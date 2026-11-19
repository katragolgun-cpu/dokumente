// Einstellungen und Sicherung
"use strict";
/* ================= Einstellungen & Sicherung ================= */
async function saveSettings(){S.settings.updatedAt=new Date().toISOString();await dbPut("meta",{key:"settings",...S.settings});scheduleSync()}
function openSettings(){
  const s=S.settings;S.edit={mode:"settings",urls:[]};
  const catRows=s.categories.map((c,i)=>`<div class="catrow">
      <label class="f">Name<input id="cn${i}" value="${esc(c.name)}"></label></div>`).join("");
  sheet("Einstellungen",`
    <div id="edStatus" class="status" style="margin-top:10px"></div>
    <div class="sec"><h3>Google Drive</h3>
      <p class="status" style="margin:0">${s.driveLinked
        ?"Neue Scans kommen in den Drive-Ordner „Dokumente/0 Eingang“. Verarbeitete Briefe liegen als PDF in „Dokumente“, sortiert nach Kategorie und Jahr. Jeden Tag kommt eine datierte Sicherung nach „_App-Daten/Sicherungen“."+(s.lastSnapshot?" Letzte: "+dfmt(s.lastSnapshot)+".":"")
        :"Nach dem Verbinden liegen alle Briefe als PDF im Drive-Ordner „Dokumente“."}</p>
      <p class="status" id="driveStatus" style="margin:0;font-weight:600"></p>
      <div class="btnrow">${s.driveLinked
        ?`<button type="button" class="btn primary" data-act="sync">Jetzt abgleichen</button><button type="button" class="btn" data-act="resort">Umsortier-Liste prüfen</button><button type="button" class="btn" data-act="unlink">Drive trennen</button>`
        :`<button type="button" class="btn primary" data-act="link">Mit Google Drive verbinden</button>`}</div>
      <details><summary class="status">Verlauf anzeigen</summary><pre class="status" style="white-space:pre-wrap;margin:6px 0 0;font-size:12px">${esc((()=>{try{return JSON.parse(localStorage.getItem("glog")||"[]").join("\n")}catch{return ""}})()||"Noch keine Einträge.")}</pre></details></div>
    <div class="sec"><h3>Fristen</h3>
      <p class="status" style="margin:0">${s.calOn
        ?"Jede Frist steht als ganztägiger Termin in deinem Google Kalender, mit Erinnerung."+(G.calErr?" <b>Kalender ist gerade nicht erreichbar.</b>":"")
        :"Optional: Fristen als Termin mit Erinnerung in den Google Kalender eintragen. Erledigte Briefe werden dort wieder entfernt."}</p>
      <div class="grid2">${field("Erinnerung (Tage vorher)","remD",s.remindDays??3,"number","",'min="1" max="27"')}${field("„Bald fällig“ ab (Tage)","soonD",s.soonDays??14,"number","",'min="1" max="90"')}</div>
      <div class="btnrow">${s.calOn?`<button type="button" class="btn" data-act="caloff">Kalender ausschalten</button>`:`<button type="button" class="btn" data-act="calon">Google Kalender einbinden</button>`}</div></div>
    <div class="sec"><h3>Import aus Drive und Gmail</h3>
      <p class="status" style="margin:0">${s.lastImport?`Letzter Import am ${dfmt(s.lastImport.date)}: ${s.lastImport.ok} Dokumente übernommen${s.lastImport.fail?.length?`, ${s.lastImport.fail.length} fehlgeschlagen (Liste bleibt für einen neuen Versuch erhalten)`:""}.`
        :"Übernimmt vorhandene Briefe aus deinem Google Drive und Gmail anhand der Importliste „dokumente-import.json“. Dafür fragt Google einmalig nach Lesezugriff auf Drive und Gmail. Die Originale bleiben unverändert, die App legt Kopien im Ordner „Dokumente“ an."}</p>
      <div class="btnrow"><button type="button" class="btn" data-act="import">${s.importMode?"Import fortsetzen":"Import starten"}</button></div></div>
    <div class="sec"><h3>Kategorien</h3>
      <p class="status" style="margin:0">Kategorien sind die Ordner in „Dokumente“ in Google Drive. Neue Kategorie beim Verarbeiten eines Scans anlegen oder direkt in Drive. Umbenennen hier benennt auch den Ordner in Drive um.</p>
      ${catRows}</div>
    <div class="sec"><h3>Sicherung als Datei</h3>
      <p class="status" style="margin:0">Enthält alle Angaben und den erkannten Text, ohne PDFs.${s.lastBackup?` Letzte: ${dfmt(s.lastBackup.slice(0,10))}.`:""}</p>
      <div class="btnrow"><button type="button" class="btn" data-act="backup">Sicherung erstellen</button><button type="button" class="btn" data-act="restore">Sicherung einspielen</button></div></div>
  `,`<button type="button" class="btn" data-act="close">Abbrechen</button><button type="button" class="btn primary" data-act="save">Speichern</button>`);
  updateChip();
  $("#scrim").addEventListener("click",async e=>{
    const b=e.target.closest("[data-act]");if(!b)return;
    switch(b.dataset.act){
      case "close":return closeSheet();
      case "link":closeSheet();return connectDrive();
      case "unlink":S.settings.driveLinked=false;G.token=null;try{localStorage.removeItem("gtok")}catch{};await dbPut("meta",{key:"settings",...S.settings});closeSheet();render();updateChip();return toast("Drive getrennt. Die Dateien bleiben in Drive.");
      case "sync":if(!tokenValid()){closeSheet();return connectDrive(true)}await syncNow();if(S.edit?.mode==="settings")openSettings();return;
      case "resort":if(!tokenValid()){closeSheet();return connectDrive(true)}closeSheet();G.resortAsked=false;await checkResort();if(!S.edit)toast("Keine Umsortier-Liste gefunden");return;
      case "import":collectSettings();S.settings.importMode=true;await saveSettings();closeSheet();if(fullScope()&&tokenValid())return runImport();return connectDrive(false);
      case "calon":collectSettings();S.settings.calOn=true;await saveSettings();closeSheet();return connectDrive(false);
      case "caloff":collectSettings();S.settings.calOn=false;await saveSettings();return openSettings();
      case "backup":return makeBackup();
      case "restore":{const p=$("#pickBackup");p.value="";p.onchange=()=>{const f=p.files[0];if(f)restoreBackup(f)};p.click();return}
      case "save":{
        const old=S.settings.categories.map(c=>c.name);collectSettings();
        // Umbenannte Kategorien in den Dokumenten nachziehen
        const now=S.settings.categories.map(c=>c.name);
        for(let i=0;i<Math.min(old.length,now.length);i++)if(old[i]!==now[i]){
          await renameCatFolder(old[i],now[i]);
          for(const d of S.docs)if(d.category===old[i]){d.category=now[i];d.updatedAt=new Date().toISOString();await dbPut("docs",d)}}
        await saveSettings();closeSheet();render();return toast("Gespeichert");
      }
    }
  });
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
