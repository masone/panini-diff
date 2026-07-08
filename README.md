# panini-diff

![panini-diff cover](assets/cover.svg)

Drop your lists, spot the swap.

Compare two Panini **FIFA World Cup 2026** sticker lists and instantly see the
overlap — which cards you both have, and which are unique to each side. Drop in
text lists or **images/screenshots** (read with Claude vision).

Cards are `CODE NUMBER` — e.g. `MAR 15`, `GER9`, `BRA: 4, 10, 12`. The set is
48 teams × 20 stickers, plus `FWC 1–19` and `00` specials (see
[`src/checklist.js`](src/checklist.js)).

## Install

```bash
npm install
```

## CLI

```bash
node src/cli.js <mine> <theirs> [--json] [--include-invalid] [--model <id>]
```

Each argument is a **text list** (`.txt`) or an **image** (`.png`/`.jpg`/…).
Images use Claude vision and need `ANTHROPIC_API_KEY`.

```bash
# text vs text (no API key needed)
node src/cli.js evals/panini.txt evals/panini2.txt

# your screenshot vs their screenshot
export ANTHROPIC_API_KEY=sk-...
node src/cli.js my-list.jpg their-list.png
```

Output has three buckets — **BOTH HAVE (overlap)**, **ONLY ON YOUR LIST**,
**ONLY ON THEIR LIST** — grouped per team, plus a **NEEDS A LOOK** section for
unknown codes and anything the vision model couldn't read (never guessed).

## What it handles

Real-world messiness observed in `evals/`:

- spaced `GER 9`, concatenated `GHA8`, colon `BRA: 4, 10`, inline `MAR 11, BEL 10`
- copy counts `(2x)` / `x3` (ignored)
- German (or English) country names with no code (`Belgien: 2, 19` → `BEL`)
- wrong-code / OCR aliases (`SWI→SUI`, `SAU→KSA`, `EGV→EGY`, `BHI→BIH`)
- junk: prices, URLs, phone numbers, chat UI, section headers
- redacted / blurred cells in photos → reported as unreadable, not invented

## Web UI

The text-diffing UI runs entirely client-side; image extraction needs a
backend (Claude vision needs `ANTHROPIC_API_KEY`, which must never reach the
browser). There is **one** backend — the Vercel serverless functions in
`api/*.js` plus the `middleware.js` auth gate — and it runs identically locally
and in production, so there is no second code path that can drift.

**Local** — run the exact serverless stack via `vercel dev`:

```bash
echo "ANTHROPIC_API_KEY=sk-..." > .env
npx vercel dev   # http://localhost:3000, reads .env automatically
```

(Run `vercel dev` directly, not via an npm `"dev"` script — Vercel auto-detects
a `package.json` `"dev"` script as the project's Development Command, so a
script that itself runs `vercel dev` recurses into itself.)

**Deploy:**

```bash
npx vercel        # deploy a preview
npm run deploy    # vercel --prod
```

Set `ANTHROPIC_API_KEY` as an environment variable in the Vercel project
settings (or `vercel env add ANTHROPIC_API_KEY`) before deploying — without it
image extraction is disabled but text-list diffing still works.

`api/extract.js` and `api/health.js` are thin Vercel wrappers around the
validation/error logic in [`src/httpExtract.js`](src/httpExtract.js).

### Password-protecting the site

Set both `BASIC_AUTH_USER` and `BASIC_AUTH_PASS` to gate the whole site behind
HTTP Basic Auth; leave them unset and it stays open. [`middleware.js`](middleware.js)
(Vercel Edge Middleware) enforces it — the one layer that runs before both the
CDN-served static assets and the `/api/*` functions, so a single gate covers
everything. It runs the same under `vercel dev` and in prod:

```bash
# locally, with vercel dev
BASIC_AUTH_USER=me BASIC_AUTH_PASS=letmein npx vercel dev
```

On Vercel, add the two vars in the project's environment settings (or
`vercel env add`).

## Tests & evals

```bash
npm test        # pure parser + extraction-pipeline unit tests (no API key)
npm run eval    # AI image-extraction accuracy vs ground truth (needs API key)
```

The eval scores Claude vision extraction against hand-verified fixtures in
[`evals/fixtures/`](evals/fixtures/) (precision / recall / F1, with false
positives and negatives listed). See [`evals/extract.eval.js`](evals/extract.eval.js).

Latest run across the 5 eval images: **Opus 5/5 pass, macro-F1 99.9%**;
Sonnet 5/5, 99.2% (occasionally row-shifts numbers on dense chat lists). Extraction
therefore defaults to **`claude-opus-4-8`**; override with `--model claude-sonnet-5`
or `PANINI_MODEL` for a cheaper run. Fixtures are hand transcriptions — if the eval
flags a "miss" that is actually correct, verify the image and fix the fixture (two
were corrected this way, confirmed by cropping/zooming the source).

## Layout

| File | Purpose |
|---|---|
| `src/cards.js` | pure parsing, normalization, diff (no I/O) |
| `src/checklist.js` | the 48 team codes, specials, aliases, name→code map |
| `src/extract.js` | image → cards via Claude vision |
| `src/httpExtract.js` | shared extract-route logic (validation, error mapping) |
| `src/cli.js` | two-file CLI |
| `api/extract.js`, `api/health.js` | Vercel serverless functions (the web backend) |
| `middleware.js` | Vercel Edge Middleware — HTTP Basic Auth gate for the site |
| `web/` | drag-and-drop browser UI |
| `evals/` | sample images/lists, ground-truth fixtures, eval runner |
