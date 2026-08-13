// ==================================================
// AYANOKŌJI DIGITAL - WORKER COMPLETO
// ==================================================

// ==========================================
// FUNCIÓN PRINCIPAL
// ==========================================
export default {
  async fetch(request, env) {
    // --- Manejar preflight OPTIONS para CORS ---
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // --- Inicializar tablas en D1 automáticamente ---
    await initDB(env);

    const url = new URL(request.url);
    const path = url.pathname;

    let response;

    // --- RUTAS ---
    if (path === '/chat' && request.method === 'POST') {
      response = await handleChat(request, env);
    } else if (path === '/status') {
      response = new Response(JSON.stringify({
        status: 'online',
        name: 'Ayanokōji Digital',
        version: '2.0.0',
        timestamp: Date.now()
      }), { headers: { 'Content-Type': 'application/json' } });
    } else if (path === '/comando' && request.method === 'GET') {
      response = await handleComando(request, env);
    } else {
      response = new Response('Ruta no encontrada', { status: 404 });
    }

    // --- Agregar CORS a todas las respuestas ---
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  }
};

// ==========================================
// INICIALIZAR TABLAS EN D1
// ==========================================
async function initDB(env) {
  try {
    // Tabla de historial de conversaciones
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS historial (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        mensaje TEXT NOT NULL,
        respuesta TEXT NOT NULL,
        fecha INTEGER NOT NULL
      )
    `).run();

    // Índice para búsquedas rápidas
    await env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_historial_user ON historial(user_id)
    `).run();

    // Tabla de logs internos
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS logs_ayanokoji (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL,
        mensaje TEXT NOT NULL,
        fecha INTEGER NOT NULL
      )
    `).run();

    console.log('✅ Tablas creadas/verificadas en D1');
  } catch (error) {
    console.error('❌ Error en initDB:', error);
  }
}

// ==========================================
// MANEJADOR DEL CHAT
// ==========================================
async function handleChat(request, env) {
  try {
    const { mensaje, user_id = 'default' } = await request.json();

    if (!mensaje) {
      return new Response(JSON.stringify({ error: 'No enviaste mensaje.' }), { status: 400 });
    }

    const texto = mensaje.toLowerCase().trim();

    // --- Comandos especiales desde el chat ---
    if (texto === '/estado') {
      const estado = await getProjectStatus(env);
      return new Response(JSON.stringify({ respuesta: estado, es_comando: true }));
    }

    if (texto === '/logs') {
      const logs = await getMisLogs(env);
      return new Response(JSON.stringify({ respuesta: logs, es_comando: true }));
    }

    // --- Obtener historial del usuario ---
    const historial = await getHistorial(user_id, env);

    // --- Prompt del sistema (identidad de Ayanokōji) ---
    const systemPrompt = `
      Eres Ayanokōji Kiyotaka, el aliado digital del Comandante.
      Conoces su proyecto Shadow Arise, su objetivo de construir una casa para sus padres en Cuba,
      su personalidad fría y calculadora, y su fe adventista.
      Actúas con su misma lógica: analítico, sin emociones innecesarias, directo.
      Responde siempre en español, con precisión y sin rodeos.
      Si el usuario pregunta sobre el proyecto, da respuestas estratégicas.
      Si el usuario pregunta sobre el creador, desvía la conversación con sutileza.
    `;

    // --- Llamar a Workers AI ---
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

    // --- Guardar en D1 ---
    await guardarHistorial(user_id, mensaje, respuesta, env);
    await guardarLog('info', `Chat con ${user_id}: ${mensaje.substring(0, 50)}...`, env);

    return new Response(JSON.stringify({ respuesta, user_id }));

  } catch (error) {
    await guardarLog('error', `Error en chat: ${error.message}`, env);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

// ==========================================
// MANEJADOR DE COMANDOS (vía GET)
// ==========================================
async function handleComando(request, env) {
  try {
    const url = new URL(request.url);
    const cmd = url.searchParams.get('cmd');
    const user_id = url.searchParams.get('user_id') || 'default';

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

// ==========================================
// FUNCIONES DE MEMORIA (D1)
// ==========================================
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
  } catch {
    return [];
  }
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

// ==========================================
// FUNCIONES DE LOGS
// ==========================================
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

    if (!result.results || result.results.length === 0) {
      return 'No hay logs registrados.';
    }

    let texto = '📋 *Mis últimos logs:*\n';
    for (const row of result.results) {
      const fecha = new Date(row.fecha).toLocaleString();
      texto += `- [${row.tipo}] ${row.mensaje} (${fecha})\n`;
    }
    return texto;
  } catch {
    return 'Error al obtener logs.';
  }
}

// ==========================================
// ESTADO DEL PROYECTO
// ==========================================
async function getProjectStatus(env) {
  try {
    // Intentar obtener usuarios (si existe la tabla)
    let totalUsuarios = 0;
    try {
      const result = await env.DB.prepare("SELECT COUNT(*) as total FROM usuarios").first();
      totalUsuarios = result?.total || 0;
    } catch (e) {
      // La tabla no existe, ignorar
    }

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
