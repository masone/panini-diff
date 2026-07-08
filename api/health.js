// GET /api/health -> { hasKey, defaultModel } so the client can warn before an
// upload when no server-side ANTHROPIC_API_KEY is configured.

import { DEFAULT_MODEL } from '../src/extract.js';

export default function handler(req, res) {
  res.status(200).json({ hasKey: Boolean(process.env.ANTHROPIC_API_KEY), defaultModel: DEFAULT_MODEL });
}
