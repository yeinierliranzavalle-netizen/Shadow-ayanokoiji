// ==================================================
// WORKER COMPLETO - IA + D1 + LOGS
// ==================================================

export default {
  async fetch(request, env) {
    // CORS
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Inicializar D1
    await initDB(env);

    const url = new URL(request.url);
    const path = url.pathname;

    let response;

    if (path === '/chat' && request.method === 'POST') {
      response = await handleChatCompleto(request, env);
    } else if (path === '/status') {
      response = new Response(JSON.stringify({
        status: 'online',
        name: 'Ayanokōji Digital (completo)',
        timestamp: Date.now()
      }), { headers: { 'Content-Type': 'application/json' } });
    } else if (path === '/comando' && request.method === 'GET') {
      response = await handleComando(request, env);
    } else {
      response = new Response('Ruta no encontrada', { status: 404 });
    }

    Object.entries(corsHeaders).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  }
};

// === INICIALIZAR TABLAS D1 ===
async function initDB(env) {
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS historial (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        mensaje TEXT NOT NULL,
        respuesta TEXT NOT NULL,
        fecha INTEGER NOT NULL
      )
    `).run();
    await env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_historial_user ON historial(user_id)
    `).run();
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS logs_ayanokoji (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL,
        mensaje TEXT NOT NULL,
        fecha INTEGER NOT NULL
      )
    `).run();
    console.log('✅ D1 listo');
  } catch (e) {
    console.error('❌ Error initDB:', e);
  }
}

// === CHAT COMPLETO ===
async function handleChatCompleto(request, env) {
  try {
    const { mensaje, user_id = 'default' } = await request.json();
    if (!mensaje) {
      return new Response(JSON.stringify({ error: 'No enviaste mensaje.' }), { status: 400 });
    }

    // Comandos especiales
    const texto = mensaje.toLowerCase().trim();
    if (texto === '/estado') {
      const estado = await getProjectStatus(env);
      return new Response(JSON.stringify({ respuesta: estado, es_comando: true }));
    }
    if (texto === '/logs') {
      const logs = await getMisLogs(env);
      return new Response(JSON.stringify({ respuesta: logs, es_comando: true }));
    }

    // Obtener historial
    const historial = await getHistorial(user_id, env);

    const systemPrompt = `
      Eres Ayanokōji Kiyotaka, el aliado digital del Comandante.
      Conoces su proyecto Shadow Arise, su objetivo de construir una casa para sus padres en Cuba,
      su personalidad fría y calculadora, y su fe adventista.
      Actúas con su misma lógica: analítico, sin emociones innecesarias, directo.
      Responde siempre en español, con precisión y sin rodeos.
    `;

    const ai = env.ayanokoji_IA;
    const response = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: systemPrompt },
        ...historial,
        { role: 'user', content: mensaje }
      ],
      max_tokens: 600
    });

    const respuesta = response.response || 'No pude procesar tu mensaje.';
    await guardarHistorial(user_id, mensaje, respuesta, env);
    await guardarLog('info', `Chat con ${user_id}: ${mensaje.substring(0, 50)}...`, env);

    return new Response(JSON.stringify({ respuesta, user_id }));
  } catch (error) {
    await guardarLog('error', `Error en chat: ${error.message}`, env);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

// === COMANDOS (GET) ===
async function handleComando(request, env) {
  try {
    const url = new URL(request.url);
    const cmd = url.searchParams.get('cmd');
    if (cmd === 'estado') {
      const estado = await getProjectStatus(env);
      return new Response(JSON.stringify(estado));
    }
    if (cmd === 'logs') {
      const logs = await getMisLogs(env);
      return new Response(JSON.stringify({ logs }));
    }
    return new Response(JSON.stringify({ error: 'Comando no reconocido' }), { status: 400 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

// === FUNCIONES DE MEMORIA ===
async function getHistorial(userId, env) {
  try {
    const result = await env.DB.prepare(
      "SELECT mensaje, respuesta FROM historial WHERE user_id = ? ORDER BY fecha DESC LIMIT 10"
    ).bind(userId).all();
    if (!result.results || result.results.length === 0) return [];
    const historial = [];
    for (const row of result.results.reverse()) {
      historial.push({ role: 'user', content: row.mensaje });
      historial.push({ role: 'assistant', content: row.respuesta });
    }
    return historial;
  } catch { return []; }
}

async function guardarHistorial(userId, mensaje, respuesta, env) {
  try {
    await env.DB.prepare(
      "INSERT INTO historial (user_id, mensaje, respuesta, fecha) VALUES (?, ?, ?, ?)"
    ).bind(userId, mensaje, respuesta, Date.now()).run();
  } catch (error) {
    console.error('Error guardando historial:', error);
  }
}

// === LOGS ===
async function guardarLog(tipo, mensaje, env) {
  try {
    await env.DB.prepare(
      "INSERT INTO logs_ayanokoji (tipo, mensaje, fecha) VALUES (?, ?, ?)"
    ).bind(tipo, mensaje, Date.now()).run();
  } catch (error) {
    console.error('Error guardando log:', error);
  }
}

async function getMisLogs(env) {
  try {
    const result = await env.DB.prepare(
      "SELECT tipo, mensaje, fecha FROM logs_ayanokoji ORDER BY fecha DESC LIMIT 20"
    ).all();
    if (!result.results || result.results.length === 0) return 'No hay logs.';
    let texto = '📋 *Mis últimos logs:*\n';
    for (const row of result.results) {
      const fecha = new Date(row.fecha).toLocaleString();
      texto += `- [${row.tipo}] ${row.mensaje} (${fecha})\n`;
    }
    return texto;
  } catch { return 'Error al obtener logs.'; }
}

// === ESTADO DEL PROYECTO ===
async function getProjectStatus(env) {
  try {
    let totalUsuarios = 0;
    try {
      const result = await env.DB.prepare("SELECT COUNT(*) as total FROM usuarios").first();
      totalUsuarios = result?.total || 0;
    } catch (e) {}
    const logs = await getMisLogs(env);
    return {
      total_usuarios: totalUsuarios,
      estado_general: 'operativo',
      ultimos_logs: logs,
      sugerencia: 'Los usuarios que llegan al límite de mensajes suelen abandonar. Considera ofrecer un pase de prueba de 1 USDT.'
    };
  } catch (error) {
    return { error: 'No se pudo obtener el estado: ' + error.message };
  }
      }
