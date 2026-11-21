/* Prueba de «acceso»: puro cálculo, sin navegador y sin red.

   Lo que se protege, con las palabras de Christian:
   «se puede solicitar la clave y que solo se entre si es correcta y que la
   informacion se muestre despues de la autenticacion. todo lo relacionado al
   proyecto, osea menu de crear salas, panel del presentador y configuracion
   del proyecto y presentacion, deberian estar ocultos antes de la
   autenticacion».

   La regla, en una linea: el panel del presentador y la configuracion NO se
   abren sin clave; el menu, la entrada del jugador y el televisor SI.
*/
import { requiereClave, puedeEntrar, VISTAS_CON_CLAVE } from './acceso.js';

let ok = 0, fail = 0;
const t = (c, m) => { if (c) { ok++; console.log('  ok   ' + m); } else { fail++; console.log('  FALLA ' + m); } };

console.log('=== acceso: que vistas piden clave ===');

t(requiereClave('host'), 'host (panel del presentador) pide clave');
t(requiereClave('config'), 'config (configuracion del proyecto) pide clave');

console.log('\n=== acceso: que vistas NO piden clave ===');

t(!requiereClave('menu'), 'menu NO pide clave: es la portada');
t(!requiereClave('join'), 'join NO pide clave: el jugador entra con un codigo');
t(!requiereClave('tv'), 'tv NO pide clave: el televisor solo mira');
t(!requiereClave('play'), 'play NO pide clave: el participante ya esta jugando');

console.log('\n=== acceso: sin clave no se entra ===');

t(!puedeEntrar('host', null), 'sin clave NO se entra al panel');
t(!puedeEntrar('config', null), 'sin clave NO se entra a configuracion');
t(!puedeEntrar('host', ''), 'clave vacia tampoco: cuenta como no tener');
t(puedeEntrar('host', '4321'), 'con clave SI se entra al panel');
t(puedeEntrar('config', '4321'), 'con clave SI se entra a configuracion');

console.log('\n=== acceso: la primera clave tiene su puerta ===');

/* LA EXCEPCION QUE NO ES UN DESCUIDO.
 * `config` es donde se establece la PRIMERA clave. Si se cerrara con una clave
 * que todavia no existe, una instalacion nueva quedaria trabada para siempre:
 * sin clave no se entra, y sin entrar no se puede crear la clave.
 *
 * Se prueba con las dos caras, para que la excepcion no se coma la
 * proteccion: sin clave configurada `config` se abre, y con clave configurada
 * vuelve a pedir la suya. */
t(puedeEntrar('config', null, { hayClaveConfigurada: false }),
  'sin clave configurada, config SI se abre: es donde se crea la primera');
t(!puedeEntrar('config', null, { hayClaveConfigurada: true }),
  'con clave configurada, config vuelve a pedir la clave');
t(!puedeEntrar('host', null, { hayClaveConfigurada: false }),
  'la excepcion es SOLO de config: host sigue cerrado aunque no haya clave');
t(!puedeEntrar('config', '', { hayClaveConfigurada: true }),
  'clave vacia no abre config cuando ya hay clave puesta');
t(puedeEntrar('config', '4321', { hayClaveConfigurada: true }),
  'con clave en la sesion, config se abre aunque ya hubiera clave');
t(!puedeEntrar('config', null),
  'sin decir nada de la clave configurada, config pide clave (lo seguro por defecto)');
t(puedeEntrar('  CONFIG  ', null, { hayClaveConfigurada: false }),
  'la excepcion tambien normaliza: «  CONFIG  » es config');

console.log('\n=== acceso: las vistas abiertas no dependen de la clave ===');

t(puedeEntrar('menu', null), 'el menu se ve sin clave');
t(puedeEntrar('join', null), 'el jugador entra sin clave');
t(puedeEntrar('tv', null), 'el televisor entra sin clave');

console.log('\n=== acceso: entradas raras ===');

t(!requiereClave(undefined), 'sin vista NO pide clave (no revienta)');
t(!requiereClave(null), 'vista nula NO pide clave (no revienta)');
t(requiereClave('  HOST  '), 'acepta mayusculas y espacios: HOST pide clave');
t(!requiereClave('hostal'), 'hostal NO es host: no confunde por prefijo');

console.log('\n=== acceso: el contrato de la lista ===');

t(Array.isArray(VISTAS_CON_CLAVE), 'VISTAS_CON_CLAVE es una lista');
t(VISTAS_CON_CLAVE.length === 2, 'son exactamente dos: host y config');
t(VISTAS_CON_CLAVE.includes('host') && VISTAS_CON_CLAVE.includes('config'),
  'y son host y config, no otras');

console.log(`\nRESULTADO: ${ok} correctas, ${fail} fallas`);
if (fail) process.exit(1);
