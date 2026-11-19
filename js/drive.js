// Google Drive, Kategorien, Eingang, Kalender, Abgleich
"use strict";
/* ================= Google Drive und Kalender ================= */
const GOOGLE_CLIENT_ID="592336920931-5s1klnrs64841o02016jk7mknm248rdf.apps.googleusercontent.com";
// Voller Drive-Zugriff: nötig, um Scans aus „Dokumente/0 Eingang“ und selbst angelegte Kategorie-Ordner zu sehen
const DRIVE_SCOPE="https://www.googleapis.com/auth/drive",CAL_SCOPE="https://www.googleapis.com/auth/calendar.events";
// Nur für den einmaligen Import vorhandener Dateien: voller Drive-Lesezugriff und Gmail lesen
const DRIVE_FULL="https://www.googleapis.com/auth/drive",GMAIL_RO="https://www.googleapis.com/auth/gmail.readonly";
const GMAIL="https://gmail.googleapis.com/gmail/v1/users/me";
const API="https://www.googleapis.com/drive/v3/files",UPLOAD="https://www.googleapis.com/upload/drive/v3/files",CAL="https://www.googleapis.com/calendar/v3/calendars/primary/events";
const DATA_NAME="dokumente-daten.json",FOLDER_NAME="Dokumente",INBOX_NAME="0 Eingang",NOCAT=new Set([INBOX_NAME,"Eingang","_App-Daten"]);
const G={token:null,exp:0,busy:false,dirty:false,last:null,err:null,timer:null,calErr:false};
const LOCAL_KEYS=["metaBackup","driveDataMd5","lastUpHash","driveInboxId","driveLinked","lastBackup","driveFolderId","driveDataId","driveAppId","driveFolderMap","driveSnapId","lastSnapshot","calOn","importMode","lastImport"];
try{const t=JSON.parse(localStorage.getItem("gtok")||"null");if(t&&t.exp>Date.now()){G.token=t.token;G.exp=t.exp}}catch{}
const tokenValid=()=>!!G.token&&Date.now()<G.exp-60000;
const REDIRECT_URI=new URL("./",location.href).href;
function glog(msg){try{const l=JSON.parse(localStorage.getItem("glog")||"[]");l.push(new Date().toLocaleTimeString("de-DE")+" "+msg);localStorage.setItem("glog",JSON.stringify(l.slice(-15)))}catch{}}
function connectDrive(silent){
  const state=uid();
  glog((silent?"Stille ":"")+"Anmeldung gestartet");
  try{localStorage.setItem("gstate",JSON.stringify({state,silent:!!silent}))}catch{}
  const p=new URLSearchParams({client_id:GOOGLE_CLIENT_ID,redirect_uri:REDIRECT_URI,response_type:"token",scope:[S.settings.importMode?DRIVE_FULL+" "+GMAIL_RO:DRIVE_SCOPE,S.settings.calOn?CAL_SCOPE:""].filter(Boolean).join(" "),include_granted_scopes:"true",state});
  if(silent)p.set("prompt","none");
  location.href="https://accounts.google.com/o/oauth2/v2/auth?"+p.toString();
}
function readAuthRedirect(){
  if(!location.hash||!/access_token=|error=/.test(location.hash))return null;
  const h=new URLSearchParams(location.hash.slice(1));
  history.replaceState(null,"",location.pathname+location.search);
  let saved=null;try{saved=JSON.parse(localStorage.getItem("gstate")||"null");localStorage.removeItem("gstate")}catch{}
  if(h.get("error")){glog("Google meldet: "+h.get("error"));return {error:h.get("error"),silent:!!saved?.silent}}
  if(saved&&h.get("state")!==saved.state){glog("Rückkehr mit falscher Kennung");return {error:"state"}}
  glog("Rückkehr von Google: Zugang erhalten");
  return {token:h.get("access_token"),expires:+h.get("expires_in")||3600,scope:h.get("scope")||""};
}
const AUTH=readAuthRedirect();
if(AUTH?.token){G.token=AUTH.token;G.exp=Date.now()+AUTH.expires*1000;try{localStorage.setItem("gtok",JSON.stringify({token:G.token,exp:G.exp}));localStorage.setItem("gscope",AUTH.scope||"")}catch{}}
const hasDriveFull=()=>{try{return /auth\/drive(\s|$)/.test(localStorage.getItem("gscope")||"")}catch{return false}};
const fullScope=()=>{try{return /auth\/drive(\s|$)/.test(localStorage.getItem("gscope")||"")&&/gmail\.readonly/.test(localStorage.getItem("gscope")||"")}catch{return false}};
async function gfetch(url,opts={}){
  // Bis zu 3 Versuche: „Failed to fetch“ (kurz kein Netz, Drosselung ohne CORS-Kopf), 429, 5xx und 403 wegen Rate-Limit
  let r;for(let k=0;;k++){
    try{r=await fetch(url,{...opts,headers:{...(opts.headers||{}),Authorization:"Bearer "+G.token}})}
    catch(e){if(k<2){await new Promise(z=>setTimeout(z,1500*(k+1)**2));continue}throw e}
    if(k<2&&(r.status===429||r.status>=500||(r.status===403&&/rate ?limit/i.test(await r.clone().text().catch(()=>"")))))
      {await new Promise(z=>setTimeout(z,1500*(k+1)**2));continue}
    break}
  if(r.status===401){G.token=null;try{localStorage.removeItem("gtok")}catch{};const e=new Error("auth");e.code="auth";throw e}
  if(!r.ok){let t="";try{t=(await r.text()).replace(/\s+/g," ").slice(0,160)}catch{}
    glog("Google-Fehler "+r.status+": "+t);const e=new Error("google "+r.status);e.code=r.status===404||r.status===410?"gone":r.status===403?"forbidden":"fail";throw e}
  return r;
}
const q=s=>encodeURIComponent(s);
const qv=s=>String(s).replace(/\\/g,"\\\\").replace(/'/g,"\\'");
async function findOrCreateFolder(name,parent){
  let query=`name='${qv(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;if(parent)query+=` and '${parent}' in parents`;
  const r=await (await gfetch(`${API}?q=${q(query)}&fields=files(id)&spaces=drive`)).json();
  if(r.files?.length)return r.files[0].id;
  const c=await (await gfetch(`${API}?fields=id`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,mimeType:"application/vnd.google-apps.folder",...(parent?{parents:[parent]}:{})})})).json();
  return c.id;
}
async function findFile(name,parent){
  const r=await (await gfetch(`${API}?q=${q(`name='${qv(name)}' and '${parent}' in parents and trashed=false`)}&fields=files(id)`)).json();
  return r.files?.[0]?.id||null;
}
async function moveFile(id,target,name){
  const meta=await (await gfetch(`${API}/${id}?fields=parents`)).json();
  const remove=(meta.parents||[]).filter(p=>p!==target).join(",");
  let url=`${API}/${id}?fields=id,webViewLink&addParents=${target}`;if(remove)url+=`&removeParents=${remove}`;
  return (await gfetch(url,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(name?{name}:{})})).json();
}
async function ensureFolders(){
  const s=S.settings;let changed=false;
  if(!s.driveFolderId){s.driveFolderId=await findOrCreateFolder(FOLDER_NAME);changed=true}
  if(!s.driveAppId){s.driveAppId=await findOrCreateFolder("_App-Daten",s.driveFolderId);changed=true}
  if(!s.driveInboxId&&hasDriveFull()){
    const old=await (await gfetch(`${API}?q=${q(`name='Eingang' and '${s.driveFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&fields=files(id)`)).json();
    if(old.files?.[0]?.id){s.driveInboxId=old.files[0].id;await gfetch(`${API}/${s.driveInboxId}?fields=id`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:INBOX_NAME})})}
    else s.driveInboxId=await findOrCreateFolder(INBOX_NAME,s.driveFolderId);
    changed=true}
  if(!s.driveDataId){const id=await findFile(DATA_NAME,s.driveAppId);if(id){s.driveDataId=id;changed=true}}
  if(changed)await dbPut("meta",{key:"settings",...s});
}
async function ensurePath(parts){
  const s=S.settings;s.driveFolderMap=s.driveFolderMap||{};
  let parent=s.driveFolderId,key="";
  for(const p of parts){key+="/"+p;
    if(!s.driveFolderMap[key]){s.driveFolderMap[key]=await findOrCreateFolder(p,parent);await dbPut("meta",{key:"settings",...s})}
    parent=s.driveFolderMap[key];}
  return parent;
}
const cleanName=s=>String(s||"").replace(/[\\/:*?"<>|#%]+/g," ").replace(/\s+/g,"_").replace(/_+/g,"_").replace(/^_|_$/g,"").slice(0,50);
const folderName=c=>String(c||"Sonstiges").replace(/\//g,"-").replace(/[\\:*?"<>|#%]+/g," ").trim();
function fileName(d){return [docDate(d),cleanName(d.sender||"Absender"),cleanName(d.subject||"Brief")].join("_")+".pdf"}
const wantedFolder=d=>ensurePath([folderName(d.category),docDate(d).slice(0,4)]);
async function uploadMultipart(meta,blob,fileId){
  const b="b"+uid();
  const body=new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${blob.type||"application/octet-stream"}\r\n\r\n`,blob,`\r\n--${b}--`]);
  const url=fileId?`${UPLOAD}/${fileId}?uploadType=multipart&fields=id,webViewLink,md5Checksum`:`${UPLOAD}?uploadType=multipart&fields=id,webViewLink,md5Checksum`;
  return (await gfetch(url,{method:fileId?"PATCH":"POST",headers:{"Content-Type":`multipart/related; boundary=${b}`},body})).json();
}
// Schneller Prüfwert (FNV-1a), um unveränderte Index-Daten nicht erneut hochzuladen
function hashStr(t){let h=2166136261;for(let i=0;i<t.length;i++){h^=t.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(36)+"."+t.length}
/* ---- Angaben direkt an der Datei in Drive (Umbau Schritt 2): versteckte App-Felder + Kurzinfo als Beschreibung ---- */
// Drive erlaubt je Feld höchstens 124 Bytes für Name und Wert zusammen
function propFit(k,v){v=String(v??"");const enc=new TextEncoder();while(v&&enc.encode(k+v).length>124)v=v.slice(0,-1);return v}
function driveMeta(d){
  const p={dk:d.id,v:"1",sender:d.sender,subject:d.subject,date:d.letterDate,ref:d.ref,refLabel:d.refLabel,amount:d.amount!=null?String(d.amount):"",
    deadline:d.deadline,dlKind:d.deadlineKind,status:d.status,tags:(d.tags||[]).join(", "),note:d.note};
  const appProperties={};for(const [k,v] of Object.entries(p))appProperties[k]=propFit(k,v);
  return {appProperties,description:String(d.summary||[d.sender,d.subject].filter(Boolean).join(" · ")).slice(0,4000)};
}
async function writeDriveMeta(map){
  const todo=[...map.values()].filter(d=>d.driveId&&d.metaHash!==hashStr(JSON.stringify(driveMeta(d))));
  if(!todo.length)return;
  // Vor dem ersten Schreiben einmal eine vollständige Sicherung ablegen
  if(!S.settings.metaBackup){
    if(!S.settings.driveSnapId)S.settings.driveSnapId=await findOrCreateFolder("Sicherungen",S.settings.driveAppId);
    await uploadMultipart({name:`Sicherung_vor-Drive-Angaben_${today()}.json`,parents:[S.settings.driveSnapId]},new Blob([JSON.stringify(exportData())],{type:"application/json"}));
    S.settings.metaBackup=today();await dbPut("meta",{key:"settings",...S.settings});glog("Sicherung vor Drive-Angaben erstellt");
  }
  let n=0;const show=todo.length>5;
  for(const d of todo){
    if(show&&typeof importStatus==="function")importStatus(`Angaben in Drive speichern: ${++n} von ${todo.length}`);
    const m=driveMeta(d);
    try{await gfetch(`${API}/${d.driveId}?fields=id`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(m)});
      d.metaHash=hashStr(JSON.stringify(m));await dbPut("docs",d)}
    catch(e){if(e.code==="auth")throw e;if(e.code==="gone"){d.metaHash=hashStr(JSON.stringify(m));continue}glog("Angaben nicht gespeichert ("+(e.code||e.message)+"): "+(d.name||d.driveId))}
  }
  if(show&&typeof importStatus==="function")importStatus("");
  if(show)glog(`Angaben an ${n} Dateien in Drive gespeichert`);
}
/* ---- Umbau Schritt 3: Ort in Drive übernehmen ---- */
// Wo die App den Brief haben will; ändert sich nur durch Änderungen in der App (Kategorie, Datum, Absender, Betreff)
const placeKey=d=>[folderName(d.category),docDate(d).slice(0,4),fileName(d)].join("/");
async function adoptDriveState(map){
  const s=S.settings;if(!hasDriveFull()||!s.driveFolderId)return;
  await refreshCats();
  // Alle Dateien der App mit Ort und Papierkorb-Status (App-Feld v=1, seit Schritt 2 an jeder Datei)
  const files=[];let pt="";
  do{const r=await (await gfetch(`${API}?q=${q("appProperties has { key='v' and value='1' }")}&fields=nextPageToken,files(id,name,parents,trashed)&pageSize=1000${pt?"&pageToken="+q(pt):""}`)).json();
    files.push(...(r.files||[]));pt=r.nextPageToken||""}while(pt);
  if(!files.length)return;
  const byId=new Map(files.map(f=>[f.id,f]));
  // Ordner -> Kategorie: Kategorie-Ordner selbst und ihre Unterordner (Jahre)
  const catOf=new Map();
  for(const [k,id] of Object.entries(s.driveFolderMap||{})){const p=k.split("/").filter(Boolean);if(p.length===1)catOf.set(id,(s.categories.find(c=>folderName(c.name)===p[0])||{name:p[0]}).name)}
  const cids=[...catOf.keys()];
  for(let i=0;i<cids.length;i+=40){
    const qq=`mimeType='application/vnd.google-apps.folder' and trashed=false and (${cids.slice(i,i+40).map(id=>`'${id}' in parents`).join(" or ")})`;
    const r=await (await gfetch(`${API}?q=${q(qq)}&fields=files(id,parents)&pageSize=1000`)).json();
    for(const f of r.files||[])if(!catOf.has(f.id))catOf.set(f.id,catOf.get((f.parents||[]).find(p=>catOf.has(p))))}
  const now=new Date().toISOString();let moved=0,gone=0;
  for(const d of [...map.values()]){
    const f=d.driveId&&byId.get(d.driveId);if(!f)continue;
    if(f.trashed){ // in Drive gelöscht: aus der App nehmen (Datei bleibt im Drive-Papierkorb)
      S.deleted[d.id]=now;map.delete(d.id);await dbDel("docs",d.id);gone++;glog("In Drive gelöscht, aus der App entfernt: "+(d.name||d.id));continue}
    const par=(f.parents||[])[0];if(!par||par===s.driveInboxId)continue;
    const local=d.placeKey!==undefined&&d.placeKey!==placeKey(d); // in der App geändert, noch nicht verschoben: App gewinnt
    if(par!==d.folder&&!local){
      d.folder=par;if(catOf.get(par))d.category=catOf.get(par);d.name=f.name;d.placeKey=placeKey(d);d.updatedAt=now;await dbPut("docs",d);moved++;
      glog("In Drive verschoben, übernommen: "+f.name+(catOf.get(par)?" -> "+catOf.get(par):""))}
    else if(f.name!==d.name&&!local){d.name=f.name;d.updatedAt=now;await dbPut("docs",d)}
  }
  if(gone)await dbPut("meta",{key:"deleted",items:S.deleted});
  if(moved||gone)toast([moved&&`${nBriefe(moved)} aus Drive übernommen`,gone&&`${nBriefe(gone)} in Drive gelöscht`].filter(Boolean).join(", "));
}
function stripLocal(d){const c=structuredClone(d);delete c.fileId;delete c.thumbId;return c}
function scheduleSync(){if(!S.settings.driveLinked)return;G.dirty=true;updateChip();clearTimeout(G.timer);G.timer=setTimeout(syncNow,1500)}

/* ---- Kategorien = Unterordner von „Dokumente“ (außer Eingang und _App-Daten) ---- */
async function refreshCats(){
  const s=S.settings;if(!s.driveFolderId||!tokenValid()||!hasDriveFull())return;
  const r=await (await gfetch(`${API}?q=${q(`'${s.driveFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&fields=files(id,name)&pageSize=200`)).json();
  const folders=(r.files||[]).filter(f=>!NOCAT.has(f.name));s.driveFolderMap=s.driveFolderMap||{};
  const before=JSON.stringify(s.categories),names=new Set(folders.map(f=>f.name));
  for(const f of folders){s.driveFolderMap["/"+f.name]=f.id;if(!s.categories.some(c=>folderName(c.name)===f.name))s.categories.push({name:f.name,keywords:[]})}
  // Kategorien ohne Ordner nur behalten, solange noch Briefe darin sind
  const used=new Set(live().map(d=>d.category));
  s.categories=s.categories.filter(c=>names.has(folderName(c.name))||used.has(c.name)).sort((a,b)=>a.name.localeCompare(b.name,"de"));
  if(JSON.stringify(s.categories)!==before){s.updatedAt=new Date().toISOString();await dbPut("meta",{key:"settings",...s})}
}
async function renameCatFolder(a,b){
  const s=S.settings,fa=folderName(a),fb=folderName(b),id=s.driveFolderMap?.["/"+fa];
  if(fa===fb||!id||!tokenValid())return;
  try{await gfetch(`${API}/${id}?fields=id`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:fb})});
    for(const k of Object.keys(s.driveFolderMap))if(k==="/"+fa||k.startsWith("/"+fa+"/")){s.driveFolderMap["/"+fb+k.slice(fa.length+1)]=s.driveFolderMap[k];delete s.driveFolderMap[k]}
    glog("Ordner umbenannt: "+fa+" -> "+fb)}
  catch(e){glog("Ordner umbenennen nicht möglich: "+fa);toast("Ordner in Drive konnte nicht umbenannt werden")}
}
async function createCategory(raw){
  const name=String(raw||"").replace(/\s+/g," ").trim();
  if(!name)throw new Error("Bitte einen Namen eingeben.");
  if(/[\\/]/.test(name))throw new Error("Bitte keinen Schrägstrich verwenden.");
  if(/[:*?"<>|#%]/.test(name))throw new Error("Bitte keine Sonderzeichen wie : * ? \" < > | # % verwenden.");
  if(NOCAT.has(name))throw new Error(`„${name}“ ist für die App reserviert.`);
  const ex=S.settings.categories.find(c=>fold(c.name)===fold(name)||fold(folderName(c.name))===fold(name));if(ex)return ex.name;
  const s=S.settings;
  if(s.driveLinked&&tokenValid()&&s.driveFolderId){s.driveFolderMap=s.driveFolderMap||{};s.driveFolderMap["/"+name]=await findOrCreateFolder(name,s.driveFolderId)}
  s.categories.push({name,keywords:[]});s.categories.sort((a,b)=>a.name.localeCompare(b.name,"de"));
  await saveSettings();return name;
}
// Auswahl „Art des Briefes?“: vorhandene Kategorien oder neue anlegen
function chooseCategory(title,onPick,note,onCancel){
  S.edit={mode:"cat",urls:[]};
  sheet(title,`<div id="edStatus" class="status" style="margin-top:10px"></div>
    <div class="sec"><div class="optlist">${catNames().map(c=>`<button type="button" class="btn" data-act="pick" data-c="${esc(c)}">${esc(c)}</button>`).join("")||`<div class="status">Noch keine Kategorie. Lege unten die erste an.</div>`}</div>
    ${note?`<div class="status">${esc(note)}</div>`:""}</div>
    <div class="sec"><h3>Neue Kategorie</h3><div class="newcat"><label class="f">Name<input id="ncName" placeholder="z. B. Kindergeld" autocomplete="off" enterkeyhint="done"></label><button type="button" class="btn primary" data-act="new">Anlegen</button></div>
    <div class="status">Wird als Ordner in „Dokumente“ in Google Drive angelegt.</div></div>`,
    `<button type="button" class="btn" data-act="close">Abbrechen</button>`);
  const go=async c=>{$("#scrim").querySelectorAll("button").forEach(x=>x.disabled=true);await onPick(c)};
  const make=async()=>{try{setStatus("Kategorie wird angelegt …");const c=await createCategory($("#ncName").value);await go(c)}
    catch(e){if(e.code==="auth"){closeSheet();return connectDrive(true)}setStatus(e.code?"Ordner in Drive konnte nicht angelegt werden.":e.message,true);$("#scrim").querySelectorAll("button").forEach(x=>x.disabled=false)}};
  $("#ncName").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();make()}});
  $("#scrim").addEventListener("click",e=>{const b=e.target.closest("[data-act]");if(!b||b.disabled)return;
    if(b.dataset.act==="close"){closeSheet();onCancel?.();return}
    if(b.dataset.act==="pick")return go(b.dataset.c);
    if(b.dataset.act==="new")return make()});
}
/* ---- Eingang: Scans aus „Dokumente/0 Eingang“ (Google-Drive-Scanner) ---- */
async function listInbox(){
  const s=S.settings;if(!s.driveLinked||!tokenValid()||!hasDriveFull())return;
  await ensureFolders();if(!s.driveInboxId)return;
  const r=await (await gfetch(`${API}?q=${q(`'${s.driveInboxId}' in parents and mimeType='application/pdf' and trashed=false`)}&fields=files(id,name,createdTime,size,webViewLink)&orderBy=createdTime desc&pageSize=100`)).json();
  if(r.files==null){s.driveInboxId=null;return}
  // Dateien, die schon zu einem Brief gehören (z. B. in Drive in den Eingang verschoben), mit Hinweis anzeigen
  const byDrive=new Map(live().filter(d=>d.driveId).map(d=>[d.driveId,d]));
  S.inbox=r.files.map(f=>({...f,known:byDrive.get(f.id)?.id||null}));updateInboxN();
}
function updateInboxN(){const n=S.inbox.length,e=$("#inboxN");if(!e)return;e.hidden=!n;e.textContent=n;$("#btnAdd").setAttribute("aria-label",n?`Eingang, ${n} neue Scans`:"Eingang")}
const INBOX_HELP="Brief mit dem Google-Drive-Scanner scannen und im Ordner „Dokumente/0 Eingang“ speichern.";
async function openInbox(){
  const s=S.settings;S.edit={mode:"inbox",urls:[]};
  const msg=(t,btn,act)=>{sheet("Eingang",`<div class="sec"><p class="status" style="margin:0">${t}</p>${btn?`<div class="btnrow"><button type="button" class="btn primary" data-act="${act}">${btn}</button></div>`:""}</div>`,`<button type="button" class="btn" data-act="close">Schließen</button>`);
    $("#scrim").addEventListener("click",e=>{const b=e.target.closest("[data-act]");if(!b)return;closeSheet();if(b.dataset.act==="link")connectDrive(false);if(b.dataset.act==="relog")connectDrive(true)})};
  if(!s.driveLinked)return msg("Für den Eingang zuerst mit Google Drive verbinden. "+INBOX_HELP,"Mit Google Drive verbinden","link");
  if(!hasDriveFull())return msg("Die App braucht jetzt Zugriff auf dein Google Drive, um Scans aus „Dokumente/0 Eingang“ und deine Kategorie-Ordner zu lesen. Google fragt einmal nach.","Zugriff erlauben","link");
  if(!tokenValid())return msg("Die Anmeldung bei Google ist abgelaufen.","Neu anmelden","relog");
  const draw=(status,err)=>{
    sheet("Eingang",`<div id="edStatus" class="status${err?" err":""}" style="margin-top:10px">${esc(status||"")}</div>
      <div class="sec">${S.inbox.length?`<div class="optlist">${S.inbox.map(f=>{const k=f.known&&S.docs.find(d=>d.id===f.known);
        return k?`<div class="btn" style="text-align:left;padding:12px 14px">${esc(f.name)}<small>Schon in der App: ${esc(k.category||"ohne Kategorie")}</small>
          <div class="btnrow" style="margin-top:8px"><button type="button" class="btn primary" data-act="back" data-id="${esc(f.id)}">Zurück in die Ablage</button></div></div>`
        :`<button type="button" class="btn" data-act="take" data-id="${esc(f.id)}">${esc(f.name)}<small>gescannt am ${dfmt((f.createdTime||"").slice(0,10))}${+f.size?` · ${Math.max(1,Math.round(f.size/1024))} KB`:""}</small></button>`}).join("")}</div>`
        :`<p class="status" style="margin:0">Keine neuen Scans. ${INBOX_HELP}</p>`}</div>`,
      `<button type="button" class="btn" data-act="close">Schließen</button><button type="button" class="btn" data-act="reload">Aktualisieren</button>`);
    $("#scrim").addEventListener("click",async e=>{const b=e.target.closest("[data-act]");if(!b)return;
      if(b.dataset.act==="close")return closeSheet();
      if(b.dataset.act==="reload")return load();
      if(b.dataset.act==="take"){const f=S.inbox.find(x=>x.id===b.dataset.id);if(f)takeInbox(f)}
      if(b.dataset.act==="back"){const f=S.inbox.find(x=>x.id===b.dataset.id),d=f&&S.docs.find(x=>x.id===f.known);if(!d)return;
        // Ordner als „Eingang“ merken: der nächste Abgleich verschiebt die Datei zurück nach Kategorie/Jahr
        d.folder=S.settings.driveInboxId;d.placeKey=null;d.updatedAt=new Date().toISOString();await dbPut("docs",d);
        S.inbox=S.inbox.filter(x=>x.id!==f.id);updateInboxN();scheduleSync();toast("Wird zurück nach „"+(d.category||"")+"“ verschoben");draw("")}});
  };
  const load=async()=>{draw("Eingang wird gelesen …");
    try{await listInbox();if(S.edit?.mode==="inbox")draw(S.inbox.length?`${S.inbox.length} neue${S.inbox.length===1?"r":""} Scan${S.inbox.length===1?"":"s"}. Antippen zum Verarbeiten.`:"")}
    catch(e){if(e.code==="auth"){closeSheet();return connectDrive(true)}if(S.edit?.mode==="inbox")draw("Eingang konnte nicht gelesen werden. Bitte später noch einmal versuchen.",true)}};
  load();
}
async function takeInbox(f){
  try{await refreshCats()}catch(e){if(e.code==="auth"){closeSheet();return connectDrive(true)}}
  chooseCategory("Art des Briefes?",async c=>{
    setStatus("Scan wird geladen …");
    try{const blob=await (await gfetch(`${API}/${f.id}?alt=media`)).blob();
      closeSheet();openNew({file:new File([blob],f.name,{type:"application/pdf"})},{category:c,inbox:f});}
    catch(e){if(e.code==="auth"){closeSheet();return connectDrive(true)}
      setStatus(e.code==="gone"?"Der Scan ist nicht mehr im Eingang.":"Scan konnte nicht geladen werden.",true);
      $("#scrim")?.querySelectorAll("button").forEach(x=>x.disabled=false);
      if(e.code==="gone"){S.inbox=S.inbox.filter(x=>x.id!==f.id);updateInboxN()}}
  },"",()=>openInbox());
}

/* ---- Kalender: Frist als ganztägiger Termin, Erinnerung um 9 Uhr x Tage vorher und am Vortag ---- */
function calWanted(d){return S.settings.calOn&&d.deadline&&d.status!=="erledigt"}
function calKey(d){return [d.deadline,d.deadlineKind,d.sender,d.subject,S.settings.remindDays,d.url||""].join("|")}
function calBody(d){
  const end=Letter.addDays(d.deadline,1),n=Math.max(1,Math.min(27,S.settings.remindDays||3));
  const mins=[...new Set([(n-1)*1440+900,900])];
  return {summary:`${d.deadlineKind||"Frist"}: ${d.sender||""}${d.subject?" – "+d.subject:""}`.slice(0,200),
    description:[d.summary,d.url?"Dokument: "+d.url:"","Eingetragen von der App „Dokumente“."].filter(Boolean).join("\n\n"),
    start:{date:d.deadline},end:{date:end},transparency:"transparent",
    reminders:{useDefault:false,overrides:mins.map(m=>({method:"popup",minutes:m}))},
    extendedProperties:{private:{dokumenteId:d.id}}};
}
async function calSync(map){
  if(!S.settings.calOn&&![...map.values()].some(d=>d.calId))return;
  try{
    for(const d of map.values()){
      if(calWanted(d)){
        const k=calKey(d);if(d.calId&&d.calKey===k)continue;
        if(d.calId){
          try{await gfetch(`${CAL}/${d.calId}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(calBody(d))})}
          catch(e){if(e.code!=="gone")throw e;d.calId=null}
        }
        if(!d.calId){const r=await (await gfetch(CAL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(calBody(d))})).json();d.calId=r.id;glog("Kalender: "+dfmt(d.deadline)+" "+(d.sender||""))}
        d.calKey=k;d.updatedAt=new Date().toISOString();
      }else if(d.calId){
        try{await gfetch(`${CAL}/${d.calId}`,{method:"DELETE"})}catch(e){if(e.code!=="gone")throw e}
        d.calId=null;d.calKey=null;d.updatedAt=new Date().toISOString();glog("Kalender-Termin entfernt: "+(d.sender||""));
      }
    }
    G.calErr=false;
  }catch(e){if(e.code==="auth")throw e;G.calErr=true;glog(e.code==="forbidden"?"Kalender: kein Zugriff – Kalender-API freigegeben und beim Verbinden erlaubt?":"Kalender nicht erreichbar")}
}
async function syncNow(){
  if(!S.settings.driveLinked)return;
  if(!tokenValid()){G.dirty=true;updateChip();return}
  if(G.busy){G.dirty=true;return}
  G.busy=true;G.dirty=false;G.err=null;updateChip();
  try{
    await ensureFolders();
    let remote=null;
    if(S.settings.driveDataId){
      try{const meta=await (await gfetch(`${API}/${S.settings.driveDataId}?fields=md5Checksum,trashed`)).json();
        if(meta.trashed){const e=new Error("gone");e.code="gone";throw e}
        // Unverändert seit unserem letzten Hochladen: Inhalt ist schon eingearbeitet
        if(!meta.md5Checksum||meta.md5Checksum!==S.settings.driveDataMd5){remote=await (await gfetch(`${API}/${S.settings.driveDataId}?alt=media`)).json();S.settings.driveDataMd5=null}}
      catch(e){if(e.code!=="gone")throw e;S.settings.driveDataId=null;S.settings.driveDataMd5=null;await ensureFolders()}
    }
    for(const [id,t] of Object.entries(remote?.deleted||{}))if(!S.deleted[id]||S.deleted[id]<t)S.deleted[id]=t;
    // Dokumente zusammenführen: neuere Änderung gewinnt, lokale Dateien bleiben
    const map=new Map(S.docs.map(d=>[d.id,d]));
    for(const r of remote?.docs||[]){
      const l=map.get(r.id);
      if(!l||(r.updatedAt||"")>(l.updatedAt||"")){const m=structuredClone(r);if(l){m.fileId=l.fileId;m.thumbId=l.thumbId}map.set(r.id,m)}
    }
    for(const [id,t] of Object.entries(S.deleted)){const d=map.get(id);if(d&&t>=(d.updatedAt||"")){map.delete(id);if(d.driveId&&!S.trash.some(x=>x.id===d.driveId))S.trash.push({kind:"file",id:d.driveId})}}
    // Was in Drive verschoben, umbenannt oder gelöscht wurde, übernehmen (Drive ist die Wahrheit)
    await adoptDriveState(map);
    // PDFs hochladen bzw. dorthin verschieben, wo die App sie haben will – nur nach Änderungen in der App
    for(const d of map.values()){
      const pk=placeKey(d);
      if(!d.driveId&&d.fileId){
        const f=await dbGet("files",d.fileId);if(!f)continue;
        const target=await wantedFolder(d),name=fileName(d);
        const up=await uploadMultipart({name,parents:[target],description:[d.sender,d.subject,(d.tags||[]).join(", ")].filter(Boolean).join(" · ")},f.blob);
        d.driveId=up.id;d.url=up.webViewLink||`https://drive.google.com/file/d/${up.id}/view`;d.folder=target;d.name=name;d.placeKey=pk;d.updatedAt=new Date().toISOString();
        await dbPut("docs",d);glog("Hochgeladen: "+name);
      }else if(d.driveId){
        let place=d.placeKey!==pk;
        if(d.placeKey===undefined){ // Altbestand: einmalig nach der bisherigen Regel prüfen
          place=d.folder!==await wantedFolder(d)||d.name!==fileName(d);
          if(!place){d.placeKey=pk;await dbPut("docs",d)}
        }
        if(place){const target=await wantedFolder(d),name=fileName(d);
          try{await moveFile(d.driveId,target,name);d.folder=target;d.name=name;d.placeKey=pk;d.updatedAt=new Date().toISOString();await dbPut("docs",d)}
          catch(e){if(e.code==="auth")throw e;glog("Verschieben nicht möglich: "+(d.name||d.driveId))}}
      }
      // Anlagen folgen dem Hauptdokument, wo immer es liegt
      if(d.driveId&&d.folder)for(const [i,a] of (d.attachments||[]).entries()){
        const an=String(d.name||fileName(d)).replace(/(\.pdf)?$/i,`_Anlage-${i+1}.pdf`);if(!a.driveId||(a.folder===d.folder&&a.dname===an))continue;
        try{await moveFile(a.driveId,d.folder,an);a.folder=d.folder;a.dname=an;d.updatedAt=new Date().toISOString();await dbPut("docs",d)}
        catch(e){if(e.code==="auth")throw e;if(e.code==="gone"){a.folder=d.folder;a.dname=an}glog("Anlage nicht verschiebbar ("+(e.code||e.message)+"): "+(a.name||a.driveId))}
      }
    }
    await writeDriveMeta(map);
    await calSync(map);
    // Gelöschte: Dateien in den Papierkorb, Termine entfernen
    for(const t of [...S.trash]){
      try{if(t.kind==="cal")await gfetch(`${CAL}/${t.id}`,{method:"DELETE"});else await gfetch(`${API}/${t.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({trashed:true})})}
      catch(e){if(e.code==="auth")throw e;if(e.code!=="gone"&&e.code!=="forbidden")continue}
      S.trash=S.trash.filter(x=>x!==t);
    }
    await dbPut("meta",{key:"trash",items:S.trash});
    if(remote?.settings&&(remote.settingsUpdatedAt||"")>(S.settings.updatedAt||"")){
      const keep=Object.fromEntries(LOCAL_KEYS.map(k=>[k,S.settings[k]]));
      S.settings={...DEFAULT_SETTINGS,...remote.settings,updatedAt:remote.settingsUpdatedAt,...keep};
    }
    const ids=new Set(map.keys());
    for(const old of S.docs)if(!ids.has(old.id))await dbDel("docs",old.id);
    for(const d of map.values())await dbPut("docs",d);
    S.docs=[...map.values()];
    await dbPut("meta",{key:"deleted",items:S.deleted});
    const data=exportData(),h=hashStr(JSON.stringify({...data,updatedAt:null}));
    if(!S.settings.driveDataId||h!==S.settings.lastUpHash||!S.settings.driveDataMd5){
      const blob=new Blob([JSON.stringify(data)],{type:"application/json"});
      const up=await uploadMultipart(S.settings.driveDataId?{}:{name:DATA_NAME,parents:[S.settings.driveAppId]},blob,S.settings.driveDataId);
      if(!S.settings.driveDataId)S.settings.driveDataId=up.id;
      S.settings.driveDataMd5=up.md5Checksum||null;S.settings.lastUpHash=h;glog("Index gespeichert");
    }
    await dailySnapshot(data);
    await dbPut("meta",{key:"settings",...S.settings});
    try{await refreshCats();await listInbox()}catch(e){if(e.code==="auth")throw e;glog("Eingang/Kategorien nicht lesbar: "+(e?.message||e))}
    checkResort();
    G.last=new Date();glog("Abgleich erfolgreich ("+S.docs.length+" Dokumente)");
  }catch(e){G.err=e.code==="auth"?"auth":"fail";G.dirty=true;glog("Abgleich fehlgeschlagen: "+(e?.message||e))}
  finally{G.busy=false;updateChip();render()}
  if(G.dirty&&!G.err)scheduleSync();
}
async function dailySnapshot(data){
  const day=today();if(S.settings.lastSnapshot===day)return;
  try{
    if(!S.settings.driveSnapId)S.settings.driveSnapId=await findOrCreateFolder("Sicherungen",S.settings.driveAppId);
    const name=`Sicherung_${day}.json`;
    if(!await findFile(name,S.settings.driveSnapId)){
      await uploadMultipart({name,parents:[S.settings.driveSnapId]},new Blob([JSON.stringify(data)],{type:"application/json"}));glog("Tagessicherung erstellt: "+name)}
    S.settings.lastSnapshot=day;
  }catch(e){if(e.code==="auth")throw e;S.settings.driveSnapId=null;glog("Tagessicherung fehlgeschlagen")}
}
function driveStatus(){
  if(!S.settings.driveLinked)return {text:"Nicht verbunden.",pending:false};
  if(G.busy)return {text:"Gleicht gerade ab …",pending:false};
  const pending=G.dirty||!!G.err;
  if(G.err==="auth"||(pending&&!tokenValid()))return {text:"Änderungen sind noch nicht in Drive. Tippe auf „Jetzt abgleichen“.",pending:true};
  if(G.err)return {text:"Der letzte Abgleich ist fehlgeschlagen. Tippe auf „Jetzt abgleichen“.",pending:true};
  if(pending)return {text:"Änderungen werden gleich abgeglichen.",pending:true};
  if(G.last)return {text:"Alles in Drive gespeichert, zuletzt um "+G.last.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})+" Uhr.",pending:false};
  return {text:"Verbunden.",pending:false};
}
function updateChip(){
  try{if(G.dirty)localStorage.setItem("gdirty","1");else localStorage.removeItem("gdirty")}catch{}
  const st=driveStatus();$("#settingsDot").hidden=!st.pending;
  const el=$("#driveStatus");if(el)el.textContent=st.text;
}
try{if(localStorage.getItem("gdirty")==="1")G.dirty=true}catch{}
async function driveBlob(driveId){if(!tokenValid()||!driveId)return null;try{return await (await gfetch(`${API}/${driveId}?alt=media`)).blob()}catch{return null}}
