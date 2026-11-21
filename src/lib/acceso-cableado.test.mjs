/* Prueba del CABLEADO de «acceso» dentro de la app.

   POR QUE EXISTE ESTA PRUEBA, aparte de acceso.test.mjs
   -----------------------------------------------------
   `acceso.js` tuvo 28 pruebas en verde durante horas mientras NINGUNA parte
   de la app lo llamaba. La puerta estaba bien escrita y abierta de par en
   par: un verde sobre codigo que nadie usa.

   Es la forma de prueba que miente descrita en agent/rules/prueba-que-miente:
   la prueba medía el modulo aislado, no lo que la app hace. Asi que esta
   prueba NO prueba el modulo: lee `src/app.js` y comprueba que la llamada
   esta escrita de verdad.

   DOS TRAMPAS QUE EVITA
   ---------------------
   1. Buscar el texto `puedeIrA` a secas lo encuentra tambien en un comentario
      que explique la idea. Se quitarian las llamadas y el verde seguiria. Por
      eso se leen los comentarios FUERA antes de buscar.
   2. Un `app.js` que no se pudo leer tambien da cero coincidencias. Si el
      archivo falta o queda vacio, la prueba FALLA; no se lee como «nada que
      reclamar».
*/
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let ok = 0, fail = 0;
const t = (c, m) => { if (c) { ok++; console.log('  ok   ' + m); } else { fail++; console.log('  FALLA ' + m); } };

const aqui = dirname(fileURLToPath(import.meta.url));
const APP = join(aqui, '..', 'app.js');

/**
 * Quita comentarios y deja solo codigo.
 *
 * Respeta las cadenas de texto para no cortar una URL en `//` —`app.js` tiene
 * `https://...` en varias partes— ni una comilla dentro de un comentario.
 * Es un analizador pequeño, pero suficiente y honesto: si se equivoca, se
 * equivoca hacia CONSERVAR texto, y entonces una prueba de presencia puede dar
 * un falso verde. Por eso las comprobaciones no buscan palabras sueltas sino
 * la forma completa de la llamada.
 */
function soloCodigo(fuente) {
  let fuera = '';
  let i = 0;
  while (i < fuente.length) {
    const dos = fuente.slice(i, i + 2);
    const uno = fuente[i];
    if (dos === '/*') {
      const fin = fuente.indexOf('*/', i + 2);
      i = fin === -1 ? fuente.length : fin + 2;
      fuera += ' ';
      continue;
    }
    if (dos === '//') {
      const fin = fuente.indexOf('\n', i);
      i = fin === -1 ? fuente.length : fin;
      continue;
    }
    if (uno === '"' || uno === "'" || uno === '`') {
      const cierre = uno;
      fuera += uno;
      i++;
      while (i < fuente.length) {
        if (fuente[i] === '\\') { fuera += fuente.slice(i, i + 2); i += 2; continue; }
        fuera += fuente[i];
        if (fuente[i] === cierre) { i++; break; }
        i++;
      }
      continue;
    }
    fuera += uno;
    i++;
  }
  return fuera;
}

let fuente = '';
try {
  fuente = readFileSync(APP, 'utf8');
} catch {
  fuente = '';
}

console.log('=== acceso: el cableado dentro de app.js ===');

// Una medición vacía NO es «0 problemas»: es una medición que no se hizo.
t(fuente.length > 10000, `app.js se pudo leer (${fuente.length} bytes)`);

const codigo = soloCodigo(fuente);

/* La prueba se prueba a si misma: si el quitacomentarios no quitara nada, las
   comprobaciones de abajo pasarian con solo dejar el texto en un comentario. */
t(soloCodigo('// puedeIrA(x)\nconst a = 1;').includes('puedeIrA') === false,
  'el quitacomentarios borra de verdad un comentario de linea');
t(soloCodigo('/* puedeIrA(x) */\nconst a = 1;').includes('puedeIrA') === false,
  'y tambien borra un comentario de bloque');
t(soloCodigo('const u = "https://x"; puedeIrA(y);').includes('puedeIrA'),
  'pero no confunde las // de una URL con un comentario');

// 1. El modulo se importa.
t(/import\s*\{[^}]*puedeEntrar[^}]*\}\s*from\s*['"]\.\/lib\/acceso\.js['"]/.test(codigo),
  'app.js importa puedeEntrar de ./lib/acceso.js');

// 2. Hay una funcion que delega la decision en el modulo. Si se quitara,
//    la puerta volveria a decidirse a mano y podria divergir de la regla.
/* El limite de caracteres no puede ser apretado: un comentario nuevo dentro
   de la funcion lo desborda y la prueba falla por SU forma, no porque la
   llamada se haya ido. Se corta en la llave que CIERRA la funcion. */
t(/function\s+puedeIrA\s*\(\s*vista\s*\)\s*\{[\s\S]*?\n\}/.test(codigo)
  && /function\s+puedeIrA\s*\(\s*vista\s*\)\s*\{[\s\S]*?puedeEntrar\s*\([^)]*\)\s*;?\s*\n\}/.test(codigo),
  'puedeIrA() delega en puedeEntrar() en vez de repetir la regla');

// 3. El guardia esta en render(), que es por donde pasan TODAS las vistas,
//    incluidas las que llegan por URL escrita a mano.
t(/if\s*\(\s*!\s*puedeIrA\s*\(\s*vista\s*\)/.test(codigo),
  'render() baja a menu cuando la vista no se puede abrir');

// 4. La vista pedida se recuerda para llevarla alli despues de acertar.
t(/app\.vistaPendiente\s*=\s*vista/.test(codigo),
  'el guardia recuerda a donde se queria ir');

// 5. Y despues de acertar la clave, se navega de verdad.
t(/if\s*\(\s*para\s*===\s*'acceso'\s*\)/.test(codigo),
  'el modal tiene su rama para la puerta');
t(/if\s*\(\s*para\s*===\s*'acceso'\s*\)[\s\S]{0,300}?ir\s*\(\s*destino\s*\)/.test(codigo),
  'al acertar la clave se entra a la vista pendiente');

// 6. Sin clave, lo del presentador NO se dibuja. Se comprueba que el boton
//    del panel este CONDICIONADO, no suelto.
t(/\$\{\s*puedeIrA\(\s*'host'\s*\)\s*\?\s*`<button[^`]*data-ir="host"/.test(codigo),
  'el boton «Soy presentador» solo se dibuja si puedeIrA(host)');
t(/\$\{\s*hayNube\s*&&[^}]*puedeIrA\(\s*'config'\s*\)\s*\?\s*`<button[^`]*data-ir="config"/.test(codigo),
  'el boton «Configuraciones» solo se dibuja si hay nube y puedeIrA(config)');

// 7. Pero queda UNA puerta visible, o nadie podria autenticarse nunca.
t(/data-accion="pedir-acceso"/.test(codigo),
  'hay una puerta visible sin clave (data-accion="pedir-acceso")');

/* 7 bis. Y hay un tercer estado: SIN ninguna clave configurada no se pide
   clave, se va a crearla. Si el menu dibujara «Entrar como presentador»
   cuando no hay clave, la persona teclearia una clave que no existe y no
   habria forma de acertar: la app se quedaria sin entrada en su primer
   arranque. Es el mismo defecto que la base ya corrigio en
   `20261118000001_clave_inicial.sql`. */
t(/app\.claveConfigurada\s*===\s*false/.test(codigo),
  'el menu distingue «sin clave configurada» de «sin verificar»');
t(/if\s*\(\s*app\.claveConfigurada\s*===\s*false\s*\)\s*\{\s*ir\(\s*'config'\s*\)/.test(codigo),
  'sin clave configurada la puerta lleva a configuraciones, no pide clave');
/* Y el boton de crear la clave es la RAMA del caso «no hay clave», no un
   boton suelto. Se comprueba la forma `condicion ? boton`, que es la que
   garantiza que solo se dibuja en ese estado. */
t(/claveConfigurada\s*===\s*false\s*\?\s*`<button[^`]*data-ir="config"[\s\S]{0,120}?Crear la clave/.test(codigo),
  'sin clave configurada el boton lleva a configuraciones y dice «Crear la clave»');

// 8. Y esa accion existe de verdad en el manejador, no solo en el marcado.
t(/case\s+'pedir-acceso'\s*:/.test(codigo),
  'la accion pedir-acceso esta implementada, no solo dibujada');

// 9. Se pregunta al servidor si hay clave, una sola vez.
t(/admin\.estadoClave\s*\(/.test(codigo),
  'se consulta admin.estadoClave() para saber si hay clave');
t(/if\s*\(\s*hayNube\s*&&\s*!\s*app\.clavePreguntada\s*\)/.test(codigo),
  'la consulta lleva bandera para no repetirse en cada render');

// 10. Configuraciones recibe si hay CLAVE, no si hay nube. Pasaba `hayNube`,
//     y la pantalla ofrecia «Establecer» donde debia decir «Cambiar».
t(/vistaConfig\(\s*\{\s*hayClave:\s*app\.claveConfigurada\s*===\s*true\s*\}\s*\)/.test(codigo),
  'vistaConfig recibe hayClave del servidor, no hayNube');

/* 11. CERRAR LA PUERTA TIENE QUE DEJAR SALIR.
    Si se llego con `#/host` escrito a mano, el hash sigue siendo `#/host`
    aunque la pantalla muestre el menu. Al cancelar el modal, render() volvia a
    ver `#/host`, volvia a bloquear y volvia a abrir el modal: «Cancelar» no
    hacia nada y la app se quedaba sin salida. */
t(/case\s+'cerrar-admin'[\s\S]{0,900}?vistaPendiente/.test(codigo),
  'cerrar el modal de la puerta limpia la vista pendiente y no la reabre');

// 12. El modal tiene su propio texto; sin el, cae en el generico de «entrar».
const ADMIN_UI = join(aqui, 'admin-ui.js');
let ui = '';
try { ui = readFileSync(ADMIN_UI, 'utf8'); } catch { ui = ''; }
t(ui.length > 1000, `admin-ui.js se pudo leer (${ui.length} bytes)`);
t(/\bacceso:\s*\{/.test(ui),
  'el modal de la puerta tiene su texto propio, no el generico');

/* 13. EL MODO LOCAL NO SE PUEDE CERRAR.
    Sin Supabase no hay clave que comprobar: si la puerta se aplicara igual,
    el panel del presentador quedaria inaccesible para siempre en el modo
    local. La clave vive en el servidor; sin servidor, manda el modo local. */
t(/function\s+puedeIrA[\s\S]{0,700}?if\s*\(\s*!\s*hayNube\s*\)\s*return\s+true/.test(codigo),
  'sin nube la puerta no se aplica: el modo local conserva su panel');

console.log(`\nRESULTADO: ${ok} correctas, ${fail} fallas`);
if (fail) process.exit(1);
