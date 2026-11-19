"""Browser-Tests der Dokumente-App mit nachgestellten Google-Antworten.

Aufruf (im Repo-Ordner):  python3 tests/test_app.py
Braucht: python3, playwright (Chromium). Startet selbst einen lokalen Server.
Keine echten Daten: alle IDs und Namen sind ausgedacht.
"""
import json, re, sys, threading, functools, http.server, socketserver, os
from urllib.parse import unquote
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8799
FAILS = []

def check(cond, msg):
    print(("  ok    " if cond else "  FEHLER ") + msg)
    if not cond: FAILS.append(msg)

def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    h = functools.partial(Quiet, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

class FakeDrive:
    """Sehr einfache Nachbildung der Drive-API: Ordner und Dateien im Speicher."""
    def __init__(self, files=None, extra=None):
        self.files = {f["id"]: json.loads(json.dumps(f, default=lambda o: o.decode("latin-1"))) if "content" not in f else dict(f) for f in (files or [])}
        self.calls = []; self.n = 0; self.extra = extra or (lambda route, m, u, uq: None); self.log = []
    def touch(self, fid): self.log.append(fid)  # Änderung für die Drive-Änderungsliste merken
    def new_id(self): self.n += 1; return "N%d" % self.n
    def __call__(self, route):
        req = route.request; u = req.url; m = req.method; uq = unquote(u)
        self.calls.append(m + " " + uq)
        if "cdn.jsdelivr" in u: return route.abort()
        r = self.extra(route, m, u, uq)
        if r is not None: return r
        if "/drive/v3/changes/startPageToken" in u: return route.fulfill(json={"startPageToken": str(len(self.log))})
        if "/drive/v3/changes?" in u:
            t = int(re.search(r"pageToken=(\d+)", u).group(1)); ids = list(dict.fromkeys(self.log[t:]))
            ch = [{"fileId": i, "file": {k: v for k, v in self.files[i].items() if k in ("id", "name", "parents", "trashed", "mimeType", "appProperties", "description", "webViewLink")}} if i in self.files else {"fileId": i, "removed": True} for i in ids]
            return route.fulfill(json={"changes": ch, "newStartPageToken": str(len(self.log))})
        if "upload/drive" in u:
            fid = re.search(r"/files/([^?]+)", u)
            fid = fid.group(1) if fid else self.new_id()
            self.touch(fid)
            md5 = "md5-" + str(len(self.calls)); f = self.files.setdefault(fid, {"id": fid, "name": "upload", "parents": []}); f["md5"] = md5
            try:
                nm = re.search(r'"name":"([^"]+)"', req.post_data_buffer.decode("utf-8", "ignore"))
                if nm: f["name"] = nm.group(1)
            except Exception: pass
            return route.fulfill(json={"id": fid, "webViewLink": "https://drive/" + fid, "md5Checksum": md5})
        if "/thumbs/" in u:  # Vorschaubild (in echt lh3.googleusercontent.com)
            png = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"+"1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")
            return route.fulfill(body=png, headers={"content-type": "image/png"})
        mid = re.search(r"/drive/v3/files/([^/?]+)", u)
        if m == "GET" and mid and "fields=thumbnailLink" in u:
            return route.fulfill(json={"thumbnailLink": "https://www.googleapis.com/thumbs/" + mid.group(1) + "=s220", "mimeType": "application/pdf", "size": "1000"})
        if m == "GET" and mid and "fields=md5Checksum" in u:
            return route.fulfill(json={"md5Checksum": self.files.get(mid.group(1), {}).get("md5", "x")})
        if m == "GET" and mid and "alt=media" in u:
            f = self.files.get(mid.group(1), {})
            if "content" in f: return route.fulfill(body=f["content"], headers={"content-type": f.get("mimeType", "application/octet-stream")})
            return route.fulfill(json={"docs": [], "deleted": {}})
        if m == "GET" and mid and "fields=parents" in u:
            return route.fulfill(json={"parents": self.files.get(mid.group(1), {}).get("parents", [])})
        if m == "GET" and "/drive/v3/files?" in u:
            q = re.search(r"q=([^&]*)", uq); q = q.group(1) if q else ""
            res = list(self.files.values())
            if "appProperties has" in q: res = [f for f in res if (f.get("appProperties") or {}).get("v") == "1"]
            ps = re.findall(r"'([^']+)' in parents", q)
            if ps: res = [f for f in res if any(x in f.get("parents", []) for x in ps)]
            n = re.search(r"name='([^']*)'", q)
            if n: res = [f for f in res if f.get("name") == n.group(1)]
            if "mimeType='application/vnd.google-apps.folder'" in q: res = [f for f in res if f.get("mimeType") == "folder"]
            if "mimeType='application/pdf'" in q: res = [f for f in res if f.get("mimeType") == "application/pdf"]
            if "trashed=false" in q: res = [f for f in res if not f.get("trashed")]
            return route.fulfill(json={"files": [{k: v for k, v in f.items() if k != "content"} for f in res]})
        if m == "POST" and "/drive/v3/files" in u:
            body = json.loads(req.post_data or "{}"); fid = self.new_id(); self.touch(fid)
            self.files[fid] = {"id": fid, "name": body.get("name"), "parents": body.get("parents", []), "mimeType": "folder" if "folder" in body.get("mimeType", "") else "x"}
            return route.fulfill(json={"id": fid})
        if m == "PATCH" and mid:
            f = self.files.setdefault(mid.group(1), {"id": mid.group(1), "parents": []}); self.touch(f["id"])
            body = json.loads(req.post_data or "{}")
            if body.get("name"): f["name"] = body["name"]
            if body.get("trashed"): f["trashed"] = True
            if "appProperties" in body: f["appProperties"] = body["appProperties"]
            if "description" in body: f["description"] = body["description"]
            a = re.search(r"addParents=([^&]+)", u); r_ = re.search(r"removeParents=([^&]+)", u)
            if a: f["parents"] = [p for p in f.get("parents", []) if not (r_ and p in r_.group(1).split(","))] + [a.group(1)]
            return route.fulfill(json={"id": f["id"], "webViewLink": "https://drive/" + f["id"]})
        return route.fulfill(json={"files": []})

FOLDERS = [
    {"id": "ROOT", "name": "Dokumente", "mimeType": "folder", "parents": []},
    {"id": "APP", "name": "_App-Daten", "mimeType": "folder", "parents": ["ROOT"]},
    {"id": "INB", "name": "0 Eingang", "mimeType": "folder", "parents": ["ROOT"]},
    {"id": "C_AUTO", "name": "Auto", "mimeType": "folder", "parents": ["ROOT"]},
    {"id": "C_AUTO24", "name": "2024", "mimeType": "folder", "parents": ["C_AUTO"]},
    {"id": "C_STEU", "name": "Steuern", "mimeType": "folder", "parents": ["ROOT"]},
]
SETTINGS = {"driveLinked": True, "driveFolderId": "ROOT", "driveAppId": "APP", "driveDataId": "DATA", "driveInboxId": "INB",
            "categories": [{"name": "Auto", "keywords": []}, {"name": "Steuern", "keywords": []}],
            "driveFolderMap": {"/Auto": "C_AUTO", "/Auto/2024": "C_AUTO24", "/Steuern": "C_STEU"}}

def doc(i, **k):
    d = {"id": "d%d" % i, "driveId": "D%d" % i, "category": "Auto", "sender": "Absender %d" % i, "subject": "Betreff %d" % i,
         "letterDate": "2024-03-0%d" % (i % 9 + 1), "status": "erledigt", "tags": [], "folder": "C_AUTO24",
         "updatedAt": "2026-01-01T00:00:00Z"}
    d["name"] = "%s_Absender_%d_Betreff_%d.pdf" % (d["letterDate"], i, i); d.update(k); return d

def run(p, drive, docs, settings=None, today_snapshot=True):
    b = p.chromium.launch(); c = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, service_workers="block")
    c.route(re.compile(r"https://(www|cdn)\.(googleapis|jsdelivr)\.(com|net)/.*"), drive)
    pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:%d/" % PORT)
    st = dict(SETTINGS, **(settings or {}))
    pg.evaluate("""async([docs,st,snap])=>{localStorage.setItem('gtok',JSON.stringify({token:'T',exp:Date.now()+3e6}));
      localStorage.setItem('gscope','https://www.googleapis.com/auth/drive');await idb();for(const d of docs)await dbPut('docs',d);
      await dbPut('meta',{key:'settings',...DEFAULT_SETTINGS,...st,...(snap?{lastSnapshot:today()}:{})})}""", [docs, st, today_snapshot])
    pg.reload(); pg.wait_for_timeout(2500)
    return b, pg, errs

def test_start_und_abgleich(p):
    print("Start und Abgleich")
    files = FOLDERS + [{"id": "DATA", "name": "dokumente-daten.json", "parents": ["APP"], "md5": "M0"}] + [{"id": "D%d" % i, "name": doc(i)["name"], "parents": ["C_AUTO24"]} for i in range(3)]
    dr = FakeDrive(files); b, pg, errs = run(p, dr, [doc(i) for i in range(3)])
    check(not errs, "keine JavaScript-Fehler " + str(errs))
    check(pg.evaluate("S.docs.length") == 3, "3 Briefe geladen")
    check(pg.evaluate("catNames()") == ["Auto", "Steuern"], "Kategorien aus Drive-Ordnern")
    n1 = len(dr.calls); dr.calls.clear()
    pg.evaluate("syncNow()"); pg.wait_for_timeout(2000)
    check(not any("alt=media" in x or "upload" in x for x in dr.calls), "zweiter Abgleich ohne Index-Übertragung (%d Zugriffe)" % len(dr.calls))
    b.close()

def test_eingang_und_speichern(p):
    print("Eingang, neue Kategorie, Speichern, Verschieben")
    scan = {"id": "SCAN", "name": "Scan 1.pdf", "parents": ["INB"], "mimeType": "application/pdf", "content": b"%PDF-1.4\n%%EOF", "createdTime": "2026-11-19T10:00:00Z", "size": "1000"}
    dr = FakeDrive(FOLDERS + [scan]); b, pg, errs = run(p, dr, [])
    check(pg.evaluate("S.inbox.length") == 1, "1 Scan im Eingang")
    pg.click("#btnAdd"); pg.wait_for_timeout(500); pg.click("[data-act=take]"); pg.wait_for_timeout(500)
    pg.fill("#ncName", "a/b"); pg.click("[data-act=new]"); pg.wait_for_timeout(200)
    check("Schrägstrich" in pg.inner_text("#edStatus"), "Schrägstrich wird abgelehnt")
    pg.fill("#ncName", "Kinder"); pg.click("[data-act=new]"); pg.wait_for_timeout(1500)
    check(pg.evaluate("$('#f_cat')?.value") == "Kinder", "neue Kategorie im Formular")
    pg.fill("#f_sender", "Familienkasse"); pg.fill("#f_subject", "Bescheid"); pg.fill("#f_date", "2026-11-10")
    pg.click("[data-act=save]"); pg.wait_for_timeout(3000)
    f = dr.files["SCAN"]; kinder = [x for x in dr.files.values() if x["name"] == "Kinder"][0]
    jahr = [x for x in dr.files.values() if x["name"] == "2026" and kinder["id"] in x.get("parents", [])]
    check(bool(jahr) and f["parents"] == [jahr[0]["id"]], "Scan liegt in Kinder/2026")
    check(f["name"] == "2026-11-10_Familienkasse_Bescheid.pdf", "Scan umbenannt: " + f["name"])
    check(not errs, "keine JavaScript-Fehler " + str(errs))
    b.close()

def test_doppelt(p):
    print("Doppelter Brief beim Speichern")
    scan = {"id": "SCAN", "name": "Scan 2.pdf", "parents": ["INB"], "mimeType": "application/pdf", "content": b"%PDF-1.4\n%%EOF"}
    old = doc(1, sender="Finanzamt", subject="Bescheid", letterDate="2026-11-10", category="Steuern")
    dr = FakeDrive(FOLDERS + [scan]); b, pg, errs = run(p, dr, [old])
    pg.click("#btnAdd"); pg.wait_for_timeout(500); pg.click("[data-act=take]"); pg.wait_for_timeout(500)
    pg.click("[data-act=pick][data-c=Steuern]"); pg.wait_for_timeout(1000)
    pg.fill("#f_sender", "Finanzamt"); pg.fill("#f_subject", "Bescheid"); pg.fill("#f_date", "2026-11-10")
    pg.click("[data-act=save]"); pg.wait_for_timeout(500)
    check(pg.locator("[data-act=dupdrop]").count() == 1, "Fenster „Doppelter Brief?“ erscheint")
    pg.click("[data-act=dupdrop]"); pg.wait_for_timeout(2500)
    check(dr.files["SCAN"].get("trashed") is True, "Scan im Papierkorb")
    check(pg.evaluate("S.docs.length") == 1, "kein zweiter Brief gespeichert")
    b.close()

def test_bekannte_datei_im_eingang(p):
    print("Bekannte Datei im Eingang")
    d = doc(1); dr = FakeDrive(FOLDERS + [{"id": "D1", "name": d["name"], "parents": ["INB"], "mimeType": "application/pdf"}])
    b, pg, errs = run(p, dr, [d])
    pg.click("#btnAdd"); pg.wait_for_timeout(800)
    check(pg.locator("[data-act=back]").count() == 1, "Hinweis mit „Zurück in die Ablage“")
    pg.click("[data-act=back]"); pg.wait_for_timeout(2500)
    check(dr.files["D1"]["parents"] == ["C_AUTO24"], "Datei zurück in Auto/2024")
    b.close()

def test_umsortieren(p):
    print("Umsortieren per Liste, Anlagen wandern mit")
    lst = {"categories": ["Neu"], "moves": [{"driveId": "D1", "category": "Neu"}, {"driveId": "D2", "category": "Steuern"}], "trash": ["D3", "LOSE"]}
    docs = [doc(1, attachments=[{"name": "a.pdf", "driveId": "A1"}]), doc(2), doc(3)]
    files = FOLDERS + [{"id": "LIST", "name": "dokumente-umsortieren.json", "parents": ["APP"], "content": json.dumps(lst).encode(), "mimeType": "application/json"},
                       {"id": "LOSE", "name": "kopie.pdf", "parents": ["C_AUTO24"]}, {"id": "A1", "name": "a.pdf", "parents": ["C_AUTO24"]}] + \
            [{"id": x["driveId"], "name": x["name"], "parents": ["C_AUTO24"]} for x in docs]
    dr = FakeDrive(files); b, pg, errs = run(p, dr, docs)
    check(pg.locator("[data-act=run]").count() == 1, "Fenster „Umsortieren“ erscheint")
    pg.click("[data-act=run]"); pg.wait_for_timeout(4000)
    neu = [x for x in dr.files.values() if x["name"] == "Neu"]
    check(bool(neu), "Ordner „Neu“ angelegt")
    check(pg.evaluate("S.docs.find(d=>d.id==='d1').category") == "Neu", "Brief 1 in „Neu“")
    check(dr.files["A1"]["name"].endswith("_Anlage-1.pdf") and dr.files["A1"]["parents"] == dr.files["D1"]["parents"], "Anlage mitverschoben")
    check(dr.files["D3"].get("trashed") and dr.files["LOSE"].get("trashed"), "Doppelte im Papierkorb")
    check(dr.files["LIST"]["name"].startswith("dokumente-umsortieren-erledigt-"), "Liste als erledigt markiert")
    check(not errs, "keine JavaScript-Fehler " + str(errs))
    b.close()

def test_angaben_in_drive(p):
    print("Angaben direkt an den Dateien in Drive")
    docs = [doc(1, tags=["Steuer", "Bescheid"], summary="Kurzinfo eins", deadline="2026-12-01", deadlineKind="Zahlung", status="todo", amount=12.5),
            doc(2, sender="Ä" * 90)]
    files = FOLDERS + [{"id": "SNAP", "name": "Sicherungen", "mimeType": "folder", "parents": ["APP"]}] + [{"id": x["driveId"], "name": x["name"], "parents": ["C_AUTO24"]} for x in docs]
    dr = FakeDrive(files); b, pg, errs = run(p, dr, docs)
    pg.wait_for_timeout(1500)
    a = dr.files["D1"].get("appProperties", {})
    check(a.get("sender") == "Absender 1" and a.get("deadline") == "2026-12-01" and a.get("status") == "todo" and a.get("tags") == "Steuer, Bescheid" and a.get("dk") == "d1", "App-Felder an Datei 1")
    check(dr.files["D1"].get("description") == "Kurzinfo eins", "Kurzinfo als Beschreibung")
    s2 = dr.files["D2"].get("appProperties", {}).get("sender", "")
    check(0 < len(("sender" + s2).encode()) <= 124, "langer Absender auf 124 Bytes gekürzt")
    check(any((x.get("name") or "").startswith("Sicherung_vor-Drive-Angaben_") for x in dr.files.values()), "Sicherung vor dem ersten Schreiben")
    dr.calls.clear(); pg.evaluate("syncNow()"); pg.wait_for_timeout(2000)
    check(not any(c.startswith("PATCH") and "/D1?fields=id" in c for c in dr.calls), "zweiter Abgleich schreibt nichts erneut")
    pg.evaluate("(async()=>{const d=S.docs.find(x=>x.id==='d1');d.status='erledigt';d.updatedAt=new Date().toISOString();await dbPut('docs',d);await syncNow()})()"); pg.wait_for_timeout(2500)
    check(dr.files["D1"]["appProperties"]["status"] == "erledigt", "Änderung landet in Drive")
    check(not errs, "keine JavaScript-Fehler " + str(errs))
    b.close()

def test_drive_ist_wahrheit(p):
    print("Verschieben und Löschen in Drive wird übernommen")
    docs = [doc(1), doc(2), doc(3)]
    files = FOLDERS + [{"id": "C_STEU24", "name": "2024", "mimeType": "folder", "parents": ["C_STEU"]}] + \
            [{"id": x["driveId"], "name": x["name"], "parents": ["C_AUTO24"]} for x in docs]
    dr = FakeDrive(files); b, pg, errs = run(p, dr, docs)
    pg.wait_for_timeout(1500)
    check(all((dr.files["D%d" % i].get("appProperties") or {}).get("v") == "1" for i in (1, 2, 3)), "Vorbereitung: App-Felder geschrieben")
    # Olgun verschiebt in Drive D1 nach Steuern/2024, benennt D2 um und löscht D3
    dr.files["D1"]["parents"] = ["C_STEU24"]; dr.files["D2"]["name"] = "Mein Name.pdf"; dr.files["D3"]["trashed"] = True
    for i in ("D1", "D2", "D3"): dr.touch(i)
    dr.calls.clear(); pg.evaluate("syncNow()"); pg.wait_for_timeout(3000)
    check(pg.evaluate("S.docs.find(d=>d.id==='d1')?.category") == "Steuern", "Verschiebung übernommen: Kategorie Steuern")
    check(dr.files["D1"]["parents"] == ["C_STEU24"], "Datei bleibt, wo Olgun sie hingelegt hat")
    check(dr.files["D2"]["name"] == "Mein Name.pdf", "Umbenennung in Drive bleibt")
    check(pg.evaluate("S.docs.some(d=>d.id==='d3')") is False, "in Drive gelöschter Brief aus der App entfernt")
    dr.calls.clear(); pg.evaluate("syncNow()"); pg.wait_for_timeout(2000)
    check(not any(c.startswith("PATCH") and "addParents" in c for c in dr.calls), "kein Zurückschieben beim nächsten Abgleich")
    # Änderung in der App verschiebt weiterhin
    pg.evaluate("(async()=>{const d=S.docs.find(x=>x.id==='d2');d.category='Steuern';d.updatedAt=new Date().toISOString();await dbPut('docs',d);await syncNow()})()"); pg.wait_for_timeout(3000)
    check(dr.files["D2"]["parents"] == ["C_STEU24"], "Kategorie-Änderung in der App verschiebt die Datei")
    check(not errs, "keine JavaScript-Fehler " + str(errs))
    b.close()

def test_einstellungen(p):
    print("Einstellungen: Kategorien umbenennen, Import entfernt")
    docs = [doc(1), doc(2)]
    files = FOLDERS + [{"id": x["driveId"], "name": x["name"], "parents": ["C_AUTO24"]} for x in docs]
    dr = FakeDrive(files); b, pg, errs = run(p, dr, docs)
    pg.click("#btnSettings"); pg.wait_for_timeout(500)
    check(pg.locator("text=Import aus Drive und Gmail").count() == 0, "Import-Bereich entfernt")
    check(pg.locator("[data-act=ren]").count() == 2, "Kategorien als Liste")
    pg.click("[data-act=ren][data-i='0']"); pg.wait_for_timeout(300)
    pg.fill("#rnName", "Steuern"); pg.click("[data-act=ok]"); pg.wait_for_timeout(300)
    check("gibt es schon" in pg.inner_text("#edStatus"), "doppelter Name abgelehnt")
    pg.fill("#rnName", "Fahrzeuge"); pg.click("[data-act=ok]"); pg.wait_for_timeout(1500)
    check(dr.files["C_AUTO"]["name"] == "Fahrzeuge", "Ordner in Drive umbenannt")
    check(pg.evaluate("S.docs.every(d=>d.category==='Fahrzeuge')"), "Briefe umbenannt")
    dr.calls.clear(); pg.evaluate("closeSheet();syncNow()"); pg.wait_for_timeout(2500)
    check(not any("addParents" in c for c in dr.calls), "kein unnötiges Verschieben nach Umbenennen")
    check(not errs, "keine JavaScript-Fehler " + str(errs))
    b.close()

def test_vorschau_und_karten(p):
    print("Vorschaubilder aus Drive, ruhigere Karten")
    docs = [doc(1, status="neu", tags=["a", "b", "c"]), doc(2, status="todo", deadline="2030-01-01", deadlineKind="Zahlung"), doc(3, status="erledigt")]
    files = FOLDERS + [{"id": x["driveId"], "name": x["name"], "parents": ["C_AUTO24"]} for x in docs]
    dr = FakeDrive(files); b, pg, errs = run(p, dr, docs)
    pg.wait_for_timeout(2500)
    check(pg.evaluate("S.docs.every(d=>d.thumbId)"), "alle Briefe haben ein Vorschaubild")
    pg.evaluate("S.status='alle';render()"); pg.wait_for_timeout(500)
    check(pg.locator(".card img.th").count() == 3, "Vorschaubilder in der Liste")
    check(pg.locator(".card.st-todo").count() == 1 and pg.locator(".card .stamp:has-text('Zu erledigen')").count() == 0, "Status als Streifen statt Abzeichen")
    check(pg.locator(".card[data-id=d1] .tag").count() == 2, "höchstens 2 Schlagwörter je Karte")
    dr.calls.clear(); pg.evaluate("fillThumbs()"); pg.wait_for_timeout(800)
    check(not any("thumbnailLink" in c for c in dr.calls), "Vorschaubilder nur einmal laden")
    check(not errs, "keine JavaScript-Fehler " + str(errs))
    b.close()

def test_abgleich_ueber_aenderungen(p):
    print("Abgleich über die Drive-Änderungsliste")
    docs = [doc(i) for i in range(5)]
    files = FOLDERS + [{"id": x["driveId"], "name": x["name"], "parents": ["C_AUTO24"]} for x in docs]
    dr = FakeDrive(files); b, pg, errs = run(p, dr, docs)
    pg.wait_for_timeout(1500); pg.evaluate("syncNow()"); pg.wait_for_timeout(2000)
    check(bool(pg.evaluate("S.settings.changesToken")), "Änderungsmarke gespeichert")
    dr.calls.clear(); pg.evaluate("syncNow()"); pg.wait_for_timeout(2000)
    other = [c for c in dr.calls if "/drive/v3/changes" not in c]
    check(len(other) == 0, "ohne Änderungen nur 1 Zugriff (sonst: %s)" % other[:3])
    # neuer Scan im Eingang wird über die Änderungsliste erkannt
    dr.files["NEU"] = {"id": "NEU", "name": "Scan.pdf", "parents": ["INB"], "mimeType": "application/pdf"}; dr.touch("NEU")
    pg.evaluate("syncNow()"); pg.wait_for_timeout(2000)
    check(pg.evaluate("S.inbox.some(f=>f.id==='NEU')"), "neuer Scan im Eingang erkannt")
    # Verschieben in Drive über die Änderungsliste
    dr.files["D1"]["parents"] = ["C_STEU"]; dr.touch("D1")
    pg.evaluate("syncNow()"); pg.wait_for_timeout(2000)
    check(pg.evaluate("S.docs.find(d=>d.id==='d1').category") == "Steuern", "Verschiebung über Änderungsliste übernommen")
    # nach 24 Stunden wieder vollständig
    pg.evaluate("S.settings.lastFull='2000-01-01T00:00:00Z'"); dr.calls.clear(); pg.evaluate("syncNow()"); pg.wait_for_timeout(2000)
    check(any("startPageToken" in c for c in dr.calls), "einmal am Tag vollständiger Abgleich")
    check(not errs, "keine JavaScript-Fehler " + str(errs))
    b.close()

def test_index_nur_sicherung(p):
    print("Index nur Sicherung, Wiederherstellen aus Drive")
    props = {"v": "1", "dk": "x1", "sender": "Stadtwerke", "subject": "Abschlag", "date": "2024-05-02", "status": "todo", "tags": "Strom, Abschlag", "cr": "2024-05-03"}
    files = FOLDERS + [{"id": "F1", "name": "2024-05-02_Stadtwerke_Abschlag.pdf", "parents": ["C_AUTO24"], "appProperties": props, "description": "Abschlag 80 Euro"}]
    dr = FakeDrive(files); b, pg, errs = run(p, dr, [])
    pg.wait_for_timeout(1500)
    d = pg.evaluate("S.docs.find(d=>d.id==='x1')")
    check(bool(d) and d["sender"] == "Stadtwerke" and d["category"] == "Auto" and d["tags"] == ["Strom", "Abschlag"] and d["summary"] == "Abschlag 80 Euro", "Brief allein aus Drive wiederhergestellt")
    pg.evaluate("syncNow()"); pg.wait_for_timeout(1500)
    # Statusänderung: Angaben an die Datei, aber keine neue Index-Sicherung
    dr.calls.clear()
    pg.evaluate("(async()=>{const d=S.docs[0];d.status='erledigt';d.updatedAt=new Date().toISOString();await dbPut('docs',d);await syncNow()})()"); pg.wait_for_timeout(2000)
    check(dr.files["F1"]["appProperties"]["status"] == "erledigt", "Status an der Datei")
    check(not any(c.startswith("PATCH") and "upload/drive" in c for c in dr.calls), "keine Index-Übertragung nur wegen Status")
    # neuer erkannter Text: Index-Sicherung sofort
    dr.calls.clear()
    pg.evaluate("(async()=>{const d=S.docs[0];d.text='Neuer Text';d.updatedAt=new Date().toISOString();await dbPut('docs',d);await syncNow()})()"); pg.wait_for_timeout(2000)
    check(any(c.startswith("PATCH") and "upload/drive" in c for c in dr.calls), "Index-Sicherung bei neuem Text")
    # Angaben anderswo geändert
    dr.files["F1"]["appProperties"] = dict(dr.files["F1"]["appProperties"], subject="Abschlag neu"); dr.touch("F1")
    pg.evaluate("syncNow()"); pg.wait_for_timeout(2000)
    check(pg.evaluate("S.docs[0].subject") == "Abschlag neu", "Änderung an der Datei übernommen")
    check(not errs, "keine JavaScript-Fehler " + str(errs))
    b.close()

if __name__ == "__main__":
    srv = serve()
    with sync_playwright() as p:
        for t in [test_start_und_abgleich, test_eingang_und_speichern, test_doppelt, test_bekannte_datei_im_eingang, test_umsortieren, test_angaben_in_drive, test_drive_ist_wahrheit, test_einstellungen, test_vorschau_und_karten, test_abgleich_ueber_aenderungen, test_index_nur_sicherung]:
            try: t(p)
            except Exception as e: check(False, t.__name__ + ": " + repr(e)[:200])
    srv.shutdown()
    print("\n%s: %d Fehler" % ("FEHLGESCHLAGEN" if FAILS else "ALLES OK", len(FAILS)))
    sys.exit(1 if FAILS else 0)
