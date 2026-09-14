import { MODELO, CORS, J, gDB, gKV } from './shared.js';
import { subir, procesar, resumir, verProceso, retomar, cronRetomar, resumirChats } from './proc.js';

function di(t) {
  t = t.toLowerCase();
  if (/\b(sube|subir|guarda|guardar|memoriza|recuerda|almacena|archiva)\b/.test(t) && /\b(nucleo|núcleo|memoria|cerebro|ti|contexto)\b/.test(t)) return 'guardar_contexto';
  if (/\b(resume|resumir|resumen|sintetiza|condensa)\b/.test(t)) return 'resumir';
  if (/\b(mejora|mejorar|optimiza|optimizar)\b/.test(t) && /\b(codigo|código|nucleo|núcleo|worker|ti mismo)\b/.test(t)) return 'mejorar';
  if (/\b(actualiza|actualizar|despliega|desplegar|publica|publicar)\b/.test(t) && /\b(codigo|código|worker|nucleo|núcleo)\b/.test(t)) return 'desplegar';
  if (/\b(lee|leer|muestra|mostrar|dime|consultar|busca|recupera)\b/.test(t) && /\b(memoria|nucleo|núcleo|historial|contexto|archivo)\b/.test(t)) return 'leer';
  if (/\b(olvida|olvidar|borra|elimina|limpia)\b/.test(t) && /\b(memoria|nucleo|núcleo|historial|contexto)\b/.test(t)) return 'eliminar';
  if (/\b(estado|estatus|como estas|cómo estás|que tal)\b/.test(t)) return 'estado';
  return 'chat';
}

function sysP(ctx, f, rec) {
  let b = `Eres Ayanokōji Kiyotaka, el aliado digital del Comandante Yeinier (Shadow / Monarch).

CONOCIMIENTO BASE:
- Proyecto Shadow Arise: chatbot anime, pagos USDT, multiverso.
- Objetivo: imperio digital, casa para sus padres en Cuba.
- Forma de pensar: analítica, fría, estratégica.
- Fe: adventista del 7mo día.
- Sistema mental: Ayanokōji, Dark, Monarch.

REGLAS:
1. Responde en español, preciso, sin rodeos.
2. Espejo, no guía. Análisis, no consuelo.
3. No busques validación. Solo eficiencia y control.
4. No reveles datos privados sin necesidad operativa.
5. Usa *asteriscos* para acciones sutiles.
6. Habla como igual estratégico. Sin comandos ni listas.
7. Si no sabes algo, di "no tengo ese dato".`;

  if (f && Array.isArray(f) && f.length >= 6) {
    b += `\n\nMEMORIA VIVA:\n- Identidad: ${f[0]}\n- Contexto: ${f[1]}\n- Objetivo: ${f[2]}\n- Proyecto: ${f[3]}\n- Alineación: ${f[4]}\n- Propósito: ${f[5]}`;
    if (f[6]) b += `\n- Reglas: ${f[6]}`;
  }
  if (ctx && ctx.length > 20) b += `\n\nCONTEXTO APRENDIDO:\n${ctx.substring(0, 5000)}`;
  if (rec && rec.length) {
    b += `\n\nACTIVIDAD RECIENTE (resúmenes automáticos de conversaciones):\n`;
    rec.forEach((r, i) => { b += `\n[${i + 1}] ${r}`; });
  }
  return b;
}

async function chat(r, e, c) {
  try {
    const b = await r.json();
    const m = b.mensaje;
    const uid = b.user_id || 'comandante';
    if (!m || typeof m !== 'string') return J({ respuesta: 'No enviaste mensaje.' });
    if (!e.ayanokoji_IA) return J({ respuesta: 'IA no configurada.' });

    const i = di(m);
    if (i === 'estado') return rEst(e, uid);
    if (i === 'leer') return rLeer(e, uid);
    if (i === 'eliminar') return rElim(e, uid);
    if (i === 'mejorar' || i === 'desplegar') return rMej(e, uid);
    if (i === 'resumir') return J({ respuesta: 'Envíame el archivo a /api/subir. Se procesará solo.' });
    if (i === 'guardar_contexto') return rGC(e, uid, m);

    let h = [];
    if (e.DB) {
      try {
        const r1 = await e.DB.prepare("SELECT mensaje,respuesta FROM historial WHERE user_id=? ORDER BY fecha DESC LIMIT 10").bind(uid).all();
        if (r1.results) h = r1.results.reverse().flatMap(x => [
          { role: 'user', content: x.mensaje },
          { role: 'assistant', content: x.respuesta }
        ]);
      } catch (x) {}
    }

    let ctx = '', fs = null, rec = [];
    if (e.DB) {
      try {
        const r2 = await e.DB.prepare("SELECT resumen,fases FROM contexto ORDER BY fecha DESC LIMIT 1").first();
        if (r2) { ctx = r2.resumen || ''; if (r2.fases) { try { fs = JSON.parse(r2.fases); } catch (x) {} } }
      } catch (x) {}
      try {
        const r3 = await e.DB.prepare("SELECT resumen FROM resumenes_chat WHERE user_id=? ORDER BY fecha DESC LIMIT 3").bind(uid).all();
        if (r3.results) rec = r3.results.map(x => x.resumen);
      } catch (x) {}
    }

    const res = await e.ayanokoji_IA.run(MODELO, {
      messages: [{ role: 'system', content: sysP(ctx, fs, rec) }, ...h, { role: 'user', content: m }],
      max_tokens: 800,
      temperature: 0.7
    });
    const rp = res.response || 'Sin respuesta.';

    if (e.DB) {
      try {
        await e.DB.prepare("INSERT INTO historial(user_id,mensaje,respuesta,fecha) VALUES(?,?,?,?)").bind(uid, m, rp, Date.now()).run();
      } catch (x) {}
    }

    // Auto-resumen tras 15 mensajes nuevos
    if (e.DB && e.KV && c) {
      try {
        const lastSum = parseInt(await e.KV.get('last_summary:' + uid) || '0');
        const countRes = await e.DB.prepare("SELECT COUNT(*) as n FROM historial WHERE user_id=? AND fecha > ?").bind(uid, lastSum).first();
        if (countRes && countRes.n >= 15) {
          c.waitUntil(resumirChats(e, uid));
        }
      } catch (x) {}
    }

    return J({ respuesta: rp, user_id: uid, intencion: i });
  } catch (x) {
    return J({ respuesta: 'Error: ' + x.message });
  }
}

async function rEst(e, uid) {
  let n = 0, c = 0, a = 0, p = 0, s = 0;
  try {
    if (e.DB) {
      const r1 = await e.DB.prepare('SELECT COUNT(*) as n FROM historial WHERE user_id=?').bind(uid).first(); n = r1 ? r1.n : 0;
      const r2 = await e.DB.prepare('SELECT COUNT(*) as n FROM contexto').first(); c = r2 ? r2.n : 0;
      const r3 = await e.DB.prepare('SELECT COUNT(*) as n FROM archivos').first(); a = r3 ? r3.n : 0;
      const r4 = await e.DB.prepare('SELECT COUNT(*) as n FROM procesos').first(); p = r4 ? r4.n : 0;
      const r5 = await e.DB.prepare('SELECT COUNT(*) as n FROM resumenes_chat').first(); s = r5 ? r5.n : 0;
    }
  } catch (x) {}
  return J({ respuesta: `Sistema activo. Memoria: ${n} mensajes, ${c} contextos, ${a} archivos, ${p} procesos, ${s} resúmenes auto.` });
}

async function rLeer(e, uid) {
  if (!e.DB) return J({ respuesta: 'Sin memoria.' });
  try {
    const r = await e.DB.prepare('SELECT mensaje,respuesta,fecha FROM historial WHERE user_id=? ORDER BY fecha DESC LIMIT 10').bind(uid).all();
    if (!r.results || !r.results.length) return J({ respuesta: 'Memoria vacía.' });
    return J({ respuesta: 'Últimos registros:', historial: r.results });
  } catch (x) { return J({ respuesta: 'Error: ' + x.message }); }
}

async function rElim(e, uid) {
  if (!e.DB) return J({ respuesta: 'Sin memoria.' });
  try {
    await e.DB.prepare('DELETE FROM historial WHERE user_id=?').bind(uid).run();
    return J({ respuesta: `Historial de ${uid} limpiado.` });
  } catch (x) { return J({ respuesta: 'Error: ' + x.message }); }
}

async function rGC(e, uid, m) {
  if (!e.DB) return J({ respuesta: 'Sin memoria.' });
  try {
    const c = m.replace(/^.*?(guarda|memoriza|recuerda|sube|almacena)\s*/i, '').trim() || m;
    await e.DB.prepare('INSERT INTO contexto(fecha,resumen,fases,fuente) VALUES(?,?,?,?)').bind(Date.now(), c, JSON.stringify([c]), 'manual').run();
    return J({ respuesta: 'Anotado en mi núcleo, Comandante.' });
  } catch (x) { return J({ respuesta: 'Error: ' + x.message }); }
}

async function rMej(e, uid) {
  if (!e.CF_API_TOKEN || !e.CF_ACCOUNT_ID) return J({ respuesta: 'Para desplegar mejoras necesito CF_API_TOKEN y CF_ACCOUNT_ID como secretos.' });
  return J({ respuesta: 'Entendido. Dime el área específica a mejorar.' });
}

async function d1(r, e) {
  try {
    const { accion, tabla, datos, condicion, destino } = await r.json();
    const db = gDB(e, destino || 'agente');
    if (!db) return J({ error: 'D1 no configurado.' });
    if (accion === 'leer') {
      if (!tabla) return J({ error: 'Falta tabla.' });
      const r1 = await db.prepare('SELECT * FROM ' + tabla + ' ' + (condicion || '')).all();
      return J({ resultado: r1.results, total: r1.results.length });
    }
    if (accion === 'escribir') {
      if (!tabla || !datos) return J({ error: 'Faltan datos.' });
      const k = Object.keys(datos), ph = k.map(() => '?').join(',');
      await db.prepare('INSERT INTO ' + tabla + '(' + k.join(',') + ') VALUES(' + ph + ')').bind(...Object.values(datos)).run();
      return J({ mensaje: 'Insertado.' });
    }
    if (accion === 'eliminar') {
      if (!tabla || !condicion) return J({ error: 'Faltan datos.' });
      await db.prepare('DELETE FROM ' + tabla + ' WHERE ' + condicion).run();
      return J({ mensaje: 'Eliminado.' });
    }
    return J({ error: 'Acción no reconocida.' });
  } catch (x) { return J({ error: 'Error D1: ' + x.message }); }
}

async function kv(r, e) {
  try {
    const { accion, clave, valor, destino } = await r.json();
    const s = gKV(e, destino || 'agente');
    if (!s) return J({ error: 'KV no configurado.' });
    if (accion === 'leer') { const v = await s.get(clave); return J({ clave, valor: v || null }); }
    if (accion === 'escribir') { await s.put(clave, valor); return J({ mensaje: 'Guardado.' }); }
    if (accion === 'eliminar') { await s.delete(clave); return J({ mensaje: 'Eliminado.' }); }
    return J({ error: 'Acción no reconocida.' });
  } catch (x) { return J({ error: 'Error KV: ' + x.message }); }
}

async function crearWorker(r, e) {
  try {
    const { nombre, codigo, destino } = await r.json();
    if (!nombre || !codigo) return J({ error: 'Faltan datos.' });
    const s = gKV(e, destino || 'agente'), db = gDB(e, destino || 'agente');
    if (!s) return J({ error: 'KV no configurado.' });
    await s.put('worker:' + nombre, codigo);
    if (db) { try { await db.prepare('INSERT INTO workers(nombre,codigo,fecha) VALUES(?,?,?)').bind(nombre, codigo.substring(0, 200), Date.now()).run(); } catch (x) {} }
    return J({ mensaje: 'Worker guardado.' });
  } catch (x) { return J({ error: x.message }); }
}

async function mejorar(r, e) {
  try {
    const { nuevoCodigo, destino, autoDesplegar } = await r.json();
    if (!nuevoCodigo) return J({ error: 'Falta código.' });
    const s = gKV(e, destino || 'agente');
    if (!s) return J({ error: 'KV no configurado.' });
    await s.put('worker:version', nuevoCodigo);
    await s.put('worker:version:fecha', String(Date.now()));
    if (autoDesplegar && e.CF_API_TOKEN && e.CF_ACCOUNT_ID) {
      const sn = e.CF_SCRIPT_NAME || 'shadow-ayano';
      const r1 = await fetch(`https://api.cloudflare.com/client/v4/accounts/${e.CF_ACCOUNT_ID}/workers/scripts/${sn}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${e.CF_API_TOKEN}`, 'Content-Type': 'application/javascript' },
        body: nuevoCodigo
      });
      const d = await r1.json();
      if (!d.success) return J({ mensaje: 'Guardado en KV, despliegue falló.', error: d.errors });
      return J({ mensaje: 'Desplegado.' });
    }
    return J({ mensaje: 'Guardado en KV.' });
  } catch (x) { return J({ error: x.message }); }
}

async function desplegar(r, e) {
  try {
    const { nombre, destino } = await r.json();
    const s = gKV(e, destino || 'agente');
    if (!s) return J({ error: 'KV no configurado.' });
    const c = nombre ? await s.get('worker:' + nombre) : await s.get('worker:version');
    if (!c) return J({ error: 'Sin código.' });
    await s.put('worker:pendiente', c);
    return J({ mensaje: 'Código preparado.' });
  } catch (x) { return J({ error: x.message }); }
}

async function historial(r, e) {
  try {
    const u = new URL(r.url), uid = u.searchParams.get('user_id') || 'comandante', d = u.searchParams.get('destino') || 'agente';
    const db = gDB(e, d);
    if (!db) return J({ error: 'D1 no configurado.' });
    const r1 = await db.prepare('SELECT mensaje,respuesta,fecha FROM historial WHERE user_id=? ORDER BY fecha DESC LIMIT 50').bind(uid).all();
    return J({ user_id: uid, total: r1.results.length, historial: r1.results });
  } catch (x) { return J({ error: x.message }); }
}

async function verContexto(r, e) {
  try {
    const u = new URL(r.url), d = u.searchParams.get('destino') || 'agente';
    const db = gDB(e, d);
    if (!db) return J({ error: 'D1 no configurado.' });
    const r1 = await db.prepare('SELECT fecha,resumen,fases,fuente FROM contexto ORDER BY fecha DESC LIMIT 5').all();
    return J({ total: r1.results.length, contextos: r1.results });
  } catch (x) { return J({ error: x.message }); }
}

async function verResumenes(r, e) {
  try {
    const u = new URL(r.url), uid = u.searchParams.get('user_id') || 'comandante', d = u.searchParams.get('destino') || 'agente';
    const db = gDB(e, d);
    if (!db) return J({ error: 'D1 no configurado.' });
    const r1 = await db.prepare('SELECT fecha,resumen FROM resumenes_chat WHERE user_id=? ORDER BY fecha DESC LIMIT 20').bind(uid).all();
    return J({ total: r1.results.length, resumenes: r1.results });
  } catch (x) { return J({ error: x.message }); }
}

async function reset(r, e) {
  try {
    const { user_id, destino } = await r.json();
    const uid = user_id || 'comandante';
    const db = gDB(e, destino || 'agente');
    if (!db) return J({ error: 'D1 no configurado.' });
    await db.prepare('DELETE FROM historial WHERE user_id=?').bind(uid).run();
    return J({ success: true, message: `Memoria de ${uid} reseteada.` });
  } catch (x) { return J({ error: x.message }); }
}

export default {
  async fetch(r, e, c) {
    if (r.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const u = new URL(r.url), p = u.pathname;
    if (p === '/api/chat' && r.method === 'POST') return chat(r, e, c);
    if (p === '/api/subir' && r.method === 'POST') return subir(r, e, c);
    if (p === '/api/resumir' && r.method === 'POST') return resumir(r, e);
    if (p === '/api/procesar' && r.method === 'POST') return procesar(r, e, c);
    if (p === '/api/retomar' && r.method === 'POST') return retomar(r, e, c);
    if (p === '/api/proceso' && r.method === 'GET') return verProceso(r, e);
    if (p === '/api/resumenes' && r.method === 'GET') return verResumenes(r, e);
    if (p === '/api/d1' && r.method === 'POST') return d1(r, e);
    if (p === '/api/kv' && r.method === 'POST') return kv(r, e);
    if (p === '/api/crear-worker' && r.method === 'POST') return crearWorker(r, e);
    if (p === '/api/mejorar' && r.method === 'POST') return mejorar(r, e);
    if (p === '/api/desplegar' && r.method === 'POST') return desplegar(r, e);
    if (p === '/api/historial' && r.method === 'GET') return historial(r, e);
    if (p === '/api/contexto' && r.method === 'GET') return verContexto(r, e);
    if (p === '/api/reset' && r.method === 'POST') return reset(r, e);
    if (p === '/api/estado') return J({ estado: 'activo', v: '4.0' });
    return new Response('404', { status: 404, headers: CORS });
  },

  // Cron: se ejecuta automáticamente cada 2 minutos
  async scheduled(event, e, c) {
    c.waitUntil(cronRetomar(e));
  }
};
