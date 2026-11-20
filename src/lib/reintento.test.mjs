/* Prueba de la política de reintento: puro cálculo, sin navegador y sin red.

   Cada caso está pensado para FALLAR si el defecto estuviera presente. El
   defecto que motiva todo esto: un solo intento, y al fallar la red el
   participante se queda sin turno y sin forma de reintentar. */
import {
  ESPERA_INICIAL, ESPERA_MAXIMA, siguienteEspera, esDefinitivo,
  yaEstabaDentro, reintentarPulso
} from './reintento.js';

let ok = 0, fail = 0;
const t = (c, m) => { if (c) { ok++; console.log('  ok   ' + m); } else { fail++; console.log('  FALLA ' + m); } };

/** Un `dormir` que no duerme: registra la espera y sigue. */
function dormilon() {
  const esperas = [];
  const dormir = async (ms) => { esperas.push(ms); };
  return { dormir, esperas };
}

/** Un intentar que devuelve los errores de la lista, en orden. */
function respuestas(lista) {
  let i = 0;
  const llamadas = [];
  const intentar = async () => {
    llamadas.push(i);
    const e = lista[Math.min(i, lista.length - 1)];
    i += 1;
    return { error: e };
  };
  return { intentar, llamadas };
}

console.log('=== 1. Si el primer intento entra, no se reintenta ===');
{
  const { intentar, llamadas } = respuestas([null]);
  const { dormir, esperas } = dormilon();
  const r = await reintentarPulso({ intentar, restante: () => 30000, dormir });
  t(r.ok === true, 'la pulsación entra');
  t(llamadas.length === 1, `un solo intento (fueron ${llamadas.length})`);
  t(esperas.length === 0, 'no durmió nada');
}

console.log('\n=== 2. La red falla y entra al segundo intento ===');
/* El caso que motiva el módulo: el primer envío se pierde, el reintento entra.
   Con la política anterior (un solo intento) esto dejaba al participante sin
   turno. */
{
  const { intentar, llamadas } = respuestas(['red', null]);
  const { dormir, esperas } = dormilon();
  const r = await reintentarPulso({ intentar, restante: () => 30000, dormir });
  t(r.ok === true, 'el reintento lo logra');
  t(llamadas.length === 2, `dos intentos (fueron ${llamadas.length})`);
  t(esperas.length === 1, 'durmió una vez');
  t(esperas[0] === ESPERA_INICIAL, `la primera espera es la inicial (${esperas[0]} ms)`);
}

console.log('\n=== 2b. La espera crece entre intentos ===');
{
  const { intentar } = respuestas(['red', 'red', null]);
  const { dormir, esperas } = dormilon();
  const r = await reintentarPulso({ intentar, restante: () => 30000, dormir });
  t(r.ok === true, 'entra al tercero');
  t(esperas.length === 2, 'dos esperas');
  t(esperas[1] > esperas[0], `la segunda espera es mayor (${esperas[0]} -> ${esperas[1]})`);
}

console.log('\n=== 3. `ya_pulso` es un éxito, no un fallo ===');
/* El servidor rechaza un segundo insert porque esa pulsación YA está. Reintentar
   y recibir esto significa que el toque entró: hay que darlo por bueno. */
{
  const { intentar, llamadas } = respuestas(['ya_pulso']);
  const { dormir, esperas } = dormilon();
  const r = await reintentarPulso({ intentar, restante: () => 30000, dormir });
  t(r.ok === true, 'se cuenta como éxito');
  t(llamadas.length === 1, `no se reintenta (${llamadas.length} intento)`);
  t(esperas.length === 0, 'no durmió');
  t(yaEstabaDentro('ya_pulso'), 'el módulo lo reconoce');
  t(yaEstabaDentro('ronda_cerrada') === false, 'y no confunde otros errores');
}

console.log('\n=== 4. Un error definitivo corta de inmediato ===');
for (const error of ['ronda_cerrada', 'fuera_de_tiempo', 'jugador_expulsado']) {
  const { intentar, llamadas } = respuestas([error]);
  const { dormir, esperas } = dormilon();
  const r = await reintentarPulso({ intentar, restante: () => 30000, dormir });
  t(r.ok === false, `${error}: no entra`);
  t(r.motivo === error, `${error}: informa el motivo del servidor`);
  t(llamadas.length === 1, `${error}: no reintenta`);
  t(esperas.length === 0, `${error}: no duerme`);
}
t(esDefinitivo('ronda_cerrada'), 'ronda_cerrada es definitivo');
t(esDefinitivo('juego_pausado'), 'juego_pausado es definitivo');
t(esDefinitivo('red') === false, 'la red NO es definitiva: se reintenta');

console.log('\n=== 5. Se acaba el tiempo: se rinde y avisa ===');
{
  const { intentar } = respuestas(['red']);
  const { dormir, esperas } = dormilon();
  // El reloj se agota enseguida: queda menos que la espera programada.
  const r = await reintentarPulso({ intentar, restante: () => 100, dormir });
  t(r.ok === false, 'no entra');
  t(r.motivo === 'red', 'el motivo es la red, no el reloj');
  t(esperas.length === 0, 'no durmió una espera que ya no cabía');
}

console.log('\n=== 5b. No se programa una espera mayor que el tiempo restante ===');
{
  const { intentar } = respuestas(['red']);
  const { dormir, esperas } = dormilon();
  /* Restante grande al principio y chico después, como un reloj de verdad. */
  let queda = 30000;
  const restante = () => { const v = queda; queda = 500; return v; };
  const r = await reintentarPulso({ intentar, restante, dormir });
  t(r.ok === false, 'se rinde');
  t(esperas.length === 1, `durmió solo la primera (${esperas.length})`);
  t(esperas[0] < 30000, 'y esa cabía en el reloj');
}

console.log('\n=== 6. `siguienteEspera` crece y se recorta ===');
t(siguienteEspera(600) === 900, `600 -> 900 (fue ${siguienteEspera(600)})`);
t(siguienteEspera(1000) === 1500, '1000 -> 1500');
t(siguienteEspera(2400) === ESPERA_MAXIMA, `2400 se recorta en el tope (${siguienteEspera(2400)})`);
t(siguienteEspera(999999) === ESPERA_MAXIMA, 'un valor enorme también se recorta');
t(siguienteEspera(0) === ESPERA_MAXIMA, 'un 0 no deja la espera en cero');

console.log('\n=== 7. Una excepción de red se trata como red, no como definitivo ===');
{
  let n = 0;
  const intentar = async () => { n += 1; if (n === 1) throw new Error('sin señal'); return { error: null }; };
  const { dormir } = dormilon();
  const r = await reintentarPulso({ intentar, restante: () => 30000, dormir });
  t(r.ok === true, 'una excepción no mata el reintento');
  t(n === 2, `se reintentó tras la excepción (${n} intentos)`);
}

console.log('\n===============================');
console.log(` ${ok} correctas, ${fail} fallas`);
console.log('===============================');
process.exit(fail ? 1 : 0);
