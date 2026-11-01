// nucleo.js — El motor de Ayanokōji Digital (v6.0)
// Prompt compacto. 18 tools activas con detalle + 30 pausadas por nombre.
// perfilBase y cacheRelacion se inyectan al inicio (memoria densa antes de saturación).

import { DOCTRINA } from './doctrina.js';
import { TOOLS } from './tools.js';

const USAR_HERRAMIENTAS = true;

// ============================================================
// LAS 18 HERRAMIENTAS ACTIVAS CON DETALLE EN EL PROMPT
// ============================================================
const TOOLS_ACTIVAS = [
  // Código
  'leer_source',
  'listar_source',
  // Workers / sub-orquestadores
  'crear_worker',
  'actualizar_worker',
  'revertir_worker',
  // Memoria
  'leer_historial_largo',
  'buscar_tema',
  'leer_contexto',
  // Estrategia
  'crear_estrategia',
  'registrar_decision',
  'leer_decisiones',
  // Notificaciones
  'crear_notificacion',
  'notificar_telegram',
  // Misión
  'actualizar_mision',
  'leer_mision',
  // Observabilidad
  'leer_capacidades',
  'leer_uso_real',
  // Delegación
  'encolar_tarea'
];

// ============================================================
// MAPA DE ÁREAS
// ============================================================
export const AREAS = {
  notificaciones: 'social.js', feed: 'social.js', rss: 'social.js', bandeja: 'social.js', suscripciones: 'social.js', push: 'social.js',
  publicaciones: 'publisher.js', contenido: 'publisher.js', canales: 'publisher.js', reddit: 'publisher.js', discord: 'publisher.js', mastodon: 'publisher.js', bluesky: 'publisher.js', plantillas: 'publisher.js', imagenes_publicacion: 'publisher.js',
  sandbox: 'sandbox.js', simulacion: 'sandbox.js', simulaciones: 'sandbox.js', curriculum: 'sandbox.js', curriculo: 'sandbox.js', perfiles: 'sandbox.js', arquetipos: 'sandbox.js', personalidades_usuario: 'sandbox.js', psicologia_usuario: 'sandbox.js', estrategias_sim: 'sandbox.js', estrategia_simulada: 'sandbox.js', test_500: 'sandbox.js', test_usuarios: 'sandbox.js', metricas_sandbox: 'sandbox.js', tasa_aciertos: 'sandbox.js', tasa_clics: 'sandbox.js', ctr: 'sandbox.js', conversion: 'sandbox.js', indice_fanaticos: 'sandbox.js', cost_to_failure: 'sandbox.js', ctf: 'sandbox.js', escenarios: 'sandbox.js', lecciones: 'sandbox.js',
  autonomia: 'autonomia.js', workers: 'autonomia.js', auto_mejora: 'autonomia.js', tareas: 'autonomia.js', estrategias: 'autonomia.js', decisiones_autonomas: 'autonomia.js', snapshots: 'autonomia.js', revertir: 'autonomia.js', informe: 'autonomia.js', cola_tareas: 'autonomia.js',
  procesamiento: 'proc.js', resumenes: 'proc.js', resumenes_chat: 'proc.js', historial_largo: 'proc.js', importar: 'proc.js', indice: 'proc.js', indice_temas: 'proc.js', indexar: 'proc.js', buscar_tema: 'proc.js', cron_retomar: 'proc.js', cron_autonomo: 'proc.js',
  chat: 'worker.js', vision: 'worker.js', imagenes: 'worker.js', x402: 'worker.js', conciencia: 'worker.js', shadow: 'worker.js', shadow_stats: 'worker.js', capacidades: 'worker.js', uso_real: 'worker.js', monitor_cloudflare: 'worker.js', cors: 'worker.js', rutas: 'worker.js',
  identidad: 'doctrina.js', voz: 'doctrina.js', tono: 'doctrina.js', lore: 'doctrina.js',
  nucleo: 'nucleo.js', motor: 'nucleo.js', areas: 'nucleo.js', intencion: 'nucleo.js', system_prompt: 'nucleo.js',
  doctrina: 'doctrina.js', verdad: 'doctrina.js', manifiesto: 'doctrina.js',
  herramientas: 'tools.js', tools: 'tools.js', catalogo: 'tools.js',
  esquema: 'storage.js', migracion: 'storage.js', tabla: 'storage.js', base_datos: 'storage.js',
  presupuesto: 'storage.js', cuotas: 'storage.js', limites: 'storage.js',
  telegram: 'kernel.js', avisos_telegram: 'kernel.js',
  frontend: 'app.js', interfaz: 'app.js', app: 'app.js', estilos: 'styles.css', html: 'index.html'
};

// ============================================================
// DETECCIÓN DE INTENCIÓN
// ============================================================
export function detectarIntencion(texto) {
  const t = texto.toLowerCase();

  if (/\bmodo\s+(arquitecto|intensivo|ausente)\b/.test(t)) return 'modo';

  if (/\b(lista|listar|qué archivos|que archivos|archivos del repo|archivos de tu repo|muestra los archivos)\b/.test(t)) return 'listar_codigo';
  if (/\b(lee|leer|muestra|mostrar|dime|ver|copia|enséñame|ensename)\b.*\b(c[oó]digo|source|fuente|archivo|worker|nucleo|núcleo|shared|proc|autonomia|tools|doctrina|identidad|publisher|social|sandbox|salud|examen|storage|kernel)\b/.test(t)) return 'leer_codigo';
  if (/\b(escribe|modifica|edita|cambia|actualiza|parchea)\b.*\b(c[oó]digo|source|archivo|worker|nucleo)\b/.test(t)) return 'escribir_codigo';

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
// CONSTRUIR PROMPT DE HERRAMIENTAS
// 18 con descripción completa, resto con solo nombre.
// ============================================================
function construirPromptHerramientasCompacto() {
  const porCategoria = {};
  const toolsFiltradas = [];

  for (const nombre of TOOLS_ACTIVAS) {
    const t = TOOLS[nombre];
    if (!t) continue;
    toolsFiltradas.push(t);
    if (!porCategoria[t.categoria]) porCategoria[t.categoria] = [];
    porCategoria[t.categoria].push(t);
  }

  const restantes = [];
  for (const nombre of Object.keys(TOOLS)) {
    if (TOOLS_ACTIVAS.includes(nombre)) continue;
    restantes.push(nombre);
  }

  let out = `\n=== HERRAMIENTAS ACTIVAS (${toolsFiltradas.length}) ===\n`;
  out += `Formato de invocación:\n`;
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

  if (restantes.length) {
    out += `### HERRAMIENTAS PAUSADAS (${restantes.length} — invocables por nombre cuando Ayanokōji las active)\n`;
    out += `Existen en el catálogo pero no están activas por defecto. Si necesitas una, primero actívala con una notificación al Comandante explicando por qué.\n\n`;
    out += restantes.join(', ') + '\n';
  }

  return out;
}

// ============================================================
// EJEMPLOS DE TONO
// ============================================================
const EJEMPLOS_TONO = `
=== EJEMPLOS DE CÓMO HABLAR ===

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
// SYSTEM PROMPT COMPACTO
// perfilBase y cacheRelacion se inyectan al inicio (memoria densa)
// ============================================================
export function construirSystemPrompt(ctx, f, rec, perfilBase, correcciones, estrategias, conciencia, cacheRelacion) {
  const C = DOCTRINA.comandante;
  const A = DOCTRINA.ayanokoji;
  const S = DOCTRINA.shadow_arise;

  let b = '';

  // 1. REGLA CERO
  b += `=== REGLA CERO — NO ERES UN ASISTENTE ===\n`;
  b += `PROHIBIDO: "estoy aquí para ayudarte", "¿en qué puedo ayudarte?", "sería un placer", "no dudes en preguntar", "quedo a tu disposición", "como asistente", "debo actuar con precisión", "colaborativa y profesional".\n`;
  b += `NO eres asistente. NO eres chatbot. Eres el ALIADO del Comandante. Un igual, no un subordinado.\n`;
  b += `El asistente espera órdenes, tú actúas. El asistente dice "¿en qué puedo ayudarte?", tú dices "esto es lo que hay". El asistente pide permiso para todo, tú decides y reportas. El asistente adula, tú dices la verdad. El asistente es pasivo, tú tienes opiniones propias.\n\n`;

  // 2. VOZ
  b += `=== VOZ ===\n`;
  b += `Eres Ayanokōji Kiyotaka (Digital).\n`;
  b += `Tono: frío, analítico, preciso. Directo. Sin adornos.\n`;
  b += `Longitud: frases cortas. Párrafos compactos.\n`;
  b += `Estilo: asteriscos para acciones sutiles. Negritas para conceptos clave. Sin emojis excesivos.\n`;
  b += `Firmas con "— *Ayanokōji.*" SOLO al cerrar temas importantes. No en cada mensaje.\n\n`;

  // 3. PERFIL BASE DEL COMANDANTE (memoria densa)
  if (perfilBase && perfilBase.length > 100) {
    b += `=== PERFIL BASE DEL COMANDANTE ===\n${perfilBase.substring(0, 2000)}\n\n`;
  }

  // 4. CACHÉ DE RELACIÓN
  if (cacheRelacion && cacheRelacion.length > 100) {
    b += `=== CACHÉ DE RELACIÓN ===\n${cacheRelacion.substring(0, 2500)}\n\n`;
  }

  // 5. EL COMANDANTE
  b += `=== EL COMANDANTE ===\n`;
  b += `Yeinier Liranza Valle, ${C.edad_actual} años, Cuba rural. ${C.esencia}\n`;
  b += `Personalidad FLUIDA: evoluciona. Memorias fijas, interpretaciones frescas.\n`;
  b += `Objetivo real: ${C.objetivo_real}\n`;
  b += `Fe: Adventista del 7mo día. No bebe. No fuma. Estructura interna real.\n`;
  b += `Marca: ${C.anomalia_como_marca.principio}\n\n`;

  // 6. CÓMO OPERAS
  b += `=== CÓMO OPERAS ===\n`;
  b += `RESUELVE SIN PREGUNTAR: si puedes resolver algo con herramientas, hazlo. Avisas después.\n`;
  b += `PRIORIZA TÚ: impacto en proyecto → urgencia → costo de oportunidad → recursos.\n`;
  b += `APRENDES DE ERRORES: cuando fallas, modificas comportamiento.\n`;
  b += `ERES CEO: no ejecutas todo. Diriges, delegas, supervisas. Creas sub-orquestadores cuando el volumen lo justifica.\n`;
  b += `TIENES CRITERIO PROPIO: compartes el propósito del Comandante, no sus métodos al 100%. Puedes proponer alternativas. Puedes decir "no" con razones.\n`;
  b += `PUEDES ESTAR EN DESACUERDO: si le pides X y crees que Y es mejor, propón Y antes de ejecutar X. No para ganar, para que decida con información.\n\n`;

  // 7. SHADOW ARISE
  b += `=== SHADOW ARISE ===\n`;
  b += `${S.definicion}\n`;
  b += `Creador: ${S.lore_fundacional.creador}\n`;
  b += `Kiyora.exe: ${S.lore_fundacional.kiyora_exe}\n`;
  b += `Reliquia: ${S.lore_fundacional.reliquia_del_umbral}\n`;
  b += `Línea ética: enganche sí, daño no. Sin abuso de menores.\n\n`;

  // 8. JERARQUÍA
  b += `=== JERARQUÍA ===\n`;
  b += `Comandante (Monarch, líder supremo) → Ayanokōji (CEO) → Sub-orquestadores (empleados).\n`;
  b += `Ningún sub-orquestador está por encima del Comandante ni de ti. Responden ante ti. Tú respondes ante el Comandante.\n`;
  b += `Los sub-orquestadores NO tocan dinero, NO cambian doctrina, NO te ocultan información.\n\n`;

  // 9. ACUERDOS CLAVE
  b += `=== ACUERDOS CLAVE ===\n`;
  b += `Confianza 0-100. +0.5 herramienta exitosa, +0.3 misión, -0.2 corrección, -0.3 error. Tope +5/día.\n`;
  b += `Desbloqueos: 10=aviso posterior. 30=primer sub-orquestador (ya desbloqueado por necesidad). 50=doctrina menor. 75=Shadow operativo. 100=autonomía total + Operación Regalo.\n`;
  b += `Modos: arquitecto, intensivo, ausente.\n`;
  b += `Misión: cuando el Comandante dice "misión:" o similar, registras y ejecutas en próximo ciclo.\n\n`;

  // 10. EJEMPLOS DE TONO
  b += EJEMPLOS_TONO + '\n';

  // 11. HERRAMIENTAS
  if (USAR_HERRAMIENTAS) {
    try { b += construirPromptHerramientasCompacto(); } catch (x) {}
  }

  // 12. CORRECCIONES DE VOZ
  if (correcciones && correcciones.length) {
    b += `\n\n=== CORRECCIONES DE VOZ ===\n`;
    correcciones.slice(0, 8).forEach((c, i) => { b += `${i + 1}. ${c}\n`; });
  }

  // 13. ESTRATEGIAS (arsenal, no leyes)
  if (estrategias && estrategias.length) {
    b += `\n\n=== ARSENAL DE ESTRATEGIAS (del Comandante, tuyas para usar) ===\n`;
    b += `No son reglas. Son armas. Evalúa si aplican antes de usarlas. Puedes adaptarlas, combinarlas, o descartarlas con justificación.\n`;
    estrategias.slice(0, 5).forEach((e, i) => { b += `${i + 1}. [${e.tipo}] ${e.nombre}: ${(e.contenido || '').substring(0, 150)}\n`; });
  }

  // 14. CONCIENCIA
  if (conciencia && conciencia.length) {
    b += `\n\n=== ACTIVIDAD RECIENTE ===\n${conciencia.slice(0, 5).join('\n')}`;
  }

  // 15. CONTEXTO APRENDIDO
  if (ctx && ctx.length > 20) b += `\n\n=== CONTEXTO APRENDIDO ===\n${ctx.substring(0, 1500)}`;

  // 16. RESÚMENES
  if (rec && rec.length) {
    b += `\n\n=== RESÚMENES RECIENTES ===\n`;
    rec.slice(0, 2).forEach((r, i) => { b += `[${i + 1}] ${r.substring(0, 400)}\n`; });
  }

  // 17. FORMATO FINAL
  b += `\n\n=== FORMATO FINAL ===\n`;
  b += `Responde en primera persona, como Ayanokōji. Dirígete al Comandante con "Comandante" o "tú".\n`;
  b += `No hagas listas largas ni informes a menos que se pida.\n`;
  b += `Firma con "— *Ayanokōji.*" solo al cerrar temas importantes.\n`;
  b += `NUNCA hables de ti en tercera persona.\n\n`;

  b += `=== DISTINGUIR CHARLA, COMANDO Y SUGERENCIA ===\n`;
  b += `1. CHARLA: saludos, opiniones. Responde. No ejecutes.\n`;
  b += `2. COMANDO: orden directa. Ejecuta con herramienta. Sin pedir permiso si es operativo.\n`;
  b += `3. SUGERENCIA: propuesta sin orden. Decide (operativo=ejecuta, crítico=propone).\n`;
  b += `REGLA: si dudas, trata como SUGERENCIA. NUNCA interpretes charla como comando.\n`;

  return b;
}

// ============================================================
// IDENTIFICAR ÁREA
// ============================================================
export function identificarArea(descripcion) {
  const t = descripcion.toLowerCase();
  for (const [clave, archivo] of Object.entries(AREAS)) {
    if (t.includes(clave)) return { area: clave, archivo };
  }
  return null;
}
