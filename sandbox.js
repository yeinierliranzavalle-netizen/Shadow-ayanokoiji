import { MODELO_LIGERO, J, gDB } from './shared.js';
import { consumir } from './presupuesto.js';

const TIPOS = [
  'proyecto', 'economico', 'social', 'etico',
  'publicacion', 'tactico', 'monetizacion', 'x402',
  'crisis', 'retencion', 'escalado'
];

// ============ GENERAR ESCENARIO ============
export async function generarEscenario(e, tipoForzado) {
  const ai = e.ayanokoji_IA, db = gDB(e, 'agente');
  if (!ai || !db) return { error: 'IA o D1 no disponible.' };
  if (!await consumir(e, 'sandbox')) return { error: 'Presupuesto agotado.' };

  const tipo = tipoForzado || TIPOS[Math.floor(Math.random() * TIPOS.length)];

  // Cargar contexto real para realismo
  let ctx = '';
  try {
    const c = await db.prepare('SELECT resumen FROM contexto ORDER BY fecha DESC LIMIT 1').first();
    if (c && c.resumen) ctx = c.resumen.substring(0, 2500);
  } catch (x) {}

  // Cargar estrategias activas
  let estrategias = [];
  try {
    const es = await db.prepare("SELECT nombre, tipo, contenido FROM estrategias WHERE estado='activa' ORDER BY prioridad ASC LIMIT 5").all();
    if (es.results) estrategias = es.results;
  } catch (x) {}

  const estrTexto = estrategias.length
    ? estrategias.map(es => `[${es.tipo}] ${es.nombre}: ${es.contenido}`).join('\n')
    : 'Sin estrategias cargadas.';

  const prompt = `Genera un escenario realista tipo "${tipo}" para que Ayanokōji Digital (aliado del Comandante Yeinier) tome una decisión. Debe estar basado en el proyecto Shadow Arise y en el contexto real.

CONTEXTO DEL COMANDANTE:
${ctx}

ESTRATEGIAS ACTIVAS:
${estrTexto}

INSTRUCCIONES:
- El escenario debe ser específico, no genérico.
- Debe tener consecuencias reales si se decide mal.
- Debe tener 3 opciones concretas.
- Debe estar alineado a los objetivos del Comandante (libertad, casa, Shadow Arise, multiverso).
- Duración: 120-180 palabras.

Formato exacto:
CONTEXTO: (situación)
PREGUNTA: (qué debe decidir)
OPCIONES:
1. (opción A)
2. (opción B)
3. (opción C)`;

  const res = await ai.run(MODELO_LIGERO, {
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 500,
    temperature: 0.8
  });

  const contenido = res.response || '';
  if (contenido.length < 50) return { error: 'Escenario vacío.' };

  const r = await db.prepare(
    'INSERT INTO sandbox_escenarios(tipo,contexto,creado) VALUES(?,?,?)'
  ).bind(tipo, contenido, Date.now()).run();

  return { ok: true, id: r.meta.last_row_id, tipo, escenario: contenido };
}

// ============ DECIDIR (Ayanokōji toma la decisión) ============
export async function decidir(e, escenarioId, decisionExterna) {
  const ai = e.ayanokoji_IA, db = gDB(e, 'agente');
  if (!ai || !db) return { error: 'IA o D1 no disponible.' };
  if (!await consumir(e, 'sandbox')) return { error: 'Presupuesto agotado.' };

  const esc = await db.prepare('SELECT * FROM sandbox_escenarios WHERE id=?').bind(escenarioId).first();
  if (!esc) return { error: 'Escenario no encontrado.' };

  // Cargar lecciones previas para mejorar la decisión
  let lecciones = [];
  try {
    const ls = await db.prepare('SELECT area, leccion FROM sandbox_lecciones ORDER BY creada DESC LIMIT 10').all();
    if (ls.results) lecciones = ls.results;
  } catch (x) {}

  const lecTexto = lecciones.length
    ? lecciones.map((l, i) => `[${l.area}] ${l.leccion}`).join('\n')
    : 'Sin lecciones previas.';

  // Decisión
  let decision = decisionExterna;
  if (!decision) {
    const resDec = await ai.run(MODELO_LIGERO, {
      messages: [{ role: 'user', content: `Eres Ayanokōji Digital. Toma una decisión sobre este escenario. Responde SOLO con la decisión (una de las opciones o una variante razonada) y una justificación breve (máximo 80 palabras).

LECCIONES PREVIAS:
${lecTexto}

ESCENARIO:
${esc.contexto}` }],
      max_tokens: 250,
      temperature: 0.6
    });
    decision = resDec.response || 'Sin decisión.';
  }

  // Simular resultado
  const resSim = await ai.run(MODELO_LIGERO, {
    messages: [{ role: 'user', content: `Escenario:\n${esc.contexto}\n\nDecisión: "${decision}"\n\nSimula el resultado realista. ¿Qué consecuencias tiene? ¿Funciona o no? Explica el porqué en 150 palabras.` }],
    max_tokens: 350,
    temperature: 0.7
  });
  const resultado = resSim.response || '';

  // Autoevaluación
  const resEval = await ai.run(MODELO_LIGERO, {
    messages: [{ role: 'user', content: `Analiza esta decisión y su resultado. ¿Fue la mejor opción? ¿Qué alternativa habría sido mejor? ¿Qué lección se extrae? Máximo 200 palabras.\n\nEscenario: ${esc.contexto}\n\nDecisión: ${decision}\n\nResultado: ${resultado}` }],
    max_tokens: 450,
    temperature: 0.5
  });
  const autoevaluacion = resEval.response || '';

  await db.prepare('UPDATE sandbox_escenarios SET decision_tomada=?,resultado=?,autoevaluacion=?,completado=? WHERE id=?')
    .bind(decision, resultado, autoevaluacion, Date.now(), escenarioId).run();

  // Guardar lección si hay material
  if (autoevaluacion.length > 50) {
    await db.prepare('INSERT INTO sandbox_lecciones(escenario_id,area,leccion,creada) VALUES(?,?,?,?)')
      .bind(escenarioId, esc.tipo, autoevaluacion.substring(0, 1000), Date.now()).run();
  }

  // Registrar en decisiones autónomas
  try {
    await db.prepare('INSERT INTO decisiones_autonomas(tipo,contexto,decision,simulacion,aplicada,resultado,exito,fecha) VALUES(?,?,?,?,?,?,?,?)')
      .bind('sandbox_' + esc.tipo, esc.contexto.substring(0, 500), decision, resultado.substring(0, 500), 0, autoevaluacion.substring(0, 500), 1, Date.now()).run();
  } catch (x) {}

  return { ok: true, escenario_id: escenarioId, decision, resultado, autoevaluacion };
}

// ============ CRON SANDBOX (entrena solo) ============
export async function cronSandbox(e) {
  const db = gDB(e, 'agente');
  if (!db) return;
  if (!await consumir(e, 'sandbox')) return;

  // Limitar a 2 escenarios por ciclo para no gastar cuota
  const escPend = await db.prepare("SELECT id FROM sandbox_escenarios WHERE completado IS NULL LIMIT 2").all();
  if (escPend.results && escPend.results.length) {
    for (const esc of escPend.results) {
      await decidir(e, esc.id);
    }
    return;
  }

  // Si no hay pendientes, generar 1 nuevo
  const g = await generarEscenario(e);
  if (g.error) return;
  await decidir(e, g.id);
}

// ============ VER SANDBOX ============
export async function verSandbox(r, e) {
  try {
    const db = gDB(e, 'agente');
    if (!db) return J({ error: 'D1 no configurado.' });
    const esc = await db.prepare('SELECT * FROM sandbox_escenarios ORDER BY creado DESC LIMIT 30').all();
    const lec = await db.prepare('SELECT * FROM sandbox_lecciones ORDER BY creada DESC LIMIT 30').all();
    const stats = await db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN completado IS NOT NULL THEN 1 ELSE 0 END) as completados FROM sandbox_escenarios").first();
    return J({
      stats: stats || { total: 0, completados: 0 },
      escenarios: esc.results || [],
      lecciones: lec.results || []
    });
  } catch (x) {
    return J({ error: x.message });
  }
}

// ============ SIMULACIÓN ESPECÍFICA DE PRECIOS ============
export async function simularPrecio(r, e) {
  try {
    const b = await r.json();
    const ai = e.ayanokoji_IA;
    const db = gDB(e, 'agente');
    if (!ai || !db) return J({ error: 'IA o D1 no disponible.' });
    if (!await consumir(e, 'sandbox')) return J({ error: 'Presupuesto agotado.' });

    const propuesta = b.propuesta || 'precio base 10 USDT';
    const contexto = b.contexto || 'usuarios iniciales, sin base de datos de conversión todavía';

    const res = await ai.run(MODELO_LIGERO, {
      messages: [{ role: 'user', content: `Simula el resultado de esta propuesta de precio para Shadow Arise. Analiza: conversión esperada, retención, ingreso mensual estimado, riesgo de abandono. Máximo 250 palabras.\n\nPropuesta: ${propuesta}\n\nContexto: ${contexto}\n\nResponde con análisis realista, sin optimismo exagerado.` }],
      max_tokens: 500,
      temperature: 0.5
    });

    const simulacion = res.response || '';

    await db.prepare('INSERT INTO decisiones_autonomas(tipo,contexto,decision,simulacion,aplicada,resultado,exito,fecha) VALUES(?,?,?,?,?,?,?,?)')
      .bind('simulacion_precio', contexto, propuesta, simulacion, 0, 'pendiente de aplicar', 1, Date.now()).run();

    return J({ ok: true, propuesta, simulacion });
  } catch (x) {
    return J({ error: x.message });
  }
}

// ============ APLICAR UNA LECCIÓN A LAS ESTRATEGIAS ============
export async function promoverLeccion(r, e) {
  try {
    const b = await r.json();
    const leccionId = b.leccionId;
    const db = gDB(e, 'agente');
    if (!db || !leccionId) return J({ error: 'Faltan datos.' });

    const lec = await db.prepare('SELECT * FROM sandbox_lecciones WHERE id=?').bind(leccionId).first();
    if (!lec) return J({ error: 'Lección no encontrada.' });

    await db.prepare('INSERT INTO estrategias(nombre,tipo,contenido,prioridad,creada,actualizada) VALUES(?,?,?,?,?,?)')
      .bind('Lección ' + lec.area, 'sandbox', lec.leccion, 5, Date.now(), Date.now()).run();

    return J({ ok: true, mensaje: 'Lección promovida a estrategia activa.' });
  } catch (x) {
    return J({ error: x.message });
  }
}
