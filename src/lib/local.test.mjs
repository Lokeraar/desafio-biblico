/* =====================================================================
   Prueba del transporte local y de la vista del presentador.
   node src/lib/local.test.mjs
   ===================================================================== */
import * as E from './engine.js';
import { vistaHostCompleta } from './local.js';
import { BANCO } from './bank.js';

let ok = 0, fail = 0;
const t = (c, m) => { if (c) { ok++; console.log('  ok   ' + m); } else { fail++; console.log('  FALLA ' + m); } };

const T0 = 1000000;

console.log('=== 1. vistaHostCompleta existe y devuelve lo esperado ===');
let s = E.estadoInicial();
s.players = [
  { id: 'p1', name: 'Ana', score: 0, totalMs: 0, correct: 0, joinedAt: T0, waiting: false, kicked: false },
  { id: 'p2', name: 'Beto', score: 0, totalMs: 0, correct: 0, joinedAt: T0 + 1, waiting: false, kicked: false }
];
s = E.prepararPartida(s, BANCO, 2);
s = E.abrirPregunta(s, T0).estado;
const r = s.round;

let v = vistaHostCompleta(s);
t(typeof vistaHostCompleta === 'function', 'la función está exportada');
t(v.round.correctIdx === r.correctIdx, 'la ronda abierta SÍ revela la correcta al presentador');
t(Array.isArray(v.round.answers), 'answers es un arreglo');
t(v.round.answers.length === 0, 'sin respuestas todavía');

console.log('\n=== 2. Las respuestas llegan al presentador en orden ===');
s = E.responder(s, { playerId: 'p2', roundId: r.id, optionIdx: 1 }, T0 + 500).estado;
s = E.responder(s, { playerId: 'p1', roundId: r.id, optionIdx: r.correctIdx }, T0 + 900).estado;

v = vistaHostCompleta(s);
t(v.round.answers.length === 2, 'el presentador ve las 2 respuestas');
t(v.round.answers[0].seq < v.round.answers[1].seq, 'ordenadas por seq ascendente');
t(v.round.answers[0].playerId === 'p2', 'la primera fue Beto');
t(v.round.answers[0].name === 'Beto', 'incluye el nombre, no solo el id');
t(typeof v.round.answers[0].elapsedMs === 'number', 'incluye el tiempo de respuesta');
t(typeof v.round.answers[0].correct === 'boolean', 'incluye si acertó');

console.log('\n=== 3. Contraste: el público NO ve nada de eso ===');
const pub = E.estadoVisible(s);
t(pub.round.answers.length === 0, 'el público no ve respuestas');
t(pub.round.correctIdx === null, 'el público no ve la correcta');
t(pub.round.answered === 2, 'pero sí el conteo');

console.log('\n=== 4. Los datos del jugador que necesita el desempate ===');
t(typeof pub.players[0].joinedAt === 'number', 'joinedAt viaja al público');
t(typeof pub.players[0].correct === 'number', 'correct viaja al público');
t(pub.players[0].joinedAt !== undefined, 'joinedAt definido (no undefined)');

const tabla = E.tablaFinal(pub);
t(tabla.length === 2, 'tablaFinal funciona sobre la proyección pública');
t(tabla.every(p => p.position >= 1), 'todas las posiciones son válidas');

console.log('\n=== 5. Desempate con joinedAt presente ===');
// empate exacto en puntos y tiempo: decide el ingreso
const empate = {
  players: [
    { id: 'a', name: 'Primero', score: 1, totalMs: 500, correct: 1, joinedAt: 100, waiting: false, kicked: false },
    { id: 'b', name: 'Segundo', score: 1, totalMs: 500, correct: 1, joinedAt: 200, waiting: false, kicked: false }
  ]
};
const te = E.tablaFinal(empate);
t(te[0].name === 'Primero', 'con empate total gana quien entró antes');
t(te[1].name === 'Segundo', 'el segundo queda segundo');

console.log('\n=== 6. Desempate por tiempo ===');
const portiempo = {
  players: [
    { id: 'a', name: 'Lento', score: 1, totalMs: 900, correct: 1, joinedAt: 100, waiting: false, kicked: false },
    { id: 'b', name: 'Rapido', score: 1, totalMs: 300, correct: 1, joinedAt: 200, waiting: false, kicked: false }
  ]
};
const tt = E.tablaFinal(portiempo);
t(tt[0].name === 'Rapido', 'con empate en puntos gana el más rápido, aunque entró después');

console.log('\n=== 7. Los de la sala de espera no aparecen ===');
const conEspera = {
  players: [
    { id: 'a', name: 'Dentro', score: 2, totalMs: 0, correct: 2, joinedAt: 100, waiting: false, kicked: false },
    { id: 'b', name: 'Espera', score: 0, totalMs: 0, correct: 0, joinedAt: 150, waiting: true, kicked: false },
    { id: 'c', name: 'Fuera', score: 5, totalMs: 0, correct: 5, joinedAt: 120, kicked: true, waiting: false }
  ]
};
const tce = E.tablaFinal(conEspera);
t(tce.length === 1, 'solo cuenta quien jugó');
t(tce[0].name === 'Dentro', 'el de espera y el expulsado quedan fuera');

console.log('\n===============================');
console.log(` ${ok} correctas, ${fail} fallas`);
console.log('===============================');
process.exit(fail ? 1 : 0);
