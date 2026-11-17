-- =====================================================================
-- Repetir y Deshacer deben funcionar después de revelar
-- ---------------------------------------------------------------------
-- Los dos buscaban la última ronda con `state = 'closed'`. Pero revelar
-- cambia la ronda a 'revealed', así que en cuanto el presentador revelaba
-- la respuesta —el momento más natural para querer deshacer o repetir—
-- las dos funciones decían «no hay nada»:
--
--   · Deshacer: «nada_que_deshacer»
--   · Repetir:  «nada_que_repetir»
--
-- La última ronda jugada es la última por `ordinal`, sin importar en qué
-- estado quedó. Eso es lo que buscan ahora.
--
-- Además había un error de puntos en `host_undo`: restaba 1 en vez de los
-- 10 de `puntos_por_acierto()`. Devolver 1 de 10 dejaba al jugador con 9
-- puntos por una pregunta anulada, y al repetirla y volver a acertar subía a
-- 19. Un deshacer tiene que devolver el marcador EXACTAMENTE a donde estaba.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Repetir: la última ronda jugada, esté 'closed' o 'revealed'
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

  -- La última ronda jugada, en cualquier estado final. `revealed` cuenta
  -- igual que `closed`: repetir después de revelar es justo lo que se pide.
  select * into v_last from public.rounds
   where room_id = p_room
     and state in ('closed', 'revealed')
   order by ordinal desc
   limit 1;

  if not found then
    raise exception 'nada_que_repetir' using errcode = 'P0001';
  end if;

  -- Se vuelve a abrir la MISMA pregunta: host_open_question la pone en
  -- 'prepared' con las opciones barajadas de nuevo y sin respuestas.
  return public.host_open_question(p_room, p_token, v_last.question_id);
end;
$$;

-- ---------------------------------------------------------------------
-- Deshacer: idem, y devolviendo los puntos completos
-- ---------------------------------------------------------------------
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
   limit 1;

  if not found then
    raise exception 'nada_que_deshacer' using errcode = 'P0001';
  end if;

  -- Devolver el marcador a como estaba antes de esta ronda. El que ganó la
  -- ronda recibió `puntos_por_acierto()` puntos, un acierto y su tiempo; se
  -- le quita exactamente eso. Los que no ganaron no se tocan: sus respuestas
  -- incorrectas no sumaron nada.
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

  -- La ronda vuelve a 'prepared', NO a 'open'. Abrirla en marcha le daría a
  -- los jugadores un reloj que ya venció mientras el presentador releía la
  -- pregunta. En 'prepared' se ve la pregunta y el presentador decide cuándo
  -- arranca la cuenta otra vez.
  --
  -- `rounds` no tiene columna `revealed_at`: el estado 'revealed' se guarda
  -- solo en `state`. Poner aquí esa columna hacía fallar el UPDATE entero.
  --
  -- `deadline` es NOT NULL, así que no puede quedar en null: se pone la hora
  -- actual, igual que hace `host_open_question` al crear una ronda en
  -- 'prepared'. Lo que marca que la cuenta NO ha arrancado es `opened_at`
  -- en null, no `deadline`.
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

grant execute on function public.host_repeat_question(uuid, text) to anon, authenticated;
grant execute on function public.host_undo(uuid, text) to anon, authenticated;
