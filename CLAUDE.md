# Dokumente-App

Installierbare Web-App (PWA) für Android. Eingehende Briefe fotografieren, auf dem Handy per OCR lesen, regelbasiert auswerten und als PDF in Google Drive ablegen.

- Live: https://katragolgun-cpu.github.io/dokumente/ (GitHub Pages, Branch `main`)
- Nutzer: nur Olgun, Android-Handy, Chrome
- Konzept und Funktionsliste: Claude-Projekt „Dokumentenmanagement“, Datei `claude/konzept-dokumente-app.md`

## Rahmen (nicht verletzen)
- Budget 0 €. Kein eigener Server, kein Build-Schritt, kein npm.
- Keine Briefdaten an Dritte, keine externe KI. OCR und Auswertung laufen auf dem Handy.
- Externe Bibliotheken nur über `cdn.jsdelivr.net` (tesseract.js, pdfjs-dist, pdf-lib); der Service Worker cacht sie.
- Löschen nur in den Drive-Papierkorb, nie endgültig.

## Dateien
- `index.html` – die ganze App: CSS, HTML und JavaScript in einer Datei. Abschnitte sind mit `/* ================= Name ================= */` markiert (Speicher, Zustand, Suche, Liste, Gruppierung, Erfassen, Großansicht, Mehrfachauswahl, Einstellungen, Texterkennung/Scanner, Google Drive und Kalender, Import, Start).
- `parser.js` – `Letter.parseLetter(text, ctx)`: Absender, Betreff, Datum, Aktenzeichen, Betrag, Frist, Kategorie, Schlagwörter, Kurzinfo. Nur Regeln. Stellt auch `Letter.fold` bereit.
- `sw.js` – Service Worker für Offline-Betrieb.
- `manifest.webmanifest`, Icons.

## Daten
- Auf dem Gerät: IndexedDB mit den Stores `docs`, `files`, `meta`. Kleinkram in `localStorage` (`gtok`, `gscope`, `glog`, `grp` usw.).
- In Google Drive: `Dokumente/<Kategorie>/<Jahr>/<Datum>_<Absender>_<Betreff>.pdf`, Index-Datei mit allen Metadaten und OCR-Text, tägliche Sicherungen unter `_App-Daten/Sicherungen`.
- Google-Anmeldung per OAuth-Token-Flow im Browser (`GOOGLE_CLIENT_ID` in `index.html`, Cloud-Projekt 592336920931). Voller Drive-Zugriff (`drive`, seit v14 für Eingang und Kategorie-Ordner) und `calendar.events`; Gmail-Lesezugriff nur für den einmaligen Import. Umsortieren per Liste `dokumente-umsortieren.json` (siehe Konzept Punkt 14).

## Regeln für Änderungen
- Bei jeder Änderung an App-Dateien `VERSION` in `sw.js` um eins erhöhen (z. B. `v12` -> `v13`). Sonst bekommt das Handy das Update nicht.
- Stil im bestehenden Code beibehalten: kompaktes Vanilla-JS, Hilfsfunktionen `$`, `esc`, `fold`, `dfmt`, Zustand in `S`, Anzeige über `render()`.
- Benutzer-Texte auf Deutsch, kurz und klar.
- Vor dem Commit Syntax prüfen:
  ```
  node -e "const s=require('fs').readFileSync('index.html','utf8');[...s.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].forEach(x=>new Function(x[1]));console.log('syntax ok')"
  ```
- Neue Funktionen im Browser testen: `python3 -m http.server`, dann mit Playwright (Chromium, Viewport 390×844, `has_touch`) Testdaten in `S.docs` setzen, `S.loaded=true`, `render()` aufrufen und Screenshot prüfen. Google-Zugriffe mit nachgestellten Antworten testen.
- Nach dem Hochladen sagen, was nur mit Testdaten geprüft ist und was Olgun auf dem Handy testen soll.

## Arbeitsweise mit Olgun
- Antworten auf Deutsch, kurze Sätze, keine Emojis, keine Floskeln.
- Erst Rückfragen stellen (als Auswahlfragen), dann umsetzen. Immer nur einen Schritt pro Antwort.
- Neue Funktionen erst im Konzept beschreiben und nach seinem OK in die Konzeptdatei schreiben und umsetzen.
- Keine Fakten erfinden. Kritisch sein, wenn eine Idee unklug ist.
