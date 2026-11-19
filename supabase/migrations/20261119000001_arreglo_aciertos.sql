-- =====================================================================
-- Arreglo: `correct_count` cuenta PREGUNTAS, no huecos
--
-- Defecto encontrado al revisar la ceremonia. `players.correct_count` ya
-- existía para selección simple, donde vale «cuántas preguntas acertó» y
-- la tabla final lo imprime como «N aciertos».
--
-- En completar el versículo lo estaba sumando por hueco: quien acertaba
-- dos palabras de un mismo versículo quedaba con 2 aciertos cuando había
-- acertado UNA pregunta. La tabla habría dicho «2 aciertos» por un solo
-- versículo.
--
-- Ahora se suma 1 por ronda en la que el participante ganó al menos un
-- hueco. `score` sigue repartiendo por hueco: son dos cosas distintas y
-- cada una mide lo suyo.
-- =====================================================================

create or replace function public.cerrar_ronda_versiculo(p_round uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_round public.rounds;
  v_todos int[];
  v_n     int;
  v_s     int;
  v_cupo  int;
  v_suma  int;
begin
  select * into v_round from public.rounds where id = p_round for update;
  if not found then return; end if;
  if v_round.state in ('closed','revealed') then return; end if;

  v_todos := public.huecos_de_ronda(v_round);
  v_n := coalesce(array_length(v_todos, 1), 0);

  -- Todos los huecos a la vista: al cerrar no queda nada tapado.
  update public.rounds
     set huecos_revelados = to_jsonb(v_todos),
         turno_answer_id = null
   where id = p_round;

  select coalesce(sum(jsonb_array_length(huecos_ganados)), 0) into v_s
    from public.answers where round_id = p_round;

  if v_s = 0 or v_n = 0 then
    -- Directo a 'revealed': en este juego cerrar ya destapa todos los
    -- huecos, así que pedir un «revelar» aparte sería un botón que no
    -- hace nada y una ronda que puede quedarse trabada en 'closed'.
    update public.rounds
       set state = 'revealed', closed_at = clock_timestamp(),
           winner_player_id = null, no_winner = true
     where id = p_round;
    update public.rooms set status = 'reveal', paused = false
     where id = v_round.room_id;
    return;
  end if;

  v_cupo := (10 * v_s) / v_n;             -- división entera = floor

  with base as (
    select a.id, jsonb_array_length(a.huecos_ganados) as k, a.seq
      from public.answers a
     where a.round_id = p_round and jsonb_array_length(a.huecos_ganados) > 0
  ), calc as (
    select id, k, seq,
           (v_cupo * k) / v_s as base_p,
           (v_cupo * k) % v_s as resto_p
      from base
  ), ranked as (
    select id, base_p,
           row_number() over (order by resto_p desc, seq asc) as rn
      from calc
  ), tope as (
    select coalesce(sum(base_p), 0) as suma from calc
  )
  update public.answers a
     set puntos = r.base_p
                  + case when r.rn <= (v_cupo - (select suma from tope))
                         then 1 else 0 end
    from ranked r
   where a.id = r.id;

  -- correct_count suma UNA pregunta por ronda, no un hueco por palabra.
  -- El que ganó algún hueco acertó la pregunta, aunque no la completara.
  update public.players p
     set score = p.score + sub.pts,
         correct_count = p.correct_count + 1,
         total_ms = p.total_ms + coalesce(sub.ms, 0)
    from (
      select a.player_id,
             sum(a.puntos) as pts,
             sum(a.elapsed_ms) as ms
        from public.answers a
       where a.round_id = p_round
         and jsonb_array_length(a.huecos_ganados) > 0
       group by a.player_id
    ) sub
   where p.id = sub.player_id;

  select coalesce(sum(puntos), 0) into v_suma
    from public.answers where round_id = p_round;

  update public.rounds
     set state = 'revealed', closed_at = clock_timestamp(),
         winner_player_id = null,      -- la ronda la gana el versículo
         no_winner = (v_suma = 0)
   where id = p_round;

  update public.rooms set status = 'reveal', paused = false
   where id = v_round.room_id;
end;
$$;

revoke all on function public.cerrar_ronda_versiculo(uuid) from public;

-- ---------------------------------------------------------------------
-- El mismo defecto estaba en deshacer: devolvía huecos como aciertos.
-- Si `correct_count` sube de 1 en 1 al cerrar, al deshacer baja de 1 en 1.
-- ---------------------------------------------------------------------
create or replace function public.host_deshacer_sentencia(
  p_room uuid, p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room   public.rooms;
  v_round  public.rounds;
  v_answer public.answers;
begin
  v_room := public.assert_host(p_room, p_token);

  select * into v_round from public.rounds
   where room_id = p_room and state in ('juicio','closed','revealed')
   order by ordinal desc limit 1
   for update;

  if not found then
    raise exception 'nada_que_deshacer' using errcode = 'P0001';
  end if;

  select * into v_answer from public.answers
   where round_id = v_round.id and juzgado_at is not null
   order by juzgado_at desc
   limit 1;

  if not found then
    raise exception 'nada_que_deshacer' using errcode = 'P0001';
  end if;

  if v_round.state in ('closed','revealed') then
    -- Se devuelve un acierto por participante que hubiera ganado algo,
    -- no uno por hueco: es el inverso exacto de lo que sumó el cierre.
    update public.players p
       set score = p.score - sub.pts,
           correct_count = greatest(0, p.correct_count - 1),
           total_ms = greatest(0, p.total_ms - coalesce(sub.ms, 0))
      from (
        select a.player_id,
               sum(a.puntos) as pts,
               sum(a.elapsed_ms) as ms
          from public.answers a
         where a.round_id = v_round.id
           and jsonb_array_length(a.huecos_ganados) > 0
         group by a.player_id
      ) sub
     where p.id = sub.player_id;

    update public.answers set puntos = 0 where round_id = v_round.id;

    update public.rounds
       set state = 'juicio', closed_at = null, winner_player_id = null,
           no_winner = false
     where id = v_round.id;

    update public.rooms set status = 'question' where id = p_room;
  end if;

  update public.answers
     set veredicto = null, huecos_ganados = '[]'::jsonb,
         juzgado_at = null, puntos = 0
   where id = v_answer.id;

  perform public.recalcular_revelados(v_round.id);

  update public.rounds set turno_answer_id = v_answer.id where id = v_round.id;

  return jsonb_build_object(
    'round_id', v_round.id, 'state', 'juicio', 'turno_answer_id', v_answer.id
  );
end;
$$;

grant execute on function public.host_deshacer_sentencia(uuid, text) to anon, authenticated;

-- =====================================================================
-- Arreglo crítico: el temporizador NO puede borrar los turnos
--
-- `alCero` en app.js llama a `host_close_round` cuando vence el reloj.
-- En este juego esa función cerraba la ronda entera: destapaba todo, no
-- dejaba contestar a nadie y repartía cero puntos. Los pulsos quedaban
-- anotados pero nadie podía usarlos.
--
-- El temporizador limita CUÁNDO se puede pulsar, nunca cuándo se puede
-- contestar. Quien pulsó a tiempo conserva su turno.
--
-- Ahora vencer es «cerrar las pulsaciones»: pasa a 'juicio' y la lista
-- de turnos queda intacta.
-- =====================================================================
create or replace function public.host_close_round(p_room uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_winners public.players;
  v_total int;
  v_pulsos int;
begin
  v_room := public.assert_host(p_room, p_token);

  if v_room.game_slug = 'completar-versiculo' then
    -- Vencer no es cerrar: es dejar de aceptar pulsaciones y abrir el
    -- juicio con los turnos que ya están anotados.
    return public.host_cerrar_pulsaciones(p_room, p_token);
  end if;

  -- Rama de siempre, sin cambios de comportamiento.
  select * into v_round from public.rounds
   where room_id = p_room and state in ('prepared','open')
   order by ordinal desc limit 1
   for update;

  if not found then
    select * into v_round from public.rounds
     where room_id = p_room and state in ('closed','revealed')
     order by ordinal desc limit 1;
    if not found then
      return jsonb_build_object('already_closed', true);
    end if;
    select count(*) into v_total from public.answers where round_id = v_round.id;
    return jsonb_build_object(
      'round_id', v_round.id, 'winner_id', v_round.winner_player_id,
      'no_winner', v_round.no_winner, 'answers', v_total, 'already_closed', true
    );
  end if;

  select p.* into v_winners
    from public.answers a
    join public.players p on p.id = a.player_id
   where a.round_id = v_round.id and a.is_correct = true
   order by a.seq asc
   limit 1;

  if v_winners.id is not null then
    update public.players p
       set score = p.score + public.puntos_por_acierto(),
           correct_count = p.correct_count + 1,
           total_ms = p.total_ms + coalesce((
             select sum(a.elapsed_ms) from public.answers a
              where a.round_id = v_round.id
                and a.player_id = v_winners.id and a.is_correct
           ), 0)
     where p.id = v_winners.id;
  end if;

  update public.rounds
     set state = 'closed',
         closed_at = clock_timestamp(),
         winner_player_id = v_winners.id,
         no_winner = (v_winners.id is null)
   where id = v_round.id
   returning * into v_round;

  update public.rooms set status = 'reveal', paused = false where id = p_room;

  select count(*) into v_total from public.answers where round_id = v_round.id;

  return jsonb_build_object(
    'round_id', v_round.id, 'winner_id', v_round.winner_player_id,
    'no_winner', v_round.no_winner, 'answers', v_total
  );
end;
$$;

grant execute on function public.host_close_round(uuid, text) to anon, authenticated;
