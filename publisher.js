import { MODELO_LIGERO, J, gDB } from './shared.js';
import { notificar } from './notify.js';
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

export async function encolar(e, tipo, contenido, canales, programada) {
  const db = gDB(e, 'agente');
  if (!db) return { error: 'D1 no configurado.' };
  const c = Array.isArray(canales) ? canales.join(',') : (canales || 'telegram');
  const r = await db.prepare(
    'INSERT INTO publicaciones(tipo,contenido,canales,estado,programada,creada) VALUES(?,?,?,?,?,?)'
  ).bind(tipo, contenido, c, 'pendiente', programada || Date.now(), Date.now()).run();
  return { ok: true, id: r.meta.last_row_id };
}

async function publicarTelegram(e, contenido) {
  const token = e.telegram_titiritero_bot;
  const canal = e.telegram_canal_id;
  if (!token || !canal) return { ok: false, error: 'Telegram sin configurar.' };
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: canal, text: contenido, parse_mode: 'Markdown', disable_web_page_preview: false })
  });
  const d = await r.json();
  return { ok: d.ok === true, detalle: d.description || 'ok' };
}

async function publicarDiscord(e, contenido) {
  const wh = e.discord_webhook;
  if (!wh) return { ok: false, error: 'Discord sin configurar.' };
  const r = await fetch(wh, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: contenido })
  });
  return { ok: r.status === 204 || r.status === 200, detalle: 'status ' + r.status };
}

async function publicarBluesky(e, contenido) {
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
    const post = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ses.accessJwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: ses.did,
        collection: 'app.bsky.feed.post',
        record: { text: contenido, createdAt: new Date().toISOString() }
      })
    });
    const res = await post.json();
    return { ok: !!res.uri, detalle: res.uri || JSON.stringify(res) };
  } catch (x) { return { ok: false, error: x.message }; }
}

async function publicarMastodon(e, contenido) {
  const url = e.mastodon_url;
  const token = e.mastodon_token;
  if (!url || !token) return { ok: false, error: 'Mastodon sin configurar.' };
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/api/v1/statuses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: contenido, visibility: 'public' })
    });
    const d = await r.json();
    return { ok: !!d.id, detalle: d.url || JSON.stringify(d) };
  } catch (x) { return { ok: false, error: x.message }; }
}

export async function publicar(e, pubId) {
  const db = gDB(e, 'agente');
  if (!db) return { error: 'D1 no configurado.' };
  const p = await db.prepare('SELECT * FROM publicaciones WHERE id=?').bind(pubId).first();
  if (!p) return { error: 'Publicación no encontrada.' };
  if (p.estado === 'publicada') return { ok: true, mensaje: 'Ya publicada.' };

  const canales = (p.canales || 'telegram').split(',').map(s => s.trim());
  const resultados = {};

  for (const canal of canales) {
    let r;
    if (canal === 'telegram') r = await publicarTelegram(e, p.contenido);
    else if (canal === 'discord') r = await publicarDiscord(e, p.contenido);
    else if (canal === 'bluesky') r = await publicarBluesky(e, p.contenido);
    else if (canal === 'mastodon') r = await publicarMastodon(e, p.contenido);
    else r = { ok: false, error: 'Canal desconocido: ' + canal };
    resultados[canal] = r;
  }

  const todoOk = Object.values(resultados).some(r => r.ok);
  await db.prepare('UPDATE publicaciones SET estado=?,publicada=?,resultado=? WHERE id=?')
    .bind(todoOk ? 'publicada' : 'error', Date.now(), JSON.stringify(resultados), pubId).run();

  return { ok: todoOk, resultados };
}

export async function rutaPublicar(r, e) {
  try {
    const b = await r.json();
    const tipo = b.tipo || 'provocacion';
    const canales = b.canales || 'telegram';
    const programada = b.programada || Date.now();
    const autoPublicar = b.publicar !== false;

    let contenido = b.contenido;
    if (!contenido) {
      const g = await generarContenido(e, tipo);
      if (g.error) return J({ error: g.error });
      contenido = g.contenido;
    }

    const enc = await encolar(e, tipo, contenido, canales, programada);
    if (enc.error) return J({ error: enc.error });

    if (autoPublicar && programada <= Date.now()) {
      const pub = await publicar(e, enc.id);
      return J({ ok: true, id: enc.id, contenido, publicado: pub });
    }
    return J({ ok: true, id: enc.id, contenido, programada });
  } catch (x) {
    return J({ error: x.message });
  }
}

export async function cronPublicar(e) {
  const db = gDB(e, 'agente');
  const ai = e.ayanokoji_IA;
  if (!db || !ai) return;

  const ahora = Date.now();
  const pend = await db.prepare(
    "SELECT id FROM publicaciones WHERE estado='pendiente' AND programada <= ? LIMIT 3"
  ).bind(ahora).all();
  for (const p of (pend.results || [])) await publicar(e, p.id);

  if (!await consumir(e, 'publisher')) return;
  const pls = await db.prepare('SELECT * FROM plantillas WHERE activa=1').all();
  for (const pl of (pls.results || [])) {
    const horasPasadas = (ahora - (pl.ultima_gen || 0)) / 3600000;
    if (horasPasadas >= pl.frecuencia_horas) {
      try {
        const g = await generarContenido(e, pl.tipo);
        if (g.contenido) {
          await encolar(e, pl.tipo, g.contenido, 'telegram', ahora);
          await db.prepare('UPDATE plantillas SET ultima_gen=? WHERE id=?').bind(ahora, pl.id).run();
        }
      } catch (x) {}
    }
  }
}
