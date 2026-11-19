/* Prueba de las pantallas de completar el versículo: puro texto, sin navegador.

   Cada caso está pensado para FALLAR si el defecto estuviera presente. La
   más importante es la de fuga: si la respuesta aparece en pantalla antes
   de revelarse, el juego se pierde entero. */
import {
  felicitacion, todasLasFelicitaciones, versiculoDesdeServidor,
  versiculoHTML, avisoParticipante, miTurnoTexto, estadoBoton,
  pantallaParticipante, pantallaTV, listaTurnosHTML, modalJuicioHTML
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

// El defecto clásico: escapar antes de marcar, y el marcado sale como texto.
const conEtiquetas = versiculoHTML('Dijo <b>esto</b> y ____');
t(conEtiquetas.includes('&lt;b&gt;'), 'escapa el HTML del texto');
t(conEtiquetas.includes('class="hueco"'), 'y aun así marca el hueco');

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
t((lista.match(/class="pulso/g) || []).length === 2, 'una fila por pulso');
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
console.log(`\n${ok} correctas, ${fail} fallas`);
process.exit(fail ? 1 : 0);
