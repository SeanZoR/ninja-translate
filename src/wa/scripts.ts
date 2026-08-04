// Unicode-script detection for the auto-translate-without-mention feature.
// Only languages whose script is visually distinct from Latin can be
// auto-triggered — Latin-script languages (en, es, fr, de, ms, tl, id) are
// indistinguishable from each other without real language detection, so they
// are deliberately absent.
const SCRIPT_PATTERNS: Record<string, RegExp> = {
  th: /[฀-๿]/, // Thai
  he: /[֐-׿]/, // Hebrew
  ru: /[Ѐ-ӿ]/, // Cyrillic
  zh: /[一-鿿]/, // CJK Unified Ideographs (Han)
  my: /[က-႟]/, // Myanmar
};

// Codes offered in the group settings UI for auto-translate.
export const SCRIPT_CAPABLE_LANGS = Object.keys(SCRIPT_PATTERNS);

export function matchesScript(text: string, langs: string[]): boolean {
  return langs.some((l) => SCRIPT_PATTERNS[l]?.test(text));
}
