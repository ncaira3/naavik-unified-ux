// Matches the dummifier's own masked output. Any value already in this form
// must be treated as a no-op by every transform — otherwise re-scrambling
// produces a different UST, which looks like the dummifier is "broken".
const MASKED_USID_RE = /^UST\d{4,8}$/;

export function transformUsid(raw: string | number): string {
  const s = String(raw ?? '').trim();
  if (!s) return s;
  // Idempotent: already a UST###### token → do not re-scramble.
  if (MASKED_USID_RE.test(s)) return s;
  const digits = s.replace(/[^\d]/g, '');
  if (!digits) return s;
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n)) return s;
  const scrambled = String((n * 7919 + 31337) % 1_000_000).padStart(6, '0');
  return `UST${scrambled}`;
}

// Deterministic cell-name scrambler. Preserves structural tokens:
//   CCL00153_3A_1 → CCL47382_3A_1
// Scrambles only the first digit-run after the leading letter prefix.
export function transformCell(raw: string): string {
  const s = String(raw ?? '').trim();
  // Never touch already-masked USIDs (UST######) — they are not cell names.
  if (MASKED_USID_RE.test(s)) return s;
  const m = s.match(/^([A-Za-z]{1,6})(\d{2,8})(.*)$/);
  if (!m) return s;
  const [, prefix, digits, rest] = m;
  // Defensive: if the prefix is literally 'UST', treat the whole token as a
  // masked USID and leave it alone.
  if (prefix.toUpperCase() === 'UST') return s;
  const n = parseInt(digits, 10);
  const mod = Math.pow(10, digits.length);
  const scrambled = String((n * 2749 + 10007) % mod).padStart(digits.length, '0');
  return `${prefix}${scrambled}${rest}`;
}

// Matches CCL00153_3A_1, ENB12345, gNB00042_1 etc. — but NOT UST######.
// The negative lookahead keeps our own masked tokens out of the cell scrambler.
const CELL_TOKEN_RE = /\b(?!UST\d)[A-Za-z]{2,5}\d{3,8}(?:_[A-Za-z0-9]+){0,4}\b/g;

export function dummifyText(text: string, enabled: boolean): string {
  if (!enabled || !text) return text;
  let out = text;
  // "USID 9817" / "Site 9817" / "USID: 9817" / "USID #9817" → "Site UST0XXXXX"
  // Guard with negative lookahead so "Site UST031564" is NOT re-matched:
  // the capture group requires the next char be raw digits, not U-S-T.
  out = out.replace(/\b(USID|usid|Site|site)\b\s*[:#-]?\s*(\d{3,8})\b/g, (_m, _w, num) => `Site ${transformUsid(num)}`);
  // Cell-name tokens (letters + digits + optional _suffixes), applied before bare-number rule.
  // CELL_TOKEN_RE already excludes UST######.
  out = out.replace(CELL_TOKEN_RE, (m) => transformCell(m));
  // Bare word "USID" → "Site" (case-preserving for lower-case)
  out = out.replace(/\bUSID\b/g, 'Site');
  out = out.replace(/\busid\b/g, 'site');
  return out;
}

export function dummifyId(id: string | number | null | undefined, enabled: boolean): string {
  if (id === null || id === undefined) return '';
  const s = String(id);
  if (!enabled) return s;
  // transformUsid is now idempotent on UST######.
  return transformUsid(s);
}
