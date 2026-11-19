// Texterkennung, Scanner, PDF
"use strict";
/* ================= Texterkennung und Scanner (aus der Arztrechnungen-App) ================= */
const TESS="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
let tessWorker=null;
function loadScript(src){return new Promise((res,rej)=>{if(window.Tesseract)return res();const s=document.createElement("script");s.src=src;s.onload=res;s.onerror=()=>rej(new Error("load"));document.head.appendChild(s)})}
async function ensureTess(){
  await loadScript(TESS);
  if(!tessWorker)tessWorker=await Tesseract.createWorker("deu",1,{logger:m=>{if(m.status==="recognizing text")setStatus(`Wird gelesen … ${Math.round(m.progress*100)} %`)}});
}
function loadLib(src,test){return new Promise((res,rej)=>{if(test())return res();const s=document.createElement("script");s.src=src;s.onload=res;s.onerror=()=>rej(new Error("load"));document.head.appendChild(s)})}
async function prepareForOcr(file){
  try{
    const bmp=await createImageBitmap(file);const sc=Math.min(1,2600/Math.max(bmp.width,bmp.height));
    const w=Math.round(bmp.width*sc),h=Math.round(bmp.height*sc);
    const cv=document.createElement("canvas");cv.width=w;cv.height=h;const ctx=cv.getContext("2d",{willReadFrequently:true});
    ctx.drawImage(bmp,0,0,w,h);
    const bg=document.createElement("canvas");bg.width=w;bg.height=h;const bx=bg.getContext("2d",{willReadFrequently:true});
    bx.filter=`blur(${Math.round(Math.max(w,h)/80)}px)`;bx.drawImage(cv,0,0);
    const a=ctx.getImageData(0,0,w,h),b=bx.getImageData(0,0,w,h),d=a.data,e=b.data;
    if(e[0]===d[0]&&e[1]===d[1]&&e[w*4*Math.floor(h/2)]===d[w*4*Math.floor(h/2)]){} // Weichzeichnen evtl. nicht unterstützt
    for(let i=0;i<d.length;i+=4){
      const g=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2],bgv=Math.max(1,0.299*e[i]+0.587*e[i+1]+0.114*e[i+2]);
      const v=Math.min(255,g/bgv*255);d[i]=d[i+1]=d[i+2]=v;
    }
    ctx.putImageData(a,0,0);
    return await new Promise(r=>cv.toBlob(x=>r(x||file),"image/png"));
  }catch{return shrink(file,2000,0.9)}
}
// Liefert {pdf, images:[Blob], file?} oder null (abgebrochen). Datei-Auswahl (z. B. PDF) wird unverändert durchgereicht.
function scanDocument(title){
  return new Promise(resolve=>{
    const SC={title,pages:[],cur:null,resolve,done:false};
    S.scan=SC;drawScanStart();
  });
}
function scanFinish(result){const SC=S.scan;if(!SC||SC.done)return;SC.done=true;S.scan=null;$("#sheetHost").innerHTML="";SC.resolve(result)}
function drawScanStart(){
  const SC=S.scan;const n=SC.pages.length;
  $("#sheetHost").innerHTML=`<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-label="Scannen">
    <div class="sheet-head"><h2>${esc(SC.title)}</h2><div class="btnrow"><button type="button" class="btn" data-act="scancancel">Abbrechen</button>${n?`<button type="button" class="btn primary" data-act="scandone">Fertig (${n} Seite${n===1?"":"n"})</button>`:""}</div></div>
    ${n?`<div class="sec"><h3>Gescannte Seiten</h3><div class="thumbs">${SC.pages.map((p,i)=>`<div class="pg"><img src="${p.url}" alt="Seite ${i+1}"><button type="button" class="btn link" data-act="scandel" data-i="${i}">Entfernen</button></div>`).join("")}</div></div>`:""}
    <div class="sec">
      <div class="btnrow"><button type="button" class="btn primary" data-act="scancam">${n?"Weitere Seite fotografieren":"Foto aufnehmen"}</button>
      ${n?"":`<button type="button" class="btn" data-act="scanfile">Datei oder PDF wählen</button>`}</div>
      <p class="status" style="margin:0">Leg das Blatt auf eine dunkle Unterlage. Die App findet die Ränder, richtet das Blatt gerade aus und entfernt Schatten.</p>
    </div></div></div>`;
  $("#scrim").addEventListener("click",async e=>{
    const b=e.target.closest("[data-act]");if(!b)return;const act=b.dataset.act;
    if(act==="scancancel"){S.scan.pages.forEach(p=>URL.revokeObjectURL(p.url));return scanFinish(null)}
    if(act==="scandone")return finishScanPdf();
    if(act==="scandel"){const p=S.scan.pages.splice(+b.dataset.i,1)[0];URL.revokeObjectURL(p.url);return drawScanStart()}
    if(act==="scanfile"){const p=$("#pick");p.value="";p.onchange=()=>{const f=p.files[0];if(!f)return;if(isImg(f))scanLoad(f);else scanFinish({file:f})};p.click();return}
    if(act==="scancam"){const c=$("#cam");c.value="";c.onchange=()=>{const f=c.files[0];if(f)scanLoad(f)};c.click()}
  });
}
async function scanLoad(file){
  let bmp;try{bmp=await createImageBitmap(file)}catch{toast("Foto konnte nicht geöffnet werden");return}
  const sc=Math.min(1,4000/Math.max(bmp.width,bmp.height));const w=Math.round(bmp.width*sc),h=Math.round(bmp.height*sc);
  const src=document.createElement("canvas");src.width=w;src.height=h;src.getContext("2d").drawImage(bmp,0,0,w,h);
  S.scan.cur={src,w,h,quad:detectQuad(src)};drawScanEdit();
}
// Blatt finden: hellste zusammenhängende Fläche (Otsu-Schwelle), Ecken über Extrempunkte
// Blatt finden: helle zusammenhängende Fläche. Mehrere Helligkeitsschwellen probieren
// (heller Tisch neben weißem Papier) und die Fläche nehmen, die das Viereck am besten ausfüllt.
function polyArea(p){let a=0;for(let k=0;k<p.length;k++){const [x1,y1]=p[k],[x2,y2]=p[(k+1)%p.length];a+=x1*y2-x2*y1}return Math.abs(a)/2}
// Konvexe Hülle (Monotone Chain)
function convexHull(pts){
  const P=pts.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);if(P.length<3)return P;
  const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]),lo=[],up=[];
  for(const p of P){while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p)}
  for(let i=P.length-1;i>=0;i--){const p=P[i];while(up.length>=2&&cr(up[up.length-2],up[up.length-1],p)<=0)up.pop();up.push(p)}
  lo.pop();up.pop();return lo.concat(up);
}
// Ecken sortieren: oben links, oben rechts, unten rechts, unten links
function orderQuad(q){
  const cx=q.reduce((s,p)=>s+p[0],0)/4,cy=q.reduce((s,p)=>s+p[1],0)/4;
  q=q.slice().sort((p,r)=>Math.atan2(p[1]-cy,p[0]-cx)-Math.atan2(r[1]-cy,r[0]-cx));
  let st=0;q.forEach((p,i)=>{if(p[0]+p[1]<q[st][0]+q[st][1])st=i});
  return q.slice(st).concat(q.slice(0,st)).map(p=>[p[0],p[1]]);
}
// Viereck aus dem Umriss: Hülle vereinfachen, Blattseiten = Hüllkanten, die das kleinste umschließende Viereck bilden,
// Ecken = Schnittpunkte benachbarter Seiten. So werden auch abgeschattete oder umgeknickte Ecken rekonstruiert.
function quadFromPoints(pts,w,h){
  let H=convexHull(pts);if(H.length<4)return null;
  const tri=(a,b,c)=>Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
  const total=polyArea(H);
  const minTri=()=>{let bi=0,bv=1e18;for(let i=0;i<H.length;i++){const v=tri(H[(i-1+H.length)%H.length],H[i],H[(i+1)%H.length]);if(v<bv){bv=v;bi=i}}return [bi,bv]};
  for(;;){if(H.length<=4)break;const [bi,bv]=minTri();if(H.length>12||bv<total*0.002){H.splice(bi,1)}else break}
  // fast gerade Knicke entfernen (Seite in zwei Stücke geteilt)
  const dir=(a,b)=>Math.atan2(b[1]-a[1],b[0]-a[0]);
  const turn=i=>{const n=H.length,a=H[(i-1+n)%n],b=H[i],c=H[(i+1)%n];let d=Math.abs(dir(a,b)-dir(b,c));if(d>Math.PI)d=2*Math.PI-d;return d};
  for(let ch=true;ch&&H.length>4;){ch=false;for(let i=0;i<H.length&&H.length>4;i++)if(turn(i)<10*Math.PI/180){H.splice(i,1);ch=true;break}}
  if(H.length===4)return orderQuad(H);
  const n=H.length,len=i=>Math.hypot(H[(i+1)%n][0]-H[i][0],H[(i+1)%n][1]-H[i][1]);
  let per=0;for(let i=0;i<n;i++)per+=len(i);
  const cut=(i,j)=>{const [a,b]=[H[i],H[(i+1)%n]],[c,d]=[H[j],H[(j+1)%n]];
    const r=[b[0]-a[0],b[1]-a[1]],s=[d[0]-c[0],d[1]-c[1]],den=r[0]*s[1]-r[1]*s[0];if(Math.abs(den)<1e-9)return null;
    const sn=Math.abs(den)/(Math.hypot(...r)*Math.hypot(...s));if(sn<Math.sin(40*Math.PI/180))return null;
    const t=((c[0]-a[0])*s[1]-(c[1]-a[1])*s[0])/den;return [a[0]+t*r[0],a[1]+t*r[1]]};
  // Stützung: Anteil einer Kante, entlang dem wirklich Randpunkte liegen (überbrückte Lücken, z. B. an Fingern, haben wenig)
  const grid=new Uint8Array(w*h);for(const [x,y] of pts)for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const X=x+dx,Y=y+dy;if(X>=0&&Y>=0&&X<w&&Y<h)grid[Y*w+X]=1}
  let sgn=0;for(let i=0;i<n;i++){const a=H[i],b=H[(i+1)%n];sgn+=a[0]*b[1]-b[0]*a[1]}
  // Kandidaten-Linien: Hüllkanten und Sehnen über bis zu 3 Hüllpunkte hinweg (überspringt Ausbuchtungen wie Finger).
  // Jede Linie muss lang genug und entlang ihrer Länge von echten Randpunkten gestützt sein.
  const seg=(i,j)=>{const A=H[i%n],B=H[j%n];return {i,j,A,B,len:Math.hypot(B[0]-A[0],B[1]-A[1])}};
  const supS=L=>{let k=0;for(let t=0;t<24;t++){const f=(t+.5)/24,X=Math.round(L.A[0]+(L.B[0]-L.A[0])*f),Y=Math.round(L.A[1]+(L.B[1]-L.A[1])*f);if(X>=0&&Y>=0&&X<w&&Y<h&&grid[Y*w+X])k++}return k/24};
  const lines=[];for(let i=0;i<n;i++)for(let sk=1;sk<=Math.min(4,n-3);sk++){const L=seg(i,i+sk);if(L.len>=per/4*0.25&&supS(L)>=(sk===1?0.7:0.8))lines.push(L)}
  const cutL=(L,M)=>{const r=[L.B[0]-L.A[0],L.B[1]-L.A[1]],s2=[M.B[0]-M.A[0],M.B[1]-M.A[1]],den=r[0]*s2[1]-r[1]*s2[0];if(Math.abs(den)<1e-9)return null;
    if(Math.abs(den)/(L.len*M.len)<Math.sin(40*Math.PI/180))return null;const t=((M.A[0]-L.A[0])*s2[1]-(M.A[1]-L.A[1])*s2[0])/den;return [L.A[0]+t*r[0],L.A[1]+t*r[1]]};
  const sg=Math.sign(sgn)||1;
  const insideX=(P,skip)=>H.every((v,vi)=>{if(skip.has(vi))return true;for(let k=0;k<4;k++){const a=P[k],b=P[(k+1)%4],cr=(b[0]-a[0])*(v[1]-a[1])-(b[1]-a[1])*(v[0]-a[0]);if(cr*sg<-2*Math.hypot(b[0]-a[0],b[1]-a[1]))return false}return true});
  // Linien in Umlaufreihenfolge, ohne Überlappung; kleinstes gültiges Viereck gewinnt
  const pick=lines=>{let q=null,qa=1e18;const m=lines.length;
  for(let a=0;a<m;a++){const L0=lines[a];for(let b=0;b<m;b++){const L1=lines[b];if(L1.i<L0.j||L1.i>=L0.i+n)continue;
    for(let c=0;c<m;c++){const L2=lines[c];if(L2.i<L1.j||L2.i>=L0.i+n)continue;
      for(let d=0;d<m;d++){const L3=lines[d];if(L3.i<L2.j||L3.j>L0.i+n)continue;
        const S=[L0,L1,L2,L3],P=[];let ok=true;
        for(let k=0;k<4&&ok;k++){const p=cutL(S[k],S[(k+1)%4]);if(!p||p[0]<-0.05*w||p[1]<-0.05*h||p[0]>1.05*w||p[1]>1.05*h)ok=false;else P.push(p)}
        if(!ok)continue;const ar=polyArea(P);if(ar>=qa)continue;
        const skip=new Set();for(const L of S)for(let v=L.i+1;v<L.j;v++)skip.add(v%n);
        if(insideX(P,skip)){qa=ar;q=P}}}}}
    return q};
  // zuerst nur echte Hüllkanten, Sehnen nur wenn nötig
  let q=pick(lines.filter(L=>L.j-L.i===1))||pick(lines);
  if(!q)return fallbackQuad(H);
  q=q.map(p=>[Math.max(0,Math.min(w-1,p[0])),Math.max(0,Math.min(h-1,p[1]))]);
  return orderQuad(q);
}
// Rückfall: größtes Viereck aus den Hüllpunkten
function fallbackQuad(H){
  const n=H.length;let best=null,ba=-1;
  for(let a=0;a<n;a++)for(let b=a+1;b<n;b++)for(let c=b+1;c<n;c++)for(let d=c+1;d<n;d++){const ar=polyArea([H[a],H[b],H[c],H[d]]);if(ar>ba){ba=ar;best=[H[a],H[b],H[c],H[d]]}}
  return orderQuad(best);
}
function detectQuad(src){
  const W=360,sc=W/Math.max(src.width,src.height),w=Math.max(1,Math.round(src.width*sc)),h=Math.max(1,Math.round(src.height*sc));
  const c=document.createElement("canvas");c.width=w;c.height=h;const x=c.getContext("2d",{willReadFrequently:true});x.filter="blur(2px)";x.drawImage(src,0,0,w,h);
  const d=x.getImageData(0,0,w,h).data,g=new Uint8Array(w*h);
  for(let i=0;i<w*h;i++)g[i]=(d[i*4]*0.299+d[i*4+1]*0.587+d[i*4+2]*0.114)|0;
  const otsu=(lo)=>{const hist=new Array(256).fill(0);let n=0;for(let i=0;i<w*h;i++)if(g[i]>lo){hist[g[i]]++;n++}
    let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];let sB=0,wB=0,best=0,th=lo+1;
    for(let t=lo+1;t<256;t++){wB+=hist[t];if(!wB)continue;const wF=n-wB;if(!wF)break;sB+=t*hist[t];const mB=sB/wB,mF=(sum-sB)/wF,v=wB*wF*(mB-mF)**2;if(v>best){best=v;th=t}}
    return th};
  const comp=th=>{const lab=new Int32Array(w*h);let bestLab=0,bestSize=0,cur=0;const st=[];
    for(let i=0;i<w*h;i++){if(g[i]<=th||lab[i])continue;cur++;let size=0;st.push(i);lab[i]=cur;
      while(st.length){const p=st.pop();size++;const px=p%w,py=(p/w)|0;
        for(const q of [px>0?p-1:-1,px<w-1?p+1:-1,py>0?p-w:-1,py<h-1?p+w:-1])if(q>=0&&!lab[q]&&g[q]>th){lab[q]=cur;st.push(q)}}
      if(size>bestSize){bestSize=size;bestLab=cur}}
    if(!bestSize)return null;
    // Umriss: je Zeile linkester/rechtester Punkt der Fläche -> konvexe Hülle -> größtes einbeschriebenes Viereck
    const pts=[];for(let y=0;y<h;y++){let l=-1,r=-1;for(let x=0;x<w;x++)if(lab[y*w+x]===bestLab){if(l<0)l=x;r=x}if(l>=0){pts.push([l,y]);if(r!==l)pts.push([r,y])}}
    for(let x=0;x<w;x++){let t=-1,b=-1;for(let y=0;y<h;y++)if(lab[y*w+x]===bestLab){if(t<0)t=y;b=y}if(t>=0){pts.push([x,t]);if(b!==t)pts.push([x,b])}}
    const q=quadFromPoints(pts,w,h);if(!q)return null;
    const area=polyArea(q);
    return {size:bestSize,quad:q,fill:area?bestSize/area:0}};
  const t1=otsu(-1),cands=[];
  for(const th of [t1,otsu(t1),Math.round((t1+otsu(t1))/2)]){const r=comp(th);if(r&&r.size>=w*h*0.12)cands.push(r)}
  const full=[[0.03,0.03],[0.97,0.03],[0.97,0.97],[0.03,0.97]].map(([a,b])=>[a*src.width,b*src.height]);
  if(!cands.length)return full;
  // Lieber etwas Rand zu viel als abgeschnittener Inhalt: größte Fläche nehmen, außer sie ist praktisch das ganze Foto
  // (Blatt auf hellem Tisch) oder kein sauberes Viereck – dann die strengere Schwelle
  cands.forEach(c=>c.qa=c.size/c.fill);cands.sort((a,b)=>b.size-a.size);
  const pick=cands.find(c=>c.qa<w*h*0.9&&c.fill>=0.8)||cands.sort((a,b)=>b.fill-a.fill)[0];
  return pick.quad.map(([px,py])=>[px/sc,py/sc]);
}
function drawScanEdit(){
  const SC=S.scan,cur=SC.cur;
  $("#sheetHost").innerHTML=`<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-label="Ränder anpassen">
    <div class="sheet-head"><h2>Ränder prüfen</h2><div class="btnrow"><button type="button" class="btn" data-act="scanback">Zurück</button><button type="button" class="btn primary" data-act="scanok">Übernehmen</button></div></div>
    <p class="status" style="margin:10px 0 0">Zieh die Ecken auf die Ecken des Blatts.</p>
    <div class="scanwrap"><canvas id="scanCv"></canvas></div>
    <div class="chips" style="margin-top:10px" aria-label="Bilddarstellung">${[["color","Farbe aufgehellt"],["orig","Original"],["bw","Schwarz-Weiß"]].map(([k,l])=>`<button type="button" class="chip" data-act="scanmode" data-mode="${k}" aria-pressed="${(SC.mode||"color")===k}">${l}</button>`).join("")}</div>
    <div class="btnrow"><button type="button" class="btn" data-act="scanfull">Ganzes Foto verwenden</button><button type="button" class="btn" data-act="scanauto">Ränder neu suchen</button></div>
  </div></div>`;
  const cv=$("#scanCv"),maxW=Math.min(window.innerWidth-40,700),maxH=window.innerHeight*0.6;
  const k=Math.min(maxW/cur.w,maxH/cur.h);cv.width=Math.round(cur.w*k);cv.height=Math.round(cur.h*k);cur.k=k;
  const ctx=cv.getContext("2d");
  const paint=()=>{ctx.drawImage(cur.src,0,0,cv.width,cv.height);const q=cur.quad.map(([x,y])=>[x*k,y*k]);
    ctx.fillStyle="rgba(22,58,107,.18)";ctx.strokeStyle="#7fb2e8";ctx.lineWidth=3;ctx.beginPath();q.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();ctx.stroke();
    for(const [x,y] of q){ctx.beginPath();ctx.arc(x,y,13,0,7);ctx.fillStyle="rgba(255,255,255,.9)";ctx.fill();ctx.lineWidth=3;ctx.stroke()}};
  paint();
  let drag=-1;
  const pos=e=>{const r=cv.getBoundingClientRect();return [(e.clientX-r.left)*cv.width/r.width,(e.clientY-r.top)*cv.height/r.height]};
  cv.addEventListener("pointerdown",e=>{const [x,y]=pos(e);let bd=40;cur.quad.forEach(([qx,qy],i)=>{const dd=Math.hypot(qx*k-x,qy*k-y);if(dd<bd){bd=dd;drag=i}});if(drag>=0){cv.setPointerCapture(e.pointerId);e.preventDefault()}});
  cv.addEventListener("pointermove",e=>{if(drag<0)return;const [x,y]=pos(e);cur.quad[drag]=[Math.max(0,Math.min(cur.w,x/k)),Math.max(0,Math.min(cur.h,y/k))];paint()});
  const up=()=>{drag=-1};cv.addEventListener("pointerup",up);cv.addEventListener("pointercancel",up);
  $("#scrim").addEventListener("click",async e=>{
    const b=e.target.closest("[data-act]");if(!b)return;const act=b.dataset.act;
    if(act==="scanback"){SC.cur=null;return drawScanStart()}
    if(act==="scanfull"){cur.quad=[[0,0],[cur.w,0],[cur.w,cur.h],[0,cur.h]];return paint()}
    if(act==="scanauto"){cur.quad=detectQuad(cur.src);return paint()}
    if(act==="scanmode"){SC.mode=b.dataset.mode;$("#scrim").querySelectorAll("[data-act=scanmode]").forEach(x=>x.setAttribute("aria-pressed",x===b));return}
    if(act==="scanok"){b.disabled=true;b.textContent="Wird aufbereitet …";await new Promise(r=>setTimeout(r,30));
      const warped=warpQuad(cur.src,cur.quad),mode=SC.mode||"color";
      // PDF-Bild nach gewähltem Modus; Texterkennung immer mit S/W-Aufbereitung (liest am besten)
      const out=mode==="bw"?warped:mode==="orig"?cloneCanvas(warped):brightenColor(cloneCanvas(warped));
      const ocrBlob=await new Promise(r=>enhanceScan(warped).toBlob(r,"image/jpeg",0.9));
      const ps=Math.min(1,2200/Math.max(out.width,out.height)),pw=Math.round(out.width*ps),ph=Math.round(out.height*ps);
      const small=document.createElement("canvas");small.width=pw;small.height=ph;small.getContext("2d").drawImage(out,0,0,pw,ph);
      const blob=await new Promise(r=>small.toBlob(r,"image/jpeg",0.88));
      SC.pages.push({blob,ocrBlob,w:pw,h:ph,url:URL.createObjectURL(blob)});SC.cur=null;drawScanStart()}
  });
}
// Perspektive entzerren (Quadrat -> Viereck, Heckbert), bilinear abtasten
function warpQuad(src,quad){
  const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]=quad;
  let W=Math.max(Math.hypot(x1-x0,y1-y0),Math.hypot(x2-x3,y2-y3)),H=Math.max(Math.hypot(x3-x0,y3-y0),Math.hypot(x2-x1,y2-y1));
  const sc=Math.min(1,3200/Math.max(W,H));W=Math.max(10,Math.round(W*sc));H=Math.max(10,Math.round(H*sc));
  const sx=x0-x1+x2-x3,sy=y0-y1+y2-y3;let a,b,c,d,e,f,g=0,h=0;
  if(Math.abs(sx)<1e-6&&Math.abs(sy)<1e-6){a=x1-x0;b=x3-x0;c=x0;d=y1-y0;e=y3-y0;f=y0}
  else{const dx1=x1-x2,dx2=x3-x2,dy1=y1-y2,dy2=y3-y2,den=dx1*dy2-dx2*dy1;g=(sx*dy2-dx2*sy)/den;h=(dx1*sy-sx*dy1)/den;
    a=x1-x0+g*x1;b=x3-x0+h*x3;c=x0;d=y1-y0+g*y1;e=y3-y0+h*y3;f=y0}
  const sw=src.width,shh=src.height,sd=src.getContext("2d",{willReadFrequently:true}).getImageData(0,0,sw,shh).data;
  const out=document.createElement("canvas");out.width=W;out.height=H;const oc=out.getContext("2d");const od=oc.createImageData(W,H),o=od.data;
  for(let j=0;j<H;j++){const v=j/(H-1);for(let i=0;i<W;i++){const u=i/(W-1),den=g*u+h*v+1;
    let X=(a*u+b*v+c)/den,Y=(d*u+e*v+f)/den;if(X<0)X=0;if(Y<0)Y=0;if(X>sw-1.001)X=sw-1.001;if(Y>shh-1.001)Y=shh-1.001;
    const xi=X|0,yi=Y|0,fx=X-xi,fy=Y-yi,p=(yi*sw+xi)*4,q=p+sw*4,t=(j*W+i)*4;
    for(let ch=0;ch<3;ch++){o[t+ch]=(sd[p+ch]*(1-fx)+sd[p+4+ch]*fx)*(1-fy)+(sd[q+ch]*(1-fx)+sd[q+4+ch]*fx)*fy}o[t+3]=255}}
  oc.putImageData(od,0,0);return out;
}
function cloneCanvas(cv){const c=document.createElement("canvas");c.width=cv.width;c.height=cv.height;c.getContext("2d").drawImage(cv,0,0);return c}
// Farbe aufgehellt: Weiß- und Schwarzpunkt aus der Helligkeitsverteilung (Perzentile), Farben und Grauflächen bleiben erhalten
function brightenColor(cv){
  const w=cv.width,h=cv.height,ctx=cv.getContext("2d",{willReadFrequently:true}),a=ctx.getImageData(0,0,w,h),d=a.data;
  const hist=new Uint32Array(256);let n=0;
  for(let i=0;i<d.length;i+=16){hist[(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])|0]++;n++}
  const pct=p=>{let acc=0;for(let v=0;v<256;v++){acc+=hist[v];if(acc>=n*p)return v}return 255};
  const lo=Math.min(pct(0.01),60),hi=Math.max(pct(0.90),lo+60),k=255/(hi-lo),lut=new Uint8ClampedArray(256);
  for(let v=0;v<256;v++){const x=Math.max(0,Math.min(1,(v-lo)*k/255));lut[v]=Math.round(255*Math.pow(x,0.9))}
  for(let i=0;i<d.length;i+=4){d[i]=lut[d[i]];d[i+1]=lut[d[i+1]];d[i+2]=lut[d[i+2]]}
  ctx.putImageData(a,0,0);return cv;
}
// Scan-Look: Graustufen, Licht ausgleichen, Papier weiß, Schrift kräftig
function enhanceScan(cv){
  const w=cv.width,h=cv.height,ctx=cv.getContext("2d",{willReadFrequently:true});
  const bg=document.createElement("canvas");bg.width=w;bg.height=h;const bx=bg.getContext("2d",{willReadFrequently:true});
  bx.filter=`blur(${Math.round(Math.max(w,h)/60)}px)`;bx.drawImage(cv,0,0);
  const a=ctx.getImageData(0,0,w,h),d=a.data,e=bx.getImageData(0,0,w,h).data;
  for(let i=0;i<d.length;i+=4){
    const gv=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2],bv=Math.max(1,0.299*e[i]+0.587*e[i+1]+0.114*e[i+2]);
    let v=gv/bv*255;v=v>=245?255:v*0.98;d[i]=d[i+1]=d[i+2]=v>255?255:v;
  }
  ctx.putImageData(a,0,0);return cv;
}
async function finishScanPdf(){
  const SC=S.scan;const pages=[];
  for(const p of SC.pages)pages.push({jpg:new Uint8Array(await p.blob.arrayBuffer()),w:p.w,h:p.h});
  const pdf=jpegsToPdf(pages);const images=SC.pages.map(p=>p.ocrBlob||p.blob);
  SC.pages.forEach(p=>URL.revokeObjectURL(p.url));
  scanFinish({pdf,images});
}
// Texterkennung für Scan-Ergebnis (Bilder sind schon aufbereitet) oder Datei
async function readText(input){
  if(input.images){await ensureTess();let t="";for(const im of input.images)t+=(await ocrBest(im))+"\n";return t}
  return docText(input.file||input);
}

const PDFJS="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
// Texterkennung eines Bildes; Wörter mit Position werden für Ausschnitte (Ampel) gesammelt
async function tessRec(img){
  let res;try{res=await tessWorker.recognize(img,{},{text:true,blocks:true})}catch{res=await tessWorker.recognize(img)}
  const d=res?.data||{};
  if(S.ocrCap){let words=d.words;if(!words?.length&&d.blocks)words=d.blocks.flatMap(b=>(b.paragraphs||[]).flatMap(p=>(p.lines||[]).flatMap(l=>l.words||[])));
    S.ocrCap.push({img,words:(words||[]).map(w=>({text:w.text||"",b:w.bbox}))})}
  return d.text||"";
}
async function docText(file){
  if(file.type==="application/pdf"||/\.pdf$/i.test(file.name||"")){
    await loadLib(PDFJS,()=>!!window.pdfjsLib);
    pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    const pdf=await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
    let text="";const pages=Math.min(pdf.numPages,12);
    for(let p=1;p<=pages;p++){
      const page=await pdf.getPage(p);const tc=await page.getTextContent();
      // Textstücke zu Zeilen zusammensetzen (gleiche Höhe)
      const rows=new Map();for(const it of tc.items){const y=Math.round(it.transform[5]);const r=rows.get(y)||[];r.push([it.transform[4],it.str]);rows.set(y,r)}
      let pt=[...rows.entries()].sort((a,b)=>b[0]-a[0]).map(([,r])=>r.sort((a,b)=>a[0]-b[0]).map(x=>x[1]).join(" ")).join("\n");
      if(pt.replace(/\s/g,"").length<40){ // gescanntes PDF: Seite als Bild lesen
        const vp=page.getViewport({scale:2.2});const cv=document.createElement("canvas");cv.width=vp.width;cv.height=vp.height;
        await page.render({canvasContext:cv.getContext("2d"),viewport:vp}).promise;
        await ensureTess();const bl=await prepareForOcr(await new Promise(r=>cv.toBlob(r,"image/png")));pt=await tessRec(bl);
      }
      text+=pt+"\n";
    }
    return text;
  }
  await ensureTess();return await ocrBest(await prepareForOcr(file));
}
async function toPdf(blob){
  if(blob.type==="application/pdf")return blob;
  const bmp=await createImageBitmap(blob);const sc=Math.min(1,2000/Math.max(bmp.width,bmp.height));
  const w=Math.round(bmp.width*sc),h=Math.round(bmp.height*sc);
  const cv=document.createElement("canvas");cv.width=w;cv.height=h;const ctx=cv.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,w,h);ctx.drawImage(bmp,0,0,w,h);
  const jpg=new Uint8Array(await (await new Promise(r=>cv.toBlob(r,"image/jpeg",0.85))).arrayBuffer());
  return jpegToPdf(jpg,w,h);
}
function jpegToPdf(jpg,w,h){return jpegsToPdf([{jpg,w,h}])}
function jpegsToPdf(pages){
  const enc=new TextEncoder(),parts=[],off=[];let pos=0;
  const push=x=>{const b=typeof x==="string"?enc.encode(x):x;parts.push(b);pos+=b.length};
  const pw=595.28,ph=841.89,n=pages.length;
  push(new Uint8Array([37,80,68,70,45,49,46,52,10,37,226,227,207,211,10]));
  const obj=(i,body)=>{off[i]=pos;push(`${i} 0 obj\n${body}\nendobj\n`)};
  obj(1,"<< /Type /Catalog /Pages 2 0 R >>");
  obj(2,`<< /Type /Pages /Kids [${pages.map((_,i)=>`${3+i*3} 0 R`).join(" ")}] /Count ${n} >>`);
  pages.forEach((p,i)=>{
    const po=3+i*3,io=po+1,co=po+2;
    const s=Math.min(pw/p.w,ph/p.h),dw=+(p.w*s).toFixed(2),dh=+(p.h*s).toFixed(2),x=+((pw-dw)/2).toFixed(2),y=+((ph-dh)/2).toFixed(2);
    const content=`q ${dw} 0 0 ${dh} ${x} ${y} cm /Im0 Do Q`;
    obj(po,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${io} 0 R >> >> /Contents ${co} 0 R >>`);
    off[io]=pos;push(`${io} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /${p.gray?"DeviceGray":"DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpg.length} >>\nstream\n`);push(p.jpg);push("\nendstream\nendobj\n");
    obj(co,`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  const total=3+n*3,xref=pos;let t=`xref\n0 ${total}\n0000000000 65535 f \n`;for(let i=1;i<total;i++)t+=String(off[i]).padStart(10,"0")+" 00000 n \n";
  push(t+`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts,{type:"application/pdf"});
}
