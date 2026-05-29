# NutriFind — Cloudflare Pages deployment

## Structure
- `dist/` — built static SPA (publish directory)
- `functions/.netlify/functions/claude.js` — Cloudflare Pages Function proxying to Google Gemini
  (path kept as `/.netlify/functions/claude` so the existing frontend works unchanged)

## Deploy

### Option A — Dashboard (drag & drop)
1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Upload assets
2. Upload the `dist/` folder
3. After first deploy, also upload `functions/` via Wrangler (drag-and-drop doesn't include Functions)

### Option B — Wrangler CLI (recommended)
```bash
npm i -g wrangler
wrangler pages deploy dist --project-name=nutrifind
```
Wrangler auto-detects the sibling `functions/` directory and deploys the Pages Function.

## Environment variable
In Cloudflare Dashboard → your Pages project → Settings → Environment variables:
- Add **`GEMINI_API_KEY`** = your Google Gemini API key (Production + Preview)
- Redeploy after adding

## SPA routing
`dist/_redirects` handles client-side routes (`/* /index.html 200`).

## Notes
The Pages Function uses Cloudflare's `onRequestPost({ request, env })` handler
(not Netlify's `exports.handler`). `GEMINI_API_KEY` is read from `env`, which
Cloudflare populates from the Pages environment variables you configure in the
dashboard. The function is wrapped in `/.netlify/functions/` only so the
existing frontend URLs keep working with no code changes.
