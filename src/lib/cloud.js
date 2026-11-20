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
import { normalizarCodigo } from './util.js';

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

/*
 * Desfase entre el reloj de ESTE teléfono y el del servidor.
 *
 * El servidor manda `opened_at` y `deadline` con SU reloj, y el navegador
 * calcula el tiempo restante restando contra `Date.now()`. Si el teléfono va
 * atrasado —se midió uno 38 s en este proyecto— la resta da negativo y el
 * temporizador se queda congelado hasta que el reloj del teléfono alcanza el
 * `opened_at` del servidor. El presentador lo ve como «tarda 10 segundos en
 * arrancar» y no es la red: es que los dos relojes no coinciden.
 *
 * La cabecera `Date` de la respuesta HTTP trae la hora del servidor en cada
 * consulta. Comparando con el momento de recibirla se obtiene el desfase sin
 * necesitar una llamada extra, y se corrige una sola vez (una media móvil
 * suave, para no reaccionar a un pico de red).
 */
let desfaseRelojMs = 0;
let desfaseMedido = false;

/** Hora «del servidor» según el último desfase conocido. */
export function ahoraServidor() {
  return Date.now() + desfaseRelojMs;
}

/** El desfase detectado, para diagnóstico. */
export function desfaseConServidor() {
  return { ms: Math.round(desfaseRelojMs), medido: desfaseMedido };
}

function aprenderDesfase(res, enviadoEn) {
  const cabecera = res.headers?.get?.('date');
  if (!cabecera) return;
  const servidor = Date.parse(cabecera);
  if (!Number.isFinite(servidor)) return;

  // La cabecera `Date` tiene resolución de un segundo y el viaje de ida y
  // vuelta se come parte del intervalo: se toma el punto medio del viaje
  // como instante local equivalente.
  const medio = (enviadoEn + Date.now()) / 2;
  const desfase = servidor - medio;

  // Se descartan lecturas absurdas (un reloj muy roto o una respuesta
  // cacheada de hace horas) en vez de corregir con ellas.
  if (Math.abs(desfase) > 6 * 60 * 60 * 1000) return;

  // Media móvil: la primera medida entra completa y las siguientes pesan
  // poco, así un pico de red no mueve el reloj de golpe.
  desfaseRelojMs = desfaseMedido ? desfaseRelojMs * 0.7 + desfase * 0.3 : desfase;
  desfaseMedido = true;
}

/**
 * El desfase para lo que se mueve en pantalla: el ÚLTIMO valor congelado.
 *
 * POR QUÉ HACE FALTA SEPARARLOS
 *
 * El desfase sirve para dos cosas distintas, y una sola cifra no sirve para
 * las dos:
 *
 *   1. Poner en hora los instantes que llegan del servidor (`openedAt`, la
 *      marca en que arrancó la ronda). Ahí conviene el mejor valor posible,
 *      y tiene que seguir aprendiéndose: si se congela, la ronda arranca
 *      corrida para siempre.
 *   2. Mover una barra que baja durante 15 o 30 segundos. Ahí lo que importa
 *      no es la exactitud sino la ESTABILIDAD: si la cifra cambia a mitad de
 *      la ronda, la barra salta.
 *
 * Y la cabecera `Date` del HTTP solo tiene resolución de UN SEGUNDO. Medido
 * contra el servidor real: siempre llega en `.000`, con el instante verdadero
 * en algún punto de ese segundo. Así que cada medición trae hasta un segundo
 * de ruido, y el desfase aprendido va saltando dentro de esa ventana.
 * Repartido entre varias consultas del sondeo —cada 900 ms— eso mueve el
 * origen de la ronda, y la barra retrocede de golpe.
 *
 * Medido con el ruido real: 1 retroceso de 693 ms en 4 segundos de ronda.
 * Con un reloj limpio, 0. Eso es exactamente la «mini pausa» que se veía al
 * pasar cada segundo: no era el dibujado, era el origen del tiempo.
 *
 * La solución es la misma que un reloj de pared y una radio: se sincroniza
 * UNA vez, al llegar, y después se deja correr. Al arrancar una ronda se fija
 * el desfase del momento, y no se vuelve a tocar hasta la ronda siguiente.
 */
let desfaseCongeladoMs = 0;
let congeladoPara = null;   // el `openedAt` de la ronda a la que pertenece

/**
 * Fija el desfase que usarán los cálculos de la ronda en curso.
 *
 * Se llama con la marca de arranque de la ronda. El mismo `openedAt` no
 * vuelve a congelar nada: así el sondeo, que trae el mismo valor cada vez,
 * no reinicia el reloj a mitad de camino.
 *
 * @param {number|null} openedAt la marca de arranque que trae el servidor
 */
export function fijarDesfaseDeRonda(openedAt) {
  const clave = openedAt == null ? null : String(openedAt);
  if (clave === congeladoPara) return desfaseCongeladoMs;
  congeladoPara = clave;
  desfaseCongeladoMs = desfaseRelojMs;
  return desfaseCongeladoMs;
}

/** El desfase congelado, para diagnóstico. */
export function desfaseCongelado() {
  return { ms: Math.round(desfaseCongeladoMs), para: congeladoPara };
}

/** Llama a una función RPC de Supabase y normaliza los errores. */
export async function rpc(nombre, args = {}) {
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), MS_TOPE_PETICION);
  const enviadoEn = Date.now();
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nombre}`, {
      method: 'POST',
      headers: CABECERAS,
      body: JSON.stringify(args),
      signal: corte.signal
    });

    aprenderDesfase(res, enviadoEn);

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
 * Convierte una hora DEL SERVIDOR al reloj de este teléfono.
 *
 * Hace falta porque la resta del temporizador se hace contra `Date.now()`, y
 * con 38 s de desfase (medido en este proyecto) el reloj arrancaba congelado.
 * Restarle el desfase deja `openedAt` en la misma escala que el reloj local,
 * así que el tiempo restante sale bien aunque el teléfono vaya mal.
 */
function aMsLocal(iso, { congelado = false } = {}) {
  const n = aMs(iso);
  if (n == null) return null;
  // Los instantes que mueven la barra usan el desfase CONGELADO, para que el
  // ruido de un segundo de la cabecera `Date` no la haga retroceder. El resto
  // (marcas de llegada, puntajes) usa el valor vivo, que es el más exacto.
  const d = congelado ? desfaseCongeladoMs : desfaseRelojMs;
  return n - d;
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
      // El bloque del juego de versículos, tal cual lo manda el servidor.
      // Sin esta línea se descartaba aquí y la pantalla mostraba «0 de 0»:
      // el dato existía en la respuesta y se perdía al traducirla.
      versiculo: r.versiculo ?? null,
      // La marca de arranque de la ronda. Con este valor se FIJA el desfase
      // que moverá la barra durante toda la ronda: se congela aquí, una sola
      // vez, y no se vuelve a tocar hasta la ronda siguiente. Sin esto, cada
      // sondeo re-aprendía el desfase —con el ruido de un segundo de la
      // cabecera `Date`— y la barra retrocedía de golpe a mitad de camino.
      // Medido: 693 ms de retroceso; con el reloj limpio, cero.
      openedAt: (() => {
        const bruto = aMs(r.opened_at ?? r.openedAt ?? null);
        return bruto == null ? null : bruto - fijarDesfaseDeRonda(bruto);
      })(),
      deadline: aMsLocal(r.deadline, { congelado: true }),
      // La vista del presentador lee `deadlineMs` (es el nombre que usa el
      // motor local y `estadoVisible`). Aquí solo se publicaba `durationMs`,
      // así que `segundos(undefined)` daba NaN y la cabecera mostraba
      // «Lista · NaNs». Se emiten los dos nombres: uno es el contrato de la
      // interfaz y el otro lo sigue usando el cálculo del reloj.
      deadlineMs: (bruto.round_seconds ?? 15) * 1000,
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
    // Solo el presentador recibe estos dos: `huecos` diría la respuesta
    // antes de destaparla, y `turno_answer_id` a quién le toca. En la vista
    // del jugador llegan undefined y la interfaz no los usa.
    huecos: (bruto.huecos ?? []).map(h => ({
      indice: h.indice,
      respuesta: h.respuesta,
      revelado: Boolean(h.revelado),
      ganoNombre: h.gano_nombre ?? null
    })),
    turnoAnswerId: bruto.turno_answer_id ?? null,
    status: bruto.status,
    paused: Boolean(bruto.paused),
    // Por qué se cerró la sala, cuando lo decidió el servidor y no el
    // presentador: hoy solo 'inactividad'. Null = la cerró el presentador.
    closeReason: bruto.close_reason ?? null,
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
    async crear(cantidad = 10, segundosRonda = 15) {
      const { dato, error } = await rpc('host_create_room', {
        p_topic: topicId,
        p_game_slug: gameSlug,
        // Segundos por pregunta. El servidor valida 5–30; se manda lo que
        // eligió el presentador, no un valor fijo.
        p_round_seconds: segundosRonda
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
      return { error: null, code: dato.code, roomId: dato.room_id, hostToken: dato.host_token };
    },

    /**
     * Vuelve a la sala tras recargar la página del presentador, sin crear
     * otra ni perder los participantes. Refrescar no debe costarle la
     * partida a quien la dirige.
     */
    async reabrir({ roomId, hostToken, code }) {
      if (!roomId || !hostToken) return { error: 'sesion_incompleta' };
      sala = { room_id: roomId, host_token: hostToken, code };

      const { error } = await rpc('host_state', { p_room: roomId, p_token: hostToken });
      // Si el servidor ya no reconoce el token, la sala se perdió de verdad.
      if (error) return { error };

      activo = true;
      await refrescar();
      if (!sondeo) arrancarSondeo();
      return { error: null, code: sala.code, roomId };
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
    /**
     * Cambia la pregunta en pantalla por otra del banco, manteniendo el
     * MISMO turno: la ronda y su número no cambian, solo la pregunta.
     */
    cambiarPregunta: () => accion('host_cambiar_pregunta'),
    repetir: () => accion('host_repeat_question'),
    deshacer: () => accion('host_undo'),
    terminar: () => accion('host_end_game'),
    /**
     * Cierra la sala antes de tiempo (el presentador se va). No hay podio:
     * el servidor la pasa a 'closed' y los jugadores dejan de poder entrar.
     * Se detiene el sondeo pase lo que pase: si la llamada falla, seguir
     * consultando una sala que ya nadie dirige no arregla nada.
     */
    cerrarSala: async () => {
      const r = await accion('host_close_room');
      parar();
      return r;
    },
    expulsar: (id) => accion('host_remove_player', { p_player: id }),
    admitir: (id) => accion('host_admit_player', { p_player: id }),

    /* --- completar el versículo -------------------------------------- */

    /**
     * Cierra la ventana de pulsaciones y abre el juicio.
     *
     * Es lo mismo que hace el servidor al vencer el reloj, así que el
     * presentador puede adelantarlo sin dejar la ronda en otro estado.
     */
    cerrarPulsaciones: () => accion('host_cerrar_pulsaciones'),

    /**
     * Sentencia al que tiene el turno.
     *
     * `huecos` son los índices que el participante dijo bien; el servidor
     * ignora el arreglo cuando `correcto` es false.
     */
    sentenciar: (answerId, correcto, huecos = []) => accion('host_sentenciar', {
      p_answer: answerId,
      p_correcto: correcto,
      p_huecos: huecos
    }),

    /** Deshace la última sentencia completa, no el último toque. */
    deshacerSentencia: () => accion('host_deshacer_sentencia'),

    /** Termina la ronda sin completar el versículo, conservando lo ganado. */
    cerrarPregunta: () => accion('host_cerrar_pregunta'),

    /** Vuelve a soltar el temporizador con la lista limpia. */
    reabrirPulsaciones: () => accion('host_reabrir_pulsaciones'),

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
        // El código se dicta y se muestra espaciado («B 7 3 W S»): se manda
        // limpio o el servidor no encuentra la sala.
        p_code: normalizarCodigo(codigo),
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

    /**
     * Vuelve a la partida tras recargar la página, sin pedir el nombre otra
     * vez. Un refresco no debe dejar a nadie fuera: la sesión ya está
     * guardada, solo hay que reconectar el sondeo con los datos que ya
     * tenemos. Si el servidor ya no conoce al jugador, devuelve error y la
     * interfaz vuelve a pedir el nombre.
     */
    async reanudar({ playerId, token, roomId }) {
      if (!playerId || !token || !roomId) return { error: 'sesion_incompleta' };
      jugador = { id: playerId, token };
      salaId = roomId;

      const { dato, error } = await rpc('room_state', { p_room: roomId });
      // Un fallo de red NO significa que la sesión murió: se marca como
      // transitorio para que quien llama reintente en vez de expulsar.
      if (error) return { error, transitorio: true };

      // ¿sigue este jugador en la sala? Si lo expulsaron o la sala ya no
      // existe, no se reanuda nada.
      const sigo = (dato?.players ?? []).some(p => p.id === playerId);
      if (!sigo) return { error: 'jugador_ausente' };

      activo = true;
      onEstado?.(estadoDesdeServidor(dato, { completo: false }), jugador);
      if (!sondeo) sondeo = setInterval(refrescar, MS_SONDEO_JUGADOR);
      return { error: null };
    },

    /**
     * Pulsa el botón negro de completar el versículo.
     *
     * No es una respuesta: es tomar el turno. El servidor anota el orden
     * con la secuencia monotónica y devuelve cuál le tocó.
     */
    async pulsar(roundId) {
      if (!jugador) return { error: 'No estás dentro de una sala.' };
      const { dato, error } = await rpc('player_pulsar', {
        p_player: jugador.id,
        p_token: jugador.token,
        p_round: roundId
      });
      if (error) return { error };
      await refrescar();
      return { error: null, seq: dato?.seq, orden: dato?.orden };
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
/* Televisor: mirar una sala sin ser jugador                           */
/* ------------------------------------------------------------------ */

/**
 * Convierte un código en la sala del servidor.
 * Devuelve `{ error }` o `{ roomId, code, status }`. El servidor solo
 * publica el id, el código y el estado: ni jugadores ni la correcta, porque
 * esta consulta la puede hacer cualquiera que vea el televisor.
 */
export async function resolverSala(codigo) {
  const limpio = normalizarCodigo(codigo);
  if (!limpio) return { error: 'codigo_vacio' };

  const { dato, error } = await rpc('room_by_code', { p_code: limpio });
  if (error) return { error };
  if (!dato?.room_id) return { error: 'sala_inexistente' };

  return {
    roomId: dato.room_id,
    code: dato.code ?? limpio,
    status: dato.status
  };
}

/**
 * Sonda una sala SIN jugador: el televisor no ocupa puesto ni tiene token.
 * Usa `room_state`, la misma proyección pública que ve un participante, así
 * que nunca llega la respuesta correcta antes de revelarla.
 *
 * Devuelve el mando del sondeo. Quien llama debe soltarlo con `parar()`
 * (al cerrar la pestaña y al salir de la pantalla); si no, el televisor
 * sigue consultando para siempre desde una pantalla que ya nadie mira.
 */
export function mirarSala(roomId, { onEstado } = {}) {
  let activo = true;
  let sondeo = null;
  let ultimo = null;

  async function refrescar() {
    if (!activo || !roomId) return null;
    const { dato, error } = await rpc('room_state', { p_room: roomId });
    if (!activo) return null;

    if (error) {
      ultimo = error;
      console.warn('[nube] room_state (televisor):', error);
      // Una sala que ya no existe no va a aparecer por seguir preguntando.
      if (error === 'sala_inexistente') parar();
      return null;
    }

    ultimo = null;
    const estado = estadoDesdeServidor(dato, { completo: false });
    onEstado?.(estado);

    // Sala cerrada: el presentador se fue. No hay nada más que esperar y
    // seguir consultando solo gastaría batería y datos.
    if (estado?.status === 'closed') parar();
    return estado;
  }

  function parar() {
    activo = false;
    if (sondeo) { clearInterval(sondeo); sondeo = null; }
  }

  const primero = refrescar().then(estado => {
    if (!activo || sondeo) return estado;
    // Jitter: varios televisores encendidos a la vez no deben consultar al
    // mismo instante.
    const desfase = Math.floor(Math.random() * 400);
    setTimeout(() => {
      if (activo && !sondeo) sondeo = setInterval(refrescar, MS_SONDEO_JUGADOR);
    }, desfase);
    return estado;
  });

  // Igual que el resto de los transportes: al abandonar la página se suelta
  // todo solo. Una pestaña que se va no debe dejar un sondeo corriendo.
  if (typeof addEventListener === 'function') {
    addEventListener('pagehide', parar, { once: true });
  }

  return {
    nube: true,
    /** Estado de la primera consulta, para saber si la sala se abrió. */
    primero,
    refrescar,
    parar,
    activo: () => activo,
    /** Último error del sondeo, útil cuando la primera consulta falla. */
    ultimoError: () => ultimo
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

  /**
   * ¿Hay clave configurada? ¿Está bloqueada por intentos fallidos?
   *
   * La pantalla de configuraciones decía «La clave está configurada» mirando
   * si Supabase estaba configurado, que es otra cosa. Con esto dice la verdad,
   * y el modal sabe si debe pedir la clave actual o no.
   */
  async estadoClave() {
    const { dato, error } = await rpc('admin_key_status');
    return error ? { error } : { estado: dato ?? null };
  },

  /**
   * El lema y la portada del menú. Público: se lee sin clave.
   *
   * Cualquier campo en `null` significa «todavía no se cambió», y la app usa
   * el texto o el archivo que trae el código. Así una instalación nueva se ve
   * igual que siempre sin que nadie configure nada.
   */
  async marca() {
    const { dato, error } = await rpc('branding_get');
    return error ? { error } : { marca: dato ?? null };
  },

  async cambiarLema(clave, lema) {
    const { dato, error } = await rpc('branding_set_lema', { p_key: clave, p_lema: lema });
    return error ? { error } : { marca: dato };
  },

  /** `data` es el webp en base64, con o sin el prefijo `data:`. */
  async cambiarPortada(clave, data) {
    const { dato, error } = await rpc('branding_set_portada', { p_key: clave, p_data: data });
    return error ? { error } : { marca: dato };
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
  },

  /* ------------------------------------------------------------------ */
  /* Versículos (Completar el versículo)                                */
  /* ------------------------------------------------------------------ */
  /* No usan `question_save`: esa exige cuatro opciones y una correcta, y un
   * versículo no tiene opciones. Sus huecos van dentro del texto, con
   * formato `{palabra}`, en `texto_marcado`. */

  /** Guarda un versículo. `pregunta` es el id si se está editando. */
  async guardarVersiculo(clave, { topicId, id = null, textoMarcado, referencia = null }) {
    const { dato, error } = await rpc('versiculo_save', {
      p_key: clave,
      p_topic: topicId,
      p_question: id,
      p_marcado: textoMarcado,
      p_reference: referencia
    });
    return error ? { error } : { versiculo: dato };
  },

  async borrarVersiculo(clave, id) {
    const { error } = await rpc('versiculo_delete', { p_key: clave, p_question: id });
    return { error };
  }
};
