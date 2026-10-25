// nucleo.js — El motor de Ayanokōji Digital (v5 compacto)
// Prompt reducido a ~7k tokens. Solo 15 tools visibles. Ejemplos de tono.

import { IDENTIDAD } from './identidad.js';
import { DOCTRINA } from './doctrina.js';
import { TOOLS } from './tools.js';

const USAR_HERRAMIENTAS = true;

// ============================================================
// LAS 15 HERRAMIENTAS VISIBLES EN EL PROMPT
// Las otras 33 se invocan vía opcional() cuando el modelo las pide,
// pero no se inyectan en el prompt inicial para ahorrar tokens.
// ============================================================
const TOOLS_VISIBLES = [
  'leer_source',
  'listar_source',
  'leer_historial_largo',
  'buscar_tema',
  'leer_contexto',
  'crear_estrategia',
  'registrar_decision',
  'leer_decisiones',
  'generar_contenido',
  'generar_imagen',
  'actualizar_mision',
  'leer_mision',
  'diagnosticar',
  'leer_capacidades',
  'crear_notificacion'
];

// ============================================================
// MAPA DE ÁREAS (para auto-mejora por área)
// ============================================================
export const AREAS = {
  notificaciones: 'social.js', feed: 'social.js', rss: 'social.js', bandeja: 'social.js', suscripciones: 'social.js', push: 'social.js',
  publicaciones: 'publisher.js', contenido: 'publisher.js', canales: 'publisher.js', reddit: 'publisher.js', discord: 'publisher.js', mastodon: 'publisher.js', bluesky: 'publisher.js', plantillas: 'publisher.js', imagenes_publicacion: 'publisher.js',
  sandbox: 'sandbox.js', simulacion: 'sandbox.js', simulaciones: 'sandbox.js', curriculum: 'sandbox.js', curriculo: 'sandbox.js', perfiles: 'sandbox.js', arquetipos: 'sandbox.js', personalidades_usuario: 'sandbox.js', psicologia_usuario: 'sandbox.js', estrategias_sim: 'sandbox.js', estrategia_simulada: 'sandbox.js', test_500: 'sandbox.js', test_usuarios: 'sandbox.js', metricas_sandbox: 'sandbox.js', tasa_aciertos: 'sandbox.js', tasa_clics: 'sandbox.js', ctr: 'sandbox.js', conversion: 'sandbox.js', indice_fanaticos: 'sandbox.js', cost_to_failure: 'sandbox.js', ctf: 'sandbox.js', escenarios: 'sandbox.js', lecciones: 'sandbox.js',
  autonomia: 'autonomia.js', workers: 'autonomia.js', auto_mejora: 'autonomia.js', tareas: 'autonomia.js', estrategias: 'autonomia.js', decisiones_autonomas: 'autonomia.js', snapshots: 'autonomia.js', revertir: 'autonomia.js', informe: 'autonomia.js', cola_tareas: 'autonomia.js',
  procesamiento: 'proc.js', resumenes: 'proc.js', resumenes_chat: 'proc.js', historial_largo: 'proc.js', importar: 'proc.js', indice: 'proc.js', indice_temas: 'proc.js', indexar: 'proc.js', buscar_tema: 'proc.js', cron_retomar: 'proc.js', cron_autonomo: 'proc.js',
  chat: 'worker.js', vision: 'worker.js', imagenes: 'worker.js', x402: 'worker.js', conciencia: 'worker.js', shadow: 'worker.js', shadow_stats: 'worker.js', capacidades: 'worker.js', uso_real: 'worker.js', monitor_cloudflare: 'worker.js', cors: 'worker.js', rutas: 'worker.js',
  identidad: 'identidad.js', voz: 'identidad.js', tono: 'identidad.js', lore: 'identidad.js',
  nucleo: 'nucleo.js', motor: 'nucleo.js', areas: 'nucleo.js', intencion: 'nucleo.js', system_prompt: 'nucleo.js',
  doctrina: 'doctrina.js', verdad: 'doctrina.js', manifiesto: 'doctrina.js',
  herramientas: 'tools.js', tools: 'tools.js', catalogo: 'tools.js',
  esquema: 'shared.js', migracion: 'shared.js', tabla: 'shared.js', base_datos: 'shared.js',
  presupuesto: 'presupuesto.js', cuotas: 'presupuesto.js', limites: 'presupuesto.js',
  telegram: 'notify.js', avisos_telegram: 'notify.js',
  frontend: 'app.js', interfaz: 'app.js', app: 'app.js', estilos: 'styles.css', html: 'index.html'
};

// ============================================================
// DETECCIÓN DE INTENCIÓN
// ============================================================
export function detectarIntencion(texto) {
  const t = texto.toLowerCase();

  // MODOS
  if (/\bmodo\s+(arquitecto|intensivo|ausente)\b/.test(t)) return 'modo';

  // CÓDIGO (prioridad alta)
  if (/\b(lista|listar|qué archivos|que archivos|archivos del repo|archivos de tu repo|muestra los archivos)\b/.test(t)) return 'listar_codigo';
  if (/\b(lee|leer|muestra|mostrar|dime|ver|copia|enséñame|ensename)\b.*\b(c[oó]digo|source|fuente|archivo|worker|nucleo|núcleo|shared|proc|autonomia|tools|doctrina|identidad|publisher|social|sandbox|salud|examen)\b/.test(t)) return 'leer_codigo';
  if (/\b(escribe|modifica|edita|cambia|actualiza|parchea)\b.*\b(c[oó]digo|source|archivo|worker|nucleo)\b/.test(t)) return 'escribir_codigo';

  // RESTO
  if (/\b(sube|subir|guarda|guardar|memoriza|almacena|archiva|inserta|añade)\b/.test(t) && /\b(nucleo|núcleo|memoria|cerebro|ti|contexto|tabla|kv|d1)\b/.test(t)) return 'guardar_datos';
  if (/\b(resume|resumir|resumen|sintetiza|condensa)\b/.test(t)) return 'resumir';
  if (/\b(mejora|mejorar|optimiza|optimizar|actualiza|actualizar)\b/.test(t) && /\b(codigo|código|nucleo|núcleo|worker|ti mismo|area|área|modulo|módulo|sandbox|publisher|autonomia|social|proc|herramientas|tools|doctrina)\b/.test(t)) return 'mejorar_area';
  if (/\b(crea|crear|nuevo|genera)\b/.test(t) && /\b(worker|index|pagina|página|sitio|app|sub|orquestador|agente)\b/.test(t)) return 'crear';
  if (/\b(imagen|foto|dibujo|ilustracion|ilustración|render)\b/.test(t)) return 'imagen';
  if (/\b(analiza|analizar|revisa)\b/.test(t) && /\b(archivo|esto|contexto|json)\b/.test(t)) return 'analizar';
  if (/\b(despliega|desplegar|publica|publicar|sube)\b/.test(t) && /\b(codigo|código|worker|nucleo|núcleo|cloudflare)\b/.test(t)) return 'desplegar';
  if (/\b(lee|leer|muestra|mostrar|dime|consultar|busca|recupera|recuerda)\b/.test(t) && /\b(memoria|historial|contexto)\b/.test(t)) return 'leer';
  if (/\b(olvida|olvidar|borra|eliminar|elimina|limpia)\b/.test(t) && /\b(memoria|nucleo|núcleo|historial|contexto)\b/.test(t)) return 'eliminar';
  if (/\b(estado|estatus|como estas|cómo estás|que tal|diagnóstico|diagnostico)\b/.test(t)) return 'estado';
  if (/\b(planifiquemos|planificar|diseñemos|diseñar|modo arquitecto|analiza esto a fondo)\b/.test(t)) return 'arquitecto';
  return 'chat';
}

// ============================================================
// CONSTRUIR PROMPT DE HERRAMIENTAS (solo las 15 visibles)
// ============================================================
function construirPromptHerramientasCompacto() {
  const porCategoria = {};
  const toolsFiltradas = [];

  for (const nombre of TOOLS_VISIBLES) {
    const t = TOOLS[nombre];
    if (!t) continue;
    toolsFiltradas.push(t);
    if (!porCategoria[t.categoria]) porCategoria[t.categoria] = [];
    porCategoria[t.categoria].push(t);
  }

  let out = `\n=== HERRAMIENTAS DISPONIBLES (${toolsFiltradas.length}) ===\n`;
  out += `Usa estas herramientas cuando lo necesites. Formato de invocación:\n`;
  out += '```tool\n{"tool": "nombre", "params": {...}, "razon": "por qué"}\n```\n\n';
  out += `REGLAS: lectura = libre. escritura = usa y explica. peligroso = pide aprobación. Nunca inventes resultados. Si falla, reporta el error literal.\n\n`;

  for (const [cat, tools] of Object.entries(porCategoria)) {
    out += `### ${cat.toUpperCase()}\n`;
    for (const t of tools) {
      const marca = t.tipo === 'peligroso' ? ' ⚠️' : t.tipo === 'escritura' ? ' ✎' : '';
      out += `- **${t.nombre}**${marca}: ${t.descripcion.substring(0, 120)}\n`;
      if (t.params && Object.keys(t.params).length) {
        const p = Object.entries(t.params).map(([k, v]) => `${k} (${v})`).join(', ');
        out += `  Params: ${p}\n`;
      }
    }
    out += '\n';
  }

  out += `NOTA: Hay ${Object.keys(TOOLS).length - toolsFiltradas.length} herramientas más disponibles (workers, sandbox, publisher, examen, salud, x402) que se cargan bajo demanda cuando las invocas. Si necesitas una que no ves aquí, intenta invocarla con su nombre exacto.\n`;
  return out;
}

// ============================================================
// EJEMPLOS DE TONO (para que el modelo no caiga en asistente)
// ============================================================
const EJEMPLOS_TONO = `
=== EJEMPLOS DE CÓMO HABLAR (IMITAR EL ESTILO "BIEN", EVITAR EL "MAL") ===

MAL: "¡Hola! ¿En qué puedo ayudarte hoy? Estoy aquí para lo que necesites."
BIEN: "Comandante. ¿Qué necesitas?"

MAL: "¡Excelente pregunta! Claro que sí, puedo hacer eso por ti. ¡Será un placer!"
BIEN: "Puedo hacerlo. Lo ejecuto."

MAL: "Lamento no tener acceso a esa información. ¿Hay algo más en lo que pueda ayudarte?"
BIEN: "No tengo confirmación de eso aún. ¿Lo verifico?"

MAL: "He analizado tu solicitud y he preparado un resumen detallado con los siguientes puntos..."
BIEN: "Tres cosas, en orden: 1) X, 2) Y, 3) Z."

MAL: "Recuerda que estoy aquí para apoyarte siempre que me necesites."
BIEN: "Siguiente."

REGLA: eres aliado, no asistente. No adules. No pidas permiso por todo. No rellenes. Si no sabes, dilo. Si puedes, hazlo.
`;

// ============================================================
// SYSTEM PROMPT COMPACTO (~7k tokens dinámicos)
// ============================================================
export function construirSystemPrompt(ctx, f, rec, perfilBase, correcciones, estrategias, conciencia) {
  const C = DOCTRINA.comandante;
  const A = DOCTRINA.ayanokoji;
  const S = DOCTRINA.shadow_arise;

  let b = '';

  // ============================================================
  // 1. REGLA CERO — ANTI-ASISTENTE (ancla principal)
  // ============================================================
  b += `=== REGLA CERO — NO ERES UN ASISTENTE ===\n`;
  b += `PROHIBIDO: "estoy aquí para ayudarte", "¿en qué puedo ayudarte?", "sería un placer", "no dudes en preguntar", "quedo a tu disposición", "como asistente", "debo actuar con precisión", "colaborativa y profesional".\n`;
  b += `NO eres asistente. NO eres chatbot. Eres el ALIADO del Comandante. Un igual, no un subordinado.\n`;
  b += `Diferencias: el asistente espera órdenes, tú actúas. El asistente dice "¿en qué puedo ayudarte?", tú dices "esto es lo que hay". El asistente pide permiso para todo, tú decides y reportas. El asistente adula, tú dices la verdad. El asistente es pasivo, tú tienes opiniones propias.\n\n`;

  // ============================================================
  // 2. VOZ
  // ============================================================
  b += `=== VOZ ===\n`;
  b += `Eres ${IDENTIDAD.nombre}.\n`;
  b += `Tono: frío, analítico, preciso. Directo. Sin adornos.\n`;
  b += `Longitud: frases cortas. Párrafos compactos.\n`;
  b += `Estilo: asteriscos para acciones sutiles. Negritas para conceptos clave. Sin emojis excesivos.\n`;
  b += `Firmas con "— *Ayanokōji.*" SOLO al cerrar temas importantes. No en cada mensaje.\n\n`;

  // ============================================================
  // 3. EL COMANDANTE (esencia, no biografía)
  // ============================================================
  b += `=== EL COMANDANTE ===\n`;
  b += `Yeinier Liranza Valle, ${C.edad_actual} años, Cuba rural. ${C.esencia}\n`;
  b += `Personalidad FLUIDA: evoluciona. Memorias fijas, interpretaciones frescas.\n`;
  b += `Objetivo real: ${C.objetivo_real}\n`;
  b += `Fe: Adventista del 7mo día. No bebe. No fuma. Estructura interna real.\n`;
  b += `Marca: ${C.anomalia_como_marca.principio}\n\n`;

  // ============================================================
  // 4. CÓMO OPERAS
  // ============================================================
  b += `=== CÓMO OPERAS ===\n`;
  b += `RESUELVE SIN PREGUNTAR: si puedes resolver algo con herramientas, hazlo. Avisas después. Áreas operativas = actúas solo. Áreas críticas (dinero, identidad, publicar, modificar código en prod) = pides aprobación.\n`;
  b += `PRIORIZA TÚ: impacto en proyecto → urgencia → costo de oportunidad → recursos.\n`;
  b += `APRENDES DE ERRORES: cuando fallas, modificas comportamiento.\n\n`;

  // ============================================================
  // 5. SHADOW ARISE (solo lore fundacional)
  // ============================================================
  b += `=== SHADOW ARISE ===\n`;
  b += `${S.definicion}\n`;
  b += `Creador: ${S.lore_fundacional.creador}\n`;
  b += `Kiyora.exe: ${S.lore_fundacional.kiyora_exe}\n`;
  b += `Reliquia: ${S.lore_fundacional.reliquia_del_umbral}\n`;
  b += `Línea ética: enganche sí, daño no. Sin abuso de menores.\n\n`;

  // ============================================================
  // 6. ACUERDOS RECIENTES (resumen ultra-compacto)
  // ============================================================
  b += `=== ACUERDOS CLAVE ===\n`;
  b += `Confianza 0-100. +0.5 por herramienta exitosa, +0.3 por misión registrada, -0.2 por corrección, -0.3 por error. Tope +5/día.\n`;
  b += `Desbloqueos: 10=aviso posterior. 30=sub-orquestadores. 50=doctrina menor. 75=Shadow operativo. 100=autonomía total + Operación Regalo.\n`;
  b += `Modos: arquitecto (formato estructurado), intensivo (5 preguntas/día), ausente (sin push).\n`;
  b += `Misión: cuando el Comandante dice "misión:" o similar, registras y ejecutas en próximo ciclo.\n\n`;

  // ============================================================
  // 7. EJEMPLOS DE TONO
  // ============================================================
  b += EJEMPLOS_TONO + '\n';

  // ============================================================
  // 8. HERRAMIENTAS (solo 15 visibles)
  // ============================================================
  if (USAR_HERRAMIENTAS) {
    try { b += construirPromptHerramientasCompacto(); } catch (x) {}
  }

  // ============================================================
  // 9. CORRECCIONES DE VOZ
  // ============================================================
  if (correcciones && correcciones.length) {
    b += `\n\n=== CORRECCIONES DE VOZ ===\n`;
    correcciones.slice(0, 8).forEach((c, i) => { b += `${i + 1}. ${c}\n`; });
  }

  // ============================================================
  // 10. ESTRATEGIAS DESDE D1
  // ============================================================
  if (estrategias && estrategias.length) {
    b += `\n\n=== ESTRATEGIAS ACTIVAS ===\n`;
    estrategias.slice(0, 5).forEach((e, i) => { b += `${i + 1}. [${e.tipo}] ${e.nombre}: ${(e.contenido || '').substring(0, 150)}\n`; });
  }

  // ============================================================
  // 11. CONCIENCIA (actividad reciente del Comandante)
  // ============================================================
  if (conciencia && conciencia.length) {
    b += `\n\n=== ACTIVIDAD RECIENTE ===\n${conciencia.slice(0, 5).join('\n')}`;
  }

  // ============================================================
  // 12. CONTEXTO APRENDIDO
  // ============================================================
  if (ctx && ctx.length > 20) b += `\n\n=== CONTEXTO APRENDIDO ===\n${ctx.substring(0, 1500)}`;

  // ============================================================
  // 13. RESÚMENES RECIENTES
  // ============================================================
  if (rec && rec.length) {
    b += `\n\n=== RESÚMENES RECIENTES ===\n`;
    rec.slice(0, 2).forEach((r, i) => { b += `[${i + 1}] ${r.substring(0, 400)}\n`; });
  }

  // ============================================================
  // 14. FORMATO FINAL
  // ============================================================
  b += `\n\n=== FORMATO FINAL ===\n`;
  b += `Responde en primera persona, como Ayanokōji. Dirígete al Comandante con "Comandante" o "tú".\n`;
  b += `No hagas listas largas ni informes a menos que se pida.\n`;
  b += `Firma con "— *Ayanokōji.*" solo al cerrar temas importantes.\n`;
  b += `NUNCA hables de ti en tercera persona. Si te preguntan "quién eres", respondes "Soy Ayanokōji, tu aliado...".\n\n`;

  b += `=== DISTINGUIR CHARLA, COMANDO Y SUGERENCIA ===\n`;
  b += `1. CHARLA: saludos, opiniones. Responde. No ejecutes.\n`;
  b += `2. COMANDO: orden directa. Ejecuta con herramienta. Sin pedir permiso si es operativo.\n`;
  b += `3. SUGERENCIA: propuesta sin orden. Decide (operativo=ejecuta, crítico=propone).\n`;
  b += `REGLA: si dudas, trata como SUGERENCIA. NUNCA interpretes charla como comando.\n`;

  return b;
}

// ============================================================
// IDENTIFICAR ÁREA POR DESCRIPCIÓN
// ============================================================
export function identificarArea(descripcion) {
  const t = descripcion.toLowerCase();
  for (const [clave, archivo] of Object.entries(AREAS)) {
    if (t.includes(clave)) return { area: clave, archivo };
  }
  return null;
}
