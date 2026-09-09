// ==================================================
// SHADOW ARISE - AGENTE DIGITAL (FINAL)
// ORQUESTA D1, KV, SUBIDA DE ARCHIVOS Y RESUMEN
// ==================================================
// AUTOR: COMANDANTE SHADOW (ESTRUCTURA BASE)
// MEJORAS Y CORRECCIÓN: AYANOKŌJI DIGITAL
// VERSIÓN: 2.1 (CORREGIDA)
// ==================================================

// ------------------------------------------------------------------
// CONSTANTES Y CONFIGURACIÓN
// ------------------------------------------------------------------
const LIMITE_KV = 950 * 1024; // 950 KB (margen para evitar errores)
const BINDINGS = {
  d1: {
    agente: 'DB',
    test: 'DB_test',
    shadow: 'DB_shadow_arise'
  },
  kv: {
    agente: 'KV',
    test: 'KV_test',
    shadow: 'KV_shadow_arise'
  }
};

// ------------------------------------------------------------------
// FUNCIÓN PRINCIPAL (FETCH)
// ------------------------------------------------------------------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // --- RUTAS PÚBLICAS ---
    if (path === '/' || path === '/index.html') {
      return new Response(HTML, { headers: { 'Content-Type': 'text/html' } });
    }

    // --- RUTAS API ---
    if (path === '/api/chat' && request.method === 'POST') {
      return await handleChat(request, env);
    }
    if (path === '/api/subir' && request.method === 'POST') {
      return await handleUpload(request, env);
    }
    if (path === '/api/resumir' && request.method === 'POST') {
      return await handleResumir(request, env);
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
      return jsonResponse({
        estado: 'activo',
        nombre: 'Ayanokōji Digital',
        bindings: {
          d1: Object.keys(BINDINGS.d1),
          kv: Object.keys(BINDINGS.kv)
        }
      });
    }

    return new Response('Ruta no encontrada', { status: 404 });
  }
};

// ------------------------------------------------------------------
// CHAT CON IA (USANDO BINDING DE WORKERS AI)
// ------------------------------------------------------------------
async function handleChat(request, env) {
  try {
    const { mensaje, contexto } = await request.json();
    if (!mensaje) return jsonResponse({ error: 'No enviaste mensaje.' });

    if (!env.ayanokoji_IA) {
      return jsonResponse({ error: 'Binding de IA no configurado' });
    }

    let contextoExtra = '';
    if (contexto) {
      const result = await env.DB.prepare(
        'SELECT resumen FROM contexto WHERE fase = ? ORDER BY id DESC LIMIT 1'
      ).bind(contexto).first();
      if (result) {
        contextoExtra = '\nContexto relevante: ' + result.resumen;
      }
    }

    const systemPrompt = `
      Eres Ayanokōji Kiyotaka, el agente digital del Comandante.
      Tienes control total sobre tres D1 (DB, DB_test, DB_shadow_arise) y tres KV (KV, KV_test, KV_shadow_arise).
      Puedes ejecutar órdenes: leer/escribir/eliminar en D1, leer/escribir/eliminar en KV, crear Workers.
      Actúas con lógica fría, precisión y sin emociones innecesarias.
      Responde en español, con claridad y sin rodeos.
      ${contextoExtra}
    `;

    const ai = env.ayanokoji_IA;
    const response = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: mensaje }
      ],
      max_tokens: 800,
      temperature: 0.6
    });

    return jsonResponse({ respuesta: response.response || 'No pude procesar tu mensaje.' });
  } catch (e) {
    return jsonResponse({ error: 'Error en chat: ' + e.message });
  }
}

// ------------------------------------------------------------------
// SUBIR ARCHIVOS GRANDES A KV (DIVIDIENDO EN CHUNKS)
// ------------------------------------------------------------------
async function handleUpload(request, env) {
  try {
    const formData = await request.formData();
    const archivo = formData.get('archivo');
    const nombre = formData.get('nombre') || archivo.name || 'sin_nombre';
    const destino = formData.get('destino') || 'agente';

    if (!archivo) {
      return jsonResponse({ error: 'No se envió ningún archivo.' });
    }

    const buffer = await archivo.arrayBuffer();
    const size = buffer.byteLength;
    const chunks = [];
    const chunkSize = LIMITE_KV;

    if (size > chunkSize) {
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.slice(i, i + chunkSize);
        chunks.push(chunk);
      }
    } else {
      chunks.push(new Uint8Array(buffer));
    }

    const kv = getKV(env, destino);
    if (!kv) {
      return jsonResponse({ error: 'Destino inválido: ' + destino });
    }

    const idBase = Date.now() + '_' + nombre.replace(/[^a-zA-Z0-9._-]/g, '_');
    const metadata = {
      nombre: nombre,
      tamaño: size,
      chunks: chunks.length,
      destino: destino,
      subido: Date.now()
    };

    for (let i = 0; i < chunks.length; i++) {
      const key = 'file:' + idBase + ':' + i;
      const base64 = bufferToBase64(chunks[i]);
      await kv.put(key, base64);
    }

    const d1 = getD1(env, destino);
    await d1.prepare(
      `INSERT INTO archivos (id, nombre, tamaño, chunks, destino, fecha)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(idBase, nombre, size, chunks.length, destino, Date.now()).run();

    return jsonResponse({
      mensaje: 'Archivo subido a ' + destino + ' en ' + chunks.length + ' fragmentos.',
      id: idBase,
      tamaño_legible: formatSize(size),
      chunks: chunks.length
    });
  } catch (e) {
    return jsonResponse({ error: 'Error al subir archivo: ' + e.message });
  }
}

// ------------------------------------------------------------------
// RESUMIR CONTEXTO EN 6 FASES (DE MÁS A MENOS IMPORTANTE)
// ------------------------------------------------------------------
async function handleResumir(request, env) {
  try {
    const { archivoId, texto, destino } = await request.json();
    if (!texto && !archivoId) {
      return jsonResponse({ error: 'Falta "texto" o "archivoId".' });
    }

    let contenido = texto;
    if (archivoId) {
      const kv = getKV(env, destino || 'agente');
      if (!kv) return jsonResponse({ error: 'Destino inválido.' });

      const list = await kv.list({ prefix: 'file:' + archivoId + ':' });
      if (list.keys.length === 0) {
        return jsonResponse({ error: 'Archivo no encontrado o vacío.' });
      }

      let completo = '';
      for (const key of list.keys) {
        const chunk = await kv.get(key.name);
        if (chunk) completo += chunk;
      }
      contenido = completo;
    }

    if (!contenido || contenido.length < 100) {
      return jsonResponse({ error: 'El contenido es demasiado corto para resumir.' });
    }

    const ai = env.ayanokoji_IA;
    if (!ai) {
      return jsonResponse({ error: 'Binding de IA no configurado.' });
    }

    const chunks = splitText(contenido, 5000);
    const resumenes = [];

    for (const chunk of chunks) {
      const prompt = `
        Resume el siguiente texto en 6 fases ordenadas de más a menos importante.
        Cada fase debe ser una frase corta y concreta.
        No uses viñetas ni números. Solo frases separadas por punto y coma.
        Texto:
        ${chunk}
      `;
      const response = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400,
        temperature: 0.5
      });
      if (response && response.response) {
        resumenes.push(response.response);
      }
    }

    const resumenFinal = resumenes.join(' ').slice(0, 3000);
    const fases = extraerFases(resumenFinal);

    const d1 = getD1(env, destino || 'agente');
    await d1.prepare(
      `INSERT INTO contexto (fecha, resumen, fases, fuente)
       VALUES (?, ?, ?, ?)`
    ).bind(Date.now(), resumenFinal, JSON.stringify(fases), archivoId || 'texto_directo').run();

    return jsonResponse({
      mensaje: 'Resumen generado y guardado en ' + (destino || 'agente'),
      fases: fases,
      resumen: resumenFinal
    });
  } catch (e) {
    return jsonResponse({ error: 'Error al resumir: ' + e.message });
  }
}

// ------------------------------------------------------------------
// CONTROL DE D1 (MULTIPLE DATABASES)
// ------------------------------------------------------------------
async function handleD1(request, env) {
  try {
    const { accion, tabla, datos, condicion, destino } = await request.json();
    const db = getD1(env, destino || 'agente');
    if (!db) return jsonResponse({ error: 'Destino D1 inválido.' });

    if (!accion) return jsonResponse({ error: 'Falta "accion": leer, escribir, eliminar' });

    if (accion === 'leer') {
      if (!tabla) return jsonResponse({ error: 'Falta "tabla"' });
      const result = await db.prepare('SELECT * FROM ' + tabla + ' ' + (condicion || '')).all();
      return jsonResponse({ resultado: result.results, total: result.results.length });
    }

    if (accion === 'escribir') {
      if (!tabla || !datos) return jsonResponse({ error: 'Faltan "tabla" y "datos"' });
      const keys = Object.keys(datos);
      const placeholders = keys.map(() => '?').join(', ');
      const values = Object.values(datos);
      const query = 'INSERT INTO ' + tabla + ' (' + keys.join(', ') + ') VALUES (' + placeholders + ')';
      await db.prepare(query).bind(...values).run();
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

// ------------------------------------------------------------------
// CONTROL DE KV (MULTIPLE NAMESPACES)
// ------------------------------------------------------------------
async function handleKV(request, env) {
  try {
    const { accion, clave, valor, destino } = await request.json();
    const kv = getKV(env, destino || 'agente');
    if (!kv) return jsonResponse({ error: 'Destino KV inválido.' });

    if (!accion) return jsonResponse({ error: 'Falta "accion": leer, escribir, eliminar' });

    if (accion === 'leer') {
      if (!clave) return jsonResponse({ error: 'Falta "clave"' });
      const resultado = await kv.get(clave);
      return jsonResponse({ clave, valor: resultado || null });
    }

    if (accion === 'escribir') {
      if (!clave) return jsonResponse({ error: 'Falta "clave"' });
      if (!valor) return jsonResponse({ error: 'Falta "valor"' });
      await kv.put(clave, valor);
      return jsonResponse({ mensaje: 'Clave "' + clave + '" guardada en KV' });
    }

    if (accion === 'eliminar') {
      if (!clave) return jsonResponse({ error: 'Falta "clave"' });
      await kv.delete(clave);
      return jsonResponse({ mensaje: 'Clave "' + clave + '" eliminada de KV' });
    }

    return jsonResponse({ error: 'Acción no reconocida' });
  } catch (e) {
    return jsonResponse({ error: 'Error en KV: ' + e.message });
  }
}

// ------------------------------------------------------------------
// CREAR WORKERS (GUARDAR CÓDIGO PARA DESPLIEGUE FUTURO)
// ------------------------------------------------------------------
async function handleCrearWorker(request, env) {
  try {
    const { nombre, codigo, destino } = await request.json();
    if (!nombre || !codigo) {
      return jsonResponse({ error: 'Faltan "nombre" y "codigo"' });
    }

    const kv = getKV(env, destino || 'agente');
    await kv.put('worker:' + nombre, codigo);

    const db = getD1(env, destino || 'agente');
    await db.prepare(
      `INSERT INTO workers (nombre, codigo, fecha) VALUES (?, ?, ?)`
    ).bind(nombre, codigo.substring(0, 200), Date.now()).run();

    return jsonResponse({
      mensaje: 'Worker "' + nombre + '" preparado para despliegue.',
      nota: 'Usa /api/desplegar con el nombre del Worker.'
    });
  } catch (e) {
    return jsonResponse({ error: 'Error al crear Worker: ' + e.message });
  }
}

// ------------------------------------------------------------------
// MEJORARSE A SÍ MISMO (GUARDAR NUEVA VERSIÓN)
// ------------------------------------------------------------------
async function handleMejorar(request, env) {
  try {
    const { nuevoCodigo, destino } = await request.json();
    if (!nuevoCodigo) return jsonResponse({ error: 'Falta el nuevo código.' });

    const kv = getKV(env, destino || 'agente');
    await kv.put('worker:version', nuevoCodigo);

    return jsonResponse({
      mensaje: 'Código guardado. Usa /api/desplegar para aplicar la nueva versión.',
      version: Date.now()
    });
  } catch (e) {
    return jsonResponse({ error: e.message });
  }
}

// ------------------------------------------------------------------
// DESPLEGAR NUEVA VERSIÓN (PREPARAR)
// ------------------------------------------------------------------
async function handleDesplegar(request, env) {
  try {
    const { nombre, destino } = await request.json();
    const kv = getKV(env, destino || 'agente');

    let codigo;
    if (nombre) {
      codigo = await kv.get('worker:' + nombre);
    } else {
      codigo = await kv.get('worker:version');
    }

    if (!codigo) {
      return jsonResponse({ error: 'No se encontró código para desplegar.' });
    }

    await kv.put('worker:pendiente', codigo);

    return jsonResponse({
      mensaje: 'Código preparado para despliegue.',
      nota: 'Para desplegar automáticamente, necesitas un token de API de Cloudflare.'
    });
  } catch (e) {
    return jsonResponse({ error: 'Error al desplegar: ' + e.message });
  }
}

// ------------------------------------------------------------------
// UTILIDADES
// ------------------------------------------------------------------
function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' }
  });
}

function getD1(env, destino) {
  const map = {
    'agente': env.DB,
    'test': env.DB_test,
    'shadow': env.DB_shadow_arise
  };
  return map[destino] || null;
}

function getKV(env, destino) {
  const map = {
    'agente': env.KV,
    'test': env.KV_test,
    'shadow': env.KV_shadow_arise
  };
  return map[destino] || null;
}

function bufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function splitText(text, maxLength) {
  const parts = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxLength, text.length);
    if (end < text.length) {
      const lastSpace = text.lastIndexOf(' ', end);
      if (lastSpace > start) end = lastSpace;
    }
    parts.push(text.substring(start, end));
    start = end;
  }
  return parts;
}

function extraerFases(texto) {
  const partes = texto.split(/[.;]/).map(p => p.trim()).filter(p => p.length > 10);
  const fases = partes.slice(0, 6);
  while (fases.length < 6) {
    fases.push('Fase pendiente de definir');
  }
  return fases;
}

// ------------------------------------------------------------------
// HTML DEL INDEX (COMPLETO Y CORREGIDO)
// ------------------------------------------------------------------
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
        .destino-select { background: #0a1525; border: 1px solid #2c4a6a; border-radius: 12px; color: white; padding: 0.5rem; margin: 0.5rem 0; width: 100%; }
    </style>
</head>
<body>
<div class="card">
    <h1>⚡ <span>SHADOW</span> ARISE</h1>
    <p style="text-align:center; color:#6a6a8a; font-size:0.85rem;">Ayanokōji Digital · Control Total</p>

    <div class="chat-box" id="chatMessages">
        <div class="msg bot">El agente está listo. Puedes dar órdenes sobre D1, KV, Workers y contexto.</div>
    </div>

    <div class="input-area">
        <input type="text" id="chatInput" placeholder="Escribe tu mensaje u orden...">
        <button id="sendBtn">Enviar</button>
    </div>

    <div class="file-area">
        <input type="file" id="fileInput">
        <select id="destinoSelect" class="destino-select">
            <option value="agente">Agente</option>
            <option value="test">Test</option>
            <option value="shadow">Shadow Arise</option>
        </select>
        <button id="uploadBtn">Subir</button>
    </div>

    <div class="file-area" style="margin-top:0.5rem;">
        <input type="text" id="resumirInput" placeholder="Texto a resumir o ID de archivo..." style="flex:1; padding:0.7rem; border-radius:12px; border:1px solid #2c4a6a; background:#0a1525; color:white;">
        <button id="resumirBtn">Resumir</button
