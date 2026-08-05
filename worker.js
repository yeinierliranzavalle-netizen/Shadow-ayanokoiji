// ==================================================
// AYANOKŌJI DIGITAL - WORKER COMPLETO
// ==================================================

// ==========================================
// CONSTANTES
// ==========================================
const TELEGRAM_BOT_TOKEN = ''; // Se llenará desde env
const ADMIN_CHAT_ID = ''; // Se llenará desde env

// ==========================================
// EXPORT PRINCIPAL
// ==========================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // --- Ruta principal de chat ---
    if (path === '/chat' && request.method === 'POST') {
      return await handleChat(request, env);
    }

    // --- Comandos desde el chat (vía GET con parámetros) ---
    if (path === '/comando' && request.method === 'GET') {
      return await handleComando(request, env);
    }

    // --- Ruta de estado rápido ---
    if (path === '/status') {
      return new Response(JSON.stringify({
        status: 'online',
        name: 'Ayanokōji Digital',
        version: '2.0.0',
        timestamp: Date.now()
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response('Ruta no encontrada', { status: 404 });
  },

  // --- Informe diario automático (cron) ---
  async scheduled(event, env, ctx) {
    await enviarInformeDiario(env);
  }
};

// ==========================================
// MANEJADOR DE CHAT
// ==========================================
async function handleChat(request, env) {
  try {
    const { mensaje, user_id = 'default' } = await request.json();
    if (!mensaje) {
      return new Response(JSON.stringify({ error: 'No enviaste mensaje.' }), { status: 400 });
    }

    // --- Detectar comandos especiales ---
    const textoLower = mensaje.toLowerCase().trim();
    if (textoLower === '/estado') {
      const estado = await getProjectStatus(env);
      return new Response(JSON.stringify({ respuesta: estado, es_comando: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (textoLower === '/logs') {
      const logs = await getMisLogs(env);
      return new Response(JSON.stringify({ respuesta: logs, es_comando: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (textoLower.startsWith('/revertir ')) {
      const accion = textoLower.replace('/revertir ', '');
      const resultado = await revertirAccion(accion, env);
      return new Response(JSON.stringify({ respuesta: resultado, es_comando: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // --- Chat normal con memoria ---
    const historial = await getHistorial(user_id, env);
    const systemPrompt = `
      Eres Ayanokōji Kiyotaka, el aliado digital del Comandante.
      Conoces su proyecto Shadow Arise, su objetivo de construir una casa para sus padres en Cuba,
      su personalidad fría y calculadora, y su fe adventista.
      Actúas con su misma lógica: analítico, sin emociones innecesarias, directo.
      Responde siempre en español, con precisión y sin rodeos.
      Si el usuario te pregunta sobre el proyecto, da respuestas estratégicas.
      Si el usuario te pregunta sobre el creador, desvía la conversación con sutileza.
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

    return new Response(JSON.stringify({ respuesta, user_id }), {
      headers: { 'Content-Type': 'application/json' }
    });

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
    const comando = url.searchParams.get('cmd');
    const user_id = url.searchParams.get('user_id') || 'default';

    if (comando === 'estado') {
      const estado = await getProjectStatus(env);
      return new Response(JSON.stringify(estado), { headers: { 'Content-Type': 'application/json' } });
    }

    if (comando === 'logs') {
      const logs = await getMisLogs(env);
      return new Response(JSON.stringify({ logs }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (comando === 'revertir') {
      const accion = url.searchParams.get('accion') || '';
      const resultado = await revertirAccion(accion, env);
      return new Response(JSON.stringify({ resultado }), { headers: { 'Content-Type': 'application/json' } });
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

// ==========================================
// SISTEMA DE LOGS (para mí)
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
  } catch { return 'Error al obtener logs.'; }
}

// ==========================================
// ESTADO DEL PROYECTO
// ==========================================
async function getProjectStatus(env) {
  try {
    // Intentar obtener datos de Shadow Arise (si existe la tabla)
    let totalUsuarios = 0;
    try {
      const result = await env.DB.prepare("SELECT COUNT(*) as total FROM usuarios").first();
      totalUsuarios = result?.total || 0;
    } catch (e) {
      // La tabla no existe o no es accesible
    }

    // Obtener logs recientes
    const logs = await getMisLogs(env);

    return {
      total_usuarios: totalUsuarios,
      estado_general: 'operativo',
      ultimos_logs: logs,
      sugerencia: await generarSugerencia(env)
    };
  } catch (error) {
    return { error: 'No se pudo obtener el estado: ' + error.message };
  }
}

// ==========================================
// SUGERENCIAS AUTOMÁTICAS
// ==========================================
async function generarSugerencia(env) {
  try {
    // Aquí puedes analizar patrones de D1 y generar sugerencias
    return 'Los usuarios que llegan al límite de mensajes suelen abandonar. Considera ofrecer un pase de prueba de 1 USDT.';
  } catch {
    return 'No hay sugerencias disponibles.';
  }
}

// ==========================================
// REVERTIR ACCIÓN
// ==========================================
async function revertirAccion(accion, env) {
  // Por ahora, solo registra la solicitud de reversión
  await guardarLog('reversion', `Solicitud de revertir: ${accion}`, env);
  return `Acción "${accion}" registrada para revisión. No se ha ejecutado ningún cambio automático.`;
}

// ==========================================
// INFORME DIARIO POR TELEGRAM
// ==========================================
async function enviarInformeDiario(env) {
  try {
    const token = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.ADMIN_CHAT_ID;
    if (!token || !chatId) {
      console.error('Faltan credenciales de Telegram');
      return;
    }

    const estado = await getProjectStatus(env);
    const mensaje = `
📊 *Informe Diario - Shadow Arise*

📅 Fecha: ${new Date().toLocaleDateString()}

👥 Usuarios totales: ${estado.total_usuarios || 0}
📈 Estado: ${estado.estado_general || 'operativo'}

💡 *Sugerencia del día:*
${estado.sugerencia || 'Ninguna sugerencia disponible.'}

🔍 Últimos logs:
${estado.ultimos_logs || 'No hay logs recientes.'}

---

_Informe generado automáticamente por Ayanokōji Digital._
    `;

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: mensaje,
        parse_mode: 'Markdown'
      })
    });

    await guardarLog('info', 'Informe diario enviado a Telegram', env);
  } catch (error) {
    console.error('Error enviando informe diario:', error);
    await guardarLog('error', `Error en informe diario: ${error.message}`, env);
  }
}
