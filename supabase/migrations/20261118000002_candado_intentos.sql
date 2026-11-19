-- =====================================================================
-- El candado de intentos no existía: se borraba solo en cada intento
-- ---------------------------------------------------------------------
-- DEFECTO GRAVE, encontrado al escribir las pruebas de la marca del menú.
-- No lo introdujo este trabajo: estaba desde la primera versión, y era
-- invisible porque no dejaba ningún rastro.
--
-- QUÉ SE CREÍA QUE PASABA: cinco claves incorrectas y la puerta se cierra
-- diez minutos. El código lo decía, el modal lo insinuaba, y hasta tenía
-- su mensaje `clave_bloqueada` traducido para la pantalla.
--
-- QUÉ PASABA DE VERDAD: nada. `assert_master_key` hacía su `update` —subir
-- el contador— y acto seguido `raise exception 'clave_incorrecta'`. En
-- PostgreSQL una excepción no revierte solo lo que falta: deshace la
-- TRANSACCIÓN COMPLETA. Así que el `update` del contador se deshacía junto
-- con el error, siempre, en cada intento. El contador volvía a cero solo.
--
-- Medido, cada intento en su propia transacción —que es como llega de
-- verdad, una llamada RPC por intento:
--
--     tras 7 claves incorrectas -> intentos = 0, bloqueada_hasta = NUNCA
--     y la clave correcta entraba igual
--
-- CONSECUENCIA REAL: la clave maestra es de 4 dígitos, 10 000 combinaciones.
-- Sin freno, cualquiera con el enlace puede probarlas todas en minutos y
-- quedarse con el panel: editar temas, preguntas, y la marca del menú.
--
-- ---------------------------------------------------------------------
-- POR QUÉ LA CORRECCIÓN SON SECUENCIAS Y NO OTRO `update`
-- ---------------------------------------------------------------------
-- Guardar el contador en otra tabla no arregla nada: el problema no es
-- DÓNDE se guarda, es que el error deshace la escritura. Hace falta algo
-- que NO se revierta al abortar. En PostgreSQL, `nextval()` y `setval()`
-- tienen exactamente esa propiedad: avanzan y no vuelven, pase lo que pase
-- con la transacción. Comprobado en este mismo Postgres, abortando después
-- de escribir:
--
--     nextval -> sobrevive al rollback (last_value = 1, is_called = t)
--     setval  -> sobrevive al rollback (last_value = 1700000000000)
--
-- Son tres datos, y los tres van en secuencias por la misma razón:
--
--   admin_intentos_seq     cada fallo hace `nextval`: cuenta los intentos
--   admin_marca_seq        se alinea con `setval` en cada acierto, y al
--                          cumplirse la espera: marca dónde arranca el conteo
--   admin_ultimo_fallo_seq guarda CUÁNDO fue el último fallo, en milisegundos
--
-- Los intentos fallidos son la resta de las dos primeras. El momento del
-- último fallo sale de la tercera. Nada de eso vive en una tabla, así que
-- nada de eso puede deshacerse.
--
-- Se conservan `admin_config.failed_attempts` y `locked_until` como espejo,
-- para poder mirarlos a ojo con una consulta, pero NO son la autoridad: lo
-- que decide si la puerta se cierra no puede depender de una escritura que
-- un error pueda deshacer. El espejo, de hecho, solo se puede escribir en
-- los caminos que sí terminan bien.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Las tres secuencias
-- ---------------------------------------------------------------------
-- Arrancan en un valor alto para que no choquen con nada y para que la
-- marca inicial sea un número reconocible.
create sequence if not exists public.admin_intentos_seq
  as bigint minvalue 0 start with 1000000;

create sequence if not exists public.admin_marca_seq
  as bigint minvalue 0 start with 1000000;

create sequence if not exists public.admin_ultimo_fallo_seq
  as bigint minvalue 0 start with 0;

-- `setval` con el valor de arranque deja la secuencia «ya usada»: el primer
-- `nextval` devuelve 1000001. Sin esto, el primer intento fallido devolvía
-- 1000000, que es el mismo número que la marca, y la resta daba 0: el
-- primer intento no contaba. Se vio en la prueba, con el conteo en 0
-- después del primer fallo.
select setval('public.admin_intentos_seq', 1000000);
select setval('public.admin_marca_seq', 1000000);

revoke all on sequence public.admin_intentos_seq from anon, authenticated;
revoke all on sequence public.admin_marca_seq from anon, authenticated;
revoke all on sequence public.admin_ultimo_fallo_seq from anon, authenticated;

-- El espejo, por si alguien mira la tabla a ojo.
alter table public.admin_config
  add column if not exists intentos_marca bigint not null default 1000000;

-- ---------------------------------------------------------------------
-- 2. Cuántos intentos van, y cuándo fue el último
-- ---------------------------------------------------------------------
create or replace function public.admin_intentos_fallidos()
returns int
language sql
security definer
set search_path = public, pg_temp
as $$
  -- La resta de dos números que no se revierten. Nunca negativa: si la
  -- marca fuera por delante (una migración a medias), el conteo es 0.
  select greatest(0, (
    coalesce((select last_value from public.admin_intentos_seq), 0)
    - coalesce((select last_value from public.admin_marca_seq), 0)
  ))::int;
$$;

revoke all on function public.admin_intentos_fallidos() from anon, authenticated;

/** Milisegundos del último fallo, o 0 si nunca hubo. */
create or replace function public.admin_ultimo_fallo_ms()
returns bigint
language sql
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select last_value from public.admin_ultimo_fallo_seq), 0)::bigint;
$$;

revoke all on function public.admin_ultimo_fallo_ms() from anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. La verificación que de verdad frena
-- ---------------------------------------------------------------------
create or replace function public.assert_master_key(p_key text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cfg        public.admin_config;
  v_intentos   int;
  v_ultimo_ms  bigint;
  const_max    constant int := 5;
  const_espera constant interval := interval '10 minutes';
begin
  select * into v_cfg from public.admin_config where id = true for update;

  if v_cfg.key_hash is null then
    raise exception 'clave_no_configurada' using errcode = 'P0001';
  end if;

  v_intentos  := public.admin_intentos_fallidos();
  v_ultimo_ms := public.admin_ultimo_fallo_ms();

  -- La puerta está cerrada mientras no se cumpla la espera contada desde el
  -- ÚLTIMO fallo. Se calcula, no se guarda: un `locked_until` en la tabla
  -- se deshacía con el error, y la puerta quedaba abierta. Medido: tras 5
  -- fallos, `bloqueada` seguía en false y la clave correcta entraba.
  if v_intentos >= const_max
     and v_ultimo_ms > 0
     and clock_timestamp() < to_timestamp(v_ultimo_ms / 1000.0) + const_espera then
    raise exception 'clave_bloqueada' using errcode = 'P0001';
  end if;

  -- Cumplida la espera, el conteo arranca de nuevo. La marca se mueve con
  -- `setval`: sobrevive a un error posterior, así que un fallo nuevo no
  -- arrastra los viejos.
  if v_intentos >= const_max then
    perform setval('public.admin_marca_seq',
                   (select last_value from public.admin_intentos_seq));
    v_intentos := 0;
  end if;

  if p_key is null or extensions.crypt(p_key, v_cfg.key_hash) <> v_cfg.key_hash then
    -- ESTOS DOS `setval`/`nextval` SON EL ARREGLO. Avanzan las secuencias y
    -- no se deshacen, aunque las líneas siguientes lancen la excepción que
    -- aborta todo lo demás. Es lo único del intento fallido que sobrevive,
    -- y es justo lo que hay que recordar.
    perform nextval('public.admin_intentos_seq');
    perform setval('public.admin_ultimo_fallo_seq',
                   (extract(epoch from clock_timestamp()) * 1000)::bigint);

    v_intentos := public.admin_intentos_fallidos();

    if v_intentos >= const_max then
      raise exception 'clave_bloqueada' using errcode = 'P0001';
    end if;

    raise exception 'clave_incorrecta' using errcode = 'P0001';
  end if;

  -- Clave correcta: la marca se alinea y el conteo vuelve a cero.
  perform setval('public.admin_marca_seq',
                 (select last_value from public.admin_intentos_seq));

  update public.admin_config
     set intentos_marca = (select last_value from public.admin_marca_seq),
         failed_attempts = 0,
         locked_until = null
   where id = true;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. El estado que la pantalla consulta
-- ---------------------------------------------------------------------
create or replace function public.admin_key_status()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'configurada', (c.key_hash is not null),
           'intentos',    public.admin_intentos_fallidos(),
           'restantes',   greatest(0, 5 - public.admin_intentos_fallidos()),
           'bloqueada',   (
             public.admin_intentos_fallidos() >= 5
             and public.admin_ultimo_fallo_ms() > 0
             and clock_timestamp() < to_timestamp(public.admin_ultimo_fallo_ms() / 1000.0) + interval '10 minutes'
           )
         )
    from public.admin_config c
   where c.id = true;
$$;

grant execute on function public.admin_key_status() to anon, authenticated;
