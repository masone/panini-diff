// Shared image-extraction request handling, used by both the plain-node dev
// server (src/devServer.js) and the Vercel serverless function (api/extract.js)
// so the two hosts can't drift on validation, error mapping, or model choice.

import { extractFromImageBuffer, DEFAULT_MODEL, SUPPORTED_MEDIA_TYPES } from './extract.js';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB — Claude vision image limit
export const EXTRACT_TIMEOUT_MS = 60_000;
export const MODEL_ALLOWLIST = new Set(['claude-opus-4-8', 'claude-sonnet-5']);

export function resolveModel(modelParam) {
  return modelParam && MODEL_ALLOWLIST.has(modelParam) ? modelParam : DEFAULT_MODEL;
}

// Read a request body into a Buffer, enforcing the size cap as we go so a huge
// upload can't exhaust memory before we reject it. Works against any
// http.IncomingMessage-shaped stream (Node's http server, or Vercel's req with
// bodyParser disabled).
export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_UPLOAD_BYTES) {
        reject(Object.assign(new Error('too-large'), { code: 'too-large' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Core extract logic, transport-agnostic: given a content-type + raw body +
// Anthropic client, return a plain { status, body } result for the caller to
// serialize however its host requires.
export async function runExtract({ contentType, buffer, client, model }) {
  const mediaType = (contentType || '').split(';')[0].trim().toLowerCase();
  if (!SUPPORTED_MEDIA_TYPES.has(mediaType)) {
    return { status: 415, body: { error: 'unsupported-type', mediaType, supported: [...SUPPORTED_MEDIA_TYPES] } };
  }
  if (!buffer.length) return { status: 400, body: { error: 'empty-body' } };

  try {
    const { cards, unreadable, notes } = await extractFromImageBuffer(buffer, mediaType, { client, model });
    const pairs = cards.map((c) => ({ code: c.code, number: c.number }));
    return { status: 200, body: { cards: pairs, unreadable, notes, model } };
  } catch (err) {
    const status = err?.status || err?.response?.status;
    if (status === 401) return { status: 502, body: { error: 'upstream-auth' } };
    if (err?.name === 'APIUserAbortError' || /timeout|aborted/i.test(err?.message || '')) {
      return { status: 504, body: { error: 'timeout' } };
    }
    // Never leak the key or a stack trace; a short message is enough for the UI.
    return { status: 502, body: { error: 'extract-failed', message: String(err?.message || 'extraction failed') } };
  }
}
