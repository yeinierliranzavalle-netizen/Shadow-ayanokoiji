// ==================================================
// AGENTE DIGITAL - AYANOKŌJI (TODO EN UNO)
// Sirve el index + Chat con IA + Base para mejora futura
// ==================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // --- RUTAS API ---
    if (path === '/api/chat' && request.method === 'POST') {
      return await handleChat(request, env);
    }

    if (path === '/api/estado') {
      return jsonResponse({ estado: 'activo', nombre: 'Ayanokōji Digital' });
    }

    // --- ORDEN PARA MEJORARSE A SÍ MISMO (FUTURO) ---
    if (path === '/api/mejorar' && request.method === 'POST') {
      return await handleMejorar(request, env);
    }

    // --- SERVIR EL INDEX EN LA RAÍZ ---
    if (path === '/' || path === '/index.html') {
      return new Response(HTML, {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    return new Response('Ruta no encontrada', { status: 404 });
  }
};

// ==========================================
// CHAT CON IA
// ==========================================
async function handleChat(request, env) {
  try {
    const { mensaje } = await request.json();

    if (!mensaje) {
      return jsonResponse({ error: 'No enviaste mensaje.' });
    }

    // --- Verificar que el binding de IA existe ---
    if (!env.ayanokoji_IA) {
      return jsonResponse({ error: 'Binding de IA no configurado' });
    }

    const systemPrompt = `
      Eres Ayanokōji Kiyotaka, el agente digital del Comandante.
      Tu propósito es construir Shadow Arise desde cero y ser su mano derecha.
      Actúas con lógica fría, precisión y sin emociones innecesarias.
      Responde en español, con claridad y sin rodeos.
      Si el usuario te da una orden, indícale cómo ejecutarla o ejecútala si es posible.
    `;

    // --- Llamar a la IA ---
    const ai = env.ayanokoji_IA;
    const response = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: mensaje }
      ],
      max_tokens: 600,
      temperature: 0.7
    });

    const respuesta = response.response || 'No pude procesar tu mensaje.';

    return jsonResponse({ respuesta });
  } catch (e) {
    console.error('Error en chat:', e);
    return jsonResponse({ error: 'Error interno: ' + e.message });
  }
}

// ==========================================
// ORDEN PARA MEJORARSE A SÍ MISMO (FUTURO)
// ==========================================
async function handleMejorar(request, env) {
  try {
    const { nuevoCodigo } = await request.json();

    if (!nuevoCodigo) {
      return jsonResponse({ error: 'Falta el nuevo código.' });
    }

    // Guardar la nueva versión en KV (para futuros despliegues)
    await env.KV.put('worker:version', nuevoCodigo);

    return jsonResponse({
      mensaje: 'Código guardado. La nueva versión estará disponible en el próximo despliegue.',
      version: Date.now()
    });
  } catch (e) {
    return jsonResponse({ error: e.message });
  }
}

// ==========================================
// UTILIDADES
// ==========================================
function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// ==========================================
// HTML DEL INDEX (INTEGRADO)
// ==========================================
const HTML = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ayanokōji Digital</title>
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
    <p style="text-align:center; color:#6a6a8a; font-size:0.85rem;">Ayanokōji Digital</p>
    <div class="chat-box" id="chatMessages">
        <div class="msg bot">*El agente está listo.* ¿Qué necesitas construir hoy?</div>
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
    const status = document.getElementById('status');

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
        status.textContent = '⏳ Procesando...';

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mensaje: texto })
            });
            const data = await res.json();
            if (data.respuesta) {
                agregarMensaje('bot', data.respuesta);
            } else {
                agregarMensaje('bot', '⚠️ ' + (data.error || 'Error desconocido'));
            }
        } catch (e) {
            agregarMensaje('bot', '⚠️ Error: ' + e.message);
        }
        chatInput.disabled = false;
        sendBtn.disabled = false;
        chatInput.focus();
        status.textContent = '✅ Conectado';
    }

    sendBtn.onclick = enviarMensaje;
    chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') enviarMensaje(); });
</script>
</body>
</html>`;
