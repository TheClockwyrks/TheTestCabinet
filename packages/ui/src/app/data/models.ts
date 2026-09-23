import { canonicalModelId } from "../../modelId";
import type {
  Model,
  ModelAlias,
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
  /** The canonical model ids this model claims, each tagged with the harness
   * family it is usable with (seeds the config form and drives run→model matching). */
  aliases: ModelAlias[];
  /** The billed rate: the latest observed per-token price of the official
   * OpenRouter endpoint, refreshed by the backend. Null until observed. */
  prices: ModelPrices | null;
  /** The curated developer list price (per token) a run's comparable cost is
   * computed from, or null while the model has none. */
  listPrice: ModelPrices | null;
  /** The date (`YYYY-MM-DD`) the operator took the list-price figures, or null. */
  listPriceAsOf: string | null;
  /** The observed price history, ascending, consecutive-equal deduped. */
  priceHistory: PriceObservation[];
  /** Maximum context window in tokens, or null. */
  contextLength: number | null;
  /** The developer provider: the OpenRouter provider name of the developer's
   * own endpoint, hand-set or observed, or null when none is known. */
  providerPin: string | null;
  /** Whether `providerPin` is set by hand rather than observed. */
  providerPinSetByHand: boolean;
  /** The native quantization set by hand, or null for the listing's highest. */
  nativeQuantization: string | null;
  /** The price ceiling's input half, USD per million tokens, or null. */
  maxInputPrice: number | null;
  /** The price ceiling's output half, USD per million tokens, or null. */
  maxOutputPrice: number | null;
  /** The providers a gg run of the model never uses. */
  bannedProviders: string[];
  /** The providers accepted despite declaring `unknown` quantization. */
  unknownQuantizationProviders: string[];
  /** Release date as an RFC 3339 UTC timestamp, or null. */
  releasedAt: string | null;
  /** The input modalities the model accepts (`text`, `image`, …), lowercased.
   * Empty means the catalog has not observed a list yet, which is "unknown"
   * rather than "text only". */
  inputModalities: string[];
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
    listPrice: model.listPrice,
    listPriceAsOf: model.listPriceAsOf,
    priceHistory: model.priceHistory,
    contextLength: model.contextLength,
    providerPin: model.providerPin,
    providerPinSetByHand: model.providerPinSetByHand,
    // A snapshot published before the provider policy existed carries none of it.
    nativeQuantization: model.nativeQuantization ?? null,
    maxInputPrice: model.maxInputPrice ?? null,
    maxOutputPrice: model.maxOutputPrice ?? null,
    bannedProviders: model.bannedProviders ?? [],
    unknownQuantizationProviders: model.unknownQuantizationProviders ?? [],
    releasedAt: model.releasedAt,
    inputModalities: model.inputModalities ?? [],
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
      model.aliases.some((a) => canonicalModelId(a.slug) === canonical) ||
      model.modelIds.some(
        (id) => canonicalModelId(id, harnessSlug) === canonical,
      ),
  );
}
