/* =====================================================================
   Escala de la página — compensación del zoom del navegador
   ---------------------------------------------------------------------
   Por qué existe este archivo.

   En «modo escritorio» un navegador móvil NO cambia la pantalla: declara un
   lienzo ancho y lo dibuja entero dentro de la pantalla física. Medido en
   este teléfono: lienzo de 980 px, pantalla de 412 dp, escala 0.42. Es decir,
   todo lo que hay en la página se ve 2.38 veces más chico que en un teléfono
   normal con la misma pantalla.

   Eso rompe cualquier razonamiento sobre tamaños en `px` o `rem`: 16 pt de la
   skill se dibujaban en 6.7 dp y no había forma de saberlo mirando la hoja de
   estilos. La única medida honesta es el tamaño FÍSICO, y para llegar a él
   hay que multiplicar la raíz por el factor de encogimiento.

   Cómo se calcula el factor — y por qué NO se mide.

   La proporción `lienzo / pantalla` es exactamente el encogimiento, así que
   sale de una cuenta y no de una medición. Se intentó antes midiendo el
   documento y buscando el tamaño que no desbordara: más de setenta
   recálculos de maqueta por cambio de vista, y en el teléfono la pestaña
   llegaba a colgarse. Una asignación no cuesta nada y no puede colgarse.

   Consecuencia aceptada: al subir la escala, el contenido vertical pasa a
   necesitar desplazamiento. Es lo correcto: el mismo menú en un teléfono
   normal tampoco cabe de una vez, y la letra legible vale más que ahorrarse
   el scroll.
   ===================================================================== */

/** Un rem, en píxeles de hoja. Solo el valor de partida. */
export const REM = 16;

/** Por debajo de esta diferencia no hay zoom: es redondeo o barras. */
export const UMBRAL_ZOOM = 1.15;

/** Tope del factor, por si una pantalla declara un ancho absurdo. */
export const TOPE_FACTOR = 3;

/**
 * Cuántas veces el navegador está encogiendo la página.
 *
 * LA MEDIDA BUENA ES `visualViewport.scale`, NO la razón de anchos.
 * Durante mucho tiempo esto se calculó como `innerWidth / screen.width`, y
 * funciona en vertical pero se equivoca al girar el teléfono. Medido en modo
 * escritorio, misma pantalla, solo girando:
 *
 *   vertical   : razón 2.378 | escala 0.4199 | error 0.1 %
 *   horizontal : razón 1.158 | escala 0.8142 | error 5.7 %
 *
 * En horizontal la razón de anchos se queda corta porque `screen.width` pasa a
 * ser el ALTO físico (846) mientras el lienzo sigue siendo 980: la razón ya no
 * describe el encogimiento, describe una proporción que casualmente se le
 * parece. El resultado era una raíz de 18.53 px en vez de 19.65: un 5.7 % de
 * letra perdida en cada giro.
 *
 * `visualViewport.scale` es el propio navegador diciendo a qué escala dibuja.
 * Su recíproco (`1 / escala`) ES el factor, sin suposiciones, y se mantiene
 * correcto al girar porque el navegador lo recalcula.
 *
 * La razón de anchos queda solo como RESPALDO, para navegadores sin
 * `visualViewport` (Safari viejo). Y un respaldo del que se sabe que se
 * equivoca al girar: por eso se usa únicamente si no hay escala disponible.
 *
 * @param {object} [o]
 * @param {number} [o.escala] `visualViewport.scale`, por omisión el del navegador
 * @returns {number} 1 si no hay zoom; mayor que 1 si la página está encogida
 */
export function factorEscala({ escala } = {}) {
  const e = typeof escala === 'number' ? escala
    : (typeof visualViewport !== 'undefined' && visualViewport ? Number(visualViewport.scale) : 0);

  if (e > 0) {
    // La escala va de 0 a 1 mientras la página está encogida; 1 es tamaño real.
    const factor = 1 / e;
    // Una escala mayor que 1 es AMPLIACIÓN (pellizco del usuario): no se toca.
    if (!(factor >= UMBRAL_ZOOM)) return 1;
    return Math.min(factor, TOPE_FACTOR);
  }

  // Respaldo sin `visualViewport`: razón de anchos, sabiendo que se desvía al
  // girar en modo escritorio. Mejor una aproximación que ninguna.
  const L = typeof window !== 'undefined' ? window.innerWidth : 0;
  const P = typeof screen !== 'undefined' ? Number(screen.width) : 0;
  if (!(L > 0) || !(P > 0)) return 1;
  const factor = L / P;
  if (!(factor >= UMBRAL_ZOOM)) return 1;
  return Math.min(factor, TOPE_FACTOR);
}

/**
 * Aplica el factor a la raíz del documento.
 *
 * Una sola asignación. Como toda la escala de la app está en `rem`, esto
 * sube el texto, los rellenos y los huecos juntos, en la proporción que el
 * diseño eligió. No hay que retocar token por token, y por eso la sección de
 * juegos deja de quedarse atrás: usa `--t-sm` y `--t-xs`, que crecen con la
 * misma raíz que el cuerpo.
 *
 * @param {Document} [doc]
 * @returns {{factor: number, raizPx: number}}
 */
export function aplicarEscala(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.documentElement) return { factor: 1, raizPx: REM };

  const factor = factorEscala();
  const raizPx = REM * factor;
  d.documentElement.style.fontSize = raizPx.toFixed(2) + 'px';
  return { factor, raizPx };
}

/**
 * La raíz REAL del documento, en píxeles.
 *
 * No es lo mismo que `REM`: con la compensación aplicada la raíz es mayor, y
 * cualquier cálculo que compare tamaños tiene que partir de este valor.
 *
 * @returns {number}
 */
export function raizPx() {
  if (typeof window === 'undefined') return REM;
  const v = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(v) && v > 0 ? v : REM;
}

/**
 * Un ajustador para llamar desde el repintado y desde los cambios de tamaño.
 *
 * `requestAnimationFrame` agrupa el momento de las llamadas pero las ejecuta
 * todas, así que hace falta la bandera. Y no corre con la pestaña oculta: sin
 * la comprobación de `document.hidden` el ajuste nunca ocurre, en silencio.
 *
 * @returns {{pedir: () => void, ahora: () => object}}
 */
export function crearEscalador() {
  let pendiente = false;

  const correr = () => {
    pendiente = false;
    return aplicarEscala();
  };

  return {
    pedir() {
      if (pendiente) return;
      pendiente = true;
      if (typeof requestAnimationFrame === 'function' && !(typeof document !== 'undefined' && document.hidden)) {
        requestAnimationFrame(correr);
      } else {
        correr();
      }
    },
    ahora: correr
  };
}

/* =====================================================================
   Ajuste de texto por renglones
   ---------------------------------------------------------------------
   El orden que manda la skill, y que NO se puede invertir:

     1. Se arranca en el TECHO del rol (24 pt un título, 16 pt el contenido).
     2. Si no cabe en la capacidad del perfil, se ENCOGE la letra, paso a paso.
     3. Solo si ya se llegó al SUELO de 8 pt y todavía no cabe, se concede UNA
        línea de gracia (la capacidad pasa a N+1) y se vuelve a ajustar.
     4. Si ni con la gracia entra, recién ahí se recorta con puntos suspensivos.

   La gracia es un colchón de seguridad, no presupuesto: por eso se pide al
   final. Y el paso 2 es ENCOGER, no saltar de renglón: si un texto puede
   caber en una línea bajando la letra, así se hace, sin gastar la gracia.

   Con la raíz compensada 1 rem = 12 pt reales, así que los pasos se escriben
   en `pt` y se convierten dividiendo por 12.
   ===================================================================== */

/**
 * Escala de cada categoría: TECHO de diseño y SUELO de accesibilidad.
 *
 * El suelo es UNO SOLO para todas las categorías: 8 pt. Es el límite de
 * accesibilidad, no una preferencia, y por debajo no se baja nunca. El techo
 * sí cambia, porque un título nace en 24 pt y un párrafo en 16.
 *
 *   contenido : techo 16 pt
 *   título    : techo 24 pt
 *   etiqueta  : techo 12 pt   (insignias de estado)
 *   las tres  : suelo  8 pt
 *
 * No hace falta un suelo distinto por categoría para proteger la jerarquía:
 * el ajuste siempre se queda con el TAMAÑO MAYOR que entra, así que un título
 * corto nunca baja a 8 pt. El suelo solo actúa cuando de verdad no cabe.
 *
 * Los números están en puntos REALES: con la raíz compensada 1 rem = 12 pt,
 * así que se convierten dividiendo por 12 (ver `ptARem`).
 */
export const ESCALA = {
  contenido: { techo: 16, suelo: 8 },
  titulo: { techo: 24, suelo: 8 },
  etiqueta: { techo: 12, suelo: 8 }
};

/** Techo de contenido: 16 pt. Es el tamaño de partida, no un promedio. */
export const TECHO_CONTENIDO = ESCALA.contenido.techo;

/** Techo de título: 24 pt. */
export const TECHO_TITULO = ESCALA.titulo.techo;

/** Suelo de accesibilidad: 8 pt para todo. Por debajo no se baja. */
export const SUELO = 8;

/** Escalera de tamaños de una categoría, en pt, de mayor a menor. */
const escalera = (techo, suelo = SUELO) => {
  const pasos = [];
  for (let pt = techo; pt >= suelo; pt--) pasos.push(pt);
  return pasos;
};

/** Pasos del contenido: 16, 15, ... 8. */
export const PASOS = escalera(ESCALA.contenido.techo);

/** Pasos de un título: 24, 23, ... 8. */
export const PASOS_TITULO = escalera(ESCALA.titulo.techo);

/** Pasos de una etiqueta de estado: 12, 11, ... 8. */
export const PASOS_ETIQUETA = escalera(ESCALA.etiqueta.techo);

/** Perfiles de capacidad: tableta y PC dejan 1 renglón + 1 de gracia. */
export const PERFILES = {
  telefono: { renglones: 2, gracia: 1 },
  ancho: { renglones: 1, gracia: 1 }
};

/**
 * El perfil sale del ancho de MAQUETA, no del tamaño físico del aparato.
 *
 * La capacidad de renglones depende de cuánto texto entra en una línea, y eso
 * lo decide el ancho disponible. En «modo escritorio» un teléfono presenta una
 * maqueta de 980 px: se ve y se comporta como una tableta, así que le toca la
 * capacidad de tableta (1 + 1). Elegirla con `screen.width` daba 412 y
 * aplicaba el perfil de teléfono a una maqueta que no lo es.
 */
export function perfilPara(anchoMaqueta) {
  const w = typeof anchoMaqueta === 'number'
    ? anchoMaqueta
    : (typeof window !== 'undefined' ? window.innerWidth : 0);
  return w >= 768 ? PERFILES.ancho : PERFILES.telefono;
}

/** Convierte puntos a rem: con la raíz compensada, 1 rem = 12 pt. */
export function ptARem(pt) {
  return pt / 12;
}

/**
 * Cuenta los renglones REALES de un elemento de texto.
 *
 * Con `Range.getClientRects()`, que devuelve una caja por renglón. Dividir la
 * altura entre el interlineado no sirve: las métricas de la tipografía
 * sobresalen por arriba y por abajo y el resultado se desvía.
 */
export function contarRenglones(el) {
  if (!el || typeof document === 'undefined') return 0;
  const r = document.createRange();
  r.selectNodeContents(el);
  const cajas = [...r.getClientRects()].filter(c => c.width > 0 || c.height > 0);
  if (!cajas.length) return 0;

  /* Se agrupa por posición vertical con TOLERANCIA, no por igualdad exacta.
     Un mismo renglón puede devolver varias cajas —texto y emoji usan
     tipografías distintas, y sus cajas no arrancan en el mismo píxel— con
     `top` a uno o dos píxeles de distancia. Comparando `Math.round(top)` se
     contaban como renglones distintos: medido, un párrafo de 100 caracteres
     «ocupaba 3 renglones» a 8 pt, que es imposible de lo ancho que era.
     La tolerancia es media línea: menos que eso es el mismo renglón. */
  const lh = parseFloat(getComputedStyle(el).lineHeight);
  const tol = Number.isFinite(lh) && lh > 0 ? lh / 2 : 8;

  const tops = cajas.map(c => c.top).sort((x, y) => x - y);
  let renglones = 1;
  let ancla = tops[0];
  for (const top of tops) {
    if (top - ancla > tol) { renglones++; ancla = top; }
  }
  return renglones;
}

/** Ancho del texto de `el`, medido con Range y no con la caja. */
export function anchoTexto(el) {
  if (!el || typeof document === 'undefined') return 0;
  const r = document.createRange();
  r.selectNodeContents(el);
  const cajas = [...r.getClientRects()].filter(c => c.width > 0);
  return cajas.length ? Math.max(...cajas.map(c => c.width)) : 0;
}

/** Ancho que el texto puede usar dentro de su caja: el interior, sin relleno.
 *
 * `clientWidth` YA excluye el borde y YA incluye el relleno, así que solo hay
 * que descontar el relleno. Restar también el borde quitaba ~2 px de más y la
 * cuenta decía que el texto no cabía cuando sí cabía (o al revés, según el
 * redondeo), con lo que el ajuste se detenía un paso antes o uno después. */
export function anchoUtil(el) {
  if (!el || typeof getComputedStyle !== 'function') return 0;
  const cs = getComputedStyle(el);
  const relleno = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  return Math.max(0, el.clientWidth - relleno);
}

/** ¿Este elemento es un título y le toca el techo de 24 pt? */
export function esTitulo(el) {
  if (!el) return false;
  if (/^H[1-6]$/.test(el.tagName)) return true;
  const c = (el.className || '').toString();
  return /(^|\s)(titulo|menu-titulo)(\s|$)/.test(c);
}

/**
 * Deja un texto sin recorte ni tamaño impuesto.
 *
 * Se llama al empezar: si una pasada anterior dejó un `maxBlockSize`, medir
 * ahora leería el texto YA RECORTADO, creería que cabe y el corte sobreviviría
 * sin que nada lo note.
 */
export function limpiar(el) {
  el.style.maxBlockSize = '';
  el.style.overflow = '';
  el.style.textOverflow = '';
}

/**
 * ¿El texto cabe en la capacidad?
 *
 * Son DOS condiciones, no una. Contar renglones detecta el texto que baja de
 * línea, pero no el que se sale de lado: una palabra que no puede partirse
 * —«Preguntas», «Renombrar»— ocupa UN renglón aunque su caja sea más angosta
 * que la palabra, y el conteo la da por buena mientras el texto se desborda
 * sobre el botón vecino. Medido en el modal de temas: los tres botones se
 * pisaban entre sí y el ajuste no los tocaba porque «cabían en un renglón».
 *
 * @param {{renglones: number, desborda: boolean}} medida
 * @param {number} capacidad
 * @returns {boolean}
 */
export function cabe({ renglones, desborda }, capacidad) {
  return !desborda && renglones <= capacidad;
}

/**
 * Ajusta un GRUPO de textos a un mismo tamaño.
 *
 * Es un grupo y no un elemento suelto porque piezas hermanas —las tres
 * descripciones de juego, por ejemplo— tienen que quedar del MISMO tamaño: si
 * cada una se ajusta por su cuenta, la más larga baja a 10 pt y la más corta
 * se queda en 16, y la lista deja de ser legible. La skill lo pide igual:
 * una celda, un tamaño; la jerarquía se marca con peso y color.
 *
 * @param {HTMLElement[]} els
 * @param {object} [o]
 * @param {number[]} [o.pasos] escalera de tamaños en pt
 * @param {number} [o.renglones] capacidad declarada
 * @param {number} [o.gracia] líneas extra disponibles tras el suelo
 * @returns {{pt: number, renglones: number, graciaUsada: boolean, recortado: boolean}}
 */
/**
 * ¿Este elemento es una caja de texto, o un contenedor de maquetación?
 *
 * Caja de texto: no tiene hijos, o sus hijos son todos de línea (`<b>`,
 * `<em>`, `<span>`…), que es texto enriquecido y se mide como texto.
 *
 * Contenedor: tiene al menos un hijo de bloque (`<div>`, `<p>`, `<button>`…).
 * Ese no se ajusta: su letra no es la que se ve.
 *
 * Se decide por `tagName` y no por `getComputedStyle` para que la cuenta sea
 * la misma en el navegador y en las pruebas, que corren sin DOM.
 */
const EN_LINEA = new Set([
  'B', 'I', 'EM', 'STRONG', 'SPAN', 'BR', 'SMALL', 'SUP', 'SUB',
  'MARK', 'U', 'CODE', 'TIME', 'ABBR', 'S', 'Q', 'CITE', 'KBD'
]);

export function esCajaDeTexto(el) {
  if (!el) return false;
  const hijos = el.children;
  if (!hijos || typeof hijos.length !== 'number') return true;
  for (let i = 0; i < hijos.length; i++) {
    const hijo = hijos[i];
    const etiqueta = String(hijo?.tagName || '').toUpperCase();
    if (etiqueta === 'BR') continue;
    if (!EN_LINEA.has(etiqueta)) return false;
  }
  return true;
}

export function ajustarGrupo(els, { pasos, renglones, gracia, categoria, llenar = false } = {}) {
  /* SOLO CAJAS DE TEXTO.
   *
   * Un rol con selector amplio puede casar con un CONTENEDOR de maquetación
   * —un <main>, una rejilla, una fila de botones—. Ajustar eso como si fuera
   * texto lo rompe: `contarRenglones` cuenta los renglones de todos sus
   * descendientes, así que el contenedor "nunca cabe", se va al último paso
   * y termina con `overflow:hidden` y `maxBlockSize` de dos renglones. El
   * panel del presentador quedó en 28 px de alto con 1010 px de contenido, y
   * la pantalla se veía vacía.
   *
   * Un contenedor no tiene un tamaño de letra propio que ajustar: lo que se
   * ajusta es el texto que hay dentro. Se descarta y se sigue con el resto. */
  const grupo = [...(els || [])].filter(Boolean).filter(esCajaDeTexto);
  const perfil = perfilPara();
  const capacidad = typeof renglones === 'number' ? renglones : perfil.renglones;
  const extra = typeof gracia === 'number' ? gracia : perfil.gracia;

  if (!grupo.length) return { pt: 0, renglones: 0, graciaUsada: false, recortado: false };

  /* La escalera sale de la categoría declarada en el rol. Solo si no se
     declaró se adivina por la etiqueta del elemento. */
  const cat = categoria || (esTitulo(grupo[0]) ? 'titulo' : 'contenido');
  const techoRol = cat === 'titulo' ? ESCALA.titulo.techo
    : cat === 'etiqueta' ? ESCALA.etiqueta.techo
    : ESCALA.contenido.techo;

  /*
   * CON `llenar`, EL TECHO Y LA CAPACIDAD SALEN DE LA CAJA.
   *
   * Es lo que pidió Christian: «que cada pregunta entre en el máximo de sus
   * dimensiones de campo de escritura». Un tamaño fijo no puede hacer eso: en
   * una caja alta desperdicia la mitad del espacio y en una baja desborda.
   *
   * Se calcula cuántos renglones caben en el alto disponible y se arranca
   * desde el tamaño más grande que quepa en UNO de esos renglones. Así el
   * texto crece hasta llenar su campo, sea cual sea el aparato, sin que nadie
   * elija un número a mano.
   *
   * El techo NO es un numero elegido a mano: `techoDeLaCaja` lo deriva del
   * alto real dividido por el interlineado. Pasarse seria desbordar; quedarse
   * corto, desperdiciar el campo. El suelo de accesibilidad sigue mandando.
   */
  let capacidadEfectiva = capacidad;
  let techo = techoRol;
  if (llenar) {
    const medidas = grupo.map(el => {
      const renglones = renglonesQueCaben(el);
      return { renglones, techo: techoDeLaCaja(el, renglones) };
    }).filter(m => Number.isFinite(m.renglones));

    if (medidas.length) {
      /* El caso que manda es el MAS apretado del grupo: si un elemento tiene
         menos alto, su medida es la que decide, o el texto se saldría en ese. */
      capacidadEfectiva = Math.max(1, Math.min(...medidas.map(m => m.renglones)));
      const techoCaja = Math.min(...medidas.map(m => m.techo));
      if (Number.isFinite(techoCaja)) {
        techo = Math.max(techoRol, Math.floor(techoCaja));
      }
    }
    /* Sin caja medible se queda el techo del rol: comportamiento de antes. */
  }

  const escalones = pasos || escalera(techo);

  for (const el of grupo) {
    limpiar(el);
    // Un elemento en línea mide exacto su texto: «no cabe» nunca sería cierto.
    if (typeof getComputedStyle === 'function' && getComputedStyle(el).display === 'inline') {
      el.style.display = 'block';
    }
  }

  /**
   * Prueba un tamaño en todo el grupo y devuelve el peor caso.
   *
   * Devuelve renglones Y si algo desborda a lo ancho. Lo segundo es
   * imprescindible: un texto que no puede partirse no gana renglones, se sale
   * de su caja, y sin esta comprobación el ajuste lo declararía correcto.
   */
  const probar = pt => {
    let peor = 0;
    let desborda = false;
    for (const el of grupo) {
      el.style.fontSize = ptARem(pt) + 'rem';
      peor = Math.max(peor, contarRenglones(el));
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2) desborda = true;
      /* Y ADEMÁS, EL TEXTO CONTRA SU CAJA. `scrollWidth` no ve este caso: con
       * `overflow: visible` la caja no crece, mide lo mismo que su
       * `clientWidth`, y el texto se sale pintándose encima del botón vecino.
       * Medido en la lista de versículos: «Editar» quedaba debajo de «Borrar»
       * con las dos cajas perfectamente dentro de la tarjeta.
       *
       * La tolerancia es 1 px, no 2: con 2 el texto podía salirse un píxel y
       * medio sin que el ajuste lo notara, y en pantalla ya se ve cortado. */
      if (el.clientWidth > 0 && anchoTexto(el) > anchoUtil(el) + 1) desborda = true;
    }
    return { renglones: peor, desborda };
  };

  // 1 y 2: el MAYOR tamaño con el que todos entran en la capacidad declarada.
  for (const pt of escalones) {
    if (cabe(probar(pt), capacidadEfectiva)) {
      return { pt, renglones: contarRenglones(grupo[0]), graciaUsada: false, recortado: false };
    }
  }

  // 3: se tocó el suelo y no entró. Ahora sí, la gracia: N+1.
  const conGracia = capacidadEfectiva + extra;
  for (const pt of escalones) {
    if (cabe(probar(pt), conGracia)) {
      return { pt, renglones: contarRenglones(grupo[0]), graciaUsada: true, recortado: false };
    }
  }

  // 4: ni con la gracia. Al suelo de su categoría, y ahí se recorta.
  const sueloPropio = escalones[escalones.length - 1];
  probar(sueloPropio);
  for (const el of grupo) {
    el.style.overflow = 'hidden';
    el.style.textOverflow = 'ellipsis';
    el.style.maxBlockSize = (conGracia * 1.3).toFixed(2) + 'em';
  }
  return { pt: sueloPropio, renglones: contarRenglones(grupo[0]), graciaUsada: true, recortado: true };
}

/**
 * Selectores que se ajustan como grupo propio.
 *
 * La insignia va aparte y ANTES: es una etiqueta corta que ocupa buena parte
 * del ancho de la tarjeta, y encogiéndola primero se libera sitio para el
 * nombre y la descripción, que son los que necesitan entrar en un renglón.
 */
export const ROLES = [
  /* LOS CUATRO BOTONES DEL MENÚ SON UNA SOLA DECISIÓN.
     Se seleccionan por CONTENEDOR (`> button`), no por clase. En el HTML dos
     son `.boton-grande` y dos `.boton`, y agrupar por clase dejaba fuera a la
     mitad: medido, dos botones quedaron en 18 pt y dos sin ajustar. Lo que
     decide el grupo es compartir la fila, no el nombre de la clase.

     Y NO declaran capacidad: la toman del perfil, que es 1 + 1 en tableta y
     PC —lo que declaraste— y 2 + 1 en teléfono. Declararla aquí otra vez
     anularía el perfil, que fue exactamente el error anterior. */
  /*
     EL MENÚ PRINCIPAL VA EN 1 + 1, EN TODOS LOS PERFILES.
     El usuario lo declaró así: en teléfono el perfil daba 2 renglones y los
     botones y las tarjetas se veían desbordados o cortados. Se declara la
     capacidad UNA vez, aquí, y no se deja al perfil: el perfil describe la
     pantalla en general, y el menú tiene su propia decisión.

     Solo cambia el teléfono: en tableta y PC el perfil ya era 1 + 1. */
  { sel: '.menu-acciones > button', categoria: 'contenido', renglones: 1 },
  { sel: '.juego-tarjeta .insignia', categoria: 'etiqueta', renglones: 1 },
  /* NOMBRES Y DESCRIPCIONES DEL MENÚ: 2 + 1, no 1 + 1.
   *
   * Christian lo declaró el 21/11/2026: «en menu horizontal en la parte de
   * escoger el juego no se lee el nombre del juego, usa varias filas para
   * distintos juegos si hace falta».
   *
   * Por qué estaba mal en 1 + 1: con UNA sola línea, «Completar el versículo»
   * y su descripción no caben en el ancho de una tarjeta, así que el ajuste
   * las encogía hasta el SUELO de 8 pt. No era un problema de maqueta: era la
   * capacidad declarada la que no daba margen. Medido antes del cambio, en
   * 390x844: descripción a 10.67 px = 8 pt, el último recurso de la escala.
   *
   * Con dos líneas el texto entra sin bajar del techo, y la tarjeta puede
   * crecer en alto, que es lo que él pidió. La excepción a «el resto de la
   * interfaz va en 1 + 1» es suya y está aquí, visible, no escondida. */
  { sel: '.juego-tarjeta .nombre', categoria: 'contenido', renglones: 2 },
  /* TRES renglones para la descripcion, no dos.
   *
   * Christian: «deberia ser una letra... normal. no ajustada al espacio
   * disponible». Con letra normal, la descripcion de «Completar el
   * versiculo» no cabe en dos renglones de 257 px: medido, el ajuste la
   * dejaba en 11 pt en el telefono y 9 pt acostado, que es exactamente lo que
   * el rechaza. La letra no se encoge: se le da el renglon que necesita. */
  { sel: '.juego-tarjeta .desc', categoria: 'contenido', renglones: 3 },
  /* Títulos: techo de 24 pt. Entran todos los encabezados, incluido el h1
     de la portada, que antes se quedaba con el tamaño de la hoja y partía en
     dos renglones sin que nadie comprobara si encogiendo cabía en uno. */
  { sel: 'h1', categoria: 'titulo' },
  { sel: 'h2', categoria: 'titulo' },
  { sel: '.menu-seccion', categoria: 'titulo', renglones: 1 },
  /* El título grande de la portada y el resto del menú, acotados con
     `.menu-cuerpo` para que la misma capacidad no se aplique a los h1 de
     otras pantallas, que no son este caso. */
  { sel: '.menu-titulo h1', categoria: 'titulo', renglones: 1 },
  { sel: '.menu-juego-actual', categoria: 'contenido', renglones: 1 },
  { sel: '.menu-pie', categoria: 'etiqueta', renglones: 1 },
  { sel: '.menu-lema', categoria: 'contenido', renglones: 1 },

  /* --- completar el versículo --------------------------------------- */
  /* El panel del presentador va entero en 1 + 1; el versículo, en 2 + 1.
     Lo pidió el usuario, y va declarado aquí, en un solo sitio visible. */
  /* SIN `.panel-host` A SECAS. Ese selector casaba con el <main> entero y
     el ajuste lo trataba como una caja de texto: no cabía en un renglón, se
     recortaba y el panel quedaba en 28 px. Lo que se ajusta es el texto de
     dentro, que son los tres selectores que siguen. */
  { sel: '.panel-host .aviso, .panel-host .mini, .panel-host .chico',
    categoria: 'contenido', renglones: 1 },
  { sel: '.panel-host .boton, .panel-host button',
    categoria: 'contenido', renglones: 1 },
  { sel: '.participante .nombre-j, .participante .chico',
    categoria: 'contenido', renglones: 1 },

  /* Participante y televisor: el versículo manda, 2 + 1. El resto del
     texto va en 1 + 1. */
  { sel: '.jugador-versiculo .ref, .jugador-versiculo .aviso, .barra-jugador',
    categoria: 'contenido', renglones: 1 },
  /* `llenar: true`: el texto crece hasta llenar su caja, en vez de quedarse en
     un techo fijo. Es lo que pidio Christian: «que cada pregunta entre en el
     maximo de sus dimensiones de campo de escritura». En el participante la
     caja es alta y el versiculo es el contenido que hay que leer; en el
     televisor, mas aun. El tope de 40 pt evita que un versiculo de tres
     palabras se convierta en un cartel. */
  { sel: '.jugador-versiculo .versiculo, .cuerpo-tv .versiculo',
    categoria: 'titulo', renglones: 2, llenar: true },
  { sel: '.tv-top .ref, .tv-top .sala, .pie-tv .aviso',
    categoria: 'contenido', renglones: 1 },
  { sel: '.codigo-grande', categoria: 'titulo', renglones: 1 },
  { sel: '.espera-txt, .lista-aportes', categoria: 'contenido', renglones: 1 },
  { sel: '.modal-caja h2, .modal-caja h3', categoria: 'titulo', renglones: 1 },
  { sel: '.casilla .palabra, .casilla .quien-dijo', categoria: 'contenido', renglones: 1 },
  /* Párrafos explicativos. El usuario declaró la capacidad 1 + 1 para TODO el
     texto de la interfaz, así que la prosa también entra: si no cabe en dos
     renglones, encoge. Lo que NO se hace es inventarle una capacidad propia
     (4 renglones fue un error mío, nadie la había declarado): hereda el
     perfil, como el resto. */
  { sel: '.tenue', categoria: 'contenido' },
  /* Botones de las listas de administración (temas y preguntas). Son etiquetas
     cortas que comparten fila, así que van como UN grupo y con el mismo
     tamaño. Sin ajustar, el texto se salía de su caja y los botones se pisaban
     entre sí: el nombre de la clase los deja encogerse, pero la letra no.
     Capacidad 1 + 1 declarada por el usuario: en la lista de versículos los
     botones van a la derecha y en un renglón, y cuando no caben se encoge la
     letra, no se baja el botón debajo de la referencia. */
  { sel: '.lista-versiculos .boton-mini', categoria: 'contenido', renglones: 1,
    porCaja: '.pregunta-fila' },
  /* Los botones que NO son de la lista de versículos, nombrados por su acción.
     Los de versículos ya se ajustaron arriba, cada tarjeta por su cuenta; si
     entraran también aquí volverían a juntarse en un solo grupo y se perdería
     ese ajuste. Se nombran por `data-accion` y no con un `:not(...)` de
     descendiente, que es frágil y no todos los navegadores resuelven igual. */
  { sel: '[data-accion="editar-pregunta"], [data-accion="borrar-pregunta"], ' +
         '[data-accion="borrar-tema"]',
    categoria: 'contenido', renglones: 1 },
  /* Datos de la cabecera de la sala. Son contenido, así que van al techo de
     16 pt y encogen si la columna del QR se ensancha. */
  { sel: '.sala-datos .mini', categoria: 'contenido' },
  { sel: '.sala-datos .chico', categoria: 'contenido' },
  /* El enunciado de la pregunta: un TÍTULO, con techo de 24 pt.
     Es el ÚNICO rol con capacidad propia, y la declaró el usuario: 2 + 1.
     Con la capacidad del perfil (1 renglón) el ajuste bajaba la pregunta hasta
     el suelo de 8 pt para forzarla en una sola línea, y una pregunta se lee,
     no se adivina. Con 2 declarados puede quedarse en 2 líneas con la letra
     grande, y todavía tiene el renglón de gracia si el texto es más largo.
     Va aquí, en un solo lugar visible, que es donde la skill manda declararla. */
  { sel: '.enunciado', categoria: 'titulo', renglones: 2 },

  /* TODO TEXTO DE VERSÍCULO VA EN 2 + 1. Regla dura del proyecto, declarada
     por el usuario el 20/11/2026: un versículo parte en dos renglones casi
     siempre, y forzarlo a uno obliga al ajuste a bajarlo al suelo de 8 pt,
     donde se adivina en vez de leerse.

     Son tres sitios y van los tres, con la MISMA capacidad: el versículo en
     juego (participante y televisor, más arriba), la vista previa del editor
     mientras se marca, y el texto con huecos de la lista de un tema. Si uno
     se quedara fuera, el mismo versículo saldría de dos tamaños según la
     pantalla. */
  { sel: '.texto-versiculo', categoria: 'contenido', renglones: 2 },
  { sel: '.lista-versiculos p', categoria: 'contenido', renglones: 2,
    porCaja: '.pregunta-fila' },

  /* LOS BOTONES DEL EDITOR DE VERSÍCULO VAN EN 1 + 1.
     Declarado por el usuario el 20/11/2026. Se ajustan por CONTENEDOR y no por
     clase: lo que hace grupo es compartir la fila, no el nombre de la clase.
     Antes no estaban en ninguna lista y no se ajustaban: «Ocultar palabra:
     ACTIVO» partía en tres renglones dentro de un teléfono vertical y el
     botón se veía deforme.

     El estado de «Ocultar palabra» cambia a amarillo con el modo armado, y esa
     etiqueta es la más larga de la fila: por eso el grupo incluye el `?` que
     va a su lado, para que los dos se ajusten a la vez y no queden de dos
     tamaños. */
  /* LOS RÓTULOS DEL FORMULARIO DEL PRESENTADOR, A UNA LÍNEA.
     Christian: «ajústale el text-fitting para que quepan en una sola línea
     para que así sus Select puedan desplazarse hacia arriba un poco».
     Con dos renglones, los dos rótulos empujaban los selects hacia abajo.
     Ahora el ajuste encoge el texto hasta que entra en uno. */
  { sel: '.rotulo-campo', categoria: 'contenido', renglones: 1 },

  { sel: '.modal [data-accion="alternar-modo-ocultar"], ' +
         '.modal [data-accion="ayuda-ocultar"]',
    categoria: 'contenido', renglones: 1 },
  { sel: '.modal [data-accion="deshacer-hueco"]',
    categoria: 'contenido', renglones: 1 },
  /* El pie del editor: «← Menú», «Cancelar» y «Guardar». Comparten fila y
     tienen que verse del mismo tamaño. */
  { sel: '[data-form="versiculo"] > .fila > .boton',
    categoria: 'contenido', renglones: 1 },

  /* La referencia de cada ficha, 2 + 1. En un teléfono vertical la tarjeta
     deja ~120 px al lado de «Editar» y «Borrar», y a 16 pt
     «2 Tesalonicenses 3:16» no entra en un renglón: sin capacidad propia se
     parte por la mitad de la palabra («Tesalonicens / es»). Con 2 renglones
     el ajuste encoge la letra hasta que el nombre del libro cabe entero y el
     número baja al segundo renglón. */
  { sel: '.lista-versiculos .fila-entre > span', categoria: 'contenido', renglones: 2,
    porCaja: '.pregunta-fila' },
  /* Las cuatro respuestas comparten UNA decisión: son hermanas de la misma
     rejilla y el jugador las lee comparándolas. Van como un solo grupo para
     que las cuatro queden del mismo tamaño, no una por una. */
  { sel: '.opciones .opcion > span:not(.letra)', categoria: 'contenido' },

];

/**
 * Alto que el texto puede usar dentro de su caja, en píxeles.
 *
 * Es la mitad que faltaba del ajuste: solo se miraba el ANCHO. Por eso un
 * texto podía quedar diminuto en una caja con medio palmo libre, que es lo
 * que se veía en el teléfono: el diseño aprovecha el espacio y la app no.
 *
 * - Si la caja tiene alto propio (es un ítem flex con altura asignada), ese es
 *   el espacio: su `clientHeight` menos el relleno.
 * - Si el alto es automático (`clientHeight` 0 o el del contenido), el espacio
 *   real es el que le deja su contenedor: el alto del padre menos el relleno y
 *   menos lo que ya ocupan sus hermanos.
 * - Sin contenedor medible devuelve `Infinity`: «no hay tope», y entonces el
 *   ajuste se queda con la capacidad declarada, como antes.
 */
export function altoUtil(el) {
  if (!el || typeof getComputedStyle !== 'function') return Infinity;
  const cs = getComputedStyle(el);
  const relleno = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);

  const propio = el.clientHeight - relleno;
  if (propio > 0 && cs.flex !== 'none' && /\d/.test(cs.flexBasis ?? '')) return propio;
  if (propio > 0 && cs.display !== 'block' && cs.height !== 'auto') return propio;

  const padre = el.parentElement;
  if (!padre || typeof getComputedStyle !== 'function') return Infinity;
  const csP = getComputedStyle(padre);
  const rellenoP = (parseFloat(csP.paddingTop) || 0) + (parseFloat(csP.paddingBottom) || 0);
  const delPadre = padre.clientHeight - rellenoP;
  if (!(delPadre > 0)) return Infinity;

  let ocupado = 0;
  for (const hermano of padre.children) {
    if (hermano === el) continue;
    ocupado += hermano.getBoundingClientRect().height;
  }
  const hueco = delPadre - ocupado;
  return hueco > 0 ? hueco : Infinity;
}

/**
 * El tamaño MÁXIMO, en pt, que puede tener el texto sin salirse de su caja.
 *
 * Sale de la geometría, no de un número elegido: un renglón mide
 * `font-size × interlineado`, así que el tamaño más grande que puede dibujarse
 * dentro de un alto dado es `alto / interlineado`. Pasarse de ahí es
 * desbordar; quedarse corto es desperdiciar el campo.
 *
 * Se devuelve en pt porque es la unidad de la escalera (`ESCALA`), con la
 * misma conversión que usa `ptARem`: `pt = px × 12 / raíz`.
 *
 * `Infinity` cuando no hay caja medible: sin dato no se inventa un tope.
 */
export function techoDeLaCaja(el, renglones = 1) {
  if (!el || typeof getComputedStyle !== 'function') return Infinity;
  const alto = altoUtil(el);
  if (!Number.isFinite(alto)) return Infinity;

  const cs = getComputedStyle(el);
  const fs = parseFloat(cs.fontSize);
  const lh = parseFloat(cs.lineHeight);
  if (!Number.isFinite(fs) || fs <= 0 || !Number.isFinite(lh) || lh <= 0) return Infinity;

  /* Interlineado como proporción del tamaño: así no depende del tamaño que
     tenga puesto ahora mismo, que es justo lo que vamos a cambiar. */
  /* Se divide entre los renglones que el texto puede usar. Sin esto el techo
     seria el de UNA linea que ocupa toda la caja: en el participante daba
     120 pt, y la escalera arrancaba en un tamano absurdo para bajar de uno en
     uno hasta que cupiera, con decenas de remaquetados inutiles.
     Con el reparto, el techo es el tamano con el que N renglones llenan la
     caja entera, que es exactamente lo que hay que probar primero. */
  const cant = Number.isFinite(renglones) && renglones > 0 ? renglones : 1;
  const proporcion = lh / fs;
  const pxMax = alto / (proporcion * cant);

  const raiz = raizPx() || REM;
  return (pxMax * 12) / raiz;
}

/**
 * Cuántos renglones caben en el alto disponible del elemento.
 *
 * `Infinity` cuando no hay tope: ahí manda la capacidad declarada en el rol.
 */
export function renglonesQueCaben(el) {
  const alto = altoUtil(el);
  if (!Number.isFinite(alto)) return Infinity;
  const lh = parseFloat(getComputedStyle(el).lineHeight);
  if (!Number.isFinite(lh) || lh <= 0) return Infinity;
  return Math.max(1, Math.floor(alto / lh));
}

/**
 * Separa los elementos por la caja a la que pertenecen.
 *
 * Vive aparte de `ajustarTextos` para poder probarla sin navegador: recibe
 * elementos con `closest` y devuelve listas. Sin esto, la única forma de
 * comprobar que cada tarjeta se ajusta por su cuenta seria mirar la pantalla.
 *
 * Los elementos que no cuelgan de ninguna caja se descartan: no hay a qué
 * grupo pertenecerlos.
 *
 * @param {Array} els      elementos candidatos
 * @param {string} selector del ancestro que define la caja
 * @returns {Array<Array>} un grupo por caja, en el orden en que aparecen
 */
export function agruparPorCaja(els, selector) {
  const cajas = new Map();
  for (const el of els || []) {
    const caja = el && typeof el.closest === 'function' ? el.closest(selector) : null;
    if (!caja) continue;
    if (!cajas.has(caja)) cajas.set(caja, []);
    cajas.get(caja).push(el);
  }
  return [...cajas.values()];
}

/**
 * Ajusta los textos declarados en ROLES, agrupados por familia.
 *
 * POR QUÉ UNA LISTA Y NO TODOS LOS TEXTOS. Se probó a descubrir solo cada
 * elemento con texto propio y ajustarlo. Funciona, pero hunde la pestaña: son
 * decenas de elementos y cada paso de la escalera obliga al navegador a
 * recalcular la maqueta entera. Medido en el teléfono: la página dejaba de
 * responder a cualquier evaluación. La lista declarada son seis familias y su
 * costo es despreciable; si algún día hace falta cubrir más piezas, se añaden
 * aquí, no se abre la puerta a todas.
 *
 * @param {ParentNode} [raiz]
 * @returns {number} cuántos textos se ajustaron
 */
export function ajustarTextos(raiz) {
  const base = raiz || (typeof document !== 'undefined' ? document : null);
  if (!base || typeof base.querySelectorAll !== 'function') return 0;

  let n = 0;
  for (const rol of ROLES) {
    const els = [...base.querySelectorAll(rol.sel)];
    if (!els.length) continue;
    const opciones = {
      ...(rol.renglones != null ? { renglones: rol.renglones } : {}),
      ...(rol.categoria ? { categoria: rol.categoria } : {}),
      /* `llenar` lo declara el rol: es el que sabe si su caja tiene un alto
         que aprovechar. Por omision no se toca nada, para no cambiar el
         aspecto de las pantallas que ya estaban bien. */
      ...(rol.llenar ? { llenar: true } : {}),
    };

    /* CON `porCaja`, CADA CAJA ES SU PROPIA DECISIÓN.
     *
     * Por omisión todos los elementos de un rol son UN grupo y comparten un
     * solo tamaño, que es lo correcto cuando se leen comparándolos (las cuatro
     * respuestas de una pregunta, los botones de una fila).
     *
     * Pero las tarjetas de versículos no se comparan: una puede tener 140
     * caracteres y la de al lado 40. Metidas en el mismo grupo, la corta se
     * encoge hasta el tamaño de la larga y queda con letra chica sin motivo,
     * y una tercera partida en dos renglones tampoco puede crecer. Lo pidió
     * el usuario el 20/11/2026: cada tarjeta ajusta sola.
     *
     * `porCaja` es el selector del ancestro que define la tarjeta; los
     * elementos que cuelgan del mismo ancestro van juntos. */
    if (rol.porCaja) {
      for (const grupo of agruparPorCaja(els, rol.porCaja)) {
        ajustarGrupo(grupo, opciones);
        n += grupo.length;
      }
      continue;
    }

    // Sin `porCaja`: todos los hermanos de un rol comparten tamaño.
    ajustarGrupo(els, opciones);
    n += els.length;
  }
  return n;
}
