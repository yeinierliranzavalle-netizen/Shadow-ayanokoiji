import { MODELO_LIGERO, J, gDB } from './shared.js';
import { consumir } from './presupuesto.js';

const TIPOS = ['proyecto', 'economico', 'social', 'etico', 'publicacion', 'tactico'];

export async function generarEscenario(e) {
  const ai = e.ayanokoji_IA, db = gDB(e, 'agente');
  if (!ai || !db) return { error: 'IA o D1 no disponible.' };
  if (!await consumir(e, 'sandbox')) return { error: 'Presupuesto agotado.' };

  const tipo = TIPOS[Math.floor(Math.random() * TIPOS.length)];

  // Cargar contexto para realismo
  let ctx = '';
  try {
    const c = await db.prepare('SELECT resumen FROM contexto ORDER BY fecha DESC LIMIT 1').first();
    if (c && c.resumen) ctx = c.resumen.substring(0, 3000);
  } catch (x) {}

  const res = await ai.run(MODELO_LIGERO, {
    messages: [{ role: 'user', content: `Genera un escenario realista tipo "${tipo}" para que Ayanokōji Digital (aliado del Comandante Yeinier) tome una decisión. Debe estar basado en el proyecto Shadow Arise y el contexto del Comandante. Formato:\n\nCONTEXTO: (situación concreta, 100 palabras)\nPREGUNTA: (qué debe decidir)\nOPCIONES: (3 opciones concretas)\n\nContexto del Comandante:\n${ctx}` }],
    max_tokens: 500,
    temperature: 0.8
  });

  const contenido = res.response || '';
  const r = await db.prepare(
    'INSERT INTO sandbox_escenarios(tipo,contexto,creado) VALUES(?,?,?)'
  ).bind(tipo, contenido, Date.now()).run();

  return { ok: true, id: r.meta.last_row_id, tipo, escenario: contenido };
}

export async function decidir(e, escenarioId, decision) {
  const ai = e.ayanokoji_IA, db = gDB(e, 'agente');
  if (!ai || !db) return { error: 'IA o D1 no disponible.' };
  if (!await consumir(e, 'sandbox')) return { error: 'Presupuesto agotado.' };

  const esc = await db.prepare('SELECT * FROM sandbox_escenarios WHERE id=?').bind(escenarioId).first();
  if (!esc) return { error: 'Escenario no encontrado.' };

  // Simular resultado
  const res = await ai.run(MODELO_LIGERO, {
    messages: [{ role: 'user', content: `Escenario:\n${esc.contexto}\n\nDecisión tomada: "${decision}"\n\nSimula el resultado realista de esta decisión. ¿Qué consecuencias tiene? ¿Funciona o no? Explica el porqué en 150 palabras.` }],
    max_tokens: 400,
    temperature: 0.7
  });

  const resultado = res.response || '';

  // Autoevaluación
  const evalRes = await ai.run(MODELO_LIGERO, {
    messages: [{ role: 'user', content: `Analiza esta decisión y su resultado. ¿Fue la mejor opción? ¿Qué alternativa habría sido mejor? ¿Qué lección se extrae? 200 palabras máximo.\n\nEscenario: ${esc.contexto}\n\nDecisión: ${decision}\n\nResultado: ${resultado}` }],
    max_tokens: 500,
    temperature: 0.5
  });

  const autoevaluacion = evalRes.response || '';

  await db.prepare('UPDATE sandbox_escenarios SET decision_tomada=?,resultado=?,autoevaluacion=?,completado=? WHERE id=?')
    .bind(decision, resultado, autoevaluacion, Date.now(), escenarioId).run();

  // Guardar lección
  if (autoevaluacion.length > 50) {
    await db.prepare('INSERT INTO sandbox_lecciones(escenario_id,area,leccion,creada) VALUES(?,?,?,?)')
      .bind(escenarioId, esc.tipo, autoevaluacion.substring(0, 1000), Date.now()).run();
  }

  return { ok: true, resultado, autoevaluacion };
}

export async function cronSandbox(e) {
  const db = gDB(e, 'agente');
  if (!db) return;
  if (!await consumir(e, 'sandbox')) return;

  const g = await generarEscenario(e);
  if (g.error) return;

  // Decidir automáticamente (Ayanokōji simula su propia decisión)
  const ai = e.ayanokoji_IA;
  const decision = await ai.run(MODELO_LIGERO, {
    messages: [{ role: 'user', content: `Toma una decisión sobre este escenario como Ayanokōji Digital:\n\n${g.escenario}\n\nResponde solo con la decisión y una justificación breve (50 palabras).` }],
    max_tokens: 200,
    temperature: 0.7
  });
  const dec = decision.response || 'No decidió.';
  await decidir(e, g.id, dec);
}

export async function verSandbox(r, e) {
  try {
    const db = gDB(e, 'agente');
    if (!db) return J({ error: 'D1 no configurado.' });
    const esc = await db.prepare('SELECT * FROM sandbox_escenarios ORDER BY creado DESC LIMIT 20').all();
    const lec = await db.prepare('SELECT * FROM sandbox_lecciones ORDER BY creada DESC LIMIT 20').all();
    return J({ escenarios: esc.results, lecciones: lec.results });
  } catch (x) {
    return J({ error: x.message });
  }
}
