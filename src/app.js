/* =====================================================================
   Desafío Bíblico — aplicación
   ---------------------------------------------------------------------
   Una sola página, tres vistas: menú, presentador, jugador, televisor.
   Modo local: funciona ya, sin cuentas ni configuración.
   Modo nube: se activa cuando hay credenciales de Supabase.
   ===================================================================== */

import { BANCO } from './lib/bank.js';
import * as E from './lib/engine.js';
import {
  esc, validarNombre, segundos, EMOJI, normalizeName
} from './lib/util.js';
import { crearHostLocal, crearClienteLocal, esLocalDisponible } from './lib/local.js';
import { qrSVG } from './lib/qr.js';

const $app = document.getElementById('app');

/* ------------------------------------------------------------------ */
/* Navegación por hash                                                 */
/* ------------------------------------------------------------------ */
/**
 * URL que se comparte por QR. Lleva el código en el hash para que al
 * escanear se entre directo a esa sala.
 */
function urlSala(codigo) {
  const base = location.origin + location.pathname;
  return `${base}#/join?c=${encodeURIComponent(codigo)}`;
}

/** Lee ?c=CODIGO del hash. */
function codigoDeUrl() {
  const m = location.hash.match(/[?&]c=([A-Z0-9]+)/i);
  return m ? m[1].toUpperCase() : null;
}

function rutaActual() {
  const h = location.hash.replace(/^#\/?/, '');
  const [vista, ...resto] = h.split('/');
  return { vista: vista || 'menu', params: resto };
}

function ir(vista) {
  location.hash = '#/' + vista;
}

window.addEventListener('hashchange', render);

/* ------------------------------------------------------------------ */
/* Estado de la aplicación                                             */
/* ------------------------------------------------------------------ */
const app = {
  host: null,        // instancia del host local (solo presentador)
  cliente: null,     // instancia del cliente local (jugador/televisor)
  estado: null,      // último estado recibido
  yo: null,          // { playerId, name, roomCode }
  revision: 0,       // para evitar renders redundantes
  aviso: null,       // { tipo, texto }
  cerrarConfirm: false,
  podioPaso: 0,      // 0 = oculto, 1 = 3.º, 2 = 2.º, 3 = 1.º
  miRespuesta: null, // { roundId, idx } — lo que este teléfono ya contestó
  cantidadPreguntas: 10
};

const CLAVE_SESION = 'desafio-biblico-sesion';

function guardarSesion() {
  try {
    if (app.yo) localStorage.setItem(CLAVE_SESION, JSON.stringify(app.yo));
    else localStorage.removeItem(CLAVE_SESION);
  } catch { /* modo privado: la sesión vive solo en memoria */ }
}

function leerSesion() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_SESION) || 'null');
  } catch { return null; }
}

/* ------------------------------------------------------------------ */
/* Componentes reutilizables                                           */
/* ------------------------------------------------------------------ */

function ayuda(texto) {
  return `<span class="ayuda" tabindex="0" role="button"
    aria-label="Ayuda: ${esc(texto)}" data-tip="${esc(texto)}">?</span>`;
}

function avisoHTML() {
  if (!app.aviso) return '';
  return `<div class="aviso ${app.aviso.tipo}">${esc(app.aviso.texto)}</div>`;
}

/**
 * Barra de salida. Toda pantalla la lleva: ninguna vista deja al usuario
 * sin camino de vuelta.
 */
function barraVolver({ aMenu = true, salirHost = false, extra = '' } = {}) {
  const volver = salirHost
    ? `<button class="boton boton-secundario" data-accion="salir-host">← Menú</button>`
    : `<button class="boton boton-secundario" data-ir="menu">← Menú</button>`;
  return `<div class="fila-entre barra-volver">${volver}${extra}</div>`;
}

function ponerAviso(tipo, texto, ms = 4000) {
  app.aviso = { tipo, texto };
  render();
  if (ms) setTimeout(() => { app.aviso = null; render(); }, ms);
}

/**
 * Fila de la tabla de clasificación.
 * Una sola grilla, un solo eje: puesto, nombre y puntaje centrados entre sí.
 * La caja del puesto tiene ancho fijo, así la medalla y el número ocupan
 * lo mismo y la columna no se mueve según el puesto.
 */
function filaClasificacion({ position, name, subtitle, score, yo }) {
  const medalla = position <= 3 ? EMOJI[position] : null;
  return `
    <li class="fila-clasif${yo ? ' yo' : ''}">
      <div class="puesto">
        ${medalla
          ? `<span class="emoji" aria-hidden="true">${medalla}</span>`
          : `<span class="num">${position}</span>`}
        <span class="sr-solo">Puesto ${position}:</span>
      </div>
      <div class="datos">
        <span class="nombre">${esc(name)}</span>
        ${subtitle ? `<span class="sub">${esc(subtitle)}</span>` : ''}
      </div>
      <div class="puntos">${score}</div>
    </li>`;
}

/* ------------------------------------------------------------------ */
/* VISTA: menú                                                         */
/* ------------------------------------------------------------------ */
function vistaMenu() {
  const juegos = [
    { slug: 'seleccion-simple', icono: '🎯', nombre: 'Selección simple',
      desc: 'Una pregunta, cuatro opciones y una sola correcta. Gana el primero que acierta.',
      listo: true },
    { slug: 'completar-versiculo', icono: '📖', nombre: 'Completar el versículo',
      desc: 'Se muestra un versículo con un hueco y hay que completarlo.', listo: false },
    { slug: 'respuesta-abierta', icono: '💬', nombre: 'Respuesta abierta',
      desc: 'El presentador lee la pregunta y cada quien escribe su respuesta.', listo: false }
  ];

  return `
    <header class="menu-cabecera">
      <div class="portada">
        <img src="public/img/portada.webp" alt="Desafío Bíblico 2026 — 2 Corintios"
             fetchpriority="high" decoding="async">
      </div>
    </header>

    <main class="crecer columna" style="gap:1.2rem; margin-top:1.4rem">
      <div class="columna" style="gap:.6rem">
        <button class="boton-grande" data-ir="host">🎤 Soy el presentador</button>
        <button class="boton-grande boton-secundario" data-ir="join">🙋 Soy participante</button>
        <button class="boton boton-secundario" data-ir="tv" style="width:100%">
          📺 Pantalla para el televisor
        </button>
      </div>

      <div class="columna" style="gap:.7rem; margin-top:.5rem">
        <h2 style="font-size:var(--t-lg); margin:0">Juegos</h2>
        ${juegos.map(j => `
          <button class="juego-card${j.listo ? ' listo' : ''}" ${j.listo ? '' : 'disabled'}>
            <span class="icono" aria-hidden="true">${j.icono}</span>
            <span class="columna" style="gap:.15rem; flex:1">
              <span>${esc(j.nombre)}</span>
              <span class="chico tenue">${esc(j.desc)}</span>
              <span class="etiqueta">${j.listo ? 'Disponible' : 'Próximamente'}</span>
            </span>
          </button>`).join('')}
      </div>

      <p class="mini tenue centro" style="text-align:center; margin-top:auto; padding-top:1rem">
        ${esLocalDisponible()
          ? 'Modo local activo: funciona sin internet.'
          : 'Tu navegador no admite el modo local.'}
      </p>
    </main>`;
}

/* ------------------------------------------------------------------ */
/* VISTA: presentador                                                  */
/* ------------------------------------------------------------------ */
function vistaHost() {
  const s = app.estado;

  if (!s) {
    return `
      <div class="fila-entre">
        <button class="boton boton-secundario" data-ir="menu">← Volver</button>
      </div>
      <main class="crecer columna centro" style="gap:1.2rem">
        <h1>Panel del presentador</h1>
        <p class="tenue" style="text-align:center; max-width:34ch">
          Crea la sala. Los participantes entrarán con un código.
        </p>
        <div class="campo" style="max-width:240px; width:100%">
          <label for="cant">Preguntas en esta partida ${ayuda('Se eligen al azar entre las ' + BANCO.length + ' disponibles, empezando por las que hace más tiempo no se juegan.')}</label>
          <select id="cant">
            ${[5, 10, 15, 20, 25].map(n =>
              `<option value="${n}" ${n === app.cantidadPreguntas ? 'selected' : ''}>${n} preguntas</option>`).join('')}
          </select>
        </div>
        ${avisoHTML()}
        <button class="boton-grande" data-accion="crear-sala" style="max-width:320px">
          Crear sala
        </button>
      </main>`;
  }

  const r = s.round;
  const enPausa = s.paused;
  const jugando = s.players.filter(p => !p.waiting);
  const espera = s.players.filter(p => p.waiting);

  /* --- ceremonia: tabla de clasificación escalonada --- */
  if (s.status === 'ceremony') {
    return vistaCeremonia(s);
  }

  return `
    <div class="fila-entre">
      <button class="boton boton-secundario" data-accion="salir-host">← Menú</button>
      <span class="fila chico">
        <span class="punto-vivo"></span> En línea
      </span>
    </div>

    <main class="crecer columna" style="gap:1rem; margin-top:1rem">

      <div class="columna centro" style="gap:.4rem">
        <span class="mini tenue">Código de la sala</span>
        <div class="codigo-sala">${esc(s.code)}</div>
        <div class="qr-caja" title="Escanéalo para entrar a la sala">
          ${qrSVG(urlSala(s.code), { nivel: 'M', escala: 6, margen: 3 })}
        </div>
        <p class="mini tenue" style="text-align:center; margin:0">
          Escanea el QR o escribe el código
        </p>
        <span class="chico tenue">${jugando.length} participante${jugando.length === 1 ? '' : 's'}</span>
      </div>

      ${avisoHTML()}

      ${!r ? `
        <div class="columna" style="gap:.8rem; margin-top:.5rem">
          <div class="aviso info">
            Lista para empezar: ${app.cantidadPreguntas} preguntas preparadas.
          </div>
          <button class="boton-grande" data-accion="abrir">Empezar la primera pregunta</button>
        </div>
      ` : `
        <!-- LA RONDA: prepared → open → closed → revealed -->
        <div class="columna" style="gap:.7rem">
          <div class="fila-entre">
            <span class="mini tenue">Pregunta ${r.ordinal}</span>
            ${estadoRelojHTML(r, enPausa)}
          </div>

          ${r.state === 'open' && !enPausa ? barraTiempoHTML(r) : ''}

          <p class="enunciado">${esc(r.prompt)}</p>
          ${r.reference ? `<p class="chico tenue centro" style="text-align:center; margin-top:-.6rem">${esc(r.reference)}</p>` : ''}
        </div>

        <!-- opciones: el presentador ve la correcta siempre -->
        <div class="opciones">
          ${r.options.map((o, i) => `
            <div class="opcion${i === r.correctIdx ? ' correcta' : ''}" role="presentation">
              <span class="letra">${'ABCD'[i]}</span>
              <span>${esc(o)}</span>
              ${i === r.correctIdx ? '<span style="margin-left:auto">✓</span>' : ''}
            </div>`).join('')}
        </div>

        <!-- respuestas en vivo -->
        ${r.state === 'prepared' ? `
          <div class="aviso info">
            Lee la pregunta y las cuatro opciones en voz alta.
            Cuando estés listo, pulsa <strong>Iniciar</strong>.
          </div>
        ` : `
          <div class="columna" style="gap:.4rem">
            <div class="fila-entre">
              <h3 style="font-size:var(--t-sm); margin:0">
                Respuestas en vivo
                ${ayuda('Solo tú ves esta lista. Los participantes no saben quién respondió ni en qué orden.')}
              </h3>
              <span class="mini tenue">${r.answered} respondieron</span>
            </div>
            <div id="respuestas">
              ${r.answers?.length
                ? `<ul class="lista-jugadores">${r.answers.map(a => `
                    <li>
                      <span class="nombre-j">${a.seq}. ${esc(a.name)}</span>
                      <span class="mini ${a.correct ? 'ok-txt' : 'tenue'}">
                        ${'ABCD'[a.optionIdx]} · ${(a.elapsedMs / 1000).toFixed(1)}s
                      </span>
                    </li>`).join('')}</ul>`
                : '<p class="mini tenue">Aún nadie responde.</p>'}
            </div>
          </div>
        `}

        <!-- controles según el estado -->
        ${controlesHostHTML(r, enPausa)}
      `}

      <!-- participantes -->
      <div class="columna" style="gap:.5rem; margin-top:.6rem">
        <h3 style="font-size:var(--t-sm); margin:0">Participantes</h3>
        ${jugando.length === 0
          ? '<p class="mini tenue">Nadie ha entrado todavía. Comparte el código.</p>'
          : `<ul class="lista-jugadores">${jugando.map(p => `
              <li>
                <span class="nombre-j">${esc(p.name)}</span>
                <span class="chico tenue">${p.score} pt${p.score === 1 ? '' : 's'}</span>
                <button class="mini-btn" data-accion="expulsar" data-id="${p.id}"
                  title="Retirar de la sala">✕</button>
              </li>`).join('')}</ul>`}
        ${espera.length ? `
          <h3 style="font-size:var(--t-sm); margin:.6rem 0 0">
            En sala de espera
            ${ayuda('Entraron con la partida ya empezada. Puedes admitirlos para que jueguen desde la próxima pregunta.')}
          </h3>
          <ul class="lista-jugadores">${espera.map(p => `
            <li>
              <span class="nombre-j">${esc(p.name)}</span>
              <button class="mini-btn ok" data-accion="admitir" data-id="${p.id}">Admitir</button>
            </li>`).join('')}</ul>` : ''}
      </div>

      <div class="fila-entre" style="margin-top:auto; padding-top:1rem">
        <button class="boton boton-peligro" data-accion="pedir-terminar">
          Terminar el juego
          ${ayuda('Cierra la partida y muestra la tabla de clasificación. Te pedirá confirmar.')}
        </button>
      </div>
    </main>

    ${app.cerrarConfirm ? modalConfirmarCierre() : ''}`;
}


/* ------------------------------------------------------------------ */
/* Piezas del panel del presentador                                    */
/* ------------------------------------------------------------------ */

/** Reloj o etiqueta de estado, según dónde esté la ronda. */
function estadoRelojHTML(r, enPausa) {
  const base = {
    openedAt: r.openedAt, pausedAt: r.pausedAt,
    pausedTotal: r.pausedTotal, durationMs: r.deadlineMs
  };

  if (r.state === 'prepared') {
    return `<span class="chico tenue">Lista · ${segundos(r.deadlineMs)}s</span>`;
  }
  if (r.state === 'open') {
    return enPausa
      ? '<span class="chico tenue">⏸ En pausa</span>'
      : `<span class="fila chico"><span class="reloj" id="reloj">${segundos(E.restanteMs(base))}s</span></span>`;
  }
  if (r.state === 'closed') {
    return '<span class="chico" style="color:var(--espera)">Cerrada · lista para revelar</span>';
  }
  return '<span class="chico" style="color:var(--ok)">Revelada</span>';
}

/** Barra de tiempo restante. */
function barraTiempoHTML(r) {
  const base = {
    openedAt: r.openedAt, pausedAt: r.pausedAt,
    pausedTotal: r.pausedTotal, durationMs: r.deadlineMs
  };
  const pct = (E.restanteMs(base) / r.deadlineMs) * 100;
  return `<div class="barra-tiempo" id="barra"><i style="width:${pct}%"></i></div>`;
}

/** Botones del presentador: cambian con el estado de la ronda. */
function controlesHostHTML(r, enPausa) {
  /* 1. PREPARADA: leer en voz alta, luego iniciar el reloj */
  if (r.state === 'prepared') {
    return `
      <div class="columna" style="gap:.6rem; margin-top:.4rem">
        <button class="boton-grande" data-accion="iniciar">
          ▶ Iniciar cuenta (${segundos(r.deadlineMs)} s)
          ${ayuda('Arranca el reloj y abre las respuestas. Antes de esto nadie puede contestar.')}
        </button>
        <div class="fila envolver" style="gap:.5rem">
          <button class="boton boton-secundario" data-accion="saltar" style="flex:1">
            ⏭ Saltar ${ayuda('Cierra la pregunta sin dar el punto y muestra la correcta.')}
          </button>
        </div>
      </div>`;
  }

  /* 2. CORRIENDO: pausar, saltar, cerrar */
  if (r.state === 'open') {
    return `
      <div class="columna" style="gap:.6rem; margin-top:.4rem">
        <div class="fila envolver" style="gap:.5rem">
          <button class="boton boton-secundario" data-accion="${enPausa ? 'reanudar' : 'pausar'}" style="flex:1">
            ${enPausa ? '▶ Reanudar' : '⏸ Pausar'}
            ${ayuda(enPausa
              ? 'El reloj vuelve a correr con los segundos que quedaban.'
              : 'Congela el reloj y bloquea las respuestas.')}
          </button>
          <button class="boton boton-secundario" data-accion="saltar" style="flex:1">
            ⏭ Saltar ${ayuda('Cierra sin dar el punto y muestra la correcta.')}
          </button>
        </div>
        <button class="boton-grande" data-accion="cerrar">
          Cerrar pregunta
          ${ayuda('Detiene las respuestas y decide quién ganó. Todavía no muestra la respuesta correcta a los participantes.')}
        </button>
      </div>`;
  }

  /* 3. CERRADA: el momento del suspenso. Revelar. */
  if (r.state === 'closed') {
    return `
      <div class="columna" style="gap:.6rem; margin-top:.4rem">
        <div class="aviso espera">
          Se registraron ${r.answered} respuesta(s).
          Pulsa <strong>Revelar respuesta</strong> cuando quieras mostrarla.
        </div>
        <button class="boton-grande" data-accion="revelar">
          ✨ Revelar respuesta
          ${ayuda('Muestra la opción correcta y al ganador en todos los teléfonos y en el televisor.')}
        </button>
        <div class="fila envolver" style="gap:.5rem">
          <button class="boton boton-secundario" data-accion="deshacer" style="flex:1">
            ↶ Deshacer ${ayuda('Anula el resultado, devuelve el punto y reabre la pregunta.')}
          </button>
        </div>
      </div>`;
  }

  /* 4. REVELADA: siguiente */
  return `
    <div class="columna" style="gap:.6rem; margin-top:.4rem">
      <div class="fila envolver" style="gap:.5rem">
        <button class="boton boton-secundario" data-accion="repetir" style="flex:1">
          🔁 Repetir ${ayuda('Vuelve a lanzar esta pregunta con las opciones mezcladas.')}
        </button>
        <button class="boton boton-secundario" data-accion="deshacer" style="flex:1">
          ↶ Deshacer ${ayuda('Anula el resultado, devuelve el punto y reabre la pregunta.')}
        </button>
      </div>
      <button class="boton-grande" data-accion="abrir">Siguiente pregunta →</button>
    </div>`;
}

function modalConfirmarCierre() {
  return `
    <div class="modal-fondo" data-accion="cancelar-terminar" data-solo-fondo="1">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="t-confi">
        <h2 id="t-confi" style="font-size:var(--t-lg)">¿Terminar el juego?</h2>
        <p class="chico tenue">
          Se cierra la partida y se muestra la tabla de clasificación.
          Esta acción no se puede deshacer.
        </p>
        <div class="fila" style="gap:.6rem">
          <button class="boton boton-secundario" data-accion="cancelar-terminar" style="flex:1">
            Seguir jugando
          </button>
          <button class="boton boton-peligro" data-accion="confirmar-terminar" style="flex:1">
            Sí, terminar
          </button>
        </div>
      </div>
    </div>`;
}

function vistaCeremonia(s) {
  const tabla = E.tablaFinal(s);
  const paso = app.podioPaso;
  const aMostrar = [tabla[2], tabla[1], tabla[0]].filter(Boolean);

  return `
    <div class="fila-entre">
      <button class="boton boton-secundario" data-accion="salir-host">← Menú</button>
      <span class="chico tenue">Partida terminada</span>
    </div>

    <main class="crecer columna centro" style="gap:1.2rem">
      <h1 style="font-size:var(--t-xl)">Tabla de clasificación</h1>

      ${paso === 0 ? `
        <p class="tenue chico centro" style="text-align:center; max-width:30ch">
          Toca la pantalla para revelar los puestos, del tercero al primero.
        </p>
      ` : ''}

      <ul class="podio-lista">
        ${aMostrar.slice(0, paso).map(p => `
          <li class="fila-clasif destacado" style="--i:${p.position}">
            <div class="puesto">
              <span class="emoji" aria-hidden="true">${EMOJI[p.position] ?? ''}</span>
              <span class="sr-solo">Puesto ${p.position}:</span>
            </div>
            <div class="datos">
              <span class="nombre">${esc(p.name)}</span>
              <span class="sub">
                ${p.score} punto${p.score === 1 ? '' : 's'} ·
                ${(p.totalMs / 1000).toFixed(1)} s en total
              </span>
            </div>
            <div class="puntos">${p.score}</div>
          </li>`).join('')}
      </ul>

      ${paso < aMostrar.length ? `
        <button class="boton-grande" data-accion="revelar-podio" style="max-width:320px">
          ${paso === 0 ? 'Revelar tercer lugar' : paso === 1 ? 'Revelar segundo lugar' : 'Revelar primer lugar'}
        </button>
      ` : `
        <div class="columna" style="gap:.6rem; width:100%; max-width:320px">
          <div class="aviso ok" style="text-align:center">
            🎉 ¡Felicitaciones a ${esc(tabla[0]?.name ?? '')}!
          </div>
          <button class="boton boton-secundario" data-accion="nueva-partida">
            Jugar otra vez
          </button>
        </div>
      `}

      <div style="flex:1"></div>
      <button class="mini tenue" data-accion="ver-tabla-completa"
              style="background:none; border:0; box-shadow:none; color:var(--tu-100)">
        Ver la tabla completa
      </button>
      ${app.tablaCompleta ? modalTabla(tabla) : ''}
    </main>`;
}

function modalTabla(tabla) {
  return `
    <div class="modal-fondo" data-accion="cerrar-tabla" data-solo-fondo="1">
      <div class="modal" role="dialog" aria-modal="true">
        <h2 style="font-size:var(--t-lg)">Tabla completa</h2>
        <ul class="podio-lista">
          ${tabla.map(p => filaClasificacion({
            position: p.position, name: p.name,
            subtitle: `${(p.totalMs / 1000).toFixed(1)} s · ${p.correct} acierto${p.correct === 1 ? '' : 's'}`,
            score: p.score
          })).join('')}
        </ul>
        <button class="boton boton-secundario" data-accion="cerrar-tabla" style="width:100%">
          Cerrar
        </button>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* VISTA: jugador                                                      */
/* ------------------------------------------------------------------ */
function vistaJugador() {
  const s = app.estado;
  const yo = app.yo;

  if (!yo) {
    return `
      <div class="fila-entre">
        <button class="boton boton-secundario" data-ir="menu">← Volver</button>
      </div>
      <main class="crecer columna centro" style="gap:1rem">
        <h1 style="font-size:var(--t-xl)">Entrar a la partida</h1>
        ${codigoDeUrl() ? `<div class="aviso info">Sala ${esc(codigoDeUrl())}</div>` : ''}
        <div class="columna" style="gap:.8rem; max-width:340px; width:100%">
          <div class="campo">
            <label for="nombre">Tu nombre ${ayuda('Escribe tu nombre y apellido, o un alias respetuoso. No se permiten nombres repetidos ni ofensivos.')}</label>
            <input id="nombre" type="text" maxlength="40" autocomplete="name"
                   placeholder="Ej.: Ana Pérez" enterkeyhint="done">
          </div>
          ${avisoHTML()}
          <button class="boton-grande" data-accion="unirse">Entrar</button>
        </div>
        <p class="mini tenue" style="text-align:center; max-width:32ch">
          Escribe tu nombre tal como quieres que aparezca en la tabla.
        </p>
      </main>`;
  }

  if (!s) {
    return `<main class="crecer columna centro">
      <p class="pulso">Conectando…</p>
    </main>`;
  }

  const r = s.round;
  // Mientras la ronda está abierta el servidor no publica las respuestas
  // (para no filtrar quién respondió). El jugador sabe que ya respondió
  // por su propio registro local.
  const mias = r ? (r.answers ?? []).filter(a => a.playerId === yo.playerId) : [];
  const miRegistro = app.miRespuesta?.roundId === r?.id ? app.miRespuesta : null;
  const yaRespondi = mias.length > 0 || !!miRegistro;
  const miPuntaje = s.players.find(p => p.id === yo.playerId);
  const enEspera = miPuntaje?.waiting;

  /* --- ceremonia: mismo escalonado, en el teléfono --- */
  if (s.status === 'ceremony') {
    const tabla = E.tablaFinal(s);
    const aMostrar = [tabla[2], tabla[1], tabla[0]].filter(Boolean);
    return `
      ${barraVolver()}
      <main class="crecer columna centro" style="gap:1rem">
        <h1 style="font-size:var(--t-xl)">Tabla de clasificación</h1>
        <ul class="podio-lista">
          ${aMostrar.slice(0, app.podioPaso).map(p => `
            <li class="fila-clasif destacado">
              <div class="puesto"><span class="emoji">${EMOJI[p.position] ?? ''}</span></div>
              <div class="datos">
                <span class="nombre">${esc(p.name)}</span>
                <span class="sub">${p.score} punto${p.score === 1 ? '' : 's'}</span>
              </div>
              <div class="puntos">${p.score}</div>
            </li>`).join('')}
        </ul>
        ${app.podioPaso < aMostrar.length
          ? `<button class="boton-grande" data-accion="revelar-podio" style="max-width:320px">Revelar</button>`
          : `<div class="aviso ok">${miPuntaje ? `Quedaste en el puesto ${tabla.find(p => p.id === yo.playerId)?.position ?? '-'}` : ''}</div>`}
      </main>`;
  }

  if (enEspera) {
    return `
      ${barraVolver()}
      <main class="crecer columna centro" style="gap:1rem">
        <div class="aviso espera">Estás en sala de espera</div>
        <p class="tenue centro" style="text-align:center; max-width:30ch">
          La partida ya había empezado. El presentador puede admitirte para
          que juegues desde la próxima pregunta.
        </p>
        <p class="chico tenue">${esc(yo.name)}</p>
      </main>`;
  }

  if (!r) {
    return `
      ${barraVolver()}
      <main class="crecer columna centro" style="gap:1rem">
        <h2 style="font-size:var(--t-lg)">Ya estás dentro</h2>
        <p class="tenue centro chico" style="text-align:center; max-width:30ch">
          Espera a que el presentador lance la primera pregunta.
        </p>
        <p class="codigo-sala" style="font-size:var(--t-2xl)">${esc(yo.name)}</p>
        <p class="chico tenue">${miPuntaje?.score ?? 0} puntos</p>
      </main>`;
  }

  /* --- ronda preparada: la pregunta se ve, pero aún no se puede responder --- */
  if (r.state === 'prepared') {
    return `
      <main class="crecer columna" style="gap:1rem">
        ${barraVolver({ extra: `<span class="chico tenue">${esc(yo.name)} · ${miPuntaje?.score ?? 0} pts</span>` })}
        <div class="aviso info centro" style="text-align:center">
          Escucha la pregunta. Los botones se activan cuando el presentador inicie la cuenta.
        </div>
        <p class="enunciado">${esc(r.prompt)}</p>
        <div class="opciones">
          ${r.options.map((o, i) => `
            <div class="opcion apagada" role="presentation">
              <span class="letra">${'ABCD'[i]}</span>
              <span>${esc(o)}</span>
            </div>`).join('')}
        </div>
      </main>`;
  }

  /* --- ronda cerrada: ya no se puede responder, aún no se revela --- */
  if (r.state === 'closed') {
    return `
      <main class="crecer columna" style="gap:1rem">
        ${barraVolver({ extra: `<span class="chico tenue">${esc(yo.name)} · ${miPuntaje?.score ?? 0} pts</span>` })}
        <div class="aviso espera centro" style="text-align:center">
          ⏳ Se acabó el tiempo. Espera la respuesta…
        </div>
        <p class="enunciado">${esc(r.prompt)}</p>
        <div class="opciones">
          ${r.options.map((o, i) => `
            <div class="opcion apagada" role="presentation">
              <span class="letra">${'ABCD'[i]}</span>
              <span>${esc(o)}</span>
            </div>`).join('')}
        </div>
      </main>`;
  }

  /* --- ronda abierta: elegir --- */
  if (r.state === 'open') {
    const bloqueado = yaRespondi || s.paused;
    return `
      <main class="crecer columna" style="gap:1rem">
        ${barraVolver({
          extra: `<span class="chico tenue">${esc(yo.name)} · ${miPuntaje?.score ?? 0} pts</span>`
        })}

        <div class="columna centro" style="gap:.3rem">
          ${s.paused
            ? '<div class="aviso espera">⏸ El presentador pausó el juego</div>'
            : `<div class="reloj" id="reloj-jug">${segundos(E.restanteMs({
                openedAt: r.openedAt, pausedAt: r.pausedAt,
                pausedTotal: r.pausedTotal, durationMs: r.deadlineMs
              }))}</div>`}
        </div>

        <p class="enunciado">${esc(r.prompt)}</p>

        <div class="opciones">
          ${r.options.map((o, i) => `
            <button class="opcion" data-accion="elegir" data-idx="${i}"
              ${bloqueado ? 'disabled' : ''}>
              <span class="letra">${'ABCD'[i]}</span>
              <span>${esc(o)}</span>
            </button>`).join('')}
        </div>

        ${yaRespondi
          ? `<div class="aviso info centro" style="text-align:center">
               Respuesta enviada. Espera el resultado.
             </div>`
          : `<p class="mini tenue centro" style="text-align:center">
               Toca una sola vez. No se puede cambiar.
             </p>`}
      </main>`;
  }

  /* --- revelada --- */
  const gano = r.winnerId === yo.playerId;
  const miResp = (s.round?.answers ?? []).find(a => a.playerId === yo.playerId);
  const correcta = r.correctIdx;
  // Si el servidor aún no publicó las respuestas, usamos el registro local
  // para poder decirle si acertó o no.
  const acerte = miResp
    ? miResp.correct
    : (app.miRespuesta?.roundId === r.id ? app.miRespuesta.idx === correcta : null);

  return `
    <main class="crecer columna" style="gap:1rem">
      ${barraVolver({
        extra: `<span class="chico tenue">${esc(yo.name)} · ${miPuntaje?.score ?? 0} pts</span>`
      })}

      ${gano
        ? `<div class="aviso ok centro" style="text-align:center; font-size:var(--t-lg); padding:1.2em">
             🎉 ${esc(yo.name)}, ¡acertaste esta pregunta!
           </div>`
        : r.noWinner
          ? `<div class="aviso espera centro" style="text-align:center">
               Nadie acertó esta vez.
             </div>`
          : `<div class="aviso info centro" style="text-align:center">
               Acertó ${esc(s.players.find(p => p.id === r.winnerId)?.name ?? 'otro participante')}.
             </div>`}

      <p class="enunciado" style="font-size:var(--t-lg)">${esc(r.prompt)}</p>

      <div class="opciones">
        ${r.options.map((o, i) => {
          let clase = ' apagada';
          if (i === correcta) clase = ' correcta';
          return `
          <div class="opcion${clase}" role="presentation">
            <span class="letra">${'ABCD'[i]}</span>
            <span>${esc(o)}</span>
            ${i === correcta ? '<span style="margin-left:auto">✓</span>' : ''}
          </div>`;
        }).join('')}
      </div>

      <p class="mini tenue centro" style="text-align:center">
        ${acerte === true
          ? 'Tu respuesta fue la correcta.'
          : acerte === false
            ? 'Tu respuesta fue incorrecta.'
            : 'Esta vez no alcanzaste a responder.'}
      </p>
    </main>`;
}

/* ------------------------------------------------------------------ */
/* VISTA: televisor                                                    */
/* ------------------------------------------------------------------ */
function vistaTV() {
  const s = app.estado;
  if (!s) {
    return `
      <main class="crecer columna centro">
        <h1>Desafío Bíblico</h1>
        <p class="tenue">Esperando la partida…</p>
        <button class="boton boton-secundario" data-ir="menu">← Menú</button>
      </main>`;
  }

  const r = s.round;
  const top = s.players.slice(0, 5);

  if (s.status === 'ceremony') {
    return `
      ${barraVolver({ extra: '<span class="mini tenue">Partida terminada</span>' })}
      <main class="crecer columna centro" style="gap:1.5rem">
        <h1>Tabla de clasificación</h1>
        <ul class="podio-lista tv">
          ${[E.tablaFinal(s)[2], E.tablaFinal(s)[1], E.tablaFinal(s)[0]].filter(Boolean)
            .slice(0, app.podioPaso)
            .map(p => filaClasificacion({
              position: p.position, name: p.name,
              subtitle: `${p.score} punto${p.score === 1 ? '' : 's'} · ${(p.totalMs / 1000).toFixed(1)} s`,
              score: p.score
            })).join('')}
        </ul>
      </main>`;
  }

  return `
    ${barraVolver({
      extra: `<div class="columna" style="align-items:flex-end; gap:.2rem">
        <span class="mini tenue">Código</span>
        <span class="chico" style="color:var(--raya); font-weight:800; letter-spacing:.1em">${esc(s.code)}</span>
      </div>`
    })}
    <main class="crecer columna" style="gap:1.5rem">
      <div class="fila-entre">
        <h1 style="font-size:var(--t-xl); margin:0">Desafío Bíblico</h1>
        <div class="columna" style="align-items:flex-end; gap:.2rem">
          <span class="mini tenue">Código</span>
          <span class="chico" style="color:var(--raya); font-weight:800; letter-spacing:.1em">
            ${esc(s.code)}
          </span>
        </div>
      </div>

      ${r ? `
        <div class="columna centro" style="gap:1rem">
          ${r.state === 'prepared'
            ? `<div class="aviso info" style="font-size:var(--t-lg)">Prepárate…</div>`
            : r.state === 'open'
              ? `<div class="reloj" id="reloj-tv" style="font-size:var(--t-3xl)">
                   ${segundos(E.restanteMs({
                     openedAt: r.openedAt, pausedAt: r.pausedAt,
                     pausedTotal: r.pausedTotal, durationMs: r.deadlineMs
                   }))}
                 </div>`
              : r.state === 'closed'
                ? `<div class="aviso espera" style="font-size:var(--t-xl)">⏳ Tiempo agotado</div>`
                : `<div class="aviso ok" style="font-size:var(--t-xl)">Respuesta revelada</div>`}

          <p class="enunciado">${esc(r.prompt)}</p>
          ${r.reference ? `<p class="tenue">${esc(r.reference)}</p>` : ''}
        </div>

        <div class="opciones" style="max-width:900px; margin-inline:auto; width:100%">
          ${r.options.map((o, i) => {
            const esCorrecta = r.state === 'revealed' && i === r.correctIdx;
            return `
            <div class="opcion${esCorrecta ? ' correcta' : ' apagada'}" role="presentation">
              <span class="letra">${'ABCD'[i]}</span>
              <span>${esc(o)}</span>
            </div>`;
          }).join('')}
        </div>

        ${r.state === 'revealed' ? `
          <p class="centro" style="text-align:center; font-size:var(--t-xl); color:var(--raya); font-weight:800">
            ${r.noWinner ? 'Nadie acertó' : `🎉 ${esc(s.players.find(p => p.id === r.winnerId)?.name ?? '')}`}
          </p>` : ''}
      ` : `<p class="tenue centro" style="text-align:center">Esperando la primera pregunta…</p>`}

      ${top.length ? `
        <div class="columna" style="gap:.5rem; max-width:760px; width:100%; margin-inline:auto">
          <h2 style="font-size:var(--t-sm); margin:0" class="tenue">Marcador</h2>
          <ul class="podio-lista">
            ${top.map((p, i) => filaClasificacion({
              position: i + 1, name: p.name, score: p.score
            })).join('')}
          </ul>
        </div>` : ''}
    </main>`;
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */
let timerReloj = null;

function render() {
  const { vista } = rutaActual();

  let html;
  switch (vista) {
    case 'host':  html = vistaHost(); break;
    case 'join':
    case 'play':  html = vistaJugador(); break;
    case 'tv':    html = vistaTV(); break;
    default:      html = vistaMenu();
  }

  $app.innerHTML = html;
  document.body.classList.toggle('tv', vista === 'tv');

  // El reloj se actualiza cada 250 ms sin re-renderizar toda la pantalla.
  clearInterval(timerReloj);
  if (app.estado?.round?.state === 'open' && !app.estado.paused) {
    const r = app.estado.round;
    const base = {
      openedAt: r.openedAt, pausedAt: r.pausedAt,
      pausedTotal: r.pausedTotal, durationMs: r.deadlineMs
    };
    timerReloj = setInterval(() => {
      const ms = E.restanteMs(base);
      for (const sel of ['#reloj', '#reloj-jug', '#reloj-tv']) {
        const el = document.querySelector(sel);
        if (el) el.textContent = segundos(ms) + (sel === '#reloj' ? 's' : '');
      }
      const barra = document.querySelector('#barra > i');
      if (barra) barra.style.width = `${(ms / r.deadlineMs) * 100}%`;

      // Al llegar a cero, el presentador cierra la ronda solo.
      // Los jugadores ya no pueden responder (el motor rechaza por tiempo);
      // esta llamada solo mueve la máquina de estados para que el botón
      // pase a «Revelar respuesta».
      if (ms <= 0) {
        clearInterval(timerReloj);
        if (app.host && app.estado?.round?.state === 'open') {
          app.host.cerrar();
        }
      }
    }, 250);
  }
}

/* ------------------------------------------------------------------ */
/* Acciones                                                            */
/* ------------------------------------------------------------------ */
document.addEventListener('click', async ev => {
  const elNav = ev.target.closest('[data-ir]');
  if (elNav) { ir(elNav.dataset.ir); return; }

  const el = ev.target.closest('[data-accion]');
  if (!el) {
    // toque en la pantalla de ceremonia revela el siguiente puesto
    if (app.estado?.status === 'ceremony') {
      const { vista } = rutaActual();
      if ((vista === 'tv' || vista === 'host' || vista === 'play') && !app.tablaCompleta) {
        revelarSiguientePodio();
      }
    }
    return;
  }

  // Un clic dentro del modal no debe cerrarlo: solo el fondo.
  if (el.dataset.soloFondo && ev.target !== el) return;

  const accion = el.dataset.accion;

  switch (accion) {
    /* --- menú / navegación --- */
    case 'crear-sala': {
      app.host = crearHostLocal({
        preguntas: BANCO,
        onEstado: est => { app.estado = est; render(); }
      });
      app.host.preparar(app.cantidadPreguntas);
      // Por defecto, el presentador es quien orquesta: no necesita cuenta.
      app.estado = app.host.estado();
      render();
      break;
    }

    case 'abrir': {
      const err = app.host.abrir();
      if (err) ponerAviso('error', err);
      break;
    }
    case 'iniciar': { const e = app.host.iniciar(); if (e) ponerAviso('error', e); break; }
    case 'revelar': app.host.revelar(); break;
    case 'pausar': app.host.pausar(); break;
    case 'reanudar': app.host.reanudar(); break;
    case 'cerrar': app.host.cerrar(); break;
    case 'saltar': app.host.saltar(); break;
    case 'repetir': { const e = app.host.repetir(); if (e) ponerAviso('error', e); break; }
    case 'deshacer': { const e = app.host.deshacer(); if (e) ponerAviso('error', e); break; }
    case 'expulsar': app.host.expulsar(el.dataset.id); break;
    case 'admitir': app.host.admitir(el.dataset.id); break;
    case 'pedir-terminar': app.cerrarConfirm = true; render(); break;
    case 'cancelar-terminar': app.cerrarConfirm = false; render(); break;
    case 'confirmar-terminar': {
      app.cerrarConfirm = false;
      app.podioPaso = 0;
      app.host.terminar();
      break;
    }
    case 'nueva-partida': {
      app.podioPaso = 0;
      app.tablaCompleta = false;
      app.host.crearOtraSala();
      app.host.preparar(app.cantidadPreguntas);
      break;
    }
    case 'salir-host': {
      app.host?.destruir?.();
      app.host = null;
      app.estado = null;
      app.podioPaso = 0;
      ir('menu');
      break;
    }

    /* --- jugador --- */
    case 'unirse': {
      const inp = document.getElementById('nombre');
      const nombre = inp?.value ?? '';
      const problema = validarNombre(nombre);
      if (problema) { ponerAviso('error', problema); return; }

      if (!app.cliente) {
        app.cliente = crearClienteLocal({
          onEstado: est => { app.estado = est; render(); }
        });
      }
      const r = await app.cliente.unirse(nombre);
      if (r.error) { ponerAviso('error', r.error); return; }

      app.yo = { playerId: r.playerId, name: nombre.trim() };
      guardarSesion();
      const est = await app.cliente.pedirEstado();
      if (est?.estado) app.estado = est.estado;
      render();
      break;
    }

    case 'elegir': {
      if (!app.yo || !app.estado?.round) return;
      el.disabled = true;
      const ronda = app.estado.round;
      const r = await app.cliente.responder(
        app.yo.playerId, ronda.id, Number(el.dataset.idx)
      );
      if (r.error) ponerAviso('error', r.error);
      else {
        // registrar en local que ya respondió esta ronda
        app.miRespuesta = { roundId: ronda.id, idx: Number(el.dataset.idx) };
        ponerAviso('ok', 'Respuesta enviada.', 2000);
      }
      break;
    }

    /* --- ceremonia --- */
    case 'revelar-podio': revelarSiguientePodio(); break;
    case 'ver-tabla-completa': app.tablaCompleta = true; render(); break;
    case 'cerrar-tabla': app.tablaCompleta = false; render(); break;
  }
});

function revelarSiguientePodio() {
  const total = Math.min(3, E.tablaFinal(app.estado ?? { players: [] }).length);
  if (app.podioPaso < total) {
    app.podioPaso++;
    render();
  }
}

/* Enter para entrar con el teclado */
document.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && rutaActual().vista === 'join') {
    const inp = document.getElementById('nombre');
    if (inp && document.activeElement === inp) {
      document.querySelector('[data-accion="unirse"]')?.click();
    }
  }
  if (ev.key === 'Escape' && app.cerrarConfirm) {
    app.cerrarConfirm = false;
    render();
  }
});

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */
(function iniciar() {
  const sesion = leerSesion();

  if (rutaActual().vista === 'play' && sesion) {
    app.yo = sesion;
    app.cliente = crearClienteLocal({
      onEstado: est => { app.estado = est; render(); }
    });
    app.cliente.pedirEstado().then(r => {
      if (r?.estado) { app.estado = r.estado; render(); }
    });
  }

  render();
})();
