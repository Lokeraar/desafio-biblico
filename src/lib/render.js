/* =====================================================================
   Render de la tabla de clasificación — funciones puras.
   ---------------------------------------------------------------------
   Viven aquí (y no dentro de app.js) para poder probarlas sin navegador.
   Son texto de entrada → HTML de salida, sin estado y sin DOM.

   CEREMONIA — cómo se revela (por toques en cualquier parte de la pantalla):
     paso 0 → nada visible, solo el título
     paso 1 → aparece el 3.º
     paso 2 → aparece el 2.º
     paso 3 → aparece el 1.º + confeti de felicitación
     paso 4 → aparecen TODAS las posiciones restantes
   Es una lista, no un podio: cada puesto es una fila con medalla, nombre,
   tiempo y puntos.
   ===================================================================== */

import { esc, EMOJI } from './util.js';
import { figuraPodio, trofeo } from './figuras.js';

/** Texto del subtítulo con el tiempo total y los aciertos. */
export function subtitulo(p) {
  const seg = ((p.totalMs ?? 0) / 1000).toFixed(1);
  const n = p.correct ?? 0;
  return `${seg} s · ${n} acierto${n === 1 ? '' : 's'}`;
}

/**
 * Una fila de la tabla.
 * Grilla de tres columnas con un solo eje: puesto, datos y puntaje centrados
 * entre sí. La caja del puesto tiene ancho fijo, así la medalla y el número
 * ocupan lo mismo y la columna no se corre.
 */
export function filaClasificacion({ position, name, subtitle, score, yo = false, detalle = false }) {
  const medalla = position <= 3 ? EMOJI[position] : null;
  return `
    <li class="fila-clasif${yo ? ' yo' : ''}${detalle ? ' detalle' : ''}">
      <div class="puesto">
        ${medalla
          ? `<span class="emoji" aria-hidden="true">${medalla}</span>`
          : `<span class="num">${position}</span>`}
        <span class="sr-solo">Puesto ${position}:</span>
      </div>
      <div class="datos">
        <span class="nombre">${esc(name)}</span>
        ${subtitle ? `<span class="sub">${esc(subtitle)}</span>` : ''}
      </div>
      <div class="puntos">${score}</div>
    </li>`;
}

/** Confeti decorativo. Posiciones fijas por índice: si cambiaran, saltaría. */
function confetiHTML(n = 30) {
  const colores = ['#f5c93b', '#ffffff', '#3fae86', '#d9a520', '#2b7f96', '#ff5c8a'];
  let out = '';
  for (let i = 0; i < n; i++) {
    const izq = (i * 37) % 100;
    const tarde = ((i * 13) % 40) / 10;
    const dur = 3.2 + ((i * 7) % 24) / 10;
    out += `<i style="left:${izq}%;background:${colores[i % colores.length]};
      animation-delay:${tarde}s;animation-duration:${dur}s"></i>`;
  }
  return `<div class="confeti" aria-hidden="true">${out}</div>`;
}

/**
 * Una fila del podio revelada, con su animación de entrada.
 * `pos` es el puesto; las tres primeras llevan figurita en lugar de número.
 */
function filaRevelada(p, { yo = false, puesto = false } = {}) {
  const medalla = p.position <= 3 ? EMOJI[p.position] : null;
  return `
    <li class="fila-rev${yo ? ' yo' : ''}${puesto ? ' del-podio' : ''}"
        style="--i:${p.position}">
      <div class="rev-puesto">
        ${puesto && p.position <= 3
          ? `<span class="rev-figura">${figuraPodio(p.position, p.position === 1 ? 58 : 48)}</span>`
          : ''}
        <span class="rev-num">${medalla ?? p.position}</span>
      </div>
      <div class="rev-datos">
        <span class="rev-nombre">${esc(p.name)}</span>
        <span class="rev-sub">${esc(subtitulo(p))}</span>
      </div>
      <div class="rev-puntos">${p.score}<span class="rev-pts"> pts</span></div>
    </li>`;
}

/**
 * Ceremonia completa.
 *
 * @param {Array}  tabla   resultado de tablaFinal(), ya ordenado
 * @param {number} paso    0 nada · 1 el 3.º · 2 el 2.º · 3 el 1.º + confeti
 *                         4 y más: todas las posiciones
 * @param {object} opciones
 *   - miId: id del jugador que está mirando, para resaltar su fila
 *   - footer: HTML de los botones del pie
 *   - vacio: mensaje si no hay nadie
 */
export function ceremoniaHTML(tabla, paso, { miId = null, footer = '', vacio = '' } = {}) {
  const titulo = `
    <h1 class="titulo-ceremonia">
      <img src="public/img/titulo-tabla.webp" alt="Tabla de clasificación" class="titulo-svg">
    </h1>`;

  if (!tabla.length) {
    return `
      <div class="pantalla-ceremonia">
        <div class="marco-oro">
          <span class="marco-esquinas"></span>
          ${titulo}
          <p class="tenue" style="text-align:center">${esc(vacio || 'Aún no hay resultados.')}</p>
          ${footer ? `<div class="ceremonia-footer">${footer}</div>` : ''}
        </div>
      </div>`;
  }

  const tercero = tabla[2] ?? null;
  const segundo = tabla[1] ?? null;
  const primero = tabla[0] ?? null;
  const resto = tabla.slice(3);

  // Quién se ve en cada paso. Se acumula: lo revelado no desaparece.
  const filas = [];
  if (paso >= 1 && tercero) filas.push({ p: tercero, puesto: true });
  if (paso >= 2 && segundo) filas.push({ p: segundo, puesto: true });
  if (paso >= 3 && primero) filas.push({ p: primero, puesto: true });

  // A partir del paso 4 se ven todas las demás posiciones.
  const muestraResto = paso >= 4;
  if (muestraResto) {
    for (const p of resto) filas.push({ p, puesto: false });
  }

  const confirmacion = paso >= 3 && primero
    ? `<p class="felicitacion">🎉 ¡Felicitaciones, ${esc(primero.name)}!</p>`
    : '';

  return `
    <div class="pantalla-ceremonia" role="region" aria-label="Tabla de clasificación">
      <div class="marco-oro">
        <span class="marco-esquinas"></span>
        ${paso >= 3 ? confetiHTML() : ''}

        ${titulo}
        ${confirmacion}

        <ul class="lista-ceremonia" aria-live="polite">
          ${filas.map(({ p, puesto }) =>
            filaRevelada(p, { yo: miId && p.id === miId, puesto })
          ).join('')}
        </ul>

        ${paso >= 3 && resto.length && !muestraResto
          ? `<p class="pista-ceremonia">Toca para ver el resto de la tabla</p>`
          : ''}

        ${footer ? `<div class="ceremonia-footer">${footer}</div>` : ''}
      </div>
    </div>`;
}

/** Cuántos pasos tiene la ceremonia para esta tabla. */
export function totalPasos(tabla) {
  const tres = Math.min(3, tabla.length);
  return tabla.length > 3 ? 4 : tres;
}
