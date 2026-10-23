//! Tests for the comparison statistics: correctness of the descriptive figures,
//! the Wilson interval against hand-computed values, and — critically — that the
//! bootstrap is deterministic for a given seed.

use super::*;

/// Two floats are within a small absolute tolerance.
fn close(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-6, "expected {a} ≈ {b}");
}

#[test]
fn metric_summary_reports_median_mean_and_spread() {
    // A clean four-point sample: median 2.5, quartiles 1.75/3.25.
    let s = MetricSummary::compute(&[4.0, 1.0, 3.0, 2.0], 1).unwrap();
    assert_eq!(s.n, 4);
    close(s.median, 2.5);
    close(s.mean, 2.5);
    close(s.min, 1.0);
    close(s.max, 4.0);
    close(s.q1, 1.75);
    close(s.q3, 3.25);
    close(s.iqr, 1.5);
}

#[test]
fn median_sits_below_the_mean_for_a_right_skewed_sample() {
    // A floor with a long upper tail — the shape cost and tokens actually have.
    let s = MetricSummary::compute(&[1.0, 1.0, 1.0, 1.0, 100.0], 7).unwrap();
    close(s.median, 1.0);
    assert!(
        s.mean > s.median,
        "mean {} should exceed median {}",
        s.mean,
        s.median
    );
}

#[test]
fn a_single_run_collapses_to_a_point_with_no_spread() {
    // One observation carries no spread; every field is that value and the
    // interval has zero width — the honest answer, not a fabricated range.
    let s = MetricSummary::compute(&[42.0], 3).unwrap();
    assert_eq!(s.n, 1);
    close(s.median, 42.0);
    close(s.mean, 42.0);
    close(s.min, 42.0);
    close(s.max, 42.0);
    close(s.q1, 42.0);
    close(s.q3, 42.0);
    close(s.iqr, 0.0);
    close(s.ci_low, 42.0);
    close(s.ci_high, 42.0);
}

#[test]
fn an_empty_sample_has_no_summary() {
    assert!(MetricSummary::compute(&[], 1).is_none());
}

#[test]
fn the_bootstrap_interval_is_deterministic_for_a_seed() {
    let samples = [272_000.0, 291_000.0, 320_000.0, 305_000.0, 280_000.0];
    let a = MetricSummary::compute(&samples, 0xABCD).unwrap();
    let b = MetricSummary::compute(&samples, 0xABCD).unwrap();
    // Same sample, same seed → bit-for-bit identical interval, so a published
    // comparison renders the same numbers on every rebuild.
    assert_eq!(a.ci_low.to_bits(), b.ci_low.to_bits());
    assert_eq!(a.ci_high.to_bits(), b.ci_high.to_bits());
}

#[test]
fn the_bootstrap_interval_brackets_the_median_and_stays_in_range() {
    let samples = [272.0, 291.0, 320.0, 305.0, 280.0];
    let s = MetricSummary::compute(&samples, 12345).unwrap();
    assert!(
        s.ci_low <= s.median,
        "ci_low {} > median {}",
        s.ci_low,
        s.median
    );
    assert!(
        s.median <= s.ci_high,
        "median {} > ci_high {}",
        s.median,
        s.ci_high
    );
    // A resampled median can never leave the observed range.
    assert!(s.ci_low >= s.min && s.ci_high <= s.max);
}

#[test]
fn sample_order_does_not_change_the_summary() {
    // `compute` sorts internally and the seed is the caller's business, so a
    // reordered sample with the same seed is identical.
    let a = MetricSummary::compute(&[3.0, 1.0, 2.0, 5.0, 4.0], 99).unwrap();
    let b = MetricSummary::compute(&[5.0, 4.0, 3.0, 2.0, 1.0], 99).unwrap();
    assert_eq!(a.median.to_bits(), b.median.to_bits());
    assert_eq!(a.ci_low.to_bits(), b.ci_low.to_bits());
    assert_eq!(a.ci_high.to_bits(), b.ci_high.to_bits());
}

#[test]
fn wilson_interval_matches_hand_computed_values() {
    // 0 of 1: (0, 0.7934); 1 of 1: (0.2065, 1.0); 50 of 100: (0.4038, 0.5962).
    let (lo, hi) = wilson_interval(0, 1, WILSON_Z);
    assert!(
        (lo - 0.0).abs() < 1e-3 && (hi - 0.7934).abs() < 1e-3,
        "0/1 → ({lo}, {hi})"
    );
    let (lo, hi) = wilson_interval(1, 1, WILSON_Z);
    assert!(
        (lo - 0.2065).abs() < 1e-3 && (hi - 1.0).abs() < 1e-3,
        "1/1 → ({lo}, {hi})"
    );
    let (lo, hi) = wilson_interval(50, 100, WILSON_Z);
    assert!(
        (lo - 0.4038).abs() < 1e-3 && (hi - 0.5962).abs() < 1e-3,
        "50/100 → ({lo}, {hi})"
    );
}

#[test]
fn wilson_interval_stays_within_zero_and_one() {
    // Unlike the normal approximation, Wilson never leaves [0, 1] even at the
    // extremes.
    for &(passed, n) in &[(0_u64, 3_u64), (3, 3), (1, 10), (9, 10)] {
        let (lo, hi) = wilson_interval(passed, n, WILSON_Z);
        assert!(
            (0.0..=1.0).contains(&lo) && (0.0..=1.0).contains(&hi),
            "{passed}/{n} → ({lo}, {hi})"
        );
        assert!(lo <= hi);
    }
}

#[test]
fn pass_rate_reports_the_proportion_and_interval() {
    let pr = PassRate::compute(2, 3).unwrap();
    assert_eq!(pr.n, 3);
    assert_eq!(pr.passed, 2);
    close(pr.rate, 2.0 / 3.0);
    assert!(pr.wilson_low <= pr.rate && pr.rate <= pr.wilson_high);
    assert!(PassRate::compute(0, 0).is_none());
}

#[test]
fn median_ratio_is_the_effect_size_between_two_arms() {
    // The motivating comparison: Kilo's median cost over Pi's ≈ 6.8×.
    let pi = MetricSummary::compute(&[0.51, 0.53, 0.56], 1).unwrap();
    let kilo = MetricSummary::compute(&[3.5, 3.7, 4.0], 2).unwrap();
    let ratio = median_ratio(Some(&kilo), Some(&pi)).unwrap();
    assert!((ratio - (3.7 / 0.53)).abs() < 1e-9);
    // A zero denominator has no meaningful ratio; a missing arm has none.
    let zero = MetricSummary::compute(&[0.0, 0.0], 3).unwrap();
    assert!(median_ratio(Some(&kilo), Some(&zero)).is_none());
    assert!(median_ratio(Some(&kilo), None).is_none());
}

#[test]
fn seed_from_sorted_run_ids_is_stable_and_content_dependent() {
    let ids = vec!["a1b2".to_string(), "c3d4".to_string()];
    assert_eq!(seed_from_run_ids(&ids), seed_from_run_ids(&ids));
    // A different id set yields a different seed (so two arms don't share one).
    let other = vec!["a1b2".to_string(), "c3d5".to_string()];
    assert_ne!(seed_from_run_ids(&ids), seed_from_run_ids(&other));
}
