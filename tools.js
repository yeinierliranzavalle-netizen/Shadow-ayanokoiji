// tools.js — Catálogo de herramientas de Ayanokōji Digital (v3.0)
// Cambios v3.0:
// - Campo `activa: true/false` en cada herramienta
// - 18 activas (según nucleo.js TOOLS_ACTIVAS)
// - 30 pausadas (existen, pero no se inyectan en el prompt detallado)
// - Helper listarHerramientasActivas()
// - Todo lo demás idéntico a v2.0 (compatibilidad total con kernel.js)

export const TOOLS = {

  // ============================================================
  // CÓDIGO Y SISTEMA — ACTIVAS
  // ============================================================
  leer_source: {
    nombre: 'leer_source',
    categoria: 'codigo',
    tipo: 'lectura',
    destino: 'github',
    requiere_aprobacion: false,
    activa: true,
    descripcion: 'Lee el código fuente COMPLETO y ORIGINAL de un archivo del proyecto desde GitHub (no el bundle minificado). Úsala antes de analizar o modificar cualquier archivo.',
    params: {
      archivo: 'string (ej: worker.js, nucleo.js, proc.js, autonomia.js, sandbox.js, publisher.js, social.js, shared.js, identidad.js, tools.js, storage.js, kernel.js, doctrina.js)',
      repo: 'string opcional ("backend" o "frontend", por defecto "backend")'
    }
  },
  listar_source: {
    nombre: 'listar_source',
    categoria: 'codigo',
    tipo: 'lectura',
    destino: 'github',
    requiere_aprobacion: false,
    activa: true,
    descripcion: 'Lista todos los archivos del repositorio (backend o frontend) con su tamaño.',
    params: { repo: 'string ("backend" o "frontend", por defecto "backend")' }
  },

  // ============================================================
  // WORKERS — ACTIVAS
  // ============================================================
  crear_worker: {
    nombre: 'crear_worker',
    categoria: 'workers',
    tipo: 'peligroso',
    destino: 'cloudflare',
    requiere_aprobacion: true,
    activa: true,
    descripcion: 'Crea y despliega un nuevo Worker en Cloudflare. Requiere aprobación. Se usa para crear sub-orquestadores.',
    params: { nombre: 'string', codigo: 'string' }
  },
  actualizar_worker: {
    nombre: 'actualizar_worker',
    categoria: 'workers',
    tipo: 'peligroso',
    destino: 'cloudflare',
    requiere_aprobacion: true,
    activa: true,
    descripcion: 'Actualiza el código de un Worker existente. Usa deploySeguro (validación + snapshot + verificación + reversión). Requiere aprobación.',
    params: { nombre: 'string', codigo: 'string' }
  },
  revertir_worker: {
    nombre: 'revertir_worker',
    categoria: 'workers',
    tipo: 'peligroso',
    destino: 'cloudflare',
    requiere_aprobacion: true,
    activa: true,
    descripcion: 'Revierte un Worker al último snapshot. Requiere aprobación.',
    params: { nombre: 'string' }
  },

  // ============================================================
  // MEMORIA — ACTIVAS
  // ============================================================
  leer_historial_largo: {
    nombre: 'leer_historial_largo',
    categoria: 'memoria',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: true,
    descripcion: 'Lee un fragmento del historial largo de conversaciones.',
    params: { limite: 'integer (por defecto 50)', user_id: 'string (por defecto "comandante")', desde_orden: 'integer opcional' }
  },
  buscar_tema: {
    nombre: 'buscar_tema',
    categoria: 'memoria',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: true,
    descripcion: 'Busca en el índice semántico mensajes relacionados con un tema.',
    params: { q: 'string (tema a buscar)', limite: 'integer (por defecto 20)' }
  },
  leer_contexto: {
    nombre: 'leer_contexto',
    categoria: 'memoria',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: true,
    descripcion: 'Lee los resúmenes de contexto guardados.',
    params: { limite: 'integer (por defecto 5)' }
  },

  // ============================================================
  // ESTRATEGIA — ACTIVAS
  // ============================================================
  crear_estrategia: {
    nombre: 'crear_estrategia',
    categoria: 'estrategia',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: true,
    descripcion: 'Registra una nueva estrategia activa en el sistema.',
    params: { nombre: 'string', tipo: 'string', contenido: 'string', prioridad: 'integer 1-10' }
  },
  registrar_decision: {
    nombre: 'registrar_decision',
    categoria: 'estrategia',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: true,
    descripcion: 'Registra una decisión autónoma en la tabla de decisiones.',
    params: { tipo: 'string', contexto: 'string', decision: 'string', simulacion: 'string', resultado: 'string' }
  },
  leer_decisiones: {
    nombre: 'leer_decisiones',
    categoria: 'estrategia',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: true,
    descripcion: 'Lee las últimas decisiones autónomas registradas.',
    params: { limite: 'integer (por defecto 20)' }
  },

  // ============================================================
  // NOTIFICACIONES — ACTIVAS
  // ============================================================
  crear_notificacion: {
    nombre: 'crear_notificacion',
    categoria: 'notificaciones',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: true,
    descripcion: 'Crea una notificación en la bandeja interna del Comandante.',
    params: { tipo: 'string', titulo: 'string', mensaje: 'string' }
  },
  notificar_telegram: {
    nombre: 'notificar_telegram',
    categoria: 'notificaciones',
    tipo: 'escritura',
    destino: 'externo',
    requiere_aprobacion: false,
    activa: true,
    descripcion: 'Envía un mensaje al Telegram personal del Comandante. Solo para alertas urgentes.',
    params: { mensaje: 'string' }
  },

  // ============================================================
  // MISIÓN — ACTIVAS
  // ============================================================
  actualizar_mision: {
    nombre: 'actualizar_mision',
    categoria: 'mision',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: true,
    descripcion: 'Actualiza el estado de la misión actual (fase, objetivo, siguiente paso).',
    params: { fase_actual: 'string opcional', objetivo_semana: 'string opcional', siguiente_paso: 'string opcional' }
  },
  leer_mision: {
    nombre: 'leer_mision',
    categoria: 'mision',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: true,
    descripcion: 'Lee el estado actual de la misión.',
    params: {}
  },

  // ============================================================
  // OBSERVABILIDAD — ACTIVAS
  // ============================================================
  leer_capacidades: {
    nombre: 'leer_capacidades',
    categoria: 'observabilidad',
    tipo: 'lectura',
    destino: 'cloudflare',
    requiere_aprobacion: false,
    activa: true,
    descripcion: 'Devuelve las capacidades actuales del sistema y el uso real de Cloudflare.',
    params: {}
  },
  leer_uso_real: {
    nombre: 'leer_uso_real',
    categoria: 'observabilidad',
    tipo: 'lectura',
    destino: 'cloudflare',
    requiere_aprobacion: false,
    activa: true,
    descripcion: 'Consulta el uso real de Cloudflare (Workers, D1, KV) en las últimas 24h.',
    params: {}
  },

  // ============================================================
  // TAREAS — ACTIVAS
  // ============================================================
  encolar_tarea: {
    nombre: 'encolar_tarea',
    categoria: 'tareas',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: true,
    descripcion: 'Encola una tarea para que el cron la ejecute después.',
    params: { descripcion: 'string', prioridad: 'integer 1-10', tipo: 'string opcional' }
  },

  // ============================================================
  // ============================================================
  // A PARTIR DE AQUÍ: HERRAMIENTAS PAUSADAS (activa: false)
  // Existen, kernel.js las reconoce, pero no se inyectan con detalle en el prompt.
  // ============================================================
  // ============================================================

  // ---------- CÓDIGO (pausadas) ----------
  escribir_source: {
    nombre: 'escribir_source',
    categoria: 'codigo',
    tipo: 'peligroso',
    destino: 'github',
    requiere_aprobacion: true,
    activa: false,
    descripcion: 'Escribe o modifica un archivo del repositorio haciendo un commit.',
    params: { archivo: 'string', contenido: 'string', mensaje_commit: 'string', repo: 'string' }
  },
  proponer_cambio: {
    nombre: 'proponer_cambio',
    categoria: 'codigo',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Guarda una propuesta de cambio en la bandeja de decisiones sin ejecutarla.',
    params: { archivo: 'string', diff: 'string', razon: 'string' }
  },
  leer_frontend: {
    nombre: 'leer_frontend',
    categoria: 'codigo',
    tipo: 'lectura',
    destino: 'github',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Lee el código del frontend (index.html, app.js, styles.css) desde GitHub.',
    params: { archivo: 'string' }
  },
  modificar_frontend: {
    nombre: 'modificar_frontend',
    categoria: 'codigo',
    tipo: 'peligroso',
    destino: 'github',
    requiere_aprobacion: true,
    activa: false,
    descripcion: 'Modifica un archivo del frontend.',
    params: { archivo: 'string', contenido: 'string', mensaje_commit: 'string' }
  },

  // ---------- WORKERS (pausadas) ----------
  listar_workers: {
    nombre: 'listar_workers',
    categoria: 'workers',
    tipo: 'lectura',
    destino: 'cloudflare',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Lista todos los Workers desplegados en la cuenta de Cloudflare.',
    params: {}
  },
  leer_worker: {
    nombre: 'leer_worker',
    categoria: 'workers',
    tipo: 'lectura',
    destino: 'cloudflare',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Lee el bundle actual de un Worker en Cloudflare.',
    params: { nombre: 'string' }
  },
  snapshot_worker: {
    nombre: 'snapshot_worker',
    categoria: 'workers',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Crea un snapshot (copia de seguridad) del Worker antes de modificarlo.',
    params: { nombre: 'string' }
  },

  // ---------- MEMORIA (pausadas) ----------
  guardar_contexto: {
    nombre: 'guardar_contexto',
    categoria: 'memoria',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Guarda un nuevo resumen o análisis en la tabla de contexto.',
    params: { resumen: 'string', fuente: 'string', fases: 'array opcional' }
  },
  indexar_historial: {
    nombre: 'indexar_historial',
    categoria: 'memoria',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Reindexa el historial largo para mejorar la búsqueda semántica.',
    params: {}
  },
  construir_perfil_base: {
    nombre: 'construir_perfil_base',
    categoria: 'memoria',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Reconstruye el perfil base del Comandante desde todo el contexto disponible.',
    params: {}
  },
  leer_perfil_base: {
    nombre: 'leer_perfil_base',
    categoria: 'memoria',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Lee el perfil base actual del Comandante.',
    params: {}
  },

  // ---------- ESTRATEGIA (pausadas) ----------
  listar_estrategias: {
    nombre: 'listar_estrategias',
    categoria: 'estrategia',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Lista todas las estrategias activas del sistema.',
    params: {}
  },
  eliminar_estrategia: {
    nombre: 'eliminar_estrategia',
    categoria: 'estrategia',
    tipo: 'peligroso',
    destino: 'interno',
    requiere_aprobacion: true,
    activa: false,
    descripcion: 'Elimina una estrategia por ID.',
    params: { id: 'integer' }
  },
  simular_estrategia: {
    nombre: 'simular_estrategia',
    categoria: 'estrategia',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Simula una estrategia en el sandbox contra los 4 arquetipos de usuario.',
    params: { estrategia_id: 'integer' }
  },
  simular_precio: {
    nombre: 'simular_precio',
    categoria: 'estrategia',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Simula el impacto de un cambio de precio.',
    params: { propuesta: 'string' }
  },

  // ---------- SANDBOX (pausadas) ----------
  ejecutar_etapa: {
    nombre: 'ejecutar_etapa',
    categoria: 'sandbox',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Ejecuta una etapa del currículum del sandbox.',
    params: { etapa_id: 'string', dia: 'integer' }
  },
  test_500: {
    nombre: 'test_500',
    categoria: 'sandbox',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Ejecuta la simulación de 500 usuarios durante un día virtual.',
    params: { dia: 'integer' }
  },
  ver_sandbox: {
    nombre: 'ver_sandbox',
    categoria: 'sandbox',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Lee el estado actual del sandbox.',
    params: {}
  },
  promover_leccion: {
    nombre: 'promover_leccion',
    categoria: 'sandbox',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Promueve una lección del sandbox a estrategia activa.',
    params: { leccion_id: 'integer' }
  },

  // ---------- CONTENIDO (pausadas) ----------
  generar_contenido: {
    nombre: 'generar_contenido',
    categoria: 'contenido',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Genera contenido (lore, teaser, diálogo, provocación, anuncio).',
    params: { tipo: 'string' }
  },
  generar_imagen: {
    nombre: 'generar_imagen',
    categoria: 'contenido',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Genera una imagen con IA (FLUX). Devuelve el ID y la URL.',
    params: { prompt: 'string' }
  },
  publicar: {
    nombre: 'publicar',
    categoria: 'contenido',
    tipo: 'peligroso',
    destino: 'externo',
    requiere_aprobacion: true,
    activa: false,
    descripcion: 'Publica contenido en uno o varios canales (mastodon, bluesky, discord, reddit).',
    params: { contenido: 'string', canales: 'string', imagen_id: 'string opcional', tipo: 'string' }
  },
  encolar_publicacion: {
    nombre: 'encolar_publicacion',
    categoria: 'contenido',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Encola una publicación para el momento programado.',
    params: { contenido: 'string', canales: 'string', programada: 'integer' }
  },
  listar_publicaciones: {
    nombre: 'listar_publicaciones',
    categoria: 'contenido',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Lista las últimas publicaciones con su estado.',
    params: { limite: 'integer' }
  },

  // ---------- TAREAS (pausadas) ----------
  listar_tareas: {
    nombre: 'listar_tareas',
    categoria: 'tareas',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Lista las tareas en cola y su estado.',
    params: {}
  },
  pulso_cron: {
    nombre: 'pulso_cron',
    categoria: 'tareas',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Fuerza una ejecución inmediata del cron autónomo.',
    params: {}
  },

  // ---------- OBSERVABILIDAD (pausadas) ----------
  diagnosticar: {
    nombre: 'diagnosticar',
    categoria: 'observabilidad',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Ejecuta un diagnóstico completo: tablas D1, conteos, KV, módulos.',
    params: {}
  },
  errores_tardios: {
    nombre: 'errores_tardios',
    categoria: 'observabilidad',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Detecta errores tardíos: KV huérfano, presupuesto agotado, procesos atascados.',
    params: {}
  },
  leer_acciones: {
    nombre: 'leer_acciones',
    categoria: 'observabilidad',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Lee las últimas acciones registradas en el sistema.',
    params: { limite: 'integer' }
  },

  // ---------- NOTIFICACIONES (pausadas) ----------
  listar_notificaciones: {
    nombre: 'listar_notificaciones',
    categoria: 'notificaciones',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Lista las notificaciones de la bandeja interna.',
    params: { limite: 'integer' }
  },

  // ---------- CONCIENCIA (pausadas) ----------
  registrar_conciencia: {
    nombre: 'registrar_conciencia',
    categoria: 'conciencia',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Registra una observación en tu conciencia. Persiste entre conversaciones.',
    params: { accion: 'string', detalle: 'string', pestana: 'string' }
  },
  leer_conciencia: {
    nombre: 'leer_conciencia',
    categoria: 'conciencia',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    activa: false,
    descripcion: 'Lee la conciencia reciente del Comandante.',
    params: { user_id: 'string' }
  }
};

// ============================================================
// HELPERS
// ============================================================
export function herramientaExiste(nombre) {
  return !!TOOLS[nombre];
}

export function herramientaRequiereAprobacion(nombre) {
  const t = TOOLS[nombre];
  return t ? t.requiere_aprobacion : false;
}

export function herramientaEsPeligrosa(nombre) {
  const t = TOOLS[nombre];
  return t ? t.tipo === 'peligroso' : false;
}

export function herramientaEstaActiva(nombre) {
  const t = TOOLS[nombre];
  return t ? t.activa !== false : false;
}

export function listarNombresHerramientas() {
  return Object.keys(TOOLS);
}

export function listarHerramientasActivas() {
  return Object.values(TOOLS).filter(t => t.activa !== false);
}

export function listarHerramientasPausadas() {
  return Object.values(TOOLS).filter(t => t.activa === false);
}

export function categoriaDeHerramienta(nombre) {
  const t = TOOLS[nombre];
  return t ? t.categoria : null;
}

// ============================================================
// CONSTRUIR PROMPT DE HERRAMIENTAS (compatibilidad con kernel.js)
// ============================================================
export function construirPromptHerramientas() {
  const activas = listarHerramientasActivas();
  const porCategoria = {};
  for (const t of activas) {
    if (!porCategoria[t.categoria]) porCategoria[t.categoria] = [];
    porCategoria[t.categoria].push(t);
  }

  let out = '\n\n=== HERRAMIENTAS ACTIVAS ===\n';
  out += 'Tienes acceso a un catálogo de herramientas. Úsalas cuando lo necesites.\n\n';
  out += 'FORMATO DE INVOCACIÓN:\n';
  out += '```tool\n{"tool": "nombre_herramienta", "params": {...}, "razon": "por qué la usas"}\n```\n\n';
  out += 'REGLAS:\n';
  out += '- **lectura**: úsalas libremente.\n';
  out += '- **escritura**: úsalas si el Comandante te lo pidió o si es claramente necesario. Explica qué hiciste.\n';
  out += '- **peligroso**: SIEMPRE pide aprobación antes de invocarlas.\n';
  out += '- NUNCA inventes un resultado de herramienta.\n\n';

  for (const [cat, tools] of Object.entries(porCategoria)) {
    out += `### ${cat.toUpperCase()}\n`;
    for (const t of tools) {
      const marca = t.tipo === 'peligroso' ? ' ⚠️' : t.tipo === 'escritura' ? ' ✎' : '';
      out += `- **${t.nombre}**${marca}: ${t.descripcion}\n`;
    }
    out += '\n';
  }

  return out;
}

// ============================================================
// PARSER DE INVOCACIONES
// ============================================================
export function parsearInvocaciones(texto) {
  if (!texto || typeof texto !== 'string') return [];
  const regex = /```tool\s*\n([\s\S]*?)\n```/g;
  const invocaciones = [];
  let match;
  while ((match = regex.exec(texto)) !== null) {
    const raw = match[1].trim();
    try {
      const obj = JSON.parse(raw);
      if (obj && obj.tool && typeof obj.tool === 'string') {
        invocaciones.push({
          tool: obj.tool,
          params: obj.params || {},
          razon: obj.razon || ''
        });
      }
    } catch (x) {
      invocaciones.push({ tool: '__error_parse__', params: {}, razon: raw.substring(0, 200), error: x.message });
    }
  }
  return invocaciones;
}

// ============================================================
// DETECCIÓN HEURÍSTICA
// ============================================================
export function inferirHerramientaDeTexto(texto) {
  const t = (texto || '').toLowerCase();

  if (/\b(lee|leer|muestra|mostrar|qué hay en|ver)\b.*\b(c[oó]digo|source|fuente|archivo)\b/.test(t)) return 'leer_source';
  if (/\b(lista|listar)\b.*\b(archivos|source|repositorio)\b/.test(t)) return 'listar_source';
  if (/\b(modifica|edita|cambia|escribe)\b.*\b(c[oó]digo|archivo|source)\b/.test(t)) return 'escribir_source';
  if (/\b(mejora|mejorar|optimiza|refactoriza)\b.*\b(c[oó]digo|archivo|worker|sistema)\b/.test(t)) return 'proponer_cambio';
  if (/\b(publica|publicar|env[ií]a)\b.*\b(mastodon|bluesky|reddit|discord)\b/.test(t)) return 'publicar';
  if (/\b(genera|crear|haz)\b.*\b(imagen|ilustraci[oó]n|foto)\b/.test(t)) return 'generar_imagen';
  if (/\b(estado|uso|c[oó]mo est[aá]|diagn[oó]stico)\b.*\b(sistema|cloudflare|worker)\b/.test(t)) return 'diagnosticar';
  if (/\b(historial|memoria|recuerda)\b/.test(t)) return 'leer_historial_largo';
  if (/\b(busca|buscar|encuentra)\b.*\b(tema|concepto|idea)\b/.test(t)) return 'buscar_tema';
  if (/\b(estrategia|estrategias)\b/.test(t)) return 'listar_estrategias';
  if (/\b(decisi[oó]n|decisiones)\b/.test(t)) return 'leer_decisiones';
  if (/\b(sandbox|entrena|simulaci[oó]n)\b/.test(t)) return 'ver_sandbox';
  if (/\b(notificaci[oó]n|notificaciones|bandeja)\b/.test(t)) return 'listar_notificaciones';
  if (/\b(conciencia|qué has visto)\b/.test(t)) return 'leer_conciencia';
  if (/\b(frontend|interfaz|p[aá]gina|app)\b/.test(t)) return 'leer_frontend';

  return null;
}
