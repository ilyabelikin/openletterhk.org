'use strict';

// AI moderation of named signatures via OpenRouter (default: z-ai/glm-5.3-flash).
// Runs after a signature is saved as "pending", so signers never wait on it.
// Tested on 20 real and troll signatures (20/20); ~$0.00003 per check.

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 60000;
const RETRIES = 2;
const CONCURRENCY = 3;

const SYSTEM = `You moderate signatures on a public open letter (openletterhk.org) asking Anthropic to stop blocking Hong Kong users. Each signature is a name and an optional website of the signer's business. Decide whether to SHOW it or HIDE it.

HIDE when it is clearly not a genuine signature:
- insults, profanity, slurs, mockery, or a message/comment instead of a name (in any language, including slang like "dumbaf", "as f", Cantonese/Mandarin swears);
- sexual or porn references (names of porn performers, adult websites);
- fictional or cartoon characters, memes, joke names;
- impersonation of well-known public figures or executives, especially of AI/tech companies (e.g. Sam Altman, Dario Amodei, Elon Musk), or a website clearly belonging to a big company the signer is unlikely to represent (chatgpt.com, openai.com, google.com, anthropic.com);
- spam, ads, or gibberish.

SHOW when it plausibly is a real person or organisation, even if unusual: any language or script (Chinese, Cyrillic, Arabic…), romanised Cantonese names (e.g. "Chan Fuk Wing", "Ho Lun"), single names, initials, nicknames, company names. Ordinary people can share a name with a celebrity only if nothing else suggests a joke — when in doubt about an ordinary-looking name, SHOW.

Reply with ONLY JSON: {"verdict":"show"|"hide","reason":"<max 8 words>"}`;

function createAiModerator({ key, model = 'z-ai/glm-5.3-flash' }) {
  const enabled = !!key;
  const queue = [];
  let active = 0;

  async function callOnce(name, website) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST', signal: ctl.signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://openletterhk.org', 'X-Title': 'openletterhk moderation' },
        body: JSON.stringify({
          model, max_tokens: 4000, reasoning: { effort: 'low' },
          // Only providers that neither retain nor train on prompts; fastest first.
          provider: { data_collection: 'deny', sort: 'latency' },
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify({ name, website: website || null }) }],
        }),
      });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(`${res.status} ${JSON.stringify(j.error || j).slice(0, 200)}`);
      const text = (j.choices?.[0]?.message?.content || '').trim();
      const v = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      if (v.verdict !== 'show' && v.verdict !== 'hide') throw new Error('unexpected verdict: ' + text.slice(0, 80));
      return { verdict: v.verdict, reason: String(v.reason || '').slice(0, 80), cost: j.usage?.cost || 0, provider: j.provider || '' };
    } finally { clearTimeout(timer); }
  }

  async function check(name, website) {
    let lastErr;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      try { return await callOnce(name, website); }
      catch (err) { lastErr = err; await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); }
    }
    throw lastErr;
  }

  // Queue with limited concurrency; resolves with a verdict or rejects after retries.
  function enqueue(name, website) {
    return new Promise((resolve, reject) => { queue.push({ name, website, resolve, reject }); pump(); });
  }
  function pump() {
    while (active < CONCURRENCY && queue.length) {
      const job = queue.shift();
      active++;
      check(job.name, job.website).then(job.resolve, job.reject).finally(() => { active--; pump(); });
    }
  }

  return { enabled, model, check: enqueue, pending: () => queue.length + active };
}

module.exports = { createAiModerator };
