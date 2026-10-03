import { J, gDB, gKV } from './shared.js';

// ============================================================
// NOTIFICACIONES INTERNAS (BANDEJA)
// ============================================================
export async function crearNotificacion(e, tipo, titulo, mensaje) {
  const db = gDB(e, 'agente');
  if (!db) return false;
  try {
    await db.prepare('INSERT INTO notificaciones(tipo,titulo,mensaje,leida,fecha) VALUES(?,?,?,0,?)')
      .bind(tipo, titulo, mensaje, Date.now()).run();
    return true;
  } catch (x) { return false; }
}

export async function listarNotificaciones(e, limite = 50) {
  const db = gDB(e, 'agente');
  if (!db) return { notificaciones: [], no_leidas: 0 };
  try {
    const r = await db.prepare('SELECT * FROM notificaciones ORDER BY fecha DESC LIMIT ?').bind(limite).all();
    const unread = await db.prepare('SELECT COUNT(*) as n FROM notificaciones WHERE leida=0').first();
    return { notificaciones: r.results || [], no_leidas: unread ? unread.n : 0 };
  } catch (x) {
    return { notificaciones: [], no_leidas: 0 };
  }
}

export async function marcarLeidas(e, ids) {
  const db = gDB(e, 'agente');
  if (!db) return false;
  try {
    if (Array.isArray(ids) && ids.length) {
      const ph = ids.map(() => '?').join(',');
      await db.prepare('UPDATE notificaciones SET leida=1 WHERE id IN (' + ph + ')').bind(...ids).run();
    } else {
      await db.prepare('UPDATE notificaciones SET leida=1 WHERE leida=0').run();
    }
    return true;
  } catch (x) { return false; }
}

// ============================================================
// FEED PÚBLICO (HTML)
// ============================================================
function escaparHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escaparXML(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function renderFeed(e) {
  const db = gDB(e, 'agente');
  if (!db) return new Response('Sin datos.', { status: 500, headers: { 'Content-Type': 'text/plain' } });

  let publicaciones = [];
  try {
    const r = await db.prepare(
      "SELECT tipo, contenido, publicada, imagen_id FROM publicaciones WHERE estado='publicada' ORDER BY publicada DESC LIMIT 50"
    ).all();
    publicaciones = r.results || [];
  } catch (x) {}

  const TIPOS = { lore: 'Lore', teaser: 'Teaser', dialogo: 'Diálogo', provocacion: 'Provocación', anuncio: 'Anuncio' };

  const items = publicaciones.map(p => {
    const fecha = new Date(p.publicada || Date.now()).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    const tipo = TIPOS[p.tipo] || p.tipo || '—';
    const imgHtml = p.imagen_id
      ? '<img src="/api/imagen/' + escaparHTML(p.imagen_id) + '" alt="" loading="lazy" style="width:100%;border-radius:8px;margin-bottom:12px">'
      : '';
    return `<article class="post">
      <div class="meta">${tipo} · ${fecha}</div>
      ${imgHtml}
      <div class="contenido">${escaparHTML(p.contenido || '')}</div>
    </article>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shadow Arise · Feed</title>
<link rel="alternate" type="application/rss+xml" title="Shadow Arise" href="/rss.xml">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#08080c;color:#e9e9ee;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,sans-serif;line-height:1.6;padding:40px 20px}
.wrap{max-width:680px;margin:0 auto}
header{margin-bottom:40px;padding-bottom:20px;border-bottom:1px solid #24242f}
h1{font-size:28px;font-weight:500;letter-spacing:-.5px;margin-bottom:6px}
h1 b{background:linear-gradient(90deg,#9b83ff,#4fc3f7);-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{color:#8b8b9a;font-size:14px}
.post{background:#16161f;border:1px solid #24242f;border-radius:14px;padding:20px;margin-bottom:16px;transition:.15s}
.post:hover{border-color:#32323f}
.post .meta{font-size:11px;color:#55555f;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px;font-weight:600}
.post .contenido{white-space:pre-wrap;font-size:15px;color:#e9e9ee}
footer{margin-top:40px;padding-top:20px;border-top:1px solid #24242f;color:#55555f;font-size:12px;text-align:center}
a{color:#9b83ff;text-decoration:none}
a:hover{text-decoration:underline}
.empty{text-align:center;color:#55555f;padding:40px 20px;font-size:14px}
</style>
</head>
<body>
<div class="wrap">
<header>
<h1>Shadow <b>Arise</b></h1>
<p class="sub">Feed oficial · <a href="/rss.xml">RSS</a></p>
</header>
${items || '<div class="empty">Sin publicaciones aún.</div>'}
<footer>Shadow Arise · Operado por Ayanokōji Digital</footer>
</div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60'
    }
  });
}

// ============================================================
// RSS
// ============================================================
export async function renderRSS(e, baseUrl) {
  const db = gDB(e, 'agente');
  if (!db) return new Response('Sin datos.', { status: 500 });

  let pubs = [];
  try {
    const r = await db.prepare(
      "SELECT tipo, contenido, publicada FROM publicaciones WHERE estado='publicada' ORDER BY publicada DESC LIMIT 30"
    ).all();
    pubs = r.results || [];
  } catch (x) {}

  const items = pubs.map(p => {
    const fecha = new Date(p.publicada || Date.now()).toUTCString();
    const title = (p.tipo || 'Publicación') + ' · ' + new Date(p.publicada || Date.now()).toLocaleDateString('es-ES');
    return `    <item>
      <title>${escaparXML(title)}</title>
      <link>${baseUrl}/feed#${p.publicada || ''}</link>
      <guid isPermaLink="false">${p.publicada || Date.now()}</guid>
      <pubDate>${fecha}</pubDate>
      <description>${escaparXML(p.contenido || '')}</description>
    </item>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Shadow Arise</title>
    <link>${baseUrl}/feed</link>
    <description>Contenido oficial de Shadow Arise</description>
    <language>es</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300'
    }
  });
}

// ============================================================
// SUSCRIPCIONES PUSH (Web Push futuro)
// ============================================================
export async function suscribir(e, sub, userAgent) {
  const db = gDB(e, 'agente');
  if (!db) return { error: 'D1 no disponible.' };
  try {
    await db.prepare(
      'INSERT OR REPLACE INTO suscripciones_push(endpoint, keys_p256dh, keys_auth, user_agent, creada, activa) VALUES(?,?,?,?,?,1)'
    ).bind(sub.endpoint, sub.keys?.p256dh || '', sub.keys?.auth || '', userAgent || '', Date.now()).run();
    return { ok: true };
  } catch (x) {
    return { error: x.message };
  }
}

export async function listarSuscripciones(e) {
  const db = gDB(e, 'agente');
  if (!db) return [];
  try {
    const r = await db.prepare('SELECT endpoint, keys_p256dh, keys_auth FROM suscripciones_push WHERE activa=1').all();
    return r.results || [];
  } catch (x) { return []; }
}
