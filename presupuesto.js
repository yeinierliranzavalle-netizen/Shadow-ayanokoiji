import { gKV } from './shared.js';

const AREAS = {
  chat: 50,
  procesamiento: 300,
  sandbox: 25,
  publisher: 20,
  vision: 10
};

function hoy() {
  return new Date().toISOString().split('T')[0];
}

export async function consumir(e, area) {
  const kv = gKV(e, 'agente');
  if (!kv) return true;
  const clave = 'presupuesto:' + hoy() + ':' + area;
  const actual = parseInt(await kv.get(clave) || '0');
  const limite = AREAS[area] || 50;
  if (actual >= limite) return false;
  await kv.put(clave, String(actual + 1), { expirationTtl: 86400 });
  return true;
}

export async function disponible(e, area) {
  const kv = gKV(e, 'agente');
  if (!kv) return true;
  const clave = 'presupuesto:' + hoy() + ':' + area;
  const actual = parseInt(await kv.get(clave) || '0');
  const limite = AREAS[area] || 50;
  return actual < limite;
}

export async function estadoPresupuesto(e) {
  const kv = gKV(e, 'agente');
  if (!kv) return {};
  const res = {};
  for (const area of Object.keys(AREAS)) {
    const clave = 'presupuesto:' + hoy() + ':' + area;
    const actual = parseInt(await kv.get(clave) || '0');
    res[area] = { usado: actual, limite: AREAS[area], restante: AREAS[area] - actual };
  }
  return res;
}
