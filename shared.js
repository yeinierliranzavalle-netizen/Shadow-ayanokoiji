export const MODELO = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const CS = 500 * 1024;
export const LPB = 120;
export const BPL = 15;

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

export function J(d) {
  return new Response(JSON.stringify(d), {
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
}

export function gDB(e, x) {
  const m = { agente: e.DB, test: e.DB_test, shadow: e.DB_shadow_arise };
  return m[x] || null;
}

export function gKV(e, x) {
  const m = { agente: e.KV, test: e.KV_test, shadow: e.KV_shadow_arise };
  return m[x] || null;
}

export function b64e(b) {
  let s = '';
  const p = 8192;
  for (let i = 0; i < b.length; i += p) {
    s += String.fromCharCode.apply(null, b.subarray(i, i + p));
  }
  return btoa(s);
}

export function b64d(x) {
  const b = atob(x);
  const a = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return new TextDecoder('utf-8').decode(a);
}

export function j2t(c) {
  let d;
  try { d = typeof c === 'string' ? JSON.parse(c) : c; } catch (e) { return String(c); }
  if (Array.isArray(d)) {
    return d.map(m => {
      if (typeof m === 'string') return m;
      const r = m.role || m.rol || m.from || m.sender || '?';
      const x = m.content || m.contenido || m.text || m.message || m.mensaje || '';
      return '[' + r + ']: ' + (typeof x === 'string' ? x : JSON.stringify(x));
    }).join('\n\n');
  }
  const k = ['messages','mensajes','conversation','conversacion','chat','historial','history','data','dialogo'];
  for (const kk of k) if (d[kk]) return j2t(d[kk]);
  return JSON.stringify(d, null, 2);
}
