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

### 9. Varias pestañas con el presentador abierto (pendiente)

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

## Cómo se valida este proyecto

| Qué | Comando | Criterio |
|---|---|---|
| Motor del juego | `node src/lib/engine.test.mjs` | 70 pruebas |
| Transporte y podio | `node src/lib/local.test.mjs` | 23 pruebas |
| Partida completa | `node src/lib/partida.test.mjs` | 32 pruebas |
| Códigos QR | `node src/lib/qr.test.mjs` | decodificación real |
| SQL | `psql ... -f supabase/tests/smoke.sql` | todos los `ok` |
| Pantalla | Brave por CDP | ver captura, no suponer |

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

## Pendiente

- Flujo de cuenta regresiva con arranque manual del presentador.
- Cierre automático al llegar a cero; el botón pasa a "Revelar respuesta".
- Verificar visualmente la tabla de clasificación.
- Correr el smoke test del SQL completo.
- Crear el proyecto de Supabase y publicar en GitHub Pages.
