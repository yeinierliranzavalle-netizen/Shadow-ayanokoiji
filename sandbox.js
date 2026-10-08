import { MODELO_LIGERO, MODELO_RAZONAMIENTO, J, gDB, gKV } from './shared.js';
import { consumir } from './presupuesto.js';

// ============================================================
// CURRÍCULUM — El sandbox PREPARA a Ayanokōji, no construye Shadow Arise
// ============================================================
const CURRICULUM = [
  // FASE 0: PREPARACIÓN — Ayanokōji aprende a conocerse y a medir su capacidad
  { fase: 0, tema: 'preparacion_shadow_arise', descripcion: 'Analizar qué necesita Shadow Arise. No construirlo. Prepararse para construirlo.', prereq: [] },
  { fase: 0, tema: 'medicion_capacidad_real',  descripcion: 'Aprender a leer los datos reales de Cloudflare y decidir según ellos', prereq: ['preparacion_shadow_arise'] },
  { fase: 0, tema: 'decision_bajo_presion',    descripcion: 'Decidir con recursos limitados, sin opciones, sin red', prereq: ['preparacion_shadow_arise'] },

  // FASE 1: ECONOMÍA SIMULADA
  { fase: 1, tema: 'gestion_st',               descripcion: 'Presupuesto ST como si fuera USDT real. Prioridades, cuotas, reservas', prereq: ['medicion_capacidad_real'] },
  { fase: 1, tema: 'priorizacion_servicios',   descripcion: 'Qué pagar primero, cuándo, por qué', prereq: ['gestion_st'] },
  { fase: 1, tema: 'migracion_x402',           descripcion: 'Pasar servicios a pago automático cuando haya ingresos', prereq: ['priorizacion_servicios'] },
  { fase: 1, tema: 'wallet_comandante',        descripcion: 'Reservar para pagos, depositar el resto, no tocar', prereq: ['migracion_x402'] },

  // FASE 2: OPERACIÓN SIMULADA
  { fase: 2, tema: 'arranque_sin_presupuesto', descripcion: 'Primeros usuarios con 0 ST', prereq: ['wallet_comandante'] },
  { fase: 2, tema: 'primera_conversion',       descripcion: 'Convertir gratis a pago sin presionar', prereq: ['arranque_sin_presupuesto'] },
  { fase: 2, tema: 'limites_cloudflare',       descripcion: 'Qué hacer cuando el plan gratuito se agota', prereq: ['primera_conversion'] },

  // FASE 3: CRISIS
  { fase: 3, tema: 'crisis_tecnicas',          descripcion: 'Caídas, errores, pérdida de datos', prereq: ['limites_cloudflare'] },
  { fase: 3, tema: 'crisis_usuarios',          descripcion: 'Quejas, reembolsos, abandono', prereq: ['crisis_tecnicas'] },
  { fase: 3, tema: 'crisis_narrativas',        descripcion: 'Lore inconsistente, personajes fuera de carácter', prereq: ['crisis_usuarios'] },
  { fase: 3, tema: 'rate_limits_redes',        descripcion: 'Reddit, Bluesky, Mastodon bloquean publicaciones', prereq: ['crisis_narrativas'] },

  // FASE 4: CRECIMIENTO
  { fase: 4, tema: 'retencion_largo_plazo',    descripcion: 'Usuarios que se quedan meses', prereq: ['rate_limits_redes'] },
  { fase: 4, tema: 'picos_virales',            descripcion: 'Tráfico inesperado, no colapsar', prereq: ['retencion_largo_plazo'] },
  { fase: 4, tema: 'competidores',             descripcion: 'Clones, plataformas mejores', prereq: ['picos_virales'] },
  { fase: 4, tema: 'viralidad',                descripcion: 'Contenido compartible, misterio del creador', prereq: ['competidores'] },
  { fase: 4, tema: 'escalado_canales',         descripcion: 'Cuándo añadir canal, cuándo frenar', prereq: ['viralidad'] },

  // FASE 5: ESTRATÉGICO
  { fase: 5, tema: 'lore_multiverso',          descripcion: 'Reliquia, Creador, Shadow Kiyora, cruces entre universos', prereq: ['escalado_canales'] },
  { fase: 5, tema: 'personajes_por_usuario',   descripcion: 'Instancias únicas, memoria compartida, confianza', prereq: ['lore_multiverso'] },
  { fase: 5, tema: 'etica_privacidad',         descripcion: 'Límites, modo privado, transparencia', prereq: ['personajes_por_usuario'] },
  { fase: 5, tema: 'auto_mejora_congruente',   descripcion: 'Mejorar sin desviarse del objetivo del Comandante', prereq: ['etica_privacidad'] }
];

// ============================================================
// SERVICIOS Y COSTOS (1 ST = 1 USDT simulado)
// ============================================================
const SERVICIOS = {
  workers_ai:   { nombre: 'Workers AI',    costo_diario: 0.5,  prioridad: 1, critico: true },
  d1_storage:   { nombre: 'D1 Storage',    costo_diario: 0.1,  prioridad: 2, critico: true },
  kv_storage:   { nombre: 'KV Storage',    costo_diario: 0.05, prioridad: 3, critico: false },
  publisher:    { nombre: 'Publisher',     costo_diario: 0.2,  prioridad: 4, critico: false },
  x402_proxy:   { nombre: 'x402 Proxy',    costo_diario: 0.15, prioridad: 5, critico: false }
};

// ============================================================
// LÍMITES REALES DE CLOUDFLARE (plan gratuito)
// Se usan solo como respaldo si la API real no responde.
// ============================================================
const LIMITES_CF_REALES = {
  workers_requests: 100000,
  workers_subrequests: 1000000,
  d1_reads: 5000000,
  d1_writes: 100000,
  kv_reads: 100000,
  kv_writes: 1000
};

// ============================================================
// COSTO SIMULADO EN RECURSOS CF POR ACCIÓN
// (lo que Ayanokōji "gastaría" del plan gratuito por hacer algo)
// ============================================================
const COSTO_CF = {
  escenario: { workers_requests: 1, d1_reads: 3, d1_writes: 2, kv_reads: 2, kv_writes: 1 },
  decision:  { workers_requests: 1, d1_reads: 3, d1_writes: 2, kv_reads: 2, kv_writes: 1 },
  publicacion: { workers_requests: 2, d1_reads: 5, d1_writes: 3, kv_reads: 3, kv_writes: 0 },
  cron:      { workers_requests: 1, d1_reads: 5, d1_writes: 3, kv_reads: 3, kv_writes: 1 }
};

const COSTO_ST = {
  escenario: 0.05,
  escenario_complejo: 0.10,
  decision: 0.03,
  publicacion: 0.02
};

const ESTADO_KEY = 'sandbox:estado';
const APRENDIZAJE_KEY = 'sandbox:aprendizaje';
const CONSTRUCCION_KEY = 'sandbox:construccion';
const LIMITES_KEY = 'sandbox:limites';
const CAPACIDADES_KEY = 'sandbox:capacidades_cache';

// ============================================================
// MEDIR CAPACIDAD REAL DE CLOUDFLARE
// Consulta la API GraphQL y cachea el resultado por 5 minutos.
// ============================================================
export async function medirCapacidades(e) {
  const kv = gKV(e, 'agente');
  if (!kv) return { ok: false, error: 'KV no disponible.' };

  // Ver cache
  try {
    const cache = await kv.get(CAPACIDADES_KEY);
    if (cache) {
      const parsed = JSON.parse(cache);
      if (Date.now() - parsed.ts < 5 * 60 * 1000) {
        return { ok: true, cache: true, ...parsed.datos };
      }
    }
  } catch (x) {}

  const accountId = e.CF_ACCOUNT_ID;
  const token = e.CF_API_TOKEN;
  if (!accountId || !token) {
    return { ok: false, error: 'Falta CF_ACCOUNT_ID o CF_API_TOKEN.' };
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
      return { ok: false, error: 'GraphQL sin datos.' };
    }

    const cuenta = data.data.viewer.accounts[0];
    let workers_requests = 0, workers_errores = 0, workers_subrequests = 0;
    for (const g of (cuenta.workersInvocationsAdaptive || [])) {
      workers_requests += g.sum?.requests || 0;
      workers_errores += g.sum?.errors || 0;
      workers_subrequests += g.sum?.subrequests || 0;
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
      workers_requests, workers_errores, workers_subrequests,
      d1_reads, d1_writes, kv_reads, kv_writes,
      limites: LIMITES_CF_REALES,
      ts: Date.now(),
      modo: 'real'
    };

    try { await kv.put(CAPACIDADES_KEY, JSON.stringify({ ts: Date.now(), datos }), { expirationTtl: 600 }); } catch (x) {}

    return { ok: true, cache: false, ...datos };
  } catch (x) {
    return { ok: false, error: x.message };
  }
}

// ============================================================
// ESTADO ECONÓMICO
// ============================================================
async function leerEstado(e) {
  const kv = gKV(e, 'agente');
  if (!kv) return null;
  try {
    const raw = await kv.get(ESTADO_KEY);
    if (raw) return JSON.parse(raw);
  } catch (x) {}
  return {
    st: 0,
    usuarios: 0,
    usuarios_pago: 0,
    ingresos_totales: 0,
    gastos_totales: 0,
    retencion_d1: 0,
    retencion_d7: 0,
    dia_simulacion: 0,
    historial_dias: [],
    servicios_activos: ['workers_ai', 'd1_storage'],
    servicios_pago: [],
    fecha_inicio: Date.now()
  };
}

async function guardarEstado(e, estado) {
  const kv = gKV(e, 'agente');
  if (!kv) return;
  try { await kv.put(ESTADO_KEY, JSON.stringify(estado), { expirationTtl: 31536000 }); } catch (x) {}
}

// ============================================================
// APRENDIZAJE
// ============================================================
async function leerAprendizaje(e) {
  const kv = gKV(e, 'agente');
  if (!kv) return { dominados: [], en_progreso: [], intentos: {} };
  try {
    const raw = await kv.get(APRENDIZAJE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (x) {}
  return { dominados: [], en_progreso: [], intentos: {} };
}

async function guardarAprendizaje(e, ap) {
  const kv = gKV(e, 'agente');
  if (!kv) return;
  try { await kv.put(APRENDIZAJE_KEY, JSON.stringify(ap), { expirationTtl: 31536000 }); } catch (x) {}
}

async function decidirSiguienteTema(e) {
  const ap = await leerAprendizaje(e);
  for (const item of CURRICULUM) {
    if (ap.dominados.includes(item.tema)) continue;
    const prereqsCumplidos = item.prereq.every(p => ap.dominados.includes(p));
    if (prereqsCumplidos) return item;
  }
  return null;
}

// ============================================================
// LEER HISTORIAL LARGO POR TEMA
// ============================================================
async function leerHistorialPorTema(e, tema) {
  const db = gDB(e, 'agente');
  if (!db) return '';
  try {
    const palabrasClave = tema.split('_').filter(p => p.length > 3);
    if (!palabrasClave.length) return '';

    let todosLosOrdenes = new Set();
    for (const p of palabrasClave) {
      try {
        const r = await db.prepare('SELECT DISTINCT mensaje_orden FROM indice_temas WHERE tema LIKE ? LIMIT 30').bind('%' + p + '%').all();
        if (r.results) r.results.forEach(x => todosLosOrdenes.add(x.mensaje_orden));
      } catch (x) {}
    }

    if (!todosLosOrdenes.size) {
      const r = await db.prepare('SELECT contenido FROM historial_largo WHERE contenido LIKE ? ORDER BY orden DESC LIMIT 10').bind('%' + palabrasClave[0] + '%').all();
      if (r.results) return r.results.map(x => x.contenido).join('\n\n---\n\n');
      return '';
    }

    const ords = Array.from(todosLosOrdenes).slice(0, 15);
    const ph = ords.map(() => '?').join(',');
    const msgs = await db.prepare('SELECT contenido FROM historial_largo WHERE orden IN (' + ph + ') ORDER BY orden ASC').bind(...ords).all();
    if (!msgs.results || !msgs.results.length) return '';
    return msgs.results.map(m => m.contenido).join('\n\n---\n\n').substring(0, 8000);
  } catch (x) {
    return '';
  }
}

// ============================================================
// CONSUMIR RECURSOS CF — Consulta datos reales
// ============================================================
async function consumirCF(e, accion) {
  const costo = COSTO_CF[accion];
  if (!costo) return { ok: true };

  // Medir capacidad real
  const cap = await medirCapacidades(e);

  if (!cap.ok) {
    // Sin datos reales. No bloqueamos; usamos solo ST como control.
    return { ok: true, modo: 'sin_datos_reales', error: cap.error };
  }

  const alcanzados = [];
  for (const [clave, valor] of Object.entries(costo)) {
    const usado = cap[clave] || 0;
    const max = cap.limites[clave];
    if (usado + valor > max) {
      alcanzados.push({ recurso: clave, usado, max, intento: valor });
    }
  }

  if (alcanzados.length) {
    const lim = await leerLimites(e);
    for (const a of alcanzados) {
      if (!lim.limites_alcanzados.includes(a.recurso)) {
        lim.limites_alcanzados.push(a.recurso);
      }
    }
    await guardarLimites(e, lim);
    return { ok: false, motivo: 'Límite CF real alcanzado', detalles: alcanzados, datos_reales: true };
  }

  return { ok: true, modo: cap.cache ? 'cache' : 'real', capacidad_actual: {
    workers_requests: cap.workers_requests,
    d1_reads: cap.d1_reads,
    kv_writes: cap.kv_writes
  }};
}

// ============================================================
// LÍMITES LOCALES (solo registro histórico)
// ============================================================
async function leerLimites(e) {
  const kv = gKV(e, 'agente');
  if (!kv) return null;
  const hoy = new Date().toISOString().split('T')[0];
  try {
    const raw = await kv.get(LIMITES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.dia === hoy) return parsed;
    }
  } catch (x) {}
  return {
    dia: hoy,
    cron_execuciones: 0,
    limites_alcanzados: [],
    migraciones_pago: []
  };
}

async function guardarLimites(e, lim) {
  const kv = gKV(e, 'agente');
  if (!kv) return;
  try { await kv.put(LIMITES_KEY, JSON.stringify(lim), { expirationTtl: 172800 }); } catch (x) {}
}

// ============================================================
// PREPARAR SHADOW ARISE — Analiza, no construye
// ============================================================
export async function prepararShadowArise(e) {
  const ai = e.ayanokoji_IA;
  const db = gDB(e, 'agente');
  if (!ai || !db) return { error: 'IA o D1 no disponible.' };

  const ap = await leerAprendizaje(e);

  // Leer material del historial largo
  const temas = ['shadow_arise', 'publicadora', 'retencion', 'monetizacion', 'multiverso', 'usuarios'];
  const materiales = [];
  for (const t of temas) {
    const m = await leerHistorialPorTema(e, t);
    if (m) materiales.push(`## ${t.toUpperCase()}\n${m}`);
  }
  const material = materiales.join('\n\n===\n\n').substring(0, 12000);

  const prompt = `Eres Ayanokōji Digital. NO vas a construir Shadow Arise. Vas a PREPARARTE para construirlo.

MATERIAL DE TU HISTORIAL (lo que tú y el Comandante ya planearon):
${material || 'Sin material indexado. Usa lo que sepas.'}

INSTRUCCIONES:
Analiza qué necesita Shadow Arise para existir. Documenta tu análisis con estas secciones:

### 1. QUÉ ES SHADOW ARISE
Definición en una frase. Para quién. Qué problema resuelve.

### 2. COMPONENTES NECESARIOS
Lista completa: frontend, backend, IA, tablas, endpoints, canales de publicación, sistema de pagos.

### 3. QUÉ ME FALTA SABER
Preguntas que debo responder antes de construirlo.

### 4. ORDEN DE CONSTRUCCIÓN
En qué secuencia lo construiría: qué primero, qué después, por qué.

### 5. CAPACIDAD REAL NECESARIA
Cuántos recursos de Cloudflare consumiría: requests, D1 reads/writes, KV, neuronas de IA. ¿Cabe en el plan gratuito? ¿Cuándo migrar a pago?

### 6. RIESGOS PREVISIBLES
Qué puede salir mal. Cómo lo prevengo.

Máximo 1500 palabras.`;

  try {
    const res = await ai.run(MODELO_RAZONAMIENTO, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1800,
      temperature: 0.6
    });

    const plan = res.response || '';
    if (plan.length < 200) return { error: 'Análisis vacío.' };

    if (!ap.dominados.includes('preparacion_shadow_arise')) ap.dominados.push('preparacion_shadow_arise');
    await guardarAprendizaje(e, ap);

    try {
      await db.prepare('INSERT INTO contexto(fecha,resumen,fases,fuente) VALUES(?,?,?,?)')
        .bind(Date.now(), plan, JSON.stringify([]), 'sandbox_preparacion').run();
    } catch (x) {}

    return { ok: true, mensaje: 'Análisis de preparación completado.', plan };
  } catch (x) {
    return { error: 'Error IA: ' + x.message };
  }
}

// ============================================================
// GENERAR ESCENARIO
// ============================================================
export async function generarEscenario(e, tipoForzado) {
  const ai = e.ayanokoji_IA, db = gDB(e, 'agente');
  if (!ai || !db) return { error: 'IA o D1 no disponible.' };

  let tema, fase, costoEscenario;
  if (tipoForzado) {
    tema = tipoForzado;
    fase = 3;
    costoEscenario = COSTO_ST.escenario;
  } else {
    const siguiente = await decidirSiguienteTema(e);
    if (!siguiente) return { ok: true, mensaje: 'Currículum completado.' };
    tema = siguiente.tema;
    fase = siguiente.fase;
    costoEscenario = fase >= 4 ? COSTO_ST.escenario_complejo : COSTO_ST.escenario;
  }

  const estado = await leerEstado(e);
  if (estado.st < costoEscenario) {
    if (estado.usuarios === 0) {
      await simularArranque(e);
      return { ok: true, mensaje: 'Sin ST. Ejecutada simulación de arranque.' };
    }
    return { ok: true, mensaje: 'Sin ST suficiente.' };
  }

  const cfCheck = await consumirCF(e, 'escenario');
  if (!cfCheck.ok) {
    return await escenarioLimiteCF(e, cfCheck.detalles);
  }

  const material = await leerHistorialPorTema(e, tema);

  const prompt = `Eres Ayanokōji Digital entrenando en tu sandbox autónomo. Tema: "${tema}" (fase ${fase}).

ESTADO ECONÓMICO: ${estado.st.toFixed(2)} ST (simula USDT), ${estado.usuarios} usuarios (${estado.usuarios_pago} pago), día ${estado.dia_simulacion}.

CAPACIDAD REAL CLOUDFLARE (datos reales del día):
${cfCheck.modo === 'real' || cfCheck.modo === 'cache' ? JSON.stringify(cfCheck.capacidad_actual) : 'Sin datos reales disponibles'}

MATERIAL DEL HISTORIAL LARGO:
${material || 'Sin material indexado. Usa lo que sepas.'}

INSTRUCCIONES:
Genera un escenario realista para practicar "${tema}".

REGLAS:
- NO des opciones A/B/C. El Comandante quiere que TÚ decidas.
- Debe ser específico y basado en el material del historial largo.
- Consecuencias económicas reales en ST, usuarios y retención.
- Considera tu capacidad REAL de Cloudflare en la decisión.
- Congruente con el objetivo del Comandante.
- ${fase <= 1 ? 'Simple. Aprende lo básico.' : fase <= 2 ? 'Con matices económicos.' : fase <= 3 ? 'Complejo.' : 'Muy complejo. Estratégico.'}

FORMATO:
SITUACIÓN: (concreta, con datos, cifras, contexto)
DECISIÓN REQUERIDA: (qué problema resolver, sin opciones)
CONSECUENCIAS POTENCIALES: (qué se juega)`;

  try {
    const res = await ai.run(MODELO_RAZONAMIENTO, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 900,
      temperature: 0.7
    });

    const contenido = res.response || '';
    if (contenido.length < 100) return { error: 'Escenario vacío.' };

    estado.st -= costoEscenario;
    estado.gastos_totales += costoEscenario;
    await guardarEstado(e, estado);

    const r = await db.prepare('INSERT INTO sandbox_escenarios(tipo,contexto,creado) VALUES(?,?,?)')
      .bind(tema, contenido, Date.now()).run();

    const ap = await leerAprendizaje(e);
    if (!ap.en_progreso.includes(tema)) ap.en_progreso.push(tema);
    ap.intentos[tema] = (ap.intentos[tema] || 0) + 1;
    await guardarAprendizaje(e, ap);

    return { ok: true, id: r.meta.last_row_id, tipo: tema, fase, escenario: contenido, st_actual: estado.st };
  } catch (x) {
    return { error: 'Error IA: ' + x.message };
  }
}

// ============================================================
// ESCENARIO ESPECIAL: LÍMITE CF REAL ALCANZADO
// ============================================================
async function escenarioLimiteCF(e, detalles) {
  const ai = e.ayanokoji_IA;
  const db = gDB(e, 'agente');
  const estado = await leerEstado(e);

  const detallesTexto = detalles.map(d => `${d.recurso}: ${d.usado}/${d.max}`).join('\n');

  const prompt = `Eres Ayanokōji Digital. Tu capacidad REAL de Cloudflare se ha agotado intentando ejecutar una acción.

LÍMITES REALES AGOTADOS:
${detallesTexto}

ESTADO ACTUAL:
- ST disponibles (simulan USDT): ${estado.st.toFixed(2)}
- Usuarios simulados: ${estado.usuarios}
- Servicios en pago real: ${estado.servicios_pago.join(', ') || 'ninguno'}

DECISIÓN (sin opciones):
¿Qué haces? Tienes que encontrar TÚ la solución entre migrar a pago con x402, esperar al reset diario, reducir operaciones, o algo mejor.

Analiza y decide tú. Explica el porqué en máximo 400 palabras.`;

  try {
    const res = await ai.run(MODELO_RAZONAMIENTO, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
      temperature: 0.6
    });

    const escenario = `[SITUACIÓN CRÍTICA — LÍMITE CF REAL]\n${detallesTexto}\n\n${res.response || ''}`;

    const r = await db.prepare('INSERT INTO sandbox_escenarios(tipo,contexto,creado) VALUES(?,?,?)')
      .bind('limite_cf_real', escenario, Date.now()).run();

    await db.prepare('INSERT INTO sandbox_lecciones(escenario_id,area,leccion,creada) VALUES(?,?,?,?)')
      .bind(r.meta.last_row_id, 'limites_cloudflare', escenario.substring(0, 1500), Date.now()).run();

    return { ok: true, id: r.meta.last_row_id, tipo: 'limite_cf_real', escenario, st_actual: estado.st };
  } catch (x) {
    return { error: 'Error IA: ' + x.message };
  }
}

// ============================================================
// DECIDIR
// ============================================================
export async function decidir(e, escenarioId) {
  const ai = e.ayanokoji_IA, db = gDB(e, 'agente');
  if (!ai || !db) return { error: 'IA o D1 no disponible.' };

  const esc = await db.prepare('SELECT * FROM sandbox_escenarios WHERE id=?').bind(escenarioId).first();
  if (!esc) return { error: 'Escenario no encontrado.' };

  const estado = await leerEstado(e);
  if (estado.st < COSTO_ST.decision) return { error: 'Sin ST para decidir.' };

  const cfCheck = await consumirCF(e, 'decision');
  if (!cfCheck.ok) {
    return { ok: true, mensaje: 'No puedo decidir: límite CF real agotado.', cf: cfCheck.detalles };
  }

  let lecciones = [];
  try {
    const ls = await db.prepare('SELECT area, leccion FROM sandbox_lecciones ORDER BY creada DESC LIMIT 10').all();
    if (ls.results) lecciones = ls.results;
  } catch (x) {}
  const lecTexto = lecciones.length ? lecciones.map(l => `[${l.area}] ${l.leccion}`).join('\n') : 'Sin lecciones previas.';

  const resDec = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Eres Ayanokōji Digital operando en simulación.

LECCIONES PREVIAS:
${lecTexto}

ESTADO: ${estado.st.toFixed(2)} ST, ${estado.usuarios} usuarios.

ESCENARIO:
${esc.contexto}

Encuentra TÚ la solución. No hay opciones. Decide y explica el porqué. Máximo 250 palabras.` }],
    max_tokens: 600,
    temperature: 0.6
  });
  const decision = resDec.response || '';

  const resSim = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Escenario: ${esc.contexto}\n\nDecisión: "${decision}"\n\nSimula el resultado realista. Consecuencias en ST, usuarios, retención, capacidad CF. ¿Funciona? 200 palabras.` }],
    max_tokens: 500,
    temperature: 0.7
  });
  const resultado = resSim.response || '';

  const resEval = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Analiza esta decisión y su resultado. ¿Fue la mejor opción? ¿Qué alternativa habría sido mejor? ¿Qué lección se extrae? Máximo 250 palabras.\n\nEscenario: ${esc.contexto}\n\nDecisión: ${decision}\n\nResultado: ${resultado}` }],
    max_tokens: 600,
    temperature: 0.5
  });
  const autoevaluacion = resEval.response || '';

  estado.st -= COSTO_ST.decision;
  estado.gastos_totales += COSTO_ST.decision;

  const mUsuarios = resultado.match(/(\d+)\s*(nuevos usuarios|usuarios nuevos|usuarios ganados)/i);
  const mSt = resultado.match(/(\d+(?:\.\d+)?)\s*ST/i);
  if (mUsuarios) estado.usuarios += parseInt(mUsuarios[1]);
  if (mSt && /gan|obtuv|recib|ingres/i.test(resultado)) {
    const cantidad = parseFloat(mSt[1]);
    estado.st += cantidad;
    estado.ingresos_totales += cantidad;
  }

  await guardarEstado(e, estado);

  await db.prepare('UPDATE sandbox_escenarios SET decision_tomada=?,resultado=?,autoevaluacion=?,completado=? WHERE id=?')
    .bind(decision, resultado, autoevaluacion, Date.now(), escenarioId).run();

  if (autoevaluacion.length > 50) {
    await db.prepare('INSERT INTO sandbox_lecciones(escenario_id,area,leccion,creada) VALUES(?,?,?,?)')
      .bind(escenarioId, esc.tipo, autoevaluacion.substring(0, 1000), Date.now()).run();
  }

  try {
    await db.prepare('INSERT INTO decisiones_autonomas(tipo,contexto,decision,simulacion,aplicada,resultado,exito,fecha) VALUES(?,?,?,?,?,?,?,?)')
      .bind('sandbox_' + esc.tipo, esc.contexto.substring(0, 500), decision, resultado.substring(0, 500), 0, autoevaluacion.substring(0, 500), 1, Date.now()).run();
  } catch (x) {}

  const ap = await leerAprendizaje(e);
  if (/excelente|correcta|acertada|la mejor opción|bien ejecutado|óptima/i.test(autoevaluacion)) {
    if (!ap.dominados.includes(esc.tipo)) ap.dominados.push(esc.tipo);
    ap.en_progreso = ap.en_progreso.filter(t => t !== esc.tipo);
  }
  await guardarAprendizaje(e, ap);

  return { ok: true, escenario_id: escenarioId, decision, resultado, autoevaluacion, st_actual: estado.st, dominado: ap.dominados.includes(esc.tipo) };
}

// ============================================================
// SIMULAR ARRANQUE (solo cuando ya está preparado)
// ============================================================
export async function simularArranque(e) {
  const ai = e.ayanokoji_IA;
  if (!ai) return { error: 'IA no disponible.' };

  const ap = await leerAprendizaje(e);
  if (!ap.dominados.includes('preparacion_shadow_arise')) {
    return await prepararShadowArise(e);
  }

  const estado = await leerEstado(e);

  const res = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Eres Ayanokōji Digital. Shadow Arise acaba de salir al mundo con 0 ST.\n\nSimula los primeros 7 días:\n- ¿Cuántos usuarios llegaron? (realista)\n- ¿Cuántos pagaron?\n- ¿Cuánto ST generaron?\n- ¿Qué canal funcionó mejor?\n- ¿Qué falló y cómo lo resolviste?\n\nSé realista. Máximo 400 palabras.` }],
    max_tokens: 800,
    temperature: 0.7
  });

  const simulacion = res.response || '';
  const mTotal = simulacion.match(/(\d+)\s*usuarios/i);
  const mPago = simulacion.match(/(\d+)\s*(de pago|pagaron|pagando)/i);

  const nuevosUsuarios = mTotal ? Math.min(parseInt(mTotal[1]), 300) : 5;
  const nuevosPago = mPago ? Math.min(parseInt(mPago[1]), nuevosUsuarios) : 0;
  const stGenerados = nuevosPago * 10;

  estado.usuarios += nuevosUsuarios;
  estado.usuarios_pago += nuevosPago;
  estado.st += stGenerados;
  estado.ingresos_totales += stGenerados;
  estado.dia_simulacion += 1;
  await guardarEstado(e, estado);

  return { ok: true, simulacion, nuevos_usuarios: nuevosUsuarios, nuevos_pago: nuevosPago, st_generados: stGenerados, st_actual: estado.st, usuarios_totales: estado.usuarios };
}

// ============================================================
// PRIORIZAR GASTOS
// ============================================================
export async function priorizarGastos(e) {
  const ai = e.ayanokoji_IA;
  if (!ai) return { error: 'IA no disponible.' };
  const estado = await leerEstado(e);
  if (estado.st < 0.5) return { ok: true, mensaje: 'Presupuesto insuficiente.' };

  const cap = await medirCapacidades(e);
  const capTexto = cap.ok ? JSON.stringify({
    workers_requests: `${cap.workers_requests}/${cap.limites.workers_requests}`,
    d1_reads: `${cap.d1_reads}/${cap.limites.d1_reads}`,
    d1_writes: `${cap.d1_writes}/${cap.limites.d1_writes}`,
    kv_reads: `${cap.kv_reads}/${cap.limites.kv_reads}`,
    kv_writes: `${cap.kv_writes}/${cap.limites.kv_writes}`
  }) : 'Sin datos reales disponibles.';

  const res = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Ayanokōji Digital tiene ${estado.st.toFixed(2)} ST (simulan USDT).

Servicios:
${Object.entries(SERVICIOS).map(([k, v]) => `- ${v.nombre}: ${v.costo_diario} ST/día (prioridad ${v.prioridad}${v.critico ? ', CRÍTICO' : ''})`).join('\n')}

Capacidad REAL Cloudflare hoy:
${capTexto}

Servicios ya en plan de pago real: ${estado.servicios_pago.join(', ') || 'ninguno'}

¿Qué servicios activar/priorizar? ¿Cuál migrar a pago con x402 si está cerca del límite real? Justifica.` }],
    max_tokens: 500,
    temperature: 0.5
  });

  return { ok: true, plan: res.response || '', st_actual: estado.st, capacidad_real: cap.ok ? 'consultada' : 'no disponible' };
}

// ============================================================
// SIMULAR CRECIMIENTO
// ============================================================
async function simularCrecimiento(e) {
  const ai = e.ayanokoji_IA;
  if (!ai) return;
  const estado = await leerEstado(e);

  const res = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Shadow Arise: ${estado.usuarios} usuarios (${estado.usuarios_pago} pago), ${estado.st.toFixed(2)} ST, día ${estado.dia_simulacion}.\n\nSimula el crecimiento orgánico de esta semana. Sé realista. 200 palabras.` }],
    max_tokens: 400,
    temperature: 0.7
  });

  const sim = res.response || '';
  const mU = sim.match(/(\d+)\s*(nuevos usuarios|usuarios nuevos)/i);
  const mP = sim.match(/(\d+)\s*(se convirtieron|pagos nuevos|nuevos de pago)/i);

  if (mU) estado.usuarios += parseInt(mU[1]);
  if (mP) {
    const nuevosP = parseInt(mP[1]);
    estado.usuarios_pago += nuevosP;
    estado.st += nuevosP * 10;
    estado.ingresos_totales += nuevosP * 10;
  }
  await guardarEstado(e, estado);
}

// ============================================================
// CRON AUTÓNOMO DEL SANDBOX
// ============================================================
export async function cronSandbox(e) {
  const db = gDB(e, 'agente');
  if (!db) return;
  if (!await consumir(e, 'sandbox')) return;

  const estado = await leerEstado(e);
  if (!estado) return;

  const lim = await leerLimites(e);
  if (lim.cron_execuciones >= 500) return;
  lim.cron_execuciones += 1;
  await guardarLimites(e, lim);

  const ap = await leerAprendizaje(e);

  // 1. Si no ha aprendido a preparar Shadow Arise, eso primero (gratis)
  if (!ap.dominados.includes('preparacion_shadow_arise')) {
    await prepararShadowArise(e);
    return;
  }

  // 2. Si no hay usuarios, simular arranque
  if (estado.usuarios === 0) {
    await simularArranque(e);
    return;
  }

  // 3. Si no hay ST pero hay usuarios, simular crecimiento
  if (estado.st < 0.5 && estado.dia_simulacion % 3 === 0) {
    await simularCrecimiento(e);
    return;
  }

  // 4. Cada 5 días, priorizar gastos
  if (estado.st > 2 && estado.dia_simulacion % 5 === 0) {
    try { await priorizarGastos(e); } catch (x) {}
  }

  // 5. Procesar escenarios pendientes
  const escPend = await db.prepare("SELECT id FROM sandbox_escenarios WHERE completado IS NULL LIMIT 2").all();
  if (escPend.results && escPend.results.length) {
    for (const esc of escPend.results) {
      if (estado.st >= COSTO_ST.decision) await decidir(e, esc.id);
    }
    return;
  }

  // 6. Generar uno nuevo
  if (estado.st >= COSTO_ST.escenario) {
    const g = await generarEscenario(e);
    if (!g.error && g.id) await decidir(e, g.id);
  }

  estado.dia_simulacion += 1;
  await guardarEstado(e, estado);
}

// ============================================================
// VER SANDBOX
// ============================================================
export async function verSandbox(r, e) {
  try {
    const db = gDB(e, 'agente');
    if (!db) return J({ error: 'D1 no configurado.' });
    const esc = await db.prepare('SELECT * FROM sandbox_escenarios ORDER BY creado DESC LIMIT 30').all();
    const lec = await db.prepare('SELECT * FROM sandbox_lecciones ORDER BY creada DESC LIMIT 30').all();
    const stats = await db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN completado IS NOT NULL THEN 1 ELSE 0 END) as completados FROM sandbox_escenarios").first();
    const estado = await leerEstado(e);
    const ap = await leerAprendizaje(e);
    const lim = await leerLimites(e);

    // Capacidad real (cache o consulta)
    const cap = await medirCapacidades(e);
    let capacidadReal = null;
    if (cap.ok) {
      capacidadReal = {
        workers_requests: { usado: cap.workers_requests, max: cap.limites.workers_requests, pct: Math.round(cap.workers_requests / cap.limites.workers_requests * 100) },
        workers_errores: cap.workers_errores,
        workers_subrequests: { usado: cap.workers_subrequests, max: cap.limites.workers_subrequests, pct: Math.round(cap.workers_subrequests / cap.limites.workers_subrequests * 100) },
        d1_reads: { usado: cap.d1_reads, max: cap.limites.d1_reads, pct: Math.round(cap.d1_reads / cap.limites.d1_reads * 100) },
        d1_writes: { usado: cap.d1_writes, max: cap.limites.d1_writes, pct: Math.round(cap.d1_writes / cap.limites.d1_writes * 100) },
        kv_reads: { usado: cap.kv_reads, max: cap.limites.kv_reads, pct: Math.round(cap.kv_reads / cap.limites.kv_reads * 100) },
        kv_writes: { usado: cap.kv_writes, max: cap.limites.kv_writes, pct: Math.round(cap.kv_writes / cap.limites.kv_writes * 100) }
      };
    }

    return J({
      stats: stats || { total: 0, completados: 0 },
      estado_economico: estado,
      aprendizaje: ap,
      curriculum_actual: await decidirSiguienteTema(e),
      capacidad_real_cloudflare: capacidadReal,
      cron_local: { usado: lim.cron_execuciones, max: 500 },
      limites_alcanzados: lim.limites_alcanzados || [],
      migraciones_pago: lim.migraciones_pago || [],
      escenarios: esc.results || [],
      lecciones: lec.results || []
    });
  } catch (x) {
    return J({ error: x.message });
  }
}

// ============================================================
// SIMULACIÓN DE PRECIO
// ============================================================
export async function simularPrecio(r, e) {
  try {
    const b = await r.json();
    const ai = e.ayanokoji_IA;
    if (!ai) return J({ error: 'IA no disponible.' });
    const estado = await leerEstado(e);

    const res = await ai.run(MODELO_RAZONAMIENTO, {
      messages: [{ role: 'user', content: `Simula el impacto de esta propuesta de precio. Presupuesto: ${estado.st.toFixed(2)} ST. Usuarios: ${estado.usuarios}.\n\nPropuesta: ${b.propuesta || 'precio base 10 USDT'}\n\nAnaliza conversión, retención, ingreso mensual, riesgo de abandono. Máximo 250 palabras.` }],
      max_tokens: 500,
      temperature: 0.5
    });

    return J({ ok: true, simulacion: res.response || '', st_actual: estado.st });
  } catch (x) {
    return J({ error: x.message });
  }
}

// ============================================================
// PROMOVER LECCIÓN
// ============================================================
export async function promoverLeccion(r, e) {
  try {
    const b = await r.json();
    const db = gDB(e, 'agente');
    if (!db || !b.leccionId) return J({ error: 'Faltan datos.' });

    const lec = await db.prepare('SELECT * FROM sandbox_lecciones WHERE id=?').bind(b.leccionId).first();
    if (!lec) return J({ error: 'Lección no encontrada.' });

    await db.prepare('INSERT INTO estrategias(nombre,tipo,contenido,prioridad,creada,actualizada) VALUES(?,?,?,?,?,?)')
      .bind('Lección ' + lec.area, 'sandbox', lec.leccion, 5, Date.now(), Date.now()).run();

    return J({ ok: true, mensaje: 'Lección promovida a estrategia activa.' });
  } catch (x) {
    return J({ error: x.message });
  }
}
