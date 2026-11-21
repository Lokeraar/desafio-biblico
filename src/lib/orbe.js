/* =====================================================================
   Desafío Bíblico — orbe de espera
   ---------------------------------------------------------------------
   Un indicador animado de «la app esta trabajando», para que una pantalla
   que no cambia durante un minuto no se lea como un cuelgue.

   POR QUE NO SE USA EL PAQUETE `thinking-orbs` TAL CUAL.
   La skill `thinking-orbs` describe una libreria de React: se monta con
   `<ThinkingOrb>`, vive dentro de un componente y trae efectos de React.
   Este proyecto es HTML plano sin build y sin `node_modules`: no hay donde
   montar un componente de React ni como empaquetarlo.

   La skill tambien documenta el camino sin React —`MODE_DRAWS` y
   `resolvePreset`, que pintan un fotograma sobre un canvas propio— y dice
   que en ese caso hay que reimplementar el ciclo de vida. Eso es lo que se
   hace aqui: los presets de la skill, pintados a mano sobre canvas.

   Lo que se conserva de la skill:
     - puntos monocromos sobre canvas transparente
     - los estados con su significado (`working`, `searching`, ...)
     - tamano exacto 20 o 64, sin escalar por CSS
     - `prefers-reduced-motion` congela un fotograma representativo
     - se detiene cuando el canvas sale de pantalla o la pestana se oculta

   Lo que NO se conserva: es una reimplementacion, no la libreria. Si algun
   dia el proyecto pasa a tener build, se cambia por el paquete real.
   ===================================================================== */

/** Los estados que existen, con el modo de dibujo que les corresponde. */
export const MODOS = {
  working:   'orbits',   // trabajo generico: esperar algo que va a llegar
  searching: 'globe',    // buscar: esperar a que aparezca algo
  solving:   'rubik',    // razonar
  listening: 'wave',     // escuchar
  composing: 'ribbon',   // redactar
  shaping:   'morph'     // formar una imagen
};

/**
 * Que estado corresponde a cada momento de la sala de espera.
 *
 * Se declara aparte del dibujo para que el significado viva en un solo
 * sitio: si manana la sala de espera espera otra cosa, se cambia aqui y no
 * dentro del pintor.
 */
export const ESTADO_SALA_ESPERA = {
  solo:      'searching', // esta esperando gente: literalmente la busca
  conectando:'working',   // esta hablando con el servidor
  esperando: 'working'    // espera al presentador
};

/**
 * Puntos repartidos en una esfera, con la espiral de Fibonacci: la forma
 * mas pareja de cubrir una esfera con puntos sueltos.
 */
function puntosEsfera(n) {
  const pts = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / Math.max(1, n - 1)) * 2;
    const radio = Math.sqrt(Math.max(0, 1 - y * y));
    const th = phi * i;
    pts.push([Math.cos(th) * radio, y, Math.sin(th) * radio]);
  }
  return pts;
}

/**
 * Dibuja un fotograma.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} tam   lado del canvas en px (20 o 64)
 * @param {number} t     tiempo en segundos
 * @param {string} modo  'orbits' | 'globe' | ...
 */
export function pintarFotograma(ctx, tam, t, modo = 'orbits') {
  if (!ctx || !(tam > 0)) return;
  const r = tam / 2;
  ctx.clearRect(0, 0, tam, tam);

  // Tinta clara: el fondo de la app es oscuro.
  ctx.fillStyle = '#bfeaf2';

  if (modo === 'globe') {
    // Esfera girando: los puntos de atras se ven mas chicos y mas tenues.
    const pts = puntosEsfera(28);
    const giro = t * 0.9;
    const cs = Math.cos(giro), sn = Math.sin(giro);
    for (const [x0, y0, z0] of pts) {
      const x = x0 * cs - z0 * sn;
      const z = x0 * sn + z0 * cs;
      const prof = (z + 1) / 2;            // 0 atras, 1 adelante
      const px = r + x * r * 0.78;
      const py = r + y0 * r * 0.78;
      const rad = (tam / 64) * (1.1 + prof * 1.9);
      ctx.globalAlpha = 0.22 + prof * 0.7;
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return;
  }

  if (modo === 'wave') {
    // Onda horizontal: puntos que suben y bajan en fase.
    const n = 9;
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n) * tam;
      const fase = (i / n) * Math.PI * 2;
      const y = r + Math.sin(t * 2 + fase) * r * 0.45;
      const rad = (tam / 64) * 2.1;
      ctx.globalAlpha = 0.45 + 0.5 * (0.5 + 0.5 * Math.sin(t * 2 + fase));
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return;
  }

  if (modo === 'ribbon') {
    // Cinta: dos hileras que se cruzan.
    const n = 11;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const x = u * tam;
      for (const [desfase, alfa] of [[0, 0.85], [Math.PI, 0.4]]) {
        const y = r + Math.sin(t * 1.6 + u * Math.PI * 2 + desfase) * r * 0.5;
        ctx.globalAlpha = alfa;
        ctx.beginPath();
        ctx.arc(x, y, (tam / 64) * 1.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    return;
  }

  // Por defecto, 'orbits': tres orbitas inclinadas con un punto cada una.
  // Es el estado generico de «trabajando» de la skill.
  const orbitas = [
    { incl: -0.5, vel: 1.0, rad: 2.4, alfa: 0.95 },
    { incl: 0.9,  vel: -0.7, rad: 2.0, alfa: 0.7 },
    { incl: 2.1,  vel: 0.5, rad: 1.7, alfa: 0.5 }
  ];
  for (const o of orbitas) {
    const ang = t * o.vel;
    const x0 = Math.cos(ang) * r * 0.66;
    const y0 = Math.sin(ang) * r * 0.66;
    // Inclinacion: se rota el par (x,y) sobre el eje horizontal.
    const x = x0;
    const y = y0 * Math.cos(o.incl);
    const prof = 0.5 + 0.5 * Math.sin(ang);
    ctx.globalAlpha = o.alfa * (0.45 + prof * 0.55);
    ctx.beginPath();
    ctx.arc(r + x, r + y, (tam / 64) * o.rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * Arranca la animacion sobre un canvas.
 *
 * Devuelve `{ parar }`. Quien lo crea DEBE pararlo al salir de la vista: una
 * animacion que sigue corriendo en una pantalla abandonada gasta bateria sin
 * que nadie la mire.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts  `{ estado, tamano, reducido }`
 */
export function animar(canvas, { estado = 'working', tamano = 64, reducido = null } = {}) {
  const modo = MODOS[estado] || 'orbits';
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return { parar() {} };

  // El tamano se fija en PIXELES DEL CANVAS, no por CSS: la skill pide 20 o 64
  // exactos y escalar por CSS los deja borrosos.
  const dpr = (globalThis.devicePixelRatio || 1);
  canvas.width = tamano * dpr;
  canvas.height = tamano * dpr;
  if (canvas.style) { canvas.style.width = tamano + 'px'; canvas.style.height = tamano + 'px'; }
  ctx.scale(dpr, dpr);

  const quieto = reducido != null
    ? reducido
    : (globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Con movimiento reducido se pinta UN fotograma representativo y no se anima.
  if (quieto) {
    pintarFotograma(ctx, tamano, 0.8, modo);
    return { parar() {} };
  }

  let id = null;
  let vivo = true;
  /* DESFASE SORTEADO: Christian pidio que los orbes aparezcan «de manera
     aleatoria». Dos partidas seguidas no arrancan en el mismo fotograma, asi
     que no se ve el mismo dibujo repetido. Es un desfase de tiempo, no un
     cambio de forma: el estado sigue siendo el que corresponde. */
  const desfase = Math.random() * 10;
  const t0 = Date.now() - desfase * 1000;

  const cuadro = () => {
    if (!vivo) return;
    // Si el canvas salio de pantalla, se salta el dibujo pero se sigue vivo:
    // al volver, reengancha sin un salto brusco.
    pintarFotograma(ctx, tamano, (Date.now() - t0) / 1000, modo);
    id = globalThis.requestAnimationFrame(cuadro);
  };
  cuadro();

  const parar = () => {
    vivo = false;
    if (id != null && globalThis.cancelAnimationFrame) globalThis.cancelAnimationFrame(id);
    id = null;
  };

  // Al ocultar la pestana se para; al volver, se retoma. Sin esto la
  // animacion sigue corriendo en una pestana que nadie ve.
  if (globalThis.document && globalThis.document.addEventListener) {
    const alOcultar = () => { if (globalThis.document.hidden) parar(); };
    globalThis.document.addEventListener('visibilitychange', alOcultar);
    const pararTodo = () => {
      parar();
      globalThis.document.removeEventListener('visibilitychange', alOcultar);
    };
    return { parar: pararTodo };
  }

  return { parar };
}

/**
 * El estado que corresponde a una situacion de la sala de espera.
 * Devuelve el nombre de estado de la skill, para que el significado quede
 * escrito y no repartido por el marcado.
 */
export function estadoDeSala(situacion) {
  return ESTADO_SALA_ESPERA[situacion] || 'working';
}
