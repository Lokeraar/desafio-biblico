/* Prueba de la traducción servidor → cliente (src/lib/cloud.js).
   Aquí vivió un defecto grave: el servidor baraja las opciones conservando
   la clave original de cada una (la posición 1 puede ser 'd'), y el cliente
   enviaba la letra de la POSICIÓN. El servidor la comparaba contra la clave
   real, así que daba incorrecto siempre y nadie sumaba puntos. */
import { estadoDesdeServidor } from './cloud.js';

let ok = 0, fail = 0;
const t = (c, m) => { if (c) { ok++; console.log('  ok   ' + m); } else { fail++; console.log('  FALLA ' + m); } };

// Forma REAL del servidor: barajado, claves conservadas.
const opcionesBarajadas = [
  { k: 'd', t: 'Publicanos' },
  { k: 'b', t: 'Fariseos' },
  { k: 'a', t: 'Incrédulos' },
  { k: 'c', t: 'Hipócritas' }
];

const bruto = (extra = {}) => ({
  room_id: 'r1',
  code: 'ABC12',
  game_slug: 'seleccion-simple',
  status: 'question',
  paused: false,
  round_seconds: 15,
  players: [{ id: 'p1', name: 'Ana', score: 10, total_ms: 900, correct: 1, joined_at: null, waiting: false }],
  round: {
    round_id: 'rd1', ordinal: 1, state: 'open', prompt: '¿Quiénes?',
    reference: '2 Co 1:1', options: opcionesBarajadas,
    correct_key: null, opened_at: null, deadline: null, answered: 0,
    no_winner: false, winner_id: null, answers: [],
    ...extra
  }
});

console.log('=== 1. Con la ronda abierta NO se filtra la correcta ===');
const abierta = estadoDesdeServidor(bruto(), { completo: false });
t(abierta.round.correctIdx === null, 'el jugador no recibe la correcta');
t(abierta.round.answers.length === 0, 'el jugador no recibe respuestas ajenas');
t(abierta.round.options.join('|') === 'Publicanos|Fariseos|Incrédulos|Hipócritas',
  'las opciones se muestran en el orden barajado del servidor');

console.log('\n=== 2. Las claves reales viajan para poder responder ===');
t(abierta.round.optionKeys.join(',') === 'd,b,a,c',
  'la clave de cada posición es la original, no la posición');
t(abierta.round.optionKeys[0] === 'd',
  'la opción mostrada primera tiene clave d (esto era el defecto)');

console.log('\n=== 3. Al revelar, la correcta queda en su POSICIÓN ===');
const revelada = estadoDesdeServidor(bruto({ state: 'revealed', correct_key: 'd' }), { completo: false });
t(revelada.round.correctIdx === 0, 'la clave d está en la posición 0');
t(revelada.round.options[revelada.round.correctIdx] === 'Publicanos',
  'esa posición corresponde al texto correcto');

console.log('\n=== 4. Otro barajado: la correcta cae en otra posición ===');
const otras = [
  { k: 'a', t: 'Uno' }, { k: 'b', t: 'Dos' }, { k: 'c', t: 'Tres' }, { k: 'd', t: 'Cuatro' }
];
const otra = estadoDesdeServidor(
  bruto({ options: otras, state: 'revealed', correct_key: 'c' }), { completo: false }
);
t(otra.round.correctIdx === 2, 'la clave c queda en la posición 2');
t(otra.round.options[otra.round.correctIdx] === 'Tres', 'y apunta a «Tres»');

console.log('\n=== 5. Las respuestas se traducen a posición, no a clave ===');
const conRespuestas = estadoDesdeServidor(
  bruto({
    state: 'revealed', correct_key: 'd',
    answers: [
      { seq: 1, player_id: 'p1', name: 'Ana', option: 'd', correct: true, ms: 900 },
      { seq: 2, player_id: 'p2', name: 'Beto', option: 'a', correct: false, ms: 1200 }
    ]
  }),
  { completo: true }
);
t(conRespuestas.round.answers[0].optionIdx === 0, 'Ana eligió la posición 0 (clave d)');
t(conRespuestas.round.answers[1].optionIdx === 2, 'Beto eligió la posición 2 (clave a)');
t(conRespuestas.round.answers[0].correct === true, 'Ana acertó');

console.log('\n=== 6. Datos incompletos no rompen nada ===');
const vacio = estadoDesdeServidor({ room_id: 'r', code: 'X', players: [], round: null });
t(vacio.round === null, 'sin ronda, round es null');
t(Array.isArray(vacio.players) && vacio.players.length === 0, 'sin jugadores la lista va vacía');
const sinOpciones = estadoDesdeServidor({ room_id: 'r', code: 'X', players: [], round: { round_id: 'x' } });
t(sinOpciones.round.optionKeys.length === 0, 'sin opciones, optionKeys queda vacío');
t(sinOpciones.round.correctIdx === null, 'sin correct_key no inventa una correcta');
t(estadoDesdeServidor(null) === null, 'un payload nulo devuelve null');

console.log('\n===============================');
console.log(`  ${ok} correctas, ${fail} fallas`);
console.log('===============================');
if (fail > 0) process.exitCode = 1;
