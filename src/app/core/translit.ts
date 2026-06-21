import { Lang } from './models';

/* romanized -> Telugu transliteration (approximate; auto-used for names) */
const TE_V: Record<string, [string, string]> = {
  'au': ['ఔ', 'ౌ'], 'ai': ['ఐ', 'ై'], 'aa': ['ఆ', 'ా'], 'ee': ['ఈ', 'ీ'], 'ii': ['ఈ', 'ీ'],
  'oo': ['ఊ', 'ూ'], 'uu': ['ఊ', 'ూ'], 'a': ['అ', ''], 'i': ['ఇ', 'ి'], 'u': ['ఉ', 'ు'], 'e': ['ఏ', 'ే'], 'o': ['ఓ', 'ో'],
};
const TE_C: Record<string, string> = {
  'ksh': 'క్ష', 'chh': 'ఛ', 'kh': 'ఖ', 'gh': 'ఘ', 'ch': 'చ', 'jh': 'ఝ', 'th': 'థ', 'dh': 'ధ', 'ph': 'ఫ', 'bh': 'భ', 'sh': 'శ',
  'k': 'క', 'g': 'గ', 'c': 'చ', 'j': 'జ', 't': 'త', 'd': 'ద', 'n': 'న', 'p': 'ప', 'b': 'బ', 'm': 'మ',
  'y': 'య', 'r': 'ర', 'l': 'ల', 'v': 'వ', 'w': 'వ', 's': 'స', 'h': 'హ', 'f': 'ఫ', 'z': 'జ',
};
const TE_VK = Object.keys(TE_V).sort((a, b) => b.length - a.length);
const TE_CK = Object.keys(TE_C).sort((a, b) => b.length - a.length);
const teK = (keys: string[], s: string, i: number): string | null => { for (const k of keys) if (s.startsWith(k, i)) return k; return null; };
const TE_HARD = /^(k|kh|g|gh|ch|chh|j|jh|t|th|d|dh|p|ph|b|bh|s|sh|c)$/;

function teToken(tok: string): string {
  const s = tok.toLowerCase(), n = s.length; let i = 0, out = '';
  while (i < n) {
    const ck = teK(TE_CK, s, i);
    if (ck) {
      const after = i + ck.length;
      const nextC = after < n ? teK(TE_CK, s, after) : null;
      const hard = !!nextC && TE_HARD.test(nextC);
      if (ck === 'm' && (after >= n || hard)) { out += 'ం'; i = after; continue; }
      if (ck === 'n' && hard) { out += 'ం'; i = after; continue; }
      i = after;
      const vk = teK(TE_VK, s, i);
      if (vk) { i += vk.length; out += TE_C[ck] + TE_V[vk][1]; }
      else { out += TE_C[ck] + '్'; }
    } else {
      const vk = teK(TE_VK, s, i);
      if (vk) { i += vk.length; out += TE_V[vk][0]; }
      else { out += s[i]; i++; }
    }
  }
  return out;
}

export function toTelugu(str: string): string {
  if (!str) return '';
  return String(str).split(/(\s+)/).map(t => /^\s+$/.test(t) ? t : teToken(t)).join('');
}
export function dispName(name: string, lang: Lang): string { return lang === 'te' ? toTelugu(name) : (name || ''); }
export function initialsOf(label: string): string {
  const parts = label.trim().split(/\s+/);
  const a = parts[0] ? parts[0][0] : '';
  const b = parts.length > 1 ? (parts[parts.length - 1][0] || '') : '';
  return (a + b).toUpperCase();
}
