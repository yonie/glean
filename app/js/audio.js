"use strict";
/* Audio engine: sample decode/cache, audition, and the per-track FX chain
   (filter → low/high EQ shelves → pan → gain) used by the sequencer. */

async function getBuffer(it){
  if(bufCache.has(it.path)) return bufCache.get(it.path);
  const ab=await it.file.arrayBuffer();
  const buf=await ac().decodeAudioData(ab.slice(0));
  bufCache.set(it.path,buf); return buf;
}
async function audition(it){
  selected=it;
  $("#selname").innerHTML=`<b>${it.name}</b> &nbsp;·&nbsp; ${it.segs.slice(0,-1).join(" / ")}`;
  let buf; try{ buf=await getBuffer(it); }catch(_){ return; }
  if(!feat.has(it.path)){ try{ const v=featuresFromBuffer(buf); feat.set(it.path,v); atype.set(it.path,classifyAudio(v)); }catch(_){} }
  if(auditionSrc){ try{auditionSrc.stop();}catch(_){} }
  const s=ac().createBufferSource(); s.buffer=buf; s.connect(master()); s.start(); auditionSrc=s;
  drawWave(buf);
}
function drawWave(buf){
  const cv=$("#wave"),dpr=devicePixelRatio||1,W=cv.width=cv.clientWidth*dpr,H=cv.height=cv.clientHeight*dpr;
  const g=cv.getContext("2d"); g.clearRect(0,0,W,H);
  const d=buf.getChannelData(0),step=Math.max(1,Math.floor(d.length/W));
  g.strokeStyle=colorFor(selected?audioType(selected):"OTHER"); g.beginPath();
  for(let x=0;x<W;x++){let mn=1,mx=-1;for(let i=0;i<step;i++){const v=d[x*step+i]||0;if(v<mn)mn=v;if(v>mx)mx=v;}
    g.moveTo(x,(1-(mx*.5+.5))*H);g.lineTo(x,(1-(mn*.5+.5))*H);} g.stroke();
}

// per-track Web Audio chain (built lazily, reused for every hit)
function ensureNodes(t){
  const tr=tracks[t]; if(tr.nodes) return tr.nodes;
  const c=ac();
  const filter=c.createBiquadFilter(); filter.type="lowpass";
  const low=c.createBiquadFilter(); low.type="lowshelf"; low.frequency.value=220;
  const high=c.createBiquadFilter(); high.type="highshelf"; high.frequency.value=4500;
  const pan=c.createStereoPanner(); const gain=c.createGain();
  filter.connect(low); low.connect(high); high.connect(pan); pan.connect(gain); gain.connect(master());
  tr.nodes={filter,low,high,pan,gain}; applyFX(t); return tr.nodes;
}
function applyFX(t){ const tr=tracks[t]; if(!tr.nodes) return; const f=tr.fx, n=tr.nodes;
  n.filter.frequency.value=f.cut; n.filter.Q.value=f.q; n.low.gain.value=f.low;
  n.high.gain.value=f.high; n.pan.pan.value=f.pan; n.gain.gain.value=f.mute?0:f.vol; }
function triggerTrack(t,when){ const tr=tracks[t]; if(!tr.buffer||tr.fx.mute) return;
  const n=ensureNodes(t); const s=ac().createBufferSource(); s.buffer=tr.buffer;
  s.playbackRate.value=Math.pow(2,tr.fx.pitch/12); s.connect(n.filter); s.start(when||0); }
async function assignToTrack(t,it){ let buf; try{ buf=await getBuffer(it); }catch(_){ return; }
  if(!feat.has(it.path)){ try{ const v=featuresFromBuffer(buf); feat.set(it.path,v); atype.set(it.path,classifyAudio(v)); }catch(_){} }
  tracks[t].item=it; tracks[t].buffer=buf; tracks[t].type=audioType(it); buildGrid(); }
function clearTrack(t){ tracks[t].item=null; tracks[t].buffer=null; tracks[t].type=null;
  for(let s=0;s<NS;s++) pattern[t][s]=false; buildGrid(); }
