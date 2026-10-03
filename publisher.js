import { MODELO_LIGERO, J, gDB, gKV } from './shared.js';
import { consumir } from './presupuesto.js';

export async function generarContenido(e, tipo) {
  const ai = e.ayanokoji_IA;
  const db = gDB(e, 'agente');
  if (!ai || !db) return { error: 'IA o D1 no disponible.' };
  if (!await consumir(e, 'publisher')) return { error: 'Presupuesto agotado.' };
  const p = await db.prepare('SELECT prompt FROM plantillas WHERE tipo=? AND activa=1').bind(tipo).first();
  if (!p) return { error: 'Plantilla no encontrada: ' + tipo };
  const res = await ai.run(MODELO_LIGERO, {
    messages: [{ role: 'user', content: p.prompt }],
    max_tokens: 700,
    temperature: 0.85
  });
  return { contenido: res.response || '' };
}

export async function encolar(e, tipo, contenido, canales, programada, imagen_id) {
  const db = gDB(e, 'agente');
  if (!db) return { error: 'D1 no configurado.' };
  const c = Array.isArray(canales) ? canales.join(',') : (canales || 'mastodon');
  const r = await db.prepare(
    'INSERT INTO publicaciones(tipo,contenido,canales,estado,programada,creada,imagen_id) VALUES(?,?,?,?,?,?,?)'
  ).bind(tipo, contenido, c, 'pendiente', programada || Date.now(), Date.now(), imagen_id || null).run();
  return { ok: true, id: r.meta.last_row_id };
}

// ============ MASTODON ============
async function publicarMastodon(e, contenido, imagen_id) {
  const url = e.mastodon_url;
  const token = e.mastodon_token;
  if (!url || !token) return { ok: false, error: 'Mastodon sin configurar.' };
  try {
    let mediaIds = [];
    if (imagen_id) {
      try {
        const kv = gKV(e, 'agente');
        const base64 = await kv.get('img:' + imagen_id);
        if (base64) {
          const bin = atob(base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const fd = new FormData();
          fd.append('file', new Blob([bytes], { type: 'image/png' }), 'imagen.png');
          fd.append('description', contenido.substring(0, 200));
          const media = await fetch(url.replace(/\/$/, '') + '/api/v2/media', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: fd
          });
          const mediaData = await media.json();
          if (mediaData.id) mediaIds.push(mediaData.id);
        }
      } catch (x) {}
    }
    const body = { status: contenido, visibility: 'public' };
    if (mediaIds.length) body.media_ids = mediaIds;
    const r = await fetch(url.replace(/\/$/, '') + '/api/v1/statuses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const d = await r.json();
    return { ok: !!d.id, detalle: d.url || JSON.stringify(d).substring(0, 200) };
  } catch (x) {
    return { ok: false, error: x.message };
  }
}

// ============ BLUESKY ============
async function publicarBluesky(e, contenido, imagen_id) {
  const handle = e.bluesky_handle;
  const pass = e.bluesky_password;
  if (!handle || !pass) return { ok: false, error: 'Bluesky sin configurar.' };
  try {
    const login = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: handle, password: pass })
    });
    const ses = await login.json();
    if (!ses.accessJwt) return { ok: false, error: 'Bluesky login falló.' };

    let embed = null;
    if (imagen_id) {
      try {
        const kv = gKV(e, 'agente');
        const base64 = await kv.get('img:' + imagen_id);
        if (base64) {
          const bin = atob(base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const upload = await fetch('https://bsky.social/xrpc/com.atproto.repo.uploadBlob', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${ses.accessJwt}`, 'Content-Type': 'image/png' },
            body: bytes
          });
          const blob = await upload.json();
          if (blob.blob) {
            embed = { $type: 'app.bsky.embed.images', images: [{ image: blob.blob, alt: contenido.substring(0, 200) }] };
          }
        }
      } catch (x) {}
    }

    const record = { text: contenido.substring(0, 300), createdAt: new Date().toISOString() };
    if (embed) record.embed = embed;

    const post = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ses.accessJwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: ses.did, collection: 'app.bsky.feed.post', record })
    });
    const res = await post.json();
    return { ok: !!res.uri, detalle: res.uri || JSON.stringify(res).substring(0, 200) };
  } catch (x) {
    return { ok: false, error: x.message };
  }
}

// ============ DISCORD ============
async function publicarDiscord(e, contenido, imagen_id) {
  const wh = e.discord_webhook;
  if (!wh) return { ok: false, error: 'Discord sin configurar.' };
  try {
    const body = { content: contenido };
    if (imagen_id) {
      body.embeds = [{ image: { url: 'https://shadow-ayano.yeinierliranzavalle.workers.dev/api/imagen/' + imagen_id } }];
    }
    const r = await fetch(wh, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { ok: r.status === 204 || r.status === 200, detalle: 'status ' + r.status };
  } catch (x) {
    return { ok: false, error: x.message };
  }
}

// ============ REDDIT ============
async function publicarReddit(e, contenido, imagen_id) {
  const clientId = e.reddit_client_id;
  const clientSecret = e.reddit_client_secret;
  const user = e.reddit_username;
  const pass = e.reddit_password;
  const subreddit = e.reddit_subreddit;
  if (!clientId || !user || !pass || !subreddit) return { ok: false, error: 'Reddit sin configurar.' };
  try {
    const auth = btoa(clientId + ':' + (clientSecret || ''));
    const login = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'shadow-arise/1.0'
      },
      body: 'grant_type=password&username=' + encodeURIComponent(user) + '&password=' + encodeURIComponent(pass)
    });
    const tok = await login.json();
    if (!tok.access_token) return { ok: false, error: 'Reddit login falló.' };

    const fd = new URLSearchParams();
    fd.append('sr', subreddit);
    fd.append('title', contenido.split('\n')[0].substring(0, 280));
    fd.append('text', contenido.substring(0, 40000));
    fd.append('kind', 'self');
    fd.append('api_type', 'json');

    const post = await fetch('https://oauth.reddit.com/api/submit', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + tok.access_token,
        'User-Agent': 'shadow-arise/1.0',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: fd.toString()
    });
    const d = await post.json();
    const errores = d.json && d.json.errors;
    if (errores && errores.length) return { ok: false, error: JSON.stringify(errores) };
    return { ok: true, detalle: d.json?.data?.url || 'publicado' };
  } catch (x) {
    return { ok: false, error: x.message };
  }
}

// ============ PUBLICAR (enruta a cada canal) ============
export async function publicar(e, pubId) {
  const db = gDB(e, 'agente');
  if (!db) return { error: 'D1 no configurado.' };
  const p = await db.prepare('SELECT * FROM publicaciones WHERE id=?').bind(pubId).first();
  if (!p) return { error: 'Publicación no encontrada.' };
  if (p.estado === 'publicada') return { ok: true, mensaje: 'Ya publicada.' };

  const canales = (p.canales || 'mastodon').split(',').map(s => s.trim());
  const resultados = {};

  for (const canal of canales) {
    let r;
    if (canal === 'mastodon') r = await publicarMastodon(e, p.contenido, p.imagen_id);
    else if (canal === 'bluesky') r = await publicarBluesky(e, p.contenido, p.imagen_id);
    else if (canal === 'discord') r = await publicarDiscord(e, p.contenido, p.imagen_id);
    else if (canal === 'reddit') r = await publicarReddit(e, p.contenido, p.imagen_id);
    else if (canal === 'feed') r = { ok: true, detalle: 'solo feed interno' };
    else r = { ok: false, error: 'Canal desconocido: ' + canal };
    resultados[canal] = r;
  }

  const todoOk = Object.values(resultados).some(r => r.ok);
  await db.prepare('UPDATE publicaciones SET estado=?,publicada=?,resultado=? WHERE id=?')
    .bind(todoOk ? 'publicada' : 'error', Date.now(), JSON.stringify(resultados), pubId).run();

  return { ok: todoOk, resultados };
}

// ============ RUTA API ============
export async function rutaPublicar(r, e) {
  try {
    const b = await r.json();
    const tipo = b.tipo || 'provocacion';
    const canales = b.canales || 'mastodon';
    const programada = b.programada || Date.now();
    const autoPublicar = b.publicar !== false;
    const imagen_id = b.imagen_id || null;

    let contenido = b.contenido;
    if (!contenido) {
      const g = await generarContenido(e, tipo);
      if (g.error) return J({ error: g.error });
      contenido = g.contenido;
    }

    const enc = await encolar(e, tipo, contenido, canales, programada, imagen_id);
    if (enc.error) return J({ error: enc.error });

    if (autoPublicar && programada <= Date.now()) {
      const pub = await publicar(e, enc.id);
      return J({ ok: true, id: enc.id, contenido, publicado: pub });
    }
    return J({ ok: true, id: enc.id, contenido, programada, imagen_id });
  } catch (x) {
    return J({ error: x.message });
  }
}

// ============ CRON DE PUBLICACIÓN ============
export async function cronPublicar(e) {
  const db = gDB(e, 'agente');
  const ai = e.ayanokoji_IA;
  if (!db || !ai) return;

  // Publicar pendientes cuya hora llegó
  const ahora = Date.now();
  const pend = await db.prepare("SELECT id FROM publicaciones WHERE estado='pendiente' AND programada <= ? LIMIT 3").bind(ahora).all();
  for (const p of (pend.results || [])) await publicar(e, p.id);

  // Generar contenido nuevo según plantillas (solo si hay presupuesto)
  if (!await consumir(e, 'publisher')) return;
  const pls = await db.prepare('SELECT * FROM plantillas WHERE activa=1').all();
  for (const pl of (pls.results || [])) {
    const horasPasadas = (ahora - (pl.ultima_gen || 0)) / 3600000;
    if (horasPasadas >= pl.frecuencia_horas) {
      try {
        const g = await generarContenido(e, pl.tipo);
        if (g.contenido) {
          // Elegir canal según hora del día
          const hora = new Date().getUTCHours();
          const canal = hora < 12 ? 'mastodon' : hora < 18 ? 'bluesky' : 'mastodon';
          await encolar(e, pl.tipo, g.contenido, canal, ahora, null);
          await db.prepare('UPDATE plantillas SET ultima_gen=? WHERE id=?').bind(ahora, pl.id).run();
        }
      } catch (x) {}
    }
  }
}
