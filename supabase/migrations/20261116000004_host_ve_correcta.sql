-- =====================================================================
-- El presentador debe ver la respuesta correcta SIEMPRE
-- ---------------------------------------------------------------------
-- `host_state` buscaba la ronda solo en los estados 'open' y 'closed'.
-- Pero desde que la cuenta se inicia a mano, la ronda NACE en 'prepared':
-- ese es justo el momento en que el presentador lee la pregunta en voz
-- alta y necesita saber cuál es la correcta. Sin esto el panel no marcaba
-- la correcta antes de iniciar, y al cerrar sin haberla visto tampoco.
--
-- Regla que se mantiene intacta: la correcta solo viaja al presentador,
-- nunca a `room_state` (el que ve el jugador) con la ronda sin revelar.
-- =====================================================================

create or replace function public.host_state(p_room uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
  v_base jsonb;
  v_answers jsonb;
  v_round public.rounds;
begin
  v_room := public.assert_host(p_room, p_token);
  v_base := public.room_state(p_room);

  -- Cualquier ronda viva, incluida la que aún no arranca ('prepared').
  select * into v_round from public.rounds
   where room_id = p_room
     and state in ('prepared','open','closed','revealed')
   order by ordinal desc limit 1;

  if v_round.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'seq', a.seq,
             'player_id', a.player_id,
             'name', p.display_name,
             'option', a.option_key,
             'correct', a.is_correct,
             'ms', a.elapsed_ms
           ) order by a.seq), '[]'::jsonb)
      into v_answers
    from public.answers a
    join public.players p on p.id = a.player_id
    where a.round_id = v_round.id;

    v_base := jsonb_set(v_base, '{round,answers}', v_answers);

    -- El presentador es el árbitro: ve la correcta en todo momento.
    v_base := jsonb_set(v_base, '{round,correct_key}',
      to_jsonb((select correct_option from public.questions where id = v_round.question_id)));
  end if;

  return v_base || jsonb_build_object(
    'host_channel', v_room.host_channel,
    'plan_remaining', (select count(*) from public.game_questions
                       where room_id = p_room and used = false),
    'question_total', (select count(*) from public.questions
                       where topic_id = v_room.topic_id)
  );
end;
$$;

grant execute on function public.host_state(uuid, text) to anon, authenticated;
