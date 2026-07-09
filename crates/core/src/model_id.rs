//! Model-id canonicalization and the OpenRouter price-lookup mapping.
//!
//! A run record carries `subject.model_id` as an opaque string exactly as the
//! harness reported it. The same underlying model can appear under several such
//! strings depending on the harness:
//!
//! - a few harnesses route through OpenRouter and prepend an `openrouter/`
//!   provider prefix (OpenCode and Kilo Code report
//!   `openrouter/anthropic/claude-opus-4.8` for what every other source calls
//!   `anthropic/claude-opus-4.8`); and
//! - an OpenRouter-accessed model can carry a trailing variant tag such as
//!   `:free` (`deepseek/deepseek-v4:free`), which selects a differently-priced
//!   route to the *same* model — it must not split the model in two or make it
//!   look free.
//!
//! [`canonical_model_id`] collapses those forms to one identity string used to
//! group runs, key a model's price history, and match a run against the catalog.
//! [`openrouter_price_id`] maps a run's model id onto the exact id OpenRouter
//! lists it under, for the comparable-cost lookup. Both are harness-aware, and
//! this module is the single source of truth for that logic (mirrored, for
//! display-time grouping only, by `packages/ui/src/modelId.ts`).

use crate::run_record::HarnessSlug;

/// The provider-routing prefix OpenCode / Kilo Code prepend to OpenRouter ids.
const OPENROUTER_PREFIX: &str = "openrouter/";

/// The `openai/` provider prefix Codex's provider-native ids map onto in the
/// OpenRouter catalog (Codex reports a bare `gpt-5.5`; OpenRouter lists it as
/// `openai/gpt-5.5`).
const OPENAI_PREFIX: &str = "openai/";

/// The canonical identity of a run's model, independent of how the harness
/// reported it.
///
/// - The leading `openrouter/` routing prefix is always stripped: only OpenCode
///   and Kilo Code emit it, so stripping unconditionally is safe and collapses
///   the prefixed and bare forms onto one model.
/// - A trailing `:tag` (for example `:free`) is stripped **only** for harnesses
///   that route through OpenRouter (all except Codex, Claude, and Antigravity):
///   the tag selects a pricing route, not a different model. Provider-native
///   harnesses never carry such a tag, so their ids are left untouched.
pub fn canonical_model_id(model_id: &str, harness: HarnessSlug) -> String {
    let base = model_id.strip_prefix(OPENROUTER_PREFIX).unwrap_or(model_id);
    if harness.routes_through_openrouter()
        && let Some((head, _tag)) = base.rsplit_once(':')
    {
        return head.to_string();
    }
    base.to_string()
}

/// The exact id to query OpenRouter with for a run's comparable price.
///
/// This is the canonical id (see [`canonical_model_id`]) with one provider-prefix
/// adjustment: Codex reports OpenAI-native ids (`gpt-5.5`) that OpenRouter lists
/// under an `openai/` prefix. Every other harness already canonicalizes to the
/// OpenRouter slug. A lookup that finds no match simply yields an unknown price;
/// callers never treat a missing entry as free.
pub fn openrouter_price_id(model_id: &str, harness: HarnessSlug) -> String {
    let canonical = canonical_model_id(model_id, harness);
    match harness {
        HarnessSlug::Codex if !canonical.starts_with(OPENAI_PREFIX) => {
            format!("{OPENAI_PREFIX}{canonical}")
        }
        _ => canonical,
    }
}

#[cfg(test)]
#[path = "model_id.test.rs"]
mod tests;
