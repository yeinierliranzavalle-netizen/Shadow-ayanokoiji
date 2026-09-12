const CS = 500 * 1024;
const MODELO = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const LPB = 120;
const BPL = 15;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

function J(d) {
  return new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json', ...CORS } });
}

function gDB(e, x) {
  return { agente: e.DB, test: e.DB_test, shadow: e.DB_shadow_arise }[x] || null;
}

function gKV(e, x) {
  return { agente: e.KV, test: e.KV_test, shadow: e.KV_shadow_arise }[x] || null;
}

function b64e(b) {
  let s = '', p = 8192;
  for (let i = 0; i < b.length; i += p) s += String.fromCharCode.apply(null, b.subarray(i, i + p));
  return btoa(s);
}

function b64d(x) {
  const b = atob(x), a = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return new TextDecoder('utf-8').decode(a);
}

function j2t(c) {
  let d;
  try { d = typeof c === 'string' ? JSON.parse(c) : c; } catch (e) { return String(c); }
  if (Array.isArray(d)) return d.map(m => {
    if (typeof m === 'string') return m;
    const r = m.role || m.rol || m.from || m.sender || '?';
    const x = m.content || m.contenido || m.text || m.message || m.mensaje || '';
    return '[' + r + ']: ' + (typeof x === 'string' ? x : JSON.stringify(x));
  }).join('\n\n');
  const k = ['messages', 'mensajes', 'conversation', 'conversacion', 'chat', 'historial', 'history', 'data', 'dialogo'];
  for (const kk of k) if (d[kk]) return j2t(d[kk]);
  return JSON.stringify(d, null, 2);
}

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

function sysP(ctx, f) {
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
  if (ctx && ctx.length > 20) b += `\n\nCONTEXTO APRENDIDO:\n${ctx.substring(0, 6000)}`;
  return b;
}

async function chat(r, e) {
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
        if (r1.results) h = r1.results.reverse().flatMap(x => [{ role: 'user', content: x.mensaje }, { role: 'assistant', content: x.respuesta }]);
      } catch (x) {}
    }

    let ctx = '', fs = null;
    if (e.DB) {
      try {
        const r2 = await e.DB.prepare("SELECT resumen,fases FROM contexto ORDER BY fecha DESC LIMIT 1").first();
        if (r2) {
          ctx = r2.resumen || '';
          if (r2.fases) { try { fs = JSON.parse(r2.fases); } catch (x) {} }
        }
      } catch (x) {}
    }

    const res = await e.ayanokoji_IA.run(MODELO, {
      messages: [{ role: 'system', content: sysP(ctx, fs) }, ...h, { role: 'user', content: m }],
      max_tokens: 800,
      temperature: 0.7
    });
    const rp = res.response || 'Sin respuesta.';

    if (e.DB) {
      try {
        await e.DB.prepare("INSERT INTO historial(user_id,mensaje,respuesta,fecha)VALUES(?,?,?,?)").bind(uid, m, rp, Date.now()).run();
      } catch (x) {}
    }
    return J({ respuesta: rp, user_id: uid, intencion: i });
  } catch (x) {
    return J({ respuesta: 'Error: ' + x.message });
  }
}

async function rEst(e, uid) {
  let n = 0, c = 0, a = 0, p = 0;
  try {
    if (e.DB) {
      const r1 = await e.DB.prepare('SELECT COUNT(*) as n FROM historial WHERE user_id=?').bind(uid).first();
      n = r1 ? r1.n : 0;
      const r2 = await e.DB.prepare('SELECT COUNT(*) as n FROM contexto').first();
      c = r2 ? r2.n : 0;
      const r3 = await e.DB.prepare('SELECT COUNT(*) as n FROM archivos').first();
      a = r3 ? r3.n : 0;
      const r4 = await e.DB.prepare('SELECT COUNT(*) as n FROM procesos').first();
      p = r4 ? r4.n : 0;
    }
  } catch (x) {}
  return J({ respuesta: `Sistema activo. Memoria: ${n} mensajes, ${c} resúmenes, ${a} archivos, ${p} procesos.` });
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
    await e.DB.prepare('INSERT INTO contexto(fecha,resumen,fases,fuente)VALUES(?,?,?,?)').bind(Date.now(), c, JSON.stringify([c]), 'manual').run();
    return J({ respuesta: 'Anotado en mi núcleo, Comandante.' });
  } catch (x) { return J({ respuesta: 'Error: ' + x.message }); }
}

async function rMej(e, uid) {
  if (!e.CF_API_TOKEN || !e.CF_ACCOUNT_ID) return J({ respuesta: 'Para desplegar mejoras necesito CF_API_TOKEN y CF_ACCOUNT_ID como secretos.' });
  return J({ respuesta: 'Entendido. Dime el área específica a mejorar.' });
}

async function subir(r, e, c) {
  try {
    const f = await r.formData();
    const ar = f.get('archivo');
    const nm = f.get('nombre') || (ar ? ar.name : 'sin_nombre');
    const d = f.get('destino') || 'agente';
    const ap = f.get('autoProcesar') !== 'false';
    if (!ar) return J({ error: 'No hay archivo.' });

    const buf = await ar.arrayBuffer();
    const t = buf.byteLength;
    if (t > 5 * 1024 * 1024) return J({ error: 'Supera 5MB.', tamaño: t });

    const kv = gKV(e, d);
    if (!kv) return J({ error: 'KV inválido.' });
    const db = gDB(e, d);
    const id = Date.now() + '_' + nm.replace(/[^a-zA-Z0-9._-]/g, '_');

    const bs = new Uint8Array(buf);
    const ch = [];
    for (let i = 0; i < bs.length; i += CS) ch.push(bs.slice(i, i + CS));
    for (let i = 0; i < ch.length; i++) await kv.put('file:' + id + ':' + i, b64e(ch[i]));

    if (db) {
      try {
        await db.prepare('INSERT INTO archivos(id,nombre,tamaño,chunks,destino,fecha)VALUES(?,?,?,?,?,?)').bind(id, nm, t, ch.length, d, Date.now()).run();
      } catch (x) {}
    }

    if (db && ap) {
      try {
        await db.prepare('INSERT INTO procesos(id,archivo_id,estado,bloques_total,bloques_hechos,fecha_inicio)VALUES(?,?,?,?,?,?)').bind(id, id, 'pendiente', 0, 0, Date.now()).run();
      } catch (x) {}
      c.waitUntil(procesarLote(e, id, d, 0));
    }

    return J({ mensaje: ap ? 'Archivo subido. Procesamiento iniciado.' : 'Archivo subido.', id, tamaño: t, chunks: ch.length, autoProcesando: ap });
  } catch (x) {
    return J({ error: 'Error: ' + x.message });
  }
}

async function procesar(r, e, c) {
  try {
    const b = await r.json();
    if (!b.archivoId) return J({ error: 'Falta archivoId.' });
    c.waitUntil(procesarLote(e, b.archivoId, b.destino || 'agente', b.inicio || 0));
    return J({ mensaje: 'Lote en proceso.', archivoId: b.archivoId });
  } catch (x) {
    return J({ error: x.message });
  }
}

async function procesarLote(e, aId, d, off) {
  const kv = gKV(e, d), db = gDB(e, d), ai = e.ayanokoji_IA;
  if (!kv || !db || !ai) return;
  try {
    let txt = await kv.get('proc:' + aId + ':texto');
    if (!txt) {
      const ls = await kv.list({ prefix: 'file:' + aId + ':' });
      const ks = ls.keys.sort((a, b) => parseInt(a.name.split(':').pop()) - parseInt(b.name.split(':').pop()));
      let bb = '';
      for (const k of ks) {
        const c = await kv.get(k.name);
        if (c) bb += c;
      }
      txt = j2t(b64d(bb));
      await kv.put('proc:' + aId + ':texto', txt);
    }

    const ln = txt.split('\n');
    const bl = [];
    for (let i = 0; i < ln.length; i += LPB) bl.push(ln.slice(i, i + LPB).join('\n'));
    const tot = bl.length;

    if (off === 0) {
      await db.prepare('UPDATE procesos SET estado=?,bloques_total=?,bloques_hechos=? WHERE id=?').bind('procesando', tot, 0, aId).run();
    }

    const fin = Math.min(off + BPL, tot);
    const rp = [];
    for (let i = off; i < fin; i++) {
      try {
        const r1 = await ai.run(MODELO, {
          messages: [{ role: 'user', content: `Analiza este fragmento de conversación entre el Comandante Yeinier y su aliado. Extrae: (1) identidad y forma de pensar del Comandante, (2) decisiones tomadas, (3) errores y correcciones, (4) datos del proyecto Shadow Arise, (5) planes futuros, (6) objetivos declarados, (7) cómo quiere que su aliado le hable y actúe. Si no aplica, escribe "ninguno". Máximo 250 palabras.\n\nFragmento ${i + 1}/${tot}:\n${bl[i]}` }],
          max_tokens: 500,
          temperature: 0.3
        });
        rp.push(`[BLOQUE ${i + 1}]\n${r1.response || ''}`);
      } catch (x) {
        rp.push(`[BLOQUE ${i + 1}] ERROR: ${x.message}`);
      }
    }

    const ak = 'proc:' + aId + ':parciales';
    const pr = await kv.get(ak) || '';
    const na = pr + '\n\n' + rp.join('\n\n');
    await kv.put(ak, na);
    await db.prepare('UPDATE procesos SET bloques_hechos=? WHERE id=?').bind(fin, aId).run();

    if (fin < tot) {
      await seguir(e, aId, d, fin);
      return;
    }
    await consolidar(e, aId, d, na);
  } catch (x) {
    try {
      await db.prepare('UPDATE procesos SET estado=?,error=? WHERE id=?').bind('error', x.message, aId).run();
    } catch (y) {}
  }
}

async function seguir(e, aId, d, off) {
  const kv = gKV(e, d), db = gDB(e, d), ai = e.ayanokoji_IA;
  if (!kv || !db || !ai) return;
  try {
    const txt = await kv.get('proc:' + aId + ':texto');
    if (!txt) return;

    const ln = txt.split('\n');
    const bl = [];
    for (let i = 0; i < ln.length; i += LPB) bl.push(ln.slice(i, i + LPB).join('\n'));
    const tot = bl.length;
    const fin = Math.min(off + BPL, tot);
    const rp = [];

    for (let i = off; i < fin; i++) {
      try {
        const r1 = await ai.run(MODELO, {
          messages: [{ role: 'user', content: `Analiza este fragmento. Extrae: identidad, decisiones, errores, datos del proyecto, planes, objetivos, cómo quiere que su aliado actúe. Máximo 250 palabras.\n\nFragmento ${i + 1}/${tot}:\n${bl[i]}` }],
          max_tokens: 500,
          temperature: 0.3
        });
        rp.push(`[BLOQUE ${i + 1}]\n${r1.response || ''}`);
      } catch (x) {
        rp.push(`[BLOQUE ${i + 1}] ERROR: ${x.message}`);
      }
    }

    const ak = 'proc:' + aId + ':parciales';
    const pr = await kv.get(ak) || '';
    const na = pr + '\n\n' + rp.join('\n\n');
    await kv.put(ak, na);
    await db.prepare('UPDATE procesos SET bloques_hechos=? WHERE id=?').bind(fin, aId).run();

    if (fin < tot) {
      await seguir(e, aId, d, fin);
      return;
    }
    await consolidar(e, aId, d, na);
  } catch (x) {
    try {
      await db.prepare('UPDATE procesos SET estado=?,error=? WHERE id=?').bind('error', x.message, aId).run();
    } catch (y) {}
  }
}

async function consolidar(e, aId, d, ac) {
  const kv = gKV(e, d), db = gDB(e, d), ai = e.ayanokoji_IA;
  if (!kv || !db || !ai) return;
  try {
    let pz = ac.split('\n\n[BLOQUE ').map((p, i) => i === 0 ? p : '[BLOQUE ' + p).filter(p => p.trim().length > 30);

    while (pz.length > 5) {
      const nv = [];
      for (let i = 0; i < pz.length; i += 5) {
        const td = pz.slice(i, i + 5).join('\n---\n');
        try {
          const r1 = await ai.run(MODELO, {
            messages: [{ role: 'user', content: `Fusiona estos resúmenes en uno. Elimina repetidos. Conserva nombres, decisiones, cifras, errores, objetivos, forma de pensar. Máximo 500 palabras.\n\n${td}` }],
            max_tokens: 700,
            temperature: 0.3
          });
          nv.push(r1.response || td);
        } catch (x) {
          nv.push(td);
        }
      }
      pz = nv;
    }

    const tc = pz.join('\n\n');
    const rf = await ai.run(MODELO, {
      messages: [{ role: 'user', content: `Genera un perfil maestro del Comandante Yeinier en 7 secciones separadas por ";". Mínimo 30 palabras cada una:
1. IDENTIDAD: quién es, esencia, forma de pensar.
2. CONTEXTO: entorno, familia, situación en Cuba.
3. OBJETIVO: meta principal.
4. PROYECTO: qué construye (Shadow Arise, aliado digital, casa, paneles).
5. ALINEACIÓN: cómo debe comportarse su aliado digital, cómo hablarle, qué tono.
6. PROPÓSITO: motivación profunda.
7. REGLAS_OPERATIVAS: instrucciones específicas para dirigir el proyecto y actuar.

Solo las 7 secciones separadas por ";". Sin numeración.

Resúmenes:\n${tc.substring(0, 8000)}` }],
      max_tokens: 1200,
      temperature: 0.4
    });

    const rm = rf.response || '';
    const fs = rm.split(';').map(x => x.trim()).filter(x => x.length > 10);

    await db.prepare('INSERT INTO contexto(fecha,resumen,fases,fuente)VALUES(?,?,?,?)').bind(Date.now(), rm, JSON.stringify(fs), aId).run();
    await db.prepare('UPDATE procesos SET estado=?,fecha_fin=? WHERE id=?').bind('completado', Date.now(), aId).run();

    const ch = await kv.list({ prefix: 'file:' + aId + ':' });
    for (const k of ch.keys) await kv.delete(k.name);
    await kv.delete('proc:' + aId + ':texto');
    await kv.delete('proc:' + aId + ':parciales');
    try { await db.prepare('DELETE FROM archivos WHERE id=?').bind(aId).run(); } catch (x) {}
  } catch (x) {
    try {
      await db.prepare('UPDATE procesos SET estado=?,error=? WHERE id=?').bind('error', x.message, aId).run();
    } catch (y) {}
  }
}

async function verProceso(r, e) {
  try {
    const u = new URL(r.url), id = u.searchParams.get('id'), d = u.searchParams.get('destino') || 'agente';
    const db = gDB(e, d);
    if (!db) return J({ error: 'D1 no configurado.' });
    if (id) {
      const p = await db.prepare('SELECT * FROM procesos WHERE id=?').bind(id).first();
      return J({ proceso: p });
    }
    const r1 = await db.prepare('SELECT * FROM procesos ORDER BY fecha_inicio DESC LIMIT 10').all();
    return J({ total: r1.results.length, procesos: r1.results });
  } catch (x) { return J({ error: x.message }); }
}

async function resumir(r, e) {
  try {
    const b = await r.json();
    if (!b.texto && !b.archivoId) return J({ error: 'Falta texto o archivoId.' });
    const d = b.destino || 'agente', kv = gKV(e, d), db = gDB(e, d);
    if (!kv || !db) return J({ error: 'Destino inválido.' });
    let ct = b.texto;
    if (b.archivoId) {
      const ls = await kv.list({ prefix: 'file:' + b.archivoId + ':' });
      const ks = ls.keys.sort((a, b) => parseInt(a.name.split(':').pop()) - parseInt(b.name.split(':').pop()));
      let bb = '';
      for (const k of ks) { const c = await kv.get(k.name); if (c) bb += c; }
      ct = j2t(b64d(bb));
    }
    if (!ct || ct.length < 100) return J({ error: 'Contenido corto.' });
    const id = 'm_' + Date.now();
    await db.prepare('INSERT INTO procesos(id,archivo_id,estado,bloques_total,bloques_hechos,fecha_inicio)VALUES(?,?,?,?,?,?)').bind(id, b.archivoId || id, 'pendiente', 0, 0, Date.now()).run();
    await kv.put('proc:' + id + ':texto', ct);
    await procesarLote(e, id, d, 0);
    return J({ mensaje: 'Procesamiento iniciado.', procesoId: id });
  } catch (x) { return J({ error: 'Error: ' + x.message }); }
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
      await db.prepare('INSERT INTO ' + tabla + '(' + k.join(',') + ')VALUES(' + ph + ')').bind(...Object.values(datos)).run();
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
    await s.put('worker:' + nombre,
