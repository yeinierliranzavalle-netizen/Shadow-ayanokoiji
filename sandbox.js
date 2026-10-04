import { MODELO_LIGERO, MODELO_RAZONAMIENTO, J, gDB, gKV } from './shared.js';
import { consumir } from './presupuesto.js';

// ============ CURRÍCULUM PROGRESIVO ============
// Ayanokōji no salta a lo complejo sin dominar lo básico.
// Cada nivel requiere que el anterior esté aprobado.
const CURRICULUM = [
  // Nivel 1: Básico — cómo funciona el sistema y cómo responder
  { nivel: 1, tema: 'identidad', descripcion: 'Quién es, qué rol cumple, cómo debe responder', prereq: [] },
  { nivel: 1, tema: 'comunicacion', descripcion: 'Cómo hablar al Comandante, tono, formato', prereq: [] },
  { nivel: 1, tema: 'memoria', descripcion: 'Cómo guardar, leer y usar el historial largo', prereq: [] },

  // Nivel 2: Sistema — cómo funciona Shadow Arise y sus componentes
  { nivel: 2, tema: 'shadow_arise', descripcion: 'Componentes, arquitectura, flujo de usuario', prereq: ['identidad'] },
  { nivel: 2, tema: 'usuarios', descripcion: 'Tipos de usuario, retención, conversión', prereq: ['shadow_arise'] },
  { nivel: 2, tema: 'publicacion', descripcion: 'Canales, formatos, contenido, frecuencia', prereq: ['shadow_arise'] },

  // Nivel 3: Economía — dinero, costos, priorización
  { nivel: 3, tema: 'monetizacion', descripcion: 'Precios, suscripciones, conversión a pago', prereq: ['usuarios'] },
  { nivel: 3, tema: 'presupuesto', descripcion: 'Gestión de ST, priorización de gastos', prereq: ['monetizacion'] },
  { nivel: 3, tema: 'x402', descripcion: 'Pagos automáticos, migración a modo pago', prereq: ['presupuesto'] },

  // Nivel 4: Crisis — qué hacer cuando algo falla
  { nivel: 4, tema: 'crisis', descripcion: 'Errores, caídas, usuarios molestos, reembolsos', prereq: ['presupuesto'] },
  { nivel: 4, tema: 'escalado', descripcion: 'Cuándo crecer, cuándo frenar, cuándo expandir', prereq: ['crisis'] },

  // Nivel 5: Estratégico — visión de largo plazo
  { nivel: 5, tema: 'viralidad', descripcion: 'Cómo hacer que Shadow Arise se expanda solo', prereq: ['escalado'] },
  { nivel: 5, tema: 'lore', descripcion: 'Multiverso, misterio del creador, reliquia', prereq: ['viralidad'] },
  { nivel: 5, tema: 'etica', descripcion: 'Límites, privacidad, modo privado, respeto al usuario', prereq: ['lore'] }
];

// ============ SERVICIOS Y COSTOS ============
const SERVICIOS = {
  workers_ai:   { nombre: 'Workers AI',    costo_diario: 0.5,  prioridad: 1, critico: true },
  d1_storage:   { nombre: 'D1 Storage',    costo_diario: 0.1,  prioridad: 2, critico: true },
  kv_storage:   { nombre: 'KV Storage',    costo_diario: 0.05, prioridad: 3, critico: false },
  publisher:    { nombre: 'Publisher',     costo_diario: 0.2,  prioridad: 4, critico: false },
  x402_proxy:   { nombre: 'x402 Proxy',    costo_diario: 0.15, prioridad: 5, critico: false }
};

const COSTO = {
  escenario_simple: 0.03,
  escenario_medio: 0.05,
  escenario_complejo: 0.10,
  decision: 0.03,
  publicacion: 0.02,
  imagen: 0.15,
  analisis: 0.05
};

const ESTADO_KEY = 'sandbox:estado';
const APRENDIZAJE_KEY = 'sandbox:aprendizaje';

// ============ ESTADO ECONÓMICO ============
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

// ============ ESTADO DE APRENDIZAJE ============
async function leerAprendizaje(e) {
  const kv = gKV(e, 'agente');
  if (!kv) return { dominados: [], en_progreso: [], fallos: {} };
  try {
    const raw = await kv.get(APRENDIZAJE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (x) {}
  return { dominados: [], en_progreso: [], fallos: {}, intentos: {} };
}

async function guardarAprendizaje(e, ap) {
  const kv = gKV(e, 'agente');
  if (!kv) return;
  try {
    await kv.put(APRENDIZAJE_KEY, JSON.stringify(ap), { expirationTtl: 31536000 });
  } catch (x) {}
}

// ============ AUTONOMÍA: DECIDIR QUÉ ESTUDIAR ============
async function decidirSiguienteTema(e) {
  const ap = await leerAprendizaje(e);
  // Buscar el tema más básico que aún no domina y cuyos prereqs estén cumplidos
  for (const item of CURRICULUM) {
    if (ap.dominados.includes(item.tema)) continue;
    const prereqsCumplidos = item.prereq.every(p => ap.dominados.includes(p));
    if (prereqsCumplidos) {
      return item;
    }
  }
  return null; // Ya dominó todo
}

// ============ GENERAR ESCENARIO AUTÓNOMO ============
export async function generarEscenario(e, tipoForzado) {
  const ai = e.ayanokoji_IA, db = gDB(e, 'agente');
  if (!ai || !db) return { error: 'IA o D1 no disponible.' };

  // Si no hay tipo forzado, decidir por sí mismo según currículum
  let tema, nivel, costoEscenario;
  if (tipoForzado) {
    tema = tipoForzado;
    nivel = 3;
    costoEscenario = COSTO.escenario_medio;
  } else {
    const siguiente = await decidirSiguienteTema(e);
    if (!siguiente) {
      return { ok: true, mensaje: 'Currículum completado. Ayanokōji ha dominado todos los temas.' };
    }
    tema = siguiente.tema;
    nivel = siguiente.nivel;
    costoEscenario = nivel <= 2 ? COSTO.escenario_simple : nivel <= 3 ? COSTO.escenario_medio : COSTO.escenario_complejo;
  }

  // Verificar presupuesto
  const estado = await leerEstado(e);
  if (estado.st < costoEscenario) {
    // Si no hay ST, simular generación de ingresos primero
    if (estado.usuarios === 0) {
      await simularArranque(e);
      return { ok: true, mensaje: 'Sin ST. Ejecutada simulación de arranque para generar ingresos iniciales.' };
    }
    return { ok: true, mensaje: 'Sin ST suficiente. Esperando a que la economía del sandbox genere ingresos.' };
  }

  // Cargar contexto y estrategias
  let ctx = '';
  try {
    const c = await db.prepare('SELECT resumen FROM contexto ORDER BY fecha DESC LIMIT 1').first();
    if (c && c.resumen) ctx = c.resumen.substring(0, 2000);
  } catch (x) {}

  let estrategias = [];
  try {
    const es = await db.prepare("SELECT nombre, tipo, contenido FROM estrategias WHERE estado='activa' ORDER BY prioridad ASC LIMIT 5").all();
    if (es.results) estrategias = es.results;
  } catch (x) {}

  const estrTexto = estrategias.length
    ? estrategias.map(es => `[${es.tipo}] ${es.nombre}: ${es.contenido}`).join('\n')
    : 'Sin estrategias cargadas.';

  // Prompt según nivel
  const promptBase = `Eres Ayanokōji Digital. Estás entrenando en tu sandbox autónomo. Tu tarea es generar un escenario realista para practicar el tema "${tema}" (nivel ${nivel}/5).

ESTADO ACTUAL:
- Presupuesto: ${estado.st.toFixed(2)} ST (1 ST = 1 USDT)
- Usuarios: ${estado.usuarios} (${estado.usuarios_pago} de pago)
- Día de simulación: ${estado.dia_simulacion}

CONTEXTO DEL PROYECTO:
${ctx}

ESTRATEGIAS ACTIVAS:
${estrTexto}

INSTRUCCIONES:
- El escenario debe estar alineado al objetivo del Comandante: construir Shadow Arise, retener usuarios, generar ingresos, y no desviarse.
- Debe tener consecuencias económicas reales (ST ganados o perdidos, usuarios ganados o perdidos).
- Debe tener 3 opciones concretas.
- Debe ser específico, no genérico.
- ${nivel <= 2 ? 'Sé simple y directo. Enseña lo básico.' : nivel <= 3 ? 'Incluye matices económicos y de usuario.' : 'Es un escenario complejo. Incluye variables múltiples y consecuencias profundas.'}

Formato:
CONTEXTO: (situación concreta)
PREGUNTA: (qué debe decidir)
OPCIONES:
1. (opción con costo/beneficio en ST)
2. (opción con costo/beneficio en ST)
3. (opción con costo/beneficio en ST)`;

  try {
    const res = await ai.run(MODELO_RAZONAMIENTO, {
      messages: [{ role: 'user', content: promptBase }],
      max_tokens: 700,
      temperature: 0.7
    });

    const contenido = res.response || '';
    if (contenido.length < 50) return { error: 'Escenario vacío.' };

    // Cobrar
    estado.st -= costoEscenario;
    estado.gastos_totales += costoEscenario;
    await guardarEstado(e, estado);

    const r = await db.prepare(
      'INSERT INTO sandbox_escenarios(tipo,contexto,creado) VALUES(?,?,?)'
    ).bind(tema, contenido, Date.now()).run();

    // Marcar como en progreso
    const ap = await leerAprendizaje(e);
    if (!ap.en_progreso.includes(tema)) ap.en_progreso.push(tema);
    ap.intentos[tema] = (ap.intentos[tema] || 0) + 1;
    await guardarAprendizaje(e, ap);

    return { ok: true, id: r.meta.last_row_id, tipo: tema, nivel, escenario: contenido, st_actual: estado.st };
  } catch (x) {
    return { error: 'Error IA: ' + x.message };
  }
}

// ============ DECIDIR Y AUTOEVALUAR ============
export async function decidir(e, escenarioId) {
  const ai = e.ayanokoji_IA, db = gDB(e, 'agente');
  if (!ai || !db) return { error: 'IA o D1 no disponible.' };

  const esc = await db.prepare('SELECT * FROM sandbox_escenarios WHERE id=?').bind(escenarioId).first();
  if (!esc) return { error: 'Escenario no encontrado.' };

  const estado = await leerEstado(e);
  if (estado.st < COSTO.decision) return { error: 'Sin ST para decidir.' };

  let lecciones = [];
  try {
    const ls = await db.prepare('SELECT area, leccion FROM sandbox_lecciones ORDER BY creada DESC LIMIT 10').all();
    if (ls.results) lecciones = ls.results;
  } catch (x) {}

  const lecTexto = lecciones.length
    ? lecciones.map(l => `[${l.area}] ${l.leccion}`).join('\n')
    : 'Sin lecciones previas.';

  // Decisión con DeepSeek (razonamiento)
  const resDec = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Eres Ayanokōji Digital. Presupuesto: ${estado.st.toFixed(2)} ST. Usuarios: ${estado.usuarios}.

LECCIONES PREVIAS:
${lecTexto}

ESCENARIO:
${esc.contexto}

Toma una decisión. Considera el costo, el beneficio y la alineación con el objetivo del Comandante. Responde SOLO con la decisión y una justificación breve (máx 100 palabras).` }],
    max_tokens: 350,
    temperature: 0.6
  });
  const decision = resDec.response || 'Sin decisión.';

  // Simular resultado
  const resSim = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Escenario: ${esc.contexto}\n\nDecisión: "${decision}"\n\nSimula el resultado realista. Consecuencias en ST, usuarios, ingresos, retención. ¿Funciona o no? Explica el porqué. 150 palabras.` }],
    max_tokens: 400,
    temperature: 0.7
  });
  const resultado = resSim.response || '';

  // Autoevaluación
  const resEval = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Analiza esta decisión y su resultado. ¿Fue la mejor opción? ¿Qué alternativa habría sido mejor? ¿Qué lección se extrae? Máximo 200 palabras.\n\nEscenario: ${esc.contexto}\n\nDecisión: ${decision}\n\nResultado: ${resultado}` }],
    max_tokens: 500,
    temperature: 0.5
  });
  const autoevaluacion = resEval.response || '';

  // Cobrar
  estado.st -= COSTO.decision;
  estado.gastos_totales += COSTO.decision;

  // Aplicar consecuencias económicas reales extraídas del resultado
  const mUsuarios = resultado.match(/(\d+)\s*(nuevos usuarios|usuarios nuevos|usuarios ganados)/i);
  const mSt = resultado.match(/(\d+(?:\.\d+)?)\s*ST/i);
  if (mUsuarios) estado.usuarios += parseInt(mUsuarios[1]);
  if (mSt) {
    const cantidad = parseFloat(mSt[1]);
    // Si el resultado describe ganancia, sumar; si describe pérdida, no sumar
    if (/gan|obtuv|recib|ingres/i.test(resultado)) {
      estado.st += cantidad;
      estado.ingresos_totales += cantidad;
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

  // Evaluar si domina el tema (puntuación alta)
  const ap = await leerAprendizaje(e);
  if (/excelente|correcta|acertada|la mejor opción|bien ejecutado/i.test(autoevaluacion)) {
    if (!ap.dominados.includes(esc.tipo)) ap.dominados.push(esc.tipo);
    ap.en_progreso = ap.en_progreso.filter(t => t !== esc.tipo);
  }
  await guardarAprendizaje(e, ap);

  return { ok: true, escenario_id: escenarioId, decision, resultado, autoevaluacion, st_actual: estado.st, dominado: ap.dominados.includes(esc.tipo) };
}

// ============ SIMULACIÓN DE ARRANQUE ============
export async function simularArranque(e) {
  const ai = e.ayanokoji_IA;
  if (!ai) return { error: 'IA no disponible.' };

  const estado = await leerEstado(e);

  const res = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Eres Ayanokōji Digital. Shadow Arise se lanza con 0 ST de presupuesto. El sistema está listo: chatbot con personajes de anime, multiverso, lore, pagos con USDT.

Simula cómo atraerías los primeros usuarios sin gastar nada:
- ¿Cuántos usuarios llegaron en la primera semana? (realista: 5-200)
- ¿Cuántos pagaron? (realista: 0-10%)
- ¿Cuánto ST generaron?
- ¿Qué canal funcionó mejor y por qué?

Sé realista. Es un proyecto nuevo sin audiencia previa. Máximo 300 palabras.` }],
    max_tokens: 600,
    temperature: 0.7
  });

  const simulacion = res.response || '';
  const mTotal = simulacion.match(/(\d+)\s*usuarios/i);
  const mPago = simulacion.match(/(\d+)\s*(de pago|pagaron|pagando)/i);

  const nuevosUsuarios = mTotal ? Math.min(parseInt(mTotal[1]), 200) : 5;
  const nuevosPago = mPago ? Math.min(parseInt(mPago[1]), nuevosUsuarios) : 0;
  const stGenerados = nuevosPago * 10;

  estado.usuarios += nuevosUsuarios;
  estado.usuarios_pago += nuevosPago;
  estado.st += stGenerados;
  estado.ingresos_totales += stGenerados;
  estado.dia_simulacion += 1;
  await guardarEstado(e, estado);

  return {
    ok: true,
    simulacion,
    nuevos_usuarios: nuevosUsuarios,
    nuevos_pago: nuevosPago,
    st_generados: stGenerados,
    st_actual: estado.st,
    usuarios_totales: estado.usuarios
  };
}

// ============ PRIORIZACIÓN AUTÓNOMA DE GASTOS ============
export async function priorizarGastos(e) {
  const db = gDB(e, 'agente');
  const ai = e.ayanokoji_IA;
  if (!db || !ai) return { error: 'IA o D1 no disponible.' };

  const estado = await leerEstado(e);
  if (estado.st < 0.5) return { ok: true, mensaje: 'Presupuesto insuficiente para priorizar.' };

  const res = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Ayanokōji Digital tiene ${estado.st.toFixed(2)} ST.

Servicios disponibles:
${Object.entries(SERVICIOS).map(([k, v]) => `- ${v.nombre}: ${v.costo_diario} ST/día (prioridad ${v.prioridad}${v.critico ? ', CRÍTICO' : ''})`).join('\n')}

¿Qué servicios activar para que el presupuesto dure al menos 7 días? Responde con lista y justificación breve.` }],
    max_tokens: 400,
    temperature: 0.5
  });

  const plan = res.response || '';
  return { ok: true, plan, st_actual: estado.st };
}

// ============ CRON AUTÓNOMO DEL SANDBOX ============
// Se ejecuta solo. Ayanokōji decide qué hacer en cada ciclo.
export async function cronSandbox(e) {
  const db = gDB(e, 'agente');
  if (!db) return;
  if (!await consumir(e, 'sandbox')) return;

  const estado = await leerEstado(e);
  if (!estado) return;

  // 1. Si es el primer día y no hay usuarios, simular arranque
  if (estado.dia_simulacion === 0 && estado.usuarios === 0) {
    await simularArranque(e);
    return;
  }

  // 2. Si no hay ST pero hay usuarios, simular crecimiento
  if (estado.st < 0.5 && estado.usuarios > 0 && estado.dia_simulacion % 3 === 0) {
    await simularCrecimiento(e);
    return;
  }

  // 3. Si tiene ST suficiente, priorizar gastos
  if (estado.st > 2 && estado.dia_simulacion % 5 === 0) {
    try { await priorizarGastos(e); } catch (x) {}
  }

  // 4. Procesar escenarios pendientes
  const escPend = await db.prepare("SELECT id FROM sandbox_escenarios WHERE completado IS NULL LIMIT 2").all();
  if (escPend.results && escPend.results.length) {
    for (const esc of escPend.results) {
      if (estado.st >= COSTO.decision) await decidir(e, esc.id);
    }
    return;
  }

  // 5. Generar uno nuevo (decidiendo el tema por sí mismo)
  if (estado.st >= COSTO.escenario_simple) {
    const g = await generarEscenario(e);
    if (!g.error && g.id) await decidir(e, g.id);
  }

  // 6. Avanzar día de simulación
  estado.dia_simulacion += 1;
  await guardarEstado(e, estado);
}

// ============ SIMULAR CRECIMIENTO ORGÁNICO ============
async function simularCrecimiento(e) {
  const ai = e.ayanokoji_IA;
  if (!ai) return;
  const estado = await leerEstado(e);

  const res = await ai.run(MODELO_RAZONAMIENTO, {
    messages: [{ role: 'user', content: `Shadow Arise tiene ${estado.usuarios} usuarios (${estado.usuarios_pago} de pago) y ${estado.st.toFixed(2)} ST. El día ${estado.dia_simulacion} de simulación.

Simula el crecimiento orgánico de esta semana:
- ¿Cuántos usuarios nuevos llegaron? (realista)
- ¿Cuántos se convirtieron a pago?
- ¿Cuánto ST generaron?
- ¿Hubo abandono? ¿Cuántos?

Máximo 200 palabras.` }],
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

// ============ VER SANDBOX ============
export async function verSandbox(r, e) {
  try {
    const db = gDB(e, 'agente');
    if (!db) return J({ error: 'D1 no configurado.' });
    const esc = await db.prepare('SELECT * FROM sandbox_escenarios ORDER BY creado DESC LIMIT 30').all();
    const lec = await db.prepare('SELECT * FROM sandbox_lecciones ORDER BY creada DESC LIMIT 30').all();
    const stats = await db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN completado IS NOT NULL THEN 1 ELSE 0 END) as completados FROM sandbox_escenarios").first();
    const estado = await leerEstado(e);
    const ap = await leerAprendizaje(e);
    return J({
      stats: stats || { total: 0, completados: 0 },
      estado_economico: estado,
      aprendizaje: ap,
      curriculum_actual: await decidirSiguienteTema(e),
      escenarios: esc.results || [],
      lecciones: lec.results || []
    });
  } catch (x) {
    return J({ error: x.message });
  }
}

// ============ SIMULACIÓN DE PRECIO ============
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

// ============ PROMOVER LECCIÓN ============
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
