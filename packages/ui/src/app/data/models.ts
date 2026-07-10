import { canonicalModelId } from "../../modelId";
import type {
  Model,
  ModelPrices,
  PriceObservation,
} from "../../client/types";

// The model catalog the Models section renders. It is no longer a bundled static
// dataset: the console fetches it from the backend (`GET /models`) and the static
// site reads it from the build-time snapshot, both as the wire `Model` shape,
// which is mapped to the display `ModelSummary` below. Any model with at least one
// recorded run appears — curated or not.

export type { ModelPrices, PriceObservation };

/** One model resolved for display in the Models section. */
export interface ModelSummary {
  /** Curated slug, or the canonical model id for a derived model. */
  slug: string;
  /** Display name (a derived model uses its canonical id). */
  name: string;
  /** Provider (guessed from the id for a derived model). */
  provider: string;
  /** Whether the model has curated config, versus being derived from runs alone. */
  isConfigured: boolean;
  /** `https://openrouter.ai/<slug>` when on OpenRouter, else null. */
  openrouterUrl: string | null;
  /** Curated description markdown, or null. */
  description: string | null;
  /** Curated, sanitized provider-logo SVG, or null. */
  logoSvg: string | null;
  /** The run-record `modelId`s this model covers (what a run matches on). */
  modelIds: string[];
  /** The canonical model ids this model claims (seeds the config form). */
  aliases: string[];
  /** The latest observed comparable per-token prices, or null. */
  prices: ModelPrices | null;
  /** The observed price history, ascending, consecutive-equal deduped. */
  priceHistory: PriceObservation[];
  /** Maximum context window in tokens, or null. */
  contextLength: number | null;
  /** Release date as an RFC 3339 UTC timestamp, or null. */
  releasedAt: string | null;
}

/** Map a wire `Model` (from the backend or the snapshot) to a display summary. */
export function toModelSummary(model: Model): ModelSummary {
  return {
    slug: model.slug,
    name: model.name,
    provider: model.provider,
    isConfigured: model.curated,
    openrouterUrl: model.openrouterUrl,
    description: model.description,
    logoSvg: model.logoSvg,
    modelIds: model.coveredModelIds,
    aliases: model.aliases,
    prices: model.price,
    priceHistory: model.priceHistory,
    contextLength: model.contextLength,
    releasedAt: model.releasedAt,
  };
}

// Maps a run record's `modelId` to its catalog entry. The backend already records
// the raw `modelId`s a model covers, so an exact membership check resolves most
// runs directly; canonicalization (harness-aware when the harness is known) is the
// fallback so a prefixed or `:free`-tagged id still resolves to the base model.
// Returns undefined for ids not in the catalog.
export function findModelByModelId(
  models: ModelSummary[],
  modelId: string,
  harnessSlug?: string,
): ModelSummary | undefined {
  const exact = models.find((model) => model.modelIds.includes(modelId));
  if (exact) return exact;
  const canonical = canonicalModelId(modelId, harnessSlug);
  return models.find(
    (model) =>
      model.aliases.some((id) => canonicalModelId(id) === canonical) ||
      model.modelIds.some(
        (id) => canonicalModelId(id, harnessSlug) === canonical,
      ),
  );
}
