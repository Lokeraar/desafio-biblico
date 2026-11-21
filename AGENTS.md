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
bash scripts/probar.sh          # todo: 536 de JavaScript + 158 de SQL
bash scripts/probar.sh --js     # solo JavaScript (no necesita Postgres)
bash scripts/probar.sh --sql    # solo SQL
```

Sale con código 0 **solo si todo pasó**, y cuando una suite falla nombra cuál
y muestra sus líneas `FALLA`. No hay que correr las ocho suites a mano ni
interpretar ocho salidas distintas.

### Trampa: `--sql` NO reaplica las migraciones

`probar.sh --sql` corre `smoke.sql` contra la base `limpia` **tal como está**.
Si acabas de escribir una migración y no la aplicaste, las pruebas corren
contra el esquema viejo y dan verde: verde sobre código que no es el tuyo.

Pasó el 19/11/2026 y costó veinte minutos persiguiendo un error en un archivo
que ya estaba bien.

Antes de creer un verde de SQL, reconstruir la base:

```bash
bash scripts/probar-sql-limpio.sh   # borra `limpia`, crea y aplica TODO
bash scripts/probar.sh --sql        # ahora sí prueba el esquema real
```

Sale con código 1 y nombra el archivo si una migración falla.

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

## NUNCA pedirle al usuario que compruebe visualmente

**Regla dura, declarada por Christian el 20/11/2026.** Ningún cambio visual se
cierra pidiéndole que mire el teléfono y diga si se ve bien. Si cambias algo
que se ve, **lo muestras tú** en el canvas: el estado de antes y el de después,
lado a lado o uno debajo del otro, con los números medidos al lado.

Importa porque ya pasó: se le pidieron ocho verificaciones visuales seguidas
y él no puede ver las dos versiones a la vez. Comparar de memoria dos pantallas
que ya no están en la pantalla es imposible, y el resultado fue una ronda
tras otra de «sigue mal» y «ahora sí» sobre cosas que yo podía haber mostrado
en un solo archivo.

**Cómo se hace:**

1. Guardar el CSS y el componente de antes (`git show HEAD:styles.css`) y el
   de después en dos carpetas bajo `.shots/` o en `design/`.
2. Una página con los dos lados y el mismo contenido, con un rótulo
   **ANTES** y otro **DESPUÉS** que se lean sin lugar a dudas.
3. Los números medidos al lado de cada uno: ancho, tamaño de letra, si se sale
   de su caja. Un número convence más que una opinión.
4. Abrirlo con `gentle_design` (o el servidor local) y **capturarlo** para
   confirmar que se ve antes de decírselo.

Lo que sí se le pide es una **decisión**, no una comprobación: dos o tres
opciones con su vista previa, por `ask_user_question`.

---

## Ajuste de texto: los versículos SIEMPRE en 2 + 1

**Regla dura, declarada por Christian el 20/11/2026.** Todo texto que muestre
un versículo se ajusta con **capacidad 2 renglones + 1 de gracia**. Sin
excepciones, en cualquier pantalla: juego, administración, editor, televisor.

Vale para el texto completo del versículo, para la vista previa del editor y
para el texto con huecos de la lista de versículos. La razón es de lectura, no
estética: un versículo parte en dos renglones casi siempre, y forzarlo a uno
solo obliga al ajustador a bajarlo al suelo de 8 pt, donde se adivina en vez
de leerse.

**El resto del texto de la interfaz va en 1 + 1.** Una fila que ocupa dos
renglones empuja a su hermana y la lista deja de leerse como lista.

**Dónde se declara: en un solo sitio, `ROLES` de `src/lib/ajuste.js`.** No en
el CSS y no en la hoja de cada componente. La capacidad es una decisión de
diseño y se escribe una vez, visible:

```js
{ sel: '.jugador-versiculo .versiculo, .cuerpo-tv .versiculo',
  categoria: 'titulo', renglones: 2 },        // 2 + 1
{ sel: '.texto-versiculo', categoria: 'contenido', renglones: 2 },  // 2 + 1
```

Trampas que ya costaron tiempo aquí:

- **`white-space: nowrap` es obligatorio** en el texto que se ajusta. Con la
  etiqueta partida en dos renglones, el ajustador mira la altura y nunca ve que
  sobra ancho, así que declara «cabe» y el texto se sale de su caja.
- **La prueba de desborde tiene que ser sobre el texto, no sobre la caja.**
  `scrollWidth > clientWidth` en el botón no ve nada cuando el texto desborda
  la caja con `overflow: visible`: los dos miden lo mismo y el texto se pinta
  encima del vecino. Se mide con `Range` sobre el contenido.
- **`font-size: inherit` en los hijos.** Un `clamp()` con suelo en `rem` dentro
  de un texto ajustado no encoge con su padre y acaba más grande que el texto
  al que pertenece.
- **`container-type` y `fit-content` no pueden convivir** en la misma caja.

Detalle completo de la metodología: skill `text-fitting`.

---

## Sin scroll: cuándo sí y cuándo no

**Regla dura, declarada por Christian el 21/11/2026.** La prohibición de scroll
no es absoluta. Él lo dijo así: «la limitación de no usar scroll va para textos
que podrían fácilmente caber en las dimensiones acordadas, pero si el contenido
ya de verdad es muy largo, entonces sí tiene permitido usar scroll».

Dicho de otro modo, la pregunta no es «¿hay scroll?» sino **«¿este contenido
podría haber cabido y no cabe por cómo lo maqueté?»**:

| Contenido | Scroll | Qué se hace |
|---|---|---|
| Fijo y corto: un versículo, un formulario, un botón, un aviso | **No** | Se ajusta la letra, se aprieta el relleno, se reparte en columnas. Si aun así no cabe, es un defecto de maquetación. |
| Crece con los datos: lista de temas, de preguntas, de versículos | **Sí** | La lista se desplaza **dentro de su caja**. Lo incorrecto aquí es que el contenedor crezca y empuje el resto. |

Un cero de scroll conseguido escondiendo texto (`display: none`) o recortándolo
no cuenta: es peor que el scroll, porque pierde información en silencio.

---

## Supabase

La API de administración se usa con `POST
https://api.supabase.com/v1/projects/xodghdateldeobuumhyd/database/query` y
cabecera `Authorization: Bearer $SUPABASE_ACCESS_TOKEN`. Respuesta `[]` =
éxito.

El helper `bash .logs/sql.sh archivo.sql` envía un archivo y muestra el
resultado. `.logs/` está en `.gitignore`, así que si se limpia hay que
recrearlo. Su contenido, completo:

```bash
#!/usr/bin/env bash
set -euo pipefail
TOKEN="${SUPABASE_ACCESS_TOKEN:?falta SUPABASE_ACCESS_TOKEN}"
REF="xodghdateldeobuumhyd"
Q=$(python3 -c 'import json,sys; print(json.dumps({"query": open(sys.argv[1]).read()}))' "$1")
curl -sS -m 120 -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$Q"
echo
```

Se invoca con `bash`, nunca directo: el almacenamiento compartido no conserva
el bit de ejecución (ver la regla general de operaciones repetidas).

**Regla dura:** nunca `/tmp`. Todo temporal va en `./.logs/`.

---

## Al terminar una sesión

- Verificar que el trabajo quedó en disco y no solo en la conversación:
  `git -C <raíz> status --short --branch`.
- Recordar al usuario **revocar el token** de Supabase si lo pegó en el chat.
- No afirmar que algo funciona sin la salida real del comando que lo prueba.
