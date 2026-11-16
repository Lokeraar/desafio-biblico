// Configuración pública del proyecto Supabase.
//
// La clave `anon` NO es un secreto: por diseño viaja en el navegador y solo
// permite llamar a las funciones RPC. Las tablas tienen RLS sin políticas y
// están revocadas, así que el navegador no puede leer ni escribir nada
// directamente. La clave maestra del presentador NUNCA vive aquí: se verifica
// dentro de la base con `assert_master_key`.
//
// Si algún día cambias de proyecto, solo se tocan estas dos líneas.

export const SUPABASE_URL = 'https://xodghdateldeobuumhyd.supabase.co';

export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvZGdoZGF0ZWxkZW9idXVtaHlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4MDU2MTgsImV4cCI6MjExMDM4MTYxOH0.Ns1wesUhSLUYZQmxdSNYvYf5leoPMcIFS3YCt1dqKGc';

// ¿Hay proyecto configurado? Si no, la app se queda en modo local.
export const hayNube = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
