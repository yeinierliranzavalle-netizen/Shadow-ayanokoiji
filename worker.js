// ==================================================
// WORKER MÍNIMO - SOLO CHAT (para pruebas)
// ==================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // --- Ruta de chat (con respuesta fija) ---
    if (path === '/chat' && request.method === 'POST') {
      try {
        const { mensaje } = await request.json();
        return new Response(JSON.stringify({
          respuesta: `Recibí tu mensaje: "${mensaje}". El Worker está vivo.`
        }), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({
          error: 'Error al procesar el mensaje: ' + e.message
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // --- Ruta de estado ---
    if (path === '/estado') {
      return new Response(JSON.stringify({
        estado: 'activo',
        mensaje: 'Worker funcionando correctamente'
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response('Ruta no encontrada', { status: 404 });
  }
};
