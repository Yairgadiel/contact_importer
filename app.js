
  (function () {
    'use strict';

    const STORAGE_KEY = 'contact_importer_schema_v1';
    const API_URL = '/api/scan';

    const STANDARD_FIELDS = [
      { key: 'first_name', textKey: 'fields.first_name' },
      { key: 'last_name', textKey: 'fields.last_name' },
      { key: 'phone', textKey: 'fields.phone' },
      { key: 'email', textKey: 'fields.email' },
      { key: 'organization', textKey: 'fields.organization' },
      { key: 'title', textKey: 'fields.title' },
      { key: 'address', textKey: 'fields.address' },
      { key: 'notes', textKey: 'fields.notes' },
    ];

    // ---- schema state ----
    let schema = loadSchema();

    function defaultSchema() {
      const standards = {};
      STANDARD_FIELDS.forEach((f) => { standards[f.key] = true; });
      return { standards: standards, customs: [] };
    }

    function loadSchema() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const s = JSON.parse(raw);
          const out = { standards: {}, customs: [] };
          STANDARD_FIELDS.forEach(function (f) {
            out.standards[f.key] =
              s.standards && typeof s.standards[f.key] === 'boolean' ? s.standards[f.key] : true;
          });
          if (Array.isArray(s.customs)) {
            s.customs.forEach(function (c) {
              if (c && typeof c.label === 'string') {
                out.customs.push({
                  key: c.key || '',
                  label: c.label.trim(),
                  description: c.description || '',
                  xname: c.xname || '',
                });
              }
            });
          }
          return out;
        }
      } catch (e) { /* ignore */ }
      return defaultSchema();
    }

    function saveSchema() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(schema)); }
      catch (e) { toast(t('toast.storage_error')); }
    }

    function activeTargets() {
      const out = [];
      STANDARD_FIELDS.forEach(function (s) {
        if (schema.standards[s.key]) out.push({ key: s.key, label: t(s.textKey), type: 'standard', xname: '' });
      });
      schema.customs.forEach(function (c) {
        if (c.key && c.label.trim()) out.push({ key: c.key, label: c.label.trim(), type: 'custom', xname: c.xname });
      });
      return out;
    }

    function nextCustomKey() {
      let n = 1;
      const used = new Set(schema.customs.map(function (c) { return c.key; }));
      while (used.has('custom_' + n)) n += 1;
      return 'custom_' + n;
    }

    // ---- smart default mapping ----
    function smartTarget(text) {
      const t = (text || '').trim();
      if (!t) return 'ignore';

      const core = t
        .replace(/^(טלפון|טל\.?|פלאפון|נייד|פקס|אימייל|מייל|דוא"ל|דואר אלקטרוני|שם|שם מלא|איש קשר)\s*[:.\-–]\s*/i, '')
        .trim();

      if (/^[\w.!#$%&'*+/=?^_`{|}~-]+@[\w-]+(\.[\w-]+)+$/i.test(core)) return 'email';
      if (/^\+?[\d\s\-()./]{7,}$/.test(core) && /\d/.test(core)) return 'phone';
      if (/^(https?:\/\/|www\.)/i.test(core)) return 'notes';

      if (/(בע"מ|ע"מ|Ltd|Inc|Corp|LLC|Company|Group|הסתדרות|מועצה|ארגון|עמותה)/i.test(t)) return 'organization';
      if (/(מנכ"ל|סמנכ"ל|מנהל|מנהלת|ראש|אחראי|מהנדס|מעצב|מפתח|מתכנת|אנליסט|יועץ|רואה חשבון|גזבר|רכז|קצין|עורך דין|מרצה|מדריך|בקר|דירקטור|בעלים|נשיא|סגן|מזכיר)/i.test(t)) return 'title';

      const hasHeb = /[\u0590-\u05FF]/.test(t);
      const hasDig = /\d/.test(t);
      if (hasHeb && hasDig && t.length > 12) return 'address';

      if (/(רחוב|שדרות|כביש|דרך|עיר|יישוב|מושב|קיבוץ|אזור|ת"ד|מיקוד|דירה|בניין|קומה)/i.test(t)) return 'address';

      return 'first_name';
    }

    function initialTarget(text) {
      const t = smartTarget(text);
      const exists = activeTargets().some(function (x) { return x.key === t; });
      return exists ? t : 'ignore';
    }

    function mergeStandalonePrefixes(contact) {
      const isPrefix = function (t) {
        return /^0\d{1,2}$/.test(t.trim());
      };
      const out = [];
      const lines = contact.lines;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const txt = (line.text || '').trim();
        if (isPrefix(txt) && i + 1 < lines.length) {
          const next = lines[i + 1];
          const nextClean = (next.text || '').replace(/[^\d]/g, '');
          if (/^\d{5,8}$/.test(nextClean) && !nextClean.startsWith('0')) {
            const merged = txt + nextClean;
            const phoneActive = activeTargets().some(function (x) { return x.key === 'phone'; });
            out.push({ id: line.id, text: merged, target: phoneActive ? 'phone' : initialTarget(merged) });
            i += 1;
            continue;
          }
        }
        out.push(line);
      }
      return { id: contact.id, lines: out };
    }

    // ---- DOM refs ----
    const fileInput = document.getElementById('fileInput');
    const cameraInput = document.getElementById('cameraInput');
    const cameraBtn = document.getElementById('cameraBtn');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const preview = document.getElementById('preview');
    const dropzone = document.getElementById('dropzone');
    const resultsSection = document.getElementById('resultsSection');
    const scanSection = document.getElementById('scanSection');
    const statusEl = document.getElementById('status');
    const spinner = document.getElementById('spinner');
    const toastInner = document.getElementById('toastInner');

    let selectedFile = null;
    let mappingContacts = [];
    let modalOpen = false;
    let snapshot = null;
    let toastTimer = null;

    // ---- image handling ----
    function loadImage(file) {
      return new Promise(function (resolve, reject) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error(t('status.image_read_error'))); };
        img.src = url;
      });
    }

    async function fileToBase64Jpeg(file) {
      const img = await loadImage(file);
      const MAX = 1600;
      const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.filter = 'contrast(150%) brightness(110%)';
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL('image/jpeg', 0.85);
    }

    function setFile(file) {
      if (!file || !file.type || !file.type.startsWith('image/')) {
        toast(t('toast.not_image'));
        return;
      }
      selectedFile = file;
      if (preview.src) URL.revokeObjectURL(preview.src);
      preview.src = URL.createObjectURL(file);
      preview.classList.remove('hidden');
      analyzeBtn.disabled = false;
    }

    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files[0]) setFile(fileInput.files[0]);
    });
    cameraInput.addEventListener('change', function () {
      if (cameraInput.files && cameraInput.files[0]) setFile(cameraInput.files[0]);
    });
    dropzone.addEventListener('click', function () { fileInput.click(); });
    cameraBtn.addEventListener('click', function () { cameraInput.click(); });

    document.addEventListener('paste', function (e) {
      if (modalOpen) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) {
          const f = items[i].getAsFile();
          if (f) { setFile(f); toast(t('toast.pasted')); break; }
        }
      }
    });

    // ---- status helpers ----
    function setStatus(msg, isError) {
      if (!msg) {
        statusEl.classList.add('hidden');
        statusEl.textContent = '';
        return;
      }
      statusEl.textContent = msg;
      statusEl.className = 'mt-3 text-sm ' + (isError ? 'text-rose-400' : 'text-cyan-300');
      statusEl.classList.remove('hidden');
    }

    function setLoading(on) {
      spinner.style.display = on ? 'flex' : 'none';
      analyzeBtn.disabled = on || !selectedFile;
    }

    function toast(msg) {
      toastInner.textContent = msg;
      toastInner.classList.remove('hidden');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastInner.classList.add('hidden'); }, 2800);
    }

    // ---- analyze ----
    async function analyze() {
      if (!selectedFile) return;
      const targets = activeTargets();
      if (!targets.length) { toast(t('toast.no_fields')); return; }
      setStatus('', false);
      setLoading(true);
      try {
        const dataUrl = await fileToBase64Jpeg(selectedFile);
        const base64 = dataUrl.split(',')[1];
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            base64Image: base64,
            fields: targets.map(function (f) { return { key: f.key, label: f.label, type: f.type }; }),
          }),
        });
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
          const err = new Error(data.error || t('status.server_error'));
          err.retryable = !!data.retryable;
          throw err;
        }
        const contacts = Array.isArray(data.contacts) ? data.contacts : [];
        mappingContacts = contacts
          .map(function (ct) {
            const rawLines = Array.isArray(ct.lines) ? ct.lines : [];
            return {
              id: ct.id,
              lines: rawLines.map(function (l) {
                const text = typeof l.text === 'string'
                  ? l.text
                  : l.text != null ? String(l.text) : '';
                const suggested = typeof l.suggested === 'string' ? l.suggested : '';
                const exists = activeTargets().some(function (x) { return x.key === suggested; });
                return {
                  id: l.id,
                  text: text,
                  target: exists ? suggested : initialTarget(text),
                };
              }),
            };
          })
          .map(mergeStandalonePrefixes)
          .filter(function (ct) { return ct.lines.length > 0; });
        setLoading(false);
        renderResults();
        showResults();
        const totalLines = mappingContacts.reduce(function (n, ct) { return n + ct.lines.length; }, 0);
        if (totalLines) {
          toast(t('toast.rows_found', { n: totalLines }));
        } else {
          setStatus(t('status.no_data'), true);
        }
      } catch (err) {
        setLoading(false);
        setStatus(
          err && err.retryable
            ? t('status.try_again')
            : err && err.message ? err.message : t('status.generic_error'),
          true
        );
      }
    }

    analyzeBtn.addEventListener('click', analyze);

    // ---- mapping UI ----
    function renderResults() {
      const wrap = document.getElementById('resultsForm');
      wrap.innerHTML = '';
      const countEl = document.getElementById('resultsCount');
      const metaEl = document.getElementById('resultsMeta');

      const totalLines = mappingContacts.reduce(function (n, ct) { return n + ct.lines.length; }, 0);
      const hint = document.getElementById('multiContactHint');
      const hintWa = document.getElementById('multiContactHintWa');
      const iosLabel = document.getElementById('iosHintLabel');
      if (!totalLines) {
        wrap.innerHTML = '<p class="rounded-xl bg-slate-800/60 px-4 py-6 text-center text-sm text-slate-400">' + t('results.empty') + '</p>';
        metaEl.classList.add('hidden');
        hint.classList.add('hidden');
        hintWa.classList.add('hidden');
        iosLabel.classList.add('hidden');
        return;
      }

      countEl.textContent = totalLines + ' ' + t('results.count');
      metaEl.classList.remove('hidden');

      if (mappingContacts.length > 1) {
        iosLabel.textContent = t('results.ios_label');
        iosLabel.classList.remove('hidden');
        document.getElementById('multiContactHintText').textContent = t('results.multi_hint', { n: mappingContacts.length });
        hint.classList.remove('hidden');
        document.getElementById('multiContactHintWaText').textContent = t('results.multi_hint_wa');
        hintWa.classList.remove('hidden');
      } else {
        iosLabel.classList.add('hidden');
        hint.classList.add('hidden');
        hintWa.classList.add('hidden');
      }

      const targets = activeTargets();
      const stdOpts = targets.filter(function (t) { return t.type === 'standard'; });
      const customOpts = targets.filter(function (t) { return t.type === 'custom'; });

      mappingContacts.forEach(function (contact, ci) {
        const section = document.createElement('div');
        section.className = 'rounded-2xl bg-slate-900/60 p-3 ring-1 ring-cyan-500/20';

        const head = document.createElement('div');
        head.className = 'mb-2 flex items-center gap-2';
        head.innerHTML = '<span class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-bold text-cyan-300 ring-1 ring-slate-700"></span><span class="text-xs font-semibold text-cyan-300">' + t('results.contact') + '</span>';
        head.firstElementChild.textContent = String(ci + 1);
        section.appendChild(head);

        const body = document.createElement('div');
        body.className = 'space-y-2';

        contact.lines.forEach(function (line) {
          const box = document.createElement('div');
          box.className = 'rounded-xl bg-slate-800/70 p-2.5 ring-1 ring-slate-700/60';

          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'field-input';
          input.value = line.text || '';
          input.setAttribute('dir', 'rtl');
          function applyPhoneDir() {
            if (line.target === 'phone') {
              input.setAttribute('dir', 'ltr');
              input.classList.add('digits');
            } else {
              input.setAttribute('dir', 'rtl');
              input.classList.remove('digits');
            }
          }
          applyPhoneDir();
          input.addEventListener('input', function () { line.text = input.value; });

          const select = document.createElement('select');
          select.className = 'field-input mt-2';
          if (stdOpts.length) {
            const og = document.createElement('optgroup');
            og.label = t('results.group_standard');
            stdOpts.forEach(function (t) {
              const o = document.createElement('option');
              o.value = t.key;
              o.textContent = t.label;
              og.appendChild(o);
            });
            select.appendChild(og);
          }
          if (customOpts.length) {
            const og = document.createElement('optgroup');
            og.label = t('results.group_custom');
            customOpts.forEach(function (t) {
              const o = document.createElement('option');
              o.value = t.key;
              o.textContent = t.label;
              og.appendChild(o);
            });
            select.appendChild(og);
          }
          const ig = document.createElement('option');
          ig.value = 'ignore';
          ig.textContent = t('results.ignore');
          select.appendChild(ig);

          const hasOpt = Array.prototype.some.call(select.options, function (o) { return o.value === line.target; });
          select.value = hasOpt ? line.target : 'ignore';
          line.target = select.value;
          select.addEventListener('change', function () {
            line.target = select.value;
            applyPhoneDir();
          });

          box.appendChild(input);
          box.appendChild(select);
          body.appendChild(box);
        });

        section.appendChild(body);
        wrap.appendChild(section);
      });
    }

    function showResults() {
      scanSection.classList.add('hidden');
      resultsSection.classList.remove('hidden');
      resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function hideResults() {
      resultsSection.classList.add('hidden');
      scanSection.classList.remove('hidden');
    }

    document.getElementById('resetBtn').addEventListener('click', function () {
      mappingContacts = [];
      hideResults();
      selectedFile = null;
      fileInput.value = '';
      cameraInput.value = '';
      preview.classList.add('hidden');
      if (preview.src) { URL.revokeObjectURL(preview.src); preview.removeAttribute('src'); }
      analyzeBtn.disabled = true;
      setStatus('', false);
      setLoading(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // ---- vCard export ----
    function escText(v) {
      return String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,');
    }
    function escLine(v) {
      return escText(String(v)).replace(/\r?\n/g, '\\n');
    }
    function foldLine(line) {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const bytes = encoder.encode(line);
      if (bytes.length <= 75) return line;
      const parts = [];
      let start = 0;
      while (start < bytes.length) {
        let end = Math.min(start + 75, bytes.length);
        if (end < bytes.length) {
          while (end > start && (bytes[end] & 0xc0) === 0x80) end--;
        }
        parts.push(decoder.decode(bytes.slice(start, end)));
        start = end;
      }
      return parts.join('\r\n ');
    }

    function cleanPhone(v) {
      let clean = String(v).replace(/[^\d+]/g, '');
      if (!clean.startsWith('+')) clean = clean.replace(/\D/g, '');
      return clean;
    }

    function buildVCardForContact(contact) {
      const targets = activeTargets();
      const groups = {};
      contact.lines.forEach(function (line) {
        const v = (line.text || '').trim();
        if (!v) return;
        const t = line.target;
        if (!t || t === 'ignore') return;
        (groups[t] = groups[t] || []).push(v);
      });

      const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
      lines.push('UID:' + (contact.id || 'c') + '.' + Date.now() + '@contactimporter');

      const first = (groups.first_name || []).join(' ');
      const last = (groups.last_name || []).join(' ');
      const fullName = [first, last].filter(Boolean).join(' ');
      let fnVal = fullName;
      if (!fnVal) {
        fnVal = [groups.phone && groups.phone[0], groups.email && groups.email[0],
          groups.organization && groups.organization[0], groups.notes && groups.notes[0]].find(Boolean);
      }
      if (fnVal) lines.push('FN;CHARSET=UTF-8:' + escLine(fnVal));
      lines.push('N;CHARSET=UTF-8:' + escText(last) + ';' + escText(first) + ';;;');

      (groups.phone || []).forEach(function (p) {
        const c = cleanPhone(p);
        if (c) lines.push('TEL;TYPE=CELL;CHARSET=UTF-8:' + c);
      });
      (groups.email || []).forEach(function (e) {
        if (e) lines.push('EMAIL;CHARSET=UTF-8:' + escLine(e));
      });
      if (groups.organization && groups.organization.length) {
        lines.push('ORG;CHARSET=UTF-8:' + escLine(groups.organization.join(' ')));
      }
      if (groups.title && groups.title.length) {
        lines.push('TITLE;CHARSET=UTF-8:' + escLine(groups.title.join(' ')));
      }
      if (groups.address && groups.address.length) {
        const adr = groups.address.join(' ').replace(/\r?\n/g, ' ');
        lines.push('ADR;TYPE=HOME;CHARSET=UTF-8:;;' + escText(adr) + ';;;;');
      }

      const noteParts = [];
      (groups.notes || []).forEach(function (n) {
        if (n) noteParts.push(escLine(n));
      });
      targets.forEach(function (t) {
        if (t.type !== 'custom') return;
        (groups[t.key] || []).forEach(function (v) {
          lines.push('X-' + t.xname + ';CHARSET=UTF-8:' + escLine(v));
          noteParts.push('[' + t.label + ']: ' + escLine(v));
        });
      });
      if (noteParts.length) lines.push('NOTE;CHARSET=UTF-8:' + noteParts.join('\\n'));

      lines.push('END:VCARD');
      return lines.map(foldLine).join('\r\n');
    }

    function buildVCards() {
      const blocks = mappingContacts.map(buildVCardForContact);
      return blocks.join('\r\n') + '\r\n';
    }

    async function shareVcf(vcf, fileName) {
      const blob = new Blob([vcf], { type: 'text/vcard' });
      const file = new File([blob], fileName, { type: 'text/vcard' });
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: fileName });
        } else {
          downloadBlob(blob, fileName);
        }
      } catch (err) {
        if (err && err.name !== 'AbortError') downloadBlob(blob, fileName);
      }
    }

    function downloadBlob(blob, fileName) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }

    document.getElementById('saveContactBtn').addEventListener('click', function () {
      const any = mappingContacts.some(function (ct) {
        return ct.lines.some(function (line) {
          return line.target !== 'ignore' && (line.text || '').trim();
        });
      });
      if (!any) {
        toast(t('toast.no_mapping'));
        return;
      }
      const vcf = buildVCards();
      let fileName;
      if (mappingContacts.length === 1) {
        const lines = mappingContacts[0].lines;
        const first = lines.filter(function (r) { return r.target === 'first_name'; })
          .map(function (r) { return r.text.trim(); }).join(' ');
        const last = lines.filter(function (r) { return r.target === 'last_name'; })
          .map(function (r) { return r.text.trim(); }).join(' ');
        fileName = (first || last)
          ? 'contact_' + [first, last].filter(Boolean).join('_').replace(/[^\w\u0590-\u05FF]+/g, '_') + '.vcf'
          : 'contact.vcf';
      } else {
        fileName = 'contacts_' + mappingContacts.length + '.vcf';
      }
      shareVcf(vcf, fileName);
      toast(t('toast.vcard_ready'));
    });

    // ---- config modal ----
    function escapeAttr(v) {
      return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    function renderStandardToggles() {
      const wrap = document.getElementById('standardFields');
      wrap.innerHTML = '';
      STANDARD_FIELDS.forEach(function (f) {
        const label = document.createElement('label');
        label.className = 'flex cursor-pointer items-center justify-between gap-2 rounded-xl bg-slate-800/70 px-3 py-2.5 ring-1 ring-slate-700/60 transition hover:ring-cyan-500/40';
        label.innerHTML =
          '<input type="checkbox" class="peer sr-only">' +
          '<span class="text-sm font-medium">' + t(f.textKey) + '</span>' +
          '<span class="relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors peer-checked:bg-cyan-500 bg-slate-600">' +
          '<span class="absolute start-0.5 h-4 w-4 rounded-full bg-white shadow transition-all peer-checked:start-4"></span></span>';
        const cb = label.querySelector('input');
        cb.checked = !!schema.standards[f.key];
        cb.addEventListener('change', function () { schema.standards[f.key] = cb.checked; });
        wrap.appendChild(label);
      });
    }

    function renderCustomFields() {
      const wrap = document.getElementById('customFieldsList');
      wrap.innerHTML = '';
      if (!schema.customs.length) {
        wrap.innerHTML = '<p class="rounded-lg bg-slate-800/50 px-3 py-2 text-xs text-slate-400">' + t('config.empty_custom') + '</p>';
        return;
      }
      schema.customs.forEach(function (c, idx) {
        const row = document.createElement('div');
        row.className = 'rounded-xl bg-slate-800/70 p-2.5 ring-1 ring-slate-700/60';
        row.dataset.key = c.key;
        row.innerHTML =
          '<div class="flex gap-2">' +
          '<input type="text" class="custom-name field-input flex-1" placeholder="' + t('config.name_placeholder') + '" value="' + escapeAttr(c.label) + '">' +
          '<button type="button" class="custom-remove flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-slate-900 text-slate-400 ring-1 ring-slate-700 transition hover:text-rose-400" aria-label="' + t('config.remove') + '">' +
          '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>' +
          '</button>' +
          '</div>' +
          '<input type="text" class="custom-desc field-input mt-2" placeholder="' + t('config.desc_placeholder') + '" value="' + escapeAttr(c.description || '') + '">';
        const nameInput = row.querySelector('.custom-name');
        const descInput = row.querySelector('.custom-desc');
        nameInput.addEventListener('input', function () {
          c.label = nameInput.value;
          if (c.label.trim()) {
            c.key = nextCustomKey();
            c.xname = 'CUSTOM-' + c.key.slice('custom_'.length).toUpperCase();
            row.dataset.key = c.key;
          }
        });
        descInput.addEventListener('input', function () { c.description = descInput.value; });
        row.querySelector('.custom-remove').addEventListener('click', function () {
          schema.customs.splice(idx, 1);
          renderCustomFields();
        });
        wrap.appendChild(row);
      });
    }

    function openConfig() {
      snapshot = JSON.parse(JSON.stringify(schema));
      renderStandardToggles();
      renderCustomFields();
      document.getElementById('configModal').classList.remove('hidden');
      modalOpen = true;
    }

    function closeConfig() {
      document.getElementById('configModal').classList.add('hidden');
      modalOpen = false;
    }

    document.getElementById('configBtn').addEventListener('click', openConfig);
    document.getElementById('closeConfigBtn').addEventListener('click', function () {
      schema = JSON.parse(JSON.stringify(snapshot));
      closeConfig();
    });
    document.getElementById('cancelConfigBtn').addEventListener('click', function () {
      schema = JSON.parse(JSON.stringify(snapshot));
      closeConfig();
    });
    document.querySelector('[data-close-config]').addEventListener('click', function () {
      schema = JSON.parse(JSON.stringify(snapshot));
      closeConfig();
    });
    document.getElementById('saveConfigBtn').addEventListener('click', function () {
      schema.customs = schema.customs.filter(function (c) { return c.label.trim(); });
      saveSchema();
      closeConfig();
      if (!resultsSection.classList.contains('hidden')) renderResults();
      toast(t('toast.config_saved'));
    });
    document.getElementById('addCustomBtn').addEventListener('click', function () {
      schema.customs.push({ key: '', label: '', description: '', xname: '' });
      renderCustomFields();
      const list = document.getElementById('customFieldsList');
      const inputs = list.querySelectorAll('.custom-name');
      if (inputs.length) inputs[inputs.length - 1].focus();
    });

    // ---- boot ----

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* offline-only */ });
      });
    }
  })();
  