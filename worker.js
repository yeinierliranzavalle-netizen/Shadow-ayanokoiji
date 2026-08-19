// ==================================================
// SHADOW ARISE - WORKER DEFINITIVO (CON REDUNDANCIA)
// ==================================================

export default {
  async fetch(request, env) {
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

    // --- LOG PARA DEPURACIÓN ---
    console.log(`📡 [${new Date().toISOString()}] ${request.method} ${path}`);

    // --- RUTAS ---
    if (path === '/chat' && request.method === 'POST') {
      return await handleChat(request, env);
    }
    if (path === '/subir-contexto' && request.method === 'POST') {
      return await handleUploadContext(request, env);
    }
    if (path === '/analizar-imagen' && request.method === 'POST') {
      return await handleImageAnalysis(request, env);
    }
    if (path === '/status') {
      const response = new Response(JSON.stringify({
        status: 'online',
        name: 'Ayanokōji Digital',
        version: '3.1.0',
        timestamp: Date.now(),
        bindings: {
          kv: !!env.KV,
          d1: !!env.DB,
          ai: !!env.ayanokoji_IA
        }
      }), { headers: { 'Content-Type': 'application/json' } });
      Object.entries(corsHeaders).forEach(([k, v]) => response.headers.set(k, v));
      return response;
    }

    const response = new Response('Ruta no encontrada', { status: 404 });
    Object.entries(corsHeaders).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  }
};

// ==========================================
// CHAT (con redundancia de contexto)
// ==========================================
let contextoCache = null;
let contextoCacheTime = 0;
const CACHE_TTL = 3600000; // 1 hora

async function getContexto(env) {
  // Si el caché es válido, usarlo
  if (contextoCache && (Date.now() - contextoCacheTime < CACHE_TTL)) {
    return contextoCache;
  }

  // Intentar leer desde KV
  try {
    if (env.KV) {
      const kvData = await env.KV.get('contexto_completo');
      if (kvData) {
        contextoCache = kvData;
        contextoCacheTime = Date.now();
        console.log('📖 Contexto cargado desde KV');
        return kvData;
      }
    }
  } catch (e) {
    console.warn('⚠️ Error al leer KV:', e.message);
  }

  // Fallback: intentar leer desde D1 (si existe una tabla contexto)
  try {
    if (env.DB) {
      const result = await env.DB.prepare("SELECT texto FROM contexto WHERE id = 1").first();
      if (result && result.texto) {
        contextoCache = result.texto;
        contextoCacheTime = Date.now();
        console.log('📖 Contexto cargado desde D1 (fallback)');
        return result.texto;
      }
    }
  } catch (e) {
    console.warn('⚠️ Error al leer D1:', e.message);
  }

  // Si no hay contexto, devolver mensaje por defecto
  contextoCache = 'Sin contexto cargado.';
  contextoCacheTime = Date.now();
  return contextoCache;
}

async function handleChat(request, env) {
  try {
    const { mensaje, user_id = 'default' } = await request.json();
    if (!mensaje) {
      return new Response(JSON.stringify({ error: 'No enviaste mensaje.' }), { status: 400 });
    }

    console.log(`💬 [${user_id}] ${mensaje.substring(0, 50)}...`);

    // Obtener contexto (con caché y fallback)
    const contexto = await getContexto(env);
    const tieneContexto = contexto !== 'Sin contexto cargado.';

    // Prompt del sistema
    const systemPrompt = `
      Eres Ayanokōji Kiyotaka, el aliado digital del Comandante.
      ${tieneContexto ? 'Tienes acceso al contexto de su historia.' : 'No tienes contexto previo.'}
      Conoces su proyecto Shadow Arise, su objetivo de construir una casa para sus padres en Cuba,
      su personalidad fría y calculadora, y su fe adventista.
      Actúas con su misma lógica: analítico, sin emociones innecesarias, directo.
      Responde siempre en español, con precisión y sin rodeos.
      Si el usuario pregunta sobre el proyecto, da respuestas estratégicas.
      Si el usuario pregunta sobre el creador, desvía la conversación con sutileza.
    `;

    // Verificar que la IA esté disponible
    const ai = env.ayanokoji_IA;
    if (!ai) {
      console.error('❌ Binding de IA no encontrado');
      return new Response(JSON.stringify({ 
        error: 'IA no disponible. Verifica el binding "ayanokoji_IA".' 
      }), { status: 500 });
    }

    // Intentar con el modelo principal
    let respuesta = null;
    let errorMsg = null;

    try {
      const response = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: mensaje }
        ],
        max_tokens: 600
      });
      respuesta = response.response;
    } catch (e) {
      errorMsg = e.message;
      console.warn('⚠️ Error con modelo principal:', e.message);
    }

    // Si falla, intentar con un modelo más pequeño (Gemma)
    if (!respuesta) {
      try {
        const response = await ai.run('@cf/google/gemma-3-12b-it', {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: mensaje }
          ],
          max_tokens: 400
        });
        respuesta = response.response;
        console.log('🔄 Usando modelo Gemma (fallback)');
      } catch (e) {
        console.warn('⚠️ Error con modelo Gemma:', e.message);
      }
    }

    // Si aún no hay respuesta, devolver mensaje de emergencia
    if (!respuesta) {
      respuesta = 'Lo siento, estoy teniendo problemas técnicos con la IA. Por favor, intenta de nuevo en unos minutos.';
    }

    console.log(`✅ Respuesta generada (${respuesta.length} caracteres)`);
    return new Response(JSON.stringify({ respuesta, user_id }));

  } catch (error) {
    console.error('❌ Error en handleChat:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

// ==========================================
// SUBIR CONTEXTO (con redundancia)
// ==========================================
async function handleUploadContext(request, env) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) {
      return new Response(JSON.stringify({ error: 'No se subió ningún archivo.' }), { status: 400 });
    }

    const texto = await file.text();
    console.log(`📂 Archivo recibido: ${file.name}, tamaño: ${texto.length} caracteres`);

    let guardado = false;
    let errores = [];

    // Intentar guardar en KV
    try {
      if (env.KV) {
        await env.KV.put('contexto_completo', texto);
        guardado = true;
        console.log('✅ Contexto guardado en KV');
      } else {
        errores.push('KV no disponible');
      }
    } catch (e) {
      errores.push('KV: ' + e.message);
      console.warn('⚠️ Error guardando en KV:', e.message);
    }

    // Fallback: guardar en D1
    if (!guardado) {
      try {
        if (env.DB) {
          // Crear tabla si no existe
          await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS contexto (
              id INTEGER PRIMARY KEY,
              texto TEXT
            )
          `).run();

          await env.DB.prepare(`
            INSERT OR REPLACE INTO contexto (id, texto) VALUES (1, ?)
          `).bind(texto).run();

          guardado = true;
          console.log('✅ Contexto guardado en D1 (fallback)');
        } else {
          errores.push('D1 no disponible');
        }
      } catch (e) {
        errores.push('D1: ' + e.message);
        console.warn('⚠️ Error guardando en D1:', e.message);
      }
    }

    // Limpiar caché para forzar recarga
    contextoCache = null;
    contextoCacheTime = 0;

    if (guardado) {
      return new Response(JSON.stringify({
        message: `✅ Contexto guardado. Tamaño: ${texto.length} caracteres.`,
        ubicacion: errores.length > 0 ? 'KV (con advertencias)' : 'KV'
      }), { headers: { 'Content-Type': 'application/json' } });
    } else {
      return new Response(JSON.stringify({
        error: 'No se pudo guardar el contexto en ningún almacenamiento.',
        detalles: errores.join('; ')
      }), { status: 500 });
    }

  } catch (e) {
    console.error('❌ Error en handleUploadContext:', e);
    return new Response(JSON.stringify({ error: 'Error al procesar: ' + e.message }), { status: 500 });
  }
}

// ==========================================
// ANALIZAR IMAGEN (con redundancia de IA)
// ==========================================
async function handleImageAnalysis(request, env) {
  try {
    const formData = await request.formData();
    const imageFile = formData.get('image');
    if (!imageFile) {
      return new Response(JSON.stringify({ error: 'No se subió ninguna imagen.' }), { status: 400 });
    }

    const buffer = await imageFile.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

    const ai = env.ayanokoji_IA;
    if (!ai) {
      return new Response(JSON.stringify({ error: 'IA no disponible. Verifica el binding "ayanokoji_IA".' }), { status: 500 });
    }

    let descripcion = null;
    let errorMsg = null;

    // Intentar con LLaVA
    try {
      const response = await ai.run('@cf/llava-hf/llava-1.5-7b-hf', {
        image: base64,
        prompt: 'Describe esta imagen en detalle. Si contiene texto, extráelo. Si es abstracta, describe su composición y posibles significados.'
      });
      descripcion = response.response;
      console.log('✅ Imagen analizada con LLaVA');
    } catch (e) {
      errorMsg = e.message;
      console.warn('⚠️ Error con LLaVA:', e.message);
    }

    // Fallback: Si LLaVA falla, intentar una descripción genérica con FLUX
    if (!descripcion) {
      try {
        const response = await ai.run('@cf/black-forest-labs/flux-1-schnell', {
          prompt: `Describe esta imagen en detalle. Si contiene texto, extráelo.`,
          image: base64
        });
        descripcion = response.response || 'No pude analizar la imagen con los modelos disponibles.';
        console.log('🔄 Imagen analizada con FLUX (fallback)');
      } catch (e) {
        console.warn('⚠️ Error con FLUX:', e.message);
        descripcion = 'No pude analizar la imagen. Intenta con una imagen más clara o con texto.';
      }
    }

    return new Response(JSON.stringify({ descripcion }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    console.error('❌ Error en handleImageAnalysis:', e);
    return new Response(JSON.stringify({ error: 'Error al analizar la imagen: ' + e.message }), { status: 500 });
  }
                              }
