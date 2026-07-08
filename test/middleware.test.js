import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import middleware from '../middleware.js';

// The Basic Auth gate lives in the Vercel Edge Middleware, which runs before
// both the CDN-served static assets and the /api/* functions (identically under
// `vercel dev` and in prod). The middleware uses only Web-standard APIs
// (Request/Response/atob), so we can exercise it directly in Node.

const basicHeader = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
const req = (auth) => new Request('https://panini-diff.test/', auth ? { headers: { authorization: auth } } : undefined);

beforeEach(() => {
  delete process.env.BASIC_AUTH_USER;
  delete process.env.BASIC_AUTH_PASS;
});

test('with auth off, requests pass through without credentials', () => {
  assert.equal(middleware(req()), undefined);
});

test('with auth on, no credentials -> 401 + WWW-Authenticate', () => {
  process.env.BASIC_AUTH_USER = 'alice';
  process.env.BASIC_AUTH_PASS = 's3cret';
  const res = middleware(req());
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate'), /^Basic realm=/);
});

test('with auth on, wrong credentials -> 401', () => {
  process.env.BASIC_AUTH_USER = 'alice';
  process.env.BASIC_AUTH_PASS = 's3cret';
  assert.equal(middleware(req(basicHeader('alice', 'nope'))).status, 401);
  assert.equal(middleware(req(basicHeader('bob', 's3cret'))).status, 401);
});

test('with auth on, correct credentials pass through', () => {
  process.env.BASIC_AUTH_USER = 'alice';
  process.env.BASIC_AUTH_PASS = 's3cret';
  assert.equal(middleware(req(basicHeader('alice', 's3cret'))), undefined);
});

test('with auth on, a malformed Authorization header -> 401', () => {
  process.env.BASIC_AUTH_USER = 'alice';
  process.env.BASIC_AUTH_PASS = 's3cret';
  assert.equal(middleware(req('Bearer xyz')).status, 401);
  // "Basic" scheme but the decoded payload has no ":" separator.
  assert.equal(middleware(req(`Basic ${Buffer.from('nocolon').toString('base64')}`)).status, 401);
});
