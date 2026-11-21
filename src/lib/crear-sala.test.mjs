/* Prueba de «crear sala»: puro cálculo, sin navegador y sin servidor.

   Lo que se protege aquí, con las palabras de Christian:
   «hay que solicitar la clave maestra para poder crear la sala, si la
   introduce incorrectamente no se crea».

   Las tres reglas, y la tercera es la que se olvida:
     1. Sin tema no se crea, y NO se pide la clave (pedirla para después
        rechazar gasta un intento del candado sin motivo).
     2. Con tema y sin clave, se PIDE la clave.
     3. Con clave ya verificada en la sesión, se crea sin volver a pedirla.
*/
import { decidirCrearSala, AL_CREAR } from './crear-sala.js';

let ok = 0, fail = 0;
const t = (c, m) => { if (c) { ok++; console.log('  ok   ' + m); } else { fail++; console.log('  FALLA ' + m); } };

console.log('=== crear sala: sin tema ===');

t(typeof decidirCrearSala({}) === 'string', 'devuelve una cadena, no un objeto');
t(decidirCrearSala({ temaElegido: null, adminClave: null }) === AL_CREAR.SIN_TEMA,
  'sin tema y sin clave -> sin-tema (no pide clave)');
t(decidirCrearSala({ temaElegido: null, adminClave: '4321' }) === AL_CREAR.SIN_TEMA,
  'sin tema aunque HAYA clave -> sin-tema: el tema falta igual');
t(decidirCrearSala({}) === AL_CREAR.SIN_TEMA,
  'sin argumentos -> sin-tema, no revienta');

console.log('\n=== crear sala: con tema, sin clave ===');

t(decidirCrearSala({ temaElegido: 'abc', adminClave: null }) === AL_CREAR.PEDIR_CLAVE,
  'con tema y sin clave -> pedir-clave');
t(decidirCrearSala({ temaElegido: 'abc' }) === AL_CREAR.PEDIR_CLAVE,
  'sin la propiedad adminClave -> pedir-clave (no asume que hay)');

console.log('\n=== crear sala: con tema y clave ===');

t(decidirCrearSala({ temaElegido: 'abc', adminClave: '4321' }) === AL_CREAR.CREAR,
  'con tema y clave -> crear');
t(decidirCrearSala({ temaElegido: 'abc', adminClave: '' }) === AL_CREAR.PEDIR_CLAVE,
  'clave vacia cuenta como que no hay: pedir-clave');

console.log('\n=== crear sala: el orden manda ===');

/* EL CASO QUE IMPORTA. Si el orden se invierte —pedir la clave antes de mirar
   el tema— esto devolvería pedir-clave y la persona escribiría la clave para
   que después le digan que le falta el tema. */
t(decidirCrearSala({ temaElegido: null, adminClave: null }) === AL_CREAR.SIN_TEMA,
  'sin tema manda sobre pedir la clave: no se pide una llave para nada');

console.log('\n=== crear sala: los valores del contrato ===');

t(AL_CREAR.SIN_TEMA === 'sin-tema', 'SIN_TEMA vale sin-tema');
t(AL_CREAR.PEDIR_CLAVE === 'pedir-clave', 'PEDIR_CLAVE vale pedir-clave');
t(AL_CREAR.CREAR === 'crear', 'CREAR vale crear');

console.log(`\nRESULTADO: ${ok} correctas, ${fail} fallas`);
if (fail) process.exit(1);
