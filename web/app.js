// panini-diff web client. All parsing/diffing/grouping runs here in the browser
// by importing the SAME pure modules the CLI and tests use — the server is only
// touched to extract cards from images.
//
// Design: each pane's <textarea> is the single source of truth for that side.
// Dropped/pasted images are sent to /api/extract; the returned {code,number}
// pairs are appended to the textarea as "CODE NUM" lines. Because everything
// lives in the textarea, editing a misread and re-diffing is the same action,
// and parseText() naturally merges + dedupes across multiple images and text.

import { parseText, diffCards, groupByCode } from '/src/cards.js';

const SUPPORTED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

// Per-side state. `text` mirrors the textarea; `sources` tracks image uploads
// (for the status list + their unreadable/notes). `nextId` numbers sources.
const sides = {
  mine: { text: '', sources: [], nextId: 1 },
  theirs: { text: '', sources: [], nextId: 1 },
};

let hasKey = false;

// ---- DOM lookup helpers -------------------------------------------------

const paneEl = (side) => document.querySelector(`.pane[data-side="${side}"]`);
const q = (side, sel) => paneEl(side).querySelector(sel);

// ---- Image upload -------------------------------------------------------

async function uploadImage(side, file) {
  const s = sides[side];
  const source = { id: s.nextId++, name: file.name || 'pasted image', status: 'reading', error: '', unreadable: [], notes: '' };
  s.sources.push(source);
  renderSources(side);
  updateReadOnly(side);

  try {
    const buf = await file.arrayBuffer();
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: buf,
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      source.status = 'error';
      source.error = errorMessage(res.status, data);
      renderSources(side);
      return;
    }

    // Turn pairs into text lines and append to the textarea (source of truth).
    const lines = (data.cards || []).map((c) => `${c.code} ${c.number}`);
    source.status = 'done';
    source.count = lines.length;
    source.unreadable = data.unreadable || [];
    source.notes = data.notes || '';
    if (lines.length) appendLines(side, lines);
    renderSources(side);
    rerender();
  } catch (err) {
    source.status = 'error';
    source.error = 'Network error — is the server running?';
    renderSources(side);
  }
}

function errorMessage(status, data) {
  switch (data?.error) {
    case 'no-api-key': return 'Server has no ANTHROPIC_API_KEY — image extraction is off.';
    case 'unsupported-type': return `Unsupported image type (${data.mediaType || '?'}).`;
    case 'too-large': return 'Image is too large (max 10 MB).';
    case 'timeout': return 'Vision request timed out — try again.';
    case 'upstream-auth': return 'Server API key was rejected (401).';
    case 'extract-failed': return `Extraction failed: ${data.message || 'unknown error'}`;
    default: return `Upload failed (HTTP ${status}).`;
  }
}

// Append lines to a pane's textarea, keeping a trailing newline between blocks.
function appendLines(side, lines) {
  const ta = q(side, '[data-text]');
  const existing = ta.value.replace(/\s+$/, '');
  ta.value = (existing ? existing + '\n' : '') + lines.join('\n') + '\n';
  sides[side].text = ta.value;
}

// The field goes read-only once an upload has been used on that side — the
// text now reflects extracted images, not something the user typed/pasted.
// Clearing removes the uploads and returns the field to a writable state.
function updateReadOnly(side) {
  q(side, '[data-text]').readOnly = sides[side].sources.length > 0;
}

function clearSide(side) {
  const ta = q(side, '[data-text]');
  sides[side] = { text: '', sources: [], nextId: 1 };
  ta.value = '';
  ta.readOnly = false;
  renderSources(side);
  rerender();
}

// ---- Drag / drop / paste ------------------------------------------------

function imageFilesFrom(dataTransfer) {
  const out = [];
  for (const item of dataTransfer.files || []) {
    if (SUPPORTED.has(item.type)) out.push(item);
  }
  return out;
}

function wireInput(side) {
  const drop = q(side, '[data-drop]');
  const ta = q(side, '[data-text]');

  q(side, '[data-clear]').addEventListener('click', () => clearSide(side));

  ta.addEventListener('input', () => {
    sides[side].text = ta.value;
    rerender();
  });

  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('dragging');
    }));
  ['dragleave', 'dragend'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      if (e.target === drop) drop.classList.remove('dragging');
    }));

  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragging');
    const images = imageFilesFrom(e.dataTransfer);
    if (images.length) {
      if (!hasKey) return flashNoKey(side);
      images.forEach((f) => uploadImage(side, f));
    }
  });

  // Paste: image items -> upload; text falls through to the textarea normally.
  ta.addEventListener('paste', (e) => {
    const imgs = [];
    for (const item of e.clipboardData?.items || []) {
      if (item.kind === 'file' && SUPPORTED.has(item.type)) {
        const f = item.getAsFile();
        if (f) imgs.push(f);
      }
    }
    if (imgs.length) {
      e.preventDefault();
      if (!hasKey) return flashNoKey(side);
      imgs.forEach((f) => uploadImage(side, f));
    }
  });
}

function flashNoKey(side) {
  const hint = q(side, '[data-drophint]');
  hint.textContent = 'Image extraction is off (no server API key).';
  hint.classList.add('flash');
  setTimeout(() => {
    hint.classList.remove('flash');
    hint.textContent = 'Drop or paste images anywhere in this box';
  }, 2500);
}

// ---- Rendering ----------------------------------------------------------

function renderSources(side) {
  const ul = q(side, '[data-sources]');
  const sources = sides[side].sources;
  ul.innerHTML = '';
  for (const s of sources) {
    const li = document.createElement('li');
    li.className = `source source-${s.status}`;
    let detail = '';
    if (s.status === 'reading') detail = '<span class="spinner"></span> reading…';
    else if (s.status === 'done') detail = `✓ ${s.count} card${s.count === 1 ? '' : 's'}`;
    else if (s.status === 'error') detail = `✗ ${escapeHtml(s.error)}`;
    li.innerHTML = `<span class="src-name">${escapeHtml(s.name)}</span><span class="src-detail">${detail}</span>`;
    ul.appendChild(li);
  }
}

function groupsHtml(cards) {
  const groups = groupByCode(cards);
  if (!groups.length) return '<p class="muted">(none)</p>';
  return groups
    .map((g) => `<div class="grp"><span class="grp-code">${g.code}</span><span class="grp-nums">${g.numbers.join(', ')}</span></div>`)
    .join('');
}

let renderTimer = null;
function rerender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(doRender, 100);
}

function doRender() {
  const mine = parseText(sides.mine.text);
  const theirs = parseText(sides.theirs.text);
  const diff = diffCards(mine.cards, theirs.cards, { includeInvalid: false });

  const validCount = (r) => r.cards.filter((c) => c.valid !== false).length;
  q('mine', '[data-count]').textContent = `${validCount(mine)} cards`;
  q('theirs', '[data-count]').textContent = `${validCount(theirs)} cards`;

  document.getElementById('n-overlap').textContent = diff.overlap.length;
  document.getElementById('n-mine').textContent = diff.mineOnly.length;
  document.getElementById('n-theirs').textContent = diff.theirsOnly.length;
  document.getElementById('g-overlap').innerHTML = groupsHtml(diff.overlap);
  document.getElementById('g-mine').innerHTML = groupsHtml(diff.mineOnly);
  document.getElementById('g-theirs').innerHTML = groupsHtml(diff.theirsOnly);

  renderNeedsLook(mine, theirs, diff);
}

// "Needs a look" gathers: unknown/out-of-range codes, parser warnings, and each
// image's unreadable notes — mirroring the CLI's diagnostics section.
function renderNeedsLook(mine, theirs, diff) {
  const items = [];
  for (const c of diff.invalid) items.push(`Unknown code: <code>${escapeHtml(c.raw)}</code>`);
  for (const w of [...mine.warnings, ...theirs.warnings]) {
    items.push(`Line ${w.line}: ${escapeHtml(w.reason)}`);
  }
  for (const side of ['mine', 'theirs']) {
    const label = side === 'mine' ? 'your list' : 'their list';
    for (const src of sides[side].sources) {
      for (const u of src.unreadable) items.push(`Could not read (${label}): ${escapeHtml(u)}`);
    }
  }

  const box = document.getElementById('needsLook');
  const list = document.getElementById('needsLookList');
  if (!items.length) {
    box.hidden = true;
    list.innerHTML = '';
    return;
  }
  box.hidden = false;
  list.innerHTML = items.map((t) => `<li>${t}</li>`).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- Init ---------------------------------------------------------------

async function init() {
  wireInput('mine');
  wireInput('theirs');
  doRender();

  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    hasKey = Boolean(data.hasKey);
  } catch {
    hasKey = false;
  }
  if (!hasKey) document.getElementById('keyBanner').hidden = false;
}

init();
