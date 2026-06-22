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
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenPrices {
    /// Price per uncached input token.
    pub uncached_input: f64,
    /// Price per cached input token.
    pub cached_input: f64,
    /// Price per output token (also applied to reasoning tokens).
    pub output: f64,
}

/// Cost of a run, recorded two ways.
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
    /// provider-stable — is used instead.
    pub comparable: f64,
    /// The amount actually charged for the run, recorded for reference. Equal
    /// to the comparable figure unless the harness reports its own exact cost.
    pub actual: f64,
}

impl Cost {
    /// Compute the comparable cost from token counts and listed prices.
    ///
    /// Reasoning tokens are priced at the output rate. An unknown class
    /// (`None`) contributes nothing to the cost: its tokens are either genuinely
    /// absent or already folded into another class that is priced here (for
    /// example a harness that reports reasoning only inside its `output` total).
    pub fn comparable_from(counts: &TokenCounts, prices: &TokenPrices) -> f64 {
        let output = counts.output.unwrap_or(0) + counts.reasoning.unwrap_or(0);
        counts.uncached_input.unwrap_or(0) as f64 * prices.uncached_input
            + counts.cached_input.unwrap_or(0) as f64 * prices.cached_input
            + output as f64 * prices.output
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
