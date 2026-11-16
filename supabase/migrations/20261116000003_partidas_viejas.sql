-- =====================================================================
-- Una partida abandonada no debe bloquear el banco para siempre
-- ---------------------------------------------------------------------
-- El bloqueo por «partida en curso» miraba cualquier sala con estado
-- activo, sin importar su antigüedad. Una pestaña cerrada a la mitad dejaba
-- esa sala en 'question' para siempre, y desde entonces era imposible
-- borrar una pregunta de ese tema: el presentador veía «No se puede borrar
-- mientras hay una partida en curso» sin ninguna partida a la vista.
--
-- Una partida real dura minutos. Se considera en curso solo si la sala se
-- creó en las últimas 6 horas; pasado ese plazo se trata como abandonada.
-- =====================================================================

-- ¿Hay una partida realmente viva en este tema?
create or replace function public.tema_con_partida(p_topic uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.rooms r
     where r.topic_id = p_topic
       and r.status in ('lobby','question','reveal')
       and r.created_at > clock_timestamp() - interval '6 hours'
  );
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

  if public.tema_con_partida(v_topic) then
    raise exception 'partida_en_curso' using errcode = 'P0001';
  end if;

  delete from public.questions where id = p_question;
  return jsonb_build_object('ok', true);
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

  if public.tema_con_partida(p_topic) then
    raise exception 'partida_en_curso' using errcode = 'P0001';
  end if;

  delete from public.topics where id = p_topic;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Limpieza: cerrar las salas realmente abandonadas.
-- Se usa el MISMO plazo de 6 horas que el bloqueo: una partida de iglesia
-- puede durar una hora, y cerrarla a la fuerza en mitad del juego sería
-- peor que el problema que se está arreglando.
-- ---------------------------------------------------------------------
update public.rooms
   set status = 'closed', ended_at = clock_timestamp()
 where status in ('lobby','question','reveal')
   and created_at < clock_timestamp() - interval '6 hours';

grant execute on function public.tema_con_partida(uuid) to anon, authenticated;
