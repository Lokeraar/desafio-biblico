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
import {
  filaClasificacion, restoClasificacionHTML, ceremoniaHTML, subtitulo
} from './lib/render.js';

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
    const tablaTV = E.tablaFinal(s);
    return ceremoniaHTML(tablaTV, app.podioPaso);
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
      if (vista === 'tv' || vista === 'host' || vista === 'play') {
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
