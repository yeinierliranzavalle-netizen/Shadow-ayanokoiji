// ==================================================
// SHADOW ARISE - AGENTE DIGITAL (COMPACTO)
// ==================================================
const L=950*1024;

export default {
  async fetch(r,e) {
    const u=new URL(r.url), p=u.pathname;
    if (p==='/'||p==='/index.html') return new Response(H,{'Content-Type':'text/html'});
    if (p==='/api/chat'&&r.method==='POST') return await C(r,e);
    if (p==='/api/subir'&&r.method==='POST') return await U(r,e);
    if (p==='/api/resumir'&&r.method==='POST') return await R(r,e);
    if (p==='/api/d1'&&r.method==='POST') return await D(r,e);
    if (p==='/api/kv'&&r.method==='POST') return await K(r,e);
    if (p==='/api/crear-worker'&&r.method==='POST') return await W(r,e);
    if (p==='/api/mejorar'&&r.method==='POST') return await M(r,e);
    if (p==='/api/desplegar'&&r.method==='POST') return await P(r,e);
    if (p==='/api/estado') return j({estado:'activo'});
    return new Response('Ruta no encontrada',{status:404});
  }
};

// --- CHAT ---
async function C(r,e){try{const{m}=await r.json();if(!m)return j({error:'No mensaje'});if(!e.ayanokoji_IA)return j({error:'IA no configurada'});const a=e.ayanokoji_IA,res=await a.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast',{messages:[{role:'system',content:'Eres Ayanokōji. Responde en español.'},{role:'user',content:m}],max_tokens:800,temperature:.6});return j({respuesta:res.response||'Error'})}catch(err){return j({error:'Chat error: '+err.message})}}

// --- SUBIR ARCHIVO ---
async function U(r,e){try{const f=await r.formData(),a=f.get('archivo'),n=f.get('nombre')||a.name||'sin',d=f.get('destino')||'agente';if(!a)return j({error:'No archivo'});const buf=await a.arrayBuffer(),s=buf.byteLength,k=G(e,d);if(!k)return j({error:'Destino inválido'});const id=Date.now()+'_'+n.replace(/[^a-zA-Z0-9._-]/g,'_'),bytes=new Uint8Array(buf),chunks=[];for(let i=0;i<bytes.length;i+=L)chunks.push(bytes.slice(i,i+L));for(let i=0;i<chunks.length;i++)await k.put('file:'+id+':'+i,btoa(String.fromCharCode(...chunks[i])));const db=F(e,d);await db.prepare('INSERT INTO archivos(id,nombre,tamaño,chunks,destino,fecha)VALUES(?,?,?,?,?,?)').bind(id,n,s,chunks.length,d,Date.now()).run();return j({mensaje:'Subido ('+chunks.length+' fragmentos)',id:id})}catch(err){return j({error:'Subir error: '+err.message})}}

// --- RESUMIR ---
async function R(r,e){try{const{a,t,d}=await r.json();if(!t&&!a)return j({error:'Falta texto o archivoId'});let c=t;if(a){const k=G(e,d||'agente');if(!k)return j({error:'Destino inválido'});const list=await k.list({prefix:'file:'+a+':'});let comp='';for(const key of list.keys){const chunk=await k.get(key.name);if(chunk)comp+=chunk}c=comp}if(!c||c.length<100)return j({error:'Contenido corto'});const ai=e.ayanokoji_IA;if(!ai)return j({error:'IA no configurada'});const res=await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast',{messages:[{role:'user',content:'Resume en 6 fases separadas por punto y coma: '+c.substring(0,8000)}],max_tokens:500,temperature:.5});const sum=res.response||'No se pudo';const fases=sum.split(/[.;]/).map(p=>p.trim()).filter(p=>p.length>10).slice(0,6);while(fases.length<6)fases.push('Pendiente');const db=F(e,d||'agente');await db.prepare('INSERT INTO contexto(fecha,resumen,fases,fuente)VALUES(?,?,?,?)').bind(Date.now(),sum,JSON.stringify(fases),a||'texto').run();return j({mensaje:'Resumen guardado',fases:fases})}catch(err){return j({error:'Resumir error: '+err.message})}}

// --- D1 ---
async function D(r,e){try{const{a,t,d,c,o}=await r.json();const db=F(e,o||'agente');if(!db)return j({error:'D1 inválido'});if(a==='leer'){if(!t)return j({error:'Falta tabla'});const res=await db.prepare('SELECT * FROM '+t+' '+(c||'')).all();return j({resultado:res.results,total:res.results.length})}if(a==='escribir'){if(!t||!d)return j({error:'Faltan tabla/datos'});const ks=Object.keys(d),pl=ks.map(()=>'?').join(',');await db.prepare('INSERT INTO '+t+' ('+ks.join(',')+') VALUES ('+pl+')').bind(...Object.values(d)).run();return j({mensaje:'Insertado'})}if(a==='eliminar'){if(!t||!c)return j({error:'Faltan tabla/condición'});await db.prepare('DELETE FROM '+t+' WHERE '+c).run();return j({mensaje:'Eliminado'})}return j({error:'Acción no reconocida'})}catch(err){return j({error:'D1 error: '+err.message})}}

// --- KV ---
async function K(r,e){try{const{a,c,v,d}=await r.json();const k=G(e,d||'agente');if(!k)return j({error:'KV inválido'});if(a==='leer'){if(!c)return j({error:'Falta clave'});const val=await k.get(c);return j({clave:c,valor:val||null})}if(a==='escribir'){if(!c||!v)return j({error:'Faltan clave/valor'});await k.put(c,v);return j({mensaje:'Guardado'})}if(a==='eliminar'){if(!c)return j({error:'Falta clave'});await k.delete(c);return j({mensaje:'Eliminado'})}return j({error:'Acción no reconocida'})}catch(err){return j({error:'KV error: '+err.message})}}

// --- CREAR WORKER ---
async function W(r,e){try{const{n,c,d}=await r.json();if(!n||!c)return j({error:'Faltan nombre/código'});const k=G(e,d||'agente');await k.put('worker:'+n,c);const db=F(e,d||'agente');await db.prepare('INSERT INTO workers(nombre,codigo,fecha)VALUES(?,?,?)').bind(n,c.substring(0,200),Date.now()).run();return j({mensaje:'Worker "'+n+'" guardado'})}catch(err){return j({error:'Error: '+err.message})}}

// --- MEJORAR ---
async function M(r,e){try{const{n,d}=await r.json();if(!n)return j({error:'Falta código'});const k=G(e,d||'agente');await k.put('worker:version',n);return j({mensaje:'Código guardado. Usa /api/desplegar'})}catch(err){return j({error:err.message})}}

// --- DESPLEGAR ---
async function P(r,e){try{const{n,d}=await r.json();const k=G(e,d||'agente');const c=n?await k.get('worker:'+n):await k.get('worker:version');if(!c)return j({error:'No se encontró código'});await k.put('worker:pendiente',c);return j({mensaje:'Código preparado para despliegue'})}catch(err){return j({error:'Desplegar error: '+err.message})}}

// --- UTILIDADES ---
function j(d){return new Response(JSON.stringify(d),{'Content-Type':'application/json'})}
function F(e,d){const m={agente:e.DB,test:e.DB_test,shadow:e.DB_shadow_arise};return m[d]||null}
function G(e,d){const m={agente:e.KV,test:e.KV_test,shadow:e.KV_shadow_arise};return m[d]||null}

// --- HTML (MINIMALISTA Y FUNCIONAL) ---
const H=`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name=viewport content="width=device-width,initial-scale=1"><title>Ayanokōji</title><style>*{margin:0;padding:0;box-sizing:border-box;font-family:system-ui,sans-serif}body{background:#0a0a14;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:1rem}.card{max-width:600px;width:100%;background:#0d1420;border:1px solid #2c3a5a;border-radius:16px;padding:1.5rem}h1{color:#aaffff;text-align:center;font-weight:300}h1 span{color:#7a5cff;font-weight:600}.chat{height:300px;overflow-y:auto;border:1px solid #1a2a3a;border-radius:12px;padding:.8rem;margin:.8rem 0;background:#0a1525;display:flex;flex-direction:column;gap:.4rem}.msg{max-width:85%;padding:.5rem 1rem;border-radius:12px;font-size:.9rem}.msg.u{align-self:flex-end;background:#1a2a4a;color:#d0d8e8}.msg.b{align-self:flex-start;background:#0f1a2a;border:1px solid #2c3a5a;color:#c8d8e8}.area{display:flex;gap:.4rem;margin-top:.4rem}.area input{flex:1;padding:.6rem;border-radius:10px;border:1px solid #2c4a6a;background:#0a1525;color:#fff}.area button{padding:.6rem 1rem;border:none;border-radius:10px;background:linear-gradient(135deg,#2a1a5a,#4a2a7a);color:#fff;font-weight:bold;cursor:pointer}.file-area{display:flex;gap:.4rem;margin-top:.4rem;flex-wrap:wrap}.file-area input[type=file]{flex:1;padding:.4rem;border-radius:10px;border:1px solid #2c4a6a;background:#0a1525;color:#aaffff;min-width:120px}.file-area select{padding:.4rem;border-radius:10px;border:1px solid #2c4a6a;background:#0a1525;color:#fff;min-width:80px}.file-area button{padding:.6rem 1rem;border:none;border-radius:10px;background:#2a4a6a;color:#fff;font-weight:bold;cursor:pointer}.st{font-size:.75rem;color:#6a6a8a;text-align:center;margin-top:.4rem}.res{margin-top:.4rem;padding:.4rem;border-radius:8px;background:#0a1525;border:1px solid #2c4a6a;font-size:.8rem;color:#aaffff;white-space:pre-wrap;word-break:break-word}</style></head><body><div class=card><h1>⚡<span>SHADOW</span> ARISE</h1><p style=text-align:center;color:#6a6a8a;font-size:.8rem>Ayanokōji Digital</p><div class=chat id=m><div class="msg b">Agente listo.</div></div><div class=area><input type=text id=i placeholder="Mensaje..."><button id=s>Enviar</button></div><div class=file-area><input type=file id=f><select id=o><option value=agente>Agente</option><option value=test>Test</option><option value=shadow>Shadow</option></select><button id=u>Subir</button><button id=r style=background:#2a4a6a>Resumir</button></div><div id=res class=res>Esperando...</div><div class=st id=st>Conectado</div></div><script>
const W=location.origin,m=document.getElementById('m'),i=document.getElementById('i'),s=document.getElementById('s'),f=document.getElementById('f'),u=document.getElementById('u'),r=document.getElementById('r'),o=document.getElementById('o'),res=document.getElementById('res'),st=document.getElementById('st');
function add(t,e){const d=document.createElement('div');d.className='msg '+t;d.textContent=e;m.appendChild(d);m.scrollTop=m.scrollHeight}
function setRes(e){res.textContent=e}
s.onclick=async()=>{const t=i.value.trim();if(!t)return;add('u',t);i.value='';i.disabled=s.disabled=!0;st.textContent='⏳';try{const rsp=await fetch(W+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mensaje:t})}),data=await rsp.json();add('b',data.respuesta||'⚠️ Error')}catch(e){add('b','⚠️ Error')}i.disabled=s.disabled=!1;i.focus();st.textContent='Conectado'};
i.addEventListener('keydown',e=>{if(e.key==='Enter')s.click()});
u.onclick=async()=>{const file=f.files[0];if(!file){setRes('❌ Archivo');return}const fd=new FormData();fd.append('archivo',file);fd.append('nombre',file.name);fd.append('destino',o.value);setRes('⏳ Subiendo...');try{const rsp=await fetch(W+'/api/subir',{method:'POST',body:fd}),data=await rsp.json();setRes(data.mensaje?'✅ '+data.mensaje:'❌ '+data.error)}catch(e){setRes('❌ Error')}};
r.onclick=async()=>{const t=prompt('Texto o file:ID');if(!t)return;setRes('⏳ Resumiendo...');try{const b=t.startsWith('file:')?{archivoId:t.replace('file:',''),destino:o.value}:{texto:t,destino:o.value};const rsp=await fetch(W+'/api/resumir',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}),data=await rsp.json();if(data.fases)setRes('📋 '+data.fases.map((f,i)=>(i+1)+'. '+f).join('\n'));else setRes('❌ '+data.error)}catch(e){setRes('❌ Error')}};
</script></body></html>`;
