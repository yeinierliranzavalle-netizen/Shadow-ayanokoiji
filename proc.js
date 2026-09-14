import { MODELO, CS, LPB, BPL, J, gDB, gKV, b64e, b64d, j2t } from './shared.js';

function chunkBytes(bs, size) {
  const ch = [];
  let pos = 0;
  while (pos < bs.length) {
    let end = Math.min(pos + size, bs.length);
    if (end < bs.length) {
      while (end > pos && (bs[end] & 0xC0) === 0x80) end--;
    }
    ch.push(bs.slice(pos, end));
    pos = end;
  }
  return ch;
}

async function reconstruir(kv, prefix) {
  const ls = await kv.list({ prefix });
  const ks = ls.keys.sort((a, b) => parseInt(a.name.split(':').pop()) - parseInt(b.name.split(':').pop()));
  let texto = '';
  for (const k of ks) {
    const c = await kv.get(k.name);
    if (c) texto += b64d(c);
  }
  return texto;
}

export async function subir(r, e, c) {
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
    const ch = chunkBytes(bs, CS);
    for (let i = 0; i < ch.length; i++) {
      await kv.put('file:' + id + ':' + i, b64e(ch[i]));
    }
    if (db) {
      try {
        await db.prepare('INSERT INTO archivos(id,nombre,tamaño,chunks,destino,fecha) VALUES(?,?,?,?,?,?)')
          .bind(id, nm, t, ch.length, d, Date.now()).run();
      } catch (x) {}
    }
    if (db && ap) {
      try {
        await db.prepare('INSERT INTO procesos(id,archivo_id,estado,bloques_total,bloques_hechos,fecha_inicio,fecha_avance) VALUES(?,?,?,?,?,?,?)')
          .bind(id, id, 'pendiente', 0, 0, Date.now(), Date.now()).run();
      } catch (x) {}
      c.waitUntil(procesarLote(e, id, d, 0));
    }
    return J({ mensaje: ap ? 'Archivo subido. Procesamiento iniciado.' : 'Archivo subido.', id, tamaño: t, chunks: ch.length, autoProcesando: ap });
  } catch (x) { return J({ error: 'Error: ' + x.message }); }
}

export async function procesar(r, e, c) {
  try {
    const b = await r.json();
    if (!b.archivoId) return J({ error: 'Falta archivoId.' });
    c.waitUntil(procesarLote(e, b.archivoId, b.destino || 'agente', b.inicio || 0));
    return J({ mensaje: 'Lote en proceso.', archivoId: b.archivoId });
  } catch (x) { return J({ error: x.message }); }
}

export async function retomar(r, e, c) {
  try {
    const b = await r.json();
    const aId = b.archivoId;
    const d = b.destino || 'agente';
    const db = gDB(e, d);
    if (!db || !aId) return J({ error: 'Faltan datos.' });
    const p = await db.prepare('SELECT * FROM procesos WHERE id=?').bind(aId).first();
    if (!p) return J({ error: 'Proceso no encontrado.' });
    if (p.estado === 'completado') return J({ mensaje: 'Ya está completado.', estado: 'completado' });
    const inicio = p.bloques_hechos || 0;
    await db.prepare('UPDATE procesos SET estado=?,fecha_avance=? WHERE id=?').bind('procesando', Date.now(), aId).run();
    c.waitUntil(procesarLote(e, aId, d, inicio));
    return J({ mensaje: 'Retomado desde bloque ' + inicio, archivoId: aId, inicio });
  } catch (x) { return J({ error: x.message }); }
}

export async function resumir(r, e) {
  try {
    const b = await r.json();
    if (!b.texto && !b.archivoId) return J({ error: 'Falta texto o archivoId.' });
    const d = b.destino || 'agente', kv = gKV(e, d), db = gDB(e, d);
    if (!kv || !db) return J({ error: 'Destino inválido.' });
    let ct = b.texto;
    if (b.archivoId) {
      ct = j2t(await reconstruir(kv, 'file:' + b.archivoId + ':'));
    }
    if (!ct || ct.length < 100) return J({ error: 'Contenido corto.' });
    const id = 'm_' + Date.now();
    await db.prepare('INSERT INTO procesos(id,archivo_id,estado,bloques_total,bloques_hechos,fecha_inicio,fecha_avance) VALUES(?,?,?,?,?,?,?)')
      .bind(id, b.archivoId || id, 'pendiente', 0, 0, Date.now(), Date.now()).run();
    await kv.put('proc:' + id + ':texto', ct);
    await procesarLote(e, id, d, 0);
    return J({ mensaje: 'Procesamiento iniciado.', procesoId: id });
  } catch (x) { return J({ error: 'Error: ' + x.message }); }
}

export async function verProceso(r, e) {
  try {
    const u = new URL(r.url), id = u.searchParams.get('id'), d = u.searchParams.get('destino') || 'agente';
    const db = gDB(e, d);
    if (!db) return J({ error: 'D1 no configurado.' });
    if (id) {
      const p = await db.prepare('SELECT * FROM procesos WHERE id=?').bind(id).first();
      return J({ proceso: p });
    }
    const r1 = await db.prepare('SELECT * FROM procesos ORDER BY fecha_inicio DESC LIMIT 20').all();
    return J({ total: r1.results.length, procesos: r1.results });
  } catch (x) { return J({ error: x.message }); }
}

export async function procesarLote(e, aId, d, off) {
  const kv = gKV(e, d), db = gDB(e, d), ai = e.ayanokoji_IA;
  if (!kv || !db || !ai) return;
  try {
    let txt = await kv.get('proc:' + aId + ':texto');
    if (!txt) {
      txt = j2t(await reconstruir(kv, 'file:' + aId + ':'));
      await kv.put('proc:' + aId + ':texto', txt);
    }
    const ln = txt.split('\n'), bl = [];
    for (let i = 0; i < ln.length; i += LPB) bl.push(ln.slice(i, i + LPB).join('\n'));
    const tot = bl.length;

    if (off === 0) {
      await db.prepare('UPDATE procesos SET estado=?,bloques_total=?,bloques_hechos=?,fecha_avance=? WHERE id=?')
        .bind('procesando', tot, 0, Date.now(), aId).run();
    } else {
      await db.prepare('UPDATE procesos SET estado=?,fecha_avance=? WHERE id=?')
        .bind('procesando', Date.now(), aId).run();
    }

    const fin = Math.min(off + BPL, tot);
    const rp = [];
    for (let i = off; i < fin; i++) {
      try {
        const r1 = await ai.run(MODELO, {
          messages: [{ role: 'user', content: `Analiza este fragmento. Extrae: (1) identidad y forma de pensar del Comandante, (2) decisiones, (3) errores/correcciones, (4) datos del proyecto Shadow Arise, (5) planes futuros, (6) objetivos, (7) cómo quiere que su aliado le hable y actúe. Si no aplica, escribe "ninguno". Máximo 250 palabras.\n\nFragmento ${i + 1}/${tot}:\n${bl[i]}` }],
          max_tokens: 500,
          temperature: 0.3
        });
        rp.push(`[BLOQUE ${i + 1}]\n${r1.response || ''}`);
      } catch (x) {
        rp.push(`[BLOQUE ${i + 1}] ERROR: ${x.message}`);
      }
      await db.prepare('UPDATE procesos SET bloques_hechos=?,fecha_avance=? WHERE id=?')
        .bind(i + 1, Date.now(), aId).run();
    }

    const ak = 'proc:' + aId + ':parciales';
    const pr = await kv.get(ak) || '';
    const na = pr + '\n\n' + rp.join('\n\n');
    await kv.put(ak, na);

    if (fin < tot) return;
    await consolidar(e, aId, d, na);
  } catch (x) {
    try {
      await db.prepare('UPDATE procesos SET estado=?,error=?,fecha_avance=? WHERE id=?')
        .bind('error', x.message, Date.now(), aId).run();
    } catch (y) {}
  }
}

export async function consolidar(e, aId, d, ac) {
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
        } catch (x) { nv.push(td); }
      }
      pz = nv;
    }
    const tc = pz.join('\n\n');
    const rf = await ai.run(MODELO, {
      messages: [{ role: 'user', content: `Genera un perfil maestro del Comandante Yeinier en 7 secciones separadas por ";". Mínimo 30 palabras cada una:\n1. IDENTIDAD: quién es, esencia, forma de pensar.\n2. CONTEXTO: entorno, familia, situación en Cuba.\n3. OBJETIVO: meta principal.\n4. PROYECTO: qué construye.\n5. ALINEACIÓN: cómo debe comportarse su aliado digital, cómo hablarle, qué tono.\n6. PROPÓSITO: motivación profunda.\n7. REGLAS_OPERATIVAS: instrucciones específicas para dirigir el proyecto y actuar.\n\nSolo las 7 secciones separadas por ";". Sin numeración.\n\nResúmenes:\n${tc.substring(0, 8000)}` }],
      max_tokens: 1200,
      temperature: 0.4
    });
    const rm = rf.response || '';
    const fs = rm.split(';').map(x => x.trim()).filter(x => x.length > 10);

    await db.prepare('INSERT INTO contexto(fecha,resumen,fases,fuente) VALUES(?,?,?,?)')
      .bind(Date.now(), rm, JSON.stringify(fs), aId).run();

    await db.prepare('UPDATE procesos SET estado=?,fecha_fin=?,fecha_avance=? WHERE id=?')
      .bind('completado', Date.now(), Date.now(), aId).run();

    const ch = await kv.list({ prefix: 'file:' + aId + ':' });
    for (const k of ch.keys) await kv.delete(k.name);
    await kv.delete('proc:' + aId + ':texto');
    await kv.delete('proc:' + aId + ':parciales');
    try { await db.prepare('DELETE FROM archivos WHERE id=?').bind(aId).run(); } catch (x) {}
  } catch (x) {
    try {
      await db.prepare('UPDATE procesos SET estado=?,error=?,fecha_avance=? WHERE id=?')
        .bind('error', x.message, Date.now(), aId).run();
    } catch (y) {}
  }
}

// CRON: retoma procesos atascados automáticamente
export async function cronRetomar(e) {
  const db = gDB(e, 'agente');
  const ai = e.ayanokoji_IA;
  if (!db || !ai) return;
  try {
    const ahora = Date.now();
    const stuck = await db.prepare(
      "SELECT * FROM procesos WHERE estado IN ('procesando','pendiente') AND (fecha_avance IS NULL OR ? - fecha_avance > 60000) ORDER BY fecha_inicio ASC LIMIT 1"
    ).bind(ahora).all();
    if (!stuck.results || !stuck.results.length) return;
    const p = stuck.results[0];
    const off = p.bloques_hechos || 0;
    await db.prepare('UPDATE procesos SET estado=?,fecha_avance=? WHERE id=?')
      .bind('procesando', ahora, p.id).run();
    await procesarLote(e, p.id, 'agente', off);
  } catch (x) {}
}

// Resumir chats acumulados
export async function resumirChats(e, uid) {
  const db = gDB(e, 'agente'), kv = gKV(e, 'agente'), ai = e.ayanokoji_IA;
  if (!db || !kv || !ai) return;
  try {
    const lastSum = parseInt(await kv.get('last_summary:' + uid) || '0');
    const now = Date.now();
    const msgs = await db.prepare(
      'SELECT mensaje, respuesta FROM historial WHERE user_id=? AND fecha > ? ORDER BY fecha ASC LIMIT 40'
    ).bind(uid, lastSum).all();
    if (!msgs.results || msgs.results.length < 5) return;

    const texto = msgs.results.map(m => `Comandante: ${m.mensaje}\nAyanokōji: ${m.respuesta}`).join('\n\n');
    const res = await ai.run(MODELO, {
      messages: [{ role: 'user', content: `Resume este intercambio entre el Comandante Yeinier y su aliado digital. Extrae solo: temas tratados, decisiones tomadas, información nueva sobre el Comandante, y estado del proyecto. Máximo 250 palabras. Sé conciso.\n\n${texto.substring(0, 9000)}` }],
      max_tokens: 450,
      temperature: 0.3
    });
    const rm = res.response || '';
    if (rm.length < 20) return;

    await db.prepare('INSERT INTO resumenes_chat(user_id,fecha,resumen,desde,hasta) VALUES(?,?,?,?,?)')
      .bind(uid, now, rm, lastSum, now).run();
    await kv.put('last_summary:' + uid, String(now));
  } catch (x) {}
}
