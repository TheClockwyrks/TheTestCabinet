//! The automated toolchain gate applied over a run's aggregate rating and score.
//!
//! The gate is the one place an automated check may change what a run is rated, so
//! the two properties that keep it honest are asserted here: a **passing** typecheck
//! changes nothing at all, and a failing one never reaches into a reviewer's stored
//! marks — it composes with the aggregate they produce.

use super::*;

/// One reviewer's per-domain ratings.
fn ratings(pairs: &[(&str, Rating)]) -> Vec<DomainRating> {
    pairs
        .iter()
        .map(|(domain, rating)| DomainRating {
            domain: (*domain).to_string(),
            rating: *rating,
        })
        .collect()
}

/// The ungated case is a pass-through: a run whose typecheck succeeded (or whose
/// case declares no toolchain at all) is rated exactly what its reviewers rated it.
/// This is the assertion that would catch a gate wired to fire on the wrong
/// polarity.
#[test]
fn a_passing_typecheck_leaves_the_reviewed_rating_untouched() {
    let reviewed = aggregate_rating([ratings(&[("play", Rating::Great)]).as_slice()]);
    assert_eq!(reviewed, Some(Rating::Great));
    assert_eq!(gated_rating(false, reviewed), Some(Rating::Great));
    assert_eq!(gated_rating(false, None), None);
}

/// A failing typecheck forces `broken` over the top of even a flawless review.
#[test]
fn a_failing_typecheck_forces_broken_over_the_reviews() {
    let reviewed = aggregate_rating([ratings(&[("play", Rating::Flawless)]).as_slice()]);
    assert_eq!(reviewed, Some(Rating::Flawless));
    assert_eq!(gated_rating(true, reviewed), Some(Rating::Broken));
}

/// The gate is a statement about the build, not an average of opinions, so it
/// applies to a run nobody has reviewed yet.
#[test]
fn a_failing_typecheck_rates_an_unreviewed_run_broken() {
    assert_eq!(gated_rating(true, None), Some(Rating::Broken));
}

/// A gated run scores zero, and keeps the denominator so it reads as `0 / total`
/// rather than as unscored. The reviewer count is preserved too: the reviews still
/// happened.
#[test]
fn a_failing_typecheck_zeroes_the_score_but_keeps_its_denominator() {
    let reviewed = aggregate_score(&[
        Score {
            earned: 7.0,
            total: 10,
        },
        Score {
            earned: 9.0,
            total: 10,
        },
    ]);
    let gated = gated_score(true, reviewed).expect("a scored run stays scored");
    assert_eq!(gated.earned, 0.0);
    assert_eq!(gated.total, 10);
    assert_eq!(gated.reviews, 2);
}

/// A passing typecheck leaves the score exactly as the reviews produced it.
#[test]
fn a_passing_typecheck_leaves_the_score_untouched() {
    let reviewed = aggregate_score(&[Score {
        earned: 7.0,
        total: 10,
    }]);
    assert_eq!(gated_score(false, reviewed), reviewed);
}

/// With no reviews there is no denominator to report a zero against, so a gated run
/// stays unscored — its `broken` rating is the signal.
#[test]
fn a_gated_run_with_no_reviews_has_no_score() {
    assert!(gated_score(true, None).is_none());
}

/// A game jam's badge is the whole-game grade rather than a domain rating, so the
/// gate lands there instead.
#[test]
fn a_failing_typecheck_forces_the_worst_jam_grade() {
    let reviewed = Some(VerdictStatus::Incredible);
    assert_eq!(
        gated_overall_grade(true, reviewed),
        Some(VerdictStatus::Broken)
    );
    assert_eq!(gated_overall_grade(false, reviewed), reviewed);
    assert_eq!(gated_overall_grade(true, None), Some(VerdictStatus::Broken));
}

/// The gate composes with the aggregate; it does not replace the reviews it is
/// composed over. Re-aggregating the same reviews with the gate lifted must recover
/// the reviewers' real conclusion, which is only true if nothing was rewritten.
#[test]
fn lifting_the_gate_recovers_the_reviewers_own_verdict() {
    let review = ratings(&[("play", Rating::Passable), ("polish", Rating::Great)]);
    let reviewed = aggregate_rating([review.as_slice()]);

    assert_eq!(gated_rating(true, reviewed), Some(Rating::Broken));
    assert_eq!(gated_rating(false, reviewed), Some(Rating::Passable));
    // The source data is untouched by either call.
    assert_eq!(
        aggregate_rating([review.as_slice()]),
        Some(Rating::Passable)
    );
}
