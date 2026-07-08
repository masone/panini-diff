// Vercel serverless entry point.
//
// Vercel doesn't run a long-lived http listener — instead each request invokes
// this exported handler with Node-compatible (req, res) objects. We hand them
// straight to the same routing/auth logic used by `npm run web`, so behaviour
// (Basic Auth gating, static assets, /api/extract) is identical in both places.
//
// vercel.json rewrites every path to this function, so `req.url` still carries
// the original pathname (e.g. /api/health, /style.css) for handleRequest to route.
import { handleRequest } from '../src/server.js';

export default function handler(req, res) {
  return handleRequest(req, res);
}
