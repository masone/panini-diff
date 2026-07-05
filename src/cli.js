#!/usr/bin/env node
// panini-diff — compare two Panini WM 2026 sticker lists and show the overlap.
//
// Usage:
//   panini-diff <mine> <theirs> [options]
//
// <mine> and <theirs> are each either a text list (.txt) or an image
// (.png/.jpg/...). Images are read with Claude vision (needs ANTHROPIC_API_KEY).
//
// Options:
//   --json              output machine-readable JSON instead of a report
//   --include-invalid   include unknown/out-of-range codes in the diff sets
//   --model <id>        override the vision model (default: claude-sonnet-5)

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseText, diffCards, groupByCode } from './cards.js';
import { extractFromImage, isImagePath, DEFAULT_MODEL } from './extract.js';

function parseArgs(argv) {
  const opts = { json: false, includeInvalid: false, model: DEFAULT_MODEL, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--include-invalid') opts.includeInvalid = true;
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '-h' || a === '--help') opts.help = true;
    else opts.files.push(a);
  }
  return opts;
}

// Load one side from a file path -> normalized cards + diagnostics.
async function loadSource(filePath, opts) {
  if (isImagePath(filePath)) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        `"${path.basename(filePath)}" is an image, which needs Claude vision.\n` +
        `Set ANTHROPIC_API_KEY to use image extraction (e.g. export ANTHROPIC_API_KEY=sk-...).`,
      );
    }
    const { cards, unreadable, notes } = await extractFromImage(filePath, { model: opts.model });
    return { kind: 'image', cards, unreadable, notes, warnings: [] };
  }
  const text = await readFile(filePath, 'utf8');
  const { cards, warnings } = parseText(text);
  return { kind: 'text', cards, unreadable: [], notes: '', warnings };
}

function fmtGroups(cards) {
  const groups = groupByCode(cards);
  if (!groups.length) return '  (none)';
  return groups.map((g) => `  ${g.code.padEnd(4)} ${g.numbers.join(', ')}`).join('\n');
}

function printReport(mine, theirs, diff) {
  const line = '─'.repeat(52);
  const both = diff.overlap.length;
  console.log(`\nYour list:  ${mine.cards.filter((c) => c.valid !== false).length} cards (${mine.kind})`);
  console.log(`Their list: ${theirs.cards.filter((c) => c.valid !== false).length} cards (${theirs.kind})`);

  console.log(`\n${line}\n● BOTH HAVE — overlap (${both})\n${line}`);
  console.log(fmtGroups(diff.overlap));

  console.log(`\n${line}\n◆ ONLY ON YOUR LIST (${diff.mineOnly.length})\n${line}`);
  console.log(fmtGroups(diff.mineOnly));

  console.log(`\n${line}\n◇ ONLY ON THEIR LIST (${diff.theirsOnly.length})\n${line}`);
  console.log(fmtGroups(diff.theirsOnly));

  // Diagnostics — surfaced, never silently dropped.
  const allWarnings = [...mine.warnings, ...theirs.warnings];
  const allUnreadable = [
    ...mine.unreadable.map((u) => `your list: ${u}`),
    ...theirs.unreadable.map((u) => `their list: ${u}`),
  ];
  if (diff.invalid.length || allWarnings.length || allUnreadable.length) {
    console.log(`\n${line}\n⚠ NEEDS A LOOK\n${line}`);
    for (const c of diff.invalid) console.log(`  unknown code: ${c.raw}`);
    for (const w of allWarnings) console.log(`  line ${w.line}: ${w.reason}`);
    for (const u of allUnreadable) console.log(`  could not read — ${u}`);
    console.log('  (excluded from the overlap above; fix the source and re-run)');
  }
  console.log('');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || opts.files.length !== 2) {
    console.log('Usage: panini-diff <mine> <theirs> [--json] [--include-invalid] [--model <id>]');
    console.log('  <mine>/<theirs>: a .txt list or an image (.png/.jpg). Images need ANTHROPIC_API_KEY.');
    process.exit(opts.help ? 0 : 1);
  }

  const [mine, theirs] = await Promise.all([
    loadSource(opts.files[0], opts),
    loadSource(opts.files[1], opts),
  ]);
  const diff = diffCards(mine.cards, theirs.cards, { includeInvalid: opts.includeInvalid });

  if (opts.json) {
    const strip = (cards) => cards.map(({ code, number, key }) => ({ code, number, key }));
    console.log(JSON.stringify({
      mine: { kind: mine.kind, count: mine.cards.length },
      theirs: { kind: theirs.kind, count: theirs.cards.length },
      overlap: strip(diff.overlap),
      mineOnly: strip(diff.mineOnly),
      theirsOnly: strip(diff.theirsOnly),
      invalid: strip(diff.invalid),
      unreadable: [...mine.unreadable, ...theirs.unreadable],
    }, null, 2));
  } else {
    printReport(mine, theirs, diff);
  }
}

main().catch((err) => {
  console.error(`\nError: ${err.message}\n`);
  process.exit(1);
});
