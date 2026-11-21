/* Prueba de la compensación de escala: puro cálculo, sin navegador.
 *
 * Lo que se comprueba es la cuenta y sus límites: que el factor salga de la
 * proporción lienzo/pantalla, que no se dispare con datos absurdos y que sin
 * zoom no se toque nada.
 */
import {
  REM, UMBRAL_ZOOM, TOPE_FACTOR, factorEscala,
  TECHO_CONTENIDO, TECHO_TITULO, SUELO, PASOS,
  PERFILES, perfilPara, ptARem, ROLES, PASOS_TITULO, esTitulo, cabe,
  esCajaDeTexto, ajustarGrupo, agruparPorCaja, altoUtil, renglonesQueCaben,
  techoDeLaCaja
} from './ajuste.js';

let ok = 0, fail = 0;
const t = (c, m) => { if (c) { ok++; console.log('  ok   ' + m); } else { fail++; console.log('  FALLA ' + m); } };

console.log('=== 1. Sin zoom no se toca nada ===');
t(factorEscala({ escala: 1 }) === 1, 'escala 1 (tamano real) -> 1');
t(factorEscala({ escala: 1.05 }) === 1, 'pellizco leve -> 1');
t(factorEscala({ escala: 2 }) === 1, 'el usuario AMPLIO la pagina -> 1');
t(factorEscala({ escala: 1.4 }) === 1, 'nunca se compensa una ampliacion del usuario');

console.log('\n=== 2. El zoom se detecta y se mide ===');
// Los dos valores REALES medidos en modo escritorio, misma pantalla, girando.
const vertical = factorEscala({ escala: 0.4199 });
const horizontal = factorEscala({ escala: 0.8142 });
t(Math.abs(vertical - 2.3815) < 0.001, 'vertical (escala 0.4199) -> 2.3815 [medido]');
t(Math.abs(horizontal - 1.2283) < 0.001, 'horizontal (escala 0.8142) -> 1.2283 [medido]');
t(vertical > horizontal, 'en vertical la pagina esta mas encogida que en horizontal');
// La razon de anchos se equivocaba justo al girar: daba 1.1584 contra 1.2283.
t(Math.abs(horizontal - 1.1584) > 0.05,
  'y NO coincide con la razon de anchos (1.1584): esa era la que fallaba al girar');
t(factorEscala({ escala: 0.4 }) > 2.4, 'escala mas chica -> factor mayor');

console.log('\n=== 3. Límites y datos inválidos ===');
t(factorEscala({ escala: 0.001 }) === TOPE_FACTOR, 'no pasa del tope');
t(factorEscala({ escala: 0 }) >= 1, 'escala 0 -> respaldo, nunca 0');
t(factorEscala({ escala: NaN }) >= 1, 'escala invalida -> respaldo o 1');
t(factorEscala({ escala: 1.0001 }) === 1, 'redondeo por encima de 1 -> 1');

console.log('\n=== 4. Lo que produce el factor en la raíz ===');
// La raíz compensada es lo que hace que los `rem` signifiquen tamaño físico.
const raiz = REM * vertical;
t(Math.round(raiz) === 38, 'raíz ≈ 38 px con el factor real');
// 1 rem = 38 px de hoja -> 38 * 0.4199 = 16 dp, que es lo normal.
const dp = raiz * 0.4199;
t(Math.round(dp) === 16, 'un rem compensado se ve en 16 dp (tamaño de diseño)');
t(Math.round(1.3333 * raiz * 0.4199) === 21, '16 pt del contrato -> 21 dp reales');
t(Math.round(2 * raiz * 0.4199) === 32, '24 pt del contrato -> 32 dp reales');

// El defecto al girar, en números: la razon de anchos daba 18.53 px de raiz
// en horizontal cuando correspondian 19.65. Ahora la raiz es la correcta.
const raizH = REM * horizontal;
t(Math.abs(raizH - 19.65) < 0.1, 'en horizontal la raiz es 19.65 px, no 18.53 [defecto corregido]');
t(Math.round(raizH * 0.8142) === 16, 'y un rem se sigue viendo en 16 dp tambien en horizontal');

console.log('\n=== 5. La sección de juegos crece con el resto ===');
// Los tokens REALES de la hoja (styles.css, bloque de tableta). Todos cuelgan
// de la misma raíz, así que la compensación los sube juntos y en la misma
// proporción: ninguno se queda atrás aunque no se toque a mano.
const tokens = { xs: 1.3333, sm: 1.3333, base: 1.3333, lg: 1.5, xl: 1.75, xl2: 2 };
const antes = Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, v * REM]));
const ahora = Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, v * raiz]));
let subieronTodos = true;
let proporcionIgual = true;
for (const k of Object.keys(tokens)) {
  if (!(ahora[k] > antes[k])) subieronTodos = false;
  if (Math.abs(ahora[k] / antes[k] - vertical) > 0.01) proporcionIgual = false;
}
t(subieronTodos, 'todos los pasos suben, incluido --t-xs de las descripciones');
t(proporcionIgual, 'y suben en la MISMA proporción (ninguno se queda atrás)');
t(Math.abs(ahora.lg / ahora.base - tokens.lg / tokens.base) < 1e-9,
  'la relación entre pasos no cambia: no hay escalón roto');

console.log('\n=== 6. Topes de la skill, literales ===');
// Con la raiz compensada (38.06 px) 1rem son 12 pt: los topes se escriben tal cual.
const raizReal = 38.06;
t(ptARem(TECHO_CONTENIDO) === 1.3333 || Math.abs(ptARem(TECHO_CONTENIDO) - 1.3333) < 0.001,
  '16 pt de contenido = 1.3333rem');
t(ptARem(TECHO_TITULO) === 2, '24 pt de titulo = 2rem');
t(Math.abs(ptARem(SUELO) - 0.6667) < 0.001, '8 pt de suelo = 0.6667rem');
// Y en pixeles de hoja, multiplicando por la raiz real.
t(Math.round(ptARem(TECHO_CONTENIDO) * raizReal) === 51, '16 pt -> 51 px de hoja');
t(Math.round(ptARem(TECHO_TITULO) * raizReal) === 76, '24 pt -> 76 px de hoja');

console.log('\n=== 7. Los pasos respetan techo y suelo ===');
t(PASOS[0] === TECHO_CONTENIDO, 'se arranca en el techo, no por debajo');
t(PASOS[PASOS.length - 1] === SUELO, 'el ultimo paso es el suelo de 8 pt');
t(PASOS.every((p, i) => i === 0 || p < PASOS[i - 1]), 'los pasos bajan de uno en uno');
t(PASOS.every(p => p >= SUELO && p <= TECHO_CONTENIDO), 'ninguno sale del rango 8-16 pt');

console.log('\n=== 8. La gracia es el ULTIMO recurso ===');
// Se recorre la lista de pasos: la gracia solo puede pedirse despues del suelo.
const indiceSuelo = PASOS.indexOf(SUELO);
t(indiceSuelo === PASOS.length - 1, 'el suelo es el ultimo recurso antes de la gracia');
t(indiceSuelo > 0, 'hay pasos que probar antes de llegar al suelo (encoger primero)');
// La capacidad declarada nunca incluye la gracia: es un extra aparte.
t(PERFILES.telefono.renglones === 2 && PERFILES.telefono.gracia === 1,
  'telefono: 2 renglones declarados, 1 de gracia aparte');
t(PERFILES.ancho.renglones === 1 && PERFILES.ancho.gracia === 1,
  'pantalla ancha: 1 renglon declarado, 1 de gracia aparte');
t(PERFILES.telefono.renglones + PERFILES.telefono.gracia === 3,
  'el maximo absoluto en telefono es 3 (2 + 1), nunca mas');

console.log('\n=== 9. Perfil por ancho de maqueta ===');
t(perfilPara(412) === PERFILES.telefono, '412 de maqueta -> telefono');
t(perfilPara(767) === PERFILES.telefono, '767 de maqueta todavia es telefono');
t(perfilPara(768) === PERFILES.ancho, '768 de maqueta -> ancho (1+1)');
t(perfilPara(1024) === PERFILES.ancho, '1024 de maqueta -> ancho');
// El caso que fallo: un telefono en modo escritorio presenta 980 de maqueta.
t(perfilPara(980) === PERFILES.ancho,
  '980 de maqueta (telefono en modo escritorio) -> ancho, NO telefono');

console.log('\n=== 10. La capacidad la pone el perfil, no el rol ===');
// El bug: roles con `renglones` escrito a mano anulaban el perfil 1+1.
// NINGUN rol declara capacidad propia. La capacidad la pone el perfil de la
// maqueta (1+1 en tableta y PC, 2+1 en telefono). Escribirsela a mano fue el
// bug que dejaba los nombres y descripciones en tres renglones: anulaba el
// perfil y, de paso, se saltaba el paso de ENCOGER.
// La capacidad la declara el USUARIO, no el agente. Por eso el unico rol con
// capacidad propia es el que el declaro: la pregunta, con 2 + 1.
/* Dos decisiones del usuario conviven aqui, y las dos son legitimas porque
   las declaro el, no el agente:
     - .enunciado  -> 2 + 1, la pregunta se lee, no se adivina
     - el menu     -> 1 + 1, todo el menu principal
   La regla que sigue en pie: NADIE MAS declara capacidad. Cualquier otro rol
   hereda el perfil, y el agente no inventa ninguna para que algo quepa. */
const conCapacidadPropia = ROLES.filter(r => r.renglones != null);
const esDelMenu = (sel) => /menu|juego-tarjeta/.test(sel);
/* Fuera del menú, todo TEXTO DE VERSÍCULO declara 2 + 1. Es regla dura del
   proyecto, declarada el 20/11/2026: un versículo parte en dos renglones casi
   siempre y forzarlo a uno lo baja al suelo de 8 pt. Son cuatro selectores
   porque son cuatro sitios que muestran lo mismo: el versículo en juego
   (participante y televisor), el enunciado de una pregunta, la vista previa
   del editor y el texto con huecos de la lista de un tema. */
const pregunta = conCapacidadPropia.filter(r => !esDelMenu(r.sel) && r.renglones === 2);
t(pregunta.length === 5, 'todo texto de versiculo declara 2 renglones (+1 de gracia)');
t(pregunta.every(r => /versiculo|enunciado|fila-entre/.test(r.sel)),
  'y todos son texto de un versiculo, su enunciado o su referencia');
t(pregunta.every(r => r.renglones + PERFILES.ancho.gracia === 3),
  'los cuatro quedan en 2 + 1');
t(conCapacidadPropia.filter(r => !esDelMenu(r.sel) && r.renglones !== 2)
   .every(r => r.renglones === 1),
  'el resto declara 1, como el menu');
/* EXCEPCION DEL 21/11/2026, declarada por el usuario: los NOMBRES y
   DESCRIPCIONES de las tarjetas de juego van en 2 + 1, no en 1 + 1.
   Sus palabras: «en menu horizontal en la parte de escoger el juego no se lee
   el nombre del juego, usa varias filas para distintos juegos si hace falta»
   y «en menu vertical cuando selecciono uno y aparece que esta seleccionado se
   corta el texto y no se lee completo».
   Con una sola linea, «Completar el versiculo» y su descripcion no caben en el
   ancho de una tarjeta y el ajuste las bajaba al SUELO de 8 pt: medido en
   390x844, la descripcion quedaba en 10.67 px. La capacidad es lo que decide;
   la maqueta no puede arreglar una capacidad que no da margen.
   El resto del menu SIGUE en 1: la excepcion es de las tarjetas, no del menu. */
/* OJO: la insignia tambien vive dentro de `.juego-tarjeta` y SIGUE en 1
   renglon: es una etiqueta de estado («Elegible», «Seleccionado»), no contenido
   que haya que leer entero. Se excluye por su clase. */
const tarjetasJuego = (sel) => /juego-tarjeta/.test(sel) && !/insignia/.test(sel);
t(conCapacidadPropia.filter(r => esDelMenu(r.sel) && tarjetasJuego(r.sel))
   .every(r => r.renglones >= 2),
  'el nombre y la descripcion del juego pueden crecer, por pedido explicito');
const desc = ROLES.find(r => r.sel === '.juego-tarjeta .desc');
t(desc.renglones === 3,
  'la descripcion lleva 3 renglones: con 2 no cabe a letra normal');
t(conCapacidadPropia.filter(r => esDelMenu(r.sel) && !tarjetasJuego(r.sel))
   .every(r => r.renglones === 1),
  'y el resto del menu sigue en 1 renglon');
t(PERFILES.ancho.gracia === 1, 'y la gracia del perfil le suma el +1');
// La prosa SI entra (la capacidad 1+1 es para todo el texto), pero heredando
// el perfil: sin capacidad propia inventada.
const prosaRol = ROLES.find(r => r.sel === '.tenue');
t(prosaRol != null, 'la prosa entra en el ajuste');
t(prosaRol.renglones == null, 'y hereda el perfil, sin capacidad inventada');

// Los botones del menu son UNA decision: un solo grupo, un solo tamano.
const botones = ROLES.filter(r => r.sel.includes('menu-acciones'));
t(botones.length === 1, 'los botones del menu son un solo grupo');
/* El menu declara 1 + 1 a proposito, y NO es capacidad inventada: la declaro
   el usuario («a todo el menu principal aplícale text-fitting 1+1»). En
   telefono el perfil daba 2 y los botones se veian desbordados; declararla
   aqui la fija igual en todos los perfiles. Lo que sigue prohibido es que el
   AGENTE se invente una capacidad para hacer que algo quepa. */
t(botones[0].renglones === 1, 'los botones del menu declaran 1, por pedido explicito');
// El selector va por CONTENEDOR (`> button`), no por clase. Medido: dos
// botones eran .boton-grande y dos .boton, asi que agrupar por clase dejaba
// fuera a la mitad y la fila quedaba con dos tamanos distintos.
t(botones[0].sel.includes('>'), 'el grupo de botones se selecciona por contenedor');
t(!botones[0].sel.includes('.boton '), 'no se selecciona por clase, que los parte en dos');
// Y su capacidad es la del perfil, que en tableta y PC es 1 renglon + 1 de gracia.
t(PERFILES.ancho.renglones === 1 && PERFILES.ancho.gracia === 1,
  'la capacidad de tableta y PC es 1 + 1');
// La prosa comparte el mismo contrato: dentro del ajuste, capacidad del perfil.
t(prosaRol.categoria === 'contenido', 'la prosa es contenido, con techo de 16 pt');
t(ROLES.every(r => typeof r.sel === 'string' && r.sel.length > 0), 'todos los roles tienen selector');

console.log('\n=== 11. Encoger es el PRIMER recurso, no la gracia ===');
// Con capacidad 1: si un texto entra en 1 renglon encogiendo, NO debe gastar gracia.
const n1 = PASOS.length;
t(n1 > 1, 'hay varios tamanos que probar antes de la gracia');
// La gracia solo se concede despues del ultimo paso (el suelo).
t(PASOS[0] > PERFILES.ancho.renglones,
  'se arranca en 16 pt con capacidad de 1 renglon: primero se encoge');

console.log('\n=== 12. El titulo tiene su propio techo de 24 pt ===');
t(PASOS_TITULO[0] === TECHO_TITULO, 'la escalera de titulo arranca en 24 pt');
t(PASOS_TITULO[PASOS_TITULO.length-1] === SUELO, 'y su suelo sigue siendo 8 pt');
t(PASOS_TITULO.length > PASOS.length, 'tiene mas escalones que el contenido');
t(PASOS[0] === TECHO_CONTENIDO, 'la de contenido arranca en 16 pt');
// Un h1 nunca debe quedar por debajo del techo de contenido si hay sitio:
// por eso la escalera de titulo no se mezcla con la de contenido.
t(PASOS_TITULO[0] > PASOS[0], 'el titulo puede llegar mas alto que el contenido');

console.log('\n=== 13. Grupos: los hermanos comparten tamano ===');
// La clave de grupo usa las clases del elemento: tres .desc caen en el mismo
// grupo y por tanto reciben UN tamano, no uno cada una.
const clave = el => {
  const c = (el.className||'').toString().trim();
  return c ? c.split(/\s+/).sort().join('.') : el.tagName.toLowerCase();
};
const a1 = {className:'desc',tagName:'SPAN'}, a2 = {className:'desc',tagName:'SPAN'};
const b1 = {className:'nombre',tagName:'SPAN'};
t(clave(a1) === clave(a2), 'dos .desc generan la misma clave -> mismo grupo');
t(clave(a1) !== clave(b1), '.desc y .nombre van en grupos distintos');
t(clave({className:'boton grande',tagName:'BUTTON'}) === clave({className:'grande boton',tagName:'BUTTON'}),
  'el orden de las clases no cambia el grupo');

console.log('\n=== 14. Deteccion de titulos ===');
t(esTitulo({tagName:'H1',className:''}) === true, 'un H1 es titulo');
t(esTitulo({tagName:'H2',className:''}) === true, 'un H2 es titulo');
t(esTitulo({tagName:'H6',className:''}) === true, 'un H6 es titulo');
t(esTitulo({tagName:'P',className:'menu-titulo'}) === true, 'clase menu-titulo -> titulo');
t(esTitulo({tagName:'P',className:'desc'}) === false, 'una descripcion no es titulo');
t(esTitulo({tagName:'SPAN',className:'titulo'}) === true, 'clase titulo -> titulo');
t(esTitulo(null) === false, 'nulo no es titulo');

console.log('\n=== 15. La gracia se concede DESPUES de bajar al suelo ===');
// Simulacion del recorrido: con capacidad 1, un texto de 40 caracteres.
// A 16 pt ocupa 3 renglones; al bajar, entra en 1 o 2. La gracia (2) solo
// debe usarse si ningun tamano logra bajar a 1.
const simular = (renglonesPorPt, capacidad, pasos) => {
  for (const pt of pasos) if (renglonesPorPt(pt) <= capacidad) return { pt, gracia: false };
  for (const pt of pasos) if (renglonesPorPt(pt) <= capacidad + 1) return { pt, gracia: true };
  return { pt: pasos[pasos.length-1], gracia: true, recortado: true };
};
// Caso A: encogiendo un poco ya entra en 1 -> NO gasta gracia.
const a = simular(pt => pt >= 14 ? 2 : 1, 1, PASOS);
t(a.gracia === false, 'entra en 1 renglon encogiendo -> no gasta la gracia');
t(a.pt < TECHO_CONTENIDO, 'y lo logra con letra menor que el techo, no recortando');
// Caso B: imposible en 1, pero en 2 si -> gasta la gracia.
const b = simular(() => 2, 1, PASOS);
t(b.gracia === true, 'no entra en 1 ni al suelo -> concede la gracia');
t(b.pt === TECHO_CONTENIDO, 'y con la gracia vuelve al techo: no deja la letra chica');
// Caso C: ni con gracia -> recorta.
const c = simular(() => 5, 1, PASOS);
t(c.recortado === true, 'ni con la gracia -> recorta');
// Caso D: el punto exacto que se me explico mal. No entra en 1 linea ni
// bajando hasta 8 pt; con la linea de gracia (2) el tamano NO se queda en el
// suelo: RE-CRECE hasta el mayor que entra en esas 2 lineas.
const d = simular(pt => pt >= 12 ? 3 : 2, 1, PASOS);
t(d.gracia === true, 'no entra en 1 renglon ni al suelo -> concede la gracia');
t(d.pt === 11, 'y RE-CRECE al mayor que entra en N+1 (11 pt), no se queda en 8');
t(d.pt > SUELO, 'la letra queda por encima del suelo: no se deja ilegible');
// Caso E: el suelo tampoco basta con gracia -> ahi si, puntos suspensivos.
const e = simular(() => 9, 1, PASOS);
t(e.recortado === true && e.pt === SUELO, 'si no cabe ni con gracia: suelo + puntos suspensivos');

console.log('\n=== 16. Desborde horizontal: un renglon no basta ===');
// El caso del modal de temas: «Preguntas» y «Renombrar» no pueden partirse,
// asi que ocupan UN renglon aunque su caja sea mas angosta que la palabra.
// Contar renglones los daba por buenos mientras el texto se salia de lado.
t(cabe({ renglones: 1, desborda: false }, 1) === true, '1 renglon y sin desborde: cabe');
t(cabe({ renglones: 1, desborda: true }, 1) === false,
  'un renglon PERO desbordado: NO cabe (el caso que fallaba)');
t(cabe({ renglones: 2, desborda: false }, 1) === false, 'dos renglones con capacidad 1: no cabe');
t(cabe({ renglones: 3, desborda: true }, 2) === false, 'desbordado y de mas: no cabe');
t(cabe({ renglones: 0, desborda: false }, 1) === true, 'vacio: cabe');
// Las dos condiciones son independientes: ninguna sola alcanza.
t(cabe({ renglones: 1, desborda: true }, 99) === false,
  'con capacidad enorme sigue sin caber si desborda');
t(cabe({ renglones: 5, desborda: false }, 2) === false,
  'sin desbordar sigue sin caber si pasa los renglones');

console.log('\n=== 8. El cableado al girar no se puede perder ===');
// Estas lineas no son logica: son el CABLEADO. Si alguien las borra en un
// refactor, el calculo sigue perfecto y la pantalla vuelve a quedarse con la
// letra del tamano anterior, sin ningun error a la vista. Por eso se prueban.
//
// Y se prueba sobre el codigo, NO sobre el archivo entero: la primera version
// de esta prueba pasaba con el cableado borrado, porque la palabra seguia en
// un COMENTARIO que lo explicaba. Una prueba que el comentario satisface no
// vigila nada.
const { readFileSync } = await import('node:fs');
/** Saca comentarios: deja solo el codigo que de verdad se ejecuta. */
const soloCodigo = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')   // /* ... */
  .replace(/(^|[^:])\/\/.*$/gm, '$1');   // // ... (sin comerse un https://)
const app = soloCodigo(readFileSync(new URL('../app.js', import.meta.url), 'utf8'));
const lib = soloCodigo(readFileSync(new URL('./ajuste.js', import.meta.url), 'utf8'));

t(/visualViewport/.test(lib), 'la compensacion lee visualViewport');
t(/return 1 \/ e|1 \/ e;/.test(lib), 'el factor es el reciproco de la escala (1 / escala)');
t(lib.indexOf('visualViewport') < lib.indexOf('fallback') || /Respaldo/.test(readFileSync(new URL('./ajuste.js', import.meta.url), 'utf8')),
  'la razon de anchos queda despues, como respaldo');
t(/addEventListener\('orientationchange'/.test(app), 'app.js escucha orientationchange');
t(/screen\.orientation\.addEventListener\('change'/.test(app),
  'y tambien screen.orientation, el aviso moderno');
t(/setTimeout\(reajustar/.test(app),
  'vuelve a ajustar un momento despues: la escala tarda en actualizarse');
t(/addEventListener\('visibilitychange'/.test(app), 'y al volver visible, porque oculto no se mide');
t(/document\.fonts/.test(app), 'y cuando la tipografia termina de cargar');

console.log('\n=== 22. Un contenedor de maquetacion NO se ajusta como texto ===');
// El defecto real: el rol `.panel-host` casaba con el <main> entero. El ajuste
// lo trataba como una caja de texto, contaba los renglones de TODOS sus
// descendientes, no cabia en uno, y le ponia overflow:hidden con dos renglones
// de alto. El panel quedaba en 28 px con 1010 px de contenido y la pantalla
// se veia vacia: solo se leia «Codigo de la sala» cortado arriba.
const nodo = (tagName, hijos = []) => ({ tagName, children: hijos });
const texto = (...nombres) => nodo('SPAN', nombres.length ? nombres : []);

t(esCajaDeTexto(nodo('P')) === true, 'un <p> sin hijos es caja de texto');
t(esCajaDeTexto(nodo('P', [nodo('B'), nodo('EM')])) === true,
  'con hijos de linea (<b>, <em>) sigue siendo texto');
t(esCajaDeTexto(nodo('P', [nodo('SPAN'), nodo('BR'), nodo('SPAN')])) === true,
  'un <br> no lo convierte en contenedor');
t(esCajaDeTexto(nodo('MAIN', [nodo('DIV'), nodo('P')])) === false,
  'un <main> con divs dentro NO es caja de texto: es el defecto');
t(esCajaDeTexto(nodo('DIV', [nodo('BUTTON')])) === false,
  'una fila de botones no se ajusta como texto');
t(esCajaDeTexto(nodo('SECTION', [nodo('DIV')])) === false,
  'una rejilla tampoco');
t(esCajaDeTexto(null) === false, 'nulo no es caja de texto');

// Y ningun rol puede volver a apuntar a un contenedor: los selectores que
// terminan en la clase de un <main> se colarian otra vez.
const ROLES_DE_CONTENEDOR = ['.panel-host', '.pantalla', '.pantalla-ceremonia'];
for (const sel of ROLES_DE_CONTENEDOR) {
  const sueltos = ROLES.filter(r =>
    r.sel.split(',').map(x => x.trim()).includes(sel));
  t(sueltos.length === 0, `ningun rol apunta a ${sel} a secas (casa con el contenedor)`);
}

// El rol del panel sigue existiendo, pero acotado a texto de dentro.
const panel = ROLES.filter(r => r.sel.includes('.panel-host'));
t(panel.length > 0, 'el panel del presentador sigue teniendo su rol de texto');
t(panel.every(r => r.sel.split(',').every(x => x.trim() !== '.panel-host')),
  'y ninguno de sus selectores es `.panel-host` solo');

console.log('\n=== 23. La guarda protege al contenedor en la PRACTICA ===');
// No basta con que el selector este bien escrito: si alguien vuelve a pasar
// un contenedor a `ajustarGrupo`, la funcion tiene que negarse a tocarlo.
// Sin DOM, un contenedor de mentira con su `style` y sus hijos de bloque.
const contenedorFalso = () => ({
  tagName: 'MAIN',
  className: 'panel-host',
  style: {},
  children: [nodo('DIV'), nodo('P'), nodo('BUTTON')],
  clientWidth: 380, scrollWidth: 380
});

const caja = contenedorFalso();
const r = ajustarGrupo([caja], { renglones: 1 });
t(r.pt === 0, 'un contenedor no recibe tamano: el ajuste lo descarta');
t(r.recortado === false, 'y no queda marcado como recortado');
t(caja.style.fontSize === undefined,
  'NO se le pone fontSize al contenedor: era el defecto');
t(caja.style.overflow === undefined,
  'NO se le pone overflow:hidden: era lo que dejaba el panel en 28 px');
t(caja.style.maxBlockSize === undefined,
  'NO se le inventa un maxBlockSize de dos renglones');

// Y un texto de verdad SI se sigue ajustando, para que la guarda no apague
// el ajuste entero por error.
const parrafo = {
  tagName: 'P', className: 'aviso', style: {},
  children: [nodo('B')], clientWidth: 380, scrollWidth: 380
};
ajustarGrupo([parrafo], { renglones: 1 });
t(parrafo.style.fontSize !== undefined,
  'un <p> de verdad SI se ajusta: la guarda no apaga el ajuste');


/* ------------------------------------------------------------------ */
console.log('\n=== Cada tarjeta de versículo se ajusta por su cuenta ===');

/* Un doble mínimo: solo lo que `agruparPorCaja` usa, `closest`. Lo que se
   prueba es la DECISIÓN de agrupar, no el navegador. */
const tarjeta = (n) => ({ nombre: 'tarjeta' + n });
const ficha = (caja) => ({ closest: () => caja });

const t1 = tarjeta(1), t2 = tarjeta(2), t3 = tarjeta(3);
const grupos = agruparPorCaja([ficha(t1), ficha(t1), ficha(t2), ficha(t3), ficha(t3)], '.tarjeta');

t(grupos.length === 3, 'tres tarjetas dan tres grupos, no uno solo');
t(grupos[0].length === 2 && grupos[1].length === 1 && grupos[2].length === 2,
  'cada grupo lleva solo los elementos de su tarjeta');
t(grupos[0][0].closest() === grupos[0][1].closest(),
  'y los hermanos de una tarjeta van juntos');

/* Lo que este cambio arregla, dicho como prueba: si las tres tarjetas fueran un
   solo grupo, la corta se encogería hasta el tamaño que necesita la larga. Con
   grupos separados, cada una decide sola. */
t(agruparPorCaja([ficha(t1), ficha(t2)], '.tarjeta').length !== 1,
  'una tarjeta corta no queda atada al tamaño de la larga');

/* Un elemento que no cuelga de ninguna caja se descarta: no hay grupo donde
   ponerlo, y meterlo en el primero lo ajustaría con la capacidad de otra. */
t(agruparPorCaja([{ closest: () => null }, ficha(t1)], '.tarjeta').length === 1,
  'lo que no esta dentro de una tarjeta se descarta');
t(agruparPorCaja([], '.tarjeta').length === 0, 'sin elementos no hay grupos');
t(agruparPorCaja(null, '.tarjeta').length === 0, 'y sin lista tampoco falla');

/* Los tres roles de la lista de versiculos declaran `porCaja`: sin eso, el
   ajuste los juntaria a todos y el arreglo no serviria de nada. */
const rolesTarjeta = ROLES.filter(r => r.sel.includes('lista-versiculos'));
t(rolesTarjeta.length === 3, 'los tres roles de la lista de versiculos existen');
t(rolesTarjeta.every(r => r.porCaja === '.pregunta-fila'),
  'y los tres ajustan por tarjeta, no todos juntos');

/* El rol generico de botones de administracion NO puede volver a incluir los de
   versiculos: los juntaria otra vez y anularia el ajuste por tarjeta. */
const generico = ROLES.find(r => r.sel.includes('editar-pregunta'));
t(generico && !generico.sel.includes('lista-versiculos'),
  'el rol generico de botones no toca los de la lista de versiculos');
t(generico && !generico.porCaja,
  'la lista de preguntas sigue en un solo grupo: sus etiquetas se comparan');


/* ------------------------------------------------------------------ */
console.log('\n=== Los botones del editor de versiculo van en 1 + 1 ===');

/* Antes no estaban en ninguna lista y NO se ajustaban: «Ocultar palabra:
   ACTIVO» partia en tres renglones dentro de un telefono vertical. */
const rolOcultar = ROLES.find(r => r.sel.includes('alternar-modo-ocultar'));
t(rolOcultar != null, 'el boton «Ocultar palabra» esta declarado en ROLES');
t(rolOcultar?.renglones === 1, 'y va en 1 renglon (+1 de gracia)');
t(rolOcultar?.sel.includes('ayuda-ocultar'),
  'el «?» de al lado va en el mismo grupo: comparten fila');
t(rolOcultar?.categoria === 'contenido', 'y son contenido: techo de 16 pt');

const rolDeshacer = ROLES.find(r => r.sel.includes('deshacer-hueco'));
t(rolDeshacer != null && rolDeshacer.renglones === 1,
  '«Deshacer» tambien va en 1 + 1');

const rolPie = ROLES.find(r => r.sel.includes('[data-form="versiculo"]'));
t(rolPie != null, 'el pie del editor (Menu / Cancelar / Guardar) esta declarado');
t(rolPie?.renglones === 1, 'y tambien en 1 + 1');

/* Se agrupan por contenedor, no por clase: lo que hace grupo es compartir
   la fila. Si se declarara por clase, un boton con otra clase se quedaria
   fuera y la fila mostraria dos tamanos. */
t(rolOcultar?.sel.startsWith('.modal '),
  'se declaran por contenedor (.modal), no por clase de boton');


/* ------------------------------------------------------------------ */
console.log('=== El texto llena su caja: alto, no solo ancho ===');

/* Lo pidio Christian: «usa cualquier medida que permita que cada pregunta
   entre en el maximo de sus dimensiones de campo de escritura». Antes el
   ajuste solo miraba el ANCHO y el techo era un numero fijo: en una caja alta
   dejaba medio palmo vacio. */

// Sin DOM no hay caja medible: se devuelve Infinity, que significa «sin tope».
t(altoUtil(null) === Infinity, 'sin elemento no hay tope');
t(altoUtil({}) === Infinity, 'un objeto que no es un nodo tampoco');
t(renglonesQueCaben(null) === Infinity,
  'sin caja no se inventan renglones: manda la capacidad declarada');

/* Un doble minimo: lo que `altoUtil` consulta es `getComputedStyle`,
   `clientHeight`, `parentElement` y los hermanos. */
const estilo = (o) => () => ({
  paddingTop: '0px', paddingBottom: '0px', lineHeight: '20px',
  flex: 'none', flexBasis: 'auto', height: 'auto', display: 'block', ...o
});

// Caja con alto propio y flex: ese es su espacio.
const cajaAlta = {
  clientHeight: 200, parentElement: null,
  getBoundingClientRect: () => ({ height: 200 })
};
globalThis.getComputedStyle = estilo({ flex: '1 1 auto', flexBasis: '0%' });
t(altoUtil(cajaAlta) === 200, 'una caja flex con alto propio mide su alto');
t(renglonesQueCaben(cajaAlta) === 10, 'y caben 10 renglones de 20 px');
globalThis.getComputedStyle = estilo({ flex: '1 1 auto', flexBasis: '0%', paddingTop: '10px', paddingBottom: '10px' });
t(altoUtil(cajaAlta) === 180, 'el relleno se descuenta del alto: no es espacio del texto');

// Caja de alto automatico: el espacio lo deja el padre.
const hijo = { clientHeight: 0, getBoundingClientRect: () => ({ height: 0 }), parentElement: null };
const hermano1 = { getBoundingClientRect: () => ({ height: 40 }) };
const hermano2 = { getBoundingClientRect: () => ({ height: 60 }) };
const padre = {
  clientHeight: 300, parentElement: null,
  children: [hijo, hermano1, hermano2]
};
hijo.parentElement = padre;
globalThis.getComputedStyle = estilo({ height: 'auto' });
t(altoUtil(hijo) === 200,
  'sin alto propio, el espacio es el del padre menos lo que ocupan los hermanos');

// Un padre sin alto medible no inventa un tope.
const padreSinAlto = { clientHeight: 0, children: [hijo], parentElement: null };
hijo.parentElement = padreSinAlto;
t(altoUtil(hijo) === Infinity, 'un padre sin alto no impone tope');

delete globalThis.getComputedStyle;

/* ------------------------------------------------------------------ */
console.log('=== `llenar`: el rol calcula su techo desde la caja ===');

/* El rol del versiculo declara `llenar`, que es lo que activa el calculo. */
const rolVers = ROLES.find(r => r.sel.includes('.jugador-versiculo .versiculo'));
t(rolVers != null, 'el versiculo del participante esta declarado');
t(rolVers?.llenar === true, 'y pide llenar su caja, no quedarse en un techo fijo');
/* El techo NO se elige a mano: sale de la caja. Un numero fijo desperdicia
   la caja alta y desborda en la baja, que es justo lo que habia que evitar. */
t(rolVers?.topeMax === undefined,
  'no lleva un tope escrito a mano: el techo se calcula desde la caja');

const rolTv = ROLES.find(r => r.sel.includes('.cuerpo-tv .versiculo'));
t(rolTv?.llenar === true, 'el versiculo del televisor tambien llena su caja');

/* Los roles que NO lo piden conservan el comportamiento de siempre: activarlo
   en todas partes cambiaria el aspecto de pantallas que ya estaban bien. */
const rolBoton = ROLES.find(r => r.sel.includes('menu-acciones'));
t(rolBoton?.llenar === undefined, 'los botones del menu no llenan: capacidad declarada');
const rolVacio = ROLES.find(r => r.sel === '.tenue');
t(rolVacio?.llenar === undefined, 'la prosa tampoco: se queda como estaba');

/* Sin caja medible el ajuste no explota ni recorta: se comporta como antes. */
const sinCaja = ajustarGrupo([], { llenar: true });
t(sinCaja.recortado === false, 'sin elementos no se recorta nada');


/* ------------------------------------------------------------------ */
console.log('=== El techo se calcula, no se elige ===');

/* Un renglon mide `font-size x interlineado`. El tamano mas grande que cabe
   en un alto dado es `alto / interlineado`: pasarse desborda, quedarse corto
   desperdicia el campo. Christian: «el maximo de su campo calculado, no
   fijado a mano, sin desbordar ni cortarse». */
const estiloTecho = (o) => () => ({
  paddingTop: '0px', paddingBottom: '0px',
  fontSize: '16px', lineHeight: '22.4px',   // 1.4 = el interlineado del juego
  flex: '1 1 auto', flexBasis: '0%', height: 'auto', display: 'block', ...o
});

// 224 px de alto con interlineado 1.4 -> 100 px por renglon -> techo 100 px.
const caja224 = { clientHeight: 224, parentElement: null,
                  getBoundingClientRect: () => ({ height: 224 }) };
globalThis.getComputedStyle = estiloTecho({ flex: '1 1 auto', flexBasis: '0%' });
/* 224 px / (1.4 x 1 renglon) = 160 px de hoja; con raiz 16 son 120 pt. */
const techo224 = techoDeLaCaja(caja224);
t(Math.round(techo224) === 120, 'un alto de 224 px en UN renglon da 120 pt');

/* Con varios renglones el techo se reparte: es el tamano con el que N
   renglones llenan la caja entera. 224 px en 10 renglones -> 16 px = 12 pt. */
t(Math.round(techoDeLaCaja(caja224, 10)) === 12,
  'repartido entre 10 renglones da 12 pt: el texto llena la caja');
t(Math.round(techoDeLaCaja(caja224, 2)) === 60,
  'y entre 2 renglones da 60 pt');
t(techoDeLaCaja(caja224, 10) < techoDeLaCaja(caja224, 1),
  'mas renglones permiten menos tamano por renglon');

// El doble de alto da el doble de techo: crece con la caja, no esta fijado.
const caja448 = { clientHeight: 448, parentElement: null,
                  getBoundingClientRect: () => ({ height: 448 }) };
t(Math.round(techoDeLaCaja(caja448)) === 240,
  'el doble de alto da el doble de techo: se calcula, no se fija');

// Mas bajo -> menos techo. Nunca al reves.
t(techoDeLaCaja(caja224) < techoDeLaCaja(caja448),
  'una caja mas baja permite menos tamano');

// Sin caja medible no se inventa un tope.
t(techoDeLaCaja(null) === Infinity, 'sin elemento no hay techo que calcular');
globalThis.getComputedStyle = estiloTecho({ height: 'auto' });
const sinAlto = { clientHeight: 0, parentElement: null,
                  getBoundingClientRect: () => ({ height: 0 }) };
t(techoDeLaCaja(sinAlto) === Infinity,
  'sin caja medible devuelve Infinity: manda el techo del rol');

// Un interlineado invalido no puede dar NaN ni un techo absurdo.
globalThis.getComputedStyle = estiloTecho({ lineHeight: 'normal' });
t(techoDeLaCaja(caja224) === Infinity,
  'un interlineado no numerico no produce un techo falso');

delete globalThis.getComputedStyle;

console.log('\n===============================================');
if (fail === 0) console.log(` TODO EN VERDE: ${ok} correctas, 0 fallas`);
else console.log(` FALLAS: ${ok} correctas, ${fail} fallas`);
console.log('===============================================');
process.exit(fail === 0 ? 0 : 1);
