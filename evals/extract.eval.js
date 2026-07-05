#!/usr/bin/env node
// Eval harness for the AI image extraction (src/extract.js).
//
// For each eval image we have a hand-verified ground-truth fixture (canonical
// card list). We run Claude vision extraction and score precision / recall /
// F1 against it, listing false positives (hallucinated / misread cards) and
// false negatives (missed cards). Redacted images additionally require the
// model to REPORT unreadable regions instead of guessing.
//
// Run:  ANTHROPIC_API_KEY=sk-... npm run eval
//       node evals/extract.eval.js --model claude-opus-4-8
//       node evals/extract.eval.js --only phone   (substring filter)

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseText } from '../src/cards.js';
import { extractFromImage, DEFAULT_MODEL } from '../src/extract.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const F = (p) => path.join(HERE, p);

// image -> ground-truth fixture + scoring policy.
//   mode 'exact'   : clean source; expect near-perfect precision & recall.
//   mode 'noisy'   : legible but OCR-noisy; slightly looser (own-transcription risk).
//   mode 'partial' : has redacted cells; score recall on readable cards + require
//                    the model to report unreadable regions; precision is advisory.
const MANIFEST = [
  { image: 'Screenshot 2026-07-04 at 20.11.18.png', fixture: 'fixtures/screenshot-inline.txt', mode: 'exact', label: 'chat inline (Wir haben)' },
  { image: 'Screenshot 2026-07-04 at 20.11.34.png', fixture: 'fixtures/screenshot-list.txt', mode: 'exact', label: 'chat list (WM26 header)' },
  { image: 'panini-wm-2026-verkaufe-meine-doppelten.jpg', fixture: 'fixtures/table-doppelte.txt', mode: 'exact', label: 'spreadsheet table + (Nx) counts' },
  { image: 'panini-26-wahle-20-bilder-fur-fr1000.jpg', fixture: 'fixtures/phone-noisy.txt', mode: 'noisy', label: 'phone photo, aliases (BHI/EGV), concat' },
  { image: 'panini-2026-kaufen-020-pro-stuck.jpg', fixture: 'fixtures/table-redacted.txt', mode: 'partial', unreadableMin: 3, label: '2-col table w/ redactions' },
];

const THRESHOLDS = {
  exact: { recall: 0.95, precision: 0.95 },
  noisy: { recall: 0.9, precision: 0.9 },
  partial: { recall: 0.8, precision: 0 },
};

function parseArgs(argv) {
  const o = { model: DEFAULT_MODEL, only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--model') o.model = argv[++i];
    else if (argv[i] === '--only') o.only = argv[++i];
  }
  return o;
}

async function expectedKeys(fixturePath) {
  const text = await readFile(F(fixturePath), 'utf8');
  // Drop "# comment" lines so fixture documentation (which may mention codes like
  // "WM26") is never parsed as ground-truth cards.
  const body = text.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
  return new Set(parseText(body).cards.map((c) => c.key));
}

function score(predicted, expected) {
  const tp = [...predicted].filter((k) => expected.has(k));
  const fp = [...predicted].filter((k) => !expected.has(k)); // hallucinated / misread
  const fn = [...expected].filter((k) => !predicted.has(k)); // missed
  const precision = predicted.size ? tp.length / predicted.size : 0;
  const recall = expected.size ? tp.length / expected.size : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, fp, fn, tp: tp.length };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

async function runCase(c, model) {
  const expected = await expectedKeys(c.fixture);
  const { cards, unreadable } = await extractFromImage(F(c.image), { model });
  const predicted = new Set(cards.map((k) => k.key));
  const s = score(predicted, expected);

  const th = THRESHOLDS[c.mode];
  let pass = s.recall >= th.recall && s.precision >= th.precision;
  if (c.mode === 'partial') pass = s.recall >= th.recall && unreadable.length >= (c.unreadableMin || 1);

  return { c, s, unreadable, expectedSize: expected.size, predictedSize: predicted.size, pass };
}

async function main() {
  const { model, only } = parseArgs(process.argv.slice(2));

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('\nSKIPPED: ANTHROPIC_API_KEY is not set — image extraction evals need it.');
    console.error('Run:  ANTHROPIC_API_KEY=sk-... npm run eval\n');
    process.exit(2);
  }

  const cases = MANIFEST.filter((c) => !only || c.image.toLowerCase().includes(only.toLowerCase()) || c.label.includes(only));
  console.log(`\nRunning ${cases.length} extraction eval(s) with model "${model}"...\n`);

  const results = [];
  for (const c of cases) {
    process.stdout.write(`• ${c.label} … `);
    try {
      const r = await runCase(c, model);
      results.push(r);
      console.log(`${r.pass ? 'PASS' : 'FAIL'}  P=${pct(r.s.precision)} R=${pct(r.s.recall)} F1=${pct(r.s.f1)}`);
    } catch (err) {
      results.push({ c, error: err.message, pass: false });
      console.log(`ERROR — ${err.message}`);
    }
  }

  // Detail for anything imperfect.
  for (const r of results) {
    if (r.error) continue;
    if (r.s.fp.length || r.s.fn.length || r.unreadable.length) {
      console.log(`\n── ${r.c.label} [${r.c.mode}] ${r.predictedSize} predicted / ${r.expectedSize} expected`);
      if (r.s.fn.length) console.log(`   missed (${r.s.fn.length}): ${r.s.fn.join(', ')}`);
      if (r.s.fp.length) console.log(`   extra (${r.s.fp.length}): ${r.s.fp.join(', ')}`);
      if (r.unreadable.length) console.log(`   reported unreadable (${r.unreadable.length}): ${r.unreadable.map((u) => `“${u}”`).join('; ')}`);
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const macroF1 = results.filter((r) => r.s).reduce((a, r) => a + r.s.f1, 0) / (results.filter((r) => r.s).length || 1);
  console.log(`\n${'═'.repeat(52)}`);
  console.log(`RESULT: ${passed}/${results.length} passed   macro-F1 ${pct(macroF1)}`);
  console.log(`${'═'.repeat(52)}\n`);

  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
