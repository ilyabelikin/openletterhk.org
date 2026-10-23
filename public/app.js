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

  loadSignatures();
})();
