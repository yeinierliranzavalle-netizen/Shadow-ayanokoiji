// ==================================================
// SHADOW ARISE - WORKER SIMPLE CON IA
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

    // --- CHAT ---
    if (path === '/chat' && request.method === 'POST') {
      return await handleChat(request, env);
    }

    // --- SUBIR CONTEXTO ---
    if (path === '/subir' && request.method === 'POST') {
      return await handleUpload(request, env);
    }

    // --- VERIFICAR CONTEXTO ---
    if (path === '/verificar' && request.method === 'GET') {
      return await handleVerificar(request, env);
    }

    // --- ESTADO ---
    if (path === '/status') {
      return new Response(JSON.stringify({
        status: 'online',
        name: 'Ayanokōji Digital',
        version: '4.0.0',
        timestamp: Date.now()
      }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    return new Response('Ruta no encontrada', { status: 404, headers: corsHeaders });
  }
};

// ==========================================
// CHAT (con IA y contexto desde KV)
// ==========================================
let contextoCache = null;

async function getContexto(env) {
  if (contextoCache) return contextoCache;
  try {
    const texto = await env.KV.get('contexto_completo');
    if (texto) {
      contextoCache = texto;
      console.log(`📖 Contexto cargado: ${texto.length} caracteres`);
      return texto;
    }
  } catch (e) {
    console.warn('⚠️ Error al leer KV:', e.message);
  }
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
    console.error('❌ Error en chat:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

// ==========================================
// SUBIR CONTEXTO
// ==========================================
async function handleUpload(request, env) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No se subió ningún archivo.'
      }), { status: 400 });
    }

    const texto = await file.text();
    const tamaño = texto.length;

    await env.KV.put('contexto_completo', texto);
    contextoCache = texto;

    console.log(`✅ Contexto guardado en KV: ${tamaño} caracteres`);

    return new Response(JSON.stringify({
      success: true,
      message: `✅ Contexto guardado. Tamaño: ${tamaño} caracteres.`,
      tamaño: tamaño,
      filename: file.name
    }));
  } catch (error) {
    console.error('❌ Error al subir:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error al procesar: ' + error.message
    }), { status: 500 });
  }
}

// ==========================================
// VERIFICAR CONTEXTO
// ==========================================
async function handleVerificar(request, env) {
  try {
    const texto = await env.KV.get('contexto_completo');
    if (texto) {
      return new Response(JSON.stringify({
        success: true,
        existe: true,
        tamaño: texto.length,
        mensaje: `✅ Contexto encontrado (${texto.length} caracteres)`
      }));
    } else {
      return new Response(JSON.stringify({
        success: true,
        existe: false,
        mensaje: '⚠️ No hay contexto guardado.'
      }));
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Error al verificar: ' + error.message
    }), { status: 500 });
  }
      }
