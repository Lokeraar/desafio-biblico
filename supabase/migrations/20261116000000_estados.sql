-- =====================================================================
-- Alinea el SQL con la máquina de estados del motor JS
-- ---------------------------------------------------------------------
-- El esquema inicial se escribió antes de que existiera el arranque manual
-- de la cuenta y la separación entre cerrar y revelar. Estados:
--
--   prepared  la pregunta se ve, pero nadie responde todavía
--   open      la cuenta corre (solo aquí se aceptan respuestas)
--   closed    cerrada: hay ganador, pero la correcta NO se muestra
--   revealed  se muestra la correcta y al ganador
--
-- Regla que no se puede romper: `correct_option` solo sale de la base
-- cuando el estado es 'revealed'.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. El check de estado
-- ---------------------------------------------------------------------
alter table public.rounds drop constraint if exists rounds_state_check;
alter table public.rounds
  add constraint rounds_state_check
  check (state in ('prepared','open','closed','revealed','annulled'));

-- ---------------------------------------------------------------------
-- 2. Abrir nace en 'prepared', sin reloj
-- ---------------------------------------------------------------------
create or replace function public.host_open_question(
  p_room uuid, p_token text, p_question uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
  v_qid uuid;
  v_q public.questions;
  v_order jsonb;
  v_ordinal int;
  v_round public.rounds;
begin
  v_room := public.assert_host(p_room, p_token);

  if v_room.status in ('ceremony','closed') then
    raise exception 'partida_terminada' using errcode = 'P0001';
  end if;

  -- no puede haber dos rondas por cerrar a la vez
  if exists (
    select 1 from public.rounds
     where room_id = p_room and state in ('prepared','open')
  ) then
    raise exception 'ronda_abierta' using errcode = 'P0001';
  end if;

  if p_question is null then
    select question_id into v_qid
      from public.game_questions
     where room_id = p_room and used = false
     order by position limit 1;

    if v_qid is null then
      raise exception 'banco_agotado' using errcode = 'P0001';
    end if;
  else
    v_qid := p_question;
    insert into public.game_questions (room_id, question_id, position)
    values (p_room, v_qid,
            coalesce((select max(position) from public.game_questions
                       where room_id = p_room), 0) + 1)
    on conflict (room_id, question_id) do nothing;
  end if;

  select * into v_q from public.questions where id = v_qid;
  v_order := public.shuffle_options(v_q.options);

  select coalesce(max(ordinal), 0) + 1 into v_ordinal
    from public.rounds where room_id = p_room;

  insert into public.rounds (
    room_id, question_id, ordinal, option_order,
    opened_at, deadline, state
  ) values (
    p_room, v_qid, v_ordinal, v_order,
    null,                              -- el reloj NO arranca aquí
    clock_timestamp(),                 -- marcador provisional
    'prepared'
  )
  returning * into v_round;

  update public.game_questions
     set used = true
   where room_id = p_room and question_id = v_qid;

  update public.questions
     set last_played_at = clock_timestamp()
   where id = v_qid;

  update public.rooms set status = 'question', paused = false where id = p_room;

  return jsonb_build_object('round_id', v_round.id, 'ordinal', v_ordinal);
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Iniciar la cuenta: aquí y solo aquí arranca el reloj
-- ---------------------------------------------------------------------
create or replace function public.host_iniciar(p_room uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
begin
  v_room := public.assert_host(p_room, p_token);

  select * into v_round from public.rounds
   where room_id = p_room and state = 'prepared'
   order by ordinal desc limit 1
   for update;

  if not found then
    raise exception 'nada_que_iniciar' using errcode = 'P0001';
  end if;

  update public.rounds
     set state = 'open',
         opened_at = clock_timestamp(),
         deadline = clock_timestamp() + make_interval(secs => v_room.round_seconds),
         paused_at = null,
         paused_total_ms = 0
   where id = v_round.id
   returning * into v_round;

  update public.rooms set status = 'question', paused = false where id = p_room;

  return jsonb_build_object('round_id', v_round.id, 'deadline', v_round.deadline);
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Cerrar NO revela. Separa el suspenso de la revelación.
-- ---------------------------------------------------------------------
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
begin
  v_room := public.assert_host(p_room, p_token);

  select * into v_round from public.rounds
   where room_id = p_room and state in ('prepared','open')
   order by ordinal desc limit 1
   for update;

  if not found then
    -- ya estaba cerrada: devolver el veredicto sin volver a sumar
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

  -- ganador: la respuesta correcta con el seq más bajo
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

-- puntos por acierto, en un solo lugar
create or replace function public.puntos_por_acierto()
returns int language sql immutable as $$ select 10 $$;

-- ---------------------------------------------------------------------
-- 5. Revelar: aquí sí se publica la correcta
-- ---------------------------------------------------------------------
create or replace function public.host_revelar(p_room uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
begin
  v_room := public.assert_host(p_room, p_token);

  select * into v_round from public.rounds
   where room_id = p_room and state = 'closed'
   order by ordinal desc limit 1
   for update;

  if not found then
    select * into v_round from public.rounds
     where room_id = p_room and state = 'revealed'
     order by ordinal desc limit 1;
    if not found then
      raise exception 'nada_que_revelar' using errcode = 'P0001';
    end if;
    return jsonb_build_object('round_id', v_round.id, 'already_revealed', true);
  end if;

  update public.rounds set state = 'revealed' where id = v_round.id
  returning * into v_round;

  return jsonb_build_object('round_id', v_round.id, 'revealed', true);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Responder: solo con la ronda 'open' y dentro del plazo
-- ---------------------------------------------------------------------
create or replace function public.player_answer(
  p_player uuid, p_token text, p_round uuid, p_option text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_player public.players;
  v_room public.rooms;
  v_round public.rounds;
  v_correct text;
  v_key text := lower(btrim(p_option));
  v_answer public.answers;
begin
  if v_key not in ('a','b','c','d') then
    raise exception 'opcion_invalida' using errcode = 'P0001';
  end if;

  select * into v_player from public.players where id = p_player;
  if not found or v_player.player_token is distinct from p_token then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if v_player.kicked then raise exception 'expulsado' using errcode = '42501'; end if;
  if v_player.is_waiting then raise exception 'en_espera' using errcode = 'P0001'; end if;

  select * into v_room from public.rooms where id = v_player.room_id;
  if v_room.paused then raise exception 'en_pausa' using errcode = 'P0001'; end if;

  -- EL CANDADO: serializa todas las respuestas de esta ronda.
  select * into v_round from public.rounds
   where id = p_round and room_id = v_room.id
   for update;

  if not found then raise exception 'ronda_inexistente' using errcode = 'P0002'; end if;
  if v_round.state = 'prepared' then
    raise exception 'cuenta_no_iniciada' using errcode = 'P0001';
  end if;
  if v_round.state <> 'open' then
    raise exception 'ronda_cerrada' using errcode = 'P0001';
  end if;
  if clock_timestamp() > v_round.deadline then
    raise exception 'tiempo_agotado' using errcode = 'P0001';
  end if;

  select correct_option into v_correct from public.questions where id = v_round.question_id;

  begin
    insert into public.answers (round_id, player_id, option_key, is_correct, elapsed_ms)
    values (v_round.id, v_player.id, v_key, v_key = v_correct, public.elapsed_ms(v_round))
    returning * into v_answer;
  exception when unique_violation then
    raise exception 'ya_respondio' using errcode = '23505';
  end;

  -- feedback neutro: nunca se dice si acertó hasta revelar
  return jsonb_build_object('seq', v_answer.seq, 'received', true);
end;
$$;

-- ---------------------------------------------------------------------
-- 7. La correcta solo viaja en 'revealed'
-- ---------------------------------------------------------------------
create or replace function public.room_state(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_q public.questions;
  v_players jsonb;
  v_answered int;
  v_result jsonb;
begin
  select * into v_room from public.rooms where id = p_room;
  if not found then raise exception 'sala_inexistente' using errcode = 'P0002'; end if;

  select * into v_round from public.rounds
   where room_id = p_room and state in ('prepared','open','closed','revealed')
   order by ordinal desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.display_name, 'score', p.score,
           'total_ms', p.total_ms, 'correct', p.correct_count,
           'joined_at', p.joined_at, 'waiting', p.is_waiting
         ) order by p.score desc, p.total_ms asc, p.joined_at asc), '[]'::jsonb)
    into v_players
    from public.players p
   where p.room_id = p_room and p.kicked = false;

  if v_round.id is not null then
    select * into v_q from public.questions where id = v_round.question_id;
    select count(*) into v_answered from public.answers where round_id = v_round.id;

    v_result := jsonb_build_object(
      'round_id', v_round.id,
      'ordinal', v_round.ordinal,
      'state', v_round.state,
      'prompt', v_q.prompt,
      'reference', v_q.reference,
      'options', v_round.option_order,
      'opened_at', v_round.opened_at,
      'deadline', v_round.deadline,
      'answered', v_answered,
      'no_winner', v_round.no_winner,
      'winner_id', v_round.winner_player_id,
      'winner_name', (select display_name from public.players
                       where id = v_round.winner_player_id),
      -- LA REGLA: la correcta solo existe al revelar
      'correct_key', case when v_round.state = 'revealed'
                          then v_q.correct_option else null end,
      'answers', case when v_round.state = 'revealed'
        then (select coalesce(jsonb_agg(jsonb_build_object(
               'player_id', a.player_id, 'option', a.option_key,
               'correct', a.is_correct, 'seq', a.seq) order by a.seq), '[]'::jsonb)
              from public.answers a where a.round_id = v_round.id)
        else '[]'::jsonb end
    );
  end if;

  return jsonb_build_object(
    'room_id', v_room.id,
    'code', v_room.code,
    'game_slug', v_room.game_slug,
    'status', v_room.status,
    'paused', v_room.paused,
    'round_seconds', v_room.round_seconds,
    'players', v_players,
    'round', v_result
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Permisos de las funciones nuevas
-- ---------------------------------------------------------------------
grant execute on function
  public.host_iniciar(uuid, text),
  public.host_revelar(uuid, text),
  public.puntos_por_acierto()
to anon, authenticated;
