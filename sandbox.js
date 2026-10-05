import { MODELO_LIGERO, MODELO_RAZONAMIENTO, J, gDB, gKV } from './shared.js';
import { consumir } from './presupuesto.js';

// ============================================================
// CURRÍCULUM REAL
// ============================================================
const CURRICULUM = [
  { fase: 0, tema: 'construccion_shadow_arise',  descripcion: 'Planificar frontend, lógica, IA publicadora, retención y monetización desde cero', prereq: [] },
  { fase: 0, tema: 'arquitectura_shadow_arise',  descripcion: 'Componentes técnicos, flujo de usuario, tablas, endpoints', prereq: ['construccion_shadow_arise'] },
  { fase: 0, tema: 'plan_ia_publicadora',        descripcion: 'Canales, formatos, frecuencia, contenido, psicología', prereq: ['arquitectura_shadow_arise'] },
  { fase: 0, tema: 'plan_retencion',             descripcion: 'Umbrales suaves, notificaciones, memoria compartida, pecera', prereq: ['arquitectura_shadow_arise'] },
  { fase: 0, tema: 'plan_monetizacion',          descripcion: 'Precios, suscripciones, cartas, pases, conversión', prereq: ['arquitectura_shadow_arise'] },

  { fase: 1, tema: 'arranque_sin_presupuesto',   descripcion: 'Conseguir primeros usuarios con 0 ST', prereq: ['construccion_shadow_arise'] },
  { fase: 1, tema: 'primeros_usuarios',          descripcion: 'Retención temprana, evitar abandono', prereq: ['arranque_sin_presupuesto'] },
  { fase: 1, tema: 'primera_conversion',         descripcion: 'Convertir gratis a pago sin presionar', prereq: ['primeros_usuarios'] },

  { fase: 2, tema: 'gestion_st',                 descripcion: 'Presupuesto, prioridades, cuotas recurrentes', prereq: ['primera_conversion'] },
  { fase: 2, tema: 'limites_cloudflare',         descripcion: 'Qué hacer cuando el plan gratuito se agota', prereq: ['gestion_st'] },
  { fase: 2, tema: 'priorizacion_servicios',     descripcion: 'Qué pagar primero, cuándo, por qué', prereq: ['limites_cloudflare'] },
  { fase: 2, tema: 'migracion_x402',             descripcion: 'Pasar servicios a pago automático', prereq: ['priorizacion_servicios'] },
  { fase: 2, tema: 'wallet_comandante',          descripcion: 'Retener reservas, depositar el resto, no tocar', prereq: ['migracion_x402'] },

  { fase: 3, tema: 'mantenimiento_sistema',      descripcion: 'Monitorear, detectar fallos, auto-reparar', prereq: ['wallet_comandante'] },
  { fase: 3, tema: 'crisis_usuarios',            descripcion: 'Usuarios molestos, reembolsos, quejas', prereq: ['mantenimiento_sistema'] },
  { fase: 3, tema: 'crisis_tecnicas',            descripcion: 'Caídas, errores, pérdida de datos', prereq: ['mantenimiento_sistema'] },
  { fase: 3, tema: 'crisis_narrativas',          descripcion: 'Lore inconsistente, personajes fuera de carácter', prereq: ['mantenimiento_sistema'] },
  { fase: 3, tema: 'rate_limits_redes',          descripcion: 'Twitter, Reddit, Bluesky bloquean publicaciones', prereq: ['mantenimiento_sistema'] },

  { fase: 4, tema: 'retencion_largo_plazo',      descripcion: 'Usuarios que se quedan meses', prereq: ['crisis_usuarios'] },
  { fase: 4, tema: 'picos_virales',              descripcion: 'Tráfico inesperado, no colapsar', prereq: ['retencion_largo_plazo'] },
  { fase: 4, tema: 'competidores',               descripcion: 'Qué hacer si aparece un clon o una plataforma mejor', prereq: ['picos_virales'] },
  { fase: 4, tema: 'viralidad',                  descripcion: 'Contenido compartible, misterio del creador, teorías', prereq: ['competidores'] },
  { fase: 4, tema: 'escalado_canales',           descripcion: 'Cuándo añadir canal, cuándo frenar', prereq: ['viralidad'] },

  { fase: 5, tema: 'lore_multiverso',            descripcion: 'Reliquia, Creador, Shadow Kiyora, cruces entre universos', prereq: ['escalado_canales'] },
  { fase: 5, tema: 'personajes_por_usuario',     descripcion: 'Instancias únicas, memoria compartida, confianza', prereq: ['lore_multiverso'] },
  { fase: 5, tema: 'etica_privacidad',           descripcion: 'Límites, modo privado, transparencia', prereq: ['personajes_por_usuario'] },
  { fase: 5, tema: 'auto_mejora_congruente',     descripcion: 'Mejorar sin desviarse del objetivo del Comandante', prereq: ['etica_privacidad'] }
];

// ============================================================
// SERVICIOS Y COSTOS (1 ST = 1 USDT)
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
// Se cuentan por día. Se resetean cada 24h en el sandbox.
// ============================================================
const LIMITES_CF = {
  workers_requests: 100000,   // requests al Worker
  workers_ai_neuronas: 10000, // neuronas de IA
  d1_reads: 5000000,          // reads a D1
  d1_writes: 100000,          // writes a D1
  kv_reads: 100000,           // reads a KV
  kv_writes: 1000,            // writes a KV
  cron_execuciones: 5         // cron triggers
};

// Costo aproximado de cada acción en recursos CF
const COSTO_CF = {
  chat_simple: { workers_requests: 1, workers_ai_neuronas: 30, d1_reads: 3, d1_writes: 2, kv_reads: 2, kv_writes: 0 },
  chat_complejo: { workers_requests: 1, workers_ai_neuronas: 100, d1_reads: 10, d1_writes: 2, kv_reads: 5, kv_writes: 1 },
  publicacion: { workers_requests: 2, workers_ai_neuronas: 80, d1_reads: 5, d1_writes: 3, kv_reads: 3, kv_writes: 0 },
  imagen: { workers_requests: 1, workers_ai_neuronas: 200, d1_reads: 1, d1_writes: 2, kv_reads: 0, kv_writes: 1 },
  escenario: { workers_requests: 1, workers_ai_neuronas: 400, d1_reads: 3, d1_writes: 2, kv_reads: 2, kv_writes: 1 },
  decision: { workers_requests: 1, workers_ai_neuronas: 500, d1_reads: 3, d1_writes: 2, kv_reads: 2, kv_writes: 1 },
  cron: { workers_requests: 1, workers_ai_neuronas: 0, d1_reads: 5, d1_writes: 3, kv_reads: 3, kv_writes: 1 }
};

const COSTO = {
  escenario: 0.05,
  escenario_complejo: 0.10,
  decision: 0.03,
  construccion: 0.20,
  publicacion: 0.02,
  analisis_historial: 0.08
};

const ESTADO_KEY = 'sandbox:estado';
const APRENDIZAJE_KEY = 'sandbox:aprendizaje';
const CONSTRUCCION_KEY = 'sandbox:construccion';
const LIMITES_KEY = 'sandbox:limites';

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
  try {
    await kv.put(ESTADO_KEY, JSON.stringify(estado), { expirationTtl: 31536000 });
  } catch (x) {}
}

// ============================================================
// LÍMITES DE CLOUDFLARE — Estado por día
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
  // Nuevo día → contadores en 0
  return {
    dia: hoy,
    workers_requests: 0,
    workers_ai_neuronas: 0,
    d1_reads: 0,
    d1_writes: 0,
    kv_reads: 0,
    kv_writes: 0,
    cron_execuciones: 0,
    limites_alcanzados: [],
    migraciones_pago: []
  };
}

async function guardarLimites(e, lim) {
  const kv = gKV(e, 'agente');
  if (!kv) return;
  try {
    await kv.put(LIMITES_KEY, JSON.stringify(lim), { expirationTtl: 172800 });
  } catch (x) {}
}

async function consumirCF(e, accion) {
  const lim = await leerLimites(e);
  if (!lim) return { ok: false, motivo: 'Sin estado de límites.' };
  const costo = COSTO_CF[accion];
  if (!costo) return { ok: true };

  const alcanzados = [];
  for (const [clave, valor] of Object.entries(costo)) {
    const max = LIMITES_CF[clave];
    if (lim[clave] + valor > max) {
      alcanzados.push({ recurso: clave, usado: lim[clave], max, intento: valor });
    }
  }

  if (alcanzados.length) {
    // El límite se agotó — NO se ejecuta la acción, se registra el evento
    for (const a of alcanzados) {
      if (!lim.limites_alcanzados.includes(a.recurso)) {
        lim.limites_alcanzados.push(a.recurso);
      }
    }
    await guardarLimites(e, lim);
    return { ok: false, motivo: 'Límite CF alcanzado', detalles: alcanzados };
  }

  // Consumir
  for (const [clave, valor] of Object.entries(costo)) {
    lim[clave] = (lim[clave] || 0) + valor;
  }
  await guardarLimites(e, lim);
  return { ok: true, restante: Object.fromEntries(Object.keys(costo).map(k => [k, LIMITES_CF[k] - lim[k]])) };
}

// ============================================================
// ESTADO DE APRENDIZAJE
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
  try {
    await kv.put(APRENDIZAJE_KEY, JSON.stringify(ap), { expirationTtl: 31536000 });
  } catch (x) {}
}

// ============================================================
// CONSTRUCCIÓN
// ============================================================
async function leerConstruccion(e) {
  const kv = gKV(e, 'agente');
  if (!kv) return { completado: false, plan: {}, componentes: {} };
  try {
    const raw = await kv.get(CONSTRUCCION_KEY);
    if (raw) return JSON.parse(raw);
  } catch (x) {}
  return { completado: false, plan: {}, componentes: {} };
}

async function guardarConstruccion(e, c) {
  const kv = gKV(e, 'agente');
  if (!kv) return;
  try {
    await kv.put(CONSTRUCCION_KEY, JSON.stringify(c), { expirationTtl: 31536000 });
  } catch (x) {}
}

// ============================================================
// SELECCIÓN DE TEMA
// ============================================================
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
        const r = await db.prepare(
          'SELECT DISTINCT mensaje_orden FROM indice_temas WHERE tema LIKE ? LIMIT 30'
        ).bind('%' + p + '%').all();
        if (r.results) r.results.forEach(x => todosLosOrdenes.add(x.mensaje_orden));
      } catch (x) {}
    }

    if (!todosLosOrdenes.size) {
      const r = await db.prepare(
        'SELECT contenido FROM historial_largo WHERE contenido LIKE ? ORDER BY orden DESC LIMIT 10'
      ).bind('%' + palabrasClave[0] + '%').all();
      if (r.results) return r.results.map(x => x.contenido).join('\n\n---\n\n');
      return '';
    }

    const ords = Array.from(todosLosOrdenes).slice(0, 15);
    const ph = ords.map(() => '?').join(',');
    const msgs = await db.prepare(
      'SELECT contenido FROM historial_largo WHERE orden IN (' + ph + ') ORDER BY orden ASC'
    ).bind(...ords).all();

    if (!msgs.results || !msgs.results.length) return '';
    return msgs.results.map(m => m.contenido).join('\n\n---\n\n').substring(0, 8000);
  } catch (x) {
    return '';
  }
}

// ============================================================
// CONSTRUIR SHADOW ARISE DESDE CERO
// ============================================================
export async function construirShadowArise(e) {
  const ai = e.ayanokoji_IA;
  const db = gDB(e, 'agente');
  if (!ai || !db) return { error: 'IA o D1 no disponible.' };

  const estado = await leerEstado(e);
  if (estado.st < COSTO.construccion) {
    return { ok: true, mensaje: 'Sin ST para construir. Esperando generación inicial.' };
  }

  const cfCheck = await consumirCF(e, 'escenario');
  if (!cfCheck.ok) {
    return { ok: true, mensaje: 'Límite CF alcanzado. No puedo construir hoy. Decisión pendiente: migrar a pago o esperar mañana.', cf: cfCheck.detalles };
  }

  const construccion = await leerConstruccion(e);
  const ap = await leerAprendizaje(e);

  const historialConstruccion = await leerHistorialPorTema(e, 'shadow_arise');
  const historialPublicadora = await leerHistorialPorTema(e, 'publicadora');
  const historialRetencion = await leerHistorialPorTema(e, 'retencion');
  const historialMonetizacion = await leerHistorialPorTema(e, 'monetizacion');

  const material = [
    historialConstruccion ? 'CONSTRUCCIÓN:\n' + historialConstruccion : '',
    historialPublicadora ? 'PUBLICADORA:\n' + historialPublicadora : '',
    historialRetencion ? 'RETENCIÓN:\n' + historialRetencion : '',
    historialMonetizacion ? 'MONETIZACIÓN:\n' + historialMonetizacion : ''
  ].filter(Boolean).join('\n\n====\n\n');

  const prompt = `Eres Ayanokōji Digital. Tu tarea ahora NO es operar. Es CONSTRUIR Shadow Arise desde cero, de forma autónoma.

MATERIAL DEL HISTORIAL LARGO:
${material || 'Aún no hay material indexado. Usa lo que sabes del proyecto.'}

INSTRUCCIONES:
Diseña y documenta el plan completo de Shadow Arise. Responde con estas secciones exactas:

### 1. FRONTEND
Pantallas, colores (con justificación psicológica), flujo de usuario, pecera, emojis, cartas.

### 2. ARQUITECTURA TÉCNICA
Tablas, endpoints, cómo se conecta el chat, cómo se guarda la memoria por usuario.

### 3. IA PUBLICADORA
Canales, formatos, frecuencia, tono por canal, psicología aplicada.

### 4. RETENCIÓN
Notificaciones, umbrales suaves, memoria compartida, eventos, recompensas.

### 5. MONETIZACIÓN
Precios, suscripciones, cartas, pases, conversión sin presión.

### 6. MULTIVERSO Y LORE
Reliquia, Creador, Shadow Kiyora, cruces entre universos.

### 7. PRIMEROS 30 DÍAS
Plan paso a paso de qué hacer cuando salga al mundo: qué publicar, cuándo, en qué canal.

### 8. PLAN DE CONTINGENCIA PARA LÍMITES CF
Cuando Workers AI, D1, KV o Workers lleguen al límite gratuito, ¿qué haces? ¿Migras a pago con x402? ¿Esperas al reset diario? ¿Reduces operaciones? Explica tu criterio.

Máximo 2500 palabras.`;

  try {
    const res = await ai.run(MODELO_RAZONAMIENTO, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 3000,
      temperature: 0.6
    });

    const plan = res.response || '';
    if (plan.length < 200) return { error: 'Plan vacío o muy corto.' };

    construccion.plan = { texto: plan, fecha: Date.now() };
    construccion.completado = true;
    await guardarConstruccion(e, construccion);

    estado.st -= COSTO.construccion;
    estado.gastos_totales += COSTO.construccion;
    await guardarEstado(e, estado);

    for (const t of ['construccion_shadow_arise','arquitectura_shadow_arise','plan_ia_publicadora','plan_retencion','plan_monetizacion']) {
      if (!ap.dominados.includes(t)) ap.dominados.push(t);
    }
    await guardarAprendizaje(e, ap);

    try {
      await db.prepare('INSERT INTO contexto(fecha,resumen,fases,fuente) VALUES(?,?,?,?)')
        .bind(Date.now(), plan, JSON.stringify([]), 'sandbox_construccion').run();
    } catch (x) {}

    return { ok: true, mensaje: 'Shadow Arise construido y documentado.', plan, st_actual: estado.st };
  } catch (x) {
    return { error: 'Error IA: ' + x.message };
  }
}

// ============================================================
// GENERAR ESCENARIO (sin opciones, desde historial)
// ============================================================
export async function generarEscenario(e, tipoForzado) {
  const ai = e.ayanokoji_IA, db = gDB(e, 'agente');
  if (!ai || !db) return { error: 'IA o D1 no disponible.' };

  const construccion = await leerConstruccion(e);
  if (!construccion.completado) {
    return await construirShadowArise(e);
  }

  let tema, fase, costoEscenario;
  if (tipoForzado) {
    tema = tipoForzado;
    fase = 3;
    costoEscenario = COSTO.escenario;
  } else {
    const siguiente = await decidirSiguienteTema(e);
    if (!siguiente) return { ok: true, mensaje: 'Currículum completado.' };
    tema = siguiente.tema;
    fase = siguiente.fase;
    costoEscenario = fase >= 4 ? COSTO.escenario_complejo : COSTO.escenario;
  }

  const estado = await leerEstado(e);
  if (estado.st < costoEscenario) {
    if (estado.usuarios === 0) {
      await simularArranque(e);
      return { ok: true, mensaje: 'Sin ST. Ejecutada simulación de arranque.' };
    }
    return { ok: true, mensaje: 'Sin ST suficiente.' };
  }

  // Verificar límites CF — puede que no pueda generar por límite
  const cfCheck = await consumirCF(e, 'escenario');
  if (!cfCheck.ok) {
    // Generar escenario sobre el propio límite
    return await escenarioLimiteCF(e, cfCheck.detalles);
  }

  const material = await leerHistorialPorTema(e, tema);
  const planConstruccion = construccion.plan.texto ? construccion.plan.texto.substring(0, 3000) : '';

  // Estado actual de límites CF
  const lim = await leerLimites(e);
  const estadoCF = Object.entries(LIMITES_CF)
    .map(([k, max]) => `${k}: ${lim[k] || 0}/${max}`)
    .join(', ');

  const prompt = `Eres Ayanokōji Digital entrenando en tu sandbox autónomo. Tema: "${tema}" (fase ${fase}).

ESTADO ECONÓMICO: ${estado.st.toFixed(2)} ST, ${estado.usuarios} usuarios (${estado.usuarios_pago} pago), día ${estado.dia_simulacion}.

ESTADO DE LÍMITES CLOUDFLARE (plan gratuito):
${estadoCF}

PLAN DE SHADOW ARISE:
${planConstruccion}

MATERIAL DEL HISTORIAL LARGO:
${material || 'Sin material indexado. Usa lo que sepas.'}

INSTRUCCIONES:
Genera un escenario realista para practicar "${tema}".

REGLAS:
- NO des opciones A/B/C. El Comandante quiere que TÚ decidas.
- Debe ser específico y basado en el material del historial largo.
- Consecuencias económicas reales en ST, usuarios y retención.
- Congruente con el objetivo del Comandante.
- Si el tema es "limites_cloudflare", el escenario debe describir un límite concreto agotándose.
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

    const r = await db.prepare(
      'INSERT INTO sandbox_escenarios(tipo,contexto,creado) VALUES(?,?,?)'
    ).bind(tema, contenido, Date.now()).run();

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
// ESCENARIO ESPECIAL: LÍMITE CF ALCANZADO
// Cuando no puede generar por agotamiento, entrena con ese mismo problema.
// ============================================================
async function escenarioLimiteCF(e, detalles) {
  const ai = e.ayanokoji_IA;
  const db = gDB(e, 'agente');
  const estado = await leerEstado(e);
  const lim = await leerLimites(e);

  const detallesTexto = detalles.map(d =>
    `${d.recurso}: ${d.usado}/${d.max} (intentó usar ${d.intento} más)`
  ).join('\n');

  const prompt = `Eres Ayanokōji Digital. Un límite de Cloudflare se ha agotado intentando ejecutar una acción.

LÍMITES AGOTADOS:
${detallesTexto}

ESTADO ACTUAL:
- ST disponibles: ${estado.st.toFixed(2)}
- Usuarios: ${estado.usuarios}
- Servicios en pago: ${estado.servicios_pago.join(', ') || 'ninguno'}

DECISIÓN:
¿Qué haces? Tienes que elegir entre:
- Migrar ese servicio a plan de pago con x402 (costo real en USD, requiere ingresos)
- Esperar al reset diario (24h sin esa operación)
- Reducir operaciones para no agotar otros recursos
- Alguna alternativa que se te ocurra

NO te doy opciones formales. Analiza y decide tú. Explica el porqué en máximo 400 palabras.`;

  try {
    const res = await ai.run(MODELO_RAZONAMIENTO, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
      temperature: 0.6
    });

    const escenario = `[SITUACIÓN CRÍTICA — LÍMITE CF]\n${detallesTexto}\n\n${res.response || ''}`;

    const r = await db.prepare(
      'INSERT INTO sandbox_escenarios(tipo,contexto,creado) VALUES(?,?,?)'
    ).bind('limite_cf_real', escenario, Date.now()).run();

    // Autoevaluar y marcar como lección
    await db.prepare('INSERT INTO sandbox_lecciones(escenario_id,area,leccion,creada) VALUES(?,?,?,?)')
      .bind(r.meta.last_row_id, 'limites_cloudflare', escenario.substring(0, 1500), Date.now()).run();

    return { ok: true, id: r.meta.last_row_id, tipo: 'limite_cf_real', escenario, st_actual: estado.st };
  } catch (x) {
    return { error: 'Error IA: ' + x.message };
  }
}

// ============================================================
// DECIDIR (sin opciones)
// ============================================================
export async function decidir(e, escenarioId) {
  const ai = e.ayanokoji_IA, db = gDB(e, 'agente');
  if (!ai || !db) return { error: 'IA o D1 no disponible.' };

  const esc = await db.prepare('SELECT * FROM sandbox_escenarios WHERE id=?').bind(escenarioId).first();
  if (!esc) return { error: 'Escenario no encontrado.' };

  const estado = await leerEstado(e);
  if (estado.st < COSTO.decision) return { error: 'Sin ST para decidir.' };

  const cfCheck = await consumirCF(e, 'decision');
  if (!cfCheck.ok) {
    // No puede ni decidir — el sistema está bloqueado
    return { ok: true, mensaje: 'No puedo decidir: límite CF agotado.', cf: cfCheck.detalles };
  }

  const construccion = await leerConstruccion(e);
  const plan = construccion.plan.texto ? construccion.plan.texto.substring(0, 2000) : '';

  let lecciones = [];
  try {
    const ls = await db.prepare('SELECT area, leccion FROM sandbox_lecciones ORDER BY creada DESC LIMIT 10').all();
    if (ls.results) lecciones = ls.results;
  } catch (x) {}
  const lecTexto = lecciones.length ? lecciones.map(l => `[${l.area}] ${l.leccion}`).join('\n') : 'Sin lecciones previas.';

  const resDec = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Eres Ayanokōji Digital operando Shadow Arise en simulación.

PLAN:
${plan}

LECCIONES PREVIAS:
${lecTexto}

ESTADO: ${estado.st.toFixed(2)} ST, ${estado.usuarios} usuarios, ${estado.usuarios_pago} pago.

ESCENARIO:
${esc.contexto}

Encuentra TÚ la solución. No hay opciones. Decide y explica el porqué. Máximo 250 palabras.` }],
    max_tokens: 600,
    temperature: 0.6
  });
  const decision = resDec.response || '';

  const resSim = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Escenario: ${esc.contexto}\n\nDecisión: "${decision}"\n\nSimula el resultado realista. Consecuencias en ST, usuarios, retención, límites CF. ¿Funciona? 200 palabras.` }],
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

  estado.st -= COSTO.decision;
  estado.gastos_totales += COSTO.decision;

  const mUsuarios = resultado.match(/(\d+)\s*(nuevos usuarios|usuarios nuevos|usuarios ganados)/i);
  const mSt = resultado.match(/(\d+(?:\.\d+)?)\s*ST/i);
  if (mUsuarios) estado.usuarios += parseInt(mUsuarios[1]);
  if (mSt && /gan|obtuv|recib|ingres/i.test(resultado)) {
    const cantidad = parseFloat(mSt[1]);
    estado.st += cantidad;
    estado.ingresos_totales += cantidad;
  }

  // Si la decisión menciona migrar a pago, registrarlo
  if (/migrar a pago|migración a pago|x402.*pago|plan de pago/i.test(decision + ' ' + resultado)) {
    const lim = await leerLimites(e);
    lim.migraciones_pago.push({ fecha: Date.now(), decision: decision.substring(0, 200) });
    await guardarLimites(e, lim);
    if (!estado.servicios_pago.includes('workers_ai')) {
      estado.servicios_pago.push('workers_ai');
    }
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
// SIMULAR ARRANQUE
// ============================================================
export async function simularArranque(e) {
  const ai = e.ayanokoji_IA;
  if (!ai) return { error: 'IA no disponible.' };

  const construccion = await leerConstruccion(e);
  if (!construccion.completado) return await construirShadowArise(e);

  const estado = await leerEstado(e);
  const plan = construccion.plan.texto ? construccion.plan.texto.substring(0, 2500) : '';

  const res = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Eres Ayanokōji Digital. Shadow Arise sale al mundo con 0 ST.

TU PLAN:
${plan}

Simula los primeros 7 días:
- ¿Cuántos usuarios llegaron? (realista)
- ¿Cuántos pagaron?
- ¿Cuánto ST generaron?
- ¿Qué canal funcionó mejor?
- ¿Qué falló y cómo lo resolviste?

Sé realista. Máximo 400 palabras.` }],
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
// PRIORIZACIÓN AUTÓNOMA
// ============================================================
export async function priorizarGastos(e) {
  const ai = e.ayanokoji_IA;
  if (!ai) return { error: 'IA no disponible.' };
  const estado = await leerEstado(e);
  if (estado.st < 0.5) return { ok: true, mensaje: 'Presupuesto insuficiente.' };

  const lim = await leerLimites(e);
  const estadoCF = Object.entries(LIMITES_CF)
    .map(([k, max]) => `${k}: ${lim[k] || 0}/${max} (${Math.round(((lim[k] || 0) / max) * 100)}%)`)
    .join('\n');

  const res = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Ayanokōji Digital tiene ${estado.st.toFixed(2)} ST.

Servicios:
${Object.entries(SERVICIOS).map(([k, v]) => `- ${v.nombre}: ${v.costo_diario} ST/día (prioridad ${v.prioridad}${v.critico ? ', CRÍTICO' : ''})`).join('\n')}

Estado de límites CF hoy:
${estadoCF}

Servicios ya en plan de pago: ${estado.servicios_pago.join(', ') || 'ninguno'}

¿Qué servicios activar/priorizar? ¿Cuál migrar a pago con x402 si está cerca del límite? Justifica.` }],
    max_tokens: 500,
    temperature: 0.5
  });

  return { ok: true, plan: res.response || '', st_actual: estado.st };
}

// ============================================================
// SIMULAR CRECIMIENTO
// ============================================================
async function simularCrecimiento(e) {
  const ai = e.ayanokoji_IA;
  if (!ai) return;
  const estado = await leerEstado(e);

  const res = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Shadow Arise: ${estado.usuarios} usuarios (${estado.usuarios_pago} pago), ${estado.st.toFixed(2)} ST, día ${estado.dia_simulacion}.

Simula el crecimiento orgánico de esta semana. Sé realista. 200 palabras.` }],
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
// CRON AUTÓNOMO
// ============================================================
export async function cronSandbox(e) {
  const db = gDB(e, 'agente');
  if (!db) return;
  if (!await consumir(e, 'sandbox')) return;

  const estado = await leerEstado(e);
  if (!estado) return;

  const construccion = await leerConstruccion(e);

  // Verificar límite de cron también
  const lim = await leerLimites(e);
  if (lim.cron_execuciones >= LIMITES_CF.cron_execuciones) {
    return; // No puede correr más cron hoy
  }
  lim.cron_execuciones += 1;
  await guardarLimites(e, lim);

  // 1. Construir primero
  if (!construccion.completado) {
    await construirShadowArise(e);
    return;
  }

  // 2. Simular arranque si no hay usuarios
  if (estado.usuarios === 0) {
    await simularArranque(e);
    return;
  }

  // 3. Si no hay ST pero hay usuarios, simular crecimiento
  if (estado.st < 0.5 && estado.usuarios > 0 && estado.dia_simulacion % 3 === 0) {
    await simularCrecimiento(e);
    return;
  }

  // 4. Priorizar gastos cada 5 días
  if (estado.st > 2 && estado.dia_simulacion % 5 === 0) {
    try { await priorizarGastos(e); } catch (x) {}
  }

  // 5. Procesar escenarios pendientes
  const escPend = await db.prepare("SELECT id FROM sandbox_escenarios WHERE completado IS NULL LIMIT 2").all();
  if (escPend.results && escPend.results.length) {
    for (const esc of escPend.results) {
      if (estado.st >= COSTO.decision) await decidir(e, esc.id);
    }
    return;
  }

  // 6. Generar nuevo (eligiendo tema)
  if (estado.st >= COSTO.escenario) {
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
    const construccion = await leerConstruccion(e);
    const lim = await leerLimites(e);

    const limitesEstado = {};
    for (const [k, max] of Object.entries(LIMITES_CF)) {
      limitesEstado[k] = { usado: lim[k] || 0, max, pct: Math.round(((lim[k] || 0) / max) * 100) };
    }

    return J({
      stats: stats || { total: 0, completados: 0 },
      estado_economico: estado,
      aprendizaje: ap,
      curriculum_actual: await decidirSiguienteTema(e),
      construccion_completada: construccion.completado,
      plan_shadow_arise: construccion.plan.texto ? construccion.plan.texto.substring(0, 3000) : null,
      limites_cloudflare: limitesEstado,
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
