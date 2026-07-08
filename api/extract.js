// POST /api/extract -> one raw image body -> { cards, unreadable, notes, model }
// Vercel serverless function; validation/error-mapping lives in src/httpExtract.js.

import Anthropic from '@anthropic-ai/sdk';
import { readBody, runExtract, resolveModel, MAX_UPLOAD_BYTES, EXTRACT_TIMEOUT_MS } from '../src/httpExtract.js';

// Raw image bytes arrive as the request body; Vercel's default JSON/form body
// parsing would corrupt them, so we read the stream ourselves via readBody.
export const config = { api: { bodyParser: false } };

let sharedClient = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!sharedClient) sharedClient = new Anthropic({ timeout: EXTRACT_TIMEOUT_MS, maxRetries: 1 });
  return sharedClient;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method-not-allowed' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: 'no-api-key' });
    return;
  }

  const model = resolveModel(req.query.model);

  let buffer;
  try {
    buffer = await readBody(req);
  } catch (err) {
    if (err.code === 'too-large') {
      res.status(413).json({ error: 'too-large', maxBytes: MAX_UPLOAD_BYTES });
    } else {
      res.status(400).json({ error: 'bad-request' });
    }
    return;
  }

  const { status, body } = await runExtract({ contentType: req.headers['content-type'], buffer, client: getClient(), model });
  res.status(status).json(body);
}
