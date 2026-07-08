// Vercel Edge Middleware — HTTP Basic Auth gate for the whole deployment.
//
// Unlike the src/devServer.js handler, the Vercel deploy has no single request
// handler to hang auth off: static assets (/, /app.js, /style.css) are served
// straight from the CDN via vercel.json rewrites, and /api/* are independent
// serverless functions. Edge Middleware is the one layer that runs before ALL
// of them, so this is where the password gate belongs.
//
// Activates only when both BASIC_AUTH_USER and BASIC_AUTH_PASS are set (as they
// are in the Vercel project env). With neither set, every request passes through
// untouched, so local `vercel dev` without creds stays open.

export const config = {
  // Run on everything except Vercel's own internals and static file assets it
  // fingerprints. We DO want to gate /, /app.js, /style.css and /api/*.
  matcher: ['/((?!_next/static|_vercel|favicon\\.ico).*)'],
};

// Constant-time string comparison. Edge runtime has no node:crypto
// timingSafeEqual, so compare over the max length and fold every char in to
// avoid leaking length or an early-exit position.
function safeEqual(a, b) {
  const av = a ?? '';
  const bv = b ?? '';
  const len = Math.max(av.length, bv.length);
  let diff = av.length ^ bv.length;
  for (let i = 0; i < len; i++) {
    diff |= av.charCodeAt(i) ^ bv.charCodeAt(i);
  }
  return diff === 0;
}

function unauthorized() {
  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="panini-diff", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

export default function middleware(request) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;

  // Auth is opt-in: no creds configured -> deployment is open.
  if (!user && !pass) return;

  const header = request.headers.get('authorization') || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) return unauthorized();

  let decoded;
  try {
    decoded = atob(encoded);
  } catch {
    return unauthorized();
  }

  const sep = decoded.indexOf(':');
  if (sep === -1) return unauthorized();

  // Compare both fields regardless of a username mismatch to avoid short-circuiting.
  const userOk = safeEqual(decoded.slice(0, sep), user);
  const passOk = safeEqual(decoded.slice(sep + 1), pass);
  if (!(userOk && passOk)) return unauthorized();

  // Authorized — fall through (returning undefined lets the request continue).
}
