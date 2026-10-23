'use strict';

// openletterhk.org — static page + signature API. No dependencies.
// Binds to loopback; Caddy terminates TLS and proxies to it.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { createStream } = require('./stream');
const { notANameReason, blockedReason } = require('./moderation');

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

// ── #openletterhk stream ──────────────────────────────────────────────────

const stream = createStream(DATA_DIR);
const ADMIN_KEY = process.env.ADMIN_KEY || '';

function isAdmin(req) {
  if (!ADMIN_KEY) return false;
  const given = Buffer.from(String(req.headers['x-admin-key'] || ''));
  const want = Buffer.from(ADMIN_KEY);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

async function handleAdmin(req, res, pathname) {
  if (!ADMIN_KEY) return sendJson(res, 503, { error: 'Admin is not configured on this server.' });
  if (!isAdmin(req)) return sendJson(res, 401, { error: 'Wrong admin key.' });

  if (pathname === '/api/admin/stream' && req.method === 'GET') {
    return sendJson(res, 200, { status: stream.status(), posts: stream.all() });
  }
  if (pathname === '/api/admin/signatures' && req.method === 'GET') {
    const named = signatures.filter(s => !s.anonymous).slice().reverse()
      .map(s => ({ id: s.id, name: s.name, website: s.website || '', at: s.at, hidden: !!s.hidden, autoHidden: s.autoHidden || null, flagged: notANameReason(s.name) }));
    const anon = signatures.filter(s => s.anonymous);
    return sendJson(res, 200, { named, anonymous: anon.filter(s => !s.hidden).length, anonymousHidden: anon.filter(s => s.hidden).length });
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  let body;
  try { body = await readJsonBody(req); }
  catch (err) { return sendJson(res, err.status || 400, { error: err.message }); }

  try {
    switch (pathname) {
      case '/api/admin/sig-hide':
      case '/api/admin/sig-unhide': {
        const rec = signatures.find(s => s.id === body.id);
        if (!rec) return sendJson(res, 404, { error: 'Signature not found.' });
        if (pathname === '/api/admin/sig-hide') rec.hidden = true; else { delete rec.hidden; delete rec.autoHidden; }
        await persist();
        return sendJson(res, 200, { ok: true });
      }
      case '/api/admin/hide':     stream.setHidden(body.id, true);  return sendJson(res, 200, { ok: true });
      case '/api/admin/unhide':   stream.setHidden(body.id, false); return sendJson(res, 200, { ok: true });
      case '/api/admin/x-add':    return sendJson(res, 201, { ok: true, post: await stream.addX(body.url) });
      case '/api/admin/x-remove': stream.removeX(body.url); return sendJson(res, 200, { ok: true });
      default:                    return sendJson(res, 404, { error: 'Not found' });
    }
  } catch (err) {
    return sendJson(res, err.status || 500, { error: err.status ? err.message : 'Something went wrong.' });
  }
}

// ── Rate limiting ──────────────────────────────────────────────────────────
// IPs are hashed with a per-process salt and kept in memory only; nothing
// identifying a visitor is ever written to disk.

const SALT = crypto.randomBytes(16);
const hits = new Map();
const checkHits = new Map();
const WEBSITE_CHECKS_PER_HOUR = 20;

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  return (xff ? String(xff).split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
}

function overLimit(map, limit, req) {
  const key = crypto.createHash('sha256').update(SALT).update(clientIp(req)).digest('base64');
  const now = Date.now();
  const recent = (map.get(key) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (recent.length >= limit) { map.set(key, recent); return true; }
  recent.push(now);
  map.set(key, recent);
  return false;
}
const rateLimited = req => overLimit(hits, RATE_LIMIT, req);
const websiteCheckLimited = req => overLimit(checkHits, WEBSITE_CHECKS_PER_HOUR, req);

setInterval(() => {
  const now = Date.now();
  for (const map of [hits, checkHits]) {
    for (const [key, times] of map) {
      const recent = times.filter(t => now - t < RATE_WINDOW_MS);
      if (recent.length) map.set(key, recent); else map.delete(key);
    }
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
  if (url.username || url.password || url.port) return null;
  // Real DNS names only: letters/digits/hyphens per label and a plausible TLD.
  // (The URL parser accepts commas and other oddities, e.g. "www.joinvision,group".)
  const labels = url.hostname.toLowerCase().split('.');
  if (labels.length < 2 || url.hostname.length > 253) return null;
  if (!labels.every(l => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return null;
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(labels[labels.length - 1])) return null;
  return url.href;
}

// ── Website reachability ───────────────────────────────────────────────────
// Any HTTP response proves the site exists (many answer bots with 403). The
// server must not become a proxy into private networks: resolve first and
// refuse private/loopback/link-local addresses, default ports only, and never
// follow redirects (the first response is enough).

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('ff');
}

async function probe(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: ctl.signal,
      headers: { 'User-Agent': 'openletterhk.org website check (+https://openletterhk.org)', Accept: 'text/html,*/*' } });
    res.body?.cancel().catch(() => {});
    return res.status > 0;
  } catch { return false; }
  finally { clearTimeout(timer); }
}

async function websiteReachable(href) {
  const u = new URL(href);
  let addrs;
  try { addrs = await dns.lookup(u.hostname, { all: true, verbatim: true }); } catch { return false; }
  if (!addrs.length || addrs.some(a => isPrivateAddress(a.address))) return false;
  const https = new URL(u.href); https.protocol = 'https:';
  if (await probe(https.href)) return true;
  const http = new URL(u.href); http.protocol = 'http:';
  return probe(http.href);
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
    if (s.hidden) continue; // removed by a moderator
    if (s.anonymous) anonymous++;
    else named.push({ name: s.name, website: s.website || '', at: s.at });
  }
  return { count: named.length + anonymous, anonymous, named };
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
    if (!name) return sendJson(res, 400, { code: 'name_invalid', error: 'Please enter your name (up to 80 characters, no links).' });
    if (notANameReason(name)) return sendJson(res, 400, { code: 'name_not_a_name', error: 'Please enter just your name — this collects signatures, not comments.' });
    const website = cleanWebsite(body.website);
    if (website === null) return sendJson(res, 400, { code: 'website_invalid', error: 'That website address does not look valid. Please check it.' });

    if (website) {
      const host = hostOf(website);
      const dup = signatures.some(s => !s.anonymous && s.website && hostOf(s.website) === host && s.name.toLowerCase() === name.toLowerCase());
      if (dup) return sendJson(res, 409, { code: 'duplicate', error: 'This name and website have already signed. Thank you!' });
      if (websiteCheckLimited(req)) {
        return sendJson(res, 429, { code: 'rate_limited', error: 'Too many attempts from your connection. Please try again later.' });
      }
      if (!(await websiteReachable(website))) {
        return sendJson(res, 422, { code: 'website_unreachable', error: `We couldn't reach ${new URL(website).hostname}. Please check the address, or leave the website empty.` });
      }
    }
    record.name = name;
    if (website) record.website = website;
    // Repeats of a hidden signature are stored hidden, silently: telling a
    // troll what is blocked only helps them vary it. Moderators see the reason.
    const blocked = blockedReason(name, website, signatures);
    if (blocked) { record.hidden = true; record.autoHidden = blocked; }
  }

  if (rateLimited(req)) {
    return sendJson(res, 429, { code: 'rate_limited', error: 'Too many signatures from your connection. Please try again later.' });
  }

  signatures.push(record);
  await persist();
  sendJson(res, 201, { ok: true, count: signatures.filter(s => !s.hidden).length });
}

// ── Static files ───────────────────────────────────────────────────────────

function serveStatic(req, res, pathname) {
  const ROUTES = { '/': '/index.html', '/admin': '/admin.html', '/admin/signatures': '/admin-signatures.html', '/yue': '/yue/index.html', '/yue/': '/yue/index.html' };
  const rel = ROUTES[pathname] || decodeURIComponent(pathname);
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
  if (url.pathname === '/api/stream') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
    return sendJson(res, 200, { tag: stream.status().tag, posts: stream.visible() });
  }
  if (url.pathname.startsWith('/api/admin/')) {
    return handleAdmin(req, res, url.pathname).catch(err => { console.error(err); sendJson(res, 500, { error: 'Something went wrong.' }); });
  }
  if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });

  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, baseHeaders()); return res.end(); }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  stream.start();
  console.log(`openletterhk.org listening on http://${HOST}:${PORT} — ${signatures.length} signatures loaded`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => writeChain.then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
