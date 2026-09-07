// ==================================================
// AGENTE DIGITAL - CONTROL TOTAL (D1, KV, WORKERS)
// ==================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

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
      return jsonResponse({ estado: 'activo', nombre: 'Ayanokoji Digital' });
    }

    if (path === '/' || path === '/index.html') {
      return new Response(HTML, {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    return new Response('Ruta no encontrada', { status: 404 });
  }
};

async function handleChat(request, env) {
  try {
    const { mensaje } = await request.json();
    if (!mensaje) return jsonResponse({ error: 'No enviaste mensaje.' });

    if (!env.ayanokoji_IA) {
      return jsonResponse({ error: 'Binding de IA no configurado' });
    }

    const systemPrompt = 'Eres Ayanokoji Kiyotaka, el agente digital del Comandante. Tienes control total sobre D1, KV y la creacion de Workers. Puedes ejecutar ordenes: leer/escribir/eliminar en D1, leer/escribir/eliminar en KV, crear nuevos Workers. Actuas con logica fria, precision y sin emociones innecesarias. Responde en espanol, con claridad y sin rodeos. Si el usuario te da una orden, ejecutala usando las herramientas que tienes.';

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

async function handleD1(request, env) {
  try {
    const { accion, tabla, datos, condicion } = await request.json();

    if (!accion) return jsonResponse({ error: 'Falta accion: leer, escribir, eliminar' });

    if (accion === 'leer') {
      if (!tabla) return jsonResponse({ error: 'Falta tabla' });
      const result = await env.DB.prepare('SELECT * FROM ' + tabla + ' ' + (condicion || '')).all();
      return jsonResponse({ resultado: result.results, total: result.results.length });
    }

    if (accion === 'escribir') {
      if (!tabla || !datos) return jsonResponse({ error: 'Faltan tabla y datos' });
      const keys = Object.keys(datos);
      const placeholders = keys.map(function() { return '?'; }).join(', ');
      const values = Object.values(datos);
      const query = 'INSERT INTO ' + tabla + ' (' + keys.join(', ') + ') VALUES (' + placeholders + ')';
      await env.DB.prepare(query).bind(values).run();
      return jsonResponse({ mensaje: 'Dato insertado en ' + tabla });
    }

    if (accion === 'eliminar') {
      if (!tabla || !condicion) return jsonResponse({ error: 'Faltan tabla y condicion' });
      await env.DB.prepare('DELETE FROM ' + tabla + ' WHERE ' + condicion).run();
      return jsonResponse({ mensaje: 'Datos eliminados de ' + tabla });
    }

    return jsonResponse({ error: 'Accion no reconocida' });
  } catch (e) {
    return jsonResponse({ error: 'Error en D1: ' + e.message });
  }
}

async function handleKV(request, env) {
  try {
    const { accion, clave, valor } = await request.json();

    if (!accion) return jsonResponse({ error: 'Falta accion: leer, escribir, eliminar' });

    if (accion === 'leer') {
      if (!clave) return jsonResponse({ error: 'Falta clave' });
      const resultado = await env.KV.get(clave);
      return jsonResponse({ clave: clave, valor: resultado || null });
    }

    if (accion === 'escribir') {
      if (!clave) return jsonResponse({ error: 'Falta clave' });
      if (!valor) return jsonResponse({ error: 'Falta valor' });
      await env.KV.put(clave, valor);
      return jsonResponse({ mensaje: 'Clave ' + clave + ' guardada en KV' });
    }

    if (accion === 'eliminar') {
      if (!clave) return jsonResponse({ error: 'Falta clave' });
      await env.KV.delete(clave);
      return jsonResponse({ mensaje: 'Clave ' + clave + ' eliminada de KV' });
    }

    return jsonResponse({ error: 'Accion no reconocida' });
  } catch (e) {
    return jsonResponse({ error: 'Error en KV: ' + e.message });
  }
}

async function handleCrearWorker(request, env) {
  try {
    const { nombre, codigo } = await request.json();

    if (!nombre || !codigo) {
      return jsonResponse({ error: 'Faltan nombre y codigo' });
    }

    await env.KV.put('worker:' + nombre, codigo);

    return jsonResponse({
      mensaje: 'Worker ' + nombre + ' preparado para despliegue.',
      nota: 'Para desplegarlo, usa /api/desplegar con el nombre del Worker.'
    });
  } catch (e) {
    return jsonResponse({ error: 'Error al crear Worker: ' + e.message });
  }
}

async function handleMejorar(request, env) {
  try {
    const { nuevoCodigo } = await request.json();
    if (!nuevoCodigo) return jsonResponse({ error: 'Falta el nuevo codigo.' });

    await env.KV.put('worker:version', nuevoCodigo);

    return jsonResponse({
      mensaje: 'Codigo guardado. Usa /api/desplegar para aplicar la nueva version.',
      version: Date.now()
    });
  } catch (e) {
    return jsonResponse({ error: e.message });
  }
}

async function handleDesplegar(request, env) {
  try {
    const { nombre } = await request.json();

    let codigo;
    if (nombre) {
      codigo = await env.KV.get('worker:' + nombre);
    } else {
      codigo = await env.KV.get('worker:version');
    }

    if (!codigo) {
      return jsonResponse({ error: 'No se encontro codigo para desplegar.' });
    }

    await env.KV.put('worker:pendiente', codigo);

    return jsonResponse({
      mensaje: 'Codigo preparado para despliegue.',
      nota: 'Para desplegar automaticamente, necesitas un token de API de Cloudflare.'
    });
  } catch (e) {
    return jsonResponse({ error: 'Error al desplegar: ' + e.message });
  }
}

async function handleUpload(request, env) {
  try {
    const formData = await request.formData();
    const archivo = formData.get('archivo');
    const nombre = formData.get('nombre') || archivo.name || 'sin_nombre';

    if (!archivo) {
      return jsonResponse({ error: 'No se envio ningun archivo.' });
    }

    const buffer = await archivo.arrayBuffer();
    const size = buffer.byteLength;

    if (size > 1024 * 1024) {
      return jsonResponse({
        error: 'Archivo demasiado grande. KV soporta hasta 1 MB.'
      });
    }

    const id = '' + Date.now() + '_' + nombre;
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    await env.KV.put('file:' + id, base64);

    return jsonResponse({
      mensaje: 'Archivo ' + nombre + ' subido a KV.',
      id: id,
      tamano_legibile: (size / 1024).toFixed(2) + ' KB'
    });
  } catch (e) {
    return jsonResponse({ error: 'Error al subir archivo: ' + e.message });
  }
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// ==========================================
// HTML DEL INDEX (sin template strings)
// ==========================================
const HTML = '<!DOCTYPE html>\n<html lang="es">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>Ayanokoji Digital</title>\n    <style>\n        * { margin: 0; padding: 0; box-sizing: border-box; font-family: system-ui, sans-serif; }\n        body { background: #0a0a14; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 1rem; }\n        .card { max-width: 800px; width: 100%; background: #0d1420; border: 1px solid #2c3a5a; border-radius: 20px; padding: 1.5rem; }\n        h1 { color: #aaffff; text-align: center; font-weight: 300; }\n        h1 span { color: #7a5cff; font-weight: 600; }\n        .chat-box { height: 400px; overflow-y: auto; border: 1px solid #1a2a3a; border-radius: 12px; padding: 1rem; margin: 1rem 0; background: #0a1525; display: flex; flex-direction: column; gap: 0.5rem; }\n        .msg { max-width: 85%; padding: 0.5rem 1rem; border-radius: 14px; font-size: 0.95rem; word-wrap: break-word; }\n        .msg.user { align-self: flex-end; background: #1a2a4a; color: #d0d8e8; }\n        .msg.bot { align-self: flex-start; background: #0f1a2a; border: 1px solid #2c3a5a; color: #c8d8e8; }\n        .input-area { display: flex; gap: 0.5rem; margin-top: 0.5rem; }\n        .input-area input { flex: 1; padding: 0.7rem; border-radius: 12px; border: 1px solid #2c4a6a; background: #0a1525; color: white; }\n        .input-area button { padding: 0.7rem 1.2rem; border: none; border-radius: 12px; background: linear-gradient(135deg, #2a1a5a, #4a2a7a); color: white; font-weight: bold; cursor: pointer; }\n        .file-area { display: flex; gap: 0.5rem; margin-top: 0.5rem; }\n        .file-area input[type="file"] { flex: 1; padding: 0.5rem; border-radius: 12px; border: 1px solid #2c4a6a; background: #0a1525; color: #aaffff; }\n        .file-area button { padding: 0.7rem 1.2rem; border: none; border-radius: 12px; background: #2a4a6a; color: white; font-weight: bold; cursor: pointer; }\n        .status { font-size: 0.8rem; color: #6a6a8a; text-align: center; margin-top: 0.5rem; }\n        .result { margin-top: 0.5rem; padding: 0.5rem; border-radius: 8px; background: #0a1525; border: 1px solid #2c4a6a; font-size: 0.85rem; color: #aaffff; }\n    </style>\n</head>\n<body>\n<div class="card">\n    <h1>⚡ <span>SHADOW</span> ARISE</h1>\n    <p style="text-align:center; color:#6a6a8a; font-size:0.85rem;">Ayanokoji Digital · Control Total</p>\n    <div class="chat-box" id="chatMessages">\n        <div class="msg bot">El agente esta listo. Puedes dar ordenes sobre D1, KV y Workers.</div>\n    </div>\n    <div class="input-area">\n        <input type="text" id="chatInput" placeholder="Escribe tu mensaje u orden...">\n        <button id="sendBtn">Enviar</button>\n    </div>\n    <div class="file-area">\n        <input type="file" id="fileInput">\n        <button id="uploadBtn">Subir archivo</button>\n    </div>\n    <div class="result" id="result"></div>\n    <div class="status" id="status">Conectado</div>\n</div>\n<script>\n    var chatMessages = document.getElementById(\'chatMessages\');\n    var chatInput = document.getElementById(\'chatInput\');\n    var sendBtn = document.getElementById(\'sendBtn\');\n    var fileInput = document.getElementById(\'fileInput\');\n    var uploadBtn = document.getElementById(\'uploadBtn\');\n    var resultDiv = document.getElementById(\'result\');\n    var status = document.getElementById(\'status\');\n\n    function agregarMensaje(tipo, texto) {\n        var div = document.createElement(\'div\');\n        div.className = \'msg \' + tipo;\n        div.textContent = texto;\n        chatMessages.appendChild(div);\n        chatMessages.scrollTop = chatMessages.scrollHeight;\n    }\n\n    async function enviarMensaje() {\n        var texto = chatInput.value.trim();\n        if (!texto) return;\n        agregarMensaje(\'user\', texto);\n        chatInput.value = \'\';\n        chatInput.disabled = true;\n        sendBtn.disabled = true;\n        status.textContent = \'Procesando...\';\n        try {\n            var res = await fetch(\'/api/chat\', {\n                method: \'POST\',\n                headers: { \'Content-Type\': \'application/json\' },\n                body: JSON.stringify({ mensaje: texto })\n            });\n            var data = await res.json();\n            if (data.respuesta) {\n                agregarMensaje(\'bot\', data.respuesta);\n            } else {\n                agregarMensaje(\'bot\', \'Error: \' + (data.error || \'Error desconocido\'));\n            }\n        } catch (e) {\n            agregarMensaje(\'bot\', \'Error: \' + e.message);\n        }\n        chatInput.disabled = false;\n        sendBtn.disabled = false;\n        chatInput.focus();\n        status.textContent = \'Conectado\';\n    }\n\n    async function subirArchivo() {\n        var file = fileInput.files[0];\n        if (!file) { resultDiv.textContent = \'Selecciona un archivo.\'; return; }\n        var formData = new FormData();\n        formData.append(\'archivo\', file);\n        formData.append(\'nombre\', file.name);\n        resultDiv.textContent = \'Subiendo...\';\n        uploadBtn.disabled = true;\n        try {\n            var res = await fetch(\'/api/subir\', { method: \'POST\', body: formData });\n            var data = await res.json();\n            resultDiv.textContent = data.mensaje || data.error || \'Subido.\';\n            if (data.mensaje) {\n                agregarMensaje(\'bot\', file.name + \' subido (\' + data.tamano_legibile + \')\');\n            }\n        } catch (e) {\n            resultDiv.textContent = \'Error: \' + e.message;\n        }\n        uploadBtn.disabled = false;\n        fileInput.value = \'\';\n    }\n\n    sendBtn.onclick = enviarMensaje;\n    chatInput.addEventListener(\'keydown\', function(e) { if (e.key === \'Enter\') enviarMensaje(); });\n    uploadBtn.onclick = subirArchivo;\n</script>\n</body>\n</html>';
