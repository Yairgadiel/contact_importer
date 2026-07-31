export const config = { maxDuration: 60 };

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'JSON body required' });
  }

  const { base64Image, fields } = body;
  if (typeof base64Image !== 'string' || !base64Image) {
    return res.status(400).json({ error: 'base64Image is required' });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing GEMINI_API_KEY server environment variable' });
  }

  let mimeType = 'image/jpeg';
  let data = base64Image;
  if (base64Image.startsWith('data:')) {
    const match = base64Image.match(/^data:([^;,]+);base64,(.*)$/s);
    if (match) {
      mimeType = match[1];
      data = match[2];
    }
  }

  const fieldKeys = (Array.isArray(fields) ? fields : [])
    .map(function (f) { return f && f.key; })
    .filter(Boolean);

  const prompt = [
    'You are a precision OCR and contact-data extraction assistant, specialized in Hebrew print and handwriting.',
    'Analyze the image provided below (typically a Hebrew business card, ID card, driver license, or handwritten contact note).',
    '',
    'OCR ACCURACY RULES:',
    '1. Read character geometry carefully. Attend to tall vertical strokes (ascenders) that commonly represent the Hebrew letter Lamed (ל) and similar letters, and carefully distinguish closely related letters (e.g. ד/ר, כ/ב, ה/ח, מ/ס, ת/ב).',
    '2. When a line is clearly a person name, favor standard, recognizable Hebrew name patterns. Do not invent rare words, extra punctuation, or non-existent special characters unless they are explicitly drawn in the image.',
    '3. Preserve the exact text once read — do not "clean up" legitimate content (numbers, IDs, addresses) beyond unambiguous OCR mistakes.',
    '',
    'The image may contain ONE contact or MULTIPLE contacts (e.g. several business cards, a contact list, or a multi-column layout).',
    '',
    'STEP 1 — Group by person: use the spatial layout (position, alignment, gaps, column boundaries) to group text lines that belong to the same person/contact. Do NOT merge different people into one contact, and do NOT split one person across several contacts.',
    'STEP 2 — For each contact, list ALL of its lines.',
    'STEP 3 — For each line, choose the best matching field key and put it in "suggested".',
    '',
    'Available "suggested" keys: ' +
      (fieldKeys.length
        ? fieldKeys.join(', ') + ', ignore'
        : 'first_name, last_name, phone, email, organization, title, address, notes, ignore'),
    '',
    'Return ONLY a valid JSON object (no markdown, no code fences, no commentary) in EXACTLY this structure:',
    '{ "contacts": [ { "lines": [ { "text": "...", "suggested": "first_name" }, { "text": "...", "suggested": "phone" } ] } ] }',
    '',
    'RULES:',
    '1. "text" must preserve each line EXACTLY as it appears in the image (usually Hebrew) — do not translate, rephrase, or merge values.',
    '2. Keep phone numbers and ID numbers exactly as printed.',
    '3. A single contact must still be wrapped in the "contacts" array as one element.',
    '4. If the image contains no readable contact text, return { "contacts": [] }.',
  ].join('\n');

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data } },
        ],
      },
    ],
    generationConfig: {
      response_mime_type: 'application/json',
    },
  };

  const MAX_ATTEMPTS = 4;
  const BACKOFF_MS = [1000, 2000, 4000];

  let resp = null;
  let lastBody = null;
  let retryable = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1] || 8000));
    try {
      resp = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      lastBody = { error: { message: `Could not reach the Gemini API: ${err.message}` } };
      retryable = true;
      continue;
    }
    lastBody = await resp.json().catch(() => ({}));
    if (resp.ok) {
      retryable = false;
      break;
    }
    const msg = lastBody?.error?.message || '';
    const transient = resp.status === 429 || resp.status >= 500 || /high demand|temporar/i.test(msg);
    if (transient) {
      retryable = true;
      continue;
    }
    retryable = false;
    break;
  }

  const gemini = lastBody || {};
  if (!resp || !resp.ok) {
    const msg = gemini?.error?.message || `Gemini API error (HTTP ${resp ? resp.status : 'unknown'})`;
    const status = resp && resp.status >= 500 ? 502 : resp ? resp.status : 502;
    return res.status(status).json({ error: msg, retryable: retryable });
  }

  const text = (gemini?.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || '')
    .join('')
    .trim();

  let parsed = {};
  if (text) {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      try {
        parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      } catch {
        parsed = {};
      }
    }
  }

  const rawContacts = Array.isArray(parsed?.contacts) ? parsed.contacts : [];
  const contacts = rawContacts
    .filter((c) => c && typeof c === 'object')
    .map((c, ci) => {
      const rawLines = Array.isArray(c.lines) ? c.lines : [];
      const lines = rawLines
        .filter((l) => l && typeof l === 'object')
        .map((l, li) => ({
          id: typeof l.id === 'number' ? l.id : li + 1,
          text:
            typeof l.text === 'string'
              ? l.text
              : l.text != null
                ? String(l.text)
                : '',
          suggested: typeof l.suggested === 'string' ? l.suggested : 'ignore',
        }))
        .filter((l) => l.text.trim() !== '');
      return { id: ci + 1, lines };
    })
    .filter((c) => c.lines.length > 0);

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ contacts, requested_fields: Array.isArray(fields) ? fields : [] });
}
