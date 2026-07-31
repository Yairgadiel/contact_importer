
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
    let mappingRows = [];
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
        if (!res.ok) throw new Error(data.error || t('status.server_error'));
        const columns = Array.isArray(data.columns) ? data.columns : [];
        mappingRows = columns.map(function (c) {
          const text = typeof c.original_text === 'string'
            ? c.original_text
            : c.original_text != null ? String(c.original_text) : '';
          return { id: c.id, original_text: text, target: initialTarget(text) };
        });
        setLoading(false);
        renderResults();
        showResults();
        if (mappingRows.length) {
          toast(t('toast.rows_found', { n: mappingRows.length }));
        } else {
          setStatus(t('status.no_data'), true);
        }
      } catch (err) {
        setLoading(false);
        setStatus(err && err.message ? err.message : t('status.generic_error'), true);
      }
    }

    analyzeBtn.addEventListener('click', analyze);

    // ---- mapping UI ----
    function renderResults() {
      const wrap = document.getElementById('resultsForm');
      wrap.innerHTML = '';
      const countEl = document.getElementById('resultsCount');
      const metaEl = document.getElementById('resultsMeta');

      if (!mappingRows.length) {
        wrap.innerHTML = '<p class="rounded-xl bg-slate-800/60 px-4 py-6 text-center text-sm text-slate-400">' + t('results.empty') + '</p>';
        metaEl.classList.add('hidden');
        return;
      }

      countEl.textContent = mappingRows.length + ' ' + t('results.count');
      metaEl.classList.remove('hidden');

      const targets = activeTargets();
      const stdOpts = targets.filter(function (t) { return t.type === 'standard'; });
      const customOpts = targets.filter(function (t) { return t.type === 'custom'; });

      mappingRows.forEach(function (row, idx) {
        const box = document.createElement('div');
        box.className = 'rounded-xl bg-slate-800/70 p-3 ring-1 ring-slate-700/60';

        const head = document.createElement('div');
        head.className = 'mb-2 flex items-center gap-2';
        head.innerHTML = '<span class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-cyan-300 ring-1 ring-slate-700"></span><span class="text-[11px] text-slate-500">' + t('results.row_label') + '</span>';
        head.firstElementChild.textContent = String(idx + 1);

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'field-input';
        input.value = row.original_text || '';
        input.setAttribute('dir', 'rtl');
        input.addEventListener('input', function () { row.original_text = input.value; });

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

        const hasOpt = Array.prototype.some.call(select.options, function (o) { return o.value === row.target; });
        select.value = hasOpt ? row.target : 'ignore';
        row.target = select.value;
        select.addEventListener('change', function () { row.target = select.value; });

        box.appendChild(head);
        box.appendChild(input);
        box.appendChild(select);
        wrap.appendChild(box);
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
      mappingRows = [];
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

    function buildVCard() {
      const targets = activeTargets();
      const groups = {};
      mappingRows.forEach(function (row) {
        const v = (row.original_text || '').trim();
        if (!v) return;
        const t = row.target;
        if (!t || t === 'ignore') return;
        (groups[t] = groups[t] || []).push(v);
      });

      const lines = ['BEGIN:VCARD', 'VERSION:3.0'];

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
      return lines.map(foldLine).join('\r\n') + '\r\n';
    }

    document.getElementById('saveContactBtn').addEventListener('click', function () {
      const any = mappingRows.some(function (r) {
        return r.target !== 'ignore' && (r.original_text || '').trim();
      });
      if (!any) {
        toast(t('toast.no_mapping'));
        return;
      }
      const vcf = buildVCard();
      const blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const first = (mappingRows.filter(function (r) { return r.target === 'first_name'; })
        .map(function (r) { return r.original_text.trim(); }).join(' '));
      const last = (mappingRows.filter(function (r) { return r.target === 'last_name'; })
        .map(function (r) { return r.original_text.trim(); }).join(' '));
      a.download = (first || last)
        ? 'contact_' + [first, last].filter(Boolean).join('_').replace(/[^\w\u0590-\u05FF]+/g, '_') + '.vcf'
        : 'contact.vcf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
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
  