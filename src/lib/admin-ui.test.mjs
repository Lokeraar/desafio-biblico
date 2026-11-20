/* Prueba de la interfaz de administración: puro texto, sin navegador.
   Se centra en lo que puede romperse en silencio: la validación de una
   pregunta y el escapado de datos que vienen de la base. */
import {
  validarPregunta, selectorTema, modalClave, modalCambiarClave,
  modalTemas, modalPreguntas, modalFormPregunta, vistaConfig,
  modalVersiculos, modalEditorVersiculo,
  palabrasMarcadas, contadorHuecos, globoAyuda
} from './admin-ui.js';
import { readFileSync } from 'node:fs';
import { palabrasDe, conTexto, alternarHueco, editorDesde } from './editor-versiculo.js';

let ok = 0, fail = 0;
const t = (c, m) => { if (c) { ok++; console.log('  ok   ' + m); } else { fail++; console.log('  FALLA ' + m); } };

/* ------------------------------------------------------------------ */
console.log('=== 1. Validación de una pregunta ===');

const buena = {
  enunciado: '¿Quién escribió 2 Corintios?',
  opciones: ['Pablo', 'Pedro', 'Juan', 'Santiago'],
  indiceCorrecto: 0
};
t(validarPregunta(buena) === null, 'una pregunta completa pasa');

t(/enunciado/i.test(validarPregunta({ ...buena, enunciado: '   ' })),
  'enunciado vacío se rechaza');
t(/largo/i.test(validarPregunta({ ...buena, enunciado: 'x'.repeat(1001) })),
  'enunciado de más de 1000 se rechaza');
t(/4 respuestas/i.test(validarPregunta({ ...buena, opciones: ['a', 'b', 'c'] })),
  'tres respuestas se rechazan');
t(/respuesta 2/i.test(validarPregunta({ ...buena, opciones: ['Pablo', '', 'Juan', 'Santiago'] })),
  'una respuesta vacía se rechaza y dice cuál');
t(/iguales/i.test(validarPregunta({ ...buena, opciones: ['Pablo', 'PABLO', 'Juan', 'Santiago'] })),
  'dos respuestas iguales se rechazan sin importar mayúsculas');
t(/correcta/i.test(validarPregunta({ ...buena, indiceCorrecto: 7 })),
  'índice de correcta fuera de rango se rechaza');
t(/correcta/i.test(validarPregunta({ ...buena, indiceCorrecto: 1.5 })),
  'índice no entero se rechaza');
t(validarPregunta({ ...buena, indiceCorrecto: 3 }) === null, 'el índice 3 (la cuarta) es válido');

/* ------------------------------------------------------------------ */
console.log('\n=== 2. Selector de tema ===');

const temas = [
  { id: 't1', name: '2 Corintios', questions: 25 },
  { id: 't2', name: 'Romanos', questions: 0 }
];
const sel = selectorTema(temas, 't1');
t(sel.includes('📝'), 'lleva el botón de administrar');
t(sel.includes('2 Corintios (25 preguntas)'), 'muestra el nombre y el número de preguntas');
t(sel.includes('value="t1" selected'), 'marca el tema elegido');
t(/value="t2"[^>]*disabled/.test(sel), 'un tema sin preguntas no se puede elegir');
t(sel.includes('sin preguntas'), 'y lo dice');
t(selectorTema([], null).includes('Todavía no hay temas'), 'sin temas avisa y deja crear');
t(selectorTema(null, null).includes('Todavía no hay temas'), 'una lista nula no rompe');

/* ------------------------------------------------------------------ */
console.log('\n=== 3. Escapado (sin XSS) ===');

const malicioso = '<script>alert(1)</script>';
const selMal = selectorTema([{ id: 'x"><img onerror=alert(1)>', name: malicioso, questions: 1 }], null);
t(!selMal.includes('<script>alert'), 'el nombre del tema no se inyecta como etiqueta');
t(selMal.includes('&lt;script&gt;'), 'el nombre aparece escapado');
t(!selMal.includes('"><img'), 'el id malicioso no cierra el atributo (sin comilla viva)');
t(selMal.includes('&quot;&gt;&lt;img'), 'el id sale escapado: comilla y etiqueta inertes');

const pregs = modalPreguntas(
  { id: 't1', name: 'Tema' },
  [{ id: 'q1', prompt: malicioso, options: [{ k: 'a', t: malicioso }], correct_option: 'a' }]
);
t(!pregs.includes('<script>alert'), 'el enunciado no se inyecta');
t(pregs.includes('&lt;script&gt;'), 'el enunciado sale escapado');

const form = modalFormPregunta({
  temaId: 't1',
  pregunta: { id: 'q1', prompt: '"><b>x</b>', options: [{ k: 'a', t: '" onfocus="alert(1)' }], correct_option: 'a' }
});
t(!form.includes('onfocus="alert'), 'el texto de una opción no abre atributos');
t(form.includes('&quot;'), 'las comillas se escapan');

/* ------------------------------------------------------------------ */
console.log('\n=== 4. Modales ===');

t(modalClave({}).includes('type="password"'), 'la clave se pide como contraseña');
t(modalClave({}).includes('data-solo-fondo'), 'el fondo cierra (no usa stopPropagation)');
t(modalClave({ error: 'clave_incorrecta' }).includes('clave_incorrecta'), 'muestra el error recibido');
t(modalCambiarClave({}).includes('name="anterior"'), 'para cambiar pide la clave anterior');
t(modalCambiarClave({}).includes('name="nueva"'), 'y la nueva');
t(modalCambiarClave({}).includes('name="repetir"'), 'y la repetición');

const mt = modalTemas(temas);
t(mt.includes('Romanos'), 'lista los temas');
t(mt.includes('data-form="crear-tema"'), 'tiene el formulario para crear tema');
t(mt.includes('data-accion="borrar-tema"'), 'permite borrar un tema');
t(mt.includes('data-accion="renombrar-tema"'), 'permite renombrar un tema');
t(modalTemas([]).includes('Todavía no hay temas'), 'sin temas lo dice');

t(modalPreguntas({ id: 't1', name: 'Romanos' }, []).includes('todavía no tiene preguntas'),
  'un tema vacío lo dice');
t(modalPreguntas({ id: 't1', name: 'Romanos' }, []).includes('data-accion="nueva-pregunta"'),
  'siempre ofrece crear pregunta');

/* ------------------------------------------------------------------ */
console.log('\n=== 5. Formulario de pregunta ===');

const nuevo = modalFormPregunta({ temaId: 't1' });
t((nuevo.match(/name="opcion\d"/g) || []).length === 4, 'ofrece exactamente 4 respuestas');
t((nuevo.match(/name="correcta"/g) || []).length === 4, 'y 4 botones para marcar la correcta');
t(nuevo.includes('Cita bíblica'), 'tiene campo de cita opcional');
t(!nuevo.includes('checked'), 'una pregunta nueva no trae correcta marcada');

const editando = modalFormPregunta({
  temaId: 't1',
  pregunta: {
    id: 'q1', prompt: 'P', reference: '2 Co 1:1',
    options: [{ k: 'a', t: 'A' }, { k: 'b', t: 'B' }, { k: 'c', t: 'C' }, { k: 'd', t: 'D' }],
    correct_option: 'c'
  }
});
t(/id="op-2"[^>]*checked/.test(editando), 'al editar marca la correcta que ya tenía');
t(editando.includes('2 Co 1:1'), 'al editar conserva la cita');
t(editando.includes('data-pregunta="q1"'), 'al editar lleva el id de la pregunta');

/* ------------------------------------------------------------------ */
console.log('\n=== 6. Vista de configuraciones ===');

t(vistaConfig({ hayClave: true }).includes('Cambiar la clave maestra'), 'con clave ofrece cambiarla');
t(vistaConfig({ hayClave: false }).includes('Establecer la clave maestra'), 'sin clave ofrece establecerla');
t(vistaConfig({}).includes('data-ir="menu"'), 'tiene salida al menú');

/* ------------------------------------------------------------------ */
console.log('\n=== 7. El modal de clave dice PARA QUÉ se pide ===');

// Antes decía siempre «modificar los temas y las preguntas», que era verdad
// cuando lo único detrás era el panel. Ahora también protege el lema y la
// portada, y quien escribe la clave merece saber qué autoriza.
t(modalClave({ para: 'entrar' }).includes('temas y las preguntas'),
  'para entrar al panel, habla del panel');
t(modalClave({ para: 'lema' }).includes('texto del menú'),
  'para el lema, habla del texto del menú');
t(!modalClave({ para: 'lema' }).includes('temas y las preguntas'),
  'y no habla del panel, que no es lo que va a cambiar');
t(modalClave({ para: 'portada' }).includes('imagen del menú'),
  'para la portada, habla de la imagen');

// El para qué viaja en el formulario: el que recibe el envío tiene que saber
// qué hacer con la clave, sin adivinar por el estado de la app.
t(modalClave({ para: 'lema' }).includes('data-clave-para="lema"'),
  'el formulario lleva para qué se pide');
t(modalClave({}).includes('data-clave-para="entrar"'),
  'sin decir para qué, entra al panel');

// La vista previa: quien autoriza el cambio lo tiene que ver.
t(modalClave({ para: 'lema', muestra: 'Romanos · Concurso' }).includes('Romanos · Concurso'),
  'el modal muestra el texto que se va a guardar');
t(!modalClave({ para: 'lema' }).includes('lema-confirmado'),
  'sin texto que mostrar, no aparece el hueco vacío');

// El bloqueo se anuncia ANTES de que escriba, no después de fallar.
t(modalClave({ para: 'lema', pista: 'bloqueada' }).includes('10 minutos'),
  'si está bloqueada, lo dice antes de que escriba');
t(!modalClave({ para: 'lema' }).includes('10 minutos'),
  'sin bloqueo no se menciona');

// El escapado, que es lo que evita que un texto con etiquetas rompa el modal.
t(modalClave({ para: 'lema', muestra: '<b>negrita</b>' }).includes('&lt;b&gt;'),
  'el texto de la vista previa se escapa');
t(!modalClave({ para: 'lema', muestra: '<b>negrita</b>' }).includes('<b>negrita</b>'),
  'y no entra crudo al HTML');

/* ------------------------------------------------------------------ */
console.log('=== El editor de versiculos ===');

const TEXTO = 'Porque de tal manera amo Dios al mundo, que ha dado a su Hijo.';
const palabras = palabrasDe(TEXTO);
const base = { temaId: 't1', palabras, ocultas: [1, 5], modoOcultar: true };

/* 1. La vista previa se puede refrescar sin rehacer el modal.
   Vive en una funcion aparte justamente para eso: el modal completo y el
   refresco en vivo dibujan las palabras con el mismo codigo. Si se hubieran
   escrito dos veces, una quedaria atras y la vista previa no coincidiria con
   el cuadro de texto. */
const previa = palabrasMarcadas(palabras, [1, 5], true);
t(modalEditorVersiculo(base).includes(previa),
  'la vista previa del modal sale de palabrasMarcadas');
t(previa.includes('class="tapada"'), 'las palabras ocultas van marcadas');
t(previa.includes('data-accion="tocar-palabra"'),
  'y todas se pueden tocar cuando el modo esta armado');

/* Sin modo armado, las palabras visibles son texto plano: tocar el texto no
   debe tapar nada por accidente. */
const sinModo = palabrasMarcadas(palabras, [1], false);
t(!sinModo.includes('class="tocable"'), 'sin modo armado no hay palabras tocables');
t(sinModo.includes('class="tapada"'), 'pero las ya tapadas siguen tapadas');

/* El texto cambia y la vista previa tiene que seguirlo en el acto: esto es lo
   que se ve mientras se escribe en «Texto completo del versiculo». */
const escrito = 'Dios es amor';
const estado = conTexto(editorDesde(''), escrito);
const enVivo = palabrasMarcadas(estado.palabras, estado.ocultas, true);
t(palabrasDe(escrito).every(p => enVivo.includes(p.texto)),
  'lo que se escribe aparece entero en la vista previa');
t(!enVivo.includes('Porque'), 'y el texto anterior ya no esta');

/* Los huecos se conservan solo donde la palabra no cambio: si se reescribe el
   texto, marcar por indice taparia una palabra distinta de la elegida. */
const conHueco = { palabras: palabrasDe('Dios es amor'), ocultas: [1], historial: [] };
const tras = conTexto(conHueco, 'Dios es luz');
t(tras.ocultas.length === 0 || tras.palabras[tras.ocultas[0]].texto === 'es',
  'al reescribir el texto no se tapa una palabra distinta');

/* 2. El contador. Antes decia «1 de 34 huecos», que se lee como dos numeros
   sueltos y no dice que el segundo sea un tope. */
const uno = contadorHuecos(1, 34);
const treinta = contadorHuecos(30, 34);
const ninguno = contadorHuecos(0, 34);
t(uno.includes('1') && uno.includes('palabra oculta'),
  '«1 palabra oculta»: el numero y lo que cuenta');
t(uno.includes('máximo 34 por versículo'), 'y el tope explicado, no «de 34»');
t(!uno.includes('huecos'), 'ya no dice «huecos»');
t(treinta.includes('30') && treinta.includes('palabras ocultas'),
  'en plural concuerda: «30 palabras ocultas»');
t(ninguno.includes('0') && ninguno.includes('palabras ocultas'),
  'con cero tambien concuerda');
t(modalEditorVersiculo(base).includes(contadorHuecos(2, 34)),
  'el modal usa ese mismo contador');

/* 3. Deshacer tiene que poder mostrarse sin rehacer el modal: si el boton solo
   existiera cuando pasos > 0, al ocultar la primera palabra no habria donde
   ponerlo sin volver a dibujar todo (que es lo que hacia saltar la pantalla). */
const sinPasos = modalEditorVersiculo({ ...base, pasos: 0 });
t(sinPasos.includes('id="edv-deshacer"'),
  'el hueco de Deshacer existe aunque no haya pasos');
t(/id="edv-deshacer"[^>]*display:none/.test(sinPasos),
  'y arranca oculto');
const conPasos = modalEditorVersiculo({ ...base, pasos: 3 });
t(/id="edv-deshacer"[^>]*display:block/.test(conPasos),
  'con pasos se muestra');
t(conPasos.includes('(3)'), 'y lleva la cuenta de lo que queda por deshacer');

/* 4. El globo de ayuda se abre y se cierra sin rehacer el modal, asi que su
   texto vive en una funcion propia. */
const globo = globoAyuda();
t(globo.includes('id="edv-ayuda"'), 'el globo lleva su id para poder cerrarlo');
t(globo.includes('Ocultar palabra'), 'y explica el boton');
t(modalEditorVersiculo({ ...base, ayudaAbierta: true }).includes(globo),
  'el modal abierto usa el mismo globo');
t(modalEditorVersiculo({ ...base, ayudaAbierta: false }).includes('id="edv-hueco-ayuda"'),
  'y el hueco donde ponerlo existe siempre');

/* La vista previa ya no depende de que haya palabras: si apareciera solo al
   escribir la primera, el primer caracter no se veria. */
t(modalEditorVersiculo({ temaId: 't1', palabras: [] }).includes('texto-versiculo'),
  'sin palabras la vista previa igual existe, para ver la primera letra');

/* ------------------------------------------------------------------ */
console.log('\n=== La fila de Editar y Borrar ===');

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');

/* El arreglo cuelga de `.lista-versiculos`, que es SOLO la lista de
   versiculos. `.pregunta-fila` la comparten las fichas de opcion multiple y
   los temas, y ahi no se toca nada. */
const regla = css.match(/\.lista-versiculos \.fila \{[^}]*\}/)?.[0] ?? '';

/* Las dos columnas miden lo mismo y pueden encogerse. Con `max-content` no
   encogen nunca: «Editar» y «Borrar» juntos pedian mas ancho del que hay en un
   telefono y se salian de la tarjeta. */
t(regla.includes('minmax(min-content, 1fr)'),
  'las dos columnas miden lo mismo (1fr) y ninguna baja de su texto (min-content)');
t(!regla.includes('minmax(0, 1fr)'),
  'y no `minmax(0, ...)`, que permite una columna mas angosta que la etiqueta');
t(!regla.includes('max-content'), 'ya no se piden a su ancho natural');
t(regla.includes('max-width: 100%'), 'la rejilla no puede pedir mas ancho que la fila');

/* La regla vieja sigue igual para el resto de las pantallas: si alguien la
   cambiara, este arreglo habria alcanzado a los demas modales. */
const compartida = css.match(/\.pregunta-fila \.fila \{\s*\n\s*grid-template-columns: repeat\(2, max-content\)/);
t(!!compartida, 'la regla de las demas fichas quedo intacta');

/* Y el marcado lleva la clase que acota el arreglo. */
t(modalVersiculos({ id: 't1', name: 'Tema' }, []).includes('lista-versiculos'),
  'la lista de versiculos lleva su clase propia');
t(!modalPreguntas({ id: 't1', name: 'Tema' }, []).includes('lista-versiculos'),
  'la lista de preguntas no la lleva, asi que no la alcanza');

/* Los botones van A LA DERECHA y en UN renglon: cuando no caben no se bajan
   debajo de la referencia, se encoge la letra. Por eso la fila NO lleva
   `flex-wrap` y la etiqueta lleva `nowrap` — con la etiqueta partida, el
   ajustador mide la altura y nunca ve que sobra ancho. */
const filaEntre = css.match(/\.lista-versiculos \.fila-entre \{[^}]*\}/)?.[0] ?? '';
t(!filaEntre.includes('flex-wrap: wrap'),
  'la fila no envuelve: los botones no se bajan debajo de la referencia');

const botonFila = css.match(/\.lista-versiculos \.pregunta-fila \.fila \.boton \{[^}]*\}/)?.[0] ?? '';
t(botonFila.includes('white-space: nowrap'),
  'la etiqueta no se parte: la encoge el ajustador');
t(!botonFila.includes('white-space: normal'),
  'y no se deja envolver, que es lo que impedia medir el ancho');

/* EL RELLENO LATERAL TIENE QUE SER PEQUENO. Fue la causa real del desborde en
   un telefono vertical, y mi primera version de esta prueba no lo miraba: se
   podia volver a `.7em` (28 px de los ~81 de la caja) y las pruebas seguian en
   verde mientras el texto se salia en pantalla. Medido: con `.7em` el texto
   disponia de 49 px y necesitaba 52.

   Ademas el selector lleva `.pregunta-fila` para GANAR la cascada. Sin esa
   clase pesa lo mismo que la regla general y, como esa va despues en la hoja,
   gana ella: la medida lo demostro, el relleno seguia en 14 px con la regla
   escrita. */
t(botonFila.includes('padding-inline: .3em'),
  'el relleno lateral es .3em: con .7em el texto no entra');
t(/lista-versiculos \.pregunta-fila/.test(botonFila) ||
  /\.lista-versiculos \.pregunta-fila \.fila \.boton/.test(css),
  'y el selector gana la cascada: lleva .pregunta-fila para no empatar con la regla general');

/* El rol del ajustador declara la capacidad 1 + 1 una sola vez, en `ajuste.js`,
   que es donde la skill manda declararla. Sin ese `renglones: 1` el ajuste
   toma la capacidad del perfil y en telefono vuelve a bajar los botones. */
const ajuste = readFileSync(new URL('./ajuste.js', import.meta.url), 'utf8');
const rolBotones = ajuste.match(/\{[^}]*boton-mini[^}]*\}/)?.[0] ?? '';
t(rolBotones.includes('renglones: 1'),
  'los botones de la lista declaran 1 renglon (+1 de gracia)');
t(rolBotones.includes('categoria: \'contenido\''),
  'y son contenido: techo de 16 pt');

/* ------------------------------------------------------------------ */
console.log('\n===============================');
console.log(`  ${ok} correctas, ${fail} fallas`);
console.log('===============================');
if (fail > 0) process.exitCode = 1;
