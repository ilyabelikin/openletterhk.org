'use strict';

(function () {
  const keyForm = document.getElementById('key-form');
  const keyInput = document.getElementById('admin-key');
  const panel = document.getElementById('panel');
  const status = document.getElementById('admin-status');
  const feed = document.getElementById('feed-status');
  const list = document.getElementById('post-list');
  const xForm = document.getElementById('x-form');
  const xUrl = document.getElementById('x-url');

  let key = '';
  try { key = sessionStorage.getItem('olhk-admin-key') || ''; } catch {}

  function say(text, kind) {
    status.textContent = text;
    status.className = 'status' + (kind ? ' ' + kind : '');
  }

  async function api(path, body) {
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: Object.assign({ 'X-Admin-Key': key }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || ('HTTP ' + res.status)), { status: res.status });
    return data;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function render(data) {
    const s = data.status;
    feed.textContent =
      'Tag #' + s.tag + ' · Bluesky is checked automatically every 2 minutes, last at ' + (s.lastBlueskyOk ? new Date(s.lastBlueskyOk).toLocaleString() : 'never') +
      (s.lastBlueskyError ? ' · last error: ' + s.lastBlueskyError : '') +
      ' · filters: account ≥ ' + s.filters.minAccountAgeDays + ' days, ≥ ' + s.filters.minFollowers + ' followers, ' + s.blockedWords + ' blocked words';

    list.replaceChildren();
    if (!data.posts.length) { list.appendChild(el('li', 'admin-empty', 'No posts found yet.')); return; }

    for (const p of data.posts) {
      const li = el('li', 'admin-item');
      const state = p.hidden ? 'hidden' : p.filteredReason ? 'filtered' : 'visible';
      li.classList.add('is-' + state);

      const head = el('div', 'admin-head');
      head.appendChild(el('span', 'admin-badge badge-' + state, state === 'filtered' ? 'filtered: ' + p.filteredReason : state));
      head.appendChild(el('span', 'admin-src', p.source === 'x' ? 'X' : 'Bluesky'));
      head.appendChild(el('span', 'admin-author', (p.name || '') + ' ' + (p.handle || '')));
      head.appendChild(el('time', 'admin-date', !p.at ? '' : p.precision === 'day' ? new Date(p.at).toLocaleDateString() : new Date(p.at).toLocaleString()));
      li.appendChild(head);

      li.appendChild(el('p', 'admin-text', p.text || '(no text)'));

      const actions = el('div', 'admin-actions');
      const open = el('a', null, 'Open'); open.href = p.url; open.target = '_blank'; open.rel = 'noopener noreferrer';
      actions.appendChild(open);
      const toggle = el('button', 'secondary', p.hidden ? 'Unhide' : 'Hide');
      toggle.type = 'button';
      toggle.addEventListener('click', () => act(p.hidden ? '/api/admin/unhide' : '/api/admin/hide', { id: p.id }, p.hidden ? 'Unhidden.' : 'Hidden.'));
      actions.appendChild(toggle);
      if (p.source === 'x') {
        const rm = el('button', 'secondary', 'Remove');
        rm.type = 'button';
        rm.addEventListener('click', () => act('/api/admin/x-remove', { url: p.url }, 'Removed.'));
        actions.appendChild(rm);
      }
      li.appendChild(actions);
      list.appendChild(li);
    }
  }

  async function load() {
    try {
      const data = await api('/api/admin/stream');
      try { sessionStorage.setItem('olhk-admin-key', key); } catch {}
      keyForm.hidden = true;
      panel.hidden = false;
      if (status.parentNode !== panel) { panel.prepend(status); say(""); }
      render(data);
    } catch (err) {
      panel.hidden = true;
      keyForm.hidden = false;
      if (key) say(err.message, 'err');
      try { sessionStorage.removeItem('olhk-admin-key'); } catch {}
      keyForm.after(status);
    }
  }

  async function act(path, body, done) {
    try { await api(path, body); say(done, 'ok'); await load(); }
    catch (err) { say(err.message, 'err'); }
  }

  keyForm.addEventListener('submit', e => { e.preventDefault(); key = keyInput.value.trim(); load(); });

  xForm.addEventListener('submit', async e => {
    e.preventDefault();
    const url = xUrl.value.trim();
    if (!url) return;
    say('Fetching the post from X…');
    try { await api('/api/admin/x-add', { url }); xUrl.value = ''; say('Added to the stream.', 'ok'); await load(); }
    catch (err) { say(err.message, 'err'); }
  });

  if (key) load();
})();
