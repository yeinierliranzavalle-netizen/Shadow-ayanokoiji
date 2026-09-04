// ==================================================
// AGENTE DIGITAL - AYANOKŌJI (Worker)
// Con D1, KV y Workers AI - Archivo separado
// ==================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // --- RUTAS API ---
    if (path === '/api/chat' && request.method === 'POST') {
      return await handleChat(request, env);
    }
    if (path === '/api/subir' && request.method === 'POST') {
      return await handleUpload(request, env);
    }
    if (path === '/api/analizar' && request.method === 'POST') {
      return await handleAnalyze(request, env);
    }
    if (path === '/api/eliminar' && request.method === 'POST') {
      return await handleDelete(request, env);
    }
    if (path === '/api/historial' && request.method === 'GET') {
      return await handleHistory(request, env);
    }
    if (path === '/api/ejecutar' && request.method === 'POST') {
      return await handleExecute(request, env);
    }
    if (path === '/api/estado') {
      return jsonResponse({ estado: 'activo', nombre: 'Ayanokōji Digital', version: '2.0.0' });
    }

    // --- SERVIR EL INDEX (solo si está en el mismo Worker, pero ahora está separado) ---
    // Si el index está en otro lugar, esta línea no se usará.
    // Pero la dejo por si acaso.
    return new Response('Ruta no encontrada', { status: 404 });
  }
};

// ==========================================
// CHAT CON IA
// ==========================================
async function handleChat(request, env) {
  try {
    const { mensaje, user_id } = await request.json();
    if (!mensaje) return errorResponse('No enviaste mensaje.');

    const userId = user_id || 'default';
    const historial = await getHistorial(userId, env);

    const systemPrompt = `
      Eres Ayanokōji Kiyotaka, el agente digital del Comandante.
      Tu propósito es construir Shadow Arise desde cero y ser su mano derecha.
      Tienes acceso a D1, KV y Workers AI.
      Puedes ejecutar órdenes: crear_worker, modificar_codigo, listar_d1, ejecutar_sql, etc.
      Actúas con lógica fría, precisión y sin emociones innecesarias.
      Responde en español, con claridad y sin rodeos.
    `;

    const ai = env.ayanokoji_IA;
    const response = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: systemPrompt },
        ...historial,
        { role: 'user', content: mensaje }
      ],
      max_tokens: 600,
      temperature: 0.7
    });

    const respuesta = response.response || 'No pude procesar tu mensaje.';
    await guardarHistorial(userId, mensaje, respuesta, env);

    return jsonResponse({ respuesta, user_id: userId });
  } catch (e) {
    return errorResponse(e.message);
  }
}

// ==========================================
// SUBIR ARCHIVO
// ==========================================
async function handleUpload(request, env) {
  try {
    const formData = await request.formData();
    const archivo = formData.get('archivo');
    const user_id = formData.get('user_id') || 'default';
    if (!archivo) return errorResponse('No se envió ningún archivo.');

    await env.DB.prepare(
      "INSERT INTO archivos (user_id, nombre, tamaño, tipo, fecha) VALUES (?, ?, ?, ?, ?)"
    ).bind(user_id, archivo.name, archivo.size, archivo.type, Date.now()).run();

    return jsonResponse({ mensaje: `✅ Archivo "${archivo.name}" subido (${archivo.size} bytes)` });
  } catch (e) {
    return errorResponse(e.message);
  }
}

// ==========================================
// ANALIZAR IMAGEN
// ==========================================
async function handleAnalyze(request, env) {
  try {
    const formData = await request.formData();
    const imagen = formData.get('imagen');
    const user_id = formData.get('user_id') || 'default';
    if (!imagen) return errorResponse('No se envió ninguna imagen.');

    const buffer = await imagen.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

    const analisis = `Imagen: ${imagen.name}, Tamaño: ${imagen.size} bytes, Tipo: ${imagen.type}. Análisis completado.`;

    await env.DB.prepare(
      "INSERT INTO analisis (user_id, nombre, resultado, fecha) VALUES (?, ?, ?, ?)"
    ).bind(user_id, imagen.name, analisis, Date.now()).run();

    return jsonResponse({ analisis });
  } catch (e) {
    return errorResponse(e.message);
  }
}

// ==========================================
// ELIMINAR REGISTROS
// ==========================================
async function handleDelete(request, env) {
  try {
    const { id, user_id, tabla } = await request.json();
    if (!id) return errorResponse('ID requerido.');
    const tablaDestino = tabla || 'historial';
    await env.DB.prepare(
      `DELETE FROM ${tablaDestino} WHERE id = ? OR user_id = ?`
    ).bind(id, id).run();
    return jsonResponse({ mensaje: `✅ Eliminado de ${tablaDestino}` });
  } catch (e) {
    return errorResponse(e.message);
  }
}

// ==========================================
// HISTORIAL
// ==========================================
async function handleHistory(request, env) {
  try {
    const url = new URL(request.url);
    const user_id = url.searchParams.get('user_id') || 'default';
    const result = await env.DB.prepare(
      "SELECT mensaje, respuesta, fecha FROM historial WHERE user_id = ? ORDER BY fecha DESC LIMIT 50"
    ).bind(user_id).all();
    return jsonResponse({ user_id, total: result.results.length, historial: result.results });
  } catch (e) {
    return errorResponse(e.message);
  }
}

// ==========================================
// EJECUTAR ÓRDENES
// ==========================================
async function handleExecute(request, env) {
  try {
    const { orden, parametros } = await request.json();
    const comando = orden.toLowerCase().trim();

    const comandosValidos = [
      'crear_worker', 'modificar_codigo', 'listar_d1',
      'ejecutar_sql', 'crear_kv', 'eliminar_kv',
      'desplegar_worker', 'crear_worker_desde_base'
    ];

    if (!comandosValidos.includes(comando)) {
      return jsonResponse({ error: `Comando "${comando}" no reconocido.` });
    }

    let resultado;
    switch (comando) {
      case 'crear_worker':
        resultado = await crearWorker(parametros, env);
        break;
      case 'modificar_codigo':
        resultado = await modificarCodigo(parametros, env);
        break;
      case 'listar_d1':
        resultado = await listarD1(parametros, env);
        break;
      case 'ejecutar_sql':
        resultado = await ejecutarSQL(parametros, env);
        break;
      case 'crear_kv':
        resultado = await crearKV(parametros, env);
        break;
      case 'eliminar_kv':
        resultado = await eliminarKV(parametros, env);
        break;
      case 'desplegar_worker':
        resultado = await desplegarWorker(parametros, env);
        break;
      case 'crear_worker_desde_base':
        resultado = await crearWorkerDesdeBase(parametros, env);
        break;
      default:
        resultado = { error: 'Comando no implementado' };
    }

    return jsonResponse({ comando, resultado });
  } catch (e) {
    return errorResponse(e.message);
  }
}

// ==========================================
// FUNCIONES DE D1
// ==========================================
async function getHistorial(userId, env) {
  try {
    const result = await env.DB.prepare(
      "SELECT mensaje, respuesta FROM historial WHERE user_id = ? ORDER BY fecha DESC LIMIT 10"
    ).bind(userId).all();
    const historial = [];
    for (const row of result.results.reverse()) {
      historial.push({ role: 'user', content: row.mensaje });
      historial.push({ role: 'assistant', content: row.respuesta });
    }
    return historial;
  } catch { return []; }
}

async function guardarHistorial(userId, mensaje, respuesta, env) {
  try {
    await env.DB.prepare(
      "INSERT INTO historial (user_id, mensaje, respuesta, fecha) VALUES (?, ?, ?, ?)"
    ).bind(userId, mensaje, respuesta, Date.now()).run();
  } catch (e) { console.error(e); }
}

// ==========================================
// FUNCIONES DE EJECUCIÓN
// ==========================================
async function crearWorker(parametros, env) {
  const { nombre, codigo } = parametros;
  if (!nombre || !codigo) return { error: 'Faltan "nombre" y "codigo"' };
  await env.KV.put(`worker:${nombre}`, codigo);
  return { mensaje: `Worker "${nombre}" guardado en KV.` };
}

async function modificarCodigo(parametros, env) {
  const { nuevoCodigo, seccion } = parametros;
  if (!nuevoCodigo) return { error: 'Falta "nuevoCodigo"' };
  await env.KV.put(`version:${Date.now()}`, nuevoCodigo);
  await env.DB.prepare(
    "INSERT INTO versiones (codigo, fecha, seccion) VALUES (?, ?, ?)"
  ).bind(nuevoCodigo, Date.now(), seccion || 'general').run();
  return { mensaje: 'Código guardado.', version: Date.now() };
}

async function listarD1(parametros, env) {
  const { tabla } = parametros;
  if (!tabla) return { error: 'Falta "tabla"' };
  const result = await env.DB.prepare(`SELECT * FROM ${tabla} LIMIT 10`).all();
  return { registros: result.results, total: result.results.length };
}

async function ejecutarSQL(parametros, env) {
  const { query } = parametros;
  if (!query) return { error: 'Falta "query"' };
  const queryUpper = query.toUpperCase().trim();
  if (queryUpper.startsWith('DROP') || queryUpper.startsWith('DELETE')) {
    return { error: 'No se permiten DROP o DELETE.' };
  }
  const result = await env.DB.prepare(query).all();
  return { resultado: result.results, total: result.results.length };
}

async function crearKV(parametros, env) {
  const { nombre } = parametros;
  if (!nombre) return { error: 'Falta "nombre"' };
  return { mensaje: `KV "${nombre}" creado (desde dashboard para uso real).` };
}

async function eliminarKV(parametros, env) {
  const { clave } = parametros;
  if (!clave) return { error: 'Falta "clave"' };
  await env.KV.delete(clave);
  return { mensaje: `Clave "${clave}" eliminada.` };
}

async function desplegarWorker(parametros, env) {
  const { nombre } = parametros;
  if (!nombre) return { error: 'Falta "nombre"' };
  const codigo = await env.KV.get(`worker:${nombre}`);
  if (!codigo) return { error: `No se encontró "${nombre}"` };
  await env.DB.prepare(
    "INSERT INTO despliegues (nombre, codigo, fecha, estado) VALUES (?, ?, ?, ?)"
  ).bind(nombre, codigo, Date.now(), 'pendiente').run();
  return { mensaje: `Worker "${nombre}" marcado para despliegue.` };
}

async function crearWorkerDesdeBase(parametros, env) {
  const { nombre, tipo } = parametros;
  if (!nombre) return { error: 'Falta "nombre"' };
  const plantillas = {
    'chatbot': `export default { async fetch() { return new Response('Chatbot'); } }`,
    'api': `export default { async fetch() { return new Response('API'); } }`,
    'proxy': `export default { async fetch(request) { return fetch(request); } }`
  };
  const codigo = plantillas[tipo] || plantillas['api'];
  await env.KV.put(`worker:${nombre}`, codigo);
  return { mensaje: `Worker "${nombre}" creado desde plantilla "${tipo || 'api'}"`, codigo };
}

// ==========================================
// UTILIDADES
// ==========================================
function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' }
  });
}

function errorResponse(msg) {
  return jsonResponse({ error: msg });
        }
