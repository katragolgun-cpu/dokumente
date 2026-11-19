// Bausteine, Qualität der Texterkennung, Großansicht
"use strict";
/* ================= Bausteine ================= */
function closeSheet(){if(S.edit?.urls)S.edit.urls.forEach(u=>URL.revokeObjectURL(u));S.edit=null;$("#sheetHost").innerHTML=""}
function sheet(title,body,headBtns){
  $("#sheetHost").innerHTML=`<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
   <div class="sheet-head"><h2>${esc(title)}</h2><div class="btnrow">${headBtns}</div></div>${body}</div></div>`;
  $("#scrim").addEventListener("click",e=>{if(e.target.id==="scrim"&&S.edit?.mode!=="new")closeSheet()});
}
function setStatus(msg,err){const s=$("#edStatus");if(s){s.textContent=msg||"";s.className="status"+(err?" err":"")}}
function field(label,id,val,type="text",cls="",extra=""){
  return `<label class="f ${cls}">${label}<input id="${id}" type="${type}" value="${esc(val??"")}" ${extra}></label>`;
}
async function storeFile(blob,name){const id=uid();await dbPut("files",{id,blob,name,type:blob.type});return id}
async function shrink(file,max,q){
  if(!file.type.startsWith("image/"))return file;
  try{const bmp=await createImageBitmap(file);const sc=Math.min(1,max/Math.max(bmp.width,bmp.height));
    const cv=document.createElement("canvas");cv.width=Math.round(bmp.width*sc);cv.height=Math.round(bmp.height*sc);
    cv.getContext("2d").drawImage(bmp,0,0,cv.width,cv.height);
    return await new Promise(res=>cv.toBlob(b=>res(b||file),"image/jpeg",q));}catch{return file}
}
async function makeThumb(img){
  try{const bmp=await createImageBitmap(img);const sc=Math.min(1,560/Math.max(bmp.width,bmp.height));
    const cv=document.createElement("canvas");cv.width=Math.round(bmp.width*sc);cv.height=Math.round(bmp.height*sc);
    const g=cv.getContext("2d");g.fillStyle="#fff";g.fillRect(0,0,cv.width,cv.height);g.drawImage(bmp,0,0,cv.width,cv.height);
    return await new Promise(r=>cv.toBlob(r,"image/jpeg",0.7));}catch{return null}
}
async function pdfThumb(file){
  try{await loadLib(PDFJS,()=>!!window.pdfjsLib);
    pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    const pdf=await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;const page=await pdf.getPage(1);
    const vp0=page.getViewport({scale:1}),vp=page.getViewport({scale:700/Math.max(vp0.width,vp0.height)});
    const cv=document.createElement("canvas");cv.width=vp.width;cv.height=vp.height;await page.render({canvasContext:cv.getContext("2d"),viewport:vp}).promise;
    return await new Promise(r=>cv.toBlob(r,"image/jpeg",0.7));}catch{return null}
}
async function openLocalFile(d){
  const f=d.fileId&&await dbGet("files",d.fileId);
  if(f){const u=URL.createObjectURL(f.blob);window.open(u,"_blank");setTimeout(()=>URL.revokeObjectURL(u),60000);return}
  if(d.url){window.open(d.url,"_blank");return}
  toast("Datei ist auf diesem Gerät nicht vorhanden.");
}
async function shareDoc(d){
  let f=d.fileId&&await dbGet("files",d.fileId);
  if(!f&&d.driveId){const b=await driveBlob(d.driveId);if(b)f={blob:b}}
  if(!f){toast("Datei nicht verfügbar.");return}
  const file=new File([f.blob],d.name||fileName(d),{type:"application/pdf"});
  if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:d.subject||"Dokument"})}catch{}}
  else{const u=URL.createObjectURL(f.blob);const a=document.createElement("a");a.href=u;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(u),5000)}
}

/* ================= Texterkennung: Qualität prüfen, bei Zeichensalat gedrehte Varianten versuchen ================= */
const isImg=f=>/^image\//.test(f.type||"")||/\.(png|jpe?g|webp|heic|gif|bmp)$/i.test(f.name||"");
// Anteil echter Wörter: Buchstabenfolgen ab 3 Zeichen mit Vokal, an allen Textstücken
function ocrQuality(t){
  const toks=String(t||"").split(/\s+/).filter(x=>x.length>=2);if(toks.length<5)return 0;
  const good=toks.filter(x=>/^[(„"]?[A-Za-zÄÖÜäöüß][a-zäöüß-]{2,}[.,:;)"“]?$/.test(x)&&/[aeiouäöüy]/i.test(x)).length;
  return good/toks.length;
}
async function rotateBlob(blob,deg){
  const bmp=await createImageBitmap(blob);const sw=deg%180!==0;
  const cv=document.createElement("canvas");cv.width=sw?bmp.height:bmp.width;cv.height=sw?bmp.width:bmp.height;
  const g=cv.getContext("2d");g.translate(cv.width/2,cv.height/2);g.rotate(deg*Math.PI/180);g.drawImage(bmp,-bmp.width/2,-bmp.height/2);
  return await new Promise(r=>cv.toBlob(r,"image/png"));
}
async function ocrBest(img){
  let best={t:await tessRec(img)};best.q=ocrQuality(best.t);
  if(best.q>=0.45)return best.t;
  for(const deg of [90,270,180]){
    setStatus?.(`Text schlecht lesbar – versuche gedrehtes Bild (${deg}°) …`);
    try{const t=await tessRec(await rotateBlob(img,deg)),q=ocrQuality(t);if(q>best.q)best={t,q};if(q>=0.6)break}catch{}
  }
  return best.t;
}

/* ================= Großansicht (Fotos und PDF-Seiten, mit Zoom) ================= */
const V={zoom:1,urls:[],open:false,pages:[],textOn:false,key:null,cache:new Map(),busy:false};
async function docBlob(d){
  const f=d.fileId&&await dbGet("files",d.fileId).catch(()=>null);if(f?.blob)return f.blob;
  if(d.driveId)return await driveBlob(d.driveId);
  return null;
}
async function viewerPages(src,onPage){
  let b=src.blob;
  if(src.images?.length)return src.images;
  if(src.doc)b=await docBlob(src.doc);
  if(!b)return [];
  if(b.type?.startsWith("image/"))return [b];
  await loadLib(PDFJS,()=>!!window.pdfjsLib);
  pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  const pdf=await pdfjsLib.getDocument({data:new Uint8Array(await b.arrayBuffer())}).promise;const out=[];
  for(let i=1;i<=Math.min(pdf.numPages,30);i++){
    const page=await pdf.getPage(i),vp0=page.getViewport({scale:1}),vp=page.getViewport({scale:Math.min(3,1800/vp0.width)});
    const cv=document.createElement("canvas");cv.width=Math.round(vp.width);cv.height=Math.round(vp.height);
    const g=cv.getContext("2d");g.fillStyle="#fff";g.fillRect(0,0,cv.width,cv.height);
    await page.render({canvasContext:g,viewport:vp}).promise;
    const blob=await new Promise(r=>cv.toBlob(r,"image/jpeg",0.88));out.push(blob);onPage?.(blob,i,pdf.numPages);
  }
  return out;
}
function closeViewer(fromPop){
  if(!V.open)return;V.open=false;V.urls.forEach(u=>URL.revokeObjectURL(u));V.urls=[];$("#viewerHost").innerHTML="";
  if(!fromPop&&history.state?.viewer)history.back();
}
function viewerZoom(z,keepCenter=true){
  const sc=$("#vScroll");if(!sc)return;
  const old=V.zoom;z=Math.max(1,Math.min(5,Math.round(z*4)/4));if(z===old)return;
  const cx=(sc.scrollLeft+sc.clientWidth/2)/sc.scrollWidth,cy=(sc.scrollTop+sc.clientHeight/2)/sc.scrollHeight;
  V.zoom=z;applyZoom();
  if(keepCenter){sc.scrollLeft=cx*sc.scrollWidth-sc.clientWidth/2;sc.scrollTop=cy*sc.scrollHeight-sc.clientHeight/2}
}
// Textebene: Texterkennung der angezeigten Seiten, unsichtbarer Text über dem Bild zum Markieren und Kopieren
async function viewerText(){
  const btn=$("#vTextBtn");
  if(V.textOn){V.textOn=false;V.pages.forEach(p=>p.pg.querySelector(".vtx")?.remove());if(btn)btn.textContent="Text markieren";return}
  if(V.busy||!V.pages.length)return;V.busy=true;
  try{
    const cached=V.key&&V.cache.get(V.key);let all=cached||[];
    if(!cached){
      if(btn)btn.textContent="Wird geladen …";await ensureTess();
      for(let i=0;i<V.pages.length;i++){
        if(!V.open)return;if(btn)btn.textContent=`Text wird erkannt (Seite ${i+1}/${V.pages.length}) …`;
        const res=await tessWorker.recognize(V.pages[i].blob,{},{text:true,blocks:true}),d=res?.data||{};
        let lines=d.lines;if(!lines?.length&&d.blocks)lines=d.blocks.flatMap(b=>(b.paragraphs||[]).flatMap(p=>p.lines||[]));
        all.push((lines||[]).map(l=>({t:(l.text||"").replace(/\s+$/,""),b:l.bbox})).filter(l=>l.t&&l.b));
      }
      if(V.key)V.cache.set(V.key,all);
    }
    if(!V.open)return;
    V.pages.forEach((p,i)=>{p.pg.querySelector(".vtx")?.remove();const L=document.createElement("div");L.className="vtx";
      for(const l of all[i]||[]){const e=document.createElement("div");e.textContent=l.t+"\n";e._b=l.b;L.appendChild(e)}
      p.pg.appendChild(L)});
    V.textOn=true;if(btn)btn.textContent="Text ausblenden";layoutText();
    toast(all.some(x=>x.length)?"Text lange drücken zum Markieren":"Kein Text erkannt");
  }catch(err){if(btn)btn.textContent="Text markieren";toast("Texterkennung nicht möglich (offline?)")}
  finally{V.busy=false;setStatus?.("")}
}
function layoutText(){
  if(!V.textOn)return;
  for(const p of V.pages){const L=p.pg.querySelector(".vtx");if(!L||!p.im.naturalWidth)continue;const s=p.im.clientWidth/p.im.naturalWidth;
    for(const e of L.children){const b=e._b,h=(b.y1-b.y0)*s,w=(b.x1-b.x0)*s;
      e.style.left=b.x0*s+"px";e.style.top=b.y0*s+"px";e.style.fontSize=Math.max(4,h*0.9)+"px";e.style.height=h+"px";e.style.transform="none";
      const mw=e.scrollWidth||1;e.style.transform=`scaleX(${(w/mw).toFixed(3)})`}}
}
function applyZoom(){
  const sc=$("#vScroll");if(!sc)return;const w=sc.clientWidth-20;
  sc.querySelectorAll(".vpages img").forEach(im=>im.style.width=Math.round(w*V.zoom)+"px");
  layoutText();
  const pc=$("#vPct");if(pc)pc.textContent=Math.round(V.zoom*100)+" %";
}
async function openViewer(src){
  if(src.doc&&!src.doc.fileId&&!src.doc.driveId&&src.doc.url){window.open(src.doc.url,"_blank");return}
  V.zoom=1;V.open=true;V.pages=[];V.textOn=false;V.key=src.doc?.id||null;
  $("#viewerHost").innerHTML=`<div class="vw" role="dialog" aria-modal="true" aria-label="Großansicht">
    <div class="vbar"><button type="button" class="btn" data-v="close">Schließen</button><button type="button" class="btn" data-v="text" id="vTextBtn">Text markieren</button>
      <div class="btnrow" style="align-items:center;gap:6px"><button type="button" class="btn" data-v="out" aria-label="Verkleinern">−</button><span class="pct" id="vPct">100 %</span><button type="button" class="btn" data-v="in" aria-label="Vergrößern">+</button></div></div>
    <div class="vscroll" id="vScroll"><div class="vpages" id="vPages"><div class="vmsg">Wird geladen …</div></div></div></div>`;
  try{history.pushState({viewer:1},"")}catch{}
  const host=$("#viewerHost");
  host.querySelector(".vbar").addEventListener("click",e=>{const b=e.target.closest("[data-v]");if(!b)return;
    if(b.dataset.v==="close")return closeViewer();if(b.dataset.v==="text")return viewerText();if(b.dataset.v==="in")return viewerZoom(V.zoom+0.5);if(b.dataset.v==="out")return viewerZoom(V.zoom-0.5)});
  // Doppeltippen: Stelle vergrößern bzw. zurück auf ganze Breite
  $("#vScroll").addEventListener("dblclick",e=>{const img=e.target.closest("img");if(!img)return;
    const sc=$("#vScroll"),r=img.getBoundingClientRect(),fx=(e.clientX-r.left)/r.width,fy=(e.clientY-r.top)/r.height,top=img.offsetTop;
    const z=V.zoom>1?1:2.5;V.zoom=z;applyZoom();
    if(z>1){sc.scrollLeft=fx*img.offsetWidth+img.offsetLeft-sc.clientWidth/2;sc.scrollTop=img.offsetTop+fy*img.offsetHeight-sc.clientHeight/2}else sc.scrollTop=top-10});
  const box=$("#vPages");let first=true;
  const add=blob=>{if(!V.open)return;if(first){box.innerHTML="";first=false}const u=URL.createObjectURL(blob);V.urls.push(u);
    const pg=document.createElement("div");pg.className="vpg";const im=new Image();im.src=u;im.alt="Seite";im.onload=applyZoom;pg.appendChild(im);box.appendChild(pg);V.pages.push({blob,pg,im});applyZoom()};
  try{
    const pages=await viewerPages(src,add);
    if(!V.open)return;
    if(first){if(pages.length)pages.forEach(add);else box.innerHTML=`<div class="vmsg">Die Datei ist auf diesem Gerät nicht vorhanden${src.doc?.driveId?" und Google Drive ist gerade nicht erreichbar":""}.</div>`}
  }catch{if(V.open)box.innerHTML=`<div class="vmsg">Anzeige nicht möglich (offline?).</div>`}
}
window.addEventListener("popstate",()=>{if(V.open)closeViewer(true)});
window.addEventListener("resize",()=>{if(V.open)applyZoom()});
