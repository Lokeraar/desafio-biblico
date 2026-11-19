-- =====================================================================
-- Prueba de punta a punta del esquema.
-- Se corre contra un Postgres pelado con el shim de Supabase aplicado.
-- Cualquier regla incumplida aborta con excepción.
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages to notice;

create or replace function public.t_assert(cond boolean, msg text)
returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then
    raise exception 'FALLA: %', msg;
  end if;
  raise notice '  ok   %', msg;
end;
$$;

do $$
declare
  v_host    jsonb; v_room uuid; v_token text; v_code text;
  v_p1 jsonb; v_p2 jsonb; v_p3 jsonb;
  v_id1 uuid; v_id2 uuid; v_id3 uuid;
  v_t1 text;  v_t2 text;
  v_round uuid;
  v_state jsonb; v_hstate jsonb;
  v_correct text; v_wrong text;
  v_close jsonb; v_close2 jsonb; v_undo jsonb;
  v_final jsonb; v_rows jsonb;
  v_late jsonb;
  v_err text;
  v_seqs bigint[];
  v_opts jsonb;
  v_topic uuid;
  v_host2 jsonb;
  v_q1 uuid; v_q2 uuid; v_q3 uuid; v_ord int;
  v_marca jsonb; v_webp text; v_png text; v_clave text;
begin

raise notice '=== 1. Sala y banco ===';
-- La firma cambió en la migración 02: ahora exige el tema. Se toma el
-- primero que tenga preguntas, que es lo que el panel ofrece por defecto.
select t.id into v_topic
  from public.topics t
 where t.game_slug = 'seleccion-simple'
   and exists (select 1 from public.questions q where q.topic_id = t.id)
 order by t.created_at
 limit 1;
perform public.t_assert(v_topic is not null, 'hay un tema con preguntas');

v_host  := public.host_create_room(v_topic, 'seleccion-simple', 15);
v_room  := (v_host->>'room_id')::uuid;
v_token := v_host->>'host_token';
v_code  := v_host->>'code';
perform public.t_assert(length(v_code) = 5, 'el código de sala tiene 5 caracteres');

-- Duración de ronda: se guarda la pedida y el rango 5–30 se respeta.
perform public.t_assert((v_host->>'round_seconds')::int = 15,
                        'la sala guarda los 15 s pedidos');
begin
  perform public.host_create_room(v_topic, 'seleccion-simple', 45);
  v_err := 'sin_error';
exception when others then v_err := sqlerrm;
end;
perform public.t_assert(v_err = 'tiempo_invalido', '45 s se rechaza (máximo 30)');
begin
  perform public.host_create_room(v_topic, 'seleccion-simple', 3);
  v_err := 'sin_error';
exception when others then v_err := sqlerrm;
end;
perform public.t_assert(v_err = 'tiempo_invalido', '3 s se rechaza (mínimo 5)');
v_host2 := public.host_create_room(v_topic, 'seleccion-simple', 8);
perform public.t_assert((v_host2->>'round_seconds')::int = 8, 'acepta 8 s');
update public.rooms set status='closed', ended_at=clock_timestamp()
 where id = (v_host2->>'room_id')::uuid;
perform public.t_assert((select count(*) from public.questions where game_slug='seleccion-simple') = 25,
                        'el banco tiene 25 preguntas');

raise notice '=== 2. Entrada de jugadores ===';
v_p1 := public.player_join(v_code, 'Ana Pérez');
v_p2 := public.player_join(v_code, 'Beto Ruiz');
v_id1 := (v_p1->>'player_id')::uuid;  v_t1 := v_p1->>'player_token';
v_id2 := (v_p2->>'player_id')::uuid;  v_t2 := v_p2->>'player_token';
perform public.t_assert(v_id1 is not null and v_id2 is not null, 'dos jugadores entran');
perform public.t_assert((v_p1->>'is_waiting')::boolean = false, 'entran jugando, no en espera');
perform public.t_assert((v_p2->>'name' is null), 'la respuesta de entrada no filtra datos internos');

-- nombre repetido, sin distinguir mayúsculas ni acentos
begin
  v_p3 := public.player_join(v_code, 'ANA PEREZ');
  v_err := 'sin_error';
exception when others then v_err := sqlerrm;
end;
perform public.t_assert(v_err = 'nombre_ocupado', 'no se puede repetir nombre (mayúsculas)');

begin
  v_p3 := public.player_join(v_code, 'ana pérez');
  v_err := 'sin_error';
exception when others then v_err := sqlerrm;
end;
perform public.t_assert(v_err = 'nombre_ocupado', 'no se puede repetir nombre (con acento)');

begin
  v_p3 := public.player_join('ZZZZZ', 'Otra Persona');
  v_err := 'sin_error';
exception when others then v_err := sqlerrm;
end;
perform public.t_assert(v_err = 'sala_inexistente', 'código inválido rechazado');

raise notice '=== 3. Plan y apertura de pregunta ===';
perform public.host_set_plan(v_room, v_token, 5);
perform public.t_assert((select count(*) from public.game_questions where room_id=v_room) = 5,
                        'el plan toma 5 preguntas');
v_round := (public.host_open_question(v_room, v_token, null)->>'round_id')::uuid;
perform public.t_assert(v_round is not null, 'la ronda se abre');

select o into v_opts from (
  select jsonb_agg(jsonb_build_object('k',o->>'k','t',o->>'t')) as o
  from public.rounds r, jsonb_array_elements(r.option_order) o
  where r.id = v_round
) x;
perform public.t_assert(jsonb_array_length(v_opts) = 4, 'la ronda entrega 4 opciones');
perform public.t_assert(
  (select count(distinct o->>'t') from jsonb_array_elements(v_opts) o) = 4,
  'las 4 opciones son distintas según la ronda');

raise notice '=== 4. FUGAS DE INFORMACIÓN (lo más importante) ===';
v_state := public.room_state(v_room);
perform public.t_assert((v_state->'round'->>'correct_key') is null,
                        'LA CORRECTA NO VIAJA en room_state con la ronda abierta');
-- El campo `answers` EXISTE pero va vacío; lo que importa es que no
-- viaje ninguna respuesta, no la forma del campo.
perform public.t_assert(
  (v_state->'round'->'answers') is null
  or jsonb_array_length(v_state->'round'->'answers') = 0,
  'room_state no expone las respuestas');
perform public.t_assert((v_state->'round'->'correct_key') = 'null'::jsonb,
                        'correct_key es null (la clave existe pero el dato no viaja)');
perform public.t_assert((v_state->'round'->>'answered') = '0',
                        'room_state no revela cuántos van respondiendo');

-- el presentador SÍ ve la correcta
v_hstate := public.host_state(v_room, v_token);
v_correct := v_hstate->'round'->>'correct_key';
perform public.t_assert(v_correct in ('a','b','c','d'), 'el presentador sí ve la correcta');

-- un token falso no da acceso
begin
  perform public.host_state(v_room, 'token-inventado');
  v_err := 'sin_error';
exception when others then v_err := sqlerrm;
end;
perform public.t_assert(v_err = 'no_autorizado', 'token de presentador falso rechazado');

raise notice '=== 5. Respuestas y orden por secuencia ===';
-- Desde que la cuenta se inicia a mano, la ronda nace en 'prepared' y nadie
-- puede responder hasta que el presentador arranca el reloj.
perform public.host_iniciar(v_room, v_token);
v_wrong := case v_correct when 'a' then 'b' else 'a' end;

-- Ana responde bien; Beto responde mal después
perform public.player_answer(v_id1, v_t1, v_round, v_correct);
perform public.player_answer(v_id2, v_t2, v_round, v_wrong);

-- un segundo intento no se permite
begin
  perform public.player_answer(v_id1, v_t1, v_round, v_wrong);
  v_err := 'sin_error';
exception when others then v_err := sqlerrm;
end;
perform public.t_assert(v_err = 'ya_respondio', 'un jugador sólo responde una vez');

-- token de jugador ajeno rechazado
begin
  perform public.player_answer(v_id2, v_t1, v_round, v_correct);
  v_err := 'sin_error';
exception when others then v_err := sqlerrm;
end;
perform public.t_assert(v_err = 'no_autorizado', 'no se puede responder por otro');

select array_agg(seq order by seq) into v_seqs from public.answers where round_id = v_round;
perform public.t_assert(array_length(v_seqs,1) = 2, 'quedaron 2 respuestas');
perform public.t_assert(v_seqs[1] < v_seqs[2], 'el orden por seq es estrictamente creciente');
perform public.t_assert(v_seqs[1] <> v_seqs[2], 'sin empates: los números son distintos');

raise notice '=== 6. Cierre y ganador ===';
v_close := public.host_close_round(v_room, v_token);
perform public.t_assert((v_close->>'winner_id')::uuid = v_id1, 'gana el primero que acertó (Ana)');
-- Los puntos los decide `puntos_por_acierto()`, no un número escrito aquí:
-- cuando cambiaron de 1 a 10, esta prueba seguía esperando 1.
perform public.t_assert(
  (select score from public.players where id=v_id1) = public.puntos_por_acierto(),
  'Ana suma los puntos de un acierto');
perform public.t_assert((select score from public.players where id=v_id2) = 0, 'Beto no suma');

-- idempotencia: cerrar dos veces no suma otro punto
v_close2 := public.host_close_round(v_room, v_token);
perform public.t_assert(
  (select score from public.players where id=v_id1) = public.puntos_por_acierto(),
  'cerrar dos veces NO duplica el punto (idempotente)');

raise notice '=== 7. Revelación tras el cierre ===';
-- Cerrar NO revela: ese es el momento de suspenso del presentador. Lo que
-- se comprueba es que tras cerrar la correcta SIGUE sin viajar, y que solo
-- aparece después de `host_revelar`.
v_state := public.room_state(v_room);
perform public.t_assert((v_state->'round'->>'correct_key') is null,
                        'tras CERRAR la correcta sigue oculta (suspenso)');

perform public.host_revelar(v_room, v_token);
v_state := public.room_state(v_room);
perform public.t_assert((v_state->'round'->>'correct_key') = v_correct,
                        'tras REVELAR, la correcta sí se publica');
perform public.t_assert((v_state->'round'->>'winner_id')::uuid = v_id1,
                        'el estado público anuncia al ganador');

raise notice '=== 7-bis. Cambiar pregunta sin gastar el turno ===';
-- La ronda ya está revelada: se abre una nueva para probar el cambio.
v_round := (public.host_open_question(v_room, v_token, null)->>'round_id')::uuid;
v_q1 := (select question_id from public.rounds where id = v_round);
v_ord := (select ordinal from public.rounds where id = v_round);

perform public.host_cambiar_pregunta(v_room, v_token);
v_q2 := (select question_id from public.rounds where id = v_round);
perform public.host_cambiar_pregunta(v_room, v_token);
v_q3 := (select question_id from public.rounds where id = v_round);

perform public.t_assert(v_q2 is distinct from v_q1, 'cambiar pone otra pregunta');
-- El bug que tuvo: dos cambios devolvían a la original porque la rechazada
-- conservaba su posición y volvía a ser la primera de la lista.
perform public.t_assert(v_q3 is distinct from v_q1,
                        'un segundo cambio NO vuelve a la original');
perform public.t_assert((select ordinal from public.rounds where id = v_round) = v_ord,
                        'el número de pregunta NO cambia al cambiar de pregunta');
perform public.t_assert((select state from public.rounds where id = v_round) = 'prepared',
                        'queda preparada: el reloj espera al presentador');
perform public.t_assert((select count(*) from public.answers where round_id = v_round) = 0,
                        'sin respuestas: las de la anterior se descartan');

-- La ronda del cambio quedó en 'prepared'. Hay que cerrarla Y revelarla
-- antes de abrir otra: `host_open_question` rechaza con `ronda_abierta` si
-- sigue viva, y con `ronda_sin_revelar` si está cerrada sin revelar.
-- (`host_skip_question` no sirve aquí: solo actúa sobre rondas 'open'.)
perform public.host_close_round(v_room, v_token);
perform public.host_revelar(v_room, v_token);

raise notice '=== 8. Nadie acierta ===';
v_round := (public.host_open_question(v_room, v_token, null)->>'round_id')::uuid;
perform public.host_iniciar(v_room, v_token);
v_hstate := public.host_state(v_room, v_token);
v_correct := v_hstate->'round'->>'correct_key';
v_wrong := case v_correct when 'a' then 'b' else 'a' end;
perform public.player_answer(v_id1, v_t1, v_round, v_wrong);
perform public.player_answer(v_id2, v_t2, v_round, v_wrong);
v_close := public.host_close_round(v_room, v_token);
perform public.t_assert((v_close->>'no_winner')::boolean = true, 'se marca sin ganador');
perform public.t_assert((select score from public.players where id=v_id1) = public.puntos_por_acierto(), 'nadie suma en ronda sin acierto');
-- Cerrar no revela; para abrir otra pregunta hay que revelar esta primero.
perform public.host_revelar(v_room, v_token);

raise notice '=== 9. Deshacer devuelve el punto ===';
v_round := (public.host_open_question(v_room, v_token, null)->>'round_id')::uuid;
perform public.host_iniciar(v_room, v_token);
v_hstate := public.host_state(v_room, v_token);
v_correct := v_hstate->'round'->>'correct_key';
perform public.player_answer(v_id2, v_t2, v_round, v_correct);
perform public.host_close_round(v_room, v_token);
perform public.t_assert(
  (select score from public.players where id=v_id2) = public.puntos_por_acierto(),
  'Beto suma tras acertar');
perform public.host_undo(v_room, v_token);
perform public.t_assert((select score from public.players where id=v_id2) = 0, 'deshacer le quita el punto');
perform public.t_assert((select count(*) from public.answers where round_id=v_round) = 0,
                        'deshacer borra las respuestas de esa ronda');

raise notice '=== 10. Pausa congela el reloj ===';
-- Deshacer deja la ronda en 'prepared', NO en 'open': el reloj no debe
-- correr hasta que el presentador vuelva a pulsar «Iniciar». Se reutiliza
-- esa misma ronda iniciando la cuenta aquí.
perform public.t_assert(
  (select state from public.rounds where id = v_round) = 'prepared',
  'deshacer deja la ronda lista, sin reloj corriendo');
perform public.host_iniciar(v_room, v_token);
perform pg_sleep(0.3);
perform public.host_pause(v_room, v_token);
begin
  perform public.player_answer(v_id1, v_t1, v_round, 'a');
  v_err := 'sin_error';
exception when others then v_err := sqlerrm;
end;
perform public.t_assert(v_err = 'en_pausa', 'en pausa no se puede responder');
perform pg_sleep(1.0);
perform public.host_resume(v_room, v_token);
perform public.player_answer(v_id1, v_t1, v_round, 'a');
perform public.t_assert(true, 'al reanudar se puede responder de nuevo');

-- cerramos la ronda de la prueba de pausa antes de seguir
perform public.host_skip_question(v_room, v_token);

raise notice '=== 11. Nadie entra con la partida empezada ===';
-- Cambio de diseño (migración 06): antes, quien llegaba tarde entraba a la
-- sala de espera y el presentador podía admitirlo. Ahora se rechaza de
-- plano: a una partida ya empezada no se entra.
begin
  perform public.player_join(v_code, 'Carla Díaz');
  v_err := 'sin_error';
exception when others then v_err := sqlerrm;
end;
perform public.t_assert(v_err = 'partida_ya_iniciada',
                        'con la partida en marcha, no se entra');
perform public.t_assert(
  (select count(*) from public.players where room_id = v_room) = 2,
  'la sala se quedó con los dos jugadores que entraron en el lobby');

raise notice '=== 12. Tabla final y desempate ===';
-- Ana tiene un acierto; Beto no. Dos jugadores, sin Carla.
perform public.host_end_game(v_room, v_token);
v_final := public.final_scoreboard(v_room);
v_rows  := v_final->'rows';
perform public.t_assert(jsonb_array_length(v_rows) = 2, 'la tabla tiene 2 jugadores');
perform public.t_assert((v_rows->0->>'name') = 'Ana Pérez', 'Ana queda primera');
perform public.t_assert((v_rows->0->>'position') = '1', 'la posición 1 es la primera');
perform public.t_assert((v_rows->1->>'name') = 'Beto Ruiz', 'Beto segundo');

raise notice '=== 13. Sala cerrada rechaza entradas ===';
begin
  perform public.player_join(v_code, 'Diego Nuevo');
  v_err := 'sin_error';
exception when others then v_err := sqlerrm;
end;
perform public.t_assert(v_err = 'sala_cerrada', 'no se entra a una partida terminada');

raise notice '=== 14. La difusión no expone datos a los jugadores ===';
perform public.t_assert(
  (select count(*) from realtime.messages where topic = 'room:' || v_room::text) > 0,
  'se emitieron eventos de estado');
-- La CLAVE viaja siempre (como null cuando no se puede revelar), así que
-- buscar `correct_key` a secas siempre encuentra algo.
--
-- Lo que importa: que un evento público NUNCA lleve la correcta con valor
-- mientras la ronda no esté revelada. Los de rondas 'revealed' sí la
-- llevan, y eso es correcto: revelar es justamente publicarla.
perform public.t_assert(
  (select count(*) from realtime.messages
    where topic = 'room:' || v_room::text
      and payload->'round'->>'state' is distinct from 'revealed'
      and payload::text ~ '"correct_key"\s*:\s*"[a-d]"') = 0,
  'ningún evento público no revelado lleva la correcta con valor');
perform public.t_assert(
  (select count(*) from realtime.messages where topic like 'host:%') > 0,
  'se emitieron eventos al canal del presentador');

raise notice '=== 15. Cierre por inactividad del presentador ===';
-- Para simular el paso del tiempo hay que apagar DOS disparadores:
--
--   rooms_actividad  → su trabajo es refrescar la hora en cada UPDATE, así
--                      que pisaría el envejecido artificial.
--   rooms_broadcast  → difunde el estado llamando a `room_state`, y
--                      `room_state` lanza el barrido. Al envejecer la fila
--                      se cerraría la sala ANTES de la comprobación, y la
--                      prueba pasaría sin probar nada.
--
-- Esto vale la pena decirlo porque es un efecto real del diseño: el barrido
-- se dispara solo con leer. Si no se apaga en la prueba, el test mide el
-- azar de qué disparó primero.
alter table public.rooms disable trigger rooms_actividad;
alter table public.rooms disable trigger rooms_broadcast;
declare
  v_sala uuid;
  v_fresca boolean;
  v_cerradas int;
  v_tarde uuid;
  v_viva uuid;
begin
  v_sala := (public.host_create_room(v_topic, 'seleccion-simple', 15)->>'room_id')::uuid;

  -- Recién creada late: el barrido no debe tocarla.
  perform public.barrer_salas_inactivas(30);
  perform public.t_assert(
    (select status from public.rooms where id = v_sala) = 'lobby',
    'el barrido no cierra una sala recién creada');

  -- 31 minutos de silencio: se cierra sola y deja el motivo.
  update public.rooms set last_activity_at = clock_timestamp() - interval '31 minutes'
   where id = v_sala;
  v_cerradas := public.barrer_salas_inactivas(30);
  perform public.t_assert(v_cerradas >= 1, 'el barrido reporta lo que cerró');
  perform public.t_assert(
    (select status from public.rooms where id = v_sala) = 'closed',
    'una sala con 31 min de silencio se cierra sola');
  perform public.t_assert(
    (select close_reason from public.rooms where id = v_sala) = 'inactividad',
    'el cierre por inactividad deja su motivo');

  -- El jugador se entera por `room_state`, que es lo único que consulta.
  perform public.t_assert(
    (public.room_state(v_sala)->>'close_reason') = 'inactividad',
    'el jugador recibe el motivo del cierre');

  -- El barrido NO debe reactivar lo que acaba de cerrar: si lo hiciera,
  -- la sala quedaría «activa» al cerrarse y el reloj nunca avanzaría.
  perform public.t_assert(
    (select now() - last_activity_at > interval '30 minutes'
       from public.rooms where id = v_sala),
    'el barrido no se reactiva a sí mismo');

  -- Una sala con 29 minutos sigue viva: el margen es de 30, no de 29.
  v_tarde := (public.host_create_room(v_topic, 'seleccion-simple', 15)->>'room_id')::uuid;
  update public.rooms set last_activity_at = clock_timestamp() - interval '29 minutes'
   where id = v_tarde;
  perform public.barrer_salas_inactivas(30);
  perform public.t_assert(
    (select status from public.rooms where id = v_tarde) = 'lobby',
    'con 29 minutos la sala sigue abierta');

  -- Tocar una RONDA debe bastar para refrescar el reloj de la sala. Se
  -- deja `rooms_actividad` apagado a propósito: si estuviera encendido, el
  -- propio UPDATE sobre `rooms` refrescaría la hora y la prueba pasaría
  -- sin demostrar nada sobre el disparador de `rounds`.
  --
  -- Sala nueva y viva: `v_room` ya quedó cerrada en la sección 13, y una
  -- sala cerrada no late (ni debe: nadie va a volver a ella).
  v_viva := (public.host_create_room(v_topic, 'seleccion-simple', 15)->>'room_id')::uuid;
  update public.rooms set last_activity_at = clock_timestamp() - interval '45 minutes'
   where id = v_viva;
  perform public.t_assert(
    (select now() - last_activity_at > interval '44 minutes'
       from public.rooms where id = v_viva),
    'la sala quedó envejecida para la prueba');

  -- El presentador abre una pregunta: eso escribe en `rounds`, no en `rooms`.
  insert into public.rounds (room_id, question_id, ordinal, option_order, deadline)
  select v_viva, q.id, 1, '[{"k":"a","t":"uno"}]'::jsonb,
         clock_timestamp() + interval '15 seconds'
    from public.questions q
   where q.game_slug = 'seleccion-simple' and q.topic_id = v_topic
   limit 1;

  perform public.t_assert(
    (select now() - last_activity_at < interval '10 seconds'
       from public.rooms where id = v_viva),
    'una acción del presentador reinicia el reloj de actividad');
end;
alter table public.rooms enable trigger rooms_broadcast;
alter table public.rooms enable trigger rooms_actividad;

raise notice '';
raise notice '=== 15. Marca del menú: lema y portada ===';
-- La clave maestra se configura al final, cuando ya nadie depende de que
-- esté ausente. Se guarda el texto para poder probar el caso correcto.
v_clave := '4321';

-- ESTA SECCIÓN EMPIEZA SIN CLAVE, a propósito y por su cuenta.
--
-- La prueba corre contra la misma base en cada corrida, y la vez anterior
-- dejó una clave configurada. Depender de eso hacía que la prueba pasara la
-- primera vez y fallara la segunda: el peor tipo de prueba, la que miente
-- según el historial. Así que se deja el punto de partida explícito.
update public.admin_config
   set key_hash = null,
       failed_attempts = 0,
       locked_until = null
 where id = true;
perform setval('public.admin_intentos_seq', 1000000);
perform setval('public.admin_marca_seq', 1000000);
perform setval('public.admin_ultimo_fallo_seq', 0);
update public.branding set lema = null, portada = null, portada_bytes = null where id = true;

-- Sin clave configurada, escribir el lema NO puede pasar. Se comprueba
-- antes de configurarla, que es la única ventana en que esto es posible.
perform public.t_assert((public.admin_key_status()->>'configurada')::boolean = false,
  'el punto de partida de la sección no tiene clave');

begin
  perform public.branding_set_lema(v_clave, 'No debe entrar');
  perform public.t_assert(false, 'sin clave configurada, escribir el lema falla');
exception when others then
  perform public.t_assert(sqlerrm like '%clave_no_configurada%',
    'sin clave configurada, escribir el lema falla');
end;

-- Se configura la clave maestra por el mismo camino que usa la app.
--
-- Y ahí estaba el defecto: `admin_change_key` exigía la clave ANTERIOR, así
-- que en una instalación nueva —sin ninguna clave— el botón «Establecer la
-- clave maestra» fallaba con `clave_no_configurada`. Para poner la primera
-- clave había que escribir la que todavía no existía. Se comprueba primero
-- que la pantalla dice la verdad sobre si hay clave, y después que se puede
-- establecer sin anterior.
perform public.admin_change_key(null, v_clave);
perform public.t_assert((public.admin_key_status()->>'configurada')::boolean = true,
  'establecer la PRIMERA clave funciona sin escribir una anterior (defecto corregido)');

-- Con la clave ya puesta, la anterior se sigue exigiendo: la corrección no
-- relajó nada.
begin
  perform public.admin_change_key('0000', 'nueva1234');
  perform public.t_assert(false, 'con clave puesta, la anterior se sigue exigiendo');
exception when others then
  perform public.t_assert(sqlerrm like '%clave_incorrecta%',
    'con clave puesta, la anterior se sigue exigiendo');
end;
-- Y ese intento fallido deja marca. Ojo con la sutileza que costó una vuelta:
-- dentro de una MISMA función, un error aborta la transacción entera, así que
-- el conteo de intentos no puede leerse aquí mismo con una consulta —la
-- transacción ya está condenada. Lo que sí sobrevive son las secuencias, que
-- es donde vive el conteo de verdad. Se limpia para las pruebas siguientes.
perform setval('public.admin_marca_seq',
               (select last_value from public.admin_intentos_seq));
update public.admin_config set failed_attempts = 0, locked_until = null where id = true;

-- ---------------------------------------------------------------------
-- EL CANDADO DE INTENTOS, que no existía
-- ---------------------------------------------------------------------
-- Se creía que cinco claves incorrectas cerraban la puerta diez minutos. No
-- cerraban nada: el `update` del contador se deshacía junto con el error que
-- lo acompañaba, porque en PostgreSQL una excepción revierte la transacción
-- ENTERA. Medido antes de corregirlo: tras 7 claves incorrectas, intentos = 0
-- y nunca se bloqueaba.
--
-- Aquí no se puede probar con llamadas seguidas dentro de este bloque: el
-- primer error dejaría la transacción condenada y las siguientes pruebas no
-- correrían. La prueba del candado de verdad —con cada intento en su propia
-- transacción, que es como llega desde el navegador— está en
-- `supabase/tests/candado.sh`, que sí puede abrir una conexión por intento.
--
-- Lo que sí se prueba aquí es la MECÁNICA de la que depende: que el conteo
-- salga de la resta de dos secuencias, que esas secuencias no se reviertan, y
-- que un acierto alinee la marca.
perform setval('public.admin_intentos_seq', 1000000);
perform setval('public.admin_marca_seq', 1000000);
perform public.t_assert(public.admin_intentos_fallidos() = 0,
  'el conteo de intentos sale en 0 alineado');

-- Un avance de la secuencia que NO viene de un error: se prueba la resta.
perform nextval('public.admin_intentos_seq');
perform public.t_assert(public.admin_intentos_fallidos() = 1,
  'un avance de la secuencia cuenta como un intento');
perform nextval('public.admin_intentos_seq');
perform public.t_assert(public.admin_intentos_fallidos() = 2,
  'y dos avances cuentan dos');

-- Alinear la marca es lo que hace un acierto: el conteo vuelve a cero.
perform setval('public.admin_marca_seq',
               (select last_value from public.admin_intentos_seq));
perform public.t_assert(public.admin_intentos_fallidos() = 0,
  'alinear la marca devuelve el conteo a 0 (lo que hace un acierto)');
perform public.t_assert((public.admin_key_status()->>'restantes')::int = 5,
  'y quedan los 5 intentos otra vez');

-- Un fallo real, del camino de verdad, ahora que la transacción está sana:
-- se llama a la comprobación y se captura el error para poder seguir.
begin
  perform public.admin_check_key('0000');
  perform public.t_assert(false, 'una clave incorrecta falla');
exception when others then
  perform public.t_assert(sqlerrm like '%clave_incorrecta%', 'una clave incorrecta falla');
end;

for i in 1..5 loop
  begin
    perform public.admin_check_key('0000');
  exception when others then
    null;   -- cada error se captura para poder seguir probando
  end;
end loop;

-- Con el conteo en 5 o más, el estado tiene que decir «bloqueada». Se mira
-- por `admin_intentos_fallidos`, que es la autoridad y sí sobrevive al error.
perform public.t_assert(public.admin_intentos_fallidos() >= 5,
  'tras varios fallos, el conteo llega al máximo (y sobrevive a los errores)');
perform public.t_assert((public.admin_key_status()->>'restantes')::int = 0,
  'y no quedan intentos disponibles');

-- La clave correcta tampoco pasa mientras esté bloqueada. Es el punto: si el
-- bloqueo solo frenara las equivocadas, no frenaría a quien está probando.
begin
  perform public.admin_check_key(v_clave);
  perform public.t_assert(false, 'bloqueada, ni la clave correcta entra');
exception when others then
  perform public.t_assert(sqlerrm like '%clave_bloqueada%',
    'bloqueada, ni la clave correcta entra');
end;

-- Cumplida la espera, vuelve a entrar. Se envejece el último fallo en vez de
-- esperar diez minutos de verdad: la espera se mide contra ese número.
perform setval('public.admin_ultimo_fallo_seq',
               ((extract(epoch from clock_timestamp()) * 1000)::bigint - 660000));
perform public.t_assert((public.admin_key_status()->>'bloqueada')::boolean = false,
  'pasada la espera, deja de estar bloqueada');
perform public.admin_check_key(v_clave);
perform public.t_assert(public.admin_intentos_fallidos() = 0,
  'y al acertar el conteo vuelve a cero, sin arrastrar los fallos viejos');

-- LA MARCA ARRANCA VACÍA, no con texto del código. Es a propósito: si la
-- base guardara «2 Corintios · Concurso de preguntas», cambiar el lema del
-- código dejaría de servir y habría dos fuentes de verdad.
v_marca := public.branding_get();
perform public.t_assert(v_marca->>'lema' is null,
  'sin cambios, el lema es null (manda el texto del código)');
perform public.t_assert(v_marca->>'portada' is null,
  'sin cambios, no hay portada guardada (manda el archivo del proyecto)');

-- Clave incorrecta: no escribe. Se prueba sobre el lema, que es lo barato.
update public.admin_config set failed_attempts = 0, locked_until = null where id = true;
begin
  perform public.branding_set_lema('0000', 'No debe entrar');
  perform public.t_assert(false, 'con clave incorrecta el lema NO se escribe');
exception when others then
  perform public.t_assert(sqlerrm like '%clave_incorrecta%',
    'con clave incorrecta el lema NO se escribe');
end;
perform public.t_assert((select lema from public.branding where id = true) is null,
  'y la tabla quedó intacta: el intento fallido no escribió nada');

-- Clave correcta: escribe.
perform public.branding_set_lema(v_clave, 'Romanos · Concurso de preguntas');
perform public.t_assert((select lema from public.branding where id = true)
                        = 'Romanos · Concurso de preguntas',
  'con clave correcta el lema se guarda');

-- El lema se recorta, y vaciarlo es la forma de volver al texto del código.
perform public.branding_set_lema(v_clave, '   Con espacios   ');
perform public.t_assert((select lema from public.branding where id = true) = 'Con espacios',
  'el lema se guarda sin espacios sobrantes');

perform public.branding_set_lema(v_clave, '   ');
perform public.t_assert((select lema from public.branding where id = true) is null,
  'un lema vacío vuelve al texto del código (null), no a una cadena vacía');

-- Un lema desmedido se rechaza: el menú tiene una línea y no debe crecer
-- sin límite por un pegado accidental.
begin
  perform public.branding_set_lema(v_clave, repeat('x', 121));
  perform public.t_assert(false, 'un lema de 121 caracteres se rechaza');
exception when others then
  perform public.t_assert(sqlerrm like '%lema_muy_largo%',
    'un lema de 121 caracteres se rechaza');
end;
perform public.t_assert((select lema from public.branding where id = true) is null,
  'y el lema rechazado no se guardó');
perform public.branding_set_lema(v_clave, repeat('y', 120));
perform public.t_assert((select lema from public.branding where id = true) = repeat('y', 120),
  'un lema de 120 caracteres sí entra');
perform public.branding_set_lema(v_clave, null);
perform public.t_assert((select lema from public.branding where id = true) is null,
  'y se puede limpiar otra vez');

-- PORTADA. Un webp mínimo de verdad: cabecera RIFF + tamaño + WEBP.
-- No es una imagen que se pueda ver, pero sí es un webp por sus bytes,
-- que es exactamente lo que la función promete revisar.
v_webp := encode('\x524946461c0000005745425056503820'::bytea, 'base64');

perform public.branding_set_portada(v_clave, v_webp);
perform public.t_assert((select portada_bytes from public.branding where id = true) = 16,
  'un webp de verdad se guarda y se registra su tamaño');

-- El prefijo que produce el navegador se acepta y se descarta: obligar al
-- cliente a quitarlo sería un punto más donde equivocarse.
perform public.branding_set_portada(v_clave, 'data:image/webp;base64,' || v_webp);
perform public.t_assert((select portada is not null and length(portada) = length(v_webp)
                           from public.branding where id = true),
  'el prefijo data:image/webp;base64, se descarta sin ensuciar lo guardado');

-- Un PNG disfrazado: nombre de webp, bytes de PNG. Se revisa el CONTENIDO.
v_png := encode('\x89504e470d0a1a0a0000000d49484452'::bytea, 'base64');
begin
  perform public.branding_set_portada(v_clave, v_png);
  perform public.t_assert(false, 'un PNG disfrazado de webp se rechaza');
exception when others then
  perform public.t_assert(sqlerrm like '%imagen_no_webp%',
    'un PNG disfrazado de webp se rechaza (manda la cabecera, no el nombre)');
end;
perform public.t_assert((select length(portada) = length(v_webp)
                           from public.branding where id = true),
  'y la portada anterior quedó intacta');

-- Vacío, y base64 roto: los dos se rechazan con un nombre que se entiende.
begin
  perform public.branding_set_portada(v_clave, '');
  perform public.t_assert(false, 'una imagen vacía se rechaza');
exception when others then
  perform public.t_assert(sqlerrm like '%imagen_vacia%', 'una imagen vacía se rechaza');
end;
begin
  perform public.branding_set_portada(v_clave, 'esto no es base64 !!!');
  perform public.t_assert(false, 'base64 mal formado se rechaza');
exception when others then
  perform public.t_assert(sqlerrm like '%imagen_invalida%',
    'base64 mal formado se rechaza (con nombre claro, no el error crudo)');
end;

-- Y la portada tampoco entra sin la clave correcta.
update public.admin_config set failed_attempts = 0, locked_until = null where id = true;
begin
  perform public.branding_set_portada('9999', v_png);
  perform public.t_assert(false, 'la portada tampoco se escribe con clave incorrecta');
exception when others then
  perform public.t_assert(sqlerrm like '%clave_incorrecta%',
    'la portada tampoco se escribe con clave incorrecta');
end;

-- Dejar la clave como estaba: las pruebas anteriores no dependían de ella,
-- pero una corrida futura que lea `admin_config` no debe encontrar basura.
update public.admin_config set failed_attempts = 0, locked_until = null where id = true;

raise notice '';
raise notice '===============================';
raise notice ' TODAS LAS PRUEBAS PASARON';
raise notice '===============================';
end;
$$;
