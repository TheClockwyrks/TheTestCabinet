// Maps a model's provider to the bar color used in the metrics charts. Each
// value is the provider's recognizable primary brand color, picked to read
// clearly on the dark cabinet background (styles/tokens.css `--tcab-surface`).
//
// Providers whose logos are monochrome black or gray (Anthropic, OpenAI, xAI,
// Moonshot) would vanish on the dark chart, so they use their signature accent
// rather than the literal mark. The chromatic marks (DeepSeek, Google/Gemini,
// Xiaomi, Qwen) use the dominant color straight from the logo. A few Chinese
// providers publish no brand palette; those (MiniMax, Z.ai) are a best-effort
// read of the logo and easy to adjust here. A provider with no mapping at all
// falls back to `UNKNOWN_PROVIDER_COLOR` (a neutral grey) rather than a brand
// hue it hasn't earned.
const COLORS: Record<string, string> = {
  anthropic: "#D97757", // clay/coral brand accent (mark is monochrome)
  openai: "#10A37F", // signature teal-green (mark is monochrome)
  xai: "#E8E8E8", // monochrome mark → near-white on the dark chart
  moonshotai: "#7C5CFF", // Kimi violet accent (mark is black)
  google: "#4285F4", // Google/Gemini blue
  deepseek: "#4D6BFE", // logo blue
  xiaomi: "#FF6900", // Mi orange (MiMo)
  mistral: "#FA520F", // flame orange (from the svgl logo)
  "mistral ai": "#FA520F",
  qwen: "#615CED", // Qwen/Tongyi purple
  alibaba: "#615CED",
  minimax: "#F23F5D", // brand red — best effort
  openrouter: "#94A3B8", // slate brand mark
  "z.ai": "#5C7599", // slate-blue logo — best effort
  zhipu: "#5C7599",
};

/**
 * The bar color for a provider we don't have a brand color for. Neutral grey so
 * an unrecognized provider still reads as a deliberate, muted bar (never the
 * chart accent, which is reserved for the theme).
 */
export const UNKNOWN_PROVIDER_COLOR = "#8A8A99";

/** The bar color for a provider, or null when none is mapped. */
export function providerColor(provider: string): string | null {
  return COLORS[provider.trim().toLowerCase()] ?? null;
}
