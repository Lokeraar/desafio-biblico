/* =====================================================================
   Transporte LOCAL — sin internet, sin cuentas, sin instalar nada.
   ---------------------------------------------------------------------
   El teléfono del presentador es el servidor. Se abre una pestaña como
   presentador y las demás pestañas (o ventanas) del MISMO dispositivo
   entran como jugadores por BroadcastChannel.

   Sirve para: probar el juego completo, ensayar el concurso y jugar con
   un televisor conectado por HDMI al mismo teléfono.

   No sirve para: varios teléfonos distintos. Para eso está el modo nube.
   ===================================================================== */

import * as E from './engine.js';
import { validarNombre, normalizeName } from './util.js';

const CANAL = 'desafio-biblico-local';

export function esLocalDisponible() {
  return typeof BroadcastChannel !== 'undefined';
}

/**
 * Host local: guarda el estado en memoria y lo difunde a todos los
 * canales. Es el único que decide; los demás solo piden y escuchan.
 */
export function crearHostLocal({ preguntas, onEstado }) {
  let estado = E.estadoInicial();
  const canal = new BroadcastChannel(CANAL);
  const pendientes = new Map();  // requestId -> {resolve, reject, tipo}

  function difundir() {
    // Al público: solo lo que la proyección permite (sin respuestas ni
    // la opción correcta mientras la ronda está abierta).
    canal.postMessage({ tipo: 'estado', estado: E.estadoVisible(estado) });
    // Al presentador: el estado COMPLETO. Él es el árbitro y necesita ver
    // quién respondió, qué opción eligió y en qué orden.
    onEstado?.(vistaHostCompleta(estado));
  }

  function responderSolicitud(requestId, payload) {
    canal.postMessage({ tipo: 'respuesta', requestId, payload });
    pendientes.get(requestId)?.resolve?.(payload);
    pendientes.delete(requestId);
  }

  canal.onmessage = ev => {
    const m = ev.data;
    if (!m || m.tipo !== 'solicitud') return;
    const { requestId, accion, payload } = m;

    try {
      switch (accion) {
        case 'unirse': {
          const nombre = (payload?.nombre ?? '').trim();
          const error = validarNombre(nombre);
          if (error) return responderSolicitud(requestId, { error });

          const repetido = estado.players.some(
            p => !p.kicked && normalizeName(p.name) === normalizeName(nombre)
          );
          if (repetido) return responderSolicitud(requestId, { error: 'Ese nombre ya está en uso. Elige otro.' });

          const nuevo = {
            id: 'p-' + Math.random().toString(36).slice(2, 10),
            name: nombre,
            score: 0, totalMs: 0, correct: 0,
            joinedAt: Date.now(),
            waiting: estado.status !== 'lobby',
            kicked: false
          };
          estado = { ...estado, players: [...estado.players, nuevo] };
          difundir();
          return responderSolicitud(requestId, { playerId: nuevo.id, waiting: nuevo.waiting, code: estado.code });
        }

        case 'responder': {
          const r = E.responder(estado, payload, Date.now());
          if (r.error) return responderSolicitud(requestId, { error: r.error });
          estado = r.estado;
          difundir();
          return responderSolicitud(requestId, { ok: true });
        }

        case 'estado': {
          return responderSolicitud(requestId, { estado: E.estadoVisible(estado) });
        }
        default:
          return responderSolicitud(requestId, { error: 'Acción desconocida.' });
      }
    } catch (err) {
      responderSolicitud(requestId, { error: err.message ?? 'Error inesperado.' });
    }
  };

  return {
    roomId: () => estado.roomId,
    code: () => estado.code,
    estado: () => vistaHostCompleta(estado),
    // acciones del presentador
    preparar: (cantidad) => { estado = E.prepararPartida(estado, preguntas, cantidad); difundir(); },
    abrir: () => { const r = E.abrirPregunta(estado); if (r.error) return r.error; estado = r.estado; difundir(); return null; },
    pausar: () => { estado = E.pausar(estado).estado; difundir(); },
    reanudar: () => { estado = E.reanudar(estado).estado; difundir(); },
    iniciar: () => { const r = E.iniciarCuenta(estado); if (r.error) return r.error; estado = r.estado; difundir(); return null; },
    cerrar: () => { estado = E.cerrarRonda(estado).estado; difundir(); },
    revelar: () => { estado = E.revelarRespuesta(estado).estado; difundir(); },
    saltar: () => { estado = E.saltarPregunta(estado).estado; difundir(); },
    repetir: () => { const r = E.repetirPregunta(estado); if (r.error) return r.error; estado = r.estado; difundir(); return null; },
    deshacer: () => { const r = E.deshacer(estado); if (r.error) return r.error; estado = r.estado; difundir(); return null; },
    terminar: () => { estado = E.terminarJuego(estado).estado; difundir(); },
    expulsar: (id) => { estado = E.expulsarJugador(estado, id); difundir(); },
    admitir: (id) => { estado = E.admitirJugador(estado, id); difundir(); },
    crearOtraSala: () => {
      estado = E.estadoInicial({ roomSeconds: estado.roundSeconds });
      difundir();
    },
    destruir: () => canal.close()
  };
}

/** Cliente local: pide al host y escucha el estado. */
export function crearClienteLocal({ onEstado } = {}) {
  const canal = new BroadcastChannel(CANAL);
  const pendientes = new Map();

  canal.onmessage = ev => {
    const m = ev.data;
    if (!m) return;
    if (m.tipo === 'estado') {
      onEstado?.(m.estado);
    } else if (m.tipo === 'respuesta' && m.requestId) {
      pendientes.get(m.requestId)?.(m.payload);
      pendientes.delete(m.requestId);
    }
  };

  function solicitar(accion, payload, timeoutMs = 4000) {
    const requestId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return new Promise(resolve => {
      // Una promesa que no resuelve es un silencio: siempre hay tope.
      const tope = setTimeout(() => {
        pendientes.delete(requestId);
        resolve({ error: 'No se encontró el presentador. Abre la pantalla del presentador en otra pestaña de este mismo dispositivo, o usa el modo en línea.' });
      }, timeoutMs);
      pendientes.set(requestId, p => { clearTimeout(tope); resolve(p); });
      canal.postMessage({ tipo: 'solicitud', requestId, accion, payload });
    });
  }

  return {
    unirse: (nombre) => solicitar('unirse', { nombre }),
    responder: (playerId, roundId, optionIdx) => solicitar('responder', { playerId, roundId, optionIdx }),
    pedirEstado: () => solicitar('estado', {}),
    cerrar: () => canal.close()
  };
}

/**
 * Vista COMPLETA para el presentador: incluye las respuestas de la ronda en
 * curso y la opción correcta aunque la ronda siga abierta. Él es el árbitro.
 */
export function vistaHostCompleta(estado) {
  const base = E.estadoVisible(estado);
  const r = estado.round;
  if (!r) return base;

  const visibles = r.answers
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map(a => ({
      seq: a.seq,
      playerId: a.playerId,
      name: estado.players.find(p => p.id === a.playerId)?.name ?? '—',
      optionIdx: a.optionIdx,
      correct: a.correct,
      elapsedMs: a.elapsedMs
    }));

  return {
    ...base,
    round: {
      ...base.round,
      correctIdx: r.correctIdx,
      answers: visibles
    }
  };
}
