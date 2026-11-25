/* Private Booking Assistant – Oberfläche */
(function () {
  'use strict';
  const P = window.PBA;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const todayISO = () => P.isoDate(new Date());

  /* ─── Status ───────────────────────────────────────── */
  const STEPS = [
    { k: 'offen', label: 'Vereinbart', sub: 'Raumanfrage noch nicht versendet', chip: 'Raum offen' },
    { k: 'angefragt', label: 'Raum angefragt', chip: 'Raum angefragt' },
    { k: 'raum', label: 'Raum bestätigt', chip: 'Raum bestätigt' },
    { k: 'bestaetigt', label: 'Schülerin bestätigt', chip: 'Bestätigt' },
    { k: 'erledigt', label: 'Abgeschlossen', chip: 'Abgeschlossen' },
  ];
  const STATUS = Object.fromEntries(STEPS.map((s, i) => [s.k, { ...s, i }]));
  STATUS.storniert = { k: 'storniert', label: 'Storniert', chip: 'Storniert', i: -1 };
  const ACTIVE = a => a.status !== 'erledigt' && a.status !== 'storniert';

  /* ─── Speicher (optional verschlüsselt) ────────────── */
  const LS = { plain: 'pba_data_v1', enc: 'pba_data_enc_v1', lock: 'pba_lock_v1' };
  const te = new TextEncoder(), td = new TextDecoder();
  const b64 = buf => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function deriveKey(pin, salt, iter) {
    const base = await crypto.subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptStr(key, str) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(str));
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function decryptStr(key, o) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.ct));
    return td.decode(pt);
  }
  const cryptoOK = !!(window.crypto && crypto.subtle);

  function defaultDB() {
    return {
      v: 1, appts: [], customers: [], drafts: [],
      settings: {
        myName: '',
        defaultDuration: 60,
        defaultLocation: 'Albulastrasse',
        locations: [
          { id: uid(), name: 'Albulastrasse', contact: '', phone: '', address: '', rooms: ['Säulensaal', 'Mittlerer Saal', 'Barsaal'] },
          { id: uid(), name: 'Max-Högger-Strasse', contact: '', phone: '', address: '', rooms: ['Pflanzensaal', 'Panoramasaal', 'Studiosaal'] },
        ],
        roomExtra: '',
        calendarName: 'Privatlektionen (gelb)',
        icsTest: null,
        customersEnabled: false,
        lockMinutes: 5,
        msgMode: 'text',
      },
    };
  }
  function migrate(d) {
    const def = defaultDB();
    if (!d || typeof d !== 'object') return def;
    d.appts = Array.isArray(d.appts) ? d.appts : [];
    d.customers = Array.isArray(d.customers) ? d.customers : [];
    d.drafts = Array.isArray(d.drafts) ? d.drafts : [];
    d.settings = Object.assign({}, def.settings, d.settings || {});
    if (!Array.isArray(d.settings.locations)) d.settings.locations = def.settings.locations;
    for (const a of d.appts) { a.msg = a.msg || {}; a.variant = a.variant || { room: 0, student: 0 }; a.cal = a.cal || { state: 'none' }; a.history = a.history || []; }
    d.v = 1;
    return d;
  }

  let db = null, key = null, lockMeta = null;
  let saveChain = Promise.resolve();
  function save() {
    if (!db) return;
    const json = JSON.stringify(db);
    const k = key;
    saveChain = saveChain.then(async () => {
      try {
        if (k) { localStorage.setItem(LS.enc, JSON.stringify(await encryptStr(k, json))); localStorage.removeItem(LS.plain); }
        else localStorage.setItem(LS.plain, json);
      } catch (e) { toast('⚠️ Speichern fehlgeschlagen: ' + (e.message || e)); }
    });
    return saveChain;
  }

  /* ─── UI-Zustand ───────────────────────────────────── */
  const ui = {
    tab: sessionStorage.getItem('pba_tab') || 'home',
    sheet: null,          // { type:'appt'|'customer', id }
    showArchive: false,
    voice: '',
    listening: false,
    copied: {},           // id+kind → true (Hinweis «als … markieren»)
  };
  const S = () => db.settings;
  const locByName = n => S().locations.find(l => l.name === n);

  /* ─── Hilfen ───────────────────────────────────────── */
  function sortAppts(list) { return list.slice().sort((a, b) => ((a.date || '9') + (a.time || '')).localeCompare((b.date || '9') + (b.time || ''))); }
  const isPast = a => a.date && a.time && P.endDT(a) < new Date();
  const getAppt = id => db.appts.find(a => a.id === id);
  const getDraft = id => db.drafts.find(a => a.id === id);
  const getCust = id => db.customers.find(c => c.id === id);
  function custFor(a) {
    if (a.customerId) { const c = getCust(a.customerId); if (c) return c; }
    const n = P.compact(a.name); return n ? db.customers.find(c => P.compact(c.name) === n) : null;
  }
  function msgOpts(a, kind) {
    const loc = locByName(a.location) || {};
    return { contact: loc.contact, address: loc.address, myName: S().myName, extra: kind === 'room' ? S().roomExtra : '', variant: (a.variant || {})[kind] || 0 };
  }
  function genMsg(a, kind) { return kind === 'room' ? P.roomMessage(a, msgOpts(a, kind)) : P.studentMessage(a, msgOpts(a, kind)); }
  function getMsg(a, kind, mode) {
    if (mode === 'plain') return P.plainLine(a);
    const o = a.msg && a.msg[kind];
    return o && o.text != null ? o.text : genMsg(a, kind);
  }
  const msgStale = (a, kind) => { const o = a.msg && a.msg[kind]; return !!(o && o.text != null && o.sig !== P.sigOf(a, kind)); };
  const calStale = a => (a.cal.state === 'ics' || a.cal.state === 'verified') && a.cal.sig !== P.sigOf(a, 'student');
  function touch(a) { a.updatedAt = Date.now(); save(); }
  function setStatus(a, k) {
    if (a.status === k) return;
    a.history.push({ from: a.status, to: k, at: Date.now() });
    a.status = k; touch(a);
    toast('Status: ' + STATUS[k].label);
  }
  function linkCustomer(a) {
    if (!S().customersEnabled) return;
    const c = custFor(a); if (c) a.customerId = c.id;
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (_) {
      const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select(); t.setSelectionRange(0, text.length);
      let ok = false; try { ok = document.execCommand('copy'); } catch (_) { }
      t.remove(); return ok;
    }
  }
  function phoneClean(p) { return String(p || '').replace(/[^\d+]/g, '').replace(/^00/, '+').replace(/^0(\d{9})$/, '+41$1'); }
  function waLink(phone, text) { const p = phoneClean(phone).replace('+', ''); return 'https://wa.me/' + (p || '') + '?text=' + encodeURIComponent(text); }
  function smsLink(phone, text) { return 'sms:' + phoneClean(phone) + '&body=' + encodeURIComponent(text); }

  /* ─── Toast ────────────────────────────────────────── */
  let toastTimer;
  function toast(msg, action) {
    const el = $('#toast');
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (action ? '<button data-act="toast-action">' + esc(action.label) + '</button>' : '');
    el._action = action && action.fn;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), action ? 6000 : 2200);
  }

  /* ─── Icons ────────────────────────────────────────── */
  const I = {
    home: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    msg: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.4 3.6 5.2"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    cal: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 3 2 20h20zM12 10v4M12 17v.5"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  };

  /* ─── Rendering ────────────────────────────────────── */
  const TABS = [
    { k: 'home', label: 'Übersicht', icon: I.home },
    { k: 'new', label: 'Neu', icon: I.plus },
    { k: 'msgs', label: 'Nachrichten', icon: I.msg },
    { k: 'cust', label: 'Kunden', icon: I.people },
    { k: 'set', label: 'Einstellungen', icon: I.gear },
  ];
  function pendingMsgCount() { return db.appts.filter(a => a.status === 'offen' || a.status === 'raum').length; }

  function render() {
    if (!db) return;
    sessionStorage.setItem('pba_tab', ui.tab);
    const views = { home: viewHome, new: viewNew, msgs: viewMsgs, cust: viewCust, set: viewSettings };
    const main = $('#main');
    const scroll = main.scrollTop;
    main.innerHTML = views[ui.tab]();
    if (render.keepScroll) main.scrollTop = scroll; render.keepScroll = false;
    const n = pendingMsgCount();
    $('#tabs').innerHTML = TABS.map(t => `<button class="tab ${ui.tab === t.k ? 'on' : ''}" data-act="tab" data-k="${t.k}">${t.icon}<span>${t.label}</span>${t.k === 'msgs' && n ? `<b class="badge">${n}</b>` : ''}</button>`).join('');
    renderSheet();
  }
  function rerender() { render.keepScroll = true; render(); }

  function chip(a) {
    const st = STATUS[a.status] || STATUS.offen;
    return `<span class="chip st-${a.status}">${esc(st.chip)}</span>`;
  }
  function whenLine(a) {
    if (!a.date) return '<span class="missing">Datum fehlt</span>';
    const rel = P.relDay(a.date);
    return esc((rel ? rel.charAt(0).toUpperCase() + rel.slice(1) + ', ' : '') + P.fmtDateShort(a.date)) + (a.time ? ' · ' + esc(a.time) + '–' + esc(P.endTime(a)) : '');
  }
  function apptCard(a) {
    const conf = ACTIVE(a) ? P.conflictsFor(a, db.appts) : [];
    const past = ACTIVE(a) && isPast(a);
    const flags = [];
    if (conf.length) flags.push(`<span class="flag warn">${I.warn} Überschneidung</span>`);
    if (a.cal.state === 'verified') flags.push(`<span class="flag ok">${I.cal} im Kalender</span>`);
    else if (a.cal.state === 'ics') flags.push(`<span class="flag">${I.cal} ICS ungeprüft</span>`);
    if (calStale(a)) flags.push(`<span class="flag warn">Kalender veraltet</span>`);
    let quick = '';
    if (a.status === 'offen') quick = `<button class="btn sm" data-act="quick-copy" data-id="${a.id}" data-kind="room">${I.copy} Raumanfrage</button>`;
    else if (a.status === 'angefragt') quick = `<button class="btn sm" data-act="set-status" data-id="${a.id}" data-k="raum">${I.check} Raum bestätigt</button>`;
    else if (a.status === 'raum') quick = `<button class="btn sm" data-act="quick-copy" data-id="${a.id}" data-kind="student">${I.copy} Bestätigung</button>`;
    else if (a.status === 'bestaetigt' && past) quick = `<button class="btn sm" data-act="set-status" data-id="${a.id}" data-k="erledigt">${I.check} Abschliessen</button>`;
    else if (a.status === 'bestaetigt' && a.cal.state === 'none') quick = `<button class="btn sm" data-act="ics" data-id="${a.id}">${I.cal} In Kalender</button>`;
    return `<article class="card appt ${a.status === 'storniert' ? 'cancelled' : ''}" data-act="open" data-id="${a.id}">
      <div class="row1"><h3>${esc(a.name || 'Ohne Namen')}</h3>${chip(a)}</div>
      <div class="row2">${whenLine(a)}${past ? ' <span class="muted">· vorbei</span>' : ''}</div>
      <div class="row3">${esc(P.fmtDur(a.duration))} · ${esc(P.placeLabel(a) || 'Ort offen')}</div>
      ${flags.length || quick ? `<div class="row4"><div class="flags">${flags.join('')}</div>${quick}</div>` : ''}
    </article>`;
  }

  function viewHome() {
    const active = sortAppts(db.appts.filter(ACTIVE));
    const archive = sortAppts(db.appts.filter(a => !ACTIVE(a))).reverse();
    const counts = STEPS.slice(0, 4).map(s => [s, active.filter(a => a.status === s.k).length]).filter(([, n]) => n);
    let h = `<header class="top"><h1>Privatlektionen</h1>
      ${counts.length ? `<p class="sum">${counts.map(([s, n]) => `<span>${n} ${esc(s.chip)}</span>`).join('')}</p>` : ''}</header>`;
    if (db.drafts.length) h += `<button class="banner" data-act="tab" data-k="new">${db.drafts.length} erkannte${db.drafts.length > 1 ? '' : 'r'} Termin${db.drafts.length > 1 ? 'e' : ''} noch nicht gespeichert – prüfen</button>`;
    if (!active.length) {
      h += `<div class="empty"><p>Keine offenen Privatlektionen.</p><button class="btn primary" data-act="tab" data-k="new">${I.plus} Neuer Termin</button></div>`;
    } else {
      const due = active.filter(isPast);
      const up = active.filter(a => !isPast(a));
      if (due.length) h += `<h2 class="sec">Vorbei – abschliessen?</h2>` + due.map(apptCard).join('');
      if (up.length) h += `<h2 class="sec">Anstehend</h2>` + up.map(apptCard).join('');
    }
    if (archive.length) {
      h += `<button class="sec-toggle" data-act="toggle-archive">${ui.showArchive ? '▾' : '▸'} Archiv (${archive.length})</button>`;
      if (ui.showArchive) h += archive.map(apptCard).join('');
    }
    return h;
  }

  /* ─── Neuer Termin ─────────────────────────────────── */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const DURS = [45, 60, 75, 90, 120];
  function srcTag(src) {
    if (!src) return '';
    const map = { erkannt: ['erkannt', 'ok'], standard: ['Standard', 'std'], prüfen: ['bitte prüfen', 'chk'], fehlt: ['fehlt', 'bad'] };
    const m = map[src]; return m ? `<span class="src ${m[1]}">${m[0]}</span>` : '';
  }
  function locOptions(sel) {
    const locs = S().locations;
    let h = locs.map(l => `<option value="${esc(l.name)}" ${l.name === sel ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
    if (sel && !locs.some(l => l.name === sel)) h += `<option selected>${esc(sel)}</option>`;
    return `<option value="">– Ort wählen –</option>` + h;
  }
  function roomOptions(locName, sel) {
    const loc = locByName(locName);
    const rooms = loc ? loc.rooms : [];
    let h = `<option value="">egal / noch offen</option>` + rooms.map(r => `<option ${r === sel ? 'selected' : ''}>${esc(r)}</option>`).join('');
    if (sel && !rooms.includes(sel)) h += `<option selected>${esc(sel)}</option>`;
    return h;
  }
  // Gemeinsames Formular für Entwürfe (scope=draft) und gespeicherte Termine (scope=appt)
  function apptForm(a, scope) {
    const src = a.src || {};
    const dl = S().customersEnabled ? `<datalist id="cust-names">${db.customers.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>` : '';
    const f = (k) => `data-scope="${scope}" data-id="${a.id}" data-f="${k}"`;
    const durCustom = !DURS.includes(Number(a.duration));
    return `<div class="form">
      <label class="fld ${!a.name ? 'need' : ''}"><span>Name ${srcTag(src.name)}</span>
        <input ${f('name')} value="${esc(a.name)}" placeholder="Name der Schülerin" autocomplete="off" autocapitalize="words" ${dl ? 'list="cust-names"' : ''}></label>${dl}
      <div class="two">
        <label class="fld ${!a.date ? 'need' : ''}"><span>Datum ${srcTag(src.date)}</span>
          <input type="date" ${f('date')} value="${esc(a.date)}"></label>
        <label class="fld ${!a.time ? 'need' : ''}"><span>Start ${srcTag(src.time)}</span>
          <input type="time" ${f('time')} value="${esc(a.time)}" step="300"></label>
      </div>
      ${a.date ? `<p class="hint">${esc(P.fmtDateLong(a.date))}${a.time ? ', ' + esc(a.time) + '–' + esc(P.endTime(a)) + ' Uhr' : ''}</p>` : ''}
      <div class="fld"><span>Dauer ${srcTag(src.duration)}</span>
        <div class="chips">${DURS.map(d => `<button class="pick ${Number(a.duration) === d ? 'on' : ''}" data-act="pick" data-scope="${scope}" data-id="${a.id}" data-f="duration" data-v="${d}">${d}′</button>`).join('')}
        <input class="mini ${durCustom ? 'on' : ''}" type="number" inputmode="numeric" min="15" max="600" step="5" ${f('duration')} value="${durCustom ? esc(a.duration) : ''}" placeholder="andere"></div></div>
      <div class="two">
        <label class="fld"><span>Ort ${srcTag(src.location)}</span>
          <select ${f('location')}>${locOptions(a.location)}</select></label>
        <label class="fld"><span>Saal ${srcTag(src.room)}</span>
          <select ${f('room')}>${roomOptions(a.location, a.room)}</select></label>
      </div>
      <label class="fld"><span>Interne Notiz</span>
        <textarea ${f('notes')} rows="2" placeholder="optional, nur für dich">${esc(a.notes)}</textarea></label>
      ${scope === 'draft' && S().customersEnabled && a.name && !custFor(a) ? `
        <label class="check"><input type="checkbox" ${f('saveCustomer')} ${a.saveCustomer ? 'checked' : ''}> In Kundenkartei aufnehmen</label>
        ${a.saveCustomer ? `<label class="fld"><span>Telefon (optional)</span><input type="tel" ${f('phone')} value="${esc(a.phone)}" placeholder="+41 …"></label>` : ''}` : ''}
      <div class="derived" id="derived-${a.id}">${derivedBox(a, scope)}</div>
    </div>`;
  }
  function derivedBox(a, scope) {
    const others = scope === 'draft' ? db.appts.concat(db.drafts) : db.appts;
    const conf = P.conflictsFor(a, others);
    if (!conf.length) return '';
    return `<div class="alert warn">${I.warn}<div><b>Überschneidung</b> mit ${conf.map(c => esc((c.name || 'Entwurf') + ' (' + c.time + '–' + P.endTime(c) + ')')).join(', ')}.<br><small>Es wird nichts verändert – du entscheidest. Termine aus Apple Kalender kann die Web-App nicht lesen.</small></div></div>`;
  }

  function refreshDerived(obj, scope) {
    const box = document.getElementById('derived-' + obj.id); if (box) box.innerHTML = derivedBox(obj, scope);
    const btn = $('[data-act="save-drafts"]'); if (btn) btn.textContent = saveLabel();
  }
  function saveLabel() {
    const ready = db.drafts.filter(d => d.name && d.date && d.time).length, n = db.drafts.length;
    return ready === n ? (n > 1 ? `Alle ${n} speichern` : 'Speichern') : `${ready} von ${n} speichern`;
  }
  function viewNew() {
    let h = `<header class="top"><h1>Neuer Termin</h1></header>
    <section class="card voice">
      <p class="lead">Sprich oder tippe einen oder mehrere Termine:</p>
      <textarea id="voice" rows="3" placeholder="«Neue Privatlektion mit Sarah, nächsten Mittwoch um 19 Uhr, 90 Minuten, Säulensaal.»">${esc(ui.voice)}</textarea>
      <div class="voice-actions">
        ${SR ? `<button class="btn mic ${ui.listening ? 'rec' : ''}" data-act="mic">${I.mic} ${ui.listening ? 'Stopp' : 'Sprechen'}</button>` : ''}
        <button class="btn primary" data-act="parse">Erkennen</button>
      </div>
      <p class="hint">${SR ? 'Tipp: Mehrere Termine mit «… und noch eine Privatlektion mit …» oder je eine Zeile.' : 'Tipp: Tippe auf das Mikrofon der iPhone-Tastatur, um zu diktieren. Mehrere Termine je eine Zeile.'}</p>
    </section>
    <button class="btn ghost wide" data-act="blank-draft">${I.plus} Formular ohne Spracheingabe</button>`;
    if (db.drafts.length) {
      h += `<h2 class="sec">Bitte prüfen (${db.drafts.length})</h2>`;
      h += db.drafts.map((d, i) => `<section class="card draft">
        <div class="draft-head"><b>Termin ${i + 1}</b><button class="icon" data-act="drop-draft" data-id="${d.id}" aria-label="Verwerfen">${I.close}</button></div>
        ${d.raw ? `<p class="raw">«${esc(d.raw)}»</p>` : ''}
        ${apptForm(d, 'draft')}</section>`).join('');
      h += `<div class="sticky-save"><button class="btn primary wide" data-act="save-drafts">${saveLabel()}</button></div>`;
    }
    return h;
  }
  function newDraft(extra = {}) {
    return Object.assign({ id: uid(), name: '', date: '', time: '', duration: S().defaultDuration, location: S().defaultLocation || (S().locations[0] || {}).name || '', room: '', notes: '', src: {} }, extra);
  }
  function parseVoice() {
    const text = ($('#voice') || {}).value || ui.voice;
    if (!text.trim()) { toast('Bitte zuerst etwas sprechen oder tippen'); return; }
    const res = P.parseSpeech(text, { locations: S().locations, customers: S().customersEnabled ? db.customers : [], defaultDuration: S().defaultDuration, defaultLocation: S().defaultLocation });
    for (const r of res) db.drafts.push(newDraft({ ...r, id: uid() }));
    ui.voice = ''; save(); render();
    toast(res.length === 1 ? '1 Termin erkannt – bitte prüfen' : res.length + ' Termine erkannt – bitte prüfen');
  }
  function saveDrafts() {
    const ready = db.drafts.filter(d => d.name && d.date && d.time);
    if (!ready.length) { toast('Name, Datum und Startzeit ausfüllen'); return; }
    const conflicts = ready.filter(d => P.conflictsFor(d, db.appts.concat(db.drafts)).length);
    if (conflicts.length && !confirm(`${conflicts.length === 1 ? 'Ein Termin überschneidet' : conflicts.length + ' Termine überschneiden'} sich mit anderen Terminen. Trotzdem speichern?`)) return;
    for (const d of ready) {
      const a = {
        id: d.id, name: d.name.trim(), date: d.date, time: d.time, duration: Number(d.duration) || 60,
        location: d.location, room: d.room, notes: d.notes || '', status: 'offen',
        msg: {}, variant: { room: 0, student: 0 }, cal: { state: 'none' }, history: [{ to: 'offen', at: Date.now() }],
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      if (S().customersEnabled) {
        let c = custFor(a);
        if (!c && d.saveCustomer) { c = { id: uid(), name: a.name, phone: d.phone || '', notes: '', createdAt: Date.now() }; db.customers.push(c); }
        if (c) a.customerId = c.id;
      }
      db.appts.push(a);
    }
    db.drafts = db.drafts.filter(d => !ready.includes(d));
    save();
    ui.tab = db.drafts.length ? 'new' : 'home'; render();
    toast(ready.length === 1 ? 'Termin gespeichert' : ready.length + ' Termine gespeichert', { label: 'Raumanfragen', fn: () => { ui.tab = 'msgs'; render(); } });
  }

  // Spracherkennung
  let rec = null;
  function toggleMic() {
    if (!SR) return;
    if (ui.listening && rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = 'de-CH'; rec.interimResults = true; rec.continuous = true;
    const base = (($('#voice') || {}).value || '').trim();
    let finalText = '';
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      ui.voice = (base ? base + '\n' : '') + (finalText + interim).trim();
      const t = $('#voice'); if (t) t.value = ui.voice;
    };
    rec.onerror = e => { toast(e.error === 'not-allowed' ? 'Mikrofon nicht erlaubt – Diktat der Tastatur verwenden' : 'Spracherkennung: ' + e.error); };
    rec.onend = () => { ui.listening = false; rec = null; const b = $('[data-act="mic"]'); if (b) { b.classList.remove('rec'); b.innerHTML = I.mic + ' Sprechen'; } };
    try { rec.start(); ui.listening = true; const b = $('[data-act="mic"]'); if (b) { b.classList.add('rec'); b.innerHTML = I.mic + ' Stopp'; } }
    catch (e) { toast('Spracherkennung nicht verfügbar – Diktat der Tastatur verwenden'); }
  }

  /* ─── Nachrichten ──────────────────────────────────── */
  function msgCard(a, kind) {
    const mode = S().msgMode;
    const key = a.id + kind;
    const text = getMsg(a, kind, mode);
    const loc = locByName(a.location) || {};
    const c = custFor(a);
    const phone = kind === 'room' ? loc.phone : (c && c.phone);
    const nextK = kind === 'room' ? 'angefragt' : 'bestaetigt';
    const nextL = kind === 'room' ? 'Als «Raum angefragt» markieren' : 'Als «Schülerin bestätigt» markieren';
    return `<article class="card msg" id="msg-${key}">
      <div class="row1"><h3>${esc(a.name)}</h3><span class="muted">${whenLine(a)}</span></div>
      <p class="muted small">${kind === 'room' ? 'An Raumverwaltung ' + esc(a.location || '') + (loc.contact ? ' (' + esc(loc.contact) + ')' : '') : 'An ' + esc(a.name)} · ${esc(P.placeLabel(a))}</p>
      ${msgStale(a, kind) && mode === 'text' ? `<div class="alert warn">${I.warn}<div>Termindaten wurden nach deiner Bearbeitung geändert. <button class="link" data-act="reset-msg" data-id="${a.id}" data-kind="${kind}">Text neu erstellen</button></div></div>` : ''}
      <textarea class="msgtext" data-act-input="msg" data-id="${a.id}" data-kind="${kind}" rows="${mode === 'plain' ? 2 : 7}" ${mode === 'plain' ? 'readonly' : ''}>${esc(text)}</textarea>
      <div class="msg-actions">
        <button class="btn primary" data-act="copy" data-id="${a.id}" data-kind="${kind}">${I.copy} Kopieren</button>
        <a class="btn" href="${esc(waLink(phone, text))}" target="_blank" rel="noopener" data-act="sent" data-id="${a.id}" data-kind="${kind}">WhatsApp</a>
        <a class="btn" href="${esc(smsLink(phone, text))}" data-act="sent" data-id="${a.id}" data-kind="${kind}">SMS</a>
        ${mode === 'text' ? `<button class="btn ghost" data-act="reword" data-id="${a.id}" data-kind="${kind}" title="Neu formulieren">↻</button>` : ''}
      </div>
      ${ui.copied[key] && a.status !== nextK ? `<button class="btn next wide" data-act="set-status" data-id="${a.id}" data-k="${nextK}">${I.check} ${nextL}</button>` : ''}
    </article>`;
  }
  function modeSwitch() {
    const m = S().msgMode;
    return `<div class="seg"><button class="${m === 'text' ? 'on' : ''}" data-act="msg-mode" data-v="text">Nachricht</button><button class="${m === 'plain' ? 'on' : ''}" data-act="msg-mode" data-v="plain">Nur Termin</button></div>`;
  }
  function viewMsgs() {
    const list = sortAppts(db.appts.filter(ACTIVE));
    const room = list.filter(a => a.status === 'offen');
    const wait = list.filter(a => a.status === 'angefragt');
    const stud = list.filter(a => a.status === 'raum');
    let h = `<header class="top"><h1>Nachrichten</h1>${modeSwitch()}</header>`;
    if (!room.length && !stud.length && !wait.length) return h + `<div class="empty"><p>Keine Nachrichten zu verschicken.</p></div>`;
    if (S().msgMode === 'plain' && room.length + stud.length > 1) {
      h += `<button class="btn ghost wide" data-act="copy-all-plain">${I.copy} Alle Termine als Liste kopieren</button>`;
    }
    if (room.length) h += `<h2 class="sec">Raumanfragen (${room.length})</h2>` + room.map(a => msgCard(a, 'room')).join('');
    if (wait.length) h += `<h2 class="sec">Warte auf Raum (${wait.length})</h2>` + wait.map(a => `<div class="card slim"><div><b>${esc(a.name)}</b> <span class="muted">${whenLine(a)} · ${esc(P.placeLabel(a))}</span></div><button class="btn sm" data-act="set-status" data-id="${a.id}" data-k="raum">${I.check} Raum bestätigt</button></div>`).join('');
    if (stud.length) h += `<h2 class="sec">Bestätigungen an Schülerinnen (${stud.length})</h2>` + stud.map(a => msgCard(a, 'student')).join('');
    return h;
  }

  /* ─── Kunden ───────────────────────────────────────── */
  function lessonsOf(c) {
    const n = P.compact(c.name);
    return sortAppts(db.appts.filter(a => a.customerId === c.id || (!a.customerId && P.compact(a.name) === n)));
  }
  function viewCust() {
    let h = `<header class="top"><h1>Kunden</h1></header>`;
    if (!S().customersEnabled) {
      return h + `<div class="card"><p>Die Kundenkartei ist <b>freiwillig</b>. Termine funktionieren auch ohne sie.</p>
        <p class="muted">Mit Kartei: Namen werden beim Erfassen vorgeschlagen, Telefonnummern füllen WhatsApp/SMS automatisch, und du siehst bisherige und letzte Lektionen.</p>
        <button class="btn primary" data-act="cust-enable">Kundenkartei aktivieren</button></div>`;
    }
    h += `<button class="btn ghost wide" data-act="cust-new">${I.plus} Kundin hinzufügen</button>`;
    // Namen aus Terminen, die noch nicht in der Kartei sind
    const names = [...new Set(db.appts.map(a => a.name).filter(n => n && !db.customers.some(c => P.compact(c.name) === P.compact(n))))];
    if (names.length) h += `<p class="hint">Aus Terminen übernehmen: ${names.map(n => `<button class="pick" data-act="cust-from" data-v="${esc(n)}">+ ${esc(n)}</button>`).join(' ')}</p>`;
    const list = db.customers.slice().sort((a, b) => a.name.localeCompare(b.name, 'de'));
    if (!list.length) h += `<div class="empty"><p>Noch keine Kundinnen gespeichert.</p></div>`;
    h += list.map(c => {
      const ls = lessonsOf(c).filter(a => a.status !== 'storniert');
      const past = ls.filter(isPast); const last = past[past.length - 1];
      const next = ls.find(a => !isPast(a));
      return `<article class="card" data-act="open-cust" data-id="${c.id}"><div class="row1"><h3>${esc(c.name)}</h3><span class="muted">${ls.length} Lektion${ls.length === 1 ? '' : 'en'}</span></div>
        <div class="row3">${c.phone ? esc(c.phone) + ' · ' : ''}${last ? 'Zuletzt ' + esc(P.fmtDateShort(last.date)) : 'Noch kein Unterricht'}${next ? ' · Nächste ' + esc(P.fmtDateShort(next.date)) : ''}</div></article>`;
    }).join('');
    return h;
  }

  /* ─── Einstellungen ────────────────────────────────── */
  function viewSettings() {
    const s = S();
    const locked = !!localStorage.getItem(LS.lock);
    const t = s.icsTest;
    return `<header class="top"><h1>Einstellungen</h1></header>
    <section class="card">
      <h2>Allgemein</h2>
      <label class="fld"><span>Dein Name (Unterschrift in Nachrichten)</span><input data-set="myName" value="${esc(s.myName)}" placeholder="optional"></label>
      <div class="fld"><span>Standarddauer</span><div class="chips">${DURS.map(d => `<button class="pick ${s.defaultDuration === d ? 'on' : ''}" data-act="set-dur" data-v="${d}">${d}′</button>`).join('')}</div></div>
      <label class="fld"><span>Standardort</span><select data-set="defaultLocation">${locOptions(s.defaultLocation)}</select></label>
    </section>

    <section class="card">
      <h2>Orte, Säle &amp; Raumverwaltung</h2>
      ${s.locations.map((l, i) => `<div class="loc">
        <div class="loc-head"><input class="loc-name" data-loc="${i}" data-lf="name" value="${esc(l.name)}" placeholder="Ort / Strasse"><button class="icon" data-act="loc-del" data-i="${i}" aria-label="Ort löschen">${I.close}</button></div>
        <label class="fld"><span>Säle (mit Komma getrennt)</span><input data-loc="${i}" data-lf="rooms" value="${esc(l.rooms.join(', '))}"></label>
        <div class="two">
          <label class="fld"><span>Raumverwaltung (Vorname)</span><input data-loc="${i}" data-lf="contact" value="${esc(l.contact)}" placeholder="für «Hoi …»"></label>
          <label class="fld"><span>Telefon Raumverwaltung</span><input type="tel" data-loc="${i}" data-lf="phone" value="${esc(l.phone)}" placeholder="für WhatsApp/SMS"></label>
        </div>
        <label class="fld"><span>Adresse für Schülerinnen (optional)</span><input data-loc="${i}" data-lf="address" value="${esc(l.address)}" placeholder="z.B. Albulastrasse 00, 8048 Zürich"></label>
      </div>`).join('')}
      <button class="btn ghost" data-act="loc-add">${I.plus} Ort hinzufügen</button>
      <label class="fld"><span>Zusatz für jede Raumanfrage (optional)</span><textarea data-set="roomExtra" rows="2" placeholder="z.B. «Ich bräuchte die Musikanlage.»">${esc(s.roomExtra)}</textarea></label>
    </section>

    <section class="card">
      <h2>Apple Kalender</h2>
      <label class="fld"><span>Zielkalender (Name in Apple Kalender)</span><input data-set="calendarName" value="${esc(s.calendarName)}"></label>
      <p class="muted small">Die App erzeugt eine ICS-Datei. Eine Web-App kann den Zielkalender nicht selbst wählen und keine bestehenden Einträge lesen. Welcher Kalender verwendet wird, entscheidet iOS – deshalb wird jeder Eintrag erst als «ungeprüft» geführt, bis du ihn bestätigst.</p>
      <div class="alert ${t ? (t.ok ? 'ok' : 'warn') : 'info'}">${I.cal}<div>${t ? (t.ok ? `Getestet am ${esc(new Date(t.at).toLocaleDateString('de-CH'))}: Termin landete im Kalender «${esc(s.calendarName)}».` : `Getestet am ${esc(new Date(t.at).toLocaleDateString('de-CH'))}: Termin landete in einem <b>anderen</b> Kalender. Siehe Tipp unten.`) : '<b>Noch nicht getestet.</b> Öffne einmal den Test-Termin auf dem iPhone und prüfe, in welchem Kalender er landet.'}</div></div>
      <div class="btnrow"><button class="btn" data-act="ics-test">${I.cal} Test-Termin öffnen</button></div>
      <div class="btnrow"><button class="btn sm" data-act="ics-test-ok">Landete im richtigen Kalender</button><button class="btn sm" data-act="ics-test-bad">Landete woanders</button></div>
      <details><summary>Tipp: gelben Kalender sicherstellen</summary>
        <ol class="small">
          <li>iPhone <b>Einstellungen → Apps → Kalender → Standardkalender</b> auf «${esc(s.calendarName)}» setzen. Neue Termine aus ICS-Dateien landen dann normalerweise dort.</li>
          <li>Zeigt iOS beim Hinzufügen eine Kalenderauswahl, dort «${esc(s.calendarName)}» wählen.</li>
          <li>Danach in Apple Kalender kurz prüfen und in der App «Im Kalender geprüft» tippen.</li>
        </ol>
        <p class="small muted">Soll die Auswahl ohne Prüfung zuverlässig automatisch klappen, braucht es eine native Lösung (z.B. Apple-Kurzbefehl oder eigene iOS-App).</p>
      </details>
    </section>

    <section class="card">
      <h2>Kundenkartei</h2>
      <label class="switch"><input type="checkbox" data-act="cust-toggle" ${s.customersEnabled ? 'checked' : ''}><span>Kundenkartei verwenden (freiwillig)</span></label>
    </section>

    <section class="card">
      <h2>Zugriffsschutz</h2>
      ${cryptoOK ? (locked
        ? `<p class="small">${I.lock} PIN aktiv – Daten sind auf diesem Gerät verschlüsselt gespeichert. Sperre nach ${s.lockMinutes} Min. im Hintergrund.</p>
           <div class="btnrow"><button class="btn" data-act="pin-change">PIN ändern</button><button class="btn" data-act="lock-now">Jetzt sperren</button><button class="btn danger" data-act="pin-remove">PIN entfernen</button></div>`
        : `<p class="small muted">Ohne PIN liegen die Daten unverschlüsselt im Speicher dieses Browsers.</p><button class="btn primary" data-act="pin-set">${I.lock} PIN festlegen</button>`)
      : '<p class="small muted">Verschlüsselung ist nur über https verfügbar.</p>'}
    </section>

    <section class="card">
      <h2>Daten</h2>
      <p class="small muted">Alle Daten bleiben auf diesem Gerät. Mach ab und zu ein Backup (z.B. in iCloud Drive) – auch für den Umzug auf ein neues iPhone.</p>
      <div class="btnrow"><button class="btn" data-act="backup">Backup sichern</button><label class="btn">Backup laden<input type="file" accept="application/json,.json" data-act-change="restore" hidden></label></div>
      <p class="small muted" id="persist-info"></p>
      <button class="btn danger ghost" data-act="wipe">Alle Daten löschen</button>
    </section>
    <p class="foot">Private Booking Assistant · v1</p>`;
  }

  /* ─── Detail-Sheet ─────────────────────────────────── */
  function renderSheet() {
    const el = $('#sheet');
    if (!ui.sheet) { el.classList.remove('open'); el.innerHTML = ''; document.body.classList.remove('sheet-open'); return; }
    let body = '';
    if (ui.sheet.type === 'appt') {
      const a = getAppt(ui.sheet.id); if (!a) { ui.sheet = null; return renderSheet(); }
      body = sheetAppt(a);
    } else if (ui.sheet.type === 'customer') {
      const c = getCust(ui.sheet.id); if (!c) { ui.sheet = null; return renderSheet(); }
      body = sheetCust(c);
    }
    const scroll = el.querySelector('.sheet-body') ? el.querySelector('.sheet-body').scrollTop : 0;
    el.innerHTML = `<div class="sheet-bg" data-act="close-sheet"></div><div class="sheet-panel"><div class="sheet-bar"><button class="icon" data-act="close-sheet" aria-label="Schliessen">${I.close}</button></div><div class="sheet-body">${body}</div></div>`;
    if (sheetKeep) el.querySelector('.sheet-body').scrollTop = scroll; sheetKeep = false;
    el.classList.add('open'); document.body.classList.add('sheet-open');
  }
  let sheetKeep = false;
  function rerenderSheet() { sheetKeep = true; renderSheet(); }

  function sheetAppt(a) {
    const st = STATUS[a.status];
    const steps = STEPS.map((s, i) => `<button class="step ${a.status !== 'storniert' && st.i >= i ? 'done' : ''} ${a.status === s.k ? 'cur' : ''}" data-act="set-status" data-id="${a.id}" data-k="${s.k}"><i>${i + 1}</i><span>${esc(s.label)}${s.sub ? `<small>${esc(s.sub)}</small>` : ''}</span></button>`).join('');
    const showStudent = st.i >= 2 || a.status === 'storniert';
    return `<h2 class="sheet-title">${esc(a.name || 'Privatlektion')} ${chip(a)}</h2>
      <section class="block"><h3>Status</h3><div class="steps">${steps}</div>
        <div class="btnrow">${a.status === 'storniert' ? `<button class="btn" data-act="set-status" data-id="${a.id}" data-k="offen">Reaktivieren</button>` : `<button class="btn danger ghost sm" data-act="set-status" data-id="${a.id}" data-k="storniert">Stornieren</button>`}</div></section>
      <section class="block"><h3>Termin</h3>${apptForm(a, 'appt')}</section>
      <section class="block" id="sheet-msgs"><h3>Nachrichten</h3>${modeSwitch()}
        ${msgCard(a, 'room')}
        ${showStudent ? msgCard(a, 'student') : '<p class="muted small">Die Bestätigung an die Schülerin wird erstellt, sobald der Raum bestätigt ist.</p>'}</section>
      <section class="block" id="sheet-cal"><h3>Apple Kalender</h3>${calBox(a)}</section>
      <section class="block"><button class="btn danger ghost wide" data-act="delete" data-id="${a.id}">Termin löschen</button></section>`;
  }
  function calBox(a) {
    const s = S();
    let state = '';
    if (a.cal.state === 'none') state = `<div class="alert info">${I.cal}<div>Noch nicht im Kalender.${STATUS[a.status].i < 2 ? ' <small>(Empfohlen nach Raumbestätigung.)</small>' : ''}</div></div>`;
    if (a.cal.state === 'ics') state = `<div class="alert warn">${I.cal}<div><b>ICS übergeben</b> am ${esc(new Date(a.cal.at).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' }))} – Zielkalender <b>noch nicht geprüft</b>.<br><small>Schau in Apple Kalender nach, ob «Privatlektion – ${esc(a.name)}» im Kalender «${esc(s.calendarName)}» liegt.</small></div></div>
      <div class="btnrow"><button class="btn primary sm" data-act="cal-verify" data-id="${a.id}">${I.check} Im Kalender «${esc(s.calendarName)}» geprüft</button><button class="btn sm" data-act="cal-reset" data-id="${a.id}">Nicht angekommen</button></div>`;
    if (a.cal.state === 'verified') state = `<div class="alert ok">${I.check}<div>Von dir geprüft: im Kalender «${esc(a.cal.calendar || s.calendarName)}» (${esc(new Date(a.cal.at).toLocaleDateString('de-CH'))}).</div></div>`;
    if (calStale(a)) state += `<div class="alert warn">${I.warn}<div><b>Termin wurde danach geändert.</b> Den alten Eintrag in Apple Kalender bitte anpassen oder löschen und neu übernehmen.</div></div>`;
    return state + `<div class="btnrow"><button class="btn" data-act="ics" data-id="${a.id}" ${a.date && a.time ? '' : 'disabled'}>${I.cal} ${a.cal.state === 'none' ? 'In Apple Kalender übernehmen' : 'Erneut übergeben'}</button></div>`;
  }
  function sheetCust(c) {
    const ls = lessonsOf(c);
    return `<h2 class="sheet-title">${esc(c.name)}</h2>
      <section class="block">
        <label class="fld"><span>Name</span><input data-cust="${c.id}" data-cf="name" value="${esc(c.name)}"></label>
        <label class="fld"><span>Telefon</span><input type="tel" data-cust="${c.id}" data-cf="phone" value="${esc(c.phone)}" placeholder="+41 …"></label>
        <label class="fld"><span>Notiz</span><textarea data-cust="${c.id}" data-cf="notes" rows="2">${esc(c.notes)}</textarea></label>
        ${c.phone ? `<div class="btnrow"><a class="btn sm" href="tel:${esc(phoneClean(c.phone))}">Anrufen</a><a class="btn sm" href="${esc(waLink(c.phone, ''))}" target="_blank" rel="noopener">WhatsApp</a></div>` : ''}
      </section>
      <section class="block"><h3>Lektionen (${ls.length})</h3>
        <button class="btn primary sm" data-act="cust-lesson" data-id="${c.id}">${I.plus} Neue Lektion mit ${esc(c.name.split(' ')[0])}</button>
        ${ls.slice().reverse().map(a => `<div class="lesson" data-act="open" data-id="${a.id}"><span>${esc(P.fmtDateShort(a.date))} ${esc(a.time)}</span><span class="muted">${esc(P.placeLabel(a))}</span>${chip(a)}</div>`).join('') || '<p class="muted small">Noch keine Lektionen.</p>'}
      </section>
      <section class="block"><button class="btn danger ghost wide" data-act="cust-del" data-id="${c.id}">Aus Kartei löschen</button><p class="muted small">Termine bleiben erhalten.</p></section>`;
  }

  /* ─── ICS übergeben ────────────────────────────────── */
  function addrFor(a) { const l = locByName(a.location); return l && l.address; }
  async function openICS(list, filename) {
    const ics = P.buildICS(list, { addressFor: addrFor });
    const file = new File([ics], filename, { type: 'text/calendar' });
    const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    // iOS Safari: data-URL öffnet direkt die Kalender-Vorschau. Als Home-Bildschirm-App über Teilen-Menü.
    if (standalone && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
    }
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS) { location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics); return true; }
    const url = URL.createObjectURL(file);
    const aEl = document.createElement('a'); aEl.href = url; aEl.download = filename; document.body.appendChild(aEl); aEl.click(); aEl.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  }
  async function icsFor(a) {
    if (a.cal.state !== 'none') a.icsSeq = (a.icsSeq || 0) + 1;
    const ok = await openICS([a], 'Privatlektion-' + (a.name || 'Termin').replace(/[^\wäöüÄÖÜ-]+/g, '_') + '-' + a.date + '.ics');
    if (!ok) return;
    a.cal = { state: 'ics', at: Date.now(), sig: P.sigOf(a, 'student') };
    touch(a); rerender();
  }

  /* ─── Aktionen ─────────────────────────────────────── */
  const A = {
    'tab': t => { ui.tab = t.dataset.k; ui.sheet = null; $('#main').scrollTop = 0; render(); },
    'open': t => { ui.sheet = { type: 'appt', id: t.dataset.id }; renderSheet(); },
    'open-cust': t => { ui.sheet = { type: 'customer', id: t.dataset.id }; renderSheet(); },
    'close-sheet': () => { ui.sheet = null; rerender(); },
    'toggle-archive': () => { ui.showArchive = !ui.showArchive; rerender(); },
    'toast-action': () => { const el = $('#toast'); el.classList.remove('show'); el._action && el._action(); },
    'set-status': t => { const a = getAppt(t.dataset.id); if (!a) return; if (t.dataset.k === 'storniert' && !confirm('Termin stornieren?')) return; setStatus(a, t.dataset.k); rerender(); },
    'quick-copy': async t => {
      const a = getAppt(t.dataset.id); const kind = t.dataset.kind;
      const ok = await copyText(getMsg(a, kind, S().msgMode));
      const nextK = kind === 'room' ? 'angefragt' : 'bestaetigt';
      toast(ok ? (kind === 'room' ? 'Raumanfrage kopiert' : 'Bestätigung kopiert') : 'Kopieren nicht möglich',
        ok ? { label: kind === 'room' ? 'Als angefragt markieren' : 'Als bestätigt markieren', fn: () => { setStatus(a, nextK); rerender(); } } : null);
    },
    'copy': async t => {
      const a = getAppt(t.dataset.id); const kind = t.dataset.kind;
      const box = t.closest('.msg').querySelector('.msgtext');
      const ok = await copyText(box ? box.value : getMsg(a, kind, S().msgMode));
      if (!ok) { toast('Kopieren nicht möglich – Text markieren und kopieren'); return; }
      ui.copied[a.id + kind] = true;
      toast('Kopiert ✓');
      if (ui.sheet) rerenderSheet(); else rerender();
    },
    'sent': t => { ui.copied[t.dataset.id + t.dataset.kind] = true; setTimeout(() => (ui.sheet ? rerenderSheet() : rerender()), 400); return 'default'; },
    'copy-all-plain': async () => {
      const list = sortAppts(db.appts.filter(a => a.status === 'offen' || a.status === 'raum'));
      const ok = await copyText(list.map(a => P.plainLine(a, { withName: true })).join('\n'));
      toast(ok ? list.length + ' Termine kopiert' : 'Kopieren nicht möglich');
    },
    'reword': t => { const a = getAppt(t.dataset.id); const k = t.dataset.kind; a.variant[k] = (a.variant[k] || 0) + 1; delete a.msg[k]; touch(a); ui.sheet ? rerenderSheet() : rerender(); },
    'reset-msg': t => { const a = getAppt(t.dataset.id); delete a.msg[t.dataset.kind]; touch(a); ui.sheet ? rerenderSheet() : rerender(); },
    'msg-mode': t => { S().msgMode = t.dataset.v; save(); ui.sheet ? rerenderSheet() : rerender(); },
    'mic': toggleMic,
    'parse': parseVoice,
    'blank-draft': () => { db.drafts.push(newDraft({ src: {} })); save(); rerender(); setTimeout(() => { const els = document.querySelectorAll('.draft'); const last = els[els.length - 1]; if (last) { last.scrollIntoView({ behavior: 'smooth' }); const i = last.querySelector('input'); i && i.focus(); } }, 50); },
    'drop-draft': t => { db.drafts = db.drafts.filter(d => d.id !== t.dataset.id); save(); rerender(); },
    'save-drafts': saveDrafts,
    'pick': t => {
      const obj = t.dataset.scope === 'draft' ? getDraft(t.dataset.id) : getAppt(t.dataset.id);
      obj[t.dataset.f] = Number(t.dataset.v); if (obj.src) obj.src[t.dataset.f] = '';
      t.dataset.scope === 'appt' ? touch(obj) : save();
      ui.sheet ? rerenderSheet() : rerender();
    },
    'ics': t => { const a = getAppt(t.dataset.id); if (a) icsFor(a); },
    'cal-verify': t => { const a = getAppt(t.dataset.id); a.cal = { state: 'verified', at: Date.now(), sig: a.cal.sig, calendar: S().calendarName }; touch(a); rerenderSheet(); toast('Als geprüft markiert'); },
    'cal-reset': t => { const a = getAppt(t.dataset.id); a.cal = { state: 'none' }; touch(a); rerenderSheet(); },
    'delete': t => { if (!confirm('Termin endgültig löschen?')) return; db.appts = db.appts.filter(a => a.id !== t.dataset.id); save(); ui.sheet = null; rerender(); toast('Gelöscht'); },
    'cust-enable': () => { S().customersEnabled = true; save(); rerender(); },
    'cust-new': () => { const c = { id: uid(), name: 'Neue Kundin', phone: '', notes: '', createdAt: Date.now() }; db.customers.push(c); save(); ui.sheet = { type: 'customer', id: c.id }; rerender(); setTimeout(() => { const i = $('#sheet input'); i && (i.select(), i.focus()); }, 60); },
    'cust-from': t => { const n = t.dataset.v; const c = { id: uid(), name: n, phone: '', notes: '', createdAt: Date.now() }; db.customers.push(c); db.appts.forEach(a => { if (P.compact(a.name) === P.compact(n)) a.customerId = c.id; }); save(); rerender(); },
    'cust-del': t => { if (!confirm('Aus der Kartei löschen? Termine bleiben erhalten.')) return; db.customers = db.customers.filter(c => c.id !== t.dataset.id); db.appts.forEach(a => { if (a.customerId === t.dataset.id) delete a.customerId; }); save(); ui.sheet = null; rerender(); },
    'cust-lesson': t => { const c = getCust(t.dataset.id); db.drafts.push(newDraft({ name: c.name, customerId: c.id, src: { name: '' } })); save(); ui.sheet = null; ui.tab = 'new'; render(); },
    'set-dur': t => { S().defaultDuration = Number(t.dataset.v); save(); rerender(); },
    'loc-add': () => { S().locations.push({ id: uid(), name: '', contact: '', phone: '', address: '', rooms: [] }); save(); rerender(); },
    'loc-del': t => { const l = S().locations[t.dataset.i]; if (!confirm(`Ort «${l.name}» löschen? Bestehende Termine behalten den Namen.`)) return; S().locations.splice(t.dataset.i, 1); save(); rerender(); },
    'ics-test': () => {
      const d = new Date(); d.setDate(d.getDate() + 1);
      openICS([{ id: 'test-' + uid(), name: 'TEST (bitte löschen)', date: P.isoDate(d), time: '12:00', duration: 15, location: '', room: '', notes: 'Test des Private Booking Assistant. Prüfe den Kalender und lösche diesen Eintrag.' }], 'Test-Privatlektion.ics');
    },
    'ics-test-ok': () => { S().icsTest = { ok: true, at: Date.now() }; save(); rerender(); },
    'ics-test-bad': () => { S().icsTest = { ok: false, at: Date.now() }; save(); rerender(); },
    'pin-set': () => pinFlow('set'),
    'pin-change': () => pinFlow('change'),
    'pin-remove': async () => { if (!confirm('PIN entfernen? Daten werden danach unverschlüsselt gespeichert.')) return; key = null; localStorage.removeItem(LS.lock); localStorage.removeItem(LS.enc); await save(); rerender(); toast('PIN entfernt'); },
    'lock-now': () => lockApp(),
    'backup': async () => {
      const json = JSON.stringify(db, null, 1);
      const name = 'privatlektionen-backup-' + todayISO() + '.json';
      const file = new File([json], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; } }
      const url = URL.createObjectURL(file); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    },
    'wipe': () => { if (!confirm('Wirklich ALLE Daten auf diesem Gerät löschen?')) return; if (!confirm('Sicher? Ohne Backup ist das nicht rückgängig zu machen.')) return; Object.values(LS).forEach(k => localStorage.removeItem(k)); key = null; db = migrate(null); save(); ui.tab = 'home'; render(); toast('Alle Daten gelöscht'); },
  };

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t || !db) return;
    if (t.tagName === 'INPUT' && t.type === 'checkbox') return; // via change
    const fn = A[t.dataset.act]; if (!fn) return;
    if (t.closest('.card.appt') && t !== t.closest('.card.appt') && t.dataset.act !== 'open') e.stopPropagation();
    const r = fn(t, e);
    if (r !== 'default' && t.tagName !== 'A') e.preventDefault();
  });

  // Formularfelder
  function onField(t, commit) {
    if (t.dataset.f) {
      const obj = t.dataset.scope === 'draft' ? getDraft(t.dataset.id) : getAppt(t.dataset.id);
      if (!obj) return;
      const f = t.dataset.f;
      let v = t.type === 'checkbox' ? t.checked : t.value;
      if (f === 'duration') { v = Number(v); if (!v || v < 5) return; }
      obj[f] = v;
      if (f === 'location') { obj.room = ''; }
      if (obj.src && f in obj.src) obj.src[f] = '';
      if (t.dataset.scope === 'appt') { if (f === 'name') linkCustomer(obj); touch(obj); } else save();
      if ((commit && ['date', 'time'].includes(f)) || ['location', 'room', 'saveCustomer'].includes(f)) {
        if (t.dataset.scope === 'appt') rerenderSheet(); else rerender();
      } else refreshDerived(obj, t.dataset.scope);
      return;
    }
    if (t.dataset.set) { S()[t.dataset.set] = t.value; save(); if (commit && t.dataset.set === 'calendarName') rerender(); return; }
    if (t.dataset.loc != null) {
      const l = S().locations[t.dataset.loc]; const lf = t.dataset.lf;
      if (lf === 'rooms') l.rooms = t.value.split(',').map(s => s.trim()).filter(Boolean);
      else if (lf === 'name') {
        const old = l.name; l.name = t.value.trim();
        if (commit && old && old !== l.name) { db.appts.forEach(a => { if (a.location === old) a.location = l.name; }); if (S().defaultLocation === old) S().defaultLocation = l.name; }
      } else l[lf] = t.value;
      save(); return;
    }
    if (t.dataset.cust) {
      const c = getCust(t.dataset.cust); c[t.dataset.cf] = t.value; save();
      if (commit && t.dataset.cf === 'name') rerenderSheet();
      return;
    }
    if (t.dataset.actInput === 'msg') {
      const a = getAppt(t.dataset.id); const k = t.dataset.kind;
      if (S().msgMode !== 'text') return;
      a.msg[k] = { text: t.value, sig: P.sigOf(a, k) }; touch(a);
      return;
    }
    if (t.id === 'voice') { ui.voice = t.value; }
  }
  document.addEventListener('input', e => { if (db) onField(e.target, false); });
  document.addEventListener('change', async e => {
    if (!db) return;
    const t = e.target;
    if (t.dataset.act === 'cust-toggle') { S().customersEnabled = t.checked; save(); rerender(); return; }
    if (t.dataset.actChange === 'restore') {
      const f = t.files[0]; if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!data || !Array.isArray(data.appts)) throw new Error('Keine gültige Backup-Datei');
        if (!confirm(`Backup vom ${f.name} laden? ${data.appts.length} Termine. Die aktuellen Daten werden ersetzt.`)) return;
        db = migrate(data); await save(); render(); toast('Backup geladen');
      } catch (err) { toast('Fehler: ' + err.message); }
      t.value = ''; return;
    }
    onField(t, true);
  });

  /* ─── PIN / Sperre ─────────────────────────────────── */
  function lockScreen(mode, msg) {
    const el = $('#lock');
    const titles = { unlock: 'Entsperren', set: 'Neue PIN', confirm: 'PIN wiederholen', old: 'Aktuelle PIN' };
    el.innerHTML = `<form class="lock-box" data-mode="${mode}">${I.lock}<h2>${titles[mode]}</h2>
      <input type="password" inputmode="numeric" autocomplete="${mode === 'unlock' || mode === 'old' ? 'current-password' : 'new-password'}" pattern="[0-9]*" minlength="4" maxlength="12" id="pin" required placeholder="mind. 4 Ziffern">
      <p class="lock-msg">${esc(msg || '')}</p>
      <button class="btn primary wide" type="submit">${mode === 'unlock' ? 'Entsperren' : 'Weiter'}</button>
      ${mode !== 'unlock' ? '<button class="btn ghost wide" type="button" data-lock-cancel>Abbrechen</button>' : '<p class="small muted">PIN vergessen? Daten lassen sich nur mit einem Backup wiederherstellen.</p>'}
    </form>`;
    el.classList.add('open');
    setTimeout(() => $('#pin') && $('#pin').focus(), 50);
    return el;
  }
  function closeLock() { const el = $('#lock'); el.classList.remove('open'); el.innerHTML = ''; }
  function askPin(mode, msg) {
    return new Promise(res => {
      const el = lockScreen(mode, msg);
      const form = el.querySelector('form');
      form.onsubmit = e => { e.preventDefault(); res($('#pin').value); };
      const c = el.querySelector('[data-lock-cancel]'); if (c) c.onclick = () => res(null);
    });
  }
  async function pinFlow(kind) {
    if (kind === 'change') {
      const old = await askPin('old'); if (old == null) return closeLock();
      try { const k = await deriveKey(old, unb64(lockMeta.salt), lockMeta.iter); await decryptStr(k, JSON.parse(localStorage.getItem(LS.enc))); }
      catch (_) { closeLock(); toast('Falsche PIN'); return; }
    }
    let msg = '';
    for (; ;) {
      const p1 = await askPin('set', msg); if (p1 == null) return closeLock();
      if (!/^\d{4,12}$/.test(p1)) { msg = 'Bitte 4–12 Ziffern.'; continue; }
      const p2 = await askPin('confirm'); if (p2 == null) return closeLock();
      if (p1 !== p2) { msg = 'Die PINs stimmen nicht überein.'; continue; }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iter = 250000;
      key = await deriveKey(p1, salt, iter);
      lockMeta = { salt: b64(salt), iter };
      localStorage.setItem(LS.lock, JSON.stringify(lockMeta));
      await save();
      closeLock(); rerender(); toast('PIN aktiv – Daten verschlüsselt');
      return;
    }
  }
  async function unlockLoop() {
    let msg = '';
    for (; ;) {
      const pin = await askPin('unlock', msg);
      try {
        const k = await deriveKey(pin, unb64(lockMeta.salt), lockMeta.iter);
        const raw = localStorage.getItem(LS.enc);
        const data = raw ? JSON.parse(await decryptStr(k, JSON.parse(raw))) : null;
        key = k; db = migrate(data); closeLock(); render(); afterReady(); return;
      } catch (_) { msg = 'Falsche PIN.'; }
    }
  }
  function lockApp() {
    if (!localStorage.getItem(LS.lock)) return;
    save().then(() => { db = null; key = null; ui.sheet = null; $('#main').innerHTML = ''; renderSheet(); unlockLoop(); });
  }
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); if (db) save(); }
    else if (key && db && hiddenAt && Date.now() - hiddenAt > (S().lockMinutes || 5) * 60000) lockApp();
  });

  /* ─── Start ────────────────────────────────────────── */
  async function afterReady() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        const p = await navigator.storage.persisted() || await navigator.storage.persist();
        const el = $('#persist-info'); if (el) el.textContent = p ? 'Speicher ist als dauerhaft markiert.' : '';
      }
    } catch (_) { }
  }
  async function init() {
    const lockRaw = localStorage.getItem(LS.lock);
    if (lockRaw && cryptoOK) { lockMeta = JSON.parse(lockRaw); unlockLoop(); }
    else {
      let data = null;
      try { data = JSON.parse(localStorage.getItem(LS.plain)); } catch (_) { }
      db = migrate(data);
      if (!data) save();
      render(); afterReady();
    }
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => { });
  }
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.sheet) { ui.sheet = null; rerender(); } });
  init();
})();
