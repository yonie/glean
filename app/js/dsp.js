"use strict";
/* Audio feature extraction + PCA projection — pure functions, no DOM/state.
   This is what places samples in the "similarity space" map: each sample becomes a
   ~17-dim timbre vector, then PCA projects the set to 2D so nearby = similar sound. */

// in-place radix-2 Cooley-Tukey FFT (length must be a power of 2)
function fft(re,im){ const n=re.length;
  for(let i=1,j=0;i<n;i++){ let bit=n>>1; for(;j&bit;bit>>=1) j^=bit; j^=bit;
    if(i<j){ const tr=re[i];re[i]=re[j];re[j]=tr; const ti=im[i];im[i]=im[j];im[j]=ti; } }
  for(let len=2;len<=n;len<<=1){ const ang=-2*Math.PI/len, wr=Math.cos(ang), wi=Math.sin(ang);
    for(let i=0;i<n;i+=len){ let cr=1,ci=0;
      for(let k=0;k<len>>1;k++){ const a=i+k,b=a+(len>>1);
        const tr=re[b]*cr-im[b]*ci, ti=re[b]*ci+im[b]*cr;
        re[b]=re[a]-tr; im[b]=im[a]-ti; re[a]+=tr; im[a]+=ti;
        const ncr=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=ncr; } } }
}
// averaged magnitude spectrum over up to 8 Hann-windowed frames
function avgSpectrum(d){
  const N=1024, half=N>>1, mag=new Float32Array(half);
  let frames=0; const hop=Math.max(N,Math.floor((d.length-N)/6)||N);
  for(let s=0; s+N<=d.length && frames<8; s+=hop){
    const re=new Float32Array(N), im=new Float32Array(N);
    for(let i=0;i<N;i++){ const w=0.5-0.5*Math.cos(2*Math.PI*i/(N-1)); re[i]=d[s+i]*w; }
    fft(re,im); for(let k=0;k<half;k++) mag[k]+=Math.hypot(re[k],im[k]); frames++;
  }
  if(!frames){ const re=new Float32Array(N), im=new Float32Array(N);
    for(let i=0;i<Math.min(N,d.length);i++) re[i]=d[i]; fft(re,im);
    for(let k=0;k<half;k++) mag[k]=Math.hypot(re[k],im[k]); frames=1; }
  for(let k=0;k<half;k++) mag[k]/=frames; return mag;
}
// feature vector: [logDur, rms, zcr, attack, decay, centroid, spread, rolloff, flatness, 8 log bands]
function featuresFromBuffer(buf){
  const d=buf.getChannelData(0), N=d.length, sr=buf.sampleRate;
  let ss=0, zc=0, prev=0; const blk=256; let bi=0, bs=0, peak=0, peakI=0; const env=[];
  for(let i=0;i<N;i++){ const v=d[i]; ss+=v*v; if((v>=0)!==(prev>=0))zc++; prev=v;
    bs+=v*v; if(++bi===blk){ const r=Math.sqrt(bs/blk); env.push(r); if(r>peak){peak=r;peakI=env.length-1;} bs=0; bi=0; } }
  const rms=Math.sqrt(ss/N), zcr=zc/N, dur=buf.duration;
  const attack=env.length?peakI*blk/sr:0;
  let dn=peakI; const thr=peak*0.1; while(dn<env.length && env[dn]>thr) dn++;
  const decay=(dn-peakI)*blk/sr;
  const mag=avgSpectrum(d), L=mag.length;
  let tot=0,cen=0; for(let k=0;k<L;k++){ tot+=mag[k]; cen+=k*mag[k]; } tot=tot||1e-9;
  const cmean=cen/tot, centroid=cmean/L;
  let sp=0; for(let k=0;k<L;k++) sp+=mag[k]*(k-cmean)*(k-cmean); const spread=Math.sqrt(sp/tot)/L;
  let cum=0,roll=0; for(let k=0;k<L;k++){ cum+=mag[k]; if(cum>=0.85*tot){ roll=k/L; break; } }
  let ls=0,as=0; for(let k=0;k<L;k++){ const mm=mag[k]+1e-9; ls+=Math.log(mm); as+=mm; }
  const flat=Math.exp(ls/L)/((as/L)||1e-9);
  const B=8, bands=new Array(B).fill(0);
  for(let k=1;k<L;k++){ const b=Math.min(B-1,Math.floor(B*Math.log2(k+1)/Math.log2(L))); bands[b]+=mag[k]; }
  const ba=bands.reduce((a,b)=>a+b,0)||1; for(let i=0;i<B;i++) bands[i]=Math.log(1+bands[i]/ba*10);
  return [Math.log10(Math.max(.02,dur)),rms,zcr,attack,decay,centroid,spread,roll,flat,...bands];
}
function dot(a,b){ let s=0; for(let i=0;i<a.length;i++) s+=a[i]*b[i]; return s; }
function powerIter(C,d,defl){
  let v=new Array(d); for(let i=0;i<d;i++) v[i]=Math.sin(i*1.7+1);
  for(let it=0;it<70;it++){ const w=new Array(d).fill(0);
    for(let a=0;a<d;a++){ let s=0; for(let b=0;b<d;b++) s+=C[a][b]*v[b]; w[a]=s; }
    if(defl){ const p=dot(w,defl); for(let a=0;a<d;a++) w[a]-=p*defl[a]; }
    let nrm=Math.sqrt(dot(w,w))||1; for(let a=0;a<d;a++) w[a]/=nrm; v=w; }
  return v;
}
// project rows (n×d) to 2D via standardized PCA (top-2 principal components)
function pca2(rows){
  const n=rows.length, d=rows[0].length;
  const mean=new Array(d).fill(0), std=new Array(d).fill(0);
  for(const r of rows) for(let j=0;j<d;j++) mean[j]+=r[j];
  for(let j=0;j<d;j++) mean[j]/=n;
  for(const r of rows) for(let j=0;j<d;j++){ const v=r[j]-mean[j]; std[j]+=v*v; }
  for(let j=0;j<d;j++) std[j]=Math.sqrt(std[j]/n)||1;
  const Z=rows.map(r=>r.map((v,j)=>(v-mean[j])/std[j]));
  const C=Array.from({length:d},()=>new Array(d).fill(0));
  for(const z of Z) for(let a=0;a<d;a++){ const za=z[a]; for(let b=0;b<d;b++) C[a][b]+=za*z[b]; }
  for(let a=0;a<d;a++) for(let b=0;b<d;b++) C[a][b]/=n;
  const e1=powerIter(C,d,null), e2=powerIter(C,d,e1);
  return Z.map(z=>[dot(z,e1),dot(z,e2)]);
}
