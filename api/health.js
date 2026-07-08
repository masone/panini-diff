// GET /api/health -> { hasKey, defaultModel }, same contract as src/devServer.js,
// so the client's `hasKey` check behaves identically on Vercel and locally.

import { DEFAULT_MODEL } from '../src/extract.js';

export default function handler(req, res) {
  res.status(200).json({ hasKey: Boolean(process.env.ANTHROPIC_API_KEY), defaultModel: DEFAULT_MODEL });
}
