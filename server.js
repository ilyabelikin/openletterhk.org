'use strict';

// openletterhk.org — static page + signature API. No dependencies.
// Binds to loopback; Caddy terminates TLS and proxies to it.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3010;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'signatures.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const MAX_BODY = 8 * 1024;
const MAX_NAME = 80;
const MAX_WEBSITE = 200;
const RATE_LIMIT = 5;                   // signatures per connection per window
const RATE_WINDOW_MS = 60 * 60 * 1000;  // 1 hour

// ── Storage ────────────────────────────────────────────────────────────────

let signatures = [];
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (Array.isArray(parsed)) signatures = parsed;
} catch (err) {
  if (err.code !== 'ENOENT') console.error('Could not read signatures:', err);
}

// Writes are serialized and atomic (tmp + rename) so a crash never truncates the file.
let writeChain = Promise.resolve();
function persist() {
  const snapshot = JSON.stringify(signatures);
  writeChain = writeChain
    .then(() => fs.promises.writeFile(DATA_FILE + '.tmp', snapshot))
    .then(() => fs.promises.rename(DATA_FILE + '.tmp', DATA_FILE))
    .catch(err => console.error('Could not persist signatures:', err));
  return writeChain;
}

// ── Rate limiting ──────────────────────────────────────────────────────────
// IPs are hashed with a per-process salt and kept in memory only; nothing
// identifying a visitor is ever written to disk.

const SALT = crypto.randomBytes(16);
const hits = new Map();

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  return (xff ? String(xff).split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
}

function rateLimited(req) {
  const key = crypto.createHash('sha256').update(SALT).update(clientIp(req)).digest('base64');
  const now = Date.now();
  const recent = (hits.get(key) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) { hits.set(key, recent); return true; }
  recent.push(now);
  hits.set(key, recent);
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, times] of hits) {
    const recent = times.filter(t => now - t < RATE_WINDOW_MS);
    if (recent.length) hits.set(key, recent); else hits.delete(key);
  }
}, 10 * 60 * 1000).unref();

// ── Validation ─────────────────────────────────────────────────────────────

function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > MAX_NAME) return null;
  if (/https?:\/\/|www\./i.test(name)) return null; // links belong in the website field
  return name;
}

function cleanWebsite(raw) {
  if (raw == null || raw === '') return '';
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return '';
  if (s.length > MAX_WEBSITE) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  let url;
  try { url = new URL(s); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (!url.hostname.includes('.')) return null;
  return url.href;
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

// ── Helpers ────────────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function baseHeaders(extra) {
  return Object.assign({
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
      "connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'interest-cohort=()',
  }, extra);
}

function sendJson(res, status, body, extra) {
  const data = JSON.stringify(body);
  res.writeHead(status, baseHeaders(Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  }, extra)));
  res.end(data);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { req.pause(); reject(Object.assign(new Error('Payload too large'), { status: 413 })); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

// ── API ────────────────────────────────────────────────────────────────────

function publicSignatures() {
  const named = [];
  let anonymous = 0;
  for (let i = signatures.length - 1; i >= 0; i--) {
    const s = signatures[i];
    if (s.anonymous) anonymous++;
    else named.push({ name: s.name, website: s.website || '', at: s.at });
  }
  return { count: signatures.length, anonymous, named };
}

async function handleSign(req, res) {
  let body;
  try { body = await readJsonBody(req); }
  catch (err) {
    const status = err.status || 400;
    sendJson(res, status, { error: err.message }, status === 413 ? { Connection: 'close' } : undefined);
    if (status === 413) res.once('finish', () => req.socket.destroy());
    return;
  }

  // Honeypot: bots fill every field. Pretend it worked, store nothing.
  if (typeof body.fax === 'string' && body.fax.trim()) return sendJson(res, 200, { ok: true });

  const anonymous = body.anonymous === true;
  const record = { id: crypto.randomUUID(), at: new Date().toISOString(), anonymous };

  if (!anonymous) {
    const name = cleanName(body.name);
    if (!name) return sendJson(res, 400, { error: 'Please enter your name (up to 80 characters, no links).' });
    const website = cleanWebsite(body.website);
    if (website === null) return sendJson(res, 400, { error: 'That website address does not look valid.' });

    if (website) {
      const host = hostOf(website);
      const dup = signatures.some(s => !s.anonymous && s.website && hostOf(s.website) === host && s.name.toLowerCase() === name.toLowerCase());
      if (dup) return sendJson(res, 409, { error: 'This name and website have already signed. Thank you!' });
    }
    record.name = name;
    if (website) record.website = website;
  }

  if (rateLimited(req)) {
    return sendJson(res, 429, { error: 'Too many signatures from your connection. Please try again later.' });
  }

  signatures.push(record);
  await persist();
  sendJson(res, 201, { ok: true, count: signatures.length });
}

// ── Static files ───────────────────────────────────────────────────────────

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(404, baseHeaders()); return res.end('Not found'); }

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404, baseHeaders({ 'Content-Type': 'text/plain' })); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    // Revalidate on every load (cheap 304s) so a deploy is visible immediately —
    // never a stale stylesheet, or a stale script talking to a changed API.
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const cacheHeaders = {
      'Cache-Control': 'no-cache',
      'ETag': etag,
      'Last-Modified': stat.mtime.toUTCString(),
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, baseHeaders(cacheHeaders));
      return res.end();
    }
    res.writeHead(200, baseHeaders(Object.assign({
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
    }, cacheHeaders)));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// ── Server ─────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true });

  if (url.pathname === '/api/signatures') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
    return sendJson(res, 200, publicSignatures());
  }
  if (url.pathname === '/api/sign') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    return handleSign(req, res).catch(err => { console.error(err); sendJson(res, 500, { error: 'Something went wrong. Please try again.' }); });
  }
  if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });

  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, baseHeaders()); return res.end(); }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`openletterhk.org listening on http://${HOST}:${PORT} — ${signatures.length} signatures loaded`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => writeChain.then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
