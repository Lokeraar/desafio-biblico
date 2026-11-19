-- =====================================================================
-- La primera clave maestra no se podía establecer
-- ---------------------------------------------------------------------
-- DEFECTO ENCONTRADO al probar la marca del menú, y es un candado sin
-- salida de los que importan: cuando hay que soltar algo, nadie lo suelta.
--
-- La pantalla de configuraciones ofrece «Establecer la clave maestra»
-- cuando todavía no hay ninguna (lo dice su propio texto). Pero el camino
-- por debajo era único: `admin_change_key`, que empieza pidiendo la clave
-- ANTERIOR:
--
--     perform public.assert_master_key(p_old);
--
-- Y `assert_master_key`, si no hay clave configurada, lanza
-- `clave_no_configurada`. Es decir: para establecer la primera clave había
-- que escribir la clave anterior, que por definición no existe. El botón
-- estaba muerto en cualquier instalación nueva, y el único camino real era
-- entrar por fuera, con SQL a mano.
--
-- Por qué nadie lo había notado: en el proyecto original la clave se puso
-- una vez por SQL directo, y a partir de ahí «cambiar» funcionaba. El
-- defecto solo aparece en el primer uso, que es justo el que no se repite.
--
-- LA CORRECCIÓN es una excepción explícita y acotada: si NO hay clave
-- configurada, esto es la primera y no hay nada que comprobar. Si la hay,
-- se sigue exigiendo la anterior, igual que antes. No se relaja nada más:
-- con clave puesta, el camino es el mismo de siempre.
-- =====================================================================

create or replace function public.admin_change_key(p_old text, p_new text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hay_clave boolean;
begin
  select c.key_hash is not null into v_hay_clave
    from public.admin_config c
   where c.id = true;

  -- Sin clave configurada, es la primera: no se pide anterior.
  -- Con clave configurada, se pide y se comprueba como siempre.
  if v_hay_clave then
    perform public.assert_master_key(p_old);
  end if;

  if p_new is null or length(btrim(p_new)) < 4 then
    raise exception 'clave_muy_corta' using errcode = 'P0001';
  end if;
  if length(p_new) > 64 then
    raise exception 'clave_muy_larga' using errcode = 'P0001';
  end if;

  update public.admin_config
     set key_hash = extensions.crypt(p_new, extensions.gen_salt('bf')),
         failed_attempts = 0,
         locked_until = null,
         updated_at = clock_timestamp()
   where id = true;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------
-- ¿Hay clave? (público, y no revela nada de la clave)
-- ---------------------------------------------------------------------
-- La pantalla de configuraciones decía «La clave está configurada» mirando
-- si Supabase estaba configurado, que es otra cosa. Con esto puede decir la
-- verdad, y el modal sabe si debe pedir la clave actual o no.
create or replace function public.admin_key_status()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'configurada', (c.key_hash is not null),
           'bloqueada',   (c.locked_until is not null and clock_timestamp() < c.locked_until),
           'intentos',    c.failed_attempts
         )
    from public.admin_config c
   where c.id = true;
$$;

grant execute on function public.admin_key_status() to anon, authenticated;
