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
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenCounts {
    /// Input tokens that were **not** served from the provider's cache.
    pub uncached_input: u64,
    /// Input tokens served from the provider's cache (billed at a lower rate).
    pub cached_input: u64,
    /// Non-reasoning output tokens.
    pub output: u64,
    /// Internal reasoning tokens (billed as output, tracked separately).
    pub reasoning: u64,
}

impl TokenCounts {
    /// Total input tokens across cached and uncached classes.
    pub fn total_input(&self) -> u64 {
        self.uncached_input + self.cached_input
    }

    /// Total output tokens across reasoning and non-reasoning classes.
    pub fn total_output(&self) -> u64 {
        self.output + self.reasoning
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
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cost {
    /// The canonical figure, derived from token classes and OpenRouter's listed
    /// prices. Stable across providers, so it is the value shown on the site.
    pub comparable: f64,
    /// The amount actually charged for the run, recorded for reference.
    pub actual: f64,
}

impl Cost {
    /// Compute the comparable cost from token counts and listed prices.
    ///
    /// Reasoning tokens are priced at the output rate.
    pub fn comparable_from(_counts: &TokenCounts, _prices: &TokenPrices) -> f64 {
        todo!("derive comparable cost from token classes and listed prices")
    }
}

/// The full metrics block recorded in a [`crate::run_record::RunRecord`].
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
