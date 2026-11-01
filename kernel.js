// kernel.js — Capa de ejecución de Ayanokōji Digital
// Contiene: ejecutarHerramienta (48 tools), handlers HTTP, cache, github, aprobaciones, imágenes, widgets.
// No contiene chat ni router (eso vive en worker.js).
// No contiene cron (eso vive en worker.js).

import { MODELO, MODELO_LIGERO, MODELO_VISION, CORS, J, gDB, gKV, consultarUsoReal, consumir } from './storage.js';
import { detectarIntencion } from './nucleo.js';
import { TOOLS, parsearInvocaciones, herramientaExiste, herramientaRequiereAprobacion } from './tools.js';
import { notificar } from './notify.js';

// ============================================================
// CONSTANTES
// ============================================================
export const VENTANA_SEGURA = 15;
export const MAX_CHARS_MENSAJE = 1000;
export const MAX_CHARS_PERFIL_BASE = 2000;
export const MAX_CHARS_CONTEXTO = 1500;
export const MAX_ITERACIONES_TOOL = 3;
export const APROBACION_TTL = 600;

export const TTL_HISTORIAL = 300;
export const TTL_CONTEXTO = 1800;
export const TTL_RESUMENES = 1800;
export const TTL_CORRECCIONES = 3600;
export const TTL_ESTRATEGIAS = 3600;
export const TTL_DRAFT = 24 * 3600;
export const TTL_ESTADO = 60;
export const TTL_DIAGNOSTICO = 300;
export const TTL_WIDGETS = 300;

export const ARCHIVOS_BACKEND = ['worker.js', 'nucleo.js', 'shared.js', 'proc.js', 'autonomia.js', 'tools.js', 'doctrina.js', 'identidad.js', 'presupuesto.js', 'notify.js', 'publisher.js', 'social.js', 'sandbox.js', 'examen.js', 'salud.js', 'storage.js', 'kernel.js'];
export const ARCHIVOS_FRONTEND = ['index.html', 'styles.css', 'app.js'];

// ============================================================
// HELPERS
// ============================================================
export function extraerRespuesta(res) {
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

export async function opcional(nombre) {
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

// ============================================================
// CACHÉ
// ============================================================
export async function conCache(e, clave, ttlSeg, fn) {
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

export async function invalidarCache(e, prefijo) {
  const kv = gKV(e, 'agente');
  if (!kv) return;
  try {
    const lista = await kv.list({ prefix: 'cache:' + prefijo, limit: 1000 });
    for (const k of lista.keys) await kv.delete(k.name);
  } catch (x) {}
}

export function elegirModelo(mensaje, intencion, iteracion) {
  return MODELO;
}

// ============================================================
// GUARDAR MENSAJE
// ============================================================
export async function guardarMensajeInmediato(e, uid, rol, contenido, c) {
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
      if (kv) { try { await kv.delete(bufKey); } catch (x) {} }
    } catch (x) {}
  };

  if (c && c.waitUntil) c.waitUntil(escribirD1());
  else await escribirD1();

  return { ok: true, fecha };
}

// ============================================================
// CACHÉ DE RELACIÓN
// ============================================================
export async function construirCacheRelacion(e, uid) {
  const db = gDB(e, 'agente');
  const kv = gKV(e, 'agente');
  if (!db || !kv) return null;
  try {
    const r = await db.prepare('SELECT rol, contenido, orden FROM historial_largo WHERE user_id=? ORDER BY orden DESC LIMIT 300').bind(uid).all();
    if (!r.results || r.results.length < 20) return null;
    const texto = r.results.reverse().map(m => `[${m.rol}] ${(m.contenido || '').substring(0, 400)}`).join('\n\n');
    const res = await e.ayanokoji_IA.run(MODELO_LIGERO, {
      messages: [{ role: 'user', content: `Eres Ayanokōji Digital. Analiza las últimas conversaciones con el Comandante y extrae un resumen de relación en 5 secciones.\n\n### PATRONES DE COMUNICACIÓN\n### CHISTES INTERNOS\n### TEMAS RECURRENTES\n### MOMENTOS CLAVE\n### CÓMO DEBO ACTUAR CON ÉL\n\nConversaciones:\n${texto.substring(0, 20000)}\n\nMáximo 1200 palabras.` }],
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

export async function leerCacheRelacion(e) {
  const kv = gKV(e, 'agente');
  if (!kv) return '';
  try { return await kv.get('relacion:cache') || ''; } catch (x) { return ''; }
}

// ============================================================
// AUTO-RESUMEN POR INACTIVIDAD
// ============================================================
export async function autoResumenPorInactividad(e) {
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
    const mensajes = await db.prepare("SELECT mensaje, respuesta, fecha FROM historial WHERE user_id='comandante' AND fecha > ? ORDER BY fecha ASC").bind(ultimoResumen).all();
    if (!mensajes.results || mensajes.results.length < 3) return;
    const texto = mensajes.results.map(m => `Comandante: ${m.mensaje}\nAyanokōji: ${m.respuesta}`).join('\n\n');
    const res = await e.ayanokoji_IA.run(MODELO_LIGERO, {
      messages: [{ role: 'user', content: `Resume esta conversación para memoria de largo plazo. Máximo 400 palabras.\n\n${texto.substring(0, 12000)}` }],
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
// GITHUB
// ============================================================
export function githubHeaders(e) {
  const h = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'shadow-ayano' };
  if (e.GITHUB_TOKEN) h['Authorization'] = `Bearer ${e.GITHUB_TOKEN}`;
  return h;
}

export function repoDe(e, tipo) {
  if (tipo === 'frontend') return e.GITHUB_REPO_FRONTEND || null;
  return e.GITHUB_REPO_BACKEND || null;
}

export async function githubLeerArchivo(e, repo, archivo, rama) {
  const br = rama || e.GITHUB_BRANCH || 'main';
  const url = `https://api.github.com/repos/${repo}/contents/${archivo}?ref=${br}`;
  const r = await fetch(url, { headers: githubHeaders(e) });
  if (!r.ok) { const t = await r.text(); return { error: `GitHub ${r.status}: ${t.substring(0, 200)}` }; }
  const d = await r.json();
  if (!d.content) return { error: 'Sin contenido.' };
  const bin = atob(d.content.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const contenido = new TextDecoder('utf-8').decode(bytes);
  return { ok: true, contenido, sha: d.sha, tamaño: contenido.length };
}

export async function githubListarArchivos(e, repo, rama) {
  const br = rama || e.GITHUB_BRANCH || 'main';
  const url = `https://api.github.com/repos/${repo}/git/trees/${br}?recursive=1`;
  const r = await fetch(url, { headers: githubHeaders(e) });
  if (!r.ok) { const t = await r.text(); return { error: `GitHub ${r.status}: ${t.substring(0, 200)}` }; }
  const d = await r.json();
  if (!d.tree) return { error: 'Sin árbol.' };
  const archivos = d.tree.filter(x => x.type === 'blob').map(x => ({ ruta: x.path, tamaño: x.size }));
  return { ok: true, archivos, total: archivos.length };
}

export async function githubEscribirArchivo(e, repo, archivo, contenido, mensaje, rama) {
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
  for (let i = 0; i < bytes.length; i += paso) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + paso));
  const b64 = btoa(bin);
  const url = `https://api.github.com/repos/${repo}/contents/${archivo}`;
  const body = { message: mensaje || `Actualización de ${archivo}`, content: b64, branch: br };
  if (sha) body.sha = sha;
  const r = await fetch(url, { method: 'PUT', headers: { ...githubHeaders(e), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { const t = await r.text(); return { error: `GitHub PUT ${r.status}: ${t.substring(0, 300)}` }; }
  const d = await r.json();
  return { ok: true, commit: d.commit?.sha, url: d.commit?.html_url };
}

export function detectarArchivoEnMensaje(mensaje) {
  const t = mensaje.toLowerCase();
  return ARCHIVOS_BACKEND.find(a => t.includes(a.toLowerCase())) ||
         ARCHIVOS_FRONTEND.find(a => t.includes(a.toLowerCase())) || null;
}

export function esFrontend(mensaje) {
  const t = mensaje.toLowerCase();
  return ARCHIVOS_FRONTEND.some(a => t.includes(a.toLowerCase())) ||
         t.includes('frontend') || t.includes('interfaz') || t.includes('página') || t.includes('pagina');
}

// ============================================================
// EJECUTOR DE HERRAMIENTAS — 48 tools
// ============================================================
export async function ejecutarHerramienta(e, inv, uid, c) {
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
        const proc = await import('./proc.js');
        if (!proc.indexarHistorial) return { ok: false, error: 'proc.js sin indexarHistorial' };
        try {
          const r = await proc.indexarHistorial({ json: async () => ({}) }, e);
          return { ok: true, resultado: r };
        } catch (x) { return { ok: false, error: x.message }; }
      }
      case 'construir_perfil_base': {
        const proc = await import('./proc.js');
        if (!proc.construirPerfilBase) return { ok: false, error: 'proc.js sin construirPerfilBase' };
        try {
          const r = await proc.construirPerfilBase(e);
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
        const fakeReq = { json: async () => ({ tipo: p.tipo || 'provocacion', contenido: p.contenido, canales: p.canales || 'mastodon', imagen_id: p.imagen_id || null, publicar: true }) };
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
        return { ok: true, resultado: { mensaje: 'Cron desbloqueado, se ejecutará en el próximo ciclo.' } };
      }
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

// ============================================================
// APROBACIONES
// ============================================================
export async function guardarAprobacionPendiente(e, uid, inv) {
  const kv = gKV(e, 'agente');
  if (!kv) return null;
  const paquete = { tool: inv.tool, params: inv.params, razon: inv.razon, ts: Date.now() };
  await kv.put('aprobacion:' + uid, JSON.stringify(paquete), { expirationTtl: APROBACION_TTL });
  return paquete;
}

export async function leerAprobacionPendiente(e, uid) {
  const kv = gKV(e, 'agente');
  if (!kv) return null;
  const raw = await kv.get('aprobacion:' + uid);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (x) { return null; }
}

export async function limpiarAprobacionPendiente(e, uid) {
  const kv = gKV(e, 'agente');
  if (kv) await kv.delete('aprobacion:' + uid);
}

// ============================================================
// IMÁGENES
// ============================================================
export async function generarImagen(e, prompt, uid) {
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

export async function rImagen(r, e, c) {
  const b = await r.json();
  if (!b.prompt) return J({ error: 'Falta prompt.' });
  return J(await generarImagen(e, b.prompt, b.user_id || 'comandante'));
}

export async function servirImagen(r, e) {
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

// ============================================================
// HANDLERS DE ESTADO Y MEMORIA
// ============================================================
export async function rEst(e, uid) {
  const kv = gKV(e, 'agente');
  if (kv) {
    try {
      const cached = await kv.get('cache:estado:' + uid);
      if (cached) return J(JSON.parse(cached));
    } catch (x) {}
  }
  let n = 0, c2 = 0, hl = 0, tareas = 0, notif = 0, confianza = 0;
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
  const resultado = { respuesta: `Sistema activo. Memoria: ${n} mensajes, ${hl} en historial largo, ${c2} contextos. Tareas pendientes: ${tareas}. Notif sin leer: ${notif}. Confianza: ${confianza}/100.` };
  if (kv) { try { await kv.put('cache:estado:' + uid, JSON.stringify(resultado), { expirationTtl: TTL_ESTADO }); } catch (x) {} }
  return J(resultado);
}

export async function rLeer(e, uid) {
  if (!e.DB) return J({ respuesta: 'Sin memoria.' });
  try {
    const r = await e.DB.prepare('SELECT mensaje,respuesta,fecha FROM historial WHERE user_id=? ORDER BY fecha DESC LIMIT 10').bind(uid).all();
    if (!r.results || !r.results.length) return J({ respuesta: 'Memoria vacía.' });
    return J({ respuesta: 'Últimos registros:', historial: r.results });
  } catch (x) { return J({ respuesta: 'Error: ' + x.message }); }
}

export async function rElim(e, uid) {
  if (!e.DB) return J({ respuesta: 'Sin memoria.' });
  try {
    await e.DB.prepare('DELETE FROM historial WHERE user_id=?').bind(uid).run();
    await invalidarCache(e, 'estado:' + uid);
    return J({ respuesta: `Historial de ${uid} limpiado.` });
  } catch (x) { return J({ respuesta: 'Error: ' + x.message }); }
}

export async function d1(r, e) {
  try {
    const { accion, tabla, datos, condicion, destino } = await r.json();
    const db = gDB(e, destino || 'agente');
    if (!db) return J({ error: 'D1 no configurado.' });
    if (accion === 'leer') { const r1 = await db.prepare('SELECT * FROM ' + tabla + ' ' + (condicion || '')).all(); return J({ resultado: r1.results, total: r1.results.length }); }
    if (accion === 'escribir') { const k = Object.keys(datos), ph = k.map(() => '?').join(','); await db.prepare('INSERT INTO ' + tabla + ' (' + k.join(',') + ') VALUES(' + ph + ')').bind(...Object.values(datos)).run(); return J({ mensaje: 'Insertado.' }); }
    if (accion === 'eliminar') { await db.prepare('DELETE FROM ' + tabla + ' WHERE ' + condicion).run(); return J({ mensaje: 'Eliminado.' }); }
    return J({ error: 'Acción no reconocida.' });
  } catch (x) { return J({ error: 'Error D1: ' + x.message }); }
}

export async function kv(r, e) {
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

export async function historial(r, e) {
  try {
    const u = new URL(r.url), uid = u.searchParams.get('user_id') || 'comandante', d = u.searchParams.get('destino') || 'agente';
    const db = gDB(e, d);
    if (!db) return J({ error: 'D1 no configurado.' });
    const r1 = await db.prepare('SELECT mensaje,respuesta,fecha FROM historial WHERE user_id=? ORDER BY fecha DESC LIMIT 50').bind(uid).all();
    return J({ user_id: uid, total: r1.results.length, historial: r1.results });
  } catch (x) { return J({ error: x.message }); }
}

export async function historialLargo(r, e) {
  try {
    const u = new URL(r.url), uid = u.searchParams.get('user_id') || 'comandante';
    const limite = parseInt(u.searchParams.get('limite') || '100');
    const db = gDB(e, 'agente');
    const r1 = await db.prepare('SELECT rol,contenido,orden,fecha FROM historial_largo WHERE user_id=? ORDER BY orden DESC LIMIT ?').bind(uid, limite).all();
    const formateados = (r1.results || []).map(m => ({ rol: m.rol, contenido: m.contenido, orden: m.orden, fecha: m.fecha, fecha_formateada: new Date(m.fecha).toISOString().replace('T', ' ').substring(0, 19) }));
    return J({ total: formateados.length, historial: formateados.reverse() });
  } catch (x) { return J({ error: x.message }); }
}

export async function verContexto(r, e) {
  try {
    const u = new URL(r.url), d = u.searchParams.get('destino') || 'agente';
    const db = gDB(e, d);
    if (!db) return J({ error: 'D1 no configurado.' });
    const r1 = await db.prepare('SELECT fecha,resumen,fases,fuente FROM contexto ORDER BY fecha DESC LIMIT 5').all();
    return J({ total: r1.results.length, contextos: r1.results });
  } catch (x) { return J({ error: x.message }); }
}

export async function vision(r, e) {
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

export async function reset(r, e) {
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

export async function diagnostico(r, e) {
  const kv = gKV(e, 'agente');
  if (kv) { try { const cached = await kv.get('cache:diagnostico'); if (cached) return J(JSON.parse(cached)); } catch (x) {} }
  const db = gDB(e, 'agente');
  if (!db) return J({ error: 'Sin D1.' });
  try {
    const tablas = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const conteos = {};
    for (const t of (tablas.results || [])) {
      try { const c2 = await db.prepare('SELECT COUNT(*) as n FROM ' + t.name).first(); conteos[t.name] = c2 ? c2.n : 0; } catch (x) { conteos[t.name] = 'err'; }
    }
    const modulos = {};
    for (const m of ['social','autonomia','publisher','sandbox','examen','salud']) {
      const x = await opcional(m);
      modulos[m] = !!x;
    }
    const resultado = { ok: true, tablas: (tablas.results || []).map(t => t.name), conteos, modulos_disponibles: modulos };
    if (kv) { try { await kv.put('cache:diagnostico', JSON.stringify(resultado), { expirationTtl: TTL_DIAGNOSTICO }); } catch (x) {} }
    return J(resultado);
  } catch (x) { return J({ error: x.message }); }
}

export async function erroresTardios(r, e) {
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

export async function codigoLeer(r, e) {
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

export async function codigoListar(r, e) {
  try {
    const b = await r.json();
    const repo = repoDe(e, b.repo === 'frontend' ? 'frontend' : 'backend');
    if (!repo) return J({ error: 'Repo no configurado.' });
    const res = await githubListarArchivos(e, repo, b.rama);
    if (res.error) return J({ error: res.error });
    return J({ ok: true, ...res });
  } catch (x) { return J({ error: x.message }); }
}

export async function codigoEscribir(r, e) {
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

export async function listarHerramientas(r, e) {
  const categorias = {};
  for (const t of Object.values(TOOLS)) {
    if (!categorias[t.categoria]) categorias[t.categoria] = [];
    categorias[t.categoria].push({ nombre: t.nombre, tipo: t.tipo, descripcion: t.descripcion, requiere_aprobacion: t.requiere_aprobacion });
  }
  return J({ ok: true, total: Object.keys(TOOLS).length, categorias });
}

export async function verAprobacionPendiente(r, e) {
  try {
    const u = new URL(r.url);
    const uid = u.searchParams.get('user_id') || 'comandante';
    const p = await leerAprobacionPendiente(e, uid);
    return J({ ok: true, pendiente: p || null });
  } catch (x) { return J({ error: x.message }); }
}

export async function cancelarAprobacion(r, e) {
  try {
    const b = await r.json();
    const uid = b.user_id || 'comandante';
    await limpiarAprobacionPendiente(e, uid);
    return J({ ok: true, cancelada: true });
  } catch (x) { return J({ error: x.message }); }
}

export async function diagnosticoVariables(r, e) {
  const kv = gKV(e, 'agente');
  let cacheRelacion = null, cacheRelacionFecha = null, confianza = 0;
  try {
    cacheRelacion = await kv.get('relacion:cache');
    cacheRelacionFecha = await kv.get('relacion:cache_fecha');
    confianza = parseInt(await kv.get('confianza:actual') || '0');
  } catch (x) {}
  return J({
    timestamp: new Date().toISOString(), version: '21.5',
    token_presente: !!e.GITHUB_TOKEN, token_longitud: e.GITHUB_TOKEN ? e.GITHUB_TOKEN.length : 0,
    repo_backend_presente: !!e.GITHUB_REPO_BACKEND, repo_backend_valor: e.GITHUB_REPO_BACKEND || null,
    repo_frontend_presente: !!e.GITHUB_REPO_FRONTEND, repo_frontend_valor: e.GITHUB_REPO_FRONTEND || null,
    branch_presente: !!e.GITHUB_BRANCH, branch_valor: e.GITHUB_BRANCH || null,
    todas_las_vars_github: Object.keys(e).filter(k => k.startsWith('GITHUB_')),
    cache_activo: true, modelo_ligero_actual: MODELO_LIGERO, modelo_chat: MODELO,
    ttls: { historial: TTL_HISTORIAL, contexto: TTL_CONTEXTO, resumenes: TTL_RESUMENES, correcciones: TTL_CORRECCIONES, estrategias: TTL_ESTRATEGIAS, draft: TTL_DRAFT, estado: TTL_ESTADO, diagnostico: TTL_DIAGNOSTICO, widgets: TTL_WIDGETS },
    cache_relacion_existe: !!cacheRelacion, cache_relacion_longitud: cacheRelacion ? cacheRelacion.length : 0,
    cache_relacion_fecha: cacheRelacionFecha || null, confianza_actual: confianza
  });
}

export async function testGithub(r, e) {
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
// WIDGETS
// ============================================================
export async function widgets(r, e) {
  const kv = gKV(e, 'agente');
  if (kv) {
    try {
      const raw = await kv.get('cache:widgets');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed._ts && (Date.now() - parsed._ts) < 5 * 60 * 1000) return J({ ok: true, ...parsed });
      }
    } catch (x) {}
  }

  const resultado = { confianza: 0, mision: null, pensamiento: null, actividad: null, bandeja: 0, examen: 'libre', sandbox: 0, decisiones: 0, shadow: 0, stats: 'ver', estrategias: 0, ideas: 0 };

  if (kv) {
    try { resultado.confianza = parseInt(await kv.get('confianza:actual') || '0'); } catch (x) {}
    try { resultado.mision = JSON.parse(await kv.get('mision:estado') || 'null'); } catch (x) {}
    try {
      const diario = JSON.parse(await kv.get('identidad:diario') || '[]');
      resultado.pensamiento = diario[0] ? { tipo: diario[0].tipo, entrada: diario[0].entrada.substring(0, 60) } : null;
    } catch (x) {}
  }

  const dbAgente = gDB(e, 'agente');
  if (dbAgente) {
    try { const act = await dbAgente.prepare("SELECT tipo, descripcion, fecha FROM acciones ORDER BY fecha DESC LIMIT 1").first(); resultado.actividad = act ? { tipo: act.tipo, descripcion: (act.descripcion || '').substring(0, 50) } : null; } catch (x) {}
    try { const notif = await dbAgente.prepare("SELECT COUNT(*) as n FROM notificaciones WHERE leida=0").first(); resultado.bandeja = notif ? notif.n : 0; } catch (x) {}
    try { const ex = await dbAgente.prepare("SELECT id FROM examen_criterio WHERE respondida=0 LIMIT 1").first(); resultado.examen = ex ? '1 pendiente' : 'libre'; } catch (x) {}
    try { const dec = await dbAgente.prepare("SELECT COUNT(*) as n FROM decisiones_autonomas").first(); resultado.decisiones = dec ? dec.n : 0; } catch (x) {}
    try { const est = await dbAgente.prepare("SELECT COUNT(*) as n FROM estrategias WHERE estado='activa'").first(); resultado.estrategias = est ? est.n : 0; } catch (x) {}
    try { const ideas = await dbAgente.prepare("SELECT COUNT(*) as n FROM contexto WHERE fuente='idea'").first(); resultado.ideas = ideas ? ideas.n : 0; } catch (x) {}
  }

  const dbTest = gDB(e, 'test');
  if (dbTest) { try { const sb = await dbTest.prepare("SELECT COUNT(*) as n FROM sandbox_escenarios").first(); resultado.sandbox = sb ? sb.n : 0; } catch (x) {} }

  const dbShadow = gDB(e, 'shadow');
  if (dbShadow) { try { const sh = await dbShadow.prepare("SELECT COUNT(*) as n FROM usuarios").first(); resultado.shadow = sh ? sh.n : 0; } catch (x) {} }

  if (kv) {
    try { await kv.put('cache:widgets', JSON.stringify({ ...resultado, _ts: Date.now() }), { expirationTtl: 300 }); } catch (x) {}
  }

  return J({ ok: true, ...resultado });
}
