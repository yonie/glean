"use strict";
/* Kit export/import and bounce.
   - Export kit: a .zip with every loaded sample plus kit.json (BPM, per-track knobs, steps,
     and each sample's original path), so a kit moves to another machine intact.
   - Import kit: loads such a zip back into the drum machine.
   - Bounce: renders N bars of the pattern to a WAV, offline (faster than real time),
     through the same per-track chain the sequencer plays through (ensureNodes in audio.js). */

function saveBlob(blob,name){
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function flash(btn,msg){ const old=btn.innerHTML; btn.textContent=msg; setTimeout(()=>btn.innerHTML=old,1400); }
// run a long operation with a spinner in its button; the button is locked meanwhile
async function busy(btn,label,fn){
  if(btn.disabled) return; const old=btn.innerHTML; btn.disabled=true;
  btn.innerHTML=`<span class="spin"></span>${label}`;
  try{ return await fn(); }
  catch(e){ console.error(e); return "Failed"; }
  finally{ if(btn.disabled){ btn.innerHTML=old; btn.disabled=false; } }
}
const bpmLabel=()=>+bpm().toFixed(1);

/* ---------- zip (store on write; store or deflate on read) ---------- */
const CRC=(()=>{ const t=new Uint32Array(256);
  for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?0xedb88320^(c>>>1):c>>>1; t[n]=c>>>0; } return t; })();
function crc32(b){ let c=0xffffffff; for(let i=0;i<b.length;i++) c=CRC[(c^b[i])&255]^(c>>>8); return (c^0xffffffff)>>>0; }
function zipBlob(entries){                     // entries: [{name, data: Uint8Array}]
  const enc=new TextEncoder(), parts=[], central=[]; let off=0;
  const d=new Date(), dosT=(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1),
        dosD=((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate();
  for(const e of entries){
    const nm=enc.encode(e.name), crc=crc32(e.data), sz=e.data.length;
    const lh=new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true); lh.setUint16(4,20,true); lh.setUint16(6,0x0800,true);  // UTF-8 names
    lh.setUint16(8,0,true); lh.setUint16(10,dosT,true); lh.setUint16(12,dosD,true);
    lh.setUint32(14,crc,true); lh.setUint32(18,sz,true); lh.setUint32(22,sz,true);
    lh.setUint16(26,nm.length,true); lh.setUint16(28,0,true);
    parts.push(lh,nm,e.data);
    const ch=new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true); ch.setUint16(4,20,true); ch.setUint16(6,20,true); ch.setUint16(8,0x0800,true);
    ch.setUint16(10,0,true); ch.setUint16(12,dosT,true); ch.setUint16(14,dosD,true);
    ch.setUint32(16,crc,true); ch.setUint32(20,sz,true); ch.setUint32(24,sz,true);
    ch.setUint16(28,nm.length,true); ch.setUint32(42,off,true);
    central.push(ch,nm); off+=30+nm.length+sz;
  }
  const cdSize=central.reduce((s,p)=>s+p.byteLength,0), eo=new DataView(new ArrayBuffer(22));
  eo.setUint32(0,0x06054b50,true); eo.setUint16(8,entries.length,true); eo.setUint16(10,entries.length,true);
  eo.setUint32(12,cdSize,true); eo.setUint32(16,off,true);
  return new Blob([...parts,...central,eo],{type:"application/zip"});
}
async function unzip(buf){                     // -> Map(name -> Uint8Array)
  const v=new DataView(buf), dec=new TextDecoder(), out=new Map();
  let e=buf.byteLength-22; while(e>=0 && v.getUint32(e,true)!==0x06054b50) e--;
  if(e<0) throw new Error("not a zip");
  let p=v.getUint32(e+16,true); const n=v.getUint16(e+10,true);
  for(let i=0;i<n;i++){
    const method=v.getUint16(p+10,true), csz=v.getUint32(p+20,true),
          nl=v.getUint16(p+28,true), xl=v.getUint16(p+30,true), cl=v.getUint16(p+32,true), lo=v.getUint32(p+42,true);
    const name=dec.decode(new Uint8Array(buf,p+46,nl));
    const start=lo+30+v.getUint16(lo+26,true)+v.getUint16(lo+28,true);
    let data=new Uint8Array(buf,start,csz);
    if(method===8) data=new Uint8Array(await new Response(new Blob([data]).stream()
      .pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    else if(method!==0) throw new Error("unsupported zip compression");
    if(!name.endsWith("/")) out.set(name,data);
    p+=46+nl+xl+cl;
  }
  return out;
}

/* ---------- kit export / import ---------- */
const safeName=s=>s.replace(/[\\/:*?"<>|]+/g,"_");
async function exportKit(){
  if(!tracks.some(tr=>tr.item)) return "No samples loaded";
  const entries=[], kit={glean:1,bpm:bpm(),steps:NS,tracks:[]};
  for(let t=0;t<NT;t++){ const tr=tracks[t], steps=pattern[t].map(on=>on?"x":".").join("");
    if(!tr.item){ kit.tracks.push({sample:null,fx:tr.fx,steps}); continue; }
    const name=`samples/${t+1}-${safeName(tr.item.name)}`;
    entries.push({name,data:new Uint8Array(await tr.item.file.arrayBuffer())});
    kit.tracks.push({sample:name,path:tr.item.path,fx:tr.fx,steps});
  }
  entries.unshift({name:"kit.json",data:new TextEncoder().encode(JSON.stringify(kit,null,2))});
  saveBlob(zipBlob(entries),`glean-kit-${bpmLabel()}bpm.zip`);
}
async function importKit(file){
  let files, kit;
  try{ files=await unzip(await file.arrayBuffer()); kit=JSON.parse(new TextDecoder().decode(files.get("kit.json"))); }
  catch(_){ return "Not a Glean kit"; }
  if(!kit||!Array.isArray(kit.tracks)) return "Not a Glean kit";
  for(let t=0;t<NT;t++){ const k=kit.tracks[t]||{}, tr=tracks[t];
    tr.fx={...FXDEF(),...(k.fx||{})}; applyFX(t);
    const st=String(k.steps||""); for(let s=0;s<NS;s++) pattern[t][s]=st[s]==="x";
    const data=k.sample&&files.get(k.sample);
    if(!data){ tr.item=null; tr.buffer=null; tr.type=null; continue; }
    const fname=k.sample.split("/").pop().replace(/^\d+-/,"");
    const f=new File([data],fname,{type:"audio/wav"});
    await assignToTrack(t,{file:f,name:fname,path:`kit:${file.name}/${k.sample}`,segs:[fname],cat:"KIT"});
  }
  if(kit.bpm) $("#bpm").value=Math.max(40,Math.min(240,+kit.bpm)).toFixed(1);
  buildGrid();
}

/* ---------- bounce ---------- */
async function renderPattern(bars){
  const sr=44100, stepDur=(60/bpm())*0.25, nSteps=bars*NS, body=nSteps*stepDur;
  const live=t=>tracks[t].buffer&&!tracks[t].fx.mute&&pattern[t].some(Boolean);
  // let the last hits ring out: the longest sample that is played, at its pitch (max 4 s)
  let tail=0;
  for(let t=0;t<NT;t++) if(live(t)) tail=Math.max(tail,tracks[t].buffer.duration/Math.pow(2,tracks[t].fx.pitch/12));
  tail=Math.min(tail,4);
  const oc=new OfflineAudioContext(2,Math.ceil((body+tail)*sr),sr);
  const out=oc.createGain(); out.gain.value=master().gain.value; out.connect(oc.destination);
  for(let t=0;t<NT;t++){ if(!live(t)) continue; const tr=tracks[t], f=tr.fx;
    const filter=oc.createBiquadFilter(); filter.type="lowpass"; filter.frequency.value=f.cut; filter.Q.value=f.q;
    const low=oc.createBiquadFilter(); low.type="lowshelf"; low.frequency.value=220; low.gain.value=f.low;
    const high=oc.createBiquadFilter(); high.type="highshelf"; high.frequency.value=4500; high.gain.value=f.high;
    const pan=oc.createStereoPanner(); pan.pan.value=f.pan;
    const gain=oc.createGain(); gain.gain.value=f.vol;
    filter.connect(low); low.connect(high); high.connect(pan); pan.connect(gain); gain.connect(out);
    for(let s=0;s<nSteps;s++){ if(!pattern[t][s%NS]) continue;
      const src=oc.createBufferSource(); src.buffer=tr.buffer;
      src.playbackRate.value=Math.pow(2,f.pitch/12); src.connect(filter); src.start(s*stepDur); }
  }
  return oc.startRendering();
}
function wavBlob(buf){                         // 16-bit PCM
  const ch=buf.numberOfChannels, n=buf.length, data=n*ch*2, v=new DataView(new ArrayBuffer(44+data));
  const str=(o,s)=>{ for(let i=0;i<s.length;i++) v.setUint8(o+i,s.charCodeAt(i)); };
  str(0,"RIFF"); v.setUint32(4,36+data,true); str(8,"WAVE"); str(12,"fmt ");
  v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,ch,true);
  v.setUint32(24,buf.sampleRate,true); v.setUint32(28,buf.sampleRate*ch*2,true);
  v.setUint16(32,ch*2,true); v.setUint16(34,16,true); str(36,"data"); v.setUint32(40,data,true);
  const chans=[]; for(let c=0;c<ch;c++) chans.push(buf.getChannelData(c));
  let o=44;
  for(let i=0;i<n;i++) for(let c=0;c<ch;c++){
    const x=Math.max(-1,Math.min(1,chans[c][i])); v.setInt16(o,x<0?x*0x8000:x*0x7fff,true); o+=2; }
  return new Blob([v],{type:"audio/wav"});
}
const patternLive=()=>tracks.some((tr,t)=>tr.buffer&&!tr.fx.mute&&pattern[t].some(Boolean));
async function bounce(){
  if(!patternLive()) return "Pattern is empty";
  const buf=await renderPattern(bounceBars);
  saveBlob(wavBlob(buf),`glean-${bpmLabel()}bpm-${bounceBars}bar${bounceBars>1?"s":""}.wav`);
}

/* ---------- UI: a Bounce popover and a ⋯ kit menu, right side of the drum machine bar ---------- */
const ICON={
  wave:'<path d="M2 12h2M6 8v8M10 4v16M14 7v10M18 10v4M22 12h-2"/>',
  save:'<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>',
  more:'<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  pkgOut:'<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  pkgIn:'<path d="M4 14v5h16v-5"/><path d="M12 3v11M7 9l5 5 5-5"/>',
};
const icon=(k,fill)=>`<svg class="ico" viewBox="0 0 24 24" ${fill?'fill="currentColor" stroke="none"':'fill="none" stroke="currentColor"'} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
const BARS=[1,2,4,8,16];
let bounceBars=4; try{ const v=+localStorage.getItem("glean.bounceBars"); if(BARS.includes(v)) bounceBars=v; }catch(_){}

$("#fxpanel").insertAdjacentHTML("beforeend",`<span class="outx">
  <span class="pop"><button class="btn ghost" id="bounceBtn" aria-haspopup="true">${icon("wave")}Bounce</button>
    <div class="panel" id="bouncePanel" hidden>
      <div class="ph">Bounce to WAV</div>
      <div class="seg" id="barSeg">${BARS.map(n=>`<button data-n="${n}">${n}</button>`).join("")}</div>
      <div class="pd" id="barInfo"></div>
      <button class="btn" id="bounceGo">${icon("save")}Save WAV</button>
    </div></span>
  <span class="pop"><button class="btn ghost iconly" id="kitBtn" title="Kit: export / import" aria-haspopup="true">${icon("more",1)}</button>
    <div class="panel menu" id="kitMenu" hidden>
      <button class="mi" id="kitSave">${icon("pkgOut")}<span><b>Export kit</b><small>Samples + pattern as one .zip</small></span></button>
      <button class="mi" id="kitLoad">${icon("pkgIn")}<span><b>Import kit…</b><small>Load a kit .zip</small></span></button>
    </div></span>
  <input type="file" id="kitFile" accept=".zip" hidden></span>`);

function openPanel(id){ for(const p of $$(".outx .panel")) p.hidden=p.id!==id||!p.hidden; if(id==="bouncePanel") showBars(); }
function closePanels(){ for(const p of $$(".outx .panel")) if(!p.querySelector(":disabled")) p.hidden=true; }
function showBars(){
  for(const b of $$("#barSeg button")) b.classList.toggle("on",+b.dataset.n===bounceBars);
  const secs=bounceBars*4*60/bpm();
  $("#barInfo").textContent=`${bounceBars} bar${bounceBars>1?"s":""} · ${secs.toFixed(1)} s at ${bpmLabel()} BPM`;
}
$("#bounceBtn").onclick=e=>{ e.stopPropagation(); openPanel("bouncePanel"); };
$("#kitBtn").onclick=e=>{ e.stopPropagation(); openPanel("kitMenu"); };
for(const p of $$(".outx .panel")) p.onclick=e=>e.stopPropagation();
document.addEventListener("click",closePanels);
document.addEventListener("keydown",e=>{ if(e.key==="Escape") closePanels(); });
$("#bpm").addEventListener("input",()=>{ if(!$("#bouncePanel").hidden) showBars(); });
$("#barSeg").onclick=e=>{ const n=+e.target.dataset.n; if(!n) return; bounceBars=n;
  try{ localStorage.setItem("glean.bounceBars",n); }catch(_){} showBars(); };

// fn returns a message string when there is nothing to do; the panel closes when it succeeds
const act=(btn,label,fn)=>async()=>{ const msg=await busy(btn,label,fn);
  if(typeof msg==="string") flash(btn,msg); else closePanels(); };
$("#bounceGo").onclick=act($("#bounceGo"),"Bouncing…",bounce);
$("#kitSave").onclick=act($("#kitSave"),"Zipping…",exportKit);
$("#kitLoad").onclick=()=>$("#kitFile").click();
$("#kitFile").onchange=e=>{ const f=e.target.files[0]; e.target.value=""; if(!f) return;
  act($("#kitLoad"),"Loading…",()=>importKit(f))(); };
