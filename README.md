# openletterhk.org

**An Open Letter to Anthropic from Hong Kong** — a single page with the letter and a form to add your signature, with your name or anonymously.

Live at <https://openletterhk.org>.

## How it works

- `server.js` — a dependency-free Node server. Serves `public/` and exposes:
  - `GET /api/signatures` — count plus the list of named signatories (anonymous ones are counted only).
  - `POST /api/sign` — adds a signature. Validates input, rejects links in the name field, normalises websites, rate-limits by connection, and ignores honeypot submissions.
- `public/` — the page. No web fonts, no third-party requests, no cookies, no analytics.
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

Only what is typed into the form is stored. Anonymous signatures store a timestamp and nothing else. IP addresses are used in memory for rate limiting (hashed with a per-process salt) and are never written to disk.

## Licence

Letter text © its author, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Code [MIT](LICENSE).
