// Model providers for the run form. A "provider" selects *how* a harness reaches
// the chosen model. It matters only for the harnesses that pass the model id
// verbatim to a CLI that routes through an aggregator: OpenCode and Kilo Code reach
// their model *through OpenRouter*, so the id they launch with must carry the
// `openrouter/` prefix. Every other harness is either native (codex/claude/
// antigravity) or passes a separate provider flag internally (cline/goose/pi), so
// it takes no provider here and its model id is launched unprefixed.
//
// Provider is modeled as a value (default "openrouter") so more routes can be added
// later; today OpenRouter is the only option offered.

import { OPENROUTER_PREFIX } from "../../modelId";

/** The default (and, today, only) provider. */
export const OPENROUTER_PROVIDER = "openrouter";

/** One provider option offered in the run form's Provider dropdown. */
export interface ProviderOption {
  /** The stable value stored on a combination and used by {@link resolveLaunchModel}. */
  id: string;
  /** The human-facing label shown in the dropdown. */
  displayName: string;
}

/** Every provider the form offers, in display order. */
export const PROVIDERS: ProviderOption[] = [
  { id: OPENROUTER_PROVIDER, displayName: "OpenRouter" },
];

/** The harnesses whose model id routes through a provider (so a Provider dropdown
 * is shown and its prefix applied). Native and internal-provider harnesses aren't
 * listed — their model id is launched verbatim. */
const PROVIDER_HARNESSES = new Set(["opencode", "kilo"]);

/** Whether the given harness takes a provider (and thus shows the dropdown). */
export function harnessUsesProvider(harness: string): boolean {
  return PROVIDER_HARNESSES.has(harness);
}

/**
 * The model id to actually launch with, given the selected harness and provider.
 * For a provider-routed harness (OpenCode / Kilo Code) with the OpenRouter provider
 * in effect, the canonical, unprefixed id the user picked is given the `openrouter/`
 * prefix — unless they already typed it, so it never double-prefixes. Every other
 * case returns the id unchanged. Pure and reusable, so the batch form can resolve
 * each combination row's model at launch.
 */
export function resolveLaunchModel(
  harness: string,
  provider: string,
  modelId: string,
): string {
  if (harnessUsesProvider(harness) && provider === OPENROUTER_PROVIDER) {
    return modelId.startsWith(OPENROUTER_PREFIX)
      ? modelId
      : OPENROUTER_PREFIX + modelId;
  }
  return modelId;
}
