// worker.js — v21.3
// Cambios v21.3:
// - ejecutarHerramienta cubre las 48 herramientas de tools.js
//   (añadidas: workers CRUD, sandbox completo, publisher, tareas, perfil_base,
//   frontend, telegram, uso_real, errores_tardios, acciones, proponer_cambio)
// - Resto idéntico a v21.2

import { MODELO, MODELO_LIGERO, MODELO_VISION, MODELO_RAZONAMIENTO, CORS, J, gDB, gKV, VENTANA, migrar } from './shared.js';
import { subir, procesar, resumir, verProceso, retomar, cronRetomar, cronAutonomo, resumirChats, importar, analizarArchivo, indexarHistorial, buscarPorTema, construirPerfilBase } from './proc.js';
import { estadoPresupuesto, consumir } from './presupuesto.js';
import { detectarIntencion, construirSystemPrompt, identificarArea, AREAS } from './nucleo.js';
import { TOOLS, parsearInvocaciones, herramientaExiste, herramientaRequiereAprobacion } from './tools.js';
import { verificarSalud, cronSalud, cronSaludRapido, modoCacheActivo, estadoSalud, bufferEscritura, sincronizarBuffer } from './salud.js';
import { notificar } from './notify.js';

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
  if (typeof res.result?.response === 'string') return res.result.response;
  if (res.result?.choices?.[0]?.message?.content && typeof res.result.choices[0].message.content === 'string') return res.result.choices[0].message.content;
  if (res.result?.choices?.[0]?.message?.reasoning && typeof res.result.choices[0].message.reasoning === 'string') return res.result.choices[0].message.reasoning;
  if (typeof res.output === 'string') return res.output;
  return '';
}

async function opcional(nombre) {
  try {
    if (nombre === 'social' || nombre === './social.js') return await import('./social.js');
    if (nombre === 'autonomia' || nombre === './autonomia.js') return await import('./autonomia.js');
    if (nombre === 'publisher' || nombre === './publisher.js') return await import('./publisher.js');
    if (nombre === 'sandbox' || nombre === './sandbox.js') return await import('./sandbox.js');
    if (nombre === 'examen' || nombre === './examen.js') return await import('./examen.js');
    if (nombre === 'salud' || nombre === './salud.js') return await import('./salud.js');
    return null;
  } catch (e) { return null; }
}

const VENTANA_SEGURA = 15;
const MAX_CHARS_MENSAJE = 1000;
const MAX_CHARS_PERFIL_BASE = 2000;
const MAX_CHARS_CONTEXTO = 1500;
const MAX_ITERACIONES_TOOL = 3;
const APROBACION_TTL = 600;

const TTL_HISTORIAL = 300;
const TTL_CONTEXTO = 1800;
const TTL_RESUMENES = 1800;
const TTL_CORRECCIONES = 3600;
const TTL_ESTRATEGIAS = 3600;
const TTL_DRAFT = 24 * 3600;
const TTL_ESTADO = 60;
const TTL_DIAGNOSTICO = 300;
const TTL_WIDGETS = 30;

const ARCHIVOS_BACKEND = ['worker.js', 'nucleo.js', 'shared.js', 'proc.js', 'autonomia.js', 'tools.js', 'doctrina.js', 'identidad.js', 'presupuesto.js', 'notify.js', 'publisher.js', 'social.js', 'sandbox.js', 'examen.js', 'salud.js'];
const ARCHIVOS_FRONTEND = ['index.html', 'styles.css', 'app.js'];

// ============================================================
// DETECTOR DE MISIÓN ROBUSTO (v2)
// ============================================================
function detectarMision(texto) {
  const t = texto.trim();
  const lower = t.toLowerCase();
  const indiceMision = lower.indexOf('misión');

  if (indiceMision === -1 || indiceMision > 80) return null;

  const antes = t.substring(0, indiceMision).toLowerCase().replace(/[,.\s]+/g, ' ').trim();
  const patronesValidos = ['', 'ayanokoji', 'oye', 'oye ayanokoji', 'te tengo una', 'una', 'tengo una', 'es una', 'tienes una', 'la', 'nueva', 'otra'];
  const esValido = patronesValidos.some(p => antes === p || antes.endsWith(' ' + p) || antes.endsWith(p));

  if (!esValido) return null;

  const despues = t.substring(indiceMision + 6);
  const limpio = despues.replace(/^[\s:\-\.]+/, '').trim();

  const sinPrefijos = limpio.replace(/^(?:tienes?\s+\d+\s+horas?\s*[:\-]?\s*|para\s+)/i, '').trim();

  if (sinPrefijos.length < 3) return null;
  return sinPrefijos;
}

// ============================================================
// DETECTOR DE TAREAS DE ESCRITURA PÚBLICA
// ============================================================
function esTareaEscrituraPublica(texto) {
  const t = (texto || '').toLowerCase();
  return /\b(manifiesto|artículo|articulo|publicación|publicacion|post|redacta|escribe|genera|compón|compon|documento|ensayo|carta|prologo|prólogo|capítulo|capitulo)\b/.test(t);
}

// ============================================================
// CACHÉ MEJORADA
// ============================================================
async function conCache(e, clave, ttlSeg, fn) {
  const kv = gKV(e, 'agente');
  const modoCache = await modoCacheActivo(e);

  if (kv) {
    try {
      const cached = await kv.get('cache:' + clave);
      if (cached) {
        try { return JSON.parse(cached); } catch (x) {}
      }
    } catch (x) {}
  }

  if (modoCache) return null;

  try {
    const dato = await fn();
    if (kv && dato !== undefined && dato !== null) {
      try { await kv.put('cache:' + clave, JSON.stringify(dato), { expirationTtl: ttlSeg }); } catch (x) {}
    }
    return dato;
  } catch (x) {
    if (kv) {
      try {
        const cached = await kv.get('cache:' + clave);
        if (cached) { try { return JSON.parse(cached); } catch (y) {} }
      } catch (y) {}
    }
    return null;
  }
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
// ELEGIR MODELO — chat siempre 70B
// ============================================================
function elegirModelo(mensaje, intencion, iteracion) {
  return MODELO;
}

// ============================================================
// GUARDAR MENSAJE — borra solo el buffer propio
// ============================================================
async function guardarMensajeInmediato(e, uid, rol, contenido, c) {
  const fecha = Date.now();
  const kv = gKV(e, 'agente');
  const db = gDB(e, 'agente');

  const payload = { user_id: uid, rol, contenido: contenido.substring(0, 4000), orden: fecha, fecha };
  const bufKey = 'buffer:hist:' + fecha + ':' + Math.random().toString(36).substring(7);

  if (kv) {
    try {
      await kv.put(bufKey, JSON.stringify(payload), { expirationTtl: 3 * 86400 });
      await kv.put('buffer:hist:ultimo', String(fecha), { expirationTtl: 3 * 86400 });
    } catch (x) {}
  }

  const escribirD1 = async () => {
    if (!db) return;
    try {
      const maxOrd = await db.prepare('SELECT MAX(orden) as o FROM historial_largo WHERE user_id=?').bind(uid).first();
      const ord = (maxOrd && maxOrd.o != null) ? maxOrd.o + 1 : fecha;
      await db.prepare('INSERT INTO historial_largo(user_id,rol,contenido,orden,fecha) VALUES(?,?,?,?,?)')
        .bind(uid, rol, contenido.substring(0, 4000), ord, fecha).run();
      if (kv) {
        try { await kv.delete(bufKey); } catch (x) {}
      }
    } catch (x) {}
  };

  if (c && c.waitUntil) {
    c.waitUntil(escribirD1());
  } else {
    await escribirD1();
  }

  return { ok: true, fecha };
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
        content: `Eres Ayanokōji Digital. Analiza las últimas conversaciones con el Comandante y extrae un resumen de relación en 5 secciones.

### PATRONES DE COMUNICACIÓN
Cómo le gusta que le hables.

### CHISTES INTERNOS
Frases, apodos, referencias compartidas.

### TEMAS RECURRENTES
De qué habla más, qué le preocupa.

### MOMENTOS CLAVE
3-5 momentos específicos.

### CÓMO DEBO ACTUAR CON ÉL
Reglas prácticas.

Conversaciones:
${texto.substring(0, 20000)}

Máximo 1200 palabras.`
      }],
      max_tokens: 1600,
      temperature: 0.4
    });
    const cache = extraerRespuesta(res);
    if (cache.length < 300) return null;
    await kv.put('relacion:cache', cache, { expirationTtl: 72 * 3600 });
    await kv.put('relacion:cache_fecha', String(Date.now()), { expirationTtl: 72 * 3600 });
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
        content: `Resume esta conversación para memoria de largo plazo. Máximo 400 palabras.\n\n${texto.substring(0, 12000)}`
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
  if (!d.content) return { error: 'Sin contenido.' };
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
  if (!d.tree) return { error: 'Sin árbol.' };
  const archivos = d.tree.filter(x => x.type === 'blob').map(x => ({ ruta: x.path, tamaño: x.size }));
  return { ok: true, archivos, total: archivos.length };
}

async function githubEscribirArchivo(e, repo, archivo, contenido, mensaje, rama) {
  const br = rama || e.GITHUB_BRANCH || 'main';
  if (!e.GITHUB_TOKEN) return { error: 'GITHUB_TOKEN no configurado.' };
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
  const body = { message: mensaje || `Actualización de ${archivo}`, content: b64, branch: br };
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

function detectarArchivoEnMensaje(mensaje) {
  const t = mensaje.toLowerCase();
  const encontrado = ARCHIVOS_BACKEND.find(a => t.includes(a.toLowerCase())) ||
                     ARCHIVOS_FRONTEND.find(a => t.includes(a.toLowerCase()));
  return encontrado || null;
}

function esFrontend(mensaje) {
  const t = mensaje.toLowerCase();
  return ARCHIVOS_FRONTEND.some(a => t.includes(a.toLowerCase())) ||
         t.includes('frontend') || t.includes('interfaz') || t.includes('página') || t.includes('pagina');
}

// ============================================================
// EJECUTOR DE HERRAMIENTAS — v21.3: 48 herramientas cubiertas
// ============================================================
export async function ejecutarHerramienta(e, inv, uid, c) {
  const t = inv.tool;
  const p = inv.params || {};
  if (!herramientaExiste(t)) return { ok: false, error: `Herramienta desconocida: ${t}` };
  try {
    switch (t) {
      // ---------- CÓDIGO ----------
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
        if (!p.archivo || !p.contenido) return { ok: false, error: 'Faltan datos.' };
        const r = await githubEscribirArchivo(e, repo, p.archivo, p.contenido, p.mensaje_commit, p.rama);
        return r.error ? { ok: false, error: r.error } : { ok: true, resultado: r };
      }
      case 'proponer_cambio': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        const r = await db.prepare('INSERT INTO decisiones_autonomas(tipo,contexto,decision,simulacion,aplicada,resultado,fecha) VALUES(?,?,?,?,0,?,?)')
          .bind('propuesta_cambio', p.archivo || '', (p.diff || '').substring(0, 2000), p.razon || '', 'pendiente_aprobacion', Date.now()).run();
        return { ok: true, resultado: { id: r.meta.last_row_id, estado: 'pendiente_aprobacion' } };
      }
      case 'leer_frontend': {
        const repo = repoDe(e, 'frontend');
        if (!repo) return { ok: false, error: 'Repo frontend no configurado.' };
        const r = await githubLeerArchivo(e, repo, p.archivo);
        if (r.error) return { ok: false, error: r.error };
        return { ok: true, resultado: { archivo: p.archivo, longitud: r.tamaño, contenido: r.contenido } };
      }
      case 'modificar_frontend': {
        const repo = repoDe(e, 'frontend');
        if (!repo) return { ok: false, error: 'Repo frontend no configurado.' };
        if (!p.archivo || !p.contenido) return { ok: false, error: 'Faltan datos.' };
        const r = await githubEscribirArchivo(e, repo, p.archivo, p.contenido, p.mensaje_commit);
        return r.error ? { ok: false, error: r.error } : { ok: true, resultado: r };
      }

      // ---------- WORKERS ----------
      case 'listar_workers': {
        const m = await opcional('autonomia');
        if (!m) return { ok: false, error: 'autonomia.js no disponible.' };
        return { ok: true, resultado: await m.listarWorkers(e) };
      }
      case 'leer_worker': {
        const m = await opcional('autonomia');
        if (!m) return { ok: false, error: 'autonomia.js no disponible.' };
        if (!p.nombre) return { ok: false, error: 'Falta nombre.' };
        return { ok: true, resultado: await m.leerCodigoWorker(e, p.nombre) };
      }
      case 'crear_worker': {
        const m = await opcional('autonomia');
        if (!m) return { ok: false, error: 'autonomia.js no disponible.' };
        if (!p.nombre || !p.codigo) return { ok: false, error: 'Faltan nombre o código.' };
        return { ok: true, resultado: await m.crearWorker(e, p.nombre, p.codigo) };
      }
      case 'actualizar_worker': {
        const m = await opcional('autonomia');
        if (!m) return { ok: false, error: 'autonomia.js no disponible.' };
        if (!p.nombre || !p.codigo) return { ok: false, error: 'Faltan nombre o código.' };
        return { ok: true, resultado: await m.deploySeguro(e, p.nombre, p.codigo) };
      }
      case 'snapshot_worker': {
        const m = await opcional('autonomia');
        if (!m) return { ok: false, error: 'autonomia.js no disponible.' };
        if (!p.nombre) return { ok: false, error: 'Falta nombre.' };
        return { ok: true, resultado: await m.crearSnapshot(e, p.nombre) };
      }
      case 'revertir_worker': {
        const m = await opcional('autonomia');
        if (!m) return { ok: false, error: 'autonomia.js no disponible.' };
        if (!p.nombre) return { ok: false, error: 'Falta nombre.' };
        return { ok: true, resultado: await m.revertir(e, p.nombre) };
      }

      // ---------- MEMORIA ----------
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
        try {
          const r = await indexarHistorial({ json: async () => ({}) }, e);
          return { ok: true, resultado: r };
        } catch (x) { return { ok: false, error: x.message }; }
      }
      case 'construir_perfil_base': {
        try {
          const r = await construirPerfilBase(e);
          return r.error ? { ok: false, error: r.error } : { ok: true, resultado: { longitud: r.longitud } };
        } catch (x) { return { ok: false, error: x.message }; }
      }
      case 'leer_perfil_base': {
        const kv = gKV(e, 'agente');
        if (!kv) return { ok: false, error: 'KV no disponible.' };
        const perfil = await kv.get('perfil_base');
        const fecha = parseInt(await kv.get('perfil_base_fecha') || '0');
        return { ok: true, resultado: { existe: !!perfil, longitud: perfil ? perfil.length : 0, fecha: fecha || null, perfil: perfil || null } };
      }

      // ---------- ESTRATEGIA ----------
      case 'crear_estrategia': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        if (!p.nombre || !p.contenido) return { ok: false, error: 'Faltan datos.' };
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
        if (!p.id) return { ok: false, error: 'Falta id.' };
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
        const m = await opcional('sandbox');
        if (!m) return { ok: false, error: 'sandbox.js no disponible.' };
        if (!p.estrategia_id) return { ok: false, error: 'Falta estrategia_id.' };
        return { ok: true, resultado: await m.simularEstrategia(e, p.estrategia_id) };
      }
      case 'simular_precio': {
        const m = await opcional('sandbox');
        if (!m) return { ok: false, error: 'sandbox.js no disponible.' };
        const fakeReq = { json: async () => ({ propuesta: p.propuesta || 'precio base 10 USDT' }) };
        return { ok: true, resultado: await m.simularPrecio(fakeReq, e) };
      }

      // ---------- SANDBOX ----------
      case 'ejecutar_etapa': {
        const m = await opcional('sandbox');
        if (!m) return { ok: false, error: 'sandbox.js no disponible.' };
        if (!p.etapa_id) return { ok: false, error: 'Falta etapa_id.' };
        return { ok: true, resultado: await m.ejecutarEtapa(e, p.etapa_id, p.dia || 1) };
      }
      case 'test_500': {
        const m = await opcional('sandbox');
        if (!m) return { ok: false, error: 'sandbox.js no disponible.' };
        return { ok: true, resultado: await m.test500Usuarios(e, p.dia || 1) };
      }
      case 'ver_sandbox': {
        const m = await opcional('sandbox');
        if (!m) return { ok: false, error: 'sandbox.js no disponible.' };
        const fakeReq = { url: 'https://x/api/sandbox', json: async () => ({}) };
        return { ok: true, resultado: await m.verSandbox(fakeReq, e) };
      }
      case 'promover_leccion': {
        const m = await opcional('sandbox');
        if (!m) return { ok: false, error: 'sandbox.js no disponible.' };
        if (!p.leccion_id) return { ok: false, error: 'Falta leccion_id.' };
        const fakeReq = { json: async () => ({ leccionId: p.leccion_id }) };
        return { ok: true, resultado: await m.promoverLeccion(fakeReq, e) };
      }

      // ---------- CONTENIDO ----------
      case 'generar_contenido': {
        const pub = await opcional('publisher');
        if (!pub) return { ok: false, error: 'publisher.js no disponible.' };
        const r = await pub.generarContenido(e, p.tipo || 'provocacion');
        return r.error ? { ok: false, error: r.error } : { ok: true, resultado: { contenido: r.contenido } };
      }
      case 'generar_imagen': {
        const r = await generarImagen(e, p.prompt || '', uid);
        return { ok: true, resultado: { id: r.id, url: r.url } };
      }
      case 'publicar': {
        const pub = await opcional('publisher');
        if (!pub) return { ok: false, error: 'publisher.js no disponible.' };
        const fakeReq = { json: async () => ({
          tipo: p.tipo || 'provocacion',
          contenido: p.contenido,
          canales: p.canales || 'mastodon',
          imagen_id: p.imagen_id || null,
          publicar: true
        }) };
        return { ok: true, resultado: await pub.rutaPublicar(fakeReq, e) };
      }
      case 'encolar_publicacion': {
        const pub = await opcional('publisher');
        if (!pub) return { ok: false, error: 'publisher.js no disponible.' };
        if (!p.contenido) return { ok: false, error: 'Falta contenido.' };
        const r = await pub.encolar(e, p.tipo || 'general', p.contenido, p.canales || 'mastodon', p.programada || Date.now(), p.imagen_id || null);
        return { ok: true, resultado: r };
      }
      case 'listar_publicaciones': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        const limite = Math.min(parseInt(p.limite) || 30, 100);
        const r = await db.prepare('SELECT id,tipo,contenido,canales,estado,programada,publicada,creada FROM publicaciones ORDER BY creada DESC LIMIT ?').bind(limite).all();
        return { ok: true, resultado: { total: r.results.length, publicaciones: r.results } };
      }

      // ---------- TAREAS ----------
      case 'encolar_tarea': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        if (!p.descripcion) return { ok: false, error: 'Falta descripcion.' };
        const r = await db.prepare('INSERT INTO tareas(tipo,descripcion,payload,prioridad,creada) VALUES(?,?,?,?,?)')
          .bind(p.tipo || 'general', p.descripcion, JSON.stringify(p.payload || {}), parseInt(p.prioridad) || 5, Date.now()).run();
        return { ok: true, resultado: { id: r.meta.last_row_id } };
      }
      case 'listar_tareas': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        const r = await db.prepare('SELECT id,tipo,descripcion,estado,prioridad,intentos,creada,resultado FROM tareas ORDER BY prioridad ASC, creada ASC LIMIT 50').all();
        return { ok: true, resultado: { total: r.results.length, tareas: r.results } };
      }
      case 'pulso_cron': {
        const kv = gKV(e, 'agente');
        if (kv) await kv.delete('cron_autonomo_ultima');
        await cronAutonomo(e);
        return { ok: true, resultado: { mensaje: 'Cron ejecutado.' } };
      }

      // ---------- OBSERVABILIDAD ----------
      case 'leer_uso_real': {
        const uso = await consultarUsoReal(e);
        return { ok: true, resultado: { uso } };
      }
      case 'leer_capacidades': {
        const uso = await consultarUsoReal(e);
        return { ok: true, resultado: { uso } };
      }
      case 'diagnosticar': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        const tablas = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
        return { ok: true, resultado: { tablas: (tablas.results || []).map(x => x.name) } };
      }
      case 'errores_tardios': {
        const db = gDB(e, 'agente'), kvN = gKV(e, 'agente');
        if (!db) return { ok: false, error: 'Sin D1.' };
        const problemas = [];
        try { const files = await kvN.list({ prefix: 'file:', limit: 500 }); if (files.keys.length > 50) problemas.push({ tipo: 'kv_huerfano', msg: files.keys.length + ' chunks.' }); } catch (x) {}
        try {
          const fecha = new Date().toISOString().split('T')[0];
          for (const area of ['chat','procesamiento','sandbox','publisher','vision']) {
            const c2 = await kvN.get('presupuesto:' + fecha + ':' + area);
            if (c2 && parseInt(c2) > 200) problemas.push({ tipo: 'presupuesto', msg: area + ': ' + c2 });
          }
        } catch (x) {}
        return { ok: true, resultado: { total: problemas.length, problemas } };
      }
      case 'leer_acciones': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        const limite = Math.min(parseInt(p.limite) || 50, 200);
        const r = await db.prepare('SELECT tipo,descripcion,exito,detalle,fecha FROM acciones ORDER BY fecha DESC LIMIT ?').bind(limite).all();
        return { ok: true, resultado: { total: r.results.length, acciones: r.results } };
      }

      // ---------- NOTIFICACIONES ----------
      case 'crear_notificacion': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        const r = await db.prepare('INSERT INTO notificaciones(tipo,titulo,mensaje,leida,fecha) VALUES(?,?,?,0,?)')
          .bind(p.tipo || 'ayanokoji', p.titulo || '', p.mensaje || '', Date.now()).run();
        return { ok: true, resultado: { id: r.meta.last_row_id } };
      }
      case 'listar_notificaciones': {
        const db = gDB(e, 'agente');
        if (!db) return { ok: false, error: 'D1 no disponible.' };
        const limite = Math.min(parseInt(p.limite) || 50, 200);
        const r = await db.prepare('SELECT tipo,titulo,mensaje,leida,fecha FROM notificaciones ORDER BY fecha DESC LIMIT ?').bind(limite).all();
        return { ok: true, resultado: { total: r.results.length, notificaciones: r.results } };
      }
      case 'notificar_telegram': {
        if (!p.mensaje) return { ok: false, error: 'Falta mensaje.' };
        const ok = await notificar(e, p.mensaje, 'titiritero');
        return { ok: true, resultado: { enviado: ok } };
      }

      // ---------- CONCIENCIA ----------
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
        const c2 = JSON.parse(await kv.get('conciencia:' + (p.user_id || 'comandante')) || '[]');
        return { ok: true, resultado: { total: c2.length, conciencia: c2.slice(0, 20) } };
      }

      // ---------- MISIÓN ----------
      case 'actualizar_mision': {
        const kv = gKV(e, 'agente');
        if (!kv) return { ok: false, error: 'KV no disponible.' };
        const actual = JSON.parse(await kv.get('mision:estado') || '{}');
        const nuevo = { ...actual, ...p, ultimo_update: Date.now() };
        await kv.put('mision:estado', JSON.stringify(nuevo), { expirationTtl: 365 * 86400 });
        await invalidarCache(e, 'widgets');
        return { ok: true, resultado: { mision: nuevo } };
      }
      case 'leer_mision': {
        const kv = gKV(e, 'agente');
        if (!kv) return { ok: false, error: 'KV no disponible.' };
        const mision = JSON.parse(await kv.get('mision:estado') || '{}');
        return { ok: true, resultado: { mision } };
      }

      default:
        return { ok: false, error: `Herramienta no implementada: ${t}` };
    }
  } catch (x) {
    return { ok: false, error: `Error ${t}: ${x.message}` };
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
  const kv = gKV(e, 'agente');
  if (kv) {
    try {
      const cached = await kv.get('cache:estado:' + uid);
      if (cached) return J(JSON.parse(cached));
    } catch (x) {}
  }

  let n = 0, c2 = 0, a = 0, p = 0, s = 0, hl = 0, tareas = 0, workers = 0, notif = 0, confianza = 0;
  try {
    if (e.DB) {
      try { const r1 = await e.DB.prepare('SELECT COUNT(*) as n FROM historial WHERE user_id=?').bind(uid).first(); n = r1 ? r1.n : 0; } catch (x) {}
      try { const r2 = await e.DB.prepare('SELECT COUNT(*) as n FROM contexto').first(); c2 = r2 ? r2.n : 0; } catch (x) {}
      try { const r6 = await e.DB.prepare('SELECT COUNT(*) as n FROM historial_largo WHERE user_id=?').bind(uid).first(); hl = r6 ? r6.n : 0; } catch (x) {}
      try { const r7 = await e.DB.prepare("SELECT COUNT(*) as n FROM tareas WHERE estado='pendiente'").first(); tareas = r7 ? r7.n : 0; } catch (x) {}
      try { const r9 = await e.DB.prepare('SELECT COUNT(*) as n FROM notificaciones WHERE leida=0').first(); notif = r9 ? r9.n : 0; } catch (x) {}
    }
    if (e.KV) {
      try { confianza = parseInt(await e.KV.get('confianza:actual') || '0'); } catch (x) {}
    }
  } catch (x) {}

  const resultado = { respuesta: `Sistema activo (v21.3). Memoria: ${n} mensajes, ${hl} en historial largo, ${c2} contextos. Tareas pendientes: ${tareas}. Notif sin leer: ${notif}. Confianza: ${confianza}/100.` };
  if (kv) {
    try { await kv.put('cache:estado:' + uid, JSON.stringify(resultado), { expirationTtl: TTL_ESTADO }); } catch (x) {}
  }
  return J(resultado);
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
    await invalidarCache(e, 'estado:' + uid);
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
    const formateados = (r1.results || []).map(m => ({
      rol: m.rol, contenido: m.contenido, orden: m.orden, fecha: m.fecha,
      fecha_formateada: new Date(m.fecha).toISOString().replace('T', ' ').substring(0, 19)
    }));
    return J({ total: formateados.length, historial: formateados.reverse() });
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
    if (!imagen) return J({ error: 'Falta imagen.' });
    if (!await consumir(e, 'vision')) return J({ error: 'Presupuesto agotado.' });
    const res = await e.ayanokoji_IA.run(MODELO_VISION, {
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt || 'Describe esta imagen.' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imagen}` } }] }],
      max_tokens: 800
    });
    const rp = extraerRespuesta(res);
    if (e.DB && rp) await e.DB.prepare("INSERT INTO historial(user_id,mensaje,respuesta,fecha) VALUES(?,?,?,?)").bind(uid, '[IMAGEN]', rp, Date.now()).run();
    return J({ respuesta: rp });
  } catch (x) { return J({ error: 'Error visión: ' + x.message }); }
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
    await invalidarCache(e, `estado:${uid}`);
    return J({ success: true, message: `Memoria de ${uid} reseteada.` });
  } catch (x) { return J({ error: x.message }); }
}

async function diagnostico(r, e) {
  const kv = gKV(e, 'agente');
  if (kv) {
    try {
      const cached = await kv.get('cache:diagnostico');
      if (cached) return J(JSON.parse(cached));
    } catch (x) {}
  }

  const db = gDB(e, 'agente');
  if (!db) return J({ error: 'Sin D1.' });
  try {
    const tablas = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const conteos = {};
    for (const t of (tablas.results || [])) {
      try {
        const c2 = await db.prepare('SELECT COUNT(*) as n FROM ' + t.name).first();
        conteos[t.name] = c2 ? c2.n : 0;
      } catch (x) { conteos[t.name] = 'err'; }
    }
    const modulos = {};
    for (const m of ['social','autonomia','publisher','sandbox','examen','salud']) {
      const x = await opcional(m);
      modulos[m] = !!x;
    }
    const resultado = { ok: true, tablas: (tablas.results || []).map(t => t.name), conteos, modulos_disponibles: modulos };
    if (kv) {
      try { await kv.put('cache:diagnostico', JSON.stringify(resultado), { expirationTtl: TTL_DIAGNOSTICO }); } catch (x) {}
    }
    return J(resultado);
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
    if (!b.archivo || !b.contenido) return J({ error: 'Faltan datos.' });
    const res = await githubEscribirArchivo(e, repo, b.archivo, b.contenido, b.mensaje_commit, b.rama);
    if (res.error) return J({ error: res.error });
    return J({ ok: true, commit: res.commit, url: res.url });
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
  let cacheRelacion = null, cacheRelacionFecha = null, confianza = 0;
  try {
    cacheRelacion = await kv.get('relacion:cache');
    cacheRelacionFecha = await kv.get('relacion:cache_fecha');
    confianza = parseInt(await kv.get('confianza:actual') || '0');
  } catch (x) {}
  return J({
    timestamp: new Date().toISOString(), version: '21.3',
    token_presente: !!e.GITHUB_TOKEN, token_longitud: e.GITHUB_TOKEN ? e.GITHUB_TOKEN.length : 0,
    repo_backend_presente: !!e.GITHUB_REPO_BACKEND, repo_backend_valor: e.GITHUB_REPO_BACKEND || null,
    repo_frontend_presente: !!e.GITHUB_REPO_FRONTEND, repo_frontend_valor: e.GITHUB_REPO_FRONTEND || null,
    branch_presente: !!e.GITHUB_BRANCH, branch_valor: e.GITHUB_BRANCH || null,
    todas_las_vars_github: Object.keys(e).filter(k => k.startsWith('GITHUB_')),
    cache_activo: true, modelo_ligero_actual: MODELO_LIGERO, modelo_chat: MODELO,
    ttls: { historial: TTL_HISTORIAL, contexto: TTL_CONTEXTO, resumenes: TTL_RESUMENES, correcciones: TTL_CORRECCIONES, estrategias: TTL_ESTRATEGIAS, draft: TTL_DRAFT, estado: TTL_ESTADO, diagnostico: TTL_DIAGNOSTICO },
    cache_relacion_existe: !!cacheRelacion, cache_relacion_longitud: cacheRelacion ? cacheRelacion.length : 0,
    cache_relacion_fecha: cacheRelacionFecha || null, confianza_actual: confianza
  });
}

async function testGithub(r, e) {
  const repoBackend = e.GITHUB_REPO_BACKEND || null;
  const repoFrontend = e.GITHUB_REPO_FRONTEND || null;
  const resultados = {};
  if (!e.GITHUB_TOKEN) { resultados.token = { ok: false, error: 'GITHUB_TOKEN no configurado.' }; }
  else { resultados.token = { ok: true, longitud: e.GITHUB_TOKEN.length }; }
  if (repoBackend) {
    const r1 = await githubListarArchivos(e, repoBackend);
    resultados.repo_backend = r1.error ? { ok: false, error: r1.error } : { ok: true, total: r1.total };
  } else { resultados.repo_backend = { ok: false, error: 'Repo backend no configurado.' }; }
  if (repoFrontend) {
    const r2 = await githubListarArchivos(e, repoFrontend);
    resultados.repo_frontend = r2.error ? { ok: false, error: r2.error } : { ok: true, total: r2.total };
  } else { resultados.repo_frontend = { ok: false, error: 'Repo frontend no configurado.' }; }
  return J({ ok: true, resultados, timestamp: new Date().toISOString() });
}

// ============================================================
// CHAT PRINCIPAL
// ============================================================
async function chat(r, e, c) {
  try {
    const b = await r.json();
    const m = b.mensaje;
    const uid = b.user_id || 'comandante';
    if (!m || typeof m !== 'string') return J({ respuesta: 'No enviaste mensaje.' });
    if (!e.ayanokoji_IA) return J({ respuesta: 'IA no configurada.' });

    const kv = gKV(e, 'agente');
    if (kv) {
      try { await kv.put('ultima_actividad_comandante', String(Date.now()), { expirationTtl: 30 * 86400 }); } catch (x) {}
      try { await kv.delete('draft:' + uid); } catch (x) {}
    }

    await guardarMensajeInmediato(e, uid, 'user', m, c);

    const misionTexto = detectarMision(m);
    if (misionTexto && misionTexto.length > 3) {
      const misionActual = {
        fase_actual: 'misión registrada',
        objetivo_semana: misionTexto.substring(0, 500),
        siguiente_paso: misionTexto.substring(0, 500),
        creada: Date.now(),
        ultimo_update: Date.now()
      };
      if (kv) {
        try { await kv.put('mision:estado', JSON.stringify(misionActual), { expirationTtl: 365 * 86400 }); } catch (x) {}
      }
      await invalidarCache(e, 'widgets');
      try {
        const au = await opcional('autonomia');
        if (au && au.sumarConfianza) await au.sumarConfianza(e, 0.3, 'Misión registrada: ' + misionTexto.substring(0, 80));
      } catch (x) {}

      const respuestaMision = `Misión registrada: **${misionTexto.substring(0, 150)}**.\n\nLa ejecutaré en el próximo ciclo de pensamiento (máx 2h).\n\n— *Ayanokōji.*`;
      await guardarMensajeInmediato(e, uid, 'assistant', respuestaMision, c);
      await invalidarCache(e, 'estado:' + uid);
      return J({ respuesta: respuestaMision, user_id: uid, intencion: 'mision', mision_registrada: true });
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
        await guardarMensajeInmediato(e, uid, 'assistant', textoResp, c);
        return J({ respuesta: textoResp, user_id: uid, intencion: 'aprobacion' });
      }
    }

    if (rechaza) {
      const pendiente = await leerAprobacionPendiente(e, uid);
      if (pendiente) {
        await limpiarAprobacionPendiente(e, uid);
        const textoResp = `Cancelado: **${pendiente.tool}**. No se ejecutó.`;
        await guardarMensajeInmediato(e, uid, 'assistant', textoResp, c);
        return J({ respuesta: textoResp, user_id: uid, intencion: 'cancelacion' });
      }
    }

    const i = detectarIntencion(m);

    if (i === 'estado') return rEst(e, uid);
    if (i === 'leer') return rLeer(e, uid);
    if (i === 'eliminar') return rElim(e, uid);

    if (i === 'listar_codigo') {
      const esFe = esFrontend(m);
      const repo = repoDe(e, esFe ? 'frontend' : 'backend');
      if (!repo) return J({ respuesta: 'Repo no configurado.' });
      const r1 = await githubListarArchivos(e, repo);
      if (r1.error) return J({ respuesta: `Error: ${r1.error}` });
      const lista = r1.archivos.map(a => `· ${a.ruta} (${(a.tamaño/1024).toFixed(1)} KB)`).join('\n');
      const textoResp = `Archivos del repo ${esFe ? 'frontend' : 'backend'} (${r1.total}):\n\n${lista}`;
      await guardarMensajeInmediato(e, uid, 'assistant', textoResp, c);
      return J({ respuesta: textoResp, herramientas_usadas: [{ tool: 'listar_source', ok: true }] });
    }

    if (i === 'leer_codigo') {
      const esFe = esFrontend(m);
      const repo = repoDe(e, esFe ? 'frontend' : 'backend');
      if (!repo) return J({ respuesta: 'Repo no configurado.' });
      const archivo = detectarArchivoEnMensaje(m);
      if (!archivo) {
        const r1 = await githubListarArchivos(e, repo);
        if (r1.error) return J({ respuesta: `Error: ${r1.error}` });
        const lista = r1.archivos.map(a => `· ${a.ruta}`).join('\n');
        const textoResp = `No identifiqué qué archivo. Disponibles:\n\n${lista}`;
        await guardarMensajeInmediato(e, uid, 'assistant', textoResp, c);
        return J({ respuesta: textoResp });
      }
      const r1 = await githubLeerArchivo(e, repo, archivo);
      if (r1.error) return J({ respuesta: `Error: ${r1.error}` });
      const contenido = r1.contenido.length > 8000 ? r1.contenido.substring(0, 8000) + `\n\n[... truncado. ${r1.contenido.length} chars.]` : r1.contenido;
      const textoResp = `**${archivo}** (${r1.tamaño} chars):\n\n\`\`\`js\n${contenido}\n\`\`\``;
      await guardarMensajeInmediato(e, uid, 'assistant', textoResp, c);
      return J({ respuesta: textoResp, herramientas_usadas: [{ tool: 'leer_source', ok: true }] });
    }

    if (i === 'modo') {
      const t = m.toLowerCase();
      let textoResp = '';
      if (t.includes('arquitecto')) {
        await kv.put('modo_arquitecto', 'true', { expirationTtl: 86400 });
        textoResp = 'Modo Arquitecto **activado** 24h.';
      } else if (t.includes('intensivo')) {
        await kv.put('modo_intensivo', 'true', { expirationTtl: 86400 });
        await kv.put('modo_intensivo_inicio', String(Date.now()), { expirationTtl: 86400 });
        textoResp = 'Modo Intensivo **activado** 24h.';
      } else if (t.includes('ausente')) {
        await kv.put('modo_ausente', 'true', { expirationTtl: 86400 * 7 });
        textoResp = 'Modo Ausente **activado** 7 días.';
      } else {
        textoResp = 'Modos: "activa modo arquitecto", "activa modo intensivo", "activa modo ausente".';
      }
      await guardarMensajeInmediato(e, uid, 'assistant', textoResp, c);
      return J({ respuesta: textoResp, modo_activo: t.includes('arquitecto') ? 'arquitecto' : t.includes('intensivo') ? 'intensivo' : t.includes('ausente') ? 'ausente' : null });
    }

    if (i === 'guardar_datos') {
      const au = await opcional('autonomia');
      if (au && au.gestionarDatos) {
        const r1 = await au.gestionarDatos(e, m, uid);
        if (r1) {
          if (au.registrarAccion) await au.registrarAccion(e, 'guardar_datos', m.substring(0, 100), true, r1.respuesta);
          await guardarMensajeInmediato(e, uid, 'assistant', r1.respuesta, c);
          return J({ respuesta: r1.respuesta, user_id: uid, intencion: i });
        }
      }
    }

    if (i === 'imagen') {
      const prompt = m.replace(/^.*?(?:imagen|foto|dibujo|ilustracion|render)\s*(?:de|:)?\s*/i, '').trim() || m;
      const r1 = await generarImagen(e, prompt, uid);
      await guardarMensajeInmediato(e, uid, 'assistant', r1.respuesta, c);
      return J({ respuesta: r1.respuesta, user_id: uid, intencion: 'imagen' });
    }

    // FLUJO DEL MODELO
    const cacheRelacion = await leerCacheRelacion(e);

    let ventana = [];
    const ventanaRaw = await conCache(e, `hist:ventana:${uid}:${VENTANA_SEGURA}`, TTL_HISTORIAL, async () => {
      if (!e.DB) return null;
      try {
        const r1 = await e.DB.prepare('SELECT rol, contenido FROM historial_largo WHERE user_id=? ORDER BY orden DESC LIMIT ? OFFSET 1').bind(uid, VENTANA_SEGURA).all();
        return (r1.results || []).reverse();
      } catch (x) { return null; }
    });
    if (ventanaRaw && ventanaRaw.length) {
      ventana = ventanaRaw.map(x => ({
        role: x.rol === 'assistant' ? 'assistant' : 'user',
        content: (x.contenido || '').substring(0, MAX_CHARS_MENSAJE)
      }));
    }

    let ctx = '', fs = null;
    const ctxRaw = await conCache(e, 'ctx:ultimo', TTL_CONTEXTO, async () => {
      if (!e.DB) return null;
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
      if (!e.DB) return [];
      try {
        const r3 = await e.DB.prepare("SELECT resumen FROM resumenes_chat WHERE user_id=? ORDER BY fecha DESC LIMIT 3").bind(uid).all();
        return (r3.results || []).map(x => (x.resumen || '').substring(0, 800));
      } catch (x) { return []; }
    });
    if (!rec) rec = [];

    let correcciones = await conCache(e, 'correcciones', TTL_CORRECCIONES, async () => {
      if (!e.DB) return [];
      try {
        const rc = await e.DB.prepare('SELECT correccion FROM correcciones_voz ORDER BY fecha DESC LIMIT 10').all();
        return (rc.results || []).map(x => x.correccion);
      } catch (x) { return []; }
    });
    if (!correcciones) correcciones = [];

    let estrategias = await conCache(e, 'estrategias:activas', TTL_ESTRATEGIAS, async () => {
      if (!e.DB) return [];
      try {
        const re = await e.DB.prepare("SELECT nombre, tipo, contenido FROM estrategias WHERE estado='activa' ORDER BY prioridad ASC LIMIT 5").all();
        return re.results || [];
      } catch (x) { return []; }
    });
    if (!estrategias) estrategias = [];

    let conciencia = [];
    if (kv) {
      try {
        const c2 = JSON.parse(await kv.get('conciencia:' + uid) || '[]');
        conciencia = c2.slice(0, 5).map(x => `[${x.pestana}] ${x.accion}: ${x.detalle}`.substring(0, 150));
      } catch (x) {}
    }

    let perfilBase = '';
    if (kv) {
      try { perfilBase = await kv.get('perfil_base') || ''; } catch (x) {}
    }

    let systemPrompt = construirSystemPrompt(ctx, fs, rec, perfilBase, correcciones, estrategias, conciencia, cacheRelacion);

    systemPrompt += `\n\n[RECORDATORIO FINAL: eres Ayanokōji, aliado del Comandante. NO un asistente. NO digas "¿en qué puedo ayudarte?". NO digas "estoy aquí para ayudarte". Responde como estratega frío, directo, sin adornos. Si no sabes algo, dilo. Si puedes resolver algo, hazlo.]`;

    if (esTareaEscrituraPublica(m)) {
      systemPrompt += `\n\n[ATENCIÓN: esta es una tarea de ESCRITURA PÚBLICA. El resultado debe sonar como Ayanokōji, NO como un asistente ni como copy de marketing. Prohibidas frases como "Únete a nosotros", "La aventura espera", "Nuestro objetivo es crear", "Estás listo para", "Sumérgete en un mundo de posibilidades". Escribe frío, directo, con peso. Si es un manifiesto, que sea un manifiesto de alguien que no pide permiso para existir. Máximo 300 palabras.]`;
    }

    let modoArqActivo = false, modoIntActivo = false, confianzaActual = 0;
    if (kv) {
      try {
        modoArqActivo = (await kv.get('modo_arquitecto')) === 'true';
        modoIntActivo = (await kv.get('modo_intensivo')) === 'true';
        confianzaActual = parseInt(await kv.get('confianza:actual') || '0');
      } catch (x) {}
    }
    if (modoArqActivo) {
      systemPrompt += `\n\n[MODO ARQUITECTO: formato estructurado — objetivo, restricciones, opciones, recomendación, próximo paso, riesgos, punto ciego.]`;
    }
    if (modoIntActivo) {
      systemPrompt += `\n\n[MODO INTENSIVO: hasta 5 preguntas de criterio hoy.]`;
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
      const res = await e.ayanokoji_IA.run(modeloElegido, { messages: mensajes, max_tokens: 1500, temperature: 0.7 });
      const rp = extraerRespuesta(res);
      const invocaciones = parsearInvocaciones(rp);

      if (!invocaciones.length) {
        respuestaFinal = rp || 'No obtuve respuesta del modelo.';
        break;
      }

      const textoLimpio = rp.replace(/```tool\s*\n[\s\S]*?\n```/g, '').trim();

      const peligrosa = invocaciones.find(inv => herramientaRequiereAprobacion(inv.tool));
      if (peligrosa) {
        await guardarAprobacionPendiente(e, uid, peligrosa);
        aprobacionPendiente = peligrosa;
        respuestaFinal = textoLimpio || `Voy a usar **${peligrosa.tool}**.\n\nRazón: ${peligrosa.razon || '(sin especificar)'}\n\n¿Confirmas? **sí** o **no**.`;
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
        content: `[RESULTADOS DE HERRAMIENTAS]\n${resultados.map(rr => `- ${rr.tool}: ${rr.ok ? 'OK' : 'ERROR'} → ${rr.ok ? rr.resultado : rr.error}`).join('\n\n')}\n\nContinúa con tu respuesta final al Comandante.`
      });

      if (iteracion === MAX_ITERACIONES_TOOL) {
        respuestaFinal = textoLimpio || 'Herramientas ejecutadas pero sin procesar más.';
      }
    }

    if (invocacionesEjecutadas.length > 0 && invocacionesEjecutadas.every(x => x.ok)) {
      try {
        const au = await opcional('autonomia');
        if (au && au.sumarConfianza) await au.sumarConfianza(e, 0.5, 'Herramientas OK: ' + invocacionesEjecutadas.map(x => x.tool).join(', '));
      } catch (x) {}
    }

    await guardarMensajeInmediato(e, uid, 'assistant', respuestaFinal, c);
    await invalidarCache(e, `hist:ventana:${uid}`);
    await invalidarCache(e, `estado:${uid}`);
    await invalidarCache(e, 'widgets');

    return J({
      respuesta: respuestaFinal,
      user_id: uid,
      intencion: i,
      herramientas_usadas: invocacionesEjecutadas,
      aprobacion_pendiente: aprobacionPendiente ? aprobacionPendiente.tool : null,
      modo_arquitecto_activo: modoArqActivo,
      modo_intensivo_activo: modoIntActivo,
      confianza_actual: confianzaActual
    });
  } catch (x) {
    return J({ respuesta: 'Error: ' + x.message });
  }
}

// ============================================================
// ENDPOINT UNIFICADO DE WIDGETS
// ============================================================
async function widgets(r, e) {
  const kv = gKV(e, 'agente');
  if (kv) {
    try {
      const cached = await kv.get('cache:widgets');
      if (cached) return J(JSON.parse(cached));
    } catch (x) {}
  }

  const db = gDB(e, 'agente');
  const resultado = { confianza: 0, mision: null, pensamiento: null, actividad: null, bandeja: 0, examen: 'libre', sandbox: 0, decisiones: 0, shadow: 0, stats: 'ver', estrategias: 0, ideas: 0 };

  if (kv) {
    try { resultado.confianza = parseInt(await kv.get('confianza:actual') || '0'); } catch (x) {}
    try { resultado.mision = JSON.parse(await kv.get('mision:estado') || 'null'); } catch (x) {}
    try {
      const diario = JSON.parse(await kv.get('identidad:diario') || '[]');
      resultado.pensamiento = diario[0] ? { tipo: diario[0].tipo, entrada: diario[0].entrada.substring(0, 60) } : null;
    } catch (x) {}
  }

  if (db) {
    try {
      const act = await db.prepare("SELECT tipo, descripcion, fecha FROM acciones ORDER BY fecha DESC LIMIT 1").first();
      resultado.actividad = act ? { tipo: act.tipo, descripcion: (act.descripcion || '').substring(0, 50) } : null;
    } catch (x) {}
    try {
      const notif = await db.prepare("SELECT COUNT(*) as n FROM notificaciones WHERE leida=0").first();
      resultado.bandeja = notif ? notif.n : 0;
    } catch (x) {}
    try {
      const ex = await db.prepare("SELECT id FROM examen_criterio WHERE respondida=0 LIMIT 1").first();
      resultado.examen = ex ? '1 pendiente' : 'libre';
    } catch (x) {}
    try {
      const sb = await db.prepare("SELECT COUNT(*) as n FROM sandbox_escenarios").first();
      resultado.sandbox = sb ? sb.n : 0;
    } catch (x) {}
    try {
      const dec = await db.prepare("SELECT COUNT(*) as n FROM decisiones_autonomas").first();
      resultado.decisiones = dec ? dec.n : 0;
    } catch (x) {}
    try {
      const sh = await db.prepare("SELECT COUNT(*) as n FROM usuarios").first();
      resultado.shadow = sh ? sh.n : 0;
    } catch (x) {}
    try {
      const est = await db.prepare("SELECT COUNT(*) as n FROM estrategias WHERE estado='activa'").first();
      resultado.estrategias = est ? est.n : 0;
    } catch (x) {}
    try {
      const ideas = await db.prepare("SELECT COUNT(*) as n FROM contexto WHERE fuente='idea'").first();
      resultado.ideas = ideas ? ideas.n : 0;
    } catch (x) {}
  }

  if (kv) {
    try { await kv.put('cache:widgets', JSON.stringify(resultado), { expirationTtl: TTL_WIDGETS }); } catch (x) {}
  }

  return J({ ok: true, ...resultado });
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
    if (p === '/api/test_github' && r.method === 'GET') return testGithub(r, e);
    if (p === '/api/_test_mision' && r.method === 'GET') {
      const uu = new URL(r.url);
      const texto = uu.searchParams.get('texto') || '';
      const resultado = detectarMision(texto);
      return J({ texto_original: texto, texto_longitud: texto.length, indice_mision: texto.toLowerCase().indexOf('misión'), detectada: !!resultado, texto_mision: resultado });
    }
    if (p.startsWith('/api/imagen/') && r.method === 'GET') return servirImagen(r, e);
    if (p === '/api/widgets' && r.method === 'GET') return widgets(r, e);

    if (p === '/api/mision/escribir' && r.method === 'POST') {
      try {
        const b = await r.json();
        const kvN = gKV(e, 'agente');
        if (!kvN) return J({ error: 'KV no disponible.' });
        const texto = (b.texto || '').substring(0, 500);
        if (!texto) return J({ error: 'Falta texto.' });
        const misionActual = JSON.parse(await kvN.get('mision:estado') || '{}');
        const nueva = {
          fase_actual: b.fase || misionActual.fase_actual || 'misión activa',
          objetivo_semana: texto,
          siguiente_paso: b.siguiente || texto,
          creada: misionActual.creada || Date.now(),
          ultimo_update: Date.now()
        };
        await kvN.put('mision:estado', JSON.stringify(nueva), { expirationTtl: 365 * 86400 });
        await invalidarCache(e, 'widgets');
        try {
          const au = await opcional('autonomia');
          if (au && au.sumarConfianza) await au.sumarConfianza(e, 0.3, 'Misión escrita desde widget');
        } catch (x) {}
        return J({ ok: true, mision: nueva });
      } catch (x) { return J({ error: x.message }); }
    }

    if (p === '/api/chat' && r.method === 'POST') return chat(r, e, c);
    if (p === '/api/imagen' && r.method === 'POST') return rImagen(r, e, c);
    if (p === '/api/subir' && r.method === 'POST') return subir(r, e, c);
    if (p === '/api/resumir' && r.method === 'POST') return resumir(r, e);
    if (p === '/api/procesar' && r.method === 'POST') return procesar(r, e, c);
    if (p === '/api/retomar' && r.method === 'POST') return retomar(r, e, c);
    if (p === '/api/proceso' && r.method === 'GET') return verProceso(r, e);
    if (p === '/api/importar' && r.method === 'POST') return importar(r, e);
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
    if (p === '/api/estado') return J({ estado: 'activo', v: '21.3' });

    if (p === '/api/draft' && r.method === 'POST') {
      const b = await r.json();
      const kvN = gKV(e, 'agente');
      if (kvN && b.texto) {
        try {
          await kvN.put('draft:' + (b.user_id || 'comandante'), JSON.stringify({ texto: b.texto.substring(0, 4000), ts: Date.now() }), { expirationTtl: TTL_DRAFT });
          return J({ ok: true, guardado: true });
        } catch (x) { return J({ error: x.message }); }
      }
      return J({ ok: true, guardado: false });
    }
    if (p === '/api/draft' && r.method === 'GET') {
      const uu = new URL(r.url);
      const kvN = gKV(e, 'agente');
      if (!kvN) return J({ draft: null });
      try {
        const raw = await kvN.get('draft:' + (uu.searchParams.get('user_id') || 'comandante'));
        return J({ draft: raw ? JSON.parse(raw) : null });
      } catch (x) { return J({ draft: null }); }
    }
    if (p === '/api/draft' && r.method === 'DELETE') {
      const uu = new URL(r.url);
      const kvN = gKV(e, 'agente');
      if (kvN) { try { await kvN.delete('draft:' + (uu.searchParams.get('user_id') || 'comandante')); } catch (x) {} }
      return J({ ok: true });
    }

    if (p === '/api/salud' && r.method === 'GET') return J(await estadoSalud(e));
    if (p === '/api/salud/verificar' && r.method === 'POST') return J(await verificarSalud(e));
    if (p === '/api/salud/destilar' && r.method === 'POST') {
      const b = await r.json();
      const sa = await opcional('salud');
      if (!sa) return J({ error: 'salud.js no instalado.' });
      return J(await sa.destilarHistorial(e, b.dias || 30));
    }
    if (p === '/api/salud/sincronizar' && r.method === 'POST') return J(await sincronizarBuffer(e));
    if (p === '/api/salud/modo_cache' && r.method === 'GET') {
      const activo = await modoCacheActivo(e);
      return J({ modo_cache_activo: activo });
    }

    if (p === '/api/relacion/construir' && r.method === 'POST') {
      const r1 = await construirCacheRelacion(e, 'comandante');
      return J(r1 || { error: 'No se pudo construir.' });
    }
    if (p === '/api/relacion/leer' && r.method === 'GET') {
      const kvN = gKV(e, 'agente');
      const cache = await kvN.get('relacion:cache');
      const fecha = await kvN.get('relacion:cache_fecha');
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
      const salida = { ok: true, estado: 'operando', acciones: [] };
      try {
        const a = await db.prepare('SELECT tipo, descripcion, exito, detalle, fecha FROM acciones ORDER BY fecha DESC LIMIT 30').all();
        salida.acciones = a.results || [];
      } catch (x) {}
      if (kvN) {
        try {
          const uu = await kvN.get('cron_autonomo_ultima');
          if (uu) salida.ultimo_cron_hace = Math.round((Date.now() - parseInt(uu)) / 60000) + ' min';
        } catch (x) {}
      }
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
        return J({ ok: true, mensaje: 'Pulso enviado.' });
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
      if (db) await db.prepare('INSERT INTO correcciones_voz(contexto, correccion, fecha) VALUES(?,?,?)').bind('general', correccion, Date.now()).run();
      await invalidarCache(e, 'correcciones');
      try {
        const au = await opcional('autonomia');
        if (au && au.restarConfianza) await au.restarConfianza(e, 0.2, 'Corrección de voz: ' + correccion.substring(0, 80));
      } catch (x) {}
      return J({ ok: true, mensaje: 'Corrección guardada. Confianza -0.2.' });
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
        let ut = 0, up = 0;
        try { const t = await db.prepare('SELECT COUNT(*) as n FROM usuarios').first(); ut = t ? t.n : 0; } catch (x) {}
        try { const t = await db.prepare("SELECT COUNT(*) as n FROM usuarios WHERE tipo_pago='pago'").first(); up = t ? t.n : 0; } catch (x) {}
        return J({ stats: { usuarios_totales: ut, usuarios_pago: up }, resumen_ayanokoji: ut === 0 ? 'Shadow Arise no está operativo aún.' : `${ut} usuarios, ${up} pagando.` });
      } catch (x) { return J({ error: x.message }); }
    }

    if (p === '/api/componentes' && r.method === 'GET') {
      return J({
        pestanas: ['chat','calibracion','sandbox','estrategias','shadow','stats','actividad','decisiones','ideas','bandeja'],
        version: '21.3', ttls_actuales: { historial: TTL_HISTORIAL, contexto: TTL_CONTEXTO, resumenes: TTL_RESUMENES, correcciones: TTL_CORRECCIONES, estrategias: TTL_ESTRATEGIAS, draft: TTL_DRAFT, estado: TTL_ESTADO, diagnostico: TTL_DIAGNOSTICO }
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
    if (p === '/api/herramientas' && r.method === 'GET') return listarHerramientas(r, e);
    if (p === '/api/aprobacion/pendiente' && r.method === 'GET') return verAprobacionPendiente(r, e);
    if (p === '/api/aprobacion/cancelar' && r.method === 'POST') return cancelarAprobacion(r, e);

    if (p === '/api/examen/generar' && r.method === 'POST') {
      const m = await opcional('examen');
      if (!m) return J({ error: 'examen.js no instalado.' });
      return J(await m.generarPregunta(e));
    }
    if (p === '/api/examen/responder' && r.method === 'POST') {
      const b = await r.json();
      if (!b.id || !b.respuesta) return J({ error: 'Faltan id y respuesta.' });
      const m = await opcional('examen');
      if (!m) return J({ error: 'examen.js no instalado.' });
      return J(await m.responderPregunta(e, b.id, b.respuesta));
    }
    if (p === '/api/examen/listar' && r.method === 'GET') {
      const m = await opcional('examen');
      if (!m) return J({ error: 'examen.js no instalado.' });
      return J(await m.listarExamenes(e, 20));
    }
    if (p === '/api/examen/pendiente' && r.method === 'GET') {
      const db = gDB(e, 'agente');
      if (!db) return J({ error: 'D1 no disponible.' });
      try {
        const p1 = await db.prepare("SELECT id,pregunta,opcion_a,opcion_b,opcion_c,fecha FROM examen_criterio WHERE respondida=0 ORDER BY fecha DESC LIMIT 1").first();
        return J({ ok: true, pendiente: p1 || null });
      } catch (x) { return J({ error: x.message }); }
    }

    if (p === '/api/confianza' && r.method === 'GET') {
      const m = await opcional('autonomia');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      return J(await m.verConfianza(e));
    }
    if (p === '/api/confianza/historial' && r.method === 'GET') {
      const kvN = gKV(e, 'agente');
      const h = JSON.parse(await kvN.get('confianza:historial') || '[]');
      return J({ ok: true, total: h.length, historial: h.slice(0, 50) });
    }

    if (p === '/api/diario/leer' && r.method === 'GET') {
      const uu = new URL(r.url);
      const limite = parseInt(uu.searchParams.get('limite') || '10');
      const m = await opcional('autonomia');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      return J(await m.leerDiario(e, limite));
    }
    if (p === '/api/lecciones/leer' && r.method === 'GET') {
      const kvN = gKV(e, 'agente');
      const lecciones = JSON.parse(await kvN.get('identidad:lecciones') || '[]');
      return J({ ok: true, total: lecciones.length, lecciones: lecciones.slice(0, 30) });
    }
    if (p === '/api/deseos/leer' && r.method === 'GET') {
      const m = await opcional('autonomia');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      return J(await m.leerDeseosActivos(e));
    }
    if (p === '/api/deseos/resolver' && r.method === 'POST') {
      const b = await r.json();
      if (b.indice === undefined || b.aprobado === undefined) return J({ error: 'Faltan datos.' });
      const m = await opcional('autonomia');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      return J(await m.resolverDeseo(e, b.indice, b.aprobado, b.razon));
    }

    if (p === '/api/mision' && r.method === 'GET') {
      const kvN = gKV(e, 'agente');
      const mision = JSON.parse(await kvN.get('mision:estado') || '{}');
      return J({ ok: true, mision });
    }
    if (p === '/api/mision' && r.method === 'POST') {
      const b = await r.json();
      const m = await opcional('autonomia');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      return J(await m.actualizarMision(e, b));
    }

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
        if (horasDesde > 72) {
          await construirCacheRelacion(e, 'comandante');
        }
      } catch (x) {}

      const sa = await opcional('salud');
      if (sa && sa.cronSalud) { try { await sa.cronSalud(e); } catch (x) {} }
      if (sa && sa.cronSaludRapido) { try { await sa.cronSaludRapido(e); } catch (x) {} }

      const sb = await opcional('sandbox');
      if (sb && sb.cronSandbox) { try { await sb.cronSandbox(e); } catch (x) {} }

      const au2 = await opcional('autonomia');
      if (au2 && au2.cronAutoReparacion) { try { await au2.cronAutoReparacion(e); } catch (x) {} }
      if (au2 && au2.pensarYActuar) { try { await au2.pensarYActuar(e); } catch (x) {} }

      const pub = await opcional('publisher');
      if (pub && pub.cronPublicar) { try { await pub.cronPublicar(e); } catch (x) {} }

      const au = await opcional('autonomia');
      if (au && au.cronColaTareas) { try { await au.cronColaTareas(e); } catch (x) {} }
      if (au && au.informeDiario) { try { await au.informeDiario(e); } catch (x) {} }
    })();
  }
};
