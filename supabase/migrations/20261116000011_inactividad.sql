-- =====================================================================
-- 11. CIERRE AUTOMÁTICO POR INACTIVIDAD DEL PRESENTADOR
-- ---------------------------------------------------------------------
-- Si el presentador abandona la sala (se le cerró el portátil, perdió el
-- teléfono, se fue), los jugadores se quedan mirando «espera la
-- respuesta» para siempre y el tema queda bloqueado para siempre.
--
-- La regla es sin excepciones: 30 minutos sin que el presentador haga
-- nada y la sala se cierra sola, avisando del motivo.
--
-- DE QUÉ NO SE PUEDE FINGIR ACTIVIDAD
-- -----------------------------------
-- Lo evidente sería tomar como señal el sondeo del panel (`host_state`,
-- una vez por segundo). Está mal: mientras el presentador está LEJOS, la
-- pestaña sigue abierta y sigue sondeando, así que la sala no se cerraría
-- nunca justo en el caso que hay que resolver. Cuenta solo la ACCIÓN: un
-- cambio real en la partida, que ocurre cuando alguien pulsa algo.
--
-- Por eso la señal son disparadores sobre `rooms` y `rounds`, no la
-- lectura. `player_answer` escribe en `answers`, que no se vigila: que
-- los jugadores contesten no es actividad del presentador.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columnas nuevas
-- ---------------------------------------------------------------------
-- ¿La columna ya existía? Se decide ANTES de crearla: con `if not exists`
-- después no hay forma de distinguir «la acabo de crear» de «ya estaba», y
-- el relleno de horas tiene que correr solo la primera vez. Si corriera
-- siempre, retrocedería la hora de las salas vivas y las haría parecer
-- abandonadas.
--
-- El valor inicial es la hora REAL de cada sala (`created_at` o `ended_at`),
-- no la de esta migración: una sala abandonada hace días debe cerrarse en el
-- primer barrido, no estrenar un reloj nuevo y esperar otros 30 minutos.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'rooms'
                    and column_name = 'last_activity_at') then
    alter table public.rooms
      add column last_activity_at timestamptz not null default clock_timestamp();

    -- Va aquí, antes de crear los disparadores de actividad: si no,
    -- `rooms_marcar_actividad` pisaría este valor con la hora de ahora.
    update public.rooms
       set last_activity_at = coalesce(ended_at, created_at)
     where status <> 'closed';
  end if;
end $$;

-- Motivo del cierre, para poder decirle al jugador POR QUÉ lo sacaron.
--   'inactividad' → lo cerró el barrido automático
--   null          → lo cerró el presentador (comportamiento de siempre)
alter table public.rooms
  add column if not exists close_reason text;

comment on column public.rooms.last_activity_at is
  'Última acción REAL del presentador. El sondeo del panel no cuenta.';
comment on column public.rooms.close_reason is
  'Por qué se cerró la sala: inactividad, o null si la cerró el presentador.';

-- Índice parcial: el barrido solo mira salas vivas, que son un puñado
-- frente a las miles de salas cerradas que se acumulan con el tiempo.
create index if not exists rooms_inactivas_idx
  on public.rooms (last_activity_at)
  where status in ('lobby', 'question', 'reveal', 'ceremony');

-- ---------------------------------------------------------------------
-- 2. Marcar la actividad
-- ---------------------------------------------------------------------
-- Al tocar una sala (crear, pausar, cambiar de estado) se sella la hora.
-- Es BEFORE para poder escribir en la propia fila sin lanzar otro UPDATE,
-- que volvería a disparar el mismo disparador.
create or replace function public.rooms_marcar_actividad()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- El barrido también escribe en `rooms`; si sellara la hora, la sala
  -- quedaría «activa» justo al cerrarla y el barrido se pelearía consigo
  -- mismo. La función del barrido avisa por aquí de que es ella.
  if current_setting('desafio.barrido', true) = 'on' then
    return new;
  end if;

  -- Una sala ya cerrada no necesita latido: nadie va a volver a ella.
  if new.status = 'closed' then
    return new;
  end if;

  new.last_activity_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists rooms_actividad on public.rooms;
create trigger rooms_actividad
  before insert or update on public.rooms
  for each row execute function public.rooms_marcar_actividad();

-- Toda jugada del presentador pasa por `rounds`: abrir pregunta, revelar,
-- repetir, deshacer, cambiar pregunta. Ahí está la señal buena.
create or replace function public.rounds_marcar_actividad()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if current_setting('desafio.barrido', true) = 'on' then
    return null;
  end if;

  update public.rooms
     set last_activity_at = clock_timestamp()
   where id = new.room_id
     and status <> 'closed';

  return null;
end;
$$;

drop trigger if exists rounds_actividad on public.rounds;
create trigger rounds_actividad
  after insert or update on public.rounds
  for each row execute function public.rounds_marcar_actividad();

-- ---------------------------------------------------------------------
-- 3. El barrido
-- ---------------------------------------------------------------------
-- Cierra las salas que llevan demasiado tiempo sin que el presentador
-- haga nada. Devuelve cuántas cerró.
--
-- No hay `pg_cron` en este proyecto, así que se llama de forma perezosa
-- desde `room_state`: es exactamente el momento en que alguien está
-- mirando. Un cerrojo de aviso evita que diez teléfonos sondeando a la
-- vez lancen diez barridos; el que no consigue el cerrojo se va sin
-- hacer nada, porque el que sí lo tiene va a hacer el mismo trabajo.
create or replace function public.barrer_salas_inactivas(p_minutos int default 30)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cerradas int := 0;
  v_ids uuid[];
begin
  if p_minutos is null or p_minutos < 1 then
    return 0;
  end if;

  /*
   * Cerrojo contra la RECURSION, y va primero.
   *
   * El barrido escribe en `rooms` y en `rounds`, y esas tablas tienen
   * disparadores de difusión que llaman a `room_state`; `room_state` llama
   * al barrido. Sin esta salida temprana el ciclo no termina nunca: la
   * pila desborda y el jugador recibe un error en vez de su estado.
   *
   * `pg_try_advisory_xact_lock` NO sirve para esto: los cerrojos de
   * transacción se pueden volver a tomar por la misma transacción, así que
   * la segunda llamada también entraría. Un ajuste de sesión, en cambio,
   * es visible para la llamada anidada y la corta en seco.
   */
  if coalesce(current_setting('desafio.barrido', true), 'off') = 'on' then
    return 0;
  end if;

  if not pg_try_advisory_xact_lock(hashtext('desafio_barrido_inactividad')) then
    return 0;
  end if;

  perform set_config('desafio.barrido', 'on', true);

  -- Se marcan las salas ANTES de cerrarlas para no tocar el disparador
  -- de actividad desde aquí (ver `rooms_marcar_actividad`).
  perform set_config('desafio.barrido', 'on', true);

  select coalesce(array_agg(id), '{}')
    into v_ids
    from public.rooms
   where status in ('lobby', 'question', 'reveal', 'ceremony')
     and last_activity_at < clock_timestamp() - make_interval(mins => p_minutos);

  if cardinality(v_ids) = 0 then
    perform set_config('desafio.barrido', 'off', true);
    return 0;
  end if;

  -- Ninguna ronda puede quedar abierta: si la sala se cierra con una
  -- pregunta en curso, el reloj seguiría corriendo en los teléfonos.
  update public.rounds
     set state = 'closed', closed_at = clock_timestamp(), no_winner = true
   where room_id = any(v_ids)
     and state in ('prepared', 'open', 'closed');

  update public.rooms
     set status = 'closed',
         paused = false,
         ended_at = coalesce(ended_at, clock_timestamp()),
         close_reason = 'inactividad'
   where id = any(v_ids);

  -- Se cuenta antes de actualizar, no con `row_count`: un disparador
  -- intermedio puede hacer que el contador no refleje lo cerrado, y el
  -- número se usa para saber si hubo trabajo. La lista ya es la verdad.
  v_cerradas := cardinality(v_ids);

  perform set_config('desafio.barrido', 'off', true);
  return v_cerradas;
end;
$$;

revoke all on function public.barrer_salas_inactivas(int) from public;
-- Sin `grant` a `anon`: solo se llama desde dentro de `room_state`, que es
-- `security definer` y corre con permisos del dueño. Dárselo a los clientes
-- permitiría a cualquiera disparar el barrido a voluntad y cerrar salas
-- ajenas abandonadas que no le importan.

-- ---------------------------------------------------------------------
-- 4. `room_state` devuelve el motivo y barre de paso
-- ---------------------------------------------------------------------
-- El jugador necesita saber POR QUÉ lo sacaron. `host_state` arma su
-- respuesta sobre esta función, así que el presentador lo recibe gratis.
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
  -- Barrido perezoso: se aprovecha cada lectura para cerrar lo que quedó
  -- abandonado. Cuesta un UPDATE indexado y deja el sistema limpio sin
  -- necesitar un planificador externo.
  --
  -- Va dentro de un bloque protegido a propósito: si el barrido fallara por
  -- lo que sea, el jugador NO debe quedarse sin su estado. Cerrar salas
  -- viejas es una limpieza; mostrar la partida es lo urgente.
  begin
    perform public.barrer_salas_inactivas(30);
  exception when others then
    null;
  end;

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
    -- Por qué se cerró, para el aviso al jugador. Null = lo cerró el
    -- presentador, que se cuenta con el texto de siempre.
    'close_reason', v_room.close_reason,
    'players', v_players,
    'round', v_result
  );
end;
$$;

grant execute on function public.room_state(uuid) to anon, authenticated;
