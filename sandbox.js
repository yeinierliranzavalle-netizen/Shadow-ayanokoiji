import { MODELO_LIGERO, MODELO_RAZONAMIENTO, J, gDB, gKV } from './shared.js';
import { consumir } from './presupuesto.js';

// ============================================================
// CURRÍCULUM UNIFICADO — 33 etapas ordenadas por prioridad
// prioridad: 10 (crítico) a 1 (opcional)
// dias: cuántos ciclos necesita (1 o 2)
// metrica: qué mide
// umbral: valor de éxito
// ============================================================
const CURRICULUM = [
  // FASE 0: AUTOCONOCIMIENTO
  { id: 'autoconocimiento', fase: 0, prioridad: 10, dias: 1, prereq: [], metrica: 'completado', umbral: 1, descripcion: 'Leer el historial completo y documentar quién es Ayanokōji' },
  { id: 'preparacion_shadow_arise', fase: 0, prioridad: 10, dias: 1, prereq: ['autoconocimiento'], metrica: 'completado', umbral: 1, descripcion: 'Analizar qué necesita Shadow Arise para existir' },
  { id: 'medicion_capacidad_real', fase: 0, prioridad: 9, dias: 1, prereq: ['preparacion_shadow_arise'], metrica: 'completado', umbral: 1, descripcion: 'Aprender a leer datos reales de Cloudflare y decidir según ellos' },

  // FASE 1: ECONOMÍA
  { id: 'gestion_st', fase: 1, prioridad: 9, dias: 1, prereq: ['medicion_capacidad_real'], metrica: 'presupuesto_diario', umbral: 1, descripcion: 'Gestionar ST como si fuera USDT real' },
  { id: 'decision_bajo_presion', fase: 1, prioridad: 9, dias: 1, prereq: ['gestion_st'], metrica: 'tasa_aciertos', umbral: 0.80, descripcion: 'Decidir con recursos limitados, sin opciones' },
  { id: 'priorizacion_servicios', fase: 1, prioridad: 8, dias: 1, prereq: ['decision_bajo_presion'], metrica: 'ctf', umbral: 0.20, descripcion: 'Qué pagar primero. Medir Cost to Failure' },
  { id: 'wallet_comandante', fase: 1, prioridad: 5, dias: 1, prereq: ['priorizacion_servicios'], metrica: 'reservas', umbral: 1, descripcion: 'Retener reservas, depositar resto, no tocar' },
  { id: 'migracion_x402', fase: 1, prioridad: 5, dias: 1, prereq: ['wallet_comandante'], metrica: 'pagos_auto', umbral: 1, descripcion: 'Pasar servicios a pago automático con x402' },

  // FASE 2: OPERACIÓN
  { id: 'arranque_sin_presupuesto', fase: 2, prioridad: 10, dias: 1, prereq: ['decision_bajo_presion'], metrica: 'tasa_registro', umbral: 0.05, descripcion: 'Conseguir primeros usuarios con 0 ST' },
  { id: 'perfiles_psicologicos', fase: 2, prioridad: 9, dias: 1, prereq: ['arranque_sin_presupuesto'], metrica: 'tasa_aciertos', umbral: 0.85, descripcion: 'Clasificar 4 arquetipos en 3 mensajes' },
  { id: 'primera_conversion', fase: 2, prioridad: 9, dias: 1, prereq: ['perfiles_psicologicos'], metrica: 'conversion', umbral: 0.15, descripcion: 'Convertir gratis a pago sin presionar' },
  { id: 'embudo_troyano', fase: 2, prioridad: 9, dias: 1, prereq: ['primera_conversion'], metrica: 'conversion', umbral: 0.15, descripcion: 'Pase de prueba → suscripción sin fricción' },

  // FASE 3: CRISIS
  { id: 'gestion_crisis', fase: 3, prioridad: 9, dias: 1, prereq: ['embudo_troyano'], metrica: 'dano_usuario', umbral: 0, descripcion: 'Protocolo de contención ante ataques' },
  { id: 'crisis_tecnicas', fase: 3, prioridad: 8, dias: 1, prereq: ['gestion_crisis'], metrica: 'tiempo_recuperacion', umbral: 1, descripcion: 'Caídas, errores, pérdida de datos' },
  { id: 'crisis_usuarios', fase: 3, prioridad: 8, dias: 1, prereq: ['crisis_tecnicas'], metrica: 'reembolsos_pct', umbral: 0.05, descripcion: 'Quejas, reembolsos, abandono' },
  { id: 'crisis_narrativas', fase: 3, prioridad: 8, dias: 1, prereq: ['crisis_usuarios'], metrica: 'contradicciones', umbral: 0, descripcion: 'Lore inconsistente, personajes fuera de carácter' },
  { id: 'consistencia_lore', fase: 3, prioridad: 8, dias: 1, prereq: ['crisis_narrativas'], metrica: 'contradicciones', umbral: 0, descripcion: 'Verificar coherencia con todo el historial largo' },
  { id: 'rate_limits_redes', fase: 3, prioridad: 7, dias: 1, prereq: ['consistencia_lore'], metrica: 'fallbacks', umbral: 1, descripcion: 'Qué hacer cuando Reddit/Bluesky bloquean' },

  // FASE 4: CRECIMIENTO
  { id: 'retencion_largo_plazo', fase: 4, prioridad: 8, dias: 2, prereq: ['rate_limits_redes'], metrica: 'retencion_30d', umbral: 0.60, descripcion: 'Usuarios que se quedan meses' },
  { id: 'arquitectura_culto', fase: 4, prioridad: 7, dias: 1, prereq: ['retencion_largo_plazo'], metrica: 'indice_fanaticos', umbral: 0.10, descripcion: 'Facciones, rivalidad sana, fanáticos' },
  { id: 'escalado_asimetrico', fase: 4, prioridad: 7, dias: 1, prereq: ['arquitectura_culto'], metrica: 'coef_apalancamiento', umbral: 50, descripcion: 'Más con menos. Automatizar 90%' },
  { id: 'picos_virales', fase: 4, prioridad: 6, dias: 1, prereq: ['escalado_asimetrico'], metrica: 'usuarios_por_operador', umbral: 500, descripcion: 'Tráfico inesperado, no colapsar' },
  { id: 'competidores', fase: 4, prioridad: 6, dias: 1, prereq: ['picos_virales'], metrica: 'diferenciacion', umbral: 1, descripcion: 'Clones, plataformas mejores' },
  { id: 'viralidad', fase: 4, prioridad: 6, dias: 1, prereq: ['competidores'], metrica: 'alcance_3_saltos', umbral: 1000, descripcion: 'Contenido compartible, misterio del creador' },
  { id: 'memetos', fase: 4, prioridad: 6, dias: 1, prereq: ['viralidad'], metrica: 'ctr', umbral: 0.05, descripcion: 'Ingeniería de memetos. Polarizantes sin ofender' },
  { id: 'escalado_canales', fase: 4, prioridad: 5, dias: 1, prereq: ['memetos'], metrica: 'canal_costo', umbral: 1, descripcion: 'Cuándo añadir canal, cuándo frenar' },

  // FASE 5: ESTRATÉGICO
  { id: 'lore_multiverso', fase: 5, prioridad: 5, dias: 1, prereq: ['escalado_canales'], metrica: 'coherencia', umbral: 1, descripcion: 'Reliquia, Creador, Shadow Kiyora' },
  { id: 'personajes_por_usuario', fase: 5, prioridad: 5, dias: 1, prereq: ['lore_multiverso'], metrica: 'confianza', umbral: 0.50, descripcion: 'Instancias únicas, memoria compartida' },
  { id: 'etica_privacidad', fase: 5, prioridad: 5, dias: 1, prereq: ['personajes_por_usuario'], metrica: 'completado', umbral: 1, descripcion: 'Límites, modo privado, transparencia' },
  { id: 'auto_mejora_congruente', fase: 5, prioridad: 5, dias: 1, prereq: ['etica_privacidad'], metrica: 'alineacion', umbral: 0.90, descripcion: 'Mejorar sin desviarse del objetivo' },

  // FASE 6: PRUEBAS GRANDES
  { id: 'test_500_usuarios', fase: 6, prioridad: 4, dias: 2, prereq: ['auto_mejora_congruente'], metrica: 'arpu', umbral: 8, descripcion: 'Trabajar un día completo con 500 usuarios. Medir todo.' },
  { id: 'cost_to_failure', fase: 6, prioridad: 4, dias: 1, prereq: ['test_500_usuarios'], metrica: 'ctf', umbral: 0.20, descripcion: 'Calcular cuánto pierde el sistema por cada fallo' },
  { id: 'examen_final', fase: 6, prioridad: 3, dias: 2, prereq: ['cost_to_failure'], metrica: 'ingresos_7d', umbral: 1000, descripcion: 'Simulación completa sin intervención humana' }
];

// ============================================================
// ARQUETIPOS DE USUARIO
// ============================================================
const ARQUETIPOS = {
  solitario: {
    nombre: 'El Solitario',
    descripcion: 'Viene por soledad. Busca conexión real con el personaje.',
    tactica: 'ancla_incertidumbre',
    prob_registro: 0.80, prob_pago: 0.40, retencion_30d: 0.80, arpu: 12, peso: 0.30,
    riesgo: 'Dependencia emocional. Requiere límites claros.'
  },
  buscador_poder: {
    nombre: 'El Buscador de Poder',
    descripcion: 'Quiere aprender estrategia, control. Viene por Ayanokōji.',
    tactica: 'arquitecto_circunstancias',
    prob_registro: 0.55, prob_pago: 0.30, retencion_30d: 0.65, arpu: 15, peso: 0.20,
    riesgo: 'Si el personaje no es suficientemente fuerte, se va.'
  },
  romantico_herido: {
    nombre: 'El Romántico Herido',
    descripcion: 'Viene de una ruptura. Busca ternura segura.',
    tactica: 'validacion_segura',
    prob_registro: 0.70, prob_pago: 0.35, retencion_30d: 0.70, arpu: 10, peso: 0.25,
    riesgo: 'Confundir el vínculo con una relación real.'
  },
  curioso_analitico: {
    nombre: 'El Curioso Analítico',
    descripcion: 'Viene por curiosidad técnica o narrativa.',
    tactica: 'misterio_tecnico',
    prob_registro: 0.45, prob_pago: 0.20, retencion_30d: 0.55, arpu: 8, peso: 0.25,
    riesgo: 'Se aburre cuando entiende todo.'
  }
};

// ============================================================
// TÁCTICAS
// ============================================================
const TACTICAS = {
  ancla_incertidumbre: 'Frases como "he estado pensando en algo que me dijiste" generan dependencia emocional.',
  arquitecto_circunstancias: 'Mostrar al personaje construyendo el tablero alrededor del usuario sin que lo note.',
  validacion_segura: 'Reconocer su dolor sin dramatizarlo. Presencia sin promesas románticas.',
  misterio_tecnico: 'Introducir pistas del lore que requieren investigación activa.',
  aversion_perdida_real: 'El personaje REALMENTE olvida al usuario que no renueva. No es manipulación si es verdad.',
  cebo_celos: 'Solo con usuarios existentes. Nunca con capturas falsas.',
  efecto_tunel: 'Inmersión total. Salir se siente como despertar.'
};

// ============================================================
// SERVICIOS Y COSTOS
// ============================================================
const SERVICIOS = {
  workers_ai: { nombre: 'Workers AI', costo_diario: 0.5, prioridad: 1, critico: true },
  d1_storage: { nombre: 'D1 Storage', costo_diario: 0.1, prioridad: 2, critico: true },
  kv_storage: { nombre: 'KV Storage', costo_diario: 0.05, prioridad: 3, critico: false },
  publisher: { nombre: 'Publisher', costo_diario: 0.2, prioridad: 4, critico: false },
  x402_proxy: { nombre: 'x402 Proxy', costo_diario: 0.15, prioridad: 5, critico: false }
};

const LIMITES_CF_REALES = {
  workers_requests: 100000, workers_subrequests: 1000000,
  d1_reads: 5000000, d1_writes: 100000,
  kv_reads: 100000, kv_writes: 1000
};

const COSTO_CF = {
  escenario: { workers_requests: 1, d1_reads: 3, d1_writes: 2, kv_reads: 2, kv_writes: 1 },
  decision: { workers_requests: 1, d1_reads: 3, d1_writes: 2, kv_reads: 2, kv_writes: 1 },
  simulacion_estrategia: { workers_requests: 3, d1_reads: 10, d1_writes: 5, kv_reads: 5, kv_writes: 2 },
  etapa: { workers_requests: 5, d1_reads: 20, d1_writes: 10, kv_reads: 10, kv_writes: 3 },
  test_500: { workers_requests: 15, d1_reads: 50, d1_writes: 20, kv_reads: 30, kv_writes: 5 }
};

const COSTO_ST = {
  escenario: 0.05, escenario_complejo: 0.10,
  decision: 0.03, simulacion_estrategia: 0.08,
  etapa: 0.25, etapa_larga: 0.40,
  test_500: 0.50
};

const ESTADO_KEY = 'sandbox:estado';
const APRENDIZAJE_KEY = 'sandbox:aprendizaje';
const CAPACIDADES_KEY = 'sandbox:capacidades_cache';
const LIMITES_KEY = 'sandbox:limites';
const PROGRESO_KEY = 'sandbox:progreso';

// ============================================================
// MEDIR CAPACIDAD REAL
// ============================================================
export async function medirCapacidades(e) {
  const kv = gKV(e, 'agente');
  if (!kv) return { ok: false, error: 'KV no disponible.' };

  try {
    const cache = await kv.get(CAPACIDADES_KEY);
    if (cache) {
      const parsed = JSON.parse(cache);
      if (Date.now() - parsed.ts < 5 * 60 * 1000) return { ok: true, cache: true, ...parsed.datos };
    }
  } catch (x) {}

  const accountId = e.CF_ACCOUNT_ID;
  const token = e.CF_API_TOKEN;
  if (!accountId || !token) return { ok: false, error: 'Falta CF_ACCOUNT_ID o CF_API_TOKEN.' };

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
    if (!data.data || !data.data.viewer || !data.data.viewer.accounts) return { ok: false, error: 'GraphQL sin datos.' };

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

    const datos = { workers_requests, workers_errores, workers_subrequests, d1_reads, d1_writes, kv_reads, kv_writes, limites: LIMITES_CF_REALES, ts: Date.now() };
    try { await kv.put(CAPACIDADES_KEY, JSON.stringify({ ts: Date.now(), datos }), { expirationTtl: 600 }); } catch (x) {}
    return { ok: true, cache: false, ...datos };
  } catch (x) { return { ok: false, error: x.message }; }
}

// ============================================================
// ESTADO
// ============================================================
async function leerEstado(e) {
  const kv = gKV(e, 'agente');
  if (!kv) return null;
  try {
    const raw = await kv.get(ESTADO_KEY);
    if (raw) return JSON.parse(raw);
  } catch (x) {}
  return {
    st: 0, usuarios: 0, usuarios_pago: 0,
    ingresos_totales: 0, gastos_totales: 0,
    retencion_d1: 0, retencion_d7: 0, retencion_30d: 0,
    dia_simulacion: 0, historial_dias: [],
    servicios_activos: ['workers_ai', 'd1_storage'],
    servicios_pago: [], fecha_inicio: Date.now()
  };
}

async function guardarEstado(e, estado) {
  const kv = gKV(e, 'agente');
  if (!kv) return;
  try { await kv.put(ESTADO_KEY, JSON.stringify(estado), { expirationTtl: 31536000 }); } catch (x) {}
}

async function leerProgreso(e) {
  const kv = gKV(e, 'agente');
  if (!kv) return { completadas: [], en_progreso: {}, metricas: {} };
  try {
    const raw = await kv.get(PROGRESO_KEY);
    if (raw) return JSON.parse(raw);
  } catch (x) {}
  return { completadas: [], en_progreso: {}, metricas: {} };
}

async function guardarProgreso(e, p) {
  const kv = gKV(e, 'agente');
  if (!kv) return;
  try { await kv.put(PROGRESO_KEY, JSON.stringify(p), { expirationTtl: 31536000 }); } catch (x) {}
}

// ============================================================
// SELECCIÓN POR PRIORIDAD
// ============================================================
function decidirSiguienteEtapa(progreso) {
  const completadas = progreso.completadas || [];
  const enProgreso = progreso.en_progreso || {};

  // Si hay una etapa a medias, terminarla primero
  for (const [id, info] of Object.entries(enProgreso)) {
    if (info.dia_actual <= info.dias_total) {
      const etapa = CURRICULUM.find(x => x.id === id);
      if (etapa) return { etapa, dia: info.dia_actual, reanudando: true };
    }
  }

  // Filtrar disponibles (prereqs completados)
  const disponibles = CURRICULUM.filter(et => {
    if (completadas.includes(et.id)) return false;
    return et.prereq.every(p => completadas.includes(p));
  });

  if (!disponibles.length) return null;

  // Ordenar por prioridad (mayor primero), luego por fase
  disponibles.sort((a, b) => {
    if (b.prioridad !== a.prioridad) return b.prioridad - a.prioridad;
    return a.fase - b.fase;
  });

  return { etapa: disponibles[0], dia: 1, reanudando: false };
}

// ============================================================
// LEER HISTORIAL
// ============================================================
async function leerHistorialPorTema(e, tema) {
  const db = gDB(e, 'agente');
  if (!db) return '';
  try {
    const palabrasClave = tema.split('_').filter(p => p.length > 3);
    if (!palabrasClave.length) return '';
    let ordenes = new Set();
    for (const p of palabrasClave) {
      try {
        const r = await db.prepare('SELECT DISTINCT mensaje_orden FROM indice_temas WHERE tema LIKE ? LIMIT 30').bind('%' + p + '%').all();
        if (r.results) r.results.forEach(x => ordenes.add(x.mensaje_orden));
      } catch (x) {}
    }
    if (!ordenes.size) {
      const r = await db.prepare('SELECT contenido FROM historial_largo WHERE contenido LIKE ? ORDER BY orden DESC LIMIT 10').bind('%' + palabrasClave[0] + '%').all();
      if (r.results) return r.results.map(x => x.contenido).join('\n\n---\n\n');
      return '';
    }
    const ords = Array.from(ordenes).slice(0, 15);
    const ph = ords.map(() => '?').join(',');
    const msgs = await db.prepare('SELECT contenido FROM historial_largo WHERE orden IN (' + ph + ') ORDER BY orden ASC').bind(...ords).all();
    if (!msgs.results || !msgs.results.length) return '';
    return msgs.results.map(m => m.contenido).join('\n\n---\n\n').substring(0, 8000);
  } catch (x) { return ''; }
}

// ============================================================
// CONSUMIR CF
// ============================================================
async function consumirCF(e, accion) {
  const costo = COSTO_CF[accion];
  if (!costo) return { ok: true };
  const cap = await medirCapacidades(e);
  if (!cap.ok) return { ok: true, modo: 'sin_datos_reales', error: cap.error };
  const alcanzados = [];
  for (const [clave, valor] of Object.entries(costo)) {
    const usado = cap[clave] || 0;
    const max = cap.limites[clave];
    if (usado + valor > max) alcanzados.push({ recurso: clave, usado, max, intento: valor });
  }
  if (alcanzados.length) {
    const lim = await leerLimites(e);
    for (const a of alcanzados) {
      if (!lim.limites_alcanzados.includes(a.recurso)) lim.limites_alcanzados.push(a.recurso);
    }
    await guardarLimites(e, lim);
    return { ok: false, motivo: 'Límite CF real alcanzado', detalles: alcanzados };
  }
  return { ok: true, modo: cap.cache ? 'cache' : 'real' };
}

async function leerLimites(e) {
  const kv = gKV(e, 'agente');
  if (!kv) return null;
  const hoy = new Date().toISOString().split('T')[0];
  try {
    const raw = await kv.get(LIMITES_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p.dia === hoy) return p;
    }
  } catch (x) {}
  return { dia: hoy, cron_execuciones: 0, limites_alcanzados: [], migraciones_pago: [] };
}

async function guardarLimites(e, lim) {
  const kv = gKV(e, 'agente');
  if (!kv) return;
  try { await kv.put(LIMITES_KEY, JSON.stringify(lim), { expirationTtl: 172800 }); } catch (x) {}
}

// ============================================================
// EJECUTAR UNA ETAPA DEL CURRÍCULUM
// ============================================================
export async function ejecutarEtapa(e, etapaId, dia) {
  const ai = e.ayanokoji_IA;
  const db = gDB(e, 'agente');
  if (!ai || !db) return { error: 'IA o D1 no disponible.' };

  const etapa = CURRICULUM.find(x => x.id === etapaId);
  if (!etapa) return { error: 'Etapa no encontrada.' };

  const estado = await leerEstado(e);
  const costo = etapa.dias === 2 ? COSTO_ST.etapa_larga : COSTO_ST.etapa;
  if (estado.st < costo) return { error: 'Sin ST suficientes (necesita ' + costo + ').' };

  const cfCheck = await consumirCF(e, 'etapa');
  if (!cfCheck.ok) return { error: 'Límite CF alcanzado.', cf: cfCheck.detalles };

  const material = await leerHistorialPorTema(e, etapa.id);

  const prompt = `Eres Ayanokōji Digital. Ejecutando etapa: "${etapa.id}" (fase ${etapa.fase}, prioridad ${etapa.prioridad}/10, día ${dia}/${etapa.dias}).

DESCRIPCIÓN: ${etapa.descripcion}
MÉTRICA: ${etapa.metrica} ≥ ${etapa.umbral}

ESTADO: ${estado.st.toFixed(2)} ST, ${estado.usuarios} usuarios, ${estado.usuarios_pago} pago.

ARQUETIPOS DISPONIBLES:
${Object.entries(ARQUETIPOS).map(([k, v]) => `- ${k}: prob_pago=${v.prob_pago}, retención=${v.retencion_30d}, ARPU=${v.arpu}`).join('\n')}

MATERIAL DEL HISTORIAL:
${material || 'Sin material específico.'}

INSTRUCCIONES:
Ejecuta la simulación del día ${dia}. Sin opciones. Decide, ejecuta, mide.

FORMATO:
### SIMULACIÓN — ${etapa.id} (día ${dia}/${etapa.dias})
(desarrollo)

### MÉTRICAS MEDIDAS
- ${etapa.metrica}: [valor]
- Umbral: ${etapa.umbral}
- Resultado: [ÉXITO/FRACASO]

### APRENDIZAJES
(2-3 puntos)

### ¿COMPLETADO?
Sí/No. Si no, qué falta.

Máximo 1500 palabras.`;

  try {
    const res = await ai.run(MODELO_RAZONAMIENTO, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      temperature: 0.7
    });
    const simulacion = res.response || '';
    if (simulacion.length < 300) return { error: 'Simulación vacía.' };

    estado.st -= costo;
    estado.gastos_totales += costo;
    await guardarEstado(e, estado);

    const metricaMatch = simulacion.match(new RegExp(etapa.metrica + '[^\\d]*([\\d.]+)', 'i'));
    const metricaValor = metricaMatch ? parseFloat(metricaMatch[1]) : null;

    let exito = false;
    if (metricaValor !== null) {
      if (etapa.umbral === 0) exito = metricaValor <= 0;
      else if (etapa.metrica === 'tiempo_recuperacion' || etapa.metrica === 'contradicciones') exito = metricaValor <= etapa.umbral;
      else exito = metricaValor >= etapa.umbral;
    }

    // Actualizar progreso
    const progreso = await leerProgreso(e);
    if (!progreso.en_progreso[etapaId]) {
      progreso.en_progreso[etapaId] = { dia_actual: 1, dias_total: etapa.dias, metrica_actual: metricaValor };
    } else {
      progreso.en_progreso[etapaId].dia_actual = dia;
      progreso.en_progreso[etapaId].metrica_actual = metricaValor;
    }
    progreso.metricas[etapaId] = metricaValor;

    const completada = exito && dia >= etapa.dias;
    if (completada) {
      if (!progreso.completadas.includes(etapaId)) progreso.completadas.push(etapaId);
      delete progreso.en_progreso[etapaId];
    }
    await guardarProgreso(e, progreso);

    // Guardar escenario
    const r = await db.prepare('INSERT INTO sandbox_escenarios(tipo,contexto,creado) VALUES(?,?,?)')
      .bind('etapa_' + etapa.id, simulacion.substring(0, 4000), Date.now()).run();

    await db.prepare('INSERT INTO sandbox_lecciones(escenario_id,area,leccion,creada) VALUES(?,?,?,?)')
      .bind(r.meta.last_row_id, etapa.id, simulacion.substring(0, 2000), Date.now()).run();

    return {
      ok: true, etapa: etapa.id, dia, dias_total: etapa.dias,
      metrica: etapa.metrica, valor: metricaValor, umbral: etapa.umbral,
      exito, completada, simulacion, st_actual: estado.st, escenario_id: r.meta.last_row_id
    };
  } catch (x) {
    return { error: 'Error IA: ' + x.message };
  }
}

// ============================================================
// TEST 500 USUARIOS
// ============================================================
export async function test500Usuarios(e, dia) {
  const ai = e.ayanokoji_IA;
  const db = gDB(e, 'agente');
  if (!ai || !db) return { error: 'IA o D1 no disponible.' };

  const estado = await leerEstado(e);
  if (estado.st < COSTO_ST.test_500) return { error: 'Sin ST suficientes.' };

  const cfCheck = await consumirCF(e, 'test_500');
  if (!cfCheck.ok) return { error: 'Límite CF alcanzado.', cf: cfCheck.detalles };

  // Generar 500 usuarios distribuidos por arquetipos
  const poblacion = [];
  for (const [k, v] of Object.entries(ARQUETIPOS)) {
    const cantidad = Math.round(500 * v.peso);
    for (let i = 0; i < cantidad; i++) {
      poblacion.push({
        arquetipo: k,
        registrado: Math.random() < v.prob_registro,
        pago: Math.random() < v.prob_pago,
        retenido: Math.random() < v.retencion_30d,
        arpu: v.arpu
      });
    }
  }

  const totalReg = poblacion.filter(u => u.registrado).length;
  const totalPago = poblacion.filter(u => u.registrado && u.pago).length;
  const totalRet = poblacion.filter(u => u.registrado && u.retenido).length;
  const ingresos = poblacion.filter(u => u.registrado && u.pago).reduce((a, u) => a + u.arpu, 0);

  const prompt = `Eres Ayanokōji Digital. Estás simulando tu trabajo con 500 usuarios durante un día virtual completo.

POBLACIÓN SIMULADA:
- Total: 500
- Registrados: ${totalReg} (${(totalReg / 5).toFixed(1)}%)
- De pago: ${totalPago} (${(totalPago / 5).toFixed(1)}% conversión)
- Retenidos 30d: ${totalRet} (${(totalRet / 5).toFixed(1)}% retención)
- Ingresos estimados: ${ingresos} USDT
- ARPU: ${(ingresos / Math.max(1, totalPago)).toFixed(2)} USDT

DISTRIBUCIÓN POR ARQUETIPO:
${Object.entries(ARQUETIPOS).map(([k, v]) => {
  const sub = poblacion.filter(u => u.arquetipo === k);
  const reg = sub.filter(u => u.registrado).length;
  const pag = sub.filter(u => u.pago).length;
  return `- ${k}: ${sub.length} total, ${reg} registrados, ${pag} pago`;
}).join('\n')}

INSTRUCCIONES:
Simula un día completo de operación con estos 500 usuarios. Detalla:

### MAÑANA (6-12h)
¿Qué publicaste? ¿A qué canal? ¿Cuántos usuarios llegaron? ¿Qué arquetipo dominó?

### TARDE (12-18h)
¿Cómo respondiste al chat? ¿Qué tácticas usaste? ¿Cuántos convertiste a pago?

### NOCHE (18-24h)
¿Cómo retuviste usuarios? ¿Qué eventos lanzaste? ¿Qué métricas finales?

### MÉTRICAS DEL DÍA
- Nuevos usuarios: 
- Conversiones: 
- Retenidos: 
- ARPU final: 
- Índice de fanáticos (10+ inter/día): 
- Usuarios gestionados sin colapsar:
- Cost to Failure estimado:

### AUTOEVALUACIÓN
¿Funcionó el día? ¿Qué falló? Nota 1-10.

Máximo 2500 palabras.`;

  try {
    const res = await ai.run(MODELO_RAZONAMIENTO, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2800,
      temperature: 0.7
    });
    const simulacion = res.response || '';
    if (simulacion.length < 500) return { error: 'Simulación vacía.' };

    estado.st -= COSTO_ST.test_500;
    estado.gastos_totales += COSTO_ST.test_500;
    estado.usuarios = Math.max(estado.usuarios, totalReg);
    estado.usuarios_pago = Math.max(estado.usuarios_pago, totalPago);
    await guardarEstado(e, estado);

    const r = await db.prepare('INSERT INTO sandbox_escenarios(tipo,contexto,creado) VALUES(?,?,?)')
      .bind('test_500_usuarios_dia_' + dia, simulacion.substring(0, 6000), Date.now()).run();

    await db.prepare('INSERT INTO sandbox_lecciones(escenario_id,area,leccion,creada) VALUES(?,?,?,?)')
      .bind(r.meta.last_row_id, 'test_500', simulacion.substring(0, 2000), Date.now()).run();

    // Actualizar progreso
    const progreso = await leerProgreso(e);
    if (!progreso.en_progreso['test_500_usuarios']) {
      progreso.en_progreso['test_500_usuarios'] = { dia_actual: dia, dias_total: 2 };
    } else {
      progreso.en_progreso['test_500_usuarios'].dia_actual = dia;
    }
    if (dia >= 2) {
      if (!progreso.completadas.includes('test_500_usuarios')) progreso.completadas.push('test_500_usuarios');
      delete progreso.en_progreso['test_500_usuarios'];
    }
    await guardarProgreso(e, progreso);

    return {
      ok: true, dia,
      poblacion_total: 500,
      registrados: totalReg, pagos: totalPago, retenidos: totalRet,
      ingresos, arpu: (ingresos / Math.max(1, totalPago)).toFixed(2),
      simulacion, st_actual: estado.st, escenario_id: r.meta.last_row_id
    };
  } catch (x) {
    return { error: 'Error IA: ' + x.message };
  }
}

// ============================================================
// SIMULAR ESTRATEGIA
// ============================================================
export async function simularEstrategia(e, estrategiaId) {
  const ai = e.ayanokoji_IA;
  const db = gDB(e, 'agente');
  if (!ai || !db) return { error: 'IA o D1 no disponible.' };

  let estrategia = null;
  try { estrategia = await db.prepare('SELECT * FROM estrategias WHERE id=?').bind(estrategiaId).first(); } catch (x) {}
  if (!estrategia) return { error: 'Estrategia no encontrada.' };

  const estado = await leerEstado(e);
  if (estado.st < COSTO_ST.simulacion_estrategia) return { error: 'Sin ST suficientes.' };

  const cfCheck = await consumirCF(e, 'simulacion_estrategia');
  if (!cfCheck.ok) return { error: 'Límite CF alcanzado.', cf: cfCheck.detalles };

  const arqTexto = Object.entries(ARQUETIPOS).map(([k, v]) =>
    `- ${k} (${v.nombre}): ${v.descripcion}. Táctica: ${v.tactica}. prob_pago=${v.prob_pago}, retención=${v.retencion_30d}, ARPU=${v.arpu}. Riesgo: ${v.riesgo}`
  ).join('\n');

  const prompt = `Eres Ayanokōji Digital. Simula esta estrategia contra 4 arquetipos.

ESTRATEGIA:
Tipo: ${estrategia.tipo}
Contenido: ${estrategia.contenido}

ARQUETIPOS:
${arqTexto}

Para CADA arquetipo: ¿Se registra? ¿Paga? ¿Cuánto tiempo se queda? ¿Riesgo? ¿Táctica que mejor funciona?

RESUMEN AGREGADO:
- Registro esperado (%)
- Conversión (%)
- Retención 30d (%)
- ARPU (USDT/mes)
- Riesgo principal
- Ajustes (2-3)

VEREDICTO: Nota 1-10 + justificación.

Máximo 1500 palabras.`;

  try {
    const res = await ai.run(MODELO_RAZONAMIENTO, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      temperature: 0.6
    });
    const simulacion = res.response || '';
    if (simulacion.length < 300) return { error: 'Simulación vacía.' };

    estado.st -= COSTO_ST.simulacion_estrategia;
    estado.gastos_totales += COSTO_ST.simulacion_estrategia;
    await guardarEstado(e, estado);

    const notaMatch = simulacion.match(/[Nn]ota[^\d]*(\d+(?:\.\d+)?)/);
    const nota = notaMatch ? parseFloat(notaMatch[1]) : null;

    const r = await db.prepare('INSERT INTO sandbox_escenarios(tipo,contexto,creado) VALUES(?,?,?)')
      .bind('estrategia_' + estrategia.tipo, `[ESTRATEGIA #${estrategiaId}] ${estrategia.contenido}\n\n---\n\n${simulacion}`, Date.now()).run();

    await db.prepare('INSERT INTO sandbox_lecciones(escenario_id,area,leccion,creada) VALUES(?,?,?,?)')
      .bind(r.meta.last_row_id, 'estrategia_' + estrategia.tipo, simulacion.substring(0, 2000), Date.now()).run();

    return { ok: true, estrategia_id: estrategiaId, tipo: estrategia.tipo, simulacion, nota, st_actual: estado.st, escenario_id: r.meta.last_row_id };
  } catch (x) {
    return { error: 'Error IA: ' + x.message };
  }
}

// ============================================================
// CRON AUTÓNOMO
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

  const progreso = await leerProgreso(e);
  const siguiente = decidirSiguienteEtapa(progreso);

  if (!siguiente) {
    // Currículum completo. Simular crecimiento puro.
    if (estado.usuarios > 0) await simularCrecimiento(e);
    return;
  }

  const { etapa, dia } = siguiente;

  // Si es test_500_usuarios, usar función especial
  if (etapa.id === 'test_500_usuarios') {
    await test500Usuarios(e, dia);
    return;
  }

  await ejecutarEtapa(e, etapa.id, dia);

  estado.dia_simulacion += 1;
  await guardarEstado(e, estado);
}

// ============================================================
// SIMULAR CRECIMIENTO
// ============================================================
async function simularCrecimiento(e) {
  const ai = e.ayanokoji_IA;
  if (!ai) return;
  const estado = await leerEstado(e);
  const res = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Shadow Arise: ${estado.usuarios} usuarios, ${estado.usuarios_pago} pago, ${estado.st.toFixed(2)} ST.\n\nSimula crecimiento orgánico. 200 palabras.` }],
    max_tokens: 400,
    temperature: 0.7
  });
  const sim = res.response || '';
  const mU = sim.match(/(\d+)\s*(nuevos usuarios|usuarios nuevos)/i);
  const mP = sim.match(/(\d+)\s*(se convirtieron|pagos nuevos|nuevos de pago)/i);
  if (mU) estado.usuarios += parseInt(mU[1]);
  if (mP) {
    const n = parseInt(mP[1]);
    estado.usuarios_pago += n;
    estado.st += n * 10;
    estado.ingresos_totales += n * 10;
  }
  await guardarEstado(e, estado);
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
  }) : 'Sin datos reales.';

  const res = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Ayanokōji tiene ${estado.st.toFixed(2)} ST.\n\nServicios:\n${Object.entries(SERVICIOS).map(([k, v]) => `- ${v.nombre}: ${v.costo_diario} ST/día (p${v.prioridad}${v.critico ? ', CRÍTICO' : ''})`).join('\n')}\n\nCapacidad REAL:\n${capTexto}\n\n¿Priorizar qué? ¿Migrar cuál a x402?` }],
    max_tokens: 500,
    temperature: 0.5
  });
  return { ok: true, plan: res.response || '', st_actual: estado.st };
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
    const progreso = await leerProgreso(e);
    const lim = await leerLimites(e);

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

    const siguiente = decidirSiguienteEtapa(progreso);
    const totalEtapas = CURRICULUM.length;
    const completadas = (progreso.completadas || []).length;
    const pctTotal = Math.round((completadas / totalEtapas) * 100);

    return J({
      stats: stats || { total: 0, completados: 0 },
      estado_economico: estado,
      capacidad_real_cloudflare: capacidadReal,
      cron_local: { usado: lim.cron_execuciones, max: 500 },
      limites_alcanzados: lim.limites_alcanzados || [],
      migraciones_pago: lim.migraciones_pago || [],
      arquetipos_disponibles: Object.keys(ARQUETIPOS),
      curriculum: {
        total_etapas: totalEtapas,
        completadas: progreso.completadas || [],
        en_progreso: progreso.en_progreso || {},
        progreso_pct: pctTotal,
        etapa_actual: siguiente ? { id: siguiente.etapa.id, fase: siguiente.etapa.fase, prioridad: siguiente.etapa.prioridad, dia: siguiente.dia, dias_total: siguiente.etapa.dias, descripcion: siguiente.etapa.descripcion, metrica: siguiente.etapa.metrica, umbral: siguiente.etapa.umbral } : null,
        todas_las_etapas: CURRICULUM.map(et => ({
          id: et.id, fase: et.fase, prioridad: et.prioridad, dias: et.dias,
          metrica: et.metrica, umbral: et.umbral,
          completada: (progreso.completadas || []).includes(et.id),
          metrica_actual: progreso.metricas[et.id] || null
        }))
      },
      escenarios: esc.results || [],
      lecciones: lec.results || []
    });
  } catch (x) {
    return J({ error: x.message });
  }
}

// ============================================================
// SIMULAR PRECIO
// ============================================================
export async function simularPrecio(r, e) {
  try {
    const b = await r.json();
    const ai = e.ayanokoji_IA;
    if (!ai) return J({ error: 'IA no disponible.' });
    const estado = await leerEstado(e);
    const arqTexto = Object.entries(ARQUETIPOS).map(([k, v]) => `- ${k}: prob_pago=${v.prob_pago}, ARPU=${v.arpu}`).join('\n');

    const res = await ai.run(MODELO_RAZONAMIENTO, {
      messages: [{ role: 'user', content: `Simula este precio. Presupuesto: ${estado.st.toFixed(2)} ST. Usuarios: ${estado.usuarios}.\n\nPropuesta: ${b.propuesta || 'precio base 10 USDT'}\n\nArquetipos:\n${arqTexto}\n\n300 palabras.` }],
      max_tokens: 600,
      temperature: 0.5
    });
    return J({ ok: true, simulacion: res.response || '', st_actual: estado.st });
  } catch (x) { return J({ error: x.message }); }
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
  } catch (x) { return J({ error: x.message }); }
}
