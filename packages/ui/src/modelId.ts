// Model-id canonicalization: how a run record's `subject.modelId` is normalized
// before it is displayed, grouped, or matched against the catalog. Mirrors the
// authoritative Rust logic in `crates/core/src/model_id.rs`.
//
// A few harnesses route through OpenRouter and report the model with an
// `openrouter/` provider prefix — OpenCode and Kilo Code report
// `openrouter/anthropic/claude-opus-4.8` for what every other source calls
// `anthropic/claude-opus-4.8`. Those same OpenRouter-accessed harnesses can also
// carry a trailing variant tag such as `:free`, which selects a differently-priced
// route to the *same* model. Both are routing artifacts, not part of the model's
// identity, so we strip them: the prefix always, the trailing tag only for
// harnesses that route through OpenRouter.

/** The provider-routing prefix OpenCode / Kilo Code prepend to OpenRouter ids. */
export const OPENROUTER_PREFIX = "openrouter/";

/** The harnesses that reach their model *directly* (not through OpenRouter), so a
 * trailing `:tag` is part of the id rather than an OpenRouter variant to strip. */
const NATIVE_HARNESSES = new Set(["codex", "claude", "antigravity"]);

/**
 * The canonical form of a run's model id, with the `openrouter/` routing prefix
 * removed and — when `harnessSlug` is given and routes through OpenRouter — a
 * trailing `:tag` (e.g. `:free`) removed. Any other id is returned unchanged, so
 * this is safe to apply to every model id. Without a harness the tag is left in
 * place (the caller lacks the context to know whether it is an OpenRouter variant);
 * pass `subject.harnessSlug` when matching a run.
 */
export function canonicalModelId(
  modelId: string,
  harnessSlug?: string,
): string {
  const base = modelId.startsWith(OPENROUTER_PREFIX)
    ? modelId.slice(OPENROUTER_PREFIX.length)
    : modelId;
  if (harnessSlug !== undefined && !NATIVE_HARNESSES.has(harnessSlug)) {
    const colon = base.lastIndexOf(":");
    if (colon > 0) return base.slice(0, colon);
  }
  return base;
}
