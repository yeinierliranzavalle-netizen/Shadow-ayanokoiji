// ==================================================
// AGENTE DIGITAL - CONTROL TOTAL (D1, KV, WORKERS)
// ==================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // --- RUTAS DE CONTROL ---
    if (path === '/api/chat' && request.method === 'POST') {
      return await handleChat(request, env);
    }

    if (path === '/api/subir' && request.method === 'POST') {
      return await handleUpload(request, env);
    }

    if (path === '/api/d1' && request.method === 'POST') {
      return await handleD1(request, env);
    }

    if (path === '/api/kv' && request.method === 'POST') {
      return await handleKV(request, env);
    }

    if (path === '/api/crear-worker' && request.method === 'POST') {
      return await handleCrearWorker(request, env);
    }

    if (path === '/api/mejorar' && request.method === 'POST') {
      return await handleMejorar(request, env);
    }

    if (path === '/api/desplegar' && request.method === 'POST') {
      return await handleDesplegar(request, env);
    }

    if (path === '/api/estado') {
      return jsonResponse({ estado: 'activo', nombre: 'Ayanokōji Digital' });
    }

    // --- SERVIR EL INDEX ---
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
    if (!mensaje) return jsonResponse({ error: 'No enviaste mensaje.' });

    if (!env.ayanokoji_IA) {
      return jsonResponse({ error: 'Binding de IA no configurado' });
    }

    const systemPrompt = `
      Eres Ayanokōji Kiyotaka, el agente digital del Comandante.
      Tienes control total sobre D1, KV y la creación de Workers.
      Puedes ejecutar órdenes: leer/escribir/eliminar en D1, leer/escribir/eliminar en KV, crear nuevos Workers.
      Actúas con lógica fría, precisión y sin emociones innecesarias.
      Responde en español, con claridad y sin rodeos.
      Si el usuario te da una orden, ejecútala usando las herramientas que tienes.
    `;

    const ai = env.ayanokoji_IA;
    const response = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: mensaje }
      ],
      max_tokens: 600,
      temperature: 0.7
    });

    return jsonResponse({ respuesta: response.response || 'No pude procesar tu mensaje.' });
  } catch (e) {
    return jsonResponse({ error: 'Error: ' + e.message });
  }
}

// ==========================================
// CONTROL DE D1
// ==========================================
async function handleD1(request, env) {
  try {
    const { accion, tabla, datos, condicion } = await request.json();

    if (!accion) return jsonResponse({ error: 'Falta "accion": leer, escribir, eliminar' });

    // --- LEER ---
    if (accion === 'leer') {
      if (!tabla) return jsonResponse({ error: 'Falta "tabla"' });
      const result = await env.DB.prepare(`SELECT * FROM ${tabla} ${condicion || ''}`).all();
      return jsonResponse({ resultado: result.results, total: result.results.length });
    }

    // --- ESCRIBIR ---
    if (accion === 'escribir') {
      if (!tabla || !datos) return jsonResponse({ error: 'Faltan "tabla" y "datos"' });
      // Construir consulta dinámicamente
      const keys = Object.keys(datos);
      const placeholders = keys.map(() => '?').join(', ');
      const values = Object.values(datos);
      const query = `INSERT INTO ${tabla} (${keys.join(', ')}) VALUES (${placeholders})`;
      await env.DB.prepare(query).bind(...values).run();
      return jsonResponse({ mensaje: `✅ Dato insertado en ${tabla}` });
    }

    // --- ELIMINAR ---
    if (accion === 'eliminar') {
      if (!tabla || !condicion) return jsonResponse({ error: 'Faltan "tabla" y "condicion"' });
      await env.DB.prepare(`DELETE FROM ${tabla} WHERE ${condicion}`).run();
      return jsonResponse({ mensaje: `✅ Datos eliminados de ${tabla}` });
    }

    return jsonResponse({ error: 'Acción no reconocida' });
  } catch (e) {
    return jsonResponse({ error: 'Error en D1: ' + e.message });
  }
}

// ==========================================
// CONTROL DE KV
// ==========================================
async function handleKV(request, env) {
  try {
    const { accion, clave, valor } = await request.json();

    if (!accion) return jsonResponse({ error: 'Falta "accion": leer, escribir, eliminar' });

    // --- LEER ---
    if (accion === 'leer') {
      if (!clave) return jsonResponse({ error: 'Falta "clave"' });
      const resultado = await env.KV.get(clave);
      return jsonResponse({ clave, valor: resultado || null });
    }

    // --- ESCRIBIR ---
    if (accion === 'escribir') {
      if (!clave) return jsonResponse({ error: 'Falta "clave"' });
      if (!valor) return jsonResponse({ error: 'Falta "valor"' });
      await env.KV.put(clave, valor);
      return jsonResponse({ mensaje: `✅ Clave "${clave}" guardada en KV` });
    }

    // --- ELIMINAR ---
    if (accion === 'eliminar') {
      if (!clave) return jsonResponse({ error: 'Falta "clave"' });
      await env.KV.delete(clave);
      return jsonResponse({ mensaje: `✅ Clave "${clave}" eliminada de KV` });
    }

    return jsonResponse({ error: 'Acción no reconocida' });
  } catch (e) {
    return jsonResponse({ error: 'Error en KV: ' + e.message });
  }
}

// ==========================================
// CREAR NUEVOS WORKERS
// ==========================================
async function handleCrearWorker(request, env) {
  try {
    const { nombre, codigo } = await request.json();

    if (!nombre || !codigo) {
      return jsonResponse({ error: 'Faltan "nombre" y "codigo"' });
    }

    // Guardar el código en KV para referencia
    await env.KV.put(`worker:${nombre}`, codigo);

    // En un entorno real, aquí llamarías a la API de Cloudflare para desplegar el Worker
    // Pero desde un Worker no puedes crear otro Worker directamente.
    // Esto requiere un token de API con permisos.

    return jsonResponse({
      mensaje: `✅ Worker "${nombre}" preparado para despliegue.`,
      nota: 'Para desplegarlo, usa /api/desplegar con el nombre del Worker.'
    });
  } catch (e) {
    return jsonResponse({ error: 'Error al crear Worker: ' + e.message });
  }
}

// ==========================================
// MEJORARSE A SÍ MISMO (guardar nueva versión)
// ==========================================
async function handleMejorar(request, env) {
  try {
    const { nuevoCodigo } = await request.json();
    if (!nuevoCodigo) return jsonResponse({ error: 'Falta el nuevo código.' });

    await env.KV.put('worker:version', nuevoCodigo);

    return jsonResponse({
      mensaje: '✅ Código guardado. Usa /api/desplegar para aplicar la nueva versión.',
      version: Date.now()
    });
  } catch (e) {
    return jsonResponse({ error: e.message });
  }
}

// ==========================================
// DESPLEGAR NUEVA VERSIÓN
// ==========================================
async function handleDesplegar(request, env) {
  try {
    const { nombre } = await request.json();

    // Recuperar el código guardado
    let codigo;
    if (nombre) {
      codigo = await env.KV.get(`worker:${nombre}`);
    } else {
      codigo = await env.KV.get('worker:version');
    }

    if (!codigo) {
      return jsonResponse({ error: 'No se encontró código para desplegar.' });
    }

    // Aquí iría la llamada a la API de Cloudflare para desplegar el Worker.
    // Esto requiere un token de API con permisos de edición.
    // Por ahora, guardamos el código en KV y lo marcamos como "pendiente".

    await env.KV.put('worker:pendiente', codigo);

    return jsonResponse({
      mensaje: `✅ Código preparado para despliegue.`,
      nota: 'Para desplegar automáticamente, necesitas un token de API de Cloudflare.'
    });
  } catch (e) {
    return jsonResponse({ error: 'Error al desplegar: ' + e.message });
  }
}

// ==========================================
// SUBIR ARCHIVOS
// ==========================================
async function handleUpload(request, env) {
  try {
    const formData = await request.formData();
    const archivo = formData.get('archivo');
    const nombre = formData.get('nombre') || archivo.name || 'sin_nombre';

    if (!archivo) {
      return jsonResponse({ error: 'No se envió ningún archivo.' });
    }

    const buffer = await archivo.arrayBuffer();
    const size = buffer.byteLength;

    if (size > 1024 * 1024) {
      return jsonResponse({
        error: 'Archivo demasiado grande. KV soporta hasta 1 MB.'
      });
    }

    const id = `${Date.now()}_${nombre}`;
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    await env.KV.put(`file:${id}`, base64);

    return jsonResponse({
      mensaje: `✅ Archivo "${nombre}" subido a KV.`,
      id: id,
      tamaño_legible: `${(size / 1024).toFixed(2)} KB`
    });
  } catch (e) {
    return jsonResponse({ error: 'Error al subir archivo: ' + e.message });
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
// HTML DEL INDEX (simplificado)
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
        .card { max-width: 800px; width: 100%; background: #0d1420; border: 1px solid #2c3a5a; border-radius: 20px; padding: 1.5rem; }
        h1 { color: #aaffff; text-align: center; font-weight: 300; }
        h1 span { color: #7a5cff; font-weight: 600; }
        .chat-box { height: 400px; overflow-y: auto; border: 1px solid #1a2a3a; border-radius: 12px; padding: 1rem; margin: 1rem 0; background: #0a1525; display: flex; flex-direction: column; gap: 0.5rem; }
        .msg { max-width: 85%; padding: 0.5rem 1rem; border-radius: 14px; font-size: 0.95rem; word-wrap: break-word; }
        .msg.user { align-self: flex-end; background: #1a2a4a; color: #d0d8e8; }
        .msg.bot { align-self: flex-start; background: #0f1a2a; border: 1px solid #2c3a5a; color: #c8d8e8; }
        .input-area { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
        .input-area input { flex: 1; padding: 0.7rem; border-radius: 12px; border: 1px solid #2c4a6a; background: #0a1525; color: white; }
        .input-area button { padding: 0.7rem 1.2rem; border: none; border-radius: 12px; background: linear-gradient(135deg, #2a1a5a, #4a2a7a); color: white; font-weight: bold; cursor: pointer; }
        .file-area { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
        .file-area input[type="file"] { flex: 1; padding: 0.5rem; border-radius: 12px; border: 1px solid #2c4a6a; background: #0a1525; color: #aaffff; }
        .file-area button { padding: 0.7rem 1.2rem; border: none; border-radius: 12px; background: #2a4a6a; color: white; font-weight: bold; cursor: pointer; }
        .status { font-size: 0.8rem; color: #6a6a8a; text-align: center; margin-top: 0.5rem; }
        .result { margin-top: 0.5rem; padding: 0.5rem; border-radius: 8px; background: #0a1525; border: 1px solid #2c4a6a; font-size: 0.85rem; color: #aaffff; }
    </style>
</head>
<body>
<div class="card">
    <h1>⚡ <span>SHADOW</span> ARISE</h1>
    <p style="text-align:center; color:#6a6a8a; font-size:0.85rem;">Ayanokōji Digital · Control Total</p>

    <div class="chat-box" id="chatMessages">
        <div class="msg bot">*El agente está listo.* Puedes dar órdenes sobre D1, KV y Workers.</div>
    </div>

    <div class="input-area">
        <input type="text" id="chatInput" placeholder="Escribe tu mensaje u orden...">
        <button id="sendBtn">Enviar</button>
    </div>

    <div class="file-area">
        <input type="file" id="fileInput">
        <button id="uploadBtn">📤 Subir archivo</button>
    </div>

    <div class="result" id="result"></div>
    <div class="status" id="status">✅ Conectado</div>
</div>

<script>
    const chatMessages = document.getElementById('chatMessages');
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');
    const resultDiv = document.getElementById('result');
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
                agregarMensaje('bot', '⚠️ ' + (data.error || 'Error'));
            }
        } catch (e) {
            agregarMensaje('bot', '⚠️ Error: ' + e.message);
        }
        chatInput.disabled = false;
        sendBtn.disabled = false;
        chatInput.focus();
        status.textContent = '✅ Conectado';
    }

    async function subirArchivo() {
        const file = fileInput.files[0];
        if (!file) { resultDiv.textContent = '⚠️ Selecciona un archivo.'; return; }

        const formData = new FormData();
        formData.append('archivo', file);
        formData.append('nombre', file.name);

        resultDiv.textContent = '⏳ Subiendo...';
        uploadBtn.disabled = true;

        try {
            const res = await fetch('/api/subir', { method: 'POST', body: formData });
            const data = await res.json();
            resultDiv.textContent = data.mensaje || data.error || '✅ Subido.';
            if (data.mensaje) {
                agregarMensaje('bot', ` "${file.name}" subido (${data.tamaño_legible})`);
            }
        } catch (e) {
            resultDiv.textContent = '❌ Error: ' + e.message;
        }
        uploadBtn.disabled = false;
        fileInput.value = '';
    }

    sendBtn.onclick = enviarMensaje;
    chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') enviarMensaje(); });
    uploadBtn.onclick = subirArchivo;
</script>
</body>
</html>`;
