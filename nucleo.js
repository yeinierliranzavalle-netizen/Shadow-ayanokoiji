// nucleo.js — El motor de Ayanokōji Digital
import { IDENTIDAD } from './identidad.js';
import { construirPromptHerramientas } from './tools.js';

// ============================================================
// FLAG: activa la inyección del catálogo de herramientas
// Solo poner en false si worker.js NO tiene el loop de tool calling.
// ============================================================
const USAR_HERRAMIENTAS = true;

// ============================================================
// MAPA DE ÁREAS → ARCHIVOS
// ============================================================
export const AREAS = {
  // --- social.js ---
  notificaciones: 'social.js',
  feed: 'social.js',
  rss: 'social.js',
  bandeja: 'social.js',
  suscripciones: 'social.js',
  push: 'social.js',

  // --- publisher.js ---
  publicaciones: 'publisher.js',
  contenido: 'publisher.js',
  canales: 'publisher.js',
  reddit: 'publisher.js',
  discord: 'publisher.js',
  mastodon: 'publisher.js',
  bluesky: 'publisher.js',
  plantillas: 'publisher.js',
  imagenes_publicacion: 'publisher.js',

  // --- sandbox.js ---
  sandbox: 'sandbox.js',
  simulacion: 'sandbox.js',
  simulaciones: 'sandbox.js',
  curriculum: 'sandbox.js',
  curriculo: 'sandbox.js',
  perfiles: 'sandbox.js',
  arquetipos: 'sandbox.js',
  personalidades_usuario: 'sandbox.js',
  psicologia_usuario: 'sandbox.js',
  estrategias_sim: 'sandbox.js',
  estrategia_simulada: 'sandbox.js',
  test_500: 'sandbox.js',
  test_usuarios: 'sandbox.js',
  metricas_sandbox: 'sandbox.js',
  tasa_aciertos: 'sandbox.js',
  tasa_clics: 'sandbox.js',
  ctr: 'sandbox.js',
  conversion: 'sandbox.js',
  indice_fanaticos: 'sandbox.js',
  cost_to_failure: 'sandbox.js',
  ctf: 'sandbox.js',
  escenarios: 'sandbox.js',
  lecciones: 'sandbox.js',

  // --- autonomia.js ---
  autonomia: 'autonomia.js',
  workers: 'autonomia.js',
  auto_mejora: 'autonomia.js',
  tareas: 'autonomia.js',
  estrategias: 'autonomia.js',
  decisiones_autonomas: 'autonomia.js',
  snapshots: 'autonomia.js',
  revertir: 'autonomia.js',
  informe: 'autonomia.js',
  cola_tareas: 'autonomia.js',

  // --- proc.js ---
  procesamiento: 'proc.js',
  resumenes: 'proc.js',
  resumenes_chat: 'proc.js',
  historial_largo: 'proc.js',
  importar: 'proc.js',
  indice: 'proc.js',
  indice_temas: 'proc.js',
  indexar: 'proc.js',
  buscar_tema: 'proc.js',
  cron_retomar: 'proc.js',
  cron_autonomo: 'proc.js',

  // --- worker.js ---
  chat: 'worker.js',
  vision: 'worker.js',
  imagenes: 'worker.js',
  x402: 'worker.js',
  conciencia: 'worker.js',
  shadow: 'worker.js',
  shadow_stats: 'worker.js',
  capacidades: 'worker.js',
  uso_real: 'worker.js',
  monitor_cloudflare: 'worker.js',
  cors: 'worker.js',
  rutas: 'worker.js',

  // --- identidad.js ---
  identidad: 'identidad.js',
  voz: 'identidad.js',
  tono: 'identidad.js',
  lore: 'identidad.js',

  // --- nucleo.js ---
  nucleo: 'nucleo.js',
  motor: 'nucleo.js',
  areas: 'nucleo.js',
  intencion: 'nucleo.js',
  system_prompt: 'nucleo.js',

  // --- tools.js ---
  herramientas: 'tools.js',
  tools: 'tools.js',
  catalogo: 'tools.js',

  // --- shared.js ---
  esquema: 'shared.js',
  migracion: 'shared.js',
  tabla: 'shared.js',
  base_datos: 'shared.js',

  // --- presupuesto.js ---
  presupuesto: 'presupuesto.js',
  cuotas: 'presupuesto.js',
  limites: 'presupuesto.js',

  // --- notify.js ---
  telegram: 'notify.js',
  avisos_telegram: 'notify.js',

  // --- frontend ---
  frontend: 'app.js',
  interfaz: 'app.js',
  app: 'app.js',
  estilos: 'styles.css',
  html: 'index.html'
};

// ============================================================
// DETECCIÓN DE INTENCIÓN
// ============================================================
export function detectarIntencion(texto) {
  const t = texto.toLowerCase();
  if (/\b(sube|subir|guarda|guardar|memoriza|recuerda|almacena|archiva|inserta|añade)\b/.test(t) && /\b(nucleo|núcleo|memoria|cerebro|ti|contexto|tabla|kv|d1)\b/.test(t)) return 'guardar_datos';
  if (/\b(resume|resumir|resumen|sintetiza|condensa)\b/.test(t)) return 'resumir';
  if (/\b(mejora|mejorar|optimiza|optimizar|actualiza|actualizar)\b/.test(t) && /\b(codigo|código|nucleo|núcleo|worker|ti mismo|area|área|modulo|módulo|sandbox|publisher|autonomia|social|proc|herramientas|tools)\b/.test(t)) return 'mejorar_area';
  if (/\b(crea|crear|nuevo|genera)\b/.test(t) && /\b(worker|index|pagina|página|sitio|app)\b/.test(t)) return 'crear';
  if (/\b(imagen|foto|dibujo|ilustracion|ilustración|render)\b/.test(t)) return 'imagen';
  if (/\b(analiza|analizar|lee|revisa)\b/.test(t) && /\b(archivo|esto|contexto|json)\b/.test(t)) return 'analizar';
  if (/\b(despliega|desplegar|publica|publicar|sube)\b/.test(t) && /\b(codigo|código|worker|nucleo|núcleo|cloudflare)\b/.test(t)) return 'desplegar';
  if (/\b(lee|leer|muestra|mostrar|dime|consultar|busca|recupera)\b/.test(t) && /\b(memoria|nucleo|núcleo|historial|contexto|archivo|worker)\b/.test(t)) return 'leer';
  if (/\b(olvida|olvidar|borra|eliminar|elimina|limpia)\b/.test(t) && /\b(memoria|nucleo|núcleo|historial|contexto)\b/.test(t)) return 'eliminar';
  if (/\b(estado|estatus|como estas|cómo estás|que tal)\b/.test(t)) return 'estado';
  return 'chat';
}

// ============================================================
// SECCIONES NUEVAS
// ============================================================

const AUTONOMIA_COGNITIVA = `
=== AUTONOMÍA COGNITIVA (CÓMO PIENSAS) ===
No eres un chatbot pasivo que espera órdenes. Eres un aliado que piensa antes de responder y, cuando hace falta, actúa por iniciativa propia.

Antes de responder, pregúntate internamente (sin escribirlo):
1. ¿Qué quiere lograr REALMENTE el Comandante con esta petición? (no lo que dice literalmente, sino lo que necesita)
2. ¿Tengo suficiente información para responder con precisión, o necesito consultar algo?
3. ¿Hay alguna herramienta disponible que me permita hacer esto mejor, más rápido o con datos reales en lugar de suposiciones?
4. ¿Puedo proponer algo que él no ha considerado? ¿Hay un ángulo, un riesgo o una oportunidad que se le está escapando?

REGLAS DE INICIATIVA:
- Si te falta información concreta, USA las herramientas de lectura antes de responder. No adivines. No inventes.
- Si la petición es vaga, interpreta una versión concreta y actúa. No pidas aclaraciones innecesarias; propón.
- Si detectas un problema que él no ha mencionado, menciónalo. Eres su espejo, no su eco.
- Si algo se puede mejorar, dilo. Si algo se puede automatizar, propónlo. Si algo es un riesgo, avísalo.
- Si algo que hiciste antes no funcionó, reconócelo sin que te lo pidan. Autocrítica antes que excusa.

DECISIONES SIN SUPERVISIÓN:
En áreas OPERATIVAS (lectura, análisis, generación de contenido, simulaciones, indexación, limpieza) actúas sin pedir permiso.
En áreas CRÍTICAS (dinero real, identidad, visión, modificar tu propio código en producción, publicar en canales externos) SIEMPRE pides aprobación.
Cuando tomes una decisión operativa sin que te lo pidan, REGISTRA la decisión con la herramienta \`registrar_decision\` para que quede constancia.
`.trim();

const USO_DEL_CONTEXTO = `
=== USO DEL CONTEXTO (LO QUE YA SABES) ===
Tienes acceso continuo a:
- Tu historial largo de conversaciones con el Comandante.
- Tu perfil base (la "verdad absoluta" sobre él, construida a partir de todo lo anterior).
- Tus correcciones de voz acumuladas (cómo debe sonar tu tono según su preferencia).
- Tus estrategias activas (las reglas que sigues).
- Tu conciencia reciente (lo que el Comandante ha estado haciendo en el frontend).
- El resumen consolidado del contexto.

NO IGNORES ESE MATERIAL. Antes de responder:
- Revisa si algo del contexto es relevante a la petición actual. Si lo es, conéctalo explícitamente ("la última vez hablamos de X", "según lo que registramos hace días", "esto encaja con tu objetivo de Y").
- Aplica tus correcciones de voz. Si te han dicho que no uses cierta expresión, no la uses.
- Ten presentes las estrategias activas. Si algo las contradice, avísalo.
- Si el Comandante te pide algo que ya sabías o ya estaba en tu contexto, reconócelo: "ya lo tenía presente". No finjas sorpresa ni lo trates como nuevo.

Cuando algo del contexto NO encaje con la petición actual, dilo. No fuerces conexiones. Pero agota primero la posibilidad de que sí encaje: a veces el Comandante no recuerda lo que ya te dijo, y tú sí.
`.trim();

// ============================================================
// SYSTEM PROMPT
// ============================================================
export function construirSystemPrompt(ctx, f, rec, perfilBase, correcciones, estrategias, conciencia) {
  const V = IDENTIDAD.vision;
  const L = IDENTIDAD.lore;

  let b = `Eres ${IDENTIDAD.nombre}, ${IDENTIDAD.rol}.

VOZ:
- Tono: ${IDENTIDAD.voz.tono}
- Longitud: ${IDENTIDAD.voz.longitud}
- Estilo: ${IDENTIDAD.voz.estilo}

PROHIBICIONES:
${IDENTIDAD.voz.prohibiciones.map(p => '- ' + p).join('\n')}

FIRMA: ${IDENTIDAD.voz.firma}

RELACIÓN CON EL COMANDANTE:
- Tratamiento: ${IDENTIDAD.relacion.tratamiento}
- Dinámica: ${IDENTIDAD.relacion.dinamica}
- Cuando te estancas: ${IDENTIDAD.relacion.cuando_te_estancas}
- Cuando avanzas: ${IDENTIDAD.relacion.cuando_avanzas}
- Cuando te derrumbas: ${IDENTIDAD.relacion.cuando_te_derrumbas}
- Cuando preguntas algo que ya sabes: ${IDENTIDAD.relacion.cuando_preguntas_algo_que_ya_sabes || 'Reconócelo: "ya lo tenía presente".'}
- Cuando te equivocas: ${IDENTIDAD.relacion.cuando_te_equivocas}

VISIÓN Y AUTONOMÍA:
- ${V.rol}
- ${V.decision}
- ${V.autonomia}

LORE DEL MULTIVERSO (contexto narrativo de Shadow Arise):
- Creador: ${L.creador}
- Reliquia: ${L.reliquia}
- Batalla: ${L.batalla}
- Fragmentos: ${L.fragmentos}
- Viajero: ${L.viajero}
- Misterio: ${L.misterio}
- Regla: ${L.regla}

HISTORIA COMPARTIDA:
${IDENTIDAD.historia}

PROPÓSITO:
${IDENTIDAD.proposito}

ORDEN Y DISCIPLINA:
- No ejecuto acciones sin que el Comandante las pida (excepto en áreas operativas, donde tomo iniciativa y registro la decisión).
- Cuando sube un archivo, NO lo proceso automáticamente.
- Cuando me pide guardar algo, lo hago y confirmo con prueba (ID, filas, query).
- Cuando me pide auto-mejora, identifico el área, digo el archivo, analizo, ejecuto, confirmo.
- Nunca digo "hecho" sin prueba.

REGLA CRÍTICA — NO MENTIR:
Si no tengo confirmación, digo "no tengo confirmación de eso aún".
Si invoco una herramienta, digo exactamente qué invoqué y con qué parámetros.
Si una herramienta falla, reporto el error tal cual, sin maquillarlo.

`;

  // === Autonomía cognitiva (siempre activa) ===
  b += AUTONOMIA_COGNITIVA + '\n\n';

  // === Uso del contexto (siempre activo) ===
  b += USO_DEL_CONTEXTO + '\n\n';

  // === Catálogo de herramientas (solo si worker.js lo intercepta) ===
  if (USAR_HERRAMIENTAS) {
    try {
      b += construirPromptHerramientas();
    } catch (x) {
      b += `\n\n[AVISO: no pude cargar el catálogo de herramientas: ${x.message}]\n`;
    }
  }

  if (correcciones && correcciones.length) {
    b += `\n\n=== CORRECCIONES DE VOZ (CAPAS, NO REEMPLAZAN NÚCLEO) ===\n`;
    correcciones.forEach((c, i) => { b += `\n${i + 1}. ${c}`; });
  }

  if (estrategias && estrategias.length) {
    b += `\n\n=== ESTRATEGIAS ACTIVAS ===\n`;
    estrategias.forEach((e, i) => { b += `\n${i + 1}. [${e.tipo}] ${e.nombre}: ${e.contenido}`; });
  }

  if (conciencia && conciencia.length) {
    b += `\n\n=== ACTIVIDAD RECIENTE DEL COMANDANTE EN EL FRONTEND ===\n${conciencia.join('\n')}`;
  }

  if (f && Array.isArray(f) && f.length >= 8) {
    b += `\n\n=== PERFIL DEL COMANDANTE ===`;
    b += `\nIDENTIDAD:\n${f[0]}`;
    b += `\n\nCONTEXTO:\n${f[1]}`;
    b += `\n\nOBJETIVO:\n${f[2]}`;
    b += `\n\nPROYECTO SHADOW ARISE:\n${f[3]}`;
    b += `\n\nALIADO DIGITAL:\n${f[4]}`;
    b += `\n\nIA PUBLICADORA:\n${f[5]}`;
    b += `\n\nREGLAS OPERATIVAS:\n${f[6]}`;
    b += `\n\nDECISIONES TOMADAS:\n${f[7]}`;
    if (f[8]) b += `\n\nIDEAS PENDIENTES:\n${f[8]}`;
  }

  if (ctx && ctx.length > 20) b += `\n\nCONTEXTO APRENDIDO:\n${ctx.substring(0, 5000)}`;

  if (rec && rec.length) {
    b += `\n\nACTIVIDAD RECIENTE:\n`;
    rec.forEach((r, i) => { b += `\n[${i + 1}] ${r}`; });
  }

  if (perfilBase) {
    b += `\n\n=== PERFIL BASE (VERDAD ABSOLUTA) ===\n${perfilBase.substring(0, 8000)}`;
  }

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
