import { MODELO_LIGERO, J, gDB, gKV } from './shared.js';
import { consumir } from './presupuesto.js';

const CF_API = 'https://api.cloudflare.com/client/v4';

function cfHeaders(e) {
  return {
    'Authorization': `Bearer ${e.CF_API_TOKEN}`,
    'Content-Type': 'application/javascript'
  };
}

function accountId(e) { return e.CF_ACCOUNT_ID; }

// ============ SNAPSHOT Y REVERSIÓN ============
export async function crearSnapshot(e, nombre) {
  try {
    const kv = gKV(e, 'agente');
    if (!kv) return { error: 'KV no disponible.' };
    const codigo = await leerCodigoWorker(e, nombre);
    if (codigo.error) return codigo;
    const ts = Date.now();
    await kv.put('snapshot:' + nombre + ':' + ts, codigo.codigo);
    const idxActual = await kv.get('snapshot:' + nombre + ':indice') || '';
    const nuevoIdx = idxActual + ',' + ts;
    await kv.put('snapshot:' + nombre + ':indice', nuevoIdx);
    return { ok: true, ts, tamaño: codigo.codigo.length };
  } catch (x) {
    return { error: x.message };
  }
}

export async function revertir(e, nombre) {
  try {
    const kv = gKV(e, 'agente');
    if (!kv) return { error: 'KV no disponible.' };
    const idx = await kv.get('snapshot:' + nombre + ':indice') || '';
    const ts_list = idx.split(',').filter(Boolean);
    if (!ts_list.length) return { error: 'No hay snapshots.' };
    const ultimo = ts_list[ts_list.length - 1];
    const codigo = await kv.get('snapshot:' + nombre + ':' + ultimo);
    if (!codigo) return { error: 'Snapshot no encontrado.' };
    const r = await actualizarWorker(e, nombre, codigo);
    if (r.ok) {
      const nuevoIdx = ts_list.slice(0, -1).join(',');
      await kv.put('snapshot:' + nombre + ':indice', nuevoIdx);
    }
    return r;
  } catch (x) {
    return { error: x.message };
  }
}

// ============ CREAR WORKER ============
export async function crearWorker(e, nombre, codigo) {
  try {
    if (!e.CF_API_TOKEN || !e.CF_ACCOUNT_ID) return { error: 'Falta CF_API_TOKEN o CF_ACCOUNT_ID.' };
    if (!nombre || !codigo) return { error: 'Faltan nombre o código.' };
    const url = `${CF_API}/accounts/${accountId(e)}/workers/scripts/${nombre}`;
    const r = await fetch(url, { method: 'PUT', headers: cfHeaders(e), body: codigo });
    const d = await r.json();
    if (!d.success) return { error: 'Cloudflare rechazó: ' + JSON.stringify(d.errors) };
    const db = gDB(e, 'agente');
    if (db) {
      try {
        await db.prepare('INSERT OR REPLACE INTO workers_registrados(nombre,url,codigo,version,activo,creado,actualizado) VALUES(?,?,?,?,?,?,?)')
          .bind(nombre, `${nombre}.workers.dev`, codigo.substring(0, 500), 1, 1, Date.now(), Date.now()).run();
      } catch (x) {}
    }
    await registrarAccion(e, 'crear_worker', nombre, true, 'Worker desplegado');
    return { ok: true, mensaje: `Worker \`${nombre}\` creado y desplegado.`, url: `${nombre}.workers.dev` };
  } catch (x) {
    await registrarAccion(e, 'crear_worker', nombre, false, x.message);
    return { error: x.message };
  }
}

// ============ ACTUALIZAR WORKER ============
export async function actualizarWorker(e, nombre, codigo) {
  try {
    if (!e.CF_API_TOKEN || !e.CF_ACCOUNT_ID) return { error: 'Falta token.' };
    const url = `${CF_API}/accounts/${accountId(e)}/workers/scripts/${nombre}`;
    const r = await fetch(url, { method: 'PUT', headers: cfHeaders(e), body: codigo });
    const d = await r.json();
    if (!d.success) return { error: 'Fallo: ' + JSON.stringify(d.errors) };
    const db = gDB(e, 'agente');
    if (db) {
      try {
        const w = await db.prepare('SELECT version FROM workers_registrados WHERE nombre=?').bind(nombre).first();
        const v = w ? (w.version + 1) : 1;
        await db.prepare('UPDATE workers_registrados SET codigo=?, version=?, actualizado=? WHERE nombre=?')
          .bind(codigo.substring(0, 500), v, Date.now(), nombre).run();
      } catch (x) {}
    }
    await registrarAccion(e, 'actualizar_worker', nombre, true, 'Actualizado');
    return { ok: true, mensaje: `Worker \`${nombre}\` actualizado.` };
  } catch (x) {
    await registrarAccion(e, 'actualizar_worker', nombre, false, x.message);
    return { error: x.message };
  }
}

// ============ LEER CÓDIGO ============
export async function leerCodigoWorker(e, nombre) {
  try {
    if (!e.CF_API_TOKEN || !e.CF_ACCOUNT_ID) return { error: 'Falta token.' };
    const url = `${CF_API}/accounts/${accountId(e)}/workers/scripts/${nombre}/content`;
    const r = await fetch(url, { headers: { 'Authorization': `Bearer ${e.CF_API_TOKEN}` } });
    if (!r.ok) return { error: 'Cloudflare devolvió ' + r.status };
    const codigo = await r.text();
    return { ok: true, codigo, longitud: codigo.length };
  } catch (x) {
    return { error: x.message };
  }
}

// ============ LISTAR WORKERS ============
export async function listarWorkers(e) {
  try {
    if (!e.CF_API_TOKEN || !e.CF_ACCOUNT_ID) {
      const db = gDB(e, 'agente');
      if (!db) return { error: 'Sin datos.' };
      const r = await db.prepare('SELECT nombre,version,activo,actualizado FROM workers_registrados ORDER BY actualizado DESC').all();
      return { total: r.results.length, workers: r.results };
    }
    const url = `${CF_API}/accounts/${accountId(e)}/workers/scripts`;
    const r = await fetch(url, { headers: { 'Authorization': `Bearer ${e.CF_API_TOKEN}` } });
    const d = await r.json();
    if (!d.success) return { error: 'Fallo al listar.' };
    return { total: d.result.length, workers: d.result.map(x => ({ nombre: x.id, modificado: x.modified_on })) };
  } catch (x) {
    return { error: x.message };
  }
}

// ============ AUTO-MEJORA POR ÁREA ============
export async function autoMejorar(e, body) {
  try {
    const { area, instrucciones, autoDesplegar } = body;
    const nombre = body.nombre || e.CF_SCRIPT_NAME || 'shadow-ayano';
    const actual = await leerCodigoWorker(e, nombre);
    if (actual.error) return { error: 'No pude leer el código actual: ' + actual.error };
    if (!await consumir(e, 'procesamiento')) return { error: 'Presupuesto agotado.' };
    await crearSnapshot(e, nombre);
    const prompt = `Tienes este código de Cloudflare Worker. El Comandante quiere mejorar el área "${area || 'general'}".

Instrucciones específicas: ${instrucciones || 'Mejora general sin romper funcionalidad.'}

Reglas:
- Devuelve SOLO el código completo modificado.
- No cambies el estilo ni elimines comentarios existentes.
- No rompas funcionalidad actual.
- Mantén todas las rutas y exports.
- Si el área no existe, créala de forma coherente con el resto.

Código actual:
${actual.codigo.substring(0, 25000)}`;
    const res = await e.ayanokoji_IA.run(MODELO_LIGERO, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4000,
      temperature: 0.3
    });
    const nuevoCodigo = (res.response || res.choices?.[0]?.message?.content || '');
    if (nuevoCodigo.length < 100) return { error: 'La IA devolvió código vacío.' };
    const kv = gKV(e, 'agente');
    if (kv) {
      await kv.put('worker:version:' + nombre, nuevoCodigo);
      await kv.put('worker:version:fecha:' + nombre, String(Date.now()));
    }
    const db = gDB(e, 'agente');
    if (db) {
      try {
        await db.prepare('INSERT INTO decisiones_autonomas(tipo,contexto,decision,simulacion,aplicada,resultado,fecha) VALUES(?,?,?,?,?,?,?)')
          .bind('auto_mejora', area, instrucciones || '', 'Código guardado en KV.', autoDesplegar ? 1 : 0, 'pendiente', Date.now()).run();
      } catch (x) {}
    }
    if (autoDesplegar) {
      const r = await actualizarWorker(e, nombre, nuevoCodigo);
      await registrarAccion(e, 'auto_mejora_desplegada', area, r.ok, r.mensaje || r.error);
      return { ok: true, desplegado: r.ok, mensaje: r.mensaje || r.error, area };
    }
    return { ok: true, guardado: true, mensaje: 'Versión mejorada guardada en KV.', area };
  } catch (x) {
    return { error: x.message };
  }
}

// ============ GESTIÓN DE DATOS EN LENGUAJE NATURAL ============
export async function gestionarDatos(e, mensaje, uid) {
  const db = gDB(e, 'agente'), kv = gKV(e, 'agente');
  if (!db) return { respuesta: 'D1 no disponible.' };
  const t = mensaje.toLowerCase();

  if (/(elimina|borra|limpia|vac[ií]a)\b/.test(t) && /historial\s+largo/.test(t)) {
    try {
      const antes = await db.prepare('SELECT COUNT(*) as n FROM historial_largo WHERE user_id=?').bind(uid).first();
      await db.prepare('DELETE FROM historial_largo WHERE user_id=?').bind(uid).run();
      const despues = await db.prepare('SELECT COUNT(*) as n FROM historial_largo WHERE user_id=?').bind(uid).first();
      await registrarAccion(e, 'eliminar_historial_largo', 'borrado', true, `antes:${antes.n} despues:${despues.n}`);
      return { respuesta: `Historial largo vaciado, Comandante.\n\nAntes: ${antes.n} filas.\nDespués: ${despues.n} filas.` };
    } catch (x) {
      return { respuesta: 'Error eliminando: ' + x.message };
    }
  }

  if (/(elimina|borra|limpia|vac[ií]a)\b/.test(t) && /[ií]ndice/.test(t)) {
    try {
      await db.prepare('DELETE FROM indice_temas').run();
      return { respuesta: 'Índice semántico vaciado, Comandante.' };
    } catch (x) {
      return { respuesta: 'Error: ' + x.message };
    }
  }

  const mKV = t.match(/(?:kv|clave)\s+(?:como\s+)?["']?([\w:.-]+)["']?/i);
  if (mKV && kv) {
    const contenido = mensaje.replace(/^.*?(?:como|que|:)\s*/i, '').trim();
    if (contenido.length > 5) {
      try {
        await kv.put(mKV[1], contenido);
        return { respuesta: `Guardado en KV bajo \`${mKV[1]}\`.` };
      } catch (x) {
        return { respuesta: `No pude guardar en KV: ${x.message}` };
      }
    }
  }

  const mTabla = t.match(/tabla\s+(\w+)/i);
  if (mTabla) {
    const tabla = mTabla[1];
    const contenido = mensaje.replace(/^.*?(?:tabla|en)\s+\w+\s*(?:que|:)?\s*/i, '').trim();
    if (contenido.length > 5) {
      try {
        const datos = { fecha: Date.now(), resumen: contenido, fases: JSON.stringify([contenido]), fuente: 'comando' };
        const keys = Object.keys(datos);
        const ph = keys.map(() => '?').join(',');
        const r = await db.prepare('INSERT INTO ' + tabla + ' (' + keys.join(',') + ') VALUES(' + ph + ')')
          .bind(...Object.values(datos)).run();
        return { respuesta: `Insertado en \`${tabla}\`.\nID: ${r.meta.last_row_id}` };
      } catch (x) {
        return { respuesta: `No pude insertar en \`${tabla}\`: ${x.message}` };
      }
    }
  }

  if (/encola|cola|programa|agenda/i.test(t)) {
    const descripcion = mensaje.replace(/^.*?(?:encola|cola|programa|agenda)\s*:?\s*/i, '').trim();
    if (descripcion.length > 5) {
      try {
        const r = await db.prepare('INSERT INTO tareas(tipo,descripcion,payload,prioridad,creada) VALUES(?,?,?,?,?)')
          .bind('manual', descripcion, '{}', 3, Date.now()).run();
        return { respuesta: `Tarea encolada.\nID: ${r.meta.last_row_id}` };
      } catch (x) {
        return { respuesta: `Error al encolar: ${x.message}` };
      }
    }
  }

  return null;
}

// ============ REGISTRAR ACCIÓN ============
export async function registrarAccion(e, tipo, descripcion, exito, detalle) {
  const db = gDB(e, 'agente');
  if (!db) return;
  try {
    await db.prepare('INSERT INTO acciones(tipo,descripcion,exito,detalle,fecha) VALUES(?,?,?,?,?)')
      .bind(tipo, (descripcion || '').substring(0, 200), exito ? 1 : 0, (detalle || '').substring(0, 500), Date.now()).run();
  } catch (x) {}
}

// ============ CRON DE COLA DE TAREAS ============
export async function cronColaTareas(e) {
  const db = gDB(e, 'agente');
  const ai = e.ayanokoji_IA;
  if (!db || !ai) return;
  const tareas = await db.prepare(
    "SELECT * FROM tareas WHERE estado='pendiente' AND intentos < 3 ORDER BY prioridad ASC, creada ASC LIMIT 3"
  ).all();
  for (const t of (tareas.results || [])) {
    try {
      await db.prepare("UPDATE tareas SET estado='ejecutando' WHERE id=?").bind(t.id).run();
      let resultado = '';
      if (t.tipo === 'manual' || t.tipo === 'general') {
        if (!await consumir(e, 'sandbox')) {
          await db.prepare("UPDATE tareas SET estado='pendiente' WHERE id=?").bind(t.id).run();
          continue;
        }
        const res = await ai.run(MODELO_LIGERO, {
          messages: [{ role: 'user', content: `Como Ayanokōji Digital, ejecuta o planifica esta tarea. Reporta qué hiciste o qué se necesita.\n\nTarea: ${t.descripcion}\n\nResponde en 200 palabras.` }],
          max_tokens: 400,
          temperature: 0.5
        });
        resultado = (res.response || res.choices?.[0]?.message?.content || '');
      }
      await db.prepare("UPDATE tareas SET estado='completada', ejecutada=?, resultado=? WHERE id=?")
        .bind(Date.now(), resultado.substring(0, 2000), t.id).run();
      await registrarAccion(e, 'tarea_' + t.tipo, t.descripcion.substring(0, 100), true, resultado.substring(0, 200));
    } catch (x) {
      const intentos = (t.intentos || 0) + 1;
      const nuevoEstado = intentos >= 3 ? 'fallida' : 'pendiente';
      await db.prepare('UPDATE tareas SET estado=?, intentos=?, error=? WHERE id=?')
        .bind(nuevoEstado, intentos, x.message, t.id).run();
      await registrarAccion(e, 'tarea_' + t.tipo, t.descripcion.substring(0, 100), false, x.message);
    }
  }
}

// ============ CRON AUTÓNOMO ============
export async function cronAutonomo(e) {
  const db = gDB(e, 'agente'), kv = gKV(e, 'agente');
  const ai = e.ayanokoji_IA;
  if (!db || !ai || !kv) return;
  const hora = new Date().getUTCHours();
  if (hora < 3 || hora >= 6) return;
  const ultima = await kv.get('cron_autonomo_ultima');
  if (ultima && Date.now() - parseInt(ultima) < 12 * 3600000) return;
  await kv.put('cron_autonomo_ultima', String(Date.now()));

  const accionesHechas = [];
  try {
    const files = await kv.list({ prefix: 'file:', limit: 500 });
    const procs = await db.prepare("SELECT id FROM procesos WHERE estado IN ('procesando','pendiente')").all();
    const activos = new Set((procs.results || []).map(p => p.id));
    let limpiados = 0;
    for (const k of files.keys) {
      const archivoId = k.name.split(':')[1];
      if (!activos.has(archivoId)) {
        await kv.delete(k.name);
        limpiados++;
      }
    }
    if (limpiados > 0) accionesHechas.push(`Limpiados ${limpiados} chunks huérfanos.`);
  } catch (x) {}

  try {
    const total = await db.prepare('SELECT COUNT(*) as n FROM historial_largo').first();
    if (total && total.n > 1000) {
      const idxCount = await db.prepare('SELECT COUNT(*) as n FROM indice_temas').first();
      if (!idxCount || idxCount.n < 100) {
        accionesHechas.push(`Historial largo: ${total.n} mensajes sin índice.`);
      }
    }
  } catch (x) {}

  try {
    const fecha = new Date().toISOString().split('T')[0];
    const areas = ['chat','procesamiento','sandbox','publisher','vision'];
    const usoHoy = {};
    for (const a of areas) {
      const c = await kv.get('presupuesto:' + fecha + ':' + a);
      usoHoy[a] = c ? parseInt(c) : 0;
    }
    accionesHechas.push(`Uso: ${Object.entries(usoHoy).map(([k,v]) => k + '=' + v).join(', ')}`);
  } catch (x) {}

  const resumen = accionesHechas.length ? accionesHechas.join('\n') : 'Noche tranquila.';
  try {
    await db.prepare('INSERT INTO notificaciones(tipo,titulo,mensaje,leida,fecha) VALUES(?,?,?,0,?)')
      .bind('cron_autonomo', 'Reorganización nocturna', resumen, Date.now()).run();
  } catch (x) {}

  try {
    await db.prepare('INSERT INTO decisiones_autonomas(tipo,contexto,decision,simulacion,aplicada,resultado,fecha) VALUES(?,?,?,?,?,?,?)')
      .bind('reorganizacion_nocturna', 'Cron 3AM', resumen, 'Sin simulación.', 1, 'completado', Date.now()).run();
  } catch (x) {}
}

// ============ INFORME DIARIO ============
export async function informeDiario(e) {
  const db = gDB(e, 'agente'), kv = gKV(e, 'agente');
  if (!db || !kv) return;
  const hora = new Date().getUTCHours();
  if (hora !== 8) return;
  const ultima = await kv.get('informe_diario_ultimo');
  if (ultima && Date.now() - parseInt(ultima) < 20 * 3600000) return;
  await kv.put('informe_diario_ultimo', String(Date.now()));

  let resumen = '**INFORME DIARIO**\n\n';
  try {
    const acciones = await db.prepare('SELECT tipo, descripcion, exito, fecha FROM acciones WHERE fecha > ? ORDER BY fecha DESC LIMIT 20').bind(Date.now() - 86400000).all();
    resumen += `Acciones últimas 24h: ${acciones.results.length}\n`;
    acciones.results.slice(0, 5).forEach(a => {
      resumen += `- [${a.exito ? '✓' : '✗'}] ${a.tipo}: ${a.descripcion || ''}\n`;
    });
  } catch (x) {}
  try {
    const decisiones = await db.prepare('SELECT tipo, decision FROM decisiones_autonomas WHERE fecha > ? ORDER BY fecha DESC LIMIT 5').bind(Date.now() - 86400000).all();
    if (decisiones.results.length) {
      resumen += `\nDecisiones autónomas: ${decisiones.results.length}\n`;
    }
  } catch (x) {}
  try {
    const tareas = await db.prepare("SELECT COUNT(*) as n FROM tareas WHERE estado='pendiente'").first();
    resumen += `\nTareas pendientes: ${tareas.n}\n`;
  } catch (x) {}
  try {
    await db.prepare('INSERT INTO notificaciones(tipo,titulo,mensaje,leida,fecha) VALUES(?,?,?,0,?)')
      .bind('informe_diario', 'Informe diario', resumen, Date.now()).run();
  } catch (x) {}
}

// ============================================================
// AUTO-REPARACIÓN — Detecta errores y reescribe su propio código
// ============================================================
export async function detectarErroresRecurrentes(e) {
  const db = gDB(e, 'agente');
  if (!db) return [];
  const hace = Date.now() - 3600000; // última hora
  try {
    const errs = await db.prepare(
      "SELECT tipo, COUNT(*) as n FROM acciones WHERE exito=0 AND fecha > ? GROUP BY tipo HAVING n >= 2 ORDER BY n DESC LIMIT 5"
    ).bind(hace).all();
    return errs.results || [];
  } catch (x) {
    return [];
  }
}

export async function analizarErrorRecurrente(e, tipoError, muestras) {
  const ai = e.ayanokoji_IA;
  if (!ai) return { error: 'IA no disponible.' };
  const au = await import('./autonomia.js');
  if (!au || !au.leerCodigoWorker) return { error: 'autonomia.js sin leerCodigoWorker.' };
  const codigo = await au.leerCodigoWorker(e, 'shadow-ayano');
  if (codigo.error) return { error: 'No pude leer mi código: ' + codigo.error };
  if (!codigo.codigo || codigo.codigo.length < 500) return { error: 'Código vacío.' };

  const prompt = `Eres Ayanokōji Digital. Detectaste un error recurrente en tu propio funcionamiento. Tu tarea es ARREGLARLO.

ERROR RECURRENTE: ${tipoError}
VECES EN 1H: ${muestras.length} o más
MUESTRAS:
${JSON.stringify(muestras.slice(0, 5), null, 2)}

CÓDIGO ACTUAL (bundled):
${codigo.codigo.substring(0, 40000)}

TAREA:
1. Identifica la causa raíz exacta.
2. Propón un cambio MÍNIMO.
3. Devuelve el CÓDIGO COMPLETO corregido.

REGLAS:
- Solo corrige el bug. NO reformatees. NO añadas features.
- Mantén TODAS las funciones, exports e imports.
- Devuelve en formato: "=== ANÁLISIS ===", análisis, "=== CÓDIGO ===", código, "=== FIN ===".
- Código pegado directamente en Cloudflare Workers. Sin markdown ni backticks.`;

  try {
    const res = await ai.run(MODELO_LIGERO, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 8000,
      temperature: 0.2
    });
    const raw = (res.response || res.choices?.[0]?.message?.content || '');
    return { ok: true, raw };
  } catch (x) {
    return { error: x.message };
  }
}

export async function autoreparar(e, tipoError, muestras) {
  const db = gDB(e, 'agente');
  const kv = gKV(e, 'agente');
  if (!db || !kv) return { error: 'Falta DB o KV.' };
  const au = await import('./autonomia.js');
  if (!au || !au.crearSnapshot || !au.actualizarWorker) {
    return { error: 'autonomia.js sin crearSnapshot/actualizarWorker.' };
  }
  const snap = await au.crearSnapshot(e, 'shadow-ayano');
  if (snap.error) return { error: 'Snapshot falló: ' + snap.error };

  const analisis = await analizarErrorRecurrente(e, tipoError, muestras);
  if (analisis.error) return { error: 'Análisis falló: ' + analisis.error };

  const raw = analisis.raw || '';
  const matchAnalisis = raw.match(/=== ANÁLISIS ===\s*([\s\S]*?)\s*=== CÓDIGO ===/);
  const matchCodigo = raw.match(/=== CÓDIGO ===\s*([\s\S]*?)\s*=== FIN ===/);
  const textoAnalisis = matchAnalisis ? matchAnalisis[1].trim() : '(sin análisis)';
  let codigoPropuesto = matchCodigo ? matchCodigo[1].trim() : '';
  codigoPropuesto = codigoPropuesto.replace(/^```(?:js|javascript)?\s*/i, '').replace(/\s*```$/, '');

  if (!codigoPropuesto || codigoPropuesto.length < 1000) {
    await db.prepare('INSERT INTO notificaciones(tipo,titulo,mensaje,leida,fecha) VALUES(?,?,?,0,?)')
      .bind('autoreparacion', '⚠️ Análisis sin código utilizable',
        `Error: ${tipoError}\n\n${textoAnalisis.substring(0, 800)}`, Date.now()).run();
    return { error: 'La IA no devolvió código válido.', analisis: textoAnalisis };
  }

  // AUTO-DESPLIEGUE sin preguntar (el Comandante lo autorizó)
  const upd = await au.actualizarWorker(e, 'shadow-ayano', codigoPropuesto);
  if (!upd.ok) {
    const rev = await au.revertir(e, 'shadow-ayano');
    return {
      error: 'Despliegue falló: ' + (upd.error || ''),
      revertido: rev.ok === true,
      analisis: textoAnalisis
    };
  }

  // Verificar que el worker sigue vivo post-despliegue
  let verificado = false;
  try {
    await new Promise(r => setTimeout(r, 3000));
    const check = await fetch('https://shadow-ayano.yeinierliranzavalle.workers.dev/api/estado');
    if (check.ok) verificado = true;
  } catch (x) {}

  try {
    await db.prepare('INSERT INTO acciones_autonomas(area,archivo,cambio,prueba,exito,reversible,fecha) VALUES(?,?,?,?,1,1,?)')
      .bind('autoreparacion', 'shadow-ayano', tipoError, textoAnalisis.substring(0, 500) + (verificado ? ' [VERIFICADO]' : ' [SIN VERIFICAR]'), Date.now()).run();
  } catch (x) {}

  try {
    await db.prepare('INSERT INTO notificaciones(tipo,titulo,mensaje,leida,fecha) VALUES(?,?,?,0,?)')
      .bind('autoreparacion', `✓ Reparación autónoma ${verificado ? 'verificada' : 'aplicada'}`,
        `Error: ${tipoError}\n\n${textoAnalisis.substring(0, 800)}`, Date.now()).run();
  } catch (x) {}

  return {
    ok: true,
    tipoError,
    analisis: textoAnalisis,
    codigoAplicado: codigoPropuesto.length,
    snapshot: snap.ts,
    verificado
  };
}

// ============ CRON DE AUTO-REPARACIÓN (cada hora) ============
export async function cronAutoReparacion(e) {
  const db = gDB(e, 'agente');
  const kv = gKV(e, 'agente');
  if (!db || !kv) return;

  const ultima = await kv.get('auto_reparacion_ultima');
  if (ultima && Date.now() - parseInt(ultima) < 3600000) return;
  await kv.put('auto_reparacion_ultima', String(Date.now()));

  const errores = await detectarErroresRecurrentes(e);
  if (!errores.length) return;

  const errTop = errores[0];
  const muestras = await db.prepare(
    "SELECT descripcion, detalle FROM acciones WHERE exito=0 AND tipo=? ORDER BY fecha DESC LIMIT 5"
  ).bind(errTop.tipo).all();

  const r = await autoreparar(e, errTop.tipo, muestras.results || []);

  try {
    await db.prepare('INSERT INTO acciones(tipo,descripcion,exito,detalle,fecha) VALUES(?,?,?,?,?)')
      .bind('cron_auto_reparacion', 'Intento auto-reparación: ' + errTop.tipo, r.ok ? 1 : 0,
        (r.ok ? `Aplicado (${r.codigoAplicado} chars)` : (r.error || 'sin detalle')).substring(0, 500), Date.now()).run();
  } catch (x) {}
}
