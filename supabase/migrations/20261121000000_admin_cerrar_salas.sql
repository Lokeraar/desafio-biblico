-- =====================================================================
-- Cerrar salas abiertas desde Configuraciones, con la clave maestra
-- ---------------------------------------------------------------------
-- Christian: «Para cerrar sala individual (introduciendo el código) como
-- para cerrar todas».
--
-- EL PROBLEMA QUE RESUELVE
-- Hoy, si el presentador cierra la pestaña, cambia de teléfono o se le va la
-- señal con la sala abierta, la sala sigue viva en el servidor con sus
-- jugadores esperando a alguien que ya no está. `host_close_room` no sirve
-- para recuperarla: pide el TOKEN del presentador, y ese token vivía en el
-- `localStorage` de la pestaña que se cerró.
--
-- La única salida era esperar el barrido de 30 minutos de inactividad
-- (`20261116000011_inactividad.sql:8`). Esto lo resuelve en el momento.
--
-- POR QUÉ CON LA CLAVE MAESTRA Y NO CON UN TOKEN
-- Es mantenimiento, no conducción de una partida: no hay una sesión de
-- presentador a la que atarse. La clave maestra ya es la puerta de esta
-- pantalla, y `assert_master_key` ya trae el candado de intentos.
--
-- LAS TRES FUNCIONES
--   admin_rooms_open(p_key)                  -> lista las salas vivas
--   admin_close_room_by_code(p_key, p_code)  -> cierra una por su código
--   admin_close_all_rooms(p_key)             -> cierra todas
--
-- Las tres validan la clave ANTES de tocar nada, con `assert_master_key`,
-- igual que `topic_create` y `branding_set_lema`.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Listar las salas abiertas
-- ---------------------------------------------------------------------
-- Sin esto, el botón «cerrar todas» no puede decir cuántas son ni mostrar
-- sus códigos, y quien pulsa un botón que cierra N cosas tiene derecho a
-- saber cuántas antes de pulsarlo.
--
-- Solo las vivas: `status <> 'closed'`. Se ordenan por código para que la
-- lista sea estable entre sondeos: una lista que cambia de orden sola se lee
-- como si cambiara de contenido.
create or replace function public.admin_rooms_open(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_master_key(p_key);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',       r.id,
             'code',     r.code,
             'status',   r.status,
             'game',     r.game_slug,
             'players',  (select count(*)
                            from public.players p
                           where p.room_id = r.id
                             and not p.is_waiting
                             and not p.kicked),
             'created',  r.created_at
           ) order by r.code)
      from public.rooms r
     where r.status <> 'closed'
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.admin_rooms_open(text) to anon, authenticated;

comment on function public.admin_rooms_open(text) is
  'Lista las salas sin cerrar. Pide la clave maestra: sin ella no se filtra ni qué salas existen.';

-- ---------------------------------------------------------------------
-- 2. Cerrar UNA sala por su código
-- ---------------------------------------------------------------------
-- Por código y no por `uuid`: el presentador recuerda B73WS, no un
-- identificador de la base que nunca vio.
--
-- `upper(btrim(...))` igual que `room_by_code`: quien escribe «b73ws » con
-- el teclado del teléfono está escribiendo el código correcto.
--
-- Si el código no existe se devuelve `sala_inexistente` en vez de reventar:
-- es un dato que la persona escribió a mano y se puede equivocar.
create or replace function public.admin_close_room_by_code(p_key text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.rooms;
begin
  perform public.assert_master_key(p_key);

  select * into v_room
    from public.rooms
   where upper(code) = upper(btrim(coalesce(p_code, '')));

  if not found then
    return jsonb_build_object('error', 'sala_inexistente');
  end if;

  if v_room.status = 'closed' then
    -- Cerrada ya no es un error: el resultado que se buscaba es el que hay.
    return jsonb_build_object('code', v_room.code, 'status', 'closed',
                              'ya_estaba', true);
  end if;

  -- Ninguna ronda puede quedar abierta, por lo mismo que en
  -- `host_close_room`: con una pregunta en curso, el reloj seguiría
  -- corriendo en los teléfonos aunque la sala ya esté cerrada.
  update public.rounds
     set state = 'closed', closed_at = clock_timestamp(), no_winner = true
   where room_id = v_room.id
     and state in ('prepared', 'open');

  -- `close_reason` se deja en null a proposito: el comentario de la columna
  -- dice «inactividad, o null si la cerró el presentador», y esto es
  -- exactamente eso, alguien cerrándola a mano. Poner un valor nuevo
  -- obligaria a que el cliente lo aprendiera para no mostrarlo como error.
  update public.rooms
     set status = 'closed', paused = false, ended_at = clock_timestamp()
   where id = v_room.id;

  return jsonb_build_object('code', v_room.code, 'status', 'closed',
                            'ya_estaba', false);
end;
$$;

grant execute on function public.admin_close_room_by_code(text, text) to anon, authenticated;

comment on function public.admin_close_room_by_code(text, text) is
  'Cierra una sala buscandola por su codigo corto. Con la clave maestra, para recuperar una sala perdida.';

-- ---------------------------------------------------------------------
-- 3. Cerrar TODAS
-- ---------------------------------------------------------------------
-- Devuelve cuántas cerró de verdad, no cuántas encontró: si dos pestañas
-- pulsan a la vez, la segunda no debe decir que cerró cuatro cuando la
-- primera ya las había cerrado.
--
-- `returning id` no sirve aquí: `update ... returning` devuelve las filas
-- que la sentencia cambió, que es justo lo que se quiere contar.
create or replace function public.admin_close_all_rooms(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids   uuid[];
  v_total int;
begin
  perform public.assert_master_key(p_key);

  -- Se congelan los ids ANTES de tocar nada: el `update` de rondas y el de
  -- salas tienen que hablar de las mismas salas aunque alguien cree una
  -- nueva a mitad.
  select array_agg(id) into v_ids
    from public.rooms
   where status <> 'closed';

  if v_ids is null or cardinality(v_ids) = 0 then
    return jsonb_build_object('cerradas', 0);
  end if;

  update public.rounds
     set state = 'closed', closed_at = clock_timestamp(), no_winner = true
   where room_id = any(v_ids)
     and state in ('prepared', 'open');

  update public.rooms
     set status = 'closed', paused = false, ended_at = clock_timestamp()
   where id = any(v_ids)
     and status <> 'closed';

  get diagnostics v_total = row_count;

  return jsonb_build_object('cerradas', v_total, 'total', cardinality(v_ids));
end;
$$;

grant execute on function public.admin_close_all_rooms(text) to anon, authenticated;

comment on function public.admin_close_all_rooms(text) is
  'Cierra todas las salas sin cerrar. Devuelve cuantas cerro de verdad, no cuantas encontro.';
