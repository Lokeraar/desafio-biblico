/* Prueba de las decisiones de liberación: puro cálculo, sin navegador, sin red
   y sin esperar diez minutos a que expire un candado.

   Cada caso está pensado para FALLAR si el defecto estuviera presente. El
   defecto que motiva todo esto: tomar algo —una sesión, una sala, un botón— y
   soltarlo solo en el camino feliz. Cuando el camino se corta, la app queda
   trabada y sin decir nada. */
import {
  SESION_MUERTA, SALA_MUERTA, decidirSesionJugador, decidirSalaHost,
  avisoSesionJugador
} from './liberar.js';

let ok = 0, fail = 0;
const t = (c, m) => { if (c) { ok++; console.log('  ok   ' + m); } else { fail++; console.log('  FALLA ' + m); } };

console.log('=== liberar: sesión del participante ===');

/* --- camino feliz --- */
t(decidirSesionJugador({}) === 'seguir',
  'todo bien y sala viva: sigue');
t(decidirSesionJugador({}, { estado: 'question' }) === 'seguir',
  'todo bien en plena ronda: sigue');
t(decidirSesionJugador({}, { estado: 'ceremony' }) === 'seguir',
  'en ceremonia NO se suelta: la tabla se queda para mirarla');

/* --- la sala murió: hay que soltar --- */
t(SESION_MUERTA.has('sala_inexistente'), 'sala_inexistente es sesión muerta');
t(SESION_MUERTA.has('jugador_ausente'), 'jugador_ausente es sesión muerta');
t(SESION_MUERTA.has('sesion_incompleta'), 'sesion_incompleta es sesión muerta');

for (const error of ['sala_inexistente', 'jugador_ausente', 'sesion_incompleta']) {
  t(decidirSesionJugador({ error }) === 'olvidar',
    `con «${error}» la sesión se olvida`);
}

/* --- transitorio: NO se suelta, se reintenta --- */
t(decidirSesionJugador({ error: 'red_caida' }, { reintentosRestantes: 3 }) === 'reintentar',
  'un error de red se reintenta, no se suelta la sesión');
t(decidirSesionJugador({ error: 'timeout' }, { reintentosRestantes: 1 }) === 'reintentar',
  'un timeout se reintenta mientras queden intentos');
t(decidirSesionJugador({ error: 'red_caida' }, { reintentosRestantes: 0 }) === 'esperar',
  'sin reintentos queda esperando, con aviso, sin borrar la sesión');

/* El defecto concreto: si cualquier error borrara la sesión, un corte de señal
   expulsaría al jugador. Esta prueba lo detecta. */
t(!SESION_MUERTA.has('red_caida'),
  'un error de red NO está en la lista de sesión muerta');

/* --- sala cerrada aunque el servidor conteste bien --- */
t(decidirSesionJugador({}, { estado: 'closed' }) === 'olvidar',
  'sala cerrada: se olvida aunque la llamada saliera bien');

/* --- sin estado: no se inventa una decisión --- */
t(decidirSesionJugador({}, { estado: null }) === 'seguir',
  'sin estado no se olvida nada: no se inventa');

console.log('');
console.log('=== liberar: sala del presentador ===');

t(decidirSalaHost({}) === 'seguir', 'reabre bien: sigue');
t(decidirSalaHost({}, { estado: 'question' }) === 'seguir',
  'reabre en plena ronda: sigue');
t(decidirSalaHost({ error: 'sala_inexistente' }) === 'olvidar',
  'si no se puede reabrir, se olvida');

/* El caso que motiva la distinción: con 'ceremony' se llevaba por delante la
   tabla justo cuando el presentador la está mostrando. */
t(decidirSalaHost({}, { estado: 'ceremony' }) === 'seguir',
  'en ceremonia NO se olvida: el presentador necesita la tabla');
t(decidirSalaHost({}, { estado: 'closed' }) === 'olvidar',
  'sala cerrada: se olvida');

/* Un error de red al reabrir NO debe cerrar la sala del presentador: la sala
   vive en el servidor y su token sigue valiendo.

   DEFECTO QUE ESTO ATAJA: `reabrir` propaga el error tal cual, y el llamante
   borraba la sala guardada con CUALQUIER error. Un corte de señal al refrescar
   le borraba el panel al presentador en medio de una partida, con los
   participantes dentro y sin forma de recuperarla. */
t(decidirSalaHost({ error: 'red_caida' }, { reintentosRestantes: 2 }) === 'reintentar',
  'un corte de red al reabrir se reintenta, NO borra la sala');
t(decidirSalaHost({ error: 'timeout' }, { reintentosRestantes: 0 }) === 'esperar',
  'sin reintentos espera y avisa, sin borrar la sala');
t(SALA_MUERTA.has('sala_inexistente') && SALA_MUERTA.has('no_autorizado')
  && SALA_MUERTA.has('sesion_incompleta'),
  'solo los tres errores de sala muerta hacen olvidar');


console.log('');
console.log('=== liberar: avisos ===');

t(avisoSesionJugador('olvidar') !== null, 'olvidar tiene aviso');
t(/sesión terminó/i.test(avisoSesionJugador('olvidar')),
  'el aviso de olvidar dice que la sesión terminó');
t(/conexión/i.test(avisoSesionJugador('esperar')),
  'el aviso de esperar habla de la conexión');
t(avisoSesionJugador('seguir') === null, 'seguir no muestra aviso');
t(avisoSesionJugador('reintentar') === null,
  'reintentar no muestra aviso todavia: se avisa solo si se agotan');

console.log('');
console.log(fail === 0
  ? ` TODO EN VERDE: ${ok} correctas, 0 fallas`
  : ` FALLAS: ${ok} correctas, ${fail} fallas`);
process.exit(fail === 0 ? 0 : 1);
