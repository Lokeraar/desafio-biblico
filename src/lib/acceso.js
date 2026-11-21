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
 * @param {string} vista
 * @param {string|null} adminClave
 * @returns {boolean}
 */
export function puedeEntrar(vista, adminClave) {
  if (!requiereClave(vista)) return true;
  return Boolean(adminClave);
}
