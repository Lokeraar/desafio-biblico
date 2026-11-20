-- ---------------------------------------------------------------------
-- El barrido de inactividad cierra también las rondas en 'juicio'
-- ---------------------------------------------------------------------
-- Defecto medido: una sala del juego nuevo se quedaba con la ronda VIVA
-- después de que el barrido la cerrara. Se creaba la sala, alguien pulsaba,
-- se cerraban las pulsaciones (estado 'juicio') y el presentador no tocaba
-- nada en más de una hora. El barrido cerraba la SALA, pero su UPDATE solo
-- miraba los estados viejos:
--
--     and state in ('prepared', 'open', 'closed')
--
-- El juego de completar el versículo añadió 'juicio', donde la ronda se
-- queda esperando que el presentador sentencie. No estaba en esa lista, así
-- que sobrevivía al cierre: `rooms.status = 'closed'` con `rounds.state =
-- 'juicio'` y el `turno_answer_id` apuntando a alguien que ya no está.
--
-- El comentario original explicaba el porqué, y sigue siendo la razón: si la
-- sala se cierra con una sentencia pendiente, esa ronda no puede quedar
-- abierta. Se cierra y se marca sin ganador, igual que las demás.
--
-- 'revealed' y 'annulled' NO entran: son estados terminales, la ronda ya
-- terminó y reescribirlos borraría el resultado de la partida.
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

  -- Cerrojo contra la recursión; se explica en la migración original.
  if coalesce(current_setting('desafio.barrido', true), 'off') = 'on' then
    return 0;
  end if;

  if not pg_try_advisory_xact_lock(hashtext('desafio_barrido_inactividad')) then
    return 0;
  end if;

  perform set_config('desafio.barrido', 'on', true);

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
  -- pregunta en curso, el reloj seguiría corriendo en los teléfonos. Se
  -- incluye 'juicio': en el juego nuevo esa ronda está esperando una
  -- sentencia que ya no va a llegar.
  update public.rounds
     set state = 'closed', closed_at = clock_timestamp(),
         no_winner = true, turno_answer_id = null
   where room_id = any(v_ids)
     and state in ('prepared', 'open', 'juicio', 'closed');

  update public.rooms
     set status = 'closed',
         paused = false,
         ended_at = coalesce(ended_at, clock_timestamp()),
         close_reason = 'inactividad'
   where id = any(v_ids);

  v_cerradas := cardinality(v_ids);

  perform set_config('desafio.barrido', 'off', true);
  return v_cerradas;
end;
$$;

revoke all on function public.barrer_salas_inactivas(int) from public;
