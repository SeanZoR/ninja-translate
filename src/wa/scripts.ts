// Unicode-script detection for the auto-translate-without-mention feature.
//
// Non-Latin languages are identified purely by script (a Thai character means
// Thai). Latin-script languages (en, es, fr, de, ms, tl, id) all look the
// same at this level, so a Latin match only says "worth sending to Gemini";
// the handler then checks Gemini's detected source language against the
// group's auto-translate list and drops the reply if it doesn't match.
const LATIN = /[A-Za-zÀ-ɏ]/;

const SCRIPT_PATTERNS: Record<string, RegExp> = {
  th: /[฀-๿]/, // Thai
  he: /[֐-׿]/, // Hebrew
  ru: /[Ѐ-ӿ]/, // Cyrillic
  zh: /[一-鿿]/, // CJK Unified Ideographs (Han)
  my: /[က-႟]/, // Myanmar
  en: LATIN,
  es: LATIN,
  fr: LATIN,
  de: LATIN,
  ms: LATIN,
  tl: LATIN,
  id: LATIN,
};

/** True when `text` contains a script that could belong to one of `langs`. */
export function matchesScript(text: string, langs: string[]): boolean {
  return langs.some((l) => SCRIPT_PATTERNS[l]?.test(text));
}
