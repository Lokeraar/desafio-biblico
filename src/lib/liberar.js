/* =====================================================================
   Desafío Bíblico — liberar
   ---------------------------------------------------------------------
   CUÁNDO SE SUELTA LO QUE UNA PANTALLA TOMÓ.

   Tomar algo es fácil: se guarda en `localStorage`, se marca un botón como
   deshabilitado, se abre un candado. Soltarlo solo en el camino feliz es lo
   que deja la app trabada y, peor, sin decir nada.

   Estas funciones no tocan nada: reciben lo que contestó el servidor y dicen
   QUÉ HACER. Así la decisión se puede probar sin navegador, sin red y sin
   esperar diez minutos a que expire un candado.

   Quien las usa (`app.js`) se queda con el efecto: borrar la clave, cerrar el
   cliente, pintar el aviso.
   ===================================================================== */

/*
 * Errores que significan que la sesión MURIÓ.
 *
 * Lista cerrada a propósito. Todo lo que no esté aquí se trata como
 * transitorio y se reintenta: echar a un jugador porque el servidor tardó o
 * la señal se cayó es justo lo contrario de lo que se quiere.
 */
export const SESION_MUERTA = new Set([
  'jugador_ausente',     // lo expulsaron, o el barrido lo dio por ido
  'sala_inexistente',    // la sala se cerró o la borró el barrido
  'sesion_incompleta'    // el token no vale
]);

/**
 * Errores que significan que la SALA del presentador ya no sirve.
 *
 * Es una lista DISTINTA de la del jugador, y la diferencia importa: al
 * presentador `no_autorizado` lo deja fuera (su token dejó de valer), pero al
 * jugador ese mismo código no le dice nada porque su token es otro.
 */
export const SALA_MUERTA = new Set([
  'sala_inexistente',   // la cerró él mismo, o la barrió el servidor
  'no_autorizado',      // el token dejó de valer
  'sesion_incompleta'   // falta el id o el token
]);

/** Estados de sala en los que la sesión ya no sirve para nada. */
const ESTADOS_TERMINALES = new Set(['closed']);

/**
 * Qué hacer con la sesión del participante cuando el servidor contestó.
 *
 * @param {object} r      lo que devolvió `reanudar`: `{ error? }`
 * @param {object} opts   `{ estado, reintentosRestantes }`
 * @returns {'seguir'|'olvidar'|'reintentar'}
 */
export function decidirSesionJugador(r, { estado = null, reintentosRestantes = 0 } = {}) {
  const error = r?.error;

  // Salió bien: se sigue, salvo que la sala esté cerrada. Una sala cerrada
  // no se puede reanudar aunque el servidor haya aceptado: quedarse en ella
  // es mirar una partida que ya no existe.
  if (!error) {
    return estado && ESTADOS_TERMINALES.has(estado) ? 'olvidar' : 'seguir';
  }

  if (SESION_MUERTA.has(error)) return 'olvidar';

  // Transitorio: red caída, servidor lento. Se reintenta sin tocar la sesión.
  return reintentosRestantes > 0 ? 'reintentar' : 'esperar';
}

/**
 * Qué hacer con la sala guardada del presentador al arrancar.
 *
 * @param {object} r      lo que devolvió `reabrir`: `{ error? }`
 * @param {object} opts   `{ estado }`
 * @returns {'seguir'|'olvidar'}
 */
export function decidirSalaHost(r, { estado = null, reintentosRestantes = 0 } = {}) {
  /*
   * UN ERROR NO SIEMPRE SIGNIFICA QUE LA SALA MURIO.
   *
   * Aquí estaba el defecto: `reabrir` propaga el error tal cual, y el código
   * llamante borraba la sala guardada con CUALQUIER error. Un corte de señal
   * al refrescar —que no dice nada de la sala— le borraba el panel al
   * presentador en medio de una partida, con los participantes dentro.
   *
   * Solo tres errores significan que la sala ya no está. El resto se
   * reintenta: la sala vive en el servidor y su token sigue valiendo.
   */
  const error = r?.error;
  if (error) {
    if (SALA_MUERTA.has(error)) return 'olvidar';
    return reintentosRestantes > 0 ? 'reintentar' : 'esperar';
  }

  // Se reabrió bien, pero la partida terminó: no se vuelve a la tabla de
  // clasificación de una partida anterior como si siguiera viva.
  //
  // OJO: solo con 'closed'. Con 'ceremony' se llevaría por delante la tabla
  // justo cuando el presentador la está mostrando, que es lo único que
  // necesita para revelar el podio.
  if (estado && ESTADOS_TERMINALES.has(estado)) return 'olvidar';

  return 'seguir';
}

/**
 * El aviso que corresponde a cada decisión sobre la sesión del jugador.
 *
 * Vive aquí, junto a la decisión, para que el mensaje no se separe de la
 * razón que lo provoca.
 */
export function avisoSesionJugador(decision) {
  switch (decision) {
    case 'olvidar':    return 'Tu sesión terminó. Vuelve a entrar con tu nombre.';
    case 'esperar':    return 'No hay conexión. Se reintentará al recargar.';
    default:           return null;
  }
}
