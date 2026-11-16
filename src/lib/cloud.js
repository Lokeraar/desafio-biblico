// Transporte en la nube (Supabase) con la MISMA interfaz que local.js.
//
// La app no sabe si juega contra BroadcastChannel o contra Supabase: ambos
// exponen `crearHostLocal`-style APIs. Así el resto del código no cambia.
//
// ── Cómo viaja el estado ──────────────────────────────────────────────
// El servidor es el árbitro: guarda el orden de llegada con una secuencia
// monotónica y decide el ganador. El cliente NO calcula puntos ni orden.
//
// ── Por qué sondeo y no realtime ─────────────────────────────────────
// Realtime por WebSocket obligaría a implementar el protocolo Phoenix a
// mano (el proyecto no tiene dependencias). El sondeo con jitter cubre
// 40–200 jugadores de sobra para una partida de 15 s por ronda, y es
// mucho más difícil que se quede colgado en un teléfono con mala señal:
// cada consulta es independiente y se puede repetir sin efectos.
//
// Si algún día hace falta, se cambia SOLO este archivo.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

const CABECERAS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json'
};

// Sondeo: el presentador necesita más frescura que el jugador.
const MS_SONDEO_HOST = 900;
const MS_SONDEO_JUGADOR = 1400;
// Tope duro por consulta: una promesa que no resuelve no es un error,
// es un silencio, y un silencio no se puede diagnosticar.
const MS_TOPE_PETICION = 8000;

/** Llama a una función RPC de Supabase y normaliza los errores. */
export async function rpc(nombre, args = {}) {
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), MS_TOPE_PETICION);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nombre}`, {
      method: 'POST',
      headers: CABECERAS,
      body: JSON.stringify(args),
      signal: corte.signal
    });

    const texto = await res.text();
    let cuerpo = null;
    try { cuerpo = texto ? JSON.parse(texto) : null; } catch { cuerpo = null; }

    if (!res.ok) {
      // Postgres lanza los errores del motor en `message` (nombre_ocupado,
      // ya_respondio, clave_incorrecta…). Se propagan tal cual para que la
      // interfaz muestre el texto que ya está en español.
      const codigo = cuerpo?.message ?? `error_http_${res.status}`;
      return { error: codigo };
    }
    return { dato: cuerpo };
  } catch (e) {
    if (e?.name === 'AbortError') {
      return { error: 'El servidor tardó demasiado. Revisa tu conexión.' };
    }
    return { error: 'No se pudo conectar. Revisa tu conexión a internet.' };
  } finally {
    clearTimeout(reloj);
  }
}

/* ------------------------------------------------------------------ */
/* Traducción servidor → cliente                                       */
/* ------------------------------------------------------------------ */

function aMs(iso) {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convierte el JSON del servidor al `estado` que ya entiende la interfaz.
 * El motor del cliente espera `options: string[]` y `correctIdx: number`;
 * el servidor guarda `[{k,t}]` y `correct_key: 'a'`.
 */
export function estadoDesdeServidor(bruto, { completo = false } = {}) {
  if (!bruto) return null;

  const r = bruto.round;

  const players = (bruto.players ?? []).map(p => ({
    id: p.id,
    name: p.name,
    score: p.score ?? 0,
    totalMs: p.total_ms ?? 0,
    correct: p.correct ?? 0,
    joinedAt: aMs(p.joined_at) ?? 0,
    waiting: Boolean(p.waiting),
    kicked: false
  }));

  let round = null;
  if (r) {
    const opciones = Array.isArray(r.options) ? r.options : [];
    // `r.options` llega como [{k,t}, …] ya barajado. La clave de cada
    // posición es la ORIGINAL de esa opción: la posición 1 puede ser 'd'.
    const claves = opciones.map(o => (typeof o === 'string' ? null : o.k));
    // `correct_key` también es una clave original, no una posición.
    const idxCorrecto = r.correct_key ? claves.indexOf(r.correct_key) : -1;

    round = {
      id: r.round_id,
      ordinal: r.ordinal,
      prompt: r.prompt,
      reference: r.reference ?? null,
      options: opciones.map(o => (typeof o === 'string' ? o : o.t)),
      // La clave real de cada opción, en el orden en que se muestran. El
      // servidor baraja los objetos enteros, así que la opción de la
      // posición 1 puede tener clave 'd'. Sin esto el cliente enviaba la
      // letra de la POSICIÓN y el servidor la comparaba contra la clave
      // real: daba incorrecto siempre y nadie sumaba puntos.
      optionKeys: opciones.map(o => (typeof o === 'string' ? null : o.k)),
      // Solo viene cuando el servidor decide que ya se puede publicar.
      correctIdx: idxCorrecto >= 0 ? idxCorrecto : null,
      openedAt: aMs(r.opened_at),
      deadline: aMs(r.deadline),
      durationMs: (bruto.round_seconds ?? 15) * 1000,
      pausedAt: null,
      pausedTotal: 0,
      state: r.state,
      winnerId: r.winner_id ?? null,
      noWinner: Boolean(r.no_winner),
      answers: (r.answers ?? []).map(a => ({
        seq: a.seq,
        playerId: a.player_id,
        name: a.name ?? null,
        // `a.option` viene como clave original; se traduce a la POSICIÓN
        // en que esa opción se mostró, que es lo que pinta la interfaz.
        optionIdx: claves.indexOf(a.option),
        correct: Boolean(a.correct),
        elapsedMs: a.ms ?? 0
      }))
    };

    // `answered` es el número de respuestas; lo usamos para mostrar avance
    // sin necesidad de revelar quién respondió qué.
    round.answered = r.answered ?? round.answers.length;

    if (!completo) {
      // Proyección pública: el jugador nunca ve la correcta ni las
      // respuestas ajenas mientras la ronda está abierta.
      if (round.state !== 'revealed') {
        round.correctIdx = null;
        round.answers = [];
      }
    }
  }

  return {
    roomId: bruto.room_id,
    code: bruto.code,
    gameSlug: bruto.game_slug,
    status: bruto.status,
    paused: Boolean(bruto.paused),
    roundSeconds: bruto.round_seconds ?? 15,
    players,
    round,
    // Campos que el motor local usa y aquí no aplican: se dejan vacíos
    // para que nada acceda a undefined.
    plan: [],
    planIndex: 0,
    history: [],
    seq: round?.answers?.length ?? 0,
    online: true
  };
}

/* ------------------------------------------------------------------ */
/* Host en la nube                                                     */
/* ------------------------------------------------------------------ */

/**
 * Crea el host remoto. Mantiene la misma API que `crearHostLocal`.
 * `onEstado` recibe el estado ya traducido, igual que en local.
 */
export function crearHostNube({ topicId, onEstado, gameSlug = 'seleccion-simple' }) {
  let sala = null;          // { room_id, code, host_token }
  let estadoActual = null;
  let sondeo = null;
  let activo = true;

  async function refrescar() {
    if (!activo || !sala) return;
    const { dato, error } = await rpc('host_state', {
      p_room: sala.room_id,
      p_token: sala.host_token
    });
    if (!activo) return;
    if (error) {
      // Un fallo de red momentáneo no debe tumbar el panel: se reintenta
      // en el siguiente ciclo. El error real se ve en la consola.
      console.warn('[nube] host_state:', error);
      return;
    }
    estadoActual = estadoDesdeServidor(dato, { completo: true });
    onEstado?.(estadoActual);
  }

  function arrancarSondeo() {
    if (sondeo) return;
    sondeo = setInterval(refrescar, MS_SONDEO_HOST);
  }

  function parar() {
    activo = false;
    if (sondeo) { clearInterval(sondeo); sondeo = null; }
  }

  if (typeof addEventListener === 'function') {
    addEventListener('pagehide', parar, { once: true });
  }

  /** Envuelve una acción del host: llama la RPC y refresca el estado. */
  async function accion(nombre, args = {}) {
    if (!sala) return { error: 'La sala todavía no está creada.' };
    const { error } = await rpc(nombre, {
      p_room: sala.room_id,
      p_token: sala.host_token,
      ...args
    });
    if (error) return { error };
    await refrescar();
    return { error: null };
  }

  return {
    nube: true,

    /** Crea la sala en el servidor. Debe llamarse una vez. */
    async crear(cantidad = 10) {
      const { dato, error } = await rpc('host_create_room', {
        p_topic: topicId,
        p_game_slug: gameSlug
      });
      if (error) return { error };

      sala = { room_id: dato.room_id, code: dato.code, host_token: dato.host_token };
      await rpc('host_set_plan', {
        p_room: sala.room_id,
        p_token: sala.host_token,
        p_count: cantidad
      });
      await refrescar();
      arrancarSondeo();
      return { error: null, code: dato.code, roomId: dato.room_id };
    },

    // Se conservan por compatibilidad con la interfaz: en la nube el plan
    // ya se fijó al crear la sala.
    roomId: () => sala?.room_id ?? null,
    code: () => sala?.code ?? null,
    estado: () => estadoActual,

    iniciar: () => accion('host_iniciar'),
    abrir: () => accion('host_open_question'),
    cerrar: () => accion('host_close_round'),
    revelar: () => accion('host_revelar'),
    pausar: () => accion('host_pause'),
    reanudar: () => accion('host_resume'),
    saltar: () => accion('host_skip_question'),
    repetir: () => accion('host_repeat_question'),
    deshacer: () => accion('host_undo'),
    terminar: () => accion('host_end_game'),
    expulsar: (id) => accion('host_remove_player', { p_player: id }),
    admitir: (id) => accion('host_admit_player', { p_player: id }),

    activo: () => activo,
    destruir: parar,
    refrescar
  };
}

/* ------------------------------------------------------------------ */
/* Jugador en la nube                                                  */
/* ------------------------------------------------------------------ */

export function crearClienteNube({ onEstado } = {}) {
  let jugador = null;       // { id, token }
  let sondeo = null;
  let activo = true;
  let salaId = null;

  async function refrescar() {
    if (!activo || !salaId) return;
    const { dato, error } = await rpc('room_state', { p_room: salaId });
    if (!activo || error) return;
    onEstado?.(estadoDesdeServidor(dato, { completo: false }), jugador);
  }

  function parar() {
    activo = false;
    if (sondeo) { clearInterval(sondeo); sondeo = null; }
  }

  if (typeof addEventListener === 'function') {
    addEventListener('pagehide', parar, { once: true });
  }

  return {
    nube: true,

    /** Entra a la sala con un código y un nombre. */
    async unirse(codigo, nombre) {
      const { dato, error } = await rpc('player_join', {
        p_code: String(codigo ?? '').trim().toUpperCase(),
        p_name: String(nombre ?? '').trim()
      });
      if (error) return { error };

      jugador = { id: dato.player_id, token: dato.player_token };
      salaId = dato.room_id;
      await refrescar();

      if (!sondeo) {
        // Jitter: 200 teléfonos que consultan al mismo instante golpean
        // el servidor de golpe. Cada uno espera un poco distinto.
        const desfase = Math.floor(Math.random() * 400);
        setTimeout(() => {
          if (!activo) return;
          sondeo = setInterval(refrescar, MS_SONDEO_JUGADOR);
        }, desfase);
      }
      return { error: null, ...dato };
    },

    /** Responde la ronda en curso. */
    async responder(roundId, claveLetra) {
      if (!jugador) return { error: 'No estás dentro de una sala.' };
      const { dato, error } = await rpc('player_answer', {
        p_player: jugador.id,
        p_token: jugador.token,
        p_round: roundId,
        p_option: claveLetra
      });
      if (error) return { error };
      await refrescar();
      return { error: null, seq: dato?.seq };
    },

    pedirEstado: refrescar,
    id: () => jugador?.id ?? null,
    cerrar: parar
  };
}

/* ------------------------------------------------------------------ */
/* Administración: temas y preguntas (requiere clave maestra)          */
/* ------------------------------------------------------------------ */

export const admin = {
  async comprobarClave(clave) {
    const { error } = await rpc('admin_check_key', { p_key: clave });
    return { error };
  },

  async cambiarClave(anterior, nueva) {
    const { error } = await rpc('admin_change_key', { p_old: anterior, p_new: nueva });
    return { error };
  },

  async temas(gameSlug = 'seleccion-simple') {
    const { dato, error } = await rpc('topic_list', { p_game_slug: gameSlug });
    return error ? { error } : { temas: dato ?? [] };
  },

  async crearTema(clave, nombre, gameSlug = 'seleccion-simple') {
    const { dato, error } = await rpc('topic_create', {
      p_key: clave, p_name: nombre, p_game_slug: gameSlug
    });
    return error ? { error } : { tema: dato };
  },

  async renombrarTema(clave, id, nombre) {
    const { error } = await rpc('topic_rename', { p_key: clave, p_topic: id, p_name: nombre });
    return { error };
  },

  async borrarTema(clave, id) {
    const { error } = await rpc('topic_delete', { p_key: clave, p_topic: id });
    return { error };
  },

  async preguntas(clave, topicId) {
    const { dato, error } = await rpc('question_list', { p_key: clave, p_topic: topicId });
    return error ? { error } : { preguntas: dato ?? [] };
  },

  /** p_correct es el índice 0..3 dentro de `opciones`. */
  async guardarPregunta(clave, { topicId, id = null, enunciado, opciones, indiceCorrecto, referencia = null }) {
    const { dato, error } = await rpc('question_save', {
      p_key: clave,
      p_topic: topicId,
      p_question: id,
      p_prompt: enunciado,
      p_options: opciones,
      p_correct: indiceCorrecto,
      p_reference: referencia
    });
    return error ? { error } : { pregunta: dato };
  },

  async borrarPregunta(clave, id) {
    const { error } = await rpc('question_delete', { p_key: clave, p_question: id });
    return { error };
  }
};
