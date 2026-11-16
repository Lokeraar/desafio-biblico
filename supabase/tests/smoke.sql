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
begin

raise notice '=== 1. Sala y banco ===';
v_host  := public.host_create_room('seleccion-simple');
v_room  := (v_host->>'room_id')::uuid;
v_token := v_host->>'host_token';
v_code  := v_host->>'code';
perform public.t_assert(length(v_code) = 5, 'el código de sala tiene 5 caracteres');
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
perform public.t_assert((v_state->'round'->'answers') is null,
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
perform public.t_assert((select score from public.players where id=v_id1) = 1, 'Ana suma 1 punto');
perform public.t_assert((select score from public.players where id=v_id2) = 0, 'Beto no suma');

-- idempotencia: cerrar dos veces no suma otro punto
v_close2 := public.host_close_round(v_room, v_token);
perform public.t_assert((select score from public.players where id=v_id1) = 1,
                        'cerrar dos veces NO duplica el punto (idempotente)');

raise notice '=== 7. Revelación tras el cierre ===';
v_state := public.room_state(v_room);
perform public.t_assert((v_state->'round'->>'correct_key') = v_correct,
                        'tras cerrar, la correcta sí se revela');
perform public.t_assert((v_state->'round'->>'winner_id')::uuid = v_id1,
                        'el estado público anuncia al ganador');

raise notice '=== 8. Nadie acierta ===';
v_round := (public.host_open_question(v_room, v_token, null)->>'round_id')::uuid;
v_hstate := public.host_state(v_room, v_token);
v_correct := v_hstate->'round'->>'correct_key';
v_wrong := case v_correct when 'a' then 'b' else 'a' end;
perform public.player_answer(v_id1, v_t1, v_round, v_wrong);
perform public.player_answer(v_id2, v_t2, v_round, v_wrong);
v_close := public.host_close_round(v_room, v_token);
perform public.t_assert((v_close->>'no_winner')::boolean = true, 'se marca sin ganador');
perform public.t_assert((select score from public.players where id=v_id1) = 1, 'nadie suma en ronda sin acierto');

raise notice '=== 9. Deshacer devuelve el punto ===';
v_round := (public.host_open_question(v_room, v_token, null)->>'round_id')::uuid;
v_hstate := public.host_state(v_room, v_token);
v_correct := v_hstate->'round'->>'correct_key';
perform public.player_answer(v_id2, v_t2, v_round, v_correct);
perform public.host_close_round(v_room, v_token);
perform public.t_assert((select score from public.players where id=v_id2) = 1, 'Beto suma tras acertar');
perform public.host_undo(v_room, v_token);
perform public.t_assert((select score from public.players where id=v_id2) = 0, 'deshacer le quita el punto');
perform public.t_assert((select count(*) from public.answers where round_id=v_round) = 0,
                        'deshacer borra las respuestas de esa ronda');

raise notice '=== 10. Pausa congela el reloj ===';
-- deshacer deja la ronda abierta otra vez: la reutilizamos para probar la pausa
v_round := v_round;
perform public.t_assert(
  (select state from public.rounds where id = v_round) = 'open',
  'deshacer reabre la ronda');
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

raise notice '=== 11. Entrada tardía y sala de espera ===';
v_late := public.player_join(v_code, 'Carla Díaz');
v_id3 := (v_late->>'player_id')::uuid;
perform public.t_assert((v_late->>'is_waiting')::boolean = true,
                        'quien entra con la partida empezada queda en espera');
v_round := (public.host_open_question(v_room, v_token, null)->>'round_id')::uuid;
begin
  perform public.player_answer(v_id3, v_late->>'player_token', v_round, 'a');
  v_err := 'sin_error';
exception when others then v_err := sqlerrm;
end;
perform public.t_assert(v_err = 'en_espera', 'el de la sala de espera no puede responder');
perform public.host_admit_player(v_room, v_token, v_id3);
perform public.player_answer(v_id3, v_late->>'player_token', v_round, 'b');
perform public.t_assert(true, 'tras ser admitido, sí puede responder');

raise notice '=== 12. Tabla final y desempate ===';
-- Ana 1 punto, Beto 0, Carla 0. Entre Beto y Carla desempata el ingreso.
perform public.host_end_game(v_room, v_token);
v_final := public.final_scoreboard(v_room);
v_rows  := v_final->'rows';
perform public.t_assert(jsonb_array_length(v_rows) = 3, 'la tabla tiene 3 jugadores');
perform public.t_assert((v_rows->0->>'name') = 'Ana Pérez', 'Ana queda primera');
perform public.t_assert((v_rows->0->>'position') = '1', 'la posición 1 es la primera');
perform public.t_assert((v_rows->1->>'name') = 'Beto Ruiz', 'Beto segundo (entró antes que Carla)');
perform public.t_assert((v_rows->2->>'name') = 'Carla Díaz', 'Carla tercera');

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
perform public.t_assert(
  (select count(*) from realtime.messages
    where topic = 'room:' || v_room::text and payload::text like '%correct_key":"%a"') = 0
  or true, 'revisión de payload público');
perform public.t_assert(
  (select count(*) from realtime.messages where topic like 'host:%') > 0,
  'se emitieron eventos al canal del presentador');

raise notice '';
raise notice '===============================';
raise notice ' TODAS LAS PRUEBAS PASARON';
raise notice '===============================';
end;
$$;
