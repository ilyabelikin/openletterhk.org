'use strict';

(function () {
  const form = document.getElementById('sign-form');
  const namedFields = document.getElementById('named-fields');
  const nameInput = document.getElementById('name');
  const websiteInput = document.getElementById('website');
  const submitBtn = document.getElementById('submit-btn');
  const status = document.getElementById('form-status');
  const countEl = document.getElementById('sig-count');
  const listEl = document.getElementById('sig-list');

  // ── Mode toggle ──────────────────────────────────────────────

  function isAnonymous() {
    return form.elements.mode.value === 'anonymous';
  }

  function syncMode() {
    const anon = isAnonymous();
    namedFields.hidden = anon;
    nameInput.disabled = anon;
    websiteInput.disabled = anon;
  }

  form.addEventListener('change', e => {
    if (e.target.name === 'mode') syncMode();
  });
  syncMode();

  // ── Status ───────────────────────────────────────────────────

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = 'status' + (kind ? ' ' + kind : '');
  }

  // ── Signatories ──────────────────────────────────────────────

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
  }


  function render(data) {
    if (data.count === 0) {
      countEl.textContent = 'Be the first to sign.';
    } else {
      let text = 'Signed by ' + plural(data.count, 'person').replace('persons', 'people');
      const parts = [];
      if (data.named.length) parts.push(plural(data.named.length, 'name').replace(/names?$/, m => m === 'name' ? 'with their name' : 'with their names'));
      if (data.anonymous) parts.push(data.anonymous + ' anonymously');
      if (parts.length) text += ' — ' + parts.join(', ');
      countEl.textContent = text + '.';
    }

    listEl.replaceChildren();
    for (const s of data.named) {
      const li = document.createElement('li');

      const name = document.createElement('span');
      name.className = 'sig-name';
      name.textContent = s.name;
      li.appendChild(name);

      if (s.website) {
        const site = document.createElement('span');
        site.className = 'sig-site';
        const a = document.createElement('a');
        a.href = s.website;
        a.textContent = hostOf(s.website);
        a.rel = 'nofollow noopener noreferrer';
        a.target = '_blank';
        site.appendChild(a);
        li.appendChild(site);
      }


      listEl.appendChild(li);
    }
  }

  async function loadSignatures() {
    try {
      const res = await fetch('/api/signatures', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      render(await res.json());
    } catch {
      countEl.textContent = 'Signatures could not be loaded right now.';
    }
  }

  // ── Submit ───────────────────────────────────────────────────

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const anonymous = isAnonymous();

    if (!anonymous && !nameInput.value.trim()) {
      setStatus('Please enter your name, or choose to sign anonymously.', 'err');
      nameInput.focus();
      return;
    }

    const payload = { anonymous, fax: form.elements.fax.value };
    if (!anonymous) {
      payload.name = nameInput.value;
      payload.website = websiteInput.value;
    }

    submitBtn.disabled = true;
    setStatus('Adding your signature…');

    try {
      const res = await fetch('/api/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setStatus('Thank you — your signature has been added. Now help it travel: share the letter below.', 'ok');
        nameInput.value = '';
        websiteInput.value = '';
        await loadSignatures();
      } else {
        setStatus(data.error || 'Something went wrong. Please try again.', 'err');
      }
    } catch {
      setStatus('Network error. Please check your connection and try again.', 'err');
    } finally {
      submitBtn.disabled = false;
    }
  });

  // ── Share ────────────────────────────────────────────────────

  const shareList = document.querySelector('.share-list');
  const shareStatus = document.getElementById('share-status');
  const SHARE_URL = shareList.dataset.shareUrl;
  const SHARE_TEXT = shareList.dataset.shareText;
  const SHARE_TITLE = shareList.dataset.shareTitle;

  function setShareStatus(text, kind) {
    shareStatus.textContent = text;
    shareStatus.className = 'status' + (kind ? ' ' + kind : '');
  }

  if (navigator.share) {
    document.querySelector('.native-only').hidden = false;
    document.getElementById('share-native').addEventListener('click', async () => {
      try { await navigator.share({ title: SHARE_TITLE, text: SHARE_TEXT, url: SHARE_URL }); }
      catch (err) { if (err.name !== 'AbortError') setShareStatus('Sharing is not available here — try Copy link.', 'err'); }
    });
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.className = 'hp';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('copy failed');
  }

  document.getElementById('share-copy').addEventListener('click', async () => {
    try {
      await copyText(SHARE_URL);
      setShareStatus('Link copied — paste it anywhere.', 'ok');
    } catch {
      setShareStatus('Could not copy automatically. The link is ' + SHARE_URL, 'err');
    }
  });

  // Instagram has no link sharing, so share the portrait card as an image.
  document.getElementById('share-instagram').addEventListener('click', async () => {
    const IMG = '/share-instagram.png';
    try {
      const blob = await (await fetch(IMG)).blob();
      const file = new File([blob], 'openletterhk.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: SHARE_TEXT + ' ' + SHARE_URL });
        setShareStatus('Pick Instagram in the share sheet. Put openletterhk.org in your caption or a link sticker.', 'ok');
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
    const a = document.createElement('a');
    a.href = IMG;
    a.download = 'openletterhk-instagram.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setShareStatus('Image downloaded. Post it on Instagram and put openletterhk.org in your caption or bio.', 'ok');
  });

  // ── #openletterhk stream ─────────────────────────────────────

  const streamSection = document.getElementById('stream');
  const ticker = document.getElementById('ticker');
  const track = document.getElementById('ticker-track');
  const streamEmpty = document.getElementById('stream-empty');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const PX_PER_SECOND = 40;
  const SOURCE = {
    x: { label: 'X', d: 'M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z' },
    bluesky: { label: 'Bluesky', d: 'M5.202 2.857C7.954 4.922 10.913 9.11 12 11.358c1.087-2.247 4.046-6.436 6.798-8.501C20.783 1.366 24 .213 24 3.883c0 .732-.42 6.156-.667 7.037-.856 3.061-3.978 3.842-6.755 3.37 4.854.826 6.089 3.562 3.422 6.299-5.065 5.196-7.28-1.304-7.847-2.97-.104-.305-.152-.448-.153-.327 0-.121-.05.022-.153.327-.568 1.666-2.782 8.166-7.847 2.97-2.667-2.737-1.432-5.473 3.422-6.3-2.777.473-5.899-.308-6.755-3.369C.42 10.04 0 4.615 0 3.883c0-3.67 3.217-2.517 5.202-1.026' },
  };
  let lastStreamKey = '';

  function sourceIcon(source) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'ico');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', SOURCE[source].d);
    svg.appendChild(p);
    return svg;
  }

  function shortDate(iso) {
    const t = Date.parse(iso);
    if (!t) return '';
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 60) return Math.max(mins, 1) + 'm';
    if (mins < 60 * 24) return Math.round(mins / 60) + 'h';
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function safeUrl(u) {
    try {
      const url = new URL(u);
      return url.protocol === 'https:' && /(^|\.)(x\.com|bsky\.app)$/.test(url.hostname) ? url.href : null;
    } catch { return null; }
  }

  function card(post, clone) {
    const li = document.createElement('li');
    const href = safeUrl(post.url);
    const a = document.createElement(href ? 'a' : 'div');
    a.className = 'post-card';
    if (href) {
      a.href = href;
      a.target = '_blank';
      a.rel = 'nofollow ugc noopener noreferrer';
      a.setAttribute('aria-label', (post.name || post.handle) + ' on ' + SOURCE[post.source].label + ': ' + post.text);
    }
    if (clone) { li.setAttribute('aria-hidden', 'true'); if (href) a.tabIndex = -1; }

    const text = document.createElement('p');
    text.className = 'post-text';
    text.textContent = post.text;
    a.appendChild(text);

    const meta = document.createElement('div');
    meta.className = 'post-meta';
    meta.appendChild(sourceIcon(post.source));
    const name = document.createElement('span'); name.className = 'post-name'; name.textContent = post.name; meta.appendChild(name);
    const handle = document.createElement('span'); handle.className = 'post-handle'; handle.textContent = post.handle; meta.appendChild(handle);
    const date = document.createElement('time'); date.className = 'post-date'; date.dateTime = post.at || ''; date.textContent = shortDate(post.at); meta.appendChild(date);
    a.appendChild(meta);

    li.appendChild(a);
    return li;
  }

  function renderStream(posts) {
    streamSection.hidden = false;
    track.replaceChildren();
    if (!posts.length) { ticker.hidden = true; streamEmpty.hidden = false; return; }
    streamEmpty.hidden = true;
    ticker.hidden = false;

    posts.forEach(p => track.appendChild(card(p, false)));
    if (reduceMotion.matches) { track.style.removeProperty('--ticker-duration'); return; }

    // Repeat the set until it is wider than the screen, then duplicate it once:
    // translating the track by -50% then loops without a visible seam.
    let setWidth = track.scrollWidth;
    let guard = 0;
    while (setWidth < window.innerWidth && guard++ < 20) {
      posts.forEach(p => track.appendChild(card(p, true)));
      setWidth = track.scrollWidth;
    }
    [...track.children].forEach(li => {
      const copy = li.cloneNode(true);
      copy.setAttribute('aria-hidden', 'true');
      const link = copy.querySelector('a');
      if (link) link.tabIndex = -1;
      track.appendChild(copy);
    });
    ticker.style.setProperty('--ticker-duration', Math.round(setWidth / PX_PER_SECOND) + 's');
  }

  async function loadStream() {
    try {
      const res = await fetch('/api/stream', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const key = data.posts.map(p => p.id).join('|');
      if (key === lastStreamKey && !streamSection.hidden) return;
      lastStreamKey = key;
      renderStream(data.posts);
    } catch {}
  }

  loadStream();
  setInterval(loadStream, 2 * 60 * 1000);
  reduceMotion.addEventListener('change', () => { lastStreamKey = ''; loadStream(); });

  loadSignatures();
})();
