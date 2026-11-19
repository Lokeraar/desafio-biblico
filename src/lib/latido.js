// Latido del temporizador: mueve la barra en cada cuadro, sin saltos.
//
// El defecto que corrige, y por qué era un defecto de diseño y no de números:
//
// La barra se movía con un `setInterval` de 250 ms que escribía un ancho nuevo,
// y en la hoja de estilos había `transition: width .25s linear`. Es decir: la
// barra no seguía al tiempo, perseguía al tiempo con una animación que duraba
// exactamente lo mismo que el intervalo.
//
// Cuando dos cosas que deberían encadenarse duran igual y las dispara un reloj
// que no es exacto (el de JavaScript no lo es: comparte el hilo con la red, el
// QR y el dibujado), se rompe la cadena en cada vuelta:
//
//   - si el intervalo llega TARDE, la transición ya terminó y la barra se
//     queda quieta esperando; al llegar el valor nuevo, pega un salto;
//   - si llega TEMPRANO, la transición anterior se corta a la mitad y arranca
//     otra desde donde iba, con menos distancia para el mismo tiempo: la barra
//     se ve FRENAR y luego recuperar.
//
// Medido con el reloj real: el ancho objetivo avanza 100/duración por
// milisegundo, pero la animación solo empieza a moverse cuando llega el tick.
// De ahí la sensación de «se frena a cada segundo».
//
// La cura no es ajustar los números (250 ms contra 250 ms ya estaban
// ajustados): es sacar la animación del medio. Aquí el ancho se CALCULA con el
// tiempo real en cada cuadro de dibujo:
//
//   - no hay transición: el ancho ES el tiempo, no algo que lo persigue;
//   - no hay intervalo: se dibuja cuando el navegador dibuja, no cuando el
//     reloj de JavaScript se acuerda.
//
// Y por eso este módulo no toca el DOM: recibe `leer` y `pintar`. Se puede
// probar sin navegador, y el día que la barra cambie de forma el motor del
// latido no se toca.

/** Porcentaje restante, acotado a 0..100. */
export function calcularPct(ms, totalMs) {
  if (!(totalMs > 0)) return 0;
  const pct = (ms / totalMs) * 100;
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, pct));
}

/**
 * Un latido que sigue al tiempo real, cuadro por cuadro.
 *
 * @param {object} o
 * @param {() => number} o.leer milisegundos restantes; se llama en cada cuadro
 * @param {number} o.total duración completa de la ronda, en ms
 * @param {(pct: number, ms: number) => void} o.pintar recibe el porcentaje
 * @param {() => void} [o.alCero] se llama UNA vez cuando el tiempo se acaba
 * @param {(fn: Function) => number} [o.cuadro] el programador de cuadros
 * @param {(id: number) => void} [o.cancelarCuadro] el que los cancela
 * @param {number} [o.umbral] tope del cambio mínimo para volver a pintar
 * @param {number} [o.cuadrosPorSegundo] estimación, por omisión 60
 * @returns {{arrancar: () => void, parar: () => void, correr: () => void, activo: () => boolean}}
 */
export function crearLatido({
  leer,
  total,
  pintar,
  alCero,
  cuadro,
  cancelarCuadro,
  umbral = 0.05,
  cuadrosPorSegundo = 60
} = {}) {
  const pedirCuadro = cuadro
    || (typeof globalThis.requestAnimationFrame === 'function'
      ? (fn) => globalThis.requestAnimationFrame(fn)
      : null);
  const soltarCuadro = cancelarCuadro
    || (typeof globalThis.cancelAnimationFrame === 'function'
      ? (id) => globalThis.cancelAnimationFrame(id)
      : () => {});

  let id = null;
  let vivo = false;
  let ultimoPct = null;
  let avisado = false;

  /*
   * EL UMBRAL NUNCA PUEDE SER MAYOR QUE LO QUE AVANZA UN CUADRO.
   *
   * El umbral existe para no escribir el mismo ancho cuando el valor no se
   * movió (una pestaña oculta, un reloj detenido). Pero puesto como un número
   * fijo —0,05 puntos— se come cuadros enteros en las rondas largas, donde
   * cada cuadro avanza menos:
   *
   *     5 s -> 0,334 puntos por cuadro    se pinta siempre
   *    15 s -> 0,111 puntos por cuadro    se pinta siempre
   *    30 s -> 0,056 puntos por cuadro    al filo del umbral
   *    60 s -> 0,028 puntos por cuadro    SE FILTRA: un cuadro de cada dos
   *
   * Un cuadro filtrado es una pausa de 17 ms, y los cuadros filtrados se
   * juntan: medido, una racha quieta de 1 cuadro (17 ms) que se repite. Es
   * pequeña, pero es exactamente la clase de tropiezo que se nota como «no
   * baja parejo».
   *
   * Así que el umbral se calcula como la MITAD de lo que avanza un cuadro.
   * Con eso se pinta en cada cuadro donde el valor cambió de verdad, y se
   * sigue sin escribir cuando no cambió nada.
   */
  const pasoPorCuadro = (total > 0) ? (100 * (1000 / cuadrosPorSegundo)) / total : 100;
  const umbralEfectivo = Math.min(umbral, pasoPorCuadro / 2);

  function correr() {
    if (!vivo) return;
    const ms = Number(leer?.() ?? 0);
    const pct = calcularPct(ms, total);

    // Se pinta cuando el cambio se nota. En una ronda de 30 s a 60 cuadros por
    // segundo el paso es de ~0,06 puntos: con este umbral se pinta casi todo
    // cuadro, y en una ronda larga se deja de escribir cuando el cambio es
    // invisible. Escribir el mismo valor no se hace nunca.
    /*
     * La barra solo BAJA. Es un reloj: no puede crecer.
     *
     * Sin esta guarda, un valor que sube un instante —el origen del tiempo
     * moviéndose por el ruido de la sincronización con el servidor, o un
     * cálculo que se rehace con otro desfase— se dibuja tal cual, y la barra
     * da un salto hacia atrás. Se VE como una pausa, que es exactamente lo
     * que se reportó: «al pasar cada segundo hace como una mini pausa».
     * Medido con el ruido real del servidor: un retroceso de 693 ms.
     *
     * Se ignora cualquier valor mayor que el último pintado. Si el origen se
     * corrige de verdad (una ronda nueva), `arrancar()` limpia `ultimoPct`.
     */
    // El `continue` de un bucle escrito como función: se salta el pintado
    // pero NO la petición del cuadro siguiente. Con un `return` el latido se
    // detenía para siempre en la primera subida, y la barra se quedaba
    // clavada: un reloj congelado, peor que el salto.
    const sube = ultimoPct !== null && pct > ultimoPct;
    if (!sube && (ultimoPct === null || Math.abs(pct - ultimoPct) >= umbralEfectivo)) {
      ultimoPct = pct;
      pintar?.(pct, ms);
    }

    if (ms <= 0) {
      vivo = false;
      id = null;
      if (!avisado) {
        avisado = true;
        alCero?.();
      }
      return;
    }

    // Sin programador de cuadros (un entorno sin `requestAnimationFrame`) se
    // pinta una vez y no se insiste: mejor una barra quieta que un bucle
    // apretado que congele el hilo.
    if (!pedirCuadro) return;
    id = pedirCuadro(correr);
  }

  return {
    arrancar() {
      if (vivo) return;
      vivo = true;
      avisado = false;
      ultimoPct = null;
      // Primer cuadro inmediato: la barra no debe esperar a que el navegador
      // dibuje para aparecer donde corresponde al tiempo ya transcurrido.
      correr();
    },
    parar() {
      vivo = false;
      if (id !== null) {
        soltarCuadro(id);
        id = null;
      }
    },
    correr,
    activo: () => vivo
  };
}
