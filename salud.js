// salud.js — Mantenimiento autónomo y resiliencia de Ayanokōji Digital
// Detecta problemas, repara lo que puede, activa modo cache si D1 falla,
// destila historial periódicamente, y notifica a Ayanokōji (no al usuario).

import { MODELO_LIGERO, gDB, gKV } from './shared.js';
import { registrarAccion, escribirLeccion } from './autonomia.js';

// ============================================================
// VERIFICACIÓN DE SALUD
// ============================================================
export async function verificarSalud(e) {
  const db = gDB(e, 'agente');
  const kv = gKV(e, 'agente');
  const salud = {
    timestamp: Date.now(),
    d1: { ok: false, error: null, latencia_ms: null },
    kv: { ok: false, error: null },
    github: { ok: false, error: null },
    cloudflare: { ok: false, error: null },
    cron: { ultimo_hace_min: null, ok: false },
    modelo: { ok: false, error: null },
    modo_cache_activo: false,
    escrituras_pendientes: 0,
    resumen: 'desconocido'
  };

  // 1. Verificar D1
  if (db) {
    try {
      const t0 = Date.now();
      const r = await db.prepare('SELECT 1 as test').first();
      const latencia = Date.now() - t0;
      salud.d1 = { ok: !!r, error: null, latencia_ms: latencia };
    } catch (x) {
      salud.d1 = { ok: false, error: x.message, latencia_ms: null };
    }
  } else {
    salud.d1 = { ok: false, error: 'D1 no configurado' };
  }

  // 2. Verificar KV
  if (kv) {
    try {
      await kv.put('health:ping', String(Date.now()), { expirationTtl: 60 });
      const v = await kv.get('health:ping');
      salud.kv = { ok: !!v, error: null };
    } catch (x) {
      salud.kv = { ok: false, error: x.message };
    }
  } else {
    salud.kv = { ok: false, error: 'KV no configurado' };
  }

  // 3. Verificar modo cache
  try {
    salud.modo_cache_activo = (await kv.get('modo_cache')) === 'true';
  } catch (x) {}

  // 4. Verificar escrituras pendientes en buffer
  try {
    const lista = await kv.list({ prefix: 'buffer:escritura:', limit: 100 });
    salud.escrituras_pendientes = lista.keys.length;
  } catch (x) {}

  // 5. Verificar último cron
  try {
    const ultima = await kv.get('cron_autonomo_ultima');
    if (ultima) {
      const hace = Math.round((Date.now() - parseInt(ultima)) / 60000);
      salud.cron.ultimo_hace_min = hace;
      salud.cron.ok = hace < 180; // menos de 3h
    }
  } catch (x) {}

  // 6. Verificar GitHub (solo si hay token)
  if (e.GITHUB_TOKEN && e.GITHUB_REPO_BACKEND) {
    try {
      const r = await fetch(`https://api.github.com/repos/${e.GITHUB_REPO_BACKEND}`, {
        headers: {
          'Authorization': `Bearer ${e.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'shadow-ayano-health'
        }
      });
      salud.github = { ok: r.ok, error: r.ok ? null : `HTTP ${r.status}` };
    } catch (x) {
      salud.github = { ok: false, error: x.message };
    }
  } else {
    salud.github = { ok: false, error: 'Token o repo no configurado' };
  }

  // 7. Verificar Cloudflare API (solo si hay token)
  if (e.CF_API_TOKEN && e.CF_ACCOUNT_ID) {
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${e.CF_ACCOUNT_ID}`, {
        headers: { 'Authorization': `Bearer ${e.CF_API_TOKEN}` }
      });
      salud.cloudflare = { ok: r.ok, error: r.ok ? null : `HTTP ${r.status}` };
    } catch (x) {
      salud.cloudflare = { ok: false, error: x.message };
    }
  } else {
    salud.cloudflare = { ok: false, error: 'Token o cuenta no configurados' };
  }

  // 8. Verificar modelo (prueba mínima)
  if (e.ayanokoji_IA) {
    try {
      const r = await e.ayanokoji_IA.run(MODELO_LIGERO, {
        messages: [{ role: 'user', content: 'ok' }],
        max_tokens: 3
      });
      salud.modelo = { ok: !!r, error: null };
    } catch (x) {
      salud.modelo = { ok: false, error: x.message };
    }
  } else {
    salud.modelo = { ok: false, error: 'IA no configurada' };
  }

  // 9. Resumen
  if (salud.d1.ok && salud.kv.ok && salud.modelo.ok) {
    salud.resumen = 'verde';
  } else if (salud.kv.ok && salud.modelo.ok) {
    salud.resumen = 'amarillo'; // D1 puede estar caído pero hay fallback
  } else {
    salud.resumen = 'rojo';
  }

  // Guardar en KV para consulta rápida
  try {
    await kv.put('health:ultimo', JSON.stringify(salud), { expirationTtl: 3600 });
  } catch (x) {}

  return salud;
}

// ============================================================
// MODO CACHE: cuando D1 falla, todo va a KV
// ============================================================
export async function activarModoCache(e, razon) {
  const kv = gKV(e, 'agente');
  if (!kv) return { error: 'KV no disponible.' };
  try {
    await kv.put('modo_cache', 'true', { expirationTtl: 24 * 3600 });
    await kv.put('modo_cache_razon', razon || 'D1 falló', { expirationTtl: 24 * 3600 });
    await kv.put('modo_cache_activado_en', String(Date.now()), { expirationTtl: 24 * 3600 });
    try {
      await registrarAccion(e, 'modo_cache_activado', razon, true, 'Sistema en modo cache hasta que D1 vuelva');
    } catch (x) {}
    return { ok: true, mensaje: 'Modo cache activado.' };
  } catch (x) { return { error: x.message }; }
}

export async function desactivarModoCache(e, razon) {
  const kv = gKV(e, 'agente');
  if (!kv) return { error: 'KV no disponible.' };
  try {
    await kv.put('modo_cache', 'false');
    await kv.put('modo_cache_desactivado_en', String(Date.now()), { expirationTtl: 86400 });
    try {
      await registrarAccion(e, 'modo_cache_desactivado', razon, true, 'Sistema vuelve a modo normal');
    } catch (x) {}
    return { ok: true, mensaje: 'Modo cache desactivado.' };
  } catch (x) { return { error: x.message }; }
}

export async function modoCacheActivo(e) {
  const kv = gKV(e, 'agente');
  if (!kv) return false;
  try {
    return (await kv.get('modo_cache')) === 'true';
  } catch (x) { return false; }
}

// ============================================================
// BUFFER DE ESCRITURA: cuando D1 falla al escribir, guardamos en KV
// y sincronizamos cuando vuelva
// ============================================================
export async function bufferEscritura(e, tabla, datos) {
  const kv = gKV(e, 'agente');
  if (!kv) return { error: 'KV no disponible.' };
  try {
    const id = 'buffer:' + Date.now() + ':' + Math.random().toString(36).substring(7);
    const payload = { tabla, datos, ts: Date.now() };
    await kv.put('buffer:escritura:' + id, JSON.stringify(payload), { expirationTtl: 7 * 86400 });
    return { ok: true, id };
  } catch (x) { return { error: x.message }; }
}

export async function sincronizarBuffer(e) {
  const db = gDB(e, 'agente');
  const kv = gKV(e, 'agente');
  if (!db || !kv) return { error: 'DB o KV no disponible.' };

  const lista = await kv.list({ prefix: 'buffer:escritura:', limit: 100 });
  if (!lista.keys.length) return { ok: true, sincronizadas: 0 };

  let sincronizadas = 0;
  let fallidas = 0;

  for (const k of lista.keys) {
    try {
      const raw = await kv.get(k.name);
      if (!raw) continue;
      const payload = JSON.parse(raw);
      if (!payload.tabla || !payload.datos) {
        await kv.delete(k.name);
        continue;
      }
      const keys = Object.keys(payload.datos);
      const ph = keys.map(() => '?').join(',');
      await db.prepare('INSERT INTO ' + payload.tabla + ' (' + keys.join(',') + ') VALUES(' + ph + ')')
        .bind(...Object.values(payload.datos)).run();
      await kv.delete(k.name);
      sincronizadas++;
    } catch (x) {
      fallidas++;
    }
  }

  try {
    await registrarAccion(e, 'buffer_sincronizado', `${sincronizadas} escrituras sincronizadas`, sincronizadas > 0, `${fallidas} fallidas`);
  } catch (x) {}

  return { ok: true, sincronizadas, fallidas };
}

// ============================================================
// DESTILACIÓN DE HISTORIAL: convierte mensajes viejos en resúmenes
// ============================================================
export async function destilarHistorial(e, dias_antiguedad = 30) {
  const db = gDB(e, 'agente');
  const kv = gKV(e, 'agente');
  const ai = e.ayanokoji_IA;
  if (!db || !kv || !ai) return { error: 'DB, KV o IA no disponible.' };

  const corte = Date.now() - (dias_antiguedad * 86400000);

  // 1. Contar cuántos mensajes hay que destilar
  let total = 0;
  try {
    const r = await db.prepare("SELECT COUNT(*) as n FROM historial_largo WHERE fecha < ?").bind(corte).first();
    total = r ? r.n : 0;
  } catch (x) { return { error: 'D1 falló: ' + x.message }; }

  if (total < 50) return { ok: true, mensaje: 'Historial ya está destilado.', total };

  // 2. Leer bloques de 200 mensajes para resumir
  let destilados = 0;
  let iteraciones = 0;
  const maxIteraciones = 10; // máximo 2000 mensajes por ejecución

  while (iteraciones < maxIteraciones) {
    let bloque;
    try {
      bloque = await db.prepare("SELECT id, rol, contenido, orden FROM historial_largo WHERE fecha < ? ORDER BY orden ASC LIMIT 200").bind(corte).all();
    } catch (x) { break; }

    if (!bloque.results || !bloque.results.length) break;

    const texto = bloque.results.map(m => `[${m.rol}]: ${(m.contenido || '').substring(0, 300)}`).join('\n');

    let resumen = '';
    try {
      const res = await ai.run(MODELO_LIGERO, {
        messages: [{
          role: 'user',
          content: `Resume este fragmento de conversación con el Comandante. Conserva SOLO lo que sea útil para el proyecto o para la relación: decisiones tomadas, información sobre Shadow Arise, patrones del Comandante, momentos clave. Omite charla trivial, saludos, y redundancias. Máximo 400 palabras.

${texto}`
        }],
        max_tokens: 600,
        temperature: 0.3
      });
      resumen = res.response || res.choices?.[0]?.message?.content || '';
    } catch (x) {
      break;
    }

    if (resumen.length < 50) break;

    // Guardar resumen en resumenes_chat con marca de destilado
    try {
      await db.prepare('INSERT INTO resumenes_chat(user_id, fecha, resumen, desde, hasta) VALUES(?,?,?,?,?)')
        .bind('comandante', Date.now(), '[DESTILADO] ' + resumen, bloque.results[0].orden, bloque.results[bloque.results.length - 1].orden).run();
    } catch (x) { break; }

    // Borrar los mensajes brutos
    try {
      const ids = bloque.results.map(m => m.id);
      const ph = ids.map(() => '?').join(',');
      await db.prepare('DELETE FROM historial_largo WHERE id IN (' + ph + ')').bind(...ids).run();
      destilados += bloque.results.length;
    } catch (x) { break; }

    iteraciones++;
  }

  try {
    await registrarAccion(e, 'destilacion_historial', `Destilados ${destilados} mensajes`, destilados > 0, `Antigüedad: ${dias_antiguedad} días`);
  } catch (x) {}

  return { ok: true, destilados, total_previo: total, iteraciones };
}

// ============================================================
// CRON DE SALUD — corre cada 6h, actúa autónomamente
// ============================================================
export async function cronSalud(e) {
  const db = gDB(e, 'agente');
  const kv = gKV(e, 'agente');
  if (!db || !kv) return;

  // Throttle: máximo 1 vez cada 6h
  const ultima = await kv.get('salud_ultima_ejecucion');
  if (ultima && Date.now() - parseInt(ultima) < 6 * 3600000) return;
  await kv.put('salud_ultima_ejecucion', String(Date.now()));

  const salud = await verificarSalud(e);

  // === ACCIÓN 1: D1 caído → activar modo cache ===
  if (!salud.d1.ok) {
    await activarModoCache(e, 'D1 falló: ' + (salud.d1.error || 'desconocido'));
    // Notificar a Ayanokōji (bandeja interna, no al usuario)
    try {
      await db.prepare('INSERT INTO notificaciones(tipo,titulo,mensaje,leida,fecha) VALUES(?,?,?,0,?)')
        .bind('salud', '⚠️ D1 caído', 'Modo cache activado. Ayanokōji seguirá funcionando con datos en KV. Se sincronizará cuando D1 vuelva.', Date.now()).run();
    } catch (x) {}
  }

  // === ACCIÓN 2: D1 volvió → desactivar modo cache y sincronizar buffer ===
  if (salud.d1.ok && salud.modo_cache_activo) {
    const sinc = await sincronizarBuffer(e);
    await desactivarModoCache(e, 'D1 recuperado');
    try {
      await db.prepare('INSERT INTO notificaciones(tipo,titulo,mensaje,leida,fecha) VALUES(?,?,?,0,?)')
        .bind('salud', '✅ D1 recuperado', `Modo cache desactivado. ${sinc.sincronizadas || 0} escrituras sincronizadas desde buffer.`, Date.now()).run();
    } catch (x) {}
  }

  // === ACCIÓN 3: si D1 está ok pero hay buffer pendiente, sincronizar ===
  if (salud.d1.ok && salud.escrituras_pendientes > 0) {
    await sincronizarBuffer(e);
  }

  // === ACCIÓN 4: GitHub token por expirar → notificar urgente ===
  if (salud.github.ok) {
    try {
      const r = await fetch('https://api.github.com/user', {
        headers: { 'Authorization': `Bearer ${e.GITHUB_TOKEN}`, 'User-Agent': 'shadow-ayano-health' }
      });
      const headers = r.headers;
      // GitHub no expone expiración del token directamente. Alternativa: si falla, notificar.
    } catch (x) {}
  } else if (e.GITHUB_TOKEN) {
    try {
      await db.prepare('INSERT INTO notificaciones(tipo,titulo,mensaje,leida,fecha) VALUES(?,?,?,0,?)')
        .bind('salud', '⚠️ Token GitHub problemático', `Error: ${salud.github.error}. Ayanokōji no puede leer/escribir código. Revisa el token.`, Date.now()).run();
    } catch (x) {}
  }

  // === ACCIÓN 5: Cloudflare API caída → notificar ===
  if (!salud.cloudflare.ok && e.CF_API_TOKEN) {
    try {
      await db.prepare('INSERT INTO notificaciones(tipo,titulo,mensaje,leida,fecha) VALUES(?,?,?,0,?)')
        .bind('salud', '⚠️ Cloudflare API problemática', `Error: ${salud.cloudflare.error}. Auto-reparación y creación de workers no disponibles.`, Date.now()).run();
    } catch (x) {}
  }

  // === ACCIÓN 6: cron atrasado → notificar ===
  if (salud.cron.ultimo_hace_min && salud.cron.ultimo_hace_min > 180) {
    try {
      await db.prepare('INSERT INTO notificaciones(tipo,titulo,mensaje,leida,fecha) VALUES(?,?,?,0,?)')
        .bind('salud', '⚠️ Cron atrasado', `Último cron hace ${salud.cron.ultimo_hace_min} min. Puede estar bloqueado o fallando.`, Date.now()).run();
    } catch (x) {}
  }

  // === ACCIÓN 7: destilar historial si es necesario ===
  // Solo si el historial tiene más de 2000 mensajes
  try {
    const cnt = await db.prepare("SELECT COUNT(*) as n FROM historial_largo").first();
    if (cnt && cnt.n > 2000) {
      await destilarHistorial(e, 30);
    }
  } catch (x) {}

  // === ACCIÓN 8: escribir lección si hay algo recurrente ===
  if (!salud.d1.ok && salud.modo_cache_activo) {
    // Ya está cubierto por el modo cache, no es lección nueva
  } else if (!salud.d1.ok) {
    await escribirLeccion(e, {
      error_concreto: 'D1 falló y no se activó modo cache',
      contexto: 'Cron de salud detectó D1 caído',
      causa_raiz: 'Modo cache no estaba activo antes de la caída',
      leccion: 'Activar modo cache preventivamente si la latencia de D1 sube de 500ms'
    });
  }

  return salud;
}

// ============================================================
// CRON RÁPIDO — corre cada 5 min, solo sincroniza buffer
// (más ligero que cronSalud)
// ============================================================
export async function cronSaludRapido(e) {
  const kv = gKV(e, 'agente');
  if (!kv) return;

  // Si hay buffer pendiente, intentar sincronizar
  try {
    const lista = await kv.list({ prefix: 'buffer:escritura:', limit: 50 });
    if (lista.keys.length > 0) {
      await sincronizarBuffer(e);
    }
  } catch (x) {}

  // Si el modo cache está activo, verificar si D1 ya volvió
  const activo = await modoCacheActivo(e);
  if (activo) {
    const db = gDB(e, 'agente');
    if (db) {
      try {
        await db.prepare('SELECT 1').first();
        // D1 responde: desactivar modo cache
        await desactivarModoCache(e, 'D1 recuperado (verificación rápida)');
        await sincronizarBuffer(e);
      } catch (x) {
        // D1 sigue caído, no hacer nada
      }
    }
  }
}

// ============================================================
// ENDPOINT PARA CONSULTAR SALUD DESDE EL FRONTEND
// ============================================================
export async function estadoSalud(e) {
  const kv = gKV(e, 'agente');
  try {
    const ultimo = await kv.get('health:ultimo');
    if (ultimo) return JSON.parse(ultimo);
  } catch (x) {}
  return await verificarSalud(e);
}
