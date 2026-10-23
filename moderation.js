'use strict';

// "Is this plausibly a name?" — rejects insults and comments typed into the
// name field. Deliberately conservative: words that are also real names
// (Dick, Fanny, Willy, Gay, Wang, Cock, Hore…) are NOT listed.

// English insults/profanity, matched as whole words after de-obfuscation.
const EN_WORDS = [
  'fuck', 'fucking', 'fucker', 'fucked', 'fck', 'shit', 'shitty', 'bullshit', 'crap', 'cunt', 'bitch',
  'bastard', 'asshole', 'arsehole', 'motherfucker', 'wanker', 'twat', 'bollocks', 'prick', 'dickhead', 'douche',
  'idiot', 'idiots', 'moron', 'morons', 'stupid', 'dumb', 'dumbass', 'retard', 'retarded', 'imbecile', 'clown',
  'loser', 'losers', 'sucks', 'suck', 'pathetic', 'garbage', 'trash', 'nonsense', 'joke', 'scam', 'troll', 'fake',
  'lol', 'lmao', 'lmfao', 'rofl', 'wtf', 'stfu', 'gtfo', 'omg', 'kys', 'nazi', 'nigger', 'nigga', 'faggot', 'fag',
];
// Phrases that make it a sentence/comment rather than a name.
const EN_PHRASES = [
  'this is', 'that is', 'it is', "it's", 'you are', "you're", 'go away', 'who cares', 'nobody cares',
  'as f', 'as hell', 'get lost', 'shut up', 'screw you', 'no one', 'nice try', 'what a', 'so dumb', 'so stupid',
];
// CJK swears (substring match; these essentially never occur in names).
const CJK = [
  '屌', '㞗', '撚', '閪', '仆街', '戇鳩', '戆鸠', '冚家鏟', '冚家铲', '含家鏟', '痴線', '黐線', '收皮', '柒頭', '柒头',
  '傻逼', '傻屄', '煞笔', '沙比', '他媽的', '他妈的', '操你', '肏', '草泥馬', '草泥马', '垃圾', '廢柴', '废柴', '白痴', '白癡', '智障', '滾',
];
// Romanised Cantonese swears overlap real name syllables (Diu 刁, Lun 倫, Fuk 福, Chi Sin 志善),
// so only unmistakable ones are listed.
const CANTO_ROMAN = ['on9', 'dllm'];

// Undo common disguises: f*ck, sh1t, @ss, "f u c k".
function normalise(s) {
  return s.toLowerCase()
    .replace(/[0@4]/g, m => ({ 0: 'o', '@': 'a', 4: 'a' }[m]))
    .replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/[5$]/g, 's').replace(/7/g, 't')
    .replace(/[*_.~^`'"-]+/g, '');
}

function notANameReason(name) {
  const raw = String(name).trim();
  const lower = raw.toLowerCase();
  if (/[?!]/.test(raw)) return 'punctuation';
  if (raw.split(/\s+/).length > 6) return 'too many words';
  if (/(.)\1{4,}/u.test(raw.replace(/\s/g, ''))) return 'repeated characters';
  if (!/\p{L}/u.test(raw)) return 'no letters'; // \W would wrongly treat Chinese characters as non-letters
  if (CJK.some(w => raw.includes(w))) return 'insult';
  const words = normalise(raw).split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some(w => EN_WORDS.includes(w))) return 'insult';
  if (words.some(w => /^f+u*c+k+/.test(w))) return 'insult';
  if (words.some(w => CANTO_ROMAN.includes(w))) return 'insult';
  const spaced = ' ' + lower.replace(/\s+/g, ' ') + ' ';
  if (EN_PHRASES.some(p => spaced.includes(' ' + p + (p.endsWith(' ') ? '' : ' ')) || spaced.startsWith(' ' + p + ' '))) return 'comment, not a name';
  return null;
}

// Identity keys for "has this person/site been blocked?": case, accents,
// punctuation, spacing and word order don't matter for names; websites
// compare by host without "www.".
function nameKey(name) {
  return String(name).normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean).sort().join(' ');
}
function hostKey(website) {
  try { return new URL(website).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

// Blocked from the start. Edit freely.
const RESERVED_NAMES = ['Ilya Belikin'];               // the letter's author signs it above, not in the list
const RESERVED_HOSTS = ['anthropic.com', 'claude.ai', 'claude.com'];

// Returns why a new signature should be auto-hidden, or null.
// A signature hidden by a moderator blocks its name (with any website) and its website (with any name).
function blockedReason(name, website, signatures) {
  const nk = nameKey(name), hk = website ? hostKey(website) : '';
  if (RESERVED_NAMES.some(n => nameKey(n) === nk)) return 'reserved name';
  if (hk && RESERVED_HOSTS.some(h => hk === h || hk.endsWith('.' + h))) return 'reserved website';
  for (const s of signatures) {
    // Only signatures a moderator hid feed the blocklist. Auto-hidden ones must not,
    // or a troll could block a real name by pairing it with a blocked website.
    if (!s.hidden || s.autoHidden || s.anonymous) continue;
    if (s.name && nameKey(s.name) === nk) return 'name matches a hidden signature';
    const sh = s.website ? hostKey(s.website) : '';
    if (hk && sh && (hk === sh || hk.endsWith('.' + sh))) return 'website matches a hidden signature'; // incl. subdomains
  }
  return null;
}

module.exports = { notANameReason, blockedReason, nameKey, hostKey };
