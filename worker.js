// ==================================================
// WORKER DE PRUEBA - SOLO PARA VERIFICAR CONEXIÓN
// ==================================================

export default {
  async fetch(request, env) {
    // CORS para todas las respuestas
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

    // Ruta /status
    if (path === '/status') {
      const response = new Response(JSON.stringify({
        status: 'online',
        name: 'Worker de prueba',
        timestamp: Date.now()
      }), { headers: { 'Content-Type': 'application/json' } });
      Object.entries(corsHeaders).forEach(([k, v]) => response.headers.set(k, v));
      return response;
    }

    // Ruta /chat
    if (path === '/chat' && request.method === 'POST') {
      // Leer el cuerpo de la solicitud (aunque no lo usemos)
      await request.json().catch(() => {});
      const response = new Response(JSON.stringify({
        respuesta: '🧪 Hola, soy el Worker de prueba. Si ves esto, la conexión funciona correctamente.',
        test: true
      }), { headers: { 'Content-Type': 'application/json' } });
      Object.entries(corsHeaders).forEach(([k, v]) => response.headers.set(k, v));
      return response;
    }

    // Cualquier otra ruta
    const response = new Response('Ruta no encontrada', { status: 404 });
    Object.entries(corsHeaders).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  }
};
