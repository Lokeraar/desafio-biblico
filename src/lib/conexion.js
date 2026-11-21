/* =====================================================================
   Desafío Bíblico — sin conexión
   ---------------------------------------------------------------------
   QUE SE PUEDE JUGAR CUANDO NO HAY RED.

   Christian: «"Sin modo local" se renombra a "Sin conexión", los usuarios ni
   siquiera entenderian que significa el primer termino. Y se deberian mostrar
   en la pantalla todo lo que se tenga guardado en cache en ese modo "sin
   conexion"».

   EL DEFECTO QUE ESTO ARREGLA. El menu decia «Modo local» / «Sin modo local»
   mirando `esLocalDisponible()`, que NO mide la conexion: mide si el navegador
   soporta `BroadcastChannel`. Son dos cosas distintas, y el resultado era un
   aviso que hablaba de otra cosa.

   Aqui se separan las dos preguntas:
     - ¿hay red ahora?           -> `estadoConexion`
     - ¿que se puede jugar igual? -> `resumenSinConexion`
   ===================================================================== */

/**
 * ¿Hay red ahora?
 *
 * `navigator.onLine` es lo unico que el navegador sabe de verdad, y solo dice
 * si hay una interfaz de red levantada: no garantiza que el servidor
 * responda. Por eso se trata como una pista, no como una promesa: quien llama
 * decide que hacer con ella.
 *
 * @returns {'con'|'sin'} estado probable
 */
export function estadoConexion(nav) {
  const n = nav || (typeof navigator !== 'undefined' ? navigator : null);
  if (!n) return 'con';           // sin navegador no se inventa un problema
  if (typeof n.onLine !== 'boolean') return 'con';
  return n.onLine ? 'con' : 'sin';
}

/**
 * Qué se puede jugar sin conexión, contado a partir de lo que hay guardado.
 *
 * No inventa cifras: recibe el banco y los juegos y cuenta. Si mañana el banco
 * crece, el texto crece solo.
 *
 * @param {object} opts  `{ banco, juegos }`
 * @returns {{juegos:number, preguntas:number, hayAlgo:boolean}}
 */
export function resumenSinConexion({ banco = [], juegos = [], sinRed = [] } = {}) {
  const preguntas = Array.isArray(banco) ? banco.length : 0;
  /* Solo cuentan los juegos que de verdad se pueden jugar SIN RED.
   *
   * No basta con que el juego este «listo»: `crearHostLocal` solo sabe servir
   * preguntas. «Completar el versiculo» vive en Supabase, asi que sin conexion
   * no tiene nada que dar. Prometerlo seria mandar al presentador a una
   * pantalla vacia, y descubrirlo con la gente esperando.
   *
   * `sinRed` es la lista de slugs que el modo local puede servir de verdad; la
   * decide quien conoce el modo local, no este modulo. */
  const puedeSinRed = new Set(Array.isArray(sinRed) ? sinRed : []);
  const jugables = (Array.isArray(juegos) ? juegos : [])
    .filter(j => j && j.listo && puedeSinRed.has(j.slug)).length;
  return { juegos: jugables, preguntas, hayAlgo: jugables > 0 && preguntas > 0 };
}

/**
 * El texto que se muestra, ya en palabras de persona.
 *
 * Devuelve null cuando no hay nada que decir: si se puede jugar sin
 * conexion, no hace falta anunciarlo, y si no hay nada guardado tampoco se
 * promete lo que no hay.
 */
export function avisoSinConexion(resumen) {
  if (!resumen || !resumen.hayAlgo) return null;
  const j = resumen.juegos;
  const p = resumen.preguntas;
  return `Sin conexión. Puedes jugar con lo que hay guardado: `
    + `${j} ${j === 1 ? 'juego' : 'juegos'} y ${p} ${p === 1 ? 'pregunta' : 'preguntas'}.`;
}
