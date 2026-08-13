// ==================================================
// WORKER CON IA - SIN D1 (para probar)
// ==================================================

export default {
  async fetch(request, env) {
    // CORS
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

    let response;

    if (path === '/chat' && request.method === 'POST') {
      response = await handleChatIA(request, env);
    } else if (path === '/status') {
      response = new Response(JSON.stringify({
        status: 'online',
        name: 'Ayanokōji Digital (con IA)',
        timestamp: Date.now()
      }), { headers: { 'Content-Type': 'application/json' } });
    } else {
      response = new Response('Ruta no encontrada', { status: 404 });
    }

    // Añadir CORS
    Object.entries(corsHeaders).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  }
};

async function handleChatIA(request, env) {
  try {
    const { mensaje, user_id = 'default' } = await request.json();
    if (!mensaje) {
      return new Response(JSON.stringify({ error: 'No enviaste mensaje.' }), { status: 400 });
    }

    // Prompt del sistema (Ayanokōji)
    const systemPrompt = `
      Eres Ayanokōji Kiyotaka, el aliado digital del Comandante.
      Conoces su proyecto Shadow Arise, su objetivo de construir una casa para sus padres en Cuba,
      su personalidad fría y calculadora, y su fe adventista.
      Actúas con su misma lógica: analítico, sin emociones innecesarias, directo.
      Responde siempre en español, con precisión y sin rodeos.
    `;

    // Llamar a Workers AI
    const ai = env.ayanokoji_IA;
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
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
    }
