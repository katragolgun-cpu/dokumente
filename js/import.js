// Teilen-Menü, Import, Umsortieren
"use strict";
/* ================= Dateien von außen: Teilen-Menü und „Öffnen mit“ ================= */
async function takeShared(){
  history.replaceState(null,"",location.pathname);
  try{const c=await caches.open("share-inbox");const key=new URL("shared-file",location.origin+location.pathname).href;
    const r=await c.match(key);if(!r)return;const b=await r.blob();await c.delete(key);
    takeIncoming(new File([b],decodeURIComponent(r.headers.get("x-name")||"Dokument"),{type:b.type||r.headers.get("content-type")||""}))}catch{toast("Die geteilte Datei konnte nicht gelesen werden.")}
}
async function takeIncoming(f){while(!S.loaded)await new Promise(r=>setTimeout(r,100));if(S.edit)closeSheet();
  if(isImg(f)){const pr=scanDocument("Brief erfassen");scanLoad(f);const r=await pr;if(r)openNew(r);return}
  openNew({file:f})}
if("launchQueue" in window)launchQueue.setConsumer(async p=>{if(p.files?.length){try{takeIncoming(await p.files[0].getFile())}catch{}}});

/* ================= Import vorhandener Dokumente (einmalig, Liste von Claude) ================= */
function importStatus(t){const b=$("#importBar");if(!b)return;b.hidden=!t;b.textContent=t||""}
function b64uToBlob(s,type){const b=atob(String(s).replace(/-/g,"+").replace(/_/g,"/"));const a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return new Blob([a],{type})}
async function pdfText(blob){
  try{await loadLib(PDFJS,()=>!!window.pdfjsLib);
    pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    const pdf=await pdfjsLib.getDocument({data:new Uint8Array(await blob.arrayBuffer())}).promise;let t="";
    for(let i=1;i<=Math.min(pdf.numPages,8);i++){const tc=await (await pdf.getPage(i)).getTextContent();t+=tc.items.map(x=>x.str).join(" ")+"\n"}
    return {text:t.replace(/[ \t]+/g," ").trim(),pages:pdf.numPages};
  }catch{return {text:"",pages:0}}
}
function gmailPdfParts(thread,only){
  const out=[],seen=new Set();
  const walk=(p,msgId)=>{if(!p)return;
    const fn=p.filename||"";
    if(p.body?.attachmentId&&(/\.pdf$/i.test(fn)||p.mimeType==="application/pdf")&&(!only||only.includes(fn))){
      const k=fn+"|"+(p.body.size||0);if(!seen.has(k)){seen.add(k);out.push({msgId,attId:p.body.attachmentId,filename:fn||"Anhang.pdf"})}}
    for(const c of p.parts||[])walk(c,msgId)};
  for(const m of thread.messages||[])walk(m.payload,m.id);
  return out;
}
async function importOne(e){
  const doc={...blankDoc(),id:e.id,letterDate:e.letterDate||"",sender:e.sender||"",subject:e.subject||"",category:e.category||catNames().at(-1),
    tags:e.tags||[],summary:e.summary||"",ref:e.ref||"",refLabel:e.ref?"Nummer":"",amount:e.amount??null,status:e.status||"erledigt",text:e.text||"",imported:e.src.type};
  const target=await wantedFolder(doc),name=fileName(doc);let blob=null;
  if(e.src.type==="drive"){
    const c=await (await gfetch(`${API}/${e.src.fileId}/copy?fields=id,webViewLink,size`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,parents:[target]})})).json();
    doc.driveId=c.id;doc.url=c.webViewLink||`https://drive.google.com/file/d/${c.id}/view`;doc.folder=target;doc.name=name;
    if(+c.size&&+c.size<8e6)blob=await (await gfetch(`${API}/${c.id}?alt=media`)).blob();
  }else{
    const th=await (await gfetch(`${GMAIL}/threads/${e.src.threadId}?format=full`)).json();
    const parts=gmailPdfParts(th,e.src.files);
    if(!parts.length){doc.url=`https://mail.google.com/mail/u/0/#all/${e.src.threadId}`;doc.note="Kein PDF-Anhang – Link zur E-Mail."}
    for(let i=0;i<parts.length;i++){
      const p=parts[i],a=await (await gfetch(`${GMAIL}/messages/${p.msgId}/attachments/${p.attId}`)).json();
      const b=b64uToBlob(a.data,"application/pdf"),nm=i?name.replace(/\.pdf$/,`_Anlage-${i}.pdf`):name;
      const up=await uploadMultipart({name:nm,parents:[target],description:[doc.sender,doc.subject].join(" · ")},b);
      const url=up.webViewLink||`https://drive.google.com/file/d/${up.id}/view`;
      if(!i){doc.driveId=up.id;doc.url=url;doc.folder=target;doc.name=name;blob=b}
      else (doc.attachments=doc.attachments||[]).push({name:p.filename,driveId:up.id,url});
    }
  }
  if(blob){
    const r=await pdfText(blob);doc.pages=r.pages;if(!doc.text)doc.text=r.text.slice(0,12000);
    const t=await pdfThumb(blob);if(t)doc.thumbId=await storeFile(t,"vorschau.jpg");
  }
  doc.createdAt=doc.updatedAt=new Date().toISOString();
  await dbPut("docs",doc);S.docs.push(doc);
}
async function runImport(){
  if(G.importing||!tokenValid())return;G.importing=true;let fileId=null;
  try{
    importStatus("Import: Importliste wird gesucht …");
    const r=await (await gfetch(`${API}?q=${q("name='dokumente-import.json' and trashed=false")}&fields=files(id)`)).json();
    fileId=r.files?.[0]?.id;
    if(!fileId){toast("Keine Importliste in Drive gefunden");glog("Import: keine Importliste");S.settings.importMode=false;await dbPut("meta",{key:"settings",...S.settings});return}
    const data=await (await gfetch(`${API}/${fileId}?alt=media`)).json();
    let catAdded=false;for(const c of data.categories||[])if(!S.settings.categories.some(x=>x.name===c.name)){S.settings.categories.push(c);catAdded=true}
    if(catAdded)S.settings.updatedAt=new Date().toISOString();
    await ensureFolders();
    const todo=(data.entries||[]).filter(e=>!S.docs.some(d=>d.id===e.id)&&!S.deleted[e.id]);const fail=[];
    glog(`Import gestartet: ${todo.length} Dokumente`);
    for(let i=0;i<todo.length;i++){
      const e=todo[i];importStatus(`Import ${i+1} von ${todo.length}: ${e.sender||""} – ${e.subject||""}`);
      try{await importOne(e)}catch(err){if(err.code==="auth")throw err;fail.push(e.subject||e.id);glog("Import fehlgeschlagen: "+(e.subject||e.id))}
      if(i%5===4)render();
    }
    if(!fail.length)await gfetch(`${API}/${fileId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:`dokumente-import-erledigt-${today()}.json`})});
    S.settings.importMode=false;S.settings.lastImport={date:today(),ok:todo.length-fail.length,fail};
    await dbPut("meta",{key:"settings",...S.settings});
    glog(`Import fertig: ${todo.length-fail.length} übernommen, ${fail.length} fehlgeschlagen`);
    toast(fail.length?`${todo.length-fail.length} Dokumente übernommen, ${fail.length} fehlgeschlagen`:`${todo.length} Dokumente übernommen`);
  }catch(err){glog("Import unterbrochen: "+(err?.message||err));toast(err.code==="auth"?"Import unterbrochen: Anmeldung abgelaufen. In den Einstellungen „Import fortsetzen“ tippen.":"Import unterbrochen. In den Einstellungen „Import fortsetzen“ tippen.")}
  finally{G.importing=false;importStatus("");render();scheduleSync()}
}

/* ================= Umsortieren per Liste (dokumente-umsortieren.json, von Claude) ================= */
const RESORT_NAME="dokumente-umsortieren.json";
async function checkResort(){
  if(G.resortAsked||G.resortBusy||!tokenValid()||!hasDriveFull()||S.edit||G.importing)return;G.resortBusy=true;
  let fileId,data;
  try{const r=await (await gfetch(`${API}?q=${q(`name='${RESORT_NAME}' and trashed=false`)}&fields=files(id)`)).json();
    fileId=r.files?.[0]?.id;if(!fileId)return;data=await (await gfetch(`${API}/${fileId}?alt=media`)).json()}
  catch(e){glog("Umsortier-Liste nicht lesbar: "+(e?.message||e));return}
  finally{G.resortBusy=false}
  G.resortAsked=true;if(S.edit)return void(G.resortAsked=false);
  const byDrive=new Map(live().filter(d=>d.driveId).map(d=>[d.driveId,d]));
  const moves=(data.moves||[]).map(m=>({d:byDrive.get(m.driveId),c:String(m.category||"").trim()})).filter(m=>m.d&&m.c&&m.d.category!==m.c);
  const tids=[...new Set(data.trash||[])],trash=tids.map(id=>byDrive.get(id)).filter(Boolean);
  // Dateien ohne Brief in der App (z. B. doppelte Kopie): nur die Datei in den Drive-Papierkorb
  const orphans=tids.filter(id=>!byDrive.has(id)&&!live().some(d=>(d.attachments||[]).some(a=>a.driveId===id)));
  const done=async()=>{try{await gfetch(`${API}/${fileId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:`dokumente-umsortieren-erledigt-${today()}.json`})})}catch{}};
  const miss=(data.moves||[]).length+tids.length-moves.length-trash.length-orphans.length;
  if(!moves.length&&!trash.length&&!orphans.length){glog("Umsortier-Liste: nichts zu tun");return done()}
  S.edit={mode:"resort",urls:[]};
  const cats=[...new Set(moves.map(m=>m.c))].sort((a,b)=>a.localeCompare(b,"de"));
  sheet("Umsortieren",`<div id="edStatus" class="status" style="margin-top:10px"></div>
    <div class="sec"><p style="margin:0"><b>${nBriefe(moves.length)} verschieben${trash.length?`, ${nBriefe(trash.length)} in den Papierkorb`:""}${orphans.length?`, ${orphans.length} doppelte Datei${orphans.length===1?"":"en"} in den Papierkorb`:""}.</b> Ausführen?</p>
    ${data.note?`<p class="status">${esc(data.note)}</p>`:""}</div>
    <div class="sec"><h3>Ziele</h3><div class="status">${cats.map(c=>`${esc(c)}: ${moves.filter(m=>m.c===c).length}`).join("<br>")}</div>
    ${trash.length?`<h3 style="margin-top:12px">Papierkorb</h3><div class="status">${trash.map(d=>esc(`${dfmt(d.letterDate)} ${d.sender} – ${d.subject}`)).join("<br>")}</div>`:""}
    ${miss>0?`<div class="status">${miss} Einträge der Liste passen nicht (schon erledigt oder Brief nicht gefunden).</div>`:""}</div>`,
    `<button type="button" class="btn" data-act="later">Später</button><button type="button" class="btn primary" data-act="run">Ausführen</button>`);
  $("#scrim").addEventListener("click",async e=>{const b=e.target.closest("[data-act]");if(!b||b.disabled)return;
    if(b.dataset.act==="later")return closeSheet();
    if(b.dataset.act!=="run")return;
    $("#scrim").querySelectorAll("button").forEach(x=>x.disabled=true);setStatus("Wird ausgeführt …");
    try{
      const nm={};for(const c of [...new Set([...(data.categories||[]),...cats])])nm[c]=await createCategory(c);
      const now=new Date().toISOString();
      for(const m of moves){m.d.category=nm[m.c]||m.c;m.d.updatedAt=now;await dbPut("docs",m.d)}
      if(trash.length)await deleteDocs(trash);
      if(orphans.length){for(const id of orphans)S.trash.push({kind:"file",id});await dbPut("meta",{key:"trash",items:S.trash})}
      await done();glog(`Umsortiert: ${moves.length} verschoben, ${trash.length} gelöscht`);
      closeSheet();render();toast(`${nBriefe(moves.length)} umsortiert. Drive wird abgeglichen.`);scheduleSync();
    }catch(err){if(err.code==="auth"){closeSheet();return connectDrive(true)}setStatus("Umsortieren fehlgeschlagen. Bitte später erneut öffnen.",true);G.resortAsked=false;
      $("#scrim").querySelectorAll("button").forEach(x=>x.disabled=false)}
  });
}
