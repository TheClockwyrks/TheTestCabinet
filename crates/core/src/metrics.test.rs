//! Tests for the token-class totals and the comparable-cost derivation.

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
