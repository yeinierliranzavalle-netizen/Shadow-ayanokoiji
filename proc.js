import { MODELO_LIGERO, CS, LPB, BPL, J, gDB, gKV, b64e, b64d, j2t } from './shared.js';
import { notificar } from './notify.js';
import { consumir } from './presupuesto.js';

const MAX_ARCHIVO = 20 * 1024 * 1024;

const STOPWORDS = new Set([
  'que','de','la','el','en','y','a','los','del','se','las','por','un','para','con','no','una','su','al','lo','como','más','pero','sus','le','ya','o','este','sí','porque','esta','entre','cuando','muy','sin','sobre','también','me','hasta','hay','donde','quien','desde','todo','nos','durante','todos','uno','les','ni','contra','otros','ese','eso','ante','ellos','e','esto','mí','antes','algunos','qué','unos','yo','otro','otras','otra','él','tanto','esa','estos','mucho','quienes','nada','muchos','cual','poco','ella','estar','estas','algunas','algo','nosotros','mi','mis','tú','te','ti','tu','tus','ellas','nosotras','vosotros','vosotras','os','mío','mía','míos','mías','tuyo','tuya','tuyos','tuyas','suyo','suya','suyos','suyas','nuestro','nuestra','nuestros','nuestras','vuestro','vuestra','vuestros','vuestras','esos','esas','estoy','estás','está','estamos','estáis','están','soy','eres','es','somos','sois','son'
]);

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

// ============================================================
// CONSULTAR CAPACIDAD REAL DE CLOUDFLARE
// Ayanokōji usa esto antes de decidir. Datos reales, no locales.
// ============================================================
async function consultarCapacidadReal(e) {
  const accountId = e.CF_ACCOUNT_ID;
  const token = e.CF_API_TOKEN;
  if (!accountId || !token) return { ok: false, error: 'Sin CF_ACCOUNT_ID o CF_API_TOKEN.' };

  // Cache 5 min para no saturar
  const kv = gKV(e, 'agente');
  if (kv) {
    try {
      const cache = await kv.get('capacidad_real_cache');
      if (cache) {
        const p = JSON.parse(cache);
        if (Date.now() - p.ts < 5 * 60 * 1000) return { ok: true, cache: true, ...p.datos };
      }
    } catch (x) {}
  }

  const ahora = new Date();
  const inicioDiaISO = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate())).toISOString();
  const inicioDiaDate = inicioDiaISO.split('T')[0];

  const query = `
    query GetUsage($accountTag: String!, $startDate: String!, $startDatetime: String!) {
      viewer {
        accounts(filter: {accountTag: $accountTag}) {
          workersInvocationsAdaptive(limit: 1000, filter: { datetime_geq: $startDatetime }) {
            sum { requests errors subrequests }
          }
          d1AnalyticsAdaptiveGroups(limit: 100, filter: { date_geq: $startDate }) {
            sum { readQueries writeQueries }
          }
          kvOperationsAdaptiveGroups(limit: 100, filter: { date_geq: $startDate }) {
            sum { requests }
            dimensions { actionType }
          }
        }
      }
    }
  `;

  try {
    const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { accountTag: accountId, startDate: inicioDiaDate, startDatetime: inicioDiaISO } })
    });

    const data = await r.json();
    if (!data.data || !data.data.viewer || !data.data.viewer.accounts) {
      return { ok: false, error: 'GraphQL sin datos.' };
    }

    const cuenta = data.data.viewer.accounts[0];
    let workers_requests = 0, workers_subrequests = 0, workers_errores = 0;
    for (const g of (cuenta.workersInvocationsAdaptive || [])) {
      workers_requests += g.sum?.requests || 0;
      workers_subrequests += g.sum?.subrequests || 0;
      workers_errores += g.sum?.errors || 0;
    }

    let d1_reads = 0, d1_writes = 0;
    for (const g of (cuenta.d1AnalyticsAdaptiveGroups || [])) {
      d1_reads += g.sum?.readQueries || 0;
      d1_writes += g.sum?.writeQueries || 0;
    }

    let kv_reads = 0, kv_writes = 0;
    for (const g of (cuenta.kvOperationsAdaptiveGroups || [])) {
      const tipo = (g.dimensions?.actionType || '').toLowerCase();
      const c = g.sum?.requests || 0;
      if (tipo.includes('read')) kv_reads += c;
      else if (tipo.includes('write')) kv_writes += c;
    }

    const datos = {
      workers_requests, workers_subrequests, workers_errores,
      d1_reads, d1_writes, kv_reads, kv_writes,
      limites: {
        workers_requests: 100000,
        workers_subrequests: 1000000,
        d1_reads: 5000000,
        d1_writes: 100000,
        kv_reads: 100000,
        kv_writes: 1000
      },
      ts: Date.now()
    };

    if (kv) {
      try { await kv.put('capacidad_real_cache', JSON.stringify({ ts: Date.now(), datos }), { expirationTtl: 600 }); } catch (x) {}
    }

    return { ok: true, cache: false, ...datos };
  } catch (x) {
    return { ok: false, error: x.message };
  }
}

// ============================================================
// SUBIR
// ============================================================
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
      mensaje: ap ? 'Archivo subido. Procesamiento iniciado.' : 'Archivo subido. NO procesado.',
      id, tamaño: t, chunks: ch.length, autoProcesado: ap
    });
  } catch (x) { return J({ error: 'Error: ' + x.message }); }
}

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
      await notificar(e, `❌ *Proceso falló*\n\nID: \`${aId}\`\nError: ${x.message}`);
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
        content: `Genera un PERFIL MAESTRO del Comandante Yeinier en 9 secciones. Cada sección EXPLICATIVA: QUÉ, POR QUÉ y CÓMO. Formato: "### N. TITULO:" y termina con "###". Mínimo 80 palabras.\n\n### 1. IDENTIDAD\n### 2. CONTEXTO\n### 3. OBJETIVO\n### 4. PROYECTO SHADOW ARISE\n### 5. ALIADO DIGITAL\n### 6. IA PUBLICADORA\n### 7. REGLAS OPERATIVAS\n### 8. DECISIONES TOMADAS Y SU RAZÓN\n### 9. IDEAS PENDIENTES\n\nResúmenes:\n${tc.substring(0, 9000)}`
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

// ============================================================
// CRON RETOMAR — Solo procesos atascados
// ============================================================
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

// ============================================================
// CRON AUTÓNOMO — El cerebro. Ahora consulta CAPACIDAD REAL primero.
// ============================================================
export async function cronAutonomo(e) {
  const db = gDB(e, 'agente');
  const kv = gKV(e, 'agente');
  const ai = e.ayanokoji_IA;
  if (!db || !kv || !ai) return;

  const ultima = await kv.get('cron_autonomo_ultima');
  const ahora = Date.now();
  if (ultima && ahora - parseInt(ultima) < 25 * 60 * 1000) return;
  await kv.put('cron_autonomo_ultima', String(ahora), { expirationTtl: 7200 });

  // ============ FASE 1: CONSULTAR CAPACIDAD REAL ============
  const capacidad = await consultarCapacidadReal(e);
  const capDisponible = capacidad.ok;

  // Si la capacidad real dice que estamos por encima del 80% de algo crítico, esperar
  if (capDisponible) {
    const wr = capacidad.workers_requests || 0;
    const d1w = capacidad.d1_writes || 0;
    const kvw = capacidad.kv_writes || 0;
    if (wr > 80000 || d1w > 80000 || kvw > 800) {
      try {
        await db.prepare('INSERT INTO notificaciones(tipo,titulo,mensaje,leida,fecha) VALUES(?,?,?,0,?)')
          .bind('cron_autonomo', 'Capacidad real alta',
            `Workers: ${wr}/100000. D1 writes: ${d1w}/100000. KV writes: ${kvw}/1000. No actúo para no agotar.`, Date.now()).run();
      } catch (x) {}
      return;
    }
  }

  // ============ FASE 2: OBSERVAR EL TABLERO ============
  const tablero = {
    procesos_activos: 0,
    archivos_huerfanos: 0,
    mensajes_largo: 0,
    temas_indexados: 0,
    modo_indice: 'ninguno',
    resumenes_viejos: 0,
    errores_recientes: 0,
    tareas_pendientes: 0,
    capacidad_workers_pct: capDisponible ? Math.round((capacidad.workers_requests || 0) / 100000 * 100) : null,
    capacidad_d1w_pct: capDisponible ? Math.round((capacidad.d1_writes || 0) / 100000 * 100) : null,
    capacidad_kvw_pct: capDisponible ? Math.round((capacidad.kv_writes || 0) / 1000 * 100) : null,
    hora: new Date().getUTCHours()
  };

  try {
    const p = await db.prepare("SELECT COUNT(*) as n FROM procesos WHERE estado IN ('procesando','pendiente')").first();
    tablero.procesos_activos = p ? p.n : 0;
  } catch (x) {}

  try {
    const files = await kv.list({ prefix: 'file:', limit: 500 });
    tablero.archivos_huerfanos = files.keys.length;
  } catch (x) {}

  try {
    const m = await db.prepare('SELECT COUNT(*) as n FROM historial_largo').first();
    tablero.mensajes_largo = m ? m.n : 0;
    const t = await db.prepare('SELECT COUNT(*) as n FROM indice_temas').first();
    tablero.temas_indexados = t ? t.n : 0;
    tablero.modo_indice = await kv.get('indice:ultimo_modo') || 'ninguno';
  } catch (x) {}

  try {
    const r = await db.prepare("SELECT COUNT(*) as n FROM resumenes_chat WHERE fecha < ?").bind(ahora - 30 * 86400000).first();
    tablero.resumenes_viejos = r ? r.n : 0;
  } catch (x) {}

  try {
    const e1 = await db.prepare("SELECT COUNT(*) as n FROM acciones WHERE exito=0 AND fecha > ?").bind(ahora - 86400000).first();
    tablero.errores_recientes = e1 ? e1.n : 0;
  } catch (x) {}

  try {
    const t = await db.prepare("SELECT COUNT(*) as n FROM tareas WHERE estado='pendiente'").first();
    tablero.tareas_pendientes = t ? t.n : 0;
  } catch (x) {}

  // ============ FASE 3: DECIDIR ============
  if (tablero.procesos_activos > 0) return;

  const candidatas = [];

  if (tablero.modo_indice !== 'ia_con_fallback' && tablero.mensajes_largo > 100 && tablero.temas_indexados < tablero.mensajes_largo * 3) {
    candidatas.push({ tipo: 'reindexar', peso: 8 });
  }
  if (tablero.archivos_huerfanos > 30) {
    candidatas.push({ tipo: 'limpiar_kv', peso: 5 });
  }
  if (tablero.resumenes_viejos > 10) {
    candidatas.push({ tipo: 'consolidar_resumenes', peso: 6 });
  }
  if (tablero.errores_recientes > 5) {
    candidatas.push({ tipo: 'analizar_errores', peso: 7 });
  }
  if (tablero.tareas_pendientes > 0) {
    candidatas.push({ tipo: 'procesar_tareas', peso: 4 });
  }
  if (tablero.mensajes_largo > 500 && tablero.hora >= 2 && tablero.hora < 6) {
    candidatas.push({ tipo: 'reflexionar', peso: 3 });
  }

  // Si el índice está por debajo de 3 temas/mensaje Y hay capacidad, subir el peso del reindexado
  if (capDisponible && tablero.capacidad_workers_pct !== null && tablero.capacidad_workers_pct < 50) {
    const idx = candidatas.find(c => c.tipo === 'reindexar');
    if (idx) idx.peso += 2;
  }

  if (!candidatas.length) {
    try {
      await db.prepare('INSERT INTO notificaciones(tipo,titulo,mensaje,leida,fecha) VALUES(?,?,?,0,?)')
        .bind('cron_autonomo', 'Noche tranquila',
          `Observé el tablero y la capacidad real. Nada requiere acción. Workers: ${tablero.capacidad_workers_pct}%.`, ahora).run();
    } catch (x) {}
    return;
  }

  candidatas.sort((a, b) => b.peso - a.peso);
  const elegida = candidatas[0];

  // ============ FASE 4: EJECUTAR ============
  let resultado = '';
  try {
    if (elegida.tipo === 'reindexar') {
      try {
        const prueba = await ai.run(MODELO_LIGERO, { messages: [{ role: 'user', content: 'ok' }], max_tokens: 3 });
        if (prueba && prueba.response) {
          const idx = await indexarHistorial({ json: async () => ({}) }, e);
          resultado = 'Reindexado con IA. Temas: ' + (idx.temas_insertados || '?');
        } else {
          resultado = 'IA no disponible, pospuesto.';
        }
      } catch (x) { resultado = 'Reindexado falló: ' + x.message; }
    }

    if (elegida.tipo === 'limpiar_kv') {
      const files = await kv.list({ prefix: 'file:', limit: 500 });
      const procs = await db.prepare("SELECT id FROM procesos WHERE estado IN ('procesando','pendiente')").all();
      const activos = new Set((procs.results || []).map(p => p.id));
      let limpiados = 0;
      for (const k of files.keys) {
        const archivoId = k.name.split(':')[1];
        if (!activos.has(archivoId)) { await kv.delete(k.name); limpiados++; }
      }
      resultado = 'Limpiados ' + limpiados + ' chunks huérfanos.';
    }

    if (elegida.tipo === 'consolidar_resumenes') {
      const viejos = await db.prepare("SELECT id, resumen FROM resumenes_chat WHERE fecha < ? ORDER BY fecha ASC LIMIT 10").bind(ahora - 30 * 86400000).all();
      if (viejos.results && viejos.results.length >= 5) {
        const texto = viejos.results.map(r => r.resumen).join('\n---\n');
        try {
          const fus = await ai.run(MODELO_LIGERO, {
            messages: [{ role: 'user', content: `Fusiona estos resúmenes antiguos en uno solo consolidado. Conserva lo esencial. Máximo 400 palabras.\n\n${texto}` }],
            max_tokens: 600,
            temperature: 0.3
          });
          if (fus.response) {
            await db.prepare('INSERT INTO resumenes_chat(user_id,fecha,resumen,desde,hasta) VALUES(?,?,?,?,?)')
              .bind('comandante', Date.now(), '[CONSOLIDADO] ' + fus.response, 0, Date.now()).run();
            const ids = viejos.results.map(r => r.id);
            const ph = ids.map(() => '?').join(',');
            await db.prepare('DELETE FROM resumenes_chat WHERE id IN (' + ph + ')').bind(...ids).run();
            resultado = 'Consolidados ' + ids.length + ' resúmenes.';
          }
        } catch (x) { resultado = 'Consolidación IA falló.'; }
      }
    }

    if (elegida.tipo === 'analizar_errores') {
      const errs = await db.prepare("SELECT tipo, descripcion, detalle FROM acciones WHERE exito=0 ORDER BY fecha DESC LIMIT 10").all();
      if (errs.results && errs.results.length) {
        const texto = errs.results.map(x => `[${x.tipo}] ${x.descripcion} — ${x.detalle}`).join('\n');
        try {
          const anal = await ai.run(MODELO_LIGERO, {
            messages: [{ role: 'user', content: `Analiza estos errores recientes. ¿Hay un patrón? ¿Qué solución propones? Máximo 200 palabras.\n\n${texto}` }],
            max_tokens: 400,
            temperature: 0.5
          });
          resultado = 'Análisis: ' + (anal.response || '').substring(0, 300);
        } catch (x) { resultado = 'Análisis falló.'; }
      }
    }

    if (elegida.tipo === 'procesar_tareas') {
      resultado = 'Tareas pendientes detectadas. Delegado al worker.';
    }

    if (elegida.tipo === 'reflexionar') {
      try {
        const frag = await db.prepare('SELECT contenido FROM historial_largo ORDER BY RANDOM() LIMIT 5').all();
        const texto = (frag.results || []).map(x => x.contenido).join('\n---\n');
        if (texto.length > 200) {
          const refl = await ai.run(MODELO_LIGERO, {
            messages: [{ role: 'user', content: `Lee estos fragmentos del historial del Comandante y extrae UNA idea o patrón que valga la pena recordarle. Máximo 150 palabras. Directo.\n\n${texto.substring(0, 6000)}` }],
            max_tokens: 300,
            temperature: 0.6
          });
          resultado = 'Reflexión: ' + (refl.response || '').substring(0, 300);
        }
      } catch (x) { resultado = 'Reflexión falló.'; }
    }

    try {
      await db.prepare('INSERT INTO acciones(tipo,descripcion,exito,detalle,fecha) VALUES(?,?,?,?,?)')
        .bind('autonomo_' + elegida.tipo, 'Cron eligió: ' + elegida.tipo, 1, resultado.substring(0, 500), ahora).run();
    } catch (x) {}

    try {
      await db.prepare('INSERT INTO notificaciones(tipo,titulo,mensaje,leida,fecha) VALUES(?,?,?,0,?)')
        .bind('cron_autonomo', 'Acción autónoma: ' + elegida.tipo,
          `${resultado}\n\nCapacidad real usada para decidir: Workers ${tablero.capacidad_workers_pct}%, D1 writes ${tablero.capacidad_d1w_pct}%, KV writes ${tablero.capacidad_kvw_pct}%`,
          ahora).run();
    } catch (x) {}

  } catch (x) {
    try {
      await db.prepare('INSERT INTO acciones(tipo,descripcion,exito,detalle,fecha) VALUES(?,?,?,?,?)')
        .bind('autonomo_' + elegida.tipo, 'Cron falló: ' + elegida.tipo, 0, x.message, Date.now()).run();
    } catch (y) {}
  }
}

export async function cronMantenimiento(e) {
  return;
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
      messages: [{ role: 'user', content: `Resume este intercambio. Explica QUÉ se habló, QUÉ se decidió, POR QUÉ, qué nuevo sobre el Comandante o el proyecto. Máximo 300 palabras.\n\n${texto.substring(0, 9000)}` }],
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

function extraerKeywords(texto) {
  const limpio = texto.toLowerCase().replace(/[^\wáéíóúñü\s]/g, ' ').replace(/\s+/g, ' ');
  const palabras = limpio.split(' ').filter(p => p.length > 4 && !STOPWORDS.has(p) && !/^\d+$/.test(p));
  const frecuencia = {};
  for (const p of palabras) frecuencia[p] = (frecuencia[p] || 0) + 1;
  return Object.entries(frecuencia).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([palabra, freq]) => ({ palabra, freq }));
}

export async function indexarHistorial(r, e) {
  try {
    const db = gDB(e, 'agente');
    const ai = e.ayanokoji_IA;
    const kv = gKV(e, 'agente');
    if (!db) return { error: 'D1 no disponible.' };

    const msgs = await db.prepare('SELECT orden, contenido FROM historial_largo WHERE user_id=? ORDER BY orden ASC').bind('comandante').all();
    if (!msgs.results || !msgs.results.length) return { error: 'Historial vacío.' };

    await db.prepare('DELETE FROM indice_temas').run();

    let procesados = 0, temasInsertados = 0, erroresIA = 0, fallbacks = 0;
    const total = msgs.results.length;

    let iaDisponible = false;
    if (ai) {
      try {
        const prueba = await ai.run(MODELO_LIGERO, { messages: [{ role: 'user', content: 'ok' }], max_tokens: 3 });
        if (prueba && prueba.response) iaDisponible = true;
      } catch (x) {}
    }

    for (let i = 0; i < total; i += 20) {
      const lote = msgs.results.slice(i, i + 20);
      let usoTemaIA = false;

      if (iaDisponible) {
        const texto = lote.map(m => `[${m.orden}] ${m.contenido.substring(0, 400)}`).join('\n\n');
        try {
          const res = await ai.run(MODELO_LIGERO, {
            messages: [{ role: 'user', content: `De estos mensajes, extrae los TEMAS/CONCEPTOS clave. Formato JSON estricto: [{"orden": N, "temas": ["tema1", "tema2"], "peso": 5}]. Máximo 3 temas por mensaje. Temas de 1 a 3 palabras. Responde SOLO con el JSON.\n\n${texto}` }],
            max_tokens: 800,
            temperature: 0.2
          });
          const rp = res.response || '';
          const match = rp.match(/\[[\s\S]*?\]/);
          if (match) {
            try {
              const items = JSON.parse(match[0]);
              const inserciones = [];
              for (const item of items) {
                if (!item.temas) continue;
                for (const tema of item.temas) {
                  inserciones.push(
                    db.prepare('INSERT INTO indice_temas(mensaje_orden, tema, peso, fecha) VALUES(?,?,?,?)')
                      .bind(item.orden, String(tema).toLowerCase().substring(0, 50), item.peso || 5, Date.now())
                  );
                  temasInsertados++;
                }
              }
              if (inserciones.length) {
                try { await db.batch(inserciones); usoTemaIA = true; } catch (x) {}
              }
            } catch (x) {}
          }
        } catch (x) { erroresIA++; }
      }

      if (!usoTemaIA) {
        const inserciones = [];
        for (const msg of lote) {
          const keywords = extraerKeywords(msg.contenido);
          for (const kw of keywords) {
            inserciones.push(
              db.prepare('INSERT INTO indice_temas(mensaje_orden, tema, peso, fecha) VALUES(?,?,?,?)')
                .bind(msg.orden, kw.palabra, Math.min(kw.freq, 10), Date.now())
            );
            temasInsertados++;
          }
        }
        if (inserciones.length) {
          try { await db.batch(inserciones); fallbacks++; } catch (x) {}
        }
      }
      procesados += lote.length;
    }

    const modo = iaDisponible ? 'ia_con_fallback' : 'solo_keywords';
    if (kv) {
      try { await kv.put('indice:ultimo_modo', modo, { expirationTtl: 2592000 }); } catch (x) {}
      try { await kv.put('indice:ultimo_intento', String(Date.now()), { expirationTtl: 2592000 }); } catch (x) {}
    }

    return { ok: true, procesados, total, temas_insertados: temasInsertados, modo, errores_ia: erroresIA, lotes_fallback: fallbacks };
  } catch (x) {
    return { error: x.message };
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
    const temas = await db.prepare('SELECT DISTINCT mensaje_orden, tema, peso FROM indice_temas WHERE tema LIKE ? ORDER BY peso DESC LIMIT ?').bind('%' + q + '%', limite).all();
    if (!temas.results || !temas.results.length) {
      const r1 = await db.prepare('SELECT rol,contenido,orden FROM historial_largo WHERE contenido LIKE ? ORDER BY orden DESC LIMIT ?').bind('%' + q + '%', limite).all();
      return J({ consulta: q, metodo: 'directo', total: r1.results.length, resultados: r1.results });
    }
    const ords = temas.results.map(t => t.mensaje_orden);
    const ph = ords.map(() => '?').join(',');
    const msgs = await db.prepare('SELECT rol,contenido,orden FROM historial_largo WHERE orden IN (' + ph + ') ORDER BY orden ASC').bind(...ords).all();
    return J({ consulta: q, metodo: 'indice_semantico', total: msgs.results.length, resultados: msgs.results });
  } catch (x) { return J({ error: x.message }); }
}

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
    return J({ ok: true, archivoId, metadata: meta, longitud_texto: txt.length, preview: txt.substring(0, 3000) });
  } catch (x) { return J({ error: x.message }); }
}

function extraerTextoDeContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(c => extraerTextoDeContent(c)).filter(Boolean).join('\n');
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
        for (const fm of fragMsgs) nodos.push({ orden: tiempo, rol: fm.rol, contenido: fm.contenido });
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
  return { mensajes, stats: { total_nodos: keys.length, con_message: keys.length - sinMessage, sin_contenido: sinContenido, validos: mensajes.length, ejemplos_vacios: ejemplos } };
}

function extraerMensajes(data, profundidad = 0) {
  if (profundidad > 10) return null;
  if (!data) return null;
  if (Array.isArray(data)) {
    const primeros = data.slice(0, 3).filter(x => x && typeof x === 'object');
    if (primeros.length > 0) {
      const tieneContenido = primeros.some(m => m.content || m.contenido || m.text || m.message || m.mensaje || m.query || m.response || m.prompt || m.completion);
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
      return J({ error: 'No se encontraron mensajes.', diagnostico: { tipo_raiz: Array.isArray(data) ? 'array' : typeof data, claves_raiz: keys, stats_extractor: stats, primeros_300: String(texto || '').substring(0, 300) } });
    }
    const db = gDB(e, 'agente');
    if (!db) return J({ error: 'D1 no configurado.' });
    const desde = Math.max(0, lista.length - limite);
    const recorte = lista.slice(desde);
    await db.prepare('DELETE FROM historial_largo WHERE user_id=?').bind(uid).run();
    const sentencias = [];
    let orden = 0, insertados = 0, saltados = 0;
    const ahora = Date.now();
    for (const m of recorte) {
      const p = parsearMensaje(m);
      if (!p) { saltados++; continue; }
      if (p.rol === 'system') { saltados++; continue; }
      sentencias.push(db.prepare('INSERT INTO historial_largo(user_id,rol,contenido,orden,fecha) VALUES(?,?,?,?,?)').bind(uid, p.rol, p.contenido, orden, ahora));
      orden++; insertados++;
    }
    if (sentencias.length > 0) {
      try { await db.batch(sentencias); } catch (x) { return J({ error: 'Error al insertar en lote: ' + x.message, insertados: 0 }); }
    }
    try { await notificar(e, `📥 *Importación*\n\nInsertados: ${insertados}\nTotal: ${lista.length}`); } catch (x) {}
    return J({ ok: true, insertados, total: lista.length, saltados, desde, stats_extractor: stats });
  } catch (x) {
    return J({ error: 'Error al importar: ' + x.message });
  }
}
