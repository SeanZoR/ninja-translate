import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';
import { estimateCostCents } from '../cost.js';

const FLAGS: Record<string, string> = {
  en: '🇬🇧',
  th: '🇹🇭',
  he: '🇮🇱',
  my: '🇲🇲',
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
  conciseMode: boolean;
  showSourceLabel: boolean;
};

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
  const langs = opts.targetLanguages.join(', ');
  const sourceBlock = opts.conciseMode ? '' : '<source transcript or text>\n---\n';
  const labelBlock = opts.showSourceLabel ? '[lang: <iso-639-1>]\n' : '';
  return `You are a translator inside a multilingual WhatsApp group.

Group languages: [${langs}]  (ISO-639-1 codes)
Concise mode: ${opts.conciseMode}
Show source label: ${opts.showSourceLabel}

Input is ${kind === 'voice' ? 'a voice message (audio)' : 'a text message'}.

Steps:
1. Identify the source language. It MUST be one of the group's languages.
2. ${kind === 'voice' ? 'Produce a faithful transcript in the source language.' : 'Use the input text verbatim as the source.'}
3. Translate naturally into every OTHER language in the group. Preserve tone and register.

Output ONLY the following format, no commentary, no markdown fences:
${labelBlock}${sourceBlock}<flag emoji> <translation in target language 1>
<flag emoji> <translation in target language 2>
...

Use these flag emojis: ${opts.targetLanguages.map(l => `${l}=${FLAGS[l] ?? '🏳️'}`).join(', ')}

If the input is silent, empty, or unintelligible, output exactly: [unintelligible]`;
}

function parseRendered(rendered: string, opts: TranslateOptions): {
  sourceLang: string | null;
  sourceText: string | null;
  translations: Record<string, string>;
} {
  const trimmed = rendered.trim();
  if (trimmed === '[unintelligible]') {
    return { sourceLang: null, sourceText: null, translations: {} };
  }

  let sourceLang: string | null = null;
  let sourceText: string | null = null;
  let body = trimmed;

  if (opts.showSourceLabel) {
    const m = body.match(/^\[lang:\s*([a-z]{2,3})\]\s*\n?/i);
    if (m) {
      sourceLang = m[1]!.toLowerCase();
      body = body.slice(m[0].length);
    }
  }

  if (!opts.conciseMode) {
    const sepIdx = body.indexOf('\n---');
    if (sepIdx >= 0) {
      sourceText = body.slice(0, sepIdx).trim();
      body = body.slice(sepIdx + 4).replace(/^\n+/, '');
    }
  }

  const translations: Record<string, string> = {};
  const flagToLang = new Map<string, string>();
  for (const lang of opts.targetLanguages) {
    const flag = FLAGS[lang];
    if (flag) flagToLang.set(flag, lang);
  }
  for (const line of body.split('\n')) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    let matched = false;
    for (const [flag, lang] of flagToLang) {
      if (trimmedLine.startsWith(flag)) {
        translations[lang] = trimmedLine.slice(flag.length).trim();
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Be forgiving: if a line begins with "EN: " or similar, accept that too.
      const m = trimmedLine.match(/^([a-z]{2,3})[:\-]\s*(.*)$/i);
      if (m && opts.targetLanguages.includes(m[1]!.toLowerCase())) {
        translations[m[1]!.toLowerCase()] = m[2]!.trim();
      }
    }
  }

  return { sourceLang, sourceText, translations };
}

export async function translate(
  input: TranslateInput,
  opts: TranslateOptions,
): Promise<TranslateResult> {
  const model = client().getGenerativeModel({ model: config.geminiModel });
  const prompt = buildPrompt(opts, input.kind);

  const parts: any[] =
    input.kind === 'voice'
      ? [
          { text: prompt },
          { inlineData: { mimeType: input.mimeType, data: input.audioBase64 } },
        ]
      : [{ text: `${prompt}\n\nInput text:\n${input.text}` }];

  const resp = await model.generateContent({ contents: [{ role: 'user', parts }] });
  const rendered = resp.response.text();
  const usage = resp.response.usageMetadata;

  // Gemini reports total prompt tokens including audio; output tokens separately.
  // For cost estimation we approximate: audio input → audio rate; text-only → text input rate.
  const inputTokens = usage?.promptTokenCount ?? 0;
  const outputTokens = usage?.candidatesTokenCount ?? 0;

  const costCents =
    input.kind === 'voice'
      ? estimateCostCents({ audioTokens: inputTokens, outputTokens })
      : estimateCostCents({ textInputTokens: inputTokens, outputTokens });

  const parsed = parseRendered(rendered, opts);

  return {
    sourceLang: parsed.sourceLang,
    sourceText: parsed.sourceText,
    translations: parsed.translations,
    rendered,
    tokensIn: inputTokens,
    tokensOut: outputTokens,
    costCents,
  };
}

export function flagFor(lang: string): string {
  return FLAGS[lang] ?? '🏳️';
}
