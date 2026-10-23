'use strict';

// #openletterhk stream: live Bluesky posts + curated X posts, filtered and
// moderated server-side. The browser only ever talks to this server.

const fs = require('fs');
const path = require('path');

const TAG = (process.env.STREAM_TAG || 'openletterhk').toLowerCase();
const BSKY = 'https://api.bsky.app/xrpc';
const BSKY_POLL_MS = 2 * 60 * 1000;
const X_REFRESH_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;
const MAX_VISIBLE = 40;
const MAX_PER_AUTHOR = 3;

const FILTERS = {
  minAccountAgeDays: Number(process.env.STREAM_MIN_AGE_DAYS ?? 7),
  minFollowers: Number(process.env.STREAM_MIN_FOLLOWERS ?? 3),
  minTextLength: 10,
};

// Moderation labels that keep a post off the page. Informational labels
// (e.g. "bridged-from-bridgy-fed-activitypub") are deliberately not here.
// System labels starting with "!" (like !hide, !warn) are always excluded.
const BAD_LABELS = new Set([
  'porn', 'sexual', 'nudity', 'sexual-figurative', 'graphic-media', 'gore', 'corpse', 'self-harm',
  'spam', 'scam', 'impersonation', 'misleading', 'intolerant', 'rude', 'threat', 'harassment',
  'extremist', 'violence', 'bot', 'troll', 'engagement-farming',
]);

// Lower-case substrings; extend in data/blocked-words.txt (one per line).
const DEFAULT_BLOCKED = ['onlyfans', 'airdrop', 'giveaway', 'nsfw', 'porn', 'casino', 'free crypto'];

// Posts that are just our suggested share text add nothing to the strip.
// Compare with links, the hashtag, punctuation, spacing and case removed;
// a few extra characters (emoji, "+1") still count as the template.
const TEMPLATE_SLACK = 8;
function normaliseForTemplate(text) {
  return String(text).toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(?:www\.)?openletterhk\.org(?:\/\S*)?/g, ' ')
    .replace(new RegExp('#' + TAG, 'g'), ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}
const TEMPLATES = (() => {
  const out = [];
  for (const lang of ['en', 'zh']) {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n', lang + '.json'), 'utf8')).share.share_text;
      if (t) out.push(normaliseForTemplate(t));
    } catch {}
  }
  return out;
})();
function isShareTemplate(text) {
  const n = normaliseForTemplate(text);
  return TEMPLATES.some(t => n === t || (n.includes(t) && n.length - t.length <= TEMPLATE_SLACK));
}

function createStream(dataDir) {
  const file = name => path.join(dataDir, name);
  const readJson = (name, fallback) => {
    try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
  };
  const writeJson = (name, value) => {
    const tmp = file(name) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file(name));
  };

  let bsky = readJson('stream-bsky.json', []);       // candidates incl. filter verdicts
  let xPosts = readJson('stream-x.json', []);        // curated: [{ url, addedAt, ...oembed }]
  let hidden = new Set(readJson('stream-hidden.json', []));
  let lastBskyOk = null;
  let lastBskyError = null;

  function blockedWords() {
    let extra = [];
    try {
      extra = fs.readFileSync(file('blocked-words.txt'), 'utf8')
        .split('\n').map(s => s.trim().toLowerCase()).filter(s => s && !s.startsWith('#'));
    } catch {}
    return DEFAULT_BLOCKED.concat(extra);
  }

  async function getJson(url) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'openletterhk.org (+https://openletterhk.org)' } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${new URL(url).pathname}`);
      return await res.json();
    } finally { clearTimeout(t); }
  }

  // ── Bluesky ─────────────────────────────────────────────────

  function hasTag(record) {
    const facetTag = (record.facets || []).some(f => (f.features || []).some(x =>
      x.$type === 'app.bsky.richtext.facet#tag' && String(x.tag).toLowerCase() === TAG));
    return facetTag || new RegExp(`#${TAG}\\b`, 'i').test(record.text || '');
  }

  function verdict(post, profile, words) {
    const rec = post.record || {};
    const labels = [...(post.labels || []), ...((post.author && post.author.labels) || [])].map(l => l.val);
    if (labels.includes('!no-unauthenticated')) return 'author opted out of logged-out display';
    const bad = [...new Set(labels.filter(l => l.startsWith('!') || BAD_LABELS.has(l)))];
    if (bad.length) return `labelled by Bluesky moderation (${bad.join(', ')})`;
    if (!hasTag(rec)) return 'does not contain the hashtag';
    if (isShareTemplate(rec.text || '')) return 'unedited share template';
    const text = (rec.text || '').trim();
    if (text.length < FILTERS.minTextLength) return 'too short';
    const lower = text.toLowerCase();
    const word = words.find(w => lower.includes(w));
    if (word) return `blocked word "${word}"`;
    if (profile) {
      const ageDays = (Date.now() - Date.parse(profile.createdAt)) / 86400000;
      if (!(ageDays >= FILTERS.minAccountAgeDays)) return `account younger than ${FILTERS.minAccountAgeDays} days`;
      if (!((profile.followersCount || 0) >= FILTERS.minFollowers)) return `fewer than ${FILTERS.minFollowers} followers`;
    } else {
      return 'profile unavailable';
    }
    return null;
  }

  async function pollBluesky() {
    try {
      const search = await getJson(`${BSKY}/app.bsky.feed.searchPosts?q=${encodeURIComponent('#' + TAG)}&sort=latest&limit=100`);
      const posts = search.posts || [];
      const dids = [...new Set(posts.map(p => p.author.did))];
      const profiles = new Map();
      for (let i = 0; i < dids.length; i += 25) {
        const qs = dids.slice(i, i + 25).map(d => 'actors=' + encodeURIComponent(d)).join('&');
        const res = await getJson(`${BSKY}/app.bsky.actor.getProfiles?${qs}`);
        for (const p of res.profiles || []) profiles.set(p.did, p);
      }
      const words = blockedWords();
      bsky = posts.map(p => {
        const rkey = p.uri.split('/').pop();
        const prof = profiles.get(p.author.did);
        return {
          id: 'bsky:' + p.uri,
          source: 'bluesky',
          name: p.author.displayName || p.author.handle,
          handle: '@' + p.author.handle,
          url: `https://bsky.app/profile/${p.author.handle}/post/${rkey}`,
          text: (p.record && p.record.text || '').trim(),
          at: (p.record && p.record.createdAt) || p.indexedAt,
          filteredReason: verdict(p, prof, words),
        };
      });
      writeJson('stream-bsky.json', bsky);
      lastBskyOk = new Date().toISOString();
      lastBskyError = null;
    } catch (err) {
      lastBskyError = String(err.message || err);
      console.error('Bluesky poll failed:', lastBskyError);
    }
  }

  // ── X (curated, via public oEmbed) ──────────────────────────

  function decodeEntities(s) {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, c) => {
      if (c[0] === '#') { const n = c[1].toLowerCase() === 'x' ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
      return Object.prototype.hasOwnProperty.call(named, c.toLowerCase()) ? named[c.toLowerCase()] : m;
    });
  }

  function normaliseXUrl(raw) {
    let u;
    try { u = new URL(String(raw).trim()); } catch { return null; }
    if (!/^(www\.|mobile\.)?(x|twitter)\.com$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{1,25})/);
    return m ? `https://x.com/${m[1]}/status/${m[2]}` : null;
  }

  async function fetchX(url) {
    const j = await getJson(`https://publish.x.com/oembed?url=${encodeURIComponent(url)}&omit_script=true&dnt=true`);
    const html = String(j.html || '');
    const p = (html.match(/<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '';
    const text = decodeEntities(p.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim();
    const dateText = decodeEntities(((html.match(/<a[^>]*>([^<]*)<\/a>\s*<\/blockquote>/i) || [])[1] || '').trim());
    const parsed = Date.parse(dateText);
    const handle = '@' + String(j.author_url || '').split('/').filter(Boolean).pop();
    return { name: j.author_name || handle, handle, text, at: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null, fetchedAt: new Date().toISOString() };
  }

  async function refreshX() {
    let changed = false;
    for (const item of xPosts) {
      const stale = !item.fetchedAt || Date.now() - Date.parse(item.fetchedAt) > X_REFRESH_MS;
      if (!stale) continue;
      try { Object.assign(item, await fetchX(item.url), { error: null }); }
      catch (err) { item.error = String(err.message || err); }
      changed = true;
    }
    if (changed) writeJson('stream-x.json', xPosts);
  }

  async function addX(raw) {
    const url = normaliseXUrl(raw);
    if (!url) throw Object.assign(new Error('That is not an X post link (x.com/<user>/status/<id>).'), { status: 400 });
    if (xPosts.some(p => p.url === url)) throw Object.assign(new Error('That post is already in the stream.'), { status: 409 });
    let data;
    try { data = await fetchX(url); }
    catch { throw Object.assign(new Error('X could not find that post (deleted, private, or a bad link).'), { status: 404 }); }
    const item = Object.assign({ url, addedAt: new Date().toISOString(), error: null }, data);
    xPosts.push(item);
    writeJson('stream-x.json', xPosts);
    return item;
  }

  function removeX(raw) {
    const url = normaliseXUrl(raw) || String(raw);
    const before = xPosts.length;
    xPosts = xPosts.filter(p => p.url !== url);
    if (xPosts.length === before) throw Object.assign(new Error('Not found.'), { status: 404 });
    writeJson('stream-x.json', xPosts);
  }

  // ── Views ───────────────────────────────────────────────────

  function xAsPost(p) {
    // oEmbed only gives a calendar date; pin to midday UTC so the day reads the same in every timezone.
    const at = p.at ? p.at.slice(0, 10) + 'T12:00:00.000Z' : p.addedAt;
    return { id: 'x:' + p.url, source: 'x', name: p.name, handle: p.handle, url: p.url, text: p.text, at, precision: p.at ? 'day' : 'time',
             filteredReason: p.error ? 'could not load from X' : !p.text ? 'empty' : isShareTemplate(p.text) ? 'unedited share template' : null };
  }

  function all() {
    return [...bsky, ...xPosts.map(xAsPost)]
      .map(p => Object.assign({}, p, { hidden: hidden.has(p.id) }))
      .sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
  }

  function visible() {
    const perAuthor = new Map();
    const out = [];
    for (const p of all()) {
      if (p.hidden) continue;
      // Curated X posts were chosen by a person, so only Bluesky is auto-filtered.
      if (p.source === 'bluesky' && p.filteredReason) continue;
      if (p.source === 'x' && p.filteredReason) continue;
      const k = p.source + p.handle.toLowerCase();
      const n = (perAuthor.get(k) || 0) + 1;
      perAuthor.set(k, n);
      if (n > MAX_PER_AUTHOR) continue;
      out.push({ id: p.id, source: p.source, name: p.name, handle: p.handle, url: p.url, text: p.text, at: p.at, precision: p.precision || 'time' });
      if (out.length >= MAX_VISIBLE) break;
    }
    return out;
  }

  function setHidden(id, value) {
    if (typeof id !== 'string' || !id) throw Object.assign(new Error('Missing id.'), { status: 400 });
    if (value) hidden.add(id); else hidden.delete(id);
    writeJson('stream-hidden.json', [...hidden]);
  }

  function status() {
    return { tag: TAG, filters: FILTERS, blockedWords: blockedWords().length, lastBlueskyOk: lastBskyOk, lastBlueskyError: lastBskyError };
  }

  function start() {
    pollBluesky();
    refreshX();
    setInterval(pollBluesky, BSKY_POLL_MS).unref();
    setInterval(refreshX, 30 * 60 * 1000).unref();
  }

  return { start, visible, all, addX, removeX, setHidden, status, pollBluesky };
}

module.exports = { createStream, isShareTemplate, TEMPLATES };
