/* Política de reintento de la pulsación: puro cálculo, sin red y sin DOM.
 *
 * Existe separado de app.js porque lo importante aquí no es el botón sino la
 * decisión: cuánto esperar, cuándo rendirse y qué error es definitivo. Así se
 * puede probar sin navegador y sin esperar de verdad.
 *
 * El caso que resuelve: el participante pulsa y la red falla justo ahí. Antes
 * la app se rendía al primer intento y el teléfono decía «No se pudo enviar»
 * con el reloj corriendo, sin forma de volver a intentar. Ahora reintenta solo,
 * en segundo plano, con el botón ya bloqueado: un toque por ronda.
 *
 * Se registra con el segundo en que LLEGA, no en que se tocó, y eso no lo
 * decide este módulo: el servidor ya guarda `elapsed_ms` con
 * `clock_timestamp() - opened_at` en el INSERT. Es injusto cuando la red
 * tarda, pero es lo único coherente que se puede hacer.
 */

/** Primera espera entre intentos, en milisegundos. */
export const ESPERA_INICIAL = 600;

/** Cuánto crece cada espera. */
export const FACTOR = 1.5;

/** Tope de una espera suelta: más que esto y el reloj de la ronda se acaba. */
export const ESPERA_MAXIMA = 2500;

/* Un tope de intentos como red de seguridad. Con las esperas de arriba y una
 * ronda de 30 s no se llega ni a la mitad; está para que un `restante` que
 * mienta no deje el bucle girando para siempre. */
const MAX_INTENTOS = 60;

/* Errores que NO se arreglan reintentando: el servidor ya decidió y volver a
 * preguntar da lo mismo. `ya_pulso` no está aquí a propósito: no es un fallo,
 * es la confirmación de que la pulsación entró. */
const DEFINITIVOS = new Set([
  'no_autorizado',
  'jugador_expulsado',
  'jugador_en_espera',
  'juego_equivocado',
  'juego_pausado',
  'ronda_no_existe',
  'ronda_cerrada',
  'fuera_de_tiempo'
]);

/** La pulsación ya estaba registrada: se cuenta como éxito. */
const YA_ESTABA = 'ya_pulso';

/** La siguiente espera: crece y se recorta en el tope. */
export function siguienteEspera(actual, factor = FACTOR, maxima = ESPERA_MAXIMA) {
  const siguiente = Math.round(Number(actual) * factor);
  if (!Number.isFinite(siguiente) || siguiente <= 0) return maxima;
  return Math.min(siguiente, maxima);
}

/** ¿Reintentar este error no sirve de nada? */
export function esDefinitivo(error) {
  return DEFINITIVOS.has(error);
}

/** ¿Este error significa «ya entró»? */
export function yaEstabaDentro(error) {
  return error === YA_ESTABA;
}

/**
 * Reintenta la pulsación hasta que entre, hasta que el servidor diga algo
 * definitivo, o hasta que se acabe el tiempo de la ronda.
 *
 * @param {object} opciones
 * @param {() => Promise<{error?: string|null}>} opciones.intentar
 *        Un intento de envío. Resuelve con `{ error }`: `null` es que entró.
 * @param {() => number} opciones.restante
 *        Milisegundos que quedan de ronda AHORA. Se consulta antes de cada
 *        espera, no una vez al principio.
 * @param {(ms: number) => Promise<void>} [opciones.dormir]
 *        Cómo se espera. Se inyecta para poder probar sin esperar de verdad.
 * @returns {Promise<{ok: true, intentos: number} | {ok: false, motivo: string, intentos: number}>}
 *        `motivo` es `'red'` cuando se acabó el tiempo sin lograr entrar, o el
 *        error del servidor cuando fue definitivo.
 */
export async function reintentarPulso({
  intentar,
  restante,
  dormir = (ms) => new Promise((listo) => setTimeout(listo, ms)),
  esperaInicial = ESPERA_INICIAL,
  factor = FACTOR,
  esperaMaxima = ESPERA_MAXIMA
}) {
  let espera = esperaInicial;
  let intentos = 0;

  for (;;) {
    intentos += 1;
    let respuesta;
    try {
      respuesta = await intentar();
    } catch (e) {
      // Una excepción es de red: no trae código del servidor que interpretar.
      respuesta = { error: 'red' };
    }
    const error = respuesta?.error ?? null;

    if (!error) return { ok: true, intentos };
    if (yaEstabaDentro(error)) return { ok: true, intentos };
    if (esDefinitivo(error)) return { ok: false, motivo: error, intentos };

    if (intentos >= MAX_INTENTOS) return { ok: false, motivo: 'red', intentos };

    /*
     * No se programa una espera que ya no cabe en la ronda: dormir para
     * despertar con el reloj agotado solo retrasa el aviso al participante.
     */
    const queda = Number(restante());
    if (!Number.isFinite(queda) || queda <= espera) {
      return { ok: false, motivo: 'red', intentos };
    }

    await dormir(espera);
    espera = siguienteEspera(espera, factor, esperaMaxima);
  }
}
