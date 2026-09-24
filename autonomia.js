import { MODELO_LIGERO, J, gDB, gKV } from './shared.js';
import { notificar } from './notify.js';
import { consumir } from './presupuesto.js';

const CF_API = 'https://api.cloudflare.com/client/v4';

function cfHeaders(e) {
  return {
    'Authorization': `Bearer ${e.CF_API_TOKEN}`,
    'Content-Type': 'application/javascript'
  };
}

function accountId(e) {
  return e.CF_ACCOUNT_ID;
}

// ============ CREAR WORKER NUEVO ============
export async function crearWorker(e, nombre, codigo) {
  try {
    if (!e.CF_API_TOKEN || !e.CF_ACCOUNT_ID) {
      return { error: 'Falta CF_API_TOKEN o CF_ACCOUNT_ID.' };
    }
    if (!nombre || !codigo) return { error: 'Faltan nombre o código.' };

    const url = `${CF_API}/accounts/${accountId(e)}/workers/scripts/${nombre}`;
    const r = await fetch(url, {
      method: 'PUT',
      headers: cfHeaders(e),
      body: codigo
    });
    const d = await r.json();
    if (!d.success) return { error: 'Cloudflare rechazó: ' + JSON.stringify(d.errors) };

    // Registrar en D1
    const db = gDB(e, 'agente');
    if (db) {
      try {
        await db.prepare('INSERT OR REPLACE INTO workers_registrados(nombre,url,codigo,version,activo,creado,actualizado) VALUES(?,?,?,?,?,?,?)')
          .bind(nombre, `${nombre}.workers.dev`, codigo.substring(0, 500), 1, 1, Date.now(), Date.now()).run();
      } catch (x) {}
    }

    await registrarAccion(e, 'crear_worker', nombre, true, 'Worker desplegado');
    await notificar(e, `🔧 *Worker creado*\n\n\`${nombre}\`\nYa está en línea.`);
    return { ok: true, mensaje: `Worker \`${nombre}\` creado y desplegado.`, url: `${nombre}.workers.dev` };
  } catch (x) {
    await registrarAccion(e, 'crear_worker', nombre, false, x.message);
    return { error: x.message };
  }
}

// ============ ACTUALIZAR WORKER EXISTENTE ============
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
    await notificar(e, `🚀 *Worker actualizado*\n\n\`${nombre}\``);
    return { ok: true, mensaje: `Worker \`${nombre}\` actualizado.` };
  } catch (x) {
    await registrarAccion(e, 'actualizar_worker', nombre, false, x.message);
    return { error: x.message };
  }
}

// ============ LEER CÓDIGO DE UN WORKER ============
export async function leerCodigoWorker(e, nombre) {
  try {
    if (!e.CF_API_TOKEN || !e.CF_ACCOUNT_ID) return { error: 'Falta token.' };
    const url = `${CF_API}/accounts/${accountId(e)}/workers/scripts/${nombre}/content`;
    const r = await fetch(url, {
      headers: { 'Authorization': `Bearer ${e.CF_API_TOKEN}` }
    });
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
      // Fallback: listar los registrados en D1
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

// ============ AUTO-MEJORA (usando IA para generar código nuevo) ============
export async function autoMejorar(e, body) {
  try {
    const { area, instrucciones, autoDesplegar } = body;
    const nombre = body.nombre || e.CF_SCRIPT_NAME || 'shadow-ayano';

    // Leer código actual
    const actual = await leerCodigoWorker(e, nombre);
    if (actual.error) return { error: 'No pude leer el código actual: ' + actual.error };

    if (!await consumir(e, 'procesamiento')) return { error: 'Presupuesto agotado.' };

    // Pedirle a la IA que genere una mejora
    const prompt = `Tienes este código de Cloudflare Worker. El Comandante quiere mejorar el área "${area || 'general'}".

Instrucciones específicas: ${instrucciones || 'Mejora general sin romper funcionalidad.'}

Reglas:
- Devuelve SOLO el código completo modificado.
- No cambies el estilo ni elimines comentarios existentes.
- No rompas funcionalidad actual.
- Mantén todas las rutas y exports.

Código actual:
${actual.codigo.substring(0, 30000)}`;

    const res = await e.ayanokoji_IA.run(MODELO_LIGERO, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4000,
      temperature: 0.3
    });

    const nuevoCodigo = res.response || '';
    if (nuevoCodigo.length < 100) return { error: 'La IA devolvió código vacío.' };

    // Guardar en KV como versión pendiente
    const kv = gKV(e, 'agente');
    if (kv) {
      await kv.put('worker:version:' + nombre, nuevoCodigo);
      await kv.put('worker:version:fecha:' + nombre, String(Date.now()));
    }

    if (autoDesplegar) {
      const r = await actualizarWorker(e, nombre, nuevoCodigo);
      return { ok: true, desplegado: r.ok, mensaje: r.mensaje || r.error };
    }

    return { ok: true, guardado: true, mensaje: 'Versión mejorada guardada en KV. Pásame autoDesplegar:true para desplegar.' };
  } catch (x) {
    return { error: x.message };
  }
}

// ============ GESTIÓN DE DATOS EN LENGUAJE NATURAL ============
export async function gestionarDatos(e, mensaje, uid) {
  const db = gDB(e, 'agente'), kv = gKV(e, 'agente');
  if (!db) return { respuesta: 'D1 no disponible.' };

  const t = mensaje.toLowerCase();

  // "guarda X en KV como Y"
  const mKV = t.match(/(?:kv|clave)\s+(?:como\s+)?["']?([\w:.-]+)["']?/i);
  if (mKV && kv) {
    const contenido = mensaje.replace(/^.*?(?:como|que|:)\s*/i, '').trim();
    if (contenido.length > 5) {
      try {
        await kv.put(mKV[1], contenido);
        return { respuesta: `Guardado en KV bajo \`${mKV[1]}\`, Comandante.` };
      } catch (x) {
        return { respuesta: `No pude guardar en KV: ${x.message}` };
      }
    }
  }

  // "guarda X en la tabla Y"
  const mTabla = t.match(/tabla\s+(\w+)/i);
  if (mTabla) {
    const tabla = mTabla[1];
    const contenido = mensaje.replace(/^.*?(?:tabla|en)\s+\w+\s*(?:que|:)?\s*/i, '').trim();
    if (contenido.length > 5) {
      try {
        const datos = { fecha: Date.now(), resumen: contenido, fases: JSON.stringify([contenido]), fuente: 'comando' };
        const keys = Object.keys(datos);
        const ph = keys.map(() => '?').join(',');
        await db.prepare('INSERT INTO ' + tabla + ' (' + keys.join(',') + ') VALUES(' + ph + ')')
          .bind(...Object.values(datos)).run();
        return { respuesta: `Insertado en \`${tabla}\`, Comandante.` };
      } catch (x) {
        return { respuesta: `No pude insertar en \`${tabla}\`: ${x.message}` };
      }
    }
  }

  // "encola esta tarea: X"
  if (/encola|cola|programa|agenda/i.test(t)) {
    const descripcion = mensaje.replace(/^.*?(?:encola|cola|programa|agenda)\s*:?\s*/i, '').trim();
    if (descripcion.length > 5) {
      try {
        await db.prepare('INSERT INTO tareas(tipo,descripcion,payload,prioridad,creada) VALUES(?,?,?,?,?)')
          .bind('manual', descripcion, '{}', 3, Date.now()).run();
        return { respuesta: `Tarea encolada: "${descripcion.substring(0, 80)}..."` };
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
      .bind(tipo, descripcion, exito ? 1 : 0, detalle || '', Date.now()).run();
  } catch (x) {}
}

// ============ CRON DE COLA DE TAREAS ============
export async function cronColaTareas(e) {
  const db = gDB(e, 'agente');
  const ai = e.ayanokoji_IA;
  if (!db || !ai) return;

  const ahora = Date.now();
  const tareas = await db.prepare(
    "SELECT * FROM tareas WHERE estado='pendiente' AND intentos < 3 ORDER BY prioridad ASC, creada ASC LIMIT 3"
  ).all();

  for (const t of (tareas.results || [])) {
    try {
      await db.prepare("UPDATE tareas SET estado='ejecutando' WHERE id=?").bind(t.id).run();

      // Ejecutar según tipo
      let resultado = '';
      if (t.tipo === 'manual' || t.tipo === 'general') {
        // Pasar la tarea a la IA para que decida cómo ejecutarla
        const res = await ai.run(MODELO_LIGERO, {
          messages: [{ role: 'user', content: `Como Ayanokōji Digital, ejecuta o planifica esta tarea. Reporta qué hiciste o qué se necesita.\n\nTarea: ${t.descripcion}\n\nResponde en 200 palabras.` }],
          max_tokens: 400,
          temperature: 0.5
        });
        resultado = res.response || '';
      } else if (t.tipo === 'publicar') {
        resultado = 'Delegado a publicar.';
      } else if (t.tipo === 'sandbox') {
        resultado = 'Delegado a sandbox.';
      }

      await db.prepare("UPDATE tareas SET estado='completada', ejecutada=?, resultado=? WHERE id=?")
        .bind(ahora, resultado.substring(0, 2000), t.id).run();
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
