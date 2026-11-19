// Pruebas de la conversión a webp.
//
// No hay navegador aquí: la imagen y el lienzo entran por parámetro, así que
// se prueba la LÓGICA, que es donde están las decisiones que importan (cuándo
// convertir, a qué tamaño, y qué hacer cuando algo falla). Lo que no se puede
// probar sin navegador es el motor de webp; eso se verifica de punta a punta.

import {
  decidir, calcularDestino, aWebp, tamanoDe, bytesABase64, aBytes, base64ABytes,
  prefijoData, LADO_MAX
} from './imagen.js';

let ok = 0, fail = 0;
const t = (c, m) => { if (c) { ok++; console.log('  ok   ' + m); } else { fail++; console.log('  FALLA ' + m); } };

console.log('=== 1. Cuándo convertir ===');
t(decidir('image/jpeg').convertir === true, 'un jpg se convierte');
t(decidir('image/png').convertir === true, 'un png se convierte');
t(decidir('', 'foto.JPG').convertir === true, 'por extensión, sin tipo (mayúsculas)');
t(decidir('image/webp').convertir === false, 'un webp NO se reconvierte');
t(decidir('image/webp').motivo === 'ya_es_webp', 'y se sabe por qué');
t(decidir('', 'portada.webp').convertir === false, 'por extensión también');
// Un gif animado convertido perdería el movimiento: se prefiere no tocarlo y
// decirlo, antes que guardar un cuadro suelto como si fuera la imagen.
t(decidir('image/gif').convertir === false, 'un gif no se convierte');
t(decidir('image/gif').motivo === 'gif_animado', 'y se sabe por qué');
t(decidir('application/pdf').convertir === false, 'un pdf no se convierte');
t(decidir('text/plain').convertir === false, 'un texto no se convierte');

console.log('\n=== 2. A qué tamaño se dibuja ===');
t(calcularDestino(800, 600).encogida === false, 'una imagen chica no se toca');
t(calcularDestino(800, 600).ancho === 800, 'y conserva su ancho');
t(calcularDestino(3200, 2400).encogida === true, 'una de 3200 se encoge');
t(calcularDestino(3200, 2400).ancho === LADO_MAX, 'hasta el lado máximo');
t(calcularDestino(3200, 2400).alto === 1200, 'conservando la proporción (2400/2)');
const retrato = calcularDestino(1200, 4800);
t(retrato.alto === LADO_MAX && retrato.ancho === 400,
  'en vertical manda el lado mayor, también (400x1600)');
// Agrandar no agrega detalle y sí multiplica el peso.
t(calcularDestino(200, 150).ancho === 200, 'una imagen diminuta NO se agranda');
t(calcularDestino(200, 150).encogida === false, 'y no se marca como encogida');
t(calcularDestino(0, 0).ancho === 0, 'sin dimensiones devuelve 0, no revienta');
t(calcularDestino('x', 'y').ancho === 0, 'con basura devuelve 0');
t(calcularDestino(1, 1, 0).ancho === 1, 'un lado máximo 0 no divide por cero');

console.log('\n=== 3. Auxiliares sin navegador ===');
t(tamanoDe(new Uint8Array(10)) === 10, 'el tamaño sale de byteLength');
t(tamanoDe(new ArrayBuffer(7)) === 7, 'también de un ArrayBuffer');
t(tamanoDe(null) === 0, 'sin datos, 0');
{
  const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]);   // "RIFF"
  t(bytesABase64(bytes) === 'UklGRg==', 'bytes a base64 sin prefijo');
  t(prefijoData('UklGRg==') === 'data:image/webp;base64,UklGRg==', 'el prefijo se arma bien');
  // Una foto grande: por bloques, sin reventar la pila.
  const grande = new Uint8Array(300000);
  const b64 = bytesABase64(grande);
  t(b64.length > 399000 && b64.length < 401000, '300 KB se convierten por bloques sin desbordar');
}

console.log('\n=== 4. El camino completo, con un lienzo de mentira ===');
// Se simula el navegador: una imagen con dimensiones y un lienzo que devuelve
// bytes fijos. Así se prueba TODO el camino menos el motor de webp.
function herramientas({ ancho = 800, alto = 600, fallaImagen = false, fallaContexto = false,
                        sinBlob = false, datosSalida = null } = {}) {
  const visto = { dibujos: [], lienzos: [] };
  return {
    visto,
    crearImagen: async () => {
      if (fallaImagen) throw new Error('imagen_ilegible');
      return { naturalWidth: ancho, naturalHeight: alto };
    },
    lienzoDe: () => {
      const lienzo = {
        width: 0, height: 0,
        getContext: () => {
          if (fallaContexto) return null;
          return { drawImage: (img, x, y, w, h) => { visto.dibujos.push({ w, h }); } };
        },
        toBlob: (cb) => {
          // Un Blob DE VERDAD, como el que devuelve el navegador: tiene
          // `.size` y sus bytes se leen con `arrayBuffer()`. La primera
          // versión de esta prueba devolvía un objeto con `.byteLength`, y
          // por eso no vio que el código no sabía leer un Blob: la conversión
          // «funcionaba» y guardaba una cadena vacía.
          const bytes = datosSalida || new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x1c, 0x00, 0x00, 0x00,
                                                     0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
          cb(sinBlob ? null : new Blob([bytes], { type: 'image/webp' }));
        }
      };
      visto.lienzos.push(lienzo);
      return lienzo;
    }
  };
}

{
  const h = herramientas();
  const r = await aWebp({
    datos: new Uint8Array(1000), tipo: 'image/jpeg',
    crearImagen: h.crearImagen, lienzoDe: h.lienzoDe
  });
  t(r.convertida === true, 'un jpg se convierte');
  t(r.bytes === 16, 'y devuelve los bytes del webp');
  t(r.ancho === 800 && r.alto === 600, 'con las dimensiones originales');
  t(typeof r.html === 'string' && r.html.length > 0, 'y el base64 para mandar');
  t(!r.html.startsWith('data:'), 'sin el prefijo (la base también lo aceptaría)');
}

{
  // Una imagen grande: se dibuja al tamaño reducido, no al original.
  const h = herramientas({ ancho: 4000, alto: 3000 });
  const r = await aWebp({
    datos: new Uint8Array(1000), tipo: 'image/png',
    crearImagen: h.crearImagen, lienzoDe: h.lienzoDe
  });
  t(h.visto.dibujos[0].w === LADO_MAX, 'se dibuja al ancho reducido');
  t(h.visto.dibujos[0].h === 1200, 'y con la proporción conservada');
  t(r.motivo === 'otro_formato_encogida', 'y queda dicho que se encogió');
  t(h.visto.lienzos[0].width === LADO_MAX, 'el lienzo se dimensiona antes de dibujar');
}

{
  // Un webp: pasa tal cual, sin recompresión ni lienzo.
  const h = herramientas();
  const r = await aWebp({
    datos: new Uint8Array([0x52, 0x49, 0x46, 0x46]), tipo: 'image/webp',
    crearImagen: h.crearImagen, lienzoDe: h.lienzoDe
  });
  t(r.convertida === false, 'un webp no se reconvierte');
  t(h.visto.lienzos.length === 0, 'y ni se crea un lienzo');
  t(r.html === 'UklGRg==', 'se manda su base64 tal cual');
}

console.log('\n=== 5. Los caminos que fallan (nada de silencios) ===');
// Cada fallo tiene que salir con un nombre claro. Un `null` que sigue camino
// termina guardado como si fuera una portada.
async function falla(o, esperado, msg) {
  const h = herramientas(o);
  try {
    await aWebp({
      datos: o.datos ?? new Uint8Array(1000), tipo: o.tipo ?? 'image/jpeg',
      crearImagen: h.crearImagen, lienzoDe: h.lienzoDe
    });
    t(false, msg + ' (no falló)');
  } catch (e) {
    t(e.message === esperado, msg + ' → ' + e.message);
  }
}

await falla({ datos: new Uint8Array(0) }, 'archivo_vacio', 'un archivo vacío se rechaza');
await falla({ fallaImagen: true }, 'imagen_ilegible', 'un archivo corrupto se rechaza');
await falla({ ancho: 0, alto: 0 }, 'imagen_ilegible', 'una imagen sin dimensiones se rechaza');
await falla({ fallaContexto: true }, 'sin_lienzo', 'sin contexto de lienzo se rechaza');
await falla({ sinBlob: true }, 'no_se_pudo_convertir', 'si el lienzo no da imagen, se rechaza');

{
  // Un gif: no se convierte, y se dice por qué en vez de guardar un cuadro.
  try {
    await aWebp({ datos: new Uint8Array(100), tipo: 'image/gif', crearImagen: async () => ({}), lienzoDe: () => ({}) });
    t(false, 'un gif se rechaza con su motivo');
  } catch (e) {
    t(e.message === 'gif_no_soportado', 'un gif se rechaza con su motivo');
  }
  try {
    await aWebp({ datos: new Uint8Array(100), tipo: 'application/pdf', crearImagen: async () => ({}), lienzoDe: () => ({}) });
    t(false, 'un no-imagen se rechaza con su motivo');
  } catch (e) {
    t(e.message === 'no_es_imagen', 'un no-imagen se rechaza con su motivo');
  }
}

{
  // Sin herramientas (un navegador rarísimo): se avisa, no se rompe.
  try {
    await aWebp({ datos: new Uint8Array(100), tipo: 'image/jpeg' });
    t(false, 'sin herramientas se avisa');
  } catch (e) {
    t(e.message === 'sin_herramientas', 'sin herramientas se avisa');
  }
}

console.log('\n=== 6. Las tres salidas posibles del lienzo ===');
// Un Blob (lo normal), un data URL (el respaldo viejo) y bytes (pruebas).
{
  const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x1c, 0x00, 0x00, 0x00,
                                0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
  const b64 = bytesABase64(bytes);

  t((await aBytes(new Blob([bytes]))).length === 16, 'un Blob entrega sus 16 bytes');
  t((await aBytes({ __dataUrl: 'data:image/webp;base64,' + b64 })).length === 16,
    'un data URL entrega sus bytes');
  t((await aBytes(bytes)).length === 16, 'bytes pelados se pasan tal cual');
  t((await aBytes(new ArrayBuffer(4))).length === 4, 'un ArrayBuffer también');
  t((await aBytes(null)) === null, 'null no revienta');

  // El camino de vuelta tiene que coincidir con el de ida.
  t(bytesABase64(base64ABytes(b64)) === b64, 'base64 de ida y vuelta da lo mismo');
  t(base64ABytes('') === null, 'base64 vacío devuelve null, no basura');
  t(base64ABytes('!!!no es base64!!!') === null, 'base64 roto devuelve null');

  // Y el camino completo con un Blob de verdad, que es el que corre en el
  // navegador: si esto falla, la portada nunca se guardaría.
  const h = herramientas();
  const r = await aWebp({
    datos: new Uint8Array(1000), tipo: 'image/jpeg',
    crearImagen: h.crearImagen, lienzoDe: h.lienzoDe
  });
  t(r.bytes === 16 && r.html.length > 0,
    'una conversión con Blob de verdad entrega bytes y base64 (no vacío)');
}

console.log('\n=== 7. El toBlob que devuelve null no pasa como bueno ===');
{
  // El caso que importa: el navegador dice que sí pero no entrega nada. Si
  // eso siguiera camino, se guardaría una portada vacía y «con éxito».
  const h = herramientas({ sinBlob: true });
  let salio = false;
  try {
    await aWebp({
      datos: new Uint8Array(1000), tipo: 'image/png',
      crearImagen: h.crearImagen, lienzoDe: h.lienzoDe
    });
  } catch { salio = true; }
  t(salio === true, 'un lienzo que no entrega imagen se reporta como fallo, no como éxito');
}

console.log('\n===============================================');
if (fail === 0) console.log(` TODO EN VERDE: ${ok} correctas, 0 fallas`);
else console.log(` FALLAS: ${ok} correctas, ${fail} fallas`);
console.log('===============================================');
process.exit(fail === 0 ? 0 : 1);
