//! Run metrics: normalized token classes, cost, and run time.
//!
//! See `docs/metrics.md`. The Test Cabinet does not reduce a run to a single
//! score; these values describe the resources a run consumed.

use serde::{Deserialize, Serialize};

/// The four normalized token classes recorded for every run.
///
/// The [`crate::harness`] layer is responsible for translating each harness's
/// raw reporting into these classes. In particular:
///
/// - cached reads must be subtracted from input so [`Self::uncached_input`]
///   excludes them, and
/// - reasoning tokens must be subtracted from output so [`Self::output`]
///   excludes them.
///
/// Each class is optional: `None` means the harness does **not** report that
/// class at all (the value could not be determined), which is distinct from
/// `Some(0)` (the harness reports the class and it was zero). Keeping the two
/// apart matters for any consumer that aggregates across classes — a total that
/// folds in an unknown class would be misleading, so such totals are themselves
/// reported as unknown rather than silently treating the gap as zero.
#[cfg_attr(
    feature = "contract",
    derive(ts_rs::TS, schemars::JsonSchema),
    ts(rename = "TokenMetrics"),
    schemars(rename = "TokenMetrics")
)]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenCounts {
    /// Input tokens that were **not** served from the provider's cache, or `None`
    /// when the harness does not report input usage.
    pub uncached_input: Option<u64>,
    /// Input tokens served from the provider's cache (billed at a lower rate), or
    /// `None` when the harness does not break cached reads out.
    pub cached_input: Option<u64>,
    /// Non-reasoning output tokens, or `None` when the harness does not report
    /// output usage.
    pub output: Option<u64>,
    /// Internal reasoning tokens (billed as output, tracked separately), or `None`
    /// when the harness does not break reasoning out — note that a harness which
    /// folds reasoning into `output` reports `None` here, not `Some(0)`.
    pub reasoning: Option<u64>,
}

impl TokenCounts {
    /// Total input tokens across the cached and uncached classes. An unreported
    /// class (`None`) counts as zero rather than poisoning the total, because a
    /// harness that does not break the split out still folds those tokens into the
    /// class it *does* report (a cache-unaware harness reports all input as
    /// uncached). The total is therefore only `None` when **neither** input class
    /// is reported — a run with no input usage at all.
    pub fn total_input(&self) -> Option<u64> {
        sum_reported(self.uncached_input, self.cached_input)
    }

    /// Total output tokens across the reasoning and non-reasoning classes, on the
    /// same terms as [`Self::total_input`]: an unreported reasoning class folds
    /// into the reported `output` total, so it counts as zero and the total stays
    /// meaningful; `None` only when neither output class is reported.
    pub fn total_output(&self) -> Option<u64> {
        sum_reported(self.output, self.reasoning)
    }

    /// The headline token figure: the sum across every class (input + output).
    /// Mirrors the UI's `totalTokens(metrics)` — an unreported class folds into
    /// the class it is accounted under, so it counts as zero, and the total is
    /// `None` only when **no** class is reported at all (a run with no token usage
    /// recorded). Used by the lifted `run.total_tokens` sort column.
    pub fn total(&self) -> Option<u64> {
        sum_reported(self.total_input(), self.total_output())
    }
}

/// Sum two optional token counts, treating an unreported (`None`) class as zero,
/// but returning `None` when **both** are unreported so a genuinely empty total
/// stays distinguishable from a real zero.
fn sum_reported(a: Option<u64>, b: Option<u64>) -> Option<u64> {
    match (a, b) {
        (None, None) => None,
        (a, b) => Some(a.unwrap_or(0) + b.unwrap_or(0)),
    }
}

/// Per-token prices (USD) used to compute the comparable cost.
///
/// These come from the prices OpenRouter lists for the model used. Reasoning
/// tokens are priced at the output rate, so no separate field is needed.
///
/// Each price is optional: `None` means the price is **unknown** (OpenRouter
/// does not list one, or lists a nonsensical value such as a negative sentinel),
/// which is distinct from `Some(0.0)` (a genuinely free class). A class priced
/// `None` poisons any cost it contributes to rather than being silently treated
/// as free — see [`Cost::comparable_from`].
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenPrices {
    /// Price per uncached input token, or `None` when unknown.
    pub uncached_input: Option<f64>,
    /// Price per cached input token, or `None` when unknown.
    pub cached_input: Option<f64>,
    /// Price per output token (also applied to reasoning tokens), or `None` when
    /// unknown.
    pub output: Option<f64>,
}

/// Cost of a run, recorded two ways.
///
/// Each figure is optional: `None` means the cost is **unknown** — typically
/// because the model's per-token prices could not be resolved (the model is
/// absent from OpenRouter's catalog, or OpenRouter lists a nonsensical price).
/// This is distinct from `Some(0.0)`, a genuinely free run. Keeping the two
/// apart avoids presenting an unknown cost as `$0.00`.
#[cfg_attr(
    feature = "contract",
    derive(ts_rs::TS, schemars::JsonSchema),
    ts(rename = "CostMetrics"),
    schemars(rename = "CostMetrics")
)]
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cost {
    /// The canonical figure shown on the site, stable across providers. It is
    /// derived from token classes and OpenRouter's listed prices, except for
    /// harnesses that drive a single provider directly and report their own
    /// exact cost (such as Claude Code), where that reported cost — itself
    /// provider-stable — is used instead. `None` when the cost is unknown.
    pub comparable: Option<f64>,
    /// The amount actually charged for the run, recorded for reference. Equal
    /// to the comparable figure unless the harness reports its own exact cost.
    /// `None` when the cost is unknown.
    pub actual: Option<f64>,
}

impl Cost {
    /// Compute the comparable cost from token counts and listed prices, or
    /// `None` when the cost cannot be determined.
    ///
    /// Reasoning tokens are priced at the output rate. An unknown token class
    /// (`None`) contributes nothing to the cost: its tokens are either genuinely
    /// absent or already folded into another class that is priced here (for
    /// example a harness that reports reasoning only inside its `output` total).
    /// An **unknown price** (`None`), on the other hand, poisons the total: if a
    /// class carries tokens but its per-token price is unknown, the whole cost is
    /// unknown rather than under-counted. A class with zero tokens needs no
    /// price.
    pub fn comparable_from(counts: &TokenCounts, prices: &TokenPrices) -> Option<f64> {
        // A priced class contributes `tokens * price`; zero tokens contribute
        // nothing regardless of price, but a nonzero count with an unknown price
        // makes the whole total unknown.
        let part = |tokens: u64, price: Option<f64>| -> Option<f64> {
            if tokens == 0 {
                Some(0.0)
            } else {
                price.map(|price| tokens as f64 * price)
            }
        };
        let uncached_input = part(counts.uncached_input.unwrap_or(0), prices.uncached_input)?;
        let cached_input = part(counts.cached_input.unwrap_or(0), prices.cached_input)?;
        let output_tokens = counts.output.unwrap_or(0) + counts.reasoning.unwrap_or(0);
        let output = part(output_tokens, prices.output)?;
        Some(uncached_input + cached_input + output)
    }
}

/// The full metrics block recorded in a [`crate::run_record::RunRecord`].
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunMetrics {
    /// End-to-end wall-clock time of the run, in seconds.
    pub run_time_seconds: f64,
    /// Normalized token usage.
    pub tokens: TokenCounts,
    /// Cost, recorded as comparable and actual.
    pub cost: Cost,
}
