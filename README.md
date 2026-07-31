# ייבוא אנשי קשר

Hebrew business-card scanner PWA. Take a photo, detect text lines with Gemini, map them to contact fields, and export a vCard.

## Stack

- Static PWA (HTML, Tailwind CDN, service worker)
- Vercel serverless API (`/api/scan`) for Gemini OCR

## Setup

```bash
npm install
```

Set `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) in Vercel project settings or a local `.env` for `vercel dev`.

## Development

```bash
npm start
```

## Deploy

```bash
npm run deploy
```
