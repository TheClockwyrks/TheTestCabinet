//! Descriptive statistics for harness comparisons: honest summaries of an arm's
//! `N` runs.
//!
//! The governing rule (see `docs/comparisons/statistics.md`) is: **present the
//! distribution and its sample size; never emit a verdict.** Nothing here computes
//! "significance", crowns a winner, or returns a p-value. Every summary carries its
//! `n` and its spread, and the reader draws the conclusion.
//!
//! The metrics have different shapes and each gets the summary that does not lie
//! about it:
//! - **Cost and tokens are right-skewed** — a floor with a long upper tail. They
//!   are summarized with the [`MetricSummary`] (median + IQR + min/max, alongside
//!   the mean, because the gap between mean and median is itself informative), with
//!   a bootstrap confidence interval on the median that makes no normality
//!   assumption and stays honest at small `n`.
//! - **Pass rate is a proportion** — summarized with a [`PassRate`] carrying a
//!   Wilson score interval, not a normal one.
//!
//! Everything is **deterministic** for a given input: the bootstrap draws from a
//! seeded SplitMix64 PRNG (the caller seeds it from the arm's sorted run ids),
//! so a published comparison renders identically every time and a re-computation
//! never silently shifts the numbers. There is no use of wall-clock time or a
//! thread RNG anywhere in this module.

use serde::{Deserialize, Serialize};

/// The number of bootstrap resamples used for a confidence interval. Large enough
/// that the interval is stable to three significant figures for the small `n` a
/// comparison arm carries, small enough to stay cheap.
const BOOTSTRAP_ITERS: usize = 10_000;

/// The two-sided coverage removed by the confidence interval — a 95% interval
/// takes the 2.5th and 97.5th percentiles of the bootstrap distribution.
const CI_ALPHA: f64 = 0.05;

/// The standard-normal quantile for a 95% Wilson interval (z at the 97.5th
/// percentile).
const WILSON_Z: f64 = 1.959_963_984_540_054;

/// A descriptive summary of one numeric metric (comparable cost, total tokens)
/// over an arm's `N` runs.
///
/// The bar a view draws is the [`median`](Self::median) — the honest "typical"
/// run for a skewed metric — but the summary carries the full spread so the view
/// can show the raw shape: the [quartiles](Self::q1) for a box, the
/// [extremes](Self::min) for whiskers, the [`mean`](Self::mean) (which sits above
/// the median for a right-skewed metric — that gap is informative, not redundant),
/// and a bootstrap [confidence interval](Self::ci_low) on the median that widens
/// honestly as `n` shrinks.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct MetricSummary {
    /// The number of runs summarized (always shown; never implied).
    pub n: usize,
    /// The median — the value a view plots for the arm.
    pub median: f64,
    /// The arithmetic mean, shown alongside the median (their gap reveals skew).
    pub mean: f64,
    /// The smallest observed value.
    pub min: f64,
    /// The largest observed value.
    pub max: f64,
    /// The first quartile (25th percentile), the box's lower edge.
    pub q1: f64,
    /// The third quartile (75th percentile), the box's upper edge.
    pub q3: f64,
    /// The interquartile range, `q3 - q1`.
    pub iqr: f64,
    /// The lower bound of the bootstrap confidence interval on the median.
    pub ci_low: f64,
    /// The upper bound of the bootstrap confidence interval on the median.
    pub ci_high: f64,
}

impl MetricSummary {
    /// Summarize `samples`, seeding the bootstrap from `seed` (a stable hash of the
    /// arm's sorted run ids). Returns `None` for an empty sample — an arm with no
    /// runs has nothing to summarize, and the caller shows "no runs" rather than a
    /// fabricated zero.
    ///
    /// With a single run the distribution collapses to a point: every field equals
    /// that value and the interval has zero width, which is the correct answer —
    /// one observation carries no spread to report.
    pub fn compute(samples: &[f64], seed: u64) -> Option<Self> {
        if samples.is_empty() {
            return None;
        }
        let mut sorted = samples.to_vec();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let q1 = quantile(&sorted, 0.25);
        let q3 = quantile(&sorted, 0.75);
        let (ci_low, ci_high) = bootstrap_median_ci(&sorted, seed);
        Some(MetricSummary {
            n: sorted.len(),
            median: quantile(&sorted, 0.5),
            mean: sorted.iter().sum::<f64>() / sorted.len() as f64,
            min: sorted[0],
            max: sorted[sorted.len() - 1],
            q1,
            q3,
            iqr: q3 - q1,
            ci_low,
            ci_high,
        })
    }
}

/// An arm's pass rate — the proportion of its runs whose automated validators all
/// passed — with a **Wilson score interval** rather than a normal one, because a
/// plain average understates the uncertainty of a small sample.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PassRate {
    /// The number of runs (the denominator).
    pub n: u64,
    /// How many of them passed.
    pub passed: u64,
    /// The observed proportion, `passed / n`.
    pub rate: f64,
    /// The lower bound of the 95% Wilson score interval.
    pub wilson_low: f64,
    /// The upper bound of the 95% Wilson score interval.
    pub wilson_high: f64,
}

impl PassRate {
    /// The pass rate of `passed` out of `n` runs, with its Wilson interval. Returns
    /// `None` for `n == 0` (no runs, no rate to report).
    pub fn compute(passed: u64, n: u64) -> Option<Self> {
        if n == 0 {
            return None;
        }
        let (wilson_low, wilson_high) = wilson_interval(passed, n, WILSON_Z);
        Some(PassRate {
            n,
            passed,
            rate: passed as f64 / n as f64,
            wilson_low,
            wilson_high,
        })
    }
}

/// The effect size between two arms as a **ratio** of their medians — "Kilo's
/// median cost is 6.8× Pi's". A presented number, not a verdict. `None` when the
/// denominator median is zero (no meaningful ratio) or either arm is absent.
pub fn median_ratio(
    numerator: Option<&MetricSummary>,
    denominator: Option<&MetricSummary>,
) -> Option<f64> {
    let num = numerator?;
    let den = denominator?;
    if den.median == 0.0 {
        return None;
    }
    Some(num.median / den.median)
}

/// The `q`-quantile of an already-sorted, non-empty slice, by linear interpolation
/// between the two closest ranks (the "type 7" definition R and NumPy use by
/// default). `q` is clamped to `[0, 1]`.
///
/// Public because it is **the repository's one quantile definition**: the
/// [gg query language](crate::gg_query)'s `median`/`p90`/`p95`/`dist` reuse it
/// verbatim rather than reinventing one, so a gg box plot and a comparison chart
/// cannot report different medians for the same numbers. A second definition anywhere
/// is a defect, not a preference.
pub fn quantile(sorted: &[f64], q: f64) -> f64 {
    debug_assert!(!sorted.is_empty());
    let n = sorted.len();
    if n == 1 {
        return sorted[0];
    }
    let q = q.clamp(0.0, 1.0);
    // Rank position in [0, n-1]; the fractional part interpolates between neighbors.
    let pos = q * (n - 1) as f64;
    let lower = pos.floor() as usize;
    let upper = pos.ceil() as usize;
    if lower == upper {
        return sorted[lower];
    }
    let weight = pos - lower as f64;
    sorted[lower] * (1.0 - weight) + sorted[upper] * weight
}

/// The Wilson score interval for `passed` successes in `n` trials at the given
/// z-score. Unlike the normal approximation it stays inside `[0, 1]` and does not
/// collapse to a zero-width interval at a 0% or 100% observed rate — the honest
/// behavior for the small samples a comparison arm carries.
pub fn wilson_interval(passed: u64, n: u64, z: f64) -> (f64, f64) {
    if n == 0 {
        return (0.0, 0.0);
    }
    let n = n as f64;
    let phat = passed as f64 / n;
    let z2 = z * z;
    let denom = 1.0 + z2 / n;
    let center = (phat + z2 / (2.0 * n)) / denom;
    let margin = (z / denom) * ((phat * (1.0 - phat) / n) + (z2 / (4.0 * n * n))).sqrt();
    ((center - margin).max(0.0), (center + margin).min(1.0))
}

/// A bootstrap confidence interval on the **median** of an already-sorted sample:
/// resample it with replacement [`BOOTSTRAP_ITERS`] times, take each resample's
/// median, and report the [`CI_ALPHA`] percentile envelope of those medians.
///
/// Bootstrapping is the right default here — it assumes no distribution, tolerates
/// skew, and at small `n` returns a wide interval, which is the correct answer
/// rather than false precision. The PRNG is seeded from `seed`, so the interval is
/// identical for the same sample every time. A single-element sample has a
/// degenerate median, so the interval is that point with zero width.
fn bootstrap_median_ci(sorted: &[f64], seed: u64) -> (f64, f64) {
    debug_assert!(!sorted.is_empty());
    if sorted.len() == 1 {
        return (sorted[0], sorted[0]);
    }
    let mut rng = SplitMix64::new(seed);
    let n = sorted.len();
    let mut medians = Vec::with_capacity(BOOTSTRAP_ITERS);
    let mut resample = vec![0.0_f64; n];
    for _ in 0..BOOTSTRAP_ITERS {
        for slot in resample.iter_mut() {
            *slot = sorted[rng.index(n)];
        }
        resample.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        medians.push(quantile(&resample, 0.5));
    }
    medians.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let lo = quantile(&medians, CI_ALPHA / 2.0);
    let hi = quantile(&medians, 1.0 - CI_ALPHA / 2.0);
    (lo, hi)
}

/// A tiny, fast, deterministic PRNG (Vigna's SplitMix64). Used only to make the
/// bootstrap reproducible from a seed; it never touches wall-clock time or a
/// thread RNG, so a comparison recomputes bit-for-bit.
struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    fn new(seed: u64) -> Self {
        SplitMix64 { state: seed }
    }

    /// The next 64-bit value in the sequence.
    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// A uniformly-distributed index in `[0, n)`. `n` is a resample length, always
    /// non-zero here. Uses Lemire's multiply-shift to avoid modulo bias.
    fn index(&mut self, n: usize) -> usize {
        ((self.next_u64() as u128 * n as u128) >> 64) as usize
    }
}

/// A stable 64-bit seed for the bootstrap, folded from an arm's run ids. The caller
/// sorts the ids first so the seed — and thus every interval — is independent of the
/// order runs happen to arrive in. FNV-1a over the sorted, newline-joined ids.
pub fn seed_from_run_ids(sorted_run_ids: &[String]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for id in sorted_run_ids {
        for byte in id.as_bytes() {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        hash ^= b'\n' as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

#[cfg(test)]
#[path = "comparison_stats.test.rs"]
mod tests;
