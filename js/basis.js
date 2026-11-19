// Speicher, Zustand, Suche, Liste, Gruppierung, Filter
"use strict";
/* ================= Speicher (IndexedDB, nur auf diesem Gerät) ================= */
const DB_NAME="dokumente",DB_VER=1;
let _db;
function idb(){
  if(_db)return Promise.resolve(_db);
  return new Promise((res,rej)=>{
    const r=indexedDB.open(DB_NAME,DB_VER);
    r.onupgradeneeded=()=>{const d=r.result;
      if(!d.objectStoreNames.contains("docs"))d.createObjectStore("docs",{keyPath:"id"});
      if(!d.objectStoreNames.contains("files"))d.createObjectStore("files",{keyPath:"id"});
      if(!d.objectStoreNames.contains("meta"))d.createObjectStore("meta",{keyPath:"key"});};
    r.onsuccess=()=>{_db=r.result;res(_db)};r.onerror=()=>rej(r.error);
  });
}
async function tx(store,mode,fn){
  const d=await idb();
  return new Promise((res,rej)=>{const t=d.transaction(store,mode);const s=t.objectStore(store);let out;
    const r=fn(s);if(r&&"onsuccess" in r)r.onsuccess=()=>out=r.result;
    t.oncomplete=()=>res(out);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error)});
}
const dbAll=s=>tx(s,"readonly",st=>st.getAll());
const dbGet=(s,k)=>tx(s,"readonly",st=>st.get(k));
const dbPut=(s,v)=>tx(s,"readwrite",st=>st.put(v));
const dbDel=(s,k)=>tx(s,"readwrite",st=>st.delete(k));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);

/* ================= Zustand ================= */
const DEFAULT_CATEGORIES=[
  {name:"Finanzamt/Steuern",keywords:["finanzamt","steuer","steuernummer","steuerbescheid","grundsteuer","einkommensteuer","kfz-steuer","hauptzollamt","elster","steuer-id"]},
  {name:"Wohnen/Vermieter",keywords:["miete","mieter","vermieter","wohnung","nebenkosten","betriebskosten","heizkosten","gewoge","hausverwaltung","techem","ista","hausgeld","eigentümer","stadtwerke","strom","gas","wasser","schornsteinfeger"]},
  {name:"Versicherung/Bank",keywords:["versicherung","versicherungsschein","police","beitragsanpassung","sparkasse","volksbank","bank","konto","kontoauszug","kredit","darlehen","depot","kreditkarte","axa","allianz","huk","schufa"]},
  {name:"Behörden/Sonstiges",keywords:["stadt","amt","behörde","familienkasse","kindergeld","rentenversicherung","kita","schule","bürgeramt","beitragsservice","rundfunk","telekom","vodafone","vertrag"]}
];
const DEFAULT_SETTINGS={categories:DEFAULT_CATEGORIES,soonDays:14,calOn:false,remindDays:3,lastBackup:null};
const STATUS={neu:"Neu",todo:"Zu erledigen",erledigt:"Erledigt"};
const STATUS_CLS={neu:"s-neu",todo:"s-todo",erledigt:"s-ok"};
const S={docs:[],deleted:{},trash:[],settings:structuredClone(DEFAULT_SETTINGS),loaded:false,status:"offen",cat:"alle",group:"keine",open:{},q:"",edit:null,scan:null,sel:null,shown:[],inbox:[]};

const $=s=>document.querySelector(s);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const today=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const dfmt=s=>{if(!s)return "";const [y,m,d]=s.split("-");return d+"."+m+"."+y};
const days=(a,b)=>Math.round((new Date(b+"T12:00:00")-new Date(a+"T12:00:00"))/864e5);
const eur=n=>(+n||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"});
const fold=Letter.fold;
async function copyText(t){
  try{await navigator.clipboard.writeText(t);return toast("Text kopiert")}catch{}
  const a=document.createElement("textarea");a.value=t;a.setAttribute("readonly","");a.style.cssText="position:fixed;top:0;left:0;opacity:0";
  document.body.appendChild(a);a.select();let ok=false;try{ok=document.execCommand("copy")}catch{}a.remove();
  toast(ok?"Text kopiert":"Kopieren nicht möglich");
}
function toast(msg){const t=$("#toast");t.textContent=msg;t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>t.hidden=true,2600)}
const catNames=()=>S.settings.categories.map(c=>c.name);
const docDate=d=>d.letterDate||(d.createdAt||"").slice(0,10)||today();
const live=()=>S.docs.filter(d=>!S.deleted[d.id]);

/* ================= Suche (Volltext) ================= */
function hay(d){return fold([d.sender,d.subject,d.category,(d.tags||[]).join(" "),d.summary,d.refLabel,d.ref,d.note,dfmt(d.letterDate),d.letterDate,d.deadline&&dfmt(d.deadline),d.amount!=null?String(d.amount).replace(".",","):"",d.text].join(" \n "))}
function matchQ(d,q){
  const words=fold(q).split(/\s+/).filter(Boolean);if(!words.length)return true;
  const h=hay(d),hc=h.replace(/[^a-z0-9]/g,"");
  return words.every(w=>h.includes(w)||(w.replace(/[^a-z0-9]/g,"").length>=4&&hc.includes(w.replace(/[^a-z0-9]/g,""))));
}
// Textstelle mit dem ersten Treffer zeigen (nur wenn der Treffer im erkannten Text liegt)
function snippet(d,q){
  const w=fold(q).split(/\s+/).filter(Boolean)[0];if(!w||!d.text)return "";
  const meta=fold([d.sender,d.subject,(d.tags||[]).join(" "),d.category].join(" "));if(meta.includes(w))return "";
  const t=d.text.replace(/\s+/g," "),ft=fold(t);const i=ft.indexOf(w);if(i<0)return "";
  // fold verändert die Länge (ä->ae): Position grob zurückrechnen
  let pos=0,acc=0;while(pos<t.length&&acc<i){acc+=fold(t[pos]).length;pos++}
  const a=Math.max(0,pos-50),b=Math.min(t.length,pos+w.length+70);
  let len=0,k=pos;while(k<t.length&&len<w.length){len+=fold(t[k]).length;k++}
  return (a>0?"… ":"")+esc(t.slice(a,pos))+"<mark>"+esc(t.slice(pos,k))+"</mark>"+esc(t.slice(k,b))+(b<t.length?" …":"");
}

/* ================= Liste ================= */
const isOpen=d=>d.status!=="erledigt";
function dueInfo(d){
  if(!d.deadline||!isOpen(d))return null;
  const n=days(today(),d.deadline);
  return {n,text:n<0?`seit ${-n} Tag${n===-1?"":"en"} abgelaufen`:n===0?"heute":n===1?"morgen":`in ${n} Tagen`,over:n<0,soon:n<=S.settings.soonDays};
}
const ICON_DOC=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>`;
const thumbCache=new Map();
async function thumbUrl(d){
  if(!d.thumbId)return null;if(thumbCache.has(d.thumbId))return thumbCache.get(d.thumbId);
  const f=await dbGet("files",d.thumbId).catch(()=>null);if(!f)return null;const u=URL.createObjectURL(f.blob);thumbCache.set(d.thumbId,u);return u;
}
/* ================= Gruppierung ================= */
const GROUPS=[["keine","Keine"],["kategorie","Kategorie"],["absender","Absender"],["jahr","Jahr"],["status","Status"]];
try{const g=JSON.parse(localStorage.getItem("grp")||"null");if(g&&GROUPS.some(x=>x[0]===g.mode)){S.group=g.mode;S.open=g.open||{}}}catch{}
function saveGrp(){try{localStorage.setItem("grp",JSON.stringify({mode:S.group,open:S.open}))}catch{}}
// Absender grob vereinheitlichen: Groß-/Kleinschreibung, Satzzeichen, Rechtsformen ignorieren
const LEGAL=new Set(["gmbh","mbh","ag","kg","kgaa","ohg","gbr","ug","se","ev","eg","co","und","haftungsbeschraenkt","vvag","ltd","inc"]);
function senderTokens(n){return fold(n).replace(/e\.\s*v\./g," ev ").replace(/&/g," und ").split(/[^a-z0-9]+/).filter(t=>t&&!LEGAL.has(t))}
function senderGroups(rows){
  const keyOf=new Map(),toks=new Map();
  for(const d of rows){const t=senderTokens(d.sender||"");const k=t.join(" ");keyOf.set(d.id,k);if(k)toks.set(k,t)}
  // kürzere Schreibweise, die am Wortanfang übereinstimmt, übernimmt die längere (HUK-COBURG ⊂ HUK Coburg Versicherung)
  const keys=[...toks.keys()].sort((a,b)=>toks.get(a).length-toks.get(b).length||a.length-b.length),root=new Map();
  for(const k of keys){const t=toks.get(k);let r=k;
    for(const c of keys){const ct=toks.get(c);if(c===k||ct.length>=t.length||ct.join("").length<4)continue;if(ct.every((w,i)=>t[i]===w)){r=root.get(c)||c;break}}
    root.set(k,r)}
  const names=new Map();
  for(const d of rows){const k=keyOf.get(d.id);if(!k)continue;const r=root.get(k);const m=names.get(r)||new Map();const n=(d.sender||"").trim();m.set(n,(m.get(n)||0)+1);names.set(r,m)}
  const label=r=>[...names.get(r)].sort((a,b)=>b[1]-a[1]||a[0].length-b[0].length||(a[0]===a[0].toLowerCase())-(b[0]===b[0].toLowerCase()))[0][0];
  return d=>{const k=keyOf.get(d.id);if(!k)return {key:"",name:"Unbekannter Absender"};const r=root.get(k);return {key:r,name:label(r)}};
}
function groupRows(rows){
  const m=S.group;let gf,order;
  if(m==="kategorie"){gf=d=>({key:d.category||"",name:d.category||"Ohne Kategorie"});order=(a,b)=>!a.key-!b.key||a.name.localeCompare(b.name,"de")}
  else if(m==="absender"){gf=senderGroups(rows);order=(a,b)=>!a.key-!b.key||a.name.localeCompare(b.name,"de",{sensitivity:"base"})}
  else if(m==="jahr"){gf=d=>{const y=docDate(d).slice(0,4);return {key:y,name:y}};order=(a,b)=>b.key.localeCompare(a.key)}
  else if(m==="status"){const o=["neu","todo","erledigt"];gf=d=>{const k=STATUS[d.status]?d.status:"neu";return {key:k,name:STATUS[k]}};order=(a,b)=>o.indexOf(a.key)-o.indexOf(b.key)}
  const map=new Map();
  for(const d of rows){const g=gf(d);if(!map.has(g.key))map.set(g.key,{...g,docs:[]});map.get(g.key).docs.push(d)}
  return [...map.values()].sort(order);
}
const isGrpOpen=k=>!!S.q||(S.open[S.group]||[]).includes(k);
function toggleGrp(k){const l=new Set(S.open[S.group]||[]);l.has(k)?l.delete(k):l.add(k);S.open[S.group]=[...l];saveGrp();render()}
function selectGrp(k){
  const g=(S.groups||[]).find(x=>x.key===k);if(!g)return;const ids=g.docs.map(d=>d.id);
  if(!S.sel)startSel(null);
  const allOn=ids.every(id=>S.sel.has(id));ids.forEach(id=>allOn?S.sel.delete(id):S.sel.add(id));
  try{navigator.vibrate?.(25)}catch{}render();
}
const ICON_CHEV=`<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`;
function cardHtml(d){
  const i=dueInfo(d),sn=S.q?snippet(d,S.q):"";
  const on=S.sel?.has(d.id);
  return `<button type="button" class="card st-${esc(d.status||"neu")}${on?" sel":""}" data-id="${d.id}"${S.sel?` aria-pressed="${!!on}"`:""}>
      ${S.sel?`<span class="ck" aria-hidden="true">✓</span>`:""}${d.thumbId?`<img class="th" data-thumb="${d.thumbId}" alt="">`:`<span class="th ph">${ICON_DOC}</span>`}
      <span class="body">
        <span class="r1"><span class="snd">${esc(d.sender||"Unbekannter Absender")}</span><span class="dt">${dfmt(docDate(d))}</span></span>
        <span class="sbj">${esc(d.subject||"Ohne Betreff")}</span>
        <span class="meta"><span class="vh">Status: ${STATUS[d.status]||"Neu"}.</span>${d.status==="neu"?`<span class="newdot">Neu</span>`:""}${i?`<span class="stamp ${i.over||i.n<=3?"s-bad":"s-todo"}">${esc(d.deadlineKind||"Frist")} ${i.text}</span>`:""}${(d.tags||[]).slice(0,2).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</span>
        ${sn?`<span class="hit">${sn}</span>`:""}
      </span></button>`;
}
function render(){
  if(!S.loaded)return;
  const all=live();
  $("#sub").textContent=all.length?`${all.length} Dokument${all.length===1?"":"e"}${S.settings.driveLinked?" · in Google Drive":""}`:"Briefe erfassen und wiederfinden";
  // Fristen
  const due=all.map(d=>({d,i:dueInfo(d)})).filter(x=>x.i&&x.i.soon).sort((a,b)=>a.d.deadline.localeCompare(b.d.deadline));
  const box=$("#dueBox");box.hidden=!due.length||!!S.q||!!S.sel;
  if(due.length)box.innerHTML=`<h2>Bald fällig</h2>`+due.slice(0,6).map(({d,i})=>`<button type="button" class="due-item${i.over?" over":""}" data-id="${d.id}">
      <span style="min-width:0"><span class="t">${esc(d.sender||"Unbekannt")}</span><br><span class="s">${esc(d.deadlineKind||"Frist")}: ${esc(d.subject||"")}</span></span>
      <span class="d">${dfmt(d.deadline)}<br><span class="s">${i.text}</span></span></button>`).join("")+(due.length>6?`<span class="s" style="font-size:12.5px;opacity:.85">und ${due.length-6} weitere</span>`:"");
  // Filter
  const cnt=f=>all.filter(f).length;
  const sts=STS;
  const stF=(sts.find(s=>s[0]===S.status)||sts[0])[2];
  const stL=(sts.find(s=>s[0]===S.status)||sts[0])[1],grL=(GROUPS.find(g=>g[0]===S.group)||GROUPS[0])[1];
  const nAct=(S.status!=="offen")+(S.cat!=="alle")+(S.group!=="keine");
  $("#fBadge").hidden=!nAct;$("#fBadge").textContent=nAct;$("#btnFilter").setAttribute("aria-pressed",String(!!nAct));
  // Zeile mit aktiven Filtern: Status immer (damit klar ist, was die Liste zeigt), Rest nur wenn gesetzt
  $("#actChips").hidden=!!S.q||!!S.sel;
  $("#actChips").innerHTML=(S.status==="offen"?`<button type="button" class="chip on plain" data-f="open" aria-label="Filter öffnen">${stL}<span class="c">${cnt(stF)}</span></button>`
      :`<button type="button" class="chip on" data-f="status" aria-label="Status ${stL} entfernen">${stL}<span class="c">${cnt(stF)}</span><span class="x" aria-hidden="true">×</span></button>`)
    +(S.cat!=="alle"?`<button type="button" class="chip on" data-f="cat" aria-label="Kategorie ${esc(S.cat)} entfernen">${esc(S.cat)}<span class="x" aria-hidden="true">×</span></button>`:"")
    +(S.group!=="keine"?`<button type="button" class="chip on" data-f="group" aria-label="Gruppierung entfernen">Nach ${grL}<span class="x" aria-hidden="true">×</span></button>`:"");
  if($("#fpBody"))$("#fpBody").innerHTML=filterBody(all,cnt,stF);
  // Liste
  let rows=all.filter(d=>(S.q?true:stF(d))&&(S.cat==="alle"||d.category===S.cat)&&matchQ(d,S.q));
  rows.sort((a,b)=>docDate(b).localeCompare(docDate(a))||(b.createdAt||"").localeCompare(a.createdAt||""));
  S.shown=rows.map(d=>d.id);
  if(S.sel){const ids=new Set(all.map(d=>d.id));for(const id of [...S.sel])if(!ids.has(id))S.sel.delete(id)}
  updateSelBar();
  const list=$("#list");
  if(!all.length){list.innerHTML=`<div class="empty">Noch keine Dokumente.<br>Brief mit dem Drive-Scanner scannen und in „Dokumente/0 Eingang“ speichern. Dann hier auf „Eingang“ tippen.</div>`;return}
  if(!rows.length){list.innerHTML=`<div class="empty">${S.q?"Nichts gefunden.":"Keine Dokumente in dieser Ansicht."}</div>`;return}
  let html="";
  if(S.group==="keine"){
    S.groups=null;let year="";
    for(const d of rows){const y=docDate(d).slice(0,4);if(y!==year){year=y;html+=`<div class="year">${y}</div>`}html+=cardHtml(d)}
  }else{
    S.groups=groupRows(rows);
    for(const g of S.groups){
      const open=isGrpOpen(g.key),allSel=!!S.sel&&g.docs.every(d=>S.sel.has(d.id));
      html+=`<button type="button" class="grp${allSel?" allsel":""}" data-grp="${esc(g.key)}" aria-expanded="${open}">${ICON_CHEV}<span class="gn">${esc(g.name)}</span><span class="c">${g.docs.length}</span></button>`;
      if(open)html+=g.docs.map(cardHtml).join("");
    }
  }
  list.innerHTML=html;
  list.querySelectorAll("img[data-thumb]").forEach(async img=>{const d=S.docs.find(x=>x.thumbId===img.dataset.thumb);const u=d&&await thumbUrl(d);if(u)img.src=u;else img.replaceWith(Object.assign(document.createElement("span"),{className:"th ph",innerHTML:ICON_DOC}))});
}
/* ================= Filter (Panel von unten) ================= */
const STS=[["offen","Offen",d=>isOpen(d)],["neu","Neu",d=>d.status==="neu"],["todo","Zu erledigen",d=>d.status==="todo"],["erledigt","Erledigt",d=>d.status==="erledigt"],["alle","Alle",()=>true]];
function filterBody(all,cnt,stF){
  const cats=["alle",...catNames()];
  return `<div class="sec fsec"><h3>Status</h3><div class="chips fwrap">${STS.map(([k,l,f])=>`<button type="button" class="chip" data-status="${k}" aria-pressed="${S.status===k}">${l}<span class="c">${cnt(f)}</span></button>`).join("")}</div></div>
   <div class="sec fsec"><h3>Kategorie</h3><div class="chips fwrap">${cats.map(c=>`<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="${S.cat===c}">${c==="alle"?"Alle":esc(c)}<span class="c">${cnt(d=>(c==="alle"||d.category===c)&&stF(d))}</span></button>`).join("")}</div></div>
   <div class="sec fsec"><h3>Gruppieren</h3><div class="chips fwrap">${GROUPS.map(([k,l])=>`<button type="button" class="chip" data-group="${k}" aria-pressed="${S.group===k}">${l}</button>`).join("")}</div></div>`;
}
function resetFilter(){S.status="offen";S.cat="alle";S.group="keine";saveGrp()}
function openFilter(){
  sheet("Filter",`<div id="fpBody"></div>`,`<button type="button" class="btn link" data-fp="reset">Zurücksetzen</button><button type="button" class="btn primary" data-fp="done">Fertig</button>`);
  const host=$("#scrim");
  host.addEventListener("click",e=>{
    const b=e.target.closest("[data-status],[data-cat],[data-group],[data-fp]");if(!b)return;
    if(b.dataset.fp==="done")return closeSheet();
    if(b.dataset.fp==="reset")resetFilter();
    else if(b.dataset.status)S.status=b.dataset.status;
    else if(b.dataset.cat)S.cat=b.dataset.cat;
    else if(b.dataset.group){S.group=b.dataset.group;saveGrp()}
    render()});
  render();
}
$("#btnFilter").addEventListener("click",()=>openFilter());
$("#actChips").addEventListener("click",e=>{const b=e.target.closest("[data-f]");if(!b)return;const f=b.dataset.f;
  if(f==="open")return openFilter();
  if(f==="cat")S.cat="alle";else if(f==="group"){S.group="keine";saveGrp()}else if(f==="status")S.status="offen";
  render()});
/* Mehrfachauswahl: langes Drücken startet die Auswahl, danach Antippen zum Hinzufügen/Entfernen */
const LP={t:null,x:0,y:0,fired:false};
$("#list").addEventListener("pointerdown",e=>{LP.fired=false;clearTimeout(LP.t);
  const g=e.target.closest(".grp[data-grp]");if(g){LP.x=e.clientX;LP.y=e.clientY;LP.t=setTimeout(()=>{LP.fired=true;selectGrp(g.dataset.grp)},500);return}
  const b=e.target.closest(".card[data-id]");if(!b||S.sel)return;
  LP.x=e.clientX;LP.y=e.clientY;LP.t=setTimeout(()=>{LP.fired=true;startSel(b.dataset.id)},500)});
$("#list").addEventListener("pointermove",e=>{if(LP.t&&Math.hypot(e.clientX-LP.x,e.clientY-LP.y)>10){clearTimeout(LP.t);LP.t=null}});
["pointerup","pointercancel"].forEach(ev=>$("#list").addEventListener(ev,()=>{clearTimeout(LP.t);LP.t=null}));
$("#list").addEventListener("contextmenu",e=>{const g=e.target.closest(".grp[data-grp]");if(g){e.preventDefault();if(!LP.fired){clearTimeout(LP.t);LP.fired=true;selectGrp(g.dataset.grp)}return}
  const b=e.target.closest(".card[data-id]");if(!b)return;e.preventDefault();
  if(!S.sel&&!LP.fired){clearTimeout(LP.t);LP.fired=true;startSel(b.dataset.id)}});
$("#list").addEventListener("click",e=>{
  const g=e.target.closest(".grp[data-grp]");if(g){if(LP.fired){LP.fired=false;return}return toggleGrp(g.dataset.grp)}
  const b=e.target.closest("[data-id]");if(!b)return;
  if(LP.fired){LP.fired=false;return}
  if(S.sel){toggleSel(b.dataset.id);return}
  openView(b.dataset.id)});
$("#dueBox").addEventListener("click",e=>{const b=e.target.closest("[data-id]");if(b)openView(b.dataset.id)});
$("#btnAdd").addEventListener("click",()=>openInbox());
$("#btnSettings").addEventListener("click",()=>openSettings());
(()=>{const q=$("#q"),c=$("#qClear");let t;
q.addEventListener("input",()=>{c.hidden=!q.value;clearTimeout(t);t=setTimeout(()=>{S.q=q.value.trim();render()},150)});
c.addEventListener("click",()=>{q.value="";c.hidden=true;S.q="";render();q.focus()});
q.addEventListener("keydown",e=>{if(e.key==="Escape"){q.value="";c.hidden=true;S.q="";render()}else if(e.key==="Enter")q.blur()});})();
