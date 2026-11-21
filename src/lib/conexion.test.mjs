/* Prueba de «sin conexión»: puro cálculo, sin navegador y sin red.

   Los defectos que motiva esto:
     - el menu decia «Sin modo local», jerga que nadie entiende;
     - ese aviso miraba `esLocalDisponible()`, que mide BroadcastChannel y no
       la conexion: hablaba de otra cosa;
     - cuando no hay red no se decia QUE se puede jugar igual. */
import { estadoConexion, resumenSinConexion, avisoSinConexion } from './conexion.js';

let ok = 0, fail = 0;
const t = (c, m) => { if (c) { ok++; console.log('  ok   ' + m); } else { fail++; console.log('  FALLA ' + m); } };

console.log('=== conexion: ¿hay red? ===');

t(estadoConexion({ onLine: true }) === 'con', 'onLine true -> con conexion');
t(estadoConexion({ onLine: false }) === 'sin', 'onLine false -> sin conexion');
/* Sin navegador no se inventa un problema: mejor decir «con» y que falle la
   llamada real, que anunciar una averia que no existe. */
t(estadoConexion(null) === 'con', 'sin navegador no se anuncia una averia');
t(estadoConexion({}) === 'con', 'un navegador sin onLine no se toma por caido');

console.log('');
console.log('=== resumen: que hay guardado ===');

const juegos = [
  { slug: 'seleccion-simple', listo: true },
  { slug: 'completar-versiculo', listo: true },
  { slug: 'respuesta-abierta', listo: false }
];
const banco = new Array(25).fill({ prompt: 'x' });

const r = resumenSinConexion({ banco, juegos, sinRed: ['seleccion-simple', 'completar-versiculo'] });
t(r.juegos === 2, 'solo cuentan los juegos LISTOS (no «Pronto»)');

/* EL DEFECTO QUE ESTO ATAJA: prometer «Completar el versiculo» sin conexion
   cuando sus versiculos viven en Supabase. El presentador crearia una sala
   vacia y lo descubriria con la gente esperando. */
const soloPreguntas = resumenSinConexion({ banco, juegos, sinRed: ['seleccion-simple'] });
t(soloPreguntas.juegos === 1,
  'sin red solo cuenta lo que el modo local sirve de verdad');
t(!avisoSinConexion(soloPreguntas).includes('2 juegos'),
  'no promete dos juegos cuando solo uno funciona sin red');
t(r.preguntas === 25, 'cuenta las preguntas del banco');
t(r.hayAlgo === true, 'con juegos y preguntas, hay algo que jugar');

const vacio = resumenSinConexion({ banco: [], juegos, sinRed: ['seleccion-simple'] });
t(vacio.preguntas === 0, 'sin preguntas, cero');
t(vacio.hayAlgo === false, 'sin preguntas NO hay nada que jugar');

const sinListos = resumenSinConexion({ banco, juegos: [{ slug: 'x', listo: false }], sinRed: ['x'] });
t(sinListos.juegos === 0, 'un juego no listo no se cuenta');
t(sinListos.hayAlgo === false, 'sin juegos listos no se promete nada');

/* Basura no rompe: los datos vienen de fuera. */
const roto = resumenSinConexion({ banco: null, juegos: 'no es una lista' });
t(roto.juegos === 0 && roto.preguntas === 0, 'datos invalidos no rompen ni mienten');

console.log('');
console.log('=== el texto ===');

const texto = avisoSinConexion(r);
t(/Sin conexión/.test(texto), 'dice «Sin conexión», no «modo local»');
t(/2 juegos/.test(texto), 'dice cuantos juegos');
t(/25 preguntas/.test(texto), 'dice cuantas preguntas');
t(!/local/i.test(texto), 'no aparece la palabra «local»');

/* Singular y plural: «1 juegos» se lee mal y delata el texto generico. */
const uno = avisoSinConexion({ juegos: 1, preguntas: 1, hayAlgo: true });
t(/1 juego y 1 pregunta\./.test(uno), 'singular correcto con un juego y una pregunta');

/* Nada que decir cuando no hay nada guardado, o cuando no hay problema. */
t(avisoSinConexion({ juegos: 0, preguntas: 0, hayAlgo: false }) === null,
  'sin nada guardado no se promete nada');
t(avisoSinConexion(null) === null, 'sin resumen no hay aviso');

console.log('');
console.log(fail === 0
  ? ` TODO EN VERDE: ${ok} correctas, 0 fallas`
  : ` FALLAS: ${ok} correctas, ${fail} fallas`);
process.exit(fail === 0 ? 0 : 1);
