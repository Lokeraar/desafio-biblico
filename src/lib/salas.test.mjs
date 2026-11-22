/* Prueba de «salas»: que se pinta en la tarjeta de salas abiertas.

   LO QUE SE PROTEGE
   -----------------
   La diferencia entre «no hay ninguna sala» y «no se pudo preguntar». Se
   parecen en pantalla y son opuestos: si un fallo se pinta como «no hay
   ninguna», una sala olvidada sigue viva toda la noche y nadie la cierra.
   Es el defecto de render prematuro que ya aparecio en otras pantallas de
   este proyecto: pintar una conclusion cuando la verdad es «todavia no se
   sabe».

   POR QUE ESTA PRUEBA NO MIRA EL FUENTE
   -------------------------------------
   La version anterior vivia dentro del marcado de `admin-ui.js` y se probaba
   buscando texto. Con el defecto inyectado daba VERDE: el patron se deslizaba
   hasta el `if (error)` de otra funcion. Aqui se prueba el resultado de una
   funcion pura, asi que el defecto no tiene donde esconderse.
*/
import { estadoSalas, puedeCerrarTodas, textoRecuento } from './salas.js';

let ok = 0, fail = 0;
const t = (c, m) => { if (c) { ok++; console.log('  ok   ' + m); } else { fail++; console.log('  FALLA ' + m); } };

console.log('=== salas: que se pinta en la tarjeta ===');

/* --- consultando: no se afirma nada --- */
t(estadoSalas({ salas: null }) === 'consultando',
  'con salas en null se dice «consultando», no «no hay»');
t(estadoSalas({ salas: undefined }) === 'consultando',
  'sin el dato tambien es «consultando»');
t(estadoSalas({ salas: [], cargando: true }) === 'consultando',
  'mientras se consulta manda «consultando», aunque la lista vieja este vacia');
t(estadoSalas() === 'consultando', 'sin argumentos no se inventa una respuesta');

/* --- error: se dice error, no vacio --- */
t(estadoSalas({ error: 'sin red', salas: null }) === 'error',
  'un fallo se dice como error');
t(estadoSalas({ error: 'sin red', salas: [] }) === 'error',
  'y gana sobre una lista vacia: no se puede afirmar «no hay» si fallo mirar');
t(estadoSalas({ error: 'sin red', salas: [{ code: 'ABC' }] }) === 'error',
  'y tambien gana sobre una lista vieja con salas');

/* --- vacio: SI es una respuesta --- */
t(estadoSalas({ salas: [] }) === 'vacio',
  'una lista vacia si es una respuesta: se consulto y no hay ninguna');
t(estadoSalas({ salas: [], cargando: false }) === 'vacio',
  'terminada la consulta, la lista vacia se queda en vacio');

/* --- lista --- */
t(estadoSalas({ salas: [{ code: 'ABC' }] }) === 'lista', 'con salas se listan');
t(estadoSalas({ salas: [{ code: 'A' }, { code: 'B' }] }) === 'lista',
  'y con varias tambien');

/* Lo que NO es una lista no se confunde con vacio: un objeto suelto o un
   texto no son «no hay salas», son datos que no se entendieron. */
t(estadoSalas({ salas: {} }) === 'consultando',
  'un objeto que no es lista no se lee como «no hay»');
t(estadoSalas({ salas: 'nada' }) === 'consultando',
  'un texto tampoco se lee como «no hay»');

console.log('\n=== salas: el boton de cerrar todas ===');

t(puedeCerrarTodas('lista', [{ code: 'A' }]) === true,
  'con salas se puede ofrecer cerrar todas');
t(puedeCerrarTodas('vacio', []) === false,
  'sin salas no: un boton que cierra 0 no hace nada y hace dudar');
t(puedeCerrarTodas('consultando', null) === false,
  'mientras se consulta tampoco');
t(puedeCerrarTodas('error', null) === false, 'con un error tampoco');
t(puedeCerrarTodas('lista', []) === false,
  'ni si el estado dice lista pero no hay nada dentro');

console.log('\n=== salas: el recuento ===');

t(textoRecuento(1) === '1 sala cerrada', 'una se dice en singular');
t(textoRecuento(3) === '3 salas cerradas', 'varias en plural');
t(textoRecuento(0) === '0 salas cerradas', 'cero no inventa un singular');
t(textoRecuento(undefined) === '0 salas cerradas', 'sin dato no dice «NaN»');
t(textoRecuento('2') === '2 salas cerradas', 'un texto numerico se cuenta igual');

console.log(`\nRESULTADO: ${ok} correctas, ${fail} fallas`);
if (fail) process.exit(1);
