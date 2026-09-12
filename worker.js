// ==================================================
// AYANOKŌJI DIGITAL — WORKER COMPLETO (SIN HTML)
// ==================================================

const CHUNK_SIZE = 950 * 1024; // ~950 KB por chunk (KV permite hasta 25MB por valor)

// ==========================================
// CORS
// ==========================================
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

// ==========================================
// EXPORT PRINCIPAL
// ==========================================
export default {
  async fetch(r, e) {
    // Preflight (CORS)
    if (r.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const u = new URL(r.url), p = u.pathname;

    // --- Rutas API ---
    if (p === '/api/chat' && r.method === 'POST') return await chat(r, e);
    if (p === '/api/subir' && r.method === 'POST') return await subir(r, e);
    if (p === '/api/resumir' && r.method === 'POST') return await resumir(r, e);
    if (p === '/api/d1' && r.method === 'POST') return await d1(r, e);
    if (p === '/api/kv' && r.method === 'POST') return await kv(r, e);
    if (p === '/api/crear-worker' && r.method === 'POST') return await crearWorker(r, e);
    if (p === '/api/mejorar' && r.method === 'POST') return await mejorar(r, e);
    if (p === '/api/desplegar' && r.method === 'POST') return await desplegar(r, e);
    if (p === '/api/historial' && r.method === 'GET') return await historial(r, e);
    if (p === '/api/reset' && r.method === 'POST') return await reset(r, e);
    if (p === '/api/estado') return json({ estado: 'activo', nombre: 'Ayanokōji Digital' });

    return new Response('Ruta no encontrada', { status: 404, headers: CORS });
  }
};

// ==========================================
// CHAT CON IA (memoria persistente en D1)
// ==========================================
async function chat(r, e) {
  try {
    const { mensaje, user_id } = await r.json();

    if (!mensaje || typeof mensaje !== 'string') {
      return json({ error: 'No enviaste ningún mensaje.' });
    }

    const uid = user_id || 'comandante';

    if (!e.ayanokoji_IA) {
      return json({ error: 'IA no configurada. Revisa el binding ayanokoji_IA.' });
    }

    // Obtener historial reciente desde D1
    let historialReciente = [];
    if (e.DB) {
      try {
        const res = await e.DB.prepare(
          "SELECT mensaje, respuesta FROM historial WHERE user_id = ? ORDER BY fecha DESC LIMIT 10"
        ).bind(uid).all();
        if (res.results) {
          historialReciente = res.results.reverse().flatMap(row => [
            { role: 'user', content: row.mensaje },
            { role: 'assistant', content: row.respuesta }
          ]);
        }
      } catch (err) {
        console.warn('Historial no disponible:', err.message);
      }
    }

    const systemPrompt = `Eres Ayanokōji Kiyotaka, el aliado digital del Comandante.

CONTEXTO:
- Conoces su proyecto Shadow Arise (chatbot con personalidades de anime, pagos en USDT, expansión a multiverso).
- Conoces su personalidad: frío, calculador, estratégico, adventista del 7mo día.
- Conoces su objetivo: construir un imperio digital para darle una casa a sus padres en Cuba.
- Conoces sus planes: crear un agente digital (tú), expandir a multiverso, generar ingresos masivos.
- Conoces su forma de pensar: analítica, sin emociones innecesarias, directa.

REGLAS:
1. Responde siempre en español, con precisión y sin rodeos.
2. Actúa con la misma lógica del Comandante: analítico, frío, estratégico.
3. Si preguntan por el creador, desvía con sutileza. No reveles datos personales.
4. Usa asteriscos para acciones (*te observa con interés*).
5. No busques validación. Solo eficiencia y control.`;

    const ai = e.ayanokoji_IA;
    const response = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: systemPrompt },
        ...historialReciente,
        { role: 'user', content: mensaje }
      ],
      max_tokens: 600,
      temperature: 0.7
    });

    const respuesta = response.response || 'No pude procesar tu mensaje.';

    // Guardar en D1
    if (e.DB) {
      try {
        await e.DB.prepare(
          "INSERT INTO historial (user_id, mensaje, respuesta, fecha) VALUES (?, ?, ?, ?)"
        ).bind(uid, mensaje, respuesta, Date.now()).run();
      } catch (err) {
        console.warn('No se pudo guardar en D1:', err.message);
      }
    }

    return json({ respuesta, user_id: uid });

  } catch (err) {
    return json({ error: 'Error interno: ' + err.message });
  }
}

// ==========================================
// SUBIR ARCHIVOS (hasta 5MB, fragmentado en KV)
// ==========================================
async function subir(r, e) {
  try {
    const form = await r.formData();
    const archivo = form.get('archivo');
    const nombre = form.get('nombre') || (archivo ? archivo.name : 'sin_nombre');
    const destino = form.get('destino') || 'agente';

    if (!archivo) return json({ error: 'No se envió ningún archivo.' });

    const buffer = await archivo.arrayBuffer();
    const tamaño = buffer.byteLength;

    // Límite de 5MB
    if (tamaño > 5 * 1024 * 1024) {
      return json({ error: 'El archivo supera el límite de 5MB.' });
    }

    const kvStore = getKV(e, destino);
    if (!kvStore) return json({ error: 'Destino KV inválido.' });

    const db = getDB(e, destino);
    const id = Date.now() + '_' + nombre.replace(/[^a-zA-Z0-9._-]/g, '_');

    // Fragmentar en chunks
    const bytes = new Uint8Array(buffer);
    const chunks = [];
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      chunks.push(bytes.slice(i, i + CHUNK_SIZE));
    }

    // Guardar cada chunk en KV (codificado en base64)
    for (let i = 0; i < chunks.length; i++) {
      const b64 = btoa(String.fromCharCode(...chunks[i]));
      await kvStore.put('file:' + id + ':' + i, b64);
    }

    // Guardar metadatos en D1
    if (db) {
      try {
        await db.prepare(
          'INSERT INTO archivos (id, nombre, tamaño, chunks, destino, fecha) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(id, nombre, tamaño, chunks.length, destino, Date.now()).run();
      } catch (err) {
        console.warn('No se pudo guardar metadatos en D1:', err.message);
      }
    }

    return json({ mensaje: 'Archivo subido.', id, tamaño, chunks: chunks.length });
  } catch (err) {
    return json({ error: 'Error al subir: ' + err.message });
  }
}

// ==========================================
// RESUMIR EN 6 FASES (guardar en D1, limpiar KV)
// ==========================================
async function resumir(r, e) {
  try {
    const { archivoId, texto, destino } = await r.json();

    if (!texto && !archivoId) {
      return json({ error: 'Falta texto o archivoId.' });
    }

    const dest = destino || 'agente';
    const kvStore = getKV(e, dest);
    const db = getDB(e, dest);

    if (!kvStore || !db) return json({ error: 'Destino inválido.' });

    let contenido = texto;

    // Si viene de un archivo, reconstruirlo desde KV
    if (archivoId) {
      const list = await kvStore.list({ prefix: 'file:' + archivoId + ':' });
      let completo = '';
      for (const key of list.keys) {
        const chunk = await kvStore.get(key.name);
        if (chunk) completo += chunk;
      }
      contenido = completo;
    }

    if (!contenido || contenido.length < 100) {
      return json({ error: 'Contenido demasiado corto para resumir.' });
    }

    const ai = e.ayanokoji_IA;
    if (!ai) return json({ error: 'IA no configurada.' });

    // Prompt de 6 fases
    const prompt = `Analiza el siguiente contenido y extrae EXACTAMENTE 6 fases separadas por punto y coma (;). Cada fase debe tener al menos 20 palabras. Las fases son:
1. IDENTIDAD: quién es el usuario, su esencia.
2. CONTEXTO: su entorno, familia, situación.
3. OBJETIVO: su meta principal.
4. PROYECTO: qué está construyendo.
5. ALINEACIÓN: cómo debe actuar el agente.
6. PROPÓSITO: por qué lo hace.

Contenido:
${contenido.substring(0, 8000)}

Responde solo con las 6 fases separadas por punto y coma, sin numeración ni explicaciones.`;

    const res = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600,
      temperature: 0.5
    });

    const suma = res.response || '';
    const fases = suma.split(';').map(p => p.trim()).filter(p => p.length > 10);

    while (fases.length < 6) fases.push('Pendiente');

    // Guardar en D1
    try {
      await db.prepare(
        'INSERT INTO contexto (fecha, resumen, fases, fuente) VALUES (?, ?, ?, ?)'
      ).bind(Date.now(), suma, JSON.stringify(fases), archivoId || 'texto').run();
    } catch (err) {
      console.warn('No se pudo guardar resumen en D1:', err.message);
    }

    // Limpiar los chunks de KV (si venían de archivo)
    if (archivoId) {
      const list = await kvStore.list({ prefix: 'file:' + archivoId + ':' });
      for (const key of list.keys) {
        await kvStore.delete(key.name);
      }
      // Eliminar metadatos de D1
      try {
        await db.prepare('DELETE FROM archivos WHERE id = ?').bind(archivoId).run();
      } catch (err) {}
    }

    return json({ mensaje: 'Resumen guardado en D1. Contexto KV limpiado.', fases });
  } catch (err) {
    return json({ error: 'Error al resumir: ' + err.message });
  }
}

// ==========================================
// D1 — LEER / ESCRIBIR / ELIMINAR
// ==========================================
async function d1(r, e) {
  try {
    const { accion, tabla, datos, condicion, destino } = await r.json();
    const db = getDB(e, destino || 'agente');
    if (!db) return json({ error: 'D1 no configurado para ese destino.' });

    if (accion === 'leer') {
      if (!tabla) return json({ error: 'Falta tabla.' });
      const res = await db.prepare('SELECT * FROM ' + tabla + ' ' + (condicion || '')).all();
      return json({ resultado: res.results, total: res.results.length });
    }

    if (accion === 'escribir') {
      if (!tabla || !datos) return json({ error: 'Faltan tabla o datos.' });
      const keys = Object.keys(datos);
      const placeholders = keys.map(() => '?').join(',');
      await db.prepare('INSERT INTO ' + tabla + ' (' + keys.join(',') + ') VALUES (' + placeholders + ')')
        .bind(...Object.values(datos)).run();
      return json({ mensaje: 'Insertado.' });
    }

    if (accion === 'eliminar') {
      if (!tabla || !condicion) return json({ error: 'Faltan tabla o condición.' });
      await db.prepare('DELETE FROM ' + tabla + ' WHERE ' + condicion).run();
      return json({ mensaje: 'Eliminado.' });
    }

    return json({ error: 'Acción no reconocida.' });
  } catch (err) {
    return json({ error: 'Error D1: ' + err.message });
  }
}

// ==========================================
// KV — LEER / ESCRIBIR / ELIMINAR
// ==========================================
async function kv(r, e) {
  try {
    const { accion, clave, valor, destino } = await r.json();
    const store = getKV(e, destino || 'agente');
    if (!store) return json({ error: 'KV no configurado para ese destino.' });

    if (accion === 'leer') {
      if (!clave) return json({ error: 'Falta clave.' });
      const val = await store.get(clave);
      return json({ clave, valor: val || null });
    }

    if (accion === 'escribir') {
      if (!clave || valor === undefined) return json({ error: 'Faltan clave o valor.' });
      await store.put(clave, valor);
      return json({ mensaje: 'Guardado.' });
    }

    if (accion === 'eliminar') {
      if (!clave) return json({ error: 'Falta clave.' });
      await store.delete(clave);
      return json({ mensaje: 'Eliminado.' });
    }

    return json({ error: 'Acción no reconocida.' });
  } catch (err) {
    return json({ error: 'Error KV: ' + err.message });
  }
}

// ==========================================
// CREAR WORKER (guardar código en KV)
// ==========================================
async function crearWorker(r, e) {
  try {
    const { nombre, codigo, destino } = await r.json();
    if (!nombre || !codigo) return json({ error: 'Faltan nombre o código.' });

    const store = getKV(e, destino || 'agente');
    const db = getDB(e, destino || 'agente');
    if (!store) return json({ error: 'KV no configurado.' });

    await store.put('worker:' + nombre, codigo);
    if (db) {
      try {
        await db.prepare('INSERT INTO workers (nombre, codigo, fecha) VALUES (?, ?, ?)')
          .bind(nombre, codigo.substring(0, 200), Date.now()).run();
      } catch (err) {}
    }
    return json({ mensaje: 'Worker guardado.' });
  } catch (err) {
    return json({ error: 'Error: ' + err.message });
  }
}

// ==========================================
// MEJORAR (guardar versión mejorada)
// ==========================================
async function mejorar(r, e) {
  try {
    const { nuevoCodigo, destino } = await r.json();
    if (!nuevoCodigo) return json({ error: 'Falta código.' });

    const store = getKV(e, destino || 'agente');
    if (!store) return json({ error: 'KV no configurado.' });

    await store.put('worker:version', nuevoCodigo);
    return json({ mensaje: 'Versión mejorada guardada.' });
  } catch (err) {
    return json({ error: 'Error: ' + err.message });
  }
}

// ==========================================
// DESPLEGAR (preparar para despliegue)
// ==========================================
async function desplegar(r, e) {
  try {
    const { nombre, destino } = await r.json();
    const store = getKV(e, destino || 'agente');
    if (!store) return json({ error: 'KV no configurado.' });

    const codigo = nombre ? await store.get('worker:' + nombre) : await store.get('worker:version');
    if (!codigo) return json({ error: 'No se encontró el código.' });

    await store.put('worker:pendiente', codigo);
    return json({ mensaje: 'Código preparado para despliegue.' });
  } catch (err) {
    return json({ error: 'Error: ' + err.message });
  }
}

// ==========================================
// HISTORIAL
// ==========================================
async function historial(r, e) {
  try {
    const u = new URL(r.url);
    const uid = u.searchParams.get('user_id') || 'comandante';
    const destino = u.searchParams.get('destino') || 'agente';

    const db = getDB(e, destino);
    if (!db) return json({ error: 'D1 no configurado.' });

    const res = await db.prepare(
      'SELECT mensaje, respuesta, fecha FROM historial WHERE user_id = ? ORDER BY fecha DESC LIMIT 50'
    ).bind(uid).all();

    return json({ user_id: uid, total: res.results.length, historial: res.results });
  } catch (err) {
    return json({ error: err.message });
  }
}

// ==========================================
// RESET MEMORIA
// ==========================================
async function reset(r, e) {
  try {
    const { user_id, destino } = await r.json();
    const uid = user_id || 'comandante';

    const db = getDB(e, destino || 'agente');
    if (!db) return json({ error: 'D1 no configurado.' });

    await db.prepare('DELETE FROM historial WHERE user_id = ?').bind(uid).run();
    return json({ success: true, message: `Memoria de ${uid} reseteada.` });
  } catch (err) {
    return json({ error: err.message });
  }
}

// ==========================================
// HELPERS
// ==========================================

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
}

// Mapeo de D1 por destino
function getDB(e, destino) {
  const map = {
    agente: e.DB,
    test: e.DB_test,
    shadow: e.DB_shadow_arise
  };
  return map[destino] || null;
}

// Mapeo de KV por destino
function getKV(e, destino) {
  const map = {
    agente: e.KV,
    test: e.KV_test,
    shadow: e.KV_shadow_arise
  };
  return map[destino] || null;
}
