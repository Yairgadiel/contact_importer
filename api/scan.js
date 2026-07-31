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

  const prompt = [
    'You are a precise OCR and data-extraction assistant for contact information.',
    'Analyze the image provided below (typically a Hebrew business card, ID card, driver license, or handwritten contact note).',
    '',
    'Extract EVERY distinct line/item of contact information that is visible in the image — such as person names, phone numbers, email addresses, websites, company name, job title, street addresses, ID numbers, and any other notes.',
    '',
    'Return ONLY a valid JSON object with a single "columns" key, in exactly this structure (no markdown, no code fences, no commentary):',
    '{ "columns": [ { "id": 1, "original_text": "..." }, { "id": 2, "original_text": "..." } ] }',
    '',
    'RULES:',
    '1. "original_text" must preserve the text EXACTLY as it appears in the image (usually Hebrew) — do not translate, rephrase, or merge values.',
    '2. Each detected item keeps its own sequential "id" starting from 1.',
    '3. Keep phone numbers and ID numbers exactly as printed.',
    '4. If the image contains no readable contact text, return { "columns": [] }.',
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
      thinking_level: 'low',
    },
  };

  let resp;
  try {
    resp = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return res.status(502).json({ error: `Could not reach the Gemini API: ${err.message}` });
  }

  const gemini = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = gemini?.error?.message || `Gemini API error (HTTP ${resp.status})`;
    return res.status(resp.status >= 500 ? 502 : resp.status).json({ error: msg });
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

  const raw = Array.isArray(parsed?.columns) ? parsed.columns : [];
  const columns = raw
    .filter((c) => c && typeof c === 'object')
    .map((c, i) => ({
      id: typeof c.id === 'number' ? c.id : i + 1,
      original_text:
        typeof c.original_text === 'string'
          ? c.original_text
          : c.original_text != null
            ? String(c.original_text)
            : '',
    }))
    .filter((c) => c.original_text.trim() !== '');

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ columns, requested_fields: Array.isArray(fields) ? fields : [] });
}
