-- =====================================================================
-- Desafío Bíblico — esquema base
-- Juego 1: Selección simple (1 correcta + 3 falsas, orden por llegada)
--
-- Principios:
--   * El servidor es el único árbitro. El frontend nunca decide nada.
--   * El orden de llegada lo da `answers.seq` (bigserial) bajo un candado
--     de fila sobre la ronda: sin huecos, sin empates, sin falsificar.
--   * La opción correcta NUNCA sale hacia el jugador antes de la revelación.
--   * Toda escritura pasa por una función SECURITY DEFINER. Las tablas
--     quedan cerradas: RLS activo y sin políticas.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Catálogo de juegos (el menú tiene tres; este es el primero)
-- ---------------------------------------------------------------------
create table public.games (
  slug        text primary key,
  name        text not null,
  description text not null,
  ordinal     int  not null,
  ready       boolean not null default false
);

insert into public.games (slug, name, description, ordinal, ready) values
  ('seleccion-simple', 'Selección simple',
   'Una pregunta, cuatro opciones y una sola correcta. Gana el primero que acierta.',
   1, true),
  ('completar-versiculo', 'Completar el versículo',
   'Se muestra un versículo con un hueco y hay que completarlo.',
   2, false),
  ('respuesta-abierta', 'Respuesta abierta',
   'El presentador lee la pregunta y cada participante escribe su respuesta.',
   3, false);

-- ---------------------------------------------------------------------
-- Banco de preguntas
-- ---------------------------------------------------------------------
create table public.questions (
  id             uuid primary key default gen_random_uuid(),
  game_slug      text not null references public.games(slug) on delete cascade,
  prompt         text not null check (length(btrim(prompt)) > 0),
  -- [{ "k": "a", "t": "texto de la opción" }, ...]  (siempre 4)
  options        jsonb not null check (jsonb_array_length(options) = 4),
  correct_option text not null check (correct_option in ('a','b','c','d')),
  reference      text,             -- cita bíblica opcional
  source         text not null default 'manual' check (source in ('seed','manual')),
  created_at     timestamptz not null default clock_timestamp(),
  last_played_at timestamptz       -- para no repetir hasta agotar el banco
);

create index questions_pick_idx
  on public.questions (game_slug, last_played_at nulls first);

-- ---------------------------------------------------------------------
-- Salas
-- ---------------------------------------------------------------------
create table public.rooms (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,          -- código corto para unirse
  game_slug text not null references public.games(slug),
  -- secreto del presentador: nunca se entrega a un jugador
  host_token text not null default encode(gen_random_bytes(24), 'hex'),
  -- canal de difusión privado del presentador (derivado, no el token)
  host_channel text not null default encode(gen_random_bytes(16), 'hex'),
  status    text not null default 'lobby'
            check (status in ('lobby','question','reveal','ceremony','closed')),
  paused    boolean not null default false,
  round_seconds int not null default 15 check (round_seconds between 5 and 120),
  created_at timestamptz not null default clock_timestamp(),
  ended_at   timestamptz
);

create index rooms_code_idx on public.rooms (upper(code));

-- ---------------------------------------------------------------------
-- Participantes
-- ---------------------------------------------------------------------
-- Normaliza un nombre para compararlo: minúsculas, sin tildes y con los
-- espacios colapsados. Es `immutable` a propósito, para poder usarla en
-- un índice único (a diferencia de lower() a secas, que deja pasar
-- «ANA PEREZ» junto a «Ana Pérez»).
create or replace function public.normalize_name(p_text text)
returns text
language sql immutable parallel safe
as $$
  select btrim(regexp_replace(
    lower(translate(
      btrim(p_text),
      'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
      'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'
    )),
    '\s+', ' ', 'g'));
$$;
create table public.players (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms(id) on delete cascade,
  player_token text not null default encode(gen_random_bytes(24), 'hex'),
  display_name text not null check (length(btrim(display_name)) between 2 and 40),
  joined_at   timestamptz not null default clock_timestamp(),
  score       int not null default 0,
  -- suma de milisegundos de sus respuestas correctas (criterio de desempate)
  total_ms    bigint not null default 0,
  correct_count int not null default 0,
  -- entró con la partida ya empezada: espera a la siguiente
  is_waiting  boolean not null default false,
  kicked      boolean not null default false
);

-- nombres únicos dentro de la sala, sin distinguir mayúsculas ni acentos
create unique index players_unique_name_idx
  on public.players (room_id, public.normalize_name(display_name))
  where kicked = false;

create index players_room_idx on public.players (room_id);

-- ---------------------------------------------------------------------
-- Rondas
-- ---------------------------------------------------------------------
create table public.rounds (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms(id) on delete cascade,
  question_id  uuid not null references public.questions(id),
  ordinal      int  not null,
  -- 'open' mientras corre el reloj; 'closed' cuando ya hay veredicto
  state        text not null default 'open' check (state in ('open','closed','annulled')),
  -- orden barajado de las opciones, idéntico para todos: [{k,t},...]
  option_order jsonb not null,
  opened_at    timestamptz not null default clock_timestamp(),
  deadline     timestamptz not null,
  paused_at    timestamptz,
  paused_total_ms bigint not null default 0,
  closed_at    timestamptz,
  winner_player_id uuid references public.players(id) on delete set null,
  -- se cerró sin ningún acierto
  no_winner    boolean not null default false
);

create index rounds_room_idx on public.rounds (room_id, ordinal desc);

-- ---------------------------------------------------------------------
-- Respuestas  ← aquí vive el orden real de llegada
-- ---------------------------------------------------------------------
create table public.answers (
  id        uuid primary key default gen_random_uuid(),
  seq       bigserial not null,               -- EL árbitro
  round_id  uuid not null references public.rounds(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  option_key text not null check (option_key in ('a','b','c','d')),
  is_correct boolean not null,
  elapsed_ms int not null check (elapsed_ms >= 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (round_id, player_id)                -- un solo intento por pregunta
);

create unique index answers_seq_idx on public.answers (seq);
create index answers_round_idx on public.answers (round_id, seq);

-- ---------------------------------------------------------------------
-- Utilidades internas
-- ---------------------------------------------------------------------
-- ms transcurridos desde la apertura, descontando el tiempo en pausa
create or replace function public.elapsed_ms(p_round public.rounds)
returns int
language sql stable
as $$
  select greatest(0,
    (extract(epoch from (clock_timestamp() - p_round.opened_at)) * 1000)::bigint
    - p_round.paused_total_ms
  )::int;
$$;

-- código de sala legible: sin caracteres que se confunden al dictarlos
create or replace function public.new_room_code()
returns text
language plpgsql
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  i int;
begin
  loop
    candidate := '';
    for i in 1..5 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.rooms where code = candidate);
  end loop;
  return candidate;
end;
$$;

-- baraja las cuatro opciones una sola vez, para todos por igual
create or replace function public.shuffle_options(p_options jsonb)
returns jsonb
language plpgsql
as $$
declare
  arr jsonb := p_options;
  out jsonb := '[]'::jsonb;
  i int;
  pick int;
begin
  for i in reverse 4..1 loop
    pick := 1 + floor(random() * i)::int;   -- 1..i
    out := out || jsonb_build_array(arr -> (pick - 1));
    arr := arr - (pick - 1);                -- quita ese elemento (índice base 0)
  end loop;
  return out;
end;
$$;

-- =====================================================================
-- PRESENTADOR
-- =====================================================================

-- Crea la sala. Devuelve el código y los secretos: solo el presentador los ve.
create or replace function public.host_create_room(
  p_game_slug text default 'seleccion-simple'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
begin
  insert into public.rooms (code, game_slug)
  values (public.new_room_code(), p_game_slug)
  returning * into v_room;

  return jsonb_build_object(
    'room_id',      v_room.id,
    'code',         v_room.code,
    'host_token',   v_room.host_token,
    'host_channel', v_room.host_channel,
    'round_seconds', v_room.round_seconds
  );
end;
$$;

-- Verifica el token del presentador y devuelve la sala, o lanza error.
create or replace function public.assert_host(p_room uuid, p_token text)
returns public.rooms
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
begin
  select * into v_room from public.rooms where id = p_room;
  if not found then
    raise exception 'sala_inexistente' using errcode = 'P0002';
  end if;
  if v_room.host_token is distinct from p_token then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  return v_room;
end;
$$;

-- Elige las preguntas de la partida: primero las nunca jugadas, luego las
-- más viejas. Así el banco rota en vez de repetirse al azar.
create or replace function public.host_plan_game(
  p_room uuid, p_token text, p_count int default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
  v_picked jsonb;
begin
  v_room := public.assert_host(p_room, p_token);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'prompt', q.prompt, 'reference', q.reference,
           'options', q.options, 'correct_option', q.correct_option
         ) order by q.pick_order), '[]'::jsonb)
    into v_picked
  from (
    select q.*,
           row_number() over (
             order by (q.last_played_at is not null),
                      coalesce(q.last_played_at, 'epoch'::timestamptz),
                      random()
           ) as pick_order
    from public.questions q
    where q.game_slug = v_room.game_slug
  ) q
  where q.pick_order <= greatest(1, least(p_count, 500));

  return v_picked;
end;
$$;

-- ---------------------------------------------------------------------
-- Preguntas en juego. Se guardan por partida para que el presentador
-- pueda saltar, repetir y deshacer sin volver a sortear.
-- ---------------------------------------------------------------------
create table public.game_questions (
  room_id     uuid not null references public.rooms(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  position    int  not null,
  used        boolean not null default false,
  primary key (room_id, question_id)
);

create index game_questions_order_idx on public.game_questions (room_id, position);

create or replace function public.host_set_plan(
  p_room uuid, p_token text, p_count int
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
  v_plan jsonb;
  v_item record;
  v_pos int := 0;
begin
  v_room := public.assert_host(p_room, p_token);

  if exists (select 1 from public.rounds where room_id = p_room) then
    raise exception 'partida_ya_iniciada' using errcode = 'P0001';
  end if;

  delete from public.game_questions where room_id = p_room;

  v_plan := public.host_plan_game(p_room, p_token, p_count);

  for v_item in select value as q from jsonb_array_elements(v_plan) loop
    v_pos := v_pos + 1;
    insert into public.game_questions (room_id, question_id, position)
    values (p_room, (v_item.q ->> 'id')::uuid, v_pos);
  end loop;

  return jsonb_build_object('count', v_pos);
end;
$$;

-- Abre la siguiente pregunta (o una concreta si se la pasan).
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

  if v_room.status = 'ceremony' or v_room.status = 'closed' then
    raise exception 'partida_terminada' using errcode = 'P0001';
  end if;

  -- no puede haber dos rondas abiertas a la vez
  if exists (select 1 from public.rounds where room_id = p_room and state = 'open') then
    raise exception 'ronda_abierta' using errcode = 'P0001';
  end if;

  if p_question is null then
    select question_id into v_qid
    from public.game_questions
    where room_id = p_room and used = false
    order by position
    limit 1;

    if v_qid is null then
      raise exception 'banco_agotado' using errcode = 'P0001';
    end if;
  else
    v_qid := p_question;
    insert into public.game_questions (room_id, question_id, position)
    values (p_room, v_qid,
            coalesce((select max(position) from public.game_questions where room_id = p_room), 0) + 1)
    on conflict (room_id, question_id) do nothing;
  end if;

  select * into v_q from public.questions where id = v_qid;
  v_order := public.shuffle_options(v_q.options);

  select coalesce(max(ordinal), 0) + 1 into v_ordinal
  from public.rounds where room_id = p_room;

  insert into public.rounds (
    room_id, question_id, ordinal, option_order,
    opened_at, deadline
  ) values (
    p_room, v_qid, v_ordinal, v_order,
    clock_timestamp(),
    clock_timestamp() + make_interval(secs => v_room.round_seconds)
  )
  returning * into v_round;

  update public.game_questions
     set used = true
   where room_id = p_room and question_id = v_qid;

  update public.questions
     set last_played_at = clock_timestamp()
   where id = v_qid;

  update public.rooms
     set status = 'question', paused = false
   where id = p_room;

  return jsonb_build_object('round_id', v_round.id, 'ordinal', v_ordinal);
end;
$$;

create or replace function public.host_pause(p_room uuid, p_token text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
begin
  v_room := public.assert_host(p_room, p_token);
  if v_room.paused then return; end if;

  update public.rounds
     set paused_at = clock_timestamp()
   where room_id = p_room and state = 'open' and paused_at is null;

  update public.rooms set paused = true where id = p_room;
end;
$$;

create or replace function public.host_resume(p_room uuid, p_token text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_delta bigint;
begin
  v_room := public.assert_host(p_room, p_token);
  if not v_room.paused then return; end if;

  select * into v_round from public.rounds
   where room_id = p_room and state = 'open' and paused_at is not null;

  if found then
    v_delta := (extract(epoch from (clock_timestamp() - v_round.paused_at)) * 1000)::bigint;
    update public.rounds
       set paused_at = null,
           paused_total_ms = paused_total_ms + v_delta,
           -- el reloj vuelve con los segundos que quedaban, no se reinicia
           deadline = deadline + make_interval(secs => (v_delta / 1000.0)::float8)
     where id = v_round.id;
  end if;

  update public.rooms set paused = false where id = p_room;
end;
$$;

-- Cierre de ronda: idempotente. Recalcula siempre desde las respuestas
-- guardadas, así que da igual quién lo dispare ni cuándo.
create or replace function public.host_close_round(
  p_room uuid, p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_winner public.players;
  v_correct_key text;
  v_total int;
begin
  v_room := public.assert_host(p_room, p_token);

  select * into v_round from public.rounds
   where room_id = p_room and state = 'open'
   order by ordinal desc limit 1
   for update;

  if not found then
    -- ya estaba cerrada: devolvemos el veredicto tal cual (idempotencia)
    select * into v_round from public.rounds
     where room_id = p_room and state in ('closed')
     order by ordinal desc limit 1;
    if not found then
      return jsonb_build_object('already_closed', true);
    end if;
  else
    select correct_option into v_correct_key from public.questions where id = v_round.question_id;

    select p.* into v_winner
    from public.answers a
    join public.players p on p.id = a.player_id
    where a.round_id = v_round.id and a.is_correct = true
    order by a.seq asc
    limit 1;

    if v_winner.id is not null then
      update public.players
         set score = score + 1,
             correct_count = correct_count + 1,
             total_ms = total_ms + (
               select coalesce(sum(a.elapsed_ms), 0) from public.answers a
               where a.round_id = v_round.id and a.player_id = v_winner.id and a.is_correct
             )
       where id = v_winner.id;
    end if;

    update public.rounds
       set state = 'closed',
           closed_at = clock_timestamp(),
           winner_player_id = v_winner.id,
           no_winner = (v_winner.id is null)
     where id = v_round.id
     returning * into v_round;

    update public.rooms set status = 'reveal', paused = false where id = p_room;
  end if;

  select count(*) into v_total from public.answers a where a.round_id = v_round.id;

  return jsonb_build_object(
    'round_id',   v_round.id,
    'winner_id',  v_round.winner_player_id,
    'no_winner',  v_round.no_winner,
    'answers',    v_total
  );
end;
$$;

-- Saltar: cierra sin otorgar punto y revela la correcta.
create or replace function public.host_skip_question(p_room uuid, p_token text)
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
   where room_id = p_room and state = 'open'
   order by ordinal desc limit 1 for update;

  if found then
    update public.rounds
       set state = 'closed', closed_at = clock_timestamp(),
           no_winner = true, winner_player_id = null
     where id = v_round.id;
  end if;

  update public.rooms set status = 'reveal', paused = false where id = p_room;

  return jsonb_build_object('skipped', true);
end;
$$;

-- Repetir: vuelve a lanzar la misma pregunta como ronda nueva.
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
   where room_id = p_room and state = 'closed'
   order by ordinal desc limit 1;

  if not found then
    raise exception 'nada_que_repetir' using errcode = 'P0001';
  end if;

  return public.host_open_question(p_room, p_token, v_last.question_id);
end;
$$;

-- Deshacer: anula la última ronda cerrada, devuelve el punto y la reabre.
create or replace function public.host_undo(p_room uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_winner public.players;
  v_ms bigint;
begin
  v_room := public.assert_host(p_room, p_token);

  select * into v_round from public.rounds
   where room_id = p_room and state = 'closed'
   order by ordinal desc limit 1;

  if not found then
    raise exception 'nada_que_deshacer' using errcode = 'P0001';
  end if;

  if v_round.winner_player_id is not null then
    select * into v_winner from public.players where id = v_round.winner_player_id;
    select coalesce(sum(elapsed_ms), 0) into v_ms
      from public.answers
     where round_id = v_round.id and player_id = v_round.winner_player_id and is_correct;

    update public.players
       set score = greatest(0, score - 1),
           correct_count = greatest(0, correct_count - 1),
           total_ms = greatest(0, total_ms - v_ms)
     where id = v_winner.id;
  end if;

  delete from public.answers where round_id = v_round.id;

  update public.rounds
     set state = 'open',
         winner_player_id = null,
         no_winner = false,
         closed_at = null,
         opened_at = clock_timestamp(),
         paused_at = null,
         paused_total_ms = 0,
         deadline = clock_timestamp() + make_interval(secs => v_room.round_seconds)
   where id = v_round.id;

  update public.rooms set status = 'question', paused = false where id = p_room;

  return jsonb_build_object('round_id', v_round.id, 'reopened', true);
end;
$$;

-- Descartar a un participante (nombre ofensivo, duplicado, etc.)
create or replace function public.host_remove_player(
  p_room uuid, p_token text, p_player uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_host(p_room, p_token);
  update public.players set kicked = true, is_waiting = true where id = p_player and room_id = p_room;
end;
$$;

-- Sacar de la sala de espera a quien entró tarde
create or replace function public.host_admit_player(
  p_room uuid, p_token text, p_player uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_host(p_room, p_token);
  update public.players set is_waiting = false where id = p_player and room_id = p_room;
end;
$$;

-- Terminar el juego → ceremonia de premiación
create or replace function public.host_end_game(p_room uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
begin
  v_room := public.assert_host(p_room, p_token);

  update public.rounds set state = 'closed', closed_at = clock_timestamp(), no_winner = true
   where room_id = p_room and state = 'open';

  update public.rooms set status = 'ceremony', paused = false, ended_at = clock_timestamp()
   where id = p_room;

  return jsonb_build_object('status', 'ceremony');
end;
$$;

-- =====================================================================
-- JUGADOR
-- =====================================================================

-- Entrar a la sala. Si la partida ya empezó, queda en sala de espera.
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

  select * into v_room from public.rooms where upper(code) = upper(btrim(p_code));
  if not found then
    raise exception 'sala_inexistente' using errcode = 'P0002';
  end if;
  if v_room.status in ('ceremony','closed') then
    raise exception 'sala_cerrada' using errcode = 'P0001';
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

-- Responder. Aquí está el candado que vuelve incontestable el orden.
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
  if v_player.kicked then
    raise exception 'expulsado' using errcode = '42501';
  end if;
  if v_player.is_waiting then
    raise exception 'en_espera' using errcode = 'P0001';
  end if;

  select * into v_room from public.rooms where id = v_player.room_id;
  if v_room.paused then
    raise exception 'en_pausa' using errcode = 'P0001';
  end if;

  -- EL CANDADO: serializa todas las respuestas de esta ronda.
  -- Sin él, dos inserciones simultáneas podrían confirmarse en orden inverso
  -- al de sus números de secuencia.
  select * into v_round from public.rounds
   where id = p_round and room_id = v_room.id
   for update;

  if not found then
    raise exception 'ronda_inexistente' using errcode = 'P0002';
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

  -- feedback neutro: nunca decimos si acertó hasta la revelación
  return jsonb_build_object('seq', v_answer.seq, 'received', true);
end;
$$;

-- =====================================================================
-- LECTURA
-- =====================================================================

-- Vista pública de la sala: la correcta NO viaja si la ronda está abierta.
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
  if not found then
    raise exception 'sala_inexistente' using errcode = 'P0002';
  end if;

  select * into v_round from public.rounds
   where room_id = p_room and state in ('open','closed')
   order by ordinal desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.display_name, 'score', p.score,
           'waiting', p.is_waiting
         ) order by p.score desc, p.total_ms asc, p.joined_at asc), '[]'::jsonb)
    into v_players
  from public.players p
  where p.room_id = p_room and p.kicked = false;

  if v_round.id is not null then
    select * into v_q from public.questions where id = v_round.question_id;
    select count(*) into v_answered from public.answers where round_id = v_round.id;

    v_result := jsonb_build_object(
      'round_id',    v_round.id,
      'ordinal',     v_round.ordinal,
      'state',       v_round.state,
      'prompt',      v_q.prompt,
      'reference',   v_q.reference,
      'options',     v_round.option_order,
      'opened_at',   v_round.opened_at,
      'deadline',    v_round.deadline,
      'answered',    v_answered,
      'no_winner',   v_round.no_winner,
      'winner_id',   v_round.winner_player_id,
      'winner_name', (select display_name from public.players where id = v_round.winner_player_id),
      -- revelación: la correcta solo aparece cuando la ronda ya cerró
      'correct_key', case when v_round.state = 'closed' then v_q.correct_option else null end
    );
  end if;

  return jsonb_build_object(
    'room_id',     v_room.id,
    'code',        v_room.code,
    'game_slug',   v_room.game_slug,
    'status',      v_room.status,
    'paused',      v_room.paused,
    'round_seconds', v_room.round_seconds,
    'players',     v_players,
    'round',       v_result
  );
end;
$$;

-- Vista del presentador: incluye quién respondió qué y en qué orden.
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

  select * into v_round from public.rounds
   where room_id = p_room and state in ('open','closed')
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
    -- el presentador sí puede ver la correcta en todo momento
    v_base := jsonb_set(v_base, '{round,correct_key}',
      to_jsonb((select correct_option from public.questions where id = v_round.question_id)));
  end if;

  return v_base || jsonb_build_object(
    'host_channel', v_room.host_channel,
    'plan_remaining', (select count(*) from public.game_questions
                       where room_id = p_room and used = false),
    'question_total', (select count(*) from public.questions
                       where game_slug = v_room.game_slug)
  );
end;
$$;

-- Tabla final con desempate: puntos → tiempo → orden de ingreso.
create or replace function public.final_scoreboard(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'position', pos,
           'id', id, 'name', name,
           'score', score, 'total_ms', total_ms,
           'correct_count', correct_count
         ) order by pos), '[]'::jsonb)
    into v_rows
  from (
    select row_number() over (
             order by p.score desc, p.total_ms asc, p.joined_at asc
           ) as pos,
           p.id, p.display_name as name, p.score, p.total_ms, p.correct_count
    from public.players p
    where p.room_id = p_room and p.kicked = false and p.is_waiting = false
  ) t;

  return jsonb_build_object('room_id', p_room, 'rows', v_rows);
end;
$$;

-- =====================================================================
-- DIFUSIÓN EN VIVO
-- Sólo se emiten eventos. No se abre ninguna tabla a lectura.
--   room:<uuid>        → estado público (jugadores y televisor)
--   host:<canal>       → detalle de cada respuesta (sólo el presentador)
-- =====================================================================

create or replace function public.broadcast_public()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room uuid;
  v_payload jsonb;
begin
  if tg_table_name = 'rounds' then
    v_room := new.room_id;
  else
    v_room := new.id;
  end if;

  v_payload := public.room_state(v_room);

  perform realtime.send(
    v_payload,
    'state',
    'room:' || v_room::text,
    false                          -- canal público
  );
  return null;
end;
$$;

create trigger rooms_broadcast
  after update on public.rooms
  for each row execute function public.broadcast_public();

create trigger rounds_broadcast
  after insert or update on public.rounds
  for each row execute function public.broadcast_public();

-- Cada respuesta se avisa SOLO al canal del presentador: el jugador no
-- debe saber quién respondió ni cuántos van (ahorra 50× mensajes y
-- cierra la fuga de información).
create or replace function public.broadcast_answer()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
  v_name text;
begin
  select r.* into v_room
    from public.rooms r
    join public.rounds rd on rd.room_id = r.id
   where rd.id = new.round_id;

  if not found then return null; end if;

  select display_name into v_name from public.players where id = new.player_id;

  perform realtime.send(
    jsonb_build_object(
      'round_id', new.round_id,
      'seq', new.seq,
      'player_id', new.player_id,
      'name', v_name,
      'option', new.option_key,
      'ms', new.elapsed_ms
    ),
    'answer',
    'host:' || v_room.host_channel,
    false
  );
  return null;
end;
$$;

create trigger answers_broadcast
  after insert on public.answers
  for each row execute function public.broadcast_answer();

-- =====================================================================
-- SEGURIDAD: las tablas quedan cerradas. Sólo se usan por RPC.
-- =====================================================================
alter table public.games           enable row level security;
alter table public.questions       enable row level security;
alter table public.rooms           enable row level security;
alter table public.players         enable row level security;
alter table public.rounds          enable row level security;
alter table public.answers         enable row level security;
alter table public.game_questions  enable row level security;

-- El catálogo de juegos sí es público (lo necesita el menú).
create policy "games son publicos" on public.games
  for select to anon, authenticated using (true);

grant select on public.games to anon, authenticated;

-- (sin políticas = sin acceso al resto)

revoke all on public.questions from anon, authenticated;
revoke all on public.rooms from anon, authenticated;
revoke all on public.players from anon, authenticated;
revoke all on public.rounds from anon, authenticated;
revoke all on public.answers from anon, authenticated;
revoke all on public.game_questions from anon, authenticated;

-- El acceso es por estas funciones y nada más.
grant execute on function
  public.room_state(uuid),
  public.player_join(text, text),
  public.player_answer(uuid, text, uuid, text),
  public.final_scoreboard(uuid),
  public.host_create_room(text),
  public.host_state(uuid, text),
  public.host_plan_game(uuid, text, int),
  public.host_set_plan(uuid, text, int),
  public.host_open_question(uuid, text, uuid),
  public.host_pause(uuid, text),
  public.host_resume(uuid, text),
  public.host_close_round(uuid, text),
  public.host_skip_question(uuid, text),
  public.host_repeat_question(uuid, text),
  public.host_undo(uuid, text),
  public.host_end_game(uuid, text),
  public.host_remove_player(uuid, text, uuid),
  public.host_admit_player(uuid, text, uuid)
to anon, authenticated;
