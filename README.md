# openletterhk.org

**An Open Letter to Anthropic from Hong Kong** — a single page with the letter and a form to add your signature, with your name or anonymously.

Live at <https://openletterhk.org>.

## How it works

- `server.js` — a dependency-free Node server. Serves `public/` and exposes:
  - `GET /api/signatures` — count plus the list of named signatories (anonymous ones are counted only).
  - `POST /api/sign` — adds a signature. Validates input, rejects links in the name field, normalises websites, rate-limits by connection, and ignores honeypot submissions.
- `public/` — the page. The script face (Dancing Script, SIL OFL, licence in `public/fonts/OFL.txt`) is self-hosted; no third-party requests, no cookies, no analytics.
- `data/signatures.json` — the signatures. Gitignored; it only ever exists on the server. Writes are atomic.

## Run locally

```bash
PORT=3010 node server.js
```

Then open <http://127.0.0.1:3010>. Signatures are written to `./data/`.

## Deploy

```bash
./deploy.sh
```

Pulls `main` on the server and reloads the PM2 process `openletterhk` (port 3010, behind Caddy). Signatures in `data/` survive deploys.

## Privacy

Only what is typed into the form is stored with the signature. Anonymous signatures store a timestamp and nothing else. Signing is limited to 3 per connection per 24 hours: a keyed hash (HMAC with `RATE_SALT` from `.env`) of the address — IPv6 by /64 — is kept in `data/ratelimit.json`, separate from signatures, and dropped after 24 hours. Named signatures are checked by an AI model (`z-ai/glm-5.3-flash` via OpenRouter, providers with `data_collection: deny`) before they appear; see `ai-moderation.js`.

## Licence

Letter text © its author, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Code [MIT](LICENSE).

## Social card

`public/og.png` (2400×1260, link previews) and `public/share-instagram.png` (1080×1350, Instagram feed) are rendered from `og/card.html` and `og/card-portrait.html`. Edit the HTML, then run `./og/render.sh` (needs Google Chrome).

## #openletterhk stream

`stream.js` shows posts tagged **#openletterhk** in a moving strip on the page:

- **Bluesky** is searched every 2 minutes (`api.bsky.app`, no account needed). Posts appear automatically if they pass the filters: account at least 7 days old, at least 3 followers, the post really contains the tag, no Bluesky moderation labels (porn, spam, bot…), authors who opted out of logged-out display are respected, a blocked-words list (`data/blocked-words.txt`, one per line, extends the defaults), and at most 3 posts per author.
- **X** posts are curated: add them by link on the admin page. Text is fetched from X's public oEmbed endpoint; no X scripts load in the browser.

The browser only talks to this server; no avatars or third-party requests.

### Admin

`/admin` lists every post (visible, filtered with the reason, hidden) and lets you hide/unhide, add/remove X posts, and re-check Bluesky. It needs `ADMIN_KEY` in `/var/www/openletterhk.org/.env` on the server (gitignored, loaded by PM2 via `--env-file-if-exists`). Read it with:

```bash
ssh root@5.223.89.26 "grep ADMIN_KEY /var/www/openletterhk.org/.env"
```

Tuning via `.env`: `STREAM_MIN_AGE_DAYS`, `STREAM_MIN_FOLLOWERS`, `STREAM_TAG`.

## Translation (`/zh-hk`)

`public/zh-hk/index.html` (formal written Chinese, 書面語) is **generated** — edit `public/index.html` and/or `i18n/zh.json`, then rebuild:

```bash
node i18n/build.mjs && ./og/render.sh
```

- `i18n/en.json` — English source strings (letter + UI), with `{{…}}` placeholders for links.
- `i18n/zh.json` — formal written Chinese, HK Traditional; proofread by native speakers.
- A colloquial Cantonese version (`/yue`) was removed on 2026-10-24 after native readers found it misleading; `/yue` redirects to `/zh-hk`. It remains in git history.
- Locales are listed in `LOCALES` in `i18n/build.mjs` (`i18n/translate.mjs` is the Qwen drafting pipeline used for the retired Cantonese draft); the build also keeps the language switch and hreflang list in `public/index.html` in sync.
- UI messages reach `app.js` through a `<script type="application/json" id="i18n">` data block.
