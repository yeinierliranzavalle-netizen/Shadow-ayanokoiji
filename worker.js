// ==================================================
// CONTEXT UPLOADER - Worker minimalista
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

    // --- RUTA PARA SUBIR EL ARCHIVO ---
    if (path === '/subir' && request.method === 'POST') {
      try {
        const formData = await request.formData();
        const file = formData.get('file');

        if (!file) {
          return new Response(JSON.stringify({
            success: false,
            error: 'No se subió ningún archivo.'
          }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const texto = await file.text();
        const tamaño = texto.length;

        // Guardar en KV
        await env.KV.put('contexto_completo', texto);

        console.log(`✅ Contexto guardado: ${tamaño} caracteres`);

        return new Response(JSON.stringify({
          success: true,
          message: `✅ Contexto guardado correctamente. Tamaño: ${tamaño} caracteres.`,
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

    // --- RUTA PARA VERIFICAR SI EL CONTEXTO EXISTE ---
    if (path === '/verificar' && request.method === 'GET') {
      try {
        const contexto = await env.KV.get('contexto_completo');
        if (contexto) {
          return new Response(JSON.stringify({
            success: true,
            existe: true,
            tamaño: contexto.length,
            mensaje: `✅ Contexto encontrado (${contexto.length} caracteres)`
          }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        } else {
          return new Response(JSON.stringify({
            success: true,
            existe: false,
            mensaje: '⚠️ No hay contexto guardado aún.'
          }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Error al verificar: ' + error.message
        }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }
    }

    // --- RUTA DE ESTADO ---
    if (path === '/status') {
      return new Response(JSON.stringify({
        status: 'online',
        name: 'Context Uploader',
        version: '1.0.0',
        timestamp: Date.now()
      }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    return new Response('Ruta no encontrada', { status: 404, headers: corsHeaders });
  }
};
