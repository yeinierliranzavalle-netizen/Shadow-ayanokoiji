import { MODELO, MODELO_LIGERO, MODELO_VISION, MODELO_RAZONAMIENTO, CORS, J, gDB, gKV, VENTANA, migrar } from './shared.js';
import { subir, procesar, resumir, verProceso, retomar, cronRetomar, cronAutonomo, resumirChats, importar, analizarArchivo, indexarHistorial, buscarPorTema, construirPerfilBase } from './proc.js';
import { estadoPresupuesto, consumir } from './presupuesto.js';
import { detectarIntencion, construirSystemPrompt, identificarArea, AREAS } from './nucleo.js';
import { TOOLS, parsearInvocaciones, herramientaExiste, herramientaRequiereAprobacion } from './tools.js';

function extraerRespuesta(res) {
  if (!res) return '';
  if (typeof res === 'string') return res;
  if (typeof res.response === 'string' && res.response.length > 0) return res.response;
  if (res.choices && res.choices[0]) {
    const c = res.choices[0];
    const msg = c.message || {};
    if (typeof msg.content === 'string' && msg.content.trim().length > 0) return msg.content;
    if (msg.content === null && typeof msg.reasoning === 'string' && msg.reasoning.trim().length > 0) return msg.reasoning;
    if (typeof c.text === 'string' && c.text.trim().length > 0) return c.text;
  }
  if (typeof res.result?.response === 'string' && res.result.response.length > 0) return res.result.response;
  if (res.result?.choices?.[0]?.message?.content && typeof res.result.choices[0].message.content === 'string') return res.result.choices[0].message.content;
  if (res.result?.choices?.[0]?.message?.reasoning && typeof res.result.choices[0].message.reasoning === 'string') return res.result.choices[0].message.reasoning;
  if (typeof res.output === 'string' && res.output.length > 0) return res.output;
  return '';
}

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
const MAX_ITERACIONES_TOOL = 3;
const APROBACION_TTL = 600;

// TTLs aumentados (baja consumo D1 ~80%)
const TTL_HISTORIAL = 300;   // 5 min
const TTL_CONTEXTO = 1800;   // 30 min
const TTL_RESUMENES = 1800;  // 30 min
const TTL_CORRECCIONES = 3600; // 1h
const TTL_ESTRATEGIAS = 3600;  // 1h

// ============================================================
// CACHÉ EN KV
// ============================================================
async function conCache(e, clave, ttlSeg, fn) {
  const kv = gKV(e, 'agente');
  if (kv) {
    try {
      const cached = await kv.get('cache:' + clave);
      if (cached) { try { return JSON.parse(cached); } catch (x) {} }
    } catch (x) {}
  }
  try {
    const dato = await fn();
    if (kv && dato !== undefined && dato !== null) {
      try { await kv.put('cache:' + clave, JSON.stringify(dato), { expirationTtl: ttlSeg }); } catch (x) {}
    }
    return dato;
  } catch (x) { return null; }
}

async function invalidarCache(e, prefijo) {
  const kv = gKV(e, 'agente');
  if (!kv) return;
  try {
    const lista = await kv.list({ prefix: 'cache:' + prefijo, limit: 1000 });
    for (const k of lista.keys) await kv.delete(k.name);
  } catch (x) {}
}

// ============================================================
// SELECTOR DE MODELO — Chat siempre con 70B
// ============================================================
function elegirModelo(mensaje, intencion, iteracion) {
  return MODELO;
}

// ============================================================
// CACHÉ DE RELACIÓN
// ============================================================
async function construirCacheRelacion(e, uid) {
  const db = gDB(e, 'agente');
  const kv = gKV(e, 'agente');
  if (!db || !kv) return null;
  try {
    const r = await db.prepare(
      'SELECT rol, contenido, orden FROM historial_largo WHERE user_id=? ORDER BY orden DESC LIMIT 300'
    ).bind(uid).all();
    if (!r.results || r.results.length < 20) return null;
    const texto = r.results.reverse().map(m => `[${m.rol}] ${(m.contenido || '').substring(0, 400)}`).join('\n\n');
    const res = await e.ayanokoji_IA.run(MODELO_LIGERO, {
      messages: [{
        role: 'user',
        content: `Eres Ayanokōji Digital. Analiza las últimas conversaciones con el Comandante y extrae un resumen de relación en 5 secciones. Sé específico, no genérico.

### PATRONES DE COMUNICACIÓN
Cómo le gusta que le hables, qué tono prefiere, qué evita.

### CHISTES INTERNOS Y REFERENCIAS
Frases, apodos, referencias compartidas que solo él y tú entienden.

### TEMAS RECURRENTES
De qué habla más, qué le preocupa, qué le ilusiona.

### MOMENTOS CLAVE
3-5 momentos específicos que definieron la relación. Cita frases textuales si es posible.

### CÓMO DEBO ACTUAR CON ÉL
Reglas prácticas para el día a día. Qué le funciona, qué no.

Conversaciones:
${texto.substring(0, 20000)}

Responde solo con las 5 secciones. Máximo 1200 palabras.`
      }],
      max_tokens: 1600,
      temperature: 0.4
    });
    const cache = extraerRespuesta(res);
    if (cache.length < 300) return null;
    await kv.put('relacion:cache', cache, { expirationTtl: 30 * 86400 });
    await kv.put('relacion:cache_fecha', String(Date.now()), { expirationTtl: 30 * 86400 });
    return { ok: true, longitud: cache.length };
  } catch (x) { return null; }
}

async function leerCacheRelacion(e) {
  const kv = gKV(e, 'agente');
  if (!kv) return '';
  try { return await kv.get('relacion:cache') || ''; } catch (x) { return ''; }
}

// ============================================================
// AUTO-RESUMEN POR INACTIVIDAD
// ============================================================
async function autoResumenPorInactividad(e) {
  const db = gDB(e, 'agente');
  const kv = gKV(e, 'agente');
  if (!db || !kv) return;
  try {
    const ultimaActividad = parseInt(await kv.get('ultima_actividad_comandante') || '0');
    if (!ultimaActividad) return;
    const horasInactivo = (Date.now() - ultimaActividad) / 3600000;
    if (horasInactivo < 4) return;
    const ultimoResumen = parseInt(await kv.get('ultimo_resumen_inactividad') || '0');
    if (ultimoResumen > ultimaActividad) return;
    const mensajes = await db.prepare(
      "SELECT mensaje, respuesta, fecha FROM historial WHERE user_id='comandante' AND fecha > ? ORDER BY fecha ASC"
    ).bind(ultimoResumen).all();
    if (!mensajes.results || mensajes.results.length < 3) return;
    const texto = mensajes.results.map(m => `Comandante: ${m.mensaje}\nAyanokōji: ${m.respuesta}`).join('\n\n');
    const res = await e.ayanokoji_IA.run(MODELO_LIGERO, {
      messages: [{
        role: 'user',
        content: `Resume esta conversación para memoria de largo plazo. Incluye: temas tratados, decisiones tomadas, estado del proyecto, cualquier dato nuevo sobre el Comandante. Frases explicativas, no listas. Máximo 400 palabras.\n\n${texto.substring(0, 12000)}`
      }],
      max_tokens: 600,
      temperature: 0.3
    });
    const resumen = extraerRespuesta(res);
    if (resumen.length < 50) return;
    await db.prepare('INSERT INTO resumenes_chat(user_id,fecha,resumen,desde,hasta) VALUES(?,?,?,?,?)')
      .bind('comandante', Date.now(), '[AUTO-INACTIVIDAD] ' + resumen, ultimoResumen, ultimaActividad).run();
    await kv.put('ultimo_resumen_inactividad', String(Date.now()), { expirationTtl: 30 * 86400 });
    await invalidarCache(e, 'resumenes:');
    try {
      await db.prepare('INSERT INTO notificaciones(tipo,titulo,mensaje,leida,fecha) VALUES(?,?,?,0,?)')
        .bind('auto_resumen', 'Resumen automático guardado', `Se resumió la conversación de las últimas horas. (${resumen.length} chars)`, Date.now()).run();
    } catch (x) {}
  } catch (x) {}
}

// ============================================================
// USO REAL DE CLOUDFLARE
// ============================================================
async function consultarUsoReal(e) {
  const accountId = e.CF_ACCOUNT_ID;
  const token = e.CF_API_TOKEN;
  if (!accountId || !token) return { ok: false, error: 'Falta CF_ACCOUNT_ID o CF_API_TOKEN.' };
  const ahora = new Date();
  const inicioDiaISO = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate())).toISOString();
  const inicioDiaDate = inicioDiaISO.split('T')[0];
  const query = `
    query GetFullUsage($accountTag: String!, $startDate: String!, $startDatetime: String!) {
      viewer {
        accounts(filter: {accountTag: $accountTag}) {
          workersInvocationsAdaptive(limit: 1000, filter: { datetime_geq: $startDatetime }) {
            sum { requests errors subrequests }
          }
          d1AnalyticsAdaptiveGroups(limit: 100, filter: { date_geq: $startDate }) {
            sum { readQueries writeQueries rowsRead rowsWritten }
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
      const fallback = await consultarSoloWorkers(accountId, token, inicioDiaISO);
      fallback.raw = data;
      return fallback;
    }
    const cuenta = data.data.viewer.accounts[0];
    let requests = 0, errores = 0, subrequests = 0;
    for (const g of (cuenta.workersInvocationsAdaptive || [])) {
      requests += g.sum?.requests || 0;
      errores += g.sum?.errors || 0;
      subrequests += g.sum?.subrequests || 0;
    }
    let d1_reads = 0, d1_writes = 0, d1_rows_read = 0, d1_rows_written = 0;
    for (const g of (cuenta.d1AnalyticsAdaptiveGroups || [])) {
      d1_reads += g.sum?.readQueries || 0;
      d1_writes += g.sum?.writeQueries || 0;
      d1_rows_read += g.sum?.rowsRead || 0;
      d1_rows_written += g.sum?.rowsWritten || 0;
    }
    let kv_reads = 0, kv_writes = 0, kv_deletes = 0, kv_lists = 0;
    for (const g of (cuenta.kvOperationsAdaptiveGroups || [])) {
      const tipo = (g.dimensions?.actionType || '').toLowerCase();
      const cantidad = g.sum?.requests || 0;
      if (tipo.includes('read') || tipo === 'read') kv_reads += cantidad;
      else if (tipo.includes('write') || tipo === 'write') kv_writes += cantidad;
      else if (tipo.includes('delete')) kv_deletes += cantidad;
      else if (tipo.includes('list')) kv_lists += cantidad;
    }
    return {
      ok: true,
      workers_requests: requests, workers_errores: errores, workers_subrequests: subrequests,
      d1_reads, d1_writes, d1_rows_read, d1_rows_written,
      kv_reads, kv_writes, kv_deletes, kv_lists,
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
          workersInvocationsAdaptive(limit: 1000, filter: { datetime_geq: $datetimeStart }) {
            sum { requests errors subrequests }
          }
        }
      }
    }
  `;
  try {
    const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { accountTag: accountId, datetimeStart: inicioDiaISO } })
    });
    const data = await r.json();
    if (!data.data || !data.data.viewer || !data.data.viewer.accounts) return { ok: false, error: 'GraphQL sin datos.', raw: data };
    const groups = data.data.viewer.accounts[0].workersInvocationsAdaptive || [];
    let requests = 0, errores = 0, subrequests = 0;
    for (const g of groups) {
      requests += g.sum?.requests || 0;
      errores += g.sum?.errors || 0;
      subrequests += g.sum?.subrequests || 0;
    }
    return {
      ok: true, workers_requests: requests, workers_errores: errores, workers_subrequests: subrequests,
      d1_reads: null, d1_writes: null, kv_reads: null, kv_writes: null,
      consultado_en: Date.now(), modo: 'solo_workers'
    };
  } catch (x) { return { ok: false, error: x.message }; }
}

// ============================================================
// GITHUB
// ============================================================
function githubHeaders(e) {
  const h = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'shadow-ayano'
  };
  if (e.GITHUB_TOKEN) h['Authorization'] = `Bearer ${e.GITHUB_TOKEN}`;
  return h;
}

function repoDe(e, tipo) {
  if (tipo === 'frontend') return e.GITHUB_REPO_FRONTEND || null;
  return e.GITHUB_REPO_BACKEND || null;
}

async function githubLeerArchivo(e, repo, archivo, rama) {
  const br = rama || e.GITHUB_BRANCH || 'main';
  const url = `https://api.github.com/repos/${repo}/contents/${archivo}?ref=${br}`;
  const r = await fetch(url, { headers: githubHeaders(e) });
  if (!r.ok) {
    const t = await r.text();
    return { error: `GitHub ${r.status}: ${t.substring(0, 200)}` };
  }
  const d = await r.json();
  if (!d.content) return { error: 'Sin contenido en la respuesta.' };
  const bin = atob(d.content.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const contenido = new TextDecoder('utf-8').decode(bytes);
  return { ok: true, contenido, sha: d.sha, tamaño: contenido.length };
}

async function githubListarArchivos(e, repo, rama) {
  const br = rama || e.GITHUB_BRANCH || 'main';
  const url = `https://api.github.com/repos/${repo}/git/trees/${br}?recursive=1`;
  const r = await fetch(url, { headers: githubHeaders(e) });
  if (!r.ok) {
    const t = await r.text();
    return { error: `GitHub ${r.status}: ${t.substring(0, 200)}` };
  }
  const d = await r.json();
  if (!d.tree) return { error: 'Sin árbol en la respuesta.' };
  const archivos = d.tree
    .filter(x => x.type === 'blob')
    .map(x => ({ ruta: x.path, tamaño: x.size }));
  return { ok: true, archivos, total: archivos.length };
}

async function githubEscribirArchivo(e, repo, archivo, contenido, mensaje, rama) {
  const br = rama || e.GITHUB_BRANCH || 'main';
  if (!e.GITHUB_TOKEN) return { error: 'GITHUB_TOKEN no configurado. No puedo escribir.' };
  let sha = null;
  try {
    const url = `https://api.github.com/repos/${repo}/contents/${archivo}?ref=${br}`;
    const r = await fetch(url, { headers: githubHeaders(e) });
    if (r.ok) { const d = await r.json(); sha = d.sha; }
  } catch (x) {}
  const bytes = new TextEncoder().encode(contenido);
  let bin = '';
  const paso = 8192;
  for (let i = 0; i < bytes.length; i += paso) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + paso));
  }
  const b64 = btoa(bin);
  const url = `https://api.github.com/repos/${repo}/contents/${archivo}`;
  const body = {
    message: mensaje || `Actualización de ${archivo} por Ayanokōji Digital`,
    content: b64,
    branch: br
  };
  if (sha) body.sha = sha;
  const r = await fetch(url, {
    method: 'PUT',
    headers: { ...githubHeaders(e), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const t = await r.text();
    return { error: `GitHub PUT ${r.status}: ${t.substring(0, 300)}` };
  }
  const d = await r.json();
  return { ok: true, commit: d.commit?.sha, url: d.commit?.html_url };
}

// ============================================================
// EJECUTOR DE HERRAMIENTAS
// ============================================================
async function ejecutarHerramienta(e, inv, uid, c) {
  const t = inv.tool;
  const p = inv.params || {};
  if (!herramientaExiste(t)) return { ok: false, error: `Herramienta desconocida: ${t}` };
  try {
    switch (t) {
      case 'leer_source': {
        const repo = repoDe(e, p.repo === 'frontend' ? 'frontend' : 'backend');
        if (!repo) return { ok: false, error: 'Repo no configurado.' };
        const r = await githubLeerArchivo(e, repo, p.archivo, p.rama);
        if (r.error) return { ok: false, error: r.error };
        return { ok: true, resultado: { archivo: p.archivo, longitud: r.tamaño, contenido: r.contenido } };
      }
      case 'listar_source': {
        const repo = repoDe(e, p.repo === 'frontend' ? 'frontend' : 'backend');
        if (!repo) return { ok: false, error: 'Repo no configurado.' };
        const r = await githubListarArchivos(e, repo, p.rama);
        return r.error ? { ok: false, error: r.error } : { ok: true, resultado: r };
      }
      case 'escribir_source': {
        const repo = repoDe(e, p.repo === 'frontend' ? 'frontend' : 'backend');
        if (!repo) return { ok: false, error: 'Repo no configurado.' };
        if (!p.archivo || !p.contenido) return { ok: false, error: 'Faltan archivo o contenido.' };
        const kv = gKV(e, 'agente');
        if (kv) {
          try {
            const actual = await githubLeerArchivo(e, repo, p.archivo, p.rama);
            if (actual.ok) await kv.put(`snapshot_github:${p.archivo}:${Date.now()}`, actual.contenido, { expirationTtl: 30 * 86400 });
          } catch (x) {}
        }
        const r = await githubEscribirArchivo(e, repo, p.archivo, p.contenido, p.mensaje_commit, p.rama);
        return r.error ? { ok: false, error: r.error } : { ok: true, resultado: r };
      }
      case 'proponer_cambio': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        try {
          const r = await db.prepare('INSERT INTO decisiones_autonomas(tipo,contexto,decision,simulacion,aplicada,resultado,fecha) VALUES(?,?,?,?,?,?,?)')
            .bind('propuesta_codigo', p.archivo || '', p.razon || '', (p.diff || '').substring(0, 4000), 0, 'pendiente_aprobacion', Date.now()).run();
          return { ok: true, resultado: { id: r.meta.last_row_id, mensaje: 'Propuesta guardada.' } };
        } catch (x) { return { ok: false, error: x.message }; }
      }
      case 'listar_workers': {
        const au = await opcional('autonomia');
        if (!au) return { ok: false, error: 'autonomia.js no disponible.' };
        const r = await au.listarWorkers(e);
        return r.error ? { ok: false, error: r.error } : { ok: true, resultado: r };
      }
      case 'leer_worker': {
        const au = await opcional('autonomia');
        if (!au) return { ok: false, error: 'autonomia.js no disponible.' };
        const r = await au.leerCodigoWorker(e, p.nombre);
        return r.error ? { ok: false, error: r.error } : { ok: true, resultado: { nombre: p.nombre, longitud: r.longitud, codigo: (r.codigo || '').substring(0, 20000) } };
      }
      case 'crear_worker': {
        const au = await opcional('autonomia');
        if (!au) return { ok: false, error: 'autonomia.js no disponible.' };
        const r = await au.crearWorker(e, p.nombre, p.codigo);
        return r.error ? { ok: false, error: r.error } : { ok: true, resultado: r };
      }
      case 'actualizar_worker': {
        const au = await opcional('autonomia');
        if (!au) return { ok: false, error: 'autonomia.js no disponible.' };
        const r = await au.actualizarWorker(e, p.nombre, p.codigo);
        return r.error ? { ok: false, error: r.error } : { ok: true, resultado: r };
      }
      case 'snapshot_worker': {
        const au = await opcional('autonomia');
        if (!au) return { ok: false, error: 'autonomia.js no disponible.' };
        const r = await au.crearSnapshot(e, p.nombre);
        return r.error ? { ok: false, error: r.error } : { ok: true, resultado: r };
      }
      case 'revertir_worker': {
        const au = await opcional('autonomia');
        if (!au) return { ok: false, error: 'autonomia.js no disponible.' };
        const r = await au.revertir(e, p.nombre);
        return r.error ? { ok: false, error: r.error } : { ok: true, resultado: r };
      }
      case 'leer_historial_largo': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        const limite = Math.min(parseInt(p.limite) || 50, 200);
        const user_id = p.user_id || 'comandante';
        const r = await db.prepare('SELECT rol, contenido, orden, fecha FROM historial_largo WHERE user_id=? ORDER BY orden DESC LIMIT ?').bind(user_id, limite).all();
        return { ok: true, resultado: { total: r.results.length, mensajes: (r.results || []).reverse() } };
      }
      case 'buscar_tema': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        const q = (p.q || '').toLowerCase();
        if (!q) return { ok: false, error: 'Falta q.' };
        const limite = Math.min(parseInt(p.limite) || 20, 60);
        const temas = await db.prepare('SELECT DISTINCT mensaje_orden, tema, peso FROM indice_temas WHERE tema LIKE ? ORDER BY peso DESC LIMIT ?').bind('%' + q + '%', limite).all();
        if (!temas.results || !temas.results.length) {
          const directo = await db.prepare('SELECT rol,contenido,orden FROM historial_largo WHERE contenido LIKE ? ORDER BY orden DESC LIMIT ?').bind('%' + q + '%', limite).all();
          return { ok: true, resultado: { metodo: 'directo', total: directo.results.length, resultados: directo.results } };
        }
        const ords = temas.results.map(x => x.mensaje_orden);
        const ph = ords.map(() => '?').join(',');
        const msgs = await db.prepare('SELECT rol,contenido,orden FROM historial_largo WHERE orden IN (' + ph + ') ORDER BY orden ASC').bind(...ords).all();
        return { ok: true, resultado: { metodo: 'indice', total: msgs.results.length, resultados: msgs.results } };
      }
      case 'leer_contexto': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        const limite = Math.min(parseInt(p.limite) || 5, 30);
        const r = await db.prepare('SELECT fecha, resumen, fases, fuente FROM contexto ORDER BY fecha DESC LIMIT ?').bind(limite).all();
        return { ok: true, resultado: { total: r.results.length, contextos: r.results } };
      }
      case 'guardar_contexto': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        const resumen = p.resumen || '';
        if (!resumen) return { ok: false, error: 'Falta resumen.' };
        const fases = Array.isArray(p.fases) ? JSON.stringify(p.fases) : JSON.stringify([]);
        const r = await db.prepare('INSERT INTO contexto(fecha,resumen,fases,fuente) VALUES(?,?,?,?)')
          .bind(Date.now(), resumen, fases, p.fuente || 'ayanokoji_auto').run();
        await invalidarCache(e, 'contexto:');
        return { ok: true, resultado: { id: r.meta.last_row_id } };
      }
      case 'indexar_historial': {
        const r = await indexarHistorial({ json: async () => ({}) }, e);
        return r.error ? { ok: false, error: r.error } : { ok: true, resultado: r };
      }
      case 'construir_perfil_base': {
        const r = await construirPerfilBase(e);
        return r.error ? { ok: false, error: r.error } : { ok: true, resultado: { longitud: r.longitud } };
      }
      case 'leer_perfil_base': {
        const kv = gKV(e, 'agente');
        if (!kv) return { ok: false, error: 'KV no disponible.' };
        const perfil = await kv.get('perfil_base');
        return { ok: true, resultado: { existe: !!perfil, longitud: perfil ? perfil.length : 0, perfil: perfil || null } };
      }
      case 'crear_estrategia': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        if (!p.nombre || !p.contenido) return { ok: false, error: 'Faltan nombre o contenido.' };
        const r = await db.prepare('INSERT INTO estrategias(nombre,tipo,contenido,prioridad,creada,actualizada) VALUES(?,?,?,?,?,?)')
          .bind(p.nombre, p.tipo || 'general', p.contenido, parseInt(p.prioridad) || 5, Date.now(), Date.now()).run();
        await invalidarCache(e, 'estrategias:');
        return { ok: true, resultado: { id: r.meta.last_row_id } };
      }
      case 'listar_estrategias': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        const r = await db.prepare("SELECT id,nombre,tipo,contenido,prioridad,estado FROM estrategias WHERE estado='activa' ORDER BY prioridad ASC").all();
        return { ok: true, resultado: { total: r.results.length, estrategias: r.results } };
      }
      case 'eliminar_estrategia': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        await db.prepare('DELETE FROM estrategias WHERE id=?').bind(p.id).run();
        await invalidarCache(e, 'estrategias:');
        return { ok: true, resultado: { eliminada: p.id } };
      }
      case 'registrar_decision': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        const r = await db.prepare('INSERT INTO decisiones_autonomas(tipo,contexto,decision,simulacion,aplicada,resultado,fecha) VALUES(?,?,?,?,?,?,?)')
          .bind(p.tipo || 'operativa', p.contexto || '', p.decision || '', p.simulacion || '', 1, p.resultado || '', Date.now()).run();
        return { ok: true, resultado: { id: r.meta.last_row_id } };
      }
      case 'leer_decisiones': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        const limite = Math.min(parseInt(p.limite) || 20, 100);
        const r = await db.prepare('SELECT tipo,contexto,decision,resultado,fecha FROM decisiones_autonomas ORDER BY fecha DESC LIMIT ?').bind(limite).all();
        return { ok: true, resultado: { total: r.results.length, decisiones: r.results } };
      }
      case 'simular_estrategia': {
        const sb = await opcional('sandbox');
        if (!sb) return { ok: false, error: 'sandbox.js no disponible.' };
        const r = await sb.simularEstrategia(e, parseInt(p.estrategia_id));
        return r.error ? { ok: false, error: r.error } : { ok: true, resultado: { nota: r.nota, simulacion: (r.simulacion || '').substring(0, 3000) } };
      }
      case 'simular_precio': {
        const sb = await opcional('sandbox');
        if (!sb) return { ok: false, error: 'sandbox.js no disponible.' };
        const fakeR = { json: async () => ({ propuesta: p.propuesta }) };
        const res = await sb.simularPrecio(fakeR, e);
        const data = await res.json();
        return data.error ? { ok: false, error: data.error } : { ok: true, resultado: { simulacion: data.simulacion } };
      }
      case 'ejecutar_etapa': {
        const sb = await opcional('sandbox');
        if (!sb) return { ok: false, error: 'sandbox.js no disponible.' };
        const r = await sb.ejecutarEtapa(e, p.etapa_id, parseInt(p.dia) || 1);
        return r.error ? { ok: false, error: r.error } : { ok: true, resultado: { etapa: r.etapa, exito: r.exito, completada: r.completada, metrica: r.valor } };
      }
      case 'test_500': {
        const sb = await opcional('sandbox');
        if (!sb) return { ok: false, error: 'sandbox.js no disponible.' };
        const r = await sb.test500Usuarios(e, parseInt(p.dia) || 1);
        return r.error ? { ok: false, error: r.error } : { ok: true, resultado: { registrados: r.registrados, pagos: r.pagos, ingresos: r.ingresos, arpu: r.arpu } };
      }
      case 'ver_sandbox': {
        const sb = await opcional('sandbox');
        if (!sb) return { ok: false, error: 'sandbox.js no disponible.' };
        const fakeR = { url: 'https://x/api/sandbox' };
        const res = await sb.verSandbox(fakeR, e);
        const data = await res.json();
        return data.error ? { ok: false, error: data.error } : { ok: true, resultado: { progreso_pct: data.curriculum?.progreso_pct, etapa_actual: data.curriculum?.etapa_actual, st: data.estado_economico?.st } };
      }
      case 'promover_leccion': {
        const sb = await opcional('sandbox');
        if (!sb) return { ok: false, error: 'sandbox.js no disponible.' };
        const fakeR = { json: async () => ({ leccionId: p.leccion_id }) };
        const res = await sb.promoverLeccion(fakeR, e);
        const data = await res.json();
        return data.error ? { ok: false, error: data.error } : { ok: true, resultado: data };
      }
      case 'generar_contenido': {
        const pub = await opcional('publisher');
        if (!pub) return { ok: false, error: 'publisher.js no disponible.' };
        const r = await pub.generarContenido(e, p.tipo || 'provocacion');
        return r.error ? { ok: false, error: r.error } : { ok: true, resultado: { contenido: r.contenido } };
      }
      case 'generar_imagen': {
        const r = await generarImagen(e, p.prompt || '', uid);
        return { ok: true, resultado: { id: r.id, url: r.url, mensaje: r.respuesta } };
      }
      case 'publicar': {
        const pub = await opcional('publisher');
        if (!pub) return { ok: false, error: 'publisher.js no disponible.' };
        const enc = await pub.encolar(e, p.tipo || 'manual', p.contenido || '', p.canales || 'mastodon', Date.now(), p.imagen_id || null);
        if (enc.error) return { ok: false, error: enc.error };
        const r = await pub.publicar(e, enc.id);
        return { ok: r.ok === true, resultado: r.resultados, error: r.ok ? null : 'Falló algún canal' };
      }
      case 'encolar_publicacion': {
        const pub = await opcional('publisher');
        if (!pub) return { ok: false, error: 'publisher.js no disponible.' };
        const r = await pub.encolar(e, p.tipo || 'manual', p.contenido || '', p.canales || 'mastodon', parseInt(p.programada) || Date.now(), p.imagen_id || null);
        return r.error ? { ok: false, error: r.error } : { ok: true, resultado: r };
      }
      case 'listar_publicaciones': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        const limite = Math.min(parseInt(p.limite) || 30, 100);
        const r = await db.prepare('SELECT id,tipo,canales,estado,publicada,creada FROM publicaciones ORDER BY creada DESC LIMIT ?').bind(limite).all();
        return { ok: true, resultado: { total: r.results.length, publicaciones: r.results } };
      }
      case 'encolar_tarea': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        const r = await db.prepare('INSERT INTO tareas(tipo,descripcion,payload,prioridad,creada) VALUES(?,?,?,?,?)')
          .bind('manual', p.descripcion || '', '{}', parseInt(p.prioridad) || 5, Date.now()).run();
        return { ok: true, resultado: { id: r.meta.last_row_id } };
      }
      case 'listar_tareas': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        const r = await db.prepare('SELECT id,tipo,descripcion,estado,prioridad,creada FROM tareas ORDER BY prioridad ASC, creada ASC LIMIT 50').all();
        return { ok: true, resultado: { total: r.results.length, tareas: r.results } };
      }
      case 'pulso_cron': {
        const kv = gKV(e, 'agente');
        if (kv) await kv.delete('cron_autonomo_ultima');
        await cronAutonomo(e);
        return { ok: true, resultado: { mensaje: 'Cron ejecutado.' } };
      }
      case 'leer_uso_real': {
        const r = await consultarUsoReal(e);
        return r.ok ? { ok: true, resultado: r } : { ok: false, error: r.error };
      }
      case 'leer_capacidades': {
        const uso = await consultarUsoReal(e);
        const db = gDB(e, 'agente');
        let procesosActivos = 0, totalMensajes = 0, totalTemas = 0;
        if (db) {
          try { const p1 = await db.prepare("SELECT COUNT(*) as n FROM procesos WHERE estado IN ('procesando','pendiente')").first(); procesosActivos = p1 ? p1.n : 0; } catch (x) {}
          try { const p2 = await db.prepare('SELECT COUNT(*) as n FROM historial_largo').first(); totalMensajes = p2 ? p2.n : 0; } catch (x) {}
          try { const p3 = await db.prepare('SELECT COUNT(*) as n FROM indice_temas').first(); totalTemas = p3 ? p3.n : 0; } catch (x) {}
        }
        return { ok: true, resultado: { uso, procesosActivos, totalMensajes, totalTemas } };
      }
      case 'diagnosticar': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        const tablas = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
        const conteos = {};
        for (const t2 of (tablas.results || [])) {
          try { const c2 = await db.prepare('SELECT COUNT(*) as n FROM ' + t2.name).first(); conteos[t2.name] = c2 ? c2.n : 0; } catch (x) { conteos[t2.name] = 'err'; }
        }
        return { ok: true, resultado: { tablas: (tablas.results || []).map(x => x.name), conteos } };
      }
      case 'errores_tardios': {
        const db = gDB(e, 'agente'), kv = gKV(e, 'agente');
        const problemas = [];
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        try { const files = await kv.list({ prefix: 'file:', limit: 500 }); if (files.keys.length > 50) problemas.push({ tipo: 'kv_huerfano', msg: files.keys.length + ' chunks.' }); } catch (x) {}
        try { const atascados = await db.prepare("SELECT id FROM procesos WHERE estado='procesando' AND ? - fecha_inicio > 86400000").bind(Date.now()).all(); for (const x of (atascados.results || [])) problemas.push({ tipo: 'proceso_atascado', msg: x.id }); } catch (x) {}
        return { ok: true, resultado: { total: problemas.length, problemas } };
      }
      case 'leer_acciones': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        const limite = Math.min(parseInt(p.limite) || 50, 200);
        const r = await db.prepare('SELECT tipo,descripcion,exito,detalle,fecha FROM acciones ORDER BY fecha DESC LIMIT ?').bind(limite).all();
        return { ok: true, resultado: { total: r.results.length, acciones: r.results } };
      }
      case 'listar_notificaciones': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        const limite = Math.min(parseInt(p.limite) || 50, 200);
        const r = await db.prepare('SELECT tipo,titulo,mensaje,leida,fecha FROM notificaciones ORDER BY fecha DESC LIMIT ?').bind(limite).all();
        return { ok: true, resultado: { total: r.results.length, notificaciones: r.results } };
      }
      case 'crear_notificacion': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        const r = await db.prepare('INSERT INTO notificaciones(tipo,titulo,mensaje,leida,fecha) VALUES(?,?,?,0,?)')
          .bind(p.tipo || 'ayanokoji', p.titulo || '', p.mensaje || '', Date.now()).run();
        return { ok: true, resultado: { id: r.meta.last_row_id } };
      }
      case 'notificar_telegram': {
        const { notificar } = await import('./notify.js');
        const ok = await notificar(e, p.mensaje || '');
        return { ok, resultado: { enviado: ok } };
      }
      case 'registrar_conciencia': {
        const kv = gKV(e, 'agente');
        if (!kv) return { ok: false, error: 'KV no disponible.' };
        const clave = 'conciencia:ayanokoji';
        const actual = JSON.parse(await kv.get(clave) || '[]');
        actual.unshift({ accion: p.accion || '', detalle: (p.detalle || '').substring(0, 400), pestana: p.pestana || 'auto', fecha: Date.now() });
        await kv.put(clave, JSON.stringify(actual.slice(0, 50)), { expirationTtl: 7 * 86400 });
        return { ok: true, resultado: { registrada: true } };
      }
      case 'leer_conciencia': {
        const kv = gKV(e, 'agente');
        if (!kv) return { ok: false, error: 'KV no disponible.' };
        const user_id = p.user_id || 'comandante';
        const c2 = JSON.parse(await kv.get('conciencia:' + user_id) || '[]');
        return { ok: true, resultado: { total: c2.length, conciencia: c2.slice(0, 20) } };
      }
      case 'leer_frontend': {
        const repo = repoDe(e, 'frontend');
        if (!repo) return { ok: false, error: 'Repo frontend no configurado.' };
        const r = await githubLeerArchivo(e, repo, p.archivo, p.rama);
        if (r.error) return { ok: false, error: r.error };
        return { ok: true, resultado: { archivo: p.archivo, longitud: r.tamaño, contenido: r.contenido } };
      }
      case 'modificar_frontend': {
        const repo = repoDe(e, 'frontend');
        if (!repo) return { ok: false, error: 'Repo frontend no configurado.' };
        const kv = gKV(e, 'agente');
        if (kv) {
          try {
            const actual = await githubLeerArchivo(e, repo, p.archivo, p.rama);
            if (actual.ok) await kv.put(`snapshot_github:frontend:${p.archivo}:${Date.now()}`, actual.contenido, { expirationTtl: 30 * 86400 });
          } catch (x) {}
        }
        const r = await githubEscribirArchivo(e, repo, p.archivo, p.contenido, p.mensaje_commit, p.rama);
        return r.error ? { ok: false, error: r.error } : { ok: true, resultado: r };
      }
      default:
        return { ok: false, error: `Herramienta no implementada: ${t}` };
    }
  } catch (x) {
    return { ok: false, error: `Error ejecutando ${t}: ${x.message}` };
  }
}

async function guardarAprobacionPendiente(e, uid, inv) {
  const kv = gKV(e, 'agente');
  if (!kv) return null;
  const clave = 'aprobacion:' + uid;
  const paquete = { tool: inv.tool, params: inv.params, razon: inv.razon, ts: Date.now() };
  await kv.put(clave, JSON.stringify(paquete), { expirationTtl: APROBACION_TTL });
  return paquete;
}

async function leerAprobacionPendiente(e, uid) {
  const kv = gKV(e, 'agente');
  if (!kv) return null;
  const raw = await kv.get('aprobacion:' + uid);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (x) { return null; }
}

async function limpiarAprobacionPendiente(e, uid) {
  const kv = gKV(e, 'agente');
  if (kv) await kv.delete('aprobacion:' + uid);
}

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
  } catch (x) { return { respuesta: 'Error: ' + x.message }; }
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

    const kvActividad = gKV(e, 'agente');
    if (kvActividad) {
      try { await kvActividad.put('ultima_actividad_comandante', String(Date.now()), { expirationTtl: 30 * 86400 }); } catch (x) {}
    }

    const tLower = m.toLowerCase().trim();
    const aprueba = /^(s[ií]|dale|adelante|hazlo|confirmo|aprobado|ok|procede|ejecuta|yes)$/i.test(tLower);
    const rechaza = /^(no|cancela|abort|rechaza|detente|para|nope)$/i.test(tLower);

    if (aprueba) {
      const pendiente = await leerAprobacionPendiente(e, uid);
      if (pendiente) {
        await limpiarAprobacionPendiente(e, uid);
        const resultado = await ejecutarHerramienta(e, pendiente, uid, c);
        const exito = resultado.ok;
        try {
          const db = gDB(e, 'agente');
          if (db) {
            await db.prepare('INSERT INTO acciones(tipo,descripcion,exito,detalle,fecha) VALUES(?,?,?,?,?)')
              .bind('aprobacion_herramienta', pendiente.tool, exito ? 1 : 0, (resultado.error || JSON.stringify(resultado.resultado || {}).substring(0, 500)), Date.now()).run();
          }
        } catch (x) {}
        const textoResp = exito
          ? `Ejecutado: **${pendiente.tool}**.\n\nResultado: ${JSON.stringify(resultado.resultado || {}).substring(0, 1500)}`
          : `Falló **${pendiente.tool}**: ${resultado.error}`;
        if (e.DB) {
          try {
            await e.DB.prepare("INSERT INTO historial(user_id,mensaje,respuesta,fecha) VALUES(?,?,?,?)").bind(uid, m, textoResp, Date.now()).run();
          } catch (x) {}
        }
        return J({ respuesta: textoResp, user_id: uid, intencion: 'aprobacion' });
      }
    }

    if (rechaza) {
      const pendiente = await leerAprobacionPendiente(e, uid);
      if (pendiente) {
        await limpiarAprobacionPendiente(e, uid);
        return J({ respuesta: `Cancelado: **${pendiente.tool}**. No se ejecutó.`, user_id: uid, intencion: 'cancelacion' });
      }
    }

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

    const cacheRelacion = await leerCacheRelacion(e);

    let ventana = [];
    const ventanaRaw = await conCache(e, `historial:${uid}:${VENTANA_SEGURA}`, TTL_HISTORIAL, async () => {
      try {
        const r1 = await e.DB.prepare('SELECT rol, contenido FROM historial_largo WHERE user_id=? ORDER BY orden DESC LIMIT ?').bind(uid, VENTANA_SEGURA).all();
        return (r1.results || []).reverse();
      } catch (x) { return null; }
    });
    if (ventanaRaw && ventanaRaw.length) {
      ventana = ventanaRaw.map(x => ({
        role: x.rol === 'assistant' ? 'assistant' : 'user',
        content: (x.contenido || '').substring(0, MAX_CHARS_MENSAJE)
      }));
    } else if (e.DB) {
      try {
        const r1 = await e.DB.prepare("SELECT mensaje,respuesta FROM historial WHERE user_id=? ORDER BY fecha DESC LIMIT 15").bind(uid).all();
        if (r1.results) {
          ventana = r1.results.reverse().flatMap(x => [
            { role: 'user', content: (x.mensaje || '').substring(0, MAX_CHARS_MENSAJE) },
            { role: 'assistant', content: (x.respuesta || '').substring(0, MAX_CHARS_MENSAJE) }
          ]);
        }
      } catch (x) {}
    }

    let ctx = '', fs = null;
    const ctxRaw = await conCache(e, 'contexto:ultimo', TTL_CONTEXTO, async () => {
      try {
        const r2 = await e.DB.prepare("SELECT resumen,fases FROM contexto ORDER BY fecha DESC LIMIT 1").first();
        return r2 || null;
      } catch (x) { return null; }
    });
    if (ctxRaw) {
      ctx = (ctxRaw.resumen || '').substring(0, MAX_CHARS_CONTEXTO);
      if (ctxRaw.fases) { try { fs = JSON.parse(ctxRaw.fases); } catch (x) {} }
    }

    let rec = await conCache(e, `resumenes:${uid}`, TTL_RESUMENES, async () => {
      try {
        const r3 = await e.DB.prepare("SELECT resumen FROM resumenes_chat WHERE user_id=? ORDER BY fecha DESC LIMIT 3").bind(uid).all();
        return (r3.results || []).map(x => (x.resumen || '').substring(0, 800));
      } catch (x) { return null; }
    });
    if (!rec) rec = [];

    let correcciones = await conCache(e, 'correcciones', TTL_CORRECCIONES, async () => {
      try {
        const rc = await e.DB.prepare('SELECT correccion FROM correcciones_voz ORDER BY fecha DESC LIMIT 15').all();
        return (rc.results || []).map(x => x.correccion);
      } catch (x) { return null; }
    });
    if (!correcciones) correcciones = [];

    let estrategias = await conCache(e, 'estrategias:activas', TTL_ESTRATEGIAS, async () => {
      try {
        const re = await e.DB.prepare("SELECT nombre, tipo, contenido FROM estrategias WHERE estado='activa' ORDER BY prioridad ASC LIMIT 5").all();
        return re.results || [];
      } catch (x) { return null; }
    });
    if (!estrategias) estrategias = [];

    let conciencia = [];
    if (e.KV) {
      try {
        const c2 = JSON.parse(await e.KV.get('conciencia:' + uid) || '[]');
        conciencia = c2.slice(0, 10).map(x => `[${x.pestana}] ${x.accion}: ${x.detalle}`.substring(0, 200));
      } catch (x) {}
    }

    let systemPrompt = construirSystemPrompt(ctx, fs, rec, perfilBase, correcciones, estrategias, conciencia);

    if (cacheRelacion && cacheRelacion.length > 100) {
      systemPrompt += `\n\n=== CACHÉ DE RELACIÓN (patrones entre el Comandante y yo) ===\n${cacheRelacion.substring(0, 3000)}`;
    }

    let mensajes = [
      { role: 'system', content: systemPrompt },
      ...ventana,
      { role: 'user', content: m }
    ];

    let respuestaFinal = '';
    let iteracion = 0;
    let invocacionesEjecutadas = [];
    let aprobacionPendiente = null;

    while (iteracion < MAX_ITERACIONES_TOOL) {
      iteracion++;
      const modeloElegido = elegirModelo(m, i, iteracion);
      const res = await e.ayanokoji_IA.run(modeloElegido, { messages: mensajes, max_tokens: 1200, temperature: 0.7 });
      const rp = extraerRespuesta(res);
      const invocaciones = parsearInvocaciones(rp);

      if (!invocaciones.length) {
        respuestaFinal = rp || 'No obtuve respuesta del modelo. Intenta de nuevo.';
        break;
      }

      const textoLimpio = rp.replace(/```tool\s*\n[\s\S]*?\n```/g, '').trim();

      const peligrosa = invocaciones.find(inv => herramientaRequiereAprobacion(inv.tool));
      if (peligrosa) {
        await guardarAprobacionPendiente(e, uid, peligrosa);
        aprobacionPendiente = peligrosa;
        respuestaFinal = textoLimpio || `Voy a usar la herramienta **${peligrosa.tool}**.\n\nRazón: ${peligrosa.razon || '(sin especificar)'}\n\nParámetros: ${JSON.stringify(peligrosa.params).substring(0, 300)}\n\n¿Confirmas? Responde **sí** para ejecutar, **no** para cancelar.`;
        break;
      }

      const resultados = [];
      for (const inv of invocaciones) {
        const r1 = await ejecutarHerramienta(e, inv, uid, c);
        invocacionesEjecutadas.push({ tool: inv.tool, ok: r1.ok });
        resultados.push({
          tool: inv.tool,
          ok: r1.ok,
          resultado: r1.resultado ? JSON.stringify(r1.resultado).substring(0, 4000) : null,
          error: r1.error || null
        });
      }

      mensajes.push({ role: 'assistant', content: rp });
      mensajes.push({
        role: 'user',
        content: `[RESULTADOS DE HERRAMIENTAS]\n${resultados.map(rr => `- ${rr.tool}: ${rr.ok ? 'OK' : 'ERROR'} → ${rr.ok ? rr.resultado : rr.error}`).join('\n\n')}\n\nContinúa con tu respuesta final al Comandante. NO incluyas bloques \`\`\`tool a menos que necesites otra herramienta.`
      });

      if (iteracion === MAX_ITERACIONES_TOOL) {
        respuestaFinal = textoLimpio || 'He ejecutado herramientas pero no puedo procesar más en esta iteración. Revisa la bandeja de acciones.';
      }
    }

    const afirmaAccion = /\b(he creado|he insertado|he guardado|he actualizado|he desplegado|he borrado|he añadido|ya está|ya se hizo|completado|ejecutado)\b/i.test(respuestaFinal);
    if (afirmaAccion && !invocacionesEjecutadas.length && e.DB) {
      try {
        const ult = await e.DB.prepare("SELECT tipo FROM acciones WHERE fecha > ? ORDER BY fecha DESC LIMIT 1").bind(Date.now() - 60000).first();
        if (!ult) respuestaFinal += '\n\n_⚠️ No tengo registro de esa acción en mi historial reciente._';
      } catch (x) {}
    }

    if (e.DB) {
      try {
        await e.DB.prepare("INSERT INTO historial(user_id,mensaje,respuesta,fecha) VALUES(?,?,?,?)").bind(uid, m, respuestaFinal, Date.now()).run();
        const maxOrd = await e.DB.prepare('SELECT MAX(orden) as o FROM historial_largo WHERE user_id=?').bind(uid).first();
        let ord = (maxOrd && maxOrd.o != null) ? maxOrd.o : 0;
        await e.DB.prepare('INSERT INTO historial_largo(user_id,rol,contenido,orden,fecha) VALUES(?,?,?,?,?)').bind(uid, 'user', m, ord + 1, Date.now()).run();
        await e.DB.prepare('INSERT INTO historial_largo(user_id,rol,contenido,orden,fecha) VALUES(?,?,?,?,?)').bind(uid, 'assistant', respuestaFinal, ord + 2, Date.now()).run();
      } catch (x) {}
    }

    try { await invalidarCache(e, `historial:${uid}`); } catch (x) {}

    if (e.DB && e.KV && c) {
      try {
        const lastSum = parseInt(await e.KV.get('last_summary:' + uid) || '0');
        const countRes = await e.DB.prepare("SELECT COUNT(*) as n FROM historial WHERE user_id=? AND fecha > ?").bind(uid, lastSum).first();
        if (countRes && countRes.n >= 30) c.waitUntil(resumirChats(e, uid));
      } catch (x) {}
    }

    return J({
      respuesta: respuestaFinal,
      user_id: uid,
      intencion: i,
      herramientas_usadas: invocacionesEjecutadas,
      aprobacion_pendiente: aprobacionPendiente ? aprobacionPendiente.tool : null,
      cache_usado: true
    });
  } catch (x) {
    return J({ respuesta: 'Error: ' + x.message });
  }
}

// ============================================================
// RESPUESTAS DIRECTAS Y ENDPOINTS
// ============================================================
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

async function rEst(e, uid) {
  let n = 0, c2 = 0, a = 0, p = 0, s = 0, hl = 0, tareas = 0, workers = 0, notif = 0;
  try {
    if (e.DB) {
      try { const r1 = await e.DB.prepare('SELECT COUNT(*) as n FROM historial WHERE user_id=?').bind(uid).first(); n = r1 ? r1.n : 0; } catch (x) {}
      try { const r2 = await e.DB.prepare('SELECT COUNT(*) as n FROM contexto').first(); c2 = r2 ? r2.n : 0; } catch (x) {}
      try { const r3 = await e.DB.prepare('SELECT COUNT(*) as n FROM archivos').first(); a = r3 ? r3.n : 0; } catch (x) {}
      try { const r4 = await e.DB.prepare('SELECT COUNT(*) as n FROM procesos').first(); p = r4 ? r4.n : 0; } catch (x) {}
      try { const r5 = await e.DB.prepare('SELECT COUNT(*) as n FROM resumenes_chat').first(); s = r5 ? r5.n : 0; } catch (x) {}
      try { const r6 = await e.DB.prepare('SELECT COUNT(*) as n FROM historial_largo WHERE user_id=?').bind(uid).first(); hl = r6 ? r6.n : 0; } catch (x) {}
      try { const r7 = await e.DB.prepare("SELECT COUNT(*) as n FROM tareas WHERE estado='pendiente'").first(); tareas = r7 ? r7.n : 0; } catch (x) {}
      try { const r8 = await e.DB.prepare('SELECT COUNT(*) FROM workers_registrados WHERE activo=1').first(); workers = r8 ? Object.values(r8)[0] : 0; } catch (x) {}
      try { const r9 = await e.DB.prepare('SELECT COUNT(*) as n FROM notificaciones WHERE leida=0').first(); notif = r9 ? r9.n : 0; } catch (x) {}
    }
  } catch (x) {}
  return J({ respuesta: `Sistema activo (modelo 70B + caché con TTLs largos). Memoria: ${n} mensajes, ${hl} en historial largo, ${c2} contextos, ${a} archivos, ${p} procesos, ${s} resúmenes. Tareas: ${tareas}. Workers: ${workers}. Notif sin leer: ${notif}.` });
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
    const db = gDB(e, 'agente'), kvN = gKV(e, 'agente');
    if (!db) return J({ error: 'D1 no configurado.' });
    if (b.archivoId && kvN) {
      const ls = await kvN.list({ prefix: 'file:' + b.archivoId + ':' });
      for (const k of ls.keys) await kvN.delete(k.name);
      const lp = await kvN.list({ prefix: 'proc:' + b.archivoId + ':' });
      for (const k of lp.keys) await kvN.delete(k.name);
      try { await db.prepare('DELETE FROM archivos WHERE id=?').bind(b.archivoId).run(); } catch (x) {}
      try { await db.prepare('DELETE FROM procesos WHERE id=?').bind(b.archivoId).run(); } catch (x) {}
      return J({ ok: true, limpiado: b.archivoId });
    }
    if (b.todo) {
      const todas = await kvN.list({ prefix: '' });
      for (const k of todas.keys) {
        if (k.name.startsWith('file:') || k.name.startsWith('proc:')) await kvN.delete(k.name);
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
    const rp = extraerRespuesta(res);
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
    await invalidarCache(e, `historial:${uid}`);
    return J({ success: true, message: `Memoria de ${uid} reseteada.` });
  } catch (x) { return J({ error: x.message }); }
}

async function diagnostico(r, e) {
  const db = gDB(e, 'agente');
  if (!db) return J({ error: 'Sin D1.' });
  try {
    const tablas = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const conteos = {};
    for (const t of (tablas.results || [])) {
      try { const c2 = await db.prepare('SELECT COUNT(*) as n FROM ' + t.name).first(); conteos[t.name] = c2 ? c2.n : 0; } catch (x) { conteos[t.name] = 'err: ' + x.message; }
    }
    const kvN = gKV(e, 'agente');
    let kvCount = 'sin kv';
    try { const lista = await kvN.list({ limit: 1000 }); kvCount = lista.keys.length; } catch (x) {}
    const modulos = {};
    for (const m of ['social','autonomia','publisher','sandbox']) {
      const x = await opcional(m);
      modulos[m] = !!x;
    }
    return J({ ok: true, tablas: (tablas.results || []).map(t => t.name), conteos, kv_claves: kvCount, modulos_disponibles: modulos });
  } catch (x) { return J({ error: x.message }); }
}

async function erroresTardios(r, e) {
  const db = gDB(e, 'agente'), kvN = gKV(e, 'agente');
  const problemas = [];
  if (!db) return J({ error: 'Sin D1.' });
  try {
    try { const files = await kvN.list({ prefix: 'file:', limit: 500 }); if (files.keys.length > 50) problemas.push({ tipo: 'kv_huerfano', msg: files.keys.length + ' chunks.' }); } catch (x) {}
    try {
      const fecha = new Date().toISOString().split('T')[0];
      for (const area of ['chat','procesamiento','sandbox','publisher','vision']) {
        const c2 = await kvN.get('presupuesto:' + fecha + ':' + area);
        if (c2 && parseInt(c2) > 200) problemas.push({ tipo: 'presupuesto', msg: area + ': ' + c2 });
      }
    } catch (x) {}
    try {
      const atascados = await db.prepare("SELECT id FROM procesos WHERE estado='procesando' AND ? - fecha_inicio > 86400000").bind(Date.now()).all();
      for (const p of (atascados.results || [])) problemas.push({ tipo: 'proceso_atascado', msg: p.id });
    } catch (x) {}
    return J({ ok: true, total: problemas.length, problemas });
  } catch (x) { return J({ error: x.message }); }
}

async function codigoLeer(r, e) {
  try {
    const b = await r.json();
    const repo = repoDe(e, b.repo === 'frontend' ? 'frontend' : 'backend');
    if (!repo) return J({ error: 'Repo no configurado.' });
    if (!b.archivo) return J({ error: 'Falta archivo.' });
    const res = await githubLeerArchivo(e, repo, b.archivo, b.rama);
    if (res.error) return J({ error: res.error });
    return J({ ok: true, archivo: b.archivo, longitud: res.tamaño, contenido: res.contenido });
  } catch (x) { return J({ error: x.message }); }
}

async function codigoListar(r, e) {
  try {
    const b = await r.json();
    const repo = repoDe(e, b.repo === 'frontend' ? 'frontend' : 'backend');
    if (!repo) return J({ error: 'Repo no configurado.' });
    const res = await githubListarArchivos(e, repo, b.rama);
    if (res.error) return J({ error: res.error });
    return J({ ok: true, ...res });
  } catch (x) { return J({ error: x.message }); }
}

async function codigoEscribir(r, e) {
  try {
    const b = await r.json();
    const repo = repoDe(e, b.repo === 'frontend' ? 'frontend' : 'backend');
    if (!repo) return J({ error: 'Repo no configurado.' });
    if (!b.archivo || !b.contenido) return J({ error: 'Faltan archivo o contenido.' });
    const kvN = gKV(e, 'agente');
    if (kvN) {
      try {
        const actual = await githubLeerArchivo(e, repo, b.archivo, b.rama);
        if (actual.ok) await kvN.put(`snapshot_github:${b.archivo}:${Date.now()}`, actual.contenido, { expirationTtl: 30 * 86400 });
      } catch (x) {}
    }
    const res = await githubEscribirArchivo(e, repo, b.archivo, b.contenido, b.mensaje_commit || `Actualización de ${b.archivo}`, b.rama);
    if (res.error) return J({ error: res.error });
    return J({ ok: true, commit: res.commit, url: res.url });
  } catch (x) { return J({ error: x.message }); }
}

async function codigoProponer(r, e) {
  try {
    const b = await r.json();
    const db = gDB(e, 'agente');
    if (!db) return J({ error: 'D1 no disponible.' });
    const r1 = await db.prepare('INSERT INTO decisiones_autonomas(tipo,contexto,decision,simulacion,aplicada,resultado,fecha) VALUES(?,?,?,?,?,?,?)')
      .bind('propuesta_codigo', b.archivo || '', b.razon || '', (b.diff || '').substring(0, 4000), 0, 'pendiente_aprobacion', Date.now()).run();
    return J({ ok: true, id: r1.meta.last_row_id });
  } catch (x) { return J({ error: x.message }); }
}

async function listarHerramientas(r, e) {
  const categorias = {};
  for (const t of Object.values(TOOLS)) {
    if (!categorias[t.categoria]) categorias[t.categoria] = [];
    categorias[t.categoria].push({ nombre: t.nombre, tipo: t.tipo, descripcion: t.descripcion, requiere_aprobacion: t.requiere_aprobacion });
  }
  return J({ ok: true, total: Object.keys(TOOLS).length, categorias });
}

async function verAprobacionPendiente(r, e) {
  try {
    const u = new URL(r.url);
    const uid = u.searchParams.get('user_id') || 'comandante';
    const p = await leerAprobacionPendiente(e, uid);
    return J({ ok: true, pendiente: p || null });
  } catch (x) { return J({ error: x.message }); }
}

async function cancelarAprobacion(r, e) {
  try {
    const b = await r.json();
    const uid = b.user_id || 'comandante';
    await limpiarAprobacionPendiente(e, uid);
    return J({ ok: true, cancelada: true });
  } catch (x) { return J({ error: x.message }); }
}

async function diagnosticoVariables(r, e) {
  const kv = gKV(e, 'agente');
  let cacheRelacion = null, cacheRelacionFecha = null;
  try {
    cacheRelacion = await kv.get('relacion:cache');
    cacheRelacionFecha = await kv.get('relacion:cache_fecha');
  } catch (x) {}
  return J({
    timestamp: new Date().toISOString(),
    token_presente: !!e.GITHUB_TOKEN,
    token_longitud: e.GITHUB_TOKEN ? e.GITHUB_TOKEN.length : 0,
    repo_backend_presente: !!e.GITHUB_REPO_BACKEND,
    repo_backend_valor: e.GITHUB_REPO_BACKEND || null,
    repo_frontend_presente: !!e.GITHUB_REPO_FRONTEND,
    repo_frontend_valor: e.GITHUB_REPO_FRONTEND || null,
    branch_presente: !!e.GITHUB_BRANCH,
    branch_valor: e.GITHUB_BRANCH || null,
    todas_las_vars_github: Object.keys(e).filter(k => k.startsWith('GITHUB_')),
    cache_activo: true,
    modelo_ligero_actual: MODELO_LIGERO,
    modelo_chat: MODELO,
    ttls: { historial: TTL_HISTORIAL, contexto: TTL_CONTEXTO, resumenes: TTL_RESUMENES, correcciones: TTL_CORRECCIONES, estrategias: TTL_ESTRATEGIAS },
    cache_relacion_existe: !!cacheRelacion,
    cache_relacion_longitud: cacheRelacion ? cacheRelacion.length : 0,
    cache_relacion_fecha: cacheRelacionFecha || null
  });
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

    if (p === '/api/_diag' && r.method === 'GET') return diagnosticoVariables(r, e);
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
    if (p === '/api/estado') return J({ estado: 'activo', v: '16.0' });

    if (p === '/api/relacion/construir' && r.method === 'POST') {
      const uid = 'comandante';
      const r1 = await construirCacheRelacion(e, uid);
      return J(r1 || { error: 'No se pudo construir (historial insuficiente o IA no disponible).' });
    }
    if (p === '/api/relacion/leer' && r.method === 'GET') {
      const kv = gKV(e, 'agente');
      const cache = await kv.get('relacion:cache');
      const fecha = await kv.get('relacion:cache_fecha');
      return J({ existe: !!cache, longitud: cache ? cache.length : 0, fecha, contenido: cache || null });
    }

    if (p === '/api/uso_real' && r.method === 'GET') {
      const uso = await consultarUsoReal(e);
      return J(uso);
    }

    if (p === '/api/capacidades' && r.method === 'GET') {
      const uso = await consultarUsoReal(e);
      const db = gDB(e, 'agente');
      const kvN = gKV(e, 'agente');
      let procesosActivos = 0, totalMensajes = 0, totalTemas = 0, modoIndice = 'ninguno';
      if (db) {
        try { const p1 = await db.prepare("SELECT COUNT(*) as n FROM procesos WHERE estado IN ('procesando','pendiente')").first(); procesosActivos = p1 ? p1.n : 0; } catch (x) {}
        try { const p2 = await db.prepare('SELECT COUNT(*) as n FROM historial_largo').first(); totalMensajes = p2 ? p2.n : 0; } catch (x) {}
        try { const p3 = await db.prepare('SELECT COUNT(*) as n FROM indice_temas').first(); totalTemas = p3 ? p3.n : 0; } catch (x) {}
      }
      if (kvN) { try { modoIndice = await kvN.get('indice:ultimo_modo') || 'ninguno'; } catch (x) {} }
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
        ok: true, consulta_real: uso.ok, error_consulta: uso.error || null,
        fecha_consulta: new Date().toISOString(),
        limites_cloudflare: lim, procesos_activos: procesosActivos,
        mensajes_historial: totalMensajes, temas_indexados: totalTemas, modo_indice: modoIndice,
        cache_activo: true,
        ttls: { historial: TTL_HISTORIAL, contexto: TTL_CONTEXTO, resumenes: TTL_RESUMENES, correcciones: TTL_CORRECCIONES, estrategias: TTL_ESTRATEGIAS }
      });
    }

    if (p === '/api/actividad' && r.method === 'GET') {
      const db = gDB(e, 'agente');
      const kvN = gKV(e, 'agente');
      if (!db) return J({ error: 'Sin D1.' });
      const salida = { ok: true, estado: 'operando', etapa_actual: null, ultima_accion: null, ultimo_cron_hace: null, acciones: [] };
      try {
        const a = await db.prepare('SELECT tipo, descripcion, exito, detalle, fecha FROM acciones ORDER BY fecha DESC LIMIT 50').all();
        salida.acciones = a.results || [];
        if (salida.acciones.length) {
          salida.ultima_accion = salida.acciones[0].tipo;
          const hace = Math.round((Date.now() - salida.acciones[0].fecha) / 60000);
          salida.ultima_accion_hace = hace + ' min';
        }
      } catch (x) {}
      if (kvN) {
        try {
          const uu = await kvN.get('cron_autonomo_ultima');
          if (uu) {
            const hace = Math.round((Date.now() - parseInt(uu)) / 60000);
            salida.ultimo_cron_hace = hace + ' min';
          }
        } catch (x) {}
      }
      try {
        const sb = await opcional('sandbox');
        if (sb && sb.estadoActual) {
          salida.etapa_actual = await sb.estadoActual(e);
        } else {
          if (kvN) {
            const progreso = JSON.parse(await kvN.get('sandbox:progreso') || '{}');
            if (progreso.en_progreso && Object.keys(progreso.en_progreso).length) {
              const [id, info] = Object.entries(progreso.en_progreso)[0];
              salida.etapa_actual = { id, fase: 0, prioridad: 5, dia: info.dia_actual || 1, dias: info.dias_total || 1, descripcion: '', metrica: '', umbral: '' };
            }
          }
        }
      } catch (x) {}
      return J(salida);
    }

    if (p === '/api/ritmo' && r.method === 'GET') {
      const kvN = gKV(e, 'agente');
      if (!kvN) return J({ error: 'Sin KV.' });
      const ultima = await kvN.get('cron_autonomo_ultima');
      const intervalo = await kvN.get('cron_autonomo_intervalo') || '0';
      const razon = await kvN.get('cron_autonomo_razon') || 'sin datos';
      const hace = ultima ? Math.round((Date.now() - parseInt(ultima)) / 60000) : null;
      return J({
        ultima_ejecucion_hace_min: hace,
        intervalo_actual_min: Math.round(parseInt(intervalo) / 60000),
        razon,
        proxima_en_min: ultima && intervalo ? Math.max(0, Math.round((parseInt(intervalo) - (Date.now() - parseInt(ultima))) / 60000)) : null
      });
    }

    if (p === '/api/pulso' && r.method === 'POST') {
      try {
        const kvN = gKV(e, 'agente');
        if (kvN) await kvN.delete('cron_autonomo_ultima');
        await cronAutonomo(e);
        return J({ ok: true, mensaje: 'Pulso enviado. Cron ejecutado.' });
      } catch (x) { return J({ error: x.message }); }
    }

    if (p === '/api/perfil_base/construir' && r.method === 'POST') {
      const r1 = await construirPerfilBase(e);
      return J(r1);
    }

    if (p === '/api/perfil_base' && r.method === 'GET') {
      const kvN = gKV(e, 'agente');
      if (!kvN) return J({ error: 'Sin KV.' });
      const perfil = await kvN.get('perfil_base');
      const fecha = parseInt(await kvN.get('perfil_base_fecha') || '0');
      return J({ existe: !!perfil, longitud: perfil ? perfil.length : 0, fecha: fecha || null, perfil: perfil || null });
    }

    if (p === '/api/corregir' && r.method === 'POST') {
      const { correccion } = await r.json();
      const db = gDB(e, 'agente');
      await db.prepare('INSERT INTO correcciones_voz(contexto, correccion, fecha) VALUES(?,?,?)').bind('general', correccion, Date.now()).run();
      await invalidarCache(e, 'correcciones');
      return J({ ok: true, mensaje: 'Corrección guardada como capa. Núcleo intacto.' });
    }

    if (p === '/api/areas') return J({ total: Object.keys(AREAS).length, areas: AREAS });
    if (p === '/api/analizar' && r.method === 'POST') return analizarArchivo(r, e);

    if (p === '/api/modo' && r.method === 'POST') {
      const { autonomo } = await r.json();
      const kvN = gKV(e, 'agente');
      await kvN.put('modo_autonomo', autonomo ? 'true' : 'false');
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
      await invalidarCache(e, 'estrategias:');
      return J({ ok: true, id: r1.meta.last_row_id });
    }

    if (p.startsWith('/api/estrategias/') && r.method === 'DELETE') {
      const id = p.replace('/api/estrategias/', '');
      const db = gDB(e, 'agente');
      if (!db) return J({ error: 'D1 no configurado.' });
      try {
        await db.prepare('DELETE FROM estrategias WHERE id=?').bind(id).run();
        await invalidarCache(e, 'estrategias:');
        return J({ ok: true, eliminada: id });
      } catch (x) { return J({ error: x.message }); }
    }

    if (p === '/api/decisiones' && r.method === 'GET') {
      const db = gDB(e, 'agente');
      const r1 = await db.prepare('SELECT * FROM decisiones_autonomas ORDER BY fecha DESC LIMIT 50').all();
      return J({ total: r1.results.length, decisiones: r1.results });
    }

    if (p === '/api/conciencia' && r.method === 'POST') {
      const b = await r.json();
      const uid = b.user_id || 'comandante';
      const kvN = gKV(e, 'agente');
      if (kvN) {
        const clave = 'conciencia:' + uid;
        const actual = JSON.parse(await kvN.get(clave) || '[]');
        actual.unshift({ accion: b.accion, detalle: (b.detalle || '').substring(0, 300), pestana: b.pestana || 'chat', fecha: Date.now() });
        await kvN.put(clave, JSON.stringify(actual.slice(0, 30)), { expirationTtl: 86400 });
      }
      return J({ ok: true });
    }

    if (p === '/api/leer_conciencia' && r.method === 'GET') {
      const uu = new URL(r.url);
      const uid = uu.searchParams.get('user_id') || 'comandante';
      const kvN = gKV(e, 'agente');
      if (!kvN) return J({ conciencia: [] });
      const c2 = JSON.parse(await kvN.get('conciencia:' + uid) || '[]');
      return J({ total: c2.length, conciencia: c2 });
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
        try { const r2 = await db.prepare('SELECT * FROM metricas_diarias ORDER BY fecha DESC LIMIT 7').all(); recientes = r2.results || []; } catch (x) {}
        const ret = recientes.length ? { d1: recientes[0].retencion_d1 || 0, d7: recientes[0].retencion_d7 || 0, d30: 0 } : { d1: 0, d7: 0, d30: 0 };
        const escala = ut === 0 ? 0 : ut < 50 ? 1 : ut < 500 ? 2 : ut < 5000 ? 3 : 4;
        const resumen = ut === 0 ? 'Shadow Arise no está operativo aún.' : `Shadow Arise lleva ${ut} usuarios. ${up} pagando (${conv}%).`;
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
          metricas_recientes: recientes, resumen_ayanokoji: resumen
        });
      } catch (x) { return J({ error: x.message }); }
    }

    if (p === '/api/componentes' && r.method === 'GET') {
      return J({
        pestanas: ['chat','sandbox','estrategias','shadow','stats','actividad','decisiones','ideas','bandeja'],
        botones: ['subir','imagen','indexar','migrar','diagnostico','procesos','contexto','corregir','limpiar'],
        acciones_chat: ['enviar_mensaje','cargar_historial','corregir_voz','generar_imagen'],
        acciones_auto: ['indexar','migrar','analizar','encolar','publicar','simular_estrategia','ejecutar_etapa','test_500'],
        acciones_cron: ['pulso','ritmo'],
        version: '16.0',
        ttls_actuales: { historial: TTL_HISTORIAL, contexto: TTL_CONTEXTO, resumenes: TTL_RESUMENES, correcciones: TTL_CORRECCIONES, estrategias: TTL_ESTRATEGIAS }
      });
    }

    if (p === '/api/sandbox/etapa' && r.method === 'POST') {
      const m = await opcional('sandbox');
      if (!m) return J({ error: 'sandbox.js no instalado.' });
      const b = await r.json();
      if (!b.etapa_id) return J({ error: 'Falta etapa_id.' });
      return J(await m.ejecutarEtapa(e, b.etapa_id, b.dia || 1));
    }

    if (p === '/api/sandbox/test_500' && r.method === 'POST') {
      const m = await opcional('sandbox');
      if (!m) return J({ error: 'sandbox.js no instalado.' });
      const b = await r.json();
      return J(await m.test500Usuarios(e, b.dia || 1));
    }

    if (p === '/api/sandbox/simular_estrategia' && r.method === 'POST') {
      const m = await opcional('sandbox');
      if (!m) return J({ error: 'sandbox.js no instalado.' });
      const b = await r.json();
      if (!b.estrategia_id) return J({ error: 'Falta estrategia_id.' });
      return J(await m.simularEstrategia(e, b.estrategia_id));
    }

    if (p === '/api/sandbox/preparar' && r.method === 'POST') {
      const m = await opcional('sandbox');
      if (!m) return J({ error: 'sandbox.js no instalado.' });
      return J(await m.prepararShadowArise(e));
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

    if (p === '/api/sandbox' && r.method === 'GET') {
      const m = await opcional('sandbox');
      if (!m) return J({ escenarios: [], lecciones: [] });
      return m.verSandbox(r, e);
    }

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

    if (p === '/api/codigo/leer' && r.method === 'POST') return codigoLeer(r, e);
    if (p === '/api/codigo/listar' && r.method === 'POST') return codigoListar(r, e);
    if (p === '/api/codigo/escribir' && r.method === 'POST') return codigoEscribir(r, e);
    if (p === '/api/codigo/proponer' && r.method === 'POST') return codigoProponer(r, e);
    if (p === '/api/herramientas' && r.method === 'GET') return listarHerramientas(r, e);
    if (p === '/api/aprobacion/pendiente' && r.method === 'GET') return verAprobacionPendiente(r, e);
    if (p === '/api/aprobacion/cancelar' && r.method === 'POST') return cancelarAprobacion(r, e);

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
      try { await autoResumenPorInactividad(e); } catch (x) {}
      try {
        const kv = gKV(e, 'agente');
        const ultimaConstruccion = parseInt(await kv.get('relacion:cache_fecha') || '0');
        const horasDesde = (Date.now() - ultimaConstruccion) / 3600000;
        if (horasDesde > 24) {
          await construirCacheRelacion(e, 'comandante');
        }
      } catch (x) {}
      // SANDBOX — NUEVO: ahora sí se ejecuta
      const sb = await opcional('sandbox');
      if (sb && sb.cronSandbox) { try { await sb.cronSandbox(e); } catch (x) {} }
      // Auto-reparación
      const au2 = await opcional('autonomia');
      if (au2 && au2.cronAutoReparacion) { try { await au2.cronAutoReparacion(e); } catch (x) {} }
      // Publisher
      const pub = await opcional('publisher');
      if (pub && pub.cronPublicar) { try { await pub.cronPublicar(e); } catch (x) {} }
      // Cola de tareas e informe
      const au = await opcional('autonomia');
      if (au && au.cronColaTareas) { try { await au.cronColaTareas(e); } catch (x) {} }
      if (au && au.informeDiario) { try { await au.informeDiario(e); } catch (x) {} }
    })());
  }
};
