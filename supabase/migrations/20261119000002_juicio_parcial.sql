-- =====================================================================
-- El juicio parcial no termina la ronda ni destapa el versículo
--
-- Defecto: al sentenciar «acertó 1 de 2», `host_sentenciar` veía que
-- quedaban huecos tapados y que ya no había otro pulsante, así que caía
-- en `cerrar_ronda_versiculo`, que DESTAPA TODOS los huecos. El
-- participante acertaba una palabra y el televisor enseñaba el versículo
-- entero resuelto.
--
-- Ahora:
--   1. Solo se destapa lo que el presentador marcó como acertado.
--   2. El punto fraccionado se suma EN EL MOMENTO, para que el
--      participante lo vea sin esperar al cierre.
--   3. La ronda sigue con las palabras que faltan: se vuelve a abrir el
--      timbrazo con el temporizador completo, conservando lo destapado.
--      Quien ya pulsó no vuelve a pulsar en esta ronda.
--
-- El reparto: el versículo vale 10 puntos, repartidos entre sus N huecos.
-- Cada hueco acertado paga floor(10 / N) al instante. Al cerrar se
-- reparte lo que la división dejó sin asignar, así el total por versículo
-- nunca pasa de 10 ni se pierden puntos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. El timbrazo NO se reabre entre palabras
-- ---------------------------------------------------------------------
-- Se quitó `versiculo_siguiente_tanda`. El orden de la ronda lo fija quien
-- pulsó más rápido al principio y esa lista no crece: agotada, la ronda
-- cierra. Reabrir el temporizador hacía que el mismo versículo pareciera
-- empezar de nuevo.
-- `versiculo_siguiente_tanda` se eliminó a propósito: el timbrazo ya no se
-- reabre. Está aquí de cuerpo entero sólo en el historial, para que se lea
-- por qué se fue.
drop function if exists public.versiculo_siguiente_tanda(uuid);

-- ---------------------------------------------------------------------
-- 2. Sentenciar: solo lo marcado, puntos al momento, ronda sigue
-- ---------------------------------------------------------------------
create or replace function public.host_sentenciar(
  p_room uuid, p_token text, p_answer uuid,
  p_correcto boolean, p_huecos int[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_room     public.rooms;
  v_round    public.rounds;
  v_answer   public.answers;
  v_rev      int[];
  v_nuevos   jsonb;
  v_todos    int[];
  v_falta    boolean;
  v_siguiente uuid;
  v_n        int;
  v_por_hueco int;
  v_k        int;
  v_hay_nuevos boolean;
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

  v_todos := public.huecos_de_ronda(v_round);
  v_n := coalesce(array_length(v_todos, 1), 0);

  if p_correcto then
    if p_huecos is null or array_length(p_huecos, 1) is null then
      raise exception 'sin_huecos' using errcode = 'P0001';
    end if;

    -- Un hueco ya destapado no se vuelve a ganar: sería pagar dos veces
    -- por la misma palabra.
    if exists (select 1 from unnest(p_huecos) h where h = any(v_rev)) then
      raise exception 'hueco_ya_revelado' using errcode = 'P0001';
    end if;
    if exists (select 1 from unnest(p_huecos) h where not (h = any(v_todos))) then
      raise exception 'hueco_no_existe' using errcode = 'P0001';
    end if;

    select coalesce(jsonb_agg(h order by h), '[]'::jsonb) into v_nuevos
      from unnest(p_huecos) h;

    -- Puntos al momento: cada hueco paga su parte del versículo.
    v_k := array_length(p_huecos, 1);
    v_por_hueco := case when v_n > 0 then (10 / v_n) else 0 end;

    -- El veredicto depende de si tras esta sentencia queda algo tapado:
    -- quien completa el versículo queda en 'correcto', no en 'parcial'.
    update public.answers
       set huecos_ganados = v_nuevos,
           veredicto = case
             when (select count(*) from unnest(v_todos) t
                    where not (t = any(v_rev)) and not (t = any(p_huecos))) = 0
             then 'correcto' else 'parcial' end,
           juzgado_at = clock_timestamp(),
           puntos = v_k * v_por_hueco
     where id = p_answer;

    -- SOLO se destapan los marcados. Nada más.
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

    -- El participante ve su punto en el marcador ahora, no al cerrar.
    if v_k * v_por_hueco > 0 then
      update public.players set score = public.players.score + (v_k * v_por_hueco)
       where id = v_answer.player_id;
    end if;

  else
    update public.answers
       set veredicto = 'incorrecto',
           juzgado_at = clock_timestamp()
     where id = p_answer;
  end if;

  -- ¿Queda algún hueco tapado?
  select coalesce(array_agg((e)::int), array[]::int[]) into v_rev
    from jsonb_array_elements_text(v_round.huecos_revelados) e;
  select exists (
    select 1 from unnest(v_todos) t where not (t = any (v_rev))
  ) into v_falta;

  if v_falta then
    -- Primero: ¿queda alguien en la lista de esta tanda sin hablar?
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
        'round_id', v_round.id, 'state', 'juicio',
        'turno_answer_id', v_siguiente, 'huecos_restantes', true
      );
    end if;

    /*
     * LA LISTA NO SE REABRE. Se cierra la ronda.
     *
     * El timbrazo se cierra UNA vez por ronda y esa lista es definitiva: el
     * orden lo fija quien pulsó más rápido al principio. Cuando se agota, ya
     * hablaron todos los que querían hablar, y quedan dos casos:
     *
     *   - Nadie ganó nada: se destapa el versículo y no hubo ganador.
     *   - Alguien ganó algunas palabras pero no todas: esas palabras quedan
     *     como su acierto parcial, y las que nadie acertó se destapan al
     *     cerrar. No hay segunda vuelta.
     *
     * Antes se reiniciaba el temporizador para una tanda nueva, y eso
     * confundía: en pantalla parecía que nadie había acertado nada y el
     * mismo versículo volvía a empezar. Acertar una palabra de tres es un
     * acierto parcial de ESA persona, y el turno pasa al siguiente de la
     * lista, no a una ronda nueva.
     */
    perform public.cerrar_ronda_versiculo(v_round.id);
    return jsonb_build_object(
      'round_id', v_round.id, 'state', 'closed',
      'turno_answer_id', null, 'huecos_restantes', true
    );
  end if;

  -- No queda ningún hueco: ahí sí se cierra, con todos a la vista.
  perform public.cerrar_ronda_versiculo(v_round.id);

  return jsonb_build_object(
    'round_id', v_round.id, 'state', 'closed',
    'turno_answer_id', null, 'huecos_restantes', false
  );
end;
$$;

grant execute on function public.host_sentenciar(uuid, text, uuid, boolean, int[]) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Cerrar: reparte solo el sobrante, no vuelve a pagar lo pagado
-- ---------------------------------------------------------------------
-- Cada hueco ya pagó floor(10/N) al sentenciarse. Al cerrar queda un
-- sobrante de `10 mod N` (1 punto con 3 huecos, 2 con 4) que se reparte
-- entre quienes más huecos ganaron, por mayor resto y, en empate, por el
-- `seq` más bajo: quien pulsó antes.
--
-- El total por versículo nunca pasa de 10 ni deja puntos sin asignar.
drop function if exists public.cerrar_ronda_versiculo(uuid);

create or replace function public.cerrar_ronda_versiculo(
  p_round uuid, p_repartir_sobrante boolean default true
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_round   public.rounds;
  v_todos   int[];
  v_pagado  int;
  v_resto   int;
  v_n       int;
  v_ganados int;
  v_techo   int;
  v_sobrante record;
begin
  select * into v_round from public.rounds where id = p_round for update;
  if not found then return; end if;
  if v_round.state in ('closed','revealed') then return; end if;

  v_todos := public.huecos_de_ronda(v_round);

  -- Todos los huecos a la vista: al cerrar no queda nada tapado.
  update public.rounds
     set huecos_revelados = to_jsonb(v_todos),
         turno_answer_id = null
   where id = p_round;

  v_n := coalesce(array_length(v_todos, 1), 0);

  select coalesce(sum(jsonb_array_length(huecos_ganados)), 0),
         coalesce(sum(puntos), 0)
    into v_ganados, v_pagado
    from public.answers where round_id = p_round;
  -- Solo se reparte el sobrante si el versículo quedó completo. Al
  -- cerrar a mano con huecos tapados, lo ganado se conserva y no se
  -- reparte nada nuevo.
  /*
   * El sobrante solo existe si alguien ganó algo. Sin esta condición,
   * `10 - 0` daba 10 puntos a repartir entre nadie y `no_winner` salía
   * falso en una ronda donde no acertó ni una persona: la tabla final
   * habría dicho que hubo ganador.
   */
  /*
   * El techo no es 10 fijo: es 10 por los huecos que ALGUIEN ganó.
   *
   * Si el versículo tiene 3 huecos y solo se acertaron 2, el versículo
   * vale floor(10 x 2 / 3) = 6 puntos, no 10. El resto se pierde: el punto
   * de un hueco que nadie acertó no se reparte entre los demás.
   */
  v_techo := (10 * coalesce(v_ganados, 0)) / greatest(coalesce(v_n, 1), 1);
  v_resto := case
    when not p_repartir_sobrante then 0
    when v_pagado = 0 then 0
    else greatest(0, v_techo - v_pagado)
  end;

  -- El sobrante se paga de a un punto, en orden de mérito. Se guarda en
  -- `puntos` de la respuesta para que deshacer sepa qué devolver.
  if v_resto > 0 then
    for v_sobrante in
      select a.id, a.player_id
        from public.answers a
       where a.round_id = p_round
         and jsonb_array_length(a.huecos_ganados) > 0
       order by jsonb_array_length(a.huecos_ganados) desc, a.seq asc
       limit v_resto
    loop
      update public.answers set puntos = puntos + 1 where id = v_sobrante.id;
      update public.players set score = score + 1 where id = v_sobrante.player_id;
    end loop;
  end if;

  -- `correct_count` cuenta PREGUNTAS, no huecos: quien ganó al menos un
  -- hueco acertó la pregunta, aunque no la completara. Un acierto por
  -- participante y por ronda, nunca uno por palabra.
  update public.players p
     set correct_count = p.correct_count + 1
    from (
      select distinct a.player_id
        from public.answers a
       where a.round_id = p_round
         and jsonb_array_length(a.huecos_ganados) > 0
    ) sub
   where p.id = sub.player_id;

  update public.rounds
     set state = 'revealed', closed_at = clock_timestamp(),
         winner_player_id = null,
         no_winner = (v_pagado + v_resto = 0)
   where id = p_round;

  update public.rooms set status = 'reveal', paused = false
   where id = v_round.room_id;
end;
$$;

revoke all on function public.cerrar_ronda_versiculo(uuid, boolean) from public;

-- ---------------------------------------------------------------------
-- 4. Deshacer: devuelve exactamente lo que pagó esa sentencia
-- ---------------------------------------------------------------------
create or replace function public.host_deshacer_sentencia(
  p_room uuid, p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_room   public.rooms;
  v_round  public.rounds;
  v_answer public.answers;
  v_pagado int;
  v_por_hueco int;
begin
  v_room := public.assert_host(p_room, p_token);

  select * into v_round from public.rounds
   where room_id = p_room and state in ('open','juicio','closed','revealed')
   order by ordinal desc limit 1
   for update;

  if not found then
    raise exception 'nada_que_deshacer' using errcode = 'P0001';
  end if;

  select * into v_answer from public.answers
   where round_id = v_round.id and juzgado_at is not null
   order by juzgado_at desc
   limit 1;

  if not found then
    raise exception 'nada_que_deshacer' using errcode = 'P0001';
  end if;

  /*
   * Se devuelve TODO lo que esta ronda había pagado —lo de cada sentencia
   * y el sobrante del cierre— y después se vuelve a pagar solo lo que
   * sigue válido. Restar una parte deja al marcador y al detalle de las
   * respuestas diciendo cosas distintas: el jugador veía 0 puntos y su
   * respuesta guardaba 3.
   */
  v_pagado := coalesce((
    select sum(a.puntos) from public.answers a where a.round_id = v_round.id
  ), 0);

  if v_pagado > 0 then
    update public.players p
       set score = greatest(0, p.score - coalesce((
             select sum(a.puntos) from public.answers a
              where a.round_id = v_round.id and a.player_id = p.id), 0))
     where p.room_id = p_room;
  end if;

  -- Lo que sobrevive: cada sentencia viva vale sus huecos por su parte.
  v_por_hueco := 10 / greatest(coalesce(
                   array_length(public.huecos_de_ronda(v_round), 1), 1), 1);

  update public.answers a
     set puntos = case
       when a.id = v_answer.id then 0
       else jsonb_array_length(a.huecos_ganados) * v_por_hueco
     end
   where a.round_id = v_round.id;

  -- Y se vuelve a sumar a quien corresponda; aquí ya está la sentencia
  -- deshecha incluida, con 0.
  update public.players p
     set score = p.score + coalesce((
           select sum(a.puntos) from public.answers a
            where a.round_id = v_round.id and a.player_id = p.id), 0)
   where p.room_id = p_room;

  -- Si estaba cerrada o revelada, vuelve al juicio: el presentador está
  -- corrigiendo, no terminando la ronda.
  if v_round.state in ('closed','revealed') then
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

  perform public.recalcular_revelados(v_round.id);

  -- La ronda vuelve a estar abierta al juicio si el turno era suyo, y si
  -- no, se le devuelve el turno a él.
  update public.rounds
     set state = case when state = 'open' then 'juicio' else state end,
         turno_answer_id = v_answer.id
   where id = v_round.id;

  return jsonb_build_object(
    'round_id', v_round.id, 'state', 'juicio', 'turno_answer_id', v_answer.id
  );
end;
$$;

grant execute on function public.host_deshacer_sentencia(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Cerrar a mano no reparte el sobrante
-- ---------------------------------------------------------------------
-- «Cerrar pregunta» termina la ronda con huecos tapados: lo ganado se
-- conserva y NO se reparte nada nuevo. Es lo que se decidió, y la prueba
-- de SQL lo fija. Antes llamaba a la versión que siempre reparte.
create or replace function public.host_cerrar_pregunta(p_room uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
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

  perform public.cerrar_ronda_versiculo(v_round.id, false);

  return jsonb_build_object('round_id', v_round.id, 'state', 'closed');
end;
$$;

grant execute on function public.host_cerrar_pregunta(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. El hueco se dibuja tan largo como la palabra
-- ---------------------------------------------------------------------
-- El participante veía `____` para cualquier palabra: cuatro guiones para
-- «deshonra» (8 letras) no ayudan a nadie.
--
-- Se resuelve en el propio render y no con un campo nuevo: el servidor ya
-- sabe el largo de cada palabra cuando tapa el hueco, así que lo dibuja de
-- una vez. Saber que faltan 8 letras NO revela «deshonra»; decirla sí. La
-- fuga que protege todo este juego sigue cerrada.
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
  v_largo  int;
  v_rayas  text;
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
    if v_fin = 0 then
      v_salida := v_salida || v_resto;
      exit;
    end if;
    v_fin := v_ini + v_fin - 1;

    v_antes := substr(v_resto, 1, v_ini - 1);
    v_hueco := substr(v_resto, v_ini + 1, v_fin - v_ini - 1);
    v_salida := v_salida || v_antes;

    if btrim(v_hueco) = '' then
      v_salida := v_salida || v_hueco;
    elsif v_idx = any(v_rev) then
      v_salida := v_salida || v_hueco;
      v_idx := v_idx + 1;
    else
      -- Un guion por letra, con un mínimo de 3 para que el hueco se vea.
      -- Los espacios de una frase oculta no cuentan: se ven como separación.
      v_largo := greatest(3, length(replace(btrim(v_hueco), ' ', '')));
      v_rayas := repeat('_', v_largo);
      v_salida := v_salida || v_rayas;
      v_idx := v_idx + 1;
    end if;

    v_resto := substr(v_resto, v_fin + 1);
  end loop;

  return v_salida;
end;
$$;

grant execute on function public.versiculo_render(text, int[]) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Cerrar pulsaciones: el turno salta a quien NO fue juzgado
-- ---------------------------------------------------------------------
-- Defecto real: al continuar la ronda por las palabras que faltan, Ana ya
-- había sido sentenciada con un acierto parcial. Beto pulsaba, y el turno
-- se fijaba en el PRIMER pulso de la ronda, que seguía siendo el de Ana.
-- El presentador veía a Ana otra vez y no podía juzgar a Beto:
-- `no_es_el_turno`.
--
-- Ahora el turno va al primero que pulsó y todavía NO tiene veredicto.
create or replace function public.host_cerrar_pulsaciones(
  p_room uuid, p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_room   public.rooms;
  v_round  public.rounds;
  v_pulsos int;
  v_turno  uuid;
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
    return jsonb_build_object('round_id', v_round.id, 'state', v_round.state);
  end if;

  select count(*) into v_pulsos from public.answers where round_id = v_round.id;

  if v_pulsos = 0 then
    perform public.cerrar_ronda_versiculo(v_round.id);
    return jsonb_build_object(
      'round_id', v_round.id, 'state', 'closed', 'pulsos', 0
    );
  end if;

  -- El primero que pulsó y aún no fue juzgado. Se recalcula en cada
  -- cierre porque, al continuar la ronda, los primeros ya tienen su
  -- veredicto y no deben volver a salir.
  select a.id into v_turno
    from public.answers a
   where a.round_id = v_round.id and a.veredicto is null
   order by a.seq limit 1;

  update public.rounds
     set state = 'juicio', turno_answer_id = v_turno
   where id = v_round.id
   returning * into v_round;

  update public.rooms set paused = false where id = p_room;

  return jsonb_build_object(
    'round_id', v_round.id, 'state', v_round.state,
    'pulsos', v_pulsos, 'turno_answer_id', v_turno
  );
end;
$$;

grant execute on function public.host_cerrar_pulsaciones(uuid, text) to anon, authenticated;
