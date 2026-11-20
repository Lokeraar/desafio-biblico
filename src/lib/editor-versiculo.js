/* Editor de versículos: marcar palabras, deshacer y serializar.
 *
 * Puro cálculo, sin DOM y sin red, para poder probarlo sin navegador.
 *
 * El formato de guardado es el que ya usa el juego: el texto del versículo con
 * cada palabra tapada entre llaves. `Pablo ... y el hermano {Timoteo} a la
 * iglesia ...`. De ahí cuelga todo: `versiculo_huecos` cuenta los huecos,
 * `versiculo_render` los dibuja con un guion por letra, y nada más se guarda.
 *
 * El editor del juego viejo no sirve aquí: pide cuatro respuestas y una
 * correcta. Un versículo no tiene opciones: tiene palabras tapadas dentro de
 * su propio texto. Reusar ese formulario obligaba a inventar respuestas.
 */

/** Tope de huecos por versículo. Escrito en el documento del juego; al llegar
 *  aquí se BLOQUEA, no solo se avisa. */
export const TOPE_HUECOS = 34;

/** Pasos de historial que se guardan para deshacer. */
export const TOPE_DESHACER = 10;

/**
 * Parte el texto en palabras con su separación, para poder volver a unirlo
 * exactamente igual.
 *
 * Se guarda también el espacio que sigue a cada palabra: si se reconstruyera
 * con `join(' ')` se perderían los saltos de línea y la puntuación pegada, y
 * el texto del versículo se vería distinto al que escribió el presentador.
 *
 * @returns {Array<{ texto: string, espacio: string }>}
 */
export function palabrasDe(texto) {
  const crudo = String(texto ?? '');
  if (!crudo.trim()) return [];
  const trozos = crudo.split(/(\s+)/);
  const fuera = [];
  for (let i = 0; i < trozos.length; i += 2) {
    const texto = trozos[i];
    if (!texto) continue;
    fuera.push({ texto, espacio: trozos[i + 1] ?? '' });
  }
  return fuera;
}

/** Vuelve a armar el texto desde las palabras y sus espacios. */
export function unirPalabras(palabras) {
  return (palabras ?? []).map(p => p.texto + p.espacio).join('');
}

/**
 * Lee un `texto_marcado` de la base y devuelve las palabras con sus índices
 * ocultos. Es la ida y vuelta de `serializar`.
 *
 * Los versículos ya sembrados vienen en este formato, así que el editor los
 * abre con sus huecos puestos en vez de hacerlos rehacer desde cero.
 *
 * @returns {{ palabras: Array<{texto:string, espacio:string}>, ocultas: number[] }}
 */
export function desdeMarcado(textoMarcado) {
  const crudo = String(textoMarcado ?? '');

  /* Se parte en tramos: el texto suelto y lo que va entre llaves. Se hace en
   * dos pasadas porque el espacio que sigue a un `}` pertenece a la palabra
   * TAPADA de antes, no al tramo siguiente: si se parte directamente, ese
   * espacio se pierde y `{Timoteo} a` se relee como `{Timoteo}a`. Pasaba, y la
   * prueba de ida y vuelta lo cazó. */
  const tramos = [];
  let i = 0;
  while (i < crudo.length) {
    if (crudo[i] === '{') {
      const cierra = crudo.indexOf('}', i + 1);
      if (cierra > i + 1) {
        tramos.push({ texto: crudo.slice(i + 1, cierra), oculto: true });
        i = cierra + 1;
        continue;
      }
    }
    const proxima = crudo.indexOf('{', i);
    const fin = proxima < 0 ? crudo.length : proxima;
    tramos.push({ texto: crudo.slice(i, fin), oculto: false });
    i = fin;
  }

  const palabras = [];
  const ocultas = [];
  for (const tramo of tramos) {
    if (!tramo.texto) continue;
    if (tramo.oculto) {
      // Un hueco con espacios dentro son varias palabras: se conservan
      // separadas para que el conteo coincida con el del servidor.
      for (const parte of palabrasDe(tramo.texto)) {
        palabras.push(parte);
        ocultas.push(palabras.length - 1);
      }
      continue;
    }
    const m = /^(\s*)/.exec(tramo.texto);
    const espacioInicial = m ? m[1] : '';
    if (espacioInicial && palabras.length) {
      palabras[palabras.length - 1].espacio = espacioInicial;
    }
    for (const parte of palabrasDe(tramo.texto.slice(espacioInicial.length))) {
      palabras.push(parte);
    }
  }
  return { palabras, ocultas };
}

/**
 * Arma el `texto_marcado` desde las palabras. Envuelve en llaves las que
 * están ocultas y conserva el espacio que tuviera cada una.
 */
export function serializar(palabras, ocultas) {
  const puestas = new Set(ocultas ?? []);
  return (palabras ?? [])
    .map((p, i) => (puestas.has(i) ? `{${p.texto}}` : p.texto) + p.espacio)
    .join('')
    .trimEnd();
}

/** ¿Se puede ocultar una palabra más? Aplica el tope. */
export function puedeOcultar(ocultas) {
  return (ocultas?.length ?? 0) < TOPE_HUECOS;
}

/**
 * Estado inicial del editor vacío.
 */
export function editorVacio() {
  return { palabras: [], ocultas: [], historial: [] };
}

/** Estado del editor a partir de un versículo guardado (o vacío si es nuevo). */
export function editorDesde({ textoMarcado = null } = {}) {
  if (!textoMarcado) return editorVacio();
  const { palabras, ocultas } = desdeMarcado(textoMarcado);
  return { palabras, ocultas, historial: [] };
}

/** Reemplaza el texto conservando los huecos que caigan dentro del texto nuevo. */
export function conTexto(estado, textoNuevo) {
  const palabras = palabrasDe(textoNuevo);
  /* Los huecos se conservan solo en las posiciones que siguen existiendo y
   * donde la palabra no cambió: si el presentador reescribe el texto, marcar
   * por índice dejaría tapada una palabra distinta de la que eligió. */
  const viejas = estado.palabras ?? [];
  const ocultas = (estado.ocultas ?? []).filter(
    i => i < palabras.length && viejas[i]?.texto === palabras[i]?.texto
  );
  return { palabras, ocultas, historial: estado.historial ?? [] };
}

/**
 * Alterna el hueco de una palabra.
 *
 * Devuelve `{ estado, accion }` donde `accion` es `'oculto'`, `'visible'`,
 * `'tope'` o `'fuera'`. Con `'tope'` el estado NO cambia: el tope bloquea.
 */
export function alternarHueco(estado, indice) {
  const palabras = estado.palabras ?? [];
  if (!Number.isInteger(indice) || indice < 0 || indice >= palabras.length) {
    return { estado, accion: 'fuera' };
  }
  const ocultas = [...(estado.ocultas ?? [])];
  const ya = ocultas.indexOf(indice);

  if (ya >= 0) {
    ocultas.splice(ya, 1);
    /* ESTE TOQUE ES UN DESHACER, NO UN PASO NUEVO.
     *
     * Volver a tocar una palabra tapada la destapa, y eso deshace el cambio
     * que la tapó: el contador de deshacer tiene que BAJAR, no subir. Antes se
     * empujaba al historial igual, así que ocultar y arrepentirse dejaba dos
     * pasos en la cuenta por un solo cambio.
     *
     * Se quita la última aparición de ese índice del historial. Si el índice no
     * estaba —una palabra que venía tapada del versículo guardado, sin que el
     * presentador la tapara ahora— no se toca la cuenta: destapar algo que
     * nunca tapaste no te devuelve un paso, porque no gastaste ninguno. */
    return {
      estado: {
        ...estado,
        ocultas: ocultas.sort((a, b) => a - b),
        historial: quitarDelHistorial(estado.historial, indice)
      },
      accion: 'visible'
    };
  }

  if (!puedeOcultar(ocultas)) return { estado, accion: 'tope' };

  ocultas.push(indice);
  return {
    estado: {
      ...estado,
      ocultas: ocultas.sort((a, b) => a - b),
      historial: empujarHistorial(estado.historial, indice)
    },
    accion: 'oculto'
  };
}

/** El historial guarda como máximo TOPE_DESHACER índices, el más nuevo al final. */
/**
 * Saca del historial la última vez que se tocó ese índice.
 *
 * Es la otra mitad de empujar: si volver a tocar una palabra la destapa, ese
 * toque deshace el anterior en vez de sumar uno nuevo.
 */
function quitarDelHistorial(historial, indice) {
  const siguiente = [...(historial ?? [])];
  const i = siguiente.lastIndexOf(indice);
  if (i >= 0) siguiente.splice(i, 1);
  return siguiente;
}

function empujarHistorial(historial, indice) {
  const siguiente = [...(historial ?? []), indice];
  return siguiente.length > TOPE_DESHACER
    ? siguiente.slice(siguiente.length - TOPE_DESHACER)
    : siguiente;
}

/**
 * Deshace el último cambio, de a uno.
 *
 * Devuelve el estado nuevo; si no hay historial, devuelve el mismo estado sin
 * tocar nada (deshacer dos veces seguidas no puede romper).
 */
export function deshacer(estado) {
  const historial = [...(estado.historial ?? [])];
  if (!historial.length) return { estado, accion: 'nada' };

  const indice = historial.pop();
  const ocultas = [...(estado.ocultas ?? [])];
  const i = ocultas.indexOf(indice);
  if (i >= 0) ocultas.splice(i, 1);
  else ocultas.push(indice);

  return {
    estado: {
      ...estado,
      ocultas: ocultas.sort((a, b) => a - b),
      historial
    },
    accion: 'deshecho'
  };
}

/** Cuántos pasos de deshacer quedan. */
export function pasosDeDeshacer(estado) {
  return (estado?.historial ?? []).length;
}

/** Cuántos huecos hay y si se llegó al tope. */
export function resumenHuecos(estado) {
  const n = estado?.ocultas?.length ?? 0;
  return { huecos: n, tope: TOPE_HUECOS, lleno: n >= TOPE_HUECOS };
}

/**
 * Valida antes de guardar. Devuelve un mensaje de error o null.
 *
 * No reusa `validarPregunta`: esa exige cuatro respuestas, que es justo lo que
 * un versículo no tiene.
 */
export function validarVersiculo({ referencia, texto, ocultas }) {
  const ref = String(referencia ?? '').trim();
  const t = String(texto ?? '').trim();
  if (!ref) return 'Escribe la referencia del versículo.';
  if (ref.length > 120) return 'La referencia es demasiado larga (máximo 120 caracteres).';
  if (!t) return 'Escribe el texto del versículo.';
  if (!(ocultas?.length > 0)) return 'Oculta al menos una palabra: sin huecos no hay juego.';
  if (ocultas.length > TOPE_HUECOS) {
    return `Hay ${ocultas.length} huecos y el máximo es ${TOPE_HUECOS}.`;
  }
  return null;
}

/**
 * El texto que se manda al servidor. La `prompt` la arma `versiculo_render`:
 * no se compone a mano aquí, para que no haya dos fuentes de verdad sobre qué
 * está tapado.
 */
export function paraGuardar(estado, referencia) {
  return {
    referencia: String(referencia ?? '').trim(),
    textoMarcado: serializar(estado.palabras ?? [], estado.ocultas ?? [])
  };
}
