/* Prueba de las pantallas de completar el versículo: puro texto, sin navegador.

   Cada caso está pensado para FALLAR si el defecto estuviera presente. La
   más importante es la de fuga: si la respuesta aparece en pantalla antes
   de revelarse, el juego se pierde entero. */
import { readFileSync } from 'node:fs';
import {
  felicitacion, todasLasFelicitaciones, versiculoDesdeServidor,
  versiculoHTML, versiculoHostHTML, avisoParticipante, miTurnoTexto, estadoBoton,
  pantallaParticipante, pantallaTV, listaTurnosHTML, modalJuicioHTML,
  sinReferenciaAlFinal, relojHTML
} from './versiculo.js';

let ok = 0, fail = 0;
const t = (c, m) => { if (c) { ok++; console.log('  ok   ' + m); } else { fail++; console.log('  FALLA ' + m); } };

/** Un estado de servidor con lo mínimo, para no repetirlo en cada caso. */
function estadoDe({ state = 'open', versiculo = {}, code = '4K7M2' } = {}) {
  return {
    roomId: 'r1', code, gameSlug: 'completar-versiculo', status: 'question',
    paused: false, roundSeconds: 15,
    players: [
      { id: 'p1', name: 'Ana Pérez', score: 10, totalMs: 9400, correct: 1 },
      { id: 'p2', name: 'Beto Ruiz', score: 0, totalMs: 0, correct: 0 }
    ],
    round: {
      id: 'round1', ordinal: 2, state,
      prompt: 'Vosotros sois nuestra ____ , escrita en nuestros ____',
      reference: '2 Corintios 3:2',
      options: [], optionKeys: [], correctIdx: null,
      openedAt: Date.now() - 5000, deadline: Date.now() + 10000,
      answers: [], answered: 0, noWinner: false,
      versiculo: {
        huecos_totales: 2,
        revelados: [],
        completo: false,
        respuesta: null,
        contestando: null,
        pulsos: [],
        ...versiculo
      }
    }
  };
}

/* ------------------------------------------------------------------ */
console.log('=== 1. Las seis felicitaciones ===');
const todas = todasLasFelicitaciones();
t(todas.length === 6, 'hay seis variantes');
t(new Set(todas).size === 6, 'ninguna se repite');

// El defecto que se evita: salir dos veces seguidas la misma.
let repes = 0;
for (let i = 0; i < 200; i++) {
  const a = felicitacion(Math.random());
  const b = felicitacion(Math.random(), a);
  if (a === b) repes++;
}
t(repes === 0, 'nunca salen dos iguales seguidas (200 intentos)');

t(felicitacion(0, null) === todas[0], 'azar 0 da la primera');
t(felicitacion(0.999, null) === todas[5], 'azar casi 1 da la última');
t(felicitacion(0, todas[0]) === todas[1], 'evitar la primera salta a la siguiente');
t(todas.includes(felicitacion(0.5, todas[0])), 'con evitar, sigue saliendo una de la lista');

/* ------------------------------------------------------------------ */
console.log('\n=== 2. Lo que llega del servidor ===');
const sinJuego = versiculoDesdeServidor({ round: { id: 'x' } });
t(sinJuego === null, 'sin bloque versiculo devuelve null (no rompe el otro juego)');

const v = versiculoDesdeServidor(estadoDe({ versiculo: { revelados: [0], huecos_totales: 2 } }));
t(v.huecosTotales === 2, 'lee los huecos totales');
t(v.revelados.length === 1 && v.revelados[0] === 0, 'lee los revelados');
t(v.respuesta === null, 'respuesta null se queda null');

// LA REGLA: si el servidor no la manda, aquí no se inventa.
const conFuga = versiculoDesdeServidor(estadoDe({
  versiculo: { respuesta: null, revelados: [] }
}));
t(conFuga.respuesta === null, 'LA REGLA: sin respuesta del servidor, no hay respuesta en pantalla');

/* El defecto que dejaba «0 de 0»: cloud.js no copiaba el bloque del
   servidor a la ronda, asi que la pantalla recibia undefined y contaba 0. */
const conBloque = versiculoDesdeServidor({
  round: { versiculo: { huecos_totales: 3, revelados: [0], completo: false, pulsos: [] } }
});
t(conBloque.huecosTotales === 3, 'el bloque del servidor llega con sus huecos totales');
t(conBloque.revelados.length === 1, 'y con lo ya revelado');

const revelado = versiculoDesdeServidor(estadoDe({
  state: 'revealed',
  versiculo: { respuesta: 'Vosotros sois nuestra carta, escrita en nuestros corazones', completo: true }
}));
t(revelado.respuesta.includes('carta'), 'al revelarse, la respuesta sí llega');

/* ------------------------------------------------------------------ */
console.log('\n=== 3. El texto del versículo ===');
const h = versiculoHTML('Vosotros sois nuestra ____ , escrita en nuestros ____');
t((h.match(/class="hueco"/g) || []).length === 2, 'los dos huecos se vuelven elementos');

// Un versículo sin huecos tapados no debe producir ningún hueco falso.
const lleno = versiculoHTML('Vosotros sois nuestra carta, escrita en nuestros corazones');
t(!lleno.includes('class="hueco"'), 'un texto completo no inventa huecos');

/* ------------------------------------------------------------------ */
console.log('\n=== El hueco se dibuja tan largo como la palabra ===');
/* El servidor YA dibuja un guion por letra (migración
   20261119000002_juicio_parcial.sql, función versiculo_render: «un guion por
   letra, con un mínimo de 3 para que el hueco se vea»). Pero el hueco llegaba
   a la pantalla siempre igual de ancho, porque el CSS le agregaba cuatro
   guiones ENCIMA con `.hueco::before { content: "____" }`: los que mandaba el
   servidor se ocultaban y todos los huecos se veían idénticos. Saber que
   faltan 8 letras no revela la palabra; decirla sí. */
const largoDe = (texto) => {
  // el ancho del hueco tiene que venir del texto del servidor, no del CSS
  const m = /<span class="hueco"[^>]*>([^<]*)<\/span>/.exec(texto);
  return m ? m[1] : null;
};

const tres = versiculoHTML('En honra y ____ , como ____');
const guiones = (tres.match(/_/g) || []).length;
t(guiones === 8, `los guiones del servidor se conservan (${guiones}: 4 + 4)`);
t((tres.match(/class="hueco"/g) || []).length === 2, 'y sigue habiendo un elemento por hueco');

// Cada hueco conserva SU largo, no uno común.
const desiguales = versiculoHTML('Uno ___ dos _____');
const largos = [...desiguales.matchAll(/<span class="hueco"[^>]*>([^<]*)<\/span>/g)].map(m => m[1].length);
t(largos[0] === 3 && largos[1] === 5, `cada hueco mantiene su propio largo (${largos.join(' y ')})`);

// Y el CSS no puede volver a taparlos con guiones propios.
// Se lee aquí y no con la constante `css` de más abajo: ese `const` se declara
// después y usarlo antes lanzaría ReferenceError (pasó).
const cssAhora = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');
const cssHueco = (() => {
  const i = cssAhora.indexOf('.hueco::before');
  if (i < 0) return '';
  return cssAhora.slice(i, cssAhora.indexOf('}', i));
})();
t(!/content\s*:\s*["']_+["']/.test(cssHueco),
  'el CSS no agrega guiones propios: los pone el servidor');

// El defecto clásico: escapar antes de marcar, y el marcado sale como texto.
const conEtiquetas = versiculoHTML('Dijo <b>esto</b> y ____');
t(conEtiquetas.includes('&lt;b&gt;'), 'escapa el HTML del texto');
t(conEtiquetas.includes('class="hueco"'), 'y aun así marca el hueco');

/* ------------------------------------------------------------------ */
console.log('\n=== 3b. El versiculo del presentador ===');
/* El presentador ve el versiculo COMPLETO y las palabras ocultas van
   subrayadas: eso le dice cuales no ven los demas. Ya no hay bloque
   «Ver la respuesta» que las repita. */
const hh = versiculoHostHTML('En honra y en ____ , como ____ , pero veraces', [
  { indice: 0, respuesta: 'deshonra', revelado: false },
  { indice: 1, respuesta: 'impostores', revelado: false }
]);
t(hh.includes('deshonra') && hh.includes('impostores'), 'muestra las palabras ocultas');
t((hh.match(/hueco-host/g) || []).length === 2, 'las dos subrayadas');
t(!hh.includes('____'), 'sin guiones sueltos en medio');

const yaVista = versiculoHostHTML('Uno ____ dos', [
  { indice: 0, respuesta: 'carta', revelado: true }
]);
t(!yaVista.includes('hueco-host'), 'una palabra ya revelada no va subrayada');
t(!yaVista.includes('carta'), 'y no se repite: va escrita en el propio texto');

const sinHuecos = versiculoHostHTML('Uno ____ dos', []);
t(sinHuecos.includes('class="hueco"'), 'sin datos deja el hueco normal en vez de romper');

const conHtml = versiculoHostHTML('Dijo <b>x</b> y ____', [
  { indice: 0, respuesta: 'fin', revelado: false }
]);
t(conHtml.includes('&lt;b&gt;'), 'escapa el HTML del versiculo');
t(conHtml.includes('hueco-host'), 'y aun asi subraya la palabra oculta');

/* ------------------------------------------------------------------ */
console.log('\n=== 4. Avisos del participante ===');
t(avisoParticipante({ estado: 'lobby' }).tipo === 'neutro', 'en la sala de espera avisa de que espera');

const miTurno = avisoParticipante({
  estado: 'juicio', yoContesto: true,
  contestando: { nombre: 'Ana Pérez', orden: 1 }
});
t(miTurno.tipo === 'turno' && miTurno.texto.includes('Estás contestando'), 'si me toca, dice que estoy contestando');

const otroTurno = avisoParticipante({
  estado: 'juicio', contestando: { nombre: 'Beto Ruiz', orden: 2 }, miPulso: { orden: 3 }
});
t(otroTurno.texto.includes('Beto Ruiz'), 'si contesta otro, lo nombra');
t(!otroTurno.texto.includes('Estás'), 'y no me confunde a mí con él');

const nadie = avisoParticipante({ estado: 'juicio' });
t(nadie.texto.includes('Nadie pulsó'), 'sin pulsos lo dice');

const gano = avisoParticipante({
  estado: 'revealed', ultimoJuicio: { nombre: 'Ana Pérez', veredicto: 'correcto' },
  quedanHuecos: 0
});
t(gano.tipo === 'exito' && gano.texto.includes('acertó'), 'al acertar lo anuncia');

const cerradoIncompleto = avisoParticipante({ estado: 'revealed', quedanHuecos: 0 });
t(cerradoIncompleto.texto.includes('quedó completo'), 'versículo completo sin un solo ganador');

/* ------------------------------------------------------------------ */
console.log('\n=== 5. Mi número en la cola ===');
t(miTurnoTexto(null) === null, 'si no pulsé, no hay número');
t(miTurnoTexto({ orden: 3 }) === 'Fuiste el 3 en pulsar', 'el número sale tal cual');

/* ------------------------------------------------------------------ */
console.log('\n=== 6. El botón negro ===');
const abierto = estadoBoton({ estado: 'open' });
t(abierto.activo && abierto.texto === 'Presionar', 'en ventana abierta se puede pulsar');

const enviando = estadoBoton({ estado: 'open', enviando: true });
t(!enviando.activo && enviando.texto.includes('…'), 'al enviar se apaga al instante');

const yaPulso = estadoBoton({ estado: 'open', miPulso: { orden: 1 } });
t(!yaPulso.activo && yaPulso.texto === 'Pulsaste', 'si ya pulsó, no puede repetir');

const noLlego = estadoBoton({ estado: 'juicio' });
t(!noLlego.activo && noLlego.nota === 'No pulsaste esta ronda', 'quien no llegó ve por qué');

const falloRed = estadoBoton({ estado: 'open', rechazo: 'Sin conexión' });
t(!falloRed.activo && falloRed.nota === 'Sin conexión', 'un fallo de red se explica');

/* ------------------------------------------------------------------ */
console.log('\n=== 6b. Reintento en segundo plano ===');
/* Un toque por ronda: al pulsar, el botón se apaga y NO vuelve a aceptar
   aunque el envío esté reintentando. Si se liberara, el participante tocaría
   otra vez y se arriesgaría a dos pulsaciones por un solo turno. */
const reintentando = estadoBoton({ estado: 'open', enviando: false, reintentando: true });
t(!reintentando.activo, 'mientras reintenta, el botón no acepta toques');
t(reintentando.texto === 'Pulsaste…', 'y sigue diciendo que ya pulsó, no que falle');

const reintentandoYMiPulso = estadoBoton({ estado: 'open', miPulso: { orden: 1 }, reintentando: true });
t(!reintentandoYMiPulso.activo, 'con pulso ya confirmado tampoco');

// El indicador se pinta en el pie, con su texto exacto.
const pantallaReintento = pantallaParticipante(
  { code: 'ABCDE', gameSlug: 'completar-versiculo', status: 'question',
    players: [{ id: 'p1', name: 'Ana', score: 0 }],
    round: { id: 'r1', state: 'open', prompt: 'Uno ____ dos', reference: '2 Co 1:1',
             versiculo: { huecos_totales: 1, revelados: [], pulsos: [], respuesta: null, contestando: null } } },
  { miId: 'p1', reintentando: true }
);
t(pantallaReintento.includes('Reconectando…'), 'la pantalla dice «Reconectando…»');
t(pantallaReintento.includes('class="reconectando"'), 'con su clase para el estilo');
t(pantallaReintento.includes('girando'), 'y el indicador que gira');
t(pantallaReintento.includes('aria-live'), 'se anuncia a quien usa lector de pantalla');
t(pantallaReintento.includes('boton-ok bloqueado'), 'el botón queda bloqueado');

// Sin reintento, el indicador NO aparece: no debe quedar pegado.
const pantallaNormal = pantallaParticipante(
  { code: 'ABCDE', gameSlug: 'completar-versiculo', status: 'question',
    players: [{ id: 'p1', name: 'Ana', score: 0 }],
    round: { id: 'r1', state: 'open', prompt: 'Uno ____ dos', reference: '2 Co 1:1',
             versiculo: { huecos_totales: 1, revelados: [], pulsos: [], respuesta: null, contestando: null } } },
  { miId: 'p1' }
);
t(!pantallaNormal.includes('Reconectando'), 'sin reintento no se dibuja el indicador');

// El mensaje final, exacto, cuando la red no dejó entrar la pulsación.
const MENSAJE_RED = 'Por problemas de red no pudiste participar en esta ronda.';
t(MENSAJE_RED.length > 20, 'el mensaje final de red está definido');
const appFuente = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
t(appFuente.includes(MENSAJE_RED), 'y app.js lo usa tal cual al rendirse');

/* ------------------------------------------------------------------ */
console.log('\n=== 7. Pantalla del participante ===');
const enEspera = pantallaParticipante(estadoDe({ state: 'prepared', versiculo: {} }), { miId: 'p1' });
t(enEspera.includes('Ana Pérez'), 'lleva el nombre propio');
t(enEspera.includes('10 pts'), 'lleva el puntaje propio');

const abierta = pantallaParticipante(estadoDe(), { miId: 'p1' });
t(abierta.includes('boton-ok'), 'muestra el botón negro');
t(abierta.includes('data-accion="pulsar"'), 'el botón es accionable');
t(abierta.includes('class="hueco"'), 'los huecos se ven como huecos');
t(!abierta.includes('carta'), 'LA REGLA: la respuesta no está en el HTML');

const bloqueada = pantallaParticipante(estadoDe(), { miId: 'p1', miPulso: { orden: 1 } });
t(bloqueada.includes('bloqueado') && bloqueada.includes('Pulsaste'), 'tras pulsar queda bloqueado');
t(!bloqueada.includes('data-accion="pulsar"'), 'y no se puede volver a pulsar');

const miTurnoPantalla = pantallaParticipante(estadoDe({
  state: 'juicio',
  versiculo: { contestando: { nombre: 'Ana Pérez', orden: 1 } }
}), { miId: 'p1', miPulso: { orden: 1 } });
t(miTurnoPantalla.includes('Estás contestando'), 've que le toca a él');

const gane = pantallaParticipante(estadoDe({
  state: 'revealed',
  versiculo: {
    completo: true, revelados: [0, 1],
    respuesta: 'Vosotros sois nuestra carta, escrita en nuestros corazones'
  }
}), { miId: 'p1', miPulso: { orden: 1, veredicto: 'correcto' }, felicitacionActual: '¡La diste!' });
t(gane.includes('¡La diste!'), 'al ganar usa la variante que se le pasa');
t(gane.includes('✅'), 'y la marca de acierto');

// Un nombre con HTML no puede ejecutar nada.
const peligroso = pantallaParticipante(estadoDe({
  state: 'juicio', versiculo: { contestando: { nombre: '<img src=x onerror=1>', orden: 1 } }
}), { miId: 'p1', miPulso: { orden: 2 } });
t(!peligroso.includes('onerror=1>'), 'escapa el nombre ajeno (sin XSS)');

/* ------------------------------------------------------------------ */
console.log('\n=== 8. Pantalla del televisor ===');
const tvEspera = pantallaTV({
  code: '4K7M2', players: [{ id: 'p1' }, { id: 'p2' }], round: null
});
t(tvEspera.includes('4K7M2'), 'en la espera muestra el código');
t(tvEspera.includes('2 en la sala'), 'y cuántos hay');

const tvAbierta = pantallaTV(estadoDe());
t(tvAbierta.includes('Pulsando'), 'en ventana abierta lo dice');
t(!tvAbierta.includes('pts'), 'LA REGLA: la tele no muestra marcador');
t(!tvAbierta.includes('carta'), 'LA REGLA: la tele no destapa la respuesta');

const tvJuicio = pantallaTV(estadoDe({
  state: 'juicio',
  versiculo: { contestando: { nombre: 'Beto Ruiz', orden: 2 } }
}));
t(tvJuicio.includes('Contestando: Beto Ruiz'), 'muestra quién contesta');
t(tvJuicio.includes('fue el 2 en pulsar'), 'y su número de turno');

const tvFalló = pantallaTV(estadoDe({
  state: 'juicio',
  versiculo: {
    contestando: { nombre: 'Ana Pérez', orden: 2 },
    pulsos: [{ orden: 1, nombre: 'Beto Ruiz', veredicto: 'incorrecto' }]
  }
}));
t(tvFalló.includes('no acertó'), 'anuncia que el anterior falló');

// El defecto: la tele filtrada, que enseñaría el versículo resuelto.
const tvConRespuesta = pantallaTV(estadoDe({
  versiculo: { respuesta: 'Vosotros sois nuestra carta, escrita en nuestros corazones' }
}));
t(!tvConRespuesta.includes('nuestra carta'), 'LA REGLA: ni con respuesta en el estado la pinta en ventana abierta');

const tvCompleto = pantallaTV(estadoDe({
  state: 'revealed',
  versiculo: {
    completo: true, revelados: [0, 1],
    pulsos: [
      { orden: 1, nombre: 'Beto Ruiz', veredicto: 'parcial' },
      { orden: 2, nombre: 'Ana Pérez', veredicto: 'correcto' }
    ]
  }
}));
t(tvCompleto.includes('quedó completo'), 'anuncia el versículo completo');
t(tvCompleto.includes('Beto Ruiz') && tvCompleto.includes('Ana Pérez'), 'nombra a quienes aportaron');

/* ------------------------------------------------------------------ */
console.log('\n=== 9. Lista de turnos del presentador ===');
const lista = listaTurnosHTML({
  huecosTotales: 2,
  contestando: { nombre: 'Beto Ruiz', orden: 1 },
  pulsos: [
    { orden: 1, nombre: 'Beto Ruiz', veredicto: null },
    { orden: 2, nombre: 'Ana Pérez', veredicto: null }
  ]
});
t(lista.includes('turno'), 'resalta a quién le toca');
t((lista.match(/class="fila-turno/g) || []).length === 2, 'una fila por pulso');
/* La fila NO puede llamarse `pulso`: esa clase ya es una utilidad de
   animacion (styles.css:477) y cada fila parpadeaba en bucle. */
t(!lista.includes('class="pulso'), 'la fila no toma prestada la utilidad .pulso');
t(lista.indexOf('Beto') < lista.indexOf('Ana'), 'respeta el orden de llegada');

t(listaTurnosHTML({ pulsos: [] }).includes('nadie'), 'sin pulsos lo dice claramente');

/* ------------------------------------------------------------------ */
console.log('\n=== 10. El modal de juicio ===');
const huecos = [
  { indice: 0, respuesta: 'carta', revelado: true },
  { indice: 1, respuesta: 'corazones', revelado: false }
];
const modal = modalJuicioHTML({ huecosTotales: 2 }, huecos, 'Beto Ruiz');
t(modal.includes('Beto Ruiz'), 'nombra a quién se juzga');
t(modal.includes('corazones'), 'ofrece el hueco que queda');
t(!modal.includes('carta'), 'no ofrece un hueco que ya ganó otro');
t((modal.match(/data-hueco=/g) || []).length === 1, 'una casilla por hueco disponible');

const todoRevelado = modalJuicioHTML({ huecosTotales: 2 }, huecos.map(h => ({ ...h, revelado: true })), 'Ana');
t(todoRevelado.includes('No quedan huecos'), 'sin huecos libres lo dice en vez de mostrar un modal vacío');

/* ------------------------------------------------------------------ */
console.log('\n=== La referencia no se lee dos veces ===');
// El texto viene sembrado TAL CUAL del documento y casi todos los versículos
// terminan con su cita entre paréntesis. La cabecera del panel ya la muestra,
// así que sin limpiarla el presentador ve «(2 Corintios 2:15)» dos veces.
t(sinReferenciaAlFinal('Hola mundo. (2 Corintios 2:15)', '2 Corintios 2:15') === 'Hola mundo',
  'la cita entre paréntesis del final se quita');
t(sinReferenciaAlFinal('Hola mundo (2 Corintios 2:15).', '2 Corintios 2:15') === 'Hola mundo',
  'también con el punto por fuera');
t(sinReferenciaAlFinal('Hola mundo [2 Corintios 2:15]', '2 Corintios 2:15') === 'Hola mundo',
  'y con corchetes');
t(sinReferenciaAlFinal('Hola mundo.', '2 Corintios 2:15') === 'Hola mundo.',
  'si no trae la cita, no se toca nada');
t(sinReferenciaAlFinal('Hola (otra cosa)', '2 Corintios 2:15') === 'Hola (otra cosa)',
  'un paréntesis que NO es la referencia se queda: es parte del versículo');
// La cita solo se quita si COINCIDE. Si no, se comería texto del versículo.
t(sinReferenciaAlFinal('Hola (2 Corintios 2:16)', '2 Corintios 2:15') === 'Hola (2 Corintios 2:16)',
  'una cita DISTINTA a la de la ronda no se toca');
t(sinReferenciaAlFinal('', '2 Corintios 2:15') === '', 'texto vacío devuelve vacío');
t(sinReferenciaAlFinal('Hola (2 Corintios 2:15)', '') === 'Hola (2 Corintios 2:15)',
  'sin referencia no se adivina qué quitar');

console.log('\n=== El reloj se ve en las TRES pantallas ===');
// Se pidió tres veces: presentador, participante y televisor. Es fácil que
// una se quede atrás al tocar solo dos.
const reloj = relojHTML(9000, 15000, 'reloj-x');
t(reloj.includes('barra-tiempo'), 'el reloj trae la barra');
t(reloj.includes('reloj-x'), 'y el hueco del número, con su id');
t(reloj.includes('9 s'), 'y el número de segundos, no solo la barra');
t(relojHTML(0, 15000, 'r').includes('0 s'), 'a cero muestra 0 s');
t(relojHTML(9000, 0, 'r') === '', 'sin duración no inventa un reloj');

const estR = { code:'A', players:[{id:'p1',name:'Ana'}],
  round:{ id:'r', state:'open', prompt:'Uno ___ dos', reference:'2 Co 1:1', options:[],
    versiculo:{ huecos_totales:1, revelados:[], pulsos:[], respuesta:null, contestando:null } } };
const tv = pantallaTV(estR, { qr:'', restanteMs:9000, totalMs:15000 });
const ju = pantallaParticipante(estR, { miId:'p1', restanteMs:9000, totalMs:15000 });
t(tv.includes('id="reloj-tv"'), 'el televisor tiene su número de segundos');
t(ju.includes('id="reloj-jug"'), 'el participante tiene el suyo');

/* ------------------------------------------------------------------ */
console.log('\n=== Las confirmaciones se pintan UNA vez, para todas las vistas ===');
// Defecto real: «← Menú» y «Terminar juego» existen en varias pantallas, y
// los dos solo hacen `app.confirmar = '...'` + redibujar. Pintar la
// confirmación DENTRO de una vista concreta las dejaba muertas en las demás:
// el botón cambiaba el estado y no aparecía nada.
//
// La amenaza contraria también cuenta: si se pintaran solo dentro de una
// vista, arreglar la de hoy rompe la de mañana. Por eso van en `render()`,
// que es el único sitio por donde pasan todas.
const soloCodigo = (x) => x
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const appSrc = soloCodigo(readFileSync(new URL('../app.js', import.meta.url), 'utf8'));

const cuerpoRender = (() => {
  const ini = appSrc.indexOf('function render(');
  if (ini < 0) return '';
  const resto = appSrc.slice(ini + 10);
  const fin = resto.search(/\nfunction [a-zA-Z]/);
  return fin < 0 ? resto : resto.slice(0, fin);
})();

t(cuerpoRender.length > 500, 'se localiza el cuerpo de render');
t(/app\.confirmar === 'terminar'[^;]*modalConfirmarCierre/.test(cuerpoRender),
  'render pinta la confirmación de terminar juego');
t(/app\.confirmar === 'sala'[^;]*modalCerrarSala/.test(cuerpoRender),
  'y la de cerrar la sala');

// Y NO se pintan desde una vista concreta: eso era el defecto. Se busca en
// todas las funciones de pantalla, no solo en la que falló.
const vistas = [...appSrc.matchAll(/function (panelVersiculo|vistaHost|vistaJugador|vistaTV)\s*\(/g)];
t(vistas.length >= 4, 'se localizan las cuatro vistas');
for (const v of vistas) {
  const resto = appSrc.slice(v.index + 10);
  const fin = resto.search(/\nfunction [a-zA-Z]/);
  const cuerpo = fin < 0 ? resto : resto.slice(0, fin);
  t(!cuerpo.includes('modalConfirmarCierre()') && !cuerpo.includes('modalCerrarSala()'),
    `${v[1]} NO pinta confirmaciones por su cuenta: van en render()`);
}

/* ------------------------------------------------------------------ */
console.log('\n=== La ceremonia y la sala cerrada, ANTES del juego ===');
// Defecto real: «Terminar juego» hacía su trabajo en el servidor —la sala
// pasaba a 'ceremony'— y el panel seguía dibujando la partida, así que el
// botón se veía muerto. La causa: `vistaHost` desviaba al panel del juego
// antes de mirar el estado final, y ese panel no sabe dibujar la ceremonia.
const cuerpoVistaHost = (() => {
  const ini = appSrc.indexOf('function vistaHost(');
  if (ini < 0) return '';
  const resto = appSrc.slice(ini + 10);
  const fin = resto.search(/\nfunction [a-zA-Z]/);
  return fin < 0 ? resto : resto.slice(0, fin);
})();

t(cuerpoVistaHost.length > 200, 'se localiza el cuerpo de vistaHost');
t(cuerpoVistaHost.includes('vistaCeremonia'),
  'vistaHost sabe dibujar la ceremonia');
t(cuerpoVistaHost.includes('vistaSalaCerrada'),
  'y la sala cerrada');

// El ORDEN es lo que fallaba: el estado final se mira antes del desvío.
const iFin = cuerpoVistaHost.indexOf("status === 'ceremony'");
const iJuego = cuerpoVistaHost.indexOf("completar-versiculo");
t(iFin >= 0 && iJuego > iFin,
  'los estados finales se miran ANTES de desviar por juego');

// Y una sola pantalla de sala cerrada, no dos copias que se separan.
t(appSrc.includes('function vistaSalaCerrada('),
  'la pantalla de sala cerrada vive en una función');
const copias = (appSrc.match(/La sala está cerrada/g) || []).length;
t(copias === 1, 'y está escrita UNA vez, no copiada por vista');

/* El mismo defecto, en las otras dos vistas.
 *
 * En el panel del presentador ya se había corregido y se probó. En el
 * teléfono del participante y en el televisor seguía vivo: terminaba la
 * partida, el presentador veía la tabla, y las otras dos pantallas se
 * quedaban congeladas en el último versículo. La ceremonia y el cierre son
 * estados de la SALA, no del juego, así que tienen que mirarse antes de
 * desviar por `gameSlug`. */
const cuerpoDe = (nombre) => {
  const ini = appSrc.indexOf(`function ${nombre}(`);
  if (ini < 0) return '';
  const resto = appSrc.slice(ini + 10);
  const fin = resto.search(/\nfunction [a-zA-Z]/);
  return fin < 0 ? resto : resto.slice(0, fin);
};

for (const vista of ['vistaJugador', 'vistaTV']) {
  const cuerpo = cuerpoDe(vista);
  t(cuerpo.length > 200, `se localiza el cuerpo de ${vista}`);

  const iFin = cuerpo.indexOf("status === 'ceremony'");
  const iJuego = cuerpo.indexOf("completar-versiculo");
  t(iFin >= 0, `${vista} mira el estado 'ceremony'`);
  t(iJuego >= 0, `${vista} desvía por juego`);
  t(iFin >= 0 && iJuego > iFin,
    `${vista}: el fin de partida se mira ANTES de desviar por juego`);

  t(cuerpo.includes("'closed'"),
    `${vista}: y también mira la sala cerrada antes del juego`);
}

// El televisor no recibe toques: la tabla tiene que salir completa sola.
// `app.podioPaso` arranca en 0 y solo sube con `revelarSiguientePodio`, que
// engancha el toque en pantalla. Si se le pasara tal cual, el salón vería
// un marco vacío para siempre.
const cuerpoTVFin = cuerpoDe('finDePartidaTV');
t(cuerpoTVFin.length > 100, 'existe finDePartidaTV');
t(/totalPasos\s*\(/.test(cuerpoTVFin),
  'la tele pide el ÚLTIMO paso de la tabla, no el actual');
t(!/podioPaso/.test(cuerpoTVFin),
  'y NO usa app.podioPaso, que se queda en 0 porque nadie toca la tele');

/* ------------------------------------------------------------------ */
console.log('\n=== La MATRIZ completa de estados, sin casos sueltos ===');
// Encontrar defectos uno por uno, mirando capturas, deja siempre el próximo
// escondido. Esta prueba recorre TODOS los estados de ronda que el servidor
// produce y comprueba en cada uno las mismas cuatro cosas:
//
//   1. que el aviso del participante exista (null se ve como app colgada);
//   2. que el botón tenga texto;
//   3. que ninguna pantalla deje «undefined» ni «NaN» a la vista;
//   4. que la respuesta no se filtre antes de revelarse.
//
// Los estados salen del CHECK de la base, no de una lista inventada.
const ESTADOS_RONDA = ['prepared', 'open', 'juicio', 'closed', 'revealed', 'annulled'];
const yaRevelado = (r) => r === 'revealed' || r === 'closed';

const universo = (ronda) => ({
  status: 'question', code: 'ABCDE', gameSlug: 'completar-versiculo',
  players: [{ id: 'p1', name: 'Ana', score: 0 }, { id: 'p2', name: 'Beto', score: 0 }],
  round: ronda ? {
    id: 'r1', state: ronda, prompt: 'Uno ____ dos ____ tres', reference: '2 Co 1:1',
    options: [], deadlineMs: 15000,
    versiculo: {
      huecos_totales: 2,
      revelados: yaRevelado(ronda) ? [0, 1] : [],
      completo: ronda === 'revealed',
      respuesta: ronda === 'revealed' ? 'Uno a dos b tres' : null,
      contestando: ronda === 'juicio' ? { nombre: 'Beto', orden: 1 } : null,
      pulsos: (ronda === 'juicio' || ronda === 'revealed')
        ? [{ orden: 1, player_id: 'p2', nombre: 'Beto', veredicto: null }] : []
    }
  } : null
});

const SECRETO = 'Uno a dos b tres';
for (const ronda of ESTADOS_RONDA) {
  const e = universo(ronda);
  const v = versiculoDesdeServidor(e);

  const aviso = avisoParticipante({
    estado: ronda,
    contestando: v?.contestando ?? null,
    quedanHuecos: v ? v.huecosTotales - v.revelados.length : 0
  });
  const boton = estadoBoton({ estado: ronda });
  t(Boolean(boton?.texto), `en '${ronda}' el botón tiene texto`);

  /* La invariante de verdad no es «siempre hay aviso»: con el reloj corriendo
     el aviso es nulo a propósito, porque el botón activo ya lo dice todo.
     Lo que no puede pasar es que el participante se quede SIN SEÑAL —ni
     aviso ni botón que se pueda pulsar—, que es como se ve una app colgada. */
  const tieneAviso = Boolean(aviso?.texto);
  const puedePulsar = Boolean(boton?.activo);
  t(tieneAviso || puedePulsar,
    `en '${ronda}' el participante tiene una señal: aviso o botón activo`);

  const jug = pantallaParticipante(e, { miId: 'p1', restanteMs: 9000, totalMs: 15000 });
  const tv = pantallaTV(e, { qr: '', restanteMs: 9000, totalMs: 15000 });

  for (const [nom, html] of [['participante', jug], ['televisor', tv]]) {
    t(html.trim().length > 0, `en '${ronda}' la pantalla del ${nom} no sale vacía`);
    for (const malo of ['undefined', 'NaN', '[object Object]']) {
      t(!html.includes(malo), `en '${ronda}' el ${nom} no muestra «${malo}»`);
    }
    if (!yaRevelado(ronda)) {
      t(!html.includes(SECRETO), `en '${ronda}' el ${nom} NO filtra la respuesta`);
    }
  }
}

/* ------------------------------------------------------------------ */
console.log('\n=== La referencia va en gris, como en selección simple ===');
// En el juego viejo la referencia usa `.tenue`, que es `--tinta-suave`.
// En el nuevo estaba en cian (`--tu-100`) y competía con el versículo: la
// referencia dice DE DÓNDE es el texto, no es lo que se lee en voz alta.
const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');

const reglaDe = (selector) => {
  /* El selector puede venir con espacios de más (`.aviso.info   {`) o dentro de
     una lista separada por comas (`.aviso.ok,\n.aviso.exito {`). Un
     `indexOf(selector + ' {')` fallaba en los dos casos y hacia creer que la
     regla no existía. Se busca el selector como palabra completa y se toma el
     bloque hasta su llave de cierre. */
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(esc + '(?![\\w-])');
  const m = re.exec(css);
  if (!m) return '';
  const abre = css.indexOf('{', m.index);
  if (abre < 0) return '';
  const cierra = css.indexOf('}', abre);
  if (cierra < 0) return '';
  return css.slice(abre + 1, cierra);
};

const refJug = reglaDe('.jugador-versiculo .ref');
t(refJug.length > 0, 'existe la regla de la referencia del participante');
t(refJug.includes('var(--tinta-suave)'),
  'y usa el gris de `.tenue`, no el cian del acento');
t(!refJug.includes('var(--tu-100)'),
  'NO queda en cian: era el color que competía con el versículo');

const refTv = reglaDe('.tv-top .ref');
t(refTv.includes('var(--tinta-suave)'),
  'la referencia del televisor también es gris');

// El gris tiene que ser EL MISMO que usa el juego viejo, no uno parecido.
const tenue = reglaDe('.tenue');
t(tenue.includes('var(--tinta-suave)'),
  'el gris es el mismo token que usa `.tenue` en selección simple');

/* ------------------------------------------------------------------ */
console.log('\n=== Clases emitidas sin regla en el CSS ===');
/* Defecto real: `listaTurnosHTML` emitia `.lista`, `.vacio`, `.marca.ok` y
   `.pulso` sin ninguna regla, y los avisos `.neutro`, `.turno` y `.exito`
   tambien. Se veian como texto suelto. Peor: `.pulso` ya era una utilidad de
   animacion, asi que cada fila de participante parpadeaba en bucle.

   Esta comprobacion NO mira un caso: barre todas las clases que el modulo
   escribe y exige que cada una tenga regla. Si mañana alguien agrega una
   clase nueva y se olvida del CSS, esto falla y dice cual. */
const clasesEmitidas = (() => {
  const fuente = readFileSync(new URL('./versiculo.js', import.meta.url), 'utf8');
  const vistas = new Set();
  for (const m of fuente.matchAll(/class="([^"]*)"/g)) {
    const crudo = m[1];
    // literales entre comillas dentro de las interpolaciones
    for (const lit of crudo.matchAll(/'([^']*)'/g)) {
      for (const c of lit[1].split(/\s+/)) if (c) vistas.add(c);
    }
    // la parte fija: se tira lo que va dentro de ${...}
    for (const c of crudo.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) if (c) vistas.add(c);
  }
  return vistas;
})();

t(clasesEmitidas.size > 20, `se encontraron las clases del modulo (${clasesEmitidas.size})`);

const huerfanas = [...clasesEmitidas].filter(c => {
  const esc = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return !new RegExp('\\.' + esc + '(?![\\w-])').test(css);
});
t(huerfanas.length === 0,
  'toda clase que el juego escribe tiene regla en styles.css' +
  (huerfanas.length ? ' — faltan: ' + huerfanas.join(', ') : ''));

// Las cuatro familias de aviso tienen que existir: el aviso mas importante de
// la ronda (acierto, turno) es justo el que se habia quedado sin caja.
for (const tipo of ['info', 'ok', 'error', 'espera', 'neutro', 'turno', 'exito']) {
  t(reglaDe('.aviso.' + tipo).length > 0, `el aviso \`.${tipo}\` tiene regla propia`);
}

// Y la fila de turnos no puede volver a llamarse como la utilidad de animacion.
t(!clasesEmitidas.has('pulso'),
  'la fila de turnos no vuelve a usar `.pulso` (es la utilidad de animacion)');

/* ------------------------------------------------------------------ */
console.log(`\n${ok} correctas, ${fail} fallas`);
process.exit(fail ? 1 : 0);
