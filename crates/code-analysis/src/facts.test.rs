//! Tests for the normative complexity definition and the test-path rule.
//!
//! The scorer is the single place a complexity figure is computed, so these tests pin the
//! *definition*; `facts.parity.test.rs` then asserts both front ends actually reach it with
//! the same events for the same shape.

use super::*;

/// A function with no branches costs one cyclomatic point (the single path through it) and
/// nothing cognitively (there is nothing to hold).
#[test]
fn a_straight_line_function_scores_one_and_zero() {
    let (cyclomatic, cognitive, nesting, exits) = ComplexityScorer::new().finish();
    assert_eq!((cyclomatic, cognitive, nesting, exits), (1, 0, 0, 0));
}

/// Cognitive complexity is nesting-aware: the same branch costs more the deeper it sits.
/// This is the whole reason it is reported alongside cyclomatic, which cannot see nesting
/// at all.
#[test]
fn a_nested_branch_costs_more_cognitively_but_the_same_cyclomatically() {
    let mut flat = ComplexityScorer::new();
    flat.enter_branch();
    flat.leave();
    flat.enter_branch();
    flat.leave();

    let mut nested = ComplexityScorer::new();
    nested.enter_branch();
    nested.enter_branch();
    nested.leave();
    nested.leave();

    assert_eq!(flat.clone().finish().0, nested.clone().finish().0);
    assert_eq!(flat.finish().1, 2, "two branches at depth zero");
    assert_eq!(nested.finish().1, 3, "the inner branch pays for its depth");
}

/// An `else if` ladder is flat: charging the second rung for sitting "inside" the first
/// would make a `switch` written as an `if` chain score arbitrarily worse the longer it got.
#[test]
fn an_else_if_ladder_does_not_compound() {
    let mut scorer = ComplexityScorer::new();
    scorer.enter_branch();
    scorer.leave();
    for _ in 0..3 {
        scorer.enter_else_if();
        scorer.leave();
    }
    let (cyclomatic, cognitive, _, _) = scorer.finish();
    assert_eq!(cyclomatic, 5, "one plus four branches");
    assert_eq!(cognitive, 4, "each rung is a flat point");
}

/// A `switch` carries the cognitive weight; its arms carry the cyclomatic points. Charging
/// the construct cyclomatically as well would count its first arm twice.
#[test]
fn a_switch_splits_its_weight_between_construct_and_arms() {
    let mut scorer = ComplexityScorer::new();
    scorer.enter_switch();
    scorer.case_arm();
    scorer.case_arm();
    scorer.case_arm();
    scorer.leave();
    let (cyclomatic, cognitive, _, _) = scorer.finish();
    assert_eq!(cyclomatic, 4, "one plus three non-default arms");
    assert_eq!(cognitive, 1, "one decision for the reader to hold");
}

/// A boolean run costs a cyclomatic point per operator and **one** cognitive point however
/// long it is; a change of operator starts a new sequence.
#[test]
fn a_boolean_run_scores_once_cognitively() {
    let mut same = ComplexityScorer::new();
    same.boolean_operator(true);
    same.boolean_operator(false);
    same.boolean_operator(false);
    assert_eq!(same.finish(), (4, 1, 0, 0));

    let mut mixed = ComplexityScorer::new();
    mixed.boolean_operator(true);
    mixed.boolean_operator(true);
    assert_eq!(mixed.finish(), (3, 2, 0, 0));
}

/// Max nesting is a high-water mark, not a current depth.
#[test]
fn max_nesting_is_a_high_water_mark() {
    let mut scorer = ComplexityScorer::new();
    scorer.enter_nesting();
    scorer.enter_nesting();
    scorer.enter_nesting();
    scorer.leave();
    scorer.leave();
    scorer.leave();
    assert_eq!(scorer.finish().2, 3);
}

#[test]
fn test_paths_are_recognised_in_both_languages_conventions() {
    for path in [
        "src/game.test.ts",
        "src/game.spec.tsx",
        "src/__tests__/game.ts",
        "tests/integration.rs",
        "src/game_test.rs",
    ] {
        assert!(is_test_path(path), "`{path}` should read as test code");
    }
    for path in ["src/game.ts", "src/latest.ts", "src/protest.rs"] {
        assert!(!is_test_path(path), "`{path}` should not read as test code");
    }
}
