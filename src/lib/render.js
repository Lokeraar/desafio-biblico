/* =====================================================================
   Render de la tabla de clasificación — funciones puras.
   ---------------------------------------------------------------------
   Viven aquí (y no dentro de app.js) para poder probarlas sin navegador.
   El navegador se colgaba al inyectar módulos por import dinámico, y peor
   aún: verificar a ojo no prueba nada. Estas funciones son texto de
   entrada → HTML de salida, sin estado y sin DOM.
   ===================================================================== */

import { esc, EMOJI } from './util.js';

/**
 * Una fila de la tabla.
 * Grilla de tres columnas con un solo eje de alineación: puesto, datos y
 * puntaje comparten el mismo centro. La caja del puesto tiene ancho fijo,
 * así la medalla y el número ocupan lo mismo y la columna no se corre.
 */
export function filaClasificacion({ position, name, subtitle, score, yo = false }) {
  const medalla = position <= 3 ? EMOJI[position] : null;
  return `
    <li class="fila-clasif${yo ? ' yo' : ''}">
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

/** Texto del subtítulo con el tiempo total y los aciertos. */
export function subtitulo(p) {
  const seg = ((p.totalMs ?? 0) / 1000).toFixed(1);
  const n = p.correct ?? 0;
  return `${seg} s · ${n} acierto${n === 1 ? '' : 's'}`;
}

/**
 * El podio de la ceremonia: 2.º a la izquierda, 1.º al centro (más alto) y
 * 3.º a la derecha (más bajo), como en un podio real.
 *
 * `paso` conserva el orden de revelación del concurso: 1 → el tercero,
 * 2 → el segundo, 3 → el primero. La posición física no cambia; solo la
 * visibilidad.
 */
export function podioHTML(tabla, paso) {
  const primero = tabla[0] ?? null;
  const segundo = tabla[1] ?? null;
  const tercero = tabla[2] ?? null;

  // orden de aparición: 3.º primero, luego 2.º, luego 1.º
  const visible = {
    3: paso >= 1,
    2: paso >= 2,
    1: paso >= 3
  };

  const lugar = (p, pos, { alto }) => {
    const on = p && visible[pos];
    return `
      <div class="peldano pos-${pos}${on ? ' visible' : ''}" style="--alto:${alto}">
        ${on ? `
          <div class="figura">
            <span class="medalla" aria-hidden="true">${EMOJI[pos] ?? '🏅'}</span>
            <span class="sr-solo">Puesto ${pos}:</span>
          </div>
          <div class="plataforma">
            <span class="num-puesto">${pos}</span>
          </div>
          <div class="etiqueta">
            <span class="nombre">${esc(p.name)}</span>
            <span class="puntos">${p.score} pts</span>
          </div>
        ` : `<div class="figura hueco"></div><div class="plataforma"></div><div class="etiqueta"></div>`}
      </div>`;
  };

  return `
    <div class="escenario" data-paso="${paso}">
      <div class="podio-tres">
        ${lugar(segundo, 2, { alto: '58%' })}
        ${lugar(primero, 1, { alto: '100%' })}
        ${lugar(tercero, 3, { alto: '42%' })}
      </div>
    </div>`;
}

/**
 * Del 4.º puesto en adelante, debajo del podio.
 * Tiene scroll propio (`max-height`) para no empujar la pantalla: los cinco
 * siguientes se ven y el resto se recorre deslizando.
 */
export function restoClasificacionHTML(tabla, { maxAlto = '38vh' } = {}) {
  const resto = tabla.slice(3);
  if (!resto.length) return '';

  return `
    <div class="resto-clasif" style="max-height:${maxAlto}">
      <ul class="podio-lista compacta">
        ${resto.map(p => `
          <li class="fila-clasif">
            <div class="puesto"><span class="num">${p.position}</span></div>
            <div class="datos">
              <span class="nombre">${esc(p.name)}</span>
              <span class="sub">${esc(subtitulo(p))}</span>
            </div>
            <div class="puntos">${p.score}</div>
          </li>`).join('')}
      </ul>
    </div>`;
}

/** Confeti decorativo. Se genera con posiciones fijas por índice para que
 *  no cambie entre renders (si cambiara, el confeti saltaría). */
function confetiHTML(n = 26) {
  const colores = ['#f5c93b', '#ffffff', '#3fae86', '#d9a520', '#2b7f96'];
  let out = '';
  for (let i = 0; i < n; i++) {
    const izq = (i * 37) % 100;
    const tarde = ((i * 13) % 40) / 10;
    const dur = 3.4 + ((i * 7) % 22) / 10;
    const color = colores[i % colores.length];
    out += `<i style="left:${izq}%;background:${color};animation-delay:${tarde}s;animation-duration:${dur}s"></i>`;
  }
  return `<div class="confeti" aria-hidden="true">${out}</div>`;
}

/**
 * Los cinco puestos que siguen al podio (4.º al 8.º), en una franja bajo el
 * podio. Si hay más jugadores, el resto queda accesible por scroll.
 */
export function siguientesHTML(tabla, { cuantos = 5 } = {}) {
  const resto = tabla.slice(3);
  if (!resto.length) return '';

  const cinco = resto.slice(0, cuantos);
  const sobran = resto.length - cinco.length;

  return `
    <div class="siguientes">
      <ul class="siguientes-lista">
        ${cinco.map(p => `
          <li class="siguiente">
            <span class="s-puesto">${p.position}</span>
            <span class="s-nombre">${esc(p.name)}</span>
            <span class="s-puntos">${p.score}</span>
          </li>`).join('')}
      </ul>
      ${sobran > 0
        ? `<p class="s-mas">y ${sobran} más…</p>`
        : ''}
    </div>`;
}

/**
 * Ceremonia completa a pantalla: marco dorado, título y podio.
 * Es una capa fija que cubre todo; el presentador la controla tocando.
 */
export function ceremoniaHTML(tabla, paso, { conConfeti = true, vacio = '', controles = '' } = {}) {
  if (!tabla.length) {
    return `
      <div class="pantalla-ceremonia">
        <div class="marco-oro">
          <span class="marco-esquinas"></span>
          <h1 class="titulo-ceremonia">Tabla de <span class="oro">clasificación</span></h1>
          <p class="tenue" style="text-align:center">${esc(vacio || 'Aún no hay resultados.')}</p>
          ${controles ? `<div class="ceremonia-controles">${controles}</div>` : ''}
        </div>
      </div>`;
  }

  return `
    <div class="pantalla-ceremonia">
      <div class="marco-oro">
        <span class="marco-esquinas"></span>
        ${conConfeti && paso >= 3 ? confetiHTML() : ''}
        <h1 class="titulo-ceremonia">
          Tabla de <span class="oro">clasificación</span>
        </h1>
        ${podioHTML(tabla, paso)}
        ${paso >= 3 ? siguientesHTML(tabla) : ''}
        ${controles ? `<div class="ceremonia-controles">${controles}</div>` : ''}
      </div>
    </div>`;
}

