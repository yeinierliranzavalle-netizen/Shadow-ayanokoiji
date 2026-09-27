export const MODELO = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const MODELO_LIGERO = '@cf/meta/llama-3.1-8b-instruct';
export const MODELO_VISION = '@cf/meta/llama-3.2-11b-vision-instruct';
export const CS = 500 * 1024;
export const LPB = 120;
export const BPL = 5;
export const VENTANA = 80;

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

export function J(d) {
  return new Response(JSON.stringify(d), {
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
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
  for (let i = 0; i < b.length; i += p) {
    s += String.fromCharCode.apply(null, b.subarray(i, i + p));
  }
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
// AUTO-MIGRACIÓN ROBUSTA
// Crea tablas si no existen. Añade columnas si faltan.
// Nunca falla por "ya existe". Nunca sobreescribe datos.
// ============================================================

const ESQUEMA = {
  historial: [
    ['user_id', 'TEXT'], ['mensaje', 'TEXT'], ['respuesta', 'TEXT'], ['fecha', 'INTEGER']
  ],
  archivos: [
    ['id', 'TEXT'], ['nombre', 'TEXT'], ['tamaño', 'INTEGER'],
    ['chunks', 'INTEGER'], ['destino', 'TEXT'], ['fecha', 'INTEGER']
  ],
  contexto: [
    ['fecha', 'INTEGER'], ['resumen', 'TEXT'], ['fases', 'TEXT'], ['fuente', 'TEXT']
  ],
  workers: [
    ['nombre', 'TEXT'], ['codigo', 'TEXT'], ['fecha', 'INTEGER']
  ],
  procesos: [
    ['id', 'TEXT'], ['archivo_id', 'TEXT'], ['estado', 'TEXT'],
    ['bloques_total', 'INTEGER'], ['bloques_hechos', 'INTEGER'],
    ['resumen_parcial', 'TEXT'], ['error', 'TEXT'],
    ['fecha_inicio', 'INTEGER'], ['fecha_fin', 'INTEGER'], ['fecha_avance', 'INTEGER']
  ],
  resumenes_chat: [
    ['user_id', 'TEXT'], ['fecha', 'INTEGER'], ['resumen', 'TEXT'],
    ['desde', 'INTEGER'], ['hasta', 'INTEGER']
  ],
  historial_largo: [
    ['user_id', 'TEXT'], ['rol', 'TEXT'], ['contenido', 'TEXT'],
    ['orden', 'INTEGER'], ['fecha', 'INTEGER']
  ],
  notificaciones: [
    ['tipo', 'TEXT'], ['titulo', 'TEXT'], ['mensaje', 'TEXT'],
    ['leida', 'INTEGER DEFAULT 0'], ['fecha', 'INTEGER']
  ],
  suscripciones_push: [
    ['endpoint', 'TEXT'], ['keys_p256dh', 'TEXT'], ['keys_auth', 'TEXT'],
    ['user_agent', 'TEXT'], ['creada', 'INTEGER'], ['activa', 'INTEGER DEFAULT 1']
  ],
  tareas: [
    ['tipo', 'TEXT'], ['descripcion', 'TEXT'], ['payload', 'TEXT'],
    ['estado', "TEXT DEFAULT 'pendiente'"], ['prioridad', 'INTEGER DEFAULT 5'],
    ['intentos', 'INTEGER DEFAULT 0'], ['creada', 'INTEGER'],
    ['ejecutada', 'INTEGER'], ['resultado', 'TEXT'], ['error', 'TEXT']
  ],
  acciones: [
    ['tipo', 'TEXT'], ['descripcion', 'TEXT'], ['exito', 'INTEGER'],
    ['detalle', 'TEXT'], ['fecha', 'INTEGER']
  ],
  workers_registrados: [
    ['nombre', 'TEXT'], ['url', 'TEXT'], ['codigo', 'TEXT'],
    ['version', 'INTEGER DEFAULT 1'], ['activo', 'INTEGER DEFAULT 1'],
    ['creado', 'INTEGER'], ['actualizado', 'INTEGER']
  ],
  plantillas: [
    ['tipo', 'TEXT'], ['descripcion', 'TEXT'], ['prompt', 'TEXT'],
    ['frecuencia_horas', 'INTEGER DEFAULT 24'],
    ['ultima_gen', 'INTEGER DEFAULT 0'], ['activa', 'INTEGER DEFAULT 1']
  ],
  publicaciones: [
    ['tipo', 'TEXT'], ['contenido', 'TEXT'], ['canales', 'TEXT'],
    ['estado', 'TEXT'], ['programada', 'INTEGER'], ['publicada', 'INTEGER'],
    ['resultado', 'TEXT'], ['creada', 'INTEGER']
  ],
  sandbox_escenarios: [
    ['tipo', 'TEXT'], ['contexto', 'TEXT'], ['decision_tomada', 'TEXT'],
    ['resultado', 'TEXT'], ['autoevaluacion', 'TEXT'],
    ['puntuacion', 'INTEGER'], ['creado', 'INTEGER'], ['completado', 'INTEGER']
  ],
  sandbox_lecciones: [
    ['escenario_id', 'INTEGER'], ['area', 'TEXT'],
    ['leccion', 'TEXT'], ['creada', 'INTEGER']
  ],
  sandbox_metricas: [
    ['fecha', 'INTEGER'], ['escenarios_totales', 'INTEGER'],
    ['puntuacion_promedio', 'REAL'], ['area_debil', 'TEXT']
  ]
};

export async function migrar(e, forzar = false) {
  const db = e.DB;
  if (!db) return { ok: false, error: 'Sin D1.' };
  const kv = e.KV;

  // Marca para no migrar cada request (excepto si forzar=true)
  if (kv && !forzar) {
    try {
      const hecho = await kv.get('migrado_v8');
      if (hecho === 'ok') return { ok: true, cached: true };
    } catch (x) {}
  }

  const resultado = { ok: true, creadas: [], columnas: [], errores: [] };

  for (const [tabla, columnas] of Object.entries(ESQUEMA)) {
    // 1. Verificar si la tabla existe
    let existe = false;
    try {
      const check = await db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).bind(tabla).first();
      existe = !!check;
    } catch (x) {
      resultado.errores.push(tabla + ': ' + x.message);
      continue;
    }

    // 2. Si no existe, crearla
    if (!existe) {
      try {
        const cols = columnas.map(([n, t]) => n + ' ' + t).join(', ');
        await db.prepare('CREATE TABLE IF NOT EXISTS ' + tabla + ' (id INTEGER PRIMARY KEY AUTOINCREMENT, ' + cols + ')').run();
        resultado.creadas.push(tabla);
        // Índices útiles
        if (tabla === 'historial_largo') {
          try { await db.prepare("CREATE INDEX IF NOT EXISTS idx_hl_user_orden ON historial_largo(user_id, orden)").run(); } catch (x) {}
        }
        if (tabla === 'notificaciones') {
          try { await db.prepare("CREATE INDEX IF NOT EXISTS idx_notif_leida ON notificaciones(leida, fecha)").run(); } catch (x) {}
        }
        if (tabla === 'tareas') {
          try { await db.prepare("CREATE INDEX IF NOT EXISTS idx_tareas_estado ON tareas(estado, prioridad)").run(); } catch (x) {}
        }
      } catch (x) {
        resultado.errores.push(tabla + ' (create): ' + x.message);
      }
      continue;
    }

    // 3. Si existe, verificar columnas
    try {
      const info = await db.prepare('PRAGMA table_info(' + tabla + ')').all();
      const existentes = new Set((info.results || []).map(c => c.name));
      for (const [nombre, tipo] of columnas) {
        if (!existentes.has(nombre)) {
          try {
            await db.prepare('ALTER TABLE ' + tabla + ' ADD COLUMN ' + nombre + ' ' + tipo).run();
            resultado.columnas.push(tabla + '.' + nombre);
          } catch (x) {
            resultado.errores.push(tabla + '.' + nombre + ': ' + x.message);
          }
        }
      }
    } catch (x) {
      resultado.errores.push(tabla + ' (pragma): ' + x.message);
    }
  }

  // 4. Plantillas iniciales (si la tabla existe)
  try {
    await db.prepare(`INSERT OR IGNORE INTO plantillas (tipo, descripcion, prompt, frecuencia_horas) VALUES
      ('lore', 'Historia corta del multiverso', 'Eres el narrador del multiverso Shadow Arise. Escribe un fragmento corto (máx 200 palabras) sobre un personaje de anime en su día a día, como si fuera real. Estilo narrativo, cinematográfico. Termina con el nombre del personaje entre asteriscos.', 24),
      ('teaser', 'Avance de personaje nuevo', 'Genera un teaser críptico (máx 120 palabras) sobre un nuevo personaje que se unirá a Shadow Arise. No digas su nombre. Solo pistas: rasgos, un diálogo enigmático. Termina con "¿Adivinas quién?"', 48),
      ('dialogo', 'Conversación entre personajes', 'Escribe un diálogo (máx 250 palabras) entre dos personajes del multiverso Shadow Arise. Cada línea empieza con el nombre del personaje en negrita.', 12),
      ('provocacion', 'Pregunta abierta', 'Genera una pregunta provocadora (máx 80 palabras) sobre estrategia, poder o libertad. Estilo Ayanokōji.', 24),
      ('anuncio', 'Actualización del proyecto', 'Escribe un anuncio breve (máx 150 palabras) sobre el progreso del proyecto Shadow Arise. Tono: confiado, directo.', 72)
    `).run();
  } catch (x) {
    resultado.errores.push('plantillas init: ' + x.message);
  }

  // 5. Marca de migración
  if (kv && resultado.errores.length === 0) {
    try { await kv.put('migrado_v8', 'ok', { expirationTtl: 3600 }); } catch (x) {}
  }

  return resultado;
}

// ============================================================
// ANTI-ALUCINACIÓN: verificar que algo exista antes de responder
// ============================================================
export async function verificar(e, tipo, nombre) {
  const db = e.DB;
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
