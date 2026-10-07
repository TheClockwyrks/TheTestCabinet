//! Tests for the token-class totals, the comparable-cost derivation, and the
//! run's stage-duration partition.

use super::*;

/// Prices with every class listed, so a test that is about the *counts* is never
/// also about a missing price.
fn priced() -> TokenPrices {
    TokenPrices {
        uncached_input: Some(0.000_002),
        cached_input: Some(0.000_000_2),
        output: Some(0.000_01),
    }
}

#[test]
fn a_run_with_no_class_reported_costs_an_unknown_amount_not_zero() {
    // Nothing about this run's usage is known — the harness never reported. That
    // is not a free run, and recording it as `$0.00` would present a gap in our
    // data as a fact about the model.
    let counts = TokenCounts::default();
    assert_eq!(counts.total(), None);
    assert_eq!(Cost::comparable_from(&counts, &priced()), None);
}

#[test]
fn a_list_price_omitting_a_class_reads_that_class_as_unknown() {
    // The catalog's curated list price names only the classes a model charges for;
    // a class it does not mention (most often the cache-read rate) deserializes as
    // unknown rather than failing the whole price, so the launch it is stamped on
    // still parses.
    let parsed: TokenPrices =
        serde_json::from_str(r#"{"uncachedInput":0.000002,"output":0.00001}"#)
            .expect("a list price with an omitted class parses");
    assert_eq!(
        parsed,
        TokenPrices {
            uncached_input: Some(0.000_002),
            cached_input: None,
            output: Some(0.000_01),
        }
    );
}

#[test]
fn a_run_that_genuinely_used_nothing_costs_zero() {
    // Reported, and zero: a real (if odd) figure, and distinct from the case above.
    let counts = TokenCounts {
        uncached_input: Some(0),
        cached_input: Some(0),
        output: Some(0),
        reasoning: Some(0),
    };
    assert_eq!(counts.total(), Some(0));
    assert_eq!(Cost::comparable_from(&counts, &priced()), Some(0.0));
}

#[test]
fn unknown_classes_alongside_a_reported_one_still_cost_out() {
    // A harness that reports only what it knows still yields a cost: the
    // unreported classes fold into the classes that are reported.
    let counts = TokenCounts {
        uncached_input: Some(1_000),
        cached_input: None,
        output: Some(100),
        reasoning: None,
    };
    let cost = Cost::comparable_from(&counts, &priced()).expect("cost is known");
    assert!((cost - (1_000.0 * 0.000_002 + 100.0 * 0.000_01)).abs() < f64::EPSILON);
}

#[test]
fn reasoning_is_priced_at_the_output_rate() {
    let counts = TokenCounts {
        uncached_input: Some(0),
        cached_input: Some(0),
        output: Some(100),
        reasoning: Some(50),
    };
    let cost = Cost::comparable_from(&counts, &priced()).expect("cost is known");
    assert!((cost - (150.0 * 0.000_01)).abs() < f64::EPSILON);
}

#[test]
fn a_nonzero_class_with_an_unknown_price_makes_the_whole_cost_unknown() {
    let counts = TokenCounts {
        uncached_input: Some(1_000),
        cached_input: None,
        output: Some(100),
        reasoning: None,
    };
    let prices = TokenPrices {
        uncached_input: None,
        ..priced()
    };
    assert_eq!(Cost::comparable_from(&counts, &prices), None);
}

#[test]
fn a_zero_class_needs_no_price() {
    // Zero tokens contribute nothing whatever the rate, so an unlisted price for
    // an unused class must not poison an otherwise-known cost.
    let counts = TokenCounts {
        uncached_input: Some(1_000),
        cached_input: Some(0),
        output: Some(100),
        reasoning: None,
    };
    let prices = TokenPrices {
        cached_input: None,
        ..priced()
    };
    assert!(Cost::comparable_from(&counts, &prices).is_some());
}

#[test]
fn totals_report_nothing_only_when_no_class_in_them_is_reported() {
    let input_only = TokenCounts {
        uncached_input: Some(10),
        cached_input: None,
        output: None,
        reasoning: None,
    };
    assert_eq!(input_only.total_input(), Some(10));
    assert_eq!(input_only.total_output(), None);
    assert_eq!(input_only.total(), Some(10));
}

/// A duration in whole seconds, so a test's arithmetic reads as its assertion.
fn secs(seconds: u64) -> Duration {
    Duration::from_secs(seconds)
}

#[test]
fn the_stages_partition_the_run_exactly() {
    // A 900s run whose session ended at 870s and whose container was never queued:
    // 600s of setup, 270s of session, and the 30s of teardown that is left.
    let durations = RunDurations::partition(secs(900), secs(870), secs(270), secs(0), None);
    assert_eq!(durations.run_time_seconds, 900.0);
    assert_eq!(durations.setup_seconds, 600.0);
    assert_eq!(durations.session_seconds, 270.0);
    assert_eq!(durations.teardown_seconds, 30.0);
    assert_eq!(
        durations.setup_seconds + durations.session_seconds + durations.teardown_seconds,
        durations.run_time_seconds,
        "the three stages must sum to the run's measured duration exactly",
    );
}

#[test]
fn the_queueing_wait_is_charged_to_neither_the_run_nor_the_setup() {
    // 120s of the 900s wall clock was the container waiting its turn for cluster
    // capacity. It leaves the run's measured duration, and it leaves setup, which
    // is the stage that contained it — the session and teardown are untouched.
    let durations = RunDurations::partition(secs(900), secs(870), secs(270), secs(120), None);
    assert_eq!(durations.run_time_seconds, 780.0);
    assert_eq!(durations.setup_seconds, 480.0);
    assert_eq!(durations.session_seconds, 270.0);
    assert_eq!(durations.teardown_seconds, 30.0);
}

#[test]
fn validation_is_recorded_outside_the_run_and_only_when_it_ran() {
    let validated =
        RunDurations::partition(secs(900), secs(870), secs(270), secs(0), Some(secs(45)));
    assert_eq!(validated.validation_seconds, Some(45.0));
    assert_eq!(
        validated.run_time_seconds, 900.0,
        "validation runs after the run's wall clock is frozen, so it never joins it",
    );

    // A canceled run skips validation, and nothing measured is not zero measured.
    let canceled = RunDurations::partition(secs(900), secs(870), secs(270), secs(0), None);
    assert_eq!(canceled.validation_seconds, None);
}

#[test]
fn the_partition_holds_for_durations_a_run_could_not_have_produced() {
    // Timers that disagree — a session longer than the whole run — must still
    // partition rather than underflow into a negative teardown, because every
    // consumer of these figures is entitled to their sum.
    let durations = RunDurations::partition(secs(10), secs(600), secs(500), secs(0), None);
    assert_eq!(durations.run_time_seconds, 10.0);
    assert!(durations.setup_seconds >= 0.0);
    assert!(durations.session_seconds >= 0.0);
    assert!(durations.teardown_seconds >= 0.0);
    assert_eq!(
        durations.setup_seconds + durations.session_seconds + durations.teardown_seconds,
        durations.run_time_seconds,
    );
}
