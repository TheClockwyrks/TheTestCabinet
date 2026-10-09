//! The vitest runner's results, held to core's scoring rule.
//!
//! The runner is `test_cabinet_suites::vitest_validator`, and its own tests are
//! there; the score its results add up to is core's
//! ([`automated_only_score`](crate::comparison::automated_only_score)), so the one
//! check that needs both is here.

use std::path::PathBuf;

use crate::test_case::{ReviewItem, ReviewValidation};
use crate::validation::Inconclusive;
use crate::validator::drive_units;
use crate::vitest_validator::Suite;

/// A review item decided by the validator at `script_rel`.
fn item(id: &str, script_rel: &str) -> ReviewItem {
    ReviewItem {
        failure_cap: None,
        domains: Vec::new(),
        id: id.to_string(),
        title: format!("The {id} point"),
        text: String::new(),
        reference: None,
        proof: None,
        sequences: Vec::new(),
        frames: Vec::new(),
        weight: 1,
        graded: true,
        domain: None,
        sub_items: Vec::new(),
        scored: true,
        validation: Some(ReviewValidation {
            script: Some(PathBuf::from(script_rel)),
            script_rel: script_rel.to_string(),
            engines: Vec::new(),
            outputs: Vec::new(),
        }),
    }
}

#[test]
fn a_run_stopped_at_its_cap_contributes_to_neither_side_of_the_score() {
    let items = vec![
        item(
            "serve-speed",
            "validation/simple-2d/gameplay/serve-speed.test.ts",
        ),
        item("no-tunnel", "validation/simple-2d/ball/no-tunnel.test.ts"),
    ];
    // What the runner reports for every point of a run that outlived its cap
    // (`a_run_that_outlives_its_cap_leaves_every_point_inconclusive_rather_than_failed`
    // in the suites crate holds the runner to it).
    let results: Vec<_> = drive_units(&items)
        .iter()
        .map(|unit| {
            Suite::of(unit, "simple-2d").inconclusive("the cap expired", Inconclusive::TimedOut)
        })
        .collect();

    // The scoring rule the reviewer's checklist and the automated score share: an
    // inconclusive point is not a lost point, it is an unanswered one.
    let score = crate::comparison::automated_only_score(&items, &results);
    assert_eq!(
        (score.earned, score.total),
        (0.0, 0),
        "a run stopped at its cap contributes to neither side of the score",
    );
}
