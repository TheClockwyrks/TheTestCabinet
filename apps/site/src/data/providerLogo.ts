// Maps a model's provider to a bundled brand mark in `public/logos/` (sourced
// from svgl.app). The marks are rendered as monochrome neon masks on the model
// cards, matching the cabinet's other glyphs. Providers without a known logo
// return null so the card simply omits the mark.
const LOGOS: Record<string, string> = {
  openai: "/logos/openai.svg",
  anthropic: "/logos/anthropic.svg",
  google: "/logos/google.svg",
  meta: "/logos/meta.svg",
  mistral: "/logos/mistral.svg",
  "mistral ai": "/logos/mistral.svg",
  xai: "/logos/xai.svg",
  deepseek: "/logos/deepseek.svg",
  qwen: "/logos/qwen.svg",
  alibaba: "/logos/qwen.svg",
};

/** The logo path for a provider, or null when none is bundled. */
export function providerLogo(provider: string): string | null {
  return LOGOS[provider.trim().toLowerCase()] ?? null;
}
