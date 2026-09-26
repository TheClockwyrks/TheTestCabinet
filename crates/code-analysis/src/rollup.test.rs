//! Tests for the statistics the rollup computes itself.
//!
//! The end-to-end shape of a summary is covered in `lib.test.rs`; these pin the three
//! functions whose definitions are load-bearing and easy to get subtly wrong.

use super::*;

/// The Gini coefficient of code lines is the one number that answers "did the model split
/// the work?".
#[test]
fn gini_reads_zero_for_even_work_and_approaches_one_for_a_god_file() {
    assert_eq!(gini(&[]), 0.0, "an empty tree has no inequality");
    assert_eq!(gini(&[0, 0, 0]), 0.0, "and neither does an empty one");
    assert!(
        gini(&[100, 100, 100, 100]).abs() < 1e-9,
        "four equal files are perfectly even"
    );

    let god_file = gini(&[1, 1, 1, 1, 1_000]);
    assert!(
        god_file > 0.7,
        "one file holding everything must approach one, got {god_file}"
    );
    assert!(god_file < 1.0);

    let split = gini(&[180, 200, 210, 220, 190]);
    assert!(
        split < god_file,
        "a modularised tree must score lower than a god-file one: {split} vs {god_file}"
    );
}

/// Nearest-rank, so the median of an even-length list is a real file's size rather than an
/// interpolation between two files that do not exist.
#[test]
fn percentiles_are_nearest_rank() {
    let sorted = [10, 20, 30, 40];
    assert_eq!(percentile(&sorted, 0.5), 20);
    assert_eq!(percentile(&sorted, 0.9), 40);
    assert_eq!(percentile(&sorted, 0.0), 10);
    assert_eq!(percentile(&[], 0.5), 0);
}

/// Every mean and ratio goes through one guard, because `NaN` does not survive JSON at all —
/// a divide-by-zero would not produce a wrong number, it would produce an unparseable
/// document.
#[test]
fn an_empty_denominator_is_zero_rather_than_not_a_number() {
    assert_eq!(ratio(5.0, 0.0), 0.0);
    assert_eq!(per_kloc(4, 0), 0.0);
    assert_eq!(per_kloc(4, 2_000), 2.0);
}
