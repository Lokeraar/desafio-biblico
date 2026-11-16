-- =====================================================================
-- El presentador puede CERRAR la sala sin terminar el juego
-- ---------------------------------------------------------------------
-- «Menú» en la pantalla del presentador solo abandonaba la pestaña. La sala
-- se quedaba viva en el servidor con sus jugadores dentro, esperando a un
-- presentador que ya se había ido, y bloqueaba el tema para borrar
-- preguntas durante las 6 horas del barrido de salas abandonadas (ver
-- 20261116000003_partidas_viejas.sql).
--
-- `host_end_game` no sirve para esto: lleva la sala a 'ceremony' y corona a
-- un ganador. Aquí no hay ganador: la partida se abandona antes de jugarse
-- o a la mitad, así que va a 'closed', que es el estado final que ya
-- entiende `player_join` (rechaza con 'sala_cerrada') y `final_scoreboard`.
-- =====================================================================

create or replace function public.host_close_room(p_room uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
begin
  v_room := public.assert_host(p_room, p_token);

  -- Ninguna ronda puede quedar abierta: si la sala se abandona con una
  -- pregunta en curso, el reloj seguiría corriendo en los teléfonos y el
  -- jugador vería «espera la respuesta» para siempre.
  update public.rounds
     set state = 'closed', closed_at = clock_timestamp(), no_winner = true
   where room_id = p_room
     and state in ('prepared', 'open');

  update public.rooms
     set status = 'closed', paused = false, ended_at = clock_timestamp()
   where id = p_room;

  return jsonb_build_object('status', 'closed');
end;
$$;

grant execute on function public.host_close_room(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Limpieza de lo que quedó mal cerrado.
-- Toda sala de más de 6 horas ya se considera abandonada por el barrido
-- anterior, así que aquí NO se toca nada: se cierran solo las que ya
-- estaban en 'ceremony' sin terminar de guardar su `ended_at`.
-- ---------------------------------------------------------------------
update public.rooms
   set ended_at = coalesce(ended_at, clock_timestamp())
 where status = 'ceremony'
   and ended_at is null;
