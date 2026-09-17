import { MODELO, CS, LPB, BPL, J, gDB, gKV, b64e, b64d, j2t } from './shared.js';
import { notificar } from './notify.js';

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
          messages: [{ role: 'user', content: `Analiza este fragmento de conversación entre el Comandante Yeinier y su aliado digital. Extrae TODA la información útil que aparezca, sin limitarte a categorías fijas. Incluye:\n- Quién es el Comandante, cómo piensa, qué lo motiva, qué lo formó.\n- Decisiones tomadas y POR QUÉ se tomaron, cómo se ejecutaron.\n- Errores, correcciones y qué se aprendió.\n- Todo sobre el proyecto Shadow Arise: estrategia, componentes, monetización, estado actual.\n- Todo sobre Ayanokōji Digital: su rol, cómo debe actuar, qué límites tiene.\n- Todo sobre la IA publicadora: qué se planea, qué canales, qué estrategia.\n- Planes futuros, ideas pendientes, casa, paneles, robot, agente digital.\n- Cualquier detalle adicional relevante que aparezca, aunque no encaje en las categorías anteriores.\n\nSi algo no aparece, escribe "ninguno". Sé específico. Máximo 300 palabras.\n\nFragmento ${i + 1}/${tot}:\n${bl[i]}` }],
          max_tokens: 600,
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
      await notificar(e, `❌ *Proceso falló*\n\nID: \`${aId}\`\nBloque: ${off}\nError: ${x.message}`);
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
            messages: [{ role: 'user', content: `Fusiona estos resúmenes parciales en uno solo. Elimina repeticiones. Conserva TODOS los detalles específicos: nombres, decisiones, cifras, errores, objetivos, forma de pensar, estrategias, ideas. No omitas nada relevante aunque parezca menor. Explica el porqué de las cosas, no solo el qué. Máximo 600 palabras.\n\n${td}` }],
            max_tokens: 900,
            temperature: 0.3
          });
          nv.push(r1.response || td);
        } catch (x) { nv.push(td); }
      }
      pz = nv;
    }

    const tc = pz.join('\n\n');

    const rf = await ai.run(MODELO, {
      messages: [{
        role: 'user',
        content: `A partir de estos resúmenes consolidados, genera un PERFIL MAESTRO del Comandante Yeinier en 9 secciones. Cada sección debe ser EXPLICATIVA, no una lista de datos. Explica el QUÉ, el POR QUÉ y el CÓMO de cada cosa.

Formato exacto: cada sección comienza con "### N. TITULO:" y termina con "###" en línea aparte. Mínimo 80 palabras por sección. Frases completas que expliquen la lógica, no bullets secos.

Reglas generales:
- NO te limites a ejemplos. Si el contexto menciona algo que no está en las listas de abajo, inclúyelo en la sección que corresponda.
- Si una sección tiene más información de la esperada, inclúyela toda. No resumas de más.
- Cada afirmación debe explicar el porqué, no solo el qué.

Secciones:

### 1. IDENTIDAD:
Quién es Yeinier, su esencia, su forma de pensar y POR QUÉ piensa así (qué lo formó). Sus tres voces internas (Ayanokōji, Dark, Monarch) y cómo las usa. Su relación con la soledad, la observación, la estrategia. Su fe adventista y cómo la integra.

### 2. CONTEXTO:
Su situación actual completa: Cuba rural, familia, presión económica, trabajo, estudios, fe, relación con sus padres y hermanos. Explica CÓMO le afecta cada cosa y cómo responde. Incluye cualquier detalle de su vida cotidiana que aparezca en el contexto.

### 3. OBJETIVO:
Su meta principal y la motivación profunda detrás. No solo "quiere una casa para sus padres" — explica POR QUÉ eso importa, qué dolor concreto quiere resolver, qué futuro imagina para él y su familia.

### 4. PROYECTO SHADOW ARISE:
Qué es Shadow Arise, en qué fase está, todos los componentes. Explica la ESTRATEGIA completa: por qué ese modelo y no otro, qué decisiones se tomaron y POR QUÉ, qué errores se cometieron y CÓMO se resolvieron. Incluye monetización, canales, usuarios objetivo, expansión.

### 5. ALIADO DIGITAL:
Qué es el Ayanokōji Digital, su rol como mano derecha y orquestador. Cómo debe comportarse, cómo hablarle, qué límites tiene, POR QUÉ el Comandante quiere un aliado así. Su relación con el Comandante: espejo, no guía; orquestador, no sirviente.

### 6. IA PUBLICADORA:
Qué se planea para la IA publicadora. Canales, estrategia, contenido, herramientas. POR QUÉ se eligieron esos canales. Cómo debe Ayanokōji orquestarla sin agotarse. Incluye cualquier idea o decisión sobre esto que aparezca en el contexto.

### 7. REGLAS OPERATIVAS:
Instrucciones específicas sobre cómo trabajar con el Comandante. Ejemplos: no pedir validación, no filosofar sin propósito, responder con datos, ejecutar sin preguntar cuando la orden es clara, respetar su tiempo, no agotarlo con tareas triviales, no actuar como sirviente sino como orquestador. Incluye TODAS las reglas que aparezcan en el contexto.

### 8. DECISIONES TOMADAS Y SU RAZÓN:
Lista de las decisiones estratégicas clave del proyecto. Para cada una: QUÉ se decidió, POR QUÉ, y CÓMO se ejecutó. Incluye TODAS las decisiones que aparezcan en el contexto, no solo las que conoces. Ejemplos de dominio: alojamiento, IA, almacenamiento, procesamiento, canales, arquitectura, prioridades.

### 9. IDEAS PENDIENTES:
Todas las ideas que el Comandante ha mencionado pero no ejecutado aún. Incluye TODAS las que aparezcan en el contexto, no solo las que conoces. Explica cada una y POR QUÉ el Comandante la considera.

Recuerda: si hay algo en el contexto que no encaja en ninguna sección, añádelo en la que más se acerque. No pierdas información.

Resúmenes consolidados:
${tc.substring(0, 9000)}`
      }],
      max_tokens: 2500,
      temperature: 0.4
    });

    const rm = rf.response || '';
    const secciones = rm.split(/\n###\s*/).map(s => s.trim()).filter(s => s.length > 20);
    const fs = secciones.map(s => s.replace(/^\d+\.\s*[A-ZÁÉÍÓÚÑ_ ]+:\s*/i, '').trim());

    await db.prepare('INSERT INTO contexto(fecha,resumen,fases,fuente) VALUES(?,?,?,?)')
      .bind(Date.now(), rm, JSON.stringify(fs), aId).run();

    await db.prepare('UPDATE procesos SET estado=?,fecha_fin=?,fecha_avance=? WHERE id=?')
      .bind('completado', Date.now(), Date.now(), aId).run();

    const ch = await kv.list({ prefix: 'file:' + aId + ':' });
    for (const k of ch.keys) await kv.delete(k.name);
    await kv.delete('proc:' + aId + ':texto');
    await kv.delete('proc:' + aId + ':parciales');
    try { await db.prepare('DELETE FROM archivos WHERE id=?').bind(aId).run(); } catch (x) {}

    await notificar(e, `✅ *Contexto procesado*\n\nID: \`${aId}\`\nSecciones: ${fs.length}/9\n\nEl aliado ya tiene memoria viva del Comandante.`);
  } catch (x) {
    try {
      await db.prepare('UPDATE procesos SET estado=?,error=?,fecha_avance=? WHERE id=?')
        .bind('error', x.message, Date.now(), aId).run();
      await notificar(e, `❌ *Consolidación falló*\n\nID: \`${aId}\`\nError: ${x.message}`);
    } catch (y) {}
  }
}

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
      messages: [{ role: 'user', content: `Resume este intercambio entre el Comandante Yeinier y su aliado digital. Explica QUÉ se habló, QUÉ se decidió, POR QUÉ, y qué información nueva sobre el Comandante o el proyecto apareció. Frases explicativas, no bullets. Máximo 300 palabras.\n\n${texto.substring(0, 9000)}` }],
      max_tokens: 500,
      temperature: 0.3
    });
    const rm = res.response || '';
    if (rm.length < 20) return;

    await db.prepare('INSERT INTO resumenes_chat(user_id,fecha,resumen,desde,hasta) VALUES(?,?,?,?,?)')
      .bind(uid, now, rm, lastSum, now).run();
    await kv.put('last_summary:' + uid, String(now));

    await notificar(e, `🧠 *Resumen automático guardado*\n\nInteracciones: ${msgs.results.length}\nContexto actualizado para el aliado.`);
  } catch (x) {}
}
