-- =====================================================================
-- Pruebas de admin_rooms_open / admin_close_room_by_code / admin_close_all_rooms
-- ---------------------------------------------------------------------
-- Se aplica sobre una base ya migrada. Todo en una transacción con
-- `rollback` al final: no deja salas ni claves detrás.
--
-- Lo que se prueba es lo que HACE, no que exista:
--   1. Con clave equivocada, no pasa nada.
--   2. `admin_rooms_open` lista solo las vivas.
--   3. `admin_close_room_by_code` cierra la sala pedida y NINGUNA otra,
--      y no revienta con un código que no existe.
--   4. `admin_close_all_rooms` cierra las que quedan y dice cuántas cerró
--      de verdad.
--   5. Una sala cerrada por aquí rechaza jugadores nuevos.
-- =====================================================================

\set ON_ERROR_STOP on
begin;

do $$
declare
  v_fallas  int := 0;
  v_tema    uuid;
  v_sala_a  jsonb;
  v_sala_b  jsonb;
  v_sala_c  jsonb;
  v_cod_a   text;
  v_cod_b   text;
  v_lista   jsonb;
  v_res     jsonb;
  v_n       int;
begin
  -- ---------- preparación ----------
  -- Clave maestra conocida y sin intentos fallidos previos.
  update public.admin_config
     set key_hash = extensions.crypt('4321', extensions.gen_salt('bf'))
   where id = true;

  select id into v_tema from public.topics where game_slug = 'seleccion-simple' limit 1;

  v_sala_a := public.host_create_room(v_tema, 'seleccion-simple', 15);
  v_sala_b := public.host_create_room(v_tema, 'seleccion-simple', 15);
  v_sala_c := public.host_create_room(v_tema, 'seleccion-simple', 15);
  v_cod_a  := v_sala_a ->> 'code';
  v_cod_b  := v_sala_b ->> 'code';

  raise notice 'salas creadas: % % %', v_cod_a, v_cod_b, v_sala_c ->> 'code';

  -- ---------- 1. clave equivocada ----------
  begin
    perform public.admin_rooms_open('clave-mala');
    raise exception 'FALLA: admin_rooms_open acepto una clave equivocada';
  exception
    when others then
      if sqlerrm not like '%clave_incorrecta%' and sqlerrm not like '%clave%' then
        raise exception 'FALLA: error inesperado con clave mala: %', sqlerrm;
      end if;
  end;

  raise notice 'ok 1: la clave equivocada no abre nada';

  -- ---------- 2. listar ----------
  v_lista := public.admin_rooms_open('4321');

  v_n := jsonb_array_length(v_lista);
  if v_n < 3 then
    raise exception 'FALLA: admin_rooms_open devolvio % salas, esperaba al menos 3', v_n;
  end if;

  if not exists (
    select 1 from jsonb_array_elements(v_lista) e
     where e ->> 'code' = v_cod_a
  ) then
    raise exception 'FALLA: la sala % no aparece en la lista', v_cod_a;
  end if;

  -- Cada sala trae sus claves, no un objeto vacio.
  if not exists (
    select 1 from jsonb_array_elements(v_lista) e
     where e ->> 'code' = v_cod_a
       and (e ->> 'players') is not null
       and (e ->> 'status') is not null
  ) then
    raise exception 'FALLA: la sala % vino sin status o sin players', v_cod_a;
  end if;

  raise notice 'ok 2: la lista trae % salas vivas, con status y players', v_n;

  -- ---------- 3. cerrar UNA por codigo ----------
  -- Se escribe con espacios y en minusculas a proposito: es lo que teclea
  -- una persona en el telefono.
  v_res := public.admin_close_room_by_code('4321', '  ' || lower(v_cod_a) || ' ');

  if (v_res ->> 'status') <> 'closed' then
    raise exception 'FALLA: no cerro la sala % (respuesta: %)', v_cod_a, v_res;
  end if;

  select count(*) into v_n from public.rooms where code = v_cod_a and status = 'closed';
  if v_n <> 1 then
    raise exception 'FALLA: la sala % no quedo cerrada en la base', v_cod_a;
  end if;

  -- La otra sigue viva: cerrar una no puede cerrar dos.
  select count(*) into v_n from public.rooms where code = v_cod_b and status <> 'closed';
  if v_n <> 1 then
    raise exception 'FALLA: cerrar % tambien cerro %', v_cod_a, v_cod_b;
  end if;

  raise notice 'ok 3: cerro % y dejo viva %', v_cod_a, v_cod_b;

  -- ---------- 3b. codigo que no existe ----------
  v_res := public.admin_close_room_by_code('4321', 'ZZZZZ');
  if (v_res ->> 'error') <> 'sala_inexistente' then
    raise exception 'FALLA: un codigo inexistente devolvio %', v_res;
  end if;
  raise notice 'ok 3b: un codigo inexistente devuelve sala_inexistente, sin reventar';

  -- ---------- 3c. cerrar dos veces la misma ----------
  v_res := public.admin_close_room_by_code('4321', v_cod_a);
  if (v_res ->> 'ya_estaba') <> 'true' then
    raise exception 'FALLA: cerrar dos veces la misma no lo dijo: %', v_res;
  end if;
  raise notice 'ok 3c: cerrar dos veces la misma dice que ya estaba';

  -- ---------- 4. cerrar TODAS ----------
  v_res := public.admin_close_all_rooms('4321');

  if (v_res ->> 'cerradas')::int < 2 then
    raise exception 'FALLA: cerrar todas dijo % cerradas, esperaba al menos 2', v_res ->> 'cerradas';
  end if;

  select count(*) into v_n from public.rooms where status <> 'closed';
  if v_n <> 0 then
    raise exception 'FALLA: quedaron % salas sin cerrar', v_n;
  end if;

  raise notice 'ok 4: cerro % salas, no queda ninguna viva', v_res ->> 'cerradas';

  -- ---------- 4b. cerrar todas otra vez ----------
  v_res := public.admin_close_all_rooms('4321');
  if (v_res ->> 'cerradas')::int <> 0 then
    raise exception 'FALLA: cerrar todas dos veces dijo que cerro %', v_res ->> 'cerradas';
  end if;
  raise notice 'ok 4b: cerrar todas dos veces dice 0, no inventa';

  -- ---------- 5. una sala cerrada rechaza jugadores ----------
  begin
    perform public.player_join(v_sala_c ->> 'code', 'Tarde');
    raise exception 'FALLA: un jugador entro a una sala cerrada';
  exception
    when others then
      if sqlerrm not like '%sala_cerrada%' then
        raise exception 'FALLA: error inesperado al entrar a sala cerrada: %', sqlerrm;
      end if;
  end;

  raise notice 'ok 5: una sala cerrada por aqui rechaza jugadores con sala_cerrada';

  raise notice '--- TODAS LAS PRUEBAS DE CERRAR SALAS PASARON ---';
end $$;

rollback;
