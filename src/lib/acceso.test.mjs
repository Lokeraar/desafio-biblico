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
import { requiereClave, puedeEntrar, resolverPuerta, VISTAS_CON_CLAVE } from './acceso.js';

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

/* ------------------------------------------------------------------ */
/* La puerta como calculo puro: COMPORTAMIENTO, no texto del fuente.   */
/* ------------------------------------------------------------------ */
console.log('\n=== acceso: la puerta de render(), paso a paso ===');

const MENU = { vista: 'menu', adminClave: null, claveConfigurada: null, modal: null };

t(resolverPuerta(MENU).permite === false || resolverPuerta(MENU).vista === 'menu',
  'el menu se ve siempre: es donde vive la puerta');
t(resolverPuerta({ ...MENU, vista: 'join' }).permite === true,
  'la entrada del jugador no pide clave');
t(resolverPuerta({ ...MENU, vista: 'tv' }).permite === true,
  'el televisor no pide clave');

// host y config piden clave cuando no hay ninguna verificada
const r1 = resolverPuerta({ ...MENU, vista: 'host' });
t(r1.permite === false, 'host no se abre sin clave verificada');
t(r1.vista === 'menu', 'y baja al menu en vez de dejar la pantalla en blanco');
t(r1.modal && r1.modal.tipo === 'clave' && r1.modal.para === 'acceso',
  'y abre el modal de la puerta');
t(r1.vistaPendiente === 'host', 'y recuerda a donde se queria ir');

// Con la clave ya verificada, pasa.
t(resolverPuerta({ ...MENU, vista: 'host', adminClave: '4321' }).permite === true,
  'con la clave verificada, host se abre');

/* LA REGRESION QUE ENCONTRO LA REVISION (R3-001).
   El guardia limpiaba el error en CADA render, asi que el mensaje de clave
   incorrecta se borraba antes de verse. */
const conError = { tipo: 'clave', para: 'acceso', error: 'Clave incorrecta' };
const r2 = resolverPuerta({ ...MENU, vista: 'host', modal: conError });
t(r2.modal === conError, 'el modal abierto NO se reemplaza: conserva su error');
t(r2.modal.error === 'Clave incorrecta', 'y el mensaje de clave incorrecta sigue visible');
t(r2.abreModal === false, 'y no se vuelve a abrir, para no borrar lo escrito');

/* R3-003: una instalacion nueva sin clave. Config se abre para crear la
   primera; host no, porque crear salas exige estar acreditado. */
const sinClave = { ...MENU, claveConfigurada: false };
t(resolverPuerta({ ...sinClave, vista: 'config' }).permite === true,
  'sin clave configurada, configuraciones se abre: es donde se crea la primera');
t(resolverPuerta({ ...sinClave, vista: 'host' }).permite === false,
  'pero host sigue cerrado aunque no haya clave');

// Mientras no se sepa, se pide: el lado seguro.
t(resolverPuerta({ ...MENU, vista: 'host', claveConfigurada: null }).permite === false,
  'con el estado sin saber, se pide clave');

// Sin servidor no hay clave que comprobar.
t(resolverPuerta({ ...MENU, vista: 'host', hayNube: false }).permite === true,
  'sin nube la puerta no se aplica: el modo local conserva su panel');

console.log(`\nRESULTADO: ${ok} correctas, ${fail} fallas`);
if (fail) process.exit(1);
