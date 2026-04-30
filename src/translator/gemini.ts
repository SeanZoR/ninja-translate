import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';
import { estimateCostCents } from '../cost.js';

// ISO-639-1 → human-readable name. Add more as group configs use them.
// `my` is Burmese (per ISO-639-1) - NOT Malay. Malay is `ms`. The country
// code MY = Malaysia which speaks Malay; that ambiguity is the trap we
// avoid by always passing the full name to the model alongside the code.
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  th: 'Thai',
  he: 'Hebrew',
  my: 'Burmese (the language of Myanmar, NOT Malay)',
  ms: 'Malay',
  tl: 'Tagalog',
  id: 'Indonesian',
  es: 'Spanish',
  ru: 'Russian',
  zh: 'Chinese',
  fr: 'French',
  de: 'German',
};

const FLAGS: Record<string, string> = {
  en: '🇬🇧',
  th: '🇹🇭',
  he: '🇮🇱',
  my: '🇲🇲',
  ms: '🇲🇾',
  tl: '🇵🇭',
  id: '🇮🇩',
  es: '🇪🇸',
  ru: '🇷🇺',
  zh: '🇨🇳',
  fr: '🇫🇷',
  de: '🇩🇪',
};

export type TranslateInput =
  | { kind: 'voice'; audioBase64: string; mimeType: string }
  | { kind: 'text'; text: string };

export type TranslateOptions = {
  targetLanguages: string[];
  /** Voice-only. 0=verbatim, 1=light fillers, 2=medium cleanup, 3=high (rewrite for clarity). */
  polishLevel: number;
  showSourceLabel: boolean;
};

function polishInstruction(level: number, kind: 'voice' | 'text'): string {
  if (kind === 'text') return ''; // Polishing only applies to voice transcripts.
  switch (level) {
    case 0:
      return 'Produce a strictly verbatim transcript - include filler sounds, repetitions, and false starts as spoken.';
    case 2:
      return 'Drop filler sounds (um, uh, er, like-as-filler, you-know) AND collapse repeated false starts. Tighten awkward phrasing while preserving voice and intent.';
    case 3:
      return 'Polish into clear natural prose: drop fillers, false starts, and repetitions, and restructure sentences for clarity if needed. Preserve all factual content and the speaker\'s intent. Never invent information.';
    case 1:
    default:
      return 'Drop obvious filler sounds (um, uh, er, like-as-filler) and verbal tics. Keep the speaker\'s exact phrasing otherwise.';
  }
}

export type TranslateResult = {
  sourceLang: string | null;
  sourceText: string | null;
  translations: Record<string, string>;
  rendered: string;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
};

let _client: GoogleGenerativeAI | null = null;
function client(): GoogleGenerativeAI {
  if (!_client) _client = new GoogleGenerativeAI(config.geminiApiKey());
  return _client;
}

function buildPrompt(opts: TranslateOptions, kind: 'voice' | 'text'): string {
  const labelled = opts.targetLanguages
    .map((l) => `  - ${l} (${LANGUAGE_NAMES[l] ?? l})`)
    .join('\n');
  const transcriptStep = kind === 'voice'
    ? `Produce a transcript in the source language. ${polishInstruction(opts.polishLevel, 'voice')}`
    : 'Use the input text verbatim.';
  return `You are a translator inside a multilingual WhatsApp group.

Languages in this group (ISO-639-1 code → name):
${labelled}

The input is ${kind === 'voice' ? 'a voice message (audio)' : 'a text message'}.

Steps:
1. Identify the source language (must be one of the codes above).
2. ${transcriptStep}
3. Translate naturally into every OTHER language in the list, based on the transcript from step 2. Preserve tone and register. NO commentary, NO explanations, NO alternative phrasings, NO markdown.

Output EXACTLY this format and nothing else:

LANG=<source iso code>
SOURCE=<source text on a single line; replace any internal newlines with spaces>
[<code>]=<translation on a single line>
[<code>]=<translation on a single line>
...

Rules:
- One line per element. No blank lines. No leading/trailing whitespace on lines.
- Use bare ISO-639-1 codes from the list above.
- "my" means Burmese, not Malay. If you output "my=", the value MUST be in Burmese script.
- Do NOT include the source language as a [<code>]= line. Skip it.
- If the input is silent, empty, or unintelligible, output exactly:
UNINTELLIGIBLE
(and nothing else)`;
}

type ParsedResponse = {
  sourceLang: string | null;
  sourceText: string | null;
  translations: Record<string, string>;
};

function parseResponse(raw: string, opts: TranslateOptions): ParsedResponse {
  const trimmed = raw.trim();
  if (trimmed === 'UNINTELLIGIBLE' || trimmed === '[UNINTELLIGIBLE]' || trimmed === '[unintelligible]') {
    return { sourceLang: null, sourceText: null, translations: {} };
  }

  let sourceLang: string | null = null;
  let sourceText: string | null = null;
  const translations: Record<string, string> = {};
  const allowed = new Set(opts.targetLanguages.map((l) => l.toLowerCase()));

  for (const lineRaw of trimmed.split('\n')) {
    const line = lineRaw.trim();
    if (!line) continue;

    if (line.startsWith('LANG=')) {
      const v = line.slice('LANG='.length).trim().toLowerCase();
      if (allowed.has(v)) sourceLang = v;
      continue;
    }
    if (line.startsWith('SOURCE=')) {
      sourceText = line.slice('SOURCE='.length).trim();
      continue;
    }

    const m = line.match(/^\[([a-z]{2,3})\]=(.*)$/i);
    if (m) {
      const code = m[1]!.toLowerCase();
      const value = m[2]!.trim();
      if (allowed.has(code) && value) translations[code] = value;
      continue;
    }
  }

  return { sourceLang, sourceText, translations };
}

function renderForWhatsApp(
  parsed: ParsedResponse,
  opts: TranslateOptions,
  kind: 'voice' | 'text',
): string {
  if (!parsed.sourceLang && Object.keys(parsed.translations).length === 0) {
    return '[unintelligible]';
  }
  const lines: string[] = [];

  for (const lang of opts.targetLanguages) {
    if (lang === parsed.sourceLang) continue;
    const t = parsed.translations[lang];
    if (t && t.trim().length > 0) lines.push(`${flagFor(lang)} ${t}`);
  }

  // Source line goes LAST and only for voice (so the speaker can verify the
  // transcript - possibly polished per polishLevel). Text mentions skip it
  // since the speaker already sees their own message above the bot's quoted
  // reply.
  if (kind === 'voice' && parsed.sourceLang && parsed.sourceText) {
    lines.push(`${flagFor(parsed.sourceLang)} ${parsed.sourceText}`);
  }

  return lines.join('\n');
}

export async function translate(
  input: TranslateInput,
  opts: TranslateOptions,
): Promise<TranslateResult> {
  const model = client().getGenerativeModel({
    model: config.geminiModel,
    generationConfig: {
      maxOutputTokens: 4096,
      temperature: 0.2,
    },
  });
  const prompt = buildPrompt(opts, input.kind);

  const parts: any[] =
    input.kind === 'voice'
      ? [
          { text: prompt },
          { inlineData: { mimeType: input.mimeType, data: input.audioBase64 } },
        ]
      : [{ text: `${prompt}\n\nInput text:\n${input.text}` }];

  const resp = await model.generateContent({ contents: [{ role: 'user', parts }] });
  const raw = resp.response.text();
  const usage = resp.response.usageMetadata;

  const parsed = parseResponse(raw, opts);

  const inputTokens = usage?.promptTokenCount ?? 0;
  const outputTokens = usage?.candidatesTokenCount ?? 0;
  const costCents =
    input.kind === 'voice'
      ? estimateCostCents({ audioTokens: inputTokens, outputTokens })
      : estimateCostCents({ textInputTokens: inputTokens, outputTokens });

  return {
    sourceLang: parsed.sourceLang,
    sourceText: parsed.sourceText,
    translations: parsed.translations,
    rendered: renderForWhatsApp(parsed, opts, input.kind),
    tokensIn: inputTokens,
    tokensOut: outputTokens,
    costCents,
  };
}

export function flagFor(lang: string): string {
  return FLAGS[lang] ?? '🏳️';
}
