/* =====================================================================
   Utilidades compartidas
   ===================================================================== */

/** Escapa texto para insertarlo como HTML sin abrir un agujero de script. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/** Baraja una copia del arreglo (Fisher-Yates). */
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Minúsculas, sin tildes, espacios colapsados. Igual que en la base. */
export function normalizeName(s) {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Código de sala legible: sin caracteres que se confunden al dictar. */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function nuevoCodigo(n = 5) {
  let out = '';
  const bytes = new Uint8Array(n);
  (globalThis.crypto || {}).getRandomValues?.(bytes);
  for (let i = 0; i < n; i++) {
    const r = bytes[i] ?? Math.floor(Math.random() * 256);
    out += ALFABETO[r % ALFABETO.length];
  }
  return out;
}

/**
 * Deja un código de sala como lo guarda el servidor: mayúsculas y sin
 * espacios. En el televisor el código se muestra espaciado («B 7 3 W S») y
 * la gente lo dicta y lo escribe igual; sin limpiarlo, la sala no aparecía.
 */
export function normalizarCodigo(valor) {
  return String(valor ?? '').replace(/\s+/g, '').toUpperCase();
}

export function idUnico() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* ---------- filtro de nombres ----------
   La regla del concurso: nada vulgar, grosero ni irrespetuoso.
   Se compara sobre el nombre normalizado, y también se atrapan las
   sustituciones típicas (0→o, 1→i, 3→e, @→a, $→s). */
const VETADAS = [
  'puta', 'puto', 'putas', 'putos', 'mierda', 'pendejo', 'pendeja',
  'cabron', 'cabrona', 'cabrones', 'verga', 'vergas', 'joder', 'jodete',
  'coño', 'cono', 'culero', 'culera', 'culo', 'culos', 'zorra', 'zorro',
  'marica', 'maricon', 'maricona', 'gonorrea', 'hijueputa', 'malparido',
  'malparida', 'carechimba', 'chimba', 'chimbo', 'güevon', 'guevon', 'güevona',
  'huevon', 'huevona', 'webon', 'webona', 'huevada', 'carajo', 'carajito',
  'chupapija', 'pija', 'pijudo', 'cagada', 'cagon', 'cagona', 'singao',
  'singada', 'mamahuevo', 'mamaguevo', 'pajuo', 'pajua', 'estupido', 'estupida',
  'idiota', 'imbecil', 'tarado', 'tarada', 'retrasado', 'retrasada',
  'mongolico', 'subnormal', 'lameculos', 'ojete', 'polla', 'cojones',
  'follar', 'follador', 'chichis', 'tetas', 'perra', 'perro', 'bastardo',
  'bastarda', 'asesino', 'diablo', 'satanas', 'demonio'
];

export function esNombreInvalido(nombre) {
  const n = normalizeName(nombre).replace(/[0]/g, 'o').replace(/[1!|]/g, 'i')
    .replace(/[3]/g, 'e').replace(/[@4]/g, 'a').replace(/[$5]/g, 's');
  const compacto = n.replace(/[^a-z]/g, '');
  return VETADAS.some(v => {
    const vc = normalizeName(v).replace(/[^a-z]/g, '');
    return compacto.includes(vc);
  });
}

/** Valida el nombre y devuelve el motivo, o null si está bien. */
export function validarNombre(nombre) {
  const n = (nombre ?? '').trim();
  if (n.length < 2) return 'Escribe al menos 2 caracteres.';
  if (n.length > 40) return 'Máximo 40 caracteres.';
  if (!/[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]/.test(n)) return 'El nombre debe tener letras.';
  if (esNombreInvalido(n)) return 'Ese nombre no se permite. Usa tu nombre o un apodo respetuoso.';
  return null;
}

/* ---------- formato ---------- */
export function segundos(ms) {
  // Un `undefined` o `NaN` no debe llegar nunca a la pantalla: se vio
  // «Lista · NaNs» cuando la nube no mandaba la duración de la ronda.
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 1000)) : 0;
}

export function segundosConDecimal(ms) {
  return (Math.max(0, ms) / 1000).toFixed(1);
}

export const EMOJI = { 1: '👑', 2: '🥈', 3: '🥉' };
