import { MODELO, MODELO_LIGERO, MODELO_VISION, MODELO_RAZONAMIENTO, CORS, J, gDB, gKV, VENTANA, migrar } from './shared.js';
import { subir, procesar, resumir, verProceso, retomar, cronRetomar, cronAutonomo, resumirChats, importar, analizarArchivo, indexarHistorial, buscarPorTema } from './proc.js';
import { estadoPresupuesto, consumir } from './presupuesto.js';
import { detectarIntencion, construirSystemPrompt, identificarArea, AREAS } from './nucleo.js';

async function opcional(nombre) {
  try {
    if (nombre === 'social' || nombre === './social.js') return await import('./social.js');
    if (nombre === 'autonomia' || nombre === './autonomia.js') return await import('./autonomia.js');
    if (nombre === 'publisher' || nombre === './publisher.js') return await import('./publisher.js');
    if (nombre === 'sandbox' || nombre === './sandbox.js') return await import('./sandbox.js');
    return null;
  } catch (e) { return null; }
}

const VENTANA_SEGURA = 25;
const MAX_CHARS_MENSAJE = 1200;
const MAX_CHARS_PERFIL_BASE = 3000;
const MAX_CHARS_CONTEXTO = 3000;

// ============================================================
// MONITOR REAL DE CLOUDFLARE — Usa CF_API_TOKEN
// ============================================================
async function consultarUsoReal(e) {
  const accountId = e.CF_ACCOUNT_ID;
  const token = e.CF_API_TOKEN;
  if (!accountId || !token) {
    return { ok: false, error: 'Falta CF_ACCOUNT_ID o CF_API_TOKEN.' };
  }

  const ahora = new Date();
  const inicioDiaISO = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate())).toISOString();
  const inicioDiaDate = inicioDiaISO.split('T')[0];

  const query = `
    query GetFullUsage($accountTag: String!, $startDate: String!, $startDatetime: String!) {
      viewer {
        accounts(filter: {accountTag: $accountTag}) {
          workersInvocationsAdaptive(limit: 1000, filter: {
            datetime_geq: $startDatetime
          }) {
            sum { requests errors subrequests }
          }
          d1AnalyticsAdaptiveGroups(limit: 100, filter: {
            date_geq: $startDate
          }) {
            sum { readQueries writeQueries rowsRead rowsWritten }
          }
          kvOperationsAdaptiveGroups(limit: 100, filter: {
            date_geq: $startDate
          }) {
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
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query,
        variables: {
          accountTag: accountId,
          startDate: inicioDiaDate,
          startDatetime: inicioDiaISO
        }
      })
    });

    const data = await r.json();

    if (!data.data || !data.data.viewer || !data.data.viewer.accounts) {
      const fallback = await consultarSoloWorkers(accountId, token, inicioDiaISO);
      fallback.raw = data;
      return fallback;
    }

    const cuenta = data.data.viewer.accounts[0];

    let requests = 0, errores = 0, subrequests = 0;
    const workerGroups = cuenta.workersInvocationsAdaptive || [];
    for (const g of workerGroups) {
      requests += g.sum?.requests || 0;
      errores += g.sum?.errors || 0;
      subrequests += g.sum?.subrequests || 0;
    }

    let d1_reads = 0, d1_writes = 0, d1_rows_read = 0, d1_rows_written = 0;
    const d1Groups = cuenta.d1AnalyticsAdaptiveGroups || [];
    for (const g of d1Groups) {
      d1_reads += g.sum?.readQueries || 0;
      d1_writes += g.sum?.writeQueries || 0;
      d1_rows_read += g.sum?.rowsRead || 0;
      d1_rows_written += g.sum?.rowsWritten || 0;
    }

    let kv_reads = 0, kv_writes = 0, kv_deletes = 0, kv_lists = 0;
    const kvGroups = cuenta.kvOperationsAdaptiveGroups || [];
    for (const g of kvGroups) {
      const tipo = (g.dimensions?.actionType || '').toLowerCase();
      const cantidad = g.sum?.requests || 0;
      if (tipo.includes('read') || tipo === 'read') kv_reads += cantidad;
      else if (tipo.includes('write') || tipo === 'write') kv_writes += cantidad;
      else if (tipo.includes('delete')) kv_deletes += cantidad;
      else if (tipo.includes('list')) kv_lists += cantidad;
    }

    return {
      ok: true,
      workers_requests: requests,
      workers_errores: errores,
      workers_subrequests: subrequests,
      d1_reads,
      d1_writes,
      d1_rows_read,
      d1_rows_written,
      kv_reads,
      kv_writes,
      kv_deletes,
      kv_lists,
      consultado_en: Date.now()
    };
  } catch (x) {
    const fallback = await consultarSoloWorkers(accountId, token, inicioDiaISO);
    fallback.error_principal = x.message;
    return fallback;
  }
}

async function consultarSoloWorkers(accountId, token, inicioDiaISO) {
  const query = `
    query GetUsage($accountTag: String!, $datetimeStart: String!) {
      viewer {
        accounts(filter: {accountTag: $accountTag}) {
          workersInvocationsAdaptive(limit: 1000, filter: {
            datetime_geq: $datetimeStart
          }) {
            sum { requests errors subrequests }
          }
        }
      }
    }
  `;
  try {
    const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query,
        variables: { accountTag: accountId, datetimeStart: inicioDiaISO }
      })
    });
    const data = await r.json();
    if (!data.data || !data.data.viewer || !data.data.viewer.accounts) {
      return { ok: false, error: 'GraphQL sin datos.', raw: data };
    }
    const groups = data.data.viewer.accounts[0].workersInvocationsAdaptive || [];
    let requests = 0, errores = 0, subrequests = 0;
    for (const g of groups) {
      requests += g.sum?.requests || 0;
      errores += g.sum?.errors || 0;
      subrequests += g.sum?.subrequests || 0;
    }
    return {
      ok: true,
      workers_requests: requests,
      workers_errores: errores,
      workers_subrequests: subrequests,
      d1_reads: null, d1_writes: null,
      kv_reads: null, kv_writes: null,
      consultado_en: Date.now(),
      modo: 'solo_workers'
    };
  } catch (x) {
    return { ok: false, error: x.message };
  }
}

// ============================================================
// CHAT
// ============================================================
async function chat(r, e, c) {
  try {
    const b = await r.json();
    const m = b.mensaje;
    const uid = b.user_id || 'comandante';
    if (!m || typeof m !== 'string') return J({ respuesta: 'No enviaste mensaje.' });
    if (!e.ayanokoji_IA) return J({ respuesta: 'IA no configurada.' });

    const i = detectarIntencion(m);
    if (i === 'estado') return rEst(e, uid);
    if (i === 'leer') return rLeer(e, uid);
    if (i === 'eliminar') return rElim(e, uid);

    if (i === 'guardar_datos') {
      const au = await opcional('autonomia');
      if (au && au.gestionarDatos) {
        const r1 = await au.gestionarDatos(e, m, uid);
        if (r1) {
          if (au.registrarAccion) await au.registrarAccion(e, 'guardar_datos', m.substring(0, 100), true, r1.respuesta);
          if (e.DB) {
            try {
              await e.DB.prepare("INSERT INTO historial(user_id,mensaje,respuesta,fecha) VALUES(?,?,?,?)")
                .bind(uid, m, r1.respuesta, Date.now()).run();
            } catch (x) {}
          }
          return J({ respuesta: r1.respuesta, user_id: uid, intencion: i });
        }
      }
    }

    if (i === 'imagen') {
      const prompt = m.replace(/^.*?(?:imagen|foto|dibujo|ilustracion|ilustración|render)\s*(?:de|:)?\s*/i, '').trim() || m;
      const r1 = await generarImagen(e, prompt, uid);
      return J({ respuesta: r1.respuesta, user_id: uid, intencion: 'imagen' });
    }

    if (i === 'crear') {
      const au = await opcional('autonomia');
      const nombre = m.match(/worker\s+["']?([\w-]+)["']?/i)?.[1] || m.match(/crea\s+["']?([\w-]+)["']?/i)?.[1];
      if (au && nombre) {
        const r1 = await au.crearWorker(e, nombre, '// Worker creado por Ayanokōji\nexport default { async fetch(req) { return new Response("Hola desde " + req.url); } }');
        return J({ respuesta: r1.mensaje || r1.error, user_id: uid, intencion: 'crear' });
      }
      if (!au) return J({ respuesta: 'Necesito que subas `autonomia.js` primero.', user_id: uid });
    }

    if (i === 'mejorar_area') {
      const au = await opcional('autonomia');
      if (!au) return J({ respuesta: 'autonomia.js no instalado.', user_id: uid });
      const area = identificarArea(m);
      if (!area) {
        return J({
          respuesta: `No identifiqué el área. Áreas disponibles:\n${Object.keys(AREAS).map(a => '- ' + a).join('\n')}\n\nDime cuál y procedo.`,
          user_id: uid
        });
      }
      const r1 = await au.autoMejorar(e, { nombre: 'shadow-ayano', area: area.archivo, instrucciones: m, autoDesplegar: false });
      return J({
        respuesta: `Área identificada: *${area.area}* → archivo \`${area.archivo}\`.\n\n${r1.mensaje || r1.error || 'Sin resultado.'}`,
        user_id: uid, intencion: 'mejorar_area', area: area.area, archivo: area.archivo
      });
    }

    if (i === 'mejorar' || i === 'desplegar') {
      const au = await opcional('autonomia');
      const nombre = m.match(/worker\s+["']?([\w-]+)["']?/i)?.[1];
      if (au && nombre) {
        const r1 = await au.leerCodigoWorker(e, nombre);
        return J({ respuesta: r1.mensaje || r1.codigo?.substring(0, 500) || r1.error, user_id: uid, intencion: 'leer_codigo' });
      }
      return J({ respuesta: 'Dime el área o el nombre del worker.', user_id: uid });
    }

    let perfilBase = '';
    if (e.KV) {
      try {
        perfilBase = await e.KV.get('perfil_base') || '';
        if (perfilBase.length > MAX_CHARS_PERFIL_BASE) perfilBase = perfilBase.substring(0, MAX_CHARS_PERFIL_BASE);
      } catch (x) {}
    }

    let ventana = [];
    if (e.DB) {
      try {
        const r1 = await e.DB.prepare(
          'SELECT rol, contenido FROM historial_largo WHERE user_id=? ORDER BY orden DESC LIMIT ?'
        ).bind(uid, VENTANA_SEGURA).all();
        if (r1.results) {
          ventana = r1.results.reverse().map(x => ({
            role: x.rol === 'assistant' ? 'assistant' : 'user',
            content: (x.contenido || '').substring(0, MAX_CHARS_MENSAJE)
          }));
        }
      } catch (x) {}
    }
    if (!ventana.length && e.DB) {
      try {
        const r1 = await e.DB.prepare(
          "SELECT mensaje,respuesta FROM historial WHERE user_id=? ORDER BY fecha DESC LIMIT 15"
        ).bind(uid).all();
        if (r1.results) {
          ventana = r1.results.reverse().flatMap(x => [
            { role: 'user', content: (x.mensaje || '').substring(0, MAX_CHARS_MENSAJE) },
            { role: 'assistant', content: (x.respuesta || '').substring(0, MAX_CHARS_MENSAJE) }
          ]);
        }
      } catch (x) {}
    }

    let ctx = '', fs = null, rec = [];
    if (e.DB) {
      try {
        const r2 = await e.DB.prepare("SELECT resumen,fases FROM contexto ORDER BY fecha DESC LIMIT 1").first();
        if (r2) {
          ctx = (r2.resumen || '').substring(0, MAX_CHARS_CONTEXTO);
          if (r2.fases) { try { fs = JSON.parse(r2.fases); } catch (x) {} }
        }
      } catch (x) {}
      try {
        const r3 = await e.DB.prepare("SELECT resumen FROM resumenes_chat WHERE user_id=? ORDER BY fecha DESC LIMIT 3").bind(uid).all();
        if (r3.results) rec = r3.results.map(x => (x.resumen || '').substring(0, 800));
      } catch (x) {}
    }

    let correcciones = [];
    if (e.DB) {
      try {
        const rc = await e.DB.prepare('SELECT correccion FROM correcciones_voz ORDER BY fecha DESC LIMIT 15').all();
        if (rc.results) correcciones = rc.results.map(x => x.correccion);
      } catch (x) {}
    }

    let estrategias = [];
    if (e.DB) {
      try {
        const re = await e.DB.prepare("SELECT nombre, tipo, contenido FROM estrategias WHERE estado='activa' ORDER BY prioridad ASC LIMIT 5").all();
        if (re.results) estrategias = re.results;
      } catch (x) {}
    }

    let conciencia = [];
    if (e.KV) {
      try {
        const c = JSON.parse(await e.KV.get('conciencia:' + uid) || '[]');
        conciencia = c.slice(0, 10).map(x => `[${x.pestana}] ${x.accion}: ${x.detalle}`.substring(0, 200));
      } catch (x) {}
    }

    let systemPrompt = construirSystemPrompt(ctx, fs, rec, perfilBase, correcciones, estrategias, conciencia);

    const mensajes = [
      { role: 'system', content: systemPrompt },
      ...ventana,
      { role: 'user', content: m }
    ];

    const res = await e.ayanokoji_IA.run(MODELO, {
      messages: mensajes,
      max_tokens: 1000,
      temperature: 0.7
    });
    let rp = res.response || 'Sin respuesta.';

    const afirmaAccion = /\b(he creado|he insertado|he guardado|he actualizado|he desplegado|he borrado|he añadido|ya está|ya se hizo|completado|ejecutado)\b/i.test(rp);
    if (afirmaAccion && e.DB) {
      try {
        const ult = await e.DB.prepare("SELECT tipo FROM acciones WHERE fecha > ? ORDER BY fecha DESC LIMIT 1").bind(Date.now() - 60000).first();
        if (!ult) rp += '\n\n_⚠️ No tengo registro de esa acción en mi historial reciente._';
      } catch (x) {}
    }

    if (e.DB) {
      try {
        await e.DB.prepare("INSERT INTO historial(user_id,mensaje,respuesta,fecha) VALUES(?,?,?,?)").bind(uid, m, rp, Date.now()).run();
        const maxOrd = await e.DB.prepare('SELECT MAX(orden) as o FROM historial_largo WHERE user_id=?').bind(uid).first();
        let ord = (maxOrd && maxOrd.o != null) ? maxOrd.o : 0;
        await e.DB.prepare('INSERT INTO historial_largo(user_id,rol,contenido,orden,fecha) VALUES(?,?,?,?,?)').bind(uid, 'user', m, ord + 1, Date.now()).run();
        await e.DB.prepare('INSERT INTO historial_largo(user_id,rol,contenido,orden,fecha) VALUES(?,?,?,?,?)').bind(uid, 'assistant', rp, ord + 2, Date.now()).run();
      } catch (x) {}
    }

    if (e.DB && e.KV && c) {
      try {
        const lastSum = parseInt(await e.KV.get('last_summary:' + uid) || '0');
        const countRes = await e.DB.prepare("SELECT COUNT(*) as n FROM historial WHERE user_id=? AND fecha > ?").bind(uid, lastSum).first();
        if (countRes && countRes.n >= 30) c.waitUntil(resumirChats(e, uid));
      } catch (x) {}
    }

    return J({ respuesta: rp, user_id: uid, intencion: i });
  } catch (x) {
    return J({ respuesta: 'Error: ' + x.message });
  }
}

// ============ IMÁGENES ============
async function generarImagen(e, prompt, uid) {
  if (!e.ayanokoji_IA) return { respuesta: 'IA no configurada.' };
  if (!await consumir(e, 'vision')) return { respuesta: 'Presupuesto agotado.' };
  try {
    const res = await e.ayanokoji_IA.run('@cf/black-forest-labs/flux-1-schnell', { prompt, num_steps: 4 });
    if (!res || !res.image) return { respuesta: 'No se generó imagen.' };
    const id = 'img_' + Date.now();
    let base64 = '';
    if (typeof res.image === 'string') base64 = res.image;
    else {
      const bytes = new Uint8Array(res.image);
      let bin = '';
      const paso = 8192;
      for (let i = 0; i < bytes.length; i += paso) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + paso));
      base64 = btoa(bin);
    }
    const kv = gKV(e, 'agente');
    if (kv) await kv.put('img:' + id, base64);
    const db = gDB(e, 'agente');
    if (db) {
      try {
        await db.prepare('INSERT INTO archivos(id,nombre,tamaño,chunks,destino,fecha) VALUES(?,?,?,?,?,?)')
          .bind(id, prompt.substring(0, 100), base64.length, 1, 'imagen', Date.now()).run();
      } catch (x) {}
    }
    const url = '/api/imagen/' + id;
    return { respuesta: `Imagen generada.\n\n![imagen](${url})\n\nID: \`${id}\``, id, url };
  } catch (x) {
    return { respuesta: 'Error: ' + x.message };
  }
}

async function rImagen(r, e, c) {
  const b = await r.json();
  if (!b.prompt) return J({ error: 'Falta prompt.' });
  return J(await generarImagen(e, b.prompt, b.user_id || 'comandante'));
}

async function servirImagen(r, e) {
  try {
    const u = new URL(r.url);
    const id = u.pathname.replace('/api/imagen/', '');
    const kv = gKV(e, 'agente');
    if (!kv) return new Response('KV no disponible', { status: 503 });
    const base64 = await kv.get('img:' + id);
    if (!base64) return new Response('No encontrada', { status: 404 });
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000', ...CORS } });
  } catch (x) { return new Response('Error', { status: 500 }); }
}

// ============ RESPUESTAS DIRECTAS ============
async function rEst(e, uid) {
  let n = 0, c = 0, a = 0, p = 0, s = 0, hl = 0, tareas = 0, workers = 0, notif = 0;
  try {
    if (e.DB) {
      try { const r1 = await e.DB.prepare('SELECT COUNT(*) as n FROM historial WHERE user_id=?').bind(uid).first(); n = r1 ? r1.n : 0; } catch (x) {}
      try { const r2 = await e.DB.prepare('SELECT COUNT(*) as n FROM contexto').first(); c = r2 ? r2.n : 0; } catch (x) {}
      try { const r3 = await e.DB.prepare('SELECT COUNT(*) as n FROM archivos').first(); a = r3 ? r3.n : 0; } catch (x) {}
      try { const r4 = await e.DB.prepare('SELECT COUNT(*) as n FROM procesos').first(); p = r4 ? r4.n : 0; } catch (x) {}
      try { const r5 = await e.DB.prepare('SELECT COUNT(*) as n FROM resumenes_chat').first(); s = r5 ? r5.n : 0; } catch (x) {}
      try { const r6 = await e.DB.prepare('SELECT COUNT(*) as n FROM historial_largo WHERE user_id=?').bind(uid).first(); hl = r6 ? r6.n : 0; } catch (x) {}
      try { const r7 = await e.DB.prepare("SELECT COUNT(*) as n FROM tareas WHERE estado='pendiente'").first(); tareas = r7 ? r7.n : 0; } catch (x) {}
      try { const r8 = await e.DB.prepare('SELECT COUNT(*) as n FROM workers_registrados WHERE activo=1').first(); workers = r8 ? r8.n : 0; } catch (x) {}
      try { const r9 = await e.DB.prepare('SELECT COUNT(*) as n FROM notificaciones WHERE leida=0').first(); notif = r9 ? r9.n : 0; } catch (x) {}
    }
  } catch (x) {}
  return J({ respuesta: `Sistema activo. Memoria: ${n} mensajes, ${hl} en historial largo, ${c} contextos, ${a} archivos, ${p} procesos, ${s} resúmenes. Tareas: ${tareas}. Workers: ${workers}. Notif sin leer: ${notif}.` });
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

// ============ D1 / KV GENÉRICOS ============
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
      await db.prepare('INSERT INTO ' + tabla + ' (' + k.join(',') + ') VALUES(' + ph + ')').bind(...Object.values(datos)).run();
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

async function limpiar(r, e) {
  try {
    const b = await r.json();
    const db = gDB(e, 'agente'), kv = gKV(e, 'agente');
    if (!db) return J({ error: 'D1 no configurado.' });
    if (b.archivoId && kv) {
      const ls = await kv.list({ prefix: 'file:' + b.archivoId + ':' });
      for (const k of ls.keys) await kv.delete(k.name);
      const lp = await kv.list({ prefix: 'proc:' + b.archivoId + ':' });
      for (const k of lp.keys) await kv.delete(k.name);
      try { await db.prepare('DELETE FROM archivos WHERE id=?').bind(b.archivoId).run(); } catch (x) {}
      try { await db.prepare('DELETE FROM procesos WHERE id=?').bind(b.archivoId).run(); } catch (x) {}
      return J({ ok: true, limpiado: b.archivoId });
    }
    if (b.todo) {
      const todas = await kv.list({ prefix: '' });
      for (const k of todas.keys) {
        if (k.name.startsWith('file:') || k.name.startsWith('proc:')) await kv.delete(k.name);
      }
      return J({ ok: true, limpiado: 'kv_huerfanos' });
    }
    return J({ error: 'Falta archivoId o todo:true' });
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

async function historialLargo(r, e) {
  try {
    const u = new URL(r.url), uid = u.searchParams.get('user_id') || 'comandante';
    const limite = parseInt(u.searchParams.get('limite') || '100');
    const db = gDB(e, 'agente');
    const r1 = await db.prepare('SELECT rol,contenido,orden,fecha FROM historial_largo WHERE user_id=? ORDER BY orden DESC LIMIT ?').bind(uid, limite).all();
    return J({ total: r1.results.length, historial: r1.results.reverse() });
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

async function vision(r, e) {
  try {
    const { imagen, prompt, user_id } = await r.json();
    const uid = user_id || 'comandante';
    if (!imagen) return J({ error: 'Falta imagen (base64).' });
    if (!await consumir(e, 'vision')) return J({ error: 'Presupuesto agotado.' });
    const res = await e.ayanokoji_IA.run(MODELO_VISION, {
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt || 'Describe esta imagen.' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imagen}` } }] }],
      max_tokens: 800
    });
    const rp = res.response || '';
    if (e.DB && rp) await e.DB.prepare("INSERT INTO historial(user_id,mensaje,respuesta,fecha) VALUES(?,?,?,?)").bind(uid, '[IMAGEN]', rp, Date.now()).run();
    return J({ respuesta: rp });
  } catch (x) { return J({ error: 'Error de visión: ' + x.message }); }
}

async function reset(r, e) {
  try {
    const { user_id, destino } = await r.json();
    const uid = user_id || 'comandante';
    const db = gDB(e, destino || 'agente');
    if (!db) return J({ error: 'D1 no configurado.' });
    await db.prepare('DELETE FROM historial WHERE user_id=?').bind(uid).run();
    await db.prepare('DELETE FROM historial_largo WHERE user_id=?').bind(uid).run();
    return J({ success: true, message: `Memoria de ${uid} reseteada.` });
  } catch (x) { return J({ error: x.message }); }
}

// ============ DIAGNÓSTICO ============
async function diagnostico(r, e) {
  const db = gDB(e, 'agente');
  if (!db) return J({ error: 'Sin D1.' });
  try {
    const tablas = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const conteos = {};
    for (const t of (tablas.results || [])) {
      try {
        const c = await db.prepare('SELECT COUNT(*) as n FROM ' + t.name).first();
        conteos[t.name] = c ? c.n : 0;
      } catch (x) { conteos[t.name] = 'err: ' + x.message; }
    }
    const kv = gKV(e, 'agente');
    let kvCount = 'sin kv';
    try { const lista = await kv.list({ limit: 1000 }); kvCount = lista.keys.length; } catch (x) {}
    const modulos = {};
    for (const m of ['social','autonomia','publisher','sandbox']) {
      const x = await opcional(m);
      modulos[m] = !!x;
    }
    return J({ ok: true, tablas: (tablas.results || []).map(t => t.name), conteos, kv_claves: kvCount, modulos_disponibles: modulos });
  } catch (x) { return J({ error: x.message }); }
}

async function erroresTardios(r, e) {
  const db = gDB(e, 'agente'), kv = gKV(e, 'agente');
  const problemas = [];
  if (!db) return J({ error: 'Sin D1.' });
  try {
    try { const files = await kv.list({ prefix: 'file:', limit: 500 }); if (files.keys.length > 50) problemas.push({ tipo: 'kv_huerfano', msg: files.keys.length + ' chunks.' }); } catch (x) {}
    try {
      const fecha = new Date().toISOString().split('T')[0];
      for (const area of ['chat','procesamiento','sandbox','publisher','vision']) {
        const c = await kv.get('presupuesto:' + fecha + ':' + area);
        if (c && parseInt(c) > 200) problemas.push({ tipo: 'presupuesto', msg: area + ': ' + c });
      }
    } catch (x) {}
    try {
      const atascados = await db.prepare("SELECT id FROM procesos WHERE estado='procesando' AND ? - fecha_inicio > 86400000").bind(Date.now()).all();
      for (const p of (atascados.results || [])) problemas.push({ tipo: 'proceso_atascado', msg: p.id });
    } catch (x) {}
    return J({ ok: true, total: problemas.length, problemas });
  } catch (x) { return J({ error: x.message }); }
}

// ============================================================
// EXPORT PRINCIPAL
// ============================================================
export default {
  async fetch(r, e, c) {
    if (r.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const u = new URL(r.url), p = u.pathname;

    if (p.startsWith('/api/') || p === '/feed' || p === '/rss.xml') {
      try { await migrar(e); } catch (x) {}
    }

    if (p.startsWith('/api/imagen/') && r.method === 'GET') return servirImagen(r, e);

    if (p === '/api/chat' && r.method === 'POST') return chat(r, e, c);
    if (p === '/api/imagen' && r.method === 'POST') return rImagen(r, e, c);
    if (p === '/api/subir' && r.method === 'POST') return subir(r, e, c);
    if (p === '/api/resumir' && r.method === 'POST') return resumir(r, e);
    if (p === '/api/procesar' && r.method === 'POST') return procesar(r, e, c);
    if (p === '/api/retomar' && r.method === 'POST') return retomar(r, e, c);
    if (p === '/api/proceso' && r.method === 'GET') return verProceso(r, e);
    if (p === '/api/importar' && r.method === 'POST') return importar(r, e);
    if (p === '/api/limpiar' && r.method === 'POST') return limpiar(r, e);
    if (p === '/api/historial' && r.method === 'GET') return historial(r, e);
    if (p === '/api/historial_largo' && r.method === 'GET') return historialLargo(r, e);
    if (p === '/api/contexto' && r.method === 'GET') return verContexto(r, e);
    if (p === '/api/reset' && r.method === 'POST') return reset(r, e);
    if (p === '/api/vision' && r.method === 'POST') return vision(r, e);
    if (p === '/api/d1' && r.method === 'POST') return d1(r, e);
    if (p === '/api/kv' && r.method === 'POST') return kv(r, e);
    if (p === '/api/diagnostico') return diagnostico(r, e);
    if (p === '/api/errores_tardios') return erroresTardios(r, e);
    if (p === '/api/migrar' && r.method === 'POST') return J(await migrar(e, true));
    if (p === '/api/presupuesto' && r.method === 'GET') return J(await estadoPresupuesto(e));
    if (p === '/api/estado') return J({ estado: 'activo', v: '9.2' });

    // ============ USO REAL ============
    if (p === '/api/uso_real' && r.method === 'GET') {
      const uso = await consultarUsoReal(e);
      return J(uso);
    }

    // ============ CAPACIDADES ============
    if (p === '/api/capacidades' && r.method === 'GET') {
      const uso = await consultarUsoReal(e);
      const db = gDB(e, 'agente');
      const kv = gKV(e, 'agente');

      let procesosActivos = 0;
      let totalMensajes = 0;
      let totalTemas = 0;
      let modoIndice = 'ninguno';

      if (db) {
        try { const p1 = await db.prepare("SELECT COUNT(*) as n FROM procesos WHERE estado IN ('procesando','pendiente')").first(); procesosActivos = p1 ? p1.n : 0; } catch (x) {}
        try { const p2 = await db.prepare('SELECT COUNT(*) as n FROM historial_largo').first(); totalMensajes = p2 ? p2.n : 0; } catch (x) {}
        try { const p3 = await db.prepare('SELECT COUNT(*) as n FROM indice_temas').first(); totalTemas = p3 ? p3.n : 0; } catch (x) {}
      }
      if (kv) {
        try { modoIndice = await kv.get('indice:ultimo_modo') || 'ninguno'; } catch (x) {}
      }

      const wr = uso.workers_requests || 0;
      const d1r = uso.d1_reads || 0;
      const d1w = uso.d1_writes || 0;
      const kvr = uso.kv_reads || 0;
      const kvw = uso.kv_writes || 0;

      const lim = {
        workers_requests: { usado: wr, limite: 100000, pct: Math.round(wr / 100000 * 100) },
        workers_errores: { usado: uso.workers_errores || 0 },
        workers_subrequests: { usado: uso.workers_subrequests || 0, limite: 1000000, pct: Math.round((uso.workers_subrequests || 0) / 1000000 * 100) },
        d1_reads: { usado: d1r, limite: 5000000, pct: d1r ? Math.round(d1r / 5000000 * 100) : null },
        d1_writes: { usado: d1w, limite: 100000, pct: d1w ? Math.round(d1w / 100000 * 100) : null },
        kv_reads: { usado: kvr, limite: 100000, pct: kvr ? Math.round(kvr / 100000 * 100) : null },
        kv_writes: { usado: kvw, limite: 1000, pct: kvw ? Math.round(kvw / 1000 * 100) : null }
      };

      return J({
        ok: true,
        consulta_real: uso.ok,
        error_consulta: uso.error || null,
        fecha_consulta: new Date().toISOString(),
        limites_cloudflare: lim,
        procesos_activos: procesosActivos,
        mensajes_historial: totalMensajes,
        temas_indexados: totalTemas,
        modo_indice: modoIndice
      });
    }

    // ============ CORRECCIONES ============
    if (p === '/api/corregir' && r.method === 'POST') {
      const { correccion } = await r.json();
      const db = gDB(e, 'agente');
      await db.prepare('INSERT INTO correcciones_voz(contexto, correccion, fecha) VALUES(?,?,?)')
        .bind('general', correccion, Date.now()).run();
      return J({ ok: true, mensaje: 'Corrección guardada como capa. Núcleo intacto.' });
    }

    if (p === '/api/areas') return J({ total: Object.keys(AREAS).length, areas: AREAS });
    if (p === '/api/analizar' && r.method === 'POST') return analizarArchivo(r, e);

    if (p === '/api/modo' && r.method === 'POST') {
      const { autonomo } = await r.json();
      const kvStore = gKV(e, 'agente');
      await kvStore.put('modo_autonomo', autonomo ? 'true' : 'false');
      return J({ ok: true, modo: autonomo ? 'autónomo' : 'supervisado' });
    }

    if (p === '/api/indexar' && r.method === 'POST') return J(await indexarHistorial(r, e));
    if (p === '/api/buscar_tema' && r.method === 'GET') return buscarPorTema(r, e);

    if (p === '/api/estrategias' && r.method === 'GET') {
      const db = gDB(e, 'agente');
      const r1 = await db.prepare("SELECT * FROM estrategias WHERE estado='activa' ORDER BY prioridad ASC").all();
      return J({ total: r1.results.length, estrategias: r1.results });
    }
    if (p === '/api/estrategias' && r.method === 'POST') {
      const b = await r.json();
      const db = gDB(e, 'agente');
      const r1 = await db.prepare('INSERT INTO estrategias(nombre,tipo,contenido,prioridad,creada,actualizada) VALUES(?,?,?,?,?,?)')
        .bind(b.nombre, b.tipo, b.contenido, b.prioridad || 5, Date.now(), Date.now()).run();
      return J({ ok: true, id: r1.meta.last_row_id });
    }

    if (p === '/api/decisiones' && r.method === 'GET') {
      const db = gDB(e, 'agente');
      const r1 = await db.prepare('SELECT * FROM decisiones_autonomas ORDER BY fecha DESC LIMIT 50').all();
      return J({ total: r1.results.length, decisiones: r1.results });
    }

    if (p === '/api/conciencia' && r.method === 'POST') {
      const b = await r.json();
      const uid = b.user_id || 'comandante';
      const kv = gKV(e, 'agente');
      if (kv) {
        const clave = 'conciencia:' + uid;
        const actual = JSON.parse(await kv.get(clave) || '[]');
        actual.unshift({ accion: b.accion, detalle: (b.detalle || '').substring(0, 300), pestana: b.pestana || 'chat', fecha: Date.now() });
        await kv.put(clave, JSON.stringify(actual.slice(0, 30)), { expirationTtl: 86400 });
      }
      return J({ ok: true });
    }

    if (p === '/api/leer_conciencia' && r.method === 'GET') {
      const uu = new URL(r.url);
      const uid = uu.searchParams.get('user_id') || 'comandante';
      const kv = gKV(e, 'agente');
      if (!kv) return J({ conciencia: [] });
      const c = JSON.parse(await kv.get('conciencia:' + uid) || '[]');
      return J({ total: c.length, conciencia: c });
    }

    if (p === '/api/shadow_stats' && r.method === 'GET') {
      const db = gDB(e, 'agente');
      if (!db) return J({ error: 'Sin D1.' });
      try {
        let ut = 0, up = 0, activos = 0, nuevosSem = 0, ingresos = 0;
        try { const t = await db.prepare('SELECT COUNT(*) as n FROM usuarios').first(); ut = t ? t.n : 0; } catch (x) {}
        try { const t = await db.prepare("SELECT COUNT(*) as n FROM usuarios WHERE tipo_pago='pago'").first(); up = t ? t.n : 0; } catch (x) {}
        try { const t = await db.prepare('SELECT COUNT(*) as n FROM usuarios WHERE ultimo_acceso > ?').bind(Date.now() - 86400000).first(); activos = t ? t.n : 0; } catch (x) {}
        try { const t = await db.prepare('SELECT COUNT(*) as n FROM usuarios WHERE fecha_registro > ?').bind(Date.now() - 7 * 86400000).first(); nuevosSem = t ? t.n : 0; } catch (x) {}
        try { const t = await db.prepare('SELECT COALESCE(SUM(ingresos_usdt),0) as t FROM metricas_diarias').first(); ingresos = t ? parseFloat(t.t) : 0; } catch (x) {}

        const conv = ut > 0 ? ((up / ut) * 100).toFixed(1) : 0;

        let topP = null;
        try { topP = await db.prepare("SELECT personaje_favorito as p, COUNT(*) as n FROM usuarios WHERE personaje_favorito IS NOT NULL GROUP BY personaje_favorito ORDER BY n DESC LIMIT 1").first(); } catch (x) {}

        let recientes = [];
        try { const r = await db.prepare('SELECT * FROM metricas_diarias ORDER BY fecha DESC LIMIT 7').all(); recientes = r.results || []; } catch (x) {}

        const ret = recientes.length ? { d1: recientes[0].retencion_d1 || 0, d7: recientes[0].retencion_d7 || 0, d30: 0 } : { d1: 0, d7: 0, d30: 0 };

        const escala = ut === 0 ? 0 : ut < 50 ? 1 : ut < 500 ? 2 : ut < 5000 ? 3 : 4;

        const resumen = ut === 0
          ? 'Shadow Arise no está operativo aún. El sistema está listo para recibir usuarios.'
          : `Shadow Arise lleva ${ut} usuarios registrados. ${up} están pagando (${conv}%). Retención día 1: ${ret.d1}%.`;

        return J({
          stats: {
            usuarios_totales: ut, usuarios_pago: up, usuarios_activos_dia: activos,
            usuarios_nuevos_semana: nuevosSem, conversion_pct: parseFloat(conv),
            retencion_d1: ret.d1, retencion_d7: ret.d7, retencion_d30: ret.d30,
            ingresos_mes: ingresos, ingresos_total: ingresos,
            arpu: up > 0 ? (ingresos / up).toFixed(2) : 0,
            personaje_top: topP ? topP.p : '—', personaje_retencion: topP ? topP.p : '—'
          },
          escala: { actual: escala, pasos: ['Prototipo','Beta cerrada','Lanzamiento público','Tracción','Escala'] },
          metricas_recientes: recientes,
          resumen_ayanokoji: resumen
        });
      } catch (x) { return J({ error: x.message }); }
    }

    if (p === '/api/componentes' && r.method === 'GET') {
      return J({
        pestanas: ['chat','sandbox','shadow','stats','decisiones','ideas','bandeja'],
        botones: ['subir','imagen','indexar','migrar','diagnostico','procesos','contexto','corregir','limpiar'],
        acciones_chat: ['enviar_mensaje','cargar_historial','corregir_voz','generar_imagen'],
        acciones_auto: ['indexar','migrar','analizar','encolar','publicar']
      });
    }

    // Sandbox
    if (p === '/api/sandbox/construir' && r.method === 'POST') {
      const m = await opcional('sandbox');
      if (!m) return J({ error: 'sandbox.js no instalado.' });
      return J(await m.construirShadowArise(e));
    }
    if (p === '/api/sandbox/simular_arranque' && r.method === 'POST') {
      const m = await opcional('sandbox');
      if (!m) return J({ error: 'sandbox.js no instalado.' });
      return J(await m.simularArranque(e));
    }
    if (p === '/api/simular_precio' && r.method === 'POST') {
      const m = await opcional('sandbox');
      if (!m) return J({ error: 'sandbox.js no instalado.' });
      return m.simularPrecio(r, e);
    }
    if (p === '/api/promover_leccion' && r.method === 'POST') {
      const m = await opcional('sandbox');
      if (!m) return J({ error: 'sandbox.js no instalado.' });
      return m.promoverLeccion(r, e);
    }
    if (p === '/api/sandbox' && r.method === 'POST') {
      const m = await opcional('sandbox');
      if (!m) return J({ error: 'sandbox.js no instalado.' });
      return J(await m.generarEscenario(e));
    }
    if (p === '/api/sandbox/decidir' && r.method === 'POST') {
      const m = await opcional('sandbox');
      if (!m) return J({ error: 'sandbox.js no instalado.' });
      const { id } = await r.json();
      return J(await m.decidir(e, id));
    }
    if (p === '/api/sandbox' && r.method === 'GET') {
      const m = await opcional('sandbox');
      if (!m) return J({ escenarios: [], lecciones: [] });
      return m.verSandbox(r, e);
    }

    // Publisher
    if (p === '/api/publicar' && r.method === 'POST') {
      const m = await opcional('publisher');
      if (!m) return J({ error: 'publisher.js no instalado.' });
      return m.rutaPublicar(r, e);
    }
    if (p === '/api/generar' && r.method === 'POST') {
      const m = await opcional('publisher');
      if (!m) return J({ error: 'publisher.js no instalado.' });
      const { tipo } = await r.json();
      return J(await m.generarContenido(e, tipo || 'provocacion'));
    }
    if (p === '/api/encolar' && r.method === 'POST') {
      const m = await opcional('publisher');
      if (!m) return J({ error: 'publisher.js no instalado.' });
      const b = await r.json();
      return J(await m.encolar(e, b.tipo || 'manual', b.contenido, b.canales || 'mastodon', b.programada || Date.now(), b.imagen_id));
    }
    if (p === '/api/pub' && r.method === 'POST') {
      const m = await opcional('publisher');
      if (!m) return J({ error: 'publisher.js no instalado.' });
      const { id } = await r.json();
      return J(await m.publicar(e, id));
    }
    if (p === '/api/publicaciones' && r.method === 'GET') {
      const db = gDB(e, 'agente');
      const r1 = await db.prepare('SELECT * FROM publicaciones ORDER BY creada DESC LIMIT 30').all();
      return J({ total: r1.results.length, publicaciones: r1.results });
    }

    // Autonomía
    if (p === '/api/workers' && r.method === 'GET') {
      const m = await opcional('autonomia');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      return J(await m.listarWorkers(e));
    }
    if (p === '/api/workers/crear' && r.method === 'POST') {
      const m = await opcional('autonomia');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      const { nombre, codigo } = await r.json();
      return J(await m.crearWorker(e, nombre, codigo));
    }
    if (p === '/api/workers/actualizar' && r.method === 'POST') {
      const m = await opcional('autonomia');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      const { nombre, codigo } = await r.json();
      return J(await m.actualizarWorker(e, nombre, codigo));
    }
    if (p === '/api/workers/leer' && r.method === 'POST') {
      const m = await opcional('autonomia');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      const { nombre } = await r.json();
      return J(await m.leerCodigoWorker(e, nombre));
    }
    if (p === '/api/mejorar' && r.method === 'POST') {
      const m = await opcional('autonomia');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      return J(await m.autoMejorar(e, await r.json()));
    }
    if (p === '/api/revertir' && r.method === 'POST') {
      const m = await opcional('autonomia');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      const { nombre } = await r.json();
      return J(await m.revertir(e, nombre));
    }
    if (p === '/api/snapshot' && r.method === 'POST') {
      const m = await opcional('autonomia');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      const { nombre } = await r.json();
      return J(await m.crearSnapshot(e, nombre));
    }
    if (p === '/api/tareas' && r.method === 'GET') {
      const db = gDB(e, 'agente');
      const r1 = await db.prepare('SELECT * FROM tareas ORDER BY prioridad ASC, creada ASC LIMIT 50').all();
      return J({ total: r1.results.length, tareas: r1.results });
    }
    if (p === '/api/tareas' && r.method === 'POST') {
      const b = await r.json();
      const db = gDB(e, 'agente');
      const r1 = await db.prepare('INSERT INTO tareas(tipo,descripcion,payload,prioridad,creada) VALUES(?,?,?,?,?)')
        .bind(b.tipo || 'general', b.descripcion, JSON.stringify(b.payload || {}), b.prioridad || 5, Date.now()).run();
      return J({ ok: true, id: r1.meta.last_row_id });
    }
    if (p === '/api/acciones' && r.method === 'GET') {
      const db = gDB(e, 'agente');
      const r1 = await db.prepare('SELECT * FROM acciones ORDER BY fecha DESC LIMIT 50').all();
      return J({ total: r1.results.length, acciones: r1.results });
    }

    // Feed y notificaciones
    if (p === '/feed') {
      const m = await opcional('social');
      if (!m) return new Response('social.js no instalado', { status: 503 });
      return await m.renderFeed(e);
    }
    if (p === '/rss.xml') {
      const m = await opcional('social');
      if (!m) return new Response('social.js no instalado', { status: 503 });
      const baseUrl = 'https://' + (u.hostname || 'shadow-ayano.yeinierliranzavalle.workers.dev');
      return await m.renderRSS(e, baseUrl);
    }
    if (p === '/api/notificaciones' && r.method === 'GET') {
      const m = await opcional('social');
      if (!m) return J({ notificaciones: [], no_leidas: 0 });
      return J(await m.listarNotificaciones(e, 50));
    }
    if (p === '/api/notificaciones/leer' && r.method === 'POST') {
      const m = await opcional('social');
      if (!m) return J({ ok: false });
      const { ids } = await r.json();
      return J({ ok: await m.marcarLeidas(e, ids) });
    }
    if (p === '/api/suscribir' && r.method === 'POST') {
      const m = await opcional('social');
      if (!m) return J({ ok: false });
      const sub = await r.json();
      return J(await m.suscribir(e, sub, r.headers.get('User-Agent') || ''));
    }

    return new Response('404', { status: 404, headers: CORS });
  },

  async scheduled(event, e, c) {
    c.waitUntil((async () => {
      try { await migrar(e); } catch (x) {}
      await cronRetomar(e);
      await cronAutonomo(e);
      const pub = await opcional('publisher');
      if (pub && pub.cronPublicar) { try { await pub.cronPublicar(e); } catch (x) {} }
      const sb = await opcional('sandbox');
      if (sb && sb.cronSandbox) { try { await sb.cronSandbox(e); } catch (x) {} }
      const au = await opcional('autonomia');
      if (au && au.cronColaTareas) { try { await au.cronColaTareas(e); } catch (x) {} }
      if (au && au.informeDiario) { try { await au.informeDiario(e); } catch (x) {} }
    })());
  }
};
