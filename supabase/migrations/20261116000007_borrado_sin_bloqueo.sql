-- =====================================================================
-- Borrar preguntas no debe quedar bloqueado por una sala que no juega
-- ---------------------------------------------------------------------
-- `tema_con_partida` contaba como «partida en curso» cualquier sala en
-- 'lobby', 'question' o 'reveal' creada en las últimas 6 horas. Pero:
--
--   · 'lobby' es una sala recién creada donde nadie jugó ni una pregunta.
--     Crear una sala, mirarla y salir dejaba el tema bloqueado 6 horas, y
--     el presentador veía «No se puede borrar mientras hay una partida en
--     curso» sin ninguna partida a la vista. Pasaba al ensayar, al abrir la
--     pantalla del televisor o al recargar.
--
--   · El plazo adivinaba: una partida real dura minutos, no horas.
--
-- La regla correcta no depende del tiempo ni del estado de la sala. Una
-- pregunta solo estorba si está dentro de una RONDA ABIERTA: es el único
-- caso en que borrarla rompe algo de verdad (la ronda apunta a la pregunta
-- y la clave foránea no tiene cascada). Un tema con preguntas en una ronda
-- viva tampoco se puede borrar, por lo mismo.
--
-- Así, un ensayo o una sala en el lobby nunca bloquean el banco, y una
-- partida de verdad sigue protegida.
-- =====================================================================

-- ¿Alguna pregunta de este tema está dentro de una ronda viva?
--
-- Hacen falta TRES condiciones, y las tres se ganaron a pulso:
--
--   · La ronda está en un estado del que todavía se puede deshacer o
--     repetir: 'prepared', 'open', 'closed' o 'revealed'. 'revealed' tiene
--     que estar: la migración 08 permite deshacer y repetir justo después
--     de revelar, así que esa pregunta todavía se necesita.
--
--   · Su SALA se está jugando: 'question' o 'reveal'. Una lista positiva y
--     no `<> 'closed'`. Con `<> 'closed'` toda partida TERMINADA (que queda
--     en 'ceremony') seguía bloqueando el tema para siempre, porque sus
--     rondas siguen en la tabla. Eso cambiaba un bloqueo de 6 horas por uno
--     eterno, que es peor que el defecto original.
--
--   · La sala es reciente. Una pestaña cerrada a media pregunta deja la
--     sala en 'question' y nadie la cierra nunca; sin este plazo el tema
--     volvía a quedar bloqueado para siempre. Es el mismo criterio de la
--     migración 03, con un plazo más corto: una partida de iglesia dura
--     minutos, no seis horas.
create or replace function public.tema_con_partida(p_topic uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.rounds r
      join public.questions q on q.id = r.question_id
      join public.rooms rm on rm.id = r.room_id
     where q.topic_id = p_topic
       and r.state in ('prepared','open','closed','revealed')
       and rm.status in ('question','reveal')
       and rm.created_at > clock_timestamp() - interval '2 hours'
  );
$$;

-- La misma pregunta se puede pedir por su cuenta: el borrado de una sola
-- pregunta no tiene que mirar todo el tema.
create or replace function public.pregunta_con_partida(p_question uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.rounds r
      join public.rooms rm on rm.id = r.room_id
     where r.question_id = p_question
       and r.state in ('prepared','open','closed','revealed')
       and rm.status in ('question','reveal')
       and rm.created_at > clock_timestamp() - interval '2 hours'
  );
$$;

grant execute on function public.tema_con_partida(uuid) to anon, authenticated;
grant execute on function public.pregunta_con_partida(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Borrar UNA pregunta.
-- Se copia el cuerpo de la migración 03 cambiando solo la comprobación:
-- antes miraba todo el tema, ahora mira esa pregunta.
-- ---------------------------------------------------------------------
create or replace function public.question_delete(p_key text, p_question uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_master_key(p_key);

  if not exists (select 1 from public.questions where id = p_question) then
    raise exception 'pregunta_inexistente' using errcode = 'P0002';
  end if;

  -- Solo estorba si esa pregunta está en una ronda viva. Estar en el plan de
  -- una sala del lobby no es estorbo: `game_questions` tiene cascada y el
  -- plan se rehace solo.
  if public.pregunta_con_partida(p_question) then
    raise exception 'partida_en_curso' using errcode = 'P0001';
  end if;

  delete from public.questions where id = p_question;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.question_delete(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Limpieza: cerrar las salas abandonadas que dejaron el banco trabado.
-- Esto NO es lo que arregla el problema (eso lo hace la regla de arriba);
-- es para que el listado del presentador no muestre salas muertas.
-- ---------------------------------------------------------------------
update public.rooms
   set status = 'closed', ended_at = coalesce(ended_at, clock_timestamp())
 where status = 'lobby'
   and created_at < clock_timestamp() - interval '2 hours';

update public.rooms
   set status = 'closed', ended_at = coalesce(ended_at, clock_timestamp())
 where status in ('question','reveal')
   and created_at < clock_timestamp() - interval '6 hours';
