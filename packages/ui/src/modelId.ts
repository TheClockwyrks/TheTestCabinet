// Model-id canonicalization: how a run record's `subject.modelId` is normalized
// before it is displayed, grouped, or matched against the catalog.
//
// A few harnesses route through OpenRouter and report the model with an
// `openrouter/` provider prefix — OpenCode and Kilo Code report
// `openrouter/anthropic/claude-opus-4.8` for what every other source calls
// `anthropic/claude-opus-4.8`. That prefix is a routing artifact, not part of
// the model's identity, so we strip it wherever model data is processed. This
// keeps charts from showing `openrouter/...` and collapses the prefixed and
// bare ids onto a single model rather than two lookalikes.

/** The provider-routing prefix OpenCode / Kilo Code prepend to OpenRouter ids. */
const OPENROUTER_PREFIX = "openrouter/";

/**
 * The canonical form of a run's model id, with the `openrouter/` routing prefix
 * removed. Any other id is returned unchanged, so this is safe to apply to every
 * model id — those without the prefix are untouched.
 */
export function canonicalModelId(modelId: string): string {
  return modelId.startsWith(OPENROUTER_PREFIX)
    ? modelId.slice(OPENROUTER_PREFIX.length)
    : modelId;
}
