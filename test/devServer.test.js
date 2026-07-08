import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, __setClientForTest } from '../src/devServer.js';

// Spin the real http server up on an ephemeral port and talk to it over fetch,
// so these are true end-to-end route tests (no network to Anthropic — the vision
// client is mocked via the __setClientForTest seam).

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  base = `http://localhost:${port}`;
});

after(() => server.close());

beforeEach(() => {
  __setClientForTest(null);
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.BASIC_AUTH_USER;
  delete process.env.BASIC_AUTH_PASS;
});

const basicHeader = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

const png = Buffer.from('fake-png-bytes');

test('GET /api/health reports whether a key is present', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.hasKey, false);

  process.env.ANTHROPIC_API_KEY = 'sk-test';
  const res2 = await fetch(`${base}/api/health`);
  assert.equal((await res2.json()).hasKey, true);
});

test('GET / serves the app shell', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /panini-diff/);
});

test('GET /src/cards.js is served verbatim to the browser', async () => {
  const res = await fetch(`${base}/src/cards.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.match(await res.text(), /export function parseText/);
});

test('POST /api/extract without a key -> 503 no-api-key', async () => {
  const res = await fetch(`${base}/api/extract`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png,
  });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'no-api-key');
});

test('POST /api/extract with an unsupported type -> 415', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  const res = await fetch(`${base}/api/extract`, {
    method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: png,
  });
  assert.equal(res.status, 415);
  assert.equal((await res.json()).error, 'unsupported-type');
});

test('POST /api/extract happy path returns resolved {code,number} pairs', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  __setClientForTest({
    messages: {
      create: async () => ({
        content: [{
          type: 'tool_use', name: 'report_stickers',
          input: {
            stickers: [
              { code: 'MAR', number: 15 },
              { code: 'SWI', number: 9 }, // alias -> SUI, resolved before returning
            ],
            unreadable: ['blurred corner'],
            notes: 'ok',
          },
        }],
      }),
    },
  });

  const res = await fetch(`${base}/api/extract`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png,
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.cards, [{ code: 'MAR', number: 15 }, { code: 'SUI', number: 9 }]);
  assert.deepEqual(data.unreadable, ['blurred corner']);
});

test('POST /api/extract surfaces a 401 upstream as 502 upstream-auth', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  __setClientForTest({
    messages: {
      create: async () => { throw Object.assign(new Error('unauthorized'), { status: 401 }); },
    },
  });
  const res = await fetch(`${base}/api/extract`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png,
  });
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'upstream-auth');
});

test('unknown route -> 404', async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
});

test('with auth off, requests pass through without credentials', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
});

test('with auth on, a request without credentials -> 401 + WWW-Authenticate', async () => {
  process.env.BASIC_AUTH_USER = 'alice';
  process.env.BASIC_AUTH_PASS = 's3cret';
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate'), /^Basic realm=/);
});

test('with auth on, wrong credentials -> 401', async () => {
  process.env.BASIC_AUTH_USER = 'alice';
  process.env.BASIC_AUTH_PASS = 's3cret';
  const res = await fetch(`${base}/`, { headers: { Authorization: basicHeader('alice', 'nope') } });
  assert.equal(res.status, 401);
});

test('with auth on, correct credentials pass through', async () => {
  process.env.BASIC_AUTH_USER = 'alice';
  process.env.BASIC_AUTH_PASS = 's3cret';
  const res = await fetch(`${base}/api/health`, { headers: { Authorization: basicHeader('alice', 's3cret') } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).hasKey, false);
});

test('with auth on, a malformed Authorization header -> 401', async () => {
  process.env.BASIC_AUTH_USER = 'alice';
  process.env.BASIC_AUTH_PASS = 's3cret';
  const res = await fetch(`${base}/`, { headers: { Authorization: 'Bearer xyz' } });
  assert.equal(res.status, 401);
});
