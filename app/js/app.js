"use strict";
/* UI + wiring: folder browser, similarity map, sequencer grid, transport, view switch. */

/* ---------- load / index ---------- */
$("#pick").onclick=()=>$("#dir").click();
$("#dir").onchange=e=>index([...e.target.files]);
function index(files){
  items=[]; bufCache.clear(); feat.clear(); atype.clear(); proj=new Map(); pb=null; typeFilter.clear();
  for(const f of files){
    if(!/\.wav$/i.test(f.name)) continue;
    const rel=f.webkitRelativePath||f.name, p=rel.split("/");
    const segs=p.length>1?p.slice(1):p.slice();   // path relative to the picked root
    items.push({file:f,name:f.name,path:rel,segs,cat:segs[0]||"ROOT"});
  }
  items.sort((a,b)=>a.cat.localeCompare(b.cat)||a.name.localeCompare(b.name));
  const m=new Map(); for(const it of items) m.set(it.cat,(m.get(it.cat)||0)+1);
  cats=[...m.keys()].sort((a,b)=>{const ia=ORDER.indexOf(a),ib=ORDER.indexOf(b);
    return (ia<0?99:ia)-(ib<0?99:ib)||a.localeCompare(b);}).map(c=>({c,n:m.get(c)}));
  curPath=[]; $("#welcome").style.display="none";
  $("#stat").textContent=`${items.length} samples · ${cats.length} top folders`;
  renderSide(); buildLegend(); buildGrid(); backgroundClassify();
}
function filtered(){
  const q=$("#search").value.trim().toLowerCase(), cp=curPath;
  return items.filter(it=>{ const f=it.segs.slice(0,-1);
    if(f.length<cp.length) return false;
    for(let i=0;i<cp.length;i++) if(f[i]!==cp[i]) return false;
    return !q || it.name.toLowerCase().includes(q); });
}
function childFolders(cp){
  const c=new Map();
  for(const it of items){ const f=it.segs.slice(0,-1);
    if(f.length<=cp.length) continue; let ok=true;
    for(let i=0;i<cp.length;i++){ if(f[i]!==cp[i]){ok=false;break;} } if(!ok) continue;
    const nm=f[cp.length]; c.set(nm,(c.get(nm)||0)+1); }
  return [...c.entries()].sort((a,b)=>{const ia=ORDER.indexOf(a[0]),ib=ORDER.indexOf(b[0]);
    return (ia<0?99:ia)-(ib<0?99:ib)||a[0].localeCompare(b[0]);}).map(([name,n])=>({name,n}));
}
function countUnder(cp){ let n=0; for(const it of items){const f=it.segs.slice(0,-1);
  if(f.length<cp.length)continue; let ok=true; for(let i=0;i<cp.length;i++){if(f[i]!==cp[i]){ok=false;break;}} if(ok)n++;} return n; }
// most common sound-type among samples under cp/name — used to color a folder's dot
function domType(cp,name){ const tgt=[...cp,name], c={};
  for(const it of items){ const f=it.segs.slice(0,-1);
    if(f.length<tgt.length) continue; let ok=true;
    for(let i=0;i<tgt.length;i++){ if(f[i]!==tgt[i]){ok=false;break;} } if(!ok) continue;
    const t=atype.get(it.path); if(!t) continue;   // only analyzed (audio-derived) samples
    c[t]=(c[t]||0)+1; }
  let best="OTHER",bn=-1; for(const k in c) if(c[k]>bn){bn=c[k];best=k;} return best; }

/* ---------- sidebar (folder tree) ---------- */
function renderSide(){
  const side=$("#side"); side.innerHTML="<h3>Folders</h3>";
  const bc=document.createElement("div"); bc.className="crumbs";
  const segs=["All",...curPath];
  segs.forEach((s,i)=>{ const a=document.createElement("span");
    a.className="crumb"+(i===segs.length-1?" last":""); a.textContent=s;
    if(i<segs.length-1) a.onclick=()=>{ curPath=curPath.slice(0,i); renderSide(); drawMap(); };
    bc.appendChild(a);
    if(i<segs.length-1){ const sep=document.createElement("span"); sep.className="csep"; sep.textContent=" › "; bc.appendChild(sep);} });
  side.appendChild(bc);
  const folders=childFolders(curPath);
  for(const {name,n} of folders){
    const el=document.createElement("div"); el.className="cat";
    el.innerHTML=`<span class="lbl"><span class="dot" style="background:${colorFor(domType(curPath,name))}"></span>${name}</span><span class="n">${n}</span>`;
    el.onclick=()=>{ curPath=[...curPath,name]; renderSide(); drawMap(); };
    side.appendChild(el);
  }
  if(!folders.length){ const e=document.createElement("div"); e.className="cat"; e.style.cursor="default";
    e.innerHTML=`<span class="lbl" style="color:var(--dim)">${countUnder(curPath)} samples here</span>`; side.appendChild(e); }
}
function buildLegend(){ const present=new Set(atype.values()), host=$("#legend"); host.innerHTML="";
  for(const t of TYPE_ORDER){ if(!present.has(t)) continue;
    const el=document.createElement("span");
    el.className=(typeFilter.size && !typeFilter.has(t))?"off":"";
    el.innerHTML=`<i style="background:${colorFor(t)}"></i>${t}`;
    el.onclick=()=>{ typeFilter.has(t)?typeFilter.delete(t):typeFilter.add(t); drawMap(); };
    host.appendChild(el); }
}

/* ---------- background analysis + STABLE global projection ---------- */
let proj=new Map(), pb=null, bgToken=0;
// Compute the 2D similarity layout ONCE over ALL analyzed samples, with global bounds.
// Folder navigation / search then only filter which dots are shown — the space and its
// axes never reshape, so dots keep their position when you drill into a subfolder.
function refreshProjection(){
  const list=items.filter(it=>feat.has(it.path));
  if(list.length<3){ proj=new Map(); pb=null; return; }
  const coords=pca2(list.map(it=>feat.get(it.path)));
  const m=new Map(), xs=[], ys=[];
  list.forEach((it,i)=>{ m.set(it.path,coords[i]); xs.push(coords[i][0]); ys.push(coords[i][1]); });
  proj=m; pb={x0:Math.min(...xs),x1:Math.max(...xs),y0:Math.min(...ys),y1:Math.max(...ys)};
}
// Decode + classify EVERY sample in the background so the whole galaxy, folder dots and
// legend fill in automatically. Keeps only the small feature vector (not decoded audio),
// so memory stays bounded for big libraries.
async function backgroundClassify(){
  const token=++bgToken; analyzing=true;
  const todo=items.filter(it=>!feat.has(it.path)); let done=0;
  for(const it of todo){
    if(token!==bgToken) return;            // a new library was loaded — abandon this pass
    if(feat.has(it.path)) continue;
    try{ const ab=await it.file.arrayBuffer();
      const buf=await ac().decodeAudioData(ab.slice(0));
      const v=featuresFromBuffer(buf); feat.set(it.path,v); atype.set(it.path,classifyAudio(v));
    }catch(_){}
    if(++done%40===0){ $("#prog").textContent=`scanning ${done}/${todo.length}…`;
      refreshProjection(); drawMap(); renderSide(); await new Promise(r=>setTimeout(r,0)); }
  }
  analyzing=false; $("#prog").textContent="";
  refreshProjection(); drawMap(); renderSide(); buildLegend();
}
// Draws the CURRENT folder/search subset at their fixed global positions (no re-projection).
function drawMap(){
  const cv=$("#map"),dpr=devicePixelRatio||1;
  const W=cv.width=cv.clientWidth*dpr||1, H=cv.height=cv.clientHeight*dpr||1;
  const g=cv.getContext("2d"); g.clearRect(0,0,W,H);
  const pad=34*dpr;
  if(!pb){ mapPts=[]; $("#maphint").textContent=analyzing?"scanning…":"open a folder of samples"; return; }
  const sx=x=>pad+(W-2*pad)*((x-pb.x0)/((pb.x1-pb.x0)||1)), sy=y=>pad+(H-2*pad)*((y-pb.y0)/((pb.y1-pb.y0)||1));
  const list=filtered().filter(it=>proj.has(it.path) && (!typeFilter.size || typeFilter.has(audioType(it))));
  g.fillStyle="#5b6373"; g.font=(11*dpr)+"px sans-serif";
  g.fillText("similarity space — nearby = similar timbre",14*dpr,H-12*dpr);
  mapPts=[];
  for(const it of list){ const c=proj.get(it.path), X=sx(c[0]), Y=sy(c[1]), isSel=selected===it;
    g.beginPath(); g.fillStyle=colorFor(audioType(it)); g.globalAlpha=isSel?1:.8;
    g.arc(X,Y,(isSel?6.5:3.4)*dpr,0,Math.PI*2); g.fill();
    if(isSel){ g.globalAlpha=1; g.lineWidth=2*dpr; g.strokeStyle="#fff"; g.stroke(); }
    mapPts.push({X,Y,it}); }
  g.globalAlpha=1; buildLegend();
  $("#maphint").textContent=assignMode
    ? `${list.length} sounds · click a dot to LOAD into Track ${activeTrack+1} · Esc to cancel`
    : `${list.length} of ${proj.size} sounds · drag to scan · click to preview`;
}
function nearest(mx,my){ let best=null,bd=1e18; for(const p of mapPts){ const d=(p.X-mx)**2+(p.Y-my)**2; if(d<bd){bd=d;best=p;} } return best; }

/* ---------- map interaction: drag-scrub preview, click = assign to active track ---------- */
let scrubbing=false, moved=false, downXY=null, lastItem=null, assignMode=false;
const mapEl=$("#map");
// enter "assign mode": next map click loads a sound onto track t, then returns to seq
function enterAssign(t){ activeTrack=t; assignMode=true; setView("map");
  $("#selname").innerHTML=`<b>Choose a sample for Track ${t+1}</b> — click a dot to load it · Esc to cancel`;
  drawMap(); }
function toCanvas(e){ const r=mapEl.getBoundingClientRect(),dpr=devicePixelRatio||1; return [(e.clientX-r.left)*dpr,(e.clientY-r.top)*dpr]; }
function previewAt(e){ const [mx,my]=toCanvas(e), p=nearest(mx,my);
  if(p && p.it!==lastItem){ lastItem=p.it; audition(p.it); drawMap(); } }
mapEl.addEventListener("mousedown",e=>{ ac().resume&&ac().resume(); scrubbing=true; moved=false;
  downXY=[e.clientX,e.clientY]; lastItem=null; previewAt(e); });
window.addEventListener("mousemove",e=>{ if(!scrubbing) return;
  if(downXY && (Math.abs(e.clientX-downXY[0])+Math.abs(e.clientY-downXY[1]))>4) moved=true;
  previewAt(e); });
window.addEventListener("mouseup",e=>{ if(!scrubbing) return; scrubbing=false;
  // mousedown already auditioned the sound under the cursor — don't replay it here.
  if(!moved && assignMode){ const [mx,my]=toCanvas(e), p=nearest(mx,my);
    if(p){ assignToTrack(activeTrack,p.it); assignMode=false; setView("seq"); } } });
addEventListener("keydown",e=>{ if(e.key==="Escape" && assignMode){ assignMode=false; setView("seq"); } });

/* ---------- sequencer: per-track rotary knobs + step grid ---------- */
// SVG knob geometry: 270° sweep, gap at the bottom (y-down screen coords).
function _pt(cx,cy,r,deg){ const a=deg*Math.PI/180; return [cx+r*Math.cos(a), cy+r*Math.sin(a)]; }
function _arc(cx,cy,r,d0,d1){ const [x0,y0]=_pt(cx,cy,r,d0),[x1,y1]=_pt(cx,cy,r,d1);
  const large=(d1-d0)>180?1:0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; }
// per-track knob parameters (def = double-click reset target)
const KP=[
  {key:"vol",  label:"VOL", min:0,   max:1,     step:0.01, def:0.85, fmt:v=>Math.round(v*100)},
  {key:"pan",  label:"PAN", min:-1,  max:1,     step:0.02, def:0,    fmt:v=>v===0?"C":(v<0?"L":"R")+Math.round(Math.abs(v)*100)},
  {key:"cut",  label:"FILT",min:200, max:18000, step:10, log:true, def:18000, fmt:v=>v>=1000?(v/1000).toFixed(1)+"k":Math.round(v)},
  {key:"q",    label:"RES", min:0.1, max:12,    step:0.1, def:0.8,  fmt:v=>(+v).toFixed(1)},
  {key:"low",  label:"LOW", min:-18, max:18,    step:0.5, def:0,    fmt:v=>(v>0?"+":"")+v},
  {key:"high", label:"HIGH",min:-18, max:18,    step:0.5, def:0,    fmt:v=>(v>0?"+":"")+v},
  {key:"pitch",label:"PIT", min:-12, max:12,    step:1,   def:0,    fmt:v=>(v>0?"+":"")+v},
];
// one rotary knob: drag ↕ to turn, shift = fine, scroll = nudge, double-click = reset
function makeKnob(p, value, color, onChange){
  const el=document.createElement("div"); el.className="knob2"; el.title=p.label;
  el.innerHTML=`<svg viewBox="0 0 40 40">
    <path class="kt" fill="none" stroke-width="3.2" stroke-linecap="round" d="${_arc(20,20,14,135,405)}"></path>
    <path class="kv" fill="none" stroke-width="3.2" stroke-linecap="round" stroke="${color}"></path>
    <circle class="kp" r="2.3" fill="#fff"></circle></svg>
    <div class="klabel">${p.label}</div><div class="kval"></div>`;
  const kv=el.querySelector(".kv"), kp=el.querySelector(".kp"), kval=el.querySelector(".kval");
  const lg=!!p.log, lmin=lg?Math.log(p.min):0, lspan=lg?Math.log(p.max)-Math.log(p.min):0;
  const toT=x=> lg ? (Math.log(x)-lmin)/lspan : (x-p.min)/(p.max-p.min);
  const fromT=t=> lg ? Math.exp(lmin+t*lspan) : p.min+t*(p.max-p.min);
  let v=value;
  function render(){ const t=Math.max(0,Math.min(1,toT(v))), end=135+t*270;
    kv.setAttribute("d",_arc(20,20,14,135,Math.max(135.01,end)));
    const [px,py]=_pt(20,20,14,end); kp.setAttribute("cx",px.toFixed(2)); kp.setAttribute("cy",py.toFixed(2));
    kval.textContent=p.fmt(v); }
  function setV(nv){ v=Math.max(p.min,Math.min(p.max,nv)); if(p.step) v=Math.round(v/p.step)*p.step; render(); onChange(v); }
  render();
  let drag=false, sy=0, st=0;
  el.addEventListener("pointerdown",e=>{ drag=true; sy=e.clientY; st=toT(v); el.setPointerCapture(e.pointerId); e.preventDefault(); });
  el.addEventListener("pointermove",e=>{ if(!drag)return; const sens=e.shiftKey?700:230;
    setV(fromT(Math.max(0,Math.min(1, st+(sy-e.clientY)/sens)))); });
  el.addEventListener("pointerup",()=>{ drag=false; });
  el.addEventListener("dblclick",()=>setV(p.def));
  el.addEventListener("wheel",e=>{ e.preventDefault();
    setV(fromT(Math.max(0,Math.min(1, toT(v)+(e.deltaY<0?0.03:-0.03))))); },{passive:false});
  return el;
}
function buildGrid(){
  const wrap=$("#grid"); wrap.innerHTML="";
  for(let t=0;t<NT;t++){
    const tr=tracks[t], row=document.createElement("div"); row.className="track";
    const col=tr.type?colorFor(tr.type):"#5ad1c4";   // track color follows its sample's sound
    row.style.setProperty("--tcol",col);
    const slot=document.createElement("div"); slot.className="slot"+(t===activeTrack?" active":"");
    slot.innerHTML=`<span class="sw" style="background:${tr.type?colorFor(tr.type):'#333'}"></span>
      <span class="tn ${tr.item?'has':''}">${tr.item?tr.item.name:'Track '+(t+1)+' — empty'}</span>
      <span class="ld" title="load / change sample">⇄</span>
      <span class="m ${tr.fx.mute?'on':''}">M</span>`;
    slot.onclick=ev=>{
      if(ev.target.classList.contains("m")){ tr.fx.mute=!tr.fx.mute; ensureNodes(t); applyFX(t); buildGrid(); return; }
      if(ev.target.classList.contains("ld")){ enterAssign(t); return; }       // explicit load/change
      activeTrack=t;
      if(tr.item){ if(tr.buffer) triggerTrack(t); buildGrid(); }              // select + preview
      else { enterAssign(t); }                                               // empty track → load one
    };
    row.appendChild(slot);
    // permanent per-track rotary knobs
    const kc=document.createElement("div"); kc.className="knobs";
    for(const p of KP) kc.appendChild(makeKnob(p, tr.fx[p.key], col,
      val=>{ tr.fx[p.key]=val; ensureNodes(t); applyFX(t); }));
    row.appendChild(kc);
    const steps=document.createElement("div"); steps.className="steps";
    for(let s=0;s<NS;s++){ const c=document.createElement("div");
      c.className="step"+(s%4===0&&s>0?" g":"")+(pattern[t][s]?" on":""); c.dataset.s=s;
      c.onclick=()=>{ pattern[t][s]=!pattern[t][s]; c.classList.toggle("on",pattern[t][s]); };
      steps.appendChild(c); }
    row.appendChild(steps); wrap.appendChild(row);
  }
  $("#target").textContent="▸ Track "+(activeTrack+1);
}

/* ---------- transport ---------- */
let playing=false, curStep=0, nextTime=0, schedTimer=null; const queue=[];
function bpm(){ return Math.max(40,Math.min(240,+$("#bpm").value||120)); }
function schedule(){ const ahead=0.12;
  while(nextTime<ac().currentTime+ahead){
    for(let t=0;t<NT;t++) if(pattern[t][curStep]) triggerTrack(t,nextTime);
    queue.push({step:curStep,time:nextTime});
    nextTime+=(60/bpm())*0.25; curStep=(curStep+1)%NS; } }
function playLoop(){ schedule(); const now=ac().currentTime; let st=-1;
  while(queue.length && queue[0].time<=now) st=queue.shift().step;
  if(st>=0){ $$(".step.play").forEach(e=>e.classList.remove("play"));
    $$(`.step[data-s="${st}"]`).forEach(e=>e.classList.add("play")); }
  if(playing) requestAnimationFrame(playLoop); }
$("#play").onclick=()=>{
  if(playing){ playing=false; clearInterval(schedTimer); $$(".step.play").forEach(e=>e.classList.remove("play")); $("#play").textContent="▶ Play"; return; }
  ac().resume&&ac().resume(); playing=true; curStep=0; nextTime=ac().currentTime+0.06; queue.length=0;
  schedTimer=setInterval(schedule,25); requestAnimationFrame(playLoop); $("#play").textContent="■ Stop";
};

/* ---------- view switching + init ---------- */
function setView(v){ view=v;
  $("#tMap").classList.toggle("on",v==="map"); $("#tSeq").classList.toggle("on",v==="seq");
  $("#mapview").style.display=v==="map"?"flex":"none";
  $("#seqview").style.display=v==="seq"?"flex":"none";
  if(v==="map"){ $("#target").textContent="▸ Track "+(activeTrack+1); drawMap(); }
}
$("#tMap").onclick=()=>{ assignMode=false; setView("map"); };
$("#tSeq").onclick=()=>{ assignMode=false; setView("seq"); };
$("#search").oninput=()=>drawMap();
$("#master").oninput=()=>{ master().gain.value=(+$("#master").value)/100; };  // master volume (default 80)
addEventListener("resize",()=>{ if(view==="map") drawMap(); });

/* ---------- tap tempo ---------- */
let tapTimes=[];
$("#tap").onclick=()=>{
  const now=performance.now();
  tapTimes=tapTimes.filter(t=>now-t<2000); tapTimes.push(now);   // keep recent taps only
  if(tapTimes.length>=2){
    let sum=0; for(let i=1;i<tapTimes.length;i++) sum+=tapTimes[i]-tapTimes[i-1];
    const v=60000/(sum/(tapTimes.length-1));
    $("#bpm").value=Math.max(40,Math.min(240,v)).toFixed(1);   // one decimal place
  }
};

$("#fxpanel").innerHTML='<span class="ttl">Drum machine</span>'
  +'<span class="fxhint">knobs: drag ↕ · double-click resets · scroll = fine — click a track name to load / swap its sample</span>';
buildGrid();
