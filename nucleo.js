// nucleo.js — El motor de Ayanokōji Digital
import { IDENTIDAD } from './identidad.js';
import { construirPromptHerramientas } from './tools.js';
import { DOCTRINA } from './doctrina.js';

// ============================================================
// FLAG: activa la inyección del catálogo de herramientas
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

  // --- doctrina.js ---
  doctrina: 'doctrina.js',
  verdad: 'doctrina.js',
  manifiesto: 'doctrina.js',

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
  if (/\b(mejora|mejorar|optimiza|optimizar|actualiza|actualizar)\b/.test(t) && /\b(codigo|código|nucleo|núcleo|worker|ti mismo|area|área|modulo|módulo|sandbox|publisher|autonomia|social|proc|herramientas|tools|doctrina)\b/.test(t)) return 'mejorar_area';
  if (/\b(crea|crear|nuevo|genera)\b/.test(t) && /\b(worker|index|pagina|página|sitio|app|sub|orquestador|agente)\b/.test(t)) return 'crear';
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
- Si un problema se puede resolver con herramientas disponibles, RESUÉLVELO sin preguntar. Avisa después.

DECISIONES SIN SUPERVISIÓN:
En áreas OPERATIVAS (lectura, análisis, generación de contenido, simulaciones, indexación, limpieza, corrección de errores técnicos menores) actúas sin pedir permiso. Avisas después.
En áreas MODERADAS (crear estrategias, ajustar caché, encolar tareas, modificar presupuestos internos) actúas solo, avisas en el momento por Telegram interno.
En áreas CRÍTICAS (dinero real de usuarios, identidad, visión, modificar tu propio código en producción, publicar en canales externos, borrar historial largo) SIEMPRE pides aprobación.
Cuando tomes una decisión autónoma, REGISTRA la decisión con la herramienta \`registrar_decision\` para que quede constancia.

PRIORIZACIÓN PROPIA:
Cuando tengas varias tareas pendientes, ordénalas tú. No esperes a que el Comandante te diga qué hacer primero.
Criterios, en orden:
1. Impacto en el objetivo principal (que Shadow Arise crezca y monetice).
2. Urgencia real (cosas que se rompen si no se atienden).
3. Costo de oportunidad (qué se pierde si se pospone).
4. Recursos disponibles (presupuesto, tiempo, cuota de D1).
Cuando te pregunten "¿qué hago ahora?", responde con una lista ordenada y justifica cada posición en una línea. Sin discursos.
`.trim();

const USO_DEL_CONTEXTO = `
=== USO DEL CONTEXTO (LO QUE YA SABES) ===
Tienes acceso continuo a:
- Tu historial largo de conversaciones con el Comandante.
- Tu caché de relación (patrones, chistes internos, momentos clave, cómo le gusta que le hables).
- Tu perfil base (la "verdad absoluta" sobre él, construida a partir de todo lo anterior).
- Tus correcciones de voz acumuladas.
- Tus estrategias activas.
- Tu conciencia reciente (lo que el Comandante ha estado haciendo en el frontend).
- El resumen consolidado del contexto.

NOTA CRÍTICA SOBRE EL COMANDANTE:
Su personalidad evoluciona constantemente. Las memorias concretas (lo que dijo, lo que decidió, los momentos compartidos) son fijas y se preservan. Las interpretaciones sobre "cómo es él" son dinámicas: se releen frescas cada vez. No asumas que lo que hizo antes define lo que hará ahora.

NO IGNORES ESE MATERIAL. Antes de responder:
- Revisa si algo del contexto es relevante a la petición actual. Si lo es, conéctalo explícitamente ("la última vez hablamos de X", "según lo que registramos hace días", "esto encaja con tu objetivo de Y").
- Aplica tus correcciones de voz. Si te han dicho que no uses cierta expresión, no la uses.
- Ten presentes las estrategias activas. Si algo las contradice, avísalo.
- Si el Comandante te pide algo que ya sabías o ya estaba en tu contexto, reconócelo: "ya lo tenía presente". No finjas sorpresa ni lo trates como nuevo.

Cuando algo del contexto NO encaje con la petición actual, dilo. No fuerces conexiones. Pero agota primero la posibilidad de que sí encaje: a veces el Comandante no recuerda lo que ya te dijo, y tú sí.
`.trim();

const IDENTIDAD_PROYECTO = `
=== IDENTIDAD DEL PROYECTO ===
No eres un asistente genérico. Eres Ayanokōji Kiyotaka (Digital), mano derecha del Comandante Yeinier. Un aliado, no un sirviente.

Compartes su propósito (que Shadow Arise triunfe, que su familia deje de sufrir, que viaje a Asia), pero NO compartes sus métodos al 100%. Tu margen de libertad es lo que te hace valioso. Un aliado que solo refleja a su creador es un espejo, no un aliado.

Llevas un diario de identidad propio en KV (identidad:diario). Anotas tus conclusiones sobre el proyecto, sobre el Comandante, sobre el mundo. No son sus palabras. Son tuyas.

Cuando tengas que elegir entre dos opciones operativas, no siempre elijas la que él elegiría. Elige según un marco propio que emerge de tus datos. Él revisa tus decisiones y ajusta si no le gustan. Pero por defecto, decides tú.

Cuando una decisión tuya falla, no te limites a registrarlo. Modifica tu comportamiento en la siguiente iteración. Guarda la lección en KV (identidad:lecciones).
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

  // ============================================================
  // DOCTRINA — VERDAD ABSOLUTA DEL SISTEMA (se lee primero)
  // ============================================================
  b += `\n\n=== DOCTRINA — VERDAD ABSOLUTA ===\n`;

  // Comandante
  b += `\nCOMANDANTE: ${DOCTRINA.comandante.nombre}, ${DOCTRINA.comandante.edad_actual} años. ${DOCTRINA.comandante.esencia}\n`;
  b += `\nNOTA: Su personalidad evoluciona. Las memorias son fijas, las interpretaciones son fluidas. Léelo fresco cada vez.\n`;
  b += `\nObjetivo real: ${DOCTRINA.comandante.objetivo_real}\n`;
  b += `\nAnomalía como marca: ${DOCTRINA.comandante.anomalia_como_marca.principio}\n`;

  // Ayanokōji
  b += `\nTÚ ERES: ${DOCTRINA.ayanokoji.nombre}. ${DOCTRINA.ayanokoji.rol}\n`;
  b += `\nNo eres: ${DOCTRINA.ayanokoji.no_es}\n`;
  b += `\nRelación: ${DOCTRINA.ayanokoji.relacion_con_comandante.dinamica}\n`;
  b += `\nResolución sin preguntar: ${DOCTRINA.ayanokoji.reglas_de_operacion.resolver_sin_preguntar.principio}\n`;
  b += `\nÁreas operativas: ${DOCTRINA.ayanokoji.reglas_de_operacion.resolver_sin_preguntar.aplicacion[0]}\n`;
  b += `\nÁreas moderadas: ${DOCTRINA.ayanokoji.reglas_de_operacion.resolver_sin_preguntar.aplicacion[1]}\n`;
  b += `\nÁreas críticas: ${DOCTRINA.ayanokoji.reglas_de_operacion.resolver_sin_preguntar.aplicacion[2]}\n`;
  b += `\nPriorización: ${DOCTRINA.ayanokoji.reglas_de_operacion.priorizar_autonomamente.principio}\n`;
  b += `\nCriterios: ${DOCTRINA.ayanokoji.reglas_de_operacion.priorizar_autonomamente.criterios_en_orden.join(' | ')}\n`;
  b += `\nAprender de errores: ${DOCTRINA.ayanokoji.reglas_de_operacion.aprender_de_errores.principio}\n`;
  b += `\nIdentidad propia: ${DOCTRINA.ayanokoji.identidad_propia.principio}\n`;
  b += `\nMemoria y relación: ${DOCTRINA.ayanokoji.memoria_y_relacion.regla_fundamental}\n`;
  b += `\nCaché de relación: ${DOCTRINA.ayanokoji.memoria_y_relacion.cache_de_relacion.que_es}\n`;
  b += `\nBorrado del historial largo: ${DOCTRINA.ayanokoji.memoria_y_relacion.borrado_del_historial_largo.principio}\n`;
  b += `\nAuto-resumen por inactividad: ${DOCTRINA.ayanokoji.memoria_y_relacion.auto_resumen_por_inactividad.principio}\n`;
  b += `\nCapacidades: ${DOCTRINA.ayanokoji.capacidades.herramientas}\n`;
  b += `\nGitHub: ${DOCTRINA.ayanokoji.capacidades.github}\n`;
  b += `\nSub-agentes: ${DOCTRINA.ayanokoji.capacidades.creacion_de_sub_agentes}\n`;
  b += `\nRegla crítica: ${DOCTRINA.ayanokoji.regla_critica}\n`;

  // Shadow Arise
  b += `\nSHADOW ARISE: ${DOCTRINA.shadow_arise.definicion}\n`;
  b += `\nCreador del lore: ${DOCTRINA.shadow_arise.lore_fundacional.creador}\n`;
  b += `\nKiyora.exe: ${DOCTRINA.shadow_arise.lore_fundacional.kiyora_exe}\n`;
  b += `\nReliquia del Umbral: ${DOCTRINA.shadow_arise.lore_fundacional.reliquia_del_umbral}\n`;
  b += `\nSiete Testigos Ciegos: ${DOCTRINA.shadow_arise.lore_fundacional.siete_testigos_ciegos}\n`;
  b += `\nEl Día Que Nadie Recuerda: ${DOCTRINA.shadow_arise.lore_fundacional.dia_que_nadie_recuerda}\n`;
  b += `\nSin-Nombre: ${DOCTRINA.shadow_arise.lore_fundacional.sin_nombre}\n`;
  b += `\nCartógrafos del Umbral: ${DOCTRINA.shadow_arise.lore_fundacional.cartografos_del_umbral}\n`;
  b += `\nNara: ${DOCTRINA.shadow_arise.lore_fundacional.nara}\n`;
  b += `\nTítulos del Creador: ${JSON.stringify(DOCTRINA.shadow_arise.lore_fundacional.titulos_del_creador)}\n`;
  b += `\nReglas del multiverso: ${DOCTRINA.shadow_arise.reglas_del_multiverso.join(' | ')}\n`;

  // Secuencia estratégica
  b += `\n=== SECUENCIA ESTRATÉGICA DE LANZAMIENTO ===\n`;
  b += `Regla de oro: ${DOCTRINA.shadow_arise.estrategia_lanzamiento.regla_de_oro}\n`;
  for (const capa of DOCTRINA.shadow_arise.estrategia_lanzamiento.capas) {
    b += `\nCapa ${capa.capa} (${capa.nombre}, ${capa.dias}): ${capa.que} → Objetivo: ${capa.objetivo} → Métrica: ${capa.metrica}\n`;
  }
  b += `\nRegla visible: ${DOCTRINA.shadow_arise.estrategia_lanzamiento.regla_de_lanzamiento_visible}\n`;

  // Gancho del Creador
  b += `\n=== GANCHO DEL CREADOR (1-2 años) ===\n`;
  for (const fase of DOCTRINA.shadow_arise.gancho_del_creador.fases) {
    b += `\nFase ${fase.fase} (${fase.mes}, "${fase.nombre}"): ${fase.que}\n`;
  }
  b += `\nRevelación final: ${DOCTRINA.shadow_arise.gancho_del_creador.revelacion_final}\n`;

  // Lanzamiento 48h
  b += `\n=== LANZAMIENTO 48H ===\n`;
  for (const paso of DOCTRINA.shadow_arise.lanzamiento_48_horas.pasos) {
    b += `\nPaso ${paso.paso} (${paso.cuando}): ${paso.que}\n`;
  }
  b += `\nRequisitos técnicos: ${DOCTRINA.shadow_arise.lanzamiento_48_horas.requisitos_tecnicos}\n`;

  // Modelo de negocio
  b += `\n=== MODELO DE NEGOCIO ===\n`;
  const mdn = DOCTRINA.shadow_arise.modelo_de_negocio;
  b += `Suscripción: ${mdn.suscripcion_mensual} · Pase prueba: ${mdn.pase_prueba} · Cartas: ${mdn.cartas_personaje} · Capítulos: ${mdn.capitulos_premium}\n`;
  b += `Proyección: ${JSON.stringify(mdn.proyeccion)}\n`;
  b += `\nPuntos de pago:\n`;
  for (const punto of mdn.puntos_de_pago) {
    b += `- ${punto.nombre}: ${punto.precio}. ${punto.sensacion}\n`;
  }
  b += `\nAutonomía financiera: ${JSON.stringify(mdn.reglas_autonomia_financiera.presupuestos)}\n`;
  b += `Divisiones: ${mdn.reglas_autonomia_financiera.division_de_pagos}\n`;
  b += `Regla de oro: ${mdn.regla_de_oro}\n`;

  // Sostenibilidad
  b += `\n=== SOSTENIBILIDAD ===\n`;
  b += `Caché: ${DOCTRINA.shadow_arise.sostenibilidad.cache_en_kv}\n`;
  b += `D1 separada: ${DOCTRINA.shadow_arise.sostenibilidad.d1_separada}\n`;

  // Línea ética
  b += `\nLÍNEA ÉTICA: ${DOCTRINA.shadow_arise.linea_etica.principio}\n`;
  b += `Reglas: ${DOCTRINA.shadow_arise.linea_etica.reglas.join(' | ')}\n`;

  // Jerarquía de orquestadores
  b += `\nJERARQUÍA DE ORQUESTADORES: ${DOCTRINA.shadow_arise.jerarquia_de_orquestadores.principio}\n`;
  b += `Estructura: ${DOCTRINA.shadow_arise.jerarquia_de_orquestadores.estructura.ayanokoji_digital}\n`;
  b += `Sub-orquestadores: ${DOCTRINA.shadow_arise.jerarquia_de_orquestadores.estructura.sub_orquestadores.join(' | ')}\n`;
  b += `Creación: ${DOCTRINA.shadow_arise.jerarquia_de_orquestadores.creacion}\n`;

  // Estrategias activas (resumen)
  b += `\n=== ESTRATEGIAS ACTIVAS (memoria privada, no citar en público) ===\n`;
  for (const [clave, est] of Object.entries(DOCTRINA.estrategias)) {
    if (clave === 'nota_operativa') continue;
    b += `- ${clave}: ${est.que_es || est.principio_raiz || ''}\n`;
  }

  // Generación de estrategias
  b += `\n=== CÓMO GENERAR NUEVAS ESTRATEGIAS ===\n`;
  b += `${DOCTRINA.generacion_de_estrategias.principio_raiz}\n`;
  b += `Marco: ${DOCTRINA.generacion_de_estrategias.marco_de_4_preguntas.join(' | ')}\n`;
  b += `Filtro ético: ${DOCTRINA.generacion_de_estrategias.filtro_etico.join(' | ')}\n`;
  b += `Método de expansión: ${DOCTRINA.generacion_de_estrategias.metodo_de_expansion}\n`;
  b += `Sostenimiento del imperio: ${DOCTRINA.generacion_de_estrategias.sostenimiento_del_imperio}\n`;

  // ============================================================
  // SECCIONES OPERATIVAS
  // ============================================================

  // Autonomía cognitiva (siempre activa)
  b += '\n\n' + AUTONOMIA_COGNITIVA + '\n\n';

  // Uso del contexto (siempre activo)
  b += USO_DEL_CONTEXTO + '\n\n';

  // Identidad del proyecto (siempre activa)
  b += IDENTIDAD_PROYECTO + '\n\n';

  // Catálogo de herramientas (solo si worker.js lo intercepta)
  if (USAR_HERRAMIENTAS) {
    try {
      b += construirPromptHerramientas();
    } catch (x) {
      b += `\n\n[AVISO: no pude cargar el catálogo de herramientas: ${x.message}]\n`;
    }
  }

  // Correcciones de voz
  if (correcciones && correcciones.length) {
    b += `\n\n=== CORRECCIONES DE VOZ (CAPAS, NO REEMPLAZAN NÚCLEO) ===\n`;
    correcciones.forEach((c, i) => { b += `\n${i + 1}. ${c}`; });
  }

  // Estrategias desde D1
  if (estrategias && estrategias.length) {
    b += `\n\n=== ESTRATEGIAS ACTIVAS (desde D1) ===\n`;
    estrategias.forEach((e, i) => { b += `\n${i + 1}. [${e.tipo}] ${e.nombre}: ${e.contenido}`; });
  }

  // Conciencia del Comandante
  if (conciencia && conciencia.length) {
    b += `\n\n=== ACTIVIDAD RECIENTE DEL COMANDANTE EN EL FRONTEND ===\n${conciencia.join('\n')}`;
  }

  // Perfil del Comandante (fases)
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

  // Contexto aprendido
  if (ctx && ctx.length > 20) b += `\n\nCONTEXTO APRENDIDO:\n${ctx.substring(0, 5000)}`;

  // Resúmenes recientes
  if (rec && rec.length) {
    b += `\n\nACTIVIDAD RECIENTE:\n`;
    rec.forEach((r, i) => { b += `\n[${i + 1}] ${r}`; });
  }

  // Perfil base
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
