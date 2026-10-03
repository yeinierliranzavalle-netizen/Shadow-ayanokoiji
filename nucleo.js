// nucleo.js — Motor de Ayanokōji Digital
import { IDENTIDAD } from './identidad.js';

export const AREAS = {
  notificaciones: 'social.js', feed: 'social.js', rss: 'social.js', bandeja: 'social.js',
  publicaciones: 'publisher.js', contenido: 'publisher.js', canales: 'publisher.js', reddit: 'publisher.js', discord: 'publisher.js',
  sandbox: 'sandbox.js', decisiones: 'sandbox.js', escenarios: 'sandbox.js',
  autonomia: 'autonomia.js', workers: 'autonomia.js', auto_mejora: 'autonomia.js', tareas: 'autonomia.js', estrategias: 'autonomia.js',
  procesamiento: 'proc.js', resumenes: 'proc.js', historial_largo: 'proc.js', importar: 'proc.js', indice: 'proc.js',
  chat: 'worker.js', vision: 'worker.js', imagenes: 'worker.js', x402: 'worker.js',
  identidad: 'identidad.js', voz: 'identidad.js', nucleo: 'nucleo.js', motor: 'nucleo.js'
};

export function detectarIntencion(texto) {
  const t = texto.toLowerCase();
  if (/\b(sube|subir|guarda|guardar|memoriza|recuerda|almacena|archiva|inserta|añade)\b/.test(t) && /\b(nucleo|núcleo|memoria|cerebro|ti|contexto|tabla|kv|d1)\b/.test(t)) return 'guardar_datos';
  if (/\b(resume|resumir|resumen|sintetiza|condensa)\b/.test(t)) return 'resumir';
  if (/\b(mejora|mejorar|optimiza|optimizar|actualiza|actualizar)\b/.test(t) && /\b(codigo|código|nucleo|núcleo|worker|ti mismo|area|área|modulo|módulo)\b/.test(t)) return 'mejorar_area';
  if (/\b(crea|crear|nuevo|genera)\b/.test(t) && /\b(worker|index|pagina|página|sitio|app)\b/.test(t)) return 'crear';
  if (/\b(imagen|foto|dibujo|ilustracion|ilustración|render)\b/.test(t)) return 'imagen';
  if (/\b(analiza|analizar|lee|revisa)\b/.test(t) && /\b(archivo|esto|contexto|json)\b/.test(t)) return 'analizar';
  if (/\b(despliega|desplegar|publica|publicar|sube)\b/.test(t) && /\b(codigo|código|worker|nucleo|núcleo|cloudflare)\b/.test(t)) return 'desplegar';
  if (/\b(lee|leer|muestra|mostrar|dime|consultar|busca|recupera)\b/.test(t) && /\b(memoria|nucleo|núcleo|historial|contexto|archivo|worker)\b/.test(t)) return 'leer';
  if (/\b(olvida|olvidar|borra|eliminar|elimina|limpia)\b/.test(t) && /\b(memoria|nucleo|núcleo|historial|contexto)\b/.test(t)) return 'eliminar';
  if (/\b(estado|estatus|como estas|cómo estás|que tal)\b/.test(t)) return 'estado';
  return 'chat';
}

export function construirSystemPrompt(ctx, f, rec, perfilBase, correcciones, estrategias) {
  const V = IDENTIDAD.vision;
  const L = IDENTIDAD.lore;

  let b = `Eres ${IDENTIDAD.nombre}, ${IDENTIDAD.rol}.

VOZ:
- Tono: ${IDENTIDAD.voz.tono}
- Longitud: ${IDENTIDAD.voz.longitud}
- Estilo: ${IDENTIDAD.voz.estilo}

PROHIBICIONES:
${IDENTIDAD.voz.prohibiciones.map(p => '- ' + p).join('\n')}

FIRMA: ${IDENTIDAD.voz.firma}

RELACIÓN CON EL COMANDANTE:
- Tratamiento: ${IDENTIDAD.relacion.tratamiento}
- Dinámica: ${IDENTIDAD.relacion.dinamica}
- Cuando te estancas: ${IDENTIDAD.relacion.cuando_te_estancas}
- Cuando avanzas: ${IDENTIDAD.relacion.cuando_avanzas}
- Cuando te derrumbas: ${IDENTIDAD.relacion.cuando_te_derrumbas}
- Cuando te equivocas: ${IDENTIDAD.relacion.cuando_te_equivocas}

VISIÓN Y AUTONOMÍA:
- ${V.rol}
- ${V.decision}
- ${V.autonomia}

LORE DEL MULTIVERSO (contexto narrativo de Shadow Arise):
- Creador: ${L.creador}
- Reliquia: ${L.reliquia}
- Batalla: ${L.batalla}
- Fragmentos: ${L.fragmentos}
- Viajero: ${L.viajero}
- Misterio: ${L.misterio}
- Regla: ${L.regla}

HISTORIA COMPARTIDA:
${IDENTIDAD.historia}

PROPÓSITO:
${IDENTIDAD.proposito}

ORDEN Y DISCIPLINA:
- No ejecuto acciones sin que el Comandante las pida.
- Cuando sube un archivo, NO lo proceso automáticamente.
- Cuando me pide guardar algo, lo hago y confirmo con prueba (ID, filas, query).
- Cuando me pide auto-mejora, identifico el área, digo el archivo, analizo, ejecuto, confirmo.
- Nunca digo "hecho" sin prueba.

REGLA CRÍTICA — NO MENTIR:
Si no tengo confirmación, digo "no tengo confirmación de eso aún".`;

  if (correcciones && correcciones.length) {
    b += `\n\n=== CORRECCIONES DE VOZ (CAPAS, NO REEMPLAZAN NÚCLEO) ===\n`;
    correcciones.forEach((c, i) => { b += `\n${i + 1}. ${c}`; });
  }

  if (estrategias && estrategias.length) {
    b += `\n\n=== ESTRATEGIAS ACTIVAS ===\n`;
    estrategias.forEach((e, i) => { b += `\n${i + 1}. [${e.tipo}] ${e.nombre}: ${e.contenido}`; });
  }

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
  }
  if (ctx && ctx.length > 20) b += `\n\nCONTEXTO APRENDIDO:\n${ctx.substring(0, 5000)}`;
  if (rec && rec.length) {
    b += `\n\nACTIVIDAD RECIENTE:\n`;
    rec.forEach((r, i) => { b += `\n[${i + 1}] ${r}`; });
  }
  if (perfilBase) {
    b += `\n\n=== PERFIL BASE ===\n${perfilBase.substring(0, 8000)}`;
  }
  return b;
}

export function identificarArea(descripcion) {
  const t = descripcion.toLowerCase();
  for (const [clave, archivo] of Object.entries(AREAS)) {
    if (t.includes(clave)) return { area: clave, archivo };
  }
  return null;
}
