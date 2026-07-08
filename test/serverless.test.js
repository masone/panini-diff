import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import health from '../api/health.js';
import extract from '../api/extract.js';
import { runExtract, resolveModel } from '../src/httpExtract.js';
import { DEFAULT_MODEL } from '../src/extract.js';

// Route coverage for the serverless path. The Vercel handlers (api/*.js) are
// invoked directly with a minimal (req, res) mock; the transport-agnostic
// validation/error mapping is exercised through runExtract() with a mocked
// Anthropic client, so no network or real API key is needed.

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
}

const png = Buffer.from('fake-png-bytes');

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

test('GET /api/health reports whether a key is present', () => {
  const r1 = mockRes();
  health({ method: 'GET' }, r1);
  assert.equal(r1.statusCode, 200);
  assert.equal(r1.body.hasKey, false);
  assert.equal(r1.body.defaultModel, DEFAULT_MODEL);

  process.env.ANTHROPIC_API_KEY = 'sk-test';
  const r2 = mockRes();
  health({ method: 'GET' }, r2);
  assert.equal(r2.body.hasKey, true);
});

test('POST /api/extract without a key -> 503 no-api-key', async () => {
  const res = mockRes();
  await extract({ method: 'POST', headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'no-api-key');
});

test('/api/extract rejects non-POST -> 405', async () => {
  const res = mockRes();
  await extract({ method: 'GET', headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 405);
});

test('resolveModel honors the allowlist and falls back to the default', () => {
  assert.equal(resolveModel('claude-sonnet-5'), 'claude-sonnet-5');
  assert.equal(resolveModel('evil-model'), DEFAULT_MODEL);
  assert.equal(resolveModel(undefined), DEFAULT_MODEL);
});

test('runExtract with an unsupported type -> 415', async () => {
  const { status, body } = await runExtract({ contentType: 'application/pdf', buffer: png, client: null, model: DEFAULT_MODEL });
  assert.equal(status, 415);
  assert.equal(body.error, 'unsupported-type');
});

test('runExtract with an empty body -> 400', async () => {
  const { status, body } = await runExtract({ contentType: 'image/png', buffer: Buffer.alloc(0), client: null, model: DEFAULT_MODEL });
  assert.equal(status, 400);
  assert.equal(body.error, 'empty-body');
});

test('runExtract happy path returns resolved {code,number} pairs', async () => {
  const client = {
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
  };
  const { status, body } = await runExtract({ contentType: 'image/png', buffer: png, client, model: DEFAULT_MODEL });
  assert.equal(status, 200);
  assert.deepEqual(body.cards, [{ code: 'MAR', number: 15 }, { code: 'SUI', number: 9 }]);
  assert.deepEqual(body.unreadable, ['blurred corner']);
});

test('runExtract surfaces a 401 upstream as 502 upstream-auth', async () => {
  const client = {
    messages: { create: async () => { throw Object.assign(new Error('unauthorized'), { status: 401 }); } },
  };
  const { status, body } = await runExtract({ contentType: 'image/png', buffer: png, client, model: DEFAULT_MODEL });
  assert.equal(status, 502);
  assert.equal(body.error, 'upstream-auth');
});
