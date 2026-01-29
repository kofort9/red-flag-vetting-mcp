/**
 * Name normalization for OFAC matching.
 *
 * OFAC matching is a binary legal concern — we use exact match
 * after normalization rather than fuzzy matching.
 *
 * Normalization steps:
 * 1. Lowercase
 * 2. Strip punctuation (periods, commas, quotes, etc.)
 * 3. Remove "the" prefix
 * 4. Remove org suffixes (inc, corp, foundation, etc.)
 * 5. Collapse whitespace
 */

const ORG_SUFFIXES = [
  'incorporated',
  'inc',
  'corporation',
  'corp',
  'foundation',
  'fdn',
  'association',
  'assoc',
  'assn',
  'organization',
  'org',
  'limited',
  'ltd',
  'llc',
  'llp',
  'lp',
  'co',
  'company',
  'trust',
  'fund',
  'society',
  'institute',
  'group',
  'international',
  'intl',
  'national',
  'natl',
  'nfp',
  'pbc',
];

// Build a regex to match any suffix at word boundary at end of string
const SUFFIX_PATTERN = new RegExp(
  `\\b(${ORG_SUFFIXES.join('|')})\\b`,
  'gi'
);

export function normalizeName(name: string): string {
  let normalized = name.toLowerCase();

  // Strip punctuation (keep alphanumeric and spaces)
  normalized = normalized.replace(/[^a-z0-9\s]/g, '');

  // Remove "the" prefix
  normalized = normalized.replace(/^the\s+/, '');

  // Remove org suffixes
  normalized = normalized.replace(SUFFIX_PATTERN, '');

  // Collapse whitespace and trim
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}
