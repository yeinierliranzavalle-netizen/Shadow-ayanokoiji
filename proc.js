import { MODELO_LIGERO, CS, LPB, BPL, J, gDB, gKV, b64e, b64d, j2t } from './shared.js';
import { notificar } from './notify.js';
import { consumir } from './presupuesto.js';

const MAX_ARCHIVO = 20 * 1024 * 1024;

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

// ============ SUBIR (NO auto-procesa por defecto) ============
export async function subir(r, e, c) {
  try {
    const f = await r.formData();
    const ar = f.get('archivo');
    const nm = f.get('nombre') || (ar ? ar.name : 'sin_nombre');
    const d = f.get('destino') || 'agente';
    const ap = f.get('autoProcesar') === 'true';
    if (!ar) return J({ error: 'No hay archivo.' });
    const buf = await ar.arrayBuffer();
    const t = buf.byteLength;
    if (t > MAX_ARCHIVO) return J({ error: 'Supera ' + (MAX_ARCHIVO / 1048576) + 'MB.', tamaño: t });
    const kv = gKV(e, d);
    if (!kv) return J({ error: 'KV inválido.' });
    const db = gDB(e, d);
    const id = Date.now() + '_' + nm.replace(/[^a-zA-Z0-9._-]/g, '_');
    const bs = new Uint8Array(buf);
    const ch = chunkBytes(bs, CS);
    for (let i = 0; i < ch.length; i++) await kv.put('file:' + id + ':' + i, b64e(ch[i]));
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
    return J({
      ok: true,
      mensaje: ap ? 'Archivo subido. Procesamiento iniciado.' : 'Archivo subido. NO procesado. Disponible bajo ID.',
      id, tamaño: t, chunks: ch.length, autoProcesado: ap,
      prueba: { tabla: 'archivos', id, chunks: ch.length }
    });
  } catch (x) { return J({ error: 'Error: ' + x.message }); }
}

// ============ PROCESAR (manual, cuando el Comandante lo pida) ============
export async function procesar(r, e, c) {
  try {
    const b = await r.json();
    if (!b.archivoId) return J({ error: 'Falta archivoId.' });
    c.waitUntil(procesarLote(e, b.archivoId, b.destino || 'agente', b.inicio || 0));
    return J({ ok: true, mensaje: 'Lote en proceso.', archivoId: b.archivoId });
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
    return J({ ok: true, mensaje: 'Retomado desde bloque ' + inicio, archivoId: aId, inicio });
  } catch (x) { return J({ error: x.message }); }
}

export async function resumir(r, e) {
  try {
    const b = await r.json();
    if (!b.texto && !b.archivoId) return J({ error: 'Falta texto o archivoId.' });
    const d = b.destino || 'agente', kv = gKV(e, d), db = gDB(e, d);
    if (!kv || !db) return J({ error: 'Destino inválido.' });
    let ct = b.texto;
    if (b.archivoId) ct = j2t(await reconstruir(kv, 'file:' + b.archivoId + ':'));
    if (!ct || ct.length < 100) return J({ error: 'Contenido corto.' });
    const id = 'm_' + Date.now();
    await db.prepare('INSERT INTO procesos(id,archivo_id,estado,bloques_total,bloques_hechos,fecha_inicio,fecha_avance) VALUES(?,?,?,?,?,?,?)')
      .bind(id, b.archivoId || id, 'pendiente', 0, 0, Date.now(), Date.now()).run();
    await kv.put('proc:' + id + ':texto', ct);
    await procesarLote(e, id, d, 0);
    return J({ ok: true, mensaje: 'Procesamiento iniciado.', procesoId: id });
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
  if (!await consumir(e, 'procesamiento')) return;

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
        const r1 = await ai.run(MODELO_LIGERO, {
          messages: [{ role: 'user', content: `Analiza este fragmento de conversación entre el Comandante Yeinier y su aliado. Extrae TODA la información útil:\n- Quién es el Comandante, cómo piensa, qué lo motiva.\n- Decisiones y POR QUÉ se tomaron.\n- Errores, correcciones y aprendizajes.\n- Proyecto Shadow Arise: estrategia, componentes, estado.\n- Ayanokōji Digital: rol, comportamiento, límites.\n- IA publicadora: canales, estrategia.\n- Planes futuros, ideas pendientes, cualquier detalle adicional.\n\nSé específico. Explica el porqué. Máximo 300 palabras.\n\nFragmento ${i + 1}/${tot}:\n${bl[i]}` }],
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
  if (!await consumir(e, 'procesamiento')) return;
  try {
    let pz = ac.split('\n\n[BLOQUE ').map((p, i) => i === 0 ? p : '[BLOQUE ' + p).filter(p => p.trim().length > 30);
    while (pz.length > 5) {
      const nv = [];
      for (let i = 0; i < pz.length; i += 5) {
        const td = pz.slice(i, i + 5).join('\n---\n');
        try {
          const r1 = await ai.run(MODELO_LIGERO, {
            messages: [{ role: 'user', content: `Fusiona estos resúmenes en uno. Conserva TODOS los detalles. Explica el porqué. Máximo 600 palabras.\n\n${td}` }],
            max_tokens: 900,
            temperature: 0.3
          });
          nv.push(r1.response || td);
        } catch (x) { nv.push(td); }
      }
      pz = nv;
    }
    const tc = pz.join('\n\n');

    const rf = await ai.run(MODELO_LIGERO, {
      messages: [{
        role: 'user',
        content: `Genera un PERFIL MAESTRO del Comandante Yeinier en 9 secciones. Cada sección debe ser EXPLICATIVA: QUÉ, POR QUÉ y CÓMO. Formato: cada sección empieza con "### N. TITULO:" y termina con "###" en línea aparte. Mínimo 80 palabras por sección.

### 1. IDENTIDAD:
Quién es, esencia, forma de pensar.

### 2. CONTEXTO:
Cuba rural, familia, presión, fe adventista.

### 3. OBJETIVO:
Meta principal y motivación profunda.

### 4. PROYECTO SHADOW ARISE:
Estrategia, componentes, monetización, estado.

### 5. ALIADO DIGITAL:
Rol de Ayanokōji, cómo debe comportarse, límites.

### 6. IA PUBLICADORA:
Canales, estrategia, contenido.

### 7. REGLAS OPERATIVAS:
Cómo trabajar con el Comandante.

### 8. DECISIONES TOMADAS Y SU RAZÓN:
QUÉ, POR QUÉ y CÓMO.

### 9. IDEAS PENDIENTES:
Robot, casa, paneles, auto-mejora, sandbox.

Resúmenes:
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

    await notificar(e, `✅ *Contexto procesado*\n\nID: \`${aId}\`\nSecciones: ${fs.length}/9`);
  } catch (x) {
    try {
      await db.prepare('UPDATE procesos SET estado=?,error=?,fecha_avance=? WHERE id=?')
        .bind('error', x.message, Date.now(), aId).run();
      await notificar(e, `❌ *Consolidación falló*\n\nID: \`${aId}\`\nError: ${x.message}`);
    } catch (y) {}
  }
}

// ============ CRON ============
export async function cronRetomar(e) {
  const db = gDB(e, 'agente');
  const ai = e.ayanokoji_IA;
  if (!db || !ai) return;
  const hora = new Date().getUTCHours();
  const nocturno = hora >= 23 || hora < 8;
  if (nocturno) {
    const ultimo = await e.KV?.get('cron_ultimo_nocturno');
    const ahora = Date.now();
    if (ultimo && ahora - parseInt(ultimo) < 20 * 60 * 1000) return;
    await e.KV?.put('cron_ultimo_nocturno', String(ahora), { expirationTtl: 3600 });
  }
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

export async function cronMantenimiento(e) {
  const hora = new Date().getUTCHours();
  if (hora !== 4) return; // Solo a las 4 AM UTC
  const db = gDB(e, 'agente');
  const kv = gKV(e, 'agente');
  if (!db || !kv) return;
  try {
    // Limpiar KV huérfanos
    const files = await kv.list({ prefix: 'file:', limit: 500 });
    const procesos = await db.prepare("SELECT id FROM procesos WHERE estado IN ('procesando','pendiente')").all();
    const activos = new Set((procesos.results || []).map(p => p.id));
    let limpiados = 0;
    for (const k of files.keys) {
      const partes = k.name.split(':');
      const archivoId = partes[1];
      if (!activos.has(archivoId)) {
        await kv.delete(k.name);
        limpiados++;
      }
    }
    // Consolidar resumenes viejos
    const viejos = await db.prepare('SELECT id FROM resumenes_chat WHERE fecha < ? ORDER BY fecha ASC LIMIT 20').bind(Date.now() - 30 * 86400000).all();
    if (viejos.results && viejos.results.length >= 10) {
      // Aquí se podrían fusionar, por ahora solo reporta
    }
    await kv.put('ultimo_mantenimiento', String(Date.now()));
  } catch (x) {}
}

export async function resumirChats(e, uid) {
  const db = gDB(e, 'agente'), kv = gKV(e, 'agente'), ai = e.ayanokoji_IA;
  if (!db || !kv || !ai) return;
  if (!await consumir(e, 'chat')) return;
  try {
    const lastSum = parseInt(await kv.get('last_summary:' + uid) || '0');
    const now = Date.now();
    const msgs = await db.prepare(
      'SELECT mensaje, respuesta FROM historial WHERE user_id=? AND fecha > ? ORDER BY fecha ASC LIMIT 40'
    ).bind(uid, lastSum).all();
    if (!msgs.results || msgs.results.length < 5) return;

    const texto = msgs.results.map(m => `Comandante: ${m.mensaje}\nAyanokōji: ${m.respuesta}`).join('\n\n');
    const res = await ai.run(MODELO_LIGERO, {
      messages: [{ role: 'user', content: `Resume este intercambio. Explica QUÉ se habló, QUÉ se decidió, POR QUÉ, qué nuevo sobre el Comandante o el proyecto. Frases explicativas. Máximo 300 palabras.\n\n${texto.substring(0, 9000)}` }],
      max_tokens: 500,
      temperature: 0.3
    });
    const rm = res.response || '';
    if (rm.length < 20) return;

    await db.prepare('INSERT INTO resumenes_chat(user_id,fecha,resumen,desde,hasta) VALUES(?,?,?,?,?)')
      .bind(uid, now, rm, lastSum, now).run();
    await kv.put('last_summary:' + uid, String(now));
    await notificar(e, `🧠 *Resumen auto guardado*\n\nInteracciones: ${msgs.results.length}`);
  } catch (x) {}
}

// ============ ÍNDICE SEMÁNTICO ============
export async function indexarHistorial(r, e) {
  try {
    const db = gDB(e, 'agente');
    const ai = e.ayanokoji_IA;
    if (!db || !ai) return J({ error: 'D1 o IA no disponible.' });

    const msgs = await db.prepare(
      'SELECT orden, contenido FROM historial_largo WHERE user_id=? ORDER BY orden ASC'
    ).bind('comandante').all();
    if (!msgs.results || !msgs.results.length) return J({ error: 'Historial vacío.' });

    await db.prepare('DELETE FROM indice_temas').run();

    let procesados = 0, temasInsertados = 0;
    for (let i = 0; i < msgs.results.length; i += 20) {
      const lote = msgs.results.slice(i, i + 20);
      const texto = lote.map(m => `[${m.orden}] ${m.contenido.substring(0, 400)}`).join('\n\n');

      if (!await consumir(e, 'procesamiento')) break;

      try {
        const res = await ai.run(MODELO_LIGERO, {
          messages: [{ role: 'user', content: `De estos mensajes, extrae los TEMAS/CONCEPTOS clave (no palabras sueltas). Formato JSON: [{"orden": N, "temas": ["tema1", "tema2"], "peso": 1-10}]. Max 3 temas por mensaje. Temas cortos (1-3 palabras).\n\n${texto}` }],
          max_tokens: 800,
          temperature: 0.2
        });

        const rp = res.response || '';
        const match = rp.match(/\[[\s\S]*\]/);
        if (match) {
          try {
            const items = JSON.parse(match[0]);
            for (const item of items) {
              if (!item.temas) continue;
              for (const tema of item.temas) {
                await db.prepare('INSERT INTO indice_temas(mensaje_orden, tema, peso, fecha) VALUES(?,?,?,?)')
                  .bind(item.orden, String(tema).toLowerCase(), item.peso || 5, Date.now()).run();
                temasInsertados++;
              }
            }
          } catch (x) {}
        }
        procesados += lote.length;
      } catch (x) {}
    }

    return J({ ok: true, procesados, total: msgs.results.length, temas_insertados: temasInsertados });
  } catch (x) {
    return J({ error: x.message });
  }
}

export async function buscarPorTema(r, e) {
  try {
    const u = new URL(r.url);
    const q = (u.searchParams.get('q') || '').toLowerCase();
    const limite = parseInt(u.searchParams.get('limite') || '30');
    if (!q) return J({ error: 'Falta q.' });

    const db = gDB(e, 'agente');
    if (!db) return J({ error: 'D1 no disponible.' });

    const temas = await db.prepare(
      'SELECT DISTINCT mensaje_orden, tema, peso FROM indice_temas WHERE tema LIKE ? ORDER BY peso DESC LIMIT ?'
    ).bind('%' + q + '%', limite).all();

    if (!temas.results || !temas.results.length) {
      const r1 = await db.prepare(
        'SELECT rol,contenido,orden FROM historial_largo WHERE contenido LIKE ? ORDER BY orden DESC LIMIT ?'
      ).bind('%' + q + '%', limite).all();
      return J({ consulta: q, metodo: 'directo', total: r1.results.length, resultados: r1.results });
    }

    const ords = temas.results.map(t => t.mensaje_orden);
    const ph = ords.map(() => '?').join(',');
    const msgs = await db.prepare(
      'SELECT rol,contenido,orden FROM historial_largo WHERE orden IN (' + ph + ') ORDER BY orden ASC'
    ).bind(...ords).all();

    return J({ consulta: q, metodo: 'indice_semantico', total: msgs.results.length, resultados: msgs.results });
  } catch (x) {
    return J({ error: x.message });
  }
}

// ============ ANÁLISIS DE ARCHIVOS ============
export async function analizarArchivo(r, e) {
  try {
    const b = await r.json();
    const archivoId = b.archivoId;
    if (!archivoId) return J({ error: 'Falta archivoId.' });
    const kv = gKV(e, 'agente');
    if (!kv) return J({ error: 'KV no disponible.' });

    const txt = j2t(await reconstruir(kv, 'file:' + archivoId + ':'));
    const db = gDB(e, 'agente');
    const meta = db ? await db.prepare('SELECT * FROM archivos WHERE id=?').bind(archivoId).first() : null;

    return J({
      ok: true,
      archivoId,
      metadata: meta,
      longitud_texto: txt.length,
      preview: txt.substring(0, 3000)
    });
  } catch (x) {
    return J({ error: x.message });
  }
}

// ============ EXTRACTOR DE CONTENIDO ============
function extraerTextoDeContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(c => extraerTextoDeContent(c)).filter(Boolean).join('\n');
  }
  if (typeof content === 'object') {
    if (Array.isArray(content.parts)) return content.parts.map(p => extraerTextoDeContent(p)).filter(Boolean).join('\n');
    if (typeof content.text === 'string') return content.text;
    if (typeof content.content === 'string') return content.content;
    if (typeof content.value === 'string') return content.value;
    if (typeof content.body === 'string') return content.body;
    if (Array.isArray(content.content)) return content.content.map(c => extraerTextoDeContent(c)).filter(Boolean).join('\n');
  }
  return '';
}

function extraerDeFragments(fragments) {
  if (!Array.isArray(fragments)) return [];
  const mensajes = [];
  for (const f of fragments) {
    if (!f || typeof f !== 'object') continue;
    const tipo = String(f.type || '').toUpperCase();
    let rol = 'user';
    if (tipo === 'RESPONSE') rol = 'assistant';
    else if (tipo === 'REQUEST') rol = 'user';
    else if (tipo === 'THINKING') continue;
    else if (tipo === 'ERROR' || tipo === 'SEARCH') continue;

    let contenido = '';
    if (typeof f.content === 'string') contenido = f.content;
    else if (f.content && typeof f.content === 'object') contenido = extraerTextoDeContent(f.content);

    if (!contenido || !contenido.trim()) continue;
    mensajes.push({ rol, contenido: contenido.trim() });
  }
  return mensajes;
}

function extraerMensajesDeMapping(mapping) {
  const keys = Object.keys(mapping);
  if (!keys.length) return null;

  const nodos = [];
  let sinMessage = 0, sinContenido = 0;
  const ejemplos = [];

  for (const k of keys) {
    const n = mapping[k];
    if (!n || typeof n !== 'object') continue;
    if (!n.message) { sinMessage++; continue; }

    const msg = n.message;

    let tiempo = 0;
    if (msg.create_time) tiempo = msg.create_time;
    else if (msg.inserted_at) {
      const t = Date.parse(msg.inserted_at);
      if (!isNaN(t)) tiempo = t;
    }
    if (!tiempo) tiempo = parseFloat(k) || 0;

    if (Array.isArray(msg.fragments) && msg.fragments.length) {
      const fragMsgs = extraerDeFragments(msg.fragments);
      if (fragMsgs.length) {
        for (const fm of fragMsgs) {
          nodos.push({ orden: tiempo, rol: fm.rol, contenido: fm.contenido });
        }
        continue;
      } else {
        sinContenido++;
        if (ejemplos.length < 3) ejemplos.push({ key: k, tipo: 'fragments_vacios', fragments_count: msg.fragments.length });
        continue;
      }
    }

    let rol = msg.author?.role || msg.role || msg.sender || 'user';
    rol = String(rol).toLowerCase();
    if (rol === 'assistant' || rol === 'bot' || rol === 'ai' || rol === 'model') rol = 'assistant';
    else if (rol === 'system' || rol === 'tool' || rol === 'function') { sinContenido++; continue; }
    else rol = 'user';

    const contenido = extraerTextoDeContent(msg.content);

    if (!contenido || !contenido.trim()) {
      sinContenido++;
      if (ejemplos.length < 3) {
        let preview = '';
        try { preview = String(JSON.stringify(msg.content) || '').substring(0, 200); } catch (e) { preview = String(msg.content || '').substring(0, 200); }
        ejemplos.push({ key: k, msg_keys: Object.keys(msg), content_type: typeof msg.content, content_preview: preview });
      }
      continue;
    }

    nodos.push({ orden: tiempo, rol, contenido: contenido.trim() });
  }

  nodos.sort((a, b) => a.orden - b.orden);
  const mensajes = nodos.map(n => ({ role: n.rol, content: n.contenido }));

  return {
    mensajes,
    stats: {
      total_nodos: keys.length,
      con_message: keys.length - sinMessage,
      sin_contenido: sinContenido,
      validos: mensajes.length,
      ejemplos_vacios: ejemplos
    }
  };
}

function extraerMensajes(data, profundidad = 0) {
  if (profundidad > 10) return null;
  if (!data) return null;

  if (Array.isArray(data)) {
    const primeros = data.slice(0, 3).filter(x => x && typeof x === 'object');
    if (primeros.length > 0) {
      const tieneContenido = primeros.some(m =>
        m.content || m.contenido || m.text || m.message || m.mensaje || m.query || m.response || m.prompt || m.completion
      );
      if (tieneContenido) return { mensajes: data, stats: { origen: 'array_directo' } };
    }
    for (const item of data) {
      const sub = extraerMensajes(item, profundidad + 1);
      if (sub) return sub;
    }
    return null;
  }

  if (typeof data === 'object') {
    if (data.mapping && typeof data.mapping === 'object' && !Array.isArray(data.mapping)) {
      const r = extraerMensajesDeMapping(data.mapping);
      if (r && r.mensajes.length) return { mensajes: r.mensajes, stats: r.stats };
      if (r) return { mensajes: [], stats: r.stats };
    }

    const clavesComunes = ['messages','mensajes','conversation','conversacion','chat','historial','history','data','dialogo','dialogos','conversations','intercambios','turns','turnos','exchanges','items','entries','registros','logs'];
    for (const k of clavesComunes) {
      if (data[k]) {
        const sub = extraerMensajes(data[k], profundidad + 1);
        if (sub) return sub;
      }
    }

    for (const k of Object.keys(data)) {
      const v = data[k];
      if (Array.isArray(v) && v.length > 0) {
        const sub = extraerMensajes(v, profundidad + 1);
        if (sub) return sub;
      }
      if (v && typeof v === 'object') {
        const sub = extraerMensajes(v, profundidad + 1);
        if (sub) return sub;
      }
    }
  }
  return null;
}

function parsearMensaje(m) {
  if (!m || typeof m !== 'object') {
    if (typeof m === 'string') return { rol: 'user', contenido: m };
    return null;
  }
  let rol = m.role || m.rol || m.from || m.sender || m.author || m.who || m.tipo || m.type || 'user';
  rol = String(rol).toLowerCase();
  if (['assistant','bot','ai','model','gpt','ayanokoji','ayanokōji','a'].includes(rol)) rol = 'assistant';
  else if (['human','user','usuario','comandante','yo','u'].includes(rol)) rol = 'user';
  else if (['system','sistema'].includes(rol)) rol = 'system';
  else rol = 'user';

  let contenido = extraerTextoDeContent(m);
  if (!contenido || !contenido.trim()) {
    contenido = m.content || m.contenido || m.text || m.texto || m.message || m.mensaje || m.query || m.prompt || m.value || m.body || '';
    if (typeof contenido !== 'string') contenido = JSON.stringify(contenido);
  }
  if (!contenido.trim() && (m.response || m.completion || m.answer || m.respuesta)) {
    const r = m.response || m.completion || m.answer || m.respuesta;
    contenido = typeof r === 'string' ? r : JSON.stringify(r);
    rol = 'assistant';
  }
  if (!contenido.trim()) return null;
  return { rol, contenido: contenido.trim() };
}

export async function importar(r, e) {
  try {
    const form = await r.formData();
    const archivo = form.get('archivo');
    const uid = form.get('user_id') || 'comandante';
    const limite = parseInt(form.get('limite') || '2000');
    if (!archivo) return J({ error: 'Falta archivo JSON.' });

    const texto = await archivo.text();
    const tamaño = texto.length;
    if (tamaño > MAX_ARCHIVO) return J({ error: 'Supera ' + (MAX_ARCHIVO / 1048576) + 'MB.', tamaño });

    let data;
    try { data = JSON.parse(texto); } catch (x) {
      return J({ error: 'JSON inválido: ' + x.message, primeros_200: String(texto || '').substring(0, 200) });
    }

    const resultado = extraerMensajes(data);
    const lista = resultado ? resultado.mensajes : null;
    const stats = resultado ? resultado.stats : {};

    if (!lista || !lista.length) {
      const keys = data && typeof data === 'object' ? Object.keys(data).slice(0, 15) : [];
      return J({
        error: 'No se encontraron mensajes en el JSON.',
        diagnostico: {
          tipo_raiz: Array.isArray(data) ? 'array' : typeof data,
          claves_raiz: keys,
          stats_extractor: stats,
          primeros_300_caracteres: String(texto || '').substring(0, 300)
        }
      });
    }

    const db = gDB(e, 'agente');
    if (!db) return J({ error: 'D1 no configurado.' });

    const desde = Math.max(0, lista.length - limite);
    const recorte = lista.slice(desde);

    await db.prepare('DELETE FROM historial_largo WHERE user_id=?').bind(uid).run();

    let orden = 0, insertados = 0, saltados = 0;
    for (const m of recorte) {
      const p = parsearMensaje(m);
      if (!p) { saltados++; continue; }
      if (p.rol === 'system') { saltados++; continue; }
      await db.prepare('INSERT INTO historial_largo(user_id,rol,contenido,orden,fecha) VALUES(?,?,?,?,?)')
        .bind(uid, p.rol, p.contenido, orden, Date.now()).run();
      orden++; insertados++;
    }

    try {
      await notificar(e, `📥 *Importación*\n\nInsertados: ${insertados}\nTotal: ${lista.length}`);
    } catch (x) {}

    return J({ ok: true, insertados, total: lista.length, saltados, desde, stats_extractor: stats });
  } catch (x) {
    return J({ error: 'Error al importar: ' + x.message });
  }
}
