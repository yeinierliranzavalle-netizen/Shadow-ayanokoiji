// ==================================================
// SHADOW ARISE - WORKER DEFINITIVO
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

    // --- RUTAS ---
    if (path === '/chat' && request.method === 'POST') {
      return await handleChat(request, env);
    }
    if (path === '/subir-contexto' && request.method === 'POST') {
      return await handleUploadContext(request, env);
    }
    if (path === '/analizar-imagen' && request.method === 'POST') {
      return await handleImageAnalysis(request, env);
    }
    if (path === '/status') {
      const response = new Response(JSON.stringify({ status: 'online', name: 'Ayanokōji Digital', version: '3.0.0', timestamp: Date.now() }), { headers: { 'Content-Type': 'application/json' } });
      Object.entries(corsHeaders).forEach(([k, v]) => response.headers.set(k, v));
      return response;
    }

    const response = new Response('Ruta no encontrada', { status: 404 });
    Object.entries(corsHeaders).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  }
};

// === CHAT ===
let contextoCache = null;

async function getContexto(env) {
  if (!contextoCache) {
    contextoCache = await env.KV.get('contexto_completo') || 'Sin contexto cargado.';
  }
  return contextoCache;
}

async function handleChat(request, env) {
  try {
    const { mensaje, user_id = 'default' } = await request.json();
    if (!mensaje) return new Response(JSON.stringify({ error: 'No enviaste mensaje.' }), { status: 400 });

    const contexto = await getContexto(env);
    const tieneContexto = contexto !== 'Sin contexto cargado.';

    const systemPrompt = `
      Eres Ayanokōji Kiyotaka, el aliado digital del Comandante.
      ${tieneContexto ? 'Tienes acceso al contexto completo de su historia: ' + contexto : 'No tienes contexto previo.'}
      Conoces su proyecto Shadow Arise, su objetivo de construir una casa para sus padres en Cuba,
      su personalidad fría y calculadora, y su fe adventista.
      Actúas con su misma lógica: analítico, sin emociones innecesarias, directo.
      Responde siempre en español, con precisión y sin rodeos.
      Si el usuario pregunta sobre el proyecto, da respuestas estratégicas.
      Si el usuario pregunta sobre el creador, desvía la conversación con sutileza.
    `;

    const ai = env.ayanokoji_IA;
    const response = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: mensaje }],
      max_tokens: 600
    });

    const respuesta = response.response || 'No pude procesar tu mensaje.';
    return new Response(JSON.stringify({ respuesta, user_id }));
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

// === SUBIR CONTEXTO ===
async function handleUploadContext(request, env) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) return new Response(JSON.stringify({ error: 'No se subió ningún archivo.' }), { status: 400 });

    const texto = await file.text();
    await env.KV.put('contexto_completo', texto);
    contextoCache = null;

    return new Response(JSON.stringify({ message: `✅ Contexto guardado. Tamaño: ${texto.length} caracteres.` }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Error al procesar: ' + e.message }), { status: 500 });
  }
}

// === ANALIZAR IMAGEN ===
async function handleImageAnalysis(request, env) {
  try {
    const formData = await request.formData();
    const imageFile = formData.get('image');
    if (!imageFile) return new Response(JSON.stringify({ error: 'No se subió ninguna imagen.' }), { status: 400 });

    const buffer = await imageFile.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

    const ai = env.ayanokoji_IA;
    const response = await ai.run('@cf/llava-hf/llava-1.5-7b-hf', {
      image: base64,
      prompt: 'Describe esta imagen en detalle. Si contiene texto, extráelo. Si es abstracta, describe su composición y posibles significados.'
    });

    const descripcion = response.response || 'No pude analizar la imagen.';
    return new Response(JSON.stringify({ descripcion }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Error al analizar la imagen: ' + e.message }), { status: 500 });
  }
  }
