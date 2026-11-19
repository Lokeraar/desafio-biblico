/* Prueba de la traducción servidor → cliente (src/lib/cloud.js).
   Aquí vivió un defecto grave: el servidor baraja las opciones conservando
   la clave original de cada una (la posición 1 puede ser 'd'), y el cliente
   enviaba la letra de la POSICIÓN. El servidor la comparaba contra la clave
   real, así que daba incorrecto siempre y nadie sumaba puntos. */
import { estadoDesdeServidor, resolverSala, mirarSala, fijarDesfaseDeRonda } from './cloud.js';
import { normalizarCodigo } from './util.js';

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

console.log('=== 0. El desfase de la ronda se congela ===');
/*
 * El origen del tiempo de la ronda se fija UNA vez y no se vuelve a tocar.
 *
 * Por qué importa: la cabecera `Date` del servidor solo tiene resolución de
 * un segundo (medido contra el servidor real: siempre llega en `.000`), así
 * que cada medición del desfase trae hasta un segundo de ruido. Si el origen
 * se re-aprende con cada sondeo —cada 900 ms— la barra retrocede de golpe:
 * medido, 693 ms de retroceso en 4 segundos, y el usuario lo ve como una
 * pausa al pasar cada segundo.
 */
{
  const a = fijarDesfaseDeRonda(1000);
  t(typeof a === 'number', 'fijar devuelve un número');
  const b = fijarDesfaseDeRonda(1000);
  t(a === b, 'el MISMO arranque no vuelve a congelar: el sondeo no reinicia el reloj');
  const c = fijarDesfaseDeRonda(2000);
  t(typeof c === 'number', 'un arranque distinto sí re-fija (es otra ronda)');
  t(fijarDesfaseDeRonda(null) === fijarDesfaseDeRonda(null), 'sin ronda es estable');
}

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

/* ==================================================================
   Televisor: resolver un código de sala y mirar sin ser jugador.
   El televisor NO ocupa puesto de jugador: estas pruebas fijan que
   consulte `room_by_code` / `room_state` y que se pueda detener.
   ================================================================== */

console.log('\n=== 7. El código se limpia antes de buscar la sala ===');
t(normalizarCodigo('b 7 3 w s') === 'B73WS', 'los espacios internos desaparecen');
t(normalizarCodigo('  abc12  ') === 'ABC12', 'los extremos se recortan');
t(normalizarCodigo(null) === '', 'un valor nulo da cadena vacía');

// fetch falso: las pruebas no tocan la red, solo miran lo que se envía.
const fetchReal = globalThis.fetch;
let enviadas = [];
function falso(respuesta) {
  globalThis.fetch = async (url, opciones) => {
    enviadas.push({ url: String(url), cuerpo: JSON.parse(opciones.body) });
    return {
      ok: respuesta.ok ?? true,
      status: respuesta.status ?? 200,
      text: async () => JSON.stringify(respuesta.cuerpo ?? null)
    };
  };
}

console.log('\n=== 8. resolverSala pide el código normalizado ===');
enviadas = [];
falso({ cuerpo: { room_id: 'r-9', code: 'B73WS', status: 'lobby' } });
const sala = await resolverSala('b 7 3 w s');
t(enviadas[0].url.endsWith('/rpc/room_by_code'), 'llama a la RPC room_by_code');
t(enviadas[0].cuerpo.p_code === 'B73WS', 'manda el código sin espacios y en mayúsculas');
t(sala.roomId === 'r-9' && sala.code === 'B73WS' && sala.status === 'lobby',
  'devuelve id, código y estado');
t(Object.keys(sala).sort().join(',') === 'code,roomId,status',
  'no expone jugadores ni la respuesta correcta');

console.log('\n=== 9. Un código que no existe llega como error ===');
enviadas = [];
falso({ ok: false, status: 400, cuerpo: { message: 'sala_inexistente' } });
const noExiste = await resolverSala('ZZZZZ');
t(noExiste.error === 'sala_inexistente', 'propaga sala_inexistente');

console.log('\n=== 10. mirarSala sondea sin jugador y no filtra la correcta ===');
enviadas = [];
falso({ cuerpo: bruto({ state: 'open', correct_key: 'd' }) });
const recibidos = [];
const tv = mirarSala('r-9', { onEstado: e => recibidos.push(e) });
await tv.primero;
t(enviadas[0].url.endsWith('/rpc/room_state'), 'usa room_state');
t(enviadas[0].cuerpo.p_room === 'r-9' && !('p_token' in enviadas[0].cuerpo),
  'room_state toma solo p_room');
t(recibidos.length === 1, 'entrega el estado al televisor');
t(recibidos[0].round.correctIdx === null, 'con la ronda abierta no llega la correcta');
t(Array.isArray(recibidos[0].players) && recibidos[0].players.length === 1,
  'el marcador sí se ve en la pantalla');
t(recibidos[0].roomId === 'r1', 'el estado conserva el id de la sala');

console.log('\n=== 11. parar() detiene el sondeo ===');
const antesDeParar = enviadas.length;
tv.parar();
await new Promise(r => setTimeout(r, 1600));   // más que un ciclo de sondeo
t(enviadas.length === antesDeParar, 'después de parar no hay más consultas');
t(tv.activo() === false, 'el sondeo queda marcado como inactivo');

// Se restaura fetch para no dejar la red falsa puesta.
globalThis.fetch = fetchReal;

/* ==================================================================
   PRESERVE: lo que ya funcionaba tiene que seguir funcionando.
   ================================================================== */

console.log('\n=== 12. El estado que ve el televisor es el mismo que ve un jugador ===');
const tvBruto = bruto({ state: 'revealed', correct_key: 'd' });
const comoJugador = estadoDesdeServidor(tvBruto, { completo: false });
const comoTV = estadoDesdeServidor(tvBruto, { completo: false });
t(JSON.stringify(comoTV) === JSON.stringify(comoJugador),
  'ninguna opción de la proyección pública cambia por ser televisor');
t(comoTV.round.correctIdx === 0,
  'al revelar, el televisor sí ve la correcta (es parte del espectáculo)');
t(comoTV.status === 'question' && comoTV.code === 'ABC12',
  'el estado conserva el código y el estado de la sala');

console.log('\n=== 13. El código normal no cambia ===');
t(normalizarCodigo('B73WS') === 'B73WS', 'un código ya limpio se queda igual');
t(normalizarCodigo('abc12') === 'ABC12', 'se pasa a mayúsculas como antes');

console.log('\n=== 14. El motivo del cierre llega al cliente ===');
// El servidor cierra solo las salas abandonadas y deja el motivo en
// `close_reason`. Si el cliente no lo tradujera, el jugador expulsado
// volvería al menú sin saber por qué salió de la partida.
const porInactividad = estadoDesdeServidor(
  { ...bruto(), status: 'closed', close_reason: 'inactividad' }, { completo: false });
t(porInactividad.status === 'closed', 'la sala llega cerrada');
t(porInactividad.closeReason === 'inactividad',
  'el cliente recibe el motivo de inactividad');

t(abierta.closeReason === null,
  'una sala viva no tiene motivo de cierre');

// El presentador que pulsa «Menú» cierra la sala sin motivo: ahí manda el
// texto de siempre y no hay que anunciar una expulsión automática.
const cerradaAMano = estadoDesdeServidor({ ...bruto(), status: 'closed' }, { completo: false });
t(cerradaAMano.closeReason === null,
  'un cierre sin motivo no se confunde con la inactividad');

console.log('\n===============================');
console.log(`  ${ok} correctas, ${fail} fallas`);
console.log('===============================');
if (fail > 0) process.exitCode = 1;
