// Panini FIFA World Cup 2026 checklist / validation data.
//
// Used to validate and normalize extracted codes. Sourced from the research
// pass (Cartophilic 2026 checklist + prior-edition conventions) and the real
// formats observed in evals/. Reconcile with the final research report when the
// full 48-team list is confirmed; unknown-but-plausible codes are flagged, not
// dropped, so we never silently lose a card.

// The confirmed 48 team codes for the World Cup 2026 set (qualification closed
// 2026-03-31; verified against the Cartophilic / Panini checklists). NOTE these
// are Panini's FIFA-style codes, which deliberately differ from naive ISO-3166
// guesses (GER not DEU, NED not NLD, SUI not CHE, RSA not ZAF, KSA not SAU,
// POR not PRT, CRO not HRV, URU not URY). Every team runs <CODE>1..<CODE>20.
// Italy, Cameroon, Nigeria, Mali, Costa Rica etc. did NOT qualify.
export const TEAM_CODES = new Set([
  'MEX', 'CAN', 'USA', // hosts
  'ARG', 'BRA', 'URU', 'COL', 'ECU', 'PAR', // CONMEBOL
  'GER', 'FRA', 'ENG', 'ESP', 'POR', 'NED', 'BEL', 'CRO', 'SUI', 'AUT',
  'SCO', 'NOR', 'SWE', 'CZE', 'BIH', 'TUR', // UEFA
  'MAR', 'ALG', 'TUN', 'EGY', 'SEN', 'GHA', 'CIV', 'RSA', 'CPV', 'COD', // CAF
  'JPN', 'KOR', 'KSA', 'IRN', 'AUS', 'QAT', 'UZB', 'IRQ', 'JOR', // AFC
  'NZL', // OFC
  'PAN', 'HAI', 'CUW', // CONCACAF
]);

// Special / non-team stickers. These are valid cards but map to no country.
//   FWC — emblem, trophy, mascot, host cities, legends (FWC1..FWC19)
//   CC  — Coca-Cola x Panini promo (CC1..CC14), 2 letters
//   00  — Panini logo sticker (numeric, no letters)
export const SPECIAL_CODES = new Set(['FWC', 'CC', '00']);

// Wrong-but-common codes -> canonical. Covers scraped-checklist variants and the
// OCR / typo errors seen in the eval images (EGV->EGY, BHI->BIH).
export const CODE_ALIASES = {
  SWI: 'SUI', CHE: 'SUI',
  SAU: 'KSA',
  JAP: 'JPN',
  IVC: 'CIV',
  DEU: 'GER',
  HOL: 'NED', NLD: 'NED',
  ZAF: 'RSA',
  HRV: 'CRO',
  CRI: 'CRC',
  // observed OCR / typo noise
  EGV: 'EGY',
  BHI: 'BIH',
};

// German (and a few English) collection-language country names -> Panini code.
// Needed because some image tables list ONLY the country name, no code.
export const NAME_TO_CODE = {
  mexiko: 'MEX', mexico: 'MEX',
  kanada: 'CAN', canada: 'CAN',
  usa: 'USA', 'vereinigte staaten': 'USA',
  argentinien: 'ARG', argentina: 'ARG',
  brasilien: 'BRA', brazil: 'BRA',
  uruguay: 'URU',
  kolumbien: 'COL', colombia: 'COL',
  ecuador: 'ECU',
  paraguay: 'PAR',
  deutschland: 'GER', germany: 'GER',
  frankreich: 'FRA', france: 'FRA',
  england: 'ENG',
  spanien: 'ESP', spain: 'ESP',
  portugal: 'POR',
  niederlande: 'NED', niederland: 'NED', netherlands: 'NED',
  belgien: 'BEL', belgium: 'BEL',
  kroatien: 'CRO', croatia: 'CRO',
  schweiz: 'SUI', switzerland: 'SUI',
  oesterreich: 'AUT', österreich: 'AUT', austria: 'AUT',
  schottland: 'SCO', scotland: 'SCO',
  norwegen: 'NOR', norway: 'NOR',
  schweden: 'SWE', sweden: 'SWE',
  tschechien: 'CZE', 'tschechische republik': 'CZE', czechia: 'CZE',
  bosnien: 'BIH', 'bosnien und herzegowina': 'BIH', 'bosnia': 'BIH',
  marokko: 'MAR', morocco: 'MAR', marocco: 'MAR',
  algerien: 'ALG', algeria: 'ALG',
  tunesien: 'TUN', tunisia: 'TUN',
  aegypten: 'EGY', ägypten: 'EGY', egypt: 'EGY',
  senegal: 'SEN',
  ghana: 'GHA',
  elfenbeinkueste: 'CIV', elfenbeinküste: 'CIV', 'cote divoire': 'CIV', 'ivory coast': 'CIV',
  suedafrika: 'RSA', südafrika: 'RSA', 'south africa': 'RSA',
  kapverden: 'CPV', 'cabo verde': 'CPV', 'cape verde': 'CPV',
  kongo: 'COD', 'dr kongo': 'COD', 'dr congo': 'COD', congo: 'COD',
  japan: 'JPN',
  suedkorea: 'KOR', südkorea: 'KOR', 'south korea': 'KOR', korea: 'KOR',
  'saudi arabien': 'KSA', 'saudi-arabien': 'KSA', 'saudi arabia': 'KSA',
  iran: 'IRN',
  australien: 'AUS', australia: 'AUS',
  katar: 'QAT', qatar: 'QAT',
  usbekistan: 'UZB', uzbekistan: 'UZB',
  irak: 'IRQ', iraq: 'IRQ',
  jordanien: 'JOR', jordan: 'JOR',
  neuseeland: 'NZL', 'new zealand': 'NZL',
  panama: 'PAN',
  haiti: 'HAI',
  curacao: 'CUW', curaçao: 'CUW',
  tuerkei: 'TUR', türkei: 'TUR', turkey: 'TUR', tuerkiye: 'TUR',
};

// Every team runs 1..20; FWC specials run 1..19. Used as a soft sanity bound for
// flagging suspicious numbers, never to reject outright.
export const MAX_TEAM_NUMBER = 20;

// Resolve a raw code (already uppercased, letters/digits only) to a canonical
// code plus validity info. Never throws.
export function resolveCode(raw) {
  const up = String(raw).toUpperCase();
  if (SPECIAL_CODES.has(up)) return { code: up, special: true, valid: true, aliased: false };
  if (CODE_ALIASES[up]) return { code: CODE_ALIASES[up], special: false, valid: true, aliased: true };
  if (TEAM_CODES.has(up)) return { code: up, special: false, valid: true, aliased: false };
  return { code: up, special: false, valid: false, aliased: false };
}

// Resolve a country name (any case, possibly with accents/punctuation) to a code.
export function codeForName(name) {
  const key = String(name)
    .toLowerCase()
    .normalize('NFC')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return NAME_TO_CODE[key] || null;
}
