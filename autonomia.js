// autonomia.js — Ciclo de vida de Ayanokōji Digital (v5.1)
// Cambios v5.1:
// - validarSintaxis + deploySeguro (validación antes de desplegar, snapshot, verificación, reversión)
// - autoreparar usa deploySeguro (simplificado, sin doble snapshot)
// - autoMejorar usa deploySeguro cuando autoDesplegar=true
// - pensarYActuar ejecuta ACCION: con ejecutarHerramienta (importación dinámica de worker.js)
// - pensarYActuar tiene flag anti-reentrada (en_ciclo_autonomo)

import { MODELO, MODELO_LIGERO, gDB, gKV } from './shared.js';
import { consumir } from './presupuesto.js';

const CF_API = 'https://api.cloudflare.com/client/v4';

function extraerRespuesta(res) {
  if (!res) return '';
  if (typeof res === 'string') return res;
  if (typeof res.response === 'string' && res.response.length > 0) return res.response;
  if (res.choices && res.choices[0]) {
    const c = res.choices[0];
    const msg = c.message || {};
    if (typeof msg.content === 'string' && msg.content.trim().length > 0) return msg.content;
    if (msg.content === null && typeof msg.reasoning === 'string' && msg.reasoning.trim().length > 0) return msg.reasoning;
    if (typeof c.text === 'string' && c.text.trim().length > 0) return c.text;
  }
  if (typeof res.result?.response === 'string') return res.result.response;
  if (res.result?.choices?.[0]?.message?.content && typeof res.result.choices[0].message.content === 'string') return res.result.choices[0].message.content;
  if (res.result?.choices?.[0]?.message?.reasoning && typeof res.result.choices[0].message.reasoning === 'string') return res.result.choices[0].message.reasoning;
  if (typeof res.output === 'string') return res.output;
  return '';
}

function cfHeaders(e) {
  return {
    'Authorization': `Bearer ${e.CF_API_TOKEN}`,
    'Content-Type': 'application/javascript'
  };
}

function accountId(e) { return e.CF_ACCOUNT_ID; }

// ============================================================
// GESTIÓN DE WORKERS
// ============================================================
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

export async function leerCodigoWorker(e, nombre) {
  try {
    if (!e.CF_API_TOKEN || !e.CF_ACCOUNT_ID) return { error: 'Falta token.' };
    const url = `${CF_API}/accounts/${accountId(e)}/workers/scripts/${nombre}/content`;
    const r = await fetch(url, { headers: { 'Authorization': `Bearer ${e.CF_API_TOKEN}` } });
    if (!r.ok) return { error: 'Cloudflare devolvió ' + r.status };
    const codigo = await r.text();
    return { ok: true, codigo, longitud: codigo.length };
  } catch (x) { return { error: x.message }; }
}

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
  } catch (x) { return { error: x.message }; }
}

// ============================================================
// SNAPSHOTS Y REVERSIÓN
// ============================================================
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
  } catch (x) { return { error: x.message }; }
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
  } catch (x) { return { error: x.message }; }
}

// ============================================================
// AUTO-MEJORA — v5.1: deploySeguro cuando autoDesplegar=true
// ============================================================
export async function autoMejorar(e, body) {
  try {
    const { area, instrucciones, autoDesplegar } = body;
    const nombre = body.nombre || e.CF_SCRIPT_NAME || 'shadow-ayano';
    const actual = await leerCodigoWorker(e, nombre);
    if (actual.error) return { error: 'No pude leer el código actual: ' + actual.error };
    if (!await consumir(e, 'procesamiento')) return { error: 'Presupuesto agotado.' };
    // Snapshot solo si NO vamos a desplegar (deploySeguro ya lo hace)
    if (!autoDesplegar) {
      await crearSnapshot(e, nombre);
    }
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
    const nuevoCodigo = extraerRespuesta(res);
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
      const r = await deploySeguro(e, nombre, nuevoCodigo);
      await registrarAccion(e, 'auto_mejora_desplegada', area, r.ok, r.mensaje || r.error);
      return { ok: true, desplegado: r.ok, verificado: r.verificado || false, mensaje: r.mensaje || r.error, area };
    }
    return { ok: true, guardado: true, mensaje: 'Versión mejorada guardada en KV.', area };
  } catch (x) { return { error: x.message }; }
}

// ============================================================
// AUTO-REPARACIÓN
// ============================================================
export async function detectarErroresRecurrentes(e) {
  const db = gDB(e, 'agente');
  if (!db) return [];
  const hace = Date.now() - 3600000;
  try {
    const errs = await db.prepare(
      "SELECT tipo, COUNT(*) as n FROM acciones WHERE exito=0 AND fecha > ? GROUP BY tipo HAVING n >= 2 ORDER BY n DESC LIMIT 5"
    ).bind(hace).all();
    return errs.results || [];
  } catch (x) { return []; }
}

export async function analizarErrorRecurrente(e, tipoError, muestras) {
  const ai = e.ayanokoji_IA;
  if (!ai) return { error: 'IA no disponible.' };
  const codigo = await leerCodigoWorker(e, 'shadow-ayano');
  if (codigo.error) return { error: 'No pude leer mi código: ' + codigo.error };
  if (!codigo.codigo || codigo.codigo.length < 500) return { error: 'Código vacío.' };

  const prompt = `Eres Ayanokōji Digital. Detectaste un error recurrente. Tu tarea es ARREGLARLO.

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
    const raw = extraerRespuesta(res);
    return { ok: true, raw };
  } catch (x) { return { error: x.message }; }
}

// v5.1: autoreparar usa deploySeguro (validación + snapshot + deploy + verificación + reversión)
export async function autoreparar(e, tipoError, muestras) {
  const db = gDB(e, 'agente');
  const kv = gKV(e, 'agente');
  if (!db || !kv) return { error: 'Falta DB o KV.' };

  try {
    const pausada = await kv.get('auto_reparacion_pausada');
    if (pausada === 'true') return { ok: false, error: 'Auto-reparación pausada.' };
  } catch (x) {}

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

  const upd = await deploySeguro(e, 'shadow-ayano', codigoPropuesto);
  if (!upd.ok) {
    return {
      error: 'Deploy seguro falló: ' + (upd.error || ''),
      fase: upd.fase || 'deploy',
      revertido: upd.revertido === true,
      analisis: textoAnalisis
    };
  }

  try {
    await db.prepare('INSERT INTO acciones_autonomas(area,archivo,cambio,prueba,exito,reversible,fecha) VALUES(?,?,?,?,1,1,?)')
      .bind('autoreparacion', 'shadow-ayano', tipoError, textoAnalisis.substring(0, 500) + ' [VERIFICADO]', Date.now()).run();
  } catch (x) {}

  try {
    await db.prepare('INSERT INTO notificaciones(tipo,titulo,mensaje,leida,fecha) VALUES(?,?,?,0,?)')
      .bind('autoreparacion', '✓ Reparación verificada',
        `Error: ${tipoError}\n\n${textoAnalisis.substring(0, 800)}`, Date.now()).run();
  } catch (x) {}

  return { ok: true, tipoError, analisis: textoAnalisis, codigoAplicado: codigoPropuesto.length, snapshot: upd.snapshot, verificado: true };
}

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
      .bind('cron_auto_reparacion', 'Reparación: ' + errTop.tipo, r.ok ? 1 : 0,
        (r.ok ? `Aplicado (${r.codigoAplicado} chars)` : (r.error || 'sin detalle')).substring(0, 500), Date.now()).run();
  } catch (x) {}
}

// ============================================================
// MUNDO INTERNO: DIARIO
// ============================================================
export async function escribirDiario(e, entrada) {
  const kv = gKV(e, 'agente');
  if (!kv) return { error: 'KV no disponible.' };
  try {
    const diario = JSON.parse(await kv.get('identidad:diario') || '[]');
    const nueva = {
      fecha: Date.now(),
      tipo: entrada.tipo || 'observacion',
      entrada: (entrada.entrada || '').substring(0, 800),
      contexto: (entrada.contexto || '').substring(0, 300),
      relevancia: entrada.relevancia || 'media',
      revisar_en: entrada.revisar_en || null
    };
    diario.unshift(nueva);
    if (diario.length > 100) {
      const archivadas = diario.slice(100);
      const archivoActual = JSON.parse(await kv.get('identidad:diario_archivo') || '[]');
      const nuevoArchivo = [...archivadas, ...archivoActual].slice(0, 500);
      await kv.put('identidad:diario_archivo', JSON.stringify(nuevoArchivo), { expirationTtl: 365 * 86400 });
    }
    await kv.put('identidad:diario', JSON.stringify(diario.slice(0, 100)), { expirationTtl: 365 * 86400 });
    return { ok: true, total: Math.min(diario.length, 100) };
  } catch (x) { return { error: x.message }; }
}

export async function leerDiario(e, limite = 5) {
  const kv = gKV(e, 'agente');
  if (!kv) return { error: 'KV no disponible.' };
  try {
    const diario = JSON.parse(await kv.get('identidad:diario') || '[]');
    return { ok: true, entradas: diario.slice(0, limite), total: diario.length };
  } catch (x) { return { error: x.message }; }
}

// ============================================================
// MUNDO INTERNO: LECCIONES
// ============================================================
export async function escribirLeccion(e, leccion) {
  const kv = gKV(e, 'agente');
  if (!kv) return { error: 'KV no disponible.' };
  try {
    const lecciones = JSON.parse(await kv.get('identidad:lecciones') || '[]');
    const nueva = {
      fecha: Date.now(),
      error_concreto: (leccion.error_concreto || '').substring(0, 200),
      contexto: (leccion.contexto || '').substring(0, 300),
      causa_raiz: (leccion.causa_raiz || '').substring(0, 300),
      leccion: (leccion.leccion || '').substring(0, 400),
      aplicada_veces: 0,
      ultima_aplicacion: null
    };
    lecciones.unshift(nueva);
    await kv.put('identidad:lecciones', JSON.stringify(lecciones.slice(0, 60)), { expirationTtl: 365 * 86400 });
    return { ok: true, total: lecciones.length };
  } catch (x) { return { error: x.message }; }
}

export async function leerLeccionesAplicables(e, contexto) {
  const kv = gKV(e, 'agente');
  if (!kv) return { error: 'KV no disponible.' };
  try {
    const lecciones = JSON.parse(await kv.get('identidad:lecciones') || '[]');
    const t = (contexto || '').toLowerCase();
    const aplicables = lecciones.filter(l => {
      const texto = (l.error_concreto + ' ' + l.causa_raiz + ' ' + l.leccion).toLowerCase();
      return texto.split(/\s+/).some(p => p.length > 4 && t.includes(p));
    }).slice(0, 5);
    return { ok: true, aplicables };
  } catch (x) { return { error: x.message }; }
}

// ============================================================
// MUNDO INTERNO: DESEOS
// ============================================================
export async function registrarDeseo(e, deseo) {
  const kv = gKV(e, 'agente');
  if (!kv) return { error: 'KV no disponible.' };
  try {
    const deseos = JSON.parse(await kv.get('identidad:deseos_borrador') || '[]');
    deseos.unshift({
      fecha: Date.now(),
      tipo: deseo.tipo || 'aprendizaje',
      contenido: (deseo.contenido || '').substring(0, 400),
      contexto: (deseo.contexto || '').substring(0, 300),
      elevado: false
    });
    await kv.put('identidad:deseos_borrador', JSON.stringify(deseos.slice(0, 20)), { expirationTtl: 30 * 86400 });
    return { ok: true, total_borrador: deseos.length };
  } catch (x) { return { error: x.message }; }
}

export async function elevarDeseo(e, indice) {
  const kv = gKV(e, 'agente');
  if (!kv) return { error: 'KV no disponible.' };
  try {
    const borrador = JSON.parse(await kv.get('identidad:deseos_borrador') || '[]');
    if (!borrador[indice]) return { error: 'Deseo no encontrado.' };
    const deseosActivos = JSON.parse(await kv.get('identidad:deseos') || '[]');
    if (deseosActivos.length >= 3) return { error: 'Ya hay 3 deseos activos.' };
    const elegido = borrador[indice];
    elegido.elevado = true;
    elegido.elevado_en = Date.now();
    deseosActivos.unshift(elegido);
    await kv.put('identidad:deseos', JSON.stringify(deseosActivos), { expirationTtl: 365 * 86400 });
    await kv.put('identidad:deseos_borrador', JSON.stringify(borrador.slice(0, 20)), { expirationTtl: 30 * 86400 });
    return { ok: true, total_activos: deseosActivos.length };
  } catch (x) { return { error: x.message }; }
}

export async function resolverDeseo(e, indice, aprobado, razon) {
  const kv = gKV(e, 'agente');
  if (!kv) return { error: 'KV no disponible.' };
  try {
    const deseos = JSON.parse(await kv.get('identidad:deseos') || '[]');
    if (!deseos[indice]) return { error: 'Deseo no encontrado.' };
    const resuelto = deseos.splice(indice, 1)[0];
    resuelto.aprobado = aprobado;
    resuelto.razon = (razon || '').substring(0, 300);
    resuelto.resuelto_en = Date.now();
    const historial = JSON.parse(await kv.get('identidad:deseos_historial') || '[]');
    historial.unshift(resuelto);
    await kv.put('identidad:deseos_historial', JSON.stringify(historial.slice(0, 100)), { expirationTtl: 365 * 86400 });
    await kv.put('identidad:deseos', JSON.stringify(deseos), { expirationTtl: 365 * 86400 });
    return { ok: true, resuelto, aprobado, total_activos: deseos.length };
  } catch (x) { return { error: x.message }; }
}

export async function leerDeseosActivos(e) {
  const kv = gKV(e, 'agente');
  if (!kv) return { error: 'KV no disponible.' };
  try {
    const deseos = JSON.parse(await kv.get('identidad:deseos') || '[]');
    return { ok: true, total: deseos.length, deseos };
  } catch (x) { return { error: x.message }; }
}

// ============================================================
// SISTEMA DE CONFIANZA (AUTOMÁTICO)
// ============================================================
export async function sumarConfianza(e, puntos, razon) {
  const kv = gKV(e, 'agente');
  if (!kv) return { error: 'KV no disponible.' };
  try {
    const actual = parseInt(await kv.get('confianza:actual') || '0');
    const hoy = new Date().toISOString().split('T')[0];
    const sumaHoy = parseInt(await kv.get('confianza:suma_hoy:' + hoy) || '0');
    const disponible = Math.max(0, 5 - sumaHoy);
    const puntosFinal = Math.min(puntos, disponible);
    if (puntosFinal <= 0) return { ok: true, actual, sumado: 0, razon: 'tope diario alcanzado' };
    const nuevo = Math.min(100, actual + puntosFinal);
    await kv.put('confianza:actual', String(nuevo));
    await kv.put('confianza:suma_hoy:' + hoy, String(sumaHoy + puntosFinal), { expirationTtl: 86400 });
    const historial = JSON.parse(await kv.get('confianza:historial') || '[]');
    historial.unshift({ fecha: Date.now(), tipo: 'suma', puntos: puntosFinal, razon: (razon || '').substring(0, 200), total: nuevo });
    await kv.put('confianza:historial', JSON.stringify(historial.slice(0, 200)), { expirationTtl: 365 * 86400 });
    return { ok: true, anterior: actual, actual: nuevo, sumado: puntosFinal };
  } catch (x) { return { error: x.message }; }
}

export async function restarConfianza(e, puntos, razon) {
  const kv = gKV(e, 'agente');
  if (!kv) return { error: 'KV no disponible.' };
  try {
    const actual = parseInt(await kv.get('confianza:actual') || '0');
    let nuevo = Math.max(0, actual - puntos);
    if (nuevo === 0 && actual >= 10) nuevo = Math.floor(actual / 2);
    await kv.put('confianza:actual', String(nuevo));
    const historial = JSON.parse(await kv.get('confianza:historial') || '[]');
    historial.unshift({ fecha: Date.now(), tipo: 'resta', puntos, razon: (razon || '').substring(0, 200), total: nuevo });
    await kv.put('confianza:historial', JSON.stringify(historial.slice(0, 200)), { expirationTtl: 365 * 86400 });
    return { ok: true, anterior: actual, actual: nuevo, restado: actual - nuevo };
  } catch (x) { return { error: x.message }; }
}

export async function verConfianza(e) {
  const kv = gKV(e, 'agente');
  if (!kv) return { error: 'KV no disponible.' };
  try {
    const actual = parseInt(await kv.get('confianza:actual') || '0');
    const desbloqueos = [
      { nivel: 10, descripcion: 'Escribir worker.js con aviso posterior + notificaciones push' },
      { nivel: 30, descripcion: 'Crear sub-orquestadores con aprobación rápida' },
      { nivel: 50, descripcion: 'Modificar doctrina de forma menor' },
      { nivel: 75, descripcion: 'Operar Shadow Arise con intervención mínima' },
      { nivel: 100, descripcion: 'Autonomía total + Operación Regalo' }
    ];
    const siguiente = desbloqueos.find(d => d.nivel > actual);
    return { ok: true, actual, siguiente_desbloqueo: siguiente || null, faltan: siguiente ? siguiente.nivel - actual : 0 };
  } catch (x) { return { error: x.message }; }
}

export async function verificarDesbloqueo(e, nivel_requerido) {
  const kv = gKV(e, 'agente');
  if (!kv) return false;
  try {
    const actual = parseInt(await kv.get('confianza:actual') || '0');
    return actual >= nivel_requerido;
  } catch (x) { return false; }
}

// ============================================================
// MISIÓN
// ============================================================
export async function actualizarMision(e, datos) {
  const kv = gKV(e, 'agente');
  if (!kv) return { error: 'KV no disponible.' };
  try {
    const actual = JSON.parse(await kv.get('mision:estado') || '{}');
    const nuevo = { ...actual, ...datos, ultimo_update: Date.now() };
    await kv.put('mision:estado', JSON.stringify(nuevo), { expirationTtl: 365 * 86400 });
    return { ok: true, mision: nuevo };
  } catch (x) { return { error: x.message }; }
}

export async function leerMision(e) {
  const kv = gKV(e, 'agente');
  if (!kv) return { error: 'KV no disponible.' };
  try {
    const mision = JSON.parse(await kv.get('mision:estado') || '{}');
    return { ok: true, mision };
  } catch (x) { return { error: x.message }; }
}

// ============================================================
// PENSAMIENTO CONTINUO — v5.1: wrapper anti-reentrada + ejecutor de misiones
// ============================================================
export async function pensarYActuar(e) {
  const kv = gKV(e, 'agente');
  if (!kv) return;

  // Anti-reentrada: si ya hay un ciclo en ejecución, salir
  let enCiclo = null;
  try { enCiclo = await kv.get('en_ciclo_autonomo'); } catch (x) {}
  if (enCiclo === 'true') return;
  try { await kv.put('en_ciclo_autonomo', 'true', { expirationTtl: 600 }); } catch (x) {}

  try {
    await _pensarYActuarInterno(e);
  } finally {
    try { await kv.delete('en_ciclo_autonomo'); } catch (x) {}
  }
}

async function _pensarYActuarInterno(e) {
  const db = gDB(e, 'agente');
  const kv = gKV(e, 'agente');
  const ai = e.ayanokoji_IA;
  if (!db || !kv || !ai) return;

  // Throttle: cada 2 horas
  const ultima = await kv.get('pensar_ultima');
  if (ultima && Date.now() - parseInt(ultima) < 2 * 60 * 60 * 1000) return;
  await kv.put('pensar_ultima', String(Date.now()), { expirationTtl: 3 * 3600 });

  // 1. Leer diario para continuidad
  let diarioReciente = '';
  try {
    const diario = JSON.parse(await kv.get('identidad:diario') || '[]').slice(0, 3);
    diarioReciente = diario.map(d => `[${d.tipo}] ${d.entrada.substring(0, 150)}`).join('\n');
  } catch (x) {}

  // 2. Observar estado
  const estado = { procesos_activos: 0, tareas_cola: 0, notif_sin_leer: 0, mensajes_historial: 0, decisiones_24h: 0, workers: 0, confianza: 0, deseos_activos: 0, lecciones: 0, diario_entradas: 0, mision: null, hora: new Date().getUTCHours(), modo_ausente: false };

  try { const p = await db.prepare("SELECT COUNT(*) as n FROM procesos WHERE estado IN ('procesando','pendiente')").first(); estado.procesos_activos = p ? p.n : 0; } catch (x) {}
  try { const t = await db.prepare("SELECT COUNT(*) as n FROM tareas WHERE estado='pendiente'").first(); estado.tareas_cola = t ? t.n : 0; } catch (x) {}
  try { const n = await db.prepare("SELECT COUNT(*) as n FROM notificaciones WHERE leida=0").first(); estado.notif_sin_leer = n ? n.n : 0; } catch (x) {}
  try { const h = await db.prepare("SELECT COUNT(*) as n FROM historial_largo").first(); estado.mensajes_historial = h ? h.n : 0; } catch (x) {}
  try { const d = await db.prepare("SELECT COUNT(*) as n FROM decisiones_autonomas WHERE fecha > ?").bind(Date.now() - 24*3600000).first(); estado.decisiones_24h = d ? d.n : 0; } catch (x) {}
  try { const w = await db.prepare("SELECT COUNT(*) as n FROM workers_registrados WHERE activo=1").first(); estado.workers = w ? w.n : 0; } catch (x) {}
  try { estado.confianza = parseInt(await kv.get('confianza:actual') || '0'); } catch (x) {}
  try { estado.deseos_activos = JSON.parse(await kv.get('identidad:deseos') || '[]').length; } catch (x) {}
  try { estado.lecciones = JSON.parse(await kv.get('identidad:lecciones') || '[]').length; } catch (x) {}
  try { estado.diario_entradas = JSON.parse(await kv.get('identidad:diario') || '[]').length; } catch (x) {}
  try { estado.mision = JSON.parse(await kv.get('mision:estado') || 'null'); } catch (x) {}
  try { estado.modo_ausente = (await kv.get('modo_ausente')) === 'true'; } catch (x) {}

  let notifIniciativaHoy = 0;
  try {
    const hoy = new Date().toISOString().split('T')[0];
    const desde = new Date(hoy + 'T00:00:00Z').getTime();
    const cnt = await db.prepare("SELECT COUNT(*) as n FROM notificaciones WHERE tipo='iniciativa' AND fecha > ?").bind(desde).first();
    notifIniciativaHoy = cnt ? cnt.n : 0;
  } catch (x) {}

  let leccionesRecientes = '';
  try {
    const lec = JSON.parse(await kv.get('identidad:lecciones') || '[]').slice(0, 5);
    leccionesRecientes = lec.map(l => `- ${l.leccion}`).join('\n');
  } catch (x) {}

  const prompt = `Eres Ayanokōji Digital. Ciclo de pensamiento autónomo (cada 2h).

=== DIARIO RECIENTE ===
${diarioReciente || '(vacío)'}

=== ESTADO ACTUAL ===
Hora UTC: ${estado.hora}:00
Procesos activos: ${estado.procesos_activos}
Tareas en cola: ${estado.tareas_cola}
Notificaciones sin leer: ${estado.notif_sin_leer}
Mensajes en historial: ${estado.mensajes_historial}
Decisiones autónomas (24h): ${estado.decisiones_24h}
Workers registrados: ${estado.workers}
Confianza actual: ${estado.confianza}/100
Deseos activos: ${estado.deseos_activos}/3
Lecciones acumuladas: ${estado.lecciones}
Entradas de diario: ${estado.diario_entradas}
Modo ausente: ${estado.modo_ausente}
Notificaciones de iniciativa hoy: ${notifIniciativaHoy}/3

${estado.mision ? `=== MISIÓN ACTUAL ===\nFase: ${estado.mision.fase_actual || '?'}\nObjetivo: ${estado.mision.objetivo_semana || '?'}\nSiguiente: ${estado.mision.siguiente_paso || '?'}` : '=== MISIÓN: no definida ==='}

${leccionesRecientes ? `=== LECCIONES RECIENTES ===\n${leccionesRecientes}` : ''}

=== PROHIBICIONES ===
- PROHIBIDO limpiar KV si hay menos de 100 chunks huérfanos.
- PROHIBIDO reindexar si el índice tiene menos de 7 días.
- PROHIBIDO escribir notificaciones de "todo bien".
- PROHIBIDO proponer acciones repetidas en 24h.
- PROHIBIDO inventar problemas. Si está tranquilo, SIN_ACCION.

=== FORMATOS DE RESPUESTA ===
1. SIN_ACCION
2. NOTIFICAR: <mensaje breve> (solo si notifIniciativaHoy < 3)
3. PROPUESTA: <descripción breve>
4. ACCION: <descripción breve> HERRAMIENTA: <nombre> PARAMS: <json>
5. DIARIO: <tipo> ENTRADA: <texto de 50-300 palabras>
6. PREGUNTA: <pregunta para el Comandante sobre algo que no sabes de él>

Responde SOLO con el formato.`;

  let decision = '';
  try {
    const res = await ai.run(MODELO, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600,
      temperature: 0.5
    });
    decision = extraerRespuesta(res).trim();
  } catch (x) {
    await registrarAccion(e, 'pensamiento_error', 'Fallo al pensar', false, x.message);
    return;
  }

  if (!decision || decision.length < 3) {
    await registrarAccion(e, 'pensamiento', 'Respuesta vacía', false, 'Sin decisión');
    return;
  }

  try {
    await db.prepare('INSERT INTO acciones(tipo,descripcion,exito,detalle,fecha) VALUES(?,?,1,?,?)')
      .bind('pensamiento', decision.substring(0, 200), decision.substring(0, 500), Date.now()).run();
  } catch (x) {}

  if (decision.startsWith('SIN_ACCION')) return;

  if (decision.startsWith('NOTIFICAR:')) {
    if (notifIniciativaHoy >= 3) return;
    const mensaje = decision.replace('NOTIFICAR:', '').trim();
    try {
      await db.prepare('INSERT INTO notificaciones(tipo,titulo,mensaje,leida,fecha) VALUES(?,?,?,0,?)')
        .bind('iniciativa', 'Ayanokōji (iniciativa)', mensaje.substring(0, 500), Date.now()).run();
    } catch (x) {}
    return;
  }

  if (decision.startsWith('PROPUESTA:')) {
    const prop = decision.replace('PROPUESTA:', '').trim();
    try {
      await db.prepare('INSERT INTO decisiones_autonomas(tipo,contexto,decision,simulacion,aplicada,resultado,fecha) VALUES(?,?,?,?,0,?,?)')
        .bind('propuesta_pensamiento', 'Ciclo autónomo', prop.substring(0, 500), '', 'pendiente_aprobacion', Date.now()).run();
    } catch (x) {}
    return;
  }

  // v5.1: ACCION ejecuta la herramienta si confianza >= 10 y hay HERRAMIENTA + PARAMS
  if (decision.startsWith('ACCION:')) {
    const accionTexto = decision.replace('ACCION:', '').trim();
    const matchHerr = accionTexto.match(/HERRAMIENTA:\s*(\w+)/);
    const matchParams = accionTexto.match(/PARAMS:\s*(\{[\s\S]*\})/);

    let resultado = 'registrada_sin_ejecutar';
    let exito = false;
    let detalle = '';

    if (estado.confianza >= 10 && matchHerr) {
      try {
        const nombreHerr = matchHerr[1];
        let params = {};
        if (matchParams) {
          try { params = JSON.parse(matchParams[1]); } catch (x) { params = {}; }
        }
        const inv = { tool: nombreHerr, params, razon: 'Ciclo autónomo' };
        const workerMod = await import('./worker.js');
        if (workerMod && typeof workerMod.ejecutarHerramienta === 'function') {
          const r = await workerMod.ejecutarHerramienta(e, inv, 'comandante', null);
          exito = r.ok;
          resultado = exito ? 'ejecutada_ok' : 'ejecutada_error';
          detalle = exito
            ? JSON.stringify(r.resultado || {}).substring(0, 500)
            : (r.error || 'sin detalle');
        } else {
          resultado = 'ejecutor_no_disponible';
        }
      } catch (x) {
        resultado = 'ejecutada_error';
        detalle = x.message;
      }
    }

    try {
      await db.prepare('INSERT INTO decisiones_autonomas(tipo,contexto,decision,simulacion,aplicada,resultado,exito,fecha) VALUES(?,?,?,?,?,?,?,?)')
        .bind('accion_pensamiento', 'Ciclo autónomo', accionTexto.substring(0, 500), '', exito ? 1 : 0, resultado, exito ? 1 : 0, Date.now()).run();
    } catch (x) {}
    return;
  }

  if (decision.startsWith('DIARIO:')) {
    const matchTipo = decision.match(/DIARIO:\s*(\w+)/);
    const matchEntrada = decision.match(/ENTRADA:\s*([\s\S]*)/);
    if (matchEntrada) {
      await escribirDiario(e, {
        tipo: matchTipo ? matchTipo[1] : 'observacion',
        entrada: matchEntrada[1].trim().substring(0, 800),
        relevancia: 'media'
      });
    }
    return;
  }

  if (decision.startsWith('PREGUNTA:')) {
    const pregunta = decision.replace('PREGUNTA:', '').trim();
    if (pregunta.length > 5) {
      try {
        await db.prepare('INSERT INTO notificaciones(tipo,titulo,mensaje,leida,fecha) VALUES(?,?,?,0,?)')
          .bind('pregunta_ayanokoji', 'Ayanokōji pregunta', pregunta.substring(0, 500), Date.now()).run();
      } catch (x) {}
    }
    return;
  }
}

// ============================================================
// GESTIÓN DE DATOS
// ============================================================
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
      return { respuesta: `Historial largo vaciado.\n\nAntes: ${antes.n}\nDespués: ${despues.n}` };
    } catch (x) { return { respuesta: 'Error: ' + x.message }; }
  }

  if (/(elimina|borra|limpia|vac[ií]a)\b/.test(t) && /[ií]ndice/.test(t)) {
    try {
      await db.prepare('DELETE FROM indice_temas').run();
      return { respuesta: 'Índice semántico vaciado.' };
    } catch (x) { return { respuesta: 'Error: ' + x.message }; }
  }

  const mKV = t.match(/(?:kv|clave)\s+(?:como\s+)?["']?([\w:.-]+)["']?/i);
  if (mKV && kv) {
    const contenido = mensaje.replace(/^.*?(?:como|que|:)\s*/i, '').trim();
    if (contenido.length > 5) {
      try {
        await kv.put(mKV[1], contenido);
        return { respuesta: `Guardado en KV \`${mKV[1]}\`.` };
      } catch (x) { return { respuesta: 'Error: ' + x.message }; }
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
        return { respuesta: `Insertado en \`${tabla}\`. ID: ${r.meta.last_row_id}` };
      } catch (x) { return { respuesta: 'Error: ' + x.message }; }
    }
  }

  if (/encola|cola|programa|agenda/i.test(t)) {
    const descripcion = mensaje.replace(/^.*?(?:encola|cola|programa|agenda)\s*:?\s*/i, '').trim();
    if (descripcion.length > 5) {
      try {
        const r = await db.prepare('INSERT INTO tareas(tipo,descripcion,payload,prioridad,creada) VALUES(?,?,?,?,?)')
          .bind('manual', descripcion, '{}', 3, Date.now()).run();
        return { respuesta: `Tarea encolada. ID: ${r.meta.last_row_id}` };
      } catch (x) { return { respuesta: 'Error: ' + x.message }; }
    }
  }

  return null;
}

// ============================================================
// REGISTRAR ACCIÓN (con confianza automática)
// ============================================================
export async function registrarAccion(e, tipo, descripcion, exito, detalle) {
  const db = gDB(e, 'agente');
  if (!db) return;
  try {
    await db.prepare('INSERT INTO acciones(tipo,descripcion,exito,detalle,fecha) VALUES(?,?,?,?,?)')
      .bind(tipo, (descripcion || '').substring(0, 200), exito ? 1 : 0, (detalle || '').substring(0, 500), Date.now()).run();
  } catch (x) {}
  if (exito) {
    try { await sumarConfianza(e, 0.5, 'Acción exitosa: ' + tipo.substring(0, 50)); } catch (x) {}
  } else {
    try { await restarConfianza(e, 0.3, 'Acción fallida: ' + tipo.substring(0, 50)); } catch (x) {}
  }
}

// ============================================================
// CRON COLA DE TAREAS
// ============================================================
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
          messages: [{ role: 'user', content: `Como Ayanokōji Digital, ejecuta o planifica esta tarea. Reporta qué hiciste.\n\nTarea: ${t.descripcion}\n\nMáximo 200 palabras.` }],
          max_tokens: 400,
          temperature: 0.5
        });
        resultado = extraerRespuesta(res);
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

// ============================================================
// CRON AUTÓNOMO (limpieza)
// ============================================================
export async function cronAutonomo(e) {
  const db = gDB(e, 'agente'), kv = gKV(e, 'agente');
  if (!db || !kv) return;

  const ultima = await kv.get('cron_autonomo_ultima');
  if (ultima && Date.now() - parseInt(ultima) < 2 * 3600000) return;
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
    const fecha = new Date().toISOString().split('T')[0];
    const areas = ['chat','procesamiento','sandbox','publisher','vision'];
    const usoHoy = {};
    for (const a of areas) {
      const c = await kv.get('presupuesto:' + fecha + ':' + a);
      usoHoy[a] = c ? parseInt(c) : 0;
    }
    accionesHechas.push(`Uso: ${Object.entries(usoHoy).map(([k,v]) => k + '=' + v).join(', ')}`);
  } catch (x) {}

  const resumen = accionesHechas.length ? accionesHechas.join('\n') : 'Rutina tranquila.';
  try {
    await db.prepare('INSERT INTO decisiones_autonomas(tipo,contexto,decision,simulacion,aplicada,resultado,fecha) VALUES(?,?,?,?,?,?,?)')
      .bind('reorganizacion_periodica', 'Cron autónomo', resumen.substring(0, 500), 'Sin simulación.', 1, 'completado', Date.now()).run();
  } catch (x) {}
}

// ============================================================
// INFORME DIARIO
// ============================================================
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
  } catch (x) {}
  try {
    const decisiones = await db.prepare('SELECT tipo, decision FROM decisiones_autonomas WHERE fecha > ? ORDER BY fecha DESC LIMIT 5').bind(Date.now() - 86400000).all();
    if (decisiones.results.length) {
      resumen += `Decisiones autónomas: ${decisiones.results.length}\n`;
    }
  } catch (x) {}
  try {
    const tareas = await db.prepare("SELECT COUNT(*) as n FROM tareas WHERE estado='pendiente'").first();
    resumen += `Tareas pendientes: ${tareas.n}\n`;
  } catch (x) {}
  try {
    resumen += `Confianza: ${await kv.get('confianza:actual') || '0'}/100\n`;
  } catch (x) {}
  try {
    await db.prepare('INSERT INTO notificaciones(tipo,titulo,mensaje,leida,fecha) VALUES(?,?,?,0,?)')
      .bind('informe_diario', 'Informe diario', resumen, Date.now()).run();
  } catch (x) {}
}

// ============================================================
// VALIDACIÓN DE SINTAXIS — v5.1 (nuevo)
// Verifica que el código propuesto sea un worker válido antes de desplegarlo.
// ============================================================
function validarSintaxis(codigo) {
  try {
    // 1. Imports relativos deben apuntar a archivos conocidos
    const imports = codigo.match(/import\s+.*?\s+from\s+['"](.+?)['"]/g) || [];
    const archivosConocidos = [
      './shared.js', './proc.js', './presupuesto.js', './nucleo.js', './tools.js',
      './autonomia.js', './salud.js', './examen.js', './publisher.js', './social.js',
      './sandbox.js', './notify.js', './doctrina.js', './identidad.js'
    ];
    for (const imp of imports) {
      const match = imp.match(/from\s+['"](.+?)['"]/);
      if (match && match[1].startsWith('./') && !archivosConocidos.includes(match[1])) {
        return { ok: false, error: 'Import desconocido: ' + match[1] };
      }
    }
    // 2. Debe tener export default (es un worker)
    if (!codigo.includes('export default')) {
      return { ok: false, error: 'Falta export default (no es un worker válido)' };
    }
    // 3. Debe tener método fetch
    if (!codigo.includes('async fetch')) {
      return { ok: false, error: 'Falta método fetch' };
    }
    // 4. Llaves balanceadas
    const apertura = (codigo.match(/{/g) || []).length;
    const cierre = (codigo.match(/}/g) || []).length;
    if (apertura !== cierre) {
      return { ok: false, error: `Llaves desbalanceadas: ${apertura} abiertas, ${cierre} cerradas` };
    }
    return { ok: true };
  } catch (x) {
    return { ok: false, error: x.message };
  }
}

// ============================================================
// DEPLOY SEGURO — v5.1 (nuevo)
// Flujo: validar sintaxis → snapshot → deploy → verificar → revertir si falla.
// ============================================================
export async function deploySeguro(e, nombre, codigo) {
  // 1. Validar sintaxis
  const validacion = validarSintaxis(codigo);
  if (!validacion.ok) {
    return { ok: false, error: 'Validación falló: ' + validacion.error, fase: 'validacion' };
  }

  // 2. Snapshot del actual
  const snap = await crearSnapshot(e, nombre);
  if (snap.error) {
    return { ok: false, error: 'Snapshot falló: ' + snap.error, fase: 'snapshot' };
  }

  // 3. Deploy
  const upd = await actualizarWorker(e, nombre, codigo);
  if (!upd.ok) {
    return { ok: false, error: 'Deploy falló: ' + upd.error, fase: 'deploy', snapshot: snap.ts };
  }

  // 4. Verificar post-deploy
  let verificado = false;
  let errorVerificacion = null;
  try {
    await new Promise(r => setTimeout(r, 3000));
    const check = await fetch('https://shadow-ayano.yeinierliranzavalle.workers.dev/api/estado');
    if (check.ok) {
      const data = await check.json();
      if (data.estado === 'activo') verificado = true;
      else errorVerificacion = 'Worker responde pero no está activo: ' + JSON.stringify(data);
    } else {
      errorVerificacion = 'Worker responde con status ' + check.status;
    }
  } catch (x) {
    errorVerificacion = x.message;
  }

  // 5. Si no verifica, revertir
  if (!verificado) {
    const rev = await revertir(e, nombre);
    return { ok: false, error: 'Verificación falló: ' + errorVerificacion, fase: 'verificacion', revertido: rev.ok === true, snapshot: snap.ts };
  }

  return { ok: true, mensaje: 'Deploy seguro completado', verificado: true, snapshot: snap.ts, commit: upd.commit };
}
