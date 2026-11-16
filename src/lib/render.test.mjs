/* Prueba del render de la tabla: puro texto, sin navegador. */
import { filaClasificacion, restoClasificacionHTML, podioHTML,
         ceremoniaHTML, subtitulo, siguientesHTML } from './render.js';

let ok = 0, fail = 0;
const t = (c, m) => { if (c) { ok++; console.log('  ok   ' + m); } else { fail++; console.log('  FALLA ' + m); } };

/** Tabla de prueba con N jugadores. */
const tablaDe = n => Array.from({ length: n }, (_, i) => ({
  position: i + 1, id: 'p' + i, name: `Jugador ${i + 1}`,
  score: (n - i) * 10, totalMs: 1000 * (i + 1), correct: n - i
}));

console.log('=== 1. Fila: medallas y números ===');
t(filaClasificacion({ position: 1, name: 'Ana', score: 30 }).includes('👑'), 'puesto 1 lleva corona');
t(filaClasificacion({ position: 2, name: 'Ana', score: 20 }).includes('🥈'), 'puesto 2 lleva plata');
t(filaClasificacion({ position: 3, name: 'Ana', score: 10 }).includes('🥉'), 'puesto 3 lleva bronce');
t(!filaClasificacion({ position: 4, name: 'Ana', score: 0 }).includes('👑'), 'puesto 4 no lleva medalla');
t(filaClasificacion({ position: 4, name: 'Ana', score: 0 }).includes('>4<'), 'puesto 4 muestra el número');
t(filaClasificacion({ position: 11, name: 'Ana', score: 0 }).includes('>11<'), 'puesto 11 muestra el número');

console.log('\n=== 2. Fila: accesibilidad y escape ===');
const f = filaClasificacion({ position: 2, name: '<script>x</script>', score: 5 });
t(f.includes('&lt;script&gt;'), 'escapa el nombre (sin XSS)');
t(f.includes('sr-solo'), 'el puesto está disponible para lectores de pantalla');
t(f.includes('aria-hidden'), 'el emoji está oculto a lectores de pantalla');

console.log('\n=== 3. Podio de tres niveles ===');
const tabla5 = tablaDe(5);
const visibles = html => (html.match(/peldano pos-\d visible/g) || []).length;

t(visibles(podioHTML(tabla5, 0)) === 0, 'paso 0: no muestra a nadie');
t(visibles(podioHTML(tabla5, 1)) === 1, 'paso 1: muestra el tercero');
t(visibles(podioHTML(tabla5, 2)) === 2, 'paso 2: muestra tercero y segundo');
t(visibles(podioHTML(tabla5, 3)) === 3, 'paso 3: muestra los tres');

t(visibles(podioHTML(tabla5, 1)) === 1 &&
  podioHTML(tabla5, 1).includes('pos-3 visible'), 'paso 1 revela el 3.º, no otro');

const p3 = podioHTML(tabla5, 3);
t(p3.includes('pos-1 visible') && p3.includes('pos-2 visible') && p3.includes('pos-3 visible'),
  'paso 3 revela los tres');
t(p3.indexOf('pos-2') < p3.indexOf('pos-1'), 'el 1.º va al centro, después del 2.º en el marcado');
t(p3.includes('Jugador 1') && p3.includes('Jugador 2') && p3.includes('Jugador 3'),
  'los tres nombres aparecen');
// el 1.º es más alto que el 2.º y el 2.º más que el 3.º
t(p3.includes('--alto:100%'), 'el primero tiene el pedestal más alto');
t(p3.includes('--alto:58%') && p3.includes('--alto:42%'), 'segundo y tercero, más bajos');

console.log('\n=== 4. El resto: del 4.º en adelante ===');
t(restoClasificacionHTML(tablaDe(2)) === '', 'con 2 jugadores no hay resto');
t(restoClasificacionHTML(tablaDe(3)) === '', 'con 3 jugadores no hay resto');

const r5 = restoClasificacionHTML(tablaDe(5));
t((r5.match(/fila-clasif/g) || []).length === 2, 'con 5 jugadores el resto tiene 2 (4.º y 5.º)');
t(!r5.includes('Jugador 1') && !r5.includes('Jugador 2') && !r5.includes('Jugador 3'),
  'el resto NO repite a los tres del podio');
t(r5.includes('Jugador 4') && r5.includes('Jugador 5'), 'el resto empieza en el 4.º');

const r12 = restoClasificacionHTML(tablaDe(12));
t((r12.match(/fila-clasif/g) || []).length === 9, 'con 12 jugadores el resto tiene 9');
t(r12.includes('resto-clasif'), 'tiene contenedor con scroll propio');
t(r12.includes('max-height'), 'el contenedor tiene altura máxima: se recorre deslizando');
t(r12.includes('Jugador 12'), 'llega hasta el último');

console.log('\n=== 5. El resto respeta el orden y el puntaje ===');
const tabla10 = tablaDe(10);
const r10 = restoClasificacionHTML(tabla10);
const posiciones = [...r10.matchAll(/<span class="num">(\d+)<\/span>/g)].map(m => Number(m[1]));
t(posiciones.join(',') === '4,5,6,7,8,9,10', 'del 4.º al 10.º, en orden: ' + posiciones.join(','));
const puntos = [...r10.matchAll(/<div class="puntos">(\d+)<\/div>/g)].map(m => Number(m[1]));
t(puntos.join(',') === '70,60,50,40,30,20,10', 'los puntajes bajan: ' + puntos.join(','));
t(puntos.every(p => p % 10 === 0), 'todos los puntajes son múltiplos de 10');

console.log('\n=== 6. Los cinco siguientes al podio ===');
t(siguientesHTML(tablaDe(2)) === '', 'con 2 jugadores no hay franja');
t(siguientesHTML(tablaDe(3)) === '', 'con 3 jugadores no hay franja');

const s8 = siguientesHTML(tablaDe(8));
t((s8.match(/class="siguiente"/g) || []).length === 5, 'con 8 jugadores muestra 5 (4.º al 8.º)');
t(s8.includes('Jugador 4') && s8.includes('Jugador 8'), 'del 4.º al 8.º');
t(!s8.includes('Jugador 1') && !s8.includes('Jugador 2') && !s8.includes('Jugador 3'),
  'no repite a los tres del podio');

const s15 = siguientesHTML(tablaDe(15));
t((s15.match(/class="siguiente"/g) || []).length === 5, 'con 15 jugadores sigue mostrando 5');
t(s15.includes('y 7 más'), 'avisa que hay 7 más por scroll');

console.log('\n=== 7. Ceremonia completa ===');
const c = ceremoniaHTML(tabla10, 3);
t(c.includes('Tabla de'), 'lleva el título');
t(c.includes('oro') && c.includes('clasificación'), 'el título resalta «clasificación» en oro');
t(c.includes('marco-oro'), 'lleva el marco dorado');
t(c.includes('marco-esquinas'), 'lleva las esquinas ornamentadas');
t(c.includes('podio-tres'), 'lleva el podio de tres niveles');
t(c.includes('siguientes'), 'tras revelar el primero aparece la franja de los siguientes');
t(c.includes('confeti'), 'con el podio completo hay confeti');
t(c.includes('pantalla-ceremonia'), 'ocupa la pantalla');

const c2 = ceremoniaHTML(tabla10, 1);
t(!c2.includes('siguientes'), 'antes de revelar el primero NO aparece la franja');
t(!c2.includes('confeti'), 'sin podio completo no hay confeti');

const cVacia = ceremoniaHTML([], 0, { vacio: 'Nadie jugó' });
t(cVacia.includes('Nadie jugó'), 'con tabla vacía muestra el mensaje');
t(!cVacia.includes('podio-tres'), 'con tabla vacía no hay podio');

console.log('\n=== 8. Subtítulos con tiempo y aciertos ===');
t(subtitulo({ totalMs: 8100, correct: 3 }) === '8.1 s · 3 aciertos', 'subtítulo correcto');
t(subtitulo({ totalMs: 1000, correct: 1 }) === '1.0 s · 1 acierto', 'singular con un acierto');
t(subtitulo({ totalMs: 0, correct: 0 }) === '0.0 s · 0 aciertos', 'cero aciertos en plural');

console.log('\n===============================');
console.log(` ${ok} correctas, ${fail} fallas`);
console.log('===============================');
process.exit(fail ? 1 : 0);
