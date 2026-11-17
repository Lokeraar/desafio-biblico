-- =====================================================================
-- Duración de ronda configurable, y «Cambiar pregunta» en vez de «Saltar»
-- ---------------------------------------------------------------------
-- 1. El tiempo por pregunta estaba clavado en 15 s: la columna existía con
--    rango 5–120, pero NADIE la escribía. `host_create_room` no la recibía,
--    así que todas las partidas jugaban con el valor por defecto.
--    Es un concurso de reacción rápida: el rango útil es 5–30 s, y por
--    encima de eso solo alarga una espera que nadie aprovecha.
--
-- 2. «Saltar» cerraba la ronda y pasaba a la siguiente, gastando una de las
--    preguntas preparadas. Lo que se pide es otra cosa: cambiar la pregunta
--    SIN gastar el turno. Si vas por la pregunta 4 y no te gusta, sigue
--    siendo la pregunta 4, con otra pregunta y el reloj a cero.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Rango de 5 a 30 segundos
-- ---------------------------------------------------------------------
-- Se reemplaza el constraint en vez de añadir otro: dos reglas a la vez
-- (5–120 y 5–30) dejan un rango muerto que confunde al leer el esquema.
--
-- El orden importa: primero se quita el viejo, luego se recortan las filas
-- que quedan fuera del rango nuevo, y solo después se añade el constraint.
-- Al revés, el propio ALTER falla porque las filas existentes ya lo violan.
alter table public.rooms drop constraint if exists rooms_round_seconds_check;

update public.rooms
   set round_seconds = least(30, greatest(5, round_seconds))
 where round_seconds < 5 or round_seconds > 30;

alter table public.rooms
  add constraint rooms_round_seconds_check
  check (round_seconds between 5 and 30);

alter table public.rooms alter column round_seconds set default 15;

-- ---------------------------------------------------------------------
-- 2. Crear la sala con la duración elegida
-- ---------------------------------------------------------------------
drop function if exists public.host_create_room(uuid, text);

create or replace function public.host_create_room(
  p_topic uuid,
  p_game_slug text default 'seleccion-simple',
  p_round_seconds int default 15
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
  v_topic public.topics;
  v_n int;
begin
  if p_topic is null then
    raise exception 'tema_requerido' using errcode = 'P0001';
  end if;

  select * into v_topic from public.topics where id = p_topic;
  if not found then
    raise exception 'tema_inexistente' using errcode = 'P0002';
  end if;

  select count(*) into v_n from public.questions where topic_id = p_topic;
  if v_n = 0 then
    raise exception 'tema_sin_preguntas' using errcode = 'P0001';
  end if;

  -- Se valida aquí además del constraint para dar el error con nombre
  -- propio: un mensaje crudo de Postgres no le dice nada al presentador.
  if p_round_seconds is null or p_round_seconds < 5 or p_round_seconds > 30 then
    raise exception 'tiempo_invalido' using errcode = 'P0001';
  end if;

  insert into public.rooms (code, game_slug, topic_id, round_seconds)
  values (public.new_room_code(), p_game_slug, p_topic, p_round_seconds)
  returning * into v_room;

  return jsonb_build_object(
    'room_id', v_room.id,
    'code', v_room.code,
    'host_token', v_room.host_token,
    'host_channel', v_room.host_channel,
    'round_seconds', v_room.round_seconds,
    'topic', v_topic.name
  );
end;
$$;

grant execute on function public.host_create_room(uuid, text, int) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Cambiar la pregunta sin gastar el turno
-- ---------------------------------------------------------------------
-- Misma ronda, mismo `ordinal`, otra pregunta. El reloj vuelve a cero y
-- las respuestas de la pregunta anterior se borran: nadie contestó la que
-- se está mostrando, así que no hay nada que conservar.
--
-- No toca puntos ni marca la pregunta anterior como contestada. Es el
-- presentador diciendo «esta no, otra», no un turno consumido.
create or replace function public.host_cambiar_pregunta(p_room uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_qid uuid;
  v_q public.questions;
  v_order jsonb;
begin
  v_room := public.assert_host(p_room, p_token);

  if v_room.status in ('ceremony', 'closed') then
    raise exception 'partida_terminada' using errcode = 'P0001';
  end if;

  -- Solo tiene sentido con una pregunta en pantalla, preparada o corriendo.
  select * into v_round from public.rounds
   where room_id = p_room and state in ('prepared', 'open')
   order by ordinal desc
   limit 1
   for update;

  if not found then
    raise exception 'nada_que_cambiar' using errcode = 'P0001';
  end if;

  -- Otra pregunta del banco que no se haya usado en esta partida. Se excluye
  -- también la actual: cambiar por la misma no cambiaría nada.
  select question_id into v_qid
    from public.game_questions
   where room_id = p_room
     and used = false
     and question_id <> v_round.question_id
   order by position
   limit 1;

  if v_qid is null then
    raise exception 'banco_agotado' using errcode = 'P0001';
  end if;

  select * into v_q from public.questions where id = v_qid;
  v_order := public.shuffle_options(v_q.options);

  -- La misma fila de `rounds`: mismo id, mismo ordinal.
  update public.rounds
     set question_id = v_qid,
         option_order = v_order,
         state = 'prepared',
         opened_at = null,
         deadline = clock_timestamp(),
         paused_at = null,
         paused_total_ms = 0,
         closed_at = null,
         winner_player_id = null,
         no_winner = false
   where id = v_round.id;

  -- Las respuestas de la pregunta que se quitó no valen para esta.
  delete from public.answers where round_id = v_round.id;

  -- La nueva pasa a usada; la anterior vuelve al banco para poder salir
  -- más adelante en la misma partida.
  update public.game_questions
     set used = true
   where room_id = p_room and question_id = v_qid;

  -- La rechazada NO puede conservar su `position`: la selección ordena por
  -- ella, así que en el siguiente cambio volvería a ser la primera de la
  -- lista y el botón se quedaría rebotando entre dos preguntas. Se la manda
  -- al final para que el banco avance de verdad.
  update public.game_questions
     set used = false,
         position = (select coalesce(max(g2.position), 0) + 1
                       from public.game_questions g2
                      where g2.room_id = p_room)
   where room_id = p_room and question_id = v_round.question_id;

  update public.rooms set status = 'question', paused = false where id = p_room;

  return jsonb_build_object(
    'round_id', v_round.id,
    'ordinal',  v_round.ordinal,
    'cambiada', true
  );
end;
$$;

grant execute on function public.host_cambiar_pregunta(uuid, text) to anon, authenticated;
