// Start
"use strict";
/* ================= Start ================= */
(async()=>{
  render();
  try{
    const st=await dbGet("meta","settings");if(st){const {key,...rest}=st;S.settings={...DEFAULT_SETTINGS,...rest}}
    S.docs=await dbAll("docs");
    const del=await dbGet("meta","deleted");S.deleted=del?.items||{};
    const tq=await dbGet("meta","trash");S.trash=tq?.items||[];
  }catch(err){$("#list").innerHTML=`<div class="empty">Speicher nicht verfügbar. Bitte die App nicht im privaten Modus öffnen.</div>`;return}
  S.loaded=true;render();updateChip();
  if(new URLSearchParams(location.search).has("share"))takeShared();
  if(AUTH?.token&&!S.settings.driveLinked){S.settings.driveLinked=true;await dbPut("meta",{key:"settings",...S.settings});updateChip()}
  if(AUTH?.token&&S.settings.calOn&&AUTH.scope&&!AUTH.scope.includes("calendar")){glog("Kalender-Zugriff wurde nicht erlaubt");toast("Kalender-Zugriff wurde nicht erlaubt")}
  if(AUTH?.error){
    if(AUTH.silent&&/interaction_required|login_required|consent_required/.test(AUTH.error))return connectDrive(false);
    toast(AUTH.error==="access_denied"?"Anmeldung abgebrochen":"Anmeldung bei Google fehlgeschlagen ("+AUTH.error+")");
  }
  if(AUTH?.token)toast(S.settings.calOn?"Mit Google Drive und Kalender verbunden":"Mit Google Drive verbunden");
  if(S.settings.driveLinked&&tokenValid())syncNow().then(()=>{if(S.settings.importMode&&fullScope())runImport()});
  if(S.settings.importMode&&AUTH?.token&&!fullScope()){toast("Für den Import bitte Drive- und Gmail-Zugriff erlauben");glog("Import: Zugriff nicht vollständig erlaubt")}
  document.addEventListener("visibilitychange",async()=>{
    if(document.visibilityState!=="visible")return;
    try{const t=JSON.parse(localStorage.getItem("gtok")||"null");if(t&&t.exp>Date.now()&&t.token!==G.token){G.token=t.token;G.exp=t.exp}}catch{}
    updateChip();render();
    if(S.settings.driveLinked&&tokenValid()&&(G.dirty||!G.last||Date.now()-G.last>60000))syncNow();
  });
  try{await navigator.storage?.persist?.()}catch{}
  if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
})();
