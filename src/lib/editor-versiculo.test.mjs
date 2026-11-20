/* Prueba del editor de versículos: puro cálculo, sin navegador.

   Cada caso está pensado para FALLAR si el defecto estuviera presente. El
   defecto que motiva todo esto: para un versículo se abría el formulario de
   opción múltiple, que exige cuatro respuestas que un versículo no tiene. */
import {
  TOPE_HUECOS, TOPE_DESHACER, palabrasDe, unirPalabras, desdeMarcado, serializar,
  puedeOcultar, editorVacio, editorDesde, conTexto, alternarHueco, deshacer,
  pasosDeDeshacer, resumenHuecos, validarVersiculo, paraGuardar
} from './editor-versiculo.js';

let ok = 0, fail = 0;
const t = (c, m) => { if (c) { ok++; console.log('  ok   ' + m); } else { fail++; console.log('  FALLA ' + m); } };

const VERSICULO = 'Pablo apóstol de Jesucristo por la voluntad de Dios, y el hermano Timoteo a la iglesia de Dios que está en Corinto.';

console.log('=== 1. Partir y unir el texto ===');
{
  const p = palabrasDe('Uno dos  tres');
  t(p.length === 3, `tres palabras (${p.length})`);
  t(unirPalabras(p) === 'Uno dos  tres', 'unir devuelve el texto EXACTO, con el doble espacio');
  t(palabrasDe('').length === 0, 'texto vacío da cero palabras');
  t(palabrasDe('   ').length === 0, 'solo espacios da cero palabras');
  // los saltos de línea tienen que sobrevivir
  t(unirPalabras(palabrasDe('Uno\ndos')) === 'Uno\ndos', 'conserva el salto de línea');
}

console.log('\n=== 2. Marcar y desmarcar ===');
{
  const base = conTexto(editorVacio(), VERSICULO);
  const i = base.palabras.findIndex(p => p.texto === 'Timoteo');
  t(i > 0, `Timoteo está en el índice ${i}`);

  const r1 = alternarHueco(base, i);
  t(r1.accion === 'oculto', 'marcar devuelve «oculto»');
  t(r1.estado.ocultas.includes(i), 'la palabra queda oculta');

  const r2 = alternarHueco(r1.estado, i);
  t(r2.accion === 'visible', 'volver a tocarla devuelve «visible»');
  t(!r2.estado.ocultas.includes(i), 'y la desoculta');
}

console.log('\n=== 3. Ida y vuelta del formato con llaves ===');
{
  const base = conTexto(editorVacio(), VERSICULO);
  const i = base.palabras.findIndex(p => p.texto === 'Timoteo');
  const marcado = serializar(base.palabras, [i]);
  t(marcado.includes('{Timoteo}'), 'se serializa con llaves');
  t(!marcado.includes('{Pablo}'), 'las demás quedan sin llaves');

  const leido = desdeMarcado(marcado);
  t(leido.ocultas.length === 1, 'al releer hay un hueco');
  t(leido.palabras[leido.ocultas[0]].texto === 'Timoteo', 'y es la palabra correcta');
  t(serializar(leido.palabras, leido.ocultas) === marcado, 'la ida y vuelta es idéntica');
}

console.log('\n=== 4. Abrir un versículo ya sembrado ===');
/* Los 29 de 2 Corintios guardan texto_marcado con este formato. El editor
   tiene que abrirlos CON sus huecos puestos, no hacerlos rehacer. */
{
  const sembrado = 'Pablo apóstol de Jesucristo por la voluntad de Dios, y el hermano {Timoteo} a la iglesia de Dios que está en Corinto.';
  const e = editorDesde({ textoMarcado: sembrado });
  t(e.ocultas.length === 1, `un hueco (${e.ocultas.length})`);
  t(e.palabras[e.ocultas[0]].texto === 'Timoteo', 'apunta a Timoteo');

  const varios = 'Porque el Señor es el {Espíritu}, y donde está el {Espíritu} del Señor, allí hay {libertad}.';
  const e2 = editorDesde({ textoMarcado: varios });
  t(e2.ocultas.length === 3, `tres huecos (${e2.ocultas.length})`);
  t(e2.palabras[e2.ocultas[2]].texto === 'libertad', 'el tercero es libertad');

  // un versículo vacío o nuevo
  t(editorDesde({}).ocultas.length === 0, 'sin texto_marcado se abre vacío');
}

console.log('\n=== 5. Tope de 34: BLOQUEA ===');
/* El tope estaba escrito en el documento y no se aplicaba en ningún lado. */
{
  t(TOPE_HUECOS === 34, 'el tope es 34');
  const muchas = Array.from({ length: 40 }, () => ({ texto: 'palabra', espacio: ' ' }));
  const lleno = { palabras: muchas, ocultas: Array.from({ length: 34 }, (_, i) => i), historial: [] };
  t(!puedeOcultar(lleno.ocultas), 'con 34 ya no se puede ocultar más');

  const r = alternarHueco(lleno, 35);
  t(r.accion === 'tope', `intentar la 35 devuelve «tope» (${r.accion})`);
  t(r.estado.ocultas.length === 34, 'y NO se oculta: el estado queda igual');
  t(!r.estado.ocultas.includes(35), 'la palabra 35 no entra');

  t(puedeOcultar(new Array(33).fill(0)), 'con 33 todavía se puede');
}

console.log('\n=== 6. Deshacer de a uno, en orden inverso ===');
{
  let e = conTexto(editorVacio(), VERSICULO);
  e = alternarHueco(e, 0).estado;
  e = alternarHueco(e, 1).estado;
  e = alternarHueco(e, 2).estado;
  t(e.ocultas.length === 3, 'tres ocultas');

  const d1 = deshacer(e);
  t(d1.estado.ocultas.length === 2, 'deshacer quita UNA');
  t(!d1.estado.ocultas.includes(2), 'y quita la ÚLTIMA marcada, no otra');

  const d2 = deshacer(d1.estado);
  t(!d2.estado.ocultas.includes(1), 'el segundo deshacer quita la anterior');

  const d3 = deshacer(d2.estado);
  t(d3.estado.ocultas.length === 0, 'el tercero deja cero');
}

console.log('\n=== 7. Historial con tope de 10 ===');
{
  t(TOPE_DESHACER === 10, 'el tope es 10');
  let e = conTexto(editorVacio(), Array.from({ length: 20 }, (_, i) => `p${i}`).join(' '));
  for (let i = 0; i < 20; i++) e = alternarHueco(e, i).estado;
  t(pasosDeDeshacer(e) === 10, `guarda 10 pasos (${pasosDeDeshacer(e)})`);
  t(e.ocultas.length === 20, 'pero los 20 huecos siguen puestos');
}

console.log('\n=== 8. Deshacer sin historial no rompe ===');
{
  const e = conTexto(editorVacio(), VERSICULO);
  const r = deshacer(e);
  t(r.accion === 'nada', 'sin historial devuelve «nada»');
  t(r.estado.ocultas.length === 0, 'y el estado queda igual');
  t(deshacer(r.estado).accion === 'nada', 'deshacer dos veces seguidas tampoco rompe');
}

console.log('\n=== 9. Acentos y apóstrofos ===');
{
  const texto = "El Espíritu del Señor, y el día de hoy, no os unzáis; ¿qué compañerismo?";
  const e0 = conTexto(editorVacio(), texto);
  const iEspiritu = e0.palabras.findIndex(p => p.texto === 'Espíritu');
  const iDia = e0.palabras.findIndex(p => p.texto === 'día');
  t(iEspiritu >= 0 && iDia >= 0, 'encuentra palabras con tilde');

  const marcado = serializar(e0.palabras, [iEspiritu, iDia]);
  t(marcado.includes('{Espíritu}'), 'serializa con tilde');
  t(marcado.includes('{día}'), 'y la otra también');
  const leido = desdeMarcado(marcado);
  t(leido.palabras[leido.ocultas[0]].texto === 'Espíritu', 'la relee bien');
  t(unirPalabras(leido.palabras).endsWith('compañerismo?'), 'conserva el signo al final');
}

console.log('\n=== 10. Reescribir el texto conserva solo los huecos que valen ===');
/* Si el presentador reescribe el texto, marcar por índice dejaría tapada una
   palabra distinta de la que eligió. */
{
  let e = conTexto(editorVacio(), 'Uno dos tres');
  e = alternarHueco(e, 1).estado;          // oculta «dos»
  t(e.ocultas[0] === 1, 'oculta el índice 1');

  const igual = conTexto(e, 'Uno dos tres');
  t(igual.ocultas.length === 1, 'si el texto no cambia, el hueco se conserva');

  const cambiado = conTexto(e, 'Uno XXX tres');
  t(cambiado.ocultas.length === 0, 'si la palabra cambia, el hueco se suelta');
}

console.log('\n=== 11. Validación propia, sin cuatro respuestas ===');
/* `validarPregunta` exige exactamente 4 respuestas. Un versículo no tiene. */
{
  t(validarVersiculo({ referencia: '', texto: 'x', ocultas: [0] }) === 'Escribe la referencia del versículo.',
    'sin referencia, error claro');
  t(validarVersiculo({ referencia: '2 Co 1:1', texto: '', ocultas: [0] }) === 'Escribe el texto del versículo.',
    'sin texto, error claro');
  const sinHuecos = validarVersiculo({ referencia: '2 Co 1:1', texto: 'Uno dos', ocultas: [] });
  t(!!sinHuecos && sinHuecos.includes('al menos una'), 'sin huecos tampoco se guarda');
  t(validarVersiculo({ referencia: '2 Co 1:1', texto: 'Uno dos', ocultas: [1] }) === null,
    'con todo puesto, no hay error');
  const dentro = validarVersiculo({
    referencia: '2 Co 1:1', texto: 'Uno dos',
    ocultas: Array.from({ length: 35 }, (_, i) => i)
  });
  t(!!dentro && dentro.includes('34'), 'por encima del tope, avisa del tope');
}

console.log('\n=== 12. Lo que se manda a guardar ===');
{
  const e = editorDesde({ textoMarcado: 'Uno {dos} tres' });
  const envio = paraGuardar(e, '  2 Corintios 1:1  ');
  t(envio.textoMarcado === 'Uno {dos} tres', 'el texto_marcado va con llaves');
  t(envio.referencia === '2 Corintios 1:1', 'la referencia va sin espacios de sobra');
  t(!('opciones' in envio) && !('indiceCorrecto' in envio), 'y NO manda opciones: es un versículo');
}

console.log('\n=== 13. El resumen de huecos ===');
{
  const e = { palabras: [], ocultas: [0, 1], historial: [] };
  const r = resumenHuecos(e);
  t(r.huecos === 2 && r.tope === 34 && r.lleno === false, 'cuenta y compara con el tope');
  const lleno = resumenHuecos({ palabras: [], ocultas: new Array(34).fill(0), historial: [] });
  t(lleno.lleno === true, 'con 34 marca lleno');
}


/* ------------------------------------------------------------------ */
console.log('\n=== Volver a tocar una palabra tapada es DESHACER ===');

/* Lo pidio el usuario: ocultar una palabra y volver a tocarla no puede dejar
   dos pasos en la cuenta por un solo cambio. El toque de vuelta DESHACE. */
const base = editorDesde({ textoMarcado: 'Dios es amor' });
const uno = alternarHueco(base, 1);
t(uno.accion === 'oculto', 'el primer toque oculta');
t(pasosDeDeshacer(uno.estado) === 1, 'y deja un paso de deshacer');

const dos = alternarHueco(uno.estado, 1);
t(dos.accion === 'visible', 'el segundo toque en la MISMA palabra la destapa');
t(dos.estado.ocultas.length === 0, 'y no queda ninguna tapada');
t(pasosDeDeshacer(dos.estado) === 0,
  'y la cuenta VUELVE A CERO: el segundo toque deshace, no suma');

/* El defecto concreto: antes se empujaba al historial y quedaban dos pasos. */
t(pasosDeDeshacer(dos.estado) !== 2,
  'no quedan dos pasos por un solo cambio');

/* Con varias palabras encadenadas, cada vuelta deshace solo la suya. */
let e = editorDesde({ textoMarcado: 'Dios es amor' });
e = alternarHueco(e, 0).estado;
e = alternarHueco(e, 1).estado;
e = alternarHueco(e, 2).estado;
t(pasosDeDeshacer(e) === 3, 'tres palabras ocultas dejan tres pasos');
e = alternarHueco(e, 1).estado;
t(pasosDeDeshacer(e) === 2, 'destapar la del medio deja dos');
t(JSON.stringify(e.ocultas) === '[0,2]', 'y quedan tapadas la primera y la tercera');

/* Destapar algo que NO tapaste no gasta ni devuelve un paso: esas palabras
   vienen tapadas del versiculo guardado. */
const guardado = editorDesde({ textoMarcado: 'Dios {es} amor' });
const antes = pasosDeDeshacer(guardado);
const destapada = alternarHueco(guardado, 1);
t(destapada.accion === 'visible', 'una palabra que venia tapada se puede destapar');
t(pasosDeDeshacer(destapada.estado) === antes,
  'y no cambia la cuenta: no habia paso que deshacer');

/* Y deshacer sigue funcionando despues de una vuelta. */
let d = editorDesde({ textoMarcado: 'Dios es amor' });
d = alternarHueco(d, 2).estado;
d = alternarHueco(d, 0).estado;
d = alternarHueco(d, 0).estado;   // vuelta: deshace
t(pasosDeDeshacer(d) === 1, 'tras ocultar 2 y destapar 1, queda un paso');
const atras = deshacer(d);
t(atras.estado.ocultas.length === 0 || atras.accion === 'nada',
  'y deshacer sigue quitando el cambio que queda');

console.log('\n===============================');
console.log(` ${ok} correctas, ${fail} fallas`);
console.log('===============================');
process.exit(fail ? 1 : 0);
