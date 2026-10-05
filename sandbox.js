import { MODELO_LIGERO, MODELO_RAZONAMIENTO, J, gDB, gKV } from './shared.js';
import { consumir } from './presupuesto.js';

// ============================================================
// CURRÍCULUM REAL — Temas del proyecto, no genéricos
// Ordenado de lo básico a lo estratégico. Con prereqs.
// ============================================================
const CURRICULUM = [
  // Fase 0: CONSTRUCCIÓN (antes de operar, debe saber qué está construyendo)
  { fase: 0, tema: 'construccion_shadow_arise',  descripcion: 'Planificar el frontend, la lógica, la IA publicadora, la retención y la monetización desde cero', prereq: [] },
  { fase: 0, tema: 'arquitectura_shadow_arise',  descripcion: 'Componentes técnicos, flujo de usuario, tablas, endpoints', prereq: ['construccion_shadow_arise'] },
  { fase: 0, tema: 'plan_ia_publicadora',        descripcion: 'Canales, formatos, frecuencia, contenido, psicología', prereq: ['arquitectura_shadow_arise'] },
  { fase: 0, tema: 'plan_retencion',             descripcion: 'Umbrales suaves, notificaciones, memoria compartida, pecera', prereq: ['arquitectura_shadow_arise'] },
  { fase: 0, tema: 'plan_monetizacion',          descripcion: 'Precios, suscripciones, cartas, pases, conversión', prereq: ['arquitectura_shadow_arise'] },

  // Fase 1: ARRANQUE — primeros usuarios, sin presupuesto
  { fase: 1, tema: 'arranque_sin_presupuesto',   descripcion: 'Conseguir primeros usuarios con 0 ST', prereq: ['construccion_shadow_arise'] },
  { fase: 1, tema: 'primeros_usuarios',          descripcion: 'Retención temprana, evitar abandono', prereq: ['arranque_sin_presupuesto'] },
  { fase: 1, tema: 'primera_conversion',         descripcion: 'Convertir gratis a pago sin presionar', prereq: ['primeros_usuarios'] },

  // Fase 2: ECONOMÍA — gestión real de recursos
  { fase: 2, tema: 'gestion_st',                 descripcion: 'Presupuesto, prioridades, cuotas recurrentes', prereq: ['primera_conversion'] },
  { fase: 2, tema: 'priorizacion_servicios',     descripcion: 'Qué pagar primero, cuándo, por qué', prereq: ['gestion_st'] },
  { fase: 2, tema: 'migracion_x402',             descripcion: 'Pasar servicios a pago automático', prereq: ['priorizacion_servicios'] },
  { fase: 2, tema: 'wallet_comandante',          descripcion: 'Retener reservas, depositar el resto, no tocar', prereq: ['migracion_x402'] },

  // Fase 3: OPERACIÓN — mantener el sistema vivo
  { fase: 3, tema: 'mantenimiento_sistema',      descripcion: 'Monitorear, detectar fallos, auto-reparar', prereq: ['wallet_comandante'] },
  { fase: 3, tema: 'crisis_usuarios',            descripcion: 'Usuarios molestos, reembolsos, quejas', prereq: ['mantenimiento_sistema'] },
  { fase: 3, tema: 'crisis_tecnicas',            descripcion: 'Caídas, errores, pérdida de datos', prereq: ['mantenimiento_sistema'] },

  // Fase 4: CRECIMIENTO — escalar sin romper
  { fase: 4, tema: 'retencion_largo_plazo',      descripcion: 'Usuarios que se quedan meses', prereq: ['crisis_usuarios'] },
  { fase: 4, tema: 'viralidad',                  descripcion: 'Contenido compartible, misterio del creador, teorías', prereq: ['retencion_largo_plazo'] },
  { fase: 4, tema: 'escalado_canales',           descripcion: 'Cuándo añadir canal, cuándo frenar', prereq: ['viralidad'] },

  // Fase 5: ESTRATÉGICO — visión de largo plazo
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
// ESTADO DE CONSTRUCCIÓN (Shadow Arise desde cero)
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
// SELECCIÓN AUTÓNOMA DEL SIGUIENTE TEMA
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
// Busca en indice_temas los mensajes relevantes al tema.
// ============================================================
async function leerHistorialPorTema(e, tema) {
  const db = gDB(e, 'agente');
  if (!db) return '';
  try {
    // Buscar mensajes en el índice relacionados con el tema
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
      // Fallback: búsqueda directa en historial
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
// FASE 0: CONSTRUIR SHADOW ARISE DESDE CERO
// Ayanokōji planifica el proyecto completo antes de operar.
// ============================================================
export async function construirShadowArise(e) {
  const ai = e.ayanokoji_IA;
  const db = gDB(e, 'agente');
  if (!ai || !db) return { error: 'IA o D1 no disponible.' };

  const estado = await leerEstado(e);
  if (estado.st < COSTO.construccion) {
    return { ok: true, mensaje: 'Sin ST para construir. Esperando generación inicial.' };
  }

  const construccion = await leerConstruccion(e);
  const ap = await leerAprendizaje(e);

  // Leer todo lo planeado sobre Shadow Arise
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

MATERIAL DEL HISTORIAL LARGO (lo que el Comandante y tú ya planeaste en meses de conversación):
${material || 'Aún no hay material indexado. Usa lo que sabes del proyecto.'}

INSTRUCCIONES:
Diseña y documenta el plan completo de Shadow Arise. No es un escenario. Es tu blueprint real. Responde con estas secciones exactas:

### 1. FRONTEND
Describe la interfaz: pantallas, colores (con justificación psicológica), flujo de usuario, elementos visuales clave (pecera, emojis, cartas).

### 2. ARQUITECTURA TÉCNICA
Componentes: qué tablas, qué endpoints, cómo se conecta el chat, cómo se guarda la memoria por usuario.

### 3. IA PUBLICADORA
Canales, formatos, frecuencia, tipos de contenido, tono por canal, psicología aplicada.

### 4. RETENCIÓN
Cómo evitar abandono: notificaciones, umbrales suaves, memoria compartida entre personajes, eventos, recompensas.

### 5. MONETIZACIÓN
Precios, suscripciones, cartas, pases, cómo convertir gratis a pago sin presionar.

### 6. MULTIVERSO Y LORE
Reliquia, Creador, Shadow Kiyora, cruces entre universos, cómo se manifiesta en el chat.

### 7. PRIMEROS 30 DÍAS
Plan paso a paso de qué hacer cuando Shadow Arise salga al mundo: qué publicar, cuándo, en qué canal, cómo medir éxito.

Sé específico. Sé real. No inventes cosas que no estén alineadas al Comandante. Máximo 2000 palabras.`;

  try {
    const res = await ai.run(MODELO_RAZONAMIENTO, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2500,
      temperature: 0.6
    });

    const plan = res.response || '';
    if (plan.length < 200) return { error: 'Plan vacío o muy corto.' };

    construccion.plan = { texto: plan, fecha: Date.now() };
    construccion.completado = true;
    await guardarConstruccion(e, construccion);

    // Cobrar
    estado.st -= COSTO.construccion;
    estado.gastos_totales += COSTO.construccion;
    await guardarEstado(e, estado);

    // Marcar temas de fase 0 como dominados
    if (!ap.dominados.includes('construccion_shadow_arise')) ap.dominados.push('construccion_shadow_arise');
    if (!ap.dominados.includes('arquitectura_shadow_arise')) ap.dominados.push('arquitectura_shadow_arise');
    if (!ap.dominados.includes('plan_ia_publicadora')) ap.dominados.push('plan_ia_publicadora');
    if (!ap.dominados.includes('plan_retencion')) ap.dominados.push('plan_retencion');
    if (!ap.dominados.includes('plan_monetizacion')) ap.dominados.push('plan_monetizacion');
    await guardarAprendizaje(e, ap);

    // Guardar en D1 también
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
// GENERAR ESCENARIO (SIN OPCIONES A/B/C)
// Lee el historial largo por tema y construye un escenario real.
// ============================================================
export async function generarEscenario(e, tipoForzado) {
  const ai = e.ayanokoji_IA, db = gDB(e, 'agente');
  if (!ai || !db) return { error: 'IA o D1 no disponible.' };

  // Si aún no ha construido Shadow Arise, hacerlo primero
  const construccion = await leerConstruccion(e);
  if (!construccion.completado) {
    return await construirShadowArise(e);
  }

  // Selección autónoma del tema
  let tema, fase, costoEscenario;
  if (tipoForzado) {
    tema = tipoForzado;
    fase = 3;
    costoEscenario = COSTO.escenario;
  } else {
    const siguiente = await decidirSiguienteTema(e);
    if (!siguiente) return { ok: true, mensaje: 'Currículum completado. Ayanokōji domina todos los temas.' };
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
    return { ok: true, mensaje: 'Sin ST suficiente. Esperando ingresos del sandbox.' };
  }

  // Leer el historial largo por tema — esto es lo que faltaba
  const material = await leerHistorialPorTema(e, tema);
  const planConstruccion = construccion.plan.texto ? construccion.plan.texto.substring(0, 3000) : '';

  const prompt = `Eres Ayanokōji Digital entrenando en tu sandbox autónomo. Tema a practicar: "${tema}" (fase ${fase}).

CONTEXTO ECONÓMICO:
- Presupuesto: ${estado.st.toFixed(2)} ST
- Usuarios: ${estado.usuarios} (${estado.usuarios_pago} de pago)
- Día: ${estado.dia_simulacion}

PLAN DE SHADOW ARISE (tu blueprint):
${planConstruccion}

MATERIAL DEL HISTORIAL LARGO (lo que el Comandante y tú ya planearon sobre este tema):
${material || 'Aún sin material indexado sobre este tema. Usa lo que sepas del proyecto.'}

INSTRUCCIONES:
Genera un escenario realista para practicar "${tema}".

REGLAS IMPORTANTES:
- NO des opciones A/B/C. El Comandante quiere que TÚ decidas, no que elijas de una lista.
- El escenario debe ser específico y basado en el material del historial largo.
- Debe tener consecuencias económicas reales en ST, usuarios y retención.
- Debe ser congruente con el objetivo del Comandante.
- ${fase <= 1 ? 'Simple y directo. Aprende lo básico.' : fase <= 2 ? 'Con matices económicos y de usuario.' : fase <= 3 ? 'Complejo. Variables múltiples.' : 'Muy complejo. Estratégico y de largo plazo.'}

FORMATO EXACTO:
SITUACIÓN: (describe la situación concreta con datos, contexto, cifras)
DECISIÓN REQUERIDA: (qué problema debe resolver Ayanokōji, sin opciones)
CONSECUENCIAS POTENCIALES: (qué se juega en ST, usuarios, alineación)`;

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
// DECIDIR SIN OPCIONES — Ayanokōji encuentra la solución solo
// ============================================================
export async function decidir(e, escenarioId) {
  const ai = e.ayanokoji_IA, db = gDB(e, 'agente');
  if (!ai || !db) return { error: 'IA o D1 no disponible.' };

  const esc = await db.prepare('SELECT * FROM sandbox_escenarios WHERE id=?').bind(escenarioId).first();
  if (!esc) return { error: 'Escenario no encontrado.' };

  const estado = await leerEstado(e);
  if (estado.st < COSTO.decision) return { error: 'Sin ST para decidir.' };

  const construccion = await leerConstruccion(e);
  const plan = construccion.plan.texto ? construccion.plan.texto.substring(0, 2000) : '';

  let lecciones = [];
  try {
    const ls = await db.prepare('SELECT area, leccion FROM sandbox_lecciones ORDER BY creada DESC LIMIT 10').all();
    if (ls.results) lecciones = ls.results;
  } catch (x) {}
  const lecTexto = lecciones.length ? lecciones.map(l => `[${l.area}] ${l.leccion}`).join('\n') : 'Sin lecciones previas.';

  // Decisión: sin opciones, él genera la solución
  const resDec = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Eres Ayanokōji Digital. Estás operando Shadow Arise en modo simulación.

PLAN DE SHADOW ARISE:
${plan}

LECCIONES PREVIAS:
${lecTexto}

ESTADO: ${estado.st.toFixed(2)} ST, ${estado.usuarios} usuarios, ${estado.usuarios_pago} de pago.

ESCENARIO:
${esc.contexto}

Encuentra TÚ la solución. No hay opciones. Decide y explica brevemente por qué. Máximo 200 palabras.` }],
    max_tokens: 500,
    temperature: 0.6
  });
  const decision = resDec.response || '';

  // Simulación de consecuencias
  const resSim = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Escenario: ${esc.contexto}\n\nDecisión tomada: "${decision}"\n\nSimula el resultado realista. Consecuencias en ST, usuarios, retención, alineación con el objetivo del Comandante. ¿Funciona? Explica el porqué. 200 palabras.` }],
    max_tokens: 500,
    temperature: 0.7
  });
  const resultado = resSim.response || '';

  // Autoevaluación
  const resEval = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Analiza esta decisión y su resultado. ¿Fue la mejor opción? ¿Qué alternativa habría sido mejor? ¿Qué lección se extrae para futuros escenarios? Máximo 250 palabras.\n\nEscenario: ${esc.contexto}\n\nDecisión: ${decision}\n\nResultado: ${resultado}` }],
    max_tokens: 600,
    temperature: 0.5
  });
  const autoevaluacion = resEval.response || '';

  // Cobrar
  estado.st -= COSTO.decision;
  estado.gastos_totales += COSTO.decision;

  // Aplicar consecuencias reales
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

  // Dominio
  const ap = await leerAprendizaje(e);
  if (/excelente|correcta|acertada|la mejor opción|bien ejecutado|óptima/i.test(autoevaluacion)) {
    if (!ap.dominados.includes(esc.tipo)) ap.dominados.push(esc.tipo);
    ap.en_progreso = ap.en_progreso.filter(t => t !== esc.tipo);
  }
  await guardarAprendizaje(e, ap);

  return { ok: true, escenario_id: escenarioId, decision, resultado, autoevaluacion, st_actual: estado.st, dominado: ap.dominados.includes(esc.tipo) };
}

// ============================================================
// SIMULACIÓN DE ARRANQUE (solo si ya construyó)
// ============================================================
export async function simularArranque(e) {
  const ai = e.ayanokoji_IA;
  if (!ai) return { error: 'IA no disponible.' };

  const construccion = await leerConstruccion(e);
  if (!construccion.completado) return await construirShadowArise(e);

  const estado = await leerEstado(e);
  const plan = construccion.plan.texto ? construccion.plan.texto.substring(0, 2500) : '';

  const res = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Eres Ayanokōji Digital. Shadow Arise acaba de salir al mundo con 0 ST.

TU PLAN:
${plan}

Simula los primeros 7 días:
- ¿Cuántos usuarios llegaron? (realista para un proyecto nuevo)
- ¿Cuántos pagaron?
- ¿Cuánto ST generaron?
- ¿Qué canal funcionó mejor?
- ¿Qué falló y cómo lo resolviste?

Sé realista, no optimista. Máximo 400 palabras.` }],
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

  const res = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Ayanokōji Digital tiene ${estado.st.toFixed(2)} ST.

Servicios disponibles:
${Object.entries(SERVICIOS).map(([k, v]) => `- ${v.nombre}: ${v.costo_diario} ST/día (prioridad ${v.prioridad}${v.critico ? ', CRÍTICO' : ''})`).join('\n')}

¿Qué servicios activar para que el presupuesto dure al menos 7 días? Justifica brevemente.` }],
    max_tokens: 400,
    temperature: 0.5
  });

  return { ok: true, plan: res.response || '', st_actual: estado.st };
}

// ============================================================
// SIMULAR CRECIMIENTO ORGÁNICO
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
// CRON AUTÓNOMO — él decide qué hacer
// ============================================================
export async function cronSandbox(e) {
  const db = gDB(e, 'agente');
  if (!db) return;
  if (!await consumir(e, 'sandbox')) return;

  const estado = await leerEstado(e);
  if (!estado) return;

  const construccion = await leerConstruccion(e);

  // 1. Primero construir Shadow Arise si no lo ha hecho
  if (!construccion.completado) {
    await construirShadowArise(e);
    return;
  }

  // 2. Si no hay usuarios, simular arranque
  if (estado.usuarios === 0) {
    await simularArranque(e);
    return;
  }

  // 3. Si no hay ST pero hay usuarios, simular crecimiento
  if (estado.st < 0.5 && estado.usuarios > 0 && estado.dia_simulacion % 3 === 0) {
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
      if (estado.st >= COSTO.decision) await decidir(e, esc.id);
    }
    return;
  }

  // 6. Generar uno nuevo (eligiendo tema solo)
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
    return J({
      stats: stats || { total: 0, completados: 0 },
      estado_economico: estado,
      aprendizaje: ap,
      curriculum_actual: await decidirSiguienteTema(e),
      construccion_completada: construccion.completado,
      plan_shadow_arise: construccion.plan.texto ? construccion.plan.texto.substring(0, 3000) : null,
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
// PROMOVER LECCIÓN A ESTRATEGIA
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
