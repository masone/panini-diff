// AI image extraction: turn a photo/screenshot of a Panini sticker list into
// normalized cards using Claude vision. The model does OCR + layout reading +
// country-name->code mapping in one step and is instructed to FLAG anything it
// cannot read confidently rather than guess. All returned codes still go through
// the same buildCard() validation the text parser uses.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { buildCard, dedupeCards } from './cards.js';
import { TEAM_CODES } from './checklist.js';

// Opus is the default: on dense chat lists Sonnet occasionally row-shifts (reads
// one row's numbers onto the adjacent code), which silently corrupts a trade
// match. Opus scored ~100% across the eval images. Override with PANINI_MODEL or
// --model claude-sonnet-5 for a cheaper, slightly less accurate run.
export const DEFAULT_MODEL = process.env.PANINI_MODEL || 'claude-opus-4-8';

// Extension -> media type. Exported so the web server can validate uploaded
// content-types (and enumerate accepted types) from the same source of truth.
export const MEDIA_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

// The set of media-type strings the extractor / vision model accepts.
export const SUPPORTED_MEDIA_TYPES = new Set(Object.values(MEDIA_TYPES));

export function isImagePath(p) {
  return path.extname(p).toLowerCase() in MEDIA_TYPES;
}

const REPORT_TOOL = {
  name: 'report_stickers',
  description: 'Report the Panini sticker codes and numbers extracted from the image.',
  input_schema: {
    type: 'object',
    properties: {
      stickers: {
        type: 'array',
        description: 'One entry per distinct sticker (code + number). Ignore how many copies (counts).',
        items: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Team/special code, e.g. MAR, GER, FWC. Uppercase.' },
            number: { type: 'integer', description: 'Sticker number 1-20 (FWC 1-19).' },
          },
          required: ['code', 'number'],
        },
      },
      unreadable: {
        type: 'array',
        description: 'Descriptions of any region/row/cell that is redacted, blurred, cut off, or otherwise impossible to read. Do NOT guess its contents.',
        items: { type: 'string' },
      },
      notes: { type: 'string', description: 'Optional short note about the list (e.g. language, ambiguities).' },
    },
    required: ['stickers', 'unreadable'],
  },
};

function buildPrompt() {
  const codes = [...TEAM_CODES].sort().join(', ');
  return `You are extracting a Panini FIFA World Cup 2026 sticker trade list from an image.

Each sticker is a TEAM CODE + a NUMBER (1-20). The 48 valid team codes are:
${codes}
Plus special codes: FWC (1-19) and 00 (Panini logo). Promo codes: CC (1-14).

RULES:
- Extract every sticker as a {code, number} pair. Lines look like "MAR 15", "GER9", "BRA: 4, 10, 12", "MAR: 4, 8, 9, 11". One code usually applies to several comma-separated numbers on the same line.
- Codes may be written with a space, no space, colon, or hyphen before the number. Normalize the code to uppercase.
- Some rows give ONLY a country NAME (often German: Marokko, Deutschland, Belgien, Ägypten, Südafrika, Kroatien...) with no code. Map the name to its Panini code (Marokko->MAR, Deutschland->GER, Belgien->BEL, Ägypten->EGY, Südafrika->RSA, Kroatien->CRO, Niederlande->NED, Schweiz->SUI, Österreich->AUT, Tschechien->CZE, Türkei->TUR, Elfenbeinküste->CIV, Kapverden->CPV, etc.).
- IGNORE everything that is not a sticker: prices, currency, phone numbers, URLs, app names, "Wir haben"/"Doppelte"/"verkaufe" headings, chat UI, timestamps, "Jetzt kaufen" buttons.
- IGNORE copy counts like "(2x)", "(3x)", "x2" — report the sticker once regardless.
- If a cell/row is REDACTED (black bar), blurred, or cut off, do NOT invent a value. Add a description to "unreadable" instead.
- If a code is not in the valid list and you are unsure (possible OCR error), still report your best transcription — it will be validated downstream — but mention the uncertainty in notes.

Call report_stickers with your result.`;
}

// Extract cards from an image buffer. Returns { cards, unreadable, notes, raw }.
export async function extractFromImageBuffer(buffer, mediaType, opts = {}) {
  const client = opts.client || new Anthropic();
  const model = opts.model || DEFAULT_MODEL;
  const msg = await client.messages.create({
    model,
    max_tokens: 4096,
    tools: [REPORT_TOOL],
    tool_choice: { type: 'tool', name: 'report_stickers' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') } },
          { type: 'text', text: buildPrompt() },
        ],
      },
    ],
  });

  const block = msg.content.find((b) => b.type === 'tool_use');
  if (!block) throw new Error('Model did not return a report_stickers tool call');
  const { stickers = [], unreadable = [], notes = '' } = block.input;

  const cards = dedupeCards(
    stickers
      .filter((s) => s && s.code != null && Number.isFinite(Number(s.number)))
      .map((s) => buildCard(String(s.code).trim(), Number(s.number), { source: 'image' })),
  );

  return { cards, unreadable, notes, raw: block.input };
}

export async function extractFromImage(imagePath, opts = {}) {
  const ext = path.extname(imagePath).toLowerCase();
  const mediaType = MEDIA_TYPES[ext];
  if (!mediaType) throw new Error(`Unsupported image type: ${ext}`);
  const buffer = await readFile(imagePath);
  return extractFromImageBuffer(buffer, mediaType, opts);
}
