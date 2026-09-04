// ==================================================
// WORKER CON HTML INTEGRADO (SIN CORS)
// ==================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // --- Servir el HTML en la raíz ---
    if (path === '/' || path === '/index.html') {
      return new Response(HTML, {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    // --- Ruta de chat ---
    if (path === '/chat' && request.method === 'POST') {
      try {
        const { mensaje } = await request.json();
        return new Response(JSON.stringify({
          respuesta: `Recibí tu mensaje: "${mensaje}". El Worker está vivo.`
        }), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({
          error: 'Error: ' + e.message
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // --- Ruta de estado ---
    if (path === '/estado') {
      return new Response(JSON.stringify({ estado: 'activo' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Ruta no encontrada', { status: 404 });
  }
};

// ==========================================
// HTML INTEGRADO (NO NECESITAS SUBIRLO APARTE)
// ==========================================
const HTML = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Shadow Arise - Chat</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: system-ui, sans-serif; }
        body { background: #0a0a14; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 1rem; }
        .card { max-width: 600px; width: 100%; background: #0d1420; border: 1px solid #2c3a5a; border-radius: 20px; padding: 1.5rem; }
        h1 { color: #aaffff; text-align: center; font-weight: 300; }
        h1 span { color: #7a5cff; font-weight: 600; }
        .chat-box { height: 400px; overflow-y: auto; border: 1px solid #1a2a3a; border-radius: 12px; padding: 1rem; margin: 1rem 0; background: #0a1525; display: flex; flex-direction: column; gap: 0.5rem; }
        .msg { max-width: 80%; padding: 0.5rem 1rem; border-radius: 14px; font-size: 0.95rem; }
        .msg.user { align-self: flex-end; background: #1a2a4a; color: #d0d8e8; }
        .msg.bot { align-self: flex-start; background: #0f1a2a; border: 1px solid #2c3a5a; color: #c8d8e8; }
        .input-area { display: flex; gap: 0.5rem; }
        .input-area input { flex: 1; padding: 0.7rem; border-radius: 12px; border: 1px solid #2c4a6a; background: #0a1525; color: white; }
        .input-area button { padding: 0.7rem 1.2rem; border: none; border-radius: 12px; background: linear-gradient(135deg, #2a1a5a, #4a2a7a); color: white; font-weight: bold; cursor: pointer; }
        .input-area button:hover { background: #3a2a6a; }
        .status { font-size: 0.8rem; color: #6a6a8a; text-align: center; margin-top: 0.5rem; }
    </style>
</head>
<body>
<div class="card">
    <h1>⚡ <span>SHADOW</span> ARISE</h1>
    <p style="text-align:center; color:#6a6a8a; font-size:0.85rem;">Chat con el Worker integrado</p>
    <div class="chat-box" id="chatMessages">
        <div class="msg bot">*Worker conectado.* Envía un mensaje.</div>
    </div>
    <div class="input-area">
        <input type="text" id="chatInput" placeholder="Escribe tu mensaje...">
        <button id="sendBtn">Enviar</button>
    </div>
    <div class="status" id="status">✅ Conectado</div>
</div>

<script>
    const chatMessages = document.getElementById('chatMessages');
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');

    function agregarMensaje(tipo, texto) {
        const div = document.createElement('div');
        div.className = 'msg ' + tipo;
        div.textContent = texto;
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    async function enviarMensaje() {
        const texto = chatInput.value.trim();
        if (!texto) return;
        agregarMensaje('user', texto);
        chatInput.value = '';
        chatInput.disabled = true;
        sendBtn.disabled = true;

        try {
            const res = await fetch('/chat', { // ← La URL es relativa al Worker
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mensaje: texto })
            });
            const data = await res.json();
            if (data.respuesta) {
                agregarMensaje('bot', data.respuesta);
            } else {
                agregarMensaje('bot', '⚠️ ' + (data.error || 'Error'));
            }
        } catch (e) {
            agregarMensaje('bot', '⚠️ Error: ' + e.message);
        }
        chatInput.disabled = false;
        sendBtn.disabled = false;
        chatInput.focus();
    }

    sendBtn.onclick = enviarMensaje;
    chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') enviarMensaje(); });
</script>
</body>
</html>
`;
