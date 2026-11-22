/* Cual de los cuatro estados de la lista de salas se pinta.
 *
 * POR QUE ESTO ES UN MODULO Y NO UN `if` EN EL MARCADO
 * -----------------------------------------------------
 * La primera version vivia dentro de `admin-ui.js` y se probaba buscando texto
 * en el fuente. No servia: la prueba daba verde con el defecto inyectado,
 * porque el patron se deslizaba hasta el `if (error)` de otra funcion. Lo
 * delata que, al anclar el patron, la prueba empezo a fallar de verdad.
 *
 * Aqui es calculo puro: se prueba el COMPORTAMIENTO —que un fallo no se pinte
 * como «no hay ninguna»— sin DOM y sin red.
 *
 * LOS CUATRO ESTADOS, Y POR QUE NO SON DOS
 * ----------------------------------------
 *   consultando -> todavia no se sabe. Se dice eso, sin afirmar nada.
 *   error       -> se intento y no se pudo. Se ofrece reintentar.
 *   vacio       -> se consulto y no hay ninguna. Es una respuesta, no un fallo.
 *   lista       -> hay salas que cerrar.
 *
 * `vacio` y `error` se parecen en pantalla y son opuestos en significado:
 * pintar «no hay ninguna sala abierta» cuando la consulta fallo deja salas
 * vivas toda la noche sin que nadie lo sepa. Es el defecto de render
 * prematuro de este proyecto, y por eso la regla vive aqui, con pruebas.
 */

/**
 * @typedef {'consultando'|'error'|'vacio'|'lista'} EstadoSalas
 */

/**
 * Decide que se pinta en la tarjeta de salas.
 *
 * El orden manda:
 *   1. Un error se dice como error, aunque `salas` traiga algo viejo.
 *   2. Mientras se consulta, no se afirma nada: `null` es «no se sabe».
 *   3. Una lista vacia SI es una respuesta.
 *
 * @param {{ salas?: unknown, cargando?: boolean, error?: string|null }} entrada
 * @returns {EstadoSalas}
 */
export function estadoSalas({ salas = null, cargando = false, error = null } = {}) {
  if (error) return 'error';
  if (cargando) return 'consultando';
  /* `null` o `undefined` es «todavia no se sabe». `[]` es «se consulto y no
     hay». Confundirlos es el defecto que este modulo existe para evitar. */
  if (!Array.isArray(salas)) return 'consultando';
  return salas.length === 0 ? 'vacio' : 'lista';
}

/**
 * ¿Se puede ofrecer el boton de cerrar todas?
 *
 * Solo con la lista delante y con algo dentro. Un boton que cierra «las 0
 * salas» no hace nada y hace dudar de si funciono.
 *
 * @param {EstadoSalas} estado
 * @param {unknown} salas
 * @returns {boolean}
 */
export function puedeCerrarTodas(estado, salas) {
  return estado === 'lista' && Array.isArray(salas) && salas.length > 0;
}

/**
 * El texto del recuento, sin inventar plurales.
 *
 * @param {number} n
 * @returns {string}
 */
export function textoRecuento(n) {
  const cuantas = Number(n) || 0;
  return cuantas === 1 ? '1 sala cerrada' : `${cuantas} salas cerradas`;
}
