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
  esc, validarNombre, segundos, EMOJI, normalizeName, normalizarCodigo
} from './lib/util.js';
import { crearHostLocal, crearClienteLocal, esLocalDisponible } from './lib/local.js';
import { crearHostNube, crearClienteNube, admin, rpc, resolverSala, mirarSala } from './lib/cloud.js';
import { hayNube } from './config.js';
import {
  selectorTema, modalClave, modalCambiarClave, modalTemas,
  modalPreguntas, modalFormPregunta, vistaConfig, validarPregunta
} from './lib/admin-ui.js';
import { qrSVG } from './lib/qr.js';
import { ceremoniaHTML, totalPasos } from './lib/render.js';

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
  // El hash puede traer consulta (`join?c=ABC`). Sin cortarla aquí, la
  // vista se llamaría «join?c=ABC» y no coincidiría con ningún case: al
  // escanear el QR se abría el menú en vez de la pantalla de entrada.
  const [ruta, consulta] = h.split('?');
  const [vista, ...resto] = ruta.split('/');
  return { vista: vista || 'menu', params: resto, consulta: consulta ?? '' };
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
  // Confirmación abierta: null, 'terminar' (cerrar la partida con podio) o
  // 'sala' (abandonar la sala). Un solo sitio decide qué modal se dibuja.
  confirmar: null,
  podioPaso: 0,      // 0 = oculto, 1 = 3.º, 2 = 2.º, 3 = 1.º
  miRespuesta: null, // { roundId, idx } — lo que este teléfono ya contestó
  cantidadPreguntas: 10,
  // Mando del sondeo del televisor. Existe para poder soltarlo: un sondeo
  // que nadie detiene sigue consultando desde una pantalla ya abandonada.
  tv: null,
  // Lo que la persona ya escribió en la pantalla de entrada. Se guarda
  // porque cada aviso vuelve a dibujar el formulario y, sin esto, un error
  // como «Esa sala no existe» borraba el código recién dictado.
  formJoin: { codigo: null, nombre: '' },
  // Lo mismo para el código del televisor: un código mal escrito no debe
  // desaparecer del campo al mostrar el error.
  formTV: { codigo: null },

  // --- administración (temas y preguntas) ---
  temas: [],           // [{ id, name, questions }]
  temasCargados: false, // evita volver a pedir la lista en cada render
  temaElegido: null,   // id del tema de la partida
  adminClave: null,    // clave maestra ya verificada en esta sesión
  modal: null,         // { tipo, ...datos } o null
  adminError: null,    // mensaje de error dentro del modal
  preguntasTema: [],   // preguntas del tema abierto en el modal
  editarPregunta: null // pregunta que se está editando (null = nueva)
};

const CLAVE_SESION = 'desafio-biblico-sesion';
// La sala del presentador se guarda aparte: si refresca, debe volver a SU
// sala con sus participantes, no encontrarse el panel vacío.
const CLAVE_HOST = 'desafio-biblico-host';

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
 * Ejecuta una acción del presentador y muestra su error, si lo hay.
 *
 * `await` es obligatorio aunque el modo local responda al instante: en la
 * nube `abrir`, `iniciar`, `saltar`… devuelven una promesa. Sin esperarla,
 * `if (e)` comparaba una PROMESA contra la verdad, que siempre es cierta, y
 * el aviso de error acababa pintando «[object Promise]» en pantalla.
 *
 * Se aceptan las tres formas que devuelven los transportes: 
 * null (todo bien), un texto (el error) o { error }.
 */
async function accionHost(nombre, ...args) {
  try {
    const r = await app.host?.[nombre]?.(...args);
    const error = typeof r === 'string' ? r : (r?.error ?? null);
    if (error) ponerAviso('error', traducirError(error));
    return error;
  } catch (e) {
    const texto = e?.message ?? 'Algo salió mal.';
    ponerAviso('error', traducirError(texto));
    return texto;
  }
}

/**
 * Traduce los códigos del motor a frases que se entiendan.
 * La base devuelve códigos en español (`nombre_ocupado`), pero un código
 * suelto en pantalla no le dice nada a nadie.
 */
function traducirError(codigo) {
  const texto = String(codigo ?? '');
  // Error de despliegue, no del usuario: PostgREST responde en inglés cuando
  // la función todavía no está publicada en el proyecto. Un televisor no
  // debe mostrar «Could not find the function…», pero tampoco se puede
  // fingir que la sala no existe: se dice lo que pasa y se deja de intentar.
  if (/Could not find the function/i.test(texto)) {
    return 'El servidor todavía no tiene esta función. Avisa a quien organiza el concurso.';
  }

  const frases = {
    clave_incorrecta: 'La clave no es correcta.',
    clave_bloqueada: 'Demasiados intentos. Espera 10 minutos.',
    clave_no_configurada: 'Todavía no hay clave maestra configurada.',
    clave_muy_corta: 'La clave nueva debe tener al menos 4 caracteres.',
    clave_muy_larga: 'La clave nueva es demasiado larga (máximo 64).',
    tema_requerido: 'Elige un tema antes de crear la sala.',
    tema_inexistente: 'Ese tema ya no existe.',
    tema_ocupado: 'Ya hay un tema con ese nombre.',
    tema_sin_preguntas: 'Ese tema no tiene preguntas todavía.',
    nombre_vacio: 'Escribe un nombre para el tema.',
    nombre_muy_largo: 'El nombre del tema es demasiado largo (máximo 60).',
    partida_en_curso: 'No se puede borrar mientras hay una partida en curso.',
    pregunta_inexistente: 'Esa pregunta ya no existe.',
    enunciado_vacio: 'Escribe el enunciado de la pregunta.',
    enunciado_muy_largo: 'El enunciado es demasiado largo (máximo 1000).',
    se_requieren_4_opciones: 'Se necesitan exactamente 4 respuestas.',
    opcion_vacia: 'Todas las respuestas deben tener texto.',
    opcion_muy_larga: 'Una respuesta es demasiado larga (máximo 300).',
    opciones_repetidas: 'Hay dos respuestas iguales.',
    respuesta_correcta_invalida: 'Marca cuál respuesta es la correcta.',
    opciones_invalidas: 'Las respuestas no tienen el formato esperado.',
    nombre_ocupado: 'Ese nombre ya está tomado.',
    ya_respondio: 'Ya respondiste esta pregunta.',
    en_pausa: 'El juego está en pausa.',
    tiempo_agotado: 'Se acabó el tiempo.',
    ronda_cerrada: 'La ronda ya está cerrada.',
    ronda_sin_revelar: 'Revela la respuesta anterior antes de avanzar.',
    cuenta_no_iniciada: 'El presentador todavía no inició la cuenta.',
    banco_agotado: 'No quedan preguntas en este tema.',
    nada_que_revelar: 'No hay nada que revelar.',
    nada_que_iniciar: 'No hay ninguna pregunta preparada.',
    partida_terminada: 'La partida ya terminó.',
    sala_cerrada: 'El presentador cerró la sala. Vuelve a entrar cuando abra otra.',
    // Entrar a una partida que ya arrancó no se permite: el que llega tarde
    // quedaría mirando una pantalla que no puede jugar.
    partida_ya_iniciada: 'La partida ya comenzó. Espera a que abran otra sala.',
    ronda_abierta: 'Ya hay una pregunta abierta.',
    expulsado: 'No formas parte de esta partida.',
    en_espera: 'Estás en la sala de espera.',
    no_autorizado: 'Tu sesión ya no es válida. Vuelve a entrar.',
    sala_inexistente: 'Esa sala no existe.'
  };
  return frases[codigo] ?? String(codigo ?? 'Algo salió mal.');
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
      desc: 'Una pregunta, 4 opciones y una sola correcta.', listo: true },
    { slug: 'completar-versiculo', icono: '📖', nombre: 'Completar el versículo',
      desc: 'Se muestra un versículo con un hueco.', listo: false },
    { slug: 'respuesta-abierta', icono: '💬', nombre: 'Respuesta abierta',
      desc: 'El presentador lee y cada quien escribe.', listo: false }
  ];
  const disponibles = juegos.filter(j => j.listo).length;

  return `
    <header class="menu-cabecera">
      <div class="portada">
        <img src="public/img/portada.webp" alt="Desafío Bíblico 2026 — 2 Corintios"
             fetchpriority="high" decoding="async">
      </div>
    </header>

    <main class="crecer columna menu-cuerpo">
      <div class="menu-titulo">
        <span aria-hidden="true">🏆</span>
        <h1>DESAFÍO BÍBLICO</h1>
        <span aria-hidden="true">⭐</span>
      </div>
      <p class="menu-lema">2 Corintios · Concurso de preguntas</p>

      <div class="menu-acciones">
        <button class="boton-grande boton-oro" data-ir="host">
          🎤 Soy presentador
        </button>
        <button class="boton-grande boton-contorno" data-ir="join">
          🙋 Jugar como participante
        </button>
        <button class="boton boton-contorno" data-ir="tv">
          📺 Pantalla para el televisor
        </button>
        ${hayNube ? `<button class="boton boton-contorno" data-ir="config">
          ⚙️ Configuraciones
        </button>` : ''}
      </div>

      <h2 class="menu-seccion">
        ${disponibles} juego${disponibles === 1 ? '' : 's'} disponible${disponibles === 1 ? '' : 's'}
      </h2>

      <div class="menu-juegos">
        ${juegos.map(j => `
          <button class="juego-tarjeta${j.listo ? ' listo' : ''}" ${j.listo ? '' : 'disabled'}>
            <span class="icono" aria-hidden="true">${j.icono}</span>
            <span class="texto">
              <span class="nombre">${esc(j.nombre)}</span>
              <span class="desc">${esc(j.desc)}</span>
            </span>
            <span class="insignia">${j.listo ? 'Abierto' : 'Pronto'}</span>
          </button>`).join('')}
      </div>

      <footer class="menu-pie">
        <span>v1.0</span>
        <span class="fila" style="gap:.35rem">
          <span class="punto-vivo${esLocalDisponible() ? '' : ' apagado'}"></span>
          ${esLocalDisponible() ? 'Modo local' : 'Sin modo local'}
        </span>
      </footer>
    </main>`;
}
function vistaHost() {
  const s = app.estado;

  if (!s) {
    const temaOk = Boolean(app.temaElegido);
    const tema = app.temas.find(t => t.id === app.temaElegido);
    const nPreguntas = tema?.questions ?? 0;

    // El botón solo se habilita con un tema elegido y con preguntas.
    const puedeCrear = temaOk && nPreguntas > 0;
    const porQueNo = !temaOk
      ? 'Elige un tema para empezar.'
      : 'Ese tema no tiene preguntas todavía.';

    return `
      <div class="fila-entre">
        <button class="boton boton-secundario" data-ir="menu">← Volver</button>
      </div>
      <main class="crecer columna centro" style="gap:1.2rem">
        <h1>Panel del presentador</h1>
        <p class="tenue" style="text-align:center; max-width:34ch">
          Crea la sala. Los participantes entrarán con un código.
        </p>

        ${selectorTema(app.temas, app.temaElegido)}

        <div class="campo" style="max-width:340px; width:100%">
          <label for="cant">Preguntas en esta partida ${ayuda(
            'Se eligen al azar empezando por las que hace más tiempo no se juegan. '
            + (nPreguntas ? 'Este tema tiene ' + nPreguntas + '.' : ''))}</label>
          <select id="cant" ${puedeCrear ? '' : 'disabled'}>
            ${[5, 10, 15, 20, 25, 30, 40, 50].filter(n => n <= Math.max(nPreguntas, 5)).map(n =>
              `<option value="${n}" ${n === app.cantidadPreguntas ? 'selected' : ''}>${n} preguntas</option>`).join('')}
          </select>
        </div>

        ${avisoHTML()}
        <button class="boton-grande" data-accion="crear-sala"
                style="max-width:320px" ${puedeCrear ? '' : 'disabled'}
                title="${puedeCrear ? '' : esc(porQueNo)}">
          Crear sala
        </button>
        ${puedeCrear ? '' : `<p class="chico tenue" style="margin:0">${esc(porQueNo)}</p>`}
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
      <button class="boton boton-secundario" data-accion="pedir-cerrar-sala">← Menú</button>
      <span class="fila chico">
        <span class="punto-vivo"></span> En línea
      </span>
    </div>

    <main class="crecer columna" style="gap:1rem; margin-top:1rem">

      <div class="sala-cabecera">
        <div class="qr-caja" title="Escanéalo para entrar a la sala">
          ${qrSVG(urlSala(s.code), { nivel: 'M', escala: 6, margen: 3 })}
        </div>
        <div class="sala-datos">
          <span class="mini tenue">Código de la sala</span>
          <div class="codigo-sala">${esc(s.code)}</div>
          <span class="chico tenue">
            ${jugando.length} participante${jugando.length === 1 ? '' : 's'}
          </span>
          <span class="mini tenue">Escanea el QR o escribe el código</span>
        </div>
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

      ${r ? `
        <div class="fila-entre" style="margin-top:auto; padding-top:1rem">
          <button class="boton boton-peligro" data-accion="pedir-terminar">
            Terminar el juego
            ${ayuda('Cierra la partida y muestra la tabla de clasificación. Te pedirá confirmar.')}
          </button>
        </div>` : ''}
    </main>

    ${app.confirmar === 'terminar' ? modalConfirmarCierre() : ''}
    ${app.confirmar === 'sala' ? modalCerrarSala() : ''}`;
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
    <div class="modal-fondo" data-accion="cancelar-confirmar" data-solo-fondo="1">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="t-confi">
        <h2 id="t-confi" style="font-size:var(--t-lg)">¿Terminar el juego?</h2>
        <p class="chico tenue">
          Se cierra la partida y se muestra la tabla de clasificación.
          Esta acción no se puede deshacer.
        </p>
        <div class="fila" style="gap:.6rem">
          <button class="boton boton-secundario" data-accion="cancelar-confirmar" style="flex:1">
            Seguir jugando
          </button>
          <button class="boton boton-peligro" data-accion="confirmar-terminar" style="flex:1">
            Sí, terminar
          </button>
        </div>
      </div>
    </div>`;
}

/**
 * Confirmación de «Menú» en la sala.
 * El texto dice lo que pasa de verdad: la sala se cierra en el servidor, así
 * que los participantes dejan de poder entrar. Antes este botón solo cerraba
 * la pestaña y la sala quedaba viva, aceptando jugadores y bloqueando el tema
 * durante horas.
 *
 * El texto cambia si la partida ya está en marcha: cerrarla a la mitad cuesta
 * el puntaje de quienes iban ganando, y eso no se puede decir con la misma
 * frase que una sala recién creada.
 */
function modalCerrarSala() {
  const s = app.estado;
  const n = (s?.players ?? []).filter(p => !p.kicked).length;
  const enMarcha = Boolean(s?.round) || s?.status === 'question' || s?.status === 'reveal';
  const cuantos = n ? ` Hay ${n} participante${n === 1 ? '' : 's'} dentro.` : '';

  const cuerpo = enMarcha
    ? 'La partida está en curso. Se cierra la sala y se pierden el puntaje y la tabla final: no hay podio que mostrar.' + cuantos
    : `La partida todavía no empezó. Se cierra la sala y los participantes dejan de poder entrar con el código ${esc(s?.code ?? '')}.` + cuantos;

  return `
    <div class="modal-fondo" data-accion="cancelar-confirmar" data-solo-fondo="1">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="t-cerrar">
        <h2 id="t-cerrar" style="font-size:var(--t-lg)">¿Cerrar la sala?</h2>
        <p class="chico tenue">${cuerpo}</p>
        <div class="fila" style="gap:.6rem">
          <button class="boton boton-secundario" data-accion="cancelar-confirmar" style="flex:1">
            Seguir aquí
          </button>
          <button class="boton boton-peligro" data-accion="confirmar-cerrar-sala" style="flex:1">
            Sí, cerrar
          </button>
        </div>
      </div>
    </div>`;
}

function vistaCeremonia(s) {
  const tabla = E.tablaFinal(s);
  const paso = app.podioPaso;

  // Pie: "Jugar de nuevo" vuelve al rol que corresponde, y "Menú" al inicio.
  const esHost = !!app.host;
  const jugarDeNuevo = esHost
    ? `<button class="boton" data-accion="jugar-host">🎤 Jugar de nuevo</button>`
    : `<button class="boton" data-ir="join">🙋 Jugar de nuevo</button>`;

  const footer = `
    ${jugarDeNuevo}
    <button class="boton boton-secundario" data-accion="salir-host">← Menú</button>`;

  return ceremoniaHTML(tabla, paso, {
    miId: app.yo?.playerId ?? null,
    footer,
    vacio: 'Nadie participó en esta partida.'
  });
}

/* ------------------------------------------------------------------ */
/* VISTA: jugador                                                      */
/* ------------------------------------------------------------------ */
function vistaJugador() {
  const s = app.estado;
  const yo = app.yo;

  if (!yo) {
    // El código se precarga desde el QR y también se puede escribir a mano:
    // quien recibe el código dictado por voz no tiene enlace que escanear.
    const codigoInicial = app.formJoin.codigo ?? codigoDeUrl() ?? '';
    return `
      <div class="fila-entre">
        <button class="boton boton-secundario" data-ir="menu">← Volver</button>
      </div>
      <main class="crecer columna centro" style="gap:1rem">
        <h1 style="font-size:var(--t-xl)">Entrar a la partida</h1>
        ${codigoDeUrl() ? `<div class="aviso info">Sala ${esc(codigoDeUrl())}</div>` : ''}
        <div class="columna" style="gap:.8rem; max-width:340px; width:100%">
          <div class="campo">
            <label for="codigo">Código de la sala ${ayuda('Son los cinco caracteres que muestra la pantalla del presentador. Se pueden escribir con espacios: «B 7 3 W S» es lo mismo que «B73WS».')}</label>
            <input id="codigo" type="text" maxlength="8" autocapitalize="characters"
                   autocomplete="off" placeholder="Ej.: B73WS" value="${esc(codigoInicial)}"
                   enterkeyhint="next">
          </div>
          <div class="campo">
            <label for="nombre">Tu nombre ${ayuda('Escribe tu nombre y apellido, o un alias respetuoso. No se permiten nombres repetidos ni ofensivos.')}</label>
            <input id="nombre" type="text" maxlength="40" autocomplete="name"
                   placeholder="Ej.: Ana Pérez" value="${esc(app.formJoin.nombre)}" enterkeyhint="done">
          </div>
          ${avisoHTML()}
          <button class="boton-grande" data-accion="unirse">Entrar</button>
        </div>
        <p class="mini tenue" style="text-align:center; max-width:32ch">
          ${hayNube
            ? 'Escribe tu nombre tal como quieres que aparezca en la tabla.'
            : 'En este dispositivo se juega en el mismo aparato que el presentador, así que el código no hace falta.'}
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

  /* --- ceremonia: la misma tabla, con su propio pie --- */
  if (s.status === 'ceremony') {
    const tabla = E.tablaFinal(s);
    const footer = `
      <button class="boton" data-accion="salir-host">🙋 Jugar de nuevo</button>
      <button class="boton boton-secundario" data-ir="menu">← Menú</button>`;
    return ceremoniaHTML(tabla, app.podioPaso, {
      miId: yo.playerId,
      footer,
      vacio: 'Nadie participó en esta partida.'
    });
  }

  /*
   * La sala se cerró antes de terminar (el presentador se fue).
   * Sin este caso el jugador se quedaba mirando «espera la respuesta» para
   * siempre: el servidor ya no manda rondas y la pantalla nunca cambia.
   */
  if (s.status === 'closed') {
    return `
      <main class="crecer columna centro" style="gap:1rem">
        <div class="aviso espera centro" style="text-align:center">
          El presentador cerró la sala.
        </div>
        <p class="tenue centro chico" style="text-align:center; max-width:32ch">
          Esta partida no llegó al final, así que no hay tabla de posiciones.
        </p>
        <button class="boton boton-secundario" data-ir="menu">← Menú</button>
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
  // El televisor solo se cree su PROPIO sondeo. `app.estado` lo comparten
  // todas las vistas: sin esta condición, abrir el televisor después del
  // panel del presentador mostraba el estado del host —con la respuesta
  // correcta incluida— en una pantalla que ve todo el público.
  const s = app.tv ? app.estado : null;
  if (!s) {
    // Sin estado no hay nada que proyectar: el televisor pide el código a
    // mano. Antes solo decía «Esperando la partida…» y nunca se conectaba a
    // ningún lado, así que la pantalla se quedaba esperando para siempre.
    if (!hayNube) {
      return `
      <main class="crecer columna centro" style="gap:1rem">
        <h1>Desafío Bíblico</h1>
        <p class="tenue" style="text-align:center; max-width:34ch">
          El televisor necesita el modo en línea. Sin conexión a la nube solo
          funciona el modo local, en este mismo dispositivo.
        </p>
        <button class="boton boton-secundario" data-ir="menu">← Menú</button>
      </main>`;
    }

    const codigoInicial = app.formTV.codigo ?? codigoDeUrl() ?? '';
    return `
      <main class="crecer columna centro" style="gap:1rem">
        <h1>Desafío Bíblico</h1>
        <p class="tenue" style="text-align:center; max-width:34ch">
          Escribe el código que muestra la pantalla del presentador y este
          televisor sigue la partida.
        </p>
        <div class="columna" style="gap:.8rem; max-width:340px; width:100%">
          <div class="campo">
            <label for="codigo-tv">Código de la sala ${ayuda('Son los cinco caracteres que muestra el presentador. Se pueden escribir con espacios: «B 7 3 W S» es lo mismo que «B73WS».')}</label>
            <input id="codigo-tv" type="text" maxlength="8" autocapitalize="characters"
                   autocomplete="off" placeholder="Ej.: B73WS" value="${esc(codigoInicial)}"
                   enterkeyhint="go">
          </div>
          ${avisoHTML()}
          <button class="boton-grande" data-accion="tv-transmitir">Transmitir</button>
        </div>
        <button class="boton boton-secundario" data-ir="menu">← Menú</button>
      </main>`;
  }

  const r = s.round;
  const top = s.players.slice(0, 5);

  /*
   * Sala cerrada: el presentador se fue. Se avisa y se deja de consultar,
   * porque ya no va a llegar nada nuevo por más que se pregunte.
   */
  if (s.status === 'closed') {
    return `
      <main class="crecer columna centro" style="gap:1rem">
        <h1>Desafío Bíblico</h1>
        <div class="aviso espera centro" style="text-align:center">
          El presentador cerró la sala.
        </div>
        <p class="tenue centro chico" style="text-align:center; max-width:32ch">
          Esta pantalla puede conectarse a otra sala con su código.
        </p>
        <button class="boton boton-secundario" data-accion="tv-otra-sala">Escribir otro código</button>
        <button class="boton boton-secundario" data-ir="menu">← Menú</button>
      </main>`;
  }

  if (s.status === 'ceremony') {
    // El televisor no tiene botones de juego: solo muestra. Se deja el Menú
    // porque ninguna pantalla del proyecto puede quedarse sin camino de
    // vuelta, ni siquiera la del televisor al terminar la partida.
    return ceremoniaHTML(E.tablaFinal(s), app.podioPaso, {
      footer: '<button class="boton boton-secundario" data-ir="menu">← Menú</button>'
    });
  }

  return `
    ${barraVolver({ extra: '<span class="mini tenue">Pantalla del televisor</span>' })}
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
// Cerrando sala: evita mandar dos veces la orden si se toca el botón dos
// veces mientras viaja la respuesta del servidor.
let cerrando = false;

/* ------------------------------------------------------------------ */
/* Administración: temas, preguntas y clave maestra                    */
/* ------------------------------------------------------------------ */

/** Carga los temas del servidor y refresca la pantalla. */
async function cargarTemas() {
  if (!hayNube) return;
  const { temas, error } = await admin.temas();
  if (error) {
    // Se libera la bandera para que al volver a entrar se reintente.
    app.temasCargados = false;
    ponerAviso('error', 'No se pudieron cargar los temas.');
    return;
  }
  app.temas = temas;

  // Si el tema elegido ya no existe (o cambió su número de preguntas),
  // se corrige solo para no quedar con una selección fantasma.
  const sigue = app.temas.find(t => t.id === app.temaElegido);
  if (!sigue || sigue.questions === 0) {
    app.temaElegido = app.temas.find(t => t.questions > 0)?.id ?? null;
  }
  render();
}

/** Pide la clave maestra si todavía no se verificó en esta sesión. */
function pedirClave(siguiente) {
  if (app.adminClave) { siguiente(); return; }
  app.modal = { tipo: 'clave' };
  app.adminError = null;
  render();
}

/** Abre la lista de temas (ya con la clave verificada). */
async function abrirTemas() {
  app.modal = { tipo: 'temas' };
  app.adminError = null;
  render();
  const { temas, error } = await admin.temas();
  if (error) app.adminError = error;
  else app.temas = temas;
  render();
}

/** Abre las preguntas de un tema. */
async function abrirPreguntas(temaId) {
  const tema = app.temas.find(t => t.id === temaId);
  app.modal = { tipo: 'preguntas', tema };
  app.adminError = null;
  app.preguntasTema = [];
  render();
  const { preguntas, error } = await admin.preguntas(app.adminClave, temaId);
  if (error) app.adminError = error;
  else app.preguntasTema = preguntas;
  render();
}

/** Dibuja el modal que esté abierto, si hay alguno. */
function modalActivo() {
  const m = app.modal;
  if (!m) return '';
  const err = app.adminError;

  switch (m.tipo) {
    case 'clave':       return modalClave({ error: err });
    case 'cambiar':     return modalCambiarClave({ error: err });
    case 'temas':       return modalTemas(app.temas, { error: err });
    case 'preguntas':   return modalPreguntas(m.tema, app.preguntasTema, { error: err });
    case 'pregunta':    return modalFormPregunta({
                          temaId: m.temaId,
                          pregunta: app.editarPregunta,
                          error: err
                        });
    default: return '';
  }
}

function render() {
  const { vista } = rutaActual();

  let html;
  switch (vista) {
    case 'host':  html = vistaHost(); break;
    case 'join':
    case 'play':  html = vistaJugador(); break;
    case 'tv':    html = vistaTV(); break;
    case 'config': html = vistaConfig({ hayClave: hayNube }); break;
    default:      html = vistaMenu();
  }

  // El modal se dibuja ENCIMA de la vista, sin reemplazarla: así al
  // cerrarlo no se pierde lo que el usuario estaba escribiendo debajo.
  if (app.modal) html += modalActivo();

  $app.innerHTML = html;
  document.body.classList.toggle('tv', vista === 'tv');

  // Al salir de la pantalla del televisor se suelta su sondeo: una consulta
  // viva desde una vista abandonada gasta datos y batería sin que nadie
  // esté mirando la pantalla. También se olvida el estado para que al volver
  // a #/tv no se muestre una partida congelada sin nadie que la actualice.
  if (vista !== 'tv' && app.tv) {
    app.tv.parar();
    app.tv = null;
    app.estado = null;
  }

  // Al entrar a la vista del presentador, se cargan los temas una vez.
  // La bandera evita un bucle: si la lista vuelve vacía, render() no debe
  // volver a pedirla, porque se llamaría a sí mismo sin fin.
  if (vista === 'host' && hayNube && !app.temasCargados) {
    app.temasCargados = true;
    cargarTemas();
  }

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

  // En la ceremonia, un toque en CUALQUIER parte avanza un paso.
  // Se comprueba antes que los botones para que el pie no lo bloquee,
  // pero los botones siguen funcionando porque tienen data-accion.
  const el = ev.target.closest('[data-accion]');

  if (!el && app.estado?.status === 'ceremony') {
    revelarSiguientePodio();
    return;
  }
  if (!el) return;

  // Un clic dentro del modal no debe cerrarlo: solo el fondo.
  if (el.dataset.soloFondo && ev.target !== el) return;

  const accion = el.dataset.accion;

  switch (accion) {
    /* --- menú / navegación --- */
    case 'crear-sala': {
      if (!app.temaElegido) {
        ponerAviso('error', 'Elige un tema antes de crear la sala.');
        break;
      }

      // Un solo host vivo. Si se crea una sala nueva sin retirar la
      // anterior, los dos siguen consultando y el viejo sobrescribe el
      // estado con SU código: en pantalla aparecía un código y el QR de
      // otro, y la sala real era impredecible.
      if (app.host?.destruir) app.host.destruir();
      app.host = null;
      app.estado = null;

      // Con proyecto configurado, la partida vive en la nube: varios
      // teléfonos de verdad, no solo pestañas del mismo aparato.
      if (hayNube) {
        const host = crearHostNube({
          topicId: app.temaElegido,
          onEstado: est => { app.estado = est; render(); }
        });
        const r = await host.crear(app.cantidadPreguntas);
        if (r.error) {
          ponerAviso('error', traducirError(r.error));
          break;
        }
        app.host = host;
        // Guardar para sobrevivir a un refresco: la sala es del servidor,
        // así que basta recordar su id y el token del presentador.
        try {
          localStorage.setItem(CLAVE_HOST, JSON.stringify({
            roomId: r.roomId, hostToken: r.hostToken, code: r.code
          }));
        } catch { /* modo privado: la sala solo vive en memoria */ }
        render();
        break;
      }

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

    /* --- administración --- */
    case 'abrir-temas': {
      pedirClave(() => abrirTemas());
      break;
    }

    case 'cerrar-admin': {
      app.modal = null;
      app.adminError = null;
      app.editarPregunta = null;
      render();
      break;
    }

    case 'ver-preguntas': {
      await abrirPreguntas(el.dataset.tema);
      break;
    }

    case 'nueva-pregunta': {
      app.editarPregunta = null;
      app.adminError = null;
      app.modal = { tipo: 'pregunta', temaId: el.dataset.tema };
      render();
      break;
    }

    case 'editar-pregunta': {
      app.editarPregunta = app.preguntasTema.find(q => q.id === el.dataset.pregunta) ?? null;
      app.adminError = null;
      app.modal = { tipo: 'pregunta', temaId: app.modal?.tema?.id ?? null };
      render();
      break;
    }

    case 'borrar-pregunta': {
      const r = await admin.borrarPregunta(app.adminClave, el.dataset.pregunta);
      if (r.error) app.adminError = traducirError(r.error);
      await abrirPreguntas(app.modal?.tema?.id);
      if (r.error) { app.adminError = traducirError(r.error); render(); }
      break;
    }

    case 'borrar-tema': {
      const nombre = el.dataset.nombre ?? '';
      if (!confirm(`¿Borrar el tema «${nombre}» y todas sus preguntas?`)) break;
      const r = await admin.borrarTema(app.adminClave, el.dataset.tema);
      if (r.error) app.adminError = traducirError(r.error);
      await abrirTemas();
      if (r.error) { app.adminError = traducirError(r.error); render(); }
      break;
    }

    case 'renombrar-tema': {
      const viejo = el.dataset.nombre ?? '';
      const nuevo = prompt('Nuevo nombre del tema:', viejo);
      if (nuevo === null || !nuevo.trim() || nuevo.trim() === viejo) break;
      const r = await admin.renombrarTema(app.adminClave, el.dataset.tema, nuevo.trim());
      if (r.error) app.adminError = traducirError(r.error);
      await abrirTemas();
      if (r.error) { app.adminError = traducirError(r.error); render(); }
      break;
    }

    case 'abrir-cambiar-clave': {
      app.modal = { tipo: 'cambiar' };
      app.adminError = null;
      render();
      break;
    }

    case 'abrir': await accionHost('abrir'); break;
    case 'iniciar': await accionHost('iniciar'); break;
    case 'revelar': await accionHost('revelar'); break;
    case 'pausar': await accionHost('pausar'); break;
    case 'reanudar': await accionHost('reanudar'); break;
    case 'cerrar': await accionHost('cerrar'); break;
    case 'saltar': await accionHost('saltar'); break;
    case 'repetir': await accionHost('repetir'); break;
    case 'deshacer': await accionHost('deshacer'); break;
    case 'expulsar': await accionHost('expulsar', el.dataset.id); break;
    case 'admitir': await accionHost('admitir', el.dataset.id); break;
    case 'pedir-terminar': app.confirmar = 'terminar'; render(); break;
    case 'pedir-cerrar-sala': app.confirmar = 'sala'; render(); break;
    case 'cancelar-confirmar': app.confirmar = null; render(); break;
    case 'confirmar-terminar': {
      app.confirmar = null;
      app.podioPaso = 0;
      await accionHost('terminar');
      break;
    }
    /*
     * Cerrar la sala desde «Menú».
     * Se cierra DE VERDAD: en la nube la sala pasa a 'closed' en el servidor;
     * en local se difunde el estado final y se suelta el canal. Solo después
     * se navega al menú, para no abandonar una sala que siga viva por un
     * fallo de red.
     *
     * Se olvida la sesión guardada: sin borrar la clave, recargar la página
     * reabría la sala y el presentador se encontraba dentro de una partida
     * fantasma.
     */
    case 'confirmar-cerrar-sala': {
      app.confirmar = null;
      if (cerrando) break;          // doble toque: no se manda dos veces
      cerrando = true;
      render();

      let fallo = null;
      try {
        const r = await app.host?.cerrarSala?.();
        fallo = r?.error ?? null;
      } catch (e) {
        fallo = e?.message ?? 'No se pudo cerrar la sala.';
      }
      cerrando = false;

      if (fallo) {
        // Si no se cerró, no se simula: el presentador sigue en su sala y
        // recibe el motivo. Cerrar la pantalla sin cerrar la sala es justo
        // lo que dejaba jugadores esperando a alguien que ya se fue.
        ponerAviso('error', traducirError(fallo));
        break;
      }

      try { localStorage.removeItem(CLAVE_HOST); } catch { /* modo privado */ }
      app.host = null;
      app.estado = null;
      app.podioPaso = 0;
      ir('menu');
      break;
    }
    case 'jugar-host': {
      app.podioPaso = 0;
      app.estado = null;
      app.host?.destruir?.();
      app.host = null;
      ir('host');
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
      const inpNombre = document.getElementById('nombre');
      const inpCodigo = document.getElementById('codigo');
      const nombre = inpNombre?.value ?? '';

      // Lo escrito se guarda ANTES de cualquier aviso: mostrar un error
      // vuelve a dibujar la pantalla, y sin esto el código dictado y el
      // nombre se borraban justo cuando la persona debía corregirlos.
      app.formJoin = {
        codigo: inpCodigo ? inpCodigo.value : app.formJoin.codigo,
        nombre
      };

      const problema = validarNombre(nombre);
      if (problema) { ponerAviso('error', problema); return; }

      // Con proyecto configurado, el jugador entra por la nube: su teléfono
      // habla con Supabase, no con una pestaña del mismo aparato. Sin esto
      // el QR servía de adorno y solo funcionaba el modo local.
      if (hayNube) {
        // Manda lo escrito; el QR queda como respaldo para quien llega
        // escaneando y no toca el campo.
        const codigo = normalizarCodigo(inpCodigo?.value) || codigoDeUrl();
        if (!codigo) { ponerAviso('error', 'Falta el código de la sala.'); return; }

        if (!app.cliente || !app.cliente.nube) {
          app.cliente = crearClienteNube({
            onEstado: est => { app.estado = est; render(); }
          });
        }
        const r = await app.cliente.unirse(codigo, nombre);
        if (r.error) { ponerAviso('error', traducirError(r.error)); return; }

        app.yo = {
          playerId: r.player_id,
          name: r.display_name ?? nombre.trim(),
          code: r.code,
          // Token y sala son lo que permite VOLVER a la partida tras
          // recargar. Sin ellos, refrescar dejaba al jugador fuera.
          token: r.player_token,
          roomId: r.room_id
        };
        app.formJoin = { codigo: null, nombre: '' };
        guardarSesion();
        render();
        break;
      }

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
      const idx = Number(el.dataset.idx);

      // La nube espera la CLAVE REAL de la opción (que puede ser 'd'
      // aunque se muestre primera); el motor local, el índice.
      const clave = ronda.optionKeys?.[idx];
      const r = app.cliente?.nube
        ? await app.cliente.responder(ronda.id, clave)
        : await app.cliente.responder(app.yo.playerId, ronda.id, idx);

      if (r.error) ponerAviso('error', traducirError(r.error));
      else {
        // registrar en local que ya respondió esta ronda
        app.miRespuesta = { roundId: ronda.id, idx };
        ponerAviso('ok', 'Respuesta enviada.', 2000);
      }
      break;
    }

    /* --- televisor --- */
    case 'tv-transmitir': {
      const inp = document.getElementById('codigo-tv');
      // Se guarda lo escrito: si el código está mal, el aviso vuelve a
      // dibujar la pantalla y sin esto el campo quedaba vacío.
      app.formTV = { codigo: inp ? inp.value : app.formTV.codigo };

      const codigo = normalizarCodigo(inp?.value) || codigoDeUrl();
      if (!codigo) { ponerAviso('error', 'Falta el código de la sala.'); return; }

      if (!hayNube) {
        ponerAviso('error', 'El televisor necesita el modo en línea.');
        return;
      }

      // El televisor no ocupa puesto de jugador: traduce el código a su
      // sala y mira el estado público, sin nombre y sin token.
      const sala = await resolverSala(codigo);
      if (sala.error) { ponerAviso('error', traducirError(sala.error)); return; }

      if (sala.status === 'closed') {
        ponerAviso('error', traducirError('sala_cerrada'));
        return;
      }

      // Un solo sondeo vivo: si se transmite otra sala, la anterior se suelta.
      app.tv?.parar();
      app.tv = mirarSala(sala.roomId, {
        onEstado: est => {
          if (!est) return;
          app.estado = est;
          // La sala cerrada ya tiene su propia pantalla con el aviso; no hace
          // falta repetirlo por encima. `mirarSala` deja de consultar solo.
          render();
        }
      });

      await app.tv.primero;
      // La primera consulta es la que dice si la sala se puede ver. Si falló,
      // no hay nada que transmitir: se suelta el mando y se avisa con el
      // motivo real, en vez de dejar un sondeo vivo contra una sala rota.
      const fallo = app.tv.ultimoError();
      if (fallo) {
        app.tv.parar();
        app.tv = null;
        app.estado = null;
        ponerAviso('error', traducirError(fallo));
        return;
      }
      render();
      break;
    }

    case 'tv-otra-sala': {
      app.tv?.parar();
      app.tv = null;
      app.estado = null;
      app.formTV = { codigo: null };
      render();
      break;
    }

    /* --- ceremonia --- */
    case 'revelar-podio': revelarSiguientePodio(); break;
    case 'ver-tabla-completa': app.tablaCompleta = true; render(); break;
    case 'cerrar-tabla': app.tablaCompleta = false; render(); break;
  }
});

function revelarSiguientePodio() {
  const tabla = E.tablaFinal(app.estado ?? { players: [] });
  const total = totalPasos(tabla);
  if (app.podioPaso < total) {
    app.podioPaso++;
    render();
  }
}

/* Enter para entrar con el teclado.
   Vale tanto desde el nombre como desde el código: quien escribe el código
   dictado pulsa Enter ahí mismo y espera entrar, no que el foco salte. */
document.addEventListener('keydown', ev => {
  if (ev.key === 'Enter') {
    const vista = rutaActual().vista;
    const activo = document.activeElement;
    if (vista === 'join' && (activo?.id === 'nombre' || activo?.id === 'codigo')) {
      document.querySelector('[data-accion="unirse"]')?.click();
    }
    if (vista === 'tv' && activo?.id === 'codigo-tv') {
      document.querySelector('[data-accion="tv-transmitir"]')?.click();
    }
  }
  if (ev.key === 'Escape' && app.confirmar) {
    app.confirmar = null;
    render();
  }
});

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */
/*
 * La pantalla del televisor se cierra o se recarga a menudo (es un aparato
 * que se apaga y se enciende). Al salir de la página hay que soltar el
 * sondeo: si la pestaña se va con el sondeo vivo, la siguiente se encuentra
 * dos y la anterior sigue consultando desde una pantalla que ya no existe.
 */
addEventListener('pagehide', () => {
  app.tv?.parar();
  app.tv = null;
});
(function iniciar() {
  const sesion = leerSesion();

  // Volver a la partida tras recargar o tras un corte de señal.
  // Si hay sesión de nube con token, se reconecta y se muestra el estado
  // actual; equivale a nunca haberse ido. Si el servidor ya no conoce al
  // jugador (lo expulsaron, la sala murió), se limpia y se pide el nombre.
  // Solo se reanuda la PARTIDA DEL JUGADOR. Si el presentador abre el
  // panel, no debe encontrarse con la sesión del jugador encima: eso
  // restauraba la pantalla del participante y escondía el botón de crear
  // sala, mostrando una sala vieja que ya no se podía cambiar.
  const vista = rutaActual().vista;
  const esVistaJugador = vista === 'join' || vista === 'play';

  if (esVistaJugador && sesion && hayNube && sesion.token && sesion.roomId) {
    app.yo = sesion;
    app.cliente = crearClienteNube({
      onEstado: est => { app.estado = est; render(); }
    });
    // Errores que SÍ significan que la sesión murió. Cualquier otro (red
    // caída, servidor lento) es transitorio: expulsar al jugador por eso
    // contradice justo lo que se quería arreglar.
    const SESION_MUERTA = new Set(['jugador_ausente', 'sala_inexistente', 'sesion_incompleta']);

    const intentar = (intentos) => {
      app.cliente.reanudar({
        playerId: sesion.playerId,
        token: sesion.token,
        roomId: sesion.roomId
      }).then(r => {
        if (!r?.error) return;

        if (SESION_MUERTA.has(r.error)) {
          app.yo = null;
          app.cliente = null;
          guardarSesion();
          ponerAviso('error', 'Tu sesión terminó. Vuelve a entrar con tu nombre.');
          return;
        }

        // Fallo transitorio: se reintenta sin tocar la sesión guardada.
        if (intentos > 0) {
          setTimeout(() => intentar(intentos - 1), 2000);
        } else {
          ponerAviso('error', 'No hay conexión. Se reintentará al recargar.');
        }
      });
    };
    intentar(3);
  } else if (vista === 'play' && sesion) {
    app.yo = sesion;
    app.cliente = crearClienteLocal({
      onEstado: est => { app.estado = est; render(); }
    });
    app.cliente.pedirEstado().then(r => {
      if (r?.estado) { app.estado = r.estado; render(); }
    });
  }

  // El PRESENTADOR también sobrevive a un refresco. Su sala vive en el
  // servidor: basta recordar su id y el token para volver a ella con los
  // participantes que ya entraron.
  if (vista === 'host' && hayNube) {
    let guardada = null;
    try { guardada = JSON.parse(localStorage.getItem(CLAVE_HOST) || 'null'); } catch { guardada = null; }

    if (guardada?.roomId && guardada?.hostToken) {
      const host = crearHostNube({
        topicId: app.temaElegido,
        onEstado: est => { app.estado = est; render(); }
      });
      host.reabrir(guardada).then(r => {
        if (r?.error) {
          // La sala ya no existe o el token dejó de valer: se limpia y el
          // presentador puede crear una nueva.
          localStorage.removeItem(CLAVE_HOST);
          app.host = null;
          app.estado = null;
          render();
          return;
        }
        app.host = host;
        render();
      });
    }
  }

  render();
})();

/* ------------------------------------------------------------------ */
/* Formularios del panel de administración                              */
/* ------------------------------------------------------------------ */
document.addEventListener('submit', async ev => {
  const form = ev.target.closest('[data-form]');
  if (!form) return;
  ev.preventDefault();

  const datos = new FormData(form);
  const tipo = form.dataset.form;

  /* --- introducir la clave maestra --- */
  if (tipo === 'clave') {
    const clave = String(datos.get('clave') ?? '').trim();
    const { error } = await admin.comprobarClave(clave);
    if (error) {
      app.adminError = traducirError(error);
      render();
      return;
    }
    app.adminClave = clave;
    app.adminError = null;
    await abrirTemas();
    return;
  }

  /* --- cambiar la clave maestra --- */
  if (tipo === 'cambiar-clave') {
    const anterior = String(datos.get('anterior') ?? '').trim();
    const nueva = String(datos.get('nueva') ?? '').trim();
    const repetir = String(datos.get('repetir') ?? '').trim();

    if (nueva !== repetir) {
      app.adminError = 'Las dos claves nuevas no coinciden.';
      render();
      return;
    }
    if (nueva.length < 4) {
      app.adminError = 'La clave nueva debe tener al menos 4 caracteres.';
      render();
      return;
    }

    const { error } = await admin.cambiarClave(anterior, nueva);
    if (error) {
      app.adminError = traducirError(error);
      render();
      return;
    }
    app.adminClave = nueva;   // la sesión sigue abierta con la clave nueva
    app.modal = null;
    app.adminError = null;
    ponerAviso('ok', 'Clave maestra actualizada.');
    return;
  }

  /* --- crear un tema --- */
  if (tipo === 'crear-tema') {
    const nombre = String(datos.get('nombre') ?? '').trim();
    if (!nombre) { app.adminError = 'Escribe un nombre para el tema.'; render(); return; }

    const r = await admin.crearTema(app.adminClave, nombre);
    if (r.error) { app.adminError = traducirError(r.error); render(); return; }
    app.adminError = null;
    await abrirTemas();
    return;
  }

  /* --- guardar una pregunta (nueva o editada) --- */
  if (tipo === 'pregunta') {
    const enunciado = String(datos.get('enunciado') ?? '');
    const opciones = [0, 1, 2, 3].map(i => String(datos.get(`opcion${i}`) ?? ''));
    const correcta = datos.get('correcta');
    const referencia = String(datos.get('referencia') ?? '').trim() || null;
    const indiceCorrecto = correcta === null ? -1 : Number(correcta);

    // Misma validación que usa la base, pero al instante y sin petición.
    const problema = validarPregunta({ enunciado, opciones, indiceCorrecto });
    if (problema) { app.adminError = problema; render(); return; }

    const r = await admin.guardarPregunta(app.adminClave, {
      topicId: form.dataset.tema,
      id: form.dataset.pregunta || null,
      enunciado: enunciado.trim(),
      opciones: opciones.map(o => o.trim()),
      indiceCorrecto,
      referencia
    });
    if (r.error) { app.adminError = traducirError(r.error); render(); return; }

    app.adminError = null;
    app.editarPregunta = null;
    await abrirPreguntas(form.dataset.tema);
    return;
  }
});

/* --- elegir tema o cantidad de preguntas --- */
document.addEventListener('change', ev => {
  if (ev.target.id === 'sel-tema') {
    app.temaElegido = ev.target.value || null;
    render();
    return;
  }
  if (ev.target.id === 'cant') {
    app.cantidadPreguntas = Number(ev.target.value) || 10;
    render();
  }
});
