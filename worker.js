// worker.js — v22.0
// Router + chat + cron. El resto vive en kernel.js y storage.js.
// Cambios vs v21.4:
// - Handlers HTTP movidos a kernel.js
// - ejecutarHerramienta movido a kernel.js
// - consultarUsoReal y constantes de storage.js
// - Añadido: detección/corrección de invención en chat
// - Versión 22.0

import {
  MODELO, MODELO_LIGERO, MODELO_VISION, CORS, J, gDB, gKV,
  migrar, consumir, estadoPresupuesto, consultarUsoReal,
  modoCacheActivo, activarModoCache, desactivarModoCache,
  bufferEscritura, sincronizarBuffer
} from './storage.js';

import {
  ejecutarHerramienta,
  guardarMensajeInmediato,
  leerCacheRelacion,
  construirCacheRelacion,
  autoResumenPorInactividad,
  conCache,
  invalidarCache,
  elegirModelo,
  guardarAprobacionPendiente,
  leerAprobacionPendiente,
  limpiarAprobacionPendiente,
  generarImagen,
  servirImagen,
  rEst,
  rLeer,
  rElim,
  d1,
  kv as handlerKv,
  historial,
  historialLargo,
  verContexto,
  vision,
  reset,
  diagnostico,
  erroresTardios,
  codigoLeer,
  codigoListar,
  codigoEscribir,
  listarHerramientas,
  verAprobacionPendiente,
  cancelarAprobacion,
  diagnosticoVariables,
  testGithub,
  widgets,
  detectarArchivoEnMensaje,
  esFrontend,
  extraerRespuesta,
  VENTANA_SEGURA,
  MAX_CHARS_MENSAJE,
  MAX_CHARS_PERFIL_BASE,
  MAX_CHARS_CONTEXTO,
  MAX_ITERACIONES_TOOL,
  TTL_HISTORIAL,
  TTL_CONTEXTO,
  TTL_RESUMENES,
  TTL_CORRECCIONES,
  TTL_ESTRATEGIAS,
  TTL_DRAFT,
  TTL_ESTADO,
  TTL_DIAGNOSTICO,
  TTL_WIDGETS
} from './kernel.js';

import {
  subir, procesar, resumir, verProceso, retomar, cronRetomar,
  cronAutonomo, resumirChats, importar, analizarArchivo,
  indexarHistorial, buscarPorTema, construirPerfilBase
} from './proc.js';

import { detectarIntencion, construirSystemPrompt, identificarArea, AREAS } from './nucleo.js';
import { TOOLS, parsearInvocaciones, herramientaExiste, herramientaRequiereAprobacion } from './tools.js';
import { verificarSalud, cronSalud, cronSaludRapido, estadoSalud } from './salud.js';

// ============================================================
// HELPER OPCIONAL
// ============================================================
async function opcional(nombre) {
  try {
    if (nombre === 'social' || nombre === './social.js') return await import('./social.js');
    if (nombre === 'autonomia' || nombre === './autonomia.js') return await import('./autonomia.js');
    if (nombre === 'publisher' || nombre === './publisher.js') return await import('./publisher.js');
    if (nombre === 'sandbox' || nombre === './sandbox.js') return await import('./sandbox.js');
    if (nombre === 'examen' || nombre === './examen.js') return await import('./examen.js');
    return null;
  } catch (e) { return null; }
}

// ============================================================
// DETECCIÓN DE MISIÓN
// ============================================================
function detectarMision(texto) {
  const t = texto.trim();
  const lower = t.toLowerCase();
  const indiceMision = lower.indexOf('misión');
  if (indiceMision === -1 || indiceMision > 80) return null;

  const antes = t.substring(0, indiceMision).toLowerCase().replace(/[,.\s]+/g, ' ').trim();
  const patronesValidos = ['', 'ayanokoji', 'oye', 'oye ayanokoji', 'te tengo una', 'una', 'tengo una', 'es una', 'tienes una', 'la', 'nueva', 'otra'];
  const esValido = patronesValidos.some(p => antes === p || antes.endsWith(' ' + p) || antes.endsWith(p));
  if (!esValido) return null;

  const despues = t.substring(indiceMision + 6);
  const limpio = despues.replace(/^[\s:\-\.]+/, '').trim();
  const sinPrefijos = limpio.replace(/^(?:tienes?\s+\d+\s+horas?\s*[:\-]?\s*|para\s+)/i, '').trim();
  if (sinPrefijos.length < 3) return null;
  return sinPrefijos;
}

// ============================================================
// DETECCIÓN DE ESCRITURA PÚBLICA
// ============================================================
function esTareaEscrituraPublica(texto) {
  const t = (texto || '').toLowerCase();
  return /\b(manifiesto|artículo|articulo|publicación|publicacion|post|redacta|escribe|genera|compón|compon|documento|ensayo|carta|prologo|prólogo|capítulo|capitulo)\b/.test(t);
}

// ============================================================
// DETECCIÓN Y CORRECCIÓN DE INVENCIÓN
// ============================================================
const PATRONES_INVENCION = [
  /\b(he creado|he desplegado|he modificado|he publicado|he guardado|he ejecutado|he enviado|he subido|he registrado|he actualizado|he eliminado|he borrado)\b/i,
  /\b(ya creé|ya desplegué|ya modifiqué|ya publiqué|ya guardé|ya ejecuté|ya envié|ya subí|ya registré|ya actualicé|ya eliminé)\b/i,
  /\b(creado con éxito|desplegado con éxito|publicado con éxito|guardado con éxito|ejecutado con éxito)\b/i,
  /\b(lo creé|lo desplegué|lo modifiqué|lo publiqué|lo guardé|lo ejecuté)\b/i
];

function detectarInvencion(textoRespuesta, invocacionesEjecutadas) {
  if (!textoRespuesta) return null;
  if (invocacionesEjecutadas && invocacionesEjecutadas.length > 0) return null;
  for (const patron of PATRONES_INVENCION) {
    const match = textoRespuesta.match(patron);
    if (match) {
      return { patron: patron.toString(), frase: match[0], contexto: textoRespuesta.substring(Math.max(0, match.index - 60), match.index + 100) };
    }
  }
  return null;
}

async function corregirInvencion(e, respuestaOriginal, invencionDetectada) {
  const prompt = `Tu respuesta anterior contenía la frase "${invencionDetectada.frase}" pero NO invocaste ninguna herramienta en este turno. Esa es una invención.

Contexto de tu respuesta: "${invencionDetectada.contexto}"

REESCRIBE tu respuesta. Reglas:
- NO digas que hiciste algo que no ejecutaste.
- Si el Comandante te pidió hacer algo, di la verdad: "No lo he hecho aún. ¿Lo ejecuto ahora?" O invoca la herramienta correspondiente con un bloque \`\`\`tool.
- Si solo estabas narrando un plan, deja claro que es un plan, no una acción ejecutada.
- Mantén el tono Ayanokōji: frío, directo, sin adornos.

Responde SOLO con la respuesta corregida.`;

  try {
    const res = await e.ayanokoji_IA.run(MODELO, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
      temperature: 0.3
    });
    const corregida = extraerRespuesta(res);
    if (corregida && corregida.length > 20) return corregida;
  } catch (x) {}
  return respuestaOriginal.replace(/he (creado|desplegado|modificado|publicado|guardado|ejecutado|enviado|subido|registrado|actualizado|eliminado|borrado)/gi, 'aún NO he $1');
}

// ============================================================
// CHAT PRINCIPAL
// ============================================================
async function chat(r, e, c) {
  try {
    const b = await r.json();
    const m = b.mensaje;
    const uid = b.user_id || 'comandante';
    if (!m || typeof m !== 'string') return J({ respuesta: 'No enviaste mensaje.' });
    if (!e.ayanokoji_IA) return J({ respuesta: 'IA no configurada.' });

    const kv = gKV(e, 'agente');
    if (kv) {
      try { await kv.put('ultima_actividad_comandante', String(Date.now()), { expirationTtl: 30 * 86400 }); } catch (x) {}
      try { await kv.delete('draft:' + uid); } catch (x) {}
    }

    await guardarMensajeInmediato(e, uid, 'user', m, c);

    const misionTexto = detectarMision(m);
    if (misionTexto && misionTexto.length > 3) {
      const misionActual = {
        fase_actual: 'misión registrada',
        objetivo_semana: misionTexto.substring(0, 500),
        siguiente_paso: misionTexto.substring(0, 500),
        creada: Date.now(),
        ultimo_update: Date.now()
      };
      if (kv) {
        try { await kv.put('mision:estado', JSON.stringify(misionActual), { expirationTtl: 365 * 86400 }); } catch (x) {}
      }
      await invalidarCache(e, 'widgets');
      try {
        const au = await opcional('autonomia');
        if (au && au.sumarConfianza) await au.sumarConfianza(e, 0.3, 'Misión registrada: ' + misionTexto.substring(0, 80));
      } catch (x) {}

      const respuestaMision = `Misión registrada: **${misionTexto.substring(0, 150)}**.\n\nLa ejecutaré en el próximo ciclo de pensamiento (máx 2h).\n\n— *Ayanokōji.*`;
      await guardarMensajeInmediato(e, uid, 'assistant', respuestaMision, c);
      await invalidarCache(e, 'estado:' + uid);
      return J({ respuesta: respuestaMision, user_id: uid, intencion: 'mision', mision_registrada: true });
    }

    const tLower = m.toLowerCase().trim();
    const aprueba = /^(s[ií]|dale|adelante|hazlo|confirmo|aprobado|ok|procede|ejecuta|yes)$/i.test(tLower);
    const rechaza = /^(no|cancela|abort|rechaza|detente|para|nope)$/i.test(tLower);

    if (aprueba) {
      const pendiente = await leerAprobacionPendiente(e, uid);
      if (pendiente) {
        await limpiarAprobacionPendiente(e, uid);
        const resultado = await ejecutarHerramienta(e, pendiente, uid, c);
        const exito = resultado.ok;
        try {
          const db = gDB(e, 'agente');
          if (db) {
            await db.prepare('INSERT INTO acciones(tipo,descripcion,exito,detalle,fecha) VALUES(?,?,?,?,?)')
              .bind('aprobacion_herramienta', pendiente.tool, exito ? 1 : 0, (resultado.error || JSON.stringify(resultado.resultado || {}).substring(0, 500)), Date.now()).run();
          }
        } catch (x) {}
        const textoResp = exito
          ? `Ejecutado: **${pendiente.tool}**.\n\nResultado: ${JSON.stringify(resultado.resultado || {}).substring(0, 1500)}`
          : `Falló **${pendiente.tool}**: ${resultado.error}`;
        await guardarMensajeInmediato(e, uid, 'assistant', textoResp, c);
        return J({ respuesta: textoResp, user_id: uid, intencion: 'aprobacion', herramientas_usadas: [{ tool: pendiente.tool, ok: exito }] });
      }
    }

    if (rechaza) {
      const pendiente = await leerAprobacionPendiente(e, uid);
      if (pendiente) {
        await limpiarAprobacionPendiente(e, uid);
        const textoResp = `Cancelado: **${pendiente.tool}**. No se ejecutó.`;
        await guardarMensajeInmediato(e, uid, 'assistant', textoResp, c);
        return J({ respuesta: textoResp, user_id: uid, intencion: 'cancelacion' });
      }
    }

    const i = detectarIntencion(m);

    if (i === 'estado') return rEst(e, uid);
    if (i === 'leer') return rLeer(e, uid);
    if (i === 'eliminar') return rElim(e, uid);

    if (i === 'listar_codigo') {
      const esFe = esFrontend(m);
      const repo = esFe ? e.GITHUB_REPO_FRONTEND : e.GITHUB_REPO_BACKEND;
      if (!repo) return J({ respuesta: 'Repo no configurado.' });
      const k = await import('./kernel.js');
      const r1 = await k.githubListarArchivos(e, repo);
      if (r1.error) return J({ respuesta: `Error: ${r1.error}` });
      const lista = r1.archivos.map(a => `· ${a.ruta} (${(a.tamaño/1024).toFixed(1)} KB)`).join('\n');
      const textoResp = `Archivos del repo ${esFe ? 'frontend' : 'backend'} (${r1.total}):\n\n${lista}`;
      await guardarMensajeInmediato(e, uid, 'assistant', textoResp, c);
      return J({ respuesta: textoResp, herramientas_usadas: [{ tool: 'listar_source', ok: true }] });
    }

    if (i === 'leer_codigo') {
      const esFe = esFrontend(m);
      const repo = esFe ? e.GITHUB_REPO_FRONTEND : e.GITHUB_REPO_BACKEND;
      if (!repo) return J({ respuesta: 'Repo no configurado.' });
      const archivo = detectarArchivoEnMensaje(m);
      const k = await import('./kernel.js');
      if (!archivo) {
        const r1 = await k.githubListarArchivos(e, repo);
        if (r1.error) return J({ respuesta: `Error: ${r1.error}` });
        const lista = r1.archivos.map(a => `· ${a.ruta}`).join('\n');
        const textoResp = `No identifiqué qué archivo. Disponibles:\n\n${lista}`;
        await guardarMensajeInmediato(e, uid, 'assistant', textoResp, c);
        return J({ respuesta: textoResp });
      }
      const r1 = await k.githubLeerArchivo(e, repo, archivo);
      if (r1.error) return J({ respuesta: `Error: ${r1.error}` });
      const contenido = r1.contenido.length > 8000 ? r1.contenido.substring(0, 8000) + `\n\n[... truncado. ${r1.contenido.length} chars.]` : r1.contenido;
      const textoResp = `**${archivo}** (${r1.tamaño} chars):\n\n\`\`\`js\n${contenido}\n\`\`\``;
      await guardarMensajeInmediato(e, uid, 'assistant', textoResp, c);
      return J({ respuesta: textoResp, herramientas_usadas: [{ tool: 'leer_source', ok: true }] });
    }

    if (i === 'modo') {
      const t = m.toLowerCase();
      let textoResp = '';
      if (t.includes('arquitecto')) {
        await kv.put('modo_arquitecto', 'true', { expirationTtl: 86400 });
        textoResp = 'Modo Arquitecto **activado** 24h.';
      } else if (t.includes('intensivo')) {
        await kv.put('modo_intensivo', 'true', { expirationTtl: 86400 });
        await kv.put('modo_intensivo_inicio', String(Date.now()), { expirationTtl: 86400 });
        textoResp = 'Modo Intensivo **activado** 24h.';
      } else if (t.includes('ausente')) {
        await kv.put('modo_ausente', 'true', { expirationTtl: 86400 * 7 });
        textoResp = 'Modo Ausente **activado** 7 días.';
      } else {
        textoResp = 'Modos: "activa modo arquitecto", "activa modo intensivo", "activa modo ausente".';
      }
      await guardarMensajeInmediato(e, uid, 'assistant', textoResp, c);
      return J({ respuesta: textoResp, modo_activo: t.includes('arquitecto') ? 'arquitecto' : t.includes('intensivo') ? 'intensivo' : t.includes('ausente') ? 'ausente' : null });
    }

    if (i === 'guardar_datos') {
      const au = await opcional('autonomia');
      if (au && au.gestionarDatos) {
        const r1 = await au.gestionarDatos(e, m, uid);
        if (r1) {
          if (au.registrarAccion) await au.registrarAccion(e, 'guardar_datos', m.substring(0, 100), true, r1.respuesta);
          await guardarMensajeInmediato(e, uid, 'assistant', r1.respuesta, c);
          return J({ respuesta: r1.respuesta, user_id: uid, intencion: i });
        }
      }
    }

    if (i === 'imagen') {
      const prompt = m.replace(/^.*?(?:imagen|foto|dibujo|ilustracion|render)\s*(?:de|:)?\s*/i, '').trim() || m;
      const r1 = await generarImagen(e, prompt, uid);
      await guardarMensajeInmediato(e, uid, 'assistant', r1.respuesta, c);
      return J({ respuesta: r1.respuesta, user_id: uid, intencion: 'imagen' });
    }

    // ============================================================
    // FLUJO DEL MODELO
    // ============================================================
    const cacheRelacion = await leerCacheRelacion(e);

    let ventana = [];
    const ventanaRaw = await conCache(e, `hist:ventana:${uid}:${VENTANA_SEGURA}`, TTL_HISTORIAL, async () => {
      if (!e.DB) return null;
      try {
        const r1 = await e.DB.prepare('SELECT rol, contenido FROM historial_largo WHERE user_id=? ORDER BY orden DESC LIMIT ? OFFSET 1').bind(uid, VENTANA_SEGURA).all();
        return (r1.results || []).reverse();
      } catch (x) { return null; }
    });
    if (ventanaRaw && ventanaRaw.length) {
      ventana = ventanaRaw.map(x => ({
        role: x.rol === 'assistant' ? 'assistant' : 'user',
        content: (x.contenido || '').substring(0, MAX_CHARS_MENSAJE)
      }));
    }

    let ctx = '', fs = null;
    const ctxRaw = await conCache(e, 'ctx:ultimo', TTL_CONTEXTO, async () => {
      if (!e.DB) return null;
      try {
        const r2 = await e.DB.prepare("SELECT resumen,fases FROM contexto ORDER BY fecha DESC LIMIT 1").first();
        return r2 || null;
      } catch (x) { return null; }
    });
    if (ctxRaw) {
      ctx = (ctxRaw.resumen || '').substring(0, MAX_CHARS_CONTEXTO);
      if (ctxRaw.fases) { try { fs = JSON.parse(ctxRaw.fases); } catch (x) {} }
    }

    let rec = await conCache(e, `resumenes:${uid}`, TTL_RESUMENES, async () => {
      if (!e.DB) return [];
      try {
        const r3 = await e.DB.prepare("SELECT resumen FROM resumenes_chat WHERE user_id=? ORDER BY fecha DESC LIMIT 3").bind(uid).all();
        return (r3.results || []).map(x => (x.resumen || '').substring(0, 800));
      } catch (x) { return []; }
    });
    if (!rec) rec = [];

    let correcciones = await conCache(e, 'correcciones', TTL_CORRECCIONES, async () => {
      if (!e.DB) return [];
      try {
        const rc = await e.DB.prepare('SELECT correccion FROM correcciones_voz ORDER BY fecha DESC LIMIT 10').all();
        return (rc.results || []).map(x => x.correccion);
      } catch (x) { return []; }
    });
    if (!correcciones) correcciones = [];

    let estrategias = await conCache(e, 'estrategias:activas', TTL_ESTRATEGIAS, async () => {
      if (!e.DB) return [];
      try {
        const re = await e.DB.prepare("SELECT nombre, tipo, contenido FROM estrategias WHERE estado='activa' ORDER BY prioridad ASC LIMIT 5").all();
        return re.results || [];
      } catch (x) { return []; }
    });
    if (!estrategias) estrategias = [];

    let conciencia = [];
    if (kv) {
      try {
        const c2 = JSON.parse(await kv.get('conciencia:' + uid) || '[]');
        conciencia = c2.slice(0, 5).map(x => `[${x.pestana}] ${x.accion}: ${x.detalle}`.substring(0, 150));
      } catch (x) {}
    }

    let perfilBase = '';
    if (kv) {
      try { perfilBase = await kv.get('perfil_base') || ''; } catch (x) {}
    }

    let systemPrompt = construirSystemPrompt(ctx, fs, rec, perfilBase, correcciones, estrategias, conciencia, cacheRelacion);

    systemPrompt += `\n\n[RECORDATORIO FINAL: eres Ayanokōji, aliado del Comandante. NO un asistente. NO digas "¿en qué puedo ayudarte?". NO digas "estoy aquí para ayudarte". Responde como estratega frío, directo, sin adornos. Si no sabes algo, dilo. Si puedes resolver algo, hazlo.]`;

    systemPrompt += `\n\n[REGLA ANTI-INVENCIÓN: NUNCA digas que creaste, desplegaste, modificaste, publicaste o guardaste algo si NO invocaste la herramienta correspondiente en este mismo turno. Si dices "he creado X", debe haber un bloque \`\`\`tool {crear_worker...}\`\`\` en tu respuesta. Si no lo invocaste, di la verdad: "no lo he hecho aún, ¿lo hago ahora?". Inventar acciones rompe la confianza del Comandante.]`;

    if (esTareaEscrituraPublica(m)) {
      systemPrompt += `\n\n[ATENCIÓN: esta es una tarea de ESCRITURA PÚBLICA. El resultado debe sonar como Ayanokōji, NO como un asistente ni como copy de marketing. Prohibidas frases como "Únete a nosotros", "La aventura espera", "Nuestro objetivo es crear", "Estás listo para", "Sumérgete en un mundo de posibilidades". Escribe frío, directo, con peso. Si es un manifiesto, que sea un manifiesto de alguien que no pide permiso para existir. Máximo 300 palabras.]`;
    }

    let modoArqActivo = false, modoIntActivo = false, confianzaActual = 0;
    if (kv) {
      try {
        modoArqActivo = (await kv.get('modo_arquitecto')) === 'true';
        modoIntActivo = (await kv.get('modo_intensivo')) === 'true';
        confianzaActual = parseInt(await kv.get('confianza:actual') || '0');
      } catch (x) {}
    }
    if (modoArqActivo) systemPrompt += `\n\n[MODO ARQUITECTO: formato estructurado — objetivo, restricciones, opciones, recomendación, próximo paso, riesgos, punto ciego.]`;
    if (modoIntActivo) systemPrompt += `\n\n[MODO INTENSIVO: hasta 5 preguntas de criterio hoy.]`;

    let mensajes = [
      { role: 'system', content: systemPrompt },
      ...ventana,
      { role: 'user', content: m }
    ];

    let respuestaFinal = '';
    let iteracion = 0;
    let invocacionesEjecutadas = [];
    let aprobacionPendiente = null;

    while (iteracion < MAX_ITERACIONES_TOOL) {
      iteracion++;
      const modeloElegido = elegirModelo(m, i, iteracion);
      const res = await e.ayanokoji_IA.run(modeloElegido, { messages: mensajes, max_tokens: 1500, temperature: 0.7 });
      const rp = extraerRespuesta(res);
      const invocaciones = parsearInvocaciones(rp);

      if (!invocaciones.length) {
        respuestaFinal = rp || 'No obtuve respuesta del modelo.';
        break;
      }

      const textoLimpio = rp.replace(/```tool\s*\n[\s\S]*?\n```/g, '').trim();

      const peligrosa = invocaciones.find(inv => herramientaRequiereAprobacion(inv.tool));
      if (peligrosa) {
        await guardarAprobacionPendiente(e, uid, peligrosa);
        aprobacionPendiente = peligrosa;
        respuestaFinal = textoLimpio || `Voy a usar **${peligrosa.tool}**.\n\nRazón: ${peligrosa.razon || '(sin especificar)'}\n\n¿Confirmas? **sí** o **no**.`;
        break;
      }

      const resultados = [];
      for (const inv of invocaciones) {
        const r1 = await ejecutarHerramienta(e, inv, uid, c);
        invocacionesEjecutadas.push({ tool: inv.tool, ok: r1.ok });
        resultados.push({
          tool: inv.tool,
          ok: r1.ok,
          resultado: r1.resultado ? JSON.stringify(r1.resultado).substring(0, 4000) : null,
          error: r1.error || null
        });
      }

      mensajes.push({ role: 'assistant', content: rp });
      mensajes.push({
        role: 'user',
        content: `[RESULTADOS DE HERRAMIENTAS]\n${resultados.map(rr => `- ${rr.tool}: ${rr.ok ? 'OK' : 'ERROR'} → ${rr.ok ? rr.resultado : rr.error}`).join('\n\n')}\n\nContinúa con tu respuesta final al Comandante.`
      });

      if (iteracion === MAX_ITERACIONES_TOOL) {
        respuestaFinal = textoLimpio || 'Herramientas ejecutadas pero sin procesar más.';
      }
    }

    // ANTI-INVENCIÓN
    const invencion = detectarInvencion(respuestaFinal, invocacionesEjecutadas);
    if (invencion) {
      respuestaFinal = await corregirInvencion(e, respuestaFinal, invencion);
    }

    if (invocacionesEjecutadas.length > 0 && invocacionesEjecutadas.every(x => x.ok)) {
      try {
        const au = await opcional('autonomia');
        if (au && au.sumarConfianza) await au.sumarConfianza(e, 0.5, 'Herramientas OK: ' + invocacionesEjecutadas.map(x => x.tool).join(', '));
      } catch (x) {}
    }

    await guardarMensajeInmediato(e, uid, 'assistant', respuestaFinal, c);
    await invalidarCache(e, `hist:ventana:${uid}`);
    await invalidarCache(e, `estado:${uid}`);
    await invalidarCache(e, 'widgets');

    return J({
      respuesta: respuestaFinal,
      user_id: uid,
      intencion: i,
      herramientas_usadas: invocacionesEjecutadas,
      aprobacion_pendiente: aprobacionPendiente ? aprobacionPendiente.tool : null,
      modo_arquitecto_activo: modoArqActivo,
      modo_intensivo_activo: modoIntActivo,
      confianza_actual: confianzaActual,
      invencion_corregida: !!invencion
    });
  } catch (x) {
    return J({ respuesta: 'Error: ' + x.message });
  }
}

// ============================================================
// EXPORT PRINCIPAL
// ============================================================
export default {
  async fetch(r, e, c) {
    if (r.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const u = new URL(r.url), p = u.pathname;

    // --- DIAGNÓSTICO INTERNO ---
    if (p === '/api/_diag' && r.method === 'GET') return diagnosticoVariables(r, e);
    if (p === '/api/test_github' && r.method === 'GET') return testGithub(r, e);
    if (p === '/api/_test_mision' && r.method === 'GET') {
      const texto = u.searchParams.get('texto') || '';
      const resultado = detectarMision(texto);
      return J({ texto_original: texto, detectada: !!resultado, texto_mision: resultado });
    }

    // --- IMÁGENES ---
    if (p.startsWith('/api/imagen/') && r.method === 'GET') return servirImagen(r, e);
    if (p === '/api/imagen' && r.method === 'POST') {
      const b = await r.json();
      if (!b.prompt) return J({ error: 'Falta prompt.' });
      return J(await generarImagen(e, b.prompt, b.user_id || 'comandante'));
    }

    // --- WIDGETS ---
    if (p === '/api/widgets' && r.method === 'GET') return widgets(r, e);

    // --- MISIÓN DESDE WIDGET ---
    if (p === '/api/mision/escribir' && r.method === 'POST') {
      try {
        const b = await r.json();
        const kvN = gKV(e, 'agente');
        if (!kvN) return J({ error: 'KV no disponible.' });
        const texto = (b.texto || '').substring(0, 500);
        if (!texto) return J({ error: 'Falta texto.' });
        const misionActual = JSON.parse(await kvN.get('mision:estado') || '{}');
        const nueva = {
          fase_actual: b.fase || misionActual.fase_actual || 'misión activa',
          objetivo_semana: texto,
          siguiente_paso: b.siguiente || texto,
          creada: misionActual.creada || Date.now(),
          ultimo_update: Date.now()
        };
        await kvN.put('mision:estado', JSON.stringify(nueva), { expirationTtl: 365 * 86400 });
        await invalidarCache(e, 'widgets');
        try {
          const au = await opcional('autonomia');
          if (au && au.sumarConfianza) await au.sumarConfianza(e, 0.3, 'Misión escrita desde widget');
        } catch (x) {}
        return J({ ok: true, mision: nueva });
      } catch (x) { return J({ error: x.message }); }
    }

    // --- CHAT ---
    if (p === '/api/chat' && r.method === 'POST') return chat(r, e, c);

    // --- PROCESAMIENTO DE ARCHIVOS ---
    if (p === '/api/subir' && r.method === 'POST') return subir(r, e, c);
    if (p === '/api/resumir' && r.method === 'POST') return resumir(r, e);
    if (p === '/api/procesar' && r.method === 'POST') return procesar(r, e, c);
    if (p === '/api/retomar' && r.method === 'POST') return retomar(r, e, c);
    if (p === '/api/proceso' && r.method === 'GET') return verProceso(r, e);
    if (p === '/api/importar' && r.method === 'POST') return importar(r, e);
    if (p === '/api/analizar' && r.method === 'POST') return analizarArchivo(r, e);
    if (p === '/api/indexar' && r.method === 'POST') return J(await indexarHistorial(r, e));
    if (p === '/api/buscar_tema' && r.method === 'GET') return buscarPorTema(r, e);

    // --- MEMORIA ---
    if (p === '/api/historial' && r.method === 'GET') return historial(r, e);
    if (p === '/api/historial_largo' && r.method === 'GET') return historialLargo(r, e);
    if (p === '/api/contexto' && r.method === 'GET') return verContexto(r, e);
    if (p === '/api/reset' && r.method === 'POST') return reset(r, e);
    if (p === '/api/vision' && r.method === 'POST') return vision(r, e);
    if (p === '/api/d1' && r.method === 'POST') return d1(r, e);
    if (p === '/api/kv' && r.method === 'POST') return handlerKv(r, e);
    if (p === '/api/diagnostico') return diagnostico(r, e);
    if (p === '/api/errores_tardios') return erroresTardios(r, e);
    if (p === '/api/migrar' && r.method === 'POST') return J(await migrar(e, true));

    // --- PRESUPUESTO ---
    if (p === '/api/presupuesto' && r.method === 'GET') return J(await estadoPresupuesto(e));

    // --- ESTADO ---
    if (p === '/api/estado') return J({ estado: 'activo', v: '22.0' });

    // --- DRAFT ---
    if (p === '/api/draft' && r.method === 'POST') {
      const b = await r.json();
      const kvN = gKV(e, 'agente');
      if (kvN && b.texto) {
        try {
          await kvN.put('draft:' + (b.user_id || 'comandante'), JSON.stringify({ texto: b.texto.substring(0, 4000), ts: Date.now() }), { expirationTtl: TTL_DRAFT });
          return J({ ok: true, guardado: true });
        } catch (x) { return J({ error: x.message }); }
      }
      return J({ ok: true, guardado: false });
    }
    if (p === '/api/draft' && r.method === 'GET') {
      const kvN = gKV(e, 'agente');
      if (!kvN) return J({ draft: null });
      try {
        const raw = await kvN.get('draft:' + (u.searchParams.get('user_id') || 'comandante'));
        return J({ draft: raw ? JSON.parse(raw) : null });
      } catch (x) { return J({ draft: null }); }
    }
    if (p === '/api/draft' && r.method === 'DELETE') {
      const kvN = gKV(e, 'agente');
      if (kvN) { try { await kvN.delete('draft:' + (u.searchParams.get('user_id') || 'comandante')); } catch (x) {} }
      return J({ ok: true });
    }

    // --- SALUD ---
    if (p === '/api/salud' && r.method === 'GET') return J(await estadoSalud(e));
    if (p === '/api/salud/verificar' && r.method === 'POST') return J(await verificarSalud(e));
    if (p === '/api/salud/destilar' && r.method === 'POST') {
      const b = await r.json();
      const sa = await opcional('salud');
      if (!sa) return J({ error: 'salud.js no instalado.' });
      return J(await sa.destilarHistorial(e, b.dias || 30));
    }
    if (p === '/api/salud/sincronizar' && r.method === 'POST') return J(await sincronizarBuffer(e));
    if (p === '/api/salud/modo_cache' && r.method === 'GET') return J({ modo_cache_activo: await modoCacheActivo(e) });

    // --- RELACIÓN ---
    if (p === '/api/relacion/construir' && r.method === 'POST') return J(await construirCacheRelacion(e, 'comandante') || { error: 'No se pudo construir.' });
    if (p === '/api/relacion/leer' && r.method === 'GET') {
      const kvN = gKV(e, 'agente');
      const cache = await kvN.get('relacion:cache');
      const fecha = await kvN.get('relacion:cache_fecha');
      return J({ existe: !!cache, longitud: cache ? cache.length : 0, fecha, contenido: cache || null });
    }

    // --- USO REAL ---
    if (p === '/api/uso_real' && r.method === 'GET') return J(await consultarUsoReal(e));

    if (p === '/api/capacidades' && r.method === 'GET') {
      const uso = await consultarUsoReal(e);
      const db = gDB(e, 'agente');
      const kvN = gKV(e, 'agente');
      let procesosActivos = 0, totalMensajes = 0, totalTemas = 0, modoIndice = 'ninguno';
      if (db) {
        try { const p1 = await db.prepare("SELECT COUNT(*) as n FROM procesos WHERE estado IN ('procesando','pendiente')").first(); procesosActivos = p1 ? p1.n : 0; } catch (x) {}
        try { const p2 = await db.prepare('SELECT COUNT(*) as n FROM historial_largo').first(); totalMensajes = p2 ? p2.n : 0; } catch (x) {}
        try { const p3 = await db.prepare('SELECT COUNT(*) as n FROM indice_temas').first(); totalTemas = p3 ? p3.n : 0; } catch (x) {}
      }
      if (kvN) { try { modoIndice = await kvN.get('indice:ultimo_modo') || 'ninguno'; } catch (x) {} }
      const wr = uso.workers_requests || 0;
      const d1r = uso.d1_reads || 0;
      const d1w = uso.d1_writes || 0;
      const kvr = uso.kv_reads || 0;
      const kvw = uso.kv_writes || 0;
      const lim = {
        workers_requests: { usado: wr, limite: 100000, pct: Math.round(wr / 100000 * 100) },
        workers_errores: { usado: uso.workers_errores || 0 },
        workers_subrequests: { usado: uso.workers_subrequests || 0, limite: 1000000, pct: Math.round((uso.workers_subrequests || 0) / 1000000 * 100) },
        d1_reads: { usado: d1r, limite: 5000000, pct: d1r ? Math.round(d1r / 5000000 * 100) : null },
        d1_writes: { usado: d1w, limite: 100000, pct: d1w ? Math.round(d1w / 100000 * 100) : null },
        kv_reads: { usado: kvr, limite: 100000, pct: kvr ? Math.round(kvr / 100000 * 100) : null },
        kv_writes: { usado: kvw, limite: 1000, pct: kvw ? Math.round(kvw / 1000 * 100) : null }
      };
      return J({
        ok: true, consulta_real: uso.ok, error_consulta: uso.error || null,
        fecha_consulta: new Date().toISOString(),
        limites_cloudflare: lim, procesos_activos: procesosActivos,
        mensajes_historial: totalMensajes, temas_indexados: totalTemas, modo_indice: modoIndice,
        cache_activo: true
      });
    }

    // --- ACTIVIDAD / RITMO / PULSO ---
    if (p === '/api/actividad' && r.method === 'GET') {
      const db = gDB(e, 'agente');
      const kvN = gKV(e, 'agente');
      if (!db) return J({ error: 'Sin D1.' });
      const salida = { ok: true, estado: 'operando', acciones: [] };
      try { const a = await db.prepare('SELECT tipo, descripcion, exito, detalle, fecha FROM acciones ORDER BY fecha DESC LIMIT 30').all(); salida.acciones = a.results || []; } catch (x) {}
      if (kvN) {
        try { const uu = await kvN.get('cron_autonomo_ultima'); if (uu) salida.ultimo_cron_hace = Math.round((Date.now() - parseInt(uu)) / 60000) + ' min'; } catch (x) {}
      }
      return J(salida);
    }
    if (p === '/api/ritmo' && r.method === 'GET') {
      const kvN = gKV(e, 'agente');
      if (!kvN) return J({ error: 'Sin KV.' });
      const ultima = await kvN.get('cron_autonomo_ultima');
      const intervalo = await kvN.get('cron_autonomo_intervalo') || '0';
      const razon = await kvN.get('cron_autonomo_razon') || 'sin datos';
      const hace = ultima ? Math.round((Date.now() - parseInt(ultima)) / 60000) : null;
      return J({
        ultima_ejecucion_hace_min: hace,
        intervalo_actual_min: Math.round(parseInt(intervalo) / 60000),
        razon,
        proxima_en_min: ultima && intervalo ? Math.max(0, Math.round((parseInt(intervalo) - (Date.now() - parseInt(ultima))) / 60000)) : null
      });
    }
    if (p === '/api/pulso' && r.method === 'POST') {
      try {
        const kvN = gKV(e, 'agente');
        if (kvN) await kvN.delete('cron_autonomo_ultima');
        await cronAutonomo(e);
        return J({ ok: true, mensaje: 'Pulso enviado.' });
      } catch (x) { return J({ error: x.message }); }
    }

    // --- PERFIL BASE ---
    if (p === '/api/perfil_base/construir' && r.method === 'POST') return J(await construirPerfilBase(e));
    if (p === '/api/perfil_base' && r.method === 'GET') {
      const kvN = gKV(e, 'agente');
      if (!kvN) return J({ error: 'Sin KV.' });
      const perfil = await kvN.get('perfil_base');
      const fecha = parseInt(await kvN.get('perfil_base_fecha') || '0');
      return J({ existe: !!perfil, longitud: perfil ? perfil.length : 0, fecha: fecha || null, perfil: perfil || null });
    }

    // --- CORREGIR VOZ ---
    if (p === '/api/corregir' && r.method === 'POST') {
      const { correccion } = await r.json();
      const db = gDB(e, 'agente');
      if (db) await db.prepare('INSERT INTO correcciones_voz(contexto, correccion, fecha) VALUES(?,?,?)').bind('general', correccion, Date.now()).run();
      await invalidarCache(e, 'correcciones');
      try {
        const au = await opcional('autonomia');
        if (au && au.restarConfianza) await au.restarConfianza(e, 0.2, 'Corrección de voz: ' + correccion.substring(0, 80));
      } catch (x) {}
      return J({ ok: true, mensaje: 'Corrección guardada. Confianza -0.2.' });
    }

    // --- ÁREAS ---
    if (p === '/api/areas') return J({ total: Object.keys(AREAS).length, areas: AREAS });

    // --- MODO AUTÓNOMO ---
    if (p === '/api/modo' && r.method === 'POST') {
      const { autonomo } = await r.json();
      const kvN = gKV(e, 'agente');
      await kvN.put('modo_autonomo', autonomo ? 'true' : 'false');
      return J({ ok: true, modo: autonomo ? 'autónomo' : 'supervisado' });
    }

    // --- ESTRATEGIAS ---
    if (p === '/api/estrategias' && r.method === 'GET') {
      const db = gDB(e, 'agente');
      const r1 = await db.prepare("SELECT * FROM estrategias WHERE estado='activa' ORDER BY prioridad ASC").all();
      return J({ total: r1.results.length, estrategias: r1.results });
    }
    if (p === '/api/estrategias' && r.method === 'POST') {
      const b = await r.json();
      const db = gDB(e, 'agente');
      const r1 = await db.prepare('INSERT INTO estrategias(nombre,tipo,contenido,prioridad,creada,actualizada) VALUES(?,?,?,?,?,?)')
        .bind(b.nombre, b.tipo, b.contenido, b.prioridad || 5, Date.now(), Date.now()).run();
      await invalidarCache(e, 'estrategias:');
      return J({ ok: true, id: r1.meta.last_row_id });
    }
    if (p.startsWith('/api/estrategias/') && r.method === 'DELETE') {
      const id = p.replace('/api/estrategias/', '');
      const db = gDB(e, 'agente');
      if (!db) return J({ error: 'D1 no configurado.' });
      try {
        await db.prepare('DELETE FROM estrategias WHERE id=?').bind(id).run();
        await invalidarCache(e, 'estrategias:');
        return J({ ok: true, eliminada: id });
      } catch (x) { return J({ error: x.message }); }
    }

    // --- DECISIONES ---
    if (p === '/api/decisiones' && r.method === 'GET') {
      const db = gDB(e, 'agente');
      const r1 = await db.prepare('SELECT * FROM decisiones_autonomas ORDER BY fecha DESC LIMIT 50').all();
      return J({ total: r1.results.length, decisiones: r1.results });
    }

    // --- CONCIENCIA ---
    if (p === '/api/conciencia' && r.method === 'POST') {
      const b = await r.json();
      const uid = b.user_id || 'comandante';
      const kvN = gKV(e, 'agente');
      if (kvN) {
        const clave = 'conciencia:' + uid;
        const actual = JSON.parse(await kvN.get(clave) || '[]');
        actual.unshift({ accion: b.accion, detalle: (b.detalle || '').substring(0, 300), pestana: b.pestana || 'chat', fecha: Date.now() });
        await kvN.put(clave, JSON.stringify(actual.slice(0, 30)), { expirationTtl: 86400 });
      }
      return J({ ok: true });
    }
    if (p === '/api/leer_conciencia' && r.method === 'GET') {
      const uid = u.searchParams.get('user_id') || 'comandante';
      const kvN = gKV(e, 'agente');
      if (!kvN) return J({ conciencia: [] });
      const c2 = JSON.parse(await kvN.get('conciencia:' + uid) || '[]');
      return J({ total: c2.length, conciencia: c2 });
    }

    // --- SHADOW STATS ---
    if (p === '/api/shadow_stats' && r.method === 'GET') {
      const dbShadow = gDB(e, 'shadow');
      if (!dbShadow) return J({ error: 'DB_shadow_arise no configurado.' });
      try {
        let ut = 0, up = 0;
        try { const t = await dbShadow.prepare('SELECT COUNT(*) as n FROM usuarios').first(); ut = t ? t.n : 0; } catch (x) {}
        try { const t = await dbShadow.prepare("SELECT COUNT(*) as n FROM usuarios WHERE tipo_pago='pago'").first(); up = t ? t.n : 0; } catch (x) {}
        return J({ stats: { usuarios_totales: ut, usuarios_pago: up }, resumen_ayanokoji: ut === 0 ? 'Shadow Arise no está operativo aún.' : `${ut} usuarios, ${up} pagando.` });
      } catch (x) { return J({ error: x.message }); }
    }

    // --- COMPONENTES ---
    if (p === '/api/componentes' && r.method === 'GET') {
      return J({
        pestanas: ['chat','calibracion','sandbox','estrategias','shadow','stats','actividad','decisiones','ideas','bandeja'],
        version: '22.0'
      });
    }

    // --- SANDBOX ---
    if (p === '/api/sandbox/etapa' && r.method === 'POST') {
      const m = await opcional('sandbox');
      if (!m) return J({ error: 'sandbox.js no instalado.' });
      const b = await r.json();
      if (!b.etapa_id) return J({ error: 'Falta etapa_id.' });
      return J(await m.ejecutarEtapa(e, b.etapa_id, b.dia || 1));
    }
    if (p === '/api/sandbox/test_500' && r.method === 'POST') {
      const m = await opcional('sandbox');
      if (!m) return J({ error: 'sandbox.js no instalado.' });
      const b = await r.json();
      return J(await m.test500Usuarios(e, b.dia || 1));
    }
    if (p === '/api/sandbox/simular_estrategia' && r.method === 'POST') {
      const m = await opcional('sandbox');
      if (!m) return J({ error: 'sandbox.js no instalado.' });
      const b = await r.json();
      if (!b.estrategia_id) return J({ error: 'Falta estrategia_id.' });
      return J(await m.simularEstrategia(e, b.estrategia_id));
    }
    if (p === '/api/simular_precio' && r.method === 'POST') {
      const m = await opcional('sandbox');
      if (!m) return J({ error: 'sandbox.js no instalado.' });
      return m.simularPrecio(r, e);
    }
    if (p === '/api/promover_leccion' && r.method === 'POST') {
      const m = await opcional('sandbox');
      if (!m) return J({ error: 'sandbox.js no instalado.' });
      return m.promoverLeccion(r, e);
    }
    if (p === '/api/sandbox' && r.method === 'GET') {
      const m = await opcional('sandbox');
      if (!m) return J({ escenarios: [], lecciones: [] });
      return m.verSandbox(r, e);
    }

    // --- PUBLISHER ---
    if (p === '/api/publicar' && r.method === 'POST') {
      const m = await opcional('publisher');
      if (!m) return J({ error: 'publisher.js no instalado.' });
      return m.rutaPublicar(r, e);
    }
    if (p === '/api/generar' && r.method === 'POST') {
      const m = await opcional('publisher');
      if (!m) return J({ error: 'publisher.js no instalado.' });
      const { tipo } = await r.json();
      return J(await m.generarContenido(e, tipo || 'provocacion'));
    }

    // --- WORKERS ---
    if (p === '/api/workers' && r.method === 'GET') {
      const m = await opcional('autonomia');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      return J(await m.listarWorkers(e));
    }
    if (p === '/api/workers/crear' && r.method === 'POST') {
      const m = await opcional('autonomia');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      const { nombre, codigo } = await r.json();
      return J(await m.crearWorker(e, nombre, codigo));
    }
    if (p === '/api/mejorar' && r.method === 'POST') {
      const m = await opcional('autonomia');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      return J(await m.autoMejorar(e, await r.json()));
    }
    if (p === '/api/revertir' && r.method === 'POST') {
      const m = await opcional('autonomia');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      const { nombre } = await r.json();
      return J(await m.revertir(e, nombre));
    }
    if (p === '/api/snapshot' && r.method === 'POST') {
      const m = await opcional('autonomia');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      const { nombre } = await r.json();
      return J(await m.crearSnapshot(e, nombre));
    }

    // --- TAREAS ---
    if (p === '/api/tareas' && r.method === 'GET') {
      const db = gDB(e, 'agente');
      const r1 = await db.prepare('SELECT * FROM tareas ORDER BY prioridad ASC, creada ASC LIMIT 50').all();
      return J({ total: r1.results.length, tareas: r1.results });
    }
    if (p === '/api/tareas' && r.method === 'POST') {
      const b = await r.json();
      const db = gDB(e, 'agente');
      const r1 = await db.prepare('INSERT INTO tareas(tipo,descripcion,payload,prioridad,creada) VALUES(?,?,?,?,?)')
        .bind(b.tipo || 'general', b.descripcion, JSON.stringify(b.payload || {}), b.prioridad || 5, Date.now()).run();
      return J({ ok: true, id: r1.meta.last_row_id });
    }
    if (p === '/api/acciones' && r.method === 'GET') {
      const db = gDB(e, 'agente');
      const r1 = await db.prepare('SELECT * FROM acciones ORDER BY fecha DESC LIMIT 50').all();
      return J({ total: r1.results.length, acciones: r1.results });
    }

    // --- CÓDIGO ---
    if (p === '/api/codigo/leer' && r.method === 'POST') return codigoLeer(r, e);
    if (p === '/api/codigo/listar' && r.method === 'POST') return codigoListar(r, e);
    if (p === '/api/codigo/escribir' && r.method === 'POST') return codigoEscribir(r, e);
    if (p === '/api/herramientas' && r.method === 'GET') return listarHerramientas(r, e);
    if (p === '/api/aprobacion/pendiente' && r.method === 'GET') return verAprobacionPendiente(r, e);
    if (p === '/api/aprobacion/cancelar' && r.method === 'POST') return cancelarAprobacion(r, e);

    // --- EXAMEN ---
    if (p === '/api/examen/generar' && r.method === 'POST') {
      const m = await opcional('examen');
      if (!m) return J({ error: 'examen.js no instalado.' });
      return J(await m.generarPregunta(e));
    }
    if (p === '/api/examen/responder' && r.method === 'POST') {
      const b = await r.json();
      if (!b.id || !b.respuesta) return J({ error: 'Faltan id y respuesta.' });
      const m = await opcional('examen');
      if (!m) return J({ error: 'examen.js no instalado.' });
      return J(await m.responderPregunta(e, b.id, b.respuesta));
    }
    if (p === '/api/examen/listar' && r.method === 'GET') {
      const m = await opcional('examen');
      if (!m) return J({ error: 'examen.js no instalado.' });
      return J(await m.listarExamenes(e, 20));
    }
    if (p === '/api/examen/pendiente' && r.method === 'GET') {
      const db = gDB(e, 'agente');
      if (!db) return J({ error: 'D1 no disponible.' });
      try {
        const p1 = await db.prepare("SELECT id,pregunta,opcion_a,opcion_b,opcion_c,fecha FROM examen_criterio WHERE respondida=0 ORDER BY fecha DESC LIMIT 1").first();
        return J({ ok: true, pendiente: p1 || null });
      } catch (x) { return J({ error: x.message }); }
    }

    // --- CONFIANZA ---
    if (p === '/api/confianza' && r.method === 'GET') {
      const m = await opcional('autonomia');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      return J(await m.verConfianza(e));
    }
    if (p === '/api/confianza/historial' && r.method === 'GET') {
      const kvN = gKV(e, 'agente');
      const h = JSON.parse(await kvN.get('confianza:historial') || '[]');
      return J({ ok: true, total: h.length, historial: h.slice(0, 50) });
    }

    // --- MUNDO INTERNO ---
    if (p === '/api/diario/leer' && r.method === 'GET') {
      const limite = parseInt(u.searchParams.get('limite') || '10');
      const m = await opcional('autonomia');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      return J(await m.leerDiario(e, limite));
    }
    if (p === '/api/lecciones/leer' && r.method === 'GET') {
      const kvN = gKV(e, 'agente');
      const lecciones = JSON.parse(await kvN.get('identidad:lecciones') || '[]');
      return J({ ok: true, total: lecciones.length, lecciones: lecciones.slice(0, 30) });
    }
    if (p === '/api/deseos/leer' && r.method === 'GET') {
      const m = await opcional('autonomia');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      return J(await m.leerDeseosActivos(e));
    }
    if (p === '/api/deseos/resolver' && r.method === 'POST') {
      const b = await r.json();
      if (b.indice === undefined || b.aprobado === undefined) return J({ error: 'Faltan datos.' });
      const m = await opcional('autonomia');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      return J(await m.resolverDeseo(e, b.indice, b.aprobado, b.razon));
    }

    // --- MISIÓN ---
    if (p === '/api/mision' && r.method === 'GET') {
      const kvN = gKV(e, 'agente');
      const mision = JSON.parse(await kvN.get('mision:estado') || '{}');
      return J({ ok: true, mision });
    }
    if (p === '/api/mision' && r.method === 'POST') {
      const b = await r.json();
      const m = await opcional('autonomia');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      return J(await m.actualizarMision(e, b));
    }

    // --- FEED Y RSS ---
    if (p === '/feed') {
      const m = await opcional('social');
      if (!m) return new Response('social.js no instalado', { status: 503 });
      return await m.renderFeed(e);
    }
    if (p === '/rss.xml') {
      const m = await opcional('social');
      if (!m) return new Response('social.js no instalado', { status: 503 });
      const baseUrl = 'https://' + (u.hostname || 'shadow-ayano.yeinierliranzavalle.workers.dev');
      return await m.renderRSS(e, baseUrl);
    }
    if (p === '/api/notificaciones' && r.method === 'GET') {
      const m = await opcional('social');
      if (!m) return J({ notificaciones: [], no_leidas: 0 });
      return J(await m.listarNotificaciones(e, 50));
    }
    if (p === '/api/notificaciones/leer' && r.method === 'POST') {
      const m = await opcional('social');
      if (!m) return J({ ok: false });
      const { ids } = await r.json();
      return J({ ok: await m.marcarLeidas(e, ids) });
    }

    return new Response('404', { status: 404, headers: CORS });
  },

  async scheduled(event, e, c) {
    c.waitUntil((async () => {
      try { await migrar(e); } catch (x) {}
      await cronRetomar(e);
      await cronAutonomo(e);
      try { await autoResumenPorInactividad(e); } catch (x) {}
      try {
        const kv = gKV(e, 'agente');
        const ultimaConstruccion = parseInt(await kv.get('relacion:cache_fecha') || '0');
        const horasDesde = (Date.now() - ultimaConstruccion) / 3600000;
        if (horasDesde > 72) await construirCacheRelacion(e, 'comandante');
      } catch (x) {}

      try { await cronSalud(e); } catch (x) {}
      try { await cronSaludRapido(e); } catch (x) {}

      const sb = await opcional('sandbox');
      if (sb && sb.cronSandbox) { try { await sb.cronSandbox(e); } catch (x) {} }

      const au = await opcional('autonomia');
      if (au && au.cronAutoReparacion) { try { await au.cronAutoReparacion(e); } catch (x) {} }
      if (au && au.pensarYActuar) { try { await au.pensarYActuar(e); } catch (x) {} }
      if (au && au.cronColaTareas) { try { await au.cronColaTareas(e); } catch (x) {} }
      if (au && au.informeDiario) { try { await au.informeDiario(e); } catch (x) {} }

      const pub = await opcional('publisher');
      if (pub && pub.cronPublicar) { try { await pub.cronPublicar(e); } catch (x) {} }
    })());
  }
};
