#!/usr/bin/env node
// panini-diff web server — a deliberately thin backend.
//
// The ONLY thing this server does that the browser can't is image extraction,
// because that needs the Anthropic API key (which must never reach the client).
// Text parsing, diffing and grouping all run client-side by importing the pure
// modules src/cards.js + src/checklist.js directly in the browser.
//
// Routes:
//   GET  /                     -> web/index.html
//   GET  /app.js, /style.css   -> static client assets
//   GET  /src/cards.js         -> the pure card model, served verbatim to the browser
//   GET  /src/checklist.js     -> the pure checklist, served verbatim
//   GET  /api/health           -> { hasKey } so the UI can warn before an upload
//   POST /api/extract          -> one raw image body -> { cards:[{code,number}], unreadable, notes }
//
// Run: node --env-file=.env src/server.js   (PORT env, default 5173)

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_MODEL } from './extract.js';
import { readBody, runExtract, resolveModel, MAX_UPLOAD_BYTES, EXTRACT_TIMEOUT_MS } from './httpExtract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT) || 5173;

// Static routes: request path -> { file, type }. An explicit whitelist (no
// path-from-URL join) so there is no directory-traversal surface.
const STATIC = {
  '/': { file: 'web/index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'web/index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'web/app.js', type: 'text/javascript; charset=utf-8' },
  '/style.css': { file: 'web/style.css', type: 'text/css; charset=utf-8' },
  '/src/cards.js': { file: 'src/cards.js', type: 'text/javascript; charset=utf-8' },
  '/src/checklist.js': { file: 'src/checklist.js', type: 'text/javascript; charset=utf-8' },
};

// One shared client, constructed only when a key is present (the SDK throws
// without one). Injected into extractFromImageBuffer so tests can pass a mock.
const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY);
let sharedClient = null;
let injectedClient = null;
function getClient() {
  if (injectedClient) return injectedClient;
  if (!hasKey()) return null;
  if (!sharedClient) sharedClient = new Anthropic({ timeout: EXTRACT_TIMEOUT_MS, maxRetries: 1 });
  return sharedClient;
}

// Test seam: inject a mock Anthropic client so the extract route can be exercised
// without a network call or a real API key. Pass null to reset.
export function __setClientForTest(client) {
  injectedClient = client;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function serveStatic(res, route) {
  try {
    const buf = await readFile(path.join(ROOT, route.file));
    res.writeHead(200, { 'Content-Type': route.type });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

// POST /api/extract — one image, raw body, real image content-type. Returns the
// extracted {code, number} pairs (resolved codes) plus unreadable/notes. The
// client turns pairs into text lines and re-runs its own parseText, so the
// browser's cards.js stays the single source of truth for validation.
async function handleExtract(req, res, url) {
  if (!hasKey()) return sendJson(res, 503, { error: 'no-api-key' });

  const model = resolveModel(url.searchParams.get('model'));

  let buffer;
  try {
    buffer = await readBody(req);
  } catch (err) {
    if (err.code === 'too-large') return sendJson(res, 413, { error: 'too-large', maxBytes: MAX_UPLOAD_BYTES });
    return sendJson(res, 400, { error: 'bad-request' });
  }

  const { status, body } = await runExtract({ contentType: req.headers['content-type'], buffer, client: getClient(), model });
  return sendJson(res, status, body);
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, { hasKey: hasKey(), defaultModel: DEFAULT_MODEL });
    }
    if (req.method === 'POST' && pathname === '/api/extract') {
      return handleExtract(req, res, url);
    }
    if (req.method === 'GET' && STATIC[pathname]) {
      return serveStatic(res, STATIC[pathname]);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });
}

// Start only when run directly, not when imported by a test.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`panini-diff web UI  ->  http://localhost:${PORT}`);
    if (!hasKey()) {
      console.log('⚠  ANTHROPIC_API_KEY not set — text lists work, image extraction is disabled.');
    }
  });
}
