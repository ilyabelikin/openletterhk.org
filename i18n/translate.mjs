// Cantonese translation pipeline for openletterhk.org — runs on the server.
// Key comes from the environment (--env-file); it is never printed or written.
import fs from 'node:fs';

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('OPENROUTER_API_KEY missing'); process.exit(1); }
const MODEL = 'qwen/qwen3.8-max-prime';
const DIR = new URL('.', import.meta.url).pathname;
const source = JSON.parse(fs.readFileSync(DIR + 'source.json', 'utf8'));
let totalCost = 0;

async function ask(label, system, user) {
  const t0 = Date.now();
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 8 * 60 * 1000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: ctl.signal,
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://openletterhk.org', 'X-Title': 'openletterhk translation' },
      body: JSON.stringify({ model: MODEL, max_tokens: 32000, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    const j = await res.json();
    if (!res.ok || j.error) throw new Error(`${label}: ${res.status} ${JSON.stringify(j.error || j).slice(0, 300)}`);
    const ch = j.choices[0];
    totalCost += j.usage?.cost || 0;
    const raw = (ch.message.content || '').trim();
    const body = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const start = body.indexOf('{'), end = body.lastIndexOf('}');
    const parsed = JSON.parse(body.slice(start, end + 1));
    console.log(`  ✓ ${label.padEnd(26)} ${((Date.now() - t0) / 1000).toFixed(0)}s  finish=${ch.finish_reason}  out=${j.usage?.completion_tokens} (reasoning ${j.usage?.completion_tokens_details?.reasoning_tokens ?? '?'})  $${(j.usage?.cost || 0).toFixed(4)}`);
    return parsed;
  } finally { clearTimeout(timer); }
}

const COMMON = `
You are translating an open letter and its web page for openletterhk.org, written by Ilya Belikin, a founder living in Hong Kong who was born in the USSR. The letter criticises Anthropic for blocking Hong Kong users of Claude / Claude Code.

Hard rules:
- Hong Kong Traditional Chinese characters only (HK conventions, e.g. 裡/裏, 着 as used in HK). Never Simplified characters.
- Hong Kong vocabulary, never Mainland terms: 資訊 not 信息, 網絡 not 网络/網路, 用戶 not 用户, 軟件 not 软件, 程式 not 程序 (for software), 質素 where natural, 互聯網, 人工智能 (or AI), 私隱 not 隱私, 支援, 公司, 創辦人.
- Hong Kong full-width punctuation: ，。、；：？！ and 「」『』 for quotes, …… for ellipsis, —— for dashes.
- Keep these in English exactly: Anthropic, Claude, Claude Code, VPN, AI, Instagram, Bluesky, X, Google, Gemini, GitHub, CC BY 4.0, openletterhk.org, #openletterhk, Haah, Inc., Fable 5.1 High.
- Placeholders in double braces are link anchors or template variables. Keep every {{...}} token byte-for-byte identical (e.g. {{Anthropic}}, {{Claude Code}}, {{Haah, Inc.}}, {{#openletterhk}}, {{GitHub}}, {{CC BY 4.0}}, {{total}}, {{named}}, {{anonymous}}), EXCEPT {{Privacy.}}: translate the word inside but keep the braces, e.g. {{私隱。}}.
- It is a personal, first-person, impassioned letter. Keep the author's voice, rhythm and bluntness. The line "There is no excuse for being so damn smart and so damn clueless at the same time" must stay sharp and a little rude, not softened into politeness. Keep the three "There is no excuse…" lines as a parallel refrain.
- Translate meaning faithfully. Do not add, drop, soften or strengthen claims.
- UI strings must be short, natural button/label text as seen on Hong Kong websites.
- Output ONLY a JSON object with exactly the same structure and keys as the input, every string translated. No commentary, no code fences.`;

const STYLES = {
  colloquial: `Target style: COLLOQUIAL WRITTEN CANTONESE (粵語白話文) as Hong Kong people write online and in opinion columns — natural Cantonese grammar and particles (嘅、咗、唔、喺、佢哋、我哋、點解、冇、嘢、咁、啦、㗎 where natural). It must read like a Hongkonger wrote it, not like Standard Chinese with a few particles sprinkled in. UI strings may stay concise/neutral where Cantonese particles would be odd on a button.`,
  formal: `Target style: FORMAL WRITTEN CHINESE (書面語) in Hong Kong Traditional characters, as in a Hong Kong newspaper op-ed or a public open letter. No Cantonese colloquial particles or grammar (no 嘅、咗、唔、喺、佢哋). Dignified but still personal and forceful.`,
};

const EDITOR = `You are a senior Hong Kong copy editor. You will get an English source and a draft translation (JSON).
Check every string against the source and fix: translationese or stiff phrasing; any Simplified character or Mainland term; wrong register for the requested style; meaning drift, omissions or additions; softened tone (the letter is blunt — keep it blunt); damaged {{...}} placeholders (they must match the source exactly, except {{Privacy.}} whose inner word is translated); non-HK punctuation.
Return ONLY JSON: {"revised": <the full translation, same structure and keys>, "notes": [<short English bullets of what you changed and why; max 12>]}.`;

const BACK = `Translate this Chinese JSON back into plain, literal English, preserving structure and keys, so a reviewer can check the meaning. Do not polish or improve it. Return ONLY the JSON.`;

const SIMPLIFIED = '们这说为时会国个来对发经无门问间听让还进过么当应现东认关点样头车马长书业语网络视频软质数据该让开从样实际总还没给过选项权'.split('');
function audit(tr) {
  const flat = JSON.stringify(tr);
  const srcTokens = (JSON.stringify(source).match(/\{\{[^}]+\}\}/g) || []).filter(t => t !== '{{Privacy.}}').sort();
  const trTokens = (flat.match(/\{\{[^}]+\}\}/g) || []).filter(t => !/^\{\{[^A-Za-z#{]/.test(t) || srcTokens.includes(t)).sort();
  const missing = srcTokens.filter(t => !trTokens.includes(t));
  const simp = [...new Set(flat.split('').filter(c => SIMPLIFIED.includes(c)))];
  const keysMatch = JSON.stringify(Object.keys(source)) === JSON.stringify(Object.keys(tr)) &&
    ['before', 'refrain', 'after'].every(k => (tr.letter?.[k]?.length) === source.letter[k].length);
  return { placeholders_missing: missing, simplified_chars_found: simp, structure_ok: keysMatch };
}

async function variant(name) {
  console.log(`\n[${name}]`);
  let draft;
  if (process.env.REUSE_DRAFT && fs.existsSync(DIR + `${name}.draft.json`)) {
    draft = JSON.parse(fs.readFileSync(DIR + `${name}.draft.json`, 'utf8'));
    console.log(`  ↺ reusing saved draft`);
  } else {
    const user = `English source JSON:\n${JSON.stringify(source, null, 2)}`;
    draft = await ask(`${name}: translate`, COMMON + '\n' + STYLES[name], user);
    fs.writeFileSync(DIR + `${name}.draft.json`, JSON.stringify(draft, null, 2));
  }
  const ed = await ask(`${name}: HK editor pass`, EDITOR + '\n' + COMMON + '\n' + STYLES[name],
    `Requested style: ${name}\n\nEnglish source:\n${JSON.stringify(source, null, 2)}\n\nDraft translation:\n${JSON.stringify(draft, null, 2)}`);
  fs.writeFileSync(DIR + `${name}.editor-raw.json`, JSON.stringify(ed, null, 2));
  // Editors sometimes return the translation bare or under another key.
  const final = ed.revised || ed.translation || ed.revised_translation || (ed.letter ? ed : null);
  if (!final || !final.letter) throw new Error(`${name}: editor returned keys ${Object.keys(ed).join(",")}`);
  fs.writeFileSync(DIR + `${name}.json`, JSON.stringify(final, null, 2));
  fs.writeFileSync(DIR + `${name}.notes.json`, JSON.stringify(ed.notes || [], null, 2));
  const back = await ask(`${name}: back-translate`, BACK, JSON.stringify({ letter: final.letter, cards: final.cards, share_text: final.share?.share_text }, null, 2));
  fs.writeFileSync(DIR + `${name}.back.json`, JSON.stringify(back, null, 2));
  const a = audit(final);
  console.log(`  audit: structure_ok=${a.structure_ok}  placeholders_missing=${JSON.stringify(a.placeholders_missing)}  simplified=${JSON.stringify(a.simplified_chars_found)}`);
  return a;
}

const results = await Promise.all((process.env.ONLY ? process.env.ONLY.split(',') : ['colloquial', 'formal']).map(n => variant(n).catch(e => { console.error(`  ✗ ${n}: ${e.message}`); return null; })));
console.log(`\nmodel: ${MODEL}   total cost: $${totalCost.toFixed(4)}`);
if (results.some(r => !r)) process.exit(1);
