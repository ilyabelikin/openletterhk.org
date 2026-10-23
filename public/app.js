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
        setStatus('Thank you — your signature has been added.', 'ok');
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

  loadSignatures();
})();
