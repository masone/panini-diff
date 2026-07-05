import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromImageBuffer, isImagePath } from '../src/extract.js';

// A fake Anthropic client that returns a scripted tool_use block, so we can test
// the model-output -> normalized-card pipeline with no network / API key.
function mockClient(input) {
  return {
    messages: {
      create: async () => ({ content: [{ type: 'tool_use', name: 'report_stickers', input }] }),
    },
  };
}

const buf = Buffer.from('fake-image-bytes');

test('isImagePath recognizes image extensions only', () => {
  assert.ok(isImagePath('a.PNG'));
  assert.ok(isImagePath('/x/y.jpg'));
  assert.ok(!isImagePath('list.txt'));
});

test('normalizes, aliases, dedupes and flags model output', async () => {
  const client = mockClient({
    stickers: [
      { code: 'MAR', number: 15 },
      { code: 'SWI', number: 9 }, // alias -> SUI
      { code: 'mar', number: 15 }, // dup of MAR 15 after uppercasing
      { code: 'ZZZ', number: 4 }, // unknown code
      { code: 'GER', number: 99 }, // out of range
      { code: 'FWC', number: 8 }, // special
    ],
    unreadable: ['bottom-right cell is a black bar'],
    notes: 'german list',
  });

  const { cards, unreadable, notes } = await extractFromImageBuffer(buf, 'image/png', { client });
  const byKey = Object.fromEntries(cards.map((c) => [c.key, c]));

  assert.deepEqual(cards.map((c) => c.key), ['MAR 15', 'SUI 9', 'ZZZ 4', 'GER 99', 'FWC 8']);
  assert.equal(byKey['SUI 9'].valid, true);
  assert.ok(byKey['SUI 9'].flags.includes('aliased-from-SWI'));
  assert.equal(byKey['ZZZ 4'].valid, false);
  assert.equal(byKey['GER 99'].valid, false);
  assert.equal(byKey['FWC 8'].special, true);
  assert.deepEqual(unreadable, ['bottom-right cell is a black bar']);
  assert.equal(notes, 'german list');
});

test('throws a clear error when the model returns no tool call', async () => {
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text: 'nope' }] }) } };
  await assert.rejects(() => extractFromImageBuffer(buf, 'image/png', { client }), /report_stickers/);
});
