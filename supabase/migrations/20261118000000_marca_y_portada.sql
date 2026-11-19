-- =====================================================================
-- Marca del menú: el lema y la portada, editables con la clave maestra
-- ---------------------------------------------------------------------
-- El menú principal muestra dos cosas que hasta ahora estaban clavadas en el
-- código: el lema («2 Corintios · Concurso de preguntas») y la portada
-- (`public/img/portada.webp`). El organizador necesita cambiarlas sin tocar
-- el repositorio, y solo él debe poder hacerlo.
--
-- POR QUÉ EN LA BASE Y NO EN EL ARCHIVO:
-- una página web no puede escribir en el servidor que la sirve. Desde el
-- navegador, «reemplazar el archivo portada.webp» solo cambia lo que ve ESE
-- teléfono y, al recargar, vuelve la imagen vieja. Para que el cambio lo vea
-- todo el mundo —el presentador, los jugadores y el televisor— tiene que vivir
-- donde ya vive lo compartido: la base. Se guarda el webp en base64, que para
-- una portada de ~60 KB es completamente razonable y evita montar un depósito
-- de archivos aparte con sus propios permisos.
--
-- POR QUÉ WEBP Y NO LO QUE MANDEN:
-- la portada se dibuja en teléfonos modestos durante una partida. El webp ya
-- está en la app y es lo que mejor relación tamaño/calidad da. La conversión
-- se hace en el navegador, al subir; aquí, además, se REVISA que lo recibido
-- sea de verdad un webp: la clave maestra protege la puerta, pero un dato que
-- entra por la puerta no deja de necesitar revisión (principio de no confiar
-- en el cliente). Se miran los bytes de cabecera, no el nombre del archivo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. La tabla: un solo registro, como `admin_config`
-- ---------------------------------------------------------------------
create table if not exists public.branding (
  id            boolean primary key default true check (id),
  lema          text,                      -- null = se usa el texto del código
  portada       text,                      -- base64 del webp, SIN el prefijo data:
  portada_bytes int,                       -- tamaño real, para poder auditar
  updated_at    timestamptz not null default clock_timestamp()
);

insert into public.branding (id) values (true) on conflict do nothing;

-- Igual que el resto de las tablas: sin políticas para el público. Todo pasa
-- por funciones, que sí revisan la clave.
revoke all on public.branding from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Leer la marca (público: el menú lo necesita sin clave)
-- ---------------------------------------------------------------------
create or replace function public.branding_get()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'lema',          b.lema,
           'portada',       b.portada,
           'portada_bytes', b.portada_bytes
         )
    from public.branding b
   where b.id = true;
$$;

-- ---------------------------------------------------------------------
-- 3. Cambiar el lema
-- ---------------------------------------------------------------------
create or replace function public.branding_set_lema(p_key text, p_lema text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lema text;
begin
  -- Primero la clave: nada se escribe antes de comprobarla.
  perform public.assert_master_key(p_key);

  v_lema := nullif(btrim(coalesce(p_lema, '')), '');

  -- Vacío no es un error: es «vuelve al texto del código», que es una forma
  -- legítima de deshacer el cambio.
  if v_lema is not null and length(v_lema) > 120 then
    raise exception 'lema_muy_largo' using errcode = 'P0001';
  end if;

  update public.branding
     set lema = v_lema,
         updated_at = clock_timestamp()
   where id = true;

  return jsonb_build_object('ok', true, 'lema', v_lema);
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Cambiar la portada
-- ---------------------------------------------------------------------
create or replace function public.branding_set_portada(p_key text, p_data text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_data     text;
  v_bytes    bytea;
  v_tamano   int;
  const_max  constant int := 524288;   -- 512 KB de imagen, de sobra para una portada
begin
  perform public.assert_master_key(p_key);

  v_data := btrim(coalesce(p_data, ''));

  -- El prefijo «data:image/webp;base64,» se acepta y se descarta: es lo que
  -- produce el navegador al leer el lienzo, y obligar a quitarlo en el cliente
  -- solo agrega un punto donde equivocarse.
  v_data := regexp_replace(v_data, '^data:image/\w+;base64,', '');

  if v_data = '' then
    raise exception 'imagen_vacia' using errcode = 'P0001';
  end if;

  -- El tope se revisa sobre el texto ANTES de decodificar: decodificar medio
  -- mega para después rechazarlo es trabajo tirado, y el texto es más grande
  -- que su contenido (4 caracteres por cada 3 bytes).
  if length(v_data) > ((const_max + 2) / 3) * 4 + 8 then
    raise exception 'imagen_muy_grande' using errcode = 'P0001';
  end if;

  -- Base64 mal formado: se avisa con un nombre claro en vez de dejar salir el
  -- error crudo de `decode`, que no le dice nada a nadie.
  begin
    v_bytes := decode(v_data, 'base64');
  exception when others then
    raise exception 'imagen_invalida' using errcode = 'P0001';
  end;

  v_tamano := length(v_bytes);

  if v_tamano < 16 then
    raise exception 'imagen_invalida' using errcode = 'P0001';
  end if;

  -- Cabecera de un webp: «RIFF» + 4 bytes de tamaño + «WEBP».
  -- Se comprueba sobre los bytes. Confiar en lo que dijo el cliente sobre su
  -- propio archivo es exactamente lo que no se hace.
  if substring(v_bytes from 1 for 4) <> 'RIFF'::bytea
     or substring(v_bytes from 9 for 4) <> 'WEBP'::bytea then
    raise exception 'imagen_no_webp' using errcode = 'P0001';
  end if;

  update public.branding
     set portada = v_data,
         portada_bytes = v_tamano,
         updated_at = clock_timestamp()
   where id = true;

  return jsonb_build_object('ok', true, 'portada_bytes', v_tamano);
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Permisos
-- ---------------------------------------------------------------------
-- La lectura es pública: el menú se dibuja antes de que nadie escriba una
-- clave, y la portada no es un secreto.
grant execute on function public.branding_get() to anon, authenticated;

-- Las de escritura también se exponen a `anon`, porque la app entra con la
-- clave anónima y es `assert_master_key` quien autoriza de verdad. Sin la
-- clave correcta las dos funciones lanzan error y no escriben nada.
grant execute on function public.branding_set_lema(text, text) to anon, authenticated;
grant execute on function public.branding_set_portada(text, text) to anon, authenticated;
