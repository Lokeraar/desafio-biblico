-- =====================================================================
-- Completar el versículo — segundo tipo de juego
--
-- El contrato está congelado en docs/completar-versiculo-contrato.md.
-- Si algo de aquí no coincide con ese documento, manda el documento.
--
-- La idea: se muestra un versículo con una o varias palabras tapadas.
-- Los participantes pulsan un botón; el primero dice el versículo en voz
-- alta y el presentador destapa las palabras que acertó. Un hueco
-- destapado nunca vuelve a taparse, salvo que el presentador deshaga.
--
-- POR QUÉ UNA COLUMNA Y NO UNA TABLA DE HUECOS:
-- el versículo se guarda UNA vez, con cada hueco entre llaves. Los huecos
-- se derivan de esa línea al leerlos. Así es imposible que el texto diga
-- una cosa y la respuesta otra, porque no hay dos sitios donde escribirlas.
--
-- Todo lo de este archivo es condicional por `game_slug`: el juego de
-- selección simple no cambia de comportamiento ni de forma de datos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Los huecos, derivados del texto
-- ---------------------------------------------------------------------
-- Devuelve [{ "indice": 0, "respuesta": "carta" }, ...] en orden de
-- aparición. Una llave vacía {} no cuenta como hueco: se ignora sin
-- consumir índice, para que el texto pueda llevar llaves vacías de
-- trabajo sin desplazar a las de verdad.
create or replace function public.versiculo_huecos(p_texto text)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_salida jsonb := '[]'::jsonb;
  v_resto  text := p_texto;
  v_ini    int;
  v_fin    int;
  v_hueco  text;
  v_idx    int := 0;
begin
  if p_texto is null then
    return '[]'::jsonb;
  end if;

  loop
    v_ini := strpos(v_resto, '{');
    exit when v_ini = 0;
    v_fin := strpos(substr(v_resto, v_ini), '}');
    exit when v_fin = 0;                 -- llave sin cerrar: se deja igual
    v_fin := v_ini + v_fin - 1;
    v_hueco := substr(v_resto, v_ini + 1, v_fin - v_ini - 1);

    if btrim(v_hueco) <> '' then
      v_salida := v_salida || jsonb_build_array(
        jsonb_build_object('indice', v_idx, 'respuesta', v_hueco)
      );
      v_idx := v_idx + 1;
    end if;

    v_resto := substr(v_resto, v_fin + 1);
  end loop;

  return v_salida;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. El texto a imprimir
-- ---------------------------------------------------------------------
-- Los índices de p_revelados salen rellenos con su respuesta; los demás
-- salen como '____'. Esta es LA función que impide la fuga: si un hueco
-- no está en p_revelados, no hay forma de que su respuesta aparezca en
-- pantalla, porque nunca se escribe en la salida.
create or replace function public.versiculo_render(p_texto text, p_revelados int[])
returns text
language plpgsql
immutable
as $$
declare
  v_salida text := '';
  v_resto  text := p_texto;
  v_ini    int;
  v_fin    int;
  v_antes  text;
  v_hueco  text;
  v_idx    int := 0;
  v_rev    int[] := coalesce(p_revelados, array[]::int[]);
begin
  if p_texto is null then
    return null;
  end if;

  loop
    v_ini := strpos(v_resto, '{');
    if v_ini = 0 then
      v_salida := v_salida || v_resto;
      exit;
    end if;
    v_fin := strpos(substr(v_resto, v_ini), '}');
    if v_fin = 0 then                   -- llave sin cerrar: se deja tal cual
      v_salida := v_salida || v_resto;
      exit;
    end if;
    v_fin := v_ini + v_fin - 1;

    v_antes := substr(v_resto, 1, v_ini - 1);
    v_hueco := substr(v_resto, v_ini + 1, v_fin - v_ini - 1);
    v_salida := v_salida || v_antes;

    if btrim(v_hueco) = '' then
      v_salida := v_salida || v_hueco;   -- llave vacía: se conserva su hueco
    elsif v_idx = any(v_rev) then
      v_salida := v_salida || v_hueco;
      v_idx := v_idx + 1;
    else
      v_salida := v_salida || '____';
      v_idx := v_idx + 1;
    end if;

    v_resto := substr(v_resto, v_fin + 1);
  end loop;

  return v_salida;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. El esquema
-- ---------------------------------------------------------------------

-- El versículo con sus huecos entre llaves. Nulo en selección simple.
alter table public.questions
  add column if not exists texto_marcado text;

-- Las cuatro opciones y la letra correcta solo obligan al juego viejo.
-- Se conserva la garantía exacta de antes para 'seleccion-simple'; el
-- juego nuevo no las usa y por eso pueden quedar nulas.
alter table public.questions alter column options drop not null;
alter table public.questions alter column correct_option drop not null;
alter table public.questions drop constraint if exists questions_options_check;
alter table public.questions
  add constraint questions_options_check
  check (game_slug <> 'seleccion-simple'
         or (options is not null and jsonb_array_length(options) = 4));
alter table public.questions drop constraint if exists questions_correct_option_check;
alter table public.questions
  add constraint questions_correct_option_check
  check (game_slug <> 'seleccion-simple'
         or (correct_option is not null and correct_option in ('a','b','c','d')));

-- El estado nuevo. 'juicio' es la ventana entre cerrar las pulsaciones y
-- el veredicto del presentador: ahí ya no se pulsa, pero tampoco está
-- resuelto.
alter table public.rounds drop constraint if exists rounds_state_check;
alter table public.rounds
  add constraint rounds_state_check
  check (state in ('prepared','open','juicio','closed','revealed','annulled'));

-- Qué huecos de ESTA ronda ya se destaparon, por índice. Vive en la ronda
-- y no en la pregunta porque el mismo versículo puede quedar a medias
-- entre dos concursantes distintos.
alter table public.rounds
  add column if not exists huecos_revelados jsonb not null default '[]'::jsonb;

-- A quién le toca. Se guarda, no se deduce en el navegador: si al
-- presentador se le recarga el teléfono a mitad de ronda, al volver sigue
-- donde iba.
alter table public.rounds
  add column if not exists turno_answer_id uuid references public.answers(id) on delete set null;

-- La pulsación no tiene opción ni acierto todavía: las dos cosas las pone
-- el presentador después.
alter table public.answers alter column option_key drop not null;
alter table public.answers alter column is_correct drop not null;
alter table public.answers drop constraint if exists answers_option_key_check;
alter table public.answers
  add constraint answers_option_key_check
  check (option_key is null or option_key in ('a','b','c','d'));

alter table public.answers
  add column if not exists veredicto text;
alter table public.answers drop constraint if exists answers_veredicto_check;
alter table public.answers
  add constraint answers_veredicto_check
  check (veredicto is null or veredicto in ('parcial','correcto','incorrecto'));

alter table public.answers
  add column if not exists huecos_ganados jsonb not null default '[]'::jsonb;

-- Cuándo se juzgó. Sirve para deshacer LA ÚLTIMA SENTENCIA y no el último
-- toque: sin esto habría que adivinar el orden, y el orden de un juicio
-- no se puede reconstruir desde seq.
alter table public.answers
  add column if not exists juzgado_at timestamptz;

-- Los puntos que ESTA respuesta se llevó al cerrar la ronda. Se guardan
-- para que deshacer pueda devolverlos exactos, sin recalcular.
alter table public.answers
  add column if not exists puntos int not null default 0;

create index if not exists answers_turno_idx
  on public.answers (round_id, seq)
  where veredicto is null;

-- ---------------------------------------------------------------------
-- 4. Utilidades internas
-- ---------------------------------------------------------------------

-- Una ronda de este juego, o error si no lo es. Evita que las funciones
-- de este archivo se usen por accidente en una ronda de selección simple.
create or replace function public.ronda_versiculo(p_round uuid)
returns public.rounds
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_round public.rounds;
  v_room  public.rooms;
begin
  select * into v_round from public.rounds where id = p_round;
  if not found then
    raise exception 'ronda_no_existe' using errcode = 'P0001';
  end if;
  select * into v_room from public.rooms where id = v_round.room_id;
  if v_room.game_slug <> 'completar-versiculo' then
    raise exception 'juego_equivocado' using errcode = 'P0001';
  end if;
  return v_round;
end;
$$;

-- Índices de todos los huecos del versículo de una ronda.
create or replace function public.huecos_de_ronda(p_round public.rounds)
returns int[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_texto text;
  v_todos int[];
begin
  select texto_marcado into v_texto
    from public.questions where id = p_round.question_id;

  select coalesce(array_agg((h->>'indice')::int), array[]::int[]) into v_todos
    from jsonb_array_elements(public.versiculo_huecos(v_texto)) h;
  return v_todos;
end;
$$;

-- Deja `huecos_revelados` igual a la unión de lo que cada uno ganó.
-- Es el invariante del estado 'juicio': un hueco se ve si y solo si
-- alguien lo acertó. Al cerrar se rompe a propósito (se ven todos), y
-- deshacer lo restaura recalculando.
create or replace function public.recalcular_revelados(p_round uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rev jsonb;
begin
  select coalesce(jsonb_agg(distinct (h)::int order by (h)::int), '[]'::jsonb)
    into v_rev
    from public.answers a,
         lateral (
           select (e)::int as h
             from jsonb_array_elements_text(a.huecos_ganados) e
         ) h
   where a.round_id = p_round
     and a.veredicto is not null;

  update public.rounds set huecos_revelados = v_rev where id = p_round;
end;
$$;

-- Cierra la ronda: destapa lo que falte, reparte los puntos de lo ganado
-- y la deja en 'closed'.
--
-- Los puntos se reparten AQUÍ y no al sentenciar. Así el marcador no
-- depende del orden de los juicios y deshacer no deja puntos sueltos.
--
-- El reparto es proporcional al hueco acertado, con el total topado en
-- 10 por versículo (docs/completar-versiculo-contrato.md §6). Se usa el
-- método del mayor resto para que la suma cuadre exactamente con el cupo
-- y nunca lo pase.
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

  update public.players p
     set score = p.score + sub.pts,
         correct_count = p.correct_count + sub.huecos,
         total_ms = p.total_ms + coalesce(sub.ms, 0)
    from (
      select a.player_id,
             sum(a.puntos) as pts,
             sum(jsonb_array_length(a.huecos_ganados)) as huecos,
             sum(a.elapsed_ms) as ms
        from public.answers a
       where a.round_id = p_round
       group by a.player_id
    ) sub
   where p.id = sub.player_id and sub.pts > 0;

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

-- ---------------------------------------------------------------------
-- 5. Pulsar el botón
-- ---------------------------------------------------------------------
-- `answers.seq` (bigserial) ES la secuencia monotónica: no se inventa
-- otra. El candado `for update` sobre la ronda toma el turno antes de
-- insertar, así dos pulsaciones simultáneas no pueden recibir el mismo
-- orden ni adelantarse entre sí.
create or replace function public.player_pulsar(
  p_player uuid, p_token text, p_round uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_player public.players;
  v_room   public.rooms;
  v_round  public.rounds;
  v_answer public.answers;
  v_orden  int;
  v_total  int;
begin
  select * into v_player from public.players where id = p_player;
  if not found or v_player.player_token <> p_token then
    raise exception 'no_autorizado' using errcode = 'P0001';
  end if;
  if v_player.kicked then
    raise exception 'jugador_expulsado' using errcode = 'P0001';
  end if;
  if v_player.is_waiting then
    raise exception 'jugador_en_espera' using errcode = 'P0001';
  end if;

  select * into v_room from public.rooms where id = v_player.room_id;
  if v_room.game_slug <> 'completar-versiculo' then
    raise exception 'juego_equivocado' using errcode = 'P0001';
  end if;
  if v_room.paused then
    raise exception 'juego_pausado' using errcode = 'P0001';
  end if;

  -- EL candado. Todo lo que sigue corre con la ronda tomada.
  select * into v_round from public.rounds
   where id = p_round and room_id = v_player.room_id
   for update;
  if not found then
    raise exception 'ronda_no_existe' using errcode = 'P0001';
  end if;
  if v_round.state <> 'open' then
    raise exception 'ronda_cerrada' using errcode = 'P0001';
  end if;
  if v_round.opened_at is not null
     and clock_timestamp() > v_round.deadline then
    raise exception 'fuera_de_tiempo' using errcode = 'P0001';
  end if;

  begin
    insert into public.answers (round_id, player_id, option_key, is_correct, elapsed_ms)
    values (v_round.id, v_player.id, null, null,
            greatest(0, floor(extract(epoch from
              (clock_timestamp() - v_round.opened_at)) * 1000)::int))
    returning * into v_answer;
  exception when unique_violation then
    raise exception 'ya_pulso' using errcode = 'P0001';
  end;

  select count(*) into v_orden from public.answers
   where round_id = v_round.id and seq <= v_answer.seq;
  select count(*) into v_total from public.answers
   where round_id = v_round.id;

  -- El primero en pulsar es el primero en hablar.
  update public.rounds set turno_answer_id = v_answer.id
   where id = v_round.id and turno_answer_id is null;

  return jsonb_build_object(
    'seq', v_answer.seq, 'orden', v_orden, 'pulsos_totales', v_total
  );
end;
$$;

grant execute on function public.player_pulsar(uuid, text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Cerrar las pulsaciones
-- ---------------------------------------------------------------------
-- Si nadie pulsó no hay nada que juzgar: la ronda se cierra sin ganador
-- y se destapa el versículo. Es el camino de salida cuando la sala se
-- queda en silencio.
create or replace function public.host_cerrar_pulsaciones(
  p_room uuid, p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room  public.rooms;
  v_round public.rounds;
  v_pulsos int;
begin
  v_room := public.assert_host(p_room, p_token);

  select * into v_round from public.rounds
   where room_id = p_room and state in ('open','juicio','closed')
   order by ordinal desc limit 1
   for update;

  if not found then
    raise exception 'nada_que_cerrar' using errcode = 'P0001';
  end if;

  if v_round.state <> 'open' then
    -- idempotente: ya estaba cerrada, no se toca nada
    return jsonb_build_object('round_id', v_round.id, 'state', v_round.state);
  end if;

  select count(*) into v_pulsos from public.answers where round_id = v_round.id;

  if v_pulsos = 0 then
    perform public.cerrar_ronda_versiculo(v_round.id);
    return jsonb_build_object(
      'round_id', v_round.id, 'state', 'closed', 'pulsos', 0
    );
  end if;

  update public.rounds
     set state = 'juicio',
         -- El turno es el primero que pulsó. Se fija aquí y no se
         -- recalcula al leer, para que la lista no se mueva.
         turno_answer_id = (
           select a.id from public.answers a
            where a.round_id = v_round.id
            order by a.seq limit 1
         )
   where id = v_round.id
   returning * into v_round;

  update public.rooms set paused = false where id = p_room;

  return jsonb_build_object(
    'round_id', v_round.id, 'state', v_round.state, 'pulsos', v_pulsos
  );
end;
$$;

grant execute on function public.host_cerrar_pulsaciones(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Sentenciar al que tiene el turno
-- ---------------------------------------------------------------------
-- `p_huecos` son los índices de los huecos que el participante dijo bien.
-- El presentador los marca en el modal después de oírlo; el sistema no
-- puede saberlo solo porque la respuesta se dice en voz alta.
create or replace function public.host_sentenciar(
  p_room uuid, p_token text, p_answer uuid,
  p_correcto boolean, p_huecos int[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room    public.rooms;
  v_round   public.rounds;
  v_answer  public.answers;
  v_rev     int[];
  v_nuevos  jsonb;
  v_todos   int[];
  v_falta   boolean;
  v_siguiente uuid;
begin
  v_room := public.assert_host(p_room, p_token);

  select * into v_round from public.rounds
   where room_id = p_room and id = (
     select round_id from public.answers where id = p_answer
   )
   for update;
  if not found then
    raise exception 'ronda_no_existe' using errcode = 'P0001';
  end if;
  if v_round.state <> 'juicio' then
    raise exception 'ronda_cerrada' using errcode = 'P0001';
  end if;
  if v_round.turno_answer_id is distinct from p_answer then
    raise exception 'no_es_el_turno' using errcode = 'P0001';
  end if;

  select * into v_answer from public.answers
   where id = p_answer and round_id = v_round.id
   for update;
  if not found then
    raise exception 'no_es_el_turno' using errcode = 'P0001';
  end if;

  select coalesce(array_agg((e)::int), array[]::int[]) into v_rev
    from jsonb_array_elements_text(v_round.huecos_revelados) e;

  if p_correcto then
    if p_huecos is null or array_length(p_huecos, 1) is null then
      raise exception 'sin_huecos' using errcode = 'P0001';
    end if;

    -- Un hueco que ya estaba a la vista no se puede volver a ganar:
    -- sería regalar puntos por algo que dijo otro.
    if exists (select 1 from unnest(p_huecos) h where h = any(v_rev)) then
      raise exception 'hueco_ya_revelado' using errcode = 'P0001';
    end if;

    v_todos := public.huecos_de_ronda(v_round);
    if exists (select 1 from unnest(p_huecos) h where not (h = any(v_todos))) then
      raise exception 'hueco_no_existe' using errcode = 'P0001';
    end if;

    select coalesce(jsonb_agg(h order by h), '[]'::jsonb) into v_nuevos
      from unnest(p_huecos) h;

    update public.answers
       set huecos_ganados = v_nuevos,
           juzgado_at = clock_timestamp()
     where id = p_answer;

    update public.rounds
       set huecos_revelados = (
         select coalesce(jsonb_agg(distinct v order by v), '[]'::jsonb)
           from (
             select (e)::int as v
               from jsonb_array_elements_text(v_round.huecos_revelados) e
             union
             select h from unnest(p_huecos) h
           ) u
       )
     where id = v_round.id
     returning * into v_round;

    -- ¿Queda algún hueco tapado?
    -- Se recalcula desde la ronda ya actualizada: `v_rev` es la foto de
    -- ANTES de sentenciar, y con ella la comparación diría siempre que
    -- falta algo, aunque se acabe de completar el versículo.
    select coalesce(array_agg((e)::int), array[]::int[]) into v_rev
      from jsonb_array_elements_text(v_round.huecos_revelados) e;

    select exists (
      select 1 from unnest(public.huecos_de_ronda(v_round)) t
       where not (t = any (v_rev))
    ) into v_falta;

    update public.answers
       set veredicto = case when v_falta then 'parcial' else 'correcto' end
     where id = p_answer;

  else
    update public.answers
       set veredicto = 'incorrecto',
           juzgado_at = clock_timestamp()
     where id = p_answer;
    v_falta := true;
  end if;

  -- ¿Sigue la ronda? Solo si queda algo tapado Y queda alguien por hablar.
  if v_falta then
    select a.id into v_siguiente
      from public.answers a
     where a.round_id = v_round.id
       and a.seq > v_answer.seq
       and a.veredicto is null
     order by a.seq limit 1;

    if v_siguiente is not null then
      update public.rounds set turno_answer_id = v_siguiente
       where id = v_round.id;
      return jsonb_build_object(
        'round_id', v_round.id, 'state', 'juicio', 'turno_answer_id', v_siguiente
      );
    end if;
  end if;

  -- Se acabó: o quedó completo, o ya no queda nadie a quien ceder el turno.
  perform public.cerrar_ronda_versiculo(v_round.id);

  return jsonb_build_object(
    'round_id', v_round.id, 'state', 'closed', 'turno_answer_id', null
  );
end;
$$;

grant execute on function public.host_sentenciar(uuid, text, uuid, boolean, int[]) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Deshacer la última sentencia
-- ---------------------------------------------------------------------
-- Deshace LA SENTENCIA COMPLETA, no el último toque: si el presentador
-- marcó dos casillas de más, un toque basta para volver atrás. Y si la
-- sentencia ya había cerrado la ronda, devuelve los puntos que había
-- repartido, porque en vivo no puede quedar nadie con puntos de un error.
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

  -- La última sentencia es la que tiene el juzgado_at más reciente.
  select * into v_answer from public.answers
   where round_id = v_round.id and juzgado_at is not null
   order by juzgado_at desc
   limit 1;

  if not found then
    raise exception 'nada_que_deshacer' using errcode = 'P0001';
  end if;

  -- Si la ronda ya se había cerrado y repartido puntos, se devuelven.
  if v_round.state in ('closed','revealed') then
    update public.players p
       set score = p.score - sub.pts,
           correct_count = greatest(0, p.correct_count - sub.huecos),
           total_ms = greatest(0, p.total_ms - coalesce(sub.ms, 0))
      from (
        select a.player_id,
               sum(a.puntos) as pts,
               sum(jsonb_array_length(a.huecos_ganados)) as huecos,
               sum(a.elapsed_ms) as ms
          from public.answers a
         where a.round_id = v_round.id and a.puntos > 0
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

  -- El estado de lo revelado se recalcula de lo que sigue ganado: un
  -- hueco que vuelve a estar tapado es una palabra que se le retira.
  perform public.recalcular_revelados(v_round.id);

  update public.rounds set turno_answer_id = v_answer.id where id = v_round.id;

  return jsonb_build_object(
    'round_id', v_round.id, 'state', 'juicio', 'turno_answer_id', v_answer.id
  );
end;
$$;

grant execute on function public.host_deshacer_sentencia(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 9. Cerrar la pregunta a mano
-- ---------------------------------------------------------------------
-- Camino de salida. Si al presentador se le cae el panel, o algo salió
-- mal en escena, esto termina la ronda sin dejar a nadie esperando un
-- turno que no va a llegar. Destapa lo que falta y CONSERVA lo ganado.
create or replace function public.host_cerrar_pregunta(p_room uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room  public.rooms;
  v_round public.rounds;
begin
  v_room := public.assert_host(p_room, p_token);

  select * into v_round from public.rounds
   where room_id = p_room and state in ('prepared','open','juicio','closed')
   order by ordinal desc limit 1
   for update;

  if not found then
    raise exception 'nada_que_cerrar' using errcode = 'P0001';
  end if;

  if v_round.state in ('closed','revealed') then
    return jsonb_build_object('round_id', v_round.id, 'state', v_round.state);
  end if;

  perform public.cerrar_ronda_versiculo(v_round.id);

  return jsonb_build_object('round_id', v_round.id, 'state', 'closed');
end;
$$;

grant execute on function public.host_cerrar_pregunta(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 10. Reabrir las pulsaciones
-- ---------------------------------------------------------------------
-- Vuelve a soltar el temporizador con la lista limpia, conservando lo
-- que ya se destapó. Solo si nadie fue juzgado todavía: si ya hubo
-- veredictos, reabrir borraría el trabajo del presentador.
create or replace function public.host_reabrir_pulsaciones(
  p_room uuid, p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room  public.rooms;
  v_round public.rounds;
begin
  v_room := public.assert_host(p_room, p_token);

  select * into v_round from public.rounds
   where room_id = p_room and state in ('juicio','open')
   order by ordinal desc limit 1
   for update;

  if not found then
    raise exception 'nada_que_reabrir' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.answers
              where round_id = v_round.id and veredicto is not null) then
    raise exception 'ya_hay_juicios' using errcode = 'P0001';
  end if;

  delete from public.answers where round_id = v_round.id;

  update public.rounds
     set state = 'open',
         turno_answer_id = null,
         opened_at = clock_timestamp(),
         deadline = clock_timestamp() + make_interval(secs => v_room.round_seconds),
         paused_at = null,
         paused_total_ms = 0
   where id = v_round.id;

  update public.rooms set status = 'question', paused = false where id = p_room;

  return jsonb_build_object('round_id', v_round.id, 'state', 'open');
end;
$$;

grant execute on function public.host_reabrir_pulsaciones(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 11. Permisos de las utilidades internas
-- ---------------------------------------------------------------------
revoke all on function public.cerrar_ronda_versiculo(uuid) from public;
revoke all on function public.recalcular_revelados(uuid) from public;
revoke all on function public.ronda_versiculo(uuid) from public;
grant execute on function public.versiculo_huecos(text) to anon, authenticated;
grant execute on function public.versiculo_render(text, int[]) to anon, authenticated;
grant execute on function public.huecos_de_ronda(public.rounds) to anon, authenticated;

-- =====================================================================
-- 12. room_state — la puerta única de jugador y televisor
--
-- Cambios respecto a la versión anterior:
--   * 'juicio' entra en la búsqueda de la ronda viva. Sin esto, las tres
--     pantallas se quedan a ciegas justo cuando el presentador está
--     juzgando, que es el momento en que más falta hace ver algo.
--   * Bloque `versiculo`, solo para este juego.
--   * `prompt` se arma con versiculo_render y los huecos ya destapados.
--
-- LA REGLA QUE NO SE NEGOCIA: `versiculo.respuesta` es null mientras el
-- estado no sea 'revealed'. Es la misma regla que protege `correct_key`.
-- =====================================================================
create or replace function public.room_state(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room    public.rooms;
  v_round   public.rounds;
  v_q       public.questions;
  v_players jsonb;
  v_answered int;
  v_result  jsonb;
  v_vers    jsonb;
  v_rev     int[];
  v_todos   jsonb;
  v_pulsos  jsonb;
  v_contestando jsonb;
  v_orden   int;
begin
  begin
    perform public.barrer_salas_inactivas(30);
  exception when others then
    null;
  end;

  select * into v_room from public.rooms where id = p_room;
  if not found then raise exception 'sala_inexistente' using errcode = 'P0002'; end if;

  select * into v_round from public.rounds
   where room_id = p_room
     and state in ('prepared','open','juicio','closed','revealed')
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

    if v_room.game_slug = 'completar-versiculo' then
      select coalesce(array_agg((e)::int), array[]::int[]) into v_rev
        from jsonb_array_elements_text(v_round.huecos_revelados) e;

      v_todos := public.versiculo_huecos(v_q.texto_marcado);

      -- Público: orden de las pulsaciones. Lo necesita cada jugador para
      -- saber su número ("fuiste el 2 en pulsar"), y ya es público en la
      -- lista de participantes.
      select coalesce(jsonb_agg(jsonb_build_object(
               'orden', t.orden, 'player_id', t.player_id,
               'nombre', t.nombre, 'veredicto', t.veredicto
             ) order by t.orden), '[]'::jsonb)
        into v_pulsos
        from (
          select row_number() over (order by a.seq) as orden,
                 a.player_id, pl.display_name as nombre, a.veredicto
            from public.answers a
            join public.players pl on pl.id = a.player_id
           where a.round_id = v_round.id
        ) t;

      -- Quién está contestando ahora, con su número de turno.
      v_contestando := null;
      if v_round.turno_answer_id is not null and v_round.state = 'juicio' then
        select jsonb_build_object('nombre', pl.display_name, 'orden', t.orden)
          into v_contestando
          from public.answers a
          join public.players pl on pl.id = a.player_id
          join lateral (
            select count(*) as orden from public.answers a2
             where a2.round_id = a.round_id and a2.seq <= a.seq
          ) t on true
         where a.id = v_round.turno_answer_id;
      end if;

      v_vers := jsonb_build_object(
        'huecos_totales', jsonb_array_length(v_todos),
        'revelados', to_jsonb(v_rev),
        'completo', (jsonb_array_length(v_todos) > 0
                     and jsonb_array_length(v_todos) = array_length(v_rev, 1)),
        -- LA REGLA
        'respuesta', case when v_round.state = 'revealed'
                          then public.versiculo_render(v_q.texto_marcado,
                                 array(select (h->>'indice')::int
                                         from jsonb_array_elements(v_todos) h))
                          else null end,
        'contestando', v_contestando,
        'pulsos', v_pulsos
      );
    end if;

    v_result := jsonb_build_object(
      'round_id', v_round.id,
      'ordinal', v_round.ordinal,
      'state', v_round.state,
      'prompt', case when v_room.game_slug = 'completar-versiculo'
                     then public.versiculo_render(v_q.texto_marcado, v_rev)
                     else v_q.prompt end,
      'reference', v_q.reference,
      'options', coalesce(v_round.option_order, '[]'::jsonb),
      'opened_at', v_round.opened_at,
      'deadline', v_round.deadline,
      'answered', v_answered,
      'no_winner', v_round.no_winner,
      'winner_id', v_round.winner_player_id,
      'winner_name', (select display_name from public.players
                       where id = v_round.winner_player_id),
      'correct_key', case when v_round.state = 'revealed'
                          then v_q.correct_option else null end,
      'answers', case when v_round.state = 'revealed'
        then (select coalesce(jsonb_agg(jsonb_build_object(
               'player_id', a.player_id, 'option', a.option_key,
               'correct', a.is_correct, 'seq', a.seq) order by a.seq), '[]'::jsonb)
              from public.answers a where a.round_id = v_round.id)
        else '[]'::jsonb end
    );

    if v_vers is not null then
      v_result := v_result || jsonb_build_object('versiculo', v_vers);
    end if;
  end if;

  return jsonb_build_object(
    'room_id', v_room.id,
    'code', v_room.code,
    'game_slug', v_room.game_slug,
    'status', v_room.status,
    'paused', v_room.paused,
    'round_seconds', v_room.round_seconds,
    'close_reason', v_room.close_reason,
    'players', v_players,
    'round', v_result
  );
end;
$$;

grant execute on function public.room_state(uuid) to anon, authenticated;

-- =====================================================================
-- 13. host_state — el presentador es el árbitro
--
-- Ve la respuesta SIEMPRE, como hoy ve `correct_key`. Y ve la lista de
-- pulsaciones con su veredicto y cuántos huecos lleva cada uno, que es
-- lo que necesita para decidir a quién le toca.
-- =====================================================================
create or replace function public.host_state(p_room uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room   public.rooms;
  v_base   jsonb;
  v_answers jsonb;
  v_round  public.rounds;
  v_q      public.questions;
  v_huecos jsonb;
  v_pulsos jsonb;
  v_rev    int[];
begin
  v_room := public.assert_host(p_room, p_token);
  v_base := public.room_state(p_room);

  select * into v_round from public.rounds
   where room_id = p_room
     and state in ('prepared','open','juicio','closed','revealed')
   order by ordinal desc limit 1;

  if v_round.id is not null then
    select * into v_q from public.questions where id = v_round.question_id;

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

    -- El árbitro ve la correcta en todo momento.
    if v_q.correct_option is not null then
      v_base := jsonb_set(v_base, '{round,correct_key}',
        to_jsonb(v_q.correct_option));
    end if;

    if v_room.game_slug = 'completar-versiculo' then
      select coalesce(array_agg((e)::int), array[]::int[]) into v_rev
        from jsonb_array_elements_text(v_round.huecos_revelados) e;

      -- Qué hueco es cuál, quién lo ganó. Solo el presentador: esto
      -- diría la respuesta antes de destaparla.
      select coalesce(jsonb_agg(jsonb_build_object(
               'indice', h.orden,
               'respuesta', h.respuesta,
               'revelado', (h.orden = any(v_rev)),
               'gano_player_id', h.gano_player_id,
               'gano_nombre', h.gano_nombre
             ) order by h.orden), '[]'::jsonb)
        into v_huecos
        from (
          select (e->>'indice')::int as orden,
                 e->>'respuesta' as respuesta,
                 (select a.player_id from public.answers a
                   where a.round_id = v_round.id
                     and (e->>'indice')::int in (
                       select (g)::int from jsonb_array_elements_text(a.huecos_ganados) g
                     )
                   order by a.seq limit 1) as gano_player_id,
                 (select pl.display_name from public.answers a
                    join public.players pl on pl.id = a.player_id
                   where a.round_id = v_round.id
                     and (e->>'indice')::int in (
                       select (g)::int from jsonb_array_elements_text(a.huecos_ganados) g
                     )
                   order by a.seq limit 1) as gano_nombre
            from jsonb_array_elements(public.versiculo_huecos(v_q.texto_marcado)) e
        ) h;

      select coalesce(jsonb_agg(jsonb_build_object(
               'seq', t.seq, 'orden', t.orden, 'player_id', t.player_id,
               'nombre', t.nombre, 'veredicto', t.veredicto,
               'huecos_ganados', t.huecos_ganados,
               'es_turno', (t.id = v_round.turno_answer_id)
             ) order by t.orden), '[]'::jsonb)
        into v_pulsos
        from (
          select a.id, a.seq,
                 row_number() over (order by a.seq) as orden,
                 a.player_id, pl.display_name as nombre, a.veredicto,
                 a.huecos_ganados
            from public.answers a
            join public.players pl on pl.id = a.player_id
           where a.round_id = v_round.id
        ) t;

      v_base := v_base
        || jsonb_build_object('huecos', v_huecos)
        || jsonb_build_object('turno_answer_id', v_round.turno_answer_id)
        || jsonb_build_object('round', (v_base -> 'round')
             || jsonb_build_object('pulsos', v_pulsos))
        || jsonb_build_object('round', (v_base -> 'round')
             || jsonb_build_object('versiculo', (v_base -> 'round' -> 'versiculo')
                  || jsonb_build_object(
                       'respuesta', public.versiculo_render(
                         v_q.texto_marcado,
                         array(select (h->>'indice')::int
                                 from jsonb_array_elements(
                                   public.versiculo_huecos(v_q.texto_marcado)) h)))));
    end if;
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

-- =====================================================================
-- 14. Abrir pregunta en este juego
--
-- `host_open_question` baraja cuatro opciones. En este juego no hay
-- opciones: `option_order` queda en '[]' y el orden de las palabras lo
-- pone `versiculo_render`. Se reescribe la función entera, no se parchea
-- alrededor, porque barajar `null` no es un caso que la versión anterior
-- pudiera manejar.
-- =====================================================================
create or replace function public.host_open_question(
  p_room uuid, p_token text, p_question uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room    public.rooms;
  v_qid     uuid;
  v_q       public.questions;
  v_order   jsonb;
  v_ordinal int;
  v_round   public.rounds;
  v_ultima  public.rounds;
begin
  v_room := public.assert_host(p_room, p_token);

  if v_room.status in ('ceremony','closed') then
    raise exception 'partida_terminada' using errcode = 'P0001';
  end if;

  select * into v_ultima from public.rounds
   where room_id = p_room order by ordinal desc limit 1;

  if v_ultima.id is not null and v_ultima.state in ('prepared','open','juicio') then
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

  -- Aquí está la diferencia: sin opciones no se baraja nada.
  if v_q.game_slug = 'completar-versiculo' then
    v_order := '[]'::jsonb;
  else
    v_order := public.shuffle_options(v_q.options);
  end if;

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

grant execute on function public.host_open_question(uuid, text, uuid) to anon, authenticated;

-- =====================================================================
-- 15. Las dos funciones viejas que este juego rompe
-- =====================================================================

-- `shuffle_options` baraja exactamente cuatro y revienta con null. Cuatro
-- sitios la llaman, así que se arregla aquí, en un solo muro, y no en
-- cada llamador. Devuelve '[]' cuando no hay opciones que barajar.
create or replace function public.shuffle_options(p_options jsonb)
returns jsonb
language plpgsql
as $$
declare
  arr jsonb := coalesce(p_options, '[]'::jsonb);
  out jsonb := '[]'::jsonb;
  i int;
  pick int;
  n int;
begin
  n := coalesce(jsonb_array_length(arr), 0);
  if n = 0 then
    return '[]'::jsonb;
  end if;
  for i in reverse n..1 loop
    pick := 1 + floor(random() * i)::int;
    out := out || jsonb_build_array(arr -> (pick - 1));
    arr := arr - (pick - 1);
  end loop;
  return out;
end;
$$;

-- El cierre automático del temporizador llama a `host_close_round`. En
-- este juego cerrar no es lo mismo: hay que destapar lo que falte y
-- repartir los puntos de lo ya ganado. Se delega en vez de duplicar la
-- lógica de la máquina de estados.
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

  -- Rama de este juego: cierra repartiendo puntos por hueco ganado.
  if v_room.game_slug = 'completar-versiculo' then
    select * into v_round from public.rounds
     where room_id = p_room and state in ('prepared','open','juicio')
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
        'round_id', v_round.id, 'winner_id', null,
        'no_winner', v_round.no_winner, 'answers', v_total,
        'already_closed', true
      );
    end if;

    perform public.cerrar_ronda_versiculo(v_round.id);
    select count(*) into v_total from public.answers where round_id = v_round.id;
    -- Se relee: si nadie acertó, cerrar_ronda_versiculo ya marcó no_winner.
    select * into v_round from public.rounds where id = v_round.id;
    return jsonb_build_object(
      'round_id', v_round.id, 'winner_id', null,
      'no_winner', v_round.no_winner, 'answers', v_total
    );
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
-- =====================================================================
-- 16. La semilla: los 29 versículos de 2 Corintios
--
-- Generado por scripts/extraer-versiculos.py desde el .docx original, no
-- escrito a mano: el texto tiene que quedar exactamente como está en el
-- documento, con sus faltas incluidas, para que se corrija desde el
-- editor y no aquí. Si el documento cambia, se vuelve a generar.
--
-- Son 29 versículos y 63 huecos. Dos versículos entran dos veces
-- (3:17 y 6:14) porque el documento los trae dos veces con huecos
-- distintos, y son dos preguntas distintas del mismo versículo.
--
-- Idempotente: reaplicar la migración no duplica nada.
-- =====================================================================
do $$
declare
  v_tema uuid;
  v_antes int;
  v_despues int;
begin
  select id into v_tema
    from public.topics
   where game_slug = 'completar-versiculo'
     and public.normalize_name(name) = public.normalize_name('2 Corintios');

  if v_tema is null then
    insert into public.topics (game_slug, name)
    values ('completar-versiculo', '2 Corintios')
    returning id into v_tema;
  end if;

  select count(*) into v_antes
    from public.questions where topic_id = v_tema;

  -- Solo se siembra si el tema está vacío. Si alguien ya lo editó desde
  -- el panel, reaplicar la migración no debe pisarle el trabajo.
  if v_antes = 0 then
    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('Pablo apóstol de Jesucristo por la voluntad de Dios, y el hermano {Timoteo} a la iglesia de Dios que está en Corinto. (2 Corintios 1: 1)', '{}'),
      'Pablo apóstol de Jesucristo por la voluntad de Dios, y el hermano {Timoteo} a la iglesia de Dios que está en Corinto. (2 Corintios 1: 1)',
      '2 Corintios 1:1',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('Pero el entendimiento de ellos se endureció; porque hasta el día de hoy, en la lectura del antiguo pacto el mismo {velo} permanece sin alzarse, pues solo en {Cristo} es quitado. (2 Corintios 3:14)', '{}'),
      'Pero el entendimiento de ellos se endureció; porque hasta el día de hoy, en la lectura del antiguo pacto el mismo {velo} permanece sin alzarse, pues solo en {Cristo} es quitado. (2 Corintios 3:14)',
      '2 Corintios 3:14',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('Porque {somos grato olor} de Cristo somos para Dios entre los que se {salvan} y entre los que se pierden. (2 Corintios 2:15)', '{}'),
      'Porque {somos grato olor} de Cristo somos para Dios entre los que se {salvan} y entre los que se pierden. (2 Corintios 2:15)',
      '2 Corintios 2:15',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('Vosotros sois nuestra {carta}, escrita en nuestros {corazones}, conocida y {leída} por todos los hombres (2 Corintios 3:2)', '{}'),
      'Vosotros sois nuestra {carta}, escrita en nuestros {corazones}, conocida y {leída} por todos los hombres (2 Corintios 3:2)',
      '2 Corintios 3:2',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('En honra y en {deshonra}, en mala fama y en buena fama; como {impostores}, pero veraces; (2 Corintios 6:8)', '{}'),
      'En honra y en {deshonra}, en mala fama y en buena fama; como {impostores}, pero veraces; (2 Corintios 6:8)',
      '2 Corintios 6:8',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('Porque la tristeza que es conforme a la voluntad de Dios produce un {arrepentimiento} que conduce a la {salvación}, sin dejar pesar; pero la tristeza del mundo produce {muerte}. (2 Corintios 7:10)', '{}'),
      'Porque la tristeza que es conforme a la voluntad de Dios produce un {arrepentimiento} que conduce a la {salvación}, sin dejar pesar; pero la tristeza del mundo produce {muerte}. (2 Corintios 7:10)',
      '2 Corintios 7:10',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('Que cada uno dé como propuso en su {corazón}, no de mala gana ni por obligación, porque Dios ama al dador {alegre}. (2 Corintios 9:7)', '{}'),
      'Que cada uno dé como propuso en su {corazón}, no de mala gana ni por obligación, porque Dios ama al dador {alegre}. (2 Corintios 9:7)',
      '2 Corintios 9:7',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('Pero el que se {gloríe}, que se gloríe en el {Señor}. (2 Corintios 10:17)', '{}'),
      'Pero el que se {gloríe}, que se gloríe en el {Señor}. (2 Corintios 10:17)',
      '2 Corintios 10:17',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('Pero esto digo: Él que {siembra} escasamente, {escasamente}, también segará; y el que siembra {abundantemente}, abundantemente también {segará} (2 Corintios 9:6)', '{}'),
      'Pero esto digo: Él que {siembra} escasamente, {escasamente}, también segará; y el que siembra {abundantemente}, abundantemente también {segará} (2 Corintios 9:6)',
      '2 Corintios 9:6',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('Porque no es aprobado el que se {alaba} a sí mismo, sino aquel a quien el Señor {alaba}. (2 Corintios 10:18)', '{}'),
      'Porque no es aprobado el que se {alaba} a sí mismo, sino aquel a quien el Señor {alaba}. (2 Corintios 10:18)',
      '2 Corintios 10:18',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('Ahora bien, el Señor es el {Espíritu}; y donde está el Espíritu del Señor, hay {libertad}. (2 Corintios 3:17)', '{}'),
      'Ahora bien, el Señor es el {Espíritu}; y donde está el Espíritu del Señor, hay {libertad}. (2 Corintios 3:17)',
      '2 Corintios 3:17',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('Ahora bien, el Señor es el Espíritu; y donde está el {Espíritu} del Señor, hay libertad. (2 Corintios 3:17)', '{}'),
      'Ahora bien, el Señor es el Espíritu; y donde está el {Espíritu} del Señor, hay libertad. (2 Corintios 3:17)',
      '2 Corintios 3:17',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('¿O qué acuerdo tiene el {templo} de Dios con los {ídolos}? (2 Corintios 6:16)', '{}'),
      '¿O qué acuerdo tiene el {templo} de Dios con los {ídolos}? (2 Corintios 6:16)',
      '2 Corintios 6:16',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('El Esparció, dio a los {POBRES}; su {JUSTICIA} permanece para siempre. (2 Corintios 9:9)', '{}'),
      'El Esparció, dio a los {POBRES}; su {JUSTICIA} permanece para siempre. (2 Corintios 9:9)',
      '2 Corintios 9:9',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('Perseguidos, pero no {abandonados}; derribados, pero no {destruidos}; (2 Corintios 4:9)', '{}'),
      'Perseguidos, pero no {abandonados}; derribados, pero no {destruidos}; (2 Corintios 4:9)',
      '2 Corintios 4:9',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('Aunque nuestro hombre exterior va {decayendo}, sin embargo, nuestro hombre interior se {renueva} dé día en día. (2 Corintios 4:16)', '{}'),
      'Aunque nuestro hombre exterior va {decayendo}, sin embargo, nuestro hombre interior se {renueva} dé día en día. (2 Corintios 4:16)',
      '2 Corintios 4:16',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('¿O qué armonía tiene Cristo con {Belial}? ¿O qué tiene en común un creyente con un {incrédulo}? (2 Corintios 6:15)', '{}'),
      '¿O qué armonía tiene Cristo con {Belial}? ¿O qué tiene en común un creyente con un {incrédulo}? (2 Corintios 6:15)',
      '2 Corintios 6:15',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('Porque las armas de nuestra contienda no son {carnales}, sino poderosas en Dios para la destrucción de {fortalezas}; (2 Corintios 10:4)', '{}'),
      'Porque las armas de nuestra contienda no son {carnales}, sino poderosas en Dios para la destrucción de {fortalezas}; (2 Corintios 10:4)',
      '2 Corintios 10:4',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('Y una vez {vestidos}, no seremos hallados {desnudos}. (2 Corintios 5:3)', '{}'),
      'Y una vez {vestidos}, no seremos hallados {desnudos}. (2 Corintios 5:3)',
      '2 Corintios 5:3',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('Porque cuando soy {débil}, entonces soy {fuerte}_. (2 Corintios 12:10)', '{}'),
      'Porque cuando soy {débil}, entonces soy {fuerte}_. (2 Corintios 12:10)',
      '2 Corintios 12:10',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('No estéis unidos en {yugo} desigual con los {incrédulos}, pues (2 Corintios 6:14)', '{}'),
      'No estéis unidos en {yugo} desigual con los {incrédulos}, pues (2 Corintios 6:14)',
      '2 Corintios 6:14',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('¿O qué comunión la {luz} con las {tinieblas}? (2 Corintios 6:14)', '{}'),
      '¿O qué comunión la {luz} con las {tinieblas}? (2 Corintios 6:14)',
      '2 Corintios 6:14',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('Y yo seré para vosotros {padre}, y vosotros seréis para mí {hijos} e hijas, dice el Señor {Todopoderoso}. (2 Corintios 6:18)', '{}'),
      'Y yo seré para vosotros {padre}, y vosotros seréis para mí {hijos} e hijas, dice el Señor {Todopoderoso}. (2 Corintios 6:18)',
      '2 Corintios 6:18',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('Tenemos de Dios un {edificio}, una casa no hecha por {manos}, eterna en los {cielos}. (2 Corintios 5:1)', '{}'),
      'Tenemos de Dios un {edificio}, una casa no hecha por {manos}, eterna en los {cielos}. (2 Corintios 5:1)',
      '2 Corintios 5:1',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('Porque por {fe} andamos, no por {vista} (2 Corintios 5:7)', '{}'),
      'Porque por {fe} andamos, no por {vista} (2 Corintios 5:7)',
      '2 Corintios 5:7',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('Porque si estamos {locos}, es para Dios; y si estamos {cuerdos}, es para vosotros. (2 Corintios 5:13)', '{}'),
      'Porque si estamos {locos}, es para Dios; y si estamos {cuerdos}, es para vosotros. (2 Corintios 5:13)',
      '2 Corintios 5:13',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('De modo que, si alguno está en Cristo, {nueva} criatura es; las cosas viejas {pasaron}; he aquí, son hechas {nuevas}. (2 Corintios 5:17)', '{}'),
      'De modo que, si alguno está en Cristo, {nueva} criatura es; las cosas viejas {pasaron}; he aquí, son hechas {nuevas}. (2 Corintios 5:17)',
      '2 Corintios 5:17',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('En el tiempo propicio te {ESCUCHÉ}, y en el día de {SALVACIÓN} te socorrí. (2 Corintios 6:2)', '{}'),
      'En el tiempo propicio te {ESCUCHÉ}, y en el día de {SALVACIÓN} te socorrí. (2 Corintios 6:2)',
      '2 Corintios 6:2',
      'seed'
    );

    insert into public.questions
      (game_slug, topic_id, prompt, texto_marcado, reference, source)
    values (
      'completar-versiculo',
      v_tema,
      public.versiculo_render('Limpiémonos de toda {inmundicia} de la carne y del espíritu, perfeccionando la santidad en el {temor} de Dios. (2 Corintios 7:1)', '{}'),
      'Limpiémonos de toda {inmundicia} de la carne y del espíritu, perfeccionando la santidad en el {temor} de Dios. (2 Corintios 7:1)',
      '2 Corintios 7:1',
      'seed'
    );
  end if;

  select count(*) into v_despues
    from public.questions where topic_id = v_tema;
  raise notice 'completar-versiculo: % versículos en el tema (antes %)',
    v_despues, v_antes;
end;
$$;
