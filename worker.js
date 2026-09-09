// ==================================================
// SHADOW ARISE - AGENTE DIGITAL (MINIMIZADO)
// ==================================================
const LIMITE_KV = 950 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/' || path === '/index.html') {
      return new Response(HTML, { headers: { 'Content-Type': 'text/html' } });
    }
    if (path === '/api/chat' && request.method === 'POST') return await handleChat(request, env);
    if (path === '/api/subir' && request.method === 'POST') return await handleUpload(request, env);
    if (path === '/api/resumir' && request.method === 'POST') return await handleResumir(request, env);
    if (path === '/api/d1' && request.method === 'POST') return await handleD1(request, env);
    if (path === '/api/kv' && request.method === 'POST') return await handleKV(request, env);
    if (path === '/api/crear-worker' && request.method === 'POST') return await handleCrearWorker(request, env);
    if (path === '/api/mejorar' && request.method === 'POST') return await handleMejorar(request, env);
    if (path === '/api/desplegar' && request.method === 'POST') return await handleDesplegar(request, env);
    if (path === '/api/estado') return jsonResponse({ estado: 'activo', nombre: 'Ayanokōji Digital' });
    return new Response('Ruta no encontrada', { status: 404 });
  }
};

async function handleChat(request, env) {
  try {
    const { mensaje } = await request.json();
    if (!mensaje) return jsonResponse({ error: 'No enviaste mensaje.' });
    if (!env.ayanokoji_IA) return jsonResponse({ error: 'Binding de IA no configurado' });
    const ai = env.ayanokoji_IA;
    const response = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [{ role: 'system', content: 'Eres Ayanokōji Kiyotaka, agente digital del Comandante. Responde en español, con precisión y sin emociones.' }, { role: 'user', content: mensaje }],
      max_tokens: 800, temperature: 0.6
    });
    return jsonResponse({ respuesta: response.response || 'No pude procesar tu mensaje.' });
  } catch (e) {
    return jsonResponse({ error: 'Error en chat: ' + e.message });
  }
}

async function handleUpload(request, env) {
  try {
    const formData = await request.formData();
    const archivo = formData.get('archivo');
    const nombre = formData.get('nombre') || archivo.name || 'sin_nombre';
    const destino = formData.get('destino') || 'agente';
    if (!archivo) return jsonResponse({ error: 'No se envió ningún archivo.' });
    const buffer = await archivo.arrayBuffer();
    const size = buffer.byteLength;
    const kv = getKV(env, destino);
    if (!kv) return jsonResponse({ error: 'Destino inválido: ' + destino });
    const idBase = Date.now() + '_' + nombre.replace(/[^a-zA-Z0-9._-]/g, '_');
    const bytes = new Uint8Array(buffer);
    const chunks = [];
    for (let i = 0; i < bytes.length; i += LIMITE_KV) chunks.push(bytes.slice(i, i + LIMITE_KV));
    for (let i = 0; i < chunks.length; i++) await kv.put('file:' + idBase + ':' + i, bufferToBase64(chunks[i]));
    const d1 = getD1(env, destino);
    await d1.prepare('INSERT INTO archivos (id, nombre, tamaño, chunks, destino, fecha) VALUES (?, ?, ?, ?, ?, ?)').bind(idBase, nombre, size, chunks.length, destino, Date.now()).run();
    return jsonResponse({ mensaje: 'Archivo subido a ' + destino + ' (' + chunks.length + ' fragmentos)', id: idBase, tamaño_legible: formatSize(size) });
  } catch (e) {
    return jsonResponse({ error: 'Error al subir: ' + e.message });
  }
}

async function handleResumir(request, env) {
  try {
    const { archivoId, texto, destino } = await request.json();
    if (!texto && !archivoId) return jsonResponse({ error: 'Falta "texto" o "archivoId".' });
    let contenido = texto;
    if (archivoId) {
      const kv = getKV(env, destino || 'agente');
      if (!kv) return jsonResponse({ error: 'Destino inválido.' });
      const list = await kv.list({ prefix: 'file:' + archivoId + ':' });
      let completo = '';
      for (const key of list.keys) { const chunk = await kv.get(key.name); if (chunk) completo += chunk; }
      contenido = completo;
    }
    if (!contenido || contenido.length < 100) return jsonResponse({ error: 'El contenido es demasiado corto para resumir.' });
    const ai = env.ayanokoji_IA;
    if (!ai) return jsonResponse({ error: 'Binding de IA no configurado.' });
    const response = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [{ role: 'user', content: 'Resume en 6 fases lo siguiente, separadas por punto y coma: ' + contenido.substring(0, 8000) }],
      max_tokens: 500, temperature: 0.5
    });
    const resumen = response.response || 'No se pudo generar el resumen.';
    const fases = resumen.split(/[.;]/).map(p => p.trim()).filter(p => p.length > 10).slice(0, 6);
    while (fases.length < 6) fases.push('Fase pendiente de definir');
    const d1 = getD1(env, destino || 'agente');
    await d1.prepare('INSERT INTO contexto (fecha, resumen, fases, fuente) VALUES (?, ?, ?, ?)').bind(Date.now(), resumen, JSON.stringify(fases), archivoId || 'texto_directo').run();
    return jsonResponse({ mensaje: 'Resumen generado y guardado', fases: fases, resumen: resumen });
  } catch (e) {
    return jsonResponse({ error: 'Error al resumir: ' + e.message });
  }
}

async function handleD1(request, env) {
  try {
    const { accion, tabla, datos, condicion, destino } = await request.json();
    const db = getD1(env, destino || 'agente');
    if (!db) return jsonResponse({ error: 'Destino D1 inválido.' });
    if (accion === 'leer') {
      if (!tabla) return jsonResponse({ error: 'Falta "tabla"' });
      const result = await db.prepare('SELECT * FROM ' + tabla + ' ' + (condicion || '')).all();
      return jsonResponse({ resultado: result.results, total: result.results.length });
    }
    if (accion === 'escribir') {
      if (!tabla || !datos) return jsonResponse({ error: 'Faltan "tabla" y "datos"' });
      const keys = Object.keys(datos), placeholders = keys.map(() => '?').join(', ');
      await db.prepare('INSERT INTO ' + tabla + ' (' + keys.join(', ') + ') VALUES (' + placeholders + ')').bind(...Object.values(datos)).run();
      return jsonResponse({ mensaje: 'Dato insertado en ' + tabla });
    }
    if (accion === 'eliminar') {
      if (!tabla || !condicion) return jsonResponse({ error: 'Faltan "tabla" y "condicion"' });
      await db.prepare('DELETE FROM ' + tabla + ' WHERE ' + condicion).run();
      return jsonResponse({ mensaje: 'Datos eliminados de ' + tabla });
    }
    return jsonResponse({ error: 'Acción no reconocida' });
  } catch (e) {
    return jsonResponse({ error: 'Error en D1: ' + e.message });
  }
}

async function handleKV(request, env) {
  try {
    const { accion, clave, valor, destino } = await request.json();
    const kv = getKV(env, destino || 'agente');
    if (!kv) return jsonResponse({ error: 'Destino KV inválido.' });
    if (accion === 'leer') {
      if (!clave) return jsonResponse({ error: 'Falta "clave"' });
      const resultado = await kv.get(clave);
      return jsonResponse({ clave, valor: resultado || null });
    }
    if (accion === 'escribir') {
      if (!clave || !valor) return jsonResponse({ error: 'Faltan "clave" o "valor"' });
      await kv.put(clave, valor);
      return jsonResponse({ mensaje: 'Clave "' + clave + '" guardada' });
    }
    if (accion === 'eliminar') {
      if (!clave) return jsonResponse({ error: 'Falta "clave"' });
      await kv.delete(clave);
      return jsonResponse({ mensaje: 'Clave "' + clave + '" eliminada' });
    }
    return jsonResponse({ error: 'Acción no reconocida' });
  } catch (e) {
    return jsonResponse({ error: 'Error en KV: ' + e.message });
  }
}

async function handleCrearWorker(request, env) {
  try {
    const { nombre, codigo, destino } = await request.json();
    if (!nombre || !codigo) return jsonResponse({ error: 'Faltan "nombre" y "codigo"' });
    const kv = getKV(env, destino || 'agente');
    await kv.put('worker:' + nombre, codigo);
    const db = getD1(env, destino || 'agente');
    await db.prepare('INSERT INTO workers (nombre, codigo, fecha) VALUES (?, ?, ?)').bind(nombre, codigo.substring(0, 200), Date.now()).run();
    return jsonResponse({ mensaje: 'Worker "' + nombre + '" preparado.' });
  } catch (e) {
    return jsonResponse({ error: 'Error: ' + e.message });
  }
}

async function handleMejorar(request, env) {
  try {
    const { nuevoCodigo, destino } = await request.json();
    if (!nuevoCodigo) return jsonResponse({ error: 'Falta el nuevo código.' });
    const kv = getKV(env, destino || 'agente');
    await kv.put('worker:version', nuevoCodigo);
    return jsonResponse({ mensaje: 'Código guardado. Usa /api/desplegar para aplicarlo.' });
  } catch (e) {
    return jsonResponse({ error: e.message });
  }
}

async function handleDesplegar(request, env) {
  try {
    const { nombre, destino } = await request.json();
    const kv = getKV(env, destino || 'agente');
    const codigo = nombre ? await kv.get('worker:' + nombre) : await kv.get('worker:version');
    if (!codigo) return jsonResponse({ error: 'No se encontró código para desplegar.' });
    await kv.put('worker:pendiente', codigo);
    return jsonResponse({ mensaje: 'Código preparado para despliegue.' });
  } catch (e) {
    return jsonResponse({ error: 'Error al desplegar: ' + e.message });
  }
}

// ------------------------------------------------------------------
// UTILIDADES
// ------------------------------------------------------------------
function jsonResponse(data) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}
function getD1(env, destino) {
  const map = { 'agente': env.DB, 'test': env.DB_test, 'shadow': env.DB_shadow_arise };
  return map[destino] || null;
}
function getKV(env, destino) {
  const map = { 'agente': env.KV, 'test': env.KV_test, 'shadow': env.KV_shadow_arise };
  return map[destino] || null;
}
function bufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// ------------------------------------------------------------------
// HTML MINIMIZADO (PARA EVITAR TRUNCAMIENTO)
// ------------------------------------------------------------------
const HTML = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Ayanokōji Digital</title><style>*{margin:0;padding:0;box-sizing:border-box;font-family:system-ui,sans-serif}body{background:#0a0a14;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:1rem}.card{max-width:800px;width:100%;background:#0d1420;border:1px solid #2c3a5a;border-radius:20px;padding:1.5rem}h1{color:#aaffff;text-align:center;font-weight:300}h1 span{color:#7a5cff;font-weight:600}.chat-box{height:350px;overflow-y:auto;border:1px solid #1a2a3a;border-radius:12px;padding:1rem;margin:1rem 0;background:#0a1525;display:flex;flex-direction:column;gap:0.5rem}.msg{max-width:85%;padding:0.5rem 1rem;border-radius:14px;font-size:0.95rem;word-wrap:break-word}.msg.user{align-self:flex-end;background:#1a2a4a;color:#d0d8e8}.msg.bot{align-self:flex-start;background:#0f1a2a;border:1px solid #2c3a5a;color:#c8d8e8}.input-area{display:flex;gap:0.5rem;margin-top:0.5rem}.input-area input{flex:1;padding:0.7rem;border-radius:12px;border:1px solid #2c4a6a;background:#0a1525;color:#fff}.input-area button{padding:0.7rem 1.2rem;border:none;border-radius:12px;background:linear-gradient(135deg,#2a1a5a,#4a2a7a);color:#fff;font-weight:bold;cursor:pointer}.file-area{display:flex;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap}.file-area input[type=file]{flex:1;padding:0.5rem;border-radius:12px;border:1px solid #2c4a6a;background:#0a1525;color:#aaffff;min-width:150px}.file-area select{padding:0.5rem;border-radius:12px;border:1px solid #2c4a6a;background:#0a1525;color:#fff;min-width:100px}.file-area button{padding:0.7rem 1.2rem;border:none;border-radius:12px;background:#2a4a6a;color:#fff;font-weight:bold;cursor:pointer}.status{font-size:0.8rem;color:#6a6a8a;text-align:center;margin-top:0.5rem}.result{margin-top:0.5rem;padding:0.5rem;border-radius:8px;background:#0a1525;border:1px solid #2c4a6a;font-size:0.85rem;color:#aaffff;white-space:pre-wrap;word-break:break-word}</style></head><body><div class="card"><h1>⚡ <span>SHADOW</span> ARISE</h1><p style="text-align:center;color:#6a6a8a;font-size:0.85rem;">Ayanokōji Digital · Control Total</p><div class="chat-box" id="chatMessages"><div class="msg bot">El agente está listo. Puedes dar órdenes sobre D1, KV y Workers.</div></div><div class="input-area"><input type="text" id="chatInput" placeholder="Escribe tu mensaje u orden..."><button id="sendBtn">Enviar</button></div><div class="file-area"><input type="file" id="fileInput"><select id="destinoSelect"><option value="agente">Agente</option><option value="test">Test</option><option value="shadow">Shadow</option></select><button id="uploadBtn">Subir</button><button id="resumirBtn" style="background:#2a4a6a;">Resumir</button></div><div id="resultado" class="result">Esperando comandos...</div><div class="status" id="status">Conectado</div></div><script>const chatMessages=document.getElementById("chatMessages"),chatInput=document.getElementById("chatInput"),sendBtn=document.getElementById("sendBtn"),fileInput=document.getElementById("fileInput"),uploadBtn=document.getElementById("uploadBtn"),resumirBtn=document.getElementById("resumirBtn"),destinoSelect=document.getElementById("destinoSelect"),resultadoDiv=document.getElementById("resultado"),statusDiv=document.getElementById("status"),WORKER_URL=window.location.origin;function agregarMensaje(t,e){const n=document.createElement("div");n.className="msg "+t,n.textContent=e,chatMessages.appendChild(n),chatMessages.scrollTop=chatMessages.scrollHeight}function setResultado(e){resultadoDiv.textContent=e}sendBtn.onclick=async()=>{const e=chatInput.value.trim();if(!e)return;agregarMensaje("user",e),chatInput.value="",chatInput.disabled=!0,sendBtn.disabled=!0,statusDiv.textContent="⏳ Procesando...";try{const t=await fetch(WORKER_URL+"/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mensaje:e})}),n=await t.json();n.respuesta?agregarMensaje("bot",n.respuesta):agregarMensaje("bot","⚠️ "+(n.error||"Error desconocido."))}catch(e){agregarMensaje("bot","⚠️ Error de conexión.")}chatInput.disabled=!1,sendBtn.disabled=!1,chatInput.focus(),statusDiv.textContent="Conectado"},chatInput.addEventListener("keydown",e=>{e.key==="Enter"&&sendBtn.click()}),uploadBtn.onclick=async()=>{const e=fileInput.files[0];if(!e){setResultado("❌ Selecciona un archivo.");return}const t=destinoSelect.value,n=new FormData;n.append("archivo",e),n.append("nombre",e.name),n.append("destino",t),setResultado("⏳ Subiendo...");try{const a=await fetch(WORKER_URL+"/api/subir",{method:"POST",body:n}),r=await a.json();setResultado(r.mensaje?"✅ "+r.mensaje:"❌ "+r.error)}catch(e){setResultado("❌ Error al subir.")}},resumirBtn.onclick=async()=>{const e=prompt("Ingresa el texto a resumir o el ID del archivo (formato: file:ID)");if(!e)return;const t=destinoSelect.value;setResultado("⏳ Generando resumen...");try{const n={texto:e,destino:t};e.startsWith("file:")&&(n.archivoId=e.replace("file:",""),delete n.texto);const a=await fetch(WORKER_URL+"/api/resumir",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(n)}),r=await a.json();r.fases?setResultado("📋 Fases:\n"+r.fases.map((e,t)=>(t+1)+". "+e).join("\n")):setResultado("❌ "+(r.error||"Error al resumir."))}catch(e){setResultado("❌ Error de conexión.")}};</script></body></html>';
