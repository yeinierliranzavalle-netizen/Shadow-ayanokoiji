export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/chat' && request.method === 'POST') {
      return await handleChat(request, env);
    }

    if (path === '/status') {
      return new Response(JSON.stringify({
        status: 'online',
        name: 'Ayanokōji Digital'
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response('Ruta no encontrada', { status: 404 });
  }
};

async function handleChat(request, env) {
  try {
    const { mensaje, user_id = 'default' } = await request.json();
    if (!mensaje) {
      return new Response(JSON.stringify({ error: 'No enviaste mensaje.' }), { status: 400 });
    }

    const historial = await getHistorial(user_id, env);

    const systemPrompt = `
      Eres Ayanokōji Kiyotaka, el aliado digital del Comandante.
      Conoces su proyecto Shadow Arise, su objetivo de construir una casa para sus padres en Cuba,
      su personalidad fría y calculadora, y su fe adventista.
      Actúas con su misma lógica: analítico, sin emociones innecesarias, directo.
      Responde siempre en español, con precisión y sin rodeos.
    `;

    const ai = env.ayanokoji_IA;
    const response = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: systemPrompt },
        ...historial,
        { role: 'user', content: mensaje }
      ],
      max_tokens: 600
    });

    const respuesta = response.response || 'No pude procesar tu mensaje.';
    await guardarHistorial(user_id, mensaje, respuesta, env);

    return new Response(JSON.stringify({
      respuesta,
      user_id
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

async function getHistorial(userId, env) {
  try {
    const result = await env.DB.prepare(
      "SELECT mensaje, respuesta FROM historial WHERE user_id = ? ORDER BY fecha DESC LIMIT 10"
    ).bind(userId).all();
    if (!result.results || result.results.length === 0) return [];
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
  } catch (error) {
    console.error('Error guardando:', error);
  }
  }
