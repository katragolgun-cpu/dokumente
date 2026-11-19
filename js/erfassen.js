// Erfassen, Ansicht, Löschen, Mehrfachauswahl, Teilen
"use strict";
/* ================= Erfassen ================= */
async function startCapture(){
  const r=await scanDocument("Brief erfassen");if(!r)return;
  openNew(r);
}
function knownTags(){const m=new Map();for(const d of live())for(const t of d.tags||[])m.set(fold(t),t);return [...m.values()]}
function knownSenders(){return [...new Set(live().map(d=>d.sender).filter(Boolean))]}
function blankDoc(){return {id:uid(),createdAt:new Date().toISOString(),updatedAt:null,letterDate:"",sender:"",subject:"",category:"",tags:[],summary:"",ref:"",refLabel:"",amount:null,deadline:"",deadlineKind:"",status:"neu",note:"",text:"",pages:0}}
async function openNew(input,opt={}){
  const d=blankDoc();if(opt.category)d.category=opt.category;
  S.edit={mode:"new",doc:d,input,urls:[],auto:true,est:false,inbox:opt.inbox||null};
  // Datei vorbereiten: PDF für die Ablage, Vorschaubild
  let pdf=input.pdf||null,first=input.images?.[0]||null;
  if(!pdf&&input.file){pdf=input.file.type==="application/pdf"||/\.pdf$/i.test(input.file.name||"")?input.file:await toPdf(input.file);if(input.file.type?.startsWith("image/"))first=input.file}
  S.edit.pdf=pdf;d.pages=input.images?.length||1;
  const th=first?await makeThumb(first):await pdfThumb(pdf);
  S.edit.thumb=th;if(th){const u=URL.createObjectURL(th);S.edit.urls.push(u);S.edit.thumbUrl=u}
  drawEditor();
  runOcr(input);
}
function openEdit(d){S.edit={mode:"edit",doc:structuredClone(d),urls:[],auto:false};drawEditor()}
function drawEditor(){
  const E=S.edit,d=E.doc;
  const cats=catNames();if(d.category&&!cats.includes(d.category))cats.push(d.category);
  const sugg=knownTags().filter(t=>!(d.tags||[]).some(x=>fold(x)===fold(t))).slice(0,12);
  sheet(E.mode==="new"?"Neuer Brief":"Bearbeiten",`
    <div id="edStatus" class="status" style="margin-top:10px"></div>
    ${E.thumbUrl?`<div class="sec"><button type="button" class="zoomable" data-act="zoom" aria-label="Brief groß anzeigen"><img class="thumb" src="${E.thumbUrl}" alt="Erste Seite"><span class="zl"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M11 8v6M8 11h6"/></svg>Vergrößern</span></button></div>`:""}
    <div class="sec"><h3>Brief</h3><div class="grid2">
      ${field("Absender","f_sender",d.sender,"text","full",'list="dl_senders" autocomplete="off"')}
      ${field("Betreff","f_subject",d.subject,"text","full")}
      ${field("Briefdatum","f_date",d.letterDate,"date")}
      <label class="f">Kategorie<select id="f_cat">${cats.map(c=>`<option ${c===(d.category||cats[cats.length-1])?"selected":""}>${esc(c)}</option>`).join("")}</select></label>
      ${field("Aktenzeichen / Nummer","f_ref",d.ref,"text","","autocomplete=\"off\"")}
      ${field("Betrag (€)","f_amount",d.amount!=null?String(d.amount).replace(".",","):"","text","",'inputmode="decimal"')}
    </div><datalist id="dl_senders">${knownSenders().map(s=>`<option value="${esc(s)}">`).join("")}</datalist></div>
    <div class="sec"><h3>Frist</h3><div class="grid2">
      ${field("Frist bis","f_deadline",d.deadline,"date")}
      ${field("Art der Frist","f_dlkind",d.deadlineKind,"text","",'list="dl_kinds" placeholder="z. B. Zahlung"')}
    </div><datalist id="dl_kinds">${["Zahlung","Einspruch","Widerspruch","Rückmeldung","Kündigung","Termin","Frist"].map(k=>`<option value="${k}">`).join("")}</datalist>
    ${E.est&&d.deadline?`<div class="hint">Frist aus „innerhalb eines Monats“ o. ä. berechnet. Bitte prüfen.</div>`:""}</div>
    <div class="sec"><h3>Schlagwörter</h3>
      <div class="tagedit" id="tagEdit">${(d.tags||[]).map((t,i)=>`<span class="tag">${esc(t)}<button type="button" data-act="tagdel" data-i="${i}" aria-label="${esc(t)} entfernen">×</button></span>`).join("")}<input id="tagIn" placeholder="Schlagwort hinzufügen" enterkeyhint="done" autocomplete="off"></div>
      ${sugg.length?`<div class="sugg">${sugg.map(t=>`<button type="button" data-act="tagadd" data-t="${esc(t)}">+ ${esc(t)}</button>`).join("")}</div>`:""}</div>
    <div class="sec"><h3>Kurzinfo</h3><textarea id="f_summary" rows="5">${esc(d.summary)}</textarea>
      <div class="btnrow"><button type="button" class="btn link" data-act="resum">Kurzinfo neu aus den Feldern bilden</button></div></div>
    <div class="sec"><h3>Status</h3><div class="seg">${Object.entries(STATUS).map(([k,l])=>`<button type="button" class="${k}" data-act="st" data-s="${k}" aria-pressed="${d.status===k}">${l}</button>`).join("")}</div>
      ${field("Notiz","f_note",d.note,"text","",'placeholder="z. B. Einspruch geschickt am …"')}</div>
    <div class="sec"><details><summary class="status">Erkannter Text${d.text?` (${d.text.length} Zeichen)`:""}</summary>
      <textarea id="f_text" class="mono" rows="10" style="margin-top:8px">${esc(d.text)}</textarea>
      <div class="btnrow" style="margin-top:6px"><button type="button" class="btn" data-act="reparse">Felder neu aus dem Text lesen</button></div></details></div>
  `,`<button type="button" class="btn" data-act="cancel">Abbrechen</button><button type="button" class="btn primary" data-act="save">Speichern</button>`);
  $("#scrim").addEventListener("click",editorClick);
  $("#tagIn").addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===","){e.preventDefault();addTagFromInput()}});
  $("#tagIn").addEventListener("blur",()=>addTagFromInput());
  if(E.ocrBusy)setStatus(E.ocrMsg||"Text wird erkannt …");
}
function readForm(){
  const d=S.edit.doc,v=id=>$("#"+id)?.value??"";
  d.sender=v("f_sender").trim();d.subject=v("f_subject").trim();d.letterDate=v("f_date");d.category=v("f_cat");
  d.ref=v("f_ref").trim();const a=v("f_amount").trim().replace(/\s|€/g,"");d.amount=a?(+(/,/.test(a)?a.replace(/\./g,"").replace(",","."):a)||null):null;
  if(d.ref&&!d.refLabel)d.refLabel="Aktenzeichen";if(!d.ref)d.refLabel="";
  d.deadline=v("f_deadline");d.deadlineKind=v("f_dlkind").trim();d.summary=v("f_summary");d.note=v("f_note").trim();
  if($("#f_text"))d.text=v("f_text");
}
function addTagFromInput(){
  const inp=$("#tagIn");if(!inp)return;const t=inp.value.replace(/,/g," ").trim();if(!t)return;
  readForm();const d=S.edit.doc;if(!d.tags.some(x=>fold(x)===fold(t)))d.tags.push(t);inp.value="";drawEditor();$("#tagIn")?.focus();
}
function summaryFromFields(d){
  return Letter.buildSummary({sender:d.sender,subject:d.subject,date:d.letterDate,keySentence:S.edit?.key||null,deadline:d.deadline||null,deadlineKind:d.deadlineKind||"Frist",
    deadlineEstimated:!!S.edit?.est&&!!d.deadline,amount:d.amount,amountKind:S.edit?.amountKind||null,ref:d.ref?{label:d.refLabel||"Aktenzeichen",value:d.ref}:null});
}
function applyParsed(p,force){
  const d=S.edit.doc,set=(k,v)=>{if(v!=null&&v!==""&&(force||!d[k]))d[k]=v};
  set("letterDate",p.date);set("sender",p.sender);set("subject",p.subject);
  if(p.ref){if(force||!d.ref){d.ref=p.ref.value;d.refLabel=p.ref.label}}
  if(p.amount!=null&&(force||d.amount==null))d.amount=p.amount;
  if(p.deadline&&(force||!d.deadline)){d.deadline=p.deadline;d.deadlineKind=p.deadlineKind;S.edit.est=p.deadlineEstimated}
  for(const t of p.tags||[])if(!d.tags.some(x=>fold(x)===fold(t)))d.tags.push(t);
  S.edit.key=p.keySentence;S.edit.amountKind=p.amountKind;
  if(force||!d.summary)d.summary=p.summary;
  if(d.deadline&&d.status==="neu")d.status="todo";
}
function parseCtx(){return {today:today(),categories:S.settings.categories,senders:knownSenders(),tags:knownTags()}}
async function runOcr(input){
  const E=S.edit;E.ocrBusy=true;E.ocrMsg="Texterkennung startet … (beim ersten Mal etwas länger)";setStatus(E.ocrMsg);
  let text="";
  try{text=await readText(input)}catch(e){if(S.edit===E){E.ocrBusy=false;setStatus("Texterkennung nicht verfügbar (offline?). Bitte Felder selbst ausfüllen.",true)}return}
  if(S.edit!==E)return;
  E.ocrBusy=false;
  readForm();E.doc.text=text.trim();
  const p=Letter.parseLetter(text,parseCtx());applyParsed(p,false);
  const got=[p.sender&&"Absender",p.subject&&"Betreff",p.date&&"Datum",p.deadline&&"Frist",p.ref&&"Aktenzeichen",p.amount!=null&&"Betrag"].filter(Boolean);
  drawEditor();
  setStatus(got.length?`Erkannt: ${got.join(", ")}. Bitte kurz prüfen.`:"Nichts sicher erkannt. Bitte Felder ausfüllen.");
  const dup=findDuplicate(E.doc);if(dup)setStatus(`Achtung: Ein ähnlicher Brief ist schon gespeichert (${dup.sender||""}, ${dfmt(dup.letterDate)}).`,true);
}
// Ähnlicher Brief schon vorhanden: verwerfen, trotzdem speichern oder zurück zum Formular
function showDup(dup){
  const E=S.edit;
  sheet("Doppelter Brief?",`<div class="sec"><p style="margin:0"><b>Ähnlicher Brief schon vorhanden:</b></p>
    <p class="status" style="margin:6px 0 0">${esc([dup.sender,dfmt(dup.letterDate),dup.subject].filter(Boolean).join(" · "))}${dup.category?`<br>Kategorie: ${esc(dup.category)}`:""}</p></div>
    <div class="sec"><div class="optlist">
      <button type="button" class="btn danger" data-act="dupdrop">Scan verwerfen${E.inbox?" (Papierkorb)":""}</button>
      <button type="button" class="btn" data-act="dupsave">Trotzdem speichern</button>
      <button type="button" class="btn" data-act="dupback">Zurück</button></div></div>`,"");
  $("#scrim").addEventListener("click",async e=>{const b=e.target.closest("[data-act]");if(!b||S.edit!==E)return;
    if(b.dataset.act==="dupback")return drawEditor();
    if(b.dataset.act==="dupsave"){E.dupOk=true;drawEditor();return $("#scrim [data-act=save]")?.click()}
    if(b.dataset.act==="dupdrop"){
      if(E.inbox){S.trash.push({kind:"file",id:E.inbox.id});await dbPut("meta",{key:"trash",items:S.trash});
        S.inbox=S.inbox.filter(x=>x.id!==E.inbox.id);updateInboxN();scheduleSync()}
      closeSheet();toast(E.inbox?"Scan in den Papierkorb gelegt":"Brief verworfen")}});
}
function findDuplicate(d){return live().find(x=>x.id!==d.id&&x.letterDate&&x.letterDate===d.letterDate&&fold(x.sender)===fold(d.sender)&&(fold(x.subject)===fold(d.subject)||(x.ref&&x.ref===d.ref)))}
async function editorClick(e){
  const b=e.target.closest("[data-act]");if(!b)return;const E=S.edit;
  switch(b.dataset.act){
    case "zoom":return openViewer(E.mode==="new"?(E.input?.images?.length?{images:E.input.images}:{blob:E.input?.file||E.pdf}):{doc:E.doc});
    case "cancel":if(E.mode==="new"&&!confirm(E.inbox?"Abbrechen? Der Scan bleibt im Eingang.":"Brief verwerfen?"))return;closeSheet();return;
    case "tagdel":readForm();E.doc.tags.splice(+b.dataset.i,1);return drawEditor();
    case "tagadd":readForm();E.doc.tags.push(b.dataset.t);return drawEditor();
    case "st":readForm();E.doc.status=b.dataset.s;return drawEditor();
    case "resum":readForm();E.doc.summary=summaryFromFields(E.doc);return drawEditor();
    case "reparse":{readForm();const p=Letter.parseLetter(E.doc.text,parseCtx());applyParsed(p,true);drawEditor();setStatus("Felder aus dem Text neu gelesen.");return}
    case "save":{
      addTagFromInput();readForm();const d=E.doc;
      if(E.ocrBusy&&!confirm("Die Texterkennung läuft noch. Trotzdem speichern? Der Text fehlt dann für die Suche."))return;
      if(!d.sender&&!d.subject){setStatus("Bitte mindestens Absender oder Betreff angeben.",true);return}
      if(!d.category)d.category=catNames()[catNames().length-1];
      if(d.deadline&&!d.deadlineKind)d.deadlineKind="Frist";
      if(E.mode==="new"&&!E.dupOk){const dup=findDuplicate(d);if(dup)return showDup(dup)}
      b.disabled=true;
      if(E.mode==="new"){
        d.fileId=await storeFile(E.pdf,fileName(d));
        if(E.thumb)d.thumbId=await storeFile(E.thumb,"vorschau.jpg");
        if(E.inbox){const f=E.inbox;d.driveId=f.id;d.url=f.webViewLink||`https://drive.google.com/file/d/${f.id}/view`;d.folder=S.settings.driveInboxId;d.name=f.name;
          S.inbox=S.inbox.filter(x=>x.id!==f.id);updateInboxN()}
      }
      d.updatedAt=new Date().toISOString();
      await dbPut("docs",d);
      const i=S.docs.findIndex(x=>x.id===d.id);if(i>=0)S.docs[i]=d;else S.docs.push(d);
      closeSheet();render();toast(E.mode==="new"?"Brief gespeichert":"Gespeichert");scheduleSync();
      if(E.mode==="new"&&S.settings.calOn&&d.deadline&&!S.settings.driveLinked)toast("Für die Kalender-Erinnerung zuerst mit Google verbinden");
      return;
    }
  }
}

/* ================= Ansicht ================= */
async function openView(id){
  const d=S.docs.find(x=>x.id===id);if(!d)return;
  S.edit={mode:"view",id,urls:[]};
  const u=await thumbUrl(d);const i=dueInfo(d);
  const kv=[["Briefdatum",dfmt(d.letterDate)],["Kategorie",d.category],[d.refLabel||"Aktenzeichen",d.ref],["Betrag",d.amount!=null?eur(d.amount):""],
    ["Frist",d.deadline?`${dfmt(d.deadline)} (${esc(d.deadlineKind||"Frist")})${i?` · ${i.text}`:""}${d.calId?" · im Kalender":""}`:""],["Seiten",d.pages||""],["Notiz",d.note],
    ["Ablage",d.driveId?`<a href="${esc(d.url)}" target="_blank" rel="noopener">Google Drive</a> · ${esc(d.category)} / ${esc(docDate(d).slice(0,4))}`:(S.settings.driveLinked?"wird hochgeladen …":"nur auf diesem Handy")]]
    .filter(([,v])=>v!==""&&v!=null);
  sheet(d.sender||"Dokument",`
    <div class="sec hero"><div class="snd">${esc(d.sender||"")}</div><div class="sbj">${esc(d.subject||"Ohne Betreff")}</div>
      ${(d.tags||[]).length?`<div class="btnrow" style="gap:6px">${d.tags.map(t=>`<button type="button" class="tag" style="border:0" data-act="tagsearch" data-t="${esc(t)}">${esc(t)}</button>`).join("")}</div>`:""}</div>
    <div class="sec"><h3>Status</h3><div class="seg">${Object.entries(STATUS).map(([k,l])=>`<button type="button" class="${k}" data-act="st" data-s="${k}" aria-pressed="${d.status===k}">${l}</button>`).join("")}</div></div>
    ${d.summary?`<div class="sec"><h3>Kurzinfo</h3><div class="summary">${esc(d.summary)}</div></div>`:""}
    <div class="sec"><div class="kv">${kv.map(([k,v])=>`<span class="k">${esc(k)}</span><span class="v">${k==="Ablage"||k==="Frist"?v:esc(v)}</span>`).join("")}</div></div>
    ${(d.attachments||[]).length?`<div class="sec"><h3>Weitere Anhänge</h3>${d.attachments.map(a=>`<a class="btn link" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a>`).join("")}</div>`:""}
    ${u?`<div class="sec"><button type="button" class="zoomable" data-act="open" aria-label="Dokument groß anzeigen"><img class="thumb" src="${u}" alt="Erste Seite"><span class="zl"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M11 8v6M8 11h6"/></svg>Vergrößern</span></button></div>`:""}
    <div class="sec"><div class="btnrow"><button type="button" class="btn primary" data-act="open">Dokument öffnen</button><button type="button" class="btn" data-act="share">Teilen</button>${d.text?`<button type="button" class="btn" data-act="copytext">Text kopieren</button>`:""}<button type="button" class="btn" data-act="edit">Bearbeiten</button></div></div>
    ${d.text?`<div class="sec"><details><summary class="status">Erkannter Text</summary><div class="status" style="white-space:pre-wrap;margin-top:8px;font-size:12.5px;user-select:text;-webkit-user-select:text">${esc(d.text)}</div></details></div>`:""}
    <div class="sec"><div class="btnrow"><button type="button" class="btn danger" data-act="del">Löschen</button></div></div>
  `,`<button type="button" class="btn" data-act="close">Schließen</button>`);
  $("#scrim").addEventListener("click",async e=>{
    const b=e.target.closest("[data-act]");if(!b)return;
    switch(b.dataset.act){
      case "close":return closeSheet();
      case "open":return openViewer({doc:d});
      case "share":return shareDoc(d);
      case "copytext":return copyText(d.text);
      case "edit":return openEdit(d);
      case "tagsearch":closeSheet();$("#q").value=b.dataset.t;$("#qClear").hidden=false;S.q=b.dataset.t;return render();
      case "st":d.status=b.dataset.s;d.updatedAt=new Date().toISOString();await dbPut("docs",d);render();scheduleSync();return openView(d.id);
      case "del":{
        if(!confirm("Dokument löschen? Die Datei in Google Drive kommt in den Papierkorb."))return;
        await deleteDocs([d]);
        closeSheet();render();toast("Gelöscht");scheduleSync();return;
      }
    }
  });
}

/* ================= Löschen (einzeln und mehrere) ================= */
async function deleteDocs(list){
  const now=new Date().toISOString(),ids=new Set(list.map(d=>d.id));
  for(const d of list){
    S.deleted[d.id]=now;
    if(d.driveId)S.trash.push({kind:"file",id:d.driveId});for(const a of d.attachments||[])if(a.driveId)S.trash.push({kind:"file",id:a.driveId});if(d.calId)S.trash.push({kind:"cal",id:d.calId});
    await dbDel("docs",d.id);
    for(const fid of [d.fileId,d.thumbId])if(fid)await dbDel("files",fid).catch(()=>{});
  }
  await dbPut("meta",{key:"deleted",items:S.deleted});
  await dbPut("meta",{key:"trash",items:S.trash});
  S.docs=S.docs.filter(x=>!ids.has(x.id));
}

/* ================= Mehrfachauswahl ================= */
function startSel(id){
  if(S.sel)return;S.sel=new Set(id?[id]:[]);
  try{navigator.vibrate?.(25)}catch{}
  try{history.pushState({sel:1},"")}catch{}
  document.body.classList.add("selmode");render();
}
function endSel(fromPop){
  if(!S.sel)return;S.sel=null;document.body.classList.remove("selmode");render();
  if(!fromPop&&history.state?.sel)history.back();
}
function toggleSel(id){if(!S.sel)return;if(S.sel.has(id))S.sel.delete(id);else S.sel.add(id);render()}
function selDocs(){return S.sel?live().filter(d=>S.sel.has(d.id)):[]}
function updateSelBar(){
  const bar=$("#selBar"),on=!!S.sel;bar.hidden=!on;$("#btnAdd").hidden=on;if(!on)return;
  const n=S.sel.size;$("#selCount").textContent=`${n} ausgewählt`;
  const allOn=S.shown.length>0&&S.shown.every(id=>S.sel.has(id));
  $("#selAll").textContent=allOn?"Keine":"Alle";
  bar.querySelectorAll(".selacts .btn").forEach(b=>b.disabled=!n);
}
const nBriefe=n=>`${n} Brief${n===1?"":"e"}`;
$("#selBar").addEventListener("click",async e=>{
  const b=e.target.closest("[data-sel]");if(!b||!S.sel)return;
  switch(b.dataset.sel){
    case "cancel":return endSel();
    case "all":{const allOn=S.shown.every(id=>S.sel.has(id));S.shown.forEach(id=>allOn?S.sel.delete(id):S.sel.add(id));return render()}
    case "status":return bulkStatus();
    case "cat":return bulkCategory();
    case "share":return bulkShare();
    case "del":{
      const list=selDocs();if(!list.length)return;
      if(!confirm(`${nBriefe(list.length)} löschen? Die Dateien in Google Drive kommen in den Papierkorb.`))return;
      await deleteDocs(list);endSel();render();toast(`${nBriefe(list.length)} gelöscht`);scheduleSync();return;
    }
  }
});
async function bulkApply(fn,msg){
  const list=selDocs(),now=new Date().toISOString();
  for(const d of list){fn(d);d.updatedAt=now;await dbPut("docs",d)}
  closeSheet();endSel();render();toast(msg(list.length));scheduleSync();
}
function bulkStatus(){
  const n=S.sel.size;S.edit={mode:"bulk",urls:[]};
  sheet(`Status für ${nBriefe(n)}`,`<div class="sec"><div class="seg">${Object.entries(STATUS).map(([k,l])=>`<button type="button" class="${k}" data-act="bst" data-s="${k}">${l}</button>`).join("")}</div></div>`,
    `<button type="button" class="btn" data-act="close">Abbrechen</button>`);
  $("#scrim").addEventListener("click",e=>{const b=e.target.closest("[data-act]");if(!b)return;
    if(b.dataset.act==="close")return closeSheet();
    if(b.dataset.act==="bst"){const s=b.dataset.s;b.disabled=true;return bulkApply(d=>{d.status=s},k=>`${nBriefe(k)}: ${STATUS[s]}`)}});
}
function bulkCategory(){
  const n=S.sel.size;
  chooseCategory(`Kategorie für ${nBriefe(n)}`,c=>bulkApply(d=>{d.category=c},k=>`${nBriefe(k)} nach „${c}“ verschoben`),
    S.settings.driveLinked?"Die PDFs werden in Google Drive in den passenden Ordner verschoben.":"");
}
/* ---- Teilen: einzelne PDFs oder ein zusammengefasstes PDF (wird auf dem Handy erzeugt) ---- */
const PDFLIB="https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
async function mergePdfs(blobs){
  await loadLib(PDFLIB,()=>!!window.PDFLib);
  const out=await PDFLib.PDFDocument.create();
  for(const b of blobs){
    const pdf=(b.type||"").startsWith("image/")?await toPdf(b):b;
    const src=await PDFLib.PDFDocument.load(await pdf.arrayBuffer(),{ignoreEncryption:true});
    (await out.copyPages(src,src.getPageIndices())).forEach(p=>out.addPage(p));
  }
  return new Blob([await out.save()],{type:"application/pdf"});
}
async function shareFiles(files,title){
  if(navigator.canShare?.({files})){await navigator.share({files,title});return}
  for(const f of files){const u=URL.createObjectURL(f);const a=document.createElement("a");a.href=u;a.download=f.name;a.click();setTimeout(()=>URL.revokeObjectURL(u),5000)}
}
function bulkShare(){
  const list=selDocs().sort((a,b)=>docDate(a).localeCompare(docDate(b))),n=list.length;if(!n)return;
  S.edit={mode:"bulk",urls:[]};let ready=null;
  sheet(`${nBriefe(n)} teilen`,`<div class="sec"><div class="optlist">
      <button type="button" class="btn" data-act="mode" data-m="single">Einzelne PDFs<small>Jeder Brief bleibt eine eigene Datei.</small></button>
      <button type="button" class="btn" data-act="mode" data-m="merge">Ein zusammengefasstes PDF<small>Alle Briefe hintereinander, nach Datum sortiert.</small></button>
    </div><div id="edStatus" class="status"></div>
    <div class="btnrow" id="shareGoRow" hidden><button type="button" class="btn primary" data-act="go">Jetzt teilen</button></div></div>`,
    `<button type="button" class="btn" data-act="close">Abbrechen</button>`);
  const go=async()=>{
    try{await shareFiles(ready.files,ready.title);closeSheet();endSel();if(ready.miss)toast(`${ready.miss} Datei${ready.miss===1?"":"en"} nicht verfügbar und ausgelassen`)}
    catch(err){if(err?.name==="AbortError")return;$("#shareGoRow").hidden=false;setStatus("Bereit. Tippe auf „Jetzt teilen“.")}
  };
  $("#scrim").addEventListener("click",async e=>{const b=e.target.closest("[data-act]");if(!b)return;
    if(b.dataset.act==="close")return closeSheet();
    if(b.dataset.act==="go"&&ready)return go();
    if(b.dataset.act!=="mode"||S.edit?.busy)return;
    S.edit.busy=true;$("#shareGoRow").hidden=true;ready=null;
    $("#scrim").querySelectorAll("[data-act=mode]").forEach(x=>x.disabled=true);
    try{
      const blobs=[],used=new Set(),files=[];let miss=0;
      for(let i=0;i<n;i++){
        setStatus(`Datei ${i+1} von ${n} wird geladen …`);
        const bl=await docBlob(list[i]).catch(()=>null);if(!bl){miss++;continue}
        blobs.push({d:list[i],bl});
      }
      if(!blobs.length){setStatus("Keine der Dateien ist verfügbar. Sie sind nicht auf diesem Handy und Google Drive ist nicht verbunden.",true);return}
      if(b.dataset.m==="merge"){
        setStatus("PDF wird zusammengefasst …");
        const m=await mergePdfs(blobs.map(x=>x.bl));
        files.push(new File([m],`Dokumente_${today()}_${blobs.length}_Briefe.pdf`,{type:"application/pdf"}));
      }else for(const {d,bl} of blobs){
        let name=d.name||fileName(d),k=2;while(used.has(name))name=name.replace(/(_\d+)?\.pdf$/i,`_${k++}.pdf`);used.add(name);
        files.push(new File([bl],name,{type:bl.type||"application/pdf"}));
      }
      ready={files,title:nBriefe(blobs.length),miss};
      setStatus(miss?`${miss} Datei${miss===1?"":"en"} nicht verfügbar und ausgelassen.`:"",!!miss);
      await go();
    }catch(err){setStatus(b.dataset.m==="merge"?"Zusammenfassen nicht möglich (offline?). Einzelne PDFs gehen weiterhin.":"Teilen nicht möglich.",true)}
    finally{if(S.edit)S.edit.busy=false;$("#scrim")?.querySelectorAll("[data-act=mode]").forEach(x=>x.disabled=false)}
  });
}
window.addEventListener("popstate",()=>{if(S.sel&&!history.state?.sel)endSel(true)});
