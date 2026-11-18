# AGENTS.md — Desafío Bíblico

Concurso de preguntas bíblicas. PWA sin dependencias: HTML, CSS y JavaScript
sueltos, módulos ES, sin compilación y sin `package.json`.

- **Publicado:** https://lokeraar.github.io/desafio-biblico/
- **Código:** `/storage/emulated/0/Download/Proyectos/Desafío-Bíblico`
- **Backend:** Supabase, proyecto `xodghdateldeobuumhyd`
- **Detalle técnico y lecciones:** `NOTES.md`

---

## Publicar

```bash
publicar "Mensaje del commit"
```

`publicar` es un comando **general** (vive en `~/.local/bin/`), no de este
proyecto: sirve para cualquier repositorio, resuelve la raíz con `git` y
funciona desde cualquier directorio o subdirectorio. Hace commit, push y
verificación contra el remoto real.

No hay que repetir aquí por qué está escrito así, ni cuáles fueron los
tropiezos: está en la regla general, `agent/rules/operacion-repetida.md`,
que se carga en toda sesión.

Lo específico de este proyecto va en `scripts/al-publicar.sh`, que el comando
general llama solo tras un push verificado. Aquí: comprobar que GitHub Pages
sirva de verdad el archivo nuevo, por **bytes** y no buscando una cadena.
Subir a `main` **es** publicar: este repositorio no tiene flujo de trabajo.

Si el `push` falla y solo hay que reintentar el envío, la ruta tiene que ir
**literal** (el guardia de entrega lee el texto del comando):

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
