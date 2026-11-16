/* =====================================================================
   Códigos QR
   ---------------------------------------------------------------------
   Usa `qrcode-generator` de Kazuhiko Arase (MIT), vendorizado en
   `vendor/qrcode.esm.js` para que el juego siga funcionando sin internet
   y sin dependencias que instalar.

   ─────────────────────────────────────────────────────────────────────
   POR QUÉ NO SE ESCRIBIÓ A MANO  (leer antes de intentarlo de nuevo)
   ─────────────────────────────────────────────────────────────────────
   Se intentó implementar QR desde cero (ISO/IEC 18004, Reed-Solomon en
   GF(256), entrelazado de bloques, máscaras, formato y versión). El
   resultado compilaba, daba la versión y el tamaño correctos, y aun así
   producía matrices equivocadas en entre 119 y 545 celdas según el caso:
   un código que NO se escanea.

   Lección: un QR "que parece bien" no es un QR. Nunca darlo por bueno sin
   compararlo celda por celda contra una referencia independiente
   (`segno`, vía Python). Ver `qr.test.mjs`.

   No reintentar a mano sin una razón muy fuerte. Esta librería son 56 KB,
   lleva desde 2009 en producción y está probada en millones de sitios.
   ===================================================================== */

import libreriaQR from '../../vendor/qrcode.esm.js';

// Los niveles de la librería son letras; se aceptan ambas formas.
const CORRECCION = { L: 'L', M: 'M', Q: 'Q', H: 'H' };

/**
 * Construye la matriz del QR.
 * @param {string} texto
 * @param {{nivel?: 'L'|'M'|'Q'|'H', version?: number}} opciones
 * @returns {{size:number, version:number, nivel:string, mod:number[][]}}
 */
export function crearQR(texto, { nivel = 'M', version = 0 } = {}) {
  const lvl = CORRECCION[nivel] ?? 'M';

  if (!texto || !String(texto).length) {
    throw new Error('El texto del QR está vacío.');
  }
  // Límite práctico: por encima de esto el QR se vuelve ilegible en un móvil.
  if (String(texto).length > 1000) {
    throw new Error('El texto es demasiado largo para el QR.');
  }

  const qr = libreriaQR(version || 0, lvl);
  qr.addData(texto);          // la librería detecta UTF-8 sola
  qr.make();

  const size = qr.getModuleCount();
  const mod = [];
  for (let r = 0; r < size; r++) {
    const fila = new Array(size);
    for (let c = 0; c < size; c++) fila[c] = qr.isDark(r, c) ? 1 : 0;
    mod.push(fila);
  }

  return { size, version: Math.floor((size - 17) / 4), nivel: lvl, mod };
}

/**
 * Dibuja el QR como SVG. Un solo `<path>` mantiene el archivo pequeño y
 * `shape-rendering="crispEdges"` evita que los módulos se vean borrosos.
 */
export function qrSVG(texto, { nivel = 'M', escala = 8, margen = 4, oscuro = '#0b1a1d', claro = '#ffffff' } = {}) {
  const qr = crearQR(texto, { nivel });
  const total = qr.size + margen * 2;

  let path = '';
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.mod[r][c]) path += `M${c + margen},${r + margen}h1v1h-1z`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}"
    shape-rendering="crispEdges" role="img" aria-label="Código QR para entrar a la sala"
    width="${total * escala}" height="${total * escala}">
    <rect width="${total}" height="${total}" fill="${claro}"/>
    <path d="${path}" fill="${oscuro}"/>
  </svg>`;
}

