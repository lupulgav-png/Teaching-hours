/* Private Booking Assistant – reine Logik (ohne DOM).
   Datum/Zeit, Spracheingabe-Parser, Nachrichten, ICS, Konflikte. */
(function (G) {
  'use strict';

  const WD = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const WD_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

  const pad = n => String(n).padStart(2, '0');
  const isoDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  function parseISO(s) {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const timeToMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
  const minToTime = m => { m = ((m % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); };
  const endTime = a => minToTime(timeToMin(a.time) + Number(a.duration || 0));
  function startDT(a) {
    const d = parseISO(a.date); const m = timeToMin(a.time);
    d.setHours(Math.floor(m / 60), m % 60, 0, 0); return d;
  }
  const endDT = a => new Date(startDT(a).getTime() + Number(a.duration) * 60000);

  function fmtDateLong(iso, now = new Date()) {
    const d = parseISO(iso);
    let s = WD[d.getDay()] + ', ' + d.getDate() + '. ' + MON[d.getMonth()];
    if (d.getFullYear() !== now.getFullYear()) s += ' ' + d.getFullYear();
    return s;
  }
  const fmtDateShort = iso => { const d = parseISO(iso); return WD_SHORT[d.getDay()] + ' ' + d.getDate() + '.' + (d.getMonth() + 1) + '.'; };
  function relDay(iso, now = new Date()) {
    const diff = Math.round((parseISO(iso) - startOfDay(now)) / 86400000);
    return diff === 0 ? 'heute' : diff === 1 ? 'morgen' : diff === 2 ? 'übermorgen' : '';
  }
  const fmtClock = t => { const [h, m] = t.split(':'); return m === '00' ? Number(h) + ' Uhr' : Number(h) + ':' + m + ' Uhr'; };
  function fmtDur(min) {
    min = Number(min);
    if (min === 60) return '1 Stunde';
    if (min % 60 === 0 && min >= 120) return (min / 60) + ' Stunden';
    return min + ' Minuten';
  }

  /* ─── Orte & Räume ─────────────────────────────────── */
  function placeLabel(a) {
    if (!a.location) return a.room || '';
    return a.room ? a.room + ', ' + a.location : a.location;
  }
  // «an der Albulastrasse» / «im Säulensaal an der Albulastrasse»
  function atLocation(loc) {
    if (!loc) return '';
    return /(strasse|gasse|weg|platz|allee)$/i.test(loc.trim()) ? 'an der ' + loc : 'bei ' + loc;
  }
  function placePhrase(a) {
    const at = atLocation(a.location);
    if (a.room && at) return 'im ' + a.room + ' ' + at;
    if (a.room) return 'im ' + a.room;
    return at;
  }

  /* ─── Spracheingabe-Parser ─────────────────────────── */
  const NUMWORDS = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf',
    'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn', 'zwanzig', 'einundzwanzig',
    'zweiundzwanzig', 'dreiundzwanzig', 'vierundzwanzig', 'fünfundzwanzig', 'sechsundzwanzig', 'siebenundzwanzig',
    'achtundzwanzig', 'neunundzwanzig', 'dreissig', 'einunddreissig'];
  const NUM = {};
  NUMWORDS.forEach((w, i) => { NUM[w] = i; });
  Object.assign(NUM, { ein: 1, eine: 1, einer: 1, einem: 1, zwo: 2, fünfundvierzig: 45, sechzig: 60, siebzig: 70, fünfundsiebzig: 75, achtzig: 80, neunzig: 90, hundert: 100, hundertzwanzig: 120, vierzig: 40, fünfzig: 50 });
  const ORD = {};
  for (let i = 1; i <= 31; i++) {
    let w;
    if (i === 1) w = 'erste'; else if (i === 3) w = 'dritte'; else if (i === 7) w = 'siebte'; else if (i === 8) w = 'achte';
    else w = NUMWORDS[i] + (i < 20 ? 'te' : 'ste');
    ORD[w] = i; ORD[w + 'n'] = i; ORD[w + 'r'] = i; ORD[w + 'm'] = i;
  }
  const num = w => (w == null ? undefined : /^\d+$/.test(w) ? Number(w) : NUM[w]);
  const WDMAP = { sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6 };
  const MONMAP = { januar: 1, jan: 1, jänner: 1, februar: 2, feb: 2, märz: 3, maerz: 3, mär: 3, april: 4, apr: 4, mai: 5, juni: 6, jun: 6, juli: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, oktober: 10, okt: 10, november: 11, nov: 11, dezember: 12, dez: 12 };
  const MON_RE = Object.keys(MONMAP).sort((a, b) => b.length - a.length).join('|');
  const NUMW_RE = Object.keys(NUM).sort((a, b) => b.length - a.length).join('|');
  const ORD_RE = Object.keys(ORD).sort((a, b) => b.length - a.length).join('|');
  const L = 'a-zäöüéèàçß';

  // \b kennt keine Umlaute – eigene Wortgrenze
  const WC = '[0-9a-zäöüéèàçß_]';
  const WB = '(?:(?<!' + WC + ')(?=' + WC + ')|(?<=' + WC + ')(?!' + WC + '))';
  const rx = re => new RegExp(re.source.replace(/\\b/g, WB), re.flags);
  const compact = s => String(s || '').toLowerCase().replace(/ß/g, 'ss').replace(/[^a-z0-9äöüéèàç]/g, '');
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }

  // Text in einzelne Lektionen aufteilen
  function splitEntries(text) {
    const chunks = String(text || '').split(/\n+|;/).map(s => s.trim()).filter(Boolean);
    const out = [];
    const KEY = /(?:privat[\s-]?)?(?:lektion|stunde)\b/gi;
    const LEAD = /(?:\s|^|[,.])+(?:(?:und|dann|ausserdem|sowie|noch|eine?|neue|weitere|zweite|dritte|nächste|private?)\s+)*$/i;
    for (const c of chunks) {
      const idx = [];
      let m; KEY.lastIndex = 0;
      while ((m = KEY.exec(c))) {
        // «halbe Stunde» / «90 Minuten, eine Stunde» sind Dauern, keine neue Lektion
        const before = c.slice(Math.max(0, m.index - 14), m.index).toLowerCase();
        if (/stunde/i.test(m[0]) && !/privat/i.test(m[0]) && !/(neue|weitere|noch eine)\s*$/.test(before)) continue;
        idx.push(m.index);
      }
      if (idx.length < 2) { out.push(c); continue; }
      let last = 0;
      for (let i = 1; i < idx.length; i++) {
        const head = c.slice(0, idx[i]);
        const lead = head.match(LEAD);
        const cut = lead ? idx[i] - lead[0].length : idx[i];
        const piece = c.slice(last, cut).replace(/[\s,.]+$/, '').trim();
        if (piece) out.push(piece);
        last = cut;
      }
      const rest = c.slice(last).replace(/^[\s,.]+/, '').trim();
      if (rest) out.push(rest);
    }
    return out;
  }

  const STOP = new Set(['der', 'die', 'das', 'dem', 'den', 'einer', 'eine', 'ein', 'meiner', 'meine', 'mir', 'ihr', 'ihm', 'am', 'um', 'im', 'in', 'an', 'von', 'bis', 'uhr', 'minuten', 'stunden', 'stunde', 'neue', 'neuen', 'privatlektion', 'lektion', 'raum', 'saal', 'studio', 'und', 'heute', 'morgen', 'übermorgen', 'nächsten', 'nächste', 'diesen', 'kommenden', 'schülerin', 'schüler', 'frau', 'herr', 'ihrer', 'seiner', 'abends', 'nachmittags', 'morgens']);

  function parseEntry(text, ctx = {}) {
    const now = ctx.now || new Date();
    const today = startOfDay(now);
    const locations = ctx.locations || [];
    const r = { raw: text, name: '', date: '', time: '', duration: ctx.defaultDuration || 60, location: '', room: '', notes: '', src: {} };
    let s = ' ' + String(text).toLowerCase().replace(/[–—]/g, '-') + ' ';
    const orig = ' ' + String(text).replace(/[–—]/g, '-') + ' ';
    const eat = m => { s = s.slice(0, m.index) + ' '.repeat(m[0].length) + s.slice(m.index + m[0].length); };
    const find = re => rx(re).exec(s);

    // Notizen
    let m = find(/\b(?:notiz|bemerkung|hinweis|info)\s*:?\s+(.+)$/);
    if (m) { r.notes = orig.substr(m.index + m[0].length - m[1].length, m[1].length).trim(); eat(m); r.src.notes = 'erkannt'; }

    // Ort & Raum
    let best = null;
    const words = s.split(/[^a-z0-9äöüéèàçß]+/).filter(Boolean);
    const grams = [];
    for (let i = 0; i < words.length; i++) { grams.push(words[i]); if (words[i + 1]) grams.push(words[i] + words[i + 1]); if (words[i + 2]) grams.push(words[i] + words[i + 1] + words[i + 2]); }
    const cg = grams.map(compact);
    const score = target => {
      const t = compact(target); if (!t) return 99;
      if (compact(s).includes(t)) return 0;
      let b = 99; const tol = Math.max(1, Math.floor(t.length / 5));
      for (const g of cg) { if (Math.abs(g.length - t.length) > tol) continue; const d = lev(g, t); if (d <= tol && d < b) b = d; }
      return b;
    };
    for (const loc of locations) {
      for (const room of loc.rooms || []) {
        const sc = score(room);
        if (sc < 99 && (!best || sc < best.sc || (best.kind === 'loc' && sc === best.sc))) best = { sc, loc: loc.name, room, kind: 'room' };
      }
      const variants = [loc.name, String(loc.name).replace(/[-\s]?strasse$/i, '')];
      for (const v of variants) {
        if (compact(v).length < 4) continue;
        const sc = score(v);
        if (sc < 99) {
          if (best && best.kind === 'room' && best.loc === loc.name) best.locSeen = true;
          else if (!best || sc < best.sc) best = { sc, loc: loc.name, room: '', kind: 'loc' };
        }
      }
    }
    if (best) {
      r.location = best.loc; r.room = best.room; r.src.location = 'erkannt'; if (best.room) r.src.room = 'erkannt';
      // erkannte Ortswörter aus dem Text entfernen, damit sie nicht als Name gelten
      for (const w of [best.room, best.loc, String(best.loc).replace(/[-\s]?strasse$/i, '')].filter(Boolean)) {
        const re = new RegExp('(?:im|in der|an der|bei|beim|raum|saal|in den|ins)?\\s*' + w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[-\s]+/g, '[-\\s]?') + '\\w*', 'g');
        s = s.replace(re, mm => ' '.repeat(mm.length));
      }
    } else {
      r.location = ctx.defaultLocation || (locations[0] && locations[0].name) || '';
      r.room = ctx.defaultRoom || '';
      r.src.location = 'standard';
    }

    // Dauer
    const durPatterns = [
      [new RegExp('\\b(eineinhalb|anderthalb|einhalb)\\s*stunden?'), () => 90],
      [new RegExp('\\b(zwei|drei)einhalb\\s*stunden'), m => num(m[1]) * 60 + 30],
      [/\b(\d+)\s*(?:,|\.|und)\s*(5|halb)\s*(?:stunden|std\.?|h)\b/, m => Number(m[1]) * 60 + 30],
      [/\b(\d+(?:[.,]\d+)?)\s*(?:stunden|stunde|std\.?|h)\b/, m => Math.round(parseFloat(m[1].replace(',', '.')) * 60)],
      [/\b(\d+)\s*(?:minuten|min\.?|minütige?n?)(?![a-z])/, m => Number(m[1])],
      [new RegExp('\\b(' + NUMW_RE + ')\\s*(?:minuten|min\\.?)'), m => num(m[1])],
      [/\bhalbe\s*stunde\b/, () => 30],
      [/\b(?:drei)?viertel\s*stunde\b/, m => (/drei/.test(m[0]) ? 45 : 15)],
      [new RegExp('\\b(eine|ein|zwei|drei)\\s*stunden?\\b'), m => num(m[1]) * 60],
    ];
    for (const [re, fn] of durPatterns) {
      m = find(re);
      if (m) { const v = fn(m); if (v >= 15 && v <= 600) { r.duration = v; r.src.duration = 'erkannt'; eat(m); break; } }
    }
    if (!r.src.duration) r.src.duration = 'standard';

    // Datum (vor der Uhrzeit, damit «3.12.» nicht als Zeit gilt)
    const setDate = d => { r.date = isoDate(d); r.src.date = 'erkannt'; };
    const futureYear = (mo, day, y) => {
      let d = new Date(y || today.getFullYear(), mo - 1, day);
      if (d.getMonth() !== mo - 1) return null;
      if (!y && d < today) d = new Date(today.getFullYear() + 1, mo - 1, day);
      return d;
    };
    if ((m = find(/\bübermorgen\b/))) { setDate(addDays(today, 2)); eat(m); }
    else if ((m = find(/\bheute\b/))) { setDate(today); eat(m); }
    else if ((m = find(/\bmorgen\b(?!s)/))) { setDate(addDays(today, 1)); eat(m); }
    if (!r.date && (m = find(new RegExp('\\b(?:am\\s+|den\\s+)?(\\d{1,2})\\.?\\s*(' + MON_RE + ')\\.?(?:\\s+(\\d{4}))?\\b')))) {
      const d = futureYear(MONMAP[m[2]], Number(m[1]), m[3] && Number(m[3])); if (d) { setDate(d); eat(m); }
    }
    if (!r.date && (m = find(new RegExp('\\b(?:am\\s+|den\\s+)?(' + ORD_RE + ')\\s+(' + MON_RE + ')\\b')))) {
      const d = futureYear(MONMAP[m[2]], ORD[m[1]]); if (d) { setDate(d); eat(m); }
    }
    if (!r.date && (m = find(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})?(?!\d)/))) {
      let y = m[3] ? Number(m[3]) : undefined; if (y && y < 100) y += 2000;
      const d = futureYear(Number(m[2]), Number(m[1]), y); if (d) { setDate(d); eat(m); }
    }
    if (!r.date && (m = find(/\b(?:am|den)\s+(\d{1,2})\.(\d{1,2})\b(?!\s*uhr)/))) {
      const d = futureYear(Number(m[2]), Number(m[1])); if (d) { setDate(d); eat(m); }
    }
    if (!r.date && (m = find(/\bin\s+(\d+|[a-zä]+)\s+(tag|tagen|woche|wochen)\b/))) {
      const n = num(m[1]); if (n) { setDate(addDays(today, /woche/.test(m[2]) ? n * 7 : n)); eat(m); }
    }
    if (!r.date && (m = find(/\b(?:(übernächste[nrm]?|nächste[nrm]?|kommende[nrm]?|diese[nrm]?|am)\s+)?(?:(nächste|kommende)\s+woche\s+(?:am\s+)?)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)s?\b/))) {
      const w = WDMAP[m[3]];
      let diff = (w - today.getDay() + 7) % 7;
      const mod = m[1] || '';
      if (m[2]) {
        const mondayNext = addDays(today, ((8 - today.getDay()) % 7) || 7);
        setDate(addDays(mondayNext, (w + 6) % 7));
      } else {
        if (diff === 0 && !/^diese/.test(mod)) diff = 7;
        if (/^übernächste/.test(mod)) diff += 7;
        setDate(addDays(today, diff));
      }
      eat(m);
      if (/^(nächste|übernächste)/.test(mod)) r.src.date = 'prüfen';
    }
    if (!r.date && (m = find(/\bam\s+(\d{1,2})\.(?!\d)/))) {
      const day = Number(m[1]);
      let d = new Date(today.getFullYear(), today.getMonth(), day);
      if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, day);
      if (d.getDate() === day) { setDate(d); eat(m); }
    }
    if (!r.date) r.src.date = 'fehlt';

    // Uhrzeit
    const times = [];
    const addT = (mm, h, mi, sure) => { if (h >= 0 && h <= 24 && mi >= 0 && mi < 60) { times.push({ i: mm.index, h, mi, sure }); eat(mm); } };
    const RX = [
      [/\b(\d{1,2})[:.](\d{2})\s*(?:uhr)?/g, mm => [Number(mm[1]), Number(mm[2]), true]],
      [/\b(\d{1,2})\s*uhr(?:\s+(\d{1,2})\b(?!\s*(?:min|stund)))?/g, mm => [Number(mm[1]), Number(mm[2] || 0), true]],
      [new RegExp('\\bhalb\\s+(\\d{1,2}|' + NUMW_RE + ')\\b', 'g'), mm => [num(mm[1]) - 1, 30, false]],
      [new RegExp('\\bviertel\\s+nach\\s+(\\d{1,2}|' + NUMW_RE + ')\\b', 'g'), mm => [num(mm[1]), 15, false]],
      [new RegExp('\\bviertel\\s+vor\\s+(\\d{1,2}|' + NUMW_RE + ')\\b', 'g'), mm => [num(mm[1]) - 1, 45, false]],
      [new RegExp('\\bdreiviertel\\s+(\\d{1,2}|' + NUMW_RE + ')\\b', 'g'), mm => [num(mm[1]) - 1, 45, false]],
      [new RegExp('\\b(' + NUMW_RE + ')\\s+uhr(?:\\s+(' + NUMW_RE + '))?\\b', 'g'), mm => [num(mm[1]), num(mm[2]) || 0, true]],
      [new RegExp('\\b(?:um|ab|bis|von)\\s+(\\d{1,2}|' + NUMW_RE + ')\\b(?!\\s*(?:min|stund|tag|woche))', 'g'), mm => [num(mm[1]), 0, false]],
    ];
    for (const [re0, fn] of RX) {
      const re = rx(re0); let mm;
      const found = [];
      while ((mm = re.exec(s))) found.push(mm);
      for (const f of found) { const [h, mi, sure] = fn(f); if (h != null && !isNaN(h)) addT({ index: f.index, 0: f[0] }, h, mi, sure); }
    }
    times.sort((a, b) => a.i - b.i);
    const pm = /\b(abends|am abend|nachmittags|am nachmittag|z'?nacht)\b/.test(s);
    const am = /\b(morgens|vormittags|am morgen|am vormittag|früh)\b/.test(s);
    const fix = t => {
      let h = t.h; let assumed = false;
      if (h < 12 && pm) h += 12;
      else if (!am && h >= 1 && h <= 7 && !t.sure) { h += 12; assumed = true; }
      else if (!am && h >= 1 && h <= 7) { h += 12; assumed = true; }
      return { h: h % 24, mi: t.mi, assumed };
    };
    if (times.length) {
      const t1 = fix(times[0]);
      r.time = pad(t1.h) + ':' + pad(t1.mi);
      r.src.time = t1.assumed ? 'prüfen' : 'erkannt';
      if (times.length > 1 && r.src.duration !== 'erkannt') {
        const t2 = fix(times[1]);
        let d = (t2.h * 60 + t2.mi) - (t1.h * 60 + t1.mi);
        if (d > 0 && d <= 600) { r.duration = d; r.src.duration = 'erkannt'; }
      }
    } else r.src.time = 'fehlt';

    // Name
    const known = ctx.customers || [];
    for (const c of known) {
      const first = compact(String(c.name).split(/\s+/)[0]);
      if (compact(text).includes(compact(c.name)) || (first.length >= 3 && rx(new RegExp('\\b' + String(c.name).split(/\s+/)[0].toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b')).test(s))) {
        r.name = c.name; r.customerId = c.id; r.src.name = 'erkannt'; break;
      }
    }
    if (!r.name) {
      const nameRe = rx(new RegExp('\\b(?:mit|für|fuer)\\s+(?:(?:der|meiner|schülerin|frau)\\s+)*([' + L + "][" + L + "'-]+)(?:\\s+([" + L + "][" + L + "'-]+))?", 'gd'));
      let mm;
      while ((mm = nameRe.exec(s))) {
        const w1 = mm[1];
        if (STOP.has(w1) || WDMAP[w1] != null || MONMAP[w1] || NUM[w1] != null) continue;
        let nm = orig.slice(mm.indices[1][0], mm.indices[1][1]);
        if (mm[2] && !STOP.has(mm[2]) && WDMAP[mm[2]] == null && !MONMAP[mm[2]] && NUM[mm[2]] == null) {
          const o2 = orig.slice(mm.indices[2][0], mm.indices[2][1]);
          if (/^[A-ZÄÖÜ]/.test(o2)) nm += ' ' + o2;
        }
        r.name = nm.charAt(0).toUpperCase() + nm.slice(1); r.src.name = 'erkannt'; break;
      }
    }
    if (!r.name) {
      const first = String(text).trim().match(new RegExp('^([A-ZÄÖÜ][' + L + "'-]+)"));
      if (first && !STOP.has(first[1].toLowerCase()) && WDMAP[first[1].toLowerCase()] == null && !/^(neue|privat|lektion|eine|am|nächste)/i.test(first[1])) {
        r.name = first[1]; r.src.name = 'prüfen';
      }
    }
    if (!r.name) r.src.name = 'fehlt';
    return r;
  }

  function parseSpeech(text, ctx) { return splitEntries(text).map(t => parseEntry(t, ctx)); }

  /* ─── Nachrichten ──────────────────────────────────── */
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const pick = (arr, seed, salt) => arr[hash(seed + '|' + salt) % arr.length];

  function sigOf(a, kind) {
    const base = [a.date, a.time, a.duration, a.location, a.room].join('|');
    return kind === 'student' ? base + '|' + a.name : base;
  }

  function dayPhrase(a, now) {
    const rel = relDay(a.date, now);
    const long = fmtDateLong(a.date, now);
    return rel === 'heute' || rel === 'morgen' ? rel + ', ' + long : 'am ' + long;
  }

  function roomMessage(a, opts = {}) {
    const now = opts.now || new Date();
    const seed = a.id + ':' + (opts.variant || 0);
    const contact = (opts.contact || '').trim();
    const greet = pick(['Hallo', 'Hoi', 'Hey'], seed, 'g');
    const salutation = contact ? greet + ' ' + contact : pick(['Hallo zusammen', 'Hoi zäme', 'Hallo'], seed, 'g0');
    const when = dayPhrase(a, now);
    const from = fmtClock(a.time).replace(' Uhr', '');
    const to = fmtClock(endTime(a));
    const roomAsk = a.room ? 'den ' + a.room + (a.location ? ' ' + atLocation(a.location) : '') : 'einen Saal ' + (atLocation(a.location) || '');
    const dur = fmtDur(a.duration);
    const body = pick([
      `ich hätte gern ${roomAsk} für eine Privatlektion reserviert: ${when}, von ${from} bis ${to} (${dur}). Ist der noch frei?`,
      `wäre ${when} von ${from} bis ${to} ${a.room ? 'der ' + a.room : 'ein Saal'}${a.location ? ' ' + atLocation(a.location) : ''} frei? Ich bräuchte ihn für eine Privatlektion, ${dur}.`,
      `ich bräuchte ${when} ${roomAsk.replace(/^den /, 'den ')} für eine Privatlektion – von ${from} bis ${to}. Geht das?`,
      `kann ich ${when} von ${from} bis ${to} ${a.room ? 'den ' + a.room : 'einen Saal'}${a.location ? ' ' + atLocation(a.location) : ''} haben? Es geht um eine Privatlektion (${dur}).`,
    ], seed, 'b');
    const extra = (opts.extra || '').trim();
    const close = pick(['Danke dir und liebe Grüsse', 'Merci vielmal und liebe Grüsse', 'Danke dir schon im Voraus!', 'Lieben Dank und bis bald'], seed, 'c');
    const sig = (opts.myName || '').trim();
    return `${salutation}\n\n${body.replace(/\s+/g, ' ').replace(/ ,/g, ',').trim()}${extra ? '\n' + extra : ''}\n\n${close}${sig ? '\n' + sig : ''}`.replace(/\s+(?=[.?])/g, '');
  }

  function studentMessage(a, opts = {}) {
    const now = opts.now || new Date();
    const seed = a.id + ':' + (opts.variant || 0);
    const first = String(a.name || '').trim().split(/\s+/)[0] || '';
    const greet = pick(['Hallo', 'Hoi', 'Hey'], seed, 'g');
    const when = dayPhrase(a, now);
    const from = fmtClock(a.time);
    const to = fmtClock(endTime(a));
    const place = placePhrase(a) || '';
    const addr = (opts.address || '').trim();
    const placeFull = place + (addr ? ' (' + addr + ')' : '');
    const dur = fmtDur(a.duration);
    const body = pick([
      `der Raum ist bestätigt – unsere Privatlektion findet also statt: ${when}, ${from.replace(' Uhr', '')} bis ${to}, ${placeFull}.`,
      `kurze Bestätigung für unsere Privatlektion: Wir sehen uns ${when} um ${from} ${placeFull}. Wir haben ${dur}, also bis ${to}.`,
      `alles klar, der Saal ist reserviert! Privatlektion ${when} von ${from.replace(' Uhr', '')} bis ${to}, ${placeFull}.`,
      `ich habe den Raum bekommen 🙂 Unsere Privatlektion ist ${when} um ${from}, ${dur}, ${placeFull}.`,
    ], seed, 'b');
    const close = pick(['Ich freue mich auf dich!', 'Freue mich! Bis dann', 'Bis bald und liebe Grüsse', 'Freu mich drauf – bis dann!'], seed, 'c');
    const sig = (opts.myName || '').trim();
    return `${greet}${first ? ' ' + first : ''}\n\n${body.replace(/\s+/g, ' ').replace(/ ,/g, ',').trim()}\n\n${close}${sig ? '\n' + sig : ''}`;
  }

  // «Nur Termin» – ohne Begrüssung, zum direkten Einfügen
  function plainLine(a, opts = {}) {
    const now = opts.now || new Date();
    const parts = [fmtDateLong(a.date, now), a.time + '–' + endTime(a) + ' Uhr', '(' + fmtDur(a.duration) + ')'];
    const place = placeLabel(a);
    let s = parts.join(', ').replace(', (', ' (');
    if (place) s += ', ' + place;
    if (opts.withName && a.name) s = a.name + ': ' + s;
    return s;
  }

  /* ─── Konflikte ────────────────────────────────────── */
  function overlaps(a, b) {
    if (!a.date || !b.date || !a.time || !b.time || a.date !== b.date) return false;
    const as = timeToMin(a.time), ae = as + Number(a.duration), bs = timeToMin(b.time), be = bs + Number(b.duration);
    return as < be && bs < ae;
  }
  function conflictsFor(a, list) {
    return list.filter(b => b.id !== a.id && b.status !== 'storniert' && overlaps(a, b));
  }

  /* ─── ICS ──────────────────────────────────────────── */
  const icsEsc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const icsUTC = d => d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  function fold(line) {
    const bytes = new TextEncoder().encode(line);
    if (bytes.length <= 75) return line;
    const out = []; let cur = ''; let curLen = 0;
    for (const ch of line) {
      const l = new TextEncoder().encode(ch).length;
      if (curLen + l > (out.length ? 74 : 75)) { out.push(cur); cur = ''; curLen = 0; }
      cur += ch; curLen += l;
    }
    out.push(cur);
    return out.join('\r\n ');
  }
  function buildICS(list, opts = {}) {
    const stamp = icsUTC(opts.now || new Date());
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Private Booking Assistant//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    for (const a of list) {
      const title = (opts.titlePrefix || 'Privatlektion') + ' – ' + (a.name || '');
      const loc = placeLabel(a) + (opts.addressFor && opts.addressFor(a) ? ', ' + opts.addressFor(a) : '');
      lines.push('BEGIN:VEVENT',
        'UID:' + a.id + '@private-booking-assistant',
        'SEQUENCE:' + (a.icsSeq || 0),
        'DTSTAMP:' + stamp,
        'DTSTART:' + icsUTC(startDT(a)),
        'DTEND:' + icsUTC(endDT(a)),
        'SUMMARY:' + icsEsc(title),
        'LOCATION:' + icsEsc(loc),
        'DESCRIPTION:' + icsEsc(a.notes || ''),
        'STATUS:CONFIRMED',
        'TRANSP:OPAQUE',
        'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  G.PBA = {
    WD, WD_SHORT, MON, pad, isoDate, parseISO, addDays, startOfDay, timeToMin, minToTime, endTime, startDT, endDT,
    fmtDateLong, fmtDateShort, relDay, fmtClock, fmtDur, placeLabel, placePhrase, atLocation,
    splitEntries, parseEntry, parseSpeech, compact,
    sigOf, roomMessage, studentMessage, plainLine, overlaps, conflictsFor, buildICS, hash,
  };
})(typeof window !== 'undefined' ? window : globalThis);
