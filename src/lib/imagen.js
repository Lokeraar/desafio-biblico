// Conversión de una imagen a webp, en el navegador y sin dependencias.
//
// POR QUÉ CONVERTIR EN EL NAVEGADOR Y NO EN LA BASE:
// la base guarda lo que se le manda, y no puede abrir una foto en jpg para
// volverla a comprimir. El único que tiene la imagen delante —y el motor de
// imágenes— es el navegador, así que la conversión pasa aquí y a la base le
// llega ya el webp.
//
// POR QUÉ WEBP: es lo que ya usa la app (`public/img/portada.webp`), pesa
// menos que un jpg con la misma calidad y se ve igual en cualquier teléfono
// que pueda correr el juego.
//
// LO QUE ESTE MÓDULO NO HACE: no toca el DOM, no lee archivos y no dibuja en
// un lienzo. Todo eso entra por parámetro (`crearImagen`, `lienzoDe`). Se
// puede probar entero sin navegador, y el día que la conversión cambie de
// tecnología —otro formato, otra API— la lógica no se toca.

/** Tamaño máximo del lado mayor de la portada guardada. */
export const LADO_MAX = 1600;

/** Calidad del webp: 0.85 es el punto donde deja de notarse el ahorro. */
export const CALIDAD = 0.85;

/** Tipos que el navegador ya puede leer como imagen. */
export const TIPOS_ACEPTADOS = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'image/bmp', 'image/avif', 'image/tiff'
];

/**
 * ¿Vale la pena convertir este archivo?
 *
 * Un webp ya está listo: reconvertirlo gastaría batería para dejarlo igual (o
 * peor, porque sería una segunda compresión sobre la primera). Un gif animado
 * tampoco: la conversión guarda UN cuadro, y perdería el movimiento sin avisar.
 *
 * @param {string} tipo `file.type`
 * @param {string} [nombre] `file.name`, para el caso en que el tipo venga vacío
 * @returns {{convertir: boolean, motivo: string}}
 */
export function decidir(tipo, nombre = '') {
  const t = String(tipo || '').toLowerCase();
  const n = String(nombre || '').toLowerCase();

  if (!t && !n) return { convertir: true, motivo: 'sin_tipo' };
  if (t === 'image/webp' || n.endsWith('.webp')) return { convertir: false, motivo: 'ya_es_webp' };
  if (t === 'image/gif' || n.endsWith('.gif')) return { convertir: false, motivo: 'gif_animado' };
  if (t.startsWith('image/')) return { convertir: true, motivo: 'otro_formato' };
  if (/\.(jpe?g|png|bmp|avif|tiff?)$/.test(n)) return { convertir: true, motivo: 'por_extension' };
  return { convertir: false, motivo: 'no_es_imagen' };
}

/**
 * Tamaño al que se dibuja: se encoge si excede `ladoMax`, nunca se agranda.
 *
 * Agrandar no agrega detalle —no hay más píxeles de los que llegaron— y sí
 * multiplica el peso. Una foto de 400 px estirada a 1600 ocupa dieciséis
 * veces más y se ve igual de borrosa, o peor.
 *
 * @returns {{ancho: number, alto: number, encogida: boolean}}
 */
export function calcularDestino(ancho, alto, ladoMax = LADO_MAX) {
  const a = Number(ancho) || 0;
  const b = Number(alto) || 0;
  if (!(a > 0) || !(b > 0)) return { ancho: 0, alto: 0, encogida: false };

  const mayor = Math.max(a, b);
  if (!(ladoMax > 0) || mayor <= ladoMax) {
    return { ancho: Math.round(a), alto: Math.round(b), encogida: false };
  }

  const factor = ladoMax / mayor;
  return {
    ancho: Math.max(1, Math.round(a * factor)),
    alto: Math.max(1, Math.round(b * factor)),
    encogida: true
  };
}

/** El prefijo que el navegador espera en un `data:` de base64. */
export function prefijoData(html) {
  return 'data:image/webp;base64,' + html;
}

/**
 * Convierte un archivo de imagen a webp en base64.
 *
 * Los pasos son los de cualquier conversión: abrir la imagen, dibujarla en un
 * lienzo más chico si hace falta, y pedir el webp. Cada uno de esos pasos
 * puede fallar —un archivo corrupto, un navegador sin lienzo, memoria
 * insuficiente— y ninguno avisa solo: si el lienzo devuelve `null` hay que
 * mirarlo, porque un `null` que sigue camino termina en un base64 vacío
 * guardado como si fuera una portada.
 *
 * @param {object} o
 * @param {ArrayBuffer|ArrayBufferView} o.datos bytes del archivo
 * @param {string} o.tipo tipo declarado del archivo
 * @param {string} [o.nombre]
 * @param {(blob: Blob) => Promise<any>} o.crearImagen
 * @param {() => any} o.lienzoDe crea un lienzo nuevo
 * @param {number} [o.ladoMax]
 * @param {number} [o.calidad]
 * @param {boolean} [o.yaEsWebp]
 * @returns {Promise<{html: string, bytes: number, ancho: number, alto: number,
 *                    convertida: boolean, motivo: string}>}
 */
export async function aWebp({
  datos, tipo, nombre = '',
  crearImagen, lienzoDe,
  ladoMax = LADO_MAX, calidad = CALIDAD,
  yaEsWebp = null
} = {}) {
  const decision = yaEsWebp === true
    ? { convertir: false, motivo: 'ya_es_webp' }
    : decidir(tipo, nombre);

  if (!decision.convertir) {
    if (decision.motivo === 'ya_es_webp') {
      // Ya está en webp: se manda tal cual llegó, sin recompresión.
      const html = bytesABase64(datos);
      return {
        html, bytes: tamanoDe(datos), ancho: 0, alto: 0,
        convertida: false, motivo: decision.motivo
      };
    }
    // Un gif o algo que no es imagen: mejor decirlo que guardar un cuadro
    // suelto o basura.
    throw new Error(decision.motivo === 'gif_animado' ? 'gif_no_soportado' : 'no_es_imagen');
  }

  if (!datos || tamanoDe(datos) === 0) throw new Error('archivo_vacio');
  if (typeof crearImagen !== 'function' || typeof lienzoDe !== 'function') {
    throw new Error('sin_herramientas');
  }

  const blob = new Blob([datos], { type: tipo || 'application/octet-stream' });

  let imagen;
  try {
    imagen = await crearImagen(blob);
  } catch {
    throw new Error('imagen_ilegible');
  }

  const anchoOriginal = imagen.naturalWidth || imagen.width || 0;
  const altoOriginal = imagen.naturalHeight || imagen.height || 0;
  if (!(anchoOriginal > 0) || !(altoOriginal > 0)) throw new Error('imagen_ilegible');

  const destino = calcularDestino(anchoOriginal, altoOriginal, ladoMax);

  const lienzo = lienzoDe();
  if (!lienzo) throw new Error('sin_lienzo');

  lienzo.width = destino.ancho;
  lienzo.height = destino.alto;

  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new Error('sin_lienzo');
  ctx.drawImage(imagen, 0, 0, destino.ancho, destino.alto);

  const salida = await lienzoAWebp(lienzo, calidad);
  if (!salida) throw new Error('no_se_pudo_convertir');

  // El lienzo entrega un BLOB, no bytes. Un Blob tiene `.size`, no
  // `.byteLength`, y sus bytes se leen con `arrayBuffer()`, que es asíncrono.
  // Tratar el Blob como si fuera un arreglo de bytes daba `undefined`
  // silencioso: la conversión «funcionaba» y guardaba una cadena vacía.
  const bytes = await aBytes(salida);
  if (!bytes || bytes.length === 0) throw new Error('no_se_pudo_convertir');

  const html = bytesABase64(bytes);
  if (!html) throw new Error('no_se_pudo_convertir');

  return {
    html,
    bytes: bytes.length,
    ancho: destino.ancho,
    alto: destino.alto,
    convertida: true,
    motivo: destino.encogida ? 'otro_formato_encogida' : 'otro_formato'
  };
}

/** Abre un blob como imagen usando el navegador. */
export function crearImagenNavegador(blob) {
  return new Promise((resolver, rechazar) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolver(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rechazar(new Error('imagen_ilegible')); };
    img.src = url;
  });
}

/** Un lienzo del documento. */
export function lienzoNavegador() {
  if (typeof document === 'undefined') return null;
  return document.createElement('canvas');
}

/** Pide el webp al lienzo, con las dos formas que existen. */
function lienzoAWebp(lienzo, calidad) {
  return new Promise((resolver) => {
    // `toBlob` es la buena: no pasa por una cadena base64 intermedia.
    if (typeof lienzo.toBlob === 'function') {
      lienzo.toBlob((blob) => resolver(blob), 'image/webp', calidad);
      return;
    }
    // Respaldo para navegadores sin `toBlob`: devuelve un data URL.
    if (typeof lienzo.toDataURL === 'function') {
      const url = lienzo.toDataURL('image/webp', calidad);
      // Si el motor no soporta webp, devuelve un PNG con otro prefijo. Se
      // detecta aquí: guardar un PNG donde se prometió webp rompería la
      // revisión de cabecera que hace la base.
      if (!/^data:image\/webp;base64,/.test(url)) { resolver(null); return; }
      resolver({ __dataUrl: url });
      return;
    }
    resolver(null);
  });
}

/* ------------------------------------------------------------------ */
/* Auxiliares que no dependen del navegador                            */
/* ------------------------------------------------------------------ */

/** Cuántos bytes tiene, sea ArrayBuffer o vista sobre uno. */
export function tamanoDe(datos) {
  if (!datos) return 0;
  if (typeof datos.byteLength === 'number') return datos.byteLength;
  // Un `Blob` mide con `.size`. Sin esta línea, un Blob de verdad se veía
  // como «0 bytes» y la conversión lo rechazaba por vacío.
  if (typeof datos.size === 'number') return datos.size;
  if (typeof datos.length === 'number') return datos.length;
  return 0;
}

/**
 * Normaliza a bytes cualquier cosa que pueda entregar un lienzo.
 *
 * Existe porque las tres formas que hay de obtener la imagen son distintas y
 * ninguna se parece a las otras: un `Blob` (lo normal), un data URL (el
 * respaldo viejo) y bytes (las pruebas y algún motor recortado). Convertirlas
 * aquí, una sola vez y en un solo lugar, evita que cada tramo del código tenga
 * que saber cuál le tocó.
 *
 * @param {Blob|{__dataUrl: string}|ArrayBuffer|ArrayBufferView} salida
 * @returns {Promise<Uint8Array|null>}
 */
export async function aBytes(salida) {
  if (!salida) return null;

  if (typeof salida.__dataUrl === 'string') {
    const b64 = salida.__dataUrl.replace(/^data:[^,]*,/, '');
    return base64ABytes(b64);
  }

  // Un Blob de verdad: sus bytes son asíncronos.
  if (typeof salida.arrayBuffer === 'function') {
    try {
      return new Uint8Array(await salida.arrayBuffer());
    } catch {
      return null;
    }
  }

  if (salida instanceof ArrayBuffer) return new Uint8Array(salida);
  if (ArrayBuffer.isView(salida)) {
    return new Uint8Array(salida.buffer, salida.byteOffset, salida.byteLength);
  }
  return null;
}

/** El camino de vuelta de `bytesABase64`. */
export function base64ABytes(b64) {
  const limpio = String(b64 || '').replace(/\s+/g, '');
  if (!limpio) return null;
  try {
    if (typeof atob === 'function') {
      const binario = atob(limpio);
      const bytes = new Uint8Array(binario.length);
      for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
      return bytes;
    }
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(limpio, 'base64'));
  } catch {
    return null;
  }
  return null;
}

/** Pasa bytes a base64 sin el prefijo `data:`. */
export function bytesABase64(datos) {
  if (!datos) return '';
  // Un data URL ya trae su base64 dentro.
  if (typeof datos.__dataUrl === 'string') {
    return datos.__dataUrl.replace(/^data:[^,]*,/, '');
  }
  if (typeof datos === 'string') return datos;

  const bytes = datos instanceof ArrayBuffer ? new Uint8Array(datos)
    : (ArrayBuffer.isView(datos) ? new Uint8Array(datos.buffer, datos.byteOffset, datos.byteLength)
      : null);
  if (!bytes) return '';

  // Por bloques: `String.fromCharCode(...bytes)` con un arreglo grande revienta
  // la pila de llamadas, y una foto de 1600 px lo es.
  const trozo = 0x8000;
  let binario = '';
  for (let i = 0; i < bytes.length; i += trozo) {
    binario += String.fromCharCode.apply(null, bytes.subarray(i, i + trozo));
  }
  return btoaCompat(binario);
}

/** `btoa` existe en el navegador y en Node 16+; sin él, se avisa. */
function btoaCompat(binario) {
  if (typeof btoa === 'function') return btoa(binario);
  if (typeof Buffer !== 'undefined') return Buffer.from(binario, 'binary').toString('base64');
  throw new Error('sin_base64');
}
