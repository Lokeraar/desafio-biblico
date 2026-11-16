/* =====================================================================
   Prueba del motor. Se corre con:  node src/lib/engine.test.mjs
   ===================================================================== */
import * as E from './engine.js';
import { BANCO } from './bank.js';
import { validarNombre, esNombreInvalido, normalizeName } from './util.js';

let ok = 0, fail = 0;

/**
 * Abre una pregunta Y arranca la cuenta.
 * Desde el flujo con inicio manual, `abrirPregunta` deja la ronda en
 * 'prepared' y sin reloj: hay que llamar a `iniciarCuenta` para poder
 * responder. Este ayudante evita repetirlo en cada caso.
 */
function abrirEIniciar(estado, t) {
  const r = E.abrirPregunta(estado, t);
  if (r.error) return r;
  return { estado: E.iniciarCuenta(r.estado, t).estado };
}
const t = (cond, msg) => {
  if (cond) { ok++; console.log('  ok   ' + msg); }
  else { fail++; console.log('  FALLA ' + msg); }
};

/* ------------------------------------------------------------------ */
console.log('=== 1. Arranque ===');
let s = E.estadoInicial();
t(s.status === 'lobby', 'arranca en lobby');
t(s.code.length === 5, 'el código tiene 5 caracteres');
t(s.players.length === 0, 'sin jugadores');

// meter 3 jugadores a mano (el transporte lo hace en el modo real)
const T0 = 1000000;
s.players = [
  { id: 'p1', name: 'Ana', score: 0, totalMs: 0, correct: 0, joinedAt: T0, waiting: false, kicked: false },
  { id: 'p2', name: 'Beto', score: 0, totalMs: 0, correct: 0, joinedAt: T0 + 1, waiting: false, kicked: false },
  { id: 'p3', name: 'Carla', score: 0, totalMs: 0, correct: 0, joinedAt: T0 + 2, waiting: false, kicked: false }
];

console.log('\n=== 2. Plan y apertura ===');
let r = E.prepararPartida(s, BANCO, 5);
s = r;
t(s.plan.length === 5, 'el plan toma 5 preguntas');
t(new Set(s.plan.map(p => p.prompt)).size === 5, 'las 5 son distintas');

r = abrirEIniciar(s, T0);
s = r.estado;
t(!r.error, 'la pregunta abre');
t(s.status === 'question', 'pasa a estado question');
t(s.round.options.length === 4, 'la ronda tiene 4 opciones');
t(new Set(s.round.options).size === 4, 'las 4 opciones son distintas');

const R = s.round;
const CORRECTA = R.correctIdx;

console.log('\n=== 3. El orden por secuencia ===');
// Ana responde bien en t+1000, Beto mal en t+2000
r = E.responder(s, { playerId: 'p1', roundId: R.id, optionIdx: CORRECTA }, T0 + 1000);
s = r.estado;
const seqAna = r.answer.seq;
t(seqAna === 1, 'la primera respuesta recibe seq 1');

const MAL = (CORRECTA + 1) % 4;
r = E.responder(s, { playerId: 'p2', roundId: R.id, optionIdx: MAL }, T0 + 2000);
s = r.estado;
const seqBeto = r.answer.seq;
t(seqBeto === 2, 'la segunda recibe seq 2 (creciente, sin empates)');
t(seqBeto > seqAna, 'el orden es estrictamente creciente');

console.log('\n=== 4. Una respuesta por jugador ===');
r = E.responder(s, { playerId: 'p1', roundId: R.id, optionIdx: MAL }, T0 + 2500);
t(r.error && /Ya respondiste/.test(r.error), 'un segundo intento se rechaza');
t(r.estado === undefined, 'el rechazo no altera el estado');

console.log('\n=== 5. Tiempo agotado ===');
r = E.responder(s, { playerId: 'p3', roundId: R.id, optionIdx: CORRECTA }, T0 + 16000);
t(r.error && /tiempo/i.test(r.error), 'pasados los 15 s se rechaza la respuesta');

console.log('\n=== 6. Cierre y ganador ===');
r = E.cerrarRonda(s, T0 + 5000);
s = r.estado;
const ana = s.players.find(p => p.id === 'p1');
const beto = s.players.find(p => p.id === 'p2');
t(s.round.state === 'closed', 'cerrar deja la ronda cerrada');
t(s.status === 'question', 'el estado sigue en question: aún no se revela');
t(ana.score === E.PUNTOS_POR_ACIERTO, `Ana suma ${E.PUNTOS_POR_ACIERTO} puntos por acertar`);
t(beto.score === 0, 'Beto no suma por errar');
t(s.round.winnerId === 'p1', 'el ganador es quien acertó');
t(s.round.state === 'closed', 'la ronda queda cerrada, pendiente de revelar');

// idempotencia
const antes = JSON.stringify(s.players);
r = E.cerrarRonda(s, T0 + 6000);
t(JSON.stringify(r.estado.players) === antes, 'cerrar dos veces NO duplica el punto');

console.log('\n=== 7. Gana el segundo si el primero falla ===');
s = abrirEIniciar(s, T0 + 7000).estado;
const R2 = s.round;
const C2 = R2.correctIdx;
const M2 = (C2 + 1) % 4;
s = E.responder(s, { playerId: 'p2', roundId: R2.id, optionIdx: M2 }, T0 + 7500).estado; // Beto falla
s = E.responder(s, { playerId: 'p3', roundId: R2.id, optionIdx: C2 }, T0 + 8000).estado; // Carla acierta
s = E.cerrarRonda(s, T0 + 9000).estado;
t(s.round.winnerId === 'p3', 'el punto va al primero que ACERTÓ, no al primero que respondió');
t(s.players.find(p => p.id === 'p3').score === E.PUNTOS_POR_ACIERTO, 'Carla suma los puntos del acierto');
t(s.players.find(p => p.id === 'p2').score === 0, 'Beto sigue en 0');

console.log('\n=== 8. Nadie acierta ===');
s = abrirEIniciar(s, T0 + 10000).estado;
const R3 = s.round;
const M3a = (R3.correctIdx + 1) % 4;
const M3b = (R3.correctIdx + 2) % 4;
s = E.responder(s, { playerId: 'p1', roundId: R3.id, optionIdx: M3a }, T0 + 10500).estado;
s = E.responder(s, { playerId: 'p2', roundId: R3.id, optionIdx: M3b }, T0 + 11000).estado;
s = E.cerrarRonda(s, T0 + 11500).estado;
t(s.round.noWinner === true, 'se marca sin ganador');
t(s.players.every(p => p.score <= E.PUNTOS_POR_ACIERTO), 'nadie suma en una ronda sin acierto');

console.log('\n=== 9. Pausa congela el reloj ===');
s = abrirEIniciar(s, T0 + 20000).estado;
const R4 = s.round;
s = E.pausar(s, T0 + 21000).estado;
t(s.paused === true, 'queda en pausa');
r = E.responder(s, { playerId: 'p3', roundId: R4.id, optionIdx: 0 }, T0 + 21500);
t(r.error && /pausó/.test(r.error), 'en pausa no se puede responder');

const restanteAntes = E.restanteMs(s.round, T0 + 21500);
s = E.reanudar(s, T0 + 31000).estado;   // 10 s en pausa
const restanteDespues = E.restanteMs(s.round, T0 + 31000);
t(Math.abs(restanteDespues - restanteAntes) < 50,
  'al reanudar queda el mismo tiempo que había (no se reinicia)');
t(s.paused === false, 'sale de pausa');

console.log('\n=== 10. Deshacer ===');
const antesAna = s.players.find(p => p.id === 'p1').score;
s = E.responder(s, { playerId: 'p1', roundId: s.round.id, optionIdx: s.round.correctIdx }, T0 + 31500).estado;
s = E.cerrarRonda(s, T0 + 32000).estado;
t(s.players.find(p => p.id === 'p1').score === antesAna + E.PUNTOS_POR_ACIERTO, 'Ana suma con el acierto');
r = E.deshacer(s, T0 + 33000);
s = r.estado;
t(!r.error, 'deshacer funciona');
t(s.players.find(p => p.id === 'p1').score === antesAna, 'deshacer devuelve el punto');
t(s.round.state === 'prepared',
  'deshacer deja la ronda PREPARADA: el presentador debe pulsar Iniciar otra vez');
t(s.round.answers.length === 0, 'deshacer borra las respuestas de esa ronda');

console.log('\n=== 10b. Deshacer después de repetir no roba puntos ajenos ===');
{
  // Ronda 1: Ana acierta y suma 10.
  let x = E.estadoInicial();
  x.players = [
    { id:'p1', name:'Ana', score:0, totalMs:0, correct:0, joinedAt:1000, waiting:false, kicked:false },
    { id:'p2', name:'Beto', score:0, totalMs:0, correct:0, joinedAt:1001, waiting:false, kicked:false }
  ];
  x = E.prepararPartida(x, BANCO, 5);
  x = E.abrirPregunta(x, T0).estado;
  x = E.iniciarCuenta(x, T0).estado;
  x = E.responder(x, { playerId:'p1', roundId:x.round.id, optionIdx:x.round.correctIdx }, T0+500).estado;
  x = E.cerrarRonda(x, T0+1000).estado;
  x = E.revelarRespuesta(x, T0+1100).estado;
  t(x.players.find(p=>p.id==='p1').score === E.PUNTOS_POR_ACIERTO, 'Ana gana 10 en la ronda 1');

  // El presentador repite la pregunta (sin deshacer antes).
  x = E.repetirPregunta(x, T0+2000).estado;
  t(x.round.state === 'open', 'la repetición está abierta');
  t(x.round.id !== x.history.at(-1).id, 'la repetición es una ronda NUEVA, no la del historial');

  // No se puede deshacer una pregunta en curso: primero se cierra.
  const enCurso = E.deshacer(x, T0+2500);
  t(!!enCurso.error && /en curso/i.test(enCurso.error),
    'deshacer rechaza una pregunta abierta (hay que cerrarla antes)');

  // Se cierra la repetición (nadie respondió) y ahora sí se deshace.
  x = E.cerrarRonda(x, T0+2700).estado;
  const d = E.deshacer(x, T0+3000).estado;
  t(d.players.find(p=>p.id==='p1').score === E.PUNTOS_POR_ACIERTO,
    'Ana CONSERVA sus 10 puntos: no se le quitan por deshacer una repetición');
  t(d.history.length === 1, 'la ronda 1 sigue en el historial');
  t(d.round.id === x.round.id, 'se reabre la ronda que se estaba jugando');
}

console.log('\n=== 11. Saltar y repetir ===');
r = E.saltarPregunta(s, T0 + 34000);
s = r.estado;
t(s.round.noWinner === true, 'saltar deja la ronda sin ganador');
t(s.round.state === 'revealed', 'saltar revela de inmediato (para eso se salta)');
t(s.status === 'reveal', 'saltar pasa a reveal');
r = E.repetirPregunta(s, T0 + 35000);
s = r.estado;
t(!r.error, 'repetir funciona');
t(s.round.state === 'open', 'repetir reabre una ronda nueva');
t(s.round.answers.length === 0, 'la repetición arranca sin respuestas');
t(s.round.options.length === 4, 'la repetición conserva 4 opciones');

console.log('\n=== 12. Tabla final y desempate ===');
// Ana 1 punto (ronda 1), Carla 1 punto (ronda 2) → empate; desempata el tiempo.
s = E.terminarJuego(s, T0 + 40000).estado;
t(s.status === 'ceremony', 'terminar lleva a ceremony');
const tabla = E.tablaFinal(s);
t(tabla.length === 3, 'la tabla tiene 3 jugadores');
t(tabla[0].score >= tabla[1].score, 'ordenada por puntos descendente');
const anaF = tabla.find(p => p.name === 'Ana');
const carlaF = tabla.find(p => p.name === 'Carla');
t(anaF.score === carlaF.score, 'Ana y Carla empatan en puntos (1 cada una)');
t(anaF.totalMs <= carlaF.totalMs, 'desempata quien usó menos tiempo');
t(tabla.map(p => p.position).join(',') === '1,2,3', 'las posiciones son 1,2,3');

console.log('\n=== 13. Podio ===');
const pod = E.podio(s);
t(pod.length === 3, 'el podio tiene 3 lugares');
t(pod[2].position === 1, 'el primero se revela al final (se muestra tercero→primero)');

console.log('\n=== 14. Nombres ===');
t(validarNombre('Ana Pérez') === null, 'un nombre normal es válido');
t(validarNombre('A') !== null, 'un nombre de 1 letra se rechaza');
t(validarNombre('') !== null, 'un nombre vacío se rechaza');
t(validarNombre('12345') !== null, 'un nombre sin letras se rechaza');
t(validarNombre('Pendejo') !== null, 'un nombre grosero se rechaza');
t(validarNombre('P3ND3J0') !== null, 'un grosero con números se rechaza');
t(validarNombre('Put@') !== null, 'un grosero con arroba se rechaza');
t(validarNombre('María José') === null, 'un nombre compuesto con tilde es válido');
t(normalizeName('  Ana   PÉREZ ') === 'ana perez', 'normaliza espacios, mayúsculas y tildes');

console.log('\n=== 15. Libre de XSS ===');
// el motor no escapa, pero verificamos que las utilidades sí
const { esc } = await import('./util.js');
t(esc('<script>alert(1)</script>').includes('&lt;script&gt;'), 'esc neutraliza etiquetas');


console.log('\n=== 16. Proyección: qué se publica y qué no ===');
let sp = E.estadoInicial();
sp.players = [
  { id:'p1', name:'Ana', score:0, totalMs:0, correct:0, joinedAt:T0, waiting:false, kicked:false },
  { id:'p2', name:'Beto', score:0, totalMs:0, correct:0, joinedAt:T0+1, waiting:false, kicked:false }
];
sp = E.prepararPartida(sp, BANCO, 2);
sp = abrirEIniciar(sp, T0).estado;
const rr = sp.round;

let vis = E.estadoVisible(sp);
t(vis.round.correctIdx === null, 'ABIERTA: la correcta no se publica');
t(vis.round.answers.length === 0, 'ABIERTA: las respuestas no se publican');
t(JSON.stringify(vis).includes('correctIdx":null'), 'ABIERTA: correctIdx viaja nulo');

// Ana responde
sp = E.responder(sp, { playerId:'p1', roundId: rr.id, optionIdx: rr.correctIdx }, T0+1000).estado;
vis = E.estadoVisible(sp);
t(vis.round.answers.length === 0, 'tras responder, las respuestas siguen ocultas');
t(vis.round.answered === 1, 'pero el conteo de respuestas sí se publica');

// cerrar: NO revela todavía
sp = E.cerrarRonda(sp, T0+2000).estado;
vis = E.estadoVisible(sp);
t(vis.round.correctIdx === null, 'CERRADA pero sin revelar: la correcta sigue oculta');
t(vis.round.answers.length === 0, 'CERRADA pero sin revelar: las respuestas siguen ocultas');

// revelar: ahora sí
sp = E.revelarRespuesta(sp, T0+2500).estado;
vis = E.estadoVisible(sp);
t(vis.round.correctIdx === rr.correctIdx, 'REVELADA: la correcta sí se publica');
t(vis.round.answers.length === 1, 'REVELADA: las respuestas sí se publican');
t(vis.round.answers[0].correct === true, 'REVELADA: cada quien puede ver si acertó');
t(vis.round.answers[0].seq === 1, 'REVELADA: se publica el orden de llegada');
t(vis.round.winnerId === 'p1', 'REVELADA: se publica el ganador');

console.log('\n=== 17. El nombre no se filtra a la proyección pública ===');
t(!JSON.stringify(vis).includes('playerToken'), 'no viaja el token del jugador');

/* ------------------------------------------------------------------ */
console.log('\n===============================');
console.log(` ${ok} correctas, ${fail} fallas`);
console.log('===============================');
process.exit(fail ? 1 : 0);
