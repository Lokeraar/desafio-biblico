/* =====================================================================
   Desafío Bíblico — acceso
   ---------------------------------------------------------------------
   QUÉ PANTALLAS NO SE ABREN SIN LA CLAVE MAESTRA.

   Christian: «se puede solicitar la clave y que solo se entre si es correcta
   y que la informacion se muestre despues de la autenticacion. todo lo
   relacionado al proyecto, osea menu de crear salas, panel del presentador y
   configuracion del proyecto y presentacion, deberian estar ocultos antes de
   la autenticacion».

   Antes la clave se pedia TARDE: al crear la sala, al abrir los temas, al
   cambiar el lema. Cada puerta pedia su llave por separado, y la pantalla del
   presentador se dibujaba entera —con sus temas, sus preguntas y el boton de
   crear sala— antes de que nadie se hubiera acreditado.

   La decision no toca nada: dice que vista necesita clave. Asi se puede probar
   sin navegador, igual que `liberar.js` y `crear-sala.js`.
   ===================================================================== */

/**
 * Vistas que NO se abren sin la clave maestra.
 *
 * - `host`   el panel del presentador: crea salas y conduce partidas.
 * - `config` la configuracion del proyecto: clave maestra, temas, marca.
 *
 * `menu`, `join` y `tv` quedan abiertas a proposito: el jugador entra con un
 * codigo y el televisor solo mira. Pedirles la clave a ellos seria cerrar la
 * puerta a quien viene a jugar.
 */
export const VISTAS_CON_CLAVE = ['host', 'config'];

/**
 * ¿Esta vista necesita la clave maestra antes de entrar?
 *
 * @param {string} vista  la ruta sin `#/`, por ejemplo `host`
 * @returns {boolean}
 */
export function requiereClave(vista) {
  return VISTAS_CON_CLAVE.includes(String(vista ?? '').trim().toLowerCase());
}

/**
 * ¿Se puede entrar a esta vista?
 *
 * `adminClave` es la clave ya verificada en esta sesion: una vez dentro, no se
 * vuelve a pedir en cada pantalla. Volver a pedirla seria pedir la misma llave
 * dos veces para la misma puerta.
 *
 * LA PRIMERA CLAVE ES LA EXCEPCION, y es obligatoria: se establece EN
 * configuraciones. Si esa pantalla se cerrara con una clave que todavia no
 * existe, una instalacion nueva quedaria sin ninguna puerta de entrada y sin
 * forma de crear la primera llave. Es el mismo candado sin salida que ya se
 * corrigio en la base (`20261118000001_clave_inicial.sql`): si no hay clave,
 * no hay nada que comprobar.
 *
 * @param {string} vista
 * @param {string|null} adminClave
 * @param {{ hayClaveConfigurada?: boolean }} [opciones]
 *        `hayClaveConfigurada` en `false` abre `config`: es la puerta para
 *        crear la primera clave.
 * @returns {boolean}
 */
export function puedeEntrar(vista, adminClave, { hayClaveConfigurada = true } = {}) {
  if (!requiereClave(vista)) return true;
  if (esVista(vista, 'config') && !hayClaveConfigurada) return true;
  return Boolean(adminClave);
}

/**
 * ¿Esta vista es `vista`, comparando como lo hace `requiereClave`?
 * Se saca aparte para que las dos funciones normalicen igual: si una aceptara
 * «  HOST  » y la otra no, la misma ruta pediria clave y no la dejaria pasar.
 *
 * @param {string} vista
 * @param {string} esperada
 * @returns {boolean}
 */
function esVista(vista, esperada) {
  return String(vista ?? '').trim().toLowerCase() === esperada;
}
