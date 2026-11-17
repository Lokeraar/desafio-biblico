-- =====================================================================
-- Entrar solo antes de empezar, y una pantalla de televisor que transmita
-- ---------------------------------------------------------------------
-- Dos cosas que se notaron al probar con gente:
--
-- 1. `player_join` aceptaba siempre. Quien llegaba tarde entraba a mitad de
--    partida y quedaba en sala de espera esperando que alguien lo admitiera.
--    El requisito es el contrario: a una partida ya empezada no se entra.
--
-- 2. El televisor no sabía a qué sala conectarse: solo tenía el código que
--    alguien escribía a mano, y no había forma de pasar de un código al id
--    de la sala sin ser jugador. `room_by_code` hace solo esa traducción.
--
-- Regla que no se rompe: ni el jugador ni el televisor reciben la respuesta
-- correcta antes de que la ronda se revele.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Entrar: solo con la sala en 'lobby'
-- ---------------------------------------------------------------------
-- El resto del cuerpo es el de `20261115000000_init.sql`, tal cual. Lo
-- único nuevo es el rechazo cuando la partida ya arrancó. El `insert` sigue
-- calculando `is_waiting` igual que antes; con el rechazo de arriba esa
-- rama ya no se alcanza desde aquí, pero se deja intacta para que esta
-- función siga siendo la misma que la original más una condición.
create or replace function public.player_join(
  p_code text, p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
  v_player public.players;
  v_name text := btrim(p_name);
begin
  if length(v_name) < 2 then
    raise exception 'nombre_corto' using errcode = 'P0001';
  end if;
  if length(v_name) > 40 then
    raise exception 'nombre_largo' using errcode = 'P0001';
  end if;

  select * into v_room from public.rooms where upper(code) = upper(btrim(p_code));
  if not found then
    raise exception 'sala_inexistente' using errcode = 'P0002';
  end if;
  if v_room.status in ('ceremony','closed') then
    raise exception 'sala_cerrada' using errcode = 'P0001';
  end if;

  -- El corte: mientras la sala esté en 'lobby', entra cualquiera; en cuanto
  -- el presentador abre la primera pregunta, la sala deja de admitir gente.
  -- Se revisa el estado de la sala y no el de la ronda a propósito: 'lobby'
  -- es exactamente «todavía no se jugó nada».
  if v_room.status <> 'lobby' then
    raise exception 'partida_ya_iniciada' using errcode = 'P0001';
  end if;

  begin
    insert into public.players (room_id, display_name, is_waiting)
    values (v_room.id, v_name, v_room.status <> 'lobby')
    returning * into v_player;
  exception when unique_violation then
    raise exception 'nombre_ocupado' using errcode = '23505';
  end;

  return jsonb_build_object(
    'player_id',    v_player.id,
    'player_token', v_player.player_token,
    'room_id',      v_room.id,
    'code',         v_room.code,
    'display_name', v_player.display_name,
    'is_waiting',   v_player.is_waiting
  );
end;
$$;

grant execute on function public.player_join(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. De un código a su sala, sin ser jugador
-- ---------------------------------------------------------------------
-- El televisor escribe el código que ve en pantalla y necesita el id de la
-- sala para consultar `room_state`. Devuelve LO MÍNIMO: id, código y estado.
-- Ni participantes ni nada de la ronda: esta función la puede llamar
-- cualquiera que vea la pantalla, y la proyección pública ya tiene su propia
-- puerta (`room_state`), que es la que decide qué se revela.
create or replace function public.room_by_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
begin
  -- Se compara con `upper(btrim(...))` igual que `player_join`, y también
  -- sin espacios internos: el código se muestra espaciado («B 7 3 W S») y
  -- así se dicta y se escribe. Sin quitarlos, la sala no aparecía.
  select * into v_room
    from public.rooms
   where upper(code) = upper(regexp_replace(btrim(p_code), '\s+', '', 'g'));

  if not found then
    raise exception 'sala_inexistente' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'room_id', v_room.id,
    'code',    v_room.code,
    'status',  v_room.status
  );
end;
$$;

grant execute on function public.room_by_code(text) to anon, authenticated;
