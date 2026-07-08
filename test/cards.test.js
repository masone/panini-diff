import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseText, parseLine, diffCards, groupByCode } from '../src/cards.js';

const keys = (text) => parseText(text).cards.map((c) => c.key);

test('spaced form: "GER 9,19,20"', () => {
  assert.deepEqual(keys('GER 9,19,20'), ['GER 9', 'GER 19', 'GER 20']);
});

test('colon form: "BRA: 4, 10, 12"', () => {
  assert.deepEqual(keys('BRA: 4, 10, 12'), ['BRA 4', 'BRA 10', 'BRA 12']);
});

test('concatenated form: "GHA8"', () => {
  assert.deepEqual(keys('GHA8,9,10'), ['GHA 8', 'GHA 9', 'GHA 10']);
});

test('inline multi-code: "MAR 11, BEL 10, KSA 14"', () => {
  assert.deepEqual(keys('Wir haben: MAR 11, BEL 10, KSA 14, AUT 4'), [
    'MAR 11', 'BEL 10', 'KSA 14', 'AUT 4',
  ]);
});

test('counts are stripped and ignored: "NED: 2(2x), 5(1x)"', () => {
  assert.deepEqual(keys('NED: 2(2x), 5(1x)'), ['NED 2', 'NED 5']);
});

test('OCR noise: double commas and stray middots', () => {
  assert.deepEqual(keys('ARG 4,5,,11·,20'), ['ARG 4', 'ARG 5', 'ARG 11', 'ARG 20']);
});

test('leading comma noise: "COL ,4,6,12"', () => {
  assert.deepEqual(keys('COL ,4,6,12'), ['COL 4', 'COL 6', 'COL 12']);
});

test('hyphen separator: "FWC-1"', () => {
  assert.deepEqual(keys('FWC-1'), ['FWC 1']);
});

test('special code FWC is valid', () => {
  const { cards } = parseText('FWC: 2, 10');
  assert.equal(cards.length, 2);
  assert.ok(cards.every((c) => c.valid && c.special));
});

test('wrong-code aliases are normalized: SWI->SUI, SAU->KSA, EGV->EGY', () => {
  assert.deepEqual(keys('SWI 9'), ['SUI 9']);
  assert.deepEqual(keys('SAU 15'), ['KSA 15']);
  assert.deepEqual(keys('EGV 9'), ['EGY 9']);
});

test('lowercase codes match: "jor 15", mixed inline "jor 15, ger 9"', () => {
  assert.deepEqual(keys('jor 15'), ['JOR 15']);
  assert.deepEqual(keys('jor 15, ger 9'), ['JOR 15', 'GER 9']);
});

test('JAP alias resolves to JPN (any case)', () => {
  assert.deepEqual(keys('JAP 5'), ['JPN 5']);
  assert.deepEqual(keys('jap 5'), ['JPN 5']);
});

test('lowercase/mixed-case country name still resolves, not carved into junk', () => {
  assert.deepEqual(keys('iran 3'), ['IRN 3']);
  assert.deepEqual(keys('Iran 3'), ['IRN 3']);
});

test('German name-only row maps to code: "Belgien: 2, 19"', () => {
  assert.deepEqual(keys('Belgien: 2, 19'), ['BEL 2', 'BEL 19']);
});

test('table row with name + code prefers the code: "Marokko  MAR  1  2  4  12"', () => {
  assert.deepEqual(keys('Marokko  MAR  1  2  4  12'), ['MAR 1', 'MAR 2', 'MAR 4', 'MAR 12']);
});

test('unknown code is flagged, not silently dropped', () => {
  const { cards, warnings } = parseText('WM 26');
  assert.equal(cards[0].valid, false);
  assert.ok(warnings.some((w) => /unknown code/.test(w.reason)));
});

test('junk lines produce nothing', () => {
  assert.deepEqual(keys('Twint Zahlung möglich'), []);
  assert.deepEqual(keys('Download the app: https://moovtech.app/stickers2026/'), []);
  assert.deepEqual(keys('+41 76 234 85 33, +41 76 321 08 21'), []);
});

test('dedup collapses repeats across lines', () => {
  assert.deepEqual(keys('MAR 1\nMAR 1\nMAR 2'), ['MAR 1', 'MAR 2']);
});

test('diff computes overlap / mineOnly / theirsOnly', () => {
  const mine = parseText('GER 9,19,20\nMAR 1').cards;
  const theirs = parseText('GER 19\nMAR 5\nBEL 3').cards;
  const d = diffCards(mine, theirs);
  assert.deepEqual(d.overlap.map((c) => c.key), ['GER 19']);
  assert.deepEqual(d.mineOnly.map((c) => c.key), ['GER 9', 'GER 20', 'MAR 1']);
  assert.deepEqual(d.theirsOnly.map((c) => c.key), ['BEL 3', 'MAR 5']);
});

test('invalid cards are excluded from diff sets but surfaced', () => {
  const mine = parseText('GER 9\nWM 26').cards;
  const theirs = parseText('GER 9').cards;
  const d = diffCards(mine, theirs);
  assert.deepEqual(d.overlap.map((c) => c.key), ['GER 9']);
  assert.ok(d.invalid.some((c) => c.code === 'WM'));
});

test('groupByCode gives a compact per-team view', () => {
  const cards = parseText('GER 9,19,20\nMAR 1').cards;
  assert.deepEqual(groupByCode(cards), [
    { code: 'GER', numbers: [9, 19, 20] },
    { code: 'MAR', numbers: [1] },
  ]);
});
