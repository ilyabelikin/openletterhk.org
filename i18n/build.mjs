// Build public/yue/index.html (written Cantonese) from public/index.html + i18n/yue.json,
// and the Cantonese share cards' HTML in og/. Every replacement must match exactly once.
//   node i18n/build.mjs && ./og/render.sh
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const en = JSON.parse(read('i18n/en.json'));
const yue = JSON.parse(read('i18n/yue.json'));
const BASE = 'https://openletterhk.org/';
const URL_YUE = 'https://openletterhk.org/yue';
const TAG = '#openletterhk';

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = s => esc(s).replace(/"/g, '&quot;');
const LINKS = {
  'Anthropic': '<a href="https://www.anthropic.com" rel="noopener">Anthropic</a>',
  'Claude Code': '<a href="https://claude.com/claude-code" rel="noopener">Claude Code</a>',
  'Haah, Inc.': '<a href="https://haah.ing" rel="noopener">Haah, Inc.</a>',
  '#openletterhk': '<strong>#openletterhk</strong>',
  'CC BY 4.0': '<a href="https://creativecommons.org/licenses/by/4.0/" rel="license noopener">CC BY 4.0</a>',
  'GitHub': '<a href="https://github.com/ilyabelikin/openletterhk.org" rel="noopener">GitHub</a>',
};
// Escape text, then turn {{tokens}} into links; unknown tokens (e.g. the translated "Privacy.") become <strong>.
const rich = s => esc(s).replace(/\{\{([^}]+)\}\}/g, (m, k) => LINKS[k] || `<strong>${k}</strong>`);
const plain = s => s.replace(/\{\{([^}]+)\}\}/g, '$1');

let html = read('public/index.html');
const swap = (label, from, to) => {
  const n = html.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: expected exactly 1 match, found ${n}`);
  html = html.replace(from, () => to);
};
const swapAll = (label, from, to) => {
  const n = html.split(from).length - 1;
  if (n < 1) throw new Error(`${label}: no match`);
  html = html.split(from).join(to);
  return n;
};

// ── head
swap('lang', '<html lang="en">', '<html lang="zh-HK">');
swap('title', `<title>${esc(en.page.title)}</title>`, `<title>${esc(yue.page.title)}</title>`);
swap('description', `<meta name="description" content="${attr(en.page.description)}">`, `<meta name="description" content="${attr(yue.page.description)}">`);
swap('canonical', `<link rel="canonical" href="${BASE}">`, `<link rel="canonical" href="${URL_YUE}">`);
swap('og:title', `<meta property="og:title" content="${attr(en.page.title)}">`, `<meta property="og:title" content="${attr(yue.page.title)}">\n  <meta property="og:locale" content="zh_HK">\n  <meta property="og:locale:alternate" content="en_US">`);
swap('og:description', `<meta property="og:description" content="${attr(en.page.og_description)}">`, `<meta property="og:description" content="${attr(yue.page.og_description)}">`);
swap('og:url', `<meta property="og:url" content="${BASE}">`, `<meta property="og:url" content="${URL_YUE}">`);
swap('og:image', `<meta property="og:image" content="${BASE}og.png">`, `<meta property="og:image" content="${BASE}og-yue.png">`);
html = html.replace(/<meta property="og:image:alt" content="[^"]*">/, `<meta property="og:image:alt" content="${attr(`${yue.page.kicker}：${yue.page.h1_line1}${yue.page.h1_line2}。「${yue.cards.quote}」Ilya Belikin。openletterhk.org/yue`)}">`);
swap('twitter:title', `<meta name="twitter:title" content="${attr(en.page.title)}">`, `<meta name="twitter:title" content="${attr(yue.page.title)}">`);
swap('twitter:description', `<meta name="twitter:description" content="${attr(en.page.og_description)}">`, `<meta name="twitter:description" content="${attr(yue.page.og_description)}">`);
swap('twitter:image', `<meta name="twitter:image" content="${BASE}og.png">`, `<meta name="twitter:image" content="${BASE}og-yue.png">`);
html = html.replace(/<meta name="twitter:image:alt" content="[^"]*">/, `<meta name="twitter:image:alt" content="${attr(`${yue.page.kicker}：${yue.page.h1_line1}${yue.page.h1_line2}。Ilya Belikin`)}">`);

// ── masthead
swap('language switch', '<a href="/yue" hreflang="zh-HK" lang="zh-HK">廣東話</a>', `<a href="/" hreflang="en" lang="en">${esc(yue.page.language_switch_label)}</a>`);
swap('kicker', `<p class="kicker">${esc(en.page.kicker)}</p>`, `<p class="kicker">${esc(yue.page.kicker)}</p>`);
swap('h1', `<h1>${esc(en.page.h1_line1)}<br>${esc(en.page.h1_line2)}</h1>`, `<h1>${esc(yue.page.h1_line1)}<br>${esc(yue.page.h1_line2)}</h1>`);
swap('dateline', `<p class="dateline">${esc(en.page.dateline)}</p>`, `<p class="dateline">${esc(yue.page.dateline)}</p>`);

// ── letter (rebuilt from the translation)
const p = s => `      <p>${rich(s)}</p>`;
const letter = `<article class="letter">
${yue.letter.before.map(p).join('\n\n')}

      <div class="refrain">
${yue.letter.refrain.map(s => '  ' + p(s)).join('\n')}
      </div>

${yue.letter.after.map(p).join('\n\n')}

      <footer class="signoff">
        <p class="signoff-name"><a href="https://ilyabelikin.com" rel="noopener">Ilya Belikin</a></p>
        <p class="signoff-role">${rich(yue.page.signoff_role)}</p>
      </footer>
    </article>`;
const artStart = html.indexOf('<article class="letter">'), artEnd = html.indexOf('</article>') + '</article>'.length;
if (artStart < 0 || artEnd < artStart) throw new Error('letter article not found');
html = html.slice(0, artStart) + letter + html.slice(artEnd);

// ── sign form
swap('sign heading', `<h2 id="sign-heading">${esc(en.sign.heading)}</h2>`, `<h2 id="sign-heading">${esc(yue.sign.heading)}</h2>`);
swap('sign lede', `<p class="lede">${esc(en.sign.lede)}</p>`, `<p class="lede">${esc(yue.sign.lede)}</p>`);
swap('legend', `<legend>${esc(en.sign.legend)}</legend>`, `<legend>${esc(yue.sign.legend)}</legend>`);
swap('opt named', `value="named" checked> ${esc(en.sign.opt_named)}</label>`, `value="named" checked> ${esc(yue.sign.opt_named)}</label>`);
swap('opt anon', `value="anonymous"> ${esc(en.sign.opt_anon)}</label>`, `value="anonymous"> ${esc(yue.sign.opt_anon)}</label>`);
swap('label name', `<label for="name">${esc(en.sign.label_name)} <span class="hint">${esc(en.sign.hint_required)}</span></label>`, `<label for="name">${esc(yue.sign.label_name)} <span class="hint">${esc(yue.sign.hint_required)}</span></label>`);
swap('label website', `<label for="website">${esc(en.sign.label_website)} <span class="hint">${esc(en.sign.hint_website)}</span></label>`, `<label for="website">${esc(yue.sign.label_website)} <span class="hint">${esc(yue.sign.hint_website)}</span></label>`);
swap('submit', `<button type="submit" id="submit-btn">${esc(en.sign.submit)}</button>`, `<button type="submit" id="submit-btn">${esc(yue.sign.submit)}</button>`);

// ── share
swap('share heading', `<h2 id="share-heading">${esc(en.share.heading)}</h2>`, `<h2 id="share-heading">${esc(yue.share.heading)}</h2>`);
swap('share lede', `<p class="lede">${rich(en.share.lede)}</p>`, `<p class="lede">${rich(yue.share.lede)}</p>`);
const enText = `${en.share.share_text} ${TAG}`, yueText = `${yue.share.share_text} ${TAG}`;
const enc = encodeURIComponent;
swap('data-share-url', `data-share-url="${BASE}"`, `data-share-url="${URL_YUE}" data-instagram-image="/share-instagram-yue.png"`);
swap('data-share-text', `data-share-text="${attr(enText)}"`, `data-share-text="${attr(yueText)}"`);
swap('data-share-title', `data-share-title="${attr(en.share.email_subject)}"`, `data-share-title="${attr(yue.share.email_subject)}"`);
// links carry the share text before the URL ("text url"), or the text with the hashtag as its own param for X
const n1 = swapAll('share text + url (encoded)', enc(enText + ' ' + BASE), enc(yueText + ' ' + URL_YUE));
// longest patterns first: the mail body and "text url" both contain the bare share text
swapAll('mail body', enc(enText + '\n\n' + BASE), enc(yueText + '\n\n' + URL_YUE));
const n2 = swapAll('share text (encoded)', enc(en.share.share_text), enc(yue.share.share_text));
// the Cantonese URL starts with the English one, so skip occurrences already rewritten
const urlRe = new RegExp(enc(BASE).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!yue)', 'g');
const n3 = (html.match(urlRe) || []).length;
if (!n3) throw new Error('share url (encoded): no match');
html = html.replace(urlRe, enc(URL_YUE));
swap('mail subject', `subject=${enc(en.share.email_subject)}`, `subject=${enc(yue.share.email_subject)}`);
swap('btn native', `<span>${esc(en.share.btn_native)}</span>`, `<span>${esc(yue.share.btn_native)}</span>`);
swap('btn copy', `<span>${esc(en.share.btn_copy)}</span>`, `<span>${esc(yue.share.btn_copy)}</span>`);
swap('btn email', `<span>${esc(en.share.btn_email)}</span>`, `<span>${esc(yue.share.btn_email)}</span>`);

// ── stream, signatories, footer
swap('stream lede', `<p class="lede">${rich(en.stream.lede)}</p>`, `<p class="lede">${rich(yue.stream.lede)}</p>`);
swap('stream empty', `hidden>${rich(en.stream.empty)}</p>`, `hidden>${rich(yue.stream.empty)}</p>`);
swap('undersigned', `<h2 id="sig-heading">${esc(en.undersigned.heading)}</h2>`, `<h2 id="sig-heading">${esc(yue.undersigned.heading)}</h2>`);
swap('loading', `class="count">${esc(en.undersigned.loading)}</p>`, `class="count">${esc(yue.undersigned.loading)}</p>`);
const footStart = html.indexOf('<footer class="colophon">'), footEnd = html.indexOf('</footer>', footStart) + '</footer>'.length;
if (footStart < 0) throw new Error('colophon not found');
html = html.slice(0, footStart) + `<footer class="colophon">
      <p>${rich(yue.footer.privacy)}</p>
      <p>${rich(yue.footer.license)}</p>
      <p class="made">${rich(yue.footer.made)}</p>
    </footer>` + html.slice(footEnd);

// ── UI strings for app.js (JSON data block: not executed, allowed by the CSP)
const T = {
  need_name: yue.sign.status_need_name, adding: yue.sign.status_adding, thanks: yue.sign.status_thanks,
  error: yue.sign.status_error, network: yue.sign.status_network,
  first: yue.undersigned.first, load_failed: yue.undersigned.load_failed, count: yue.undersigned.count_template,
  copied: yue.share.status_copied, copy_failed: yue.share.status_copy_failed, native_failed: yue.share.status_native_failed,
  instagram_sheet: yue.share.status_instagram_sheet, instagram_download: yue.share.status_instagram_download,
};
const json = JSON.stringify(T).replace(/</g, '\\u003c');
swap('i18n block', '  <script src="/app.js" defer></script>', `  <script type="application/json" id="i18n">${json}</script>\n  <script src="/app.js" defer></script>`);

// leftover English check: no letter sentence or UI label should survive
const leftovers = [...en.letter.before, ...en.letter.refrain, ...en.letter.after].map(plain).filter(s => html.includes(s.slice(0, 40)));
const uiLeft = ['Add your signature', 'Share the letter', 'Undersigned', 'Sign the letter', 'Copy link', 'Loading signatures', 'Made with love'].filter(s => html.includes(s));
if (leftovers.length || uiLeft.length) throw new Error(`English left in Cantonese page: ${JSON.stringify([...leftovers.map(s => s.slice(0, 40)), ...uiLeft])}`);

fs.mkdirSync(path.join(ROOT, 'public/yue'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'public/yue/index.html'), html.replace('<!doctype html>', '<!doctype html>\n<!-- GENERATED by i18n/build.mjs from public/index.html + i18n/yue.json — do not edit by hand. -->'));
console.log(`wrote public/yue/index.html (share links rewritten: text+url ${n1}, text ${n2}, url ${n3})`);

// ── Cantonese share cards: same layout as the English cards, Cantonese text
const cardText = s => s
  .replace('<div class="kicker">An open letter</div>', `<div class="kicker">${esc(yue.page.kicker)}</div>`)
  .replace(/<h1>To Anthropic,<br>from (?:<span class="nw">)?Hong Kong(?:<\/span>)?<\/h1>/, `<h1>${esc(yue.page.h1_line1)}<br>${esc(yue.page.h1_line2)}</h1>`)
  .replace(/<p class="quote">[^<]*<\/p>/, `<p class="quote">${esc(yue.cards.quote)}</p>`)
  .replace('<div class="role">Founder of Haah, Inc.</div>', `<div class="role">${esc(plain(yue.page.signoff_role))}</div>`)
  .replace('<div class="url">openletterhk.org</div>', '<div class="url">openletterhk.org/yue</div>')
  .replace(/<div class="sub">Read it &amp; add your signature( →)?<\/div>/, (m, arrow) => `<div class="sub">${esc(yue.cards.cta)}${arrow || ''}</div>`)
  .replace('<html>', '<html lang="zh-HK">')
  .replace('</style>', `.kicker { letter-spacing: .3em; }\nh1, .quote { font-family: "Songti TC", "Noto Serif TC", Charter, serif; }\nh1 { letter-spacing: 0; line-height: 1.15; }\n.quote { line-height: 1.6; }\n</style>`);
for (const [src, out] of [['og/card.html', 'og/card-yue.html'], ['og/card-portrait.html', 'og/card-portrait-yue.html']]) {
  const before = read(src), after = cardText(before);
  const changed = ['公開信', yue.cards.quote, 'openletterhk.org/yue', yue.cards.cta].every(x => after.includes(esc(x)));
  if (!changed) throw new Error(`${out}: not every card string was replaced`);
  fs.writeFileSync(path.join(ROOT, out), after);
  console.log(`wrote ${out}`);
}
