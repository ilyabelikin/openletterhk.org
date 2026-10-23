// Build the translated pages from public/index.html + i18n/<locale>.json, plus
// share-card HTML in og/. Every replacement must match exactly once; the build
// fails if English text survives in a translated page.
//   node i18n/build.mjs && ./og/render.sh
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const BASE = 'https://openletterhk.org/';
const TAG = '#openletterhk';

// lang: the page's language (drives fonts and screen-reader voice);
// hreflang: what search engines are told. /yue is read aloud in Cantonese (zh-HK)
// but advertised as yue-Hant-HK, leaving zh-HK to the formal written version.
export const LOCALES = [
  { code: 'zh-hk', file: 'i18n/zh.json',  lang: 'zh-Hant-HK', hreflang: 'zh-HK',       label: '中文',   locale: 'zh_HK' },
  { code: 'yue',   file: 'i18n/yue.json', lang: 'zh-HK',      hreflang: 'yue-Hant-HK', label: '廣東話', locale: 'zh_HK' },
];
const EN = { code: '', lang: 'en', hreflang: 'en', label: 'English' };
const pageUrl = l => l.code ? BASE + l.code : BASE;
const pagePath = l => l.code ? '/' + l.code : '/';

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
// Escape text, then turn {{tokens}} into links; unknown tokens (a translated "Privacy.") become <strong>.
const rich = s => esc(s).replace(/\{\{([^}]+)\}\}/g, (m, k) => LINKS[k] || `<strong>${k}</strong>`);
const plain = s => s.replace(/\{\{([^}]+)\}\}/g, '$1');
const h1Html = p => esc(p.h1_line1) + (p.h1_line2 ? '<br>' + esc(p.h1_line2) : '');

// Links to every language except the current one. Used on all pages, English included.
export function langSwitch(current) {
  return [EN, ...LOCALES].filter(l => l.code !== current.code)
    .map(l => `<a href="${pagePath(l)}" hreflang="${l.hreflang}" lang="${l.lang}">${esc(l.label)}</a>`).join('');
}
export function alternates() {
  return [EN, ...LOCALES].map(l => `  <link rel="alternate" hreflang="${l.hreflang}" href="${pageUrl(l)}">`).join('\n') +
    `\n  <link rel="alternate" hreflang="x-default" href="${BASE}">`;
}

function build(loc, en, tr, source) {
  let html = source;
  const URL_L = pageUrl(loc);
  const swap = (label, from, to) => {
    const n = html.split(from).length - 1;
    if (n !== 1) throw new Error(`[${loc.code}] ${label}: expected exactly 1 match, found ${n}`);
    html = html.replace(from, () => to);
  };
  const swapAll = (label, from, to) => {
    const n = html.split(from).length - 1;
    if (n < 1) throw new Error(`[${loc.code}] ${label}: no match`);
    html = html.split(from).join(to);
    return n;
  };
  const swapBlock = (label, startMarker, endMarker, replacement) => {
    const i = html.indexOf(startMarker), j = html.indexOf(endMarker, i);
    if (i < 0 || j < 0) throw new Error(`[${loc.code}] ${label}: block not found`);
    html = html.slice(0, i) + replacement + html.slice(j + endMarker.length);
  };

  // ── head
  swap('lang', '<html lang="en">', `<html lang="${loc.lang}">`);
  swap('title', `<title>${esc(en.page.title)}</title>`, `<title>${esc(tr.page.title)}</title>`);
  swap('description', `<meta name="description" content="${attr(en.page.description)}">`, `<meta name="description" content="${attr(tr.page.description)}">`);
  swap('canonical', `<link rel="canonical" href="${BASE}">`, `<link rel="canonical" href="${URL_L}">`);
  swap('og:title', `<meta property="og:title" content="${attr(en.page.title)}">`, `<meta property="og:title" content="${attr(tr.page.title)}">\n  <meta property="og:locale" content="${loc.locale}">\n  <meta property="og:locale:alternate" content="en_US">`);
  swap('og:description', `<meta property="og:description" content="${attr(en.page.og_description)}">`, `<meta property="og:description" content="${attr(tr.page.og_description)}">`);
  swap('og:url', `<meta property="og:url" content="${BASE}">`, `<meta property="og:url" content="${URL_L}">`);
  swap('og:image', `<meta property="og:image" content="${BASE}og.png">`, `<meta property="og:image" content="${BASE}og-${loc.code}.png">`);
  const headline = (plain(tr.page.h1_line1) + (tr.page.h1_line2 || '')).replace(/[：:，,、]\s*$/, '');
  const cardAlt = `${tr.page.kicker}：${headline}。「${tr.cards.quote}」Ilya Belikin。openletterhk.org/${loc.code}`;
  html = html.replace(/<meta property="og:image:alt" content="[^"]*">/, `<meta property="og:image:alt" content="${attr(cardAlt)}">`);
  swap('twitter:title', `<meta name="twitter:title" content="${attr(en.page.title)}">`, `<meta name="twitter:title" content="${attr(tr.page.title)}">`);
  swap('twitter:description', `<meta name="twitter:description" content="${attr(en.page.og_description)}">`, `<meta name="twitter:description" content="${attr(tr.page.og_description)}">`);
  swap('twitter:image', `<meta name="twitter:image" content="${BASE}og.png">`, `<meta name="twitter:image" content="${BASE}og-${loc.code}.png">`);
  html = html.replace(/<meta name="twitter:image:alt" content="[^"]*">/, `<meta name="twitter:image:alt" content="${attr(`${tr.page.kicker}：${headline}。Ilya Belikin`)}">`);

  // ── masthead
  swapBlock('language switch', '<p class="lang-switch">', '</p>', `<p class="lang-switch">${langSwitch(loc)}</p>`);
  swap('kicker', `<p class="kicker">${esc(en.page.kicker)}</p>`, `<p class="kicker">${esc(tr.page.kicker)}</p>`);
  swap('h1', `<h1>${h1Html(en.page)}</h1>`, `<h1>${h1Html(tr.page)}</h1>`);
  swap('dateline', `<p class="dateline"><time datetime="2026-10-23">${esc(en.page.dateline)}</time></p>`, `<p class="dateline"><time datetime="2026-10-23">${esc(tr.page.dateline)}</time></p>`);

  // ── letter (rebuilt from the translation)
  const p = s => `      <p>${rich(s)}</p>`;
  swapBlock('letter', '<article class="letter">', '</article>', `<article class="letter">
${tr.letter.before.map(p).join('\n\n')}

      <div class="refrain">
${tr.letter.refrain.map(s => '  ' + p(s)).join('\n')}
      </div>

${tr.letter.after.map(p).join('\n\n')}

      <footer class="signoff">
        <p class="signoff-name"><a href="https://ilyabelikin.com" rel="noopener">Ilya Belikin</a></p>
        <p class="signoff-role">${rich(tr.page.signoff_role)}</p>
      </footer>
    </article>`);

  // ── sign form
  swap('sign heading', `<h2 id="sign-heading">${esc(en.sign.heading)}</h2>`, `<h2 id="sign-heading">${esc(tr.sign.heading)}</h2>`);
  swap('sign lede', `<p class="lede">${esc(en.sign.lede)}</p>`, `<p class="lede">${esc(tr.sign.lede)}</p>`);
  swap('legend', `<legend>${esc(en.sign.legend)}</legend>`, `<legend>${esc(tr.sign.legend)}</legend>`);
  swap('opt named', `value="named" checked> ${esc(en.sign.opt_named)}</label>`, `value="named" checked> ${esc(tr.sign.opt_named)}</label>`);
  swap('opt anon', `value="anonymous"> ${esc(en.sign.opt_anon)}</label>`, `value="anonymous"> ${esc(tr.sign.opt_anon)}</label>`);
  swap('label name', `<label for="name">${esc(en.sign.label_name)} <span class="hint">${esc(en.sign.hint_required)}</span></label>`, `<label for="name">${esc(tr.sign.label_name)} <span class="hint">${esc(tr.sign.hint_required)}</span></label>`);
  swap('label website', `<label for="website">${esc(en.sign.label_website)} <span class="hint">${esc(en.sign.hint_website)}</span></label>`, `<label for="website">${esc(tr.sign.label_website)} <span class="hint">${esc(tr.sign.hint_website)}</span></label>`);
  swap('submit', `<button type="submit" id="submit-btn">${esc(en.sign.submit)}</button>`, `<button type="submit" id="submit-btn">${esc(tr.sign.submit)}</button>`);

  // ── share
  swap('share heading', `<h2 id="share-heading">${esc(en.share.heading)}</h2>`, `<h2 id="share-heading">${esc(tr.share.heading)}</h2>`);
  swap('share lede', `<p class="lede">${rich(en.share.lede)}</p>`, `<p class="lede">${rich(tr.share.lede)}</p>`);
  const enText = `${en.share.share_text} ${TAG}`, trText = `${tr.share.share_text} ${TAG}`;
  const enc = encodeURIComponent;
  swap('data-share-url', `data-share-url="${BASE}"`, `data-share-url="${URL_L}" data-instagram-image="/share-instagram-${loc.code}.png"`);
  swap('data-share-text', `data-share-text="${attr(enText)}"`, `data-share-text="${attr(trText)}"`);
  swap('data-share-title', `data-share-title="${attr(en.share.email_subject)}"`, `data-share-title="${attr(tr.share.email_subject)}"`);
  // longest patterns first: the mail body and "text url" both contain the bare share text
  const n1 = swapAll('share text + url', enc(enText + ' ' + BASE), enc(trText + ' ' + URL_L));
  swapAll('mail body', enc(enText + '\n\n' + BASE), enc(trText + '\n\n' + URL_L));
  const n2 = swapAll('share text', enc(en.share.share_text), enc(tr.share.share_text));
  // the translated URL starts with the English one, so skip occurrences already rewritten
  const urlRe = new RegExp(enc(BASE).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + `(?!${enc(loc.code)})`, 'g');
  const n3 = (html.match(urlRe) || []).length;
  if (!n3) throw new Error(`[${loc.code}] share url: no match`);
  html = html.replace(urlRe, enc(URL_L));
  swap('mail subject', `subject=${enc(en.share.email_subject)}`, `subject=${enc(tr.share.email_subject)}`);
  swap('btn native', `<span>${esc(en.share.btn_native)}</span>`, `<span>${esc(tr.share.btn_native)}</span>`);
  swap('btn copy', `<span>${esc(en.share.btn_copy)}</span>`, `<span>${esc(tr.share.btn_copy)}</span>`);
  swap('btn email', `<span>${esc(en.share.btn_email)}</span>`, `<span>${esc(tr.share.btn_email)}</span>`);

  // ── stream, signatories, footer
  swap('stream lede', `<p class="lede">${rich(en.stream.lede)}</p>`, `<p class="lede">${rich(tr.stream.lede)}</p>`);
  swap('stream empty', `hidden>${rich(en.stream.empty)}</p>`, `hidden>${rich(tr.stream.empty)}</p>`);
  swap('undersigned', `<h2 id="sig-heading">${esc(en.undersigned.heading)}</h2>`, `<h2 id="sig-heading">${esc(tr.undersigned.heading)}</h2>`);
  swap('loading', `class="count">${esc(en.undersigned.loading)}</p>`, `class="count">${esc(tr.undersigned.loading)}</p>`);
  swapBlock('colophon', '<footer class="colophon">', '</footer>', `<footer class="colophon">
      <p>${rich(tr.footer.privacy)}</p>
      <p>${rich(tr.footer.license)}</p>
      <p class="made">${rich(tr.footer.made)}</p>
    </footer>`);

  // ── UI strings for app.js (JSON data block: not executed, allowed by the CSP)
  const S = tr.sign, Sh = tr.share, U = tr.undersigned;
  const T = {
    need_name: S.status_need_name, adding: S.status_adding, checking: S.status_checking, thanks: S.status_thanks,
    error: S.status_error, network: S.status_network,
    name_invalid: S.error_name_invalid, name_not_a_name: S.error_name_not_a_name, website_invalid: S.error_website_invalid,
    website_unreachable: S.error_website_unreachable, duplicate: S.error_duplicate, rate_limited: S.error_rate_limited,
    first: U.first, load_failed: U.load_failed, count: U.count_template,
    copied: Sh.status_copied, copy_failed: Sh.status_copy_failed, native_failed: Sh.status_native_failed,
    instagram_sheet: Sh.status_instagram_sheet, instagram_download: Sh.status_instagram_download,
  };
  const missing = Object.entries(T).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`[${loc.code}] missing UI strings: ${missing.join(', ')}`);
  const json = JSON.stringify(T).replace(/</g, '\\u003c');
  swap('i18n block', '  <script src="/app.js" defer></script>', `  <script type="application/json" id="i18n">${json}</script>\n  <script src="/app.js" defer></script>`);

  // leftover English check
  const leftovers = [...en.letter.before, ...en.letter.refrain, ...en.letter.after].map(plain).filter(s => html.includes(s.slice(0, 40)));
  const uiLeft = ['Add your signature', 'Share the letter', 'Undersigned', 'Sign the letter', 'Copy link', 'Loading signatures', 'Made with love'].filter(s => html.includes(s));
  if (leftovers.length || uiLeft.length) throw new Error(`[${loc.code}] English left: ${JSON.stringify([...leftovers.map(s => s.slice(0, 40)), ...uiLeft])}`);

  const out = path.join(ROOT, 'public', loc.code, 'index.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html.replace('<!doctype html>', `<!doctype html>\n<!-- GENERATED by i18n/build.mjs from public/index.html + ${loc.file} — do not edit by hand. -->`));
  console.log(`wrote public/${loc.code}/index.html (share links: text+url ${n1}, text ${n2}, url ${n3})`);

  // ── share cards: same layout as the English cards, translated text
  const cardText = s => s
    .replace('<div class="kicker">An open letter</div>', `<div class="kicker">${esc(tr.page.kicker)}</div>`)
    .replace(/<h1>To Anthropic,<br>from (?:<span class="nw">)?Hong Kong(?:<\/span>)?<\/h1>/, `<h1>${h1Html(tr.page)}</h1>`)
    .replace(/<p class="quote">[^<]*<\/p>/, `<p class="quote">${esc(tr.cards.quote)}</p>`)
    .replace('<div class="role">Founder of Haah, Inc.</div>', `<div class="role">${esc(plain(tr.page.signoff_role))}</div>`)
    .replace('<div class="url">openletterhk.org</div>', `<div class="url">openletterhk.org/${loc.code}</div>`)
    .replace(/<div class="sub">Read it &amp; add your signature( →)?<\/div>/, (m, arrow) => `<div class="sub">${esc(tr.cards.cta)}${arrow || ''}</div>`)
    .replace('<html>', `<html lang="${loc.lang}">`)
    .replace('</style>', `.kicker { letter-spacing: .2em; }\nh1, .quote { font-family: "Songti TC", "Noto Serif TC", Charter, serif; }\nh1 { letter-spacing: 0; line-height: 1.15; }\n.quote { line-height: 1.6; word-break: keep-all; }\n</style>`);
  for (const [src, out] of [['og/card.html', `og/card-${loc.code}.html`], ['og/card-portrait.html', `og/card-portrait-${loc.code}.html`]]) {
    const after = cardText(read(src));
    const ok = [tr.page.kicker, tr.cards.quote, `openletterhk.org/${loc.code}`, tr.cards.cta].every(x => after.includes(esc(x)));
    if (!ok) throw new Error(`[${loc.code}] ${out}: not every card string was replaced`);
    fs.writeFileSync(path.join(ROOT, out), after);
  }
  console.log(`wrote og/card-${loc.code}.html, og/card-portrait-${loc.code}.html`);
}

// ── English source page: keep its language switch and hreflang list in sync
let index = read('public/index.html');
const syncBlock = (start, end, replacement, label) => {
  const i = index.indexOf(start), j = index.indexOf(end, i);
  if (i < 0 || j < 0) throw new Error(`index.html ${label}: not found`);
  index = index.slice(0, i) + replacement + index.slice(j + end.length);
};
syncBlock('<p class="lang-switch">', '</p>', `<p class="lang-switch">${langSwitch(EN)}</p>`, 'language switch');
const altStart = index.indexOf('  <link rel="alternate" hreflang=');
const altEnd = index.indexOf('hreflang="x-default"', altStart);
if (altStart < 0 || altEnd < 0) throw new Error('index.html alternates not found');
index = index.slice(0, altStart) + alternates() + index.slice(index.indexOf('>', altEnd) + 1);
fs.writeFileSync(path.join(ROOT, 'public/index.html'), index);
console.log('synced public/index.html language switch + hreflang');

const en = JSON.parse(read('i18n/en.json'));
for (const loc of LOCALES) build(loc, en, JSON.parse(read(loc.file)), index);
