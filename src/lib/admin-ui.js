// Interfaz de administración: temas, preguntas y clave maestra.
//
// Todas las funciones de este archivo DEVUELVEN HTML y no tocan el DOM:
// así se pueden probar sin navegador (jsdom dio problemas de clics, ya
// documentado en NOTES.md lección 9).
//
// Los valores que vienen de la base pasan SIEMPRE por `esc()`: un tema
// llamado `<script>` no debe ejecutar nada.

import { esc } from './util.js';

/* ------------------------------------------------------------------ */
/* Validación de una pregunta                                          */
/* ------------------------------------------------------------------ */

/**
 * Valida una pregunta antes de mandarla. La base vuelve a validar, pero
 * aquí el usuario ve el error al instante y sin gastar una petición.
 * Devuelve `null` si está bien, o el texto del problema.
 */
export function validarPregunta({ enunciado, opciones, indiceCorrecto }) {
  const texto = String(enunciado ?? '').trim();
  if (!texto) return 'Escribe el enunciado de la pregunta.';
  if (texto.length > 1000) return 'El enunciado es demasiado largo (máximo 1000 caracteres).';

  if (!Array.isArray(opciones) || opciones.length !== 4) {
    return 'Se necesitan exactamente 4 respuestas.';
  }

  const vistos = new Set();
  for (let i = 0; i < 4; i++) {
    const o = String(opciones[i] ?? '').trim();
    if (!o) return `La respuesta ${i + 1} está vacía.`;
    if (o.length > 300) return `La respuesta ${i + 1} es demasiado larga (máximo 300).`;
    const clave = o.toLowerCase();
    if (vistos.has(clave)) return 'Hay dos respuestas iguales. Cada una debe ser distinta.';
    vistos.add(clave);
  }

  if (!Number.isInteger(indiceCorrecto) || indiceCorrecto < 0 || indiceCorrecto > 3) {
    return 'Marca cuál de las 4 respuestas es la correcta.';
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Selector de tema                                                    */
/* ------------------------------------------------------------------ */

/**
 * Selector de tema con el botón 📝 al lado.
 * `elegido` es el id del tema seleccionado o null.
 */
export function selectorTema(temas, elegido) {
  const lista = Array.isArray(temas) ? temas : [];

  if (lista.length === 0) {
    return `
      <div class="campo" style="max-width:var(--ancho-form); width:100%">
        <label>Tema</label>
        <div class="fila" style="gap:.5rem; align-items:center">
          <p class="chico tenue" style="flex:1; margin:0">
            Todavía no hay temas. Crea el primero con 📝.
          </p>
          <button class="boton boton-contorno boton-icono" data-accion="abrir-temas"
                  title="Administrar temas" aria-label="Administrar temas">📝</button>
        </div>
      </div>`;
  }

  const opciones = lista.map(t => {
    const n = t.questions ?? 0;
    const etiqueta = `${t.name} (${n} pregunta${n === 1 ? '' : 's'})`;
    return `<option value="${esc(t.id)}" ${t.id === elegido ? 'selected' : ''}
              ${n === 0 ? 'disabled' : ''}>${esc(etiqueta)}${n === 0 ? ' — sin preguntas' : ''}</option>`;
  }).join('');

  return `
    <div class="campo" style="max-width:var(--ancho-form); width:100%">
      <label for="sel-tema">Tema de la partida</label>
      <div class="fila" style="gap:.5rem; align-items:center">
        <select id="sel-tema" style="flex:1">
          <option value="" ${!elegido ? 'selected' : ''}>— Elige un tema —</option>
          ${opciones}
        </select>
        <button class="boton boton-contorno boton-icono" data-accion="abrir-temas"
                title="Ver y editar las preguntas" aria-label="Administrar temas y preguntas">📝</button>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Modal: pedir la clave maestra                                       */
/* ------------------------------------------------------------------ */

export function modalClave({ para = 'entrar', error = null } = {}) {
  const titulos = {
    entrar: 'Clave maestra',
    config: 'Cambiar la clave maestra'
  };
  return `
    <div class="modal-fondo" data-accion="cerrar-admin" data-solo-fondo="1">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="t-clave">
        <h2 id="t-clave" style="font-size:var(--t-lg)">${esc(titulos[para] ?? titulos.entrar)}</h2>
        <p class="chico tenue" style="margin:0">
          Solo el presentador puede modificar los temas y las preguntas.
        </p>
        <form class="campo" data-form="clave">
          <label for="in-clave">Clave de 4 dígitos</label>
          <input id="in-clave" name="clave" type="password" inputmode="numeric"
                 autocomplete="off" maxlength="64" required
                 style="font-size:var(--t-lg); letter-spacing:.3em; text-align:center">
          ${error ? `<p class="chico" style="color:var(--peligro); margin:.3rem 0 0">${esc(error)}</p>` : ''}
          <div class="fila" style="gap:.6rem; margin-top:.8rem">
            <button type="button" class="boton boton-secundario" data-accion="cerrar-admin" style="flex:1">
              Cancelar
            </button>
            <button type="submit" class="boton boton-oro" style="flex:1">Entrar</button>
          </div>
        </form>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Modal: cambiar la clave maestra                                     */
/* ------------------------------------------------------------------ */

export function modalCambiarClave({ error = null } = {}) {
  return `
    <div class="modal-fondo" data-accion="cerrar-admin" data-solo-fondo="1">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="t-cambioclave">
        <h2 id="t-cambioclave" style="font-size:var(--t-lg)">Cambiar la clave maestra</h2>
        <p class="chico tenue" style="margin:0">
          Escribe la clave actual y después la nueva dos veces.
        </p>
        <form class="campo" data-form="cambiar-clave">
          <label for="cc-vieja">Clave actual</label>
          <input id="cc-vieja" name="anterior" type="password" inputmode="numeric"
                 autocomplete="off" required>

          <label for="cc-nueva" style="margin-top:.6rem">Clave nueva</label>
          <input id="cc-nueva" name="nueva" type="password" inputmode="numeric"
                 autocomplete="off" minlength="4" required>

          <label for="cc-rep" style="margin-top:.6rem">Repite la clave nueva</label>
          <input id="cc-rep" name="repetir" type="password" inputmode="numeric"
                 autocomplete="off" minlength="4" required>

          ${error ? `<p class="chico" style="color:var(--peligro); margin:.3rem 0 0">${esc(error)}</p>` : ''}
          <div class="fila" style="gap:.6rem; margin-top:.8rem">
            <button type="button" class="boton boton-secundario" data-accion="cerrar-admin" style="flex:1">
              Cancelar
            </button>
            <button type="submit" class="boton boton-oro" style="flex:1">Cambiar</button>
          </div>
        </form>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Modal: lista de temas                                               */
/* ------------------------------------------------------------------ */

export function modalTemas(temas, { error = null, ocupado = false } = {}) {
  const lista = Array.isArray(temas) ? temas : [];

  const filas = lista.length === 0
    ? `<p class="chico tenue centro" style="margin:1rem 0">Todavía no hay temas.</p>`
    : lista.map(t => `
        <li class="fila-entre tema-fila">
          <span style="min-width:0">
            <strong>${esc(t.name)}</strong>
            <span class="chico tenue"> · ${t.questions ?? 0} pregunta${(t.questions ?? 0) === 1 ? '' : 's'}</span>
          </span>
          <span class="fila" style="gap:.35rem">
            <button class="boton boton-contorno boton-mini" data-accion="ver-preguntas"
                    data-tema="${esc(t.id)}">Preguntas</button>
            <button class="boton boton-contorno boton-mini" data-accion="renombrar-tema"
                    data-tema="${esc(t.id)}" data-nombre="${esc(t.name)}">Renombrar</button>
            <button class="boton boton-peligro boton-mini" data-accion="borrar-tema"
                    data-tema="${esc(t.id)}" data-nombre="${esc(t.name)}">Borrar</button>
          </span>
        </li>`).join('');

  return `
    <div class="modal-fondo" data-accion="cerrar-admin" data-solo-fondo="1">
      <div class="modal modal-ancho" role="dialog" aria-modal="true" aria-labelledby="t-temas">
        <h2 id="t-temas" style="font-size:var(--t-lg)">Temas</h2>
        ${error ? `<p class="chico" style="color:var(--peligro); margin:0">${esc(error)}</p>` : ''}
        <ul class="lista-admin">${filas}</ul>

        <form class="fila" data-form="crear-tema" style="gap:.5rem; align-items:flex-end">
          <div class="campo" style="flex:1">
            <label for="nuevo-tema">Tema nuevo</label>
            <input id="nuevo-tema" name="nombre" type="text" maxlength="60"
                   placeholder="Ej.: Romanos" required ${ocupado ? 'disabled' : ''}>
          </div>
          <button type="submit" class="boton boton-oro" ${ocupado ? 'disabled' : ''}>Crear</button>
        </form>

        <button class="boton boton-secundario" data-accion="cerrar-admin">Cerrar</button>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Modal: lista de preguntas de un tema                                */
/* ------------------------------------------------------------------ */

export function modalPreguntas(tema, preguntas, { error = null } = {}) {
  const lista = Array.isArray(preguntas) ? preguntas : [];
  const nombre = tema?.name ?? 'Preguntas';

  const filas = lista.length === 0
    ? `<p class="chico tenue centro" style="margin:1rem 0">Este tema todavía no tiene preguntas.</p>`
    : lista.map((q, i) => {
        const opciones = Array.isArray(q.options) ? q.options : [];
        const correcta = opciones.find(o => o.k === q.correct_option);
        return `
        <li class="pregunta-fila">
          <div class="fila-entre" style="gap:.5rem">
            <span class="chico tenue">#${i + 1}</span>
            <span class="fila" style="gap:.35rem">
              <button class="boton boton-contorno boton-mini" data-accion="editar-pregunta"
                      data-pregunta="${esc(q.id)}">Editar</button>
              <button class="boton boton-peligro boton-mini" data-accion="borrar-pregunta"
                      data-pregunta="${esc(q.id)}">Borrar</button>
            </span>
          </div>
          <p style="margin:.25rem 0 0">${esc(q.prompt)}</p>
          <p class="chico tenue" style="margin:.15rem 0 0">
            Correcta: ${esc(correcta?.t ?? '—')}${q.reference ? ` · ${esc(q.reference)}` : ''}
          </p>
        </li>`;
      }).join('');

  return `
    <div class="modal-fondo" data-accion="cerrar-admin" data-solo-fondo="1">
      <div class="modal modal-ancho" role="dialog" aria-modal="true" aria-labelledby="t-pregs">
        <h2 id="t-pregs" style="font-size:var(--t-lg)">${esc(nombre)}</h2>
        <p class="chico tenue" style="margin:0">
          ${lista.length} pregunta${lista.length === 1 ? '' : 's'} en este tema.
        </p>
        ${error ? `<p class="chico" style="color:var(--peligro); margin:0">${esc(error)}</p>` : ''}

        <div class="lista-admin" style="max-height:52vh; overflow-y:auto">
          <ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:.6rem">
            ${filas}
          </ul>
        </div>

        <div class="fila" style="gap:.6rem">
          <button class="boton boton-oro" data-accion="nueva-pregunta"
                  data-tema="${esc(tema?.id ?? '')}" style="flex:1">
            ➕ Nueva pregunta
          </button>
          <button class="boton boton-secundario" data-accion="abrir-temas">Volver</button>
        </div>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Modal: formulario de pregunta (crear o editar)                      */
/* ------------------------------------------------------------------ */

export function modalFormPregunta({ temaId, pregunta = null, error = null } = {}) {
  const q = pregunta;
  const opciones = Array.isArray(q?.options) ? q.options : [];
  const correcta = q?.correct_option ?? null;

  const campos = [0, 1, 2, 3].map(i => {
    const texto = opciones[i]?.t ?? '';
    const k = opciones[i]?.k ?? ['a', 'b', 'c', 'd'][i];
    const marcada = k === correcta;
    return `
      <div class="opcion-fila">
        <input type="radio" name="correcta" value="${i}" id="op-${i}"
               ${marcada ? 'checked' : ''} required>
        <input type="text" name="opcion${i}" value="${esc(texto)}" maxlength="300"
               placeholder="Respuesta ${i + 1}" aria-label="Respuesta ${i + 1}" required>
      </div>`;
  }).join('');

  return `
    <div class="modal-fondo" data-accion="cerrar-admin" data-solo-fondo="1">
      <div class="modal modal-ancho" role="dialog" aria-modal="true" aria-labelledby="t-formp">
        <h2 id="t-formp" style="font-size:var(--t-lg)">
          ${q ? 'Editar pregunta' : 'Nueva pregunta'}
        </h2>

        <form data-form="pregunta" data-tema="${esc(temaId ?? '')}"
              data-pregunta="${esc(q?.id ?? '')}">
          <div class="campo">
            <label for="fp-enunciado">Pregunta</label>
            <textarea id="fp-enunciado" name="enunciado" rows="3" maxlength="1000"
                      required>${esc(q?.prompt ?? '')}</textarea>
          </div>

          <div class="campo" style="margin-top:.8rem">
            <label>Respuestas — marca la correcta</label>
            <p class="chico tenue" style="margin:0 0 .4rem">
              Una correcta y tres incorrectas.
            </p>
            ${campos}
          </div>

          <div class="campo" style="margin-top:.8rem">
            <label for="fp-ref">Cita bíblica (opcional)</label>
            <input id="fp-ref" name="referencia" type="text" maxlength="120"
                   placeholder="Ej.: 2 Corintios 5:17" value="${esc(q?.reference ?? '')}">
          </div>

          ${error ? `<p class="chico" style="color:var(--peligro); margin:.5rem 0 0">${esc(error)}</p>` : ''}

          <div class="fila" style="gap:.6rem; margin-top:1rem">
            <button type="button" class="boton boton-secundario" data-accion="ver-preguntas"
                    data-tema="${esc(temaId ?? '')}" style="flex:1">Cancelar</button>
            <button type="submit" class="boton boton-oro" style="flex:1">Guardar</button>
          </div>
        </form>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Vista de configuraciones (menú principal)                           */
/* ------------------------------------------------------------------ */

export function vistaConfig({ hayClave = false } = {}) {
  return `
    <div class="fila-entre">
      <button class="boton boton-secundario" data-ir="menu">← Volver</button>
    </div>
    <main class="crecer columna centro" style="gap:1.2rem">
      <h1>⚙️ Configuraciones</h1>
      <p class="tenue" style="text-align:center">
        La clave maestra protege los temas y las preguntas del juego.
        Solo el presentador la conoce.
      </p>

      <div class="tarjeta-config" style="max-width:var(--ancho-form); width:100%">
        <h2 style="font-size:var(--t-md); margin:0 0 .3rem">Clave maestra</h2>
        <p class="chico tenue" style="margin:0 0 .9rem">
          ${hayClave
            ? 'La clave está configurada. Puedes cambiarla cuando quieras.'
            : 'Todavía no hay clave. Establécela antes de usar el panel del presentador.'}
        </p>
        <button class="boton boton-oro" data-accion="abrir-cambiar-clave" style="width:100%">
          ${hayClave ? 'Cambiar la clave maestra' : 'Establecer la clave maestra'}
        </button>
      </div>
    </main>`;
}
