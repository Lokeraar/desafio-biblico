/* =====================================================================
   Prueba del generador QR — por DECODIFICACIÓN, no por comparación.
   ---------------------------------------------------------------------
   LECCIÓN (leer antes de tocar esto):
   Comparar la matriz contra segno celda por celda es un criterio
   INCORRECTO. Dos QR válidos del mismo texto difieren legítimamente si
   eligen distinta máscara o distinta versión. Ese criterio produjo falsos
   negativos y llevó a reescribir un generador que ya funcionaba.

   El criterio correcto es uno solo: que un LECTOR REAL recupere el texto.
   Eso es lo que se comprueba aquí, con jsQR.
   ===================================================================== */
import { crearQR, qrSVG } from './qr.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jsQR = require('../../tests/jsQR.js');

let ok = 0, fail = 0;
const t = (c, m) => { if (c) { ok++; console.log('  ok   ' + m); } else { fail++; console.log('  FALLA ' + m); } };

/** Convierte la matriz a RGBA y la decodifica con jsQR. */
function decodificar(mod, escala = 6, margen = 4) {
  const size = mod.length;
  const lado = (size + margen * 2) * escala;
  const datos = new Uint8ClampedArray(lado * lado * 4).fill(255);

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!mod[r][c]) continue;
      for (let dy = 0; dy < escala; dy++) {
        for (let dx = 0; dx < escala; dx++) {
          const x = (c + margen) * escala + dx;
          const y = (r + margen) * escala + dy;
          const i = (y * lado + x) * 4;
          datos[i] = 0; datos[i + 1] = 0; datos[i + 2] = 0; datos[i + 3] = 255;
        }
      }
    }
  }

  const res = jsQR(datos, lado, lado);
  return res ? res.data : null;
}

const casos = [
  ['ABC12', 'L'],
  ['Q9BHX', 'M'],
  ['x', 'H'],
  ['desafio-biblico', 'Q'],
  ['http://127.0.0.1:8080/#/join?c=ABC12', 'M'],
  ['https://lokeraar.github.io/desafio-biblico/#/join?c=Q9BHX', 'L'],
  ['http://127.0.0.1:8080/#/join?c=ABC12', 'H'],
  ['https://ejemplo.com/ruta/larga/para/subir/de/version?a=1&b=2&c=3', 'M'],
  ['ABC-123_xyz~!@#$%^&*()', 'M']
];

console.log('=== Decodificación con un lector real (jsQR) ===');
for (const [texto, nivel] of casos) {
  const qr = crearQR(texto, { nivel });
  const leido = decodificar(qr.mod);
  const etiqueta = `${texto.slice(0, 34)}${texto.length > 34 ? '…' : ''} [${nivel}]`;
  t(leido === texto, `leído de vuelta${leido === texto ? '' : ' → ' + JSON.stringify(leido)} — ${etiqueta}`);
}

console.log('\n=== Acentos: limitación conocida, no defecto propio ===');
// Comprobado: la matriz de segno (referencia independiente) para texto
// acentuado TAMBIÉN devuelve vacío al leerla con jsQR. Es una limitación
// del lector, no del generador. La carga útil real (una URL de sala) es
// ASCII puro, así que no afecta al juego.
{
  const conAcento = crearQR('DESAFÍO BÍBLICO', { nivel: 'M' });
  t(conAcento.size > 0, 'genera la matriz con acentos sin lanzar error');
  const sinAcento = crearQR('DESAFIO BIBLICO', { nivel: 'M' });
  t(decodificar(sinAcento.mod) === 'DESAFIO BIBLICO', 'sin acentos se lee perfecto');
}

console.log('\n=== Los cuatro niveles de corrección ===');
for (const nivel of ['L', 'M', 'Q', 'H']) {
  const texto = 'http://127.0.0.1:8080/#/join?c=ABC12';
  const qr = crearQR(texto, { nivel });
  t(decodificar(qr.mod) === texto, `nivel ${nivel} se lee (${qr.size}x${qr.size})`);
}

console.log('\n=== Carga útil de una sala ===');
const url = 'http://127.0.0.1:8080/#/join?c=ABC12';
const q = crearQR(url);
t(q.nivel === 'M', 'nivel M por defecto');
t(q.size >= 25 && q.size <= 33, `tamaño razonable para una URL (${q.size}x${q.size})`);

console.log('\n=== El SVG generado ===');
const svg = qrSVG(url);
t(svg.startsWith('<svg'), 'es un SVG');
t(svg.includes('viewBox'), 'tiene viewBox (escala sin pérdida)');
t(svg.includes('<path'), 'dibuja los módulos en un solo path');
t(!svg.includes('undefined'), 'sin undefined en la salida');

console.log('\n=== Límites y errores ===');
let lanzo = false;
try { crearQR('', { nivel: 'M' }); } catch { lanzo = true; }
t(lanzo, 'texto vacío lanza error');

lanzo = false;
try { crearQR('x'.repeat(1200), { nivel: 'M' }); } catch { lanzo = true; }
t(lanzo, 'texto absurdo (>1000) lanza error claro');

console.log('\n===============================');
console.log(` ${ok} correctas, ${fail} fallas`);
console.log('===============================');
process.exit(fail ? 1 : 0);
