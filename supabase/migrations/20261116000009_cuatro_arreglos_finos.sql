-- =====================================================================
-- Cuatro arreglos finos que la revisión dejó anotados
-- ---------------------------------------------------------------------
-- Ninguno rompe el juego, pero los cuatro se notan al usarlo:
--
-- 1. Deshacer dos veces seguido restaba los puntos dos veces. El botón no
--    tenía freno y la función no bloqueaba la fila: dos toques rápidos
--    leían la misma ronda y descontaban dos veces.
--
-- 2. Entrar a una sala justo cuando el presentador abre la pregunta podía
--    colar a alguien tarde. La comprobación de «la partida no empezó» y el
--    alta del jugador no eran atómicas: entre una y otra el estado podía
--    cambiar. Se arregla bloqueando la sala mientras se hace la comprobación.
--
-- 3. La limpieza de salas viejas cerraba por fecha de CREACIÓN. Una sala
--    preparada con horas de antelación para un evento se cerraba sola antes
--    de empezar. Ahora mira la última señal de vida.
--
-- 4. Repetir tenía el mismo problema que Deshacer para elegir la ronda.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Deshacer: bloquear la ronda que se está anulando
-- ---------------------------------------------------------------------
-- `for update` serializa dos toques: el segundo espera, y cuando entra ya
-- encuentra la ronda en 'prepared', así que no hay nada que deshacer y
-- responde con el error controlado en vez de descontar otra vez.
create or replace function public.host_undo(p_room uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_ms bigint;
begin
  v_room := public.assert_host(p_room, p_token);

  select * into v_round from public.rounds
   where room_id = p_room
     and state in ('closed', 'revealed')
   order by ordinal desc
   limit 1
   -- Sin esto, dos toques rápidos descontaban los puntos dos veces.
   for update;

  if not found then
    raise exception 'nada_que_deshacer' using errcode = 'P0001';
  end if;

  -- Devolver el marcador a como estaba antes de esta ronda: el que ganó
  -- recibió `puntos_por_acierto()` puntos, un acierto y su tiempo.
  if v_round.winner_player_id is not null then
    select coalesce(sum(elapsed_ms), 0) into v_ms
      from public.answers
     where round_id = v_round.id
       and player_id = v_round.winner_player_id
       and is_correct;

    update public.players
       set score = greatest(0, score - public.puntos_por_acierto()),
           correct_count = greatest(0, correct_count - 1),
           total_ms = greatest(0, total_ms - v_ms)
     where id = v_round.winner_player_id;
  end if;

  delete from public.answers where round_id = v_round.id;

  -- Vuelve a 'prepared', no a 'open': abrirla en marcha daría a los
  -- jugadores un reloj que ya venció. `deadline` es NOT NULL, y lo que
  -- marca que la cuenta no arrancó es `opened_at` en null.
  update public.rounds
     set state = 'prepared',
         winner_player_id = null,
         no_winner = false,
         closed_at = null,
         opened_at = null,
         deadline = clock_timestamp(),
         paused_at = null,
         paused_total_ms = 0
   where id = v_round.id;

  update public.rooms set status = 'question', paused = false where id = p_room;

  return jsonb_build_object('round_id', v_round.id, 'reopened', true, 'state', 'prepared');
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Repetir: la misma protección
-- ---------------------------------------------------------------------
create or replace function public.host_repeat_question(p_room uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
  v_last public.rounds;
begin
  v_room := public.assert_host(p_room, p_token);

  select * into v_last from public.rounds
   where room_id = p_room
     and state in ('closed', 'revealed')
   order by ordinal desc
   limit 1
   for update;

  if not found then
    raise exception 'nada_que_repetir' using errcode = 'P0001';
  end if;

  return public.host_open_question(p_room, p_token, v_last.question_id);
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Entrar: comprobar y crear el jugador sin ventana de carrera
-- ---------------------------------------------------------------------
-- `for update` sobre la sala serializa el alta con la apertura de la
-- pregunta. Quien llegue en ese instante espera, y al entrar ve el estado
-- de verdad: si el presentador ya abrió, recibe `partida_ya_iniciada`.
create or replace function public.player_join(
  p_code text, p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
  v_player public.players;
  v_name text := btrim(p_name);
begin
  if length(v_name) < 2 then
    raise exception 'nombre_corto' using errcode = 'P0001';
  end if;
  if length(v_name) > 40 then
    raise exception 'nombre_largo' using errcode = 'P0001';
  end if;

  select * into v_room from public.rooms
   where upper(code) = upper(btrim(p_code))
   for update;

  if not found then
    raise exception 'sala_inexistente' using errcode = 'P0002';
  end if;
  if v_room.status in ('ceremony','closed') then
    raise exception 'sala_cerrada' using errcode = 'P0001';
  end if;
  if v_room.status <> 'lobby' then
    raise exception 'partida_ya_iniciada' using errcode = 'P0001';
  end if;

  begin
    insert into public.players (room_id, display_name, is_waiting)
    values (v_room.id, v_name, v_room.status <> 'lobby')
    returning * into v_player;
  exception when unique_violation then
    raise exception 'nombre_ocupado' using errcode = '23505';
  end;

  return jsonb_build_object(
    'player_id',    v_player.id,
    'player_token', v_player.player_token,
    'room_id',      v_room.id,
    'code',         v_room.code,
    'display_name', v_player.display_name,
    'is_waiting',   v_player.is_waiting
  );
end;
$$;

grant execute on function public.host_undo(uuid, text) to anon, authenticated;
grant execute on function public.host_repeat_question(uuid, text) to anon, authenticated;
grant execute on function public.player_join(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Limpieza: cerrar por abandono, no por fecha de creación
-- ---------------------------------------------------------------------
-- Una sala preparada con horas de antelación se cerraba sola antes del
-- evento. Se mira la última señal de vida REAL de la sala: cuándo entró el
-- último jugador, cuándo se movió la última ronda, o su creación si nunca
-- pasó nada.
--
-- Las columnas son las que existen: `players` no tiene `last_seen_at`, así
-- que la señal de vida de un jugador es su `joined_at`.
update public.rooms r
   set status = 'closed', ended_at = coalesce(r.ended_at, clock_timestamp())
 where r.status in ('lobby','question','reveal')
   and greatest(
         r.created_at,
         coalesce((select max(p.joined_at) from public.players p where p.room_id = r.id), r.created_at),
         coalesce((select max(rd.opened_at) from public.rounds rd where rd.room_id = r.id), r.created_at),
         coalesce((select max(rd.closed_at) from public.rounds rd where rd.room_id = r.id), r.created_at)
       ) < clock_timestamp() - interval '3 hours';
