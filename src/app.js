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
  esc, validarNombre, segundos, normalizeName, normalizarCodigo
} from './lib/util.js';
import { crearHostLocal, crearClienteLocal, esLocalDisponible } from './lib/local.js';
import { crearHostNube, crearClienteNube, admin, rpc, resolverSala, mirarSala } from './lib/cloud.js';
import { hayNube } from './config.js';
import {
  selectorTema, modalClave, modalCambiarClave, modalTemas,
  modalPreguntas, modalFormPregunta, vistaConfig, validarPregunta,
  modalProcesando
} from './lib/admin-ui.js';
import { qrSVG } from './lib/qr.js';
import { ceremoniaHTML, totalPasos } from './lib/render.js';
import {
  pantallaParticipante, pantallaTV, listaTurnosHTML, modalJuicioHTML,
  versiculoHostHTML,
  versiculoDesdeServidor, felicitacion
} from './lib/versiculo.js';
import { crearEscalador, ajustarTextos } from './lib/ajuste.js';
import { crearLatido } from './lib/latido.js';
import { aWebp, crearImagenNavegador, lienzoNavegador, prefijoData } from './lib/imagen.js';

const $app = document.getElementById('app');

/*
 * Compensa el encogimiento del «modo escritorio» del navegador subiendo la
 * raíz una sola vez. Toda la escala de la app está en `rem`, así que con esto
 * crecen el texto, los rellenos y los huecos juntos y en su proporción.
 */
const escala = crearEscalador();

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

/**
 * El QR de una sala, UNO solo para toda la app.
 *
 * El panel del presentador y el televisor dibujaban el mismo QR con
 * parámetros distintos (`escala: 6, margen: 3` uno y `escala: 10, margen 4`
 * el otro). Como el margen desplaza el dibujo, salían dos SVG con dibujo
 * diferente: dos QRs que se leen igual pero que a la vista no coinciden, y
 * quien compara uno con otro duda de si es el mismo código.
 *
 * Aquí se fijan los parámetros de UNA vez. El tamaño en pantalla lo pone el
 * CSS (`.qr-caja` y `.qr-tv`), así que el dibujo es siempre idéntico y lo
 * único que cambia es cuánto ocupa.
 */
function qrSala(codigo) {
  return qrSVG(urlSala(codigo), { nivel: 'M', escala: 10, margen: 4 });
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

// Al girar o cambiar de tamaño cambia la escala a la que el navegador dibuja,
// y con ella el tamaño real de la letra. Reajustar siempre.
const reajustar = () => { escala.ahora(); ajustarTextos($app); };

/*
 * El ajuste de texto mide renglones, y los renglones dependen de la tipografía
 * REAL. Si se mide antes de que la fuente cargue, se mide con la de reemplazo,
 * que es más angosta: el texto «cabe» en una línea, y cuando llega la fuente
 * buena ocupa tres y nadie vuelve a ajustar. Medido: una descripción de 37
 * caracteres se quedaba en tres renglones con la letra grande por esta causa.
 */
if (typeof document !== 'undefined' && document.fonts) {
  if (document.fonts.ready) document.fonts.ready.then(reajustar).catch(() => {});
  // `ready` resuelve una sola vez y a veces antes de que la fuente se aplique.
  // `loadingdone` avisa cada vez que una tipografía termina de cargar.
  if (document.fonts.addEventListener) {
    document.fonts.addEventListener('loadingdone', reajustar);
  }
}
/*
 * Al girar el teléfono hay que reajustar DOS veces, y no es un capricho.
 * `visualViewport.scale` —la medida de la que sale la compensación— tarda en
 * actualizarse: en el primer aviso de la rotación todavía trae el valor de la
 * orientación anterior, así que medir de inmediato da la raíz del tamaño
 * equivocado (medido: 18.53 px en horizontal, cuando corresponden 19.65).
 * El `setTimeout` deja pasar ese instante y vuelve a aplicar con la escala ya
 * correcta. El `resize` que el navegador manda después coincide con la
 * segunda pasada y no molesta: `aplicarEscala` es idempotente, escribe el
 * mismo número y el navegador no recompone nada.
 */
const reajustarTrasGirar = () => {
  reajustar();
  if (typeof setTimeout === 'function') setTimeout(reajustar, 300);
};
window.addEventListener('orientationchange', reajustarTrasGirar);
// `screen.orientation` es el aviso moderno: `orientationchange` está en
// desuso y algunos navegadores ya no lo emiten.
if (typeof screen !== 'undefined' && screen.orientation && screen.orientation.addEventListener) {
  screen.orientation.addEventListener('change', reajustarTrasGirar);
}
window.addEventListener('resize', reajustar);

/*
 * El ajuste también reacciona cuando cambia el CONTENEDOR sin que cambie la
 * ventana: un panel que se abre, una columna que se ensancha, el teclado que
 * reduce el alto. Con solo `resize` de ventana, el texto conservaría el
 * tamaño calculado para un ancho que ya no existe.
 *
 * Se vigila el ANCHO, no el alto. El propio ajuste cambia la altura (la letra
 * más grande hace la caja más alta), así que observar el alto dispararía el
 * ajuste otra vez, que cambiaría el alto, y así sin fin. Con el ancho, un
 * reajuste que solo movió la altura no vuelve a entrar: el ancho no cambió.
 *
 * OJO AL MEDIR: los avisos del observador se entregan en el ciclo de dibujo,
 * así que NO llegan con la pestaña en segundo plano —igual que
 * `requestAnimationFrame`—. No es un fallo del ajuste: con la pestaña oculta
 * el navegador no dibuja, y al volver el `visibilitychange` de arriba vuelve
 * a ajustar todo. Medido: con `document.hidden === true` el texto conserva el
 * tamaño anterior por más que se estreche el contenedor; con la pestaña
 * visible, encoge solo (16 -> 12 -> 9 pt al pasar de 904 a 474 px).
 */
if (typeof ResizeObserver === 'function') {
  let anchoVisto = 0;
  let observando = false;   // un ajuste no debe re-entrar mientras corre
  const observador = new ResizeObserver(entradas => {
    if (observando) return;
    const ancho = Math.round(entradas[entradas.length - 1].contentRect.width);
    if (!ancho || ancho === anchoVisto) return;
    anchoVisto = ancho;
    observando = true;
    try { reajustar(); } finally { observando = false; }
  });
  // `border-box`: el ancho que importa para el texto es el que deja el relleno.
  observador.observe($app, { box: 'border-box' });
  anchoVisto = Math.round($app.getBoundingClientRect().width);
}
// Mientras la pestaña está oculta el navegador no produce cuadros y
// `requestAnimationFrame` no llama: hay que medir al volver.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) reajustar();
});

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
  // Qué juego está elegido. El menú lo fija al pulsar una tarjeta, y el
  // resto de la app pregunta por esto en vez de suponer que es siempre
  // selección simple.
  juegoElegido: 'seleccion-simple',
  // Juego de la sala que ya está abierta: viene del servidor y manda sobre
  // lo elegido en el menú mientras la partida exista.
  juegoSala: 'seleccion-simple',
  // Pulsación en curso: el botón negro se apaga al instante y se corrige
  // cuando el servidor contesta. Sin esto, con el sondeo de 1 400 ms el
  // jugador pulsa dos veces porque no ve nada pasar.
  enviandoPulso: false,
  rechazoPulso: null,
  // Última variante de felicitación mostrada, para no repetirla seguida.
  felicitaActual: null,
  felicitaAnterior: null,
  // Juicio en curso en el panel del presentador: { answerId, nombre }.
  juicio: null,
  cantidadPreguntas: 10,
  segundosRonda: 15,   // duración de cada pregunta (5–30)
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
  editarPregunta: null, // pregunta que se está editando (null = nueva)

  // --- marca del menú: el lema y la portada ---
  marca: null,         // lo que devuelve la base; null = todavía no se pidió
  marcaCargada: false, // evita volver a pedirla en cada render
  // El lema se edita EN EL MENÚ. `editandoLema` es el texto que se está
  // escribiendo; `null` significa que se ve como texto normal.
  editandoLema: null,
  // El primer toque solo señala. Hace falta recordarlo entre un render y el
  // otro: si viviera en el DOM, cualquier redibujado lo borraría y el segundo
  // toque nunca llegaría a contar.
  lemaSenalado: false,
  // Borrador del cambio en curso: qué se está cambiando y con qué valor.
  // La clave se pide DESPUÉS de editar, así que el valor tiene que esperar
  // en algún lado mientras se escribe la clave.
  marcaPendiente: null // { tipo: 'lema'|'portada', valor }
};

/*
 * El lema y la portada que trae el CÓDIGO. La base arranca vacía a propósito:
 * así una instalación nueva se ve igual que siempre sin que nadie configure
 * nada, y `null` en la base significa «usa esto».
 */
const LEMA_ORIGINAL = '2 Corintios · Concurso de preguntas';
const PORTADA_ORIGINAL = 'public/img/portada.webp';

/** El lema que hay que mostrar: el guardado, o el del código. */
function lemaMostrado() {
  const guardado = app.marca && typeof app.marca.lema === 'string' ? app.marca.lema.trim() : '';
  return guardado || LEMA_ORIGINAL;
}

/**
 * La portada que hay que mostrar.
 *
 * La guardada viene en base64 dentro del JSON. Se le arma el prefijo `data:`
 * para que el navegador la dibuje como cualquier imagen. Si no hay guardada,
 * se usa el archivo del proyecto.
 */
function portadaMostrada() {
  const guardada = app.marca && typeof app.marca.portada === 'string' ? app.marca.portada : '';
  return guardada ? prefijoData(guardada) : PORTADA_ORIGINAL;
}

const CLAVE_SESION = 'desafio-biblico-sesion';
// El juego elegido en el menú sobrevive a entrar a cualquier vista y a
// recargar la página. Sin esto, volver al menú devolvía siempre a selección
// simple y el presentador tenía que reelegir cada vez.
const CLAVE_JUEGO = 'desafio-biblico-juego';
// La sala del presentador se guarda aparte: si refresca, debe volver a SU
// sala con sus participantes, no encontrarse el panel vacío.
const CLAVE_HOST = 'desafio-biblico-host';

function guardarSesion() {
  try {
    if (app.yo) localStorage.setItem(CLAVE_SESION, JSON.stringify(app.yo));
    else localStorage.removeItem(CLAVE_SESION);
  } catch { /* modo privado: la sesión vive solo en memoria */ }
}

function guardarJuego(slug) {
  try { localStorage.setItem(CLAVE_JUEGO, String(slug)); }
  catch { /* modo privado: la elección vive solo en memoria */ }
}

/**
 * El juego guardado, o null si no hay ninguno válido.
 *
 * Se valida contra la lista de juegos conocidos: si el almacenamiento trae
 * basura o el slug de un juego que ya no existe, se ignora en vez de dejar
 * la app en un estado que ninguna pantalla sabe dibujar.
 */
function leerJuego() {
  const VALIDOS = ['seleccion-simple', 'completar-versiculo'];
  try {
    const guardado = localStorage.getItem(CLAVE_JUEGO);
    return VALIDOS.includes(guardado) ? guardado : null;
  } catch { return null; }
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
 * Motivo del cierre para mostrar en pantalla, o null si lo cerró el
 * presentador (ahí se usa el texto de siempre).
 */
function motivoCierre(est) {
  if (est?.closeReason === 'inactividad') {
    return 'La sala se cerró sola porque el presentador estuvo 30 minutos sin actividad.';
  }
  return null;
}

/**
 * Saca al jugador de una sala que cerró el SERVIDOR por inactividad.
 *
 * Es distinto de que el presentador pulse «Menú»: ahí él decidió, y el
 * jugador merece saber por qué se quedó sin partida. Antes de esto, una
 * sala abandonada dejaba el teléfono en «espera la respuesta» para
 * siempre, sin explicación y sin camino de vuelta.
 *
 * El aviso NO se borra solo (`ms = 0`): es la única explicación que va a
 * recibir. Si desapareciera a los cuatro segundos, el jugador volvería al
 * menú sin entender nada.
 *
 * Devuelve true si expulsó, para que quien llama sepa que ya navegó.
 */
function expulsarSiCerradaPorInactividad(est) {
  if (!est || est.status !== 'closed') return false;
  const motivo = motivoCierre(est);
  if (!motivo) return false;

  app.yo = null;
  app.cliente?.cerrar?.();
  app.cliente = null;
  app.estado = null;
  guardarSesion();

  ponerAviso('espera', motivo, 0);
  ir('menu');
  return true;
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

/* ------------------------------------------------------------------ */
/* VISTA: menú                                                         */
/* ------------------------------------------------------------------ */

/**
 * El lema del menú, que se edita con DOS toques.
 *
 * Dos toques y no un doble clic, y la diferencia importa: un doble clic es un
 * gesto único que el navegador arma por su cuenta (dos clics en menos de medio
 * segundo) y que en un teléfono no existe. Acá el primer toque SEÑALA —el
 * texto queda marcado, y se ve que está seleccionado— y el segundo lo
 * convierte en un campo editable. Así funciona igual con dedo que con mouse,
 * y de paso se avisa antes de abrir un campo de escritura, que en una pantalla
 * táctil es un cambio grande.
 *
 * El orden que se pidió, y que no se puede invertir:
 *   1. se edita el texto;
 *   2. se pide la clave maestra;
 *   3. si es correcta se aplica; si no, no;
 *   4. en los dos casos se guarda lo escrito y el campo vuelve a ser texto.
 */
/**
 * «Juego: …» debajo del lema.
 *
 * Dice en una línea qué juego se va a lanzar, porque los tres botones de
 * abajo (presentador, participante, televisor) cambian de comportamiento
 * según esto. Sin el rótulo, el presentador no tiene forma de saber en qué
 * juego va a crear la sala.
 */
function juegoActualHTML(juegos) {
  const j = juegos.find(x => x.slug === app.juegoElegido);
  if (!j) return '';
  return `
    <p class="menu-juego-actual">
      <span class="rotulo">Juego:</span>
      <span class="valor">${esc(j.nombre)}</span>
    </p>`;
}

function lemaHTML() {
  const editando = app.editandoLema !== null;

  if (editando) {
    return `
      <form class="menu-lema-editor" data-form="lema">
        <input id="in-lema" name="lema" type="text" value="${esc(app.editandoLema)}"
               maxlength="120" autocomplete="off" enterkeyhint="done"
               aria-label="Texto del menú">
        <div class="fila" style="gap:.5rem; margin-top:.5rem">
          <button type="button" class="boton boton-secundario" data-accion="cancelar-lema">
            Cancelar
          </button>
          <button type="submit" class="boton boton-oro">Guardar</button>
        </div>
      </form>`;
  }

  const marcado = app.lemaSenalado === true;
  return `
    <p class="menu-lema${marcado ? ' señalado' : ''}" data-accion="editar-lema"
       role="button" tabindex="0"
       aria-label="${marcado ? 'Toca otra vez para editar el texto' : 'Texto del menú'}">
      ${esc(lemaMostrado())}
    </p>`;
}

function vistaMenu() {
  const juegos = [
    { slug: 'seleccion-simple', icono: '🎯', nombre: 'Selección simple',
      desc: 'Una pregunta, 4 opciones y una sola correcta.', listo: true },
    { slug: 'completar-versiculo', icono: '📖', nombre: 'Completar el versículo',
      desc: 'Un versículo con palabras tapadas. Pulsa para tomar el turno.', listo: true },
    { slug: 'respuesta-abierta', icono: '💬', nombre: 'Respuesta abierta',
      desc: 'El presentador lee y cada quien escribe.', listo: false }
  ];
  const disponibles = juegos.filter(j => j.listo).length;

  return `
    <header class="menu-cabecera">
      <div class="portada">
        <img src="${portadaMostrada()}" alt="Desafío Bíblico 2026 — 2 Corintios"
             fetchpriority="high" decoding="async">
        <!-- El lápiz va en la esquina superior derecha DE LA IMAGEN, no de la
             pantalla. Es una silueta sin fondo para que no tape la portada, y
             pide la clave maestra antes de abrir el explorador. -->
        <button type="button" class="lapiz-portada" data-accion="cambiar-portada"
                aria-label="Cambiar la imagen del menú"
                title="Cambiar la imagen del menú">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
          </svg>
        </button>
      </div>
    </header>

    <main class="crecer columna menu-cuerpo">
      <div class="menu-titulo">
        <span aria-hidden="true">🏆</span>
        <h1>DESAFÍO BÍBLICO</h1>
        <span aria-hidden="true">⭐</span>
      </div>
      ${lemaHTML()}
      ${juegoActualHTML(juegos)}

      ${/*
        El menú es donde aterriza el jugador cuando el servidor cierra la
        sala por inactividad. Sin este hueco, el aviso con el motivo se
        guardaba en el estado y no se dibujaba en ninguna parte: el jugador
        llegaba al menú sin saber por qué había salido de la partida.
      */''}
      ${avisoHTML()}

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
          <button class="juego-tarjeta${j.listo ? ' listo' : ''}${
                  j.slug === app.juegoElegido ? ' elegido' : ''}"
                  ${j.slug === app.juegoElegido ? 'aria-current="true"' : ''}"
                  ${j.listo ? `data-accion="elegir-juego" data-juego="${j.slug}"` : 'disabled'}>
            <span class="icono" aria-hidden="true">${j.icono}</span>
            <span class="texto">
              <span class="nombre">${esc(j.nombre)}</span>
              <span class="desc">${esc(j.desc)}</span>
            </span>
            <span class="insignia">${
              j.listo
                ? (j.slug === app.juegoElegido ? 'Seleccionado' : 'Elegible')
                : 'Pronto'
            }</span>
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

/* ------------------------------------------------------------------ */
/* Completar el versículo: piezas que las pantallas necesitan          */
/* ------------------------------------------------------------------ */

/** Mi pulso en la ronda actual, o null si no pulsé. */
function pulsoPropio(s) {
  const v = versiculoDesdeServidor(s);
  const yo = app.yo?.playerId;
  if (!v || !yo) return null;
  return v.pulsos.find(p => p.playerId === yo) ?? null;
}

/**
 * La variante de felicitación que corresponde MOSTRAR ahora.
 *
 * Se fija una sola vez por ronda y se guarda: si se sorteara en cada
 * dibujado, el sondeo la cambiaría cada segundo y el mensaje parpadearía
 * entre seis frases distintas.
 */
function felicitaPara(s, miPulso) {
  const v = versiculoDesdeServidor(s);
  if (!v?.completo || miPulso?.veredicto !== 'correcto') {
    app.felicitaActual = null;
    return null;
  }
  if (!app.felicitaActual) {
    app.felicitaActual = felicitacion(Math.random(), app.felicitaAnterior ?? null);
    app.felicitaAnterior = app.felicitaActual;
  }
  return app.felicitaActual;
}

/**
 * Panel del presentador para completar el versículo.
 *
 * El presentador es el árbitro: aquí SÍ se ven las palabras ocultas. Es la
 * única pantalla donde eso es correcto.
 */
function panelVersiculo(estado) {
  const r = estado?.round;
  const v = versiculoDesdeServidor(estado);
  // Una sola fuente: el estado que ya tradujo el servidor.
  const huecos = estado?.huecos ?? [];
  // En sala de espera el panel no puede ser una pantalla sin salida: por eso
  // el QR, el código y la lista van arriba siempre, haya ronda o no.
  const jugando = (estado?.players ?? []).filter(p => !p.waiting && !p.kicked);

  const cabecera = `
    <div class="fila-entre">
      <button class="boton boton-secundario" data-accion="pedir-cerrar-sala">← Menú</button>
      <span class="fila chico">
        <span class="punto-vivo"></span> En línea
      </span>
    </div>`;

  const entorno = `
    <div class="sala-cabecera">
      <div class="qr-caja" title="Escanéalo para entrar a la sala">
        ${qrSala(estado.code)}
      </div>
      <div class="sala-datos">
        <span class="mini tenue">Código de la sala</span>
        <div class="codigo-sala">${esc(estado.code ?? '')}</div>
        <span class="chico tenue">
          ${jugando.length} participante${jugando.length === 1 ? '' : 's'}
        </span>
        <span class="mini tenue">Escanea el QR o escribe el código</span>
      </div>
    </div>
  `;

  // La lista va al final de la pantalla, debajo del botón: primero se ve el
  // código, luego lo que hay que hacer, y abajo quién llegó. Mismo orden que
  // selección simple.
  /* Reusa la lista de participantes que ya existe (`.lista-jugadores` y
     `.nombre-j`), con su estilo y su rejilla. Inventar clases nuevas para lo
     mismo dejó la lista sin CSS: se dibujaba cruda, sin separación, y
     parecía que los participantes no estaban. */
  const lista = `
    <div class="columna" style="gap:.4rem">
      <h3 style="font-size:var(--t-sm); margin:0">Participantes</h3>
      ${jugando.length === 0
        ? '<p class="mini tenue">Nadie ha entrado todavía. Comparte el código.</p>'
        : `<ul class="lista-jugadores">${jugando.map(p => `
            <li>
              <span class="nombre-j">${esc(p.name)}</span>
              <span class="chico tenue">${p.score ?? 0} pt${(p.score ?? 0) === 1 ? '' : 's'}</span>
              <button class="mini-btn" data-accion="expulsar" data-id="${p.id}"
                title="Retirar de la sala">✕</button>
            </li>`).join('')}</ul>`}
    </div>`;

  // Lobby: la sala existe y espera. Mismo orden que selección simple —
  // código y QR, aviso de que está lista, el botón que ABRE el presentador,
  // y abajo la lista de quién entró. Nada se abre solo.
  if (!r) {
    return `
      ${cabecera}
      <main class="crecer columna panel-host" style="gap:1rem; margin-top:1rem">
        ${entorno}
        ${avisoHTML()}
        <div class="columna" style="gap:.8rem; margin-top:.5rem">
          <div class="aviso info">
            Lista para empezar: ${app.cantidadPreguntas} versículos preparados.
          </div>
          <button class="boton-grande" data-accion="abrir">Empezar el primer versículo</button>
        </div>
        ${lista}
      </main>`;
  }

  const nHuecos = v?.huecosTotales ?? 0;
  const listos = v ? v.revelados.length : 0;

  let controles = '';
  if (r.state === 'prepared' || r.state === 'open') {
    controles = r.state === 'prepared'
      ? `<div class="fila-botones">
           <button data-accion="iniciar">▶ Soltar temporizador (${estado.roundSeconds ?? 15} s)</button>
         </div>
         <div class="fila-botones">
           <button class="boton-secundario" data-accion="cambiar-pregunta">🔄 Cambiar versículo</button>
         </div>`
      : `<div class="fila-botones">
           <button class="boton-secundario" data-accion="pausar">${estado.paused ? '▶ Reanudar' : '⏸ Pausar'}</button>
           <button data-accion="cerrar-pulsaciones">Cerrar pulsaciones</button>
         </div>
         <div class="fila-botones">
           <button class="boton-secundario" data-accion="cambiar-pregunta">🔄 Cambiar versículo</button>
         </div>`;
  } else if (r.state === 'juicio') {
    const turno = v?.contestando;
    controles = `
      ${turno
        ? `<div class="aviso turno">🎤 Le toca a ${esc(turno.nombre)} · fue el ${turno.orden} en pulsar</div>`
        : `<div class="aviso neutro">Nadie pulsó esta ronda.</div>`}
      ${turno ? `
      <div class="fila-botones">
        <button class="boton-peligro" data-accion="sentenciar-mal">❌ Incorrecto</button>
        <button data-accion="sentenciar-bien">✅ Correcto</button>
      </div>` : ''}
      <div class="fila-botones">
        <button class="boton-secundario" data-accion="deshacer-sentencia">↶ Deshacer</button>
        <button class="boton-secundario" data-accion="cerrar-pregunta">Cerrar pregunta</button>
      </div>`;
  } else {
    controles = `
      <div class="fila-botones">
        <button class="boton-secundario" data-accion="deshacer-sentencia">↶ Deshacer</button>
        <button data-accion="abrir">Siguiente versículo →</button>
      </div>`;
  }

  return `
    ${cabecera}
    <main class="crecer columna panel-host" style="gap:1rem; margin-top:1rem">
      ${entorno}
      ${avisoHTML()}

      <div class="fila-entre">
        ${r.reference ? `<span class="mini tenue">${esc(r.reference)}</span>` : '<span></span>'}
        <span class="mini tenue">
          ${listos} de ${nHuecos} palabras a la vista
          ${ayuda('Cuántas de las palabras ocultas de este versículo ya se destaparon. '
                + 'El presentador las ve todas subrayadas; los participantes solo ven las destapadas.')}
        </span>
      </div>

      ${r.state === 'open' && !estado.paused ? barraTiempoHTML(r) : ''}

      ${/*
        El presentador ve el versículo COMPLETO, con las palabras ocultas
        subrayadas: eso le dice cuáles no ven los demás, sin un bloque aparte
        que repita la respuesta. Las que ya se destaparon van sin subrayar,
        porque ya las ve todo el mundo.
      */''}
      <p class="enunciado">${versiculoHostHTML(r.prompt, huecos)}</p>

      ${listaTurnosHTML(v)}
      ${controles}
      ${lista}
      <button class="boton boton-peligro" data-accion="pedir-terminar">
        Terminar juego
      </button>
    </main>`;
}

function vistaHost() {
  const s = app.estado;

  if (s && s.gameSlug === 'completar-versiculo') {
    return panelVersiculo(s);
  }

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

        <div class="campo" style="max-width:var(--ancho-form); width:100%">
          <label for="cant">Preguntas en esta partida ${ayuda(
            'Se eligen al azar empezando por las que hace más tiempo no se juegan. '
            + (nPreguntas ? 'Este tema tiene ' + nPreguntas + '.' : ''))}</label>
          <select id="cant" ${puedeCrear ? '' : 'disabled'}>
            ${[5, 10, 15, 20, 25, 30, 40, 50].filter(n => n <= Math.max(nPreguntas, 5)).map(n =>
              `<option value="${n}" ${n === app.cantidadPreguntas ? 'selected' : ''}>${n} preguntas</option>`).join('')}
          </select>
        </div>

        <div class="campo" style="max-width:var(--ancho-form); width:100%">
          <label for="seg">Segundos por pregunta ${ayuda(
            'Cuánto tiempo tienen para responder. Son juegos de reacción rápida: '
            + 'por encima de 30 segundos la espera se hace larga sin aportar nada.')}</label>
          <select id="seg" ${puedeCrear ? '' : 'disabled'}>
            ${[5, 10, 15, 20, 25, 30].map(n =>
              `<option value="${n}" ${n === app.segundosRonda ? 'selected' : ''}>${n} segundos</option>`).join('')}
          </select>
        </div>

        ${avisoHTML()}
        <button class="boton-grande" data-accion="crear-sala"
                style="max-width:var(--ancho-form)" ${puedeCrear ? '' : 'disabled'}
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

  /*
   * La sala se cerró sin que el presentador lo pidiera: lo hizo el barrido
   * por inactividad. Sin esta pantalla, el panel seguía dibujando los
   * botones de una partida que ya no existe y cada pulsación fallaba.
   *
   * También se llega aquí si el cierre lo hizo otro dispositivo con el
   * mismo enlace: en los dos casos lo honesto es decirlo y ofrecer salida.
   */
  if (s.status === 'closed') {
    return `
      <main class="crecer columna centro" style="gap:1rem">
        <h1>La sala está cerrada</h1>
        <div class="aviso espera centro" style="text-align:center">
          ${motivoCierre(s) ?? 'La sala se cerró.'}
        </div>
        <p class="tenue centro chico" style="text-align:center; max-width:34ch">
          Los participantes ya salieron. Puedes crear otra sala cuando quieras.
        </p>
        <button class="boton" data-accion="olvidar-sala-cerrada">Crear otra sala</button>
      </main>`;
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
          ${qrSala(s.code)}
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
          <button class="boton boton-secundario" data-accion="cambiar-pregunta" style="flex:1">
            🔄 Cambiar pregunta ${ayuda('Pone otra pregunta del banco sin gastar el turno: sigue siendo la misma pregunta del concurso y nadie suma ni pierde puntos por la anterior.')}
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
          <button class="boton boton-secundario" data-accion="cambiar-pregunta" style="flex:1">
            🔄 Cambiar pregunta ${ayuda('Pone otra pregunta del banco sin gastar el turno. El reloj vuelve a cero y las respuestas de esta se descartan.')}
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

  // Completar el versículo tiene su propia pantalla. Se decide por lo que
  // dice el SERVIDOR (`gameSlug`), no por lo elegido en el menú: un jugador
  // que entra con un código no pasó por el menú, y su teléfono tiene que
  // mostrar lo que la sala está jugando.
  if (s && s.gameSlug === 'completar-versiculo' && app.yo) {
    const miPulso = pulsoPropio(s);
    const rr = s.round;
    const base = rr ? {
      openedAt: rr.openedAt, pausedAt: rr.pausedAt,
      pausedTotal: rr.pausedTotal, durationMs: rr.deadlineMs
    } : null;
    return pantallaParticipante(s, {
      miId: app.yo.playerId,
      miPulso,
      enviando: app.enviandoPulso,
      rechazo: app.rechazoPulso,
      felicitacionActual: felicitaPara(s, miPulso),
      restanteMs: base ? E.restanteMs(base) : null,
      totalMs: rr?.deadlineMs ?? null
    });
  }

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
        <div class="columna" style="gap:.8rem; max-width:var(--ancho-form); width:100%">
          <div class="campo">
            <label for="codigo">Código de la sala ${ayuda('Son los cinco caracteres que muestra la pantalla del presentador. Se pueden escribir con espacios: «B 7 3 W S» es lo mismo que «B73WS».')}</label>
            <input id="codigo" type="text" maxlength="12" autocapitalize="characters"
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
          ${motivoCierre(s) ?? 'El presentador cerró la sala.'}
        </div>
        ${/*
          Sin afirmar si la partida llegó al final o no: `closed` cubre los
          dos casos (cerrada a media partida y cerrada después de la
          ceremonia), y decir «no llegó al final» cuando sí terminó sería
          mentirle al jugador que acaba de ver la tabla.
        */''}
        <p class="tenue centro chico" style="text-align:center; max-width:32ch">
          Gracias por participar. Puedes volver al menú y entrar a otra sala.
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
/**
 * Sala de espera del televisor: el QR y el código, grandes y juntos.
 *
 * Es el único momento en que el televisor tiene algo que pedirle al público.
 * Antes el código estaba arriba a la derecha en letra pequeña, casi de
 * adorno, y quien llegaba tarde no sabía qué escribir en el teléfono. Aquí
 * el QR ocupa el centro y el código va debajo, en el tamaño más grande de la
 * escala, para que se lea desde el fondo del salón.
 */
function salaEsperaHTML(s) {
  const dentro = (s.players ?? []).filter(p => !p.kicked && !p.waiting);
  const cuantos = dentro.length;

  return `
    <div class="columna centro" style="gap:1.2rem; margin-top:.5rem">
      <p class="tenue centro" style="text-align:center; margin:0; font-size:var(--t-lg)">
        Escanea el QR o escribe el código para entrar
      </p>

      <div class="qr-caja qr-tv" title="Escanéalo para entrar a la sala">
        ${qrSala(s.code)}
      </div>

      <div class="codigo-tv">${esc(s.code)}</div>

      ${/*
        Quiénes están dentro, con nombre.
        El conteo solo («2 participantes») no le dice nada a quien está en el
        salón: cada uno quiere confirmar que SU nombre aparece. Se muestran
        todos mientras quepan; con mucha gente se recorta la lista para no
        empujar el QR fuera de la pantalla.
       */''}
      ${cuantos === 0
        ? `<p class="tenue centro" style="text-align:center; margin:0">
             Nadie ha entrado todavía.
           </p>`
        : `<div class="columna" style="gap:.4rem; width:100%; max-width:var(--ancho-lista)">
             <p class="chico centro" style="text-align:center; margin:0; color:var(--tu-100)">
               Ya están dentro ${cuantos} participante${cuantos === 1 ? '' : 's'}:
             </p>
             <ul class="lista-espera-tv">
               ${dentro.slice(0, 12).map(p => `<li>${esc(p.name)}</li>`).join('')}
             </ul>
             ${cuantos > 12
               ? `<p class="mini tenue centro" style="text-align:center; margin:0">
                    y ${cuantos - 12} más…
                  </p>`
               : ''}
           </div>`}

      <p class="mini tenue centro" style="text-align:center; margin:0; max-width:38ch">
        La partida empieza en cuanto el presentador lance la primera pregunta.
      </p>
    </div>`;
}

function vistaTV() {
  // El televisor solo se cree su PROPIO sondeo. `app.estado` lo comparten
  // todas las vistas: sin esta condición, abrir el televisor después del
  // panel del presentador mostraba el estado del host —con la respuesta
  // correcta incluida— en una pantalla que ve todo el público.
  const s = app.tv ? app.estado : null;

  if (s && s.gameSlug === 'completar-versiculo') {
    // El QR se dibuja aquí: la URL de la sala la conoce esta capa.
    const rr = s.round;
    const base = rr ? {
      openedAt: rr.openedAt, pausedAt: rr.pausedAt,
      pausedTotal: rr.pausedTotal, durationMs: rr.deadlineMs
    } : null;
    return pantallaTV(s, {
      qr: s.code ? qrSala(s.code) : '',
      restanteMs: base ? E.restanteMs(base) : null,
      totalMs: rr?.deadlineMs ?? null
    });
  }

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

    // `?? ` no basta: una cadena vacía (el campo recién limpiado) es un
    // valor válido y debe ganarle al código de la URL. Con `??` el campo se
    // volvía a llenar con el de la dirección y la limpieza no se veía.
    const codigoInicial = app.formTV.codigo != null
      ? app.formTV.codigo
      : (codigoDeUrl() ?? '');
    return `
      <main class="crecer columna centro" style="gap:1rem">
        <h1>Desafío Bíblico</h1>
        <p class="tenue" style="text-align:center; max-width:34ch">
          Escribe el código que muestra la pantalla del presentador y este
          televisor sigue la partida.
        </p>
        <div class="columna" style="gap:.8rem; max-width:var(--ancho-form); width:100%">
          <div class="campo">
            <label for="codigo-tv">Código de la sala ${ayuda('Son los cinco caracteres que muestra el presentador. Se pueden escribir con espacios: «B 7 3 W S» es lo mismo que «B73WS».')}</label>
            <input id="codigo-tv" type="text" maxlength="12" autocapitalize="characters"
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

  /*
   * Sala cerrada: el presentador se fue. Se avisa y se deja de consultar,
   * porque ya no va a llegar nada nuevo por más que se pregunte.
   */
  if (s.status === 'closed') {
    return `
      <main class="crecer columna centro" style="gap:1rem">
        <h1>Desafío Bíblico</h1>
        <div class="aviso espera centro" style="text-align:center">
          ${motivoCierre(s) ?? 'El presentador cerró la sala.'}
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
        ${/*
          El código ya no va aquí arriba, en pequeño y a la derecha.
          Mientras la sala está en espera el televisor tiene una sola misión:
          que la gente entre. Para eso el QR y el código van juntos, grandes
          y centrados más abajo. Cuando la partida arranca, el código pequeño
          vuelve a la cabecera.
        */''}
        ${r ? `
          <div class="columna" style="align-items:flex-end; gap:.2rem">
            <span class="mini tenue">Código</span>
            <span class="chico" style="color:var(--raya); font-weight:800; letter-spacing:.1em">
              ${esc(s.code)}
            </span>
          </div>` : ''}
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
            <div class="opcion${esCorrecta ? ' correcta' : ''}" role="presentation">
              <span class="letra">${'ABCD'[i]}</span>
              <span>${esc(o)}</span>
            </div>`;
          }).join('')}
        </div>

        ${r.state === 'revealed' ? `
          <p class="centro" style="text-align:center; font-size:var(--t-xl); color:var(--raya); font-weight:800">
            ${r.noWinner ? 'Nadie acertó' : `🎉 ${esc(s.players.find(p => p.id === r.winnerId)?.name ?? '')}`}
          </p>` : ''}
      ` : salaEsperaHTML(s)}
      ${/*
          Sin marcador a propósito.
          Antes el televisor mostraba los cinco primeros con sus puntos
          mientras se jugaba, y eso arruinaba el suspenso: todo el salón veía
          quién iba ganando antes de la ceremonia. Los puntos se conocen solo
          al final, en la tabla de clasificación que se revela de abajo hacia
          arriba.
       */''}
    </main>`;
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */
let timerReloj = null;
let latido = null;   // el que mueve la barra del tiempo, cuadro por cuadro
// Último HTML dibujado. Evita reescribir el DOM cuando nada cambió: eso
// reiniciaba el confeti de la ceremonia en cada vuelta del sondeo.
let htmlAnterior = '';
// Cerrojo de cierre de sala. Evita DOS problemas distintos:
//   · mandar dos veces la orden al servidor (doble toque en «Sí, cerrar»);
//   · que un segundo toque en «Jugar de nuevo» corra mientras el primero
//     está esperando la respuesta y destruya la sesión NUEVA al terminar.
// Con `await` de por medio hay una ventana de reentrada que no existía
// cuando todo era síncrono.
let cerrando = false;

/* ------------------------------------------------------------------ */
/* Administración: temas, preguntas y clave maestra                    */
/* ------------------------------------------------------------------ */

/**
 * Carga el lema y la portada guardados, y refresca.
 *
 * Si falla, NO se avisa con un cartel: el menú se dibuja igual con el lema y
 * la portada del código, que es exactamente lo que se veía antes de que esto
 * existiera. Un aviso rojo por no poder leer un adorno del menú sería peor
 * que el problema: el juego se puede jugar con el texto original.
 */
async function cargarMarca() {
  if (!hayNube) return;
  const { marca, error } = await admin.marca();
  if (error || !marca) return;
  app.marca = marca;
  render();
}

/** Carga los temas del servidor y refresca la pantalla. */
async function cargarTemas() {
  if (!hayNube) return;
  // El juego va en la consulta. Sin esto se listaban SIEMPRE los temas de
  // selección simple: el panel del juego nuevo ofrecía «2 Corintios (25
  // preguntas)», que es el tema del otro juego. La sala nacía pidiendo 25
  // versículos de un tema que no tiene ninguno, el plan quedaba vacío y el
  // presentador no podía abrir la primera pregunta.
  const { temas, error } = await admin.temas(app.juegoElegido);
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
  app.modal = { tipo: 'clave', para: 'entrar' };
  app.adminError = null;
  render();
}

/**
 * Guarda el lema. Se llama SOLO con la clave ya verificada.
 *
 * El lema se edita en el menú y la clave se pide después: mientras se escribe
 * la clave, lo editado espera en `marcaPendiente`. Si la clave es incorrecta,
 * el valor NO se pierde —queda en el estado y el modal lo vuelve a mostrar—
 * porque hacer reescribir el texto por una clave mal tecleada sería castigar
 * el error equivocado.
 */
async function guardarLema(lema) {
  const { marca, error } = await admin.cambiarLema(app.adminClave, lema);
  if (error) {
    // La clave ya se verificó en la sesión, así que un error acá no es de
    // clave: es de red o del servidor. Se dice, y el cambio no se pierde.
    app.adminError = traducirError(error);
    app.modal = { tipo: 'clave', para: 'lema', muestra: lema, error: app.adminError };
    render();
    return false;
  }
  if (marca) app.marca = { ...(app.marca || {}), lema: (lema || '').trim() || null };
  app.editandoLema = null;
  app.lemaSenalado = false;
  app.marcaPendiente = null;
  app.modal = null;
  app.adminError = null;
  ponerAviso('ok', 'Texto del menú actualizado.', 3000);
  return true;
}

/**
 * Abre el explorador de archivos y convierte lo elegido.
 *
 * El `<input type="file">` es del navegador, así que abre el explorador del
 * sistema que corresponda —el de Android, el de Windows, el de macOS, el de
 * Linux, el de iPhone— sin que haya que programar nada por plataforma.
 * `accept` filtra lo que se puede elegir, que es una ayuda, no una garantía:
 * un explorador puede dejar pasar otra cosa, y por eso lo elegido se revisa.
 */
function abrirSelectorDeImagen() {
  const entrada = document.createElement('input');
  entrada.type = 'file';
  entrada.accept = 'image/*';
  entrada.style.position = 'fixed';
  entrada.style.left = '-9999px';

  entrada.addEventListener('change', async () => {
    const archivo = entrada.files && entrada.files[0];
    entrada.remove();
    if (!archivo) return;   // se cerró el explorador sin elegir: no es un error
    await aplicarImagen(archivo);
  });

  document.body.appendChild(entrada);
  entrada.click();
}

/** Convierte a webp lo elegido y lo guarda. */
async function aplicarImagen(archivo) {
  app.modal = { tipo: 'procesando', que: 'la imagen' };
  app.adminError = null;
  render();

  let datos;
  try {
    datos = await archivo.arrayBuffer();
  } catch {
    app.modal = null;
    ponerAviso('error', 'No se pudo leer el archivo elegido.');
    return;
  }

  let convertida;
  try {
    convertida = await aWebp({
      datos,
      tipo: archivo.type,
      nombre: archivo.name,
      crearImagen: crearImagenNavegador,
      lienzoDe: lienzoNavegador
    });
  } catch (e) {
    app.modal = null;
    ponerAviso('error', traducirErrorImagen(e && e.message));
    return;
  }

  const { error } = await admin.cambiarPortada(app.adminClave, convertida.html);
  if (error) {
    app.modal = null;
    // Si el servidor la rechazó, se dice qué pasó. La app ya convirtió, así
    // que un rechazo acá es de tamaño o de formato, no de red.
    ponerAviso('error', traducirError(error));
    return;
  }

  // Guardado con éxito: se relee de donde se guardó, que es la regla. No se
  // da por hecho que el valor en memoria es el que quedó en la base.
  app.marca = { ...(app.marca || {}), portada: convertida.html };
  app.marcaCargada = true;
  app.modal = null;
  app.marcaPendiente = null;
  ponerAviso('ok', 'Imagen cambiada con éxito.', 4000);
}

/** Los errores de la conversión, dichos como los diría una persona. */
function traducirErrorImagen(codigo) {
  const frases = {
    archivo_vacio: 'El archivo está vacío.',
    imagen_ilegible: 'Ese archivo no se pudo abrir como imagen.',
    gif_no_soportado: 'Los gif animados no se pueden usar como imagen del menú.',
    no_es_imagen: 'Ese archivo no es una imagen.',
    no_se_pudo_convertir: 'No se pudo preparar la imagen. Prueba con otra.',
    sin_lienzo: 'Este navegador no puede preparar la imagen.',
    sin_herramientas: 'Este navegador no puede preparar la imagen.',
    imagen_muy_grande: 'La imagen es demasiado grande. Prueba con una más liviana.',
    imagen_no_webp: 'La imagen no quedó en el formato correcto. Prueba con otra.'
  };
  return frases[codigo] ?? 'No se pudo preparar la imagen.';
}

/** Abre la lista de temas (ya con la clave verificada). */
async function abrirTemas() {
  app.modal = { tipo: 'temas' };
  app.adminError = null;
  render();
  const { temas, error } = await admin.temas(app.juegoElegido);
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
    case 'juicio':      return modalJuicioHTML(
                          versiculoDesdeServidor(app.estado),
                          app.estado?.huecos ?? [],
                          app.juicio?.nombre ?? ''
                        );
    case 'procesando':  return modalProcesando({ que: m.que });
    case 'clave':       return modalClave({
                          para: m.para || 'entrar',
                          error: err,
                          pista: m.pista || null,
                          muestra: m.muestra || null
                        });
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

  /* Si hay una sala viva, SU juego es el último que se jugó: entra a valer
     como el elegido aunque se haya llegado con un código y sin pasar por el
     menú. Se hace aquí, en el único sitio por donde pasan todos los estados,
     en vez de en cada sondeo por separado.

     SOLO fuera del menú. Dentro del menú manda lo que la persona acaba de
     elegir: si un estado viejo de otra sala siguiera en memoria, tocar una
     tarjeta se revertiría sola en el siguiente render y el botón parecería
     no responder. */
  const juegoDeLaSala = vista === 'menu' ? null : app.estado?.gameSlug;
  if (juegoDeLaSala && juegoDeLaSala !== app.juegoElegido) {
    app.juegoElegido = juegoDeLaSala;
    guardarJuego(juegoDeLaSala);
    app.temas = [];
    app.temasCargados = false;
    app.temaElegido = null;
  }

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

  /*
   * Solo se reescribe el DOM si el HTML cambió.
   *
   * `innerHTML = html` destruye y recrea TODOS los nodos. En la ceremonia
   * el sondeo de la nube vuelve a dibujar cada segundo; con los resultados
   * ya en pantalla, cada uno de esos redibujados reiniciaba el confeti y
   * hacía parpadear la tabla. Comparar antes de escribir deja la pantalla
   * quieta cuando nada cambió, que es la mayor parte del tiempo.
   */
  if (html !== htmlAnterior) {
    $app.innerHTML = html;
    htmlAnterior = html;
  }
  document.body.classList.toggle('tv', vista === 'tv');

  /* Escalar y ajustar, en este orden y sin diferir.
     El ajuste de texto mide renglones comparando contra la raíz: si la
     compensación todavía no está aplicada, los `rem` valen otra cosa y la
     cuenta sale mal. Por eso la escala va primero y de forma sincrónica. */
  escala.ahora();
  ajustarTextos($app);

  /* Segunda pasada en el cuadro siguiente.
     La primera mide con la maqueta a medio asentar: la columna del texto
     todavía no tiene su ancho final, así que un párrafo «cabe» en una línea y
     al asentarse ocupa tres. Medido: una descripción de 37 caracteres se
     quedaba en tres renglones con la letra al máximo por esta causa. La
     segunda pasada mide lo que de verdad quedó pintado y corrige.
     Es idempotente: empieza limpiando el recorte anterior, así que puede
     crecer otra vez si ahora entra. */
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => ajustarTextos($app));
  }

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

  // La marca del menú (el lema y la portada) se pide una vez, al pasar por el
  // menú. La bandera evita el bucle: si la consulta vuelve vacía, render() no
  // debe volver a pedirla, porque se llamaría a sí mismo sin fin.
  if (vista === 'menu' && hayNube && !app.marcaCargada) {
    app.marcaCargada = true;
    cargarMarca();
  }

  /*
   * El reloj se mueve CUADRO POR CUADRO, no por intervalos.
   *
   * Antes era un `setInterval` de 250 ms con `transition: width .25s` en la
   * hoja de estilos: la animación duraba exactamente lo mismo que el
   * intervalo. Cuando dos cosas encadenadas duran igual y las dispara un reloj
   * impreciso, la cadena se rompe en cada vuelta: si el intervalo llegaba
   * tarde, la transición ya había terminado y la barra se quedaba quieta hasta
   * el salto siguiente; si llegaba temprano, la transición se cortaba a la
   * mitad y la siguiente recorría menos distancia en el mismo tiempo. Eso es
   * lo que se veía como «la barra se frena».
   *
   * Ahora el ancho se calcula con el tiempo real en cada cuadro: no hay nada
   * que perseguir al tiempo, el ancho ES el tiempo. El motor vive en
   * `lib/latido.js`, con sus pruebas.
   */
  if (latido) { latido.parar(); latido = null; }
  clearInterval(timerReloj);
  if (app.estado?.round?.state === 'open' && !app.estado.paused) {
    const r = app.estado.round;
    const base = {
      openedAt: r.openedAt, pausedAt: r.pausedAt,
      pausedTotal: r.pausedTotal, durationMs: r.deadlineMs
    };
    latido = crearLatido({
      leer: () => E.restanteMs(base),
      total: r.deadlineMs,
      pintar: (pct, ms) => {
        // Los segundos se escriben solo cuando cambian: son texto, y
        // reescribir el mismo número cada cuadro hace trabajar al navegador
        // para nada. La barra, en cambio, se mueve en cada cuadro.
        const texto = segundos(ms);
        for (const sel of ['#reloj', '#reloj-jug', '#reloj-tv']) {
          const el = document.querySelector(sel);
          if (!el) continue;
          const nuevo = texto + (sel === '#reloj' ? 's' : '');
          if (el.textContent !== nuevo) el.textContent = nuevo;
        }
        const barra = document.querySelector('#barra > i');
        if (barra) barra.style.width = `${pct}%`;
      },
      // Al llegar a cero, el presentador cierra la ronda solo.
      // Los jugadores ya no pueden responder (el motor rechaza por tiempo);
      // esta llamada solo mueve la máquina de estados para que el botón
      // pase a «Revelar respuesta».
      alCero: () => {
        latido = null;
        if (app.host && app.estado?.round?.state === 'open') {
          app.host.cerrar();
        }
      }
    });
    latido.arrancar();
  }
}

/* ------------------------------------------------------------------ */
/* Cerrar la sala y salir                                              */
/* ------------------------------------------------------------------ */

/**
 * Cierra la partida en el servidor y deja la app en el menú.
 *
 * Vive en un solo sitio porque «Menú», «Jugar de nuevo» y el cierre
 * confirmado necesitan exactamente lo mismo, y tenerlo repetido fue justo
 * lo que dejó a «Jugar de nuevo» sin cerrar la sala.
 *
 * Tres reglas que esta función garantiza:
 *
 *   1. NO SE SIMULA EL ÉXITO. Si el servidor responde con error, o no
 *      contesta en 4 s, se devuelve el fallo y NO se limpia nada. Cerrar la
 *      pantalla sin cerrar la sala deja a los participantes y al televisor
 *      mirando una tabla que ya nadie va a actualizar; peor: se pierde el
 *      token del presentador y ya no hay forma de reintentar.
 *
 *   2. UN SOLO CIERRE A LA VEZ. Con `await` en medio, un segundo toque
 *      entraba mientras el primero esperaba y terminaba destruyendo la
 *      sesión recién creada.
 *
 *   3. SE SUELTA TODO. Presentador, jugador y televisor: el cliente, `yo`,
 *      la respuesta guardada y la sesión de localStorage. Dejar `yo` vivo
 *      con el estado en null atrapaba al participante en «Conectando…».
 */
async function cerrarYSalir({ aMenu = true } = {}) {
  if (cerrando) return { error: null, repetido: true };
  cerrando = true;

  let fallo = null;
  if (app.host) {
    // El tope se resuelve con una MARCA, no con una promesa que resuelve:
    // `Promise.race` con una promesa que resuelve daba éxito falso al
    // vencer el plazo y se limpiaba la sesión sin haber cerrado nada.
    const tope = new Promise(res => setTimeout(() => res({ error: 'sin_respuesta' }), 4000));
    try {
      const r = await Promise.race([app.host.cerrarSala?.(), tope]);
      fallo = r?.error ?? null;
    } catch (e) {
      fallo = e?.message ?? 'No se pudo cerrar la sala.';
    }
  }

  cerrando = false;
  if (fallo) return { error: fallo };

  // Sala cerrada (o no había sala que cerrar): se suelta todo.
  try { localStorage.removeItem(CLAVE_HOST); } catch { /* modo privado */ }

  app.cliente?.cerrar?.();
  app.cliente = null;
  app.yo = null;
  app.miRespuesta = null;
  try { guardarSesion(); } catch { /* modo privado */ }

  app.host?.destruir?.();
  app.host = null;
  app.estado = null;
  app.podioPaso = 0;
  app.tablaCompleta = false;
  app.juicio = null;
  app.felicitaActual = null;
  app.rechazoPulso = null;

  if (aMenu) ir('menu');
  return { error: null };
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
    /* --- marca del menú: el texto --- */
    case 'editar-lema': {
      // DOS toques: el primero señala, el segundo abre el campo.
      // El primer toque no abre nada a propósito. En un teléfono, caer en un
      // campo de escritura sin querer abre el teclado y tapa media pantalla:
      // pedir un segundo toque es lo que hace que el gesto sea deliberado.
      if (!app.lemaSenalado) {
        app.lemaSenalado = true;
        render();
        break;
      }
      app.lemaSenalado = false;
      app.editandoLema = lemaMostrado();
      render();
      // El cursor al final: quien toca dos veces suele querer agregar o
      // corregir, no reemplazar todo.
      const campo = document.querySelector('#in-lema');
      if (campo) {
        campo.focus();
        try { campo.setSelectionRange(campo.value.length, campo.value.length); } catch { /* sin selección */ }
      }
      break;
    }

    case 'cancelar-lema': {
      // Cancelar descarta: no se guarda nada y el texto vuelve a como estaba.
      app.editandoLema = null;
      app.lemaSenalado = false;
      app.marcaPendiente = null;
      render();
      break;
    }

    /* --- marca del menú: la imagen --- */
    case 'cambiar-portada': {
      // Primero la clave, SIEMPRE. Recién con la clave acertada se abre el
      // explorador de archivos: pedir la foto antes de autorizar dejaría a
      // cualquiera eligiendo archivos para nada.
      if (app.adminClave) {
        abrirSelectorDeImagen();
        break;
      }
      app.marcaPendiente = { tipo: 'portada', valor: null };
      app.modal = { tipo: 'clave', para: 'portada' };
      app.adminError = null;
      render();
      break;
    }

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
          // El juego viaja al servidor al crear la sala: `rooms.game_slug`
          // decide qué preguntas se pueden planificar y qué pantallas se
          // dibujan después. Sin esto, la sala nacía siempre como selección
          // simple y la tarjeta del juego nuevo no servía de nada.
          gameSlug: app.juegoElegido,
          onEstado: est => { app.estado = est; render(); }
        });
        const r = await host.crear(app.cantidadPreguntas, app.segundosRonda);
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

        // NO se abre la primera pregunta sola. La sala nace en 'lobby' y la
        // espera es parte del juego: la gente entra, el presentador ve quién
        // llegó, y recién entonces pulsa. Abrirla sola se saltaba el lobby
        // entero y nadie alcanzaba a entrar.
        render();
        break;
      }

      app.host = crearHostLocal({
        preguntas: BANCO,
        onEstado: est => { app.estado = est; render(); }
      });
      app.host.preparar(app.cantidadPreguntas, app.segundosRonda);
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

    /* --- completar el versículo ---------------------------------------- */

    /*
     * Elegir juego en el menú. Guarda la elección y abre el panel del
     * presentador. Cada juego tiene su propio tema, así que al cambiar de
     * juego se limpia el tema elegido: si no, el panel ofrecería un tema de
     * selección simple para una sala de versículos y la sala nacería vacía.
     */
    case 'elegir-juego': {
      // Elegir juego NO entra al panel: el menú es el selector, y desde ahí
      // se decide a dónde ir. Solo se guarda la elección y se redibuja.
      const juego = el.dataset.juego;
      if (juego === app.juegoElegido) break;
      app.juegoElegido = juego;
      guardarJuego(juego);
      // Cada juego tiene sus propios temas, aunque se llamen igual: el de
      // «2 Corintios» de selección simple no sirve para completar el
      // versículo. Al cambiar de juego se limpia lo cargado.
      app.temaElegido = null;
      app.temas = [];
      app.temasCargados = false;
      render();
      break;
    }

    /*
     * Pulsar el botón negro. No es una respuesta: es tomar el turno.
     *
     * Se apaga al instante y se corrige cuando el servidor responde. Con el
     * sondeo de 1 400 ms, esperar la confirmación hacía que el jugador
     * pulsara dos o tres veces sin saber si el primer toque había contado.
     */
    case 'pulsar': {
      const ronda = app.estado?.round;
      if (!ronda || app.enviandoPulso) break;
      app.enviandoPulso = true;
      app.rechazoPulso = null;
      render();
      try {
        const r = await app.cliente?.pulsar?.(ronda.id);
        if (r?.error) {
          // Un fallo de red no puede dejar el botón muerto: se libera y se
          // dice qué pasó, para que la persona pueda volver a intentar.
          app.rechazoPulso = traducirError(r.error);
        }
      } catch (e) {
        app.rechazoPulso = traducirError(e?.message ?? 'No se pudo enviar.');
      } finally {
        app.enviandoPulso = false;
        render();
      }
      break;
    }

    case 'cerrar-pulsaciones': await accionHost('cerrarPulsaciones'); break;
    case 'deshacer-sentencia': await accionHost('deshacerSentencia'); break;
    case 'cerrar-pregunta': await accionHost('cerrarPregunta'); break;

    /*
     * ❌ Incorrecto: se sentencia sin destapar nada y el turno pasa al
     * siguiente. Un toque, sin confirmar: en vivo hay prisa.
     */
    case 'sentenciar-mal': {
      const turno = app.estado?.turnoAnswerId;
      if (!turno) break;
      await accionHost('sentenciar', turno, false, []);
      break;
    }

    /*
     * ✅ Correcto: abre el modal para marcar qué palabras dijo bien.
     * El sistema no puede saberlo solo, porque la respuesta se dice en voz
     * alta y la app no oye.
     */
    case 'sentenciar-bien': {
      const v = versiculoDesdeServidor(app.estado);
      if (!v?.contestando) break;
      app.juicio = { answerId: app.estado?.turnoAnswerId, nombre: v.contestando.nombre };
      app.modal = { tipo: 'juicio' };
      render();
      break;
    }

    case 'cancelar-juicio': {
      app.juicio = null;
      app.modal = null;
      render();
      break;
    }

    /*
     * Confirmar el juicio: se mandan SOLO los huecos marcados. El servidor
     * comprueba que ninguno estuviera ya a la vista, así que un doble toque
     * no puede regalar puntos por una palabra que dijo otro.
     */
    case 'confirmar-juicio': {
      const j = app.juicio;
      if (!j) break;
      const marcados = [...document.querySelectorAll('input[data-hueco]:checked')]
        .map(i => Number(i.value));
      if (!marcados.length) {
        app.aviso = { tipo: 'error', texto: 'Marca al menos una palabra, o usa ❌ Incorrecto.' };
        render();
        break;
      }
      app.juicio = null;
      app.modal = null;
      await accionHost('sentenciar', j.answerId, true, marcados);
      break;
    }

    case 'abrir': await accionHost('abrir'); break;
    case 'iniciar': await accionHost('iniciar'); break;
    case 'revelar': await accionHost('revelar'); break;
    case 'pausar': await accionHost('pausar'); break;
    case 'reanudar': await accionHost('reanudar'); break;
    case 'cerrar': await accionHost('cerrar'); break;
    case 'saltar': await accionHost('saltar'); break;
    /*
     * Cambiar pregunta: otra pregunta del banco, mismo turno.
     * `accionHost` ya espera y traduce el error; si el banco se agotó, el
     * presentador lo ve en pantalla en vez de que el botón no haga nada.
     */
    case 'cambiar-pregunta': await accionHost('cambiarPregunta'); break;
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
      render();
      const r = await cerrarYSalir({ aMenu: true });
      // Si no se cerró, no se simula: el presentador sigue en su sala y
      // recibe el motivo. Cerrar la pantalla sin cerrar la sala es justo lo
      // que dejaba jugadores esperando a alguien que ya se fue.
      if (r.error) ponerAviso('error', traducirError(r.error));
      break;
    }
    case 'olvidar-sala-cerrada': {
      /*
       * El presentador vuelve de una sala que cerró el barrido. La sala ya
       * está cerrada en el servidor, así que aquí solo se suelta la sesión
       * local y se deja el panel listo para crear otra.
       *
       * No se llama a `host_close_room`: la sala ya no está viva y el
       * servidor respondería con un error que el presentador no provocó.
       */
      app.host?.destruir?.();
      app.host = null;
      app.estado = null;
      app.aviso = null;
      try { localStorage.removeItem(CLAVE_HOST); } catch { /* modo privado */ }
      render();
      break;
    }
    case 'jugar-host': {
      /*
       * «Jugar de nuevo» cierra la partida anterior antes de abrir otra.
       *
       * Solo destruía el host de esta pestaña: la sala quedaba en 'ceremony'
       * en el servidor y los participantes y el televisor seguían viendo la
       * tabla de una partida ya terminada, sin forma de salir solos.
       *
       * Va por `cerrarYSalir` para heredar sus dos protecciones: no fingir
       * éxito si el servidor no contesta, y no dejar que un segundo toque
       * destruya la sesión nueva.
       */
      const r = await cerrarYSalir({ aMenu: false });
      if (r.error) {
        ponerAviso('error', traducirError(r.error));
        break;
      }
      app.podioPaso = 0;
      ir('host');
      break;
    }
    case 'nueva-partida': {
      app.podioPaso = 0;
      app.tablaCompleta = false;
      app.host.crearOtraSala();
      app.host.preparar(app.cantidadPreguntas, app.segundosRonda);
      break;
    }
    case 'salir-host': {
      /*
       * Toda salida pasa por aquí: la del presentador (cierra la sala en el
       * servidor) y la del participante o el televisor (suelta su sesión).
       *
       * Antes cada botón hacía su propia versión y «Jugar de nuevo» se quedó
       * sin el paso de cerrar. Ahora hay un solo camino.
       */
      const r = await cerrarYSalir({ aMenu: true });
      if (r.error) ponerAviso('error', traducirError(r.error));
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
            onEstado: est => {
              if (expulsarSiCerradaPorInactividad(est)) return;
              app.estado = est; render();
            }
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

      // El código ya cumplió: se limpia el campo para que el siguiente que
      // vaya a transmitir no herede el de la sala anterior. Se usa cadena
      // vacía y no null: `codigoInicial` cae al código de la URL cuando es
      // null, y eso volvía a rellenar el campo que se acababa de limpiar.
      app.formTV = { codigo: '' };

      // Un solo sondeo vivo: si se transmite otra sala, la anterior se suelta.
      app.tv?.parar();
      // El mando se guarda en una variable LOCAL, no se lee de `app.tv`
      // después del `await`. `app.tv` es estado global y puede cambiar
      // mientras se espera: si la persona sale al menú, `render()` lo pone en
      // null; si transmite otra sala, apunta a otro sondeo. Leerlo después
      // del await daba «Cannot read properties of null» o cerraba el sondeo
      // equivocado y mostraba un error que no existía.
      const tv = mirarSala(sala.roomId, {
        onEstado: est => {
          if (!est) return;
          app.estado = est;
          // La sala cerrada ya tiene su propia pantalla con el aviso; no hace
          // falta repetirlo por encima. `mirarSala` deja de consultar solo.
          render();
        }
      });
      app.tv = tv;

      await tv.primero;

      // Si mientras se esperaba la persona salió del televisor o pidió otra
      // sala, este sondeo ya no es el vigente: se suelta y no se toca nada
      // más. Sin esta comprobación se mostraría un error en una pantalla que
      // ya no está en pantalla.
      if (app.tv !== tv) {
        tv.parar();
        break;
      }

      // La primera consulta es la que dice si la sala se puede ver. Si falló,
      // no hay nada que transmitir: se suelta el mando y se avisa con el
      // motivo real, en vez de dejar un sondeo vivo contra una sala rota.
      const fallo = tv.ultimoError();
      if (fallo) {
        tv.parar();
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
      app.formTV = { codigo: '' };
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
  // El juego elegido se restaura antes que cualquier otra cosa: el menú y el
  // panel del presentador se dibujan según esto, así que tiene que estar
  // puesto antes del primer render.
  const juegoGuardado = leerJuego();
  if (juegoGuardado) app.juegoElegido = juegoGuardado;

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
      onEstado: est => {
        if (expulsarSiCerradaPorInactividad(est)) return;
        app.estado = est; render();
      }
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
        if (!r?.error) {
          /*
           * Solo se olvida la sesión si la sala está CERRADA.
           *
           * Aquí estaba la regresión: también se borraba con 'ceremony', y
           * eso mataba la tabla justo cuando el jugador quería mirarla con
           * calma o enseñársela a alguien. Recargar durante la ceremonia
           * devolvía al formulario de entrada y se perdía el resultado.
           *
           * Ya no hace falta cubrir 'ceremony': desde que «Menú» y «Jugar de
           * nuevo» cierran la sala de verdad, una partida abandonada llega
           * aquí como 'closed', que es lo único que debe limpiar la sesión.
           */
          const fin = app.estado?.status;
          if (fin === 'closed') {
            app.yo = null;
            app.cliente?.cerrar?.();
            app.cliente = null;
            app.estado = null;
            guardarSesion();
            render();
          }
          return;
        }

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
        gameSlug: app.juegoElegido,
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
        /*
         * La partida ya había terminado: no se reabre.
         * Recargar después de volver al menú devolvía al presentador a la
         * tabla de clasificación de la partida anterior, como si siguiera
         * viva. Ahora se olvida la sala y el panel vuelve a pedir crear una.
         */
        /*
         * Solo se olvida si la sala está CERRADA.
         *
         * Con 'ceremony' aquí, recargar el panel durante la ceremonia se
         * llevaba por delante la tabla y la sesión del presentador, que es
         * justo lo que necesita para revelar el podio.
         */
        const fin = app.estado?.status;
        if (fin === 'closed') {
          localStorage.removeItem(CLAVE_HOST);
          host.destruir?.();
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

  /* --- guardar el texto del menú (ya editado, falta la clave) --- */
  if (tipo === 'lema') {
    const lema = String(datos.get('lema') ?? '').trim().slice(0, 120);

    // El orden que se pidió: primero se edita, DESPUÉS se pide la clave.
    // Si ya está verificada en esta sesión, no se vuelve a pedir.
    if (app.adminClave) {
      await guardarLema(lema);
      return;
    }
    app.marcaPendiente = { tipo: 'lema', valor: lema };
    // Lo escrito se conserva también en el campo, no solo en lo pendiente.
    // Sin esto, al redibujar el menú el input volvía al texto original y quien
    // había escrito veía desaparecer su texto al pasar a la clave.
    app.editandoLema = lema;
    app.modal = { tipo: 'clave', para: 'lema', muestra: lema };
    app.adminError = null;
    render();
    return;
  }

  /* --- introducir la clave maestra --- */
  if (tipo === 'clave') {
    const para = form.dataset.clavePara || 'entrar';
    const clave = String(datos.get('clave') ?? '').trim();
    const { error } = await admin.comprobarClave(clave);
    if (error) {
      /*
       * Clave incorrecta. Lo importante: NO se aplica el cambio y NO se
       * pierde lo editado.
       *
       * Acá vivía el defecto del que no se podía salir. Se cerraba el modal
       * con `app.modal = null`, así que lo que se estaba cambiando se
       * perdía, y —peor— el bloqueo por intentos fallidos se anunciaba con
       * un mensaje traducido que nunca llegaba a verse, porque el modal se
       * cerraba antes.
       */
      app.adminError = traducirError(error);
      app.modal = {
        tipo: 'clave',
        para,
        error: app.adminError,
        // El candado se dice aquí y se ve: 10 minutos de espera no se
        // descubren probando.
        pista: /bloqueada/.test(String(error)) ? 'bloqueada' : null,
        muestra: app.marcaPendiente && app.marcaPendiente.tipo === 'lema'
          ? app.marcaPendiente.valor : null
      };
      render();
      return;
    }

    app.adminClave = clave;
    app.adminError = null;

    // La clave era correcta: ahora sí se aplica lo que estaba esperando.
    if (para === 'lema') {
      const pendiente = app.marcaPendiente && app.marcaPendiente.tipo === 'lema'
        ? app.marcaPendiente.valor : '';
      await guardarLema(pendiente);
      return;
    }
    if (para === 'portada') {
      // Recién ahora se abre el explorador: la clave ya está verificada.
      app.modal = null;
      render();
      abrirSelectorDeImagen();
      return;
    }

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

    const r = await admin.crearTema(app.adminClave, nombre, app.juegoElegido);
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
  if (ev.target.id === 'seg') {
    // Se acota aquí también: el servidor rechaza fuera de 5–30, y no tiene
    // sentido dejar elegir en pantalla algo que la base va a negar.
    app.segundosRonda = Math.min(30, Math.max(5, Number(ev.target.value) || 15));
    render();
  }
});
