// Pure card model: parse messy text lists into normalized cards, and diff two
// lists. No I/O, no network — fully unit-testable.

import { resolveCode, codeForName, MAX_TEAM_NUMBER } from './checklist.js';

// A card is identified by { code, number }. Canonical key is `CODE NUM` (e.g.
// "MAR 15"), so "MEX 1", "MEX1", "MEX: 1" all collapse to the same card.
export function cardKey(code, number) {
  return `${code} ${number}`;
}

export function makeCard(code, number, extra = {}) {
  return { code, number, key: cardKey(code, number), ...extra };
}

// Pull the sticker numbers out of a "number blob" like " 9, 19,,20 " or "1 2 4 12".
function extractNumbers(blob) {
  const out = [];
  const re = /\d{1,2}/g;
  let m;
  while ((m = re.exec(blob)) !== null) out.push(parseInt(m[0], 10));
  return out;
}

// Matches a code (2-4 letters, any case, or the numeric "00" logo) directly
// followed by a run of sticker numbers. Handles spaced ("GER 9" / "ger 9"),
// colon ("GER: 9"), concatenated ("GHA8") and inline-repeated ("MAR 11, BEL 10")
// forms. Case-insensitive, but the code must be a whole letter-run — the
// (?<![...]) / (?![...]) guards keep us from carving a bogus code out of the
// middle of a country name ("Belgien" must not yield "gien"). The number run
// tolerates leading/among commas, extra spaces, and the double-comma OCR noise
// seen in the eval images.
const CODE_SEGMENT = /(?<![A-Za-zÀ-ÿ])([A-Za-z]{2,4}|00)(?![A-Za-zÀ-ÿ])\s*[:.-]?((?:[\s,\-]*\d{1,2})+)/g;

// Strip quantity markers — "(3x)", "( 2 x )", "x3" — since counts are ignored.
function stripCounts(line) {
  return line
    .replace(/\(\s*\d+\s*x\s*\)/gi, ' ')
    .replace(/\bx\s*\d+\b/gi, ' ');
}

// Normalize a raw code + number into a validated card. Shared by the text parser
// and the image extractor so both go through identical validation/aliasing. The
// raw code may be a canonical Panini code, a wrong-code alias, or a country name.
export function buildCard(rawCode, number, extra = {}) {
  let resolved = resolveCode(rawCode);
  // Case-insensitive matching can capture a country name as if it were a code
  // (e.g. "Iran", "iran"). If the token isn't a real code, try resolving it as
  // a name before giving up and flagging it unknown.
  if (!resolved.valid) {
    const named = codeForName(rawCode);
    if (named) resolved = resolveCode(named);
  }
  const inRange = number >= 1 && number <= MAX_TEAM_NUMBER;
  const flags = [];
  if (!resolved.valid) flags.push('unknown-code');
  if (resolved.aliased) flags.push(`aliased-from-${String(rawCode).toUpperCase()}`);
  if (!inRange) flags.push('number-out-of-range');
  return makeCard(resolved.code, number, {
    raw: `${rawCode} ${number}`,
    valid: resolved.valid && inRange,
    special: resolved.special,
    flags,
    ...extra,
  });
}

// Parse a single line into card entries + warnings. Returns { entries, warnings }
// where each entry is a normalized card carrying its raw source token.
export function parseLine(line, lineNo = 0) {
  const entries = [];
  const warnings = [];
  const cleaned = stripCounts(line).replace(/[·•]/g, ' ').replace(/ /g, ' ');

  const addCard = (rawCode, number) => {
    const card = buildCard(rawCode, number, { line: lineNo });
    entries.push(card);
    if (card.flags.includes('unknown-code')) {
      warnings.push({ line: lineNo, text: line.trim(), reason: `unknown code "${String(rawCode).toUpperCase()}"` });
    }
  };

  let m;
  let matchedAnyCode = false;
  CODE_SEGMENT.lastIndex = 0;
  while ((m = CODE_SEGMENT.exec(cleaned)) !== null) {
    matchedAnyCode = true;
    const rawCode = m[1];
    for (const n of extractNumbers(m[2])) addCard(rawCode, n);
  }

  // No uppercase code on the line — try a name-only row like "Belgien 2, 19".
  if (!matchedAnyCode) {
    const nameM = cleaned.match(/^\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.\-\s]*?)[\s:]+((?:[\s,]*\d{1,2})+)\s*$/);
    if (nameM) {
      const code = codeForName(nameM[1]);
      const nums = extractNumbers(nameM[2]);
      if (code && nums.length) {
        // pass the resolved code (not the raw name) so buildCard validates it.
        for (const n of nums) addCard(code, n);
      }
    }
  }

  return { entries, warnings };
}

// Parse a full multi-line text blob into a deduped, normalized card list.
// Returns { cards, warnings } where cards is unique by key (counts ignored) and
// preserves first-seen order.
export function parseText(text) {
  const seen = new Map();
  const warnings = [];
  const lines = String(text).split(/\r?\n/);
  lines.forEach((line, i) => {
    const { entries, warnings: w } = parseLine(line, i + 1);
    warnings.push(...w);
    for (const c of entries) {
      if (!seen.has(c.key)) seen.set(c.key, c);
    }
  });
  return { cards: [...seen.values()], warnings };
}

// Dedupe a card list by key, keeping first-seen order (counts ignored).
export function dedupeCards(cards) {
  const seen = new Map();
  for (const c of cards) if (!seen.has(c.key)) seen.set(c.key, c);
  return [...seen.values()];
}

// Build a Set of keys from cards, optionally excluding invalid (unknown-code /
// out-of-range) entries.
function keySet(cards, { includeInvalid = false } = {}) {
  const s = new Set();
  for (const c of cards) {
    if (!includeInvalid && c.valid === false) continue;
    s.add(c.key);
  }
  return s;
}

// Diff two card lists. Returns overlap / mineOnly / theirsOnly as sorted card
// arrays. By default invalid cards are excluded from the sets (they can't be
// reliably matched) but are surfaced separately.
export function diffCards(mine, theirs, { includeInvalid = false } = {}) {
  const byKey = new Map();
  for (const c of [...mine, ...theirs]) if (!byKey.has(c.key)) byKey.set(c.key, c);

  const mineKeys = keySet(mine, { includeInvalid });
  const theirsKeys = keySet(theirs, { includeInvalid });

  const overlap = [];
  const mineOnly = [];
  const theirsOnly = [];
  for (const k of mineKeys) (theirsKeys.has(k) ? overlap : mineOnly).push(byKey.get(k));
  for (const k of theirsKeys) if (!mineKeys.has(k)) theirsOnly.push(byKey.get(k));

  const invalid = [...mine, ...theirs].filter((c) => c.valid === false);

  return {
    overlap: sortCards(overlap),
    mineOnly: sortCards(mineOnly),
    theirsOnly: sortCards(theirsOnly),
    invalid: sortCards(invalid),
  };
}

export function sortCards(cards) {
  return [...cards].sort((a, b) =>
    a.code === b.code ? a.number - b.number : a.code < b.code ? -1 : 1,
  );
}

// Group a card list by code into { code, numbers[] } for a compact per-team view.
export function groupByCode(cards) {
  const groups = new Map();
  for (const c of sortCards(cards)) {
    if (!groups.has(c.code)) groups.set(c.code, []);
    groups.get(c.code).push(c.number);
  }
  return [...groups.entries()].map(([code, numbers]) => ({ code, numbers }));
}
