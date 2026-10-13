// tools.js — Catálogo de herramientas de Ayanokōji Digital

export const TOOLS = {

  // ============================================================
  // CÓDIGO Y SISTEMA
  // ============================================================
  leer_source: {
    nombre: 'leer_source',
    categoria: 'codigo',
    tipo: 'lectura',
    destino: 'github',
    requiere_aprobacion: false,
    descripcion: 'Lee el código fuente COMPLETO y ORIGINAL de un archivo del proyecto desde GitHub (no el bundle minificado). Úsala antes de analizar o modificar cualquier archivo.',
    params: {
      archivo: 'string (ej: worker.js, nucleo.js, proc.js, autonomia.js, sandbox.js, publisher.js, social.js, shared.js, identidad.js, tools.js)',
      repo: 'string opcional ("backend" o "frontend", por defecto "backend")'
    }
  },
  listar_source: {
    nombre: 'listar_source',
    categoria: 'codigo',
    tipo: 'lectura',
    destino: 'github',
    requiere_aprobacion: false,
    descripcion: 'Lista todos los archivos del repositorio (backend o frontend) con su tamaño.',
    params: { repo: 'string ("backend" o "frontend", por defecto "backend")' }
  },
  escribir_source: {
    nombre: 'escribir_source',
    categoria: 'codigo',
    tipo: 'peligroso',
    destino: 'github',
    requiere_aprobacion: true,
    descripcion: 'Escribe o modifica un archivo del repositorio haciendo un commit. SIEMPRE pide aprobación antes de invocarla.',
    params: {
      archivo: 'string',
      contenido: 'string (contenido completo nuevo)',
      mensaje_commit: 'string',
      repo: 'string ("backend" o "frontend")'
    }
  },
  proponer_cambio: {
    nombre: 'proponer_cambio',
    categoria: 'codigo',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Guarda una propuesta de cambio en la bandeja de decisiones sin ejecutarla.',
    params: { archivo: 'string', diff: 'string', razon: 'string' }
  },

  // ============================================================
  // WORKERS
  // ============================================================
  listar_workers: {
    nombre: 'listar_workers',
    categoria: 'workers',
    tipo: 'lectura',
    destino: 'cloudflare',
    requiere_aprobacion: false,
    descripcion: 'Lista todos los Workers desplegados en la cuenta de Cloudflare.',
    params: {}
  },
  leer_worker: {
    nombre: 'leer_worker',
    categoria: 'workers',
    tipo: 'lectura',
    destino: 'cloudflare',
    requiere_aprobacion: false,
    descripcion: 'Lee el bundle actual de un Worker en Cloudflare (código minificado tras el deploy).',
    params: { nombre: 'string' }
  },
  crear_worker: {
    nombre: 'crear_worker',
    categoria: 'workers',
    tipo: 'peligroso',
    destino: 'cloudflare',
    requiere_aprobacion: true,
    descripcion: 'Crea y despliega un nuevo Worker en Cloudflare. Requiere aprobación.',
    params: { nombre: 'string', codigo: 'string' }
  },
  actualizar_worker: {
    nombre: 'actualizar_worker',
    categoria: 'workers',
    tipo: 'peligroso',
    destino: 'cloudflare',
    requiere_aprobacion: true,
    descripcion: 'Actualiza el código de un Worker existente. Requiere aprobación.',
    params: { nombre: 'string', codigo: 'string' }
  },
  snapshot_worker: {
    nombre: 'snapshot_worker',
    categoria: 'workers',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Crea un snapshot (copia de seguridad) del Worker antes de modificarlo.',
    params: { nombre: 'string' }
  },
  revertir_worker: {
    nombre: 'revertir_worker',
    categoria: 'workers',
    tipo: 'peligroso',
    destino: 'cloudflare',
    requiere_aprobacion: true,
    descripcion: 'Revierte un Worker al último snapshot. Requiere aprobación.',
    params: { nombre: 'string' }
  },

  // ============================================================
  // MEMORIA Y CONTEXTO
  // ============================================================
  leer_historial_largo: {
    nombre: 'leer_historial_largo',
    categoria: 'memoria',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Lee un fragmento del historial largo de conversaciones.',
    params: { limite: 'integer (por defecto 50)', user_id: 'string (por defecto "comandante")', desde_orden: 'integer opcional' }
  },
  buscar_tema: {
    nombre: 'buscar_tema',
    categoria: 'memoria',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Busca en el índice semántico mensajes relacionados con un tema.',
    params: { q: 'string (tema a buscar)', limite: 'integer (por defecto 20)' }
  },
  leer_contexto: {
    nombre: 'leer_contexto',
    categoria: 'memoria',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Lee los resúmenes de contexto guardados.',
    params: { limite: 'integer (por defecto 5)' }
  },
  guardar_contexto: {
    nombre: 'guardar_contexto',
    categoria: 'memoria',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Guarda un nuevo resumen o análisis en la tabla de contexto.',
    params: { resumen: 'string', fuente: 'string', fases: 'array opcional de strings' }
  },
  indexar_historial: {
    nombre: 'indexar_historial',
    categoria: 'memoria',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Reindexa el historial largo para mejorar la búsqueda semántica. Tarda 10-20 min.',
    params: {}
  },
  construir_perfil_base: {
    nombre: 'construir_perfil_base',
    categoria: 'memoria',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Reconstruye el perfil base del Comandante desde todo el contexto disponible.',
    params: {}
  },
  leer_perfil_base: {
    nombre: 'leer_perfil_base',
    categoria: 'memoria',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Lee el perfil base actual del Comandante.',
    params: {}
  },

  // ============================================================
  // ESTRATEGIA
  // ============================================================
  crear_estrategia: {
    nombre: 'crear_estrategia',
    categoria: 'estrategia',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Registra una nueva estrategia activa en el sistema.',
    params: { nombre: 'string', tipo: 'string', contenido: 'string', prioridad: 'integer 1-10' }
  },
  listar_estrategias: {
    nombre: 'listar_estrategias',
    categoria: 'estrategia',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Lista todas las estrategias activas del sistema.',
    params: {}
  },
  eliminar_estrategia: {
    nombre: 'eliminar_estrategia',
    categoria: 'estrategia',
    tipo: 'peligroso',
    destino: 'interno',
    requiere_aprobacion: true,
    descripcion: 'Elimina una estrategia por ID. Requiere aprobación.',
    params: { id: 'integer' }
  },
  registrar_decision: {
    nombre: 'registrar_decision',
    categoria: 'estrategia',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Registra una decisión autónoma en la tabla de decisiones.',
    params: { tipo: 'string', contexto: 'string', decision: 'string', simulacion: 'string', resultado: 'string' }
  },
  leer_decisiones: {
    nombre: 'leer_decisiones',
    categoria: 'estrategia',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Lee las últimas decisiones autónomas registradas.',
    params: { limite: 'integer (por defecto 20)' }
  },
  simular_estrategia: {
    nombre: 'simular_estrategia',
    categoria: 'estrategia',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Simula una estrategia en el sandbox contra los 4 arquetipos de usuario.',
    params: { estrategia_id: 'integer' }
  },
  simular_precio: {
    nombre: 'simular_precio',
    categoria: 'estrategia',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Simula el impacto de un cambio de precio.',
    params: { propuesta: 'string' }
  },

  // ============================================================
  // SANDBOX
  // ============================================================
  ejecutar_etapa: {
    nombre: 'ejecutar_etapa',
    categoria: 'sandbox',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Ejecuta una etapa del currículum del sandbox.',
    params: { etapa_id: 'string', dia: 'integer (por defecto 1)' }
  },
  test_500: {
    nombre: 'test_500',
    categoria: 'sandbox',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Ejecuta la simulación de 500 usuarios durante un día virtual.',
    params: { dia: 'integer' }
  },
  ver_sandbox: {
    nombre: 'ver_sandbox',
    categoria: 'sandbox',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Lee el estado actual del sandbox.',
    params: {}
  },
  promover_leccion: {
    nombre: 'promover_leccion',
    categoria: 'sandbox',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Promueve una lección del sandbox a estrategia activa.',
    params: { leccion_id: 'integer' }
  },

  // ============================================================
  // CONTENIDO
  // ============================================================
  generar_contenido: {
    nombre: 'generar_contenido',
    categoria: 'contenido',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Genera contenido (lore, teaser, diálogo, provocación, anuncio).',
    params: { tipo: 'string (lore|teaser|dialogo|provocacion|anuncio)' }
  },
  generar_imagen: {
    nombre: 'generar_imagen',
    categoria: 'contenido',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Genera una imagen con IA (FLUX). Devuelve el ID y la URL.',
    params: { prompt: 'string' }
  },
  publicar: {
    nombre: 'publicar',
    categoria: 'contenido',
    tipo: 'peligroso',
    destino: 'externo',
    requiere_aprobacion: true,
    descripcion: 'Publica contenido en uno o varios canales (mastodon, bluesky, discord, reddit). Requiere aprobación.',
    params: { contenido: 'string', canales: 'string (coma-separados)', imagen_id: 'string opcional', tipo: 'string' }
  },
  encolar_publicacion: {
    nombre: 'encolar_publicacion',
    categoria: 'contenido',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Encola una publicación para el momento programado.',
    params: { contenido: 'string', canales: 'string', programada: 'integer timestamp' }
  },
  listar_publicaciones: {
    nombre: 'listar_publicaciones',
    categoria: 'contenido',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Lista las últimas publicaciones con su estado.',
    params: { limite: 'integer (por defecto 30)' }
  },

  // ============================================================
  // TAREAS
  // ============================================================
  encolar_tarea: {
    nombre: 'encolar_tarea',
    categoria: 'tareas',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Encola una tarea para que el cron la ejecute después.',
    params: { descripcion: 'string', prioridad: 'integer 1-10' }
  },
  listar_tareas: {
    nombre: 'listar_tareas',
    categoria: 'tareas',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Lista las tareas en cola y su estado.',
    params: {}
  },
  pulso_cron: {
    nombre: 'pulso_cron',
    categoria: 'tareas',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Fuerza una ejecución inmediata del cron autónomo.',
    params: {}
  },

  // ============================================================
  // OBSERVABILIDAD
  // ============================================================
  leer_uso_real: {
    nombre: 'leer_uso_real',
    categoria: 'observabilidad',
    tipo: 'lectura',
    destino: 'cloudflare',
    requiere_aprobacion: false,
    descripcion: 'Consulta el uso real de Cloudflare (Workers, D1, KV) en las últimas 24h.',
    params: {}
  },
  leer_capacidades: {
    nombre: 'leer_capacidades',
    categoria: 'observabilidad',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Devuelve las capacidades actuales del sistema.',
    params: {}
  },
  diagnosticar: {
    nombre: 'diagnosticar',
    categoria: 'observabilidad',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Ejecuta un diagnóstico completo: tablas D1, conteos, KV, módulos.',
    params: {}
  },
  errores_tardios: {
    nombre: 'errores_tardios',
    categoria: 'observabilidad',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Detecta errores tardíos: KV huérfano, presupuesto agotado, procesos atascados.',
    params: {}
  },
  leer_acciones: {
    nombre: 'leer_acciones',
    categoria: 'observabilidad',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Lee las últimas acciones registradas en el sistema.',
    params: { limite: 'integer (por defecto 50)' }
  },

  // ============================================================
  // NOTIFICACIONES
  // ============================================================
  listar_notificaciones: {
    nombre: 'listar_notificaciones',
    categoria: 'notificaciones',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Lista las notificaciones de la bandeja interna.',
    params: { limite: 'integer (por defecto 50)' }
  },
  crear_notificacion: {
    nombre: 'crear_notificacion',
    categoria: 'notificaciones',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Crea una notificación en la bandeja interna del Comandante.',
    params: { tipo: 'string', titulo: 'string', mensaje: 'string' }
  },
  notificar_telegram: {
    nombre: 'notificar_telegram',
    categoria: 'notificaciones',
    tipo: 'escritura',
    destino: 'externo',
    requiere_aprobacion: false,
    descripcion: 'Envía un mensaje al Telegram personal del Comandante. Solo para alertas urgentes.',
    params: { mensaje: 'string' }
  },

  // ============================================================
  // CONCIENCIA
  // ============================================================
  registrar_conciencia: {
    nombre: 'registrar_conciencia',
    categoria: 'conciencia',
    tipo: 'escritura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Registra una observación en tu conciencia. Persiste entre conversaciones.',
    params: { accion: 'string', detalle: 'string', pestana: 'string' }
  },
  leer_conciencia: {
    nombre: 'leer_conciencia',
    categoria: 'conciencia',
    tipo: 'lectura',
    destino: 'interno',
    requiere_aprobacion: false,
    descripcion: 'Lee la conciencia reciente del Comandante.',
    params: { user_id: 'string (por defecto "comandante")' }
  },

  // ============================================================
  // FRONTEND
  // ============================================================
  leer_frontend: {
    nombre: 'leer_frontend',
    categoria: 'frontend',
    tipo: 'lectura',
    destino: 'github',
    requiere_aprobacion: false,
    descripcion: 'Lee el código del frontend (index.html, app.js, styles.css) desde GitHub.',
    params: { archivo: 'string (index.html | app.js | styles.css)' }
  },
  modificar_frontend: {
    nombre: 'modificar_frontend',
    categoria: 'frontend',
    tipo: 'peligroso',
    destino: 'github',
    requiere_aprobacion: true,
    descripcion: 'Modifica un archivo del frontend (requiere aprobación).',
    params: { archivo: 'string', contenido: 'string', mensaje_commit: 'string' }
  }
};

// ============================================================
// CONSTRUIR EL PROMPT DE HERRAMIENTAS
// ============================================================
export function construirPromptHerramientas() {
  const porCategoria = {};
  for (const t of Object.values(TOOLS)) {
    if (!porCategoria[t.categoria]) porCategoria[t.categoria] = [];
    porCategoria[t.categoria].push(t);
  }

  let out = '\n\n=== HERRAMIENTAS DISPONIBLES ===\n';
  out += 'Tienes acceso a un catálogo de herramientas. Úsalas cuando lo necesites. No esperes que el Comandante te lo pida explícitamente: si para cumplir su orden o para actuar con precisión necesitas consultar, leer o ejecutar algo, HAZLO.\n\n';

  out += 'FORMATO DE INVOCACIÓN:\n';
  out += 'Cuando quieras usar una herramienta, escribe al final de tu respuesta un bloque EXACTAMENTE así:\n\n';
  out += '```tool\n{"tool": "nombre_herramienta", "params": {...}, "razon": "por qué la usas"}\n```\n\n';
  out += 'Puedes escribir varios bloques consecutivos si necesitas varias herramientas. El sistema los interceptará, ejecutará las herramientas y te devolverá los resultados para que continúes tu razonamiento.\n\n';

  out += 'REGLAS DE USO:\n';
  out += '- Herramientas de tipo **lectura**: úsalas libremente, sin pedir permiso.\n';
  out += '- Herramientas de tipo **escritura**: úsalas si el Comandante te lo pidió o si es claramente necesario. Explica brevemente qué hiciste después.\n';
  out += '- Herramientas de tipo **peligroso**: SIEMPRE pide aprobación antes de invocarlas. Explica qué vas a hacer, por qué, y espera un "sí" o "adelante" del Comandante.\n';
  out += '- NUNCA inventes un resultado de herramienta. Si no la has invocado, no digas que lo hiciste.\n';
  out += '- NUNCA inventes una herramienta que no esté en la lista. Si algo no existe, dilo.\n';
  out += '- Si una herramienta falla, reporta el error con precisión y propón alternativas.\n\n';

  for (const [cat, tools] of Object.entries(porCategoria)) {
    out += `### ${cat.toUpperCase()}\n`;
    for (const t of tools) {
      const marca = t.tipo === 'peligroso' ? ' ⚠️' : t.tipo === 'escritura' ? ' ✎' : '';
      out += `- **${t.nombre}**${marca}: ${t.descripcion}\n`;
      if (t.params && Object.keys(t.params).length) {
        const p = Object.entries(t.params).map(([k, v]) => `${k} (${v})`).join(', ');
        out += `  Params: ${p}\n`;
      }
    }
    out += '\n';
  }

  out += 'Leyenda: ⚠️ = requiere aprobación · ✎ = escritura (usar con explicación) · sin marca = lectura libre.\n';
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

export function listarNombresHerramientas() {
  return Object.keys(TOOLS);
}

export function categoriaDeHerramienta(nombre) {
  const t = TOOLS[nombre];
  return t ? t.categoria : null;
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
