// Gemini 2.5 Flash pricing (as of plan date). Adjust if Google changes rates.
// Audio input: $0.075 per 1M tokens
// Text input:  $0.30  per 1M tokens
// Text output: $2.50  per 1M tokens
// Numbers below are dollars per token; convert to cents at the boundary.

const USD_PER_AUDIO_TOKEN = 0.075 / 1_000_000;
const USD_PER_TEXT_INPUT_TOKEN = 0.30 / 1_000_000;
const USD_PER_TEXT_OUTPUT_TOKEN = 2.50 / 1_000_000;

export function estimateCostCents(args: {
  audioTokens?: number;
  textInputTokens?: number;
  outputTokens?: number;
}): number {
  const usd =
    (args.audioTokens ?? 0) * USD_PER_AUDIO_TOKEN +
    (args.textInputTokens ?? 0) * USD_PER_TEXT_INPUT_TOKEN +
    (args.outputTokens ?? 0) * USD_PER_TEXT_OUTPUT_TOKEN;
  return usd * 100;
}
