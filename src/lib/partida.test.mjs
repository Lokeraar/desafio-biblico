/* Partida completa por el transporte local: presentador + 3 jugadores. */
import { crearHostLocal, crearClienteLocal } from './local.js';
import { BANCO } from './bank.js';
import * as E from './engine.js';

let ok = 0, fail = 0;
const t = (c, m) => { if (c) { ok++; console.log('  ok   ' + m); } else { fail++; console.log('  FALLA ' + m); } };
const esperar = ms => new Promise(r => setTimeout(r, ms));

console.log('=== Montar presentador y tres jugadores ===');
let estadoHost = null;
const host = crearHostLocal({ preguntas: BANCO, onEstado: e => { estadoHost = e; } });
host.preparar(3);
await esperar(50);
t(!!estadoHost, 'el presentador recibe estado');
t(estadoHost.code.length === 5, 'la sala tiene código');

const ana = crearClienteLocal({});
const beto = crearClienteLocal({});
const carla = crearClienteLocal({});
await esperar(100);

const r1 = await ana.unirse('Ana Pérez');
t(!r1.error, 'Ana entra: ' + (r1.error ?? 'ok'));
t(r1.waiting === false, 'Ana entra jugando');

const r2 = await beto.unirse('Beto Ruiz');
t(!r2.error, 'Beto entra');

const r3 = await carla.unirse('Carla Díaz');
t(!r3.error, 'Carla entra');

const dup = await crearClienteLocal({}).unirse('ANA PEREZ');
t(dup.error && /nombre/i.test(dup.error), 'nombre repetido rechazado: ' + dup.error);

const grosero = await crearClienteLocal({}).unirse('Pendejo');
t(grosero.error && /nombre/i.test(grosero.error), 'nombre grosero rechazado');

console.log('\n=== Abrir pregunta ===');
const errAbrir = host.abrir();
t(!errAbrir, 'la pregunta abre: ' + (errAbrir ?? 'ok'));
await esperar(60);
t(estadoHost.round.state === 'prepared', 'la ronda queda preparada, sin reloj');
t(estadoHost.round.openedAt === null, 'el reloj NO ha arrancado');
const errIniciar = host.iniciar();
t(!errIniciar, 'el presentador inicia la cuenta: ' + (errIniciar ?? 'ok'));
await esperar(80);
const ronda = estadoHost.round;
t(!!ronda, 'el presentador tiene la ronda');
t(ronda.answers.length === 0, 'sin respuestas al abrir');

console.log('\n=== El público no ve la correcta ===');
const pub = await ana.pedirEstado();
t(pub.estado.round.correctIdx === null, 'el jugador NO ve la correcta');
t(pub.estado.round.answers.length === 0, 'el jugador NO ve respuestas ajenas');

console.log('\n=== Los tres responden en orden ===');
const MAL = (ronda.correctIdx + 1) % 4;
// Beto primero, y falla
const a1 = await beto.responder(r2.playerId, ronda.id, MAL);
t(!a1.error, 'Beto responde primero');
await esperar(20);
// Ana segunda, y acierta
const a2 = await ana.responder(r1.playerId, ronda.id, ronda.correctIdx);
t(!a2.error, 'Ana responde segunda');
await esperar(20);
// Carla tercera, y también acierta
const a3 = await carla.responder(r3.playerId, ronda.id, ronda.correctIdx);
t(!a3.error, 'Carla responde tercera');
await esperar(80);

t(estadoHost.round.answers.length === 3, 'el presentador ve 3 respuestas');
const seqs = estadoHost.round.answers.map(a => a.seq);
t(seqs[0] < seqs[1] && seqs[1] < seqs[2], 'las secuencias son crecientes: ' + seqs.join('<'));

console.log('\n=== Doble respuesta rechazada ===');
const doble = await beto.responder(r2.playerId, ronda.id, ronda.correctIdx);
t(doble.error && /Ya respondiste/.test(doble.error), 'Beto no puede responder dos veces');

console.log('\n=== Cerrar: gana el primero que ACERTÓ ===');
host.cerrar();
await esperar(80);
t(estadoHost.round.state === 'closed', 'cerrar deja la ronda cerrada, sin revelar');
host.revelar();
await esperar(80);
t(estadoHost.status === 'reveal', 'revelar pasa a revelación');
t(estadoHost.round.winnerId === r1.playerId, 'gana Ana (acertó y fue la primera en acertar)');
const anaPts = estadoHost.players.find(p => p.id === r1.playerId);
const betoPts = estadoHost.players.find(p => p.id === r2.playerId);
const carlaPts = estadoHost.players.find(p => p.id === r3.playerId);
t(anaPts.score === E.PUNTOS_POR_ACIERTO, `Ana suma ${E.PUNTOS_POR_ACIERTO}`);
t(betoPts.score === 0, 'Beto (falló) no suma');
t(carlaPts.score === 0, 'Carla (acertó después) no suma');

console.log('\n=== Ahora el público sí ve la correcta ===');
const pub2 = await ana.pedirEstado();
t(pub2.estado.round.correctIdx === ronda.correctIdx, 'revelada la correcta');
t(pub2.estado.round.answers.length === 3, 'reveladas las respuestas');

console.log('\n=== Segunda pregunta: gana Carla ===');
host.abrir();
await esperar(40);
host.iniciar();
await esperar(60);
const ronda2 = estadoHost.round;
const a4 = await beto.responder(r2.playerId, ronda2.id, (ronda2.correctIdx + 2) % 4);
t(!a4.error, 'Beto responde y falla');
const a5 = await carla.responder(r3.playerId, ronda2.id, ronda2.correctIdx);
t(!a5.error, 'Carla responde y acierta');
await esperar(60);
host.cerrar();
await esperar(60);
host.revelar();
await esperar(80);
t(estadoHost.round.winnerId === r3.playerId, 'Carla gana la segunda');

console.log('\n=== Terminar y tabla final ===');
host.terminar();
await esperar(60);
t(estadoHost.status === 'ceremony', 'estado ceremony');
const tabla = E.tablaFinal(estadoHost);
t(tabla[0].name === 'Ana Pérez' || tabla[0].name === 'Carla Díaz', 'el primero es quien tiene punto');
t(tabla.length === 3, 'tres en la tabla');
console.log('     tabla:', tabla.map(p => `${p.position}. ${p.name} (${p.score})`).join(' | '));

host.destruir(); ana.cerrar(); beto.cerrar(); carla.cerrar();

console.log('\n===============================');
console.log(` ${ok} correctas, ${fail} fallas`);
console.log('===============================');
process.exit(fail ? 1 : 0);
