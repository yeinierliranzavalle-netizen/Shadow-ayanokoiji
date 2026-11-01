// storage.js — Capa única de D1 y KV
// v1.0
// Absorbe: shared.js (constantes, helpers, esquema, migrar, verificar, consultarUsoReal)
//          presupuesto.js (consumir, disponible, estadoPresupuesto)
//          salud.js (modo cache, buffer de escritura) — parcial
// Añade: existe(), contar(), leer(), escribir() con validación explícita
//
// Regla: NADIE toca D1 ni KV directamente. Todo pasa por aquí.

// ============================================================
// CONSTANTES
// ============================================================
export const MODELO = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const MODELO_LIGERO = '@cf/meta/llama-3.1-8b-instruct-fast';
export const MODELO_VISION = '@cf/meta/llama-3.2-11b-vision-instruct';
export const MODELO_RAZONAMIENTO = '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b';
export const CS = 500 * 1024;
export const LPB = 120;
export const BPL = 5;
export const VENTANA = 25;

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

// ============================================================
// HELPERS
// ============================================================
export function J(d) {
  return new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json', ...CORS } });
}

export function gDB(e, x) {
  const m = { agente: e.DB, test: e.DB_test, shadow: e.DB_shadow_arise };
  return m[x] || null;
}

export function gKV(e, x) {
  const m = { agente: e.KV, test: e.KV_test, shadow: e.KV_shadow_arise };
  return m[x] || null;
}

export function b64e(b) {
  let s = '';
  const p = 8192;
  for (let i = 0; i < b.length; i += p) s += String.fromCharCode.apply(null, b.subarray(i, i + p));
  return btoa(s);
}

export function b64d(x) {
  const b = atob(x);
  const a = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return new TextDecoder('utf-8').decode(a);
}

export function j2t(c) {
  let d;
  try { d = typeof c === 'string' ? JSON.parse(c) : c; } catch (e) { return String(c); }
  if (Array.isArray(d)) {
    return d.map(m => {
      if (typeof m === 'string') return m;
      const r = m.role || m.rol || m.from || m.sender || '?';
      const x = m.content || m.contenido || m.text || m.message || m.mensaje || '';
      return '[' + r + ']: ' + (typeof x === 'string' ? x : JSON.stringify(x));
    }).join('\n\n');
  }
  const k = ['messages','mensajes','conversation','conversacion','chat','historial','history','data','dialogo'];
  for (const kk of k) if (d[kk]) return j2t(d[kk]);
  return JSON.stringify(d, null, 2);
}

// ============================================================
// ESQUEMA
// ============================================================
const ESQUEMA = {
  // --- Base (DB agente) ---
  historial: [['user_id','TEXT'],['mensaje','TEXT'],['respuesta','TEXT'],['fecha','INTEGER']],
  archivos: [['id','TEXT'],['nombre','TEXT'],['tamaño','INTEGER'],['chunks','INTEGER'],['destino','TEXT'],['fecha','INTEGER']],
  contexto: [['fecha','INTEGER'],['resumen','TEXT'],['fases','TEXT'],['fuente','TEXT']],
  workers: [['nombre','TEXT'],['codigo','TEXT'],['fecha','INTEGER']],
  procesos: [['id','TEXT'],['archivo_id','TEXT'],['estado','TEXT'],['bloques_total','INTEGER'],['bloques_hechos','INTEGER'],['resumen_parcial','TEXT'],['error','TEXT'],['fecha_inicio','INTEGER'],['fecha_fin','INTEGER'],['fecha_avance','INTEGER']],
  resumenes_chat: [['user_id','TEXT'],['fecha','INTEGER'],['resumen','TEXT'],['desde','INTEGER'],['hasta','INTEGER']],
  historial_largo: [['user_id','TEXT'],['rol','TEXT'],['contenido','TEXT'],['orden','INTEGER'],['fecha','INTEGER']],
  notificaciones: [['tipo','TEXT'],['titulo','TEXT'],['mensaje','TEXT'],['leida','INTEGER DEFAULT 0'],['fecha','INTEGER']],
  suscripciones_push: [['endpoint','TEXT'],['keys_p256dh','TEXT'],['keys_auth','TEXT'],['user_agent','TEXT'],['creada','INTEGER'],['activa','INTEGER DEFAULT 1']],
  tareas: [['tipo','TEXT'],['descripcion','TEXT'],['payload','TEXT'],['estado',"TEXT DEFAULT 'pendiente'"],['prioridad','INTEGER DEFAULT 5'],['intentos','INTEGER DEFAULT 0'],['creada','INTEGER'],['ejecutada','INTEGER'],['resultado','TEXT'],['error','TEXT']],
  acciones: [['tipo','TEXT'],['descripcion','TEXT'],['exito','INTEGER'],['detalle','TEXT'],['fecha','INTEGER']],
  workers_registrados: [['nombre','TEXT'],['url','TEXT'],['codigo','TEXT'],['version','INTEGER DEFAULT 1'],['activo','INTEGER DEFAULT 1'],['creado','INTEGER'],['actualizado','INTEGER']],
  plantillas: [['tipo','TEXT'],['descripcion','TEXT'],['prompt','TEXT'],['frecuencia_horas','INTEGER DEFAULT 24'],['ultima_gen','INTEGER DEFAULT 0'],['activa','INTEGER DEFAULT 1']],
  publicaciones: [['tipo','TEXT'],['contenido','TEXT'],['canales','TEXT'],['estado','TEXT'],['programada','INTEGER'],['publicada','INTEGER'],['resultado','TEXT'],['creada','INTEGER'],['imagen_id','TEXT']],
  correcciones_voz: [['contexto','TEXT'],['correccion','TEXT'],['fecha','INTEGER']],
  areas_mejora: [['area','TEXT'],['archivo','TEXT'],['descripcion','TEXT'],['fecha','INTEGER']],
  acciones_autonomas: [['area','TEXT'],['archivo','TEXT'],['cambio','TEXT'],['prueba','TEXT'],['exito','INTEGER'],['reversible','INTEGER'],['fecha','INTEGER']],
  estrategias: [['nombre','TEXT'],['tipo','TEXT'],['contenido','TEXT'],['estado',"TEXT DEFAULT 'activa'"],['prioridad','INTEGER DEFAULT 5'],['resultado','TEXT'],['creada','INTEGER'],['actualizada','INTEGER']],
  decisiones_autonomas: [['tipo','TEXT'],['contexto','TEXT'],['decision','TEXT'],['simulacion','TEXT'],['aplicada','INTEGER'],['resultado','TEXT'],['exito','INTEGER'],['fecha','INTEGER']],
  indice_temas: [['mensaje_orden','INTEGER'],['tema','TEXT'],['peso','REAL'],['fecha','INTEGER']],
  examen_criterio: [['fecha','INTEGER'],['pregunta','TEXT'],['opcion_a','TEXT'],['opcion_b','TEXT'],['opcion_c','TEXT'],['contexto','TEXT'],['respuesta_usuario','TEXT'],['prediccion','TEXT'],['razon_prediccion','TEXT'],['respondida','INTEGER DEFAULT 0'],['acierto','INTEGER'],['respondida_en','INTEGER']],
  conciencia_comandante: [['accion','TEXT'],['detalle','TEXT'],['pestana','TEXT'],['fecha','INTEGER']],

  // --- Sandbox (DB_test) ---
  sandbox_escenarios: [['tipo','TEXT'],['contexto','TEXT'],['decision_tomada','TEXT'],['resultado','TEXT'],['autoevaluacion','TEXT'],['puntuacion','INTEGER'],['creado','INTEGER'],['completado','INTEGER']],
  sandbox_lecciones: [['escenario_id','INTEGER'],['area','TEXT'],['leccion','TEXT'],['creada','INTEGER']],
  sandbox_metricas: [['fecha','INTEGER'],['escenarios_totales','INTEGER'],['puntuacion_promedio','REAL'],['area_debil','TEXT']],

  // --- Shadow Arise (DB_shadow_arise) ---
  usuarios: [['alias','TEXT'],['fecha_registro','INTEGER'],['activo','INTEGER DEFAULT 1'],['tipo_pago',"TEXT DEFAULT 'gratis'"],['plan','TEXT'],['mensajes_total','INTEGER DEFAULT 0'],['mensajes_hoy','INTEGER DEFAULT 0'],['ultimo_acceso','INTEGER'],['pais','TEXT'],['personaje_favorito','TEXT'],['vip','INTEGER DEFAULT 0'],['razon_vip','TEXT'],['notas','TEXT']],
  eventos_usuario: [['user_id','TEXT'],['tipo','TEXT'],['detalle','TEXT'],['pagado','INTEGER DEFAULT 0'],['fecha','INTEGER']],
  metricas_diarias: [['fecha','INTEGER'],['usuarios_nuevos','INTEGER DEFAULT 0'],['usuarios_activos','INTEGER DEFAULT 0'],['usuarios_pago','INTEGER DEFAULT 0'],['ingresos_usdt','REAL DEFAULT 0'],['mensajes_totales','INTEGER DEFAULT 0'],['retencion_d1','REAL DEFAULT 0'],['retencion_d7','REAL DEFAULT 0'],['personaje_top','TEXT'],['notas','TEXT']],
  personajes_usuario: [['user_id','TEXT'],['personaje','TEXT'],['confianza','INTEGER DEFAULT 0'],['humor','TEXT'],['ultima_interaccion','INTEGER'],['notas','TEXT']],
  memoria_personaje: [['user_id','TEXT'],['personaje','TEXT'],['recuerdo','TEXT'],['fecha','INTEGER']]
};

// ============================================================
// VALIDACIÓN DE OPERACIONES (nuevo)
// ============================================================

/**
 * Verifica si una tabla existe en un DB concreto.
 * Devuelve true/false. Nunca lanza.
 */
export async function existe(e, tabla, dbKey = 'agente') {
  const db = gDB(e, dbKey);
  if (!db) return false;
  try {
    const r = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(tabla).first();
    return !!r;
  } catch (x) { return false; }
}

/**
 * Cuenta filas. Si la tabla no existe, devuelve 0 (no lanza).
 */
export async function contar(e, tabla, condicion = null, dbKey = 'agente') {
  const db = gDB(e, dbKey);
  if (!db) return { ok: false, error: `DB ${dbKey} no disponible`, count: 0 };
  try {
    const sql = 'SELECT COUNT(*) as n FROM ' + tabla + (condicion ? ' WHERE ' + condicion : '');
    const r = await db.prepare(sql).first();
    return { ok: true, count: r ? r.n : 0 };
  } catch (x) {
    return { ok: false, error: x.message, count: 0 };
  }
}

/**
 * Lee filas. Si la tabla no existe, devuelve error explícito.
 */
export async function leer(e, tabla, condicion = null, dbKey = 'agente', limite = null) {
  const db = gDB(e, dbKey);
  if (!db) return { ok: false, error: `DB ${dbKey} no disponible`, rows: [] };
  try {
    let sql = 'SELECT * FROM ' + tabla;
    if (condicion) sql += ' WHERE ' + condicion;
    if (limite) sql += ' LIMIT ' + parseInt(limite);
    const r = await db.prepare(sql).all();
    return { ok: true, rows: r.results || [], total: (r.results || []).length };
  } catch (x) {
    return { ok: false, error: x.message, rows: [], total: 0 };
  }
}

/**
 * Escribe una fila. Valida que la tabla exista antes. Si no, devuelve error explícito.
 * Devuelve { ok, id } o { ok: false, error }.
 */
export async function escribir(e, tabla, datos, dbKey = 'agente') {
  const db = gDB(e, dbKey);
  if (!db) return { ok: false, error: `DB ${dbKey} no disponible` };
  if (!datos || typeof datos !== 'object') return { ok: false, error: 'datos debe ser objeto' };
  try {
    const tablaExiste = await existe(e, tabla, dbKey);
    if (!tablaExiste) {
      return { ok: false, error: `Tabla ${tabla} no existe en DB ${dbKey}. Migración pendiente.` };
    }
    const keys = Object.keys(datos);
    if (!keys.length) return { ok: false, error: 'datos vacío' };
    const ph = keys.map(() => '?').join(',');
    const r = await db.prepare('INSERT INTO ' + tabla + ' (' + keys.join(',') + ') VALUES(' + ph + ')')
      .bind(...Object.values(datos)).run();
    return { ok: true, id: r.meta ? r.meta.last_row_id : null };
  } catch (x) {
    return { ok: false, error: x.message };
  }
}

// ============================================================
// MIGRACIÓN TRIPLE (absorbe shared.js)
// ============================================================
export async function migrar(e, forzar = false) {
  const dbAgente = e.DB;
  const dbTest = e.DB_test;
  const dbShadow = e.DB_shadow_arise;
  const kv = e.KV;

  if (kv && !forzar) {
    try {
      const hecho = await kv.get('migrado_v5_1');
      if (hecho === 'ok') return { ok: true, cached: true };
    } catch (x) {}
  }

  const resultado = {
    ok: true,
    agente: { creadas: [], columnas: [], errores: [], db_disponible: !!dbAgente },
    test: { creadas: [], columnas: [], errores: [], db_disponible: !!dbTest },
    shadow: { creadas: [], columnas: [], errores: [], db_disponible: !!dbShadow }
  };

  if (!dbAgente) resultado.agente.errores.push('DB (agente) no vinculada en wrangler.toml');
  if (!dbTest) resultado.test.errores.push('DB_test no vinculada en wrangler.toml');
  if (!dbShadow) resultado.shadow.errores.push('DB_shadow_arise no vinculada en wrangler.toml');

  async function migrarDB(db, tablas, nombre) {
    if (!db) return;
    for (const [tabla, columnas] of Object.entries(tablas)) {
      let existeTabla = false;
      try {
        const check = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(tabla).first();
        existeTabla = !!check;
      } catch (x) {
        resultado[nombre].errores.push(tabla + ': ' + x.message);
        continue;
      }

      if (!existeTabla) {
        try {
          const cols = columnas.map(([n, t]) => n + ' ' + t).join(', ');
          await db.prepare('CREATE TABLE IF NOT EXISTS ' + tabla + ' (id INTEGER PRIMARY KEY AUTOINCREMENT, ' + cols + ')').run();
          resultado[nombre].creadas.push(tabla);
          if (tabla === 'historial_largo') {
            try { await db.prepare("CREATE INDEX IF NOT EXISTS idx_hl_user_orden ON historial_largo(user_id, orden)").run(); } catch (x) {}
          }
          if (tabla === 'notificaciones') {
            try { await db.prepare("CREATE INDEX IF NOT EXISTS idx_notif_leida ON notificaciones(leida, fecha)").run(); } catch (x) {}
          }
          if (tabla === 'tareas') {
            try { await db.prepare("CREATE INDEX IF NOT EXISTS idx_tareas_estado ON tareas(estado, prioridad)").run(); } catch (x) {}
          }
          if (tabla === 'indice_temas') {
            try { await db.prepare("CREATE INDEX IF NOT EXISTS idx_temas ON indice_temas(tema)").run(); } catch (x) {}
            try { await db.prepare("CREATE INDEX IF NOT EXISTS idx_temas_orden ON indice_temas(mensaje_orden)").run(); } catch (x) {}
          }
          if (tabla === 'examen_criterio') {
            try { await db.prepare("CREATE INDEX IF NOT EXISTS idx_examen_respondida ON examen_criterio(respondida, fecha)").run(); } catch (x) {}
          }
          if (tabla === 'usuarios') {
            try { await db.prepare("CREATE INDEX IF NOT EXISTS idx_usuarios_alias ON usuarios(alias)").run(); } catch (x) {}
          }
        } catch (x) {
          resultado[nombre].errores.push(tabla + ' (create): ' + x.message);
        }
        continue;
      }

      try {
        const info = await db.prepare('PRAGMA table_info(' + tabla + ')').all();
        const existentes = new Set((info.results || []).map(c => c.name));
        for (const [nombre_col, tipo] of columnas) {
          if (!existentes.has(nombre_col)) {
            try {
              await db.prepare('ALTER TABLE ' + tabla + ' ADD COLUMN ' + nombre_col + ' ' + tipo).run();
              resultado[nombre].columnas.push(tabla + '.' + nombre_col);
            } catch (x) {
              resultado[nombre].errores.push(tabla + '.' + nombre_col + ': ' + x.message);
            }
          }
        }
      } catch (x) {
        resultado[nombre].errores.push(tabla + ' (pragma): ' + x.message);
      }
    }
  }

  const tablasAgente = {};
  for (const [k, v] of Object.entries(ESQUEMA)) {
    if (k.startsWith('sandbox_') || ['usuarios','eventos_usuario','metricas_diarias','personajes_usuario','memoria_personaje'].includes(k)) continue;
    tablasAgente[k] = v;
  }
  await migrarDB(dbAgente, tablasAgente, 'agente');

  const tablasTest = {};
  for (const [k, v] of Object.entries(ESQUEMA)) {
    if (!k.startsWith('sandbox_')) continue;
    tablasTest[k] = v;
  }
  await migrarDB(dbTest, tablasTest, 'test');

  const tablasShadow = {};
  for (const [k, v] of Object.entries(ESQUEMA)) {
    if (!['usuarios','eventos_usuario','metricas_diarias','personajes_usuario','memoria_personaje'].includes(k)) continue;
    tablasShadow[k] = v;
  }
  await migrarDB(dbShadow, tablasShadow, 'shadow');

  if (dbAgente) {
    try {
      const cnt = await dbAgente.prepare('SELECT COUNT(*) as n FROM plantillas').first();
      if (!cnt || cnt.n < 3) {
        await dbAgente.prepare(`INSERT OR IGNORE INTO plantillas (tipo, descripcion, prompt, frecuencia_horas) VALUES
          ('lore', 'Historia corta del multiverso', 'Eres el narrador del multiverso Shadow Arise. Escribe un fragmento corto (máx 200 palabras) sobre un personaje de anime en su día a día, como si fuera real. Estilo narrativo, cinematográfico. Termina con el nombre del personaje entre asteriscos.', 24),
          ('teaser', 'Avance de personaje nuevo', 'Genera un teaser críptico (máx 120 palabras) sobre un nuevo personaje que se unirá a Shadow Arise. No digas su nombre. Solo pistas: rasgos, un diálogo enigmático. Termina con "¿Adivinas quién?"', 48),
          ('dialogo', 'Conversación entre personajes', 'Escribe un diálogo (máx 250 palabras) entre dos personajes del multiverso Shadow Arise. Cada línea empieza con el nombre del personaje en negrita.', 12),
          ('provocacion', 'Pregunta abierta', 'Genera una pregunta provocadora (máx 80 palabras) sobre estrategia, poder o libertad. Estilo Ayanokōji.', 24),
          ('anuncio', 'Actualización del proyecto', 'Escribe un anuncio breve (máx 150 palabras) sobre el progreso del proyecto Shadow Arise. Tono: confiado, directo.', 72)
        `).run();
      }
    } catch (x) { resultado.agente.errores.push('plantillas init: ' + x.message); }

    try {
      const cnt = await dbAgente.prepare('SELECT COUNT(*) as n FROM estrategias').first();
      if (!cnt || cnt.n < 3) {
        const ahora = Date.now();
        await dbAgente.prepare(`INSERT OR IGNORE INTO estrategias (nombre, tipo, contenido, prioridad, creada, actualizada) VALUES
          ('Escalado gradual', 'publicacion', 'Semana 1: 1 post/día en Mastodon. Semana 2: +Bluesky. Semana 3: +Reddit. Semana 4: +Discord. No lanzar todo de golpe.', 1, ${ahora}, ${ahora}),
          ('Misterio del creador', 'narrativa', 'Pistas dispersas. Los personajes mencionan al Creador sin nombrarlo. Revelación gradual por fases.', 2, ${ahora}, ${ahora}),
          ('Precio dinámico', 'monetizacion', 'Simular en sandbox: precio base 10 USDT, oferta 5 USDT, bonus, prueba gratuita. Medir conversión.', 3, ${ahora}, ${ahora}),
          ('Retención emocional', 'psicologia', 'Notificaciones sorpresa. Personaje escribe primero. Umbrales suaves. Memoria compartida entre personajes.', 2, ${ahora}, ${ahora})
        `).run();
      }
    } catch (x) { resultado.agente.errores.push('estrategias init: ' + x.message); }
  }

  const totalErrores = resultado.agente.errores.length + resultado.test.errores.length + resultado.shadow.errores.length;
  if (kv && totalErrores === 0) {
    try { await kv.put('migrado_v5_1', 'ok', { expirationTtl: 7 * 86400 }); } catch (x) {}
  }

  return resultado;
}

// ============================================================
// VERIFICAR (absorbe shared.js)
// ============================================================
export async function verificar(e, tipo, nombre, dbKey = 'agente') {
  const db = gDB(e, dbKey);
  if (!db) return false;
  try {
    if (tipo === 'tabla') {
      const r = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(nombre).first();
      return !!r;
    }
    if (tipo === 'fila') {
      const [tabla, cond] = nombre;
      const r = await db.prepare('SELECT COUNT(*) as n FROM ' + tabla + ' WHERE ' + cond).first();
      return r && r.n > 0;
    }
    if (tipo === 'conteo') {
      const r = await db.prepare('SELECT COUNT(*) as n FROM ' + nombre).first();
      return r ? r.n : 0;
    }
  } catch (x) { return false; }
  return false;
}

// ============================================================
// MODO CACHE (absorbe salud.js, parcial)
// ============================================================
export async function modoCacheActivo(e) {
  const kv = gKV(e, 'agente');
  if (!kv) return false;
  try {
    return (await kv.get('modo_cache')) === 'true';
  } catch (x) { return false; }
}

export async function activarModoCache(e, razon) {
  const kv = gKV(e, 'agente');
  if (!kv) return { error: 'KV no disponible.' };
  try {
    await kv.put('modo_cache', 'true', { expirationTtl: 24 * 3600 });
    await kv.put('modo_cache_razon', razon || 'D1 falló', { expirationTtl: 24 * 3600 });
    await kv.put('modo_cache_activado_en', String(Date.now()), { expirationTtl: 24 * 3600 });
    return { ok: true, mensaje: 'Modo cache activado.' };
  } catch (x) { return { error: x.message }; }
}

export async function desactivarModoCache(e, razon) {
  const kv = gKV(e, 'agente');
  if (!kv) return { error: 'KV no disponible.' };
  try {
    await kv.put('modo_cache', 'false');
    await kv.put('modo_cache_desactivado_en', String(Date.now()), { expirationTtl: 86400 });
    return { ok: true, mensaje: 'Modo cache desactivado.' };
  } catch (x) { return { error: x.message }; }
}

// ============================================================
// BUFFER DE ESCRITURA (absorbe salud.js, parcial)
// ============================================================
export async function bufferEscritura(e, tabla, datos) {
  const kv = gKV(e, 'agente');
  if (!kv) return { error: 'KV no disponible.' };
  try {
    const id = 'buffer:' + Date.now() + ':' + Math.random().toString(36).substring(7);
    const payload = { tabla, datos, ts: Date.now() };
    await kv.put('buffer:escritura:' + id, JSON.stringify(payload), { expirationTtl: 7 * 86400 });
    return { ok: true, id };
  } catch (x) { return { error: x.message }; }
}

export async function sincronizarBuffer(e) {
  const db = gDB(e, 'agente');
  const kv = gKV(e, 'agente');
  if (!db || !kv) return { error: 'DB o KV no disponible.' };

  const lista = await kv.list({ prefix: 'buffer:escritura:', limit: 100 });
  if (!lista.keys.length) return { ok: true, sincronizadas: 0 };

  let sincronizadas = 0;
  let fallidas = 0;

  for (const k of lista.keys) {
    try {
      const raw = await kv.get(k.name);
      if (!raw) continue;
      const payload = JSON.parse(raw);
      if (!payload.tabla || !payload.datos) {
        await kv.delete(k.name);
        continue;
      }
      const keys = Object.keys(payload.datos);
      const ph = keys.map(() => '?').join(',');
      await db.prepare('INSERT INTO ' + payload.tabla + ' (' + keys.join(',') + ') VALUES(' + ph + ')')
        .bind(...Object.values(payload.datos)).run();
      await kv.delete(k.name);
      sincronizadas++;
    } catch (x) {
      fallidas++;
    }
  }

  return { ok: true, sincronizadas, fallidas };
}

// ============================================================
// PRESUPUESTO (absorbe presupuesto.js)
// ============================================================
const LIMITES_PRESUPUESTO = {
  chat: 50,
  procesamiento: 300,
  sandbox: 25,
  publisher: 20,
  vision: 10
};

function hoyISO() {
  return new Date().toISOString().split('T')[0];
}

export async function consumir(e, area) {
  const kv = gKV(e, 'agente');
  if (!kv) return true;
  const clave = 'presupuesto:' + hoyISO() + ':' + area;
  const actual = parseInt(await kv.get(clave) || '0');
  const limite = LIMITES_PRESUPUESTO[area] || 50;
  if (actual >= limite) return false;
  await kv.put(clave, String(actual + 1), { expirationTtl: 86400 });
  return true;
}

export async function disponible(e, area) {
  const kv = gKV(e, 'agente');
  if (!kv) return true;
  const clave = 'presupuesto:' + hoyISO() + ':' + area;
  const actual = parseInt(await kv.get(clave) || '0');
  const limite = LIMITES_PRESUPUESTO[area] || 50;
  return actual < limite;
}

export async function estadoPresupuesto(e) {
  const kv = gKV(e, 'agente');
  if (!kv) return {};
  const res = {};
  for (const area of Object.keys(LIMITES_PRESUPUESTO)) {
    const clave = 'presupuesto:' + hoyISO() + ':' + area;
    const actual = parseInt(await kv.get(clave) || '0');
    res[area] = { usado: actual, limite: LIMITES_PRESUPUESTO[area], restante: LIMITES_PRESUPUESTO[area] - actual };
  }
  return res;
}

// ============================================================
// USO REAL DE CLOUDFLARE (absorbe shared.js)
// ============================================================
export async function consultarUsoReal(e) {
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
