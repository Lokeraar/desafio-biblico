# AGENTS.md — Desafío Bíblico

Concurso de preguntas bíblicas. PWA sin dependencias: HTML, CSS y JavaScript
sueltos, módulos ES, sin compilación y sin `package.json`.

- **Publicado:** https://lokeraar.github.io/desafio-biblico/
- **Código:** `/storage/emulated/0/Download/Proyectos/Desafío-Bíblico`
- **Backend:** Supabase, proyecto `xodghdateldeobuumhyd`
- **Detalle técnico y lecciones:** `NOTES.md`

---

## Publicar: usa el script, no lo hagas a mano

```bash
bash scripts/publicar.sh "Mensaje del commit"
```

Hace commit, push y verificación contra el remoto real en un solo paso.
Desde cualquier directorio funciona igual.

**No uses otra forma.** Estas dos cosas se rompían en cada entrega y ya están
resueltas dentro del script:

1. **El `cd` a mitad de comando.** Una sesión que arranca en otro directorio,
   o un `cd` que falla, deja el resto del comando corriendo en el lugar
   equivocado: `git` no encuentra el repositorio y el commit no ocurre. El
   script usa `git -C` con **ruta absoluta**, nunca `cd`.
2. **El guardia de entrega**, que rechaza `push` cuando el repositorio no se
   puede resolver desde el directorio actual. Se resuelve igual: `git -C` con
   ruta absoluta.

Otras cosas que el script ya maneja y no hace falta repetir a mano:

- Si no hay cambios, avisa y termina **sin error**.
- El trabajo se hace **antes** de imprimir el resumen: cortar la salida (por
  ejemplo con `| head`) no deja el commit a medias.
- Verifica contra el remoto de verdad (`git ls-remote`), no contra
  `origin/main` local, que el propio `push` ya actualizó.
- Después de subir, comprueba que GitHub Pages sirva el archivo por bytes.
  Subir a `main` **es** publicar: no hay flujo de trabajo.

Para publicar en otro momento solo el envío, tras un push fallido:

```bash
git -C /storage/emulated/0/Download/Proyectos/Desafío-Bíblico push origin main
```

---

## Antes de dar algo por terminado

```bash
bash scripts/probar.sh          # todo: 328 de JavaScript + 67 de SQL
bash scripts/probar.sh --js     # solo JavaScript (no necesita Postgres)
bash scripts/probar.sh --sql    # solo SQL
```

Sale con código 0 **solo si todo pasó**, y cuando una suite falla nombra cuál
y muestra sus líneas `FALLA`. No hay que correr las ocho suites a mano ni
interpretar ocho salidas distintas.

Si el Postgres local no está levantado, la parte de SQL se **omite** con su
instrucción para levantarlo, en vez de reportarse como fallo: confundir «no
probado» con «falló» hace perseguir un error que no existe.

El Postgres local vive en `~/.cache/desafio-pg` (el almacenamiento compartido
no deja que Postgres sea dueño de su propio directorio). Se cae con los
reinicios del equipo:

```bash
pg_ctl -D "$HOME/.cache/desafio-pg" -l /dev/null \
  -o "-k /data/data/com.termux/files/usr/var/run" -w start
```

Base local lista para probar, desde cero:

```bash
psql -h /data/data/com.termux/files/usr/var/run -U postgres -d postgres -c "create database limpia;"
P='psql -h /data/data/com.termux/files/usr/var/run -U postgres -d limpia -q'
$P -c "create schema if not exists extensions;"
$P -f supabase/tests/_supabase_shim.sql
for f in supabase/migrations/*.sql; do $P -v ON_ERROR_STOP=1 -f "$f"; done
```

Las migraciones se aplican en orden y son idempotentes: reaplicarlas no
retrocede datos de salas vivas.

---

## Supabase

La API de administración se usa con `POST
https://api.supabase.com/v1/projects/xodghdateldeobuumhyd/database/query` y
cabecera `Authorization: Bearer $SUPABASE_ACCESS_TOKEN`. Respuesta `[]` =
éxito.

El helper `bash .logs/sql.sh archivo.sql` envía un archivo y muestra el
resultado. `.logs/` está en `.gitignore`: si se limpia, hay que recrear el
helper (está documentado en `NOTES.md`).

**Regla dura:** nunca `/tmp`. Todo temporal va en `./.logs/`.

---

## Al terminar una sesión

- Verificar que el trabajo quedó en disco y no solo en la conversación:
  `git -C <raíz> status --short --branch`.
- Recordar al usuario **revocar el token** de Supabase si lo pegó en el chat.
- No afirmar que algo funciona sin la salida real del comando que lo prueba.
