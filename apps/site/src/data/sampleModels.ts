import type { ModelSummary } from "./models";

// Design-preview seed data for the model catalog. Fabricated entries used ONLY
// so the Models section renders realistic content while `models.json` is still
// sample-quality / empty. They match the shape `tcab catalog` emits.
// `useModels` falls back to these only when the real dataset is empty; remove
// this module once the catalog is populated.
export const sampleModels: ModelSummary[] = [
  {
    slug: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    provider: "Anthropic",
    openrouterUrl: "https://openrouter.ai/anthropic/claude-haiku-4.5",
    description:
      "# Claude Haiku 4.5\n\n**Claude Haiku 4.5** is Anthropic's fast, economical model in the Claude 4.5 family — built for low latency while remaining a genuinely capable coding model.\n",
    modelIds: ["claude-haiku-4-5"],
    prices: { uncachedInput: 1e-6, cachedInput: 1e-7, output: 5e-6 },
  },
  {
    slug: "gpt-5.4-mini",
    name: "GPT-5.4 mini",
    provider: "OpenAI",
    openrouterUrl: "https://openrouter.ai/openai/gpt-5.4-mini",
    description:
      "# GPT-5.4 mini\n\n**GPT-5.4 mini** is OpenAI's small, fast member of the GPT-5.4 family — cheap and quick enough to run at scale while holding up on real coding work.\n",
    modelIds: ["gpt-5.4-mini"],
    prices: { uncachedInput: 7.5e-7, cachedInput: 7.5e-8, output: 4.5e-6 },
  },
];
