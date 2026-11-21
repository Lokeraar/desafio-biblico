/* Prueba del orbe de espera: canvas falso, sin navegador y sin animacion real.

   Cada caso esta pensado para FALLAR si el defecto estuviera presente. Los
   defectos que motiva esto:
     - una pantalla que espera un minuto sin decir nada se lee como un cuelgue;
     - una animacion que sigue corriendo en una pestana oculta gasta bateria;
     - escalar el canvas por CSS lo deja borroso. */
import { MODOS, ESTADO_SALA_ESPERA, pintarFotograma, estadoDeSala, animar } from './orbe.js';

let ok = 0, fail = 0;
const t = (c, m) => { if (c) { ok++; console.log('  ok   ' + m); } else { fail++; console.log('  FALLA ' + m); } };

/** Un contexto de canvas que apunta lo que le mandan. */
function ctxFalso() {
  const trazas = [];
  return {
    trazas,
    globalAlpha: 1,
    fillStyle: '',
    clearRect: (...a) => trazas.push(['clearRect', ...a]),
    beginPath: () => trazas.push(['beginPath']),
    arc: (...a) => trazas.push(['arc', ...a]),
    fill: () => trazas.push(['fill']),
    scale: (...a) => trazas.push(['scale', ...a])
  };
}

console.log('=== orbe: estados con significado ===');

t(MODOS.working === 'orbits', 'working dibuja orbitas (trabajo generico)');
t(MODOS.searching === 'globe', 'searching dibuja un globo (buscar)');
t(Object.keys(MODOS).length === 6, 'estan los seis estados de la skill');

t(ESTADO_SALA_ESPERA.solo === 'searching',
  'estar solo en la sala es searching: literalmente busca gente');
t(ESTADO_SALA_ESPERA.conectando === 'working', 'conectar es working');
t(estadoDeSala('esperando') === 'working', 'esperar al presentador es working');
t(estadoDeSala('inventado') === 'working',
  'una situacion desconocida cae en working, no en un estado falso de color');

console.log('');
console.log('=== orbe: pintar el fotograma ===');

for (const [nombre, modo] of Object.entries(MODOS)) {
  const c = ctxFalso();
  pintarFotograma(c, 64, 1.2, modo);
  const limpio = c.trazas[0]?.[0] === 'clearRect';
  const arcos = c.trazas.filter(x => x[0] === 'arc').length;
  const pinta = c.trazas.some(x => x[0] === 'fill');
  t(limpio && arcos > 0 && pinta, `el modo ${modo} limpia y pinta ${arcos} puntos`);
}

// El defecto concreto: si no se limpia, los fotogramas se acumulan y el orbe
// queda como una mancha solida.
const c2 = ctxFalso();
pintarFotograma(c2, 64, 0.5, 'orbits');
t(c2.trazas[0][0] === 'clearRect', 'limpia ANTES de pintar (si no, se acumula)');

// Un canvas sin tamano no debe dibujar: dividiria por cero.
const c3 = ctxFalso();
pintarFotograma(c3, 0, 1, 'orbits');
t(c3.trazas.length === 0, 'con tamano 0 no pinta nada');
// Sin contexto no revienta.
let revento = false;
try { pintarFotograma(null, 64, 1, 'orbits'); } catch { revento = true; }
t(!revento, 'sin contexto no lanza');

console.log('');
console.log('=== orbe: animar ===');

/** Un canvas de mentira con su contexto. */
function canvasFalso() {
  const c = ctxFalso();
  return { width: 0, height: 0, style: {}, getContext: () => c, trazas: c.trazas };
}

// Movimiento reducido: se pinta UN fotograma y no se anima.
const cv = canvasFalso();
const quieto = animar(cv, { estado: 'working', tamano: 64, reducido: true });
const arcosQuieto = cv.trazas.filter(x => x[0] === 'arc').length;
t(arcosQuieto > 0, 'con movimiento reducido igual se ve un fotograma representativo');
quieto.parar();

// El tamano se fija en PIXELES DEL CANVAS, no solo por CSS: escalar por CSS
// deja el dibujo borroso.
const cv2 = canvasFalso();
const a2 = animar(cv2, { estado: 'working', tamano: 64, reducido: true });
t(cv2.width >= 64, `el canvas se dimensiona en pixeles reales (${cv2.width})`);
a2.parar();

// `parar` existe siempre y se puede llamar dos veces sin romper.
let dobleParada = false;
try { a2.parar(); a2.parar(); } catch { dobleParada = true; }
t(!dobleParada, 'parar dos veces no lanza');

// El tamano 20 tambien vale: la skill solo admite 20 o 64.
const cv3 = canvasFalso();
const a3 = animar(cv3, { estado: 'searching', tamano: 20, reducido: true });
t(cv3.trazas.some(x => x[0] === 'arc'), 'el tamano 20 tambien pinta');
a3.parar();

console.log('');
console.log(fail === 0
  ? ` TODO EN VERDE: ${ok} correctas, 0 fallas`
  : ` FALLAS: ${ok} correctas, ${fail} fallas`);
process.exit(fail === 0 ? 0 : 1);
