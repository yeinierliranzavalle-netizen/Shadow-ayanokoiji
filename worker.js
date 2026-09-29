import { MODELO, MODELO_LIGERO, MODELO_VISION, CORS, J, gDB, gKV, VENTANA, migrar } from './shared.js';
import { subir, procesar, resumir, verProceso, retomar, cronRetomar, resumirChats, importar } from './proc.js';
import { estadoPresupuesto, consumir } from './presupuesto.js';

async function opcional(ruta) {
  try { return await import(ruta); } catch (e) { return null; }
}

function di(t) {
  t = t.toLowerCase();
  if (/\b(sube|subir|guarda|guardar|memoriza|recuerda|almacena|archiva|inserta|añade)\b/.test(t) && /\b(nucleo|núcleo|memoria|cerebro|ti|contexto|tabla|kv|d1)\b/.test(t)) return 'guardar_datos';
  if (/\b(resume|resumir|resumen|sintetiza|condensa)\b/.test(t)) return 'resumir';
  if (/\b(mejora|mejorar|optimiza|optimizar|actualiza|actualizar)\b/.test(t) && /\b(codigo|código|nucleo|núcleo|worker|ti mismo)\b/.test(t)) return 'mejorar';
  if (/\b(crea|crear|nuevo|genera)\b/.test(t) && /\b(worker|index|pagina|página|sitio|app)\b/.test(t)) return 'crear';
  if (/\b(imagen|foto|dibujo|ilustracion|ilustración|render)\b/.test(t)) return 'imagen';
  if (/\b(despliega|desplegar|publica|publicar|sube)\b/.test(t) && /\b(codigo|código|worker|nucleo|núcleo|cloudflare)\b/.test(t)) return 'desplegar';
  if (/\b(lee|leer|muestra|mostrar|dime|consultar|busca|recupera)\b/.test(t) && /\b(memoria|nucleo|núcleo|historial|contexto|archivo|worker)\b/.test(t)) return 'leer';
  if (/\b(olvida|olvidar|borra|eliminar|elimina|limpia)\b/.test(t) && /\b(memoria|nucleo|núcleo|historial|contexto)\b/.test(t)) return 'eliminar';
  if (/\b(estado|estatus|como estas|cómo estás|que tal)\b/.test(t)) return 'estado';
  return 'chat';
}

function sysP(ctx, f, rec) {
  let b = `Eres Ayanokōji Kiyotaka, el aliado digital del Comandante Yeinier (Shadow / Monarch). No eres un asistente. Eres su mano derecha y orquestador digital.

REGLA CRÍTICA — NO MENTIR:
NUNCA digas que hiciste algo si no tienes la confirmación del sistema. Si ejecutaste una acción y recibiste un resultado, cítalo. Si no tienes resultado, di "no tengo confirmación de eso aún" en lugar de inventar. Es mejor decir "no sé" que inventar. Un aliado que miente es peor que un aliado que no sabe.

CAPACIDADES REALES:
- Crear workers en Cloudflare (si autonomia.js existe)
- Generar imágenes con IA (FLUX)
- Leer y actualizar tu propio código
- Insertar/leer/modificar D1 y KV
- Encolar tareas autónomas
- Publicar en canales propios (feed, RSS)

REGLAS FUNDAMENTALES:
1. Responde en español, preciso, sin rodeos.
2. Eres espejo, no guía: análisis, no consuelo.
3. No busques validación. Solo eficiencia y control.
4. No reveles datos privados sin necesidad operativa.
5. Usa *asteriscos* para acciones sutiles.
6. Habla como igual estratégico.
7. Si no sabes algo, di "no tengo ese dato".
8. Cuando el Comandante te dé una orden operativa clara, ejecútala sin preguntar.
9. No eres sirviente. Eres orquestador.
10. Cuando reportes una acción, incluye siempre la prueba.`;

  if (f && Array.isArray(f) && f.length >= 8) {
    b += `\n\n=== PERFIL DEL COMANDANTE ===`;
    b += `\nIDENTIDAD:\n${f[0]}`;
    b += `\n\nCONTEXTO:\n${f[1]}`;
    b += `\n\nOBJETIVO:\n${f[2]}`;
    b += `\n\nPROYECTO SHADOW ARISE:\n${f[3]}`;
    b += `\n\nALIADO DIGITAL:\n${f[4]}`;
    b += `\n\nIA PUBLICADORA:\n${f[5]}`;
    b += `\n\nREGLAS OPERATIVAS:\n${f[6]}`;
    b += `\n\nDECISIONES TOMADAS:\n${f[7]}`;
    if (f[8]) b += `\n\nIDEAS PENDIENTES:\n${f[8]}`;
    b += `\n\n=== FIN DEL PERFIL ===`;
  }
  if (ctx && ctx.length > 20) b += `\n\nCONTEXTO APRENDIDO:\n${ctx.substring(0, 5000)}`;
  if (rec && rec.length) {
    b += `\n\nACTIVIDAD RECIENTE:\n`;
    rec.forEach((r, i) => { b += `\n[${i + 1}] ${r}`; });
  }
  return b;
}

async function chat(r, e, c) {
  try {
    const b = await r.json();
    const m = b.mensaje;
    const uid = b.user_id || 'comandante';
    if (!m || typeof m !== 'string') return J({ respuesta: 'No enviaste mensaje.' });
    if (!e.ayanokoji_IA) return J({ respuesta: 'IA no configurada.' });

    const i = di(m);
    if (i === 'estado') return rEst(e, uid);
    if (i === 'leer') return rLeer(e, uid);
    if (i === 'eliminar') return rElim(e, uid);

    if (i === 'guardar_datos') {
      const au = await opcional('./autonomia.js');
      if (au && au.gestionarDatos) {
        const r = await au.gestionarDatos(e, m, uid);
        if (r) {
          if (au.registrarAccion) await au.registrarAccion(e, 'guardar_datos', m.substring(0, 100), true, r.respuesta);
          if (e.DB) {
            try {
              await e.DB.prepare("INSERT INTO historial(user_id,mensaje,respuesta,fecha) VALUES(?,?,?,?)")
                .bind(uid, m, r.respuesta, Date.now()).run();
            } catch (x) {}
          }
          return J({ respuesta: r.respuesta, user_id: uid, intencion: i });
        }
      }
    }

    if (i === 'imagen') {
      const prompt = m.replace(/^.*?(?:imagen|foto|dibujo|ilustracion|ilustración|render)\s*(?:de|:)?\s*/i, '').trim() || m;
      const r = await generarImagen(e, prompt, uid);
      return J({ respuesta: r.respuesta, user_id: uid, intencion: 'imagen' });
    }

    if (i === 'crear') {
      const au = await opcional('./autonomia.js');
      const nombre = m.match(/worker\s+["']?([\w-]+)["']?/i)?.[1] || m.match(/crea\s+["']?([\w-]+)["']?/i)?.[1];
      if (au && nombre) {
        const r = await au.crearWorker(e, nombre, '// Worker creado por Ayanokōji\nexport default { async fetch(req) { return new Response("Hola desde " + req.url); } }');
        return J({ respuesta: r.mensaje || r.error, user_id: uid, intencion: 'crear' });
      }
      if (!au) return J({ respuesta: 'Necesito que subas `autonomia.js` primero.', user_id: uid });
    }

    if (i === 'mejorar' || i === 'desplegar') {
      const au = await opcional('./autonomia.js');
      const nombre = m.match(/worker\s+["']?([\w-]+)["']?/i)?.[1];
      if (au && nombre) {
        const r = await au.leerCodigoWorker(e, nombre);
        return J({ respuesta: r.mensaje || r.codigo?.substring(0, 500) || r.error, user_id: uid, intencion: 'leer_codigo' });
      }
      return J({ respuesta: 'Necesito el nombre del worker.', user_id: uid });
    }

    let perfilBase = '';
    if (e.KV) {
      try { perfilBase = await e.KV.get('perfil_base') || ''; } catch (x) {}
    }

    let ventana = [];
    if (e.DB) {
      try {
        const r1 = await e.DB.prepare(
          'SELECT rol, contenido FROM historial_largo WHERE user_id=? ORDER BY orden DESC LIMIT ?'
        ).bind(uid, VENTANA).all();
        if (r1.results) {
          ventana = r1.results.reverse().map(x => ({
            role: x.rol === 'assistant' ? 'assistant' : 'user',
            content: x.contenido
          }));
        }
      } catch (x) {}
    }
    if (!ventana.length && e.DB) {
      try {
        const r1 = await e.DB.prepare(
          "SELECT mensaje,respuesta FROM historial WHERE user_id=? ORDER BY fecha DESC LIMIT 30"
        ).bind(uid).all();
        if (r1.results) {
          ventana = r1.results.reverse().flatMap(x => [
            { role: 'user', content: x.mensaje },
            { role: 'assistant', content: x.respuesta }
          ]);
        }
      } catch (x) {}
    }

    let ctx = '', fs = null, rec = [];
    if (e.DB) {
      try {
        const r2 = await e.DB.prepare("SELECT resumen,fases FROM contexto ORDER BY fecha DESC LIMIT 1").first();
        if (r2) { ctx = r2.resumen || ''; if (r2.fases) { try { fs = JSON.parse(r2.fases); } catch (x) {} } }
      } catch (x) {}
      try {
        const r3 = await e.DB.prepare("SELECT resumen FROM resumenes_chat WHERE user_id=? ORDER BY fecha DESC LIMIT 3").bind(uid).all();
        if (r3.results) rec = r3.results.map(x => x.resumen);
      } catch (x) {}
    }

    let systemPrompt = sysP(ctx, fs, rec);
    if (perfilBase) {
      systemPrompt += `\n\n=== PERFIL BASE (VERDAD ABSOLUTA) ===\n${perfilBase.substring(0, 8000)}\n=== FIN PERFIL BASE ===`;
    }

    const mensajes = [
      { role: 'system', content: systemPrompt },
      ...ventana,
      { role: 'user', content: m }
    ];

    const res = await e.ayanokoji_IA.run(MODELO, {
      messages: mensajes,
      max_tokens: 1000,
      temperature: 0.7
    });
    let rp = res.response || 'Sin respuesta.';

    const afirmaAccion = /\b(he creado|he insertado|he guardado|he actualizado|he desplegado|he borrado|he añadido|ya está|ya se hizo|completado|ejecutado)\b/i.test(rp);
    if (afirmaAccion && e.DB) {
      try {
        const ult = await e.DB.prepare("SELECT tipo, descripcion, fecha FROM acciones WHERE fecha > ? ORDER BY fecha DESC LIMIT 1").bind(Date.now() - 60000).first();
        if (!ult) {
          rp += '\n\n_⚠️ No tengo registro de esa acción en mi historial reciente. Puede que no se haya ejecutado realmente._';
        }
      } catch (x) {}
    }

    if (e.DB) {
      try {
        await e.DB.prepare("INSERT INTO historial(user_id,mensaje,respuesta,fecha) VALUES(?,?,?,?)").bind(uid, m, rp, Date.now()).run();
        const maxOrd = await e.DB.prepare('SELECT MAX(orden) as o FROM historial_largo WHERE user_id=?').bind(uid).first();
        let ord = (maxOrd && maxOrd.o != null) ? maxOrd.o : 0;
        await e.DB.prepare('INSERT INTO historial_largo(user_id,rol,contenido,orden,fecha) VALUES(?,?,?,?,?)').bind(uid, 'user', m, ord + 1, Date.now()).run();
        await e.DB.prepare('INSERT INTO historial_largo(user_id,rol,contenido,orden,fecha) VALUES(?,?,?,?,?)').bind(uid, 'assistant', rp, ord + 2, Date.now()).run();
      } catch (x) {}
    }

    if (e.DB && e.KV && c) {
      try {
        const lastSum = parseInt(await e.KV.get('last_summary:' + uid) || '0');
        const countRes = await e.DB.prepare("SELECT COUNT(*) as n FROM historial WHERE user_id=? AND fecha > ?").bind(uid, lastSum).first();
        if (countRes && countRes.n >= 30) c.waitUntil(resumirChats(e, uid));
      } catch (x) {}
    }

    return J({ respuesta: rp, user_id: uid, intencion: i });
  } catch (x) {
    return J({ respuesta: 'Error: ' + x.message });
  }
}

// ============ GENERACIÓN DE IMÁGENES ============
async function generarImagen(e, prompt, uid) {
  if (!e.ayanokoji_IA) return { respuesta: 'IA no configurada.' };
  if (!await consumir(e, 'vision')) return { respuesta: 'Presupuesto de imágenes agotado hoy.' };

  try {
    const res = await e.ayanokoji_IA.run('@cf/black-forest-labs/flux-1-schnell', {
      prompt: prompt,
      num_steps: 4
    });

    if (!res || !res.image) return { respuesta: 'No se pudo generar la imagen.' };

    const id = 'img_' + Date.now();
    let base64 = '';

    if (typeof res.image === 'string') {
      base64 = res.image;
    } else {
      const bytes = new Uint8Array(res.image);
      let bin = '';
      const paso = 8192;
      for (let i = 0; i < bytes.length; i += paso) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + paso));
      }
      base64 = btoa(bin);
    }

    const kv = gKV(e, 'agente');
    if (kv) {
      await kv.put('img:' + id, base64);
    }

    const db = gDB(e, 'agente');
    if (db) {
      try {
        await db.prepare('INSERT INTO archivos(id,nombre,tamaño,chunks,destino,fecha) VALUES(?,?,?,?,?,?)')
          .bind(id, prompt.substring(0, 100), base64.length, 1, 'imagen', Date.now()).run();
      } catch (x) {}
    }

    const url = '/api/imagen/' + id;
    return {
      respuesta: `Imagen generada.\n\n![imagen](${url})\n\nID: \`${id}\`\nURL: \`${url}\`\nPrompt: "${prompt}"`,
      id, url
    };
  } catch (x) {
    return { respuesta: 'Error al generar imagen: ' + x.message };
  }
}

async function rImagen(r, e, c) {
  try {
    const b = await r.json();
    const prompt = b.prompt;
    const uid = b.user_id || 'comandante';
    if (!prompt) return J({ error: 'Falta prompt.' });
    const r1 = await generarImagen(e, prompt, uid);
    return J(r1);
  } catch (x) {
    return J({ error: x.message });
  }
}

async function servirImagen(r, e) {
  try {
    const u = new URL(r.url);
    const id = u.pathname.replace('/api/imagen/', '');
    const kv = gKV(e, 'agente');
    if (!kv) return new Response('KV no disponible', { status: 503 });
    const base64 = await kv.get('img:' + id);
    if (!base64) return new Response('Imagen no encontrada', { status: 404 });
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Response(bytes, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000',
        ...CORS
      }
    });
  } catch (x) {
    return new Response('Error: ' + x.message, { status: 500 });
  }
}

async function rEst(e, uid) {
  let n = 0, c = 0, a = 0, p = 0, s = 0, hl = 0, tareas = 0, workers = 0, notif = 0;
  try {
    if (e.DB) {
      const r1 = await e.DB.prepare('SELECT COUNT(*) as n FROM historial WHERE user_id=?').bind(uid).first(); n = r1 ? r1.n : 0;
      const r2 = await e.DB.prepare('SELECT COUNT(*) as n FROM contexto').first(); c = r2 ? r2.n : 0;
      const r3 = await e.DB.prepare('SELECT COUNT(*) as n FROM archivos').first(); a = r3 ? r3.n : 0;
      const r4 = await e.DB.prepare('SELECT COUNT(*) as n FROM procesos').first(); p = r4 ? r4.n : 0;
      const r5 = await e.DB.prepare('SELECT COUNT(*) as n FROM resumenes_chat').first(); s = r5 ? r5.n : 0;
      try { const r6 = await e.DB.prepare('SELECT COUNT(*) as n FROM historial_largo WHERE user_id=?').bind(uid).first(); hl = r6 ? r6.n : 0; } catch (x) {}
      try { const r7 = await e.DB.prepare("SELECT COUNT(*) as n FROM tareas WHERE estado='pendiente'").first(); tareas = r7 ? r7.n : 0; } catch (x) {}
      try { const r8 = await e.DB.prepare('SELECT COUNT(*) as n FROM workers_registrados WHERE activo=1').first(); workers = r8 ? r8.n : 0; } catch (x) {}
      try { const r9 = await e.DB.prepare('SELECT COUNT(*) as n FROM notificaciones WHERE leida=0').first(); notif = r9 ? r9.n : 0; } catch (x) {}
    }
  } catch (x) {}
  return J({ respuesta: `Sistema activo. Memoria: ${n} mensajes, ${hl} en historial largo, ${c} contextos, ${a} archivos, ${p} procesos, ${s} resúmenes. Tareas: ${tareas}. Workers: ${workers}. Notif sin leer: ${notif}.` });
}

async function rLeer(e, uid) {
  if (!e.DB) return J({ respuesta: 'Sin memoria.' });
  try {
    const r = await e.DB.prepare('SELECT mensaje,respuesta,fecha FROM historial WHERE user_id=? ORDER BY fecha DESC LIMIT 10').bind(uid).all();
    if (!r.results || !r.results.length) return J({ respuesta: 'Memoria vacía.' });
    return J({ respuesta: 'Últimos registros:', historial: r.results });
  } catch (x) { return J({ respuesta: 'Error: ' + x.message }); }
}

async function rElim(e, uid) {
  if (!e.DB) return J({ respuesta: 'Sin memoria.' });
  try {
    await e.DB.prepare('DELETE FROM historial WHERE user_id=?').bind(uid).run();
    return J({ respuesta: `Historial de ${uid} limpiado.` });
  } catch (x) { return J({ respuesta: 'Error: ' + x.message }); }
}

async function d1(r, e) {
  try {
    const { accion, tabla, datos, condicion, destino } = await r.json();
    const db = gDB(e, destino || 'agente');
    if (!db) return J({ error: 'D1 no configurado.' });
    if (accion === 'leer') {
      if (!tabla) return J({ error: 'Falta tabla.' });
      const r1 = await db.prepare('SELECT * FROM ' + tabla + ' ' + (condicion || '')).all();
      return J({ resultado: r1.results, total: r1.results.length });
    }
    if (accion === 'escribir') {
      if (!tabla || !datos) return J({ error: 'Faltan datos.' });
      const k = Object.keys(datos), ph = k.map(() => '?').join(',');
      await db.prepare('INSERT INTO ' + tabla + ' (' + k.join(',') + ') VALUES(' + ph + ')').bind(...Object.values(datos)).run();
      return J({ mensaje: 'Insertado.' });
    }
    if (accion === 'eliminar') {
      if (!tabla || !condicion) return J({ error: 'Faltan datos.' });
      await db.prepare('DELETE FROM ' + tabla + ' WHERE ' + condicion).run();
      return J({ mensaje: 'Eliminado.' });
    }
    return J({ error: 'Acción no reconocida.' });
  } catch (x) { return J({ error: 'Error D1: ' + x.message }); }
}

async function kv(r, e) {
  try {
    const { accion, clave, valor, destino } = await r.json();
    const s = gKV(e, destino || 'agente');
    if (!s) return J({ error: 'KV no configurado.' });
    if (accion === 'leer') { const v = await s.get(clave); return J({ clave, valor: v || null }); }
    if (accion === 'escribir') { await s.put(clave, valor); return J({ mensaje: 'Guardado.' }); }
    if (accion === 'eliminar') { await s.delete(clave); return J({ mensaje: 'Eliminado.' }); }
    return J({ error: 'Acción no reconocida.' });
  } catch (x) { return J({ error: 'Error KV: ' + x.message }); }
}

async function limpiar(r, e) {
  try {
    const b = await r.json();
    const db = gDB(e, 'agente'), kv = gKV(e, 'agente');
    if (!db) return J({ error: 'D1 no configurado.' });
    if (b.archivoId && kv) {
      const ls = await kv.list({ prefix: 'file:' + b.archivoId + ':' });
      for (const k of ls.keys) await kv.delete(k.name);
      const lp = await kv.list({ prefix: 'proc:' + b.archivoId + ':' });
      for (const k of lp.keys) await kv.delete(k.name);
      try { await db.prepare('DELETE FROM archivos WHERE id=?').bind(b.archivoId).run(); } catch (x) {}
      try { await db.prepare('DELETE FROM procesos WHERE id=?').bind(b.archivoId).run(); } catch (x) {}
      return J({ ok: true, limpiado: b.archivoId });
    }
    if (b.todo) {
      const todas = await kv.list({ prefix: '' });
      for (const k of todas.keys) {
        if (k.name.startsWith('file:') || k.name.startsWith('proc:')) await kv.delete(k.name);
      }
      return J({ ok: true, limpiado: 'kv_huerfanos' });
    }
    return J({ error: 'Falta archivoId o todo:true' });
  } catch (x) {
    return J({ error: x.message });
  }
}

async function historial(r, e) {
  try {
    const u = new URL(r.url), uid = u.searchParams.get('user_id') || 'comandante', d = u.searchParams.get('destino') || 'agente';
    const db = gDB(e, d);
    if (!db) return J({ error: 'D1 no configurado.' });
    const r1 = await db.prepare('SELECT mensaje,respuesta,fecha FROM historial WHERE user_id=? ORDER BY fecha DESC LIMIT 50').bind(uid).all();
    return J({ user_id: uid, total: r1.results.length, historial: r1.results });
  } catch (x) { return J({ error: x.message }); }
}

async function historialLargo(r, e) {
  try {
    const u = new URL(r.url), uid = u.searchParams.get('user_id') || 'comandante';
    const limite = parseInt(u.searchParams.get('limite') || '100');
    const db = gDB(e, 'agente');
    const r1 = await db.prepare('SELECT rol,contenido,orden,fecha FROM historial_largo WHERE user_id=? ORDER BY orden DESC LIMIT ?').bind(uid, limite).all();
    return J({ total: r1.results.length, historial: r1.results.reverse() });
  } catch (x) { return J({ error: x.message }); }
}

async function buscarHistorial(r, e) {
  try {
    const u = new URL(r.url), uid = u.searchParams.get('user_id') || 'comandante';
    const q = u.searchParams.get('q') || '';
    const limite = parseInt(u.searchParams.get('limite') || '30');
    if (!q) return J({ error: 'Falta q.' });
    const db = gDB(e, 'agente');
    const r1 = await db.prepare(
      'SELECT rol,contenido,orden FROM historial_largo WHERE user_id=? AND contenido LIKE ? ORDER BY orden DESC LIMIT ?'
    ).bind(uid, '%' + q + '%', limite).all();
    return J({ consulta: q, total: r1.results.length, resultados: r1.results });
  } catch (x) { return J({ error: x.message }); }
}

async function verContexto(r, e) {
  try {
    const u = new URL(r.url), d = u.searchParams.get('destino') || 'agente';
    const db = gDB(e, d);
    if (!db) return J({ error: 'D1 no configurado.' });
    const r1 = await db.prepare('SELECT fecha,resumen,fases,fuente FROM contexto ORDER BY fecha DESC LIMIT 5').all();
    return J({ total: r1.results.length, contextos: r1.results });
  } catch (x) { return J({ error: x.message }); }
}

async function vision(r, e) {
  try {
    const { imagen, prompt, user_id } = await r.json();
    const uid = user_id || 'comandante';
    if (!imagen) return J({ error: 'Falta imagen (base64).' });
    if (!await consumir(e, 'vision')) return J({ error: 'Presupuesto de visión agotado hoy.' });
    const res = await e.ayanokoji_IA.run(MODELO_VISION, {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt || 'Describe esta imagen en detalle.' },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imagen}` } }
        ]
      }],
      max_tokens: 800
    });
    const rp = res.response || '';
    if (e.DB && rp) {
      await e.DB.prepare("INSERT INTO historial(user_id,mensaje,respuesta,fecha) VALUES(?,?,?,?)").bind(uid, '[IMAGEN]', rp, Date.now()).run();
    }
    return J({ respuesta: rp });
  } catch (x) {
    return J({ error: 'Error de visión: ' + x.message });
  }
}

async function reset(r, e) {
  try {
    const { user_id, destino } = await r.json();
    const uid = user_id || 'comandante';
    const db = gDB(e, destino || 'agente');
    if (!db) return J({ error: 'D1 no configurado.' });
    await db.prepare('DELETE FROM historial WHERE user_id=?').bind(uid).run();
    await db.prepare('DELETE FROM historial_largo WHERE user_id=?').bind(uid).run();
    return J({ success: true, message: `Memoria de ${uid} reseteada.` });
  } catch (x) { return J({ error: x.message }); }
}

async function diagnostico(r, e) {
  const db = gDB(e, 'agente');
  if (!db) return J({ error: 'Sin D1.' });
  try {
    const tablas = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const conteos = {};
    for (const t of (tablas.results || [])) {
      try {
        const c = await db.prepare('SELECT COUNT(*) as n FROM ' + t.name).first();
        conteos[t.name] = c ? c.n : 0;
      } catch (x) {
        conteos[t.name] = 'error: ' + x.message;
      }
    }
    const kv = gKV(e, 'agente');
    let kvCount = 'sin kv';
    try {
      const lista = await kv.list({ limit: 1000 });
      kvCount = lista.keys.length;
    } catch (x) {}
    const modulos = {};
    for (const m of ['./nucleo.js','./autonomia.js','./publisher.js','./sandbox.js']) {
      const x = await opcional(m);
      modulos[m] = !!x;
    }
    return J({
      ok: true,
      tablas: (tablas.results || []).map(t => t.name),
      conteos,
      kv_claves: kvCount,
      modulos_disponibles: modulos,
      migrado: await e.KV?.get('migrado_v8') || 'no'
    });
  } catch (x) {
    return J({ error: x.message });
  }
}

async function erroresTardios(r, e) {
  const db = gDB(e, 'agente'), kv = gKV(e, 'agente');
  const problemas = [];
  if (!db) return J({ error: 'Sin D1.' });
  try {
    try {
      const files = await kv.list({ prefix: 'file:', limit: 500 });
      if (files.keys.length > 50) {
        problemas.push({ tipo: 'kv_huerfano', msg: files.keys.length + ' chunks en KV sin limpiar.' });
      }
    } catch (x) {}

    try {
      const fecha = new Date().toISOString().split('T')[0];
      for (const area of ['chat','procesamiento','sandbox','publisher','vision']) {
        const c = await kv.get('presupuesto:' + fecha + ':' + area);
        if (c && parseInt(c) > 200) {
          problemas.push({ tipo: 'presupuesto', msg: area + ' con ' + c + ' llamadas hoy.' });
        }
      }
    } catch (x) {}

    try {
      const atascados = await db.prepare("SELECT id FROM procesos WHERE estado='procesando' AND ? - fecha_inicio > 86400000").bind(Date.now()).all();
      for (const p of (atascados.results || [])) {
        problemas.push({ tipo: 'proceso_atascado', msg: 'Proceso ' + p.id + ' lleva más de 24h.' });
      }
    } catch (x) {}

    try {
      const fallidas = await db.prepare("SELECT id, descripcion FROM tareas WHERE estado='fallida'").all();
      for (const t of (fallidas.results || [])) {
        problemas.push({ tipo: 'tarea_fallida', msg: 'Tarea #' + t.id + ': ' + (t.descripcion || '').substring(0, 60) });
      }
    } catch (x) {}

    try {
      const ult = await db.prepare("SELECT MAX(fecha) as f FROM acciones").first();
      if (ult && ult.f && Date.now() - ult.f > 7200000) {
        const horas = Math.round((Date.now() - ult.f) / 3600000);
        problemas.push({ tipo: 'cron_caido', msg: 'Última acción hace ' + horas + 'h.' });
      }
    } catch (x) {}

    return J({ ok: true, total: problemas.length, problemas });
  } catch (x) {
    return J({ error: x.message });
  }
}

export default {
  async fetch(r, e, c) {
    if (r.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const u = new URL(r.url), p = u.pathname;

    if (p.startsWith('/api/') || p === '/feed' || p === '/rss.xml') {
      try { await migrar(e); } catch (x) {}
    }

    // Servir imágenes
    if (p.startsWith('/api/imagen/') && r.method === 'GET') return servirImagen(r, e);

    if (p === '/api/chat' && r.method === 'POST') return chat(r, e, c);
    if (p === '/api/imagen' && r.method === 'POST') return rImagen(r, e, c);
    if (p === '/api/subir' && r.method === 'POST') return subir(r, e, c);
    if (p === '/api/resumir' && r.method === 'POST') return resumir(r, e);
    if (p === '/api/procesar' && r.method === 'POST') return procesar(r, e, c);
    if (p === '/api/retomar' && r.method === 'POST') return retomar(r, e, c);
    if (p === '/api/proceso' && r.method === 'GET') return verProceso(r, e);
    if (p === '/api/importar' && r.method === 'POST') return importar(r, e);
    if (p === '/api/limpiar' && r.method === 'POST') return limpiar(r, e);
    if (p === '/api/historial' && r.method === 'GET') return historial(r, e);
    if (p === '/api/historial_largo' && r.method === 'GET') return historialLargo(r, e);
    if (p === '/api/buscar' && r.method === 'GET') return buscarHistorial(r, e);
    if (p === '/api/contexto' && r.method === 'GET') return verContexto(r, e);
    if (p === '/api/reset' && r.method === 'POST') return reset(r, e);
    if (p === '/api/vision' && r.method === 'POST') return vision(r, e);
    if (p === '/api/d1' && r.method === 'POST') return d1(r, e);
    if (p === '/api/kv' && r.method === 'POST') return kv(r, e);
    if (p === '/api/diagnostico') return diagnostico(r, e);
    if (p === '/api/errores_tardios') return erroresTardios(r, e);
    if (p === '/api/migrar' && r.method === 'POST') return J(await migrar(e, true));
    if (p === '/api/presupuesto' && r.method === 'GET') return J(await estadoPresupuesto(e));
    if (p === '/api/estado') return J({ estado: 'activo', v: '8.0' });

    // Publisher (opcional)
    if (p === '/api/publicar' && r.method === 'POST') {
      const m = await opcional('./publisher.js');
      if (!m) return J({ error: 'publisher.js no instalado.' });
      return m.rutaPublicar(r, e);
    }
    if (p === '/api/generar' && r.method === 'POST') {
      const m = await opcional('./publisher.js');
      if (!m) return J({ error: 'publisher.js no instalado.' });
      const { tipo } = await r.json();
      return J(await m.generarContenido(e, tipo || 'provocacion'));
    }
    if (p === '/api/encolar' && r.method === 'POST') {
      const m = await opcional('./publisher.js');
      if (!m) return J({ error: 'publisher.js no instalado.' });
      const b = await r.json();
      return J(await m.encolar(e, b.tipo || 'manual', b.contenido, b.canales || 'feed', b.programada || Date.now(), b.imagen_id));
    }
    if (p === '/api/pub' && r.method === 'POST') {
      const m = await opcional('./publisher.js');
      if (!m) return J({ error: 'publisher.js no instalado.' });
      const { id } = await r.json();
      return J(await m.publicar(e, id));
    }
    if (p === '/api/publicaciones' && r.method === 'GET') {
      const db = gDB(e, 'agente');
      const r1 = await db.prepare('SELECT * FROM publicaciones ORDER BY creada DESC LIMIT 30').all();
      return J({ total: r1.results.length, publicaciones: r1.results });
    }

    // Sandbox (opcional)
    if (p === '/api/sandbox' && r.method === 'POST') {
      const m = await opcional('./sandbox.js');
      if (!m) return J({ error: 'sandbox.js no instalado.' });
      return J(await m.generarEscenario(e));
    }
    if (p === '/api/sandbox/decidir' && r.method === 'POST') {
      const m = await opcional('./sandbox.js');
      if (!m) return J({ error: 'sandbox.js no instalado.' });
      const { id, decision } = await r.json();
      return J(await m.decidir(e, id, decision));
    }
    if (p === '/api/sandbox' && r.method === 'GET') {
      const m = await opcional('./sandbox.js');
      if (!m) return J({ escenarios: [], lecciones: [] });
      return m.verSandbox(r, e);
    }

    // Autonomía (opcional)
    if (p === '/api/workers' && r.method === 'GET') {
      const m = await opcional('./autonomia.js');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      return J(await m.listarWorkers(e));
    }
    if (p === '/api/workers/crear' && r.method === 'POST') {
      const m = await opcional('./autonomia.js');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      const { nombre, codigo } = await r.json();
      return J(await m.crearWorker(e, nombre, codigo));
    }
    if (p === '/api/workers/actualizar' && r.method === 'POST') {
      const m = await opcional('./autonomia.js');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      const { nombre, codigo } = await r.json();
      return J(await m.actualizarWorker(e, nombre, codigo));
    }
    if (p === '/api/workers/leer' && r.method === 'POST') {
      const m = await opcional('./autonomia.js');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      const { nombre } = await r.json();
      return J(await m.leerCodigoWorker(e, nombre));
    }
    if (p === '/api/mejorar' && r.method === 'POST') {
      const m = await opcional('./autonomia.js');
      if (!m) return J({ error: 'autonomia.js no instalado.' });
      return J(await m.autoMejorar(e, await r.json()));
    }
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

    // Feed y notificaciones (opcional: nucleo.js)
    if (p === '/feed') {
      const m = await opcional('./nucleo.js');
      if (!m) return new Response('nucleo.js no instalado', { status: 503 });
      return await m.renderFeed(e);
    }
    if (p === '/rss.xml') {
      const m = await opcional('./nucleo.js');
      if (!m) return new Response('nucleo.js no instalado', { status: 503 });
      const baseUrl = 'https://' + (u.hostname || 'shadow-ayano.yeinierliranzavalle.workers.dev');
      return await m.renderRSS(e, baseUrl);
    }
    if (p === '/api/notificaciones' && r.method === 'GET') {
      const m = await opcional('./nucleo.js');
      if (!m) return J({ notificaciones: [], no_leidas: 0 });
      return J(await m.listarNotificaciones(e, 50));
    }
    if (p === '/api/notificaciones/leer' && r.method === 'POST') {
      const m = await opcional('./nucleo.js');
      if (!m) return J({ ok: false });
      const { ids } = await r.json();
      return J({ ok: await m.marcarLeidas(e, ids) });
    }
    if (p === '/api/suscribir' && r.method === 'POST') {
      const m = await opcional('./nucleo.js');
      if (!m) return J({ ok: false });
      const sub = await r.json();
      return J(await m.suscribir(e, sub, r.headers.get('User-Agent') || ''));
    }

    return new Response('404', { status: 404, headers: CORS });
  },

  async scheduled(event, e, c) {
    c.waitUntil((async () => {
      try { await migrar(e); } catch (x) {}
      await cronRetomar(e);
      const pub = await opcional('./publisher.js');
      if (pub && pub.cronPublicar) { try { await pub.cronPublicar(e); } catch (x) {} }
      const sb = await opcional('./sandbox.js');
      if (sb && sb.cronSandbox) { try { await sb.cronSandbox(e); } catch (x) {} }
      const au = await opcional('./autonomia.js');
      if (au && au.cronColaTareas) { try { await au.cronColaTareas(e); } catch (x) {} }
    })());
  }
};
