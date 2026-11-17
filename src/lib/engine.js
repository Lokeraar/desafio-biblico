/* =====================================================================
   Motor del juego — Selección simple
   ---------------------------------------------------------------------
   Es un reductor puro: recibe el estado y una acción, devuelve el estado
   nuevo. No sabe si está en la nube o en local. Así el mismo código
   gobierna los dos modos y se puede probar sin navegador.

   Reglas que implementa, idénticas a las del SQL:
     * Un solo intento por jugador y por pregunta.
     * El orden lo decide el número de secuencia del servidor (seq).
     * Gana quien tenga el seq más bajo entre las respuestas correctas.
     * La opción correcta no se publica hasta cerrar la ronda.
     * Pausa congela el reloj y bloquea respuestas.
     * Desempate final: puntos ↓, tiempo total ↑, orden de ingreso ↑.
   ===================================================================== */

import { shuffle, idUnico, nuevoCodigo } from './util.js';

export const ESTADOS = ['lobby', 'question', 'reveal', 'ceremony'];
export const SEGUNDOS_RONDA = 15;

/** Puntos que otorga cada acierto. El concurso juega de 10 en 10. */
export const PUNTOS_POR_ACIERTO = 10;

export function estadoInicial(opciones = {}) {
  return {
    roomId: opciones.roomId ?? idUnico(),
    code: opciones.code ?? nuevoCodigo(),
    gameSlug: 'seleccion-simple',
    status: 'lobby',
    paused: false,
    roundSeconds: opciones.roundSeconds ?? SEGUNDOS_RONDA,
    players: [],          // { id, name, score, totalMs, correct, joinedAt, waiting, kicked }
    round: null,          // { id, ordinal, prompt, reference, options[], correctIdx, openedAt, deadline, pausedAt, pausedTotal, answers[], state, winnerId, noWinner }
    seq: 0,               // contador monotónico: EL árbitro del orden
    plan: [],             // preguntas de esta partida
    planIndex: 0,
    lastPlayed: {},       // questionPrompt -> timestamp (para rotar el banco)
    history: []           // rondas cerradas, para deshacer
  };
}

/* ------------------------------------------------------------------ */
/* Utilidades internas                                                 */
/* ------------------------------------------------------------------ */

const ahora = () => Date.now();

/**
 * ¿La sala ya se cerró? Una sala cerrada no admite ninguna acción del
 * presentador: es el mismo criterio que aplica el servidor en `assert_host`
 * (rechaza 'ceremony' y 'closed'). Sin esto, el modo local dejaba reabrir
 * preguntas y deshacer rondas en una sala que ya no existe para nadie.
 */
function cerrada(estado) {
  return estado.status === 'closed';
}

function siguienteSeq(estado) {
  return { ...estado, seq: estado.seq + 1 };
}

/** ms transcurridos desde que se abrió la ronda, descontando pausas.
 *  Con la ronda en pausa el reloj queda CONGELADO: se mide hasta el
 *  momento de la pausa, no hasta ahora. */
export function transcurridoMs(round, t = ahora()) {
  if (!round || round.openedAt == null) return 0;
  const hasta = round.pausedAt ?? t;
  return Math.max(0, hasta - round.openedAt - (round.pausedTotal ?? 0));
}

export function restanteMs(round, t = ahora()) {
  if (!round) return 0;
  const total = round.durationMs ?? (round.roundSeconds ?? SEGUNDOS_RONDA) * 1000;
  // Antes de «Iniciar» el reloj está lleno.
  if (round.openedAt == null) return total;
  return Math.max(0, total - transcurridoMs(round, t));
}

function jugador(estado, id) {
  return estado.players.find(p => p.id === id);
}

/** Ganador de una ronda: seq más bajo entre las respuestas correctas. */
export function ganadorDe(round) {
  if (!round || !round.answers?.length) return null;
  const correctas = round.answers.filter(a => a.correct);
  if (!correctas.length) return null;
  return correctas.reduce((min, a) => (a.seq < min.seq ? a : min));
}

/* ------------------------------------------------------------------ */
/* Acciones del presentador                                            */
/* ------------------------------------------------------------------ */

export function prepararPartida(estado, preguntas, cantidad) {
  const disponibles = preguntas.slice();

  // Rotación: primero las nunca jugadas, luego las más viejas.
  const conPrioridad = disponibles.map(p => ({
    p,
    nuncaJugada: estado.lastPlayed[p.prompt] ? 0 : 1,
    ultima: estado.lastPlayed[p.prompt] ?? 0
  }));
  conPrioridad.sort((a, b) =>
    (b.nuncaJugada - a.nuncaJugada) ||
    (a.ultima - b.ultima) ||
    (Math.random() - 0.5)
  );

  const elegidas = conPrioridad.slice(0, Math.max(1, Math.min(cantidad, disponibles.length)))
    .map(x => x.p);

  return {
    ...estado,
    plan: shuffle(elegidas),
    planIndex: 0,
    status: 'lobby',
    round: null,
    history: []
  };
}

export function abrirPregunta(estado, t = ahora()) {
  const st = estado.round?.state;
  if (st === 'prepared' || st === 'open') {
    return { error: 'Ya hay una pregunta en curso. Ciérrala primero.' };
  }
  if (cerrada(estado)) {
    return { error: 'La sala está cerrada.' };
  }
  if (estado.status === 'ceremony') {
    return { error: 'La partida ya terminó.' };
  }

  const pregunta = estado.plan[estado.planIndex];
  if (!pregunta) {
    return { error: 'No quedan preguntas en esta partida.' };
  }

  // Barajar las opciones una sola vez, igual para todos.
  const conIndice = pregunta.options.map((texto, i) => ({
    texto, esCorrecta: i === pregunta.correct
  }));
  const barajadas = shuffle(conIndice);

  const round = {
    id: idUnico(),
    ordinal: (estado.history.length ?? 0) + 1,
    prompt: pregunta.prompt,
    reference: pregunta.reference ?? null,
    options: barajadas.map(o => o.texto),
    correctIdx: barajadas.findIndex(o => o.esCorrecta),
    // El reloj NO arranca aquí: el presentador lee la pregunta en voz
    // alta y las opciones, y solo entonces pulsa «Iniciar».
    openedAt: null,
    durationMs: estado.roundSeconds * 1000,
    pausedAt: null,
    pausedTotal: 0,
    answers: [],
    state: 'prepared',
    winnerId: null,
    noWinner: false
  };

  return {
    estado: {
      ...estado,
      status: 'question',
      paused: false,
      round,
      planIndex: estado.planIndex + 1,
      lastPlayed: { ...estado.lastPlayed, [pregunta.prompt]: t }
    }
  };
}

/**
 * El presentador pulsa «Iniciar»: aquí y solo aquí arranca el reloj.
 * Antes de esto la pregunta y las opciones ya se ven, pero nadie puede
 * responder. Así da tiempo a leerlas en voz alta.
 */
export function iniciarCuenta(estado, t = ahora()) {
  const round = estado.round;
  if (!round) return { error: 'No hay pregunta que iniciar.' };
  if (cerrada(estado)) return { error: 'La sala está cerrada.' };
  if (round.state !== 'prepared') return { error: 'La cuenta ya se inició.' };

  return {
    estado: {
      ...estado,
      status: 'question',
      paused: false,
      round: { ...round, state: 'open', openedAt: t, pausedAt: null, pausedTotal: 0 }
    }
  };
}

export function pausar(estado, t = ahora()) {
  if (!estado.round || estado.round.state !== 'open' || estado.paused) return { estado };
  return {
    estado: {
      ...estado,
      paused: true,
      round: { ...estado.round, pausedAt: t }
    }
  };
}

export function reanudar(estado, t = ahora()) {
  if (!estado.paused || !estado.round) return { estado };
  const delta = Math.max(0, t - (estado.round.pausedAt ?? t));
  return {
    estado: {
      ...estado,
      paused: false,
      // El reloj vuelve con los segundos que quedaban: no se reinicia.
      round: {
        ...estado.round,
        pausedAt: null,
        pausedTotal: (estado.round.pausedTotal ?? 0) + delta
      }
    }
  };
}

/** Cierra la ronda y otorga el punto. Idempotente: llamarla dos veces no suma doble. */
/**
 * Cierra la votación: nadie más puede responder. El punto ya se decide
 * aquí, pero la respuesta correcta AÚN NO se muestra a los jugadores.
 * Ese es el momento de suspenso del presentador.
 */
export function cerrarRonda(estado, t = ahora()) {
  const round = estado.round;
  if (!round) return { estado };
  if (round.state === 'closed' || round.state === 'revealed') return { estado };
  if (round.state === 'prepared') {
    // cerrar sin haber iniciado: no hay respuestas posibles
    const cerrada = { ...round, state: 'closed', closedAt: t, winnerId: null, noWinner: true };
    return {
      estado: {
        ...estado,
        paused: false,
        round: cerrada,
        history: [...estado.history, cerrada]
      }
    };
  }

  const ganador = ganadorDe(round);
  const ganadorId = ganador ? ganador.playerId : null;

  const players = estado.players.map(p => {
    if (p.id !== ganadorId) return p;
    const mias = round.answers.filter(a => a.playerId === p.id && a.correct);
    const ms = mias.reduce((s, a) => s + a.elapsedMs, 0);
    return {
      ...p,
      score: p.score + PUNTOS_POR_ACIERTO,
      correct: (p.correct ?? 0) + 1,
      totalMs: (p.totalMs ?? 0) + ms
    };
  });

  const roundCerrada = {
    ...round,
    state: 'closed',
    closedAt: t,
    winnerId: ganadorId,
    noWinner: !ganadorId
  };

  return {
    estado: {
      ...estado,
      // sigue en 'question': la pregunta está cerrada pero sin revelar
      paused: false,
      players,
      round: roundCerrada,
      history: [...estado.history, roundCerrada]
    }
  };
}

/** Revela la respuesta correcta y el ganador. Aquí sí cambia a 'reveal'. */
export function revelarRespuesta(estado, t = ahora()) {
  const round = estado.round;
  if (!round) return { estado };
  if (round.state === 'revealed') return { estado };
  if (round.state !== 'closed') return { estado };

  return {
    estado: {
      ...estado,
      status: 'reveal',
      round: { ...round, state: 'revealed', revealedAt: t }
    }
  };
}

/**
 * Saltar: cierra la pregunta sin dar el punto Y muestra la correcta de una vez.
 * No pasa por 'closed' porque no hay suspenso que sostener: se salta justamente
 * para ver la respuesta.
 */
/**
 * Cambia la pregunta en pantalla por otra del banco SIN gastar el turno.
 *
 * Es distinto de `saltarPregunta`: aquel cierra la ronda y avanza a la
 * siguiente, gastando una de las preguntas preparadas. Aquí la ronda sigue
 * siendo la misma —mismo id, mismo número— y solo cambia la pregunta.
 *
 * El reloj vuelve a cero y las respuestas se borran: nadie contestó la
 * pregunta que se está mostrando. La pregunta que se quita vuelve al final
 * del plan, así que se puede volver a encontrar más adelante.
 */
export function cambiarPregunta(estado, t = ahora()) {
  const round = estado.round;
  if (!round || (round.state !== 'prepared' && round.state !== 'open')) {
    return { error: 'No hay una pregunta en pantalla que cambiar.' };
  }
  if (cerrada(estado)) return { error: 'La sala está cerrada.' };

  // La pregunta en pantalla vive en planIndex - 1 (abrirPregunta ya avanzó).
  const actual = Math.max(0, (estado.planIndex ?? 0) - 1);
  const siguiente = actual + 1;

  if (!estado.plan[siguiente]) {
    return { error: 'No quedan preguntas para cambiar.' };
  }

  const pregunta = estado.plan[siguiente];
  const conIndice = pregunta.options.map((texto, i) => ({
    texto, esCorrecta: i === pregunta.correct
  }));
  const barajadas = shuffle(conIndice);

  // Se intercambian: la nueva pasa al sitio de la actual y la actual al
  // final del plan, para poder volver a salir.
  const plan = estado.plan.slice();
  plan[siguiente] = plan[actual];
  plan[actual] = pregunta;

  const nueva = {
    ...round,
    // Mismo id y mismo ordinal: es la MISMA pregunta del concurso.
    prompt: pregunta.prompt,
    reference: pregunta.reference ?? null,
    options: barajadas.map(o => o.texto),
    correctIdx: barajadas.findIndex(o => o.esCorrecta),
    openedAt: null,
    durationMs: estado.roundSeconds * 1000,
    pausedAt: null,
    pausedTotal: 0,
    answers: [],
    state: 'prepared',
    winnerId: null,
    noWinner: false
  };

  return {
    estado: {
      ...estado,
      status: 'question',
      paused: false,
      round: nueva,
      plan,
      planIndex: actual + 1,
      lastPlayed: { ...estado.lastPlayed, [pregunta.prompt]: t }
    }
  };
}

export function saltarPregunta(estado, t = ahora()) {
  const round = estado.round;
  if (!round || (round.state !== 'open' && round.state !== 'prepared')) return { estado };
  const cerrada = { ...round, state: 'revealed', closedAt: t, revealedAt: t,
                    noWinner: true, winnerId: null };
  return {
    estado: {
      ...estado,
      status: 'reveal',
      paused: false,
      round: cerrada,
      history: [...estado.history, cerrada]
    }
  };
}

export function repetirPregunta(estado, t = ahora()) {
  if (cerrada(estado)) return { error: 'La sala está cerrada.' };
  const ultima = estado.history[estado.history.length - 1];
  if (!ultima) return { error: 'No hay ninguna pregunta para repetir.' };

  const conIndice = ultima.options.map((texto, i) => ({
    texto, esCorrecta: i === ultima.correctIdx
  }));
  const barajadas = shuffle(conIndice);

  const round = {
    ...ultima,
    id: idUnico(),
    ordinal: estado.history.length + 1,
    options: barajadas.map(o => o.texto),
    correctIdx: barajadas.findIndex(o => o.esCorrecta),
    openedAt: t,
    pausedAt: null,
    pausedTotal: 0,
    answers: [],
    state: 'open',
    winnerId: null,
    noWinner: false,
    closedAt: null
  };

  return { estado: { ...estado, status: 'question', paused: false, round } };
}

/** Deshacer: anula la última ronda cerrada, devuelve el punto y la reabre. */
export function deshacer(estado, t = ahora()) {
  // Deshacer opera sobre la ronda ACTUAL, nunca sobre la última del historial.
  // Si se repitió una pregunta, la ronda en juego es una copia nueva que no
  // está en `history`: anular la del historial le quitaría el punto al ganador
  // de una ronda que ya no se está jugando.
  const actual = estado.round;

  if (cerrada(estado)) return { error: 'La sala está cerrada.' };
  if (!actual) return { error: 'No hay nada que deshacer.' };
  if (actual.state === 'open' || actual.state === 'prepared') {
    return { error: 'La pregunta está en curso. Ciérrala antes de deshacerla.' };
  }

  const ganador = actual.winnerId;
  let players = estado.players;

  if (ganador) {
    const ms = actual.answers
      .filter(a => a.playerId === ganador && a.correct)
      .reduce((s, a) => s + a.elapsedMs, 0);

    players = estado.players.map(p => p.id === ganador
      ? {
          ...p,
          score: Math.max(0, p.score - PUNTOS_POR_ACIERTO),
          correct: Math.max(0, (p.correct ?? 0) - 1),
          totalMs: Math.max(0, (p.totalMs ?? 0) - ms)
        }
      : p);
  }

  // Solo sale del historial si la ronda actual ES la última registrada.
  // Si venía de un «repetir», el historial se queda como está.
  const ultima = estado.history[estado.history.length - 1];
  const history = ultima && ultima.id === actual.id
    ? estado.history.slice(0, -1)
    : estado.history;

  const round = {
    ...actual,
    // El reloj vuelve a cero: la pregunta queda «preparada» y no corre
    // hasta que el presentador pulse Iniciar. Si dejáramos la hora aquí,
    // el motor creería que ya está en marcha (usa openedAt == null para
    // saber que el reloj no ha arrancado).
    openedAt: null,
    durationMs: estado.roundSeconds * 1000,
    pausedAt: null,
    pausedTotal: 0,
    answers: [],
    state: 'prepared',   // vuelve a «preparada»: hay que pulsar Iniciar
    winnerId: null,
    noWinner: false,
    closedAt: null,
    revealedAt: null
  };

  return {
    estado: {
      ...estado,
      status: 'question',
      paused: false,
      players,
      round,
      history
    },
    reabierta: round.id
  };
}

export function terminarJuego(estado, t = ahora()) {
  let nuevo = estado;
  if (estado.round?.state === 'open') {
    const cerrada = { ...estado.round, state: 'closed', closedAt: t, noWinner: true, winnerId: null };
    nuevo = { ...estado, round: cerrada, history: [...estado.history, cerrada] };
  }
  return { estado: { ...nuevo, status: 'ceremony', paused: false, endedAt: t } };
}

/**
 * El presentador CIERRA la sala.
 * No es la ceremonia: ahí la partida llegó a su final y se corona a alguien.
 * Aquí se abandona antes de tiempo, así que no hay podio que mostrar; solo un
 * estado final que le dice a cada jugador que ya no hay partida y lo suelta.
 *
 * Su razón de ser es liberar: una sala que queda viva en 'lobby' o 'question'
 * bloquea el tema durante horas y deja a los jugadores esperando a un
 * presentador que ya se fue. Por eso cierra también la ronda preparda.
 */
export function cerrarSala(estado, t = ahora()) {
  let nuevo = estado;
  const viva = estado.round && ['prepared', 'open'].includes(estado.round.state);
  if (viva) {
    const cerrada = { ...estado.round, state: 'closed', closedAt: t, noWinner: true, winnerId: null };
    nuevo = { ...estado, round: cerrada, history: [...estado.history, cerrada] };
  }
  return { estado: { ...nuevo, status: 'closed', paused: false, endedAt: t } };
}

export function expulsarJugador(estado, playerId) {
  return {
    estado: {
      ...estado,
      players: estado.players.map(p =>
        p.id === playerId ? { ...p, kicked: true, waiting: true } : p
      )
    }
  };
}

export function admitirJugador(estado, playerId) {
  return {
    estado: {
      ...estado,
      players: estado.players.map(p =>
        p.id === playerId ? { ...p, waiting: false } : p
      )
    }
  };
}

/* ------------------------------------------------------------------ */
/* Acciones del jugador                                                */
/* ------------------------------------------------------------------ */

/**
 * Un jugador responde. El host es el árbitro: valida tiempo, pausa,
 * duplicados y asigna el seq.
 */
export function responder(estado, { playerId, roundId, optionIdx }, t = ahora()) {
  const p = jugador(estado, playerId);
  if (!p) return { error: 'Ese jugador no está en la sala.' };
  if (p.kicked) return { error: 'Fuiste retirado de la sala.' };
  if (p.waiting) return { error: 'Estás en sala de espera. Espera la próxima pregunta.' };
  if (estado.paused) return { error: 'El presentador pausó el juego.' };

  const round = estado.round;
  if (!round || round.id !== roundId) return { error: 'Esa pregunta ya no está activa.' };
  if (round.state === 'prepared') return { error: 'El presentador aún no inició la cuenta.' };
  if (round.state !== 'open') return { error: 'La pregunta ya se cerró.' };
  if (restanteMs(round, t) <= 0) {
    return { error: 'Se acabó el tiempo.' };
  }
  if (round.answers.some(a => a.playerId === playerId)) {
    return { error: 'Ya respondiste esta pregunta.' };
  }

  const idx = Number(optionIdx);
  if (!Number.isInteger(idx) || idx < 0 || idx > 3) return { error: 'Opción inválida.' };

  const conSeq = siguienteSeq(estado);
  const answer = {
    seq: conSeq.seq,
    playerId,
    optionIdx: idx,
    correct: idx === round.correctIdx,
    elapsedMs: transcurridoMs(round, t),
    at: t
  };

  return {
    estado: {
      ...conSeq,
      round: { ...round, answers: [...round.answers, answer] }
    },
    answer
  };
}

/* ------------------------------------------------------------------ */
/* Tabla final                                                         */
/* ------------------------------------------------------------------ */

/** Orden final: puntos ↓, tiempo ↑, orden de ingreso ↑. */
export function tablaFinal(estado) {
  return estado.players
    .filter(p => !p.kicked && !p.waiting)
    .map(p => ({ ...p }))
    .sort((a, b) =>
      (b.score - a.score) ||
      ((a.totalMs ?? 0) - (b.totalMs ?? 0)) ||
      (a.joinedAt - b.joinedAt)
    )
    .map((p, i) => ({ ...p, position: i + 1 }));
}

/** Marcador en vivo (mismo criterio, sin esperar al final). */
export function marcador(estado) {
  return estado.players
    .filter(p => !p.kicked && !p.waiting)
    .slice()
    .sort((a, b) =>
      (b.score - a.score) ||
      ((a.totalMs ?? 0) - (b.totalMs ?? 0)) ||
      (a.joinedAt - b.joinedAt)
    );
}

/** El podio: 3.º, 2.º y 1.º, en ese orden de aparición. */
export function podio(estado) {
  const t = tablaFinal(estado).slice(0, 3);
  return [t[2], t[1], t[0]].filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Proyección del estado                                              */
/* ------------------------------------------------------------------ */

/**
 * Lo que se puede publicar a los jugadores y al televisor.
 * Nunca incluye `correctIdx` mientras la ronda está abierta: esa es la
 * fuga que todo el diseño evita. Al cerrar, sí se revela.
 */
export function estadoVisible(estado) {
  const r = estado.round;
  const ronda = !r ? null : {
    id: r.id,
    ordinal: r.ordinal,
    state: r.state,
    prompt: r.prompt,
    reference: r.reference,
    options: r.options,               // los textos sí: se muestran en pantalla
    openedAt: r.openedAt,
    deadlineMs: (r.durationMs ?? estado.roundSeconds * 1000),
    pausedAt: r.pausedAt,
    pausedTotal: r.pausedTotal ?? 0,
    answered: r.answers.length,        // el televisor puede mostrar el conteo
    winnerId: r.winnerId,
    noWinner: r.noWinner,
    // La correcta viaja SOLO al revelar. Cerrar no es revelar: entre uno y
    // otro está el suspenso del presentador.
    correctIdx: r.state === 'revealed' ? r.correctIdx : null,
    // Al cerrar ya no hay secreto que proteger: cada jugador puede ver
    // si acertó. Mientras la ronda está abierta NO se publican, para que
    // nadie sepa quién respondió ni en qué orden.
    answers: r.state === 'revealed'
      ? r.answers.map(a => ({
          playerId: a.playerId, optionIdx: a.optionIdx, correct: a.correct, seq: a.seq
        }))
      : []
  };

  return {
    roomId: estado.roomId,
    code: estado.code,
    gameSlug: estado.gameSlug,
    status: estado.status,
    paused: estado.paused,
    roundSeconds: estado.roundSeconds,
    players: marcador(estado).map(p => ({
      id: p.id, name: p.name, score: p.score,
      totalMs: p.totalMs ?? 0,
      correct: p.correct ?? 0,
      // joinedAt es el tercer criterio de desempate; sin él, tablaFinal
      // compara contra undefined y el orden final se rompe.
      joinedAt: p.joinedAt ?? 0,
      waiting: !!p.waiting
    })),
    round: ronda
  };
}
