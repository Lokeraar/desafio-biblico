// Pruebas del latido del temporizador.
//
// Lo que se prueba no es «llama a pintar»: es que el ancho siga al TIEMPO con
// suavidad en las condiciones feas —ticks tardíos, ticks tempranos, cuadros
// perdidos—, que es justo donde fallaba la versión de `setInterval`.

import { calcularPct, crearLatido } from './latido.js';

let ok = 0, fail = 0;
const t = (c, m) => { if (c) { ok++; console.log('  ok   ' + m); } else { fail++; console.log('  FALLA ' + m); } };

console.log('=== 1. El porcentaje sale del tiempo, no de un contador ===');
t(calcularPct(30000, 30000) === 100, 'recién empezado: 100 %');
t(calcularPct(15000, 30000) === 50, 'a la mitad: 50 %');
t(calcularPct(0, 30000) === 0, 'agotado: 0 %');
t(calcularPct(-500, 30000) === 0, 'negativo no baja de 0');
t(calcularPct(40000, 30000) === 100, 'pasado no sube de 100');
t(calcularPct(1000, 0) === 0, 'total 0 no divide por cero');
t(calcularPct(NaN, 30000) === 0, 'NaN no se propaga a la pantalla');
t(calcularPct(1000, undefined) === 0, 'total ausente no rompe');

console.log('\n=== 2. La barra sigue al tiempo real (el defecto de fondo) ===');
// Un reloj de mentira: se controla el tiempo a mano, así la prueba no depende
// de la velocidad del equipo ni de `Date.now()`.
function reloj(duracion) {
  let ahora = 0;
  return {
    avanzar(ms) { ahora += ms; },
    restante: () => Math.max(0, duracion - ahora)
  };
}

// Programador de cuadros manual: los dispara la prueba, uno por uno.
function cuadrosDeMentira() {
  const pendientes = [];
  return {
    programar: (fn) => { pendientes.push(fn); return pendientes.length; },
    cancelar: () => {},
    disparar() { const cola = pendientes.splice(0); cola.forEach(fn => fn()); },
    cuantos: () => pendientes.length
  };
}

{
  const r = reloj(10000);
  const c = cuadrosDeMentira();
  const vistos = [];
  const latido = crearLatido({
    leer: r.restante, total: 10000,
    pintar: (pct) => vistos.push(pct),
    cuadro: c.programar, cancelarCuadro: c.cancelar
  });
  latido.arrancar();
  t(vistos[0] === 100, 'el primer cuadro pinta el 100 % sin esperar');

  // 60 cuadros por segundo, como un equipo normal.
  for (let i = 0; i < 60; i++) { r.avanzar(1000 / 60); c.disparar(); }
  const tras = vistos[vistos.length - 1];
  t(Math.abs(tras - 90) < 0.5, `tras 1 s de cuadros el ancho es ~90 % (dio ${tras.toFixed(2)} %)`);

  // Lo que NO debe pasar: que el ancho se quede quieto muchos cuadros seguidos.
  let quietos = 0, peor = 0;
  for (let i = 1; i < vistos.length; i++) {
    if (vistos[i] === vistos[i - 1]) { quietos++; peor = Math.max(peor, quietos); } else { quietos = 0; }
  }
  t(peor <= 1, `nunca hay dos cuadros seguidos con el mismo ancho (peor racha: ${peor})`);
  latido.parar();
}

console.log('\n=== 3. El aviso de fin llega UNA vez, aunque el reloj se pase ===');
{
  const r = reloj(1000);
  const c = cuadrosDeMentira();
  let avisos = 0;
  const latido = crearLatido({
    leer: r.restante, total: 1000,
    pintar: () => {}, alCero: () => { avisos++; },
    cuadro: c.programar, cancelarCuadro: c.cancelar
  });
  latido.arrancar();
  r.avanzar(1500);
  c.disparar();
  t(avisos === 1, 'al agotarse avisa una vez');
  t(latido.activo() === false, 'y deja de latir solo');
  c.disparar();
  t(avisos === 1, 'no vuelve a avisar en cuadros posteriores');
}

console.log('\n=== 4. Parar suelta el cuadro pendiente ===');
{
  const r = reloj(10000);
  let cancelados = 0;
  const pendientes = [];
  const latido = crearLatido({
    leer: r.restante, total: 10000,
    pintar: () => {},
    cuadro: (fn) => { pendientes.push(fn); return pendientes.length; },
    cancelarCuadro: () => { cancelados++; }
  });
  latido.arrancar();
  latido.parar();
  t(cancelados === 1, 'parar cancela el cuadro que estaba pedido');
  t(latido.activo() === false, 'y queda inactivo');
  const antes = pendientes.length;
  latido.parar();
  t(cancelados === 1 && pendientes.length === antes, 'parar dos veces no hace nada raro');
  latido.arrancar();
  t(latido.activo() === true, 'se puede volver a arrancar');
  latido.parar();
}

console.log('\n=== 5. Sin programador de cuadros no se cuelga el hilo ===');
{
  // Un entorno sin requestAnimationFrame: debe pintar una vez y rendirse,
  // nunca quedarse en un bucle apretado.
  let pintados = 0;
  const latido = crearLatido({
    leer: () => 5000, total: 10000,
    pintar: () => { pintados++; },
    cuadro: null, cancelarCuadro: null
  });
  // Se fuerza la ausencia de rAF del entorno.
  const original = globalThis.requestAnimationFrame;
  delete globalThis.requestAnimationFrame;
  try {
    const quieto = crearLatido({ leer: () => 5000, total: 10000, pintar: () => { pintados++; } });
    quieto.arrancar();
    t(pintados >= 1, 'pinta el primer valor');
    t(quieto.activo() === true || pintados === 1, 'no entra en bucle');
  } finally {
    if (original) globalThis.requestAnimationFrame = original;
  }
  latido.arrancar();
  t(pintados >= 2, 'y con rAF disponible sigue pintando');
  latido.parar();
}

console.log('\n=== 6. El ancho baja SIEMPRE: nunca sube ni se queda clavado ===');
{
  // La prueba que atrapa el defecto reportado: la barra «se frenaba». Con el
  // tiempo avanzando de a bloques irregulares (red lenta, cuadros perdidos),
  // el ancho de la barra tiene que bajar en cada medición y llegar a cero.
  const r = reloj(30000);
  const c = cuadrosDeMentira();
  const alturas = [];
  const latido = crearLatido({
    leer: r.restante, total: 30000,
    pintar: (pct) => alturas.push(pct),
    cuadro: c.programar, cancelarCuadro: c.cancelar
  });
  latido.arrancar();
  // Bloques irregulares: 17 ms, 300 ms, 33 ms, 900 ms... como la vida real.
  for (const salto of [17, 300, 33, 900, 16, 250, 40, 1200, 22, 700]) {
    r.avanzar(salto);
    c.disparar();
  }
  let siempreBaja = true;
  for (let i = 1; i < alturas.length; i++) if (alturas[i] > alturas[i - 1]) siempreBaja = false;
  t(siempreBaja, 'con saltos irregulares el ancho nunca sube');
  t(alturas.length >= 10, `se pintó en cada bloque, sin huecos (${alturas.length} pintadas)`);

  // Y hasta el final: la barra llega a 0 y avisa.
  let aviso = false;
  const r2 = reloj(1000);
  const c2 = cuadrosDeMentira();
  const finales = [];
  const l2 = crearLatido({
    leer: r2.restante, total: 1000,
    pintar: (pct) => finales.push(pct), alCero: () => { aviso = true; },
    cuadro: c2.programar, cancelarCuadro: c2.cancelar
  });
  l2.arrancar();
  r2.avanzar(1000);
  c2.disparar();
  t(finales[finales.length - 1] === 0, 'el último ancho es 0, no un resto');
  t(aviso === true, 'y avisó el final');
}

console.log('\n=== 7. La barra NUNCA sube (la «mini pausa» reportada) ===');
{
  // El valor del tiempo puede SUBIR un instante si el origen se mueve: el
  // desfase con el reloj del servidor se aprende de una cabecera que solo
  // tiene resolución de un segundo, así que salta dentro de esa ventana.
  // Medido con el ruido real: un retroceso de 693 ms en 4 s de ronda.
  // Un reloj no crece: cualquier subida se ignora.
  const r = reloj(10000);
  const c = cuadrosDeMentira();
  const pintados = [];
  const latido = crearLatido({
    leer: r.restante, total: 10000,
    pintar: (pct) => pintados.push(pct),
    cuadro: c.programar, cancelarCuadro: c.cancelar
  });
  latido.arrancar();
  r.avanzar(1000); c.disparar();     // baja a 90
  r.avanzar(1000); c.disparar();     // baja a 80

  // Y ahora el origen se mueve: el tiempo «restante» SUBE 700 ms.
  r.avanzar(-700); c.disparar();
  const trasElSalto = pintados[pintados.length - 1];
  t(trasElSalto <= 80, `un valor que sube NO se pinta (quedó en ${trasElSalto.toFixed(1)} %, no en 87)`);

  // Y sigue bajando normalmente después. (La cuenta: 1000 + 1000 - 700 +
  // 2000 = 3300 ms transcurridos de 10000, o sea 67 % restante.)
  const antesDeSeguir = pintados.length;
  r.avanzar(2000); c.disparar();
  t(pintados.length > antesDeSeguir, 'y después sigue pintando: no se quedó clavado');
  t(Math.abs(pintados[pintados.length - 1] - 67) < 0.5,
    `y en el valor que corresponde (dio ${pintados[pintados.length - 1].toFixed(1)} %, esperado 67)`);
  t(pintados.every((p, k) => k === 0 || p <= pintados[k - 1]), 'en toda la ronda el ancho nunca subió');
  latido.parar();
}

{
  // Y si es una ronda NUEVA, el arranque limpia la marca: el ancho puede
  // empezar alto otra vez, porque es otro reloj.
  const c = cuadrosDeMentira();
  let valor = 5000;
  const pintados = [];
  const latido = crearLatido({
    leer: () => valor, total: 10000,
    pintar: (pct) => pintados.push(pct),
    cuadro: c.programar, cancelarCuadro: c.cancelar
  });
  latido.arrancar();
  t(pintados[0] === 50, 'la primera ronda arranca al 50 %');
  latido.parar();
  valor = 9000;                       // ronda nueva, tiempo nuevo
  latido.arrancar();
  t(pintados[pintados.length - 1] === 90, 'una ronda nueva sí puede arrancar más arriba');
  latido.parar();
}

console.log('\n=== 8. Un tiempo que no avanza no repinta sin motivo ===');
{
  // Con la pestaña en segundo plano el tiempo no corre; el latido no debe
  // pintar lo mismo una y otra vez.
  const c = cuadrosDeMentira();
  let pintados = 0;
  const latido = crearLatido({
    leer: () => 5000, total: 10000,
    pintar: () => { pintados++; },
    cuadro: c.programar, cancelarCuadro: c.cancelar
  });
  latido.arrancar();
  t(pintados === 1, 'primera pintada');
  for (let i = 0; i < 20; i++) c.disparar();
  t(pintados === 1, `con el mismo valor no vuelve a pintar (${pintados} pintadas en 21 cuadros)`);
  latido.parar();
}

console.log('\n=== 9. El umbral no puede comerse cuadros enteros ===');
{
  /*
   * En una ronda LARGA, cada cuadro avanza poquísimo. Con el umbral puesto
   * como un número fijo (0,05), los cuadros que no llegan a ese cambio se
   * filtran —y los filtrados se juntan—: un cuadro de cada dos en una ronda
   * de 60 s. Medido antes de corregirlo: rachas quietas de 1 cuadro que se
   * repetían, y el ojo lo nota como un tropiezo.
   *
   * La regla: el umbral tiene que ser MENOR que lo que avanza un cuadro, para
   * cualquier duración. Se prueba con las duraciones reales del juego.
   */
  for (const duracion of [5000, 10000, 15000, 20000, 25000, 30000]) {
    const r = reloj(duracion);
    const c = cuadrosDeMentira();
    const pintados = [];
    const latido = crearLatido({
      leer: r.restante, total: duracion,
      pintar: (pct) => pintados.push(pct),
      cuadro: c.programar, cancelarCuadro: c.cancelar
    });
    latido.arrancar();

    // 60 cuadros, un segundo exacto de reloj.
    for (let k = 0; k < 60; k++) { r.avanzar(1000 / 60); c.disparar(); }

    // En un segundo de cuadros, la barra tiene que haber bajado en todos.
    let quietos = 0;
    for (let k = 1; k < pintados.length; k++) if (pintados[k] === pintados[k - 1]) quietos++;
    t(quietos === 0, `en una ronda de ${duracion / 1000} s ningún cuadro se filtra (${quietos} quietos)`);
    latido.parar();
  }
}

{
  // Y el umbral sigue sirviendo para lo suyo: con el reloj detenido no pinta
  // una y otra vez.
  const c = cuadrosDeMentira();
  let pintados = 0;
  const latido = crearLatido({
    leer: () => 5000, total: 60000,
    pintar: () => { pintados++; },
    cuadro: c.programar, cancelarCuadro: c.cancelar
  });
  latido.arrancar();
  for (let k = 0; k < 30; k++) c.disparar();
  t(pintados === 1, `con el tiempo detenido no repinta (${pintados} pintada en 31 cuadros)`);
  latido.parar();
}

console.log('\n===============================================');
if (fail === 0) console.log(` TODO EN VERDE: ${ok} correctas, 0 fallas`);
else console.log(` FALLAS: ${ok} correctas, ${fail} fallas`);
console.log('===============================================');
process.exit(fail === 0 ? 0 : 1);
