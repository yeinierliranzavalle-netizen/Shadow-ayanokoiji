// ==================================================
// AYANOKŌJI DIGITAL - WORKER COMPLETO (MODULAR)
// ==================================================

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        // --- RUTAS ---
        if (path === '/chat' && request.method === 'POST') {
            return await handleChat(request, env);
        }
        if (path === '/subir' && request.method === 'POST') {
            return await handleUpload(request, env);
        }
        if (path === '/analizar' && request.method === 'POST') {
            return await handleAnalyze(request, env);
        }
        if (path === '/eliminar' && request.method === 'POST') {
            return await handleDelete(request, env);
        }
        if (path === '/historial' && request.method === 'GET') {
            return await handleHistory(request, env);
        }
        if (path === '/status') {
            return new Response(JSON.stringify({ status: 'online', name: 'Ayanokōji Digital' }), { headers: { 'Content-Type': 'application/json' } });
        }

        return new Response('Ruta no encontrada', { status: 404 });
    }
};

// ==========================================
// CHAT
// ==========================================
async function handleChat(request, env) {
    try {
        const { mensaje, user_id } = await request.json();
        if (!mensaje) return errorResponse('No enviaste mensaje.');

        const userId = user_id || 'default';
        const historial = await getHistorial(userId, env);

        const systemPrompt = `Eres Ayanokōji Kiyotaka, aliado digital del Comandante. ... (tu prompt completo) ...`;

        const ai = env.ayanokoji_IA;
        const response = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
            messages: [
                { role: 'system', content: systemPrompt },
                ...historial,
                { role: 'user', content: mensaje }
            ],
            max_tokens: 600,
            temperature: 0.7
        });

        const respuesta = response.response || 'No pude procesar tu mensaje.';
        await guardarHistorial(userId, mensaje, respuesta, env);

        return jsonResponse({ respuesta, user_id: userId });
    } catch (e) {
        return errorResponse(e.message);
    }
}

// ==========================================
// SUBIR ARCHIVO
// ==========================================
async function handleUpload(request, env) {
    try {
        const formData = await request.formData();
        const archivo = formData.get('archivo');
        const user_id = formData.get('user_id') || 'default';
        if (!archivo) return errorResponse('No se envió ningún archivo.');

        // Aquí puedes guardar el archivo en R2 o KV, o solo registrar su nombre
        const nombre = archivo.name;
        const tamaño = archivo.size;
        const tipo = archivo.type;

        // Guardar en D1 (opcional)
        await env.DB.prepare(
            "INSERT INTO archivos (user_id, nombre, tamaño, tipo, fecha) VALUES (?, ?, ?, ?, ?)"
        ).bind(user_id, nombre, tamaño, tipo, Date.now()).run();

        return jsonResponse({ mensaje: `✅ Archivo "${nombre}" subido (${tamaño} bytes)`, nombre, tamaño });
    } catch (e) {
        return errorResponse(e.message);
    }
}

// ==========================================
// ANALIZAR IMAGEN
// ==========================================
async function handleAnalyze(request, env) {
    try {
        const formData = await request.formData();
        const imagen = formData.get('imagen');
        const user_id = formData.get('user_id') || 'default';
        if (!imagen) return errorResponse('No se envió ninguna imagen.');

        // Convertir imagen a base64 para enviar a IA (si se requiere)
        const buffer = await imagen.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

        // Aquí puedes llamar a la IA para analizar la imagen (si el modelo soporta visión)
        // Por ahora, simulamos un análisis básico
        const analisis = `Imagen: ${imagen.name}, Tamaño: ${imagen.size} bytes, Tipo: ${imagen.type}. Análisis simulado.`;

        return jsonResponse({ analisis });
    } catch (e) {
        return errorResponse(e.message);
    }
}

// ==========================================
// ELIMINAR
// ==========================================
async function handleDelete(request, env) {
    try {
        const { id, user_id } = await request.json();
        if (!id) return errorResponse('ID requerido.');

        // Puedes eliminar de D1 según el campo que uses (id o user_id)
        await env.DB.prepare(
            "DELETE FROM historial WHERE id = ? OR user_id = ?"
        ).bind(id, id).run();

        return jsonResponse({ mensaje: `✅ Elemento(s) eliminado(s) para ID: ${id}` });
    } catch (e) {
        return errorResponse(e.message);
    }
}

// ==========================================
// HISTORIAL
// ==========================================
async function handleHistory(request, env) {
    try {
        const url = new URL(request.url);
        const user_id = url.searchParams.get('user_id') || 'default';

        const result = await env.DB.prepare(
            "SELECT mensaje, respuesta, fecha FROM historial WHERE user_id = ? ORDER BY fecha DESC LIMIT 50"
        ).bind(user_id).all();

        return jsonResponse({ user_id, total: result.results.length, historial: result.results });
    } catch (e) {
        return errorResponse(e.message);
    }
}

// ==========================================
// FUNCIONES AUXILIARES (D1)
// ==========================================
async function getHistorial(userId, env) {
    try {
        const result = await env.DB.prepare(
            "SELECT mensaje, respuesta FROM historial WHERE user_id = ? ORDER BY fecha DESC LIMIT 10"
        ).bind(userId).all();
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
    } catch (e) { console.error(e); }
}

// ==========================================
// UTILIDADES
// ==========================================
function jsonResponse(data) {
    return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' }
    });
}

function errorResponse(msg) {
    return jsonResponse({ error: msg });
    }
