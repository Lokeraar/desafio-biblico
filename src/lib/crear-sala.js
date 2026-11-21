/* =====================================================================
   Desafío Bíblico — crear sala
   ---------------------------------------------------------------------
   ¿SE PUEDE CREAR LA SALA, O FALTA ALGO ANTES?

   Christian: «hay que solicitar la clave maestra para poder crear la sala, si
   la introduce incorrectamente no se crea».

   La decisión no toca nada: recibe lo que hay en el estado y dice QUÉ TOCA
   hacer. Así se puede probar sin navegador y sin servidor, que es el mismo
   camino que ya siguen `liberar.js` y `conexion.js`.

   Quien la usa (`app.js`) se queda con el efecto: pintar el aviso, abrir el
   modal o crear la sala de verdad.
   ===================================================================== */

/** Lo que puede pasar al pulsar «Crear sala». */
export const AL_CREAR = {
  SIN_TEMA: 'sin-tema',        // falta elegir tema: se avisa y no se pide clave
  PEDIR_CLAVE: 'pedir-clave',  // hay tema pero no clave en la sesión
  CREAR: 'crear'               // hay tema y clave: se crea
};

/**
 * Qué hay que hacer al pulsar «Crear sala».
 *
 * EL ORDEN IMPORTA, y es lo que esta función fija:
 *   1. Sin tema no se pide la clave. Pedir una llave para después decir «te
 *      falta el tema» hace escribir la clave para nada, y encima gasta un
 *      intento del candado si se teclea mal.
 *   2. Con tema y sin clave, se pide la clave.
 *   3. Con las dos, se crea.
 *
 * `adminClave` es la clave ya verificada en ESTA sesión: se pide una vez, no
 * en cada sala. Volver a pedirla sería pedir la misma llave dos veces para la
 * misma puerta.
 *
 * @param {object} estado
 * @param {string|null} estado.temaElegido  id del tema, o null si no hay
 * @param {string|null} estado.adminClave   clave verificada en la sesión, o null
 * @returns {string} uno de `AL_CREAR`
 */
export function decidirCrearSala({ temaElegido = null, adminClave = null } = {}) {
  if (!temaElegido) return AL_CREAR.SIN_TEMA;
  if (!adminClave) return AL_CREAR.PEDIR_CLAVE;
  return AL_CREAR.CREAR;
}
