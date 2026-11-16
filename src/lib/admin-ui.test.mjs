/* Prueba de la interfaz de administración: puro texto, sin navegador.
   Se centra en lo que puede romperse en silencio: la validación de una
   pregunta y el escapado de datos que vienen de la base. */
import {
  validarPregunta, selectorTema, modalClave, modalCambiarClave,
  modalTemas, modalPreguntas, modalFormPregunta, vistaConfig
} from './admin-ui.js';

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
console.log('\n===============================');
console.log(`  ${ok} correctas, ${fail} fallas`);
console.log('===============================');
if (fail > 0) process.exitCode = 1;
