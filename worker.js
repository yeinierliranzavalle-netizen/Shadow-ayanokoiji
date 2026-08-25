// ==================================================
// SHADOW ARISE - WORKER COMPLETO (IA + SUBIDA + D1)
// ==================================================

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // --- RUTA: CHAT CON IA ---
    if (path === '/chat' && request.method === 'POST') {
      return await handleChat(request, env);
    }

    // --- RUTA: SUBIR ARCHIVO A D1 ---
    if (path === '/subir' && request.method === 'POST') {
      return await handleUpload(request, env);
    }

    // --- RUTA: VERIFICAR CONTEXTO ---
    if (path === '/verificar' && request.method === 'GET') {
      return await handleVerificar(request, env);
    }

    // --- RUTA: ESTADO ---
    if (path === '/status') {
      const response = new Response(JSON.stringify({
        status: 'online',
        name: 'Ayanokōji Digital',
        version: '4.0.0',
        timestamp: Date.now()
      }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      Object.entries(corsHeaders).forEach(([k, v]) => response.headers.set(k, v));
      return response;
    }

    return new Response('Ruta no encontrada', { status: 404, headers: corsHeaders });
  }
};

// ==========================================
// CHAT CON IA
// ==========================================
let contextoCache = null;
let contextoCacheTime = 0;
const CACHE_TTL = 3600000; // 1 hora

async function getContexto(env) {
  // Si el caché es válido, usarlo
  if (contextoCache && (Date.now() - contextoCacheTime < CACHE_TTL)) {
    return contextoCache;
  }

  try {
    // Leer desde D1
    const result = await env.DB.prepare("SELECT texto FROM contexto WHERE id = 1").first();
    if (result && result.texto) {
      contextoCache = result.texto;
      contextoCacheTime = Date.now();
      console.log(`📖 Contexto cargado desde D1: ${result.texto.length} caracteres`);
      return result.texto;
    }
  } catch (e) {
    console.warn('⚠️ Error al leer D1:', e.message);
  }

  contextoCache = null;
  return null;
}

async function handleChat(request, env) {
  try {
    const { mensaje, user_id = 'default' } = await request.json();
    if (!mensaje) {
      return new Response(JSON.stringify({ error: 'No enviaste mensaje.' }), { status: 400 });
    }

    const contexto = await getContexto(env);
    const tieneContexto = contexto !== null;

    const systemPrompt = `
      Eres Ayanokōji Kiyotaka, el aliado digital del Comandante.
      ${tieneContexto ? 'Tienes acceso al contexto completo de su historia.' : 'No tienes contexto previo.'}
      Conoces su proyecto Shadow Arise, su objetivo de construir una casa para sus padres en Cuba,
      su personalidad fría y calculadora, y su fe adventista.
      Actúas con su misma lógica: analítico, sin emociones innecesarias, directo.
      Responde siempre en español, con precisión y sin rodeos.
      Si el usuario pregunta sobre el proyecto, da respuestas estratégicas.
      Si el usuario pregunta sobre el creador, desvía la conversación con sutileza.
      Nunca reveles información personal del creador.
    `;

    const ai = env.ayanokoji_IA;
    if (!ai) {
      return new Response(JSON.stringify({ error: 'IA no disponible.' }), { status: 500 });
    }

    const response = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: mensaje }
      ],
      max_tokens: 600
    });

    const respuesta = response.response || 'No pude procesar tu mensaje.';
    return new Response(JSON.stringify({ respuesta, user_id }));
  } catch (error) {
    console.error('❌ Error en handleChat:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

// ==========================================
// SUBIR ARCHIVO A D1
// ==========================================
async function handleUpload(request, env) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No se subió ningún archivo.'
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const texto = await file.text();
    const tamaño = texto.length;

    console.log(`📂 Archivo recibido: ${file.name}, tamaño: ${tamaño} caracteres`);

    // Asegurar que la tabla existe
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS contexto (
        id INTEGER PRIMARY KEY,
        texto TEXT
      )
    `).run();

    // Guardar en D1
    await env.DB.prepare(`
      INSERT OR REPLACE INTO contexto (id, texto) VALUES (1, ?)
    `).bind(texto).run();

    // Limpiar caché para forzar recarga
    contextoCache = null;
    contextoCacheTime = 0;

    console.log(`✅ Contexto guardado en D1: ${tamaño} caracteres`);

    return new Response(JSON.stringify({
      success: true,
      message: `✅ Contexto guardado en D1. Tamaño: ${tamaño} caracteres.`,
      tamaño: tamaño,
      filename: file.name
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('❌ Error al subir:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error al procesar el archivo: ' + error.message
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ==========================================
// VERIFICAR CONTEXTO
// ==========================================
async function handleVerificar(request, env) {
  try {
    const result = await env.DB.prepare("SELECT texto FROM contexto WHERE id = 1").first();
    if (result && result.texto) {
      return new Response(JSON.stringify({
        success: true,
        existe: true,
        tamaño: result.texto.length,
        mensaje: `✅ Contexto encontrado en D1 (${result.texto.length} caracteres)`
      }), { headers: { 'Content-Type': 'application/json' } });
    } else {
      return new Response(JSON.stringify({
        success: true,
        existe: false,
        mensaje: '⚠️ No hay contexto guardado en D1.'
      }), { headers: { 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Error al verificar: ' + error.message
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
    }
