// Einstellungen und Sicherung
"use strict";
/* ================= Einstellungen & Sicherung ================= */
async function saveSettings(){S.settings.updatedAt=new Date().toISOString();await dbPut("meta",{key:"settings",...S.settings});scheduleSync()}
function openSettings(){
  const s=S.settings;S.edit={mode:"settings",urls:[]};
  const catRows=`<div class="optlist">${s.categories.map((c,i)=>`<button type="button" class="btn catbtn" data-act="ren" data-i="${i}"><span>${esc(c.name)}</span><span class="c">${live().filter(d=>d.category===c.name).length}</span></button>`).join("")}</div>`;
  sheet("Einstellungen",`
    <div id="edStatus" class="status" style="margin-top:10px"></div>
    <div class="sec"><h3>Google Drive</h3>
      <p class="status" style="margin:0">${s.driveLinked
        ?"Neue Scans kommen in den Drive-Ordner „Dokumente/0 Eingang“. Verarbeitete Briefe liegen als PDF in „Dokumente“, sortiert nach Kategorie und Jahr. Jeden Tag kommt eine datierte Sicherung nach „_App-Daten/Sicherungen“."+(s.lastSnapshot?" Letzte: "+dfmt(s.lastSnapshot)+".":"")
        :"Nach dem Verbinden liegen alle Briefe als PDF im Drive-Ordner „Dokumente“."}</p>
      <p class="status" id="driveStatus" style="margin:0;font-weight:600"></p>
      <div class="btnrow">${s.driveLinked
        ?`<button type="button" class="btn primary" data-act="sync">Jetzt abgleichen</button>`
        :`<button type="button" class="btn primary" data-act="link">Mit Google Drive verbinden</button>`}</div>
</div>
    <div class="sec"><h3>Fristen</h3>
      <p class="status" style="margin:0">${s.calOn
        ?"Jede Frist steht als ganztägiger Termin in deinem Google Kalender, mit Erinnerung."+(G.calErr?" <b>Kalender ist gerade nicht erreichbar.</b>":"")
        :"Optional: Fristen als Termin mit Erinnerung in den Google Kalender eintragen. Erledigte Briefe werden dort wieder entfernt."}</p>
      <div class="grid2">${field("Erinnerung (Tage vorher)","remD",s.remindDays??3,"number","",'min="1" max="27"')}${field("„Bald fällig“ ab (Tage)","soonD",s.soonDays??14,"number","",'min="1" max="90"')}</div>
      <div class="btnrow">${s.calOn?`<button type="button" class="btn" data-act="caloff">Kalender ausschalten</button>`:`<button type="button" class="btn" data-act="calon">Google Kalender einbinden</button>`}</div></div>
    <div class="sec"><h3>Kategorien</h3>
      <p class="status" style="margin:0">Kategorien sind die Ordner in „Dokumente“ in Google Drive. Neue Kategorie beim Verarbeiten eines Scans anlegen oder direkt in Drive. Antippen zum Umbenennen, dabei wird auch der Ordner in Drive umbenannt.</p>
      ${catRows}</div>
    <div class="sec"><details><summary><h3 style="display:inline">Erweitert</h3></summary>
      <h3 style="margin-top:14px">Verlauf</h3>
      <pre class="status" style="white-space:pre-wrap;margin:6px 0 0;font-size:12px">${esc((()=>{try{return JSON.parse(localStorage.getItem("glog")||"[]").join("\n")}catch{return ""}})()||"Noch keine Einträge.")}</pre>
      <h3 style="margin-top:14px">Sicherung als Datei</h3>
      <p class="status" style="margin:0">Zusätzlich zur täglichen Sicherung in Drive. Enthält alle Angaben und den erkannten Text, ohne PDFs.${s.lastBackup?` Letzte: ${dfmt(s.lastBackup.slice(0,10))}.`:""}</p>
      <div class="btnrow"><button type="button" class="btn" data-act="backup">Sicherung erstellen</button><button type="button" class="btn" data-act="restore">Sicherung einspielen</button></div>
      ${s.driveLinked?`<h3 style="margin-top:14px">Werkzeuge</h3><div class="btnrow"><button type="button" class="btn" data-act="resort">Umsortier-Liste prüfen</button><button type="button" class="btn danger" data-act="unlink">Drive trennen</button></div>`:""}
    </details></div>
  `,`<button type="button" class="btn" data-act="close">Abbrechen</button><button type="button" class="btn primary" data-act="save">Speichern</button>`);
  updateChip();
  $("#scrim").addEventListener("click",async e=>{
    const b=e.target.closest("[data-act]");if(!b)return;
    switch(b.dataset.act){
      case "close":return closeSheet();
      case "link":closeSheet();return connectDrive();
      case "unlink":if(!confirm("Drive wirklich trennen? Die App gleicht dann nichts mehr ab."))return;S.settings.driveLinked=false;G.token=null;try{localStorage.removeItem("gtok")}catch{};await dbPut("meta",{key:"settings",...S.settings});closeSheet();render();updateChip();return toast("Drive getrennt. Die Dateien bleiben in Drive.");
      case "sync":if(!tokenValid()){closeSheet();return connectDrive(true)}await syncNow();if(S.edit?.mode==="settings")openSettings();return;
      case "resort":if(!tokenValid()){closeSheet();return connectDrive(true)}closeSheet();G.resortAsked=false;await checkResort();if(!S.edit)toast("Keine Umsortier-Liste gefunden");return;
      case "calon":collectSettings();S.settings.calOn=true;await saveSettings();closeSheet();return connectDrive(false);
      case "caloff":collectSettings();S.settings.calOn=false;await saveSettings();return openSettings();
      case "backup":return makeBackup();
      case "ren":collectSettings();return renameCategory(+b.dataset.i);
      case "restore":{const p=$("#pickBackup");p.value="";p.onchange=()=>{const f=p.files[0];if(f)restoreBackup(f)};p.click();return}
      case "save":collectSettings();await saveSettings();closeSheet();render();return toast("Gespeichert");
    }
  });
}
// Kategorie umbenennen: Ordner in Drive, Briefe und Liste
function renameCategory(i){
  const old=S.settings.categories[i]?.name;if(old==null)return;S.edit={mode:"rename",urls:[]};
  sheet("Kategorie umbenennen",`<div id="edStatus" class="status" style="margin-top:10px"></div>
    <div class="sec"><label class="f">Neuer Name<input id="rnName" value="${esc(old)}" autocomplete="off" enterkeyhint="done"></label>
    <div class="status">${live().filter(d=>d.category===old).length} Briefe. Der Ordner in Drive wird mit umbenannt.</div></div>`,
    `<button type="button" class="btn" data-act="back">Abbrechen</button><button type="button" class="btn primary" data-act="ok">Umbenennen</button>`);
  const inp=$("#rnName");inp.focus();inp.select();
  const go=async()=>{
    const nn=inp.value.replace(/\s+/g," ").trim();if(nn===old)return openSettings();
    if(!nn)return setStatus("Bitte einen Namen eingeben.",true);
    if(/[\\/:*?"<>|#%]/.test(nn))return setStatus("Bitte keine Zeichen wie / : * ? \" < > | # % verwenden.",true);
    if(NOCAT.has(nn))return setStatus(`„${nn}“ ist für die App reserviert.`,true);
    if(S.settings.categories.some((c,k)=>k!==i&&fold(c.name)===fold(nn)))return setStatus("Diese Kategorie gibt es schon.",true);
    $("#scrim").querySelectorAll("button").forEach(x=>x.disabled=true);setStatus("Wird umbenannt …");
    const ok=await renameCatFolder(old,nn);const now=new Date().toISOString();
    S.settings.categories[i].name=nn;S.settings.categories.sort((a,b)=>a.name.localeCompare(b.name,"de"));
    for(const d of S.docs)if(d.category===old){d.category=nn;if(ok)d.placeKey=placeKey(d);d.updatedAt=now;await dbPut("docs",d)}
    if(S.cat===old)S.cat=nn;
    await saveSettings();render();openSettings();toast(ok?`Umbenannt in „${nn}“`:`Umbenannt. Der Ordner wird beim nächsten Abgleich angepasst.`);
  };
  inp.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();go()}});
  $("#scrim").addEventListener("click",e=>{const b=e.target.closest("[data-act]");if(!b||b.disabled)return;if(b.dataset.act==="back")return openSettings();if(b.dataset.act==="ok")go()});
}
function collectSettings(){
  const s=S.settings;
  s.categories=s.categories.map((c,i)=>({name:($("#cn"+i)?.value??c.name).trim().replace(/[\\/:*?"<>|#%]+/g," ").trim()||c.name,
    keywords:($("#ck"+i)?.value??(c.keywords||[]).join(",")).split(",").map(x=>x.trim()).filter(Boolean)})).filter(c=>c.name);
  const n=(id,def,min,max)=>{const v=+($("#"+id)?.value);return v>=min&&v<=max?Math.round(v):def};
  s.remindDays=n("remD",s.remindDays??3,1,27);s.soonDays=n("soonD",s.soonDays??14,1,90);
}
function blobToB64(blob){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(",")[1]);r.onerror=rej;r.readAsDataURL(blob)})}
function exportData(){
  const shared=Object.fromEntries(Object.entries(S.settings).filter(([k])=>!LOCAL_KEYS.includes(k)&&k!=="updatedAt"));
  return {app:"dokumente",version:1,updatedAt:new Date().toISOString(),settings:shared,settingsUpdatedAt:S.settings.updatedAt||null,docs:S.docs.map(stripLocal),deleted:S.deleted};
}
async function makeBackup(){
  const blob=new Blob([JSON.stringify(exportData(),null,1)],{type:"application/json"});const name=`Dokumente_Sicherung_${today()}.json`;
  const file=new File([blob],name,{type:"application/json"});
  if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:name})}catch{}}
  else{const u=URL.createObjectURL(blob);const a=document.createElement("a");a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),5000)}
  S.settings.lastBackup=new Date().toISOString();await dbPut("meta",{key:"settings",...S.settings});
}
async function restoreBackup(file){
  try{const d=JSON.parse(await file.text());if(d.app!=="dokumente"||!Array.isArray(d.docs))throw new Error("Keine Sicherung dieser App.");
    if(!confirm(`${d.docs.length} Dokumente aus der Sicherung übernehmen? Neuere Angaben auf dem Handy bleiben erhalten.`))return;
    const map=new Map(S.docs.map(x=>[x.id,x]));
    for(const r of d.docs){const l=map.get(r.id);if(!l||(r.updatedAt||"")>(l.updatedAt||"")){const m={...r};if(l){m.fileId=l.fileId;m.thumbId=l.thumbId}map.set(r.id,m);await dbPut("docs",m)}}
    S.docs=[...map.values()];if(d.settings?.categories)S.settings.categories=d.settings.categories;await saveSettings();
    closeSheet();render();toast(`${d.docs.length} Dokumente eingespielt`);scheduleSync();
  }catch(err){setStatus("Einspielen fehlgeschlagen: "+(err?.message||err),true)}
}
