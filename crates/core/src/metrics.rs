//! Run metrics: normalized token classes, cost, and the run's stage durations.
//!
//! See `docs/metrics.md`. The Test Cabinet does not reduce a run to a single
//! score; these values describe the resources a run consumed.

use std::time::Duration;

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

    /// Sum two token accountings class by class, treating an unreported (`None`)
    /// class as zero but keeping a class `None` when **neither** side reports it —
    /// exactly `sum_reported`'s rule, applied per class. This is how a session's
    /// incremental usage deltas (an orchestrator's per-session usage, or a
    /// [gg](crate::gg) run's per-turn `usage` telemetry events, which are deltas
    /// consumers sum) are accumulated into one total without a genuinely-empty
    /// class ever being reported as a misleading zero.
    #[must_use]
    pub fn plus(self, other: TokenCounts) -> TokenCounts {
        TokenCounts {
            uncached_input: sum_reported(self.uncached_input, other.uncached_input),
            cached_input: sum_reported(self.cached_input, other.cached_input),
            output: sum_reported(self.output, other.output),
            reasoning: sum_reported(self.reasoning, other.reasoning),
        }
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
/// These are the model developer's published list prices, curated on the
/// model's catalog entry — not the billed rate of whichever endpoint served the
/// run. Reasoning tokens are priced at the output rate, so no separate field is
/// needed.
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
/// because the model's per-token list prices could not be resolved (the model's
/// catalog entry curates none). This is distinct from `Some(0.0)`, a genuinely
/// free run. Keeping the two apart avoids presenting an unknown cost as `$0.00`.
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
    /// computed from the run's token classes and the model's curated list
    /// price, and from nothing else: a billed figure never feeds it, so two
    /// runs of one model at different billed rates still compare on the same
    /// basis. `None` when the cost is unknown.
    pub comparable: Option<f64>,
    /// The amount the run was actually billed, recorded for reference: the
    /// harness's own accounting where it reports one, otherwise the comparable
    /// figure. `None` when the cost is unknown.
    pub actual: Option<f64>,
}

impl Cost {
    /// Compute the comparable cost from token counts and the model's curated
    /// list prices, or `None` when the cost cannot be determined.
    ///
    /// Reasoning tokens are priced at the output rate. An unknown token class
    /// (`None`) contributes nothing to the cost: its tokens are either genuinely
    /// absent or already folded into another class that is priced here (for
    /// example a harness that reports reasoning only inside its `output` total).
    /// An **unknown price** (`None`), on the other hand, poisons the total: if a
    /// class carries tokens but its per-token price is unknown, the whole cost is
    /// unknown rather than under-counted. A class with zero tokens needs no
    /// price.
    ///
    /// Counts with **no** class reported at all ([`TokenCounts::total`] is `None`)
    /// give an unknown cost, not `$0.00`. Treating every class's "not reported" as
    /// "zero tokens, and so zero cost" would price a run whose usage never reached
    /// us as confidently free — the exact conflation the optional classes exist to
    /// prevent.
    pub fn comparable_from(counts: &TokenCounts, prices: &TokenPrices) -> Option<f64> {
        counts.total()?;
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
    /// End-to-end wall-clock time of the whole run, in seconds, excluding any
    /// time the run's container spent queued for cluster capacity before it
    /// started.
    ///
    /// This is what the run cost in machine time. It is the sum of
    /// [`Self::setup_seconds`], [`Self::session_seconds`] and
    /// [`Self::teardown_seconds`], and a question about the model is answered by
    /// the session alone: setup is shared by every run of a test case and
    /// dominates this figure whenever the session is short.
    pub run_time_seconds: f64,
    /// Wall-clock time of the harness session alone, in seconds — the model's own
    /// working time, and the figure that describes a model.
    ///
    /// `None` on a record written before the stage durations were measured, which
    /// is distinct from `Some(0.0)`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub session_seconds: Option<f64>,
    /// Wall-clock time from the start of the run until the harness session began,
    /// in seconds: rendering the case's references, seeding the workspace,
    /// starting the container, probing its environment, installing the harness,
    /// and running the test case's `init` step.
    ///
    /// The queueing wait excluded from [`Self::run_time_seconds`] is subtracted
    /// here, the stage that contains it. `None` on a record written before the
    /// stage durations were measured.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub setup_seconds: Option<f64>,
    /// Wall-clock time spent collecting the produced tree and stopping the
    /// container, in seconds.
    ///
    /// Taken as the remainder of [`Self::run_time_seconds`], so the three stages
    /// sum to it exactly. `None` on a record written before the stage durations
    /// were measured.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub teardown_seconds: Option<f64>,
    /// Wall-clock time of the [validation](crate::validation) pass, in seconds.
    ///
    /// Recorded outside [`Self::run_time_seconds`], which is frozen before
    /// validation and before every [post-run stage](crate::post_run) runs. `None`
    /// on a canceled run, which skips validation, and on a record written before
    /// the stage durations were measured.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub validation_seconds: Option<f64>,
    /// Normalized token usage.
    pub tokens: TokenCounts,
    /// Cost, recorded as comparable and actual.
    pub cost: Cost,
}

/// The wall-clock durations measured across one run's lifecycle, partitioned so
/// the stages sum to the run's measured duration exactly.
///
/// Built once by the run engine and handed to
/// [`RunEngine::collect_metrics`](crate::RunEngine::collect_metrics), which is the
/// only thing that writes the duration fields of [`RunMetrics`].
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct RunDurations {
    /// The whole run, queueing wait already excluded.
    pub run_time_seconds: f64,
    /// Everything before the harness session began.
    pub setup_seconds: f64,
    /// The harness session alone.
    pub session_seconds: f64,
    /// Tree collection and container stop, the remainder of the run.
    pub teardown_seconds: f64,
    /// The validation pass, which sits outside the run's measured duration.
    /// `None` for a run that skipped validation.
    pub validation_seconds: Option<f64>,
}

impl RunDurations {
    /// Partition a run's measured wall clock into its lifecycle stages.
    ///
    /// `elapsed` is the run timer read once teardown is complete and
    /// `before_teardown` the same timer read the instant the harness session
    /// ended; both still carry `scheduling_wait`, the time the run's container
    /// spent queued for capacity, which is subtracted from the run's measured
    /// duration and from the setup stage that contains it. `session` is the
    /// session's own elapsed time, measured around the capped drive itself.
    ///
    /// Teardown is taken as the remainder rather than measured, so setup, session
    /// and teardown sum to [`Self::run_time_seconds`] exactly however the timers
    /// were read. Each stage is clamped into what remains of the run so the
    /// partition holds even for durations that could not have been produced by a
    /// real run.
    pub fn partition(
        elapsed: Duration,
        before_teardown: Duration,
        session: Duration,
        scheduling_wait: Duration,
        validation: Option<Duration>,
    ) -> Self {
        let run_time_seconds = elapsed.saturating_sub(scheduling_wait).as_secs_f64();
        let setup_seconds = (before_teardown
            .saturating_sub(scheduling_wait)
            .as_secs_f64()
            - session.as_secs_f64())
        .clamp(0.0, run_time_seconds);
        let session_seconds = session
            .as_secs_f64()
            .clamp(0.0, run_time_seconds - setup_seconds);
        RunDurations {
            run_time_seconds,
            setup_seconds,
            session_seconds,
            teardown_seconds: run_time_seconds - setup_seconds - session_seconds,
            validation_seconds: validation.map(|validation| validation.as_secs_f64()),
        }
    }
}

#[cfg(test)]
#[path = "metrics.test.rs"]
mod tests;
