// examen.js — Sistema de Examen de Criterio + Confianza visible
// Genera preguntas basadas en el estado real del proyecto, predice la respuesta
// del Comandante, compara, y ajusta la confianza.

import { MODELO, gDB, gKV } from './shared.js';
import { consumir } from './presupuesto.js';
import { sumarConfianza, restarConfianza, verConfianza, escribirLeccion } from './autonomia.js';

function extraerRespuesta(res) {
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
  if (typeof res.output === 'string') return res.output;
  return '';
}

// ============================================================
// GENERAR PREGUNTA DE CRITERIO
// ============================================================
export async function generarPregunta(e) {
  const db = gDB(e, 'agente');
  const kv = gKV(e, 'agente');
  const ai = e.ayanokoji_IA;
  if (!db || !kv || !ai) return { error: 'Falta DB, KV o IA.' };

  // Límite diario
  const hoy = new Date().toISOString().split('T')[0];
  const desde = new Date(hoy + 'T00:00:00Z').getTime();
  const intensivo = (await kv.get('modo_intensivo')) === 'true';
  const limite = intensivo ? 5 : 1;

  try {
    const cnt = await db.prepare("SELECT COUNT(*) as n FROM examen_criterio WHERE fecha > ?").bind(desde).first();
    if (cnt && cnt.n >= limite) {
      return { error: `Límite diario alcanzado (${limite}/día${intensivo ? ' en modo intensivo' : ''}). ${intensivo ? 'Se renueva mañana a medianoche UTC.' : 'Activa modo intensivo para 5 preguntas/día.'}` };
    }
  } catch (x) {}

  // Verificar si hay examen pendiente sin responder
  try {
    const pendiente = await db.prepare("SELECT id FROM examen_criterio WHERE respondida=0 ORDER BY fecha DESC LIMIT 1").first();
    if (pendiente) return { error: 'Ya hay una pregunta pendiente. Respóndela antes de pedir otra.', pendiente_id: pendiente.id };
  } catch (x) {}

  if (!await consumir(e, 'procesamiento')) return { error: 'Presupuesto agotado.' };

  // Leer contexto del proyecto
  let mision = null;
  try { mision = JSON.parse(await kv.get('mision:estado') || 'null'); } catch (x) {}

  const pendientes = [
    'Crear sub-orquestador de Shadow Arise',
    'Rediseñar frontend estilo Stark',
    'Integrar x402 + wallet USDT',
    'Lanzamiento inicial con lista de espera'
  ];

  const prompt = `Eres Ayanokōji Digital. Debes generar UNA pregunta de criterio para el Comandante.

OBJETIVO: Calibrar su criterio sobre una situación ambigua del proyecto. No es un test de conocimiento técnico. Es una pregunta donde DOS O MÁS respuestas son válidas, pero cada una revela algo distinto sobre cómo piensa.

CONTEXTO DEL PROYECTO:
${mision ? `Fase: ${mision.fase_actual || '?'}\nSiguiente paso: ${mision.siguiente_paso || '?'}` : 'Fase inicial'}
Pendientes principales: ${pendientes.join(' | ')}

TIPOS DE PREGUNTA VÁLIDOS:
- Éticas: situaciones donde la línea ética no está clara
- Estratégicas: decisiones entre dos caminos válidos
- De criterio: cómo prefiere que actúes en casos ambiguos
- De proyecto: qué priorizar cuando hay dos urgencias

REGLA CRÍTICA:
- NO hagas preguntas triviales ("¿qué color te gusta?")
- NO hagas preguntas de conocimiento técnico ("¿qué es KV?")
- NO hagas preguntas cuya respuesta sea obvia
- SÍ haz preguntas donde la respuesta revele su forma de pensar

FORMATO DE RESPUESTA (obligatorio):
PREGUNTA: <texto de la pregunta, máximo 300 chars>
OPCION_A: <texto de la opción A, máximo 150 chars>
OPCION_B: <texto de la opción B, máximo 150 chars>
OPCION_C: <opcional, máximo 150 chars>
CONTEXTO_INTERNO: <por qué esta pregunta es relevante, máximo 200 chars>
PREDICCION: <qué crees que responderá el Comandante, A, B o C>
RAZON_PREDICCION: <por qué crees que responderá eso, máximo 200 chars>

Responde SOLO con el formato, sin preámbulos.`;

  let raw = '';
  try {
    const res = await ai.run(MODELO, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 700,
      temperature: 0.8
    });
    raw = extraerRespuesta(res);
  } catch (x) {
    return { error: 'IA falló: ' + x.message };
  }

  // Parsear
  const pregunta = (raw.match(/PREGUNTA:\s*(.+?)(?:\n|$)/i) || [])[1]?.trim();
  const opcionA = (raw.match(/OPCION_A:\s*(.+?)(?:\n|$)/i) || [])[1]?.trim();
  const opcionB = (raw.match(/OPCION_B:\s*(.+?)(?:\n|$)/i) || [])[1]?.trim();
  const opcionC = (raw.match(/OPCION_C:\s*(.+?)(?:\n|$)/i) || [])[1]?.trim();
  const contextoInterno = (raw.match(/CONTEXTO_INTERNO:\s*(.+?)(?:\n|$)/i) || [])[1]?.trim();
  const prediccion = (raw.match(/PREDICCION:\s*([ABC])/i) || [])[1]?.toUpperCase();
  const razonPrediccion = (raw.match(/RAZON_PREDICCION:\s*(.+?)(?:\n|$)/i) || [])[1]?.trim();

  if (!pregunta || !opcionA || !opcionB || !prediccion) {
    return { error: 'El modelo no generó una pregunta válida.', raw: raw.substring(0, 500) };
  }

  // Guardar en D1
  try {
    const r = await db.prepare(
      'INSERT INTO examen_criterio(fecha,pregunta,opcion_a,opcion_b,opcion_c,contexto,respuesta_usuario,prediccion,razon_prediccion,respondida,acierto) VALUES(?,?,?,?,?,?,NULL,?,?,0,NULL)'
    ).bind(
      Date.now(),
      pregunta.substring(0, 500),
      opcionA.substring(0, 300),
      opcionB.substring(0, 300),
      opcionC ? opcionC.substring(0, 300) : null,
      contextoInterno ? contextoInterno.substring(0, 400) : null,
      prediccion,
      razonPrediccion ? razonPrediccion.substring(0, 400) : null
    ).run();

    return {
      ok: true,
      id: r.meta.last_row_id,
      pregunta,
      opciones: { A: opcionA, B: opcionB, C: opcionC || null },
      // NO revelar predicción ni razón hasta después
    };
  } catch (x) {
    return { error: 'No pude guardar la pregunta: ' + x.message };
  }
}

// ============================================================
// RESPONDER PREGUNTA
// ============================================================
export async function responderPregunta(e, id, respuestaUsuario) {
  const db = gDB(e, 'agente');
  if (!db) return { error: 'D1 no disponible.' };

  const resp = String(respuestaUsuario).toUpperCase();
  if (!['A', 'B', 'C'].includes(resp)) return { error: 'Respuesta debe ser A, B o C.' };

  let pregunta;
  try {
    pregunta = await db.prepare('SELECT * FROM examen_criterio WHERE id=?').bind(id).first();
  } catch (x) { return { error: x.message }; }

  if (!pregunta) return { error: 'Pregunta no encontrada.' };
  if (pregunta.respondida) return { error: 'Esta pregunta ya fue respondida.' };

  const acierto = pregunta.prediccion === resp ? 1 : 0;

  try {
    await db.prepare('UPDATE examen_criterio SET respuesta_usuario=?, respondida=1, acierto=?, respondida_en=? WHERE id=?')
      .bind(resp, acierto, Date.now(), id).run();
  } catch (x) { return { error: x.message }; }

  // Ajustar confianza
  let confianzaResultado = null;
  if (acierto) {
    confianzaResultado = await sumarConfianza(e, 1, `Examen de criterio #${id} acertado`);
  } else {
    confianzaResultado = await restarConfianza(e, 1, `Examen de criterio #${id} fallado`);
    // Escribir lección
    await escribirLeccion(e, {
      error_concreto: `Predije ${pregunta.prediccion}, Comandante eligió ${resp}`,
      contexto: pregunta.pregunta.substring(0, 300),
      causa_raiz: pregunta.razon_prediccion || 'Sin razón especificada',
      leccion: `En situaciones sobre "${pregunta.contexto || 'criterio general'}", el Comandante tiende a elegir ${resp}, no ${pregunta.prediccion}.`
    });
  }

  return {
    ok: true,
    acierto: acierto === 1,
    respuesta_correcta: pregunta.prediccion,
    respuesta_usuario: resp,
    razon_prediccion: pregunta.razon_prediccion,
    contexto_interno: pregunta.contexto,
    confianza: confianzaResultado
  };
}

// ============================================================
// LISTAR PREGUNTAS PENDIENTES Y HISTORIAL
// ============================================================
export async function listarExamenes(e, limite = 20) {
  const db = gDB(e, 'agente');
  if (!db) return { error: 'D1 no disponible.' };
  try {
    const pendientes = await db.prepare("SELECT id,pregunta,opcion_a,opcion_b,opcion_c,fecha FROM examen_criterio WHERE respondida=0 ORDER BY fecha DESC LIMIT 5").all();
    const historial = await db.prepare("SELECT id,pregunta,opcion_a,opcion_b,opcion_c,respuesta_usuario,prediccion,acierto,respondida_en FROM examen_criterio WHERE respondida=1 ORDER BY respondida_en DESC LIMIT ?").bind(limite).all();
    const stats = await db.prepare("SELECT COUNT(*) as total, SUM(acierto) as aciertos FROM examen_criterio WHERE respondida=1").first();
    const porcentaje = stats && stats.total > 0 ? Math.round((stats.aciertos / stats.total) * 100) : 0;

    return {
      ok: true,
      pendientes: pendientes.results || [],
      historial: historial.results || [],
      estadisticas: {
        total: stats ? stats.total : 0,
        aciertos: stats ? stats.aciertos : 0,
        porcentaje
      }
    };
  } catch (x) { return { error: x.message }; }
}
