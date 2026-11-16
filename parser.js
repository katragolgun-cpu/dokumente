/* Dokumente-App: Brief auswerten – nur Regeln, keine KI, alles auf dem Handy.
   parseLetter(text, ctx) -> {date, sender, subject, ref, amount, deadline, deadlineKind, deadlineEstimated, category, tags, summary}
   ctx: {today:"YYYY-MM-DD", categories:[{name, keywords:[..]}], senders:[..], tags:[..]} */
(function (root) {
  "use strict";

  const MONTHS = { januar: 1, jan: 1, jänner: 1, februar: 2, feb: 2, märz: 3, maerz: 3, marz: 3, mär: 3, april: 4, apr: 4, mai: 5, juni: 6, jun: 6,
    juli: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, oktober: 10, okt: 10, november: 11, nov: 11, dezember: 12, dez: 12 };
  const NUMWORDS = { ein: 1, eine: 1, einen: 1, eines: 1, einem: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8,
    neun: 9, zehn: 10, elf: 11, zwölf: 12, zwoelf: 12, vierzehn: 14, einundzwanzig: 21, achtundzwanzig: 28, dreißig: 30, dreissig: 30 };

  const pad = n => String(n).padStart(2, "0");
  const iso = (y, m, d) => y + "-" + pad(m) + "-" + pad(d);
  const fold = s => String(s || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
  const dfmt = s => { if (!s) return ""; const [y, m, d] = s.split("-"); return d + "." + m + "." + y; };

  function validDate(y, m, d) {
    if (y < 100) y += 2000;
    if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null;
    return iso(y, m, d);
  }
  function addDays(isoStr, n) { const d = new Date(isoStr + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function addMonths(isoStr, n) {
    const [y, m, d] = isoStr.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, Math.min(d, last));
  }
  // Fällt das Fristende auf Samstag oder Sonntag, endet es am nächsten Werktag (§ 108 AO, § 193 BGB)
  function nextWorkday(isoStr) {
    let d = isoStr;
    for (let i = 0; i < 3; i++) { const wd = new Date(d + "T12:00:00Z").getUTCDay(); if (wd === 6 || wd === 0) d = addDays(d, 1); else break; }
    return d;
  }

  // Alle Datumsangaben in einer Zeile: 13.11.2026, 13. 11. 26, 13. November 2026, 1. Jan. 2026
  const RX_NUM = /(?<![\d.])(\d{1,2})\s?\.\s?(\d{1,2})\s?\.\s?(\d{4}|\d{2})(?![\d])/g;
  const RX_TXT = /(?<![\d])(\d{1,2})\.?\s*(januar|jänner|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|jan|feb|mär|apr|jun|jul|aug|sept|sep|okt|nov|dez)\.?\s*(\d{4})/gi;
  function findDates(line) {
    const out = [];
    for (const m of line.matchAll(RX_NUM)) { const v = validDate(+m[3], +m[2], +m[1]); if (v) out.push({ iso: v, idx: m.index, len: m[0].length }); }
    for (const m of line.matchAll(RX_TXT)) { const v = validDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]); if (v) out.push({ iso: v, idx: m.index, len: m[0].length }); }
    return out.sort((a, b) => a.idx - b.idx);
  }

  function cleanLines(text) {
    return String(text || "").replace(/\r/g, "").split("\n").map(l => l.replace(/[ \t]+/g, " ").replace(/[|_]{2,}/g, " ").trim());
  }
  const SALUT = /^(sehr geehrte|sehr geehrter|liebe[rs]?\b|hallo\b|guten tag|moin\b|servus\b)/i;

  /* ---------- Briefdatum ---------- */
  function findLetterDate(lines, today) {
    const max = today ? addDays(today, 7) : "2100-01-01";
    const cands = [];
    lines.slice(0, 40).forEach((l, i) => {
      for (const d of findDates(l)) {
        if (d.iso > max) continue;
        const before = fold(l.slice(Math.max(0, d.idx - 18), d.idx));
        const rest = l.replace(l.substr(d.idx, d.len), "").trim();
        let score = 10 - i * 0.2;
        if (/datum/.test(fold(l))) score += 8;
        if (!rest || /^[a-zäöüß\- ]{2,30},?\s*(den)?$/i.test(rest)) score += 6; // "Duisburg, 13.11.2026" oder nur Datum
        if (/(bis|vom|seit|ab|auf den|zum|frist|geb\.?|geboren|gueltig|faellig|zeitraum)\s*$/.test(before)) score -= 12;
        cands.push({ iso: d.iso, score });
      }
    });
    if (!cands.length) {
      for (const l of lines) for (const d of findDates(l)) if (d.iso <= max) return d.iso;
      return null;
    }
    cands.sort((a, b) => b.score - a.score);
    return cands[0].iso;
  }

  /* ---------- Absender ---------- */
  const KNOWN = [
    [/finanzamt\s+[a-zäöüß][\wäöüß]*(?:[\s-][a-zäöüß][\wäöüß]*)?/i, null, "Finanzamt/Steuern", "Finanzamt"],
    [/hauptzollamt\s+[a-zäöüß][\wäöüß-]*/i, null, "Finanzamt/Steuern", "Hauptzollamt"],
    [/bundeszentralamt für steuern/i, "Bundeszentralamt für Steuern", "Finanzamt/Steuern", "Steuern"],
    [/gewoge/i, "GEWOGE Duisburg-Ruhrort eG", "Wohnen/Vermieter", "GEWOGE"],
    [/techem/i, "Techem", "Wohnen/Vermieter", "Techem"],
    [/\bista\b/i, "ista", "Wohnen/Vermieter", "ista"],
    [/stadtwerke\s+[a-zäöüß][\wäöüß-]*/i, null, "Wohnen/Vermieter", "Stadtwerke"],
    [/wirtschaftsbetriebe duisburg/i, "Wirtschaftsbetriebe Duisburg", "Wohnen/Vermieter", "Abfall"],
    [/\baxa\b/i, "AXA", "Versicherung/Bank", "AXA"],
    [/allianz/i, "Allianz", "Versicherung/Bank", "Allianz"],
    [/\bhuk[- ]?coburg|\bhuk\b/i, "HUK-COBURG", "Versicherung/Bank", "HUK"],
    [/\bdevk\b/i, "DEVK", "Versicherung/Bank", "DEVK"],
    [/\bergo\b/i, "ERGO", "Versicherung/Bank", "ERGO"],
    [/sparkasse\s+[a-zäöüß][\wäöüß-]*/i, null, "Versicherung/Bank", "Sparkasse"],
    [/volksbank\s+[a-zäöüß][\wäöüß-]*/i, null, "Versicherung/Bank", "Volksbank"],
    [/\bing[- ]diba\b|\bing\b deutschland/i, "ING", "Versicherung/Bank", "ING"],
    [/commerzbank/i, "Commerzbank", "Versicherung/Bank", "Commerzbank"],
    [/postbank/i, "Postbank", "Versicherung/Bank", "Postbank"],
    [/deutsche bank/i, "Deutsche Bank", "Versicherung/Bank", "Deutsche Bank"],
    [/schufa/i, "SCHUFA", "Versicherung/Bank", "SCHUFA"],
    [/familienkasse/i, "Familienkasse", "Behörden/Sonstiges", "Kindergeld"],
    [/deutsche rentenversicherung/i, "Deutsche Rentenversicherung", "Behörden/Sonstiges", "Rente"],
    [/beitragsservice|ard zdf deutschlandradio/i, "ARD ZDF Deutschlandradio Beitragsservice", "Behörden/Sonstiges", "Rundfunkbeitrag"],
    [/bundesagentur für arbeit|jobcenter/i, null, "Behörden/Sonstiges", "Arbeitsagentur"],
    [/landesamt für besoldung|\blbv\b/i, "Landesamt für Besoldung und Versorgung NRW", "Behörden/Sonstiges", "Besoldung"],
    [/stadt duisburg/i, "Stadt Duisburg", "Behörden/Sonstiges", "Stadt"],
    [/amtsgericht\s+[a-zäöüß][\wäöüß-]*/i, null, "Behörden/Sonstiges", "Gericht"],
    [/telekom/i, "Telekom", "Behörden/Sonstiges", "Telefon/Internet"],
    [/vodafone/i, "Vodafone", "Behörden/Sonstiges", "Telefon/Internet"],
    [/\bo2\b|telefónica|telefonica/i, "O2", "Behörden/Sonstiges", "Telefon/Internet"],
    [/1\s?&\s?1/i, "1&1", "Behörden/Sonstiges", "Telefon/Internet"]
  ];
  const ORG = /\b(gmbh|ag|eg|e\.\s?v\.|kg|mbh|ohg|gbr|se|amt|stadt|versicherung|bank|kasse|verwaltung|gemeinde|kreis|behörde|gericht|schule|kita|kindergarten|universität|genossenschaft|verband|zentrum|praxis|kanzlei|steuerberater)\b/i;
  const tidy = s => String(s || "").replace(/^[^A-Za-zÄÖÜäöüß0-9]+|[^A-Za-zÄÖÜäöüß0-9.)]+$/g, "").replace(/\s+/g, " ").trim();
  const titleCase = s => s.replace(/\b([a-zäöüß])([\wäöüß]*)/gi, (m, a, b) => a.toUpperCase() + b.toLowerCase());

  function findSender(lines, text, senders) {
    const head = lines.slice(0, 25).join("\n");
    for (const scope of [head, text]) {
      for (const [rx, name, cat, tag] of KNOWN) {
        const m = scope.match(rx);
        if (m) return { name: name || titleCase(tidy(m[0])).replace(/-([a-z])/g, (x, c) => "-" + c.toUpperCase()), category: cat, tag };
      }
    }
    const ft = fold(text);
    for (const s of senders || []) if (s && s.length >= 4 && ft.includes(fold(s))) return { name: s, category: null, tag: null };
    for (const l of lines.slice(0, 15)) {
      if (l.length < 4 || l.length > 70 || SALUT.test(l)) continue;
      if (ORG.test(l)) return { name: tidy(l.split(/\s[·•|]\s|,\s(?=\d{5})/)[0]).slice(0, 60), category: null, tag: null };
    }
    const first = lines.find(l => /[a-zäöüß]{3}/i.test(l) && l.length <= 60);
    return first ? { name: tidy(first).slice(0, 60), category: null, tag: null } : null;
  }

  /* ---------- Betreff ---------- */
  const SUBJ_KW = /(?<![a-zäöüß])(bescheid|rechnung|mahnung|zahlungserinnerung|erinnerung|abrechnung|mitteilung|änderung|aenderung|kündigung|vertrag|bestätigung|einladung|information|antrag|beitrag\w*|festsetzung|feststellung|anpassung|vertragsänderung|kontoauszug|jahresabrechnung|nachzahlung|erstattung|zahlungsaufforderung)(?![a-zäöüß])/i;
  const NOISE = /^(ihr|ihre|unser|unsere)?\s*(zeichen|nachricht|telefon|tel\.?|fax|e-?mail|datum|durchwahl|ansprechpartner|sachbearbeiter|seite|kundennummer|steuernummer|aktenzeichen|bitte bei)\b/i;
  function findSubject(lines) {
    for (const l of lines.slice(0, 60)) {
      const m = l.match(/^(betreff|betr\.?|betrifft|bezug)\s*:?\s*(.{4,})$/i);
      if (m) return tidy(m[2]).slice(0, 120);
    }
    const si = lines.findIndex((l, i) => i < 70 && SALUT.test(l));
    if (si > 0) {
      for (let i = si - 1; i >= Math.max(0, si - 6); i--) {
        const l = lines[i];
        if (!l) continue;
        if (l.length < 6 || l.length > 120 || NOISE.test(l)) continue;
        const dates = findDates(l);
        if (dates.length && l.replace(/[\d.\s]/g, "").length < 12) continue;
        if (/^\d|\d{4,}\s*$/.test(l) && !SUBJ_KW.test(l)) continue;
        return tidy(l).slice(0, 120);
      }
    }
    for (let i = 0; i < Math.min(lines.length, 45); i++) {
      const l = lines[i];
      if (!l || l.length > 110 || NOISE.test(l) || !SUBJ_KW.test(l)) continue;
      let s = l;
      const km = l.match(SUBJ_KW);
      if (km && km.index > 0 && /\d{5}\s|str\.|straße|,/i.test(l.slice(0, km.index))) s = l.slice(km.index);
      if (s.length < 30) {
        for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
          const n = lines[j];
          if (!n) { if (s.length > l.length) break; else continue; }
          if (n.length > 45 || SALUT.test(n) || NOISE.test(n) || /^\d{5}\s/.test(n) || /^(herrn?|frau|eheleute|familie|an)\b/i.test(n)) break;
          s += " " + n;
          if (s.length > 100) break;
        }
      }
      return tidy(s).slice(0, 120);
    }
    return null;
  }

  /* ---------- Aktenzeichen / Kundennummer ---------- */
  const REF_RX = /(aktenzeichen|az\.|geschäftszeichen|steuernummer|steuer-nr\.?|st\.-?nr\.?|kundennummer|kunden-nr\.?|vertragsnummer|vertrags-nr\.?|versicherungsnummer|vers\.-?nr\.?|mitgliedsnummer|rechnungsnummer|rechnungs-nr\.?|kassenzeichen|vorgangsnummer|mietvertragsnummer|objektnummer|beitragsnummer|kindergeldnummer|ihr zeichen|unser zeichen)\s*[:.]?\s*([A-Z0-9][A-Z0-9/.\- ]{2,30}[A-Z0-9])/i;
  function findRef(lines) {
    for (const l of lines.slice(0, 80)) {
      const m = l.match(REF_RX);
      if (m && /\d/.test(m[2])) {
        const label = m[1].replace(/\.$/, "");
        const val = m[2].split(/\s{2,}|\s(?=[A-ZÄÖÜa-zäöü]{4,})/)[0].trim();
        return { label: label.charAt(0).toUpperCase() + label.slice(1).toLowerCase(), value: val };
      }
    }
    return null;
  }

  /* ---------- Betrag ---------- */
  const AMT_STRONG = /(zu zahlen|zahlbetrag|rechnungsbetrag|gesamtbetrag|endbetrag|nachzahlung|erstattung|erstattungsbetrag|guthaben|rückzahlung|offener betrag|fälliger betrag|bitte überweisen|abschlag|monatsbeitrag|jahresbeitrag|gesamtsumme)/i;
  const AMT_WEAK = /(\bbetrag\b|\bsumme\b|\bbeitrag\b|\bgesamt\b|\bmiete\b)/i;
  const MONEY = /(-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2})\s*(€|eur\b|euro\b)?/gi;
  function findAmount(lines) {
    let best = null;
    lines.forEach((l, i) => {
      const strong = AMT_STRONG.test(l), weak = AMT_WEAK.test(l);
      if (!strong && !weak) return;
      const ms = [...l.matchAll(MONEY)];
      if (!ms.length) return;
      const hasCur = ms.some(m => m[2]) || /€|eur/i.test(l) || /€|eur/i.test(lines[i + 1] || "");
      if (!hasCur) return;
      const m = ms[ms.length - 1];
      const v = +m[1].replace(/\./g, "").replace(",", ".");
      if (!(Math.abs(v) > 0)) return;
      const score = (strong ? 10 : 3) - i * 0.01;
      if (!best || score > best.score) best = { value: Math.abs(v), score, kind: /erstattung|guthaben|rückzahlung/i.test(l) ? "Erstattung" : null };
    });
    return best;
  }

  /* ---------- Frist ---------- */
  function deadlineKind(ctx) {
    const c = fold(ctx);
    if (/einspruch|widerspruch|klage|rechtsbehelf/.test(c)) return /widerspruch/.test(c) ? "Widerspruch" : "Einspruch";
    if (/zahl|ueberweis|faellig|begleich|beitrag|betrag|rechnung|mahnung/.test(c)) return "Zahlung";
    if (/einreich|nachweis|unterlagen|vorleg|zurueck|antwort|melden|mitteil/.test(c)) return "Rückmeldung";
    if (/kuendig/.test(c)) return "Kündigung";
    if (/termin|vorsprache|einladung/.test(c)) return "Termin";
    return "Frist";
  }
  const DL_RX = /(bis\s+(?:spätestens\s+)?(?:zum|am)?|spätestens\s+(?:am|bis(?:\s+zum)?)?|fällig\s+(?:am|zum)|zahlbar\s+(?:bis|am)|frist\w*\s+(?:endet|läuft)\s+(?:am|ab)?|einzureichen\s+bis|bis\s+einschließlich|termin\s*:|zahlungsziel\s*:?|fälligkeit\s*:?|fällig\s*:?)\s*$/i;
  function findDeadline(lines, letterDate, today) {
    const text = lines.join("\n");
    const floor = letterDate || (today ? addDays(today, -60) : "1990-01-01");
    const found = [];
    lines.forEach((l, i) => {
      for (const d of findDates(l)) {
        if (d.iso < floor) continue;
        const before = l.slice(Math.max(0, d.idx - 45), d.idx);
        if (DL_RX.test(before)) {
          const ctx = (lines[i - 1] || "") + " " + l + " " + (lines[i + 1] || "");
          found.push({ date: d.iso, kind: deadlineKind(ctx), estimated: false });
        }
      }
    });
    // Relative Fristen: "innerhalb eines Monats", "Frist ... beträgt einen Monat", "innerhalb von 14 Tagen"
    const flat = text.replace(/\s+/g, " ");
    const rel = /(innerhalb\s+(?:von\s+)?|binnen\s+|frist[^.]{0,80}?beträgt\s+|frist\s+von\s+)(\d{1,3}|[a-zäöüß]+)\s+(tag|tage|tagen|woche|wochen|monat|monats|monaten)\b/gi;
    for (const m of flat.matchAll(rel)) {
      const n = /^\d+$/.test(m[2]) ? +m[2] : NUMWORDS[m[2].toLowerCase()];
      if (!n || !letterDate) continue;
      const ctx = flat.slice(Math.max(0, m.index - 160), m.index + 120);
      const kind = deadlineKind(ctx);
      // Bekanntgabe: bei Behördenbriefen gilt der Brief am 4. Tag nach Aufgabe zur Post als zugegangen (seit 2025), vorher 3. Tag
      const behoerde = /bekanntgabe|bekannt gegeben|bescheid|rechtsbehelf|einspruch|widerspruch/i.test(flat);
      const start = behoerde ? addDays(letterDate, /dritten tag/i.test(flat) ? 3 : 4) : letterDate;
      const unit = m[3].toLowerCase();
      let end = unit.startsWith("monat") ? addMonths(start, n) : addDays(start, unit.startsWith("woche") ? n * 7 : n);
      end = nextWorkday(end);
      found.push({ date: end, kind, estimated: true });
    }
    if (!found.length) return null;
    // Feste Frist vor geschätzter, sonst früheste
    found.sort((a, b) => (a.estimated - b.estimated) || a.date.localeCompare(b.date));
    const exact = found.filter(f => !f.estimated);
    const pick = exact.length ? exact.sort((a, b) => a.date.localeCompare(b.date))[0] : found[0];
    return pick;
  }

  /* ---------- Kategorie ---------- */
  function scoreCategory(text, categories, senderCat) {
    const ft = fold(text);
    let best = null;
    for (const c of categories || []) {
      let s = c.name === senderCat ? 6 : 0;
      for (const k of c.keywords || []) { const kk = fold(k).trim(); if (kk.length >= 3 && ft.includes(kk)) s += 1; }
      if (!best || s > best.s) best = { name: c.name, s };
    }
    if (!best || best.s === 0) { const fb = (categories || []).find(c => /sonstig/i.test(c.name)); return fb ? fb.name : (categories?.[0]?.name || null); }
    return best.name;
  }

  /* ---------- Schlagwörter ---------- */
  const TAG_RULES = [
    ["Bescheid", /\bbescheid\b/i], ["Rechnung", /\brechnung\b/i], ["Mahnung", /\bmahnung|zahlungserinnerung/i],
    ["Einspruch möglich", /rechtsbehelfsbelehrung|einspruch einleg|einspruch angefochten|widerspruch einleg|widerspruch erheben/i],
    ["Zahlung", /zu zahlen|bitte überweisen|zahlbetrag|zahlungsaufforderung|bitte zahlen/i],
    ["Erstattung", /erstattung|guthaben|rückzahlung/i], ["Grundsteuer", /grundsteuer/i], ["Einkommensteuer", /einkommensteuer/i],
    ["Kfz", /\bkfz\b|kraftfahrzeug|fahrzeug/i], ["Nebenkosten", /nebenkosten|betriebskosten/i], ["Heizkosten", /heizkosten|heizung/i],
    ["Miete", /\bmiete\b|mietvertrag|mieterhöhung/i], ["Vertrag", /\bvertrag\b|vertragsänderung/i], ["Kündigung", /kündigung/i],
    ["Beitrag", /beitragsanpassung|beitragserhöhung|\bbeitrag\b/i], ["Kindergeld", /kindergeld/i], ["Rente", /\brente\b|rentenversicherung/i],
    ["Kita", /\bkita\b|kindertagesstätte|kindergarten/i], ["Schule", /\bschule\b/i], ["Strom", /\bstrom\b/i], ["Gas", /\bgas\b|erdgas/i],
    ["Wasser", /\bwasser\b/i], ["Internet/Telefon", /internet|mobilfunk|festnetz|dsl\b/i], ["Konto", /kontoauszug|girokonto/i],
    ["Kredit", /kredit|darlehen/i], ["Änderung", /(?<![a-zäöüß])änderung|anpassung|umstellung|umstellen|geändert/i], ["Termin", /\btermin\b|einladung/i],
    ["Wohnung", /wohnung|wohneigentum|wohnungseigentum/i], ["Versicherung", /versicherung/i]
  ];
  function findTags(text, sender, deadline, known) {
    const tags = [];
    const add = t => { if (t && !tags.some(x => fold(x) === fold(t))) tags.push(t); };
    if (sender?.tag) add(sender.tag);
    for (const [t, rx] of TAG_RULES) if (rx.test(text)) add(t);
    if (deadline) add("Frist");
    const ft = " " + fold(text).replace(/[^a-z0-9]+/g, " ") + " ";
    for (const k of known || []) { const kk = fold(k).replace(/[^a-z0-9]+/g, " ").trim(); if (kk.length >= 3 && ft.includes(" " + kk + " ")) add(k); }
    return tags.slice(0, 10);
  }

  /* ---------- Kernsatz für die Kurzinfo ---------- */
  function keySentence(lines) {
    const si = lines.findIndex(l => SALUT.test(l));
    if (si < 0) return null;
    const body = lines.slice(si + 1, si + 25).join(" ").replace(/\s+/g, " ").replace(/-\s(?=[a-zäöü])/g, "");
    const sents = [];
    for (const s of body.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜa-zäöü])/)) {
      const t = s.trim();
      if (/^(mit freundlichen|freundliche grüße|viele grüße)/i.test(t)) break;
      if (t.length >= 30) sents.push(t);
      if (sents.length >= 5) break;
    }
    if (!sents.length) return null;
    const key = sents.find(t => /teilen ihnen|mitteilen|informieren|bitten sie|erhalten sie|möchten wir|wir haben|hiermit|wird .* (erhöht|geändert|angepasst|umgestellt)/i.test(t)) || sents[0];
    const t = key.charAt(0).toUpperCase() + key.slice(1);
    return t.length > 240 ? t.slice(0, 237).replace(/\s\S*$/, "") + " …" : t;
  }

  function eurStr(v) { return v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €"; }

  function buildSummary(r) {
    const out = [];
    let head = [r.sender, r.subject].filter(Boolean).join(": ");
    if (head) out.push(head + (r.date ? " vom " + dfmt(r.date) : "") + ".");
    if (r.keySentence) out.push(r.keySentence);
    if (r.deadline) out.push(`Frist (${r.deadlineKind}): ${dfmt(r.deadline)}${r.deadlineEstimated ? ", geschätzt – bitte prüfen" : ""}.`);
    if (r.amount != null) out.push(`${r.amountKind || "Betrag"}: ${eurStr(r.amount)}.`);
    if (r.ref) out.push(`${r.ref.label}: ${r.ref.value}.`);
    return out.join("\n");
  }

  function parseLetter(text, ctx = {}) {
    const lines = cleanLines(text);
    const nonEmpty = lines.filter(Boolean);
    const date = findLetterDate(nonEmpty, ctx.today);
    const sender = findSender(nonEmpty, nonEmpty.join("\n"), ctx.senders);
    const subject = findSubject(lines);
    const ref = findRef(nonEmpty);
    const amt = findAmount(nonEmpty);
    const dl = findDeadline(nonEmpty, date, ctx.today);
    const category = scoreCategory(nonEmpty.join("\n"), ctx.categories, sender?.category);
    const tags = findTags(nonEmpty.join("\n"), sender, dl, ctx.tags);
    const r = {
      date, sender: sender?.name || null, subject, ref, amount: amt ? amt.value : null, amountKind: amt?.kind || null,
      deadline: dl?.date || null, deadlineKind: dl?.kind || null, deadlineEstimated: !!dl?.estimated,
      category, tags, keySentence: keySentence(lines)
    };
    r.summary = buildSummary(r);
    return r;
  }

  const api = { parseLetter, findDates, fold, addMonths, addDays, nextWorkday, buildSummary, eurStr, KNOWN_SENDERS: KNOWN };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Letter = api;
})(typeof self !== "undefined" ? self : this);
