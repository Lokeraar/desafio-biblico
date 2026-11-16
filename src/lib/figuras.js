/* =====================================================================
   Figuritas del podio — SVG en línea, sin dependencias.
   ---------------------------------------------------------------------
   Se usan SVG y no emoji porque el emoji cambia de forma según el sistema
   operativo: en Android el 🥈 se ve como una montaña gris, no como una
   medalla. Con SVG el dibujo es el mismo en cualquier equipo.

   Cada figurita es una personita estilizada con el color de su puesto:
   oro, plata y bronce. Los rasgos son simples a propósito: a tamaño
   pequeño se leen mejor las siluetas limpias que el detalle.
   ===================================================================== */

/** Colores de cada puesto. */
const METAL = {
  1: { claro: '#ffe9a3', medio: '#f5c93b', oscuro: '#b8860b', brillo: '#fff8dc' },
  2: { claro: '#f2f5f8', medio: '#c9d3dc', oscuro: '#8a99a8', brillo: '#ffffff' },
  3: { claro: '#e9b98a', medio: '#c9834a', oscuro: '#8a5324', brillo: '#f7d9b8' }
};

/**
 * Una figurita de premiación.
 * @param {1|2|3} puesto
 * @param {number} tam  ancho en px
 */
export function figuraPodio(puesto, tam = 56) {
  const c = METAL[puesto] ?? METAL[3];
  const id = `fig-puesto-${puesto}`;

  // El primero levanta los brazos; el segundo aplaude; el tercero saluda.
  const brazos = {
    1: `<path d="M22 40 L13 26" /><path d="M38 40 L47 26" />`,
    2: `<path d="M22 42 L14 36" /><path d="M38 42 L46 36" />`,
    3: `<path d="M22 42 L15 48" /><path d="M38 42 L45 34" />`
  }[puesto] ?? '';

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 70" width="${tam}" height="${tam * 70 / 60}"
     role="img" aria-label="Figurita del puesto ${puesto}">
  <defs>
    <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${c.claro}"/>
      <stop offset="55%" stop-color="${c.medio}"/>
      <stop offset="100%" stop-color="${c.oscuro}"/>
    </linearGradient>
  </defs>

  <!-- halo suave -->
  <circle cx="30" cy="34" r="26" fill="${c.medio}" opacity=".13"/>

  <!-- piernas -->
  <path d="M26 50 L26 62" stroke="${c.oscuro}" stroke-width="5" stroke-linecap="round"/>
  <path d="M34 50 L34 62" stroke="${c.oscuro}" stroke-width="5" stroke-linecap="round"/>

  <!-- cuerpo -->
  <path d="M30 30
           C22 30 20 38 20 46
           L20 52 L40 52 L40 46
           C40 38 38 30 30 30 Z"
        fill="url(#${id})"/>

  <!-- brazos -->
  <g stroke="${c.oscuro}" stroke-width="4.5" stroke-linecap="round" fill="none">
    ${brazos}
  </g>

  <!-- cabeza -->
  <circle cx="30" cy="20" r="10" fill="url(#${id})"/>
  <circle cx="30" cy="20" r="10" fill="none" stroke="${c.brillo}" stroke-width="1.2" opacity=".55"/>

  <!-- brillo -->
  <path d="M24 15 A8 8 0 0 1 33 12" stroke="${c.brillo}" stroke-width="2"
        stroke-linecap="round" fill="none" opacity=".8"/>

  <!-- corona / medalla según el puesto -->
  ${puesto === 1 ? `
    <path d="M20 9 L24 3 L30 7 L36 3 L40 9 Z" fill="${c.medio}"
          stroke="${c.oscuro}" stroke-width="1.2" stroke-linejoin="round"/>
    <circle cx="30" cy="7.5" r="1.5" fill="#ff5c8a"/>` : ''}
  ${puesto === 2 || puesto === 3 ? `
    <circle cx="30" cy="43" r="5.5" fill="url(#${id})" stroke="${c.oscuro}" stroke-width="1.2"/>
    <text x="30" y="45.6" text-anchor="middle" font-size="6.5" font-weight="700"
          fill="#3a2a10" font-family="sans-serif">${puesto}</text>` : ''}
</svg>`;
}

/** Trofeo pequeño, para adornar el encabezado de la ceremonia. */
export function trofeo({ tam = 40 } = {}) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 44" width="${tam}" height="${tam * 44 / 40}"
     role="img" aria-label="Trofeo">
  <defs>
    <linearGradient id="oro-trofeo" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fff4c2"/>
      <stop offset="50%" stop-color="#f5c93b"/>
      <stop offset="100%" stop-color="#c8951a"/>
    </linearGradient>
  </defs>
  <path d="M13 12 L14 6 L26 6 L27 12 Z" fill="url(#oro-trofeo)"/>
  <path d="M20 22 L20 30" stroke="#c8951a" stroke-width="3"/>
  <path d="M13 34 L27 34 L25 30 L15 30 Z" fill="url(#oro-trofeo)"/>
  <path d="M11 10 H17 V18 A7 7 0 0 0 11 10 Z" fill="none" stroke="#c8951a" stroke-width="2"/>
  <path d="M29 10 H23 V18 A7 7 0 0 1 29 10 Z" fill="none" stroke="#c8951a" stroke-width="2"/>
</svg>`;
}
