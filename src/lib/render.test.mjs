/* Prueba del render de la ceremonia: puro texto, sin navegador. */
import { ceremoniaHTML, filaClasificacion, subtitulo, totalPasos } from './render.js';

let ok = 0, fail = 0;
const t = (c, m) => { if (c) { ok++; console.log('  ok   ' + m); } else { fail++; console.log('  FALLA ' + m); } };

const tablaDe = n => Array.from({ length: n }, (_, i) => ({
  position: i + 1, id: 'p' + i, name: `Jugador ${i + 1}`,
  score: (n - i) * 10, totalMs: 1000 * (i + 1), correct: n - i
}));

console.log('=== 1. Fila suelta ===');
t(filaClasificacion({ position: 1, name: 'Ana', score: 30 }).includes('👑'), 'puesto 1 lleva corona');
t(filaClasificacion({ position: 4, name: 'Ana', score: 0 }).includes('>4<'), 'puesto 4 muestra número');
const f = filaClasificacion({ position: 2, name: '<script>x</script>', score: 5 });
t(f.includes('&lt;script&gt;'), 'escapa el nombre (sin XSS)');
t(f.includes('sr-solo'), 'el puesto es accesible para lectores de pantalla');

console.log('\n=== 2. Subtítulos ===');
t(subtitulo({ totalMs: 8100, correct: 3 }) === '8.1 s · 3 aciertos', 'tiempo y aciertos');
t(subtitulo({ totalMs: 1000, correct: 1 }) === '1.0 s · 1 acierto', 'singular');

console.log('\n=== 3. Pasos de la ceremonia ===');
t(totalPasos(tablaDe(2)) === 2, '2 jugadores → 2 pasos');
t(totalPasos(tablaDe(3)) === 3, '3 jugadores → 3 pasos');
t(totalPasos(tablaDe(8)) === 4, '8 jugadores → 4 pasos (el último muestra el resto)');
t(totalPasos([]) === 0, 'sin jugadores → 0 pasos');

console.log('\n=== 4. Revelado acumulativo ===');
const t8 = tablaDe(8);
const filas = html => (html.match(/class="fila-rev/g) || []).length;

t(filas(ceremoniaHTML(t8, 0)) === 0, 'paso 0: nada revelado');
t(filas(ceremoniaHTML(t8, 1)) === 1, 'paso 1: aparece el 3.º');
t(filas(ceremoniaHTML(t8, 2)) === 2, 'paso 2: aparece el 2.º');
t(filas(ceremoniaHTML(t8, 3)) === 3, 'paso 3: aparece el 1.º');
t(filas(ceremoniaHTML(t8, 4)) === 8, 'paso 4: aparecen TODAS las posiciones');

console.log('\n=== 5. Orden de aparición: 3.º → 2.º → 1.º ===');
const p1 = ceremoniaHTML(t8, 1);
t(p1.includes('Jugador 3') && !p1.includes('Jugador 1') && !p1.includes('Jugador 2'),
  'paso 1 muestra solo al 3.º');

// El nombre del ganador también aparece en el mensaje de felicitación,
// que va ARRIBA. Se comprueba el orden solo dentro de la lista.
const p3 = ceremoniaHTML(t8, 3);
const lista = p3.slice(p3.indexOf('<ul class="lista-ceremonia"'));
const pos3 = lista.indexOf('Jugador 3');
const pos2 = lista.indexOf('Jugador 2');
const pos1 = lista.indexOf('Jugador 1');
t(pos3 >= 0 && pos2 > pos3 && pos1 > pos2, 'en la lista el orden es 3.º, 2.º, 1.º');

console.log('\n=== 6. Confeti y felicitación ===');
t(!ceremoniaHTML(t8, 2).includes('confeti'), 'sin confeti antes del primero');
t(ceremoniaHTML(t8, 3).includes('confeti'), 'confeti al aparecer el primero');
t(ceremoniaHTML(t8, 3).includes('Felicitaciones'), 'mensaje de felicitación al primero');
t(ceremoniaHTML(t8, 3).includes('Jugador 1'), 'el nombre del primero aparece');

console.log('\n=== 7. Título e imágenes ===');
const c = ceremoniaHTML(t8, 3);
t(c.includes('titulo-tabla.webp'), 'el título es una imagen WebP');
t(c.includes('alt="Tabla de clasificación"'), 'el título tiene texto alternativo');
t(!/\.svg/i.test(c), 'no queda ningún SVG como archivo externo');
t(c.includes('pantalla-ceremonia'), 'ocupa la pantalla');
t(c.includes('marco-oro'), 'lleva el marco dorado');

console.log('\n=== 8. Pie con botones ===');
const conPie = ceremoniaHTML(t8, 3, { footer: '<button>Jugar de nuevo</button>' });
t(conPie.includes('ceremonia-footer'), 'el pie existe');
t(conPie.includes('Jugar de nuevo'), 'el pie lleva sus botones');
t(!ceremoniaHTML(t8, 3).includes('ceremonia-footer'), 'sin pie si no se pasa');

console.log('\n=== 9. Tabla vacía ===');
const vacia = ceremoniaHTML([], 0, { vacio: 'Nadie jugó' });
t(vacia.includes('Nadie jugó'), 'muestra el mensaje');
t(!vacia.includes('fila-rev'), 'no hay filas');

console.log('\n=== 10. Resalta al jugador propio ===');
const conmigo = ceremoniaHTML(t8, 4, { miId: 'p2' });
t(conmigo.includes('fila-rev yo'), 'la fila propia se resalta');

console.log('\n===============================');
console.log(` ${ok} correctas, ${fail} fallas`);
console.log('===============================');
process.exit(fail ? 1 : 0);
