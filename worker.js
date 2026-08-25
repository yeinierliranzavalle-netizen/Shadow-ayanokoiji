// ==================================================
// CONTEXT UPLOADER - CON VERIFICACIÓN DE TAMAÑO
// ==================================================

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // --- RUTA PARA SUBIR ---
    if (path === '/subir' && request.method === 'POST') {
      try {
        const formData = await request.formData();
        const file = formData.get('file');
        if (!file) {
          return new Response(JSON.stringify({
            success: false,
            error: 'No se subió ningún archivo.'
          }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        const texto = await file.text();
        const tamaño = texto.length;

        console.log(`📂 Archivo recibido: ${file.name}, tamaño: ${tamaño} caracteres`);

        // Guardar en KV
        await env.KV.put('contexto_completo', texto);

        console.log(`✅ Contexto guardado en KV: ${tamaño} caracteres`);

        return new Response(JSON.stringify({
          success: true,
          message: `✅ Contexto guardado. Tamaño: ${tamaño} caracteres.`,
          tamaño: tamaño,
          filename: file.name
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });

      } catch (error) {
        console.error('❌ Error al subir:', error);
        return new Response(JSON.stringify({
          success: false,
          error: 'Error al procesar el archivo: ' + error.message
        }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }
    }

    // --- RUTA PARA VERIFICAR (tamaño real) ---
    if (path === '/verificar' && request.method === 'GET') {
      try {
        const texto = await env.KV.get('contexto_completo');
        if (texto) {
          return new Response(JSON.stringify({
            success: true,
            existe: true,
            tamaño: texto.length,
            mensaje: `✅ Contexto encontrado (${texto.length} caracteres)`
          }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        } else {
          return new Response(JSON.stringify({
            success: true,
            existe: false,
            mensaje: '⚠️ No hay contexto guardado.'
          }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Error al verificar: ' + error.message
        }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }
    }

    // --- RUTA PARA OBTENER EL CONTEXTO (para depuración) ---
    if (path === '/obtener' && request.method === 'GET') {
      try {
        const texto = await env.KV.get('contexto_completo');
        if (texto) {
          return new Response(texto, {
            headers: { 'Content-Type': 'text/plain', ...corsHeaders }
          });
        } else {
          return new Response('No hay contexto guardado.', { status: 404, headers: corsHeaders });
        }
      } catch (error) {
        return new Response('Error: ' + error.message, { status: 500, headers: corsHeaders });
      }
    }

    // --- RUTA DE ESTADO ---
    if (path === '/status') {
      return new Response(JSON.stringify({
        status: 'online',
        name: 'Context Uploader',
        version: '2.0.0',
        timestamp: Date.now()
      }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    return new Response('Ruta no encontrada', { status: 404, headers: corsHeaders });
  }
};
