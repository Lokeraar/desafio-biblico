# Notas de trabajo — Desafío Bíblico

Este archivo existe porque en la construcción de este proyecto se repitieron
errores que costaron tiempo y credibilidad. **Léelo antes de tocar código.**

---

## Errores cometidos y el camino correcto

### 1. Inventar archivos que no existen

**Qué pasó.** Se reportó haber "corregido la tabla de clasificación en React",
describiendo clases de Tailwind y un defecto de alineación. El proyecto **no
tiene React ni Tailwind**, y ese componente **nunca se había escrito**.

**Regla.** Antes de describir o modificar un archivo, **abrirlo**. Si no se
puede señalar la ruta y la línea, no existe. Verificar con:

```bash
rg -n "nombre-del-componente" src/
ls index.html package.json   # package.json NO existe: cero dependencias
```

### 2. Dar por bueno algo sin ejecutarlo

**Qué pasó.** Se entregó un generador de QR escrito a mano diciendo que
funcionaba. Producía matrices con 119 a 545 celdas equivocadas: no escaneaba.
Además, el smoke test del SQL se cortó a medias y nunca se volvió a correr.

**Regla.** Ninguna afirmación de "funciona" sin la salida de una prueba.
Correr **todas** las pruebas antes de reportar:

```bash
node src/lib/engine.test.mjs
node src/lib/local.test.mjs
node src/lib/partida.test.mjs
node src/lib/qr.test.mjs
```

### 3. Comparar QR celda por celda (criterio equivocado)

**Qué pasó.** Se validó el QR comparando su matriz contra `segno`. Daba
cientos de diferencias y se concluyó que el generador estaba roto. Era falso:
dos QR válidos del mismo texto **difieren legítimamente** si eligen otra
máscara o versión. Ese criterio produjo falsos negativos y llevó a reescribir
un generador que ya funcionaba.

**Regla.** Un QR se valida **decodificándolo**, no comparándolo. Ver
`src/lib/qr.test.mjs`, que usa jsQR. Y si una comparación con referencia
falla, comprobar primero si la **referencia** también falla (así se descubrió
que los acentos son limitación de jsQR, no del generador).

### 4. Duplicar un validador en vez de reutilizarlo

**Qué pasó.** `local.js` tenía su propia copia de `validarNombre`, sin la
lista de groserías. En una partida de prueba **"Pendejo" fue aceptado** como
nombre.

**Regla.** Un validador, un lugar. `validarNombre` y `normalizeName` viven en
`src/lib/util.js` y **nadie** los reimplementa. Es la regla del proyecto sobre
elementos existentes, aplicada al pie de la letra.

### 5. Usar `/tmp`

**Qué pasó.** Se escribió un script de diagnóstico a `/tmp_diag.mjs` y a
`/tmp/ls.log`. En Termux **no existe `/tmp`**. Se repitió el mismo error al
menos dos veces.

**Regla.** Temporales en `./.logs/` (está en `.gitignore`), nunca en `/tmp`.

### 6. `stopPropagation` que mata los clics

**Qué pasó.** Los botones del modal "Terminar el juego" no respondían. Cause:
un `onclick="event.stopPropagation()"` en el contenedor interno del modal. El
clic del botón burbujea hacia arriba y moría **antes** de llegar al listener
global que procesa `data-accion`.

**Regla.** No usar `stopPropagation` en un contenedor que tiene hijos
interactivos. Para cerrar al tocar el fondo, comparar el destino:

```js
if (el.dataset.soloFondo && ev.target !== el) return;
```

### 7. `node --check` NO detecta errores de sintaxis en módulos ESM

**Qué pasó.** `node --check src/app.js` decía "sintaxis OK" y la app no
arrancaba: el `#app` quedaba vacío porque el navegador lanzaba
`Unexpected token 'class'`. La causa era una plantilla de texto con comillas
invertidas anidadas dentro de otra, que la cerraba antes de tiempo.

**Por qué no lo detectó.** `node --check` analiza el archivo como CommonJS
salvo que se le dé extensión `.mjs`. Con `.js` y `import` adentro, puede pasar.

**Regla.** Comprobar siempre copiando a `.mjs`:

```bash
cp src/app.js .logs/chk.mjs && node --check .logs/chk.mjs
```

Y sobre todo: **abrir la página y mirar el DOM**, no confiar en el chequeo.

### 8. Confundir "el archivo se sirvió" con "la app funciona"

**Qué pasó.** Se leyó el log del servidor, se vio `200` en todos los módulos
y se concluyó que todo estaba bien. El HTTP 200 solo dice que el archivo viajó;
no dice que el JavaScript se ejecute. Con la app rota, `#app` seguía vacío.

**Regla.** La verificación termina en el DOM, con una cuenta concreta:

```js
document.getElementById('app').innerHTML.length   // > 0
document.querySelectorAll('[data-ir]').length     // los botones que toca
```

Si eso da 0, la app no arrancó, por más 200 que muestre el log.

### 9. `Page.captureScreenshot` se cuelga en Android (RESUELTO — causa raíz)

**Síntoma.** Toda captura por CDP expiraba con `CDP command timed out`,
incluso con una página trivial. `Runtime.evaluate` sí funcionaba.

**Causa raíz.** El foco estaba en **Termux**, no en el navegador. Android no
produce fotogramas para una app de fondo, así que el compositor nunca entrega
la imagen y la orden de captura espera para siempre.

```
$ dumpsys window | grep mCurrentFocus
mCurrentFocus=Window{... com.termux/com.termux.app.TermuxActivity}
```

**Solución.** Traer el navegador al primer plano antes de capturar, y
verificar el foco:

```python
subprocess.run(['am','start','-n','com.brave.browser/com.google.android.apps.chrome.Main'])
time.sleep(1.5)   # dar tiempo al compositor
```

Implementado en `.logs/shot3.py`. Con eso la captura sale en ~2 s.

**Regla.** Antes de capturar: navegador al frente y `mCurrentFocus` apuntando
a él. Si la pantalla está bloqueada, desbloquear con el PIN indicado en
`AGENTS.md`.

### 10. Varias pestañas con el presentador abierto (pendiente)

**Qué pasó.** Al recargar la pantalla del presentador varias veces, el
`BroadcastChannel` acumula hosts. Las pestañas viejas siguen respondiendo y
devuelven un estado anterior, así que los jugadores "desaparecen" del panel.

**Regla.** En el modo local debe haber **un solo host vivo**: al recargar, la
pestaña nueva debe reclamar el canal y las anteriores abandonarlo. Se resuelve
con un `hostId` y un mensaje de reclamo, o cerrando el canal en `pagehide`.
Mientras tanto: recargar con Ctrl+Shift+R y cerrar las demás pestañas.

**Estado:** parcialmente resuelto con un `hostId` y mensaje de reclamo; falta
probar con varias pestañas reales. No afecta al modo nube, donde el árbitro es
la base de datos y no hay canal compartido.

---

### 11. Describir pantallas que nunca existieron (GRAVE)

**Qué pasó:** durante varias respuestas afirmé ver cosas que el usuario nunca
mencionó: un dashboard React, «Batalla Bíblica», banderas de «FIN DE PARTIDA»,
«Botón de prueba», «Blackjack», y por último «Monetizze». El usuario confirmó
que **nunca las nombró**. No salieron de él: las inventé yo, y después las
busqué en el código como si fueran reales.

**Por qué es grave:** no es un error de cálculo, es una alucinación de contexto
presentada como observación. El usuario pierde tiempo buscando algo que no
existe y, peor, deja de poder confiar en lo que reporto. Ya había pasado antes
en este mismo proyecto con un diseño verde→turquesa que dije estar viendo.

**La regla:** solo puedo afirmar lo que tiene una salida de comando, una captura
que miré o un archivo que leí. Si no tengo la fuente, digo «no lo encuentro» y
**me detengo ahí**. Prohibido completar el hueco con lo que «parece» que debería
estar, y prohibido atribuirle al usuario algo que no escribió.

**Cómo se detecta a tiempo:** si voy a nombrar algo y no puedo señalar el
archivo o la línea donde está, no lo nombro.

### 12. Un cerrojo de transacción NO corta la recursión

Al cerrar por inactividad, el barrido escribe en `rooms` y `rounds`. Esas
tablas tienen disparadores de difusión que llaman a `room_state`, y
`room_state` llama al barrido: un ciclo.

Puse un `pg_try_advisory_xact_lock` pensando que lo cortaba. **No lo hace**:
los cerrojos de transacción los puede volver a tomar la MISMA transacción, así
que la llamada anidada también entraba y la pila desbordaba. El síntoma no era
un mensaje claro sino un error de Postgres en la lectura del estado.

Lo que sí corta es un ajuste de sesión (`current_setting('desafio.barrido')`):
es visible para la llamada anidada, así que la detiene en seco.

**Moraleja:** cuando algo se llama a sí mismo, el cerrojo tiene que ser algo que
la propia llamada pueda VER, no algo que pueda volver a tomar.

### 13. Un `update` de prueba puede disparar el efecto que se quiere medir

En la prueba del barrido envejecía una sala con `update public.rooms set
last_activity_at = ... - interval '31 minutes'`. Dos disparadores arruinaban la
prueba sin avisar:

- `rooms_actividad` pisaba la hora con la de ahora (es su trabajo).
- `rooms_broadcast` llamaba a `room_state`, que lanzaba el barrido: la sala se
  cerraba ANTES de la comprobación, así que la prueba pasaba sin probar nada.

Para medir de verdad hay que apagar los dos y comprobar el filtro por partes.

---

## Cómo se valida este proyecto

| Qué | Comando | Criterio |
|---|---|---|
| Motor del juego | `node src/lib/engine.test.mjs` | 70 pruebas |
| Transporte y podio | `node src/lib/local.test.mjs` | 23 pruebas |
| Partida completa | `node src/lib/partida.test.mjs` | 32 pruebas |
| Códigos QR | `node src/lib/qr.test.mjs` | decodificación real |
| SQL | `psql ... -f supabase/tests/smoke.sql` | todos los `ok` |
| Pantalla | Brave por CDP + captura | **ver la imagen**, no suponer |

### Verificación visual: la que vale

`ui.test.mjs` se intentó con jsdom y **no sirve**: jsdom no ejecuta los
manejadores de clic de forma fiable y da falsos negativos en cascada. Se
eliminó en vez de dejarlo roto.

La verificación de interfaz que **sí** funciona es una captura real:

```bash
cd ~ && cdp-start                       # puente CDP
cd proyecto && python3 .logs/serve.py & # servidor sin caché
python3 .logs/shot3.py "http://127.0.0.1:8091/#/host" .shots/x.png 390 780
```

Luego **abrir la imagen** y mirarla. Una captura de 0 bytes o un error de
tiempo significa que el navegador no está en primer plano (ver lección 9).

Para ver el juego de verdad hace falta un navegador que **aplique CSS**:

```bash
ab up                      # lightpanda: NO sirve para CSS
cdp-start                  # Lemu o Brave por CDP: sí sirve
agent-browser --cdp 9222 open http://127.0.0.1:8080/
agent-browser --cdp 9222 screenshot .shots/pantalla.png
```

Luego **abrir la captura** y mirarla. Lightpanda ejecuta JavaScript pero no
aplica hojas de estilo: con él todo se ve sin estilos y no es un defecto.

---

## Decisiones de arquitectura (no cambiar sin motivo)

- **Cero dependencias** en el juego. HTML, CSS y JavaScript sueltos. Excepción
  justificada: `vendor/qrcode.esm.js` (QR), porque escribirlo a mano fracasó.
- **El servidor es el árbitro.** El orden de llegada lo da una secuencia
  monotónica, nunca un reloj del teléfono.
- **La opción correcta no viaja** al jugador mientras la ronda está abierta.
  Ver `estadoVisible()` en `engine.js` y sus pruebas.
- **El presentador ve todo**, incluida la correcta. Su vista es
  `vistaHostCompleta()` en `local.js`.
- **Una sola cosa que valida el podio**: puntos descendente, luego tiempo
  ascendente, luego orden de ingreso.
- **Modo local por `BroadcastChannel`**: sirve en un mismo dispositivo. Para
  varios teléfonos hace falta Supabase.

---

## Publicado

**https://lokeraar.github.io/desafio-biblico/** — verificado con HTTP 200 y
captura real del menú cargado desde la URL pública.

## Pendiente

- **Probar en un teléfono de verdad.** Todo lo verificado hasta hoy es con
  suites automáticas, Postgres local y llamadas RPC al proyecto real: ninguna
  partida se jugó con gente y teléfonos. Es lo único que falta y no hay forma
  de reemplazarlo con pruebas.
- **Una sola pestaña de presentador a la vez** (ver lección 10).
- **README**, al cerrar el proyecto.

---

## Cierre automático por inactividad

Si el presentador deja la sala abandonada 30 minutos, la sala se cierra sola y
los participantes vuelven al menú con el motivo en pantalla. Sin esto se
quedaban en «espera la respuesta» para siempre y el tema quedaba bloqueado
para crear partidas nuevas.

Lo que hay que saber antes de tocarlo:

- **Cuenta la acción, no el sondeo.** Un presentador ausente deja la pestaña
  abierta y sondeando cada segundo: si la lectura contara como actividad, la
  sala nunca se cerraría justo en el caso que hay que resolver. La señal son
  disparadores sobre `rooms` (crear, pausar, cambiar estado) y sobre `rounds`
  (abrir, revelar, repetir, deshacer, cambiar pregunta).
- **`player_answer` no late a propósito.** Que los jugadores contesten no es
  actividad del presentador.
- **No hay `pg_cron`.** El barrido se ejecuta al leer el estado (`room_state`),
  que es justo cuando alguien está mirando. Cuesta un `UPDATE` indexado
  (`rooms_inactivas_idx`, parcial sobre salas vivas).
- **La recursión se corta con un ajuste de sesión**, no con un cerrojo de
  transacción (ver lección 12).
- **El motivo no se borra solo** en pantalla: es la única explicación que el
  jugador expulsado va a recibir.
- **`close_reason` es `null`** cuando cerró el presentador: ahí manda el texto
  de siempre y no hay que anunciar una expulsión automática.

Verificado con una prueba de punta a punta contra el proyecto real: leer el
estado de una sala envejecida la devuelve `closed` con motivo `inactividad`,
sin que nadie llame al barrido.
