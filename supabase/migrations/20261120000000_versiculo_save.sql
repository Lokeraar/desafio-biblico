-- ---------------------------------------------------------------------
-- Guardar un versículo, y que el listado lo devuelva completo
-- ---------------------------------------------------------------------
-- Defecto real: el editor de versículos se conectaba al guardado de pregunta
-- de opción múltiple (`question_save`), que exige EXACTAMENTE cuatro opciones
-- y una correcta. Un versículo no tiene ni una cosa ni la otra: sus huecos
-- viven dentro de su propio texto, en `texto_marcado`, con formato
-- `{palabra}`.
--
-- Consecuencia que se veía en pantalla: para editar un versículo había que
-- inventar cuatro respuestas falsas, y `question_save` guardaba esas respuestas
-- en un juego que no las usa.
--
-- Estas dos funciones cierran eso: una guarda solo versículos, la otra
-- devuelve `texto_marcado` para que el editor los abra con sus huecos puestos.

-- ---------------------------------------------------------------------
-- 1. El listado devuelve `texto_marcado`
-- ---------------------------------------------------------------------
-- Sin esto el editor abría cada versículo VACÍO de huecos y obligaba a
-- rehacerlos, aunque la base ya los tuviera guardados.
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
             'source', q.source,
             -- El texto con las palabras entre llaves: es de donde el editor
             -- saca qué está tapado y cuántos huecos hay.
             'texto_marcado', q.texto_marcado,
             -- Cuántas veces se jugó ya, para avisar antes de reescribirlo.
             'last_played_at', q.last_played_at,
             'huecos', case
               when q.texto_marcado is null then 0
               else jsonb_array_length(public.versiculo_huecos(q.texto_marcado))
             end
           ) order by q.created_at)
      from public.questions q
     where q.topic_id = p_topic
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.question_list(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Guardar un versículo
-- ---------------------------------------------------------------------
-- Mismas comprobaciones que el editor hace al instante, pero en la base: el
-- cliente es comodidad, la base es la que manda.
--
-- La `prompt` NO se recibe: se arma con `versiculo_render` a partir del texto
-- marcado. Así hay una sola fuente de verdad sobre qué está tapado, y no se
-- puede guardar un `prompt` que diga una cosa y un `texto_marcado` que diga
-- otra.
create or replace function public.versiculo_save(
  p_key         text,
  p_topic       uuid,
  p_question    uuid,
  p_marcado     text,
  p_reference   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_marcado text := btrim(coalesce(p_marcado, ''));
  v_ref     text := nullif(btrim(coalesce(p_reference, '')), '');
  v_huecos  jsonb;
  v_n       int;
  v_game    text;
  v_q       public.questions;
  v_prompt  text;
begin
  perform public.assert_master_key(p_key);

  if length(v_marcado) = 0 then
    raise exception 'texto_vacio' using errcode = 'P0001';
  end if;
  if length(v_marcado) > 4000 then
    raise exception 'texto_muy_largo' using errcode = 'P0001';
  end if;
  if v_ref is not null and length(v_ref) > 120 then
    raise exception 'referencia_muy_larga' using errcode = 'P0001';
  end if;

  select game_slug into v_game from public.topics where id = p_topic;
  if not found then raise exception 'tema_inexistente' using errcode = 'P0002'; end if;

  -- El tope de 34 huecos que el documento pide. Antes solo estaba escrito.
  v_huecos := public.versiculo_huecos(v_marcado);
  v_n := jsonb_array_length(v_huecos);
  if v_n = 0 then
    raise exception 'sin_huecos' using errcode = 'P0001';
  end if;
  if v_n > 34 then
    raise exception 'demasiados_huecos' using errcode = 'P0001';
  end if;

  -- La prompt se DERIVA del marcado; no se acepta desde fuera.
  v_prompt := public.versiculo_render(v_marcado, array[]::int[]);

  if p_question is null then
    insert into public.questions
      (game_slug, topic_id, prompt, options, correct_option,
       texto_marcado, reference, source)
    values
      (v_game, p_topic, v_prompt, null, null,
       v_marcado, v_ref, 'manual')
    returning * into v_q;
  else
    update public.questions
       set texto_marcado = v_marcado,
           prompt        = v_prompt,
           reference     = v_ref,
           options       = null,
           correct_option = null
     where id = p_question and topic_id = p_topic
    returning * into v_q;

    if not found then
      raise exception 'pregunta_inexistente' using errcode = 'P0002';
    end if;
  end if;

  return jsonb_build_object(
    'id', v_q.id,
    'prompt', v_q.prompt,
    'reference', v_q.reference,
    'texto_marcado', v_q.texto_marcado,
    'huecos', v_n
  );
end;
$$;

grant execute on function public.versiculo_save(text, uuid, uuid, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Borrar un versículo
-- ---------------------------------------------------------------------
-- `question_delete` sirve igual (borra por id y tema), pero se deja aquí una
-- envoltura con el nombre del juego para que el código del editor no tenga que
-- saber que por dentro son la misma tabla.
create or replace function public.versiculo_delete(p_key text, p_question uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_master_key(p_key);
  delete from public.questions q
   using public.topics t
   where q.id = p_question
     and q.topic_id = t.id
     and t.game_slug = 'completar-versiculo';
end;
$$;

grant execute on function public.versiculo_delete(text, uuid) to anon, authenticated;
