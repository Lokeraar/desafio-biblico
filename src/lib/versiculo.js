/* =====================================================================
   Completar el versículo — pantallas y mensajes.
   ---------------------------------------------------------------------
   Funciones puras: estado de la partida → HTML. Sin DOM, sin red, sin
   estado propio. Se prueban sin navegador, y por eso viven aquí y no
   dentro de app.js (que ya tiene 2 688 líneas).

   El contrato de lo que llega está en docs/completar-versiculo-contrato.md.
   Lo que este módulo NO hace, a propósito:
     - no decide si alguien acertó: eso lo sentencia el presentador;
     - no muestra `respuesta` antes de `state === 'revealed'`;
     - no inventa marcador: la tele no lo lleva.
   ===================================================================== */

import { esc } from './util.js';

/* ------------------------------------------------------------------ */
/* Los mensajes de felicitación                                        */
/* ------------------------------------------------------------------ */

// Seis variantes, y no siempre la misma: ver el mismo cartel seis veces en
// una partida lo vuelve invisible. Cambia solo el arranque; el nombre va
// aparte para que ninguna variante tenga que conjugarlo.
const FELICITACIONES = [
  '¡Acertaste, felicidades!',
  '¡Correcto, te la sabías!',
  '¡Exacto, muy bien!',
  '¡La diste!',
  '¡Perfecto, esa era!',
  '¡Acertaste, qué memoria!'
];

/**
 * Una variante distinta de la anterior.
 *
 * `evitar` es el texto que se acaba de mostrar. Se elige entre las demás,
 * así nunca salen dos iguales seguidas: repetir no es aleatorio, es
 * monótono, y es justo lo que se quería evitar.
 *
 * @param {number} azar  0 <= azar < 1, para poder probarlo sin azar real
 * @param {string} [evitar] la variante que no debe salir
 */
export function felicitacion(azar = Math.random(), evitar = null) {
  const otras = evitar
    ? FELICITACIONES.filter(f => f !== evitar)
    : FELICITACIONES;
  const lista = otras.length ? otras : FELICITACIONES;
  const i = Math.min(lista.length - 1, Math.max(0, Math.floor(azar * lista.length)));
  return lista[i];
}

/** Las seis, para las pruebas y para el selector del presentador. */
export function todasLasFelicitaciones() {
  return FELICITACIONES.slice();
}

/* ------------------------------------------------------------------ */
/* Lo que llega del servidor                                           */
/* ------------------------------------------------------------------ */

/**
 * Traduce el bloque `versiculo` del servidor a algo que la interfaz pueda
 * usar sin adivinar.
 *
 * Si el servidor no lo manda (juego de selección simple), devuelve null y
 * nadie se entera.
 */
export function versiculoDesdeServidor(bruto, { completo = false } = {}) {
  const v = bruto?.round?.versiculo;
  if (!v) return null;

  return {
    huecosTotales: v.huecos_totales ?? 0,
    revelados: Array.isArray(v.revelados) ? v.revelados.slice() : [],
    completo: Boolean(v.completo),
    // LA REGLA: el servidor manda null hasta que el estado es 'revealed'.
    // Aquí no se rellena con nada, para que una fuga del servidor no se
    // convierta en una fuga de la pantalla por cortesía.
    respuesta: v.respuesta ?? null,
    contestando: v.contestando
      ? { nombre: v.contestando.nombre, orden: v.contestando.orden }
      : null,
    pulsos: (v.pulsos ?? []).map(p => ({
      orden: p.orden,
      playerId: p.player_id,
      nombre: p.nombre,
      veredicto: p.veredicto ?? null
    }))
  };
}

/**
 * Qué texto mostrar de un versículo, con los huecos en su sitio.
 *
 * El servidor ya arma `prompt` con los huecos destapados; aquí solo se
 * convierte `____` en un elemento que se vea, y las palabras ya reveladas
 * en algo que destaque. No se re-renderiza desde el marcado original: sería
 * una segunda fuente de verdad sobre qué está tapado.
 */
export function versiculoHTML(prompt) {
  const texto = esc(prompt ?? '');
  // `____` es lo único que el servidor escribe para un hueco tapado.
  return texto.replace(/_{4,}/g, '<span class="hueco"></span>');
}

/**
 * El mismo versículo, pero como lo lee el presentador.
 *
 * Las palabras ocultas se muestran subrayadas y en otro color: así entiende
 * de un vistazo cuáles son las que los demás NO ven, sin necesidad de un
 * bloque aparte que repita la respuesta. Un hueco ya revelado va normal,
 * porque ya lo ve todo el mundo.
 *
 * @param {object} vers  bloque del servidor: { contestando, revelados }
 * @param {Array}  huecos [{ indice, respuesta, revelado }] del presentador
 */
export function versiculoHostHTML(prompt, huecos = []) {
  const texto = prompt ?? '';
  if (!texto) return '';

  // Las palabras que siguen tapadas, en orden de aparición. Se buscan por
  // índice del hueco para que el orden no dependa de cómo venga ordenado
  // el arreglo.
  const porIndice = new Map();
  for (const h of huecos) {
    if (!h.revelado) porIndice.set(h.indice, h.respuesta);
  }
  const pendientes = [...porIndice.keys()]
    .sort((a, b) => a - b)
    .map(k => porIndice.get(k));

  // El texto se parte por los huecos ANTES de escapar: si se escapara
  // primero, las etiquetas del subrayado saldrían como texto visible.
  const trozos = texto.split(/_{4,}/);
  let salida = '';
  let i = 0;
  trozos.forEach((trozo, n) => {
    salida += esc(trozo);
    if (n < trozos.length - 1) {
      const palabra = pendientes[i];
      salida += palabra
        ? `<span class="hueco-host">${esc(palabra)}</span>`
        : '<span class="hueco"></span>';
      i += 1;
    }
  });
  return salida;
}

/* ------------------------------------------------------------------ */
/* Mensajes por estado                                                 */
/* ------------------------------------------------------------------ */

/**
 * El aviso principal del participante, según lo que esté pasando.
 *
 * Devuelve `{ tipo, texto }` o null si no hay nada que decir. `tipo` es la
 * clase de color: turno, espera, error, exito, neutro.
 *
 * @param {object} p
 *   - estado: 'lobby' | 'open' | 'juicio' | 'closed' | 'revealed'
 *   - miPulso: el pulso propio, o null si no pulsó
 *   - contestando: el pulso de quien está contestando ahora
 *   - yoContesto: true si el que contesta soy yo
 *   - ultimoJuicio: { nombre, veredicto } del último sentenciado
 *   - quedanHuecos: cuántos sigue tapados
 */
export function avisoParticipante({
  estado, miPulso = null, contestando = null, yoContesto = false,
  ultimoJuicio = null, quedanHuecos = 0
}) {
  if (estado === 'lobby') {
    return { tipo: 'neutro', texto: 'Esperando que el presentador suelte la primera pregunta.' };
  }

  if (estado === 'juicio') {
    if (yoContesto) {
      return { tipo: 'turno', texto: '🎤 Estás contestando' };
    }
    if (contestando) {
      return { tipo: 'espera', texto: `Está contestando: ${contestando.nombre}` };
    }
    return { tipo: 'neutro', texto: 'Nadie pulsó esta ronda.' };
  }

  // Ronda cerrada o revelada: se cuenta cómo terminó.
  if (estado === 'closed' || estado === 'revealed') {
    if (ultimoJuicio && ultimoJuicio.veredicto === 'correcto') {
      return { tipo: 'exito', texto: `✅ ${ultimoJuicio.nombre} acertó, ha ganado esta ronda` };
    }
    if (quedanHuecos > 0) {
      return { tipo: 'neutro', texto: 'Cerraron la pregunta sin completar el versículo.' };
    }
    return { tipo: 'exito', texto: '✅ El versículo quedó completo' };
  }

  return null;
}

/**
 * El propio número en la cola, o null si no pulsó.
 *
 * Es lo que hace que el participante entienda por qué no le toca: no es
 * que la app lo haya olvidado, es que va detrás de dos personas.
 */
export function miTurnoTexto(miPulso) {
  if (!miPulso) return null;
  return `Fuiste el ${miPulso.orden} en pulsar`;
}

/**
 * Si el botón negro se puede pulsar, y qué dice.
 *
 * Devuelve `{ activo, texto, nota }`. `nota` es el aviso que acompaña al
 * botón cuando hay algo que explicar.
 */
export function estadoBoton({
  estado, miPulso = null, enviando = false, rechazo = null
}) {
  if (rechazo) {
    return { activo: false, texto: 'No se pudo enviar', nota: rechazo };
  }
  if (enviando) {
    return { activo: false, texto: 'Pulsaste…', nota: null };
  }
  if (miPulso) {
    return { activo: false, texto: 'Pulsaste', nota: null };
  }
  if (estado === 'open') {
    return { activo: true, texto: 'Presionar', nota: null };
  }
  if (estado === 'juicio') {
    return { activo: false, texto: 'No pulsaste', nota: 'No pulsaste esta ronda' };
  }
  return { activo: false, texto: 'Esperando', nota: null };
}

/* ------------------------------------------------------------------ */
/* Pantallas                                                           */
/* ------------------------------------------------------------------ */

/**
 * Pantalla del participante.
 *
 * @param {object} estado  estado ya traducido por cloud.js
 * @param {object} opciones
 *   - miId: id del jugador que mira
 *   - miPulso: su pulso, si lo tiene
 *   - enviando: true mientras se espera la confirmación del servidor
 *   - rechazo: mensaje de error del servidor, si lo hubo
 *   - felicitacionActual: la variante de felicitación que se está mostrando
 */
export function pantallaParticipante(estado, {
  miId = null, miPulso = null, enviando = false, rechazo = null,
  felicitacionActual = null
} = {}) {
  const r = estado?.round;
  const vers = versiculoDesdeServidor(estado);
  const yo = (estado?.players ?? []).find(p => p.id === miId);

  if (!r) {
    return `
      <div class="pantalla jugador-versiculo centro">
        <div class="barra-jugador">
          <span>${esc(yo?.name ?? '')}</span>
          <span class="puntos">${yo?.score ?? 0} pts</span>
        </div>
        <div class="grande-exito">
          <span class="marca" aria-hidden="true">🙏</span>
          <p class="titulo">Estás en la sala</p>
          <p class="sub">${esc(avisoParticipante({ estado: estado?.status ?? 'lobby' })?.texto ?? '')}</p>
        </div>
      </div>`;
  }

  const contestando = vers?.contestando ?? null;
  const yoContesto = Boolean(
    contestando && miPulso && contestando.orden === miPulso.orden
  );

  // Cuando yo contesto, el aviso ya lo dice: no hace falta repetir el color
  // de turno en el botón.
  const boton = estadoBoton({
    estado: r.state, miPulso, enviando, rechazo
  });

  const aviso = avisoParticipante({
    estado: r.state,
    miPulso,
    contestando,
    yoContesto,
    ultimoJuicio: ultimoJuicioDe(vers, r.state),
    quedanHuecos: vers ? vers.huecosTotales - vers.revelados.length : 0
  });

  const turno = miTurnoTexto(miPulso);

  // Acierto propio y completo: la pantalla cambia de forma, no solo de texto.
  const gane = vers?.completo && miPulso?.veredicto === 'correcto';

  if (gane) {
    const frase = felicitacionActual ?? felicitacion();
    return `
      <div class="pantalla jugador-versiculo centro">
        <div class="barra-jugador">
          <span>${esc(yo?.name ?? '')}</span>
          <span class="puntos">${yo?.score ?? 0} pts</span>
        </div>
        <div class="grande-exito">
          <span class="marca" aria-hidden="true">✅</span>
          <p class="titulo">${esc(frase)}</p>
          <p class="sub">Ganaste ${vers.revelados.length} de ${vers.huecosTotales} ${vers.huecosTotales === 1 ? 'palabra' : 'palabras'}.</p>
        </div>
        ${vers.respuesta
          ? `<p class="cita">«${esc(vers.respuesta)}»${r.reference ? ` — ${esc(r.reference)}` : ''}</p>`
          : ''}
      </div>`;
  }

  return `
    <div class="pantalla jugador-versiculo">
      <div class="barra-jugador">
        <span>${esc(yo?.name ?? '')}</span>
        <span class="puntos">${yo?.score ?? 0} pts</span>
      </div>
      ${r.reference ? `<span class="ref">${esc(r.reference)}</span>` : ''}
      <p class="versiculo">${versiculoHTML(r.prompt)}</p>
      <div class="pie-jugador">
        ${aviso ? `<div class="aviso ${aviso.tipo}">${esc(aviso.texto)}</div>` : ''}
        ${turno ? `<div class="aviso neutro">${esc(turno)}</div>` : ''}
        ${boton.activo
          ? `<button class="boton-ok" type="button" data-accion="pulsar">${esc(boton.texto)}</button>`
          : `<button class="boton-ok bloqueado" type="button" disabled>${esc(boton.texto)}</button>`}
      </div>
    </div>`;
}

/** El último participante sentenciado en esta ronda, si se puede saber. */
function ultimoJuicioDe(vers, estadoRonda) {
  if (!vers || estadoRonda === 'open' || estadoRonda === 'prepared') return null;
  const juzgados = vers.pulsos.filter(p => p.veredicto);
  if (!juzgados.length) return null;
  // Los pulsos ya vienen en orden de llegada; el último sentenciado es el
  // de orden más alto entre los que tienen veredicto.
  return juzgados.reduce((a, b) => (b.orden > a.orden ? b : a));
}

/**
 * Pantalla del televisor.
 *
 * No muestra marcador durante la partida, y no destapa un hueco antes de
 * que el presentador lo sentencie. Estas dos cosas no son un detalle de
 * estilo: son las reglas que se acordaron y están en el contrato.
 */
export function pantallaTV(estado) {
  const r = estado?.round;
  const vers = versiculoDesdeServidor(estado);

  if (!r) {
    return `
      <div class="pantalla pantalla-tv centro">
        <div class="espera-caja">
          <div>
            <div class="codigo-grande">${esc(estado?.code ?? '')}</div>
            <p class="espera-txt">Entra en la app y escribe este código</p>
          </div>
        </div>
        <div class="aviso neutro">${(estado?.players ?? []).length} en la sala</div>
      </div>`;
  }

  const contestando = vers?.contestando ?? null;
  const juzgados = vers ? vers.pulsos.filter(p => p.veredicto) : [];
  const ultimo = juzgados.length
    ? juzgados.reduce((a, b) => (b.orden > a.orden ? b : a))
    : null;

  let pie = '';
  if (r.state === 'open') {
    pie = `<div class="aviso espera">⏱ Pulsando…</div>`;
  } else if (r.state === 'juicio' && contestando) {
    pie = `<div class="aviso turno">🎤 Contestando: ${esc(contestando.nombre)} (fue el ${contestando.orden} en pulsar)</div>`;
    if (ultimo) {
      pie = `<div class="aviso error">❌ ${esc(ultimo.nombre)} no acertó</div>` + pie;
    }
  } else if (r.state === 'juicio') {
    pie = `<div class="aviso neutro">Nadie pulsó esta ronda</div>`;
  } else if (vers?.completo) {
    const aportes = juzgados
      .map(p => `<span>${esc(p.nombre)}</span>`)
      .join('');
    pie = `<div class="aviso exito">✅ El versículo quedó completo</div>`
        + (aportes ? `<div class="lista-aportes">${aportes}</div>` : '');
  }

  return `
    <div class="pantalla pantalla-tv">
      <div class="tv-top">
        ${r.reference ? `<span class="ref">${esc(r.reference)}</span>` : '<span></span>'}
        <span class="sala">${esc(estado.code ?? '')}</span>
      </div>
      <div class="cuerpo-tv">
        <p class="versiculo">${versiculoHTML(r.prompt)}</p>
      </div>
      <div class="pie-tv">${pie}</div>
    </div>`;
}

/**
 * La lista de turnos del presentador.
 *
 * Ordenada por la secuencia monotónica. El resaltado es a quién le toca
 * ahora, que es lo que el presentador necesita mirar mientras escucha.
 */
export function listaTurnosHTML(vers, turnoAnswerId = null) {
  if (!vers || !vers.pulsos.length) {
    return '<p class="vacio">Todavía nadie pulsó.</p>';
  }
  return `<div class="lista">${
    vers.pulsos.map(p => {
      const esTurno = p.orden === vers.contestando?.orden;
      const marca = p.veredicto === 'incorrecto'
        ? '<span class="marca mal">❌</span>'
        : p.veredicto === 'correcto'
          ? '<span class="marca ok">✅</span>'
          : p.veredicto === 'parcial'
            ? '<span class="marca par">parcial</span>'
            : (esTurno ? '<span class="marca">contesta ahora</span>' : '');
      return `
        <div class="pulso${esTurno ? ' turno' : ''}${p.veredicto ? ' hecho' : ''}">
          <span class="num">${p.orden}</span>
          <span class="quien">${esc(p.nombre)}</span>
          ${marca}
        </div>`;
    }).join('')
  }</div>`;
}

/**
 * El modal de «¿cuáles acertó?».
 *
 * Solo aparecen los huecos que siguen tapados: un hueco a la vista ya lo
 * ganó otro, y ofrecerlo sería regalar puntos por algo que dijo otra
 * persona.
 *
 * @param {object} vers    bloque versiculo del presentador
 * @param {Array}  huecos  [{ indice, respuesta, revelado }]
 * @param {string} nombre  a quién se está juzgando
 */
export function modalJuicioHTML(vers, huecos, nombre) {
  const disponibles = (huecos ?? []).filter(h => !h.revelado);
  if (!disponibles.length) {
    return `<div class="modal-caja">
      <h3>No quedan huecos por revelar</h3>
      <p class="sub">El versículo ya está completo.</p>
    </div>`;
  }
  return `
    <div class="modal-caja">
      <h3>¿Cuáles acertó ${esc(nombre)}?</h3>
      <p class="sub">Marca las palabras que dijo bien. Las que no marques quedan tapadas para el siguiente.</p>
      ${disponibles.map(h => `
        <label class="casilla">
          <input type="checkbox" data-hueco="${h.indice}" value="${h.indice}" hidden>
          <span class="tick">✓</span>
          <span class="palabra">${esc(h.respuesta)}</span>
          <span class="quien-dijo">hueco ${h.indice + 1} de ${vers?.huecosTotales ?? disponibles.length}</span>
        </label>`).join('')}
      <div class="controles">
        <div class="fila-botones">
          <button class="sec" type="button" data-accion="cancelar-juicio">Cancelar</button>
          <button class="ok" type="button" data-accion="confirmar-juicio">Confirmar</button>
        </div>
      </div>
    </div>`;
}
