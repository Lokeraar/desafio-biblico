-- =====================================================================
-- Temas, administración con clave maestra, y los tres defectos de R3
-- ---------------------------------------------------------------------
-- Este archivo NO contiene la clave maestra. El repositorio es público y
-- un hash publicado de 4 dígitos se revierte en minutos, además de que el
-- límite de intentos dejaría de servir. La clave se establece después con
-- un comando cuyo archivo vive en `.logs/` (ignorado por git).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Temas
-- ---------------------------------------------------------------------
create table public.topics (
  id         uuid primary key default gen_random_uuid(),
  game_slug  text not null references public.games(slug) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default clock_timestamp()
);

-- Dos temas no pueden llamarse igual dentro del mismo juego,
-- sin importar mayúsculas ni acentos.
create unique index topics_name_idx
  on public.topics (game_slug, public.normalize_name(name));

-- ---------------------------------------------------------------------
-- 2. Cada pregunta pertenece a un tema
-- ---------------------------------------------------------------------
alter table public.questions
  add column topic_id uuid references public.topics(id) on delete cascade;

-- ---------------------------------------------------------------------
-- 3. Cada sala juega UN tema (obligatorio para crear la sala)
-- ---------------------------------------------------------------------
alter table public.rooms
  add column topic_id uuid references public.topics(id);

-- ---------------------------------------------------------------------
-- 4. Clave maestra: un solo registro, sin el valor
-- ---------------------------------------------------------------------
create table public.admin_config (
  id              boolean primary key default true check (id),
  key_hash        text,                       -- null = sin configurar
  failed_attempts int not null default 0,
  locked_until    timestamptz,
  updated_at      timestamptz not null default clock_timestamp()
);

insert into public.admin_config (id) values (true) on conflict do nothing;

-- Verifica la clave maestra y aplica el freno por intentos.
-- Lanza error si la clave es incorrecta o si está bloqueado.
create or replace function public.assert_master_key(p_key text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cfg public.admin_config;
begin
  select * into v_cfg from public.admin_config where id = true for update;

  if v_cfg.key_hash is null then
    raise exception 'clave_no_configurada' using errcode = 'P0001';
  end if;

  if v_cfg.locked_until is not null and clock_timestamp() < v_cfg.locked_until then
    raise exception 'clave_bloqueada' using errcode = 'P0001';
  end if;

  -- crypt compara el texto contra el hash; nunca se guarda el texto.
  if p_key is null or extensions.crypt(p_key, v_cfg.key_hash) <> v_cfg.key_hash then
    if v_cfg.failed_attempts + 1 >= 5 then
      update public.admin_config
         set failed_attempts = 0,
             locked_until = clock_timestamp() + interval '10 minutes'
       where id = true;
    else
      update public.admin_config
         set failed_attempts = failed_attempts + 1
       where id = true;
    end if;
    raise exception 'clave_incorrecta' using errcode = 'P0001';
  end if;

  update public.admin_config
     set failed_attempts = 0, locked_until = null
   where id = true;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Comprobar la clave sin hacer nada más (para el modal)
-- ---------------------------------------------------------------------
create or replace function public.admin_check_key(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_master_key(p_key);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Cambiar la clave maestra: primero la anterior, luego la nueva
-- ---------------------------------------------------------------------
create or replace function public.admin_change_key(p_old text, p_new text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_master_key(p_old);

  if p_new is null or length(btrim(p_new)) < 4 then
    raise exception 'clave_muy_corta' using errcode = 'P0001';
  end if;
  if length(p_new) > 64 then
    raise exception 'clave_muy_larga' using errcode = 'P0001';
  end if;

  update public.admin_config
     set key_hash = extensions.crypt(p_new, extensions.gen_salt('bf')),
         failed_attempts = 0,
         locked_until = null,
         updated_at = clock_timestamp()
   where id = true;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Temas: listar (público), crear, renombrar, borrar (con clave)
-- ---------------------------------------------------------------------
create or replace function public.topic_list(p_game_slug text default 'seleccion-simple')
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'name', t.name,
           'questions', (select count(*) from public.questions q where q.topic_id = t.id)
         ) order by t.created_at), '[]'::jsonb)
  from public.topics t
  where t.game_slug = p_game_slug;
$$;

create or replace function public.topic_create(
  p_key text, p_name text, p_game_slug text default 'seleccion-simple'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_topic public.topics;
begin
  perform public.assert_master_key(p_key);

  if length(v_name) = 0 then
    raise exception 'nombre_vacio' using errcode = 'P0001';
  end if;
  if length(v_name) > 60 then
    raise exception 'nombre_muy_largo' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.topics
     where game_slug = p_game_slug
       and public.normalize_name(name) = public.normalize_name(v_name)
  ) then
    raise exception 'tema_ocupado' using errcode = '23505';
  end if;

  insert into public.topics (game_slug, name)
  values (p_game_slug, v_name)
  returning * into v_topic;

  return jsonb_build_object('id', v_topic.id, 'name', v_topic.name);
end;
$$;

create or replace function public.topic_rename(p_key text, p_topic uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_topic public.topics;
begin
  perform public.assert_master_key(p_key);

  if length(v_name) = 0 then
    raise exception 'nombre_vacio' using errcode = 'P0001';
  end if;

  select * into v_topic from public.topics where id = p_topic;
  if not found then raise exception 'tema_inexistente' using errcode = 'P0002'; end if;

  if exists (
    select 1 from public.topics
     where game_slug = v_topic.game_slug and id <> p_topic
       and public.normalize_name(name) = public.normalize_name(v_name)
  ) then
    raise exception 'tema_ocupado' using errcode = '23505';
  end if;

  update public.topics set name = v_name where id = p_topic;
  return jsonb_build_object('id', p_topic, 'name', v_name);
end;
$$;

create or replace function public.topic_delete(p_key text, p_topic uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_master_key(p_key);

  -- no se toca un tema con una partida en curso
  if exists (
    select 1 from public.rooms
     where topic_id = p_topic and status in ('lobby','question','reveal')
  ) then
    raise exception 'partida_en_curso' using errcode = 'P0001';
  end if;

  delete from public.topics where id = p_topic;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Preguntas: listar, guardar (crear o editar), borrar
-- ---------------------------------------------------------------------
create or replace function public.question_list(p_key text, p_topic uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_master_key(p_key);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', q.id, 'prompt', q.prompt, 'reference', q.reference,
             'options', q.options, 'correct_option', q.correct_option,
             'source', q.source
           ) order by q.created_at)
    from public.questions q where q.topic_id = p_topic
  ), '[]'::jsonb);
end;
$$;

-- p_options: ["texto a", "texto b", "texto c", "texto d"]
-- p_correct: 0..3  (índice dentro de ese arreglo)
-- p_question null = crear; con id = editar
create or replace function public.question_save(
  p_key text,
  p_topic uuid,
  p_question uuid,
  p_prompt text,
  p_options jsonb,
  p_correct int,
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_keys text[] := array['a','b','c','d'];
  v_prompt text := btrim(coalesce(p_prompt, ''));
  v_opts jsonb;
  v_n int;
  v_i int;
  v_texto text;
  v_vistos text[] := array[]::text[];
  v_q public.questions;
  v_game text;
begin
  perform public.assert_master_key(p_key);

  if length(v_prompt) = 0 then
    raise exception 'enunciado_vacio' using errcode = 'P0001';
  end if;
  if length(v_prompt) > 1000 then
    raise exception 'enunciado_muy_largo' using errcode = 'P0001';
  end if;

  select game_slug into v_game from public.topics where id = p_topic;
  if not found then raise exception 'tema_inexistente' using errcode = 'P0002'; end if;

  -- exactamente 4 opciones, todas con texto, sin repetir
  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    raise exception 'opciones_invalidas' using errcode = 'P0001';
  end if;
  v_n := jsonb_array_length(p_options);
  if v_n <> 4 then
    raise exception 'se_requieren_4_opciones' using errcode = 'P0001';
  end if;
  if p_correct is null or p_correct < 0 or p_correct > 3 then
    raise exception 'respuesta_correcta_invalida' using errcode = 'P0001';
  end if;

  v_opts := '[]'::jsonb;
  for v_i in 0..3 loop
    v_texto := btrim(coalesce(p_options ->> v_i, ''));
    if length(v_texto) = 0 then
      raise exception 'opcion_vacia' using errcode = 'P0001';
    end if;
    if length(v_texto) > 300 then
      raise exception 'opcion_muy_larga' using errcode = 'P0001';
    end if;
    if public.normalize_name(v_texto) = any(v_vistos) then
      raise exception 'opciones_repetidas' using errcode = 'P0001';
    end if;
    v_vistos := v_vistos || public.normalize_name(v_texto);

    v_opts := v_opts || jsonb_build_object('k', v_keys[v_i + 1], 't', v_texto);
  end loop;

  if p_question is null then
    insert into public.questions
      (game_slug, topic_id, prompt, options, correct_option, reference, source)
    values
      (v_game, p_topic, v_prompt, v_opts, v_keys[p_correct + 1],
       nullif(btrim(coalesce(p_reference, '')), ''), 'manual')
    returning * into v_q;
  else
    update public.questions
       set prompt = v_prompt,
           options = v_opts,
           correct_option = v_keys[p_correct + 1],
           reference = nullif(btrim(coalesce(p_reference, '')), '')
     where id = p_question and topic_id = p_topic
     returning * into v_q;

    if not found then
      raise exception 'pregunta_inexistente' using errcode = 'P0002';
    end if;
  end if;

  return jsonb_build_object('id', v_q.id, 'saved', true);
end;
$$;

create or replace function public.question_delete(p_key text, p_question uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_topic uuid;
begin
  perform public.assert_master_key(p_key);

  select topic_id into v_topic from public.questions where id = p_question;
  if not found then raise exception 'pregunta_inexistente' using errcode = 'P0002'; end if;

  -- borrar en plena partida dejaría una ronda sin pregunta
  if exists (
    select 1 from public.rooms
     where topic_id = v_topic and status in ('lobby','question','reveal')
  ) then
    raise exception 'partida_en_curso' using errcode = 'P0001';
  end if;

  delete from public.questions where id = p_question;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------
-- 9. R3-001: no se puede abrir pregunta nueva sin revelar la anterior
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
  v_ultima public.rounds;
begin
  v_room := public.assert_host(p_room, p_token);

  if v_room.status in ('ceremony','closed') then
    raise exception 'partida_terminada' using errcode = 'P0001';
  end if;

  -- La última ronda manda. Solo se avanza si terminó de verdad:
  -- revelada o anulada. Si quedó cerrada sin revelar, hay que revelarla.
  select * into v_ultima from public.rounds
   where room_id = p_room order by ordinal desc limit 1;

  if v_ultima.id is not null and v_ultima.state in ('prepared','open') then
    raise exception 'ronda_abierta' using errcode = 'P0001';
  end if;
  if v_ultima.id is not null and v_ultima.state = 'closed' then
    raise exception 'ronda_sin_revelar' using errcode = 'P0001';
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
    room_id, question_id, ordinal, option_order, opened_at, deadline, state
  ) values (
    p_room, v_qid, v_ordinal, v_order,
    null, clock_timestamp(), 'prepared'
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
-- 10. R3-003: revelar no inventa un éxito sobre una ronda vieja
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
  v_ultima public.rounds;
begin
  v_room := public.assert_host(p_room, p_token);

  select * into v_ultima from public.rounds
   where room_id = p_room order by ordinal desc limit 1;

  if v_ultima.id is null then
    raise exception 'nada_que_revelar' using errcode = 'P0001';
  end if;

  -- sin respaldo: si la última no está cerrada, es un error honesto
  if v_ultima.state <> 'closed' then
    raise exception 'nada_que_revelar' using errcode = 'P0001';
  end if;

  update public.rounds set state = 'revealed'
   where id = v_ultima.id
   returning * into v_round;

  return jsonb_build_object('round_id', v_round.id, 'revealed', true);
end;
$$;

-- ---------------------------------------------------------------------
-- 11. Crear sala exige un tema con preguntas
-- ---------------------------------------------------------------------
-- La versión anterior no pedía tema. Se elimina para que no queden dos
-- funciones con el mismo nombre y argumentos por defecto (ambigüedad).
drop function if exists public.host_create_room(text);

create or replace function public.host_create_room(
  p_topic uuid,
  p_game_slug text default 'seleccion-simple'
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

  insert into public.rooms (code, game_slug, topic_id)
  values (public.new_room_code(), p_game_slug, p_topic)
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

-- ---------------------------------------------------------------------
-- 12. Sorteo filtrado por el tema de la sala
-- ---------------------------------------------------------------------
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
      and q.topic_id = v_room.topic_id
  ) q
  where q.pick_order <= greatest(1, least(p_count, 500));

  return v_picked;
end;
$$;

-- ---------------------------------------------------------------------
-- 13. Borrar una pregunta no debe chocar con rondas viejas de partidas
--     ya terminadas (el juego es fugaz, no hay historial perpetuo).
-- ---------------------------------------------------------------------
alter table public.rounds drop constraint if exists rounds_question_id_fkey;
alter table public.rounds
  add constraint rounds_question_id_fkey
  foreign key (question_id) references public.questions(id) on delete cascade;

-- ---------------------------------------------------------------------
-- 14. Tema inicial: las 25 preguntas sembradas pasan a «2 Corintios»
-- ---------------------------------------------------------------------
do $$
declare
  v_topic uuid;
begin
  if not exists (
    select 1 from public.topics
     where game_slug = 'seleccion-simple'
       and public.normalize_name(name) = public.normalize_name('2 Corintios')
  ) then
    insert into public.topics (game_slug, name)
    values ('seleccion-simple', '2 Corintios')
    returning id into v_topic;
  else
    select id into v_topic from public.topics
     where game_slug = 'seleccion-simple'
       and public.normalize_name(name) = public.normalize_name('2 Corintios');
  end if;

  update public.questions
     set topic_id = v_topic
   where topic_id is null and game_slug = 'seleccion-simple';
end;
$$;

-- ---------------------------------------------------------------------
-- 15. Permisos: el navegador solo alcanza las funciones, nunca las tablas
-- ---------------------------------------------------------------------
grant execute on function
  public.admin_check_key(text),
  public.admin_change_key(text, text),
  public.topic_list(text),
  public.topic_create(text, text, text),
  public.topic_rename(text, uuid, text),
  public.topic_delete(text, uuid),
  public.question_list(text, uuid),
  public.question_save(text, uuid, uuid, text, jsonb, int, text),
  public.question_delete(text, uuid),
  public.host_create_room(uuid, text),
  public.host_plan_game(uuid, text, int)
to anon, authenticated;
