import { canonicalModelId } from "../../modelId";
import modelsData from "./models.json";

// The published model catalog dataset. `tcab catalog` regenerates `models.json`
// from the models/ folder, resolving OpenRouter prices when a model declares an
// openrouter slug. Every host renders whatever is present; an unpopulated
// dataset simply renders the empty state.

/** Per-token USD prices resolved from OpenRouter, when available. */
export interface ModelPrices {
  /** USD per uncached input token, or null when OpenRouter lists no price. */
  uncachedInput: number | null;
  /** USD per cached input token, or null when OpenRouter lists no price. */
  cachedInput: number | null;
  /** USD per output token, or null when OpenRouter lists no price. */
  output: number | null;
}

/** One curated model in the catalog. */
export interface ModelSummary {
  slug: string;
  name: string;
  provider: string;
  /** `https://openrouter.ai/<slug>` when the model declares one, else null. */
  openrouterUrl: string | null;
  /** Inlined site-facing Markdown from the model's description file, or null. */
  description: string | null;
  /** The `modelId` strings (as they appear in run records) this model covers. */
  modelIds: string[];
  /** Resolved OpenRouter per-token prices, or null when unavailable. */
  prices: ModelPrices | null;
  /** Maximum context window in tokens from OpenRouter, or null when unavailable. */
  contextLength: number | null;
  /** Release date as an RFC 3339 UTC timestamp from OpenRouter, or null. */
  releasedAt: string | null;
}

export const models: ModelSummary[] = modelsData as ModelSummary[];

// Maps a run record's `modelId` to its catalog entry. A model may cover several
// ids, so this scans `modelIds`. Both sides are canonicalized so an
// `openrouter/`-prefixed id resolves to the same entry as its bare form, even
// when the catalog only declares one of them. Returns undefined for ids not in
// the catalog.
export function findModelByModelId(modelId: string): ModelSummary | undefined {
  const canonical = canonicalModelId(modelId);
  return models.find((model) =>
    model.modelIds.some((id) => canonicalModelId(id) === canonical),
  );
}
