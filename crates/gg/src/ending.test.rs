//! What an [`Ending`] will and will not represent.
//!
//! These are the checks that used to be impossible: under the old contract a reviewer's verdict was
//! prose the loop scraped a list out of, so "changes requested, nothing listed" was a *value* the
//! system could hold and a template had to apologise for. Here it is a constructor error, and that
//! is the whole point — so the tests below are mostly about what cannot be built.

use super::*;

#[test]
fn finishing_requires_something_to_say() {
    assert!(Ending::finished("did the thing".to_string(), FINISH_TOOL).is_ok());
    for empty in ["", "   ", "\n\t "] {
        let error = Ending::finished(empty.to_string(), FINISH_TOOL)
            .expect_err("an empty summary is refused");
        assert!(error.contains(FINISH_TOOL), "{error}");
        assert!(error.contains("NOT over"), "{error}");
    }
}

/// **The refusal names the call the way its caller named it.**
///
/// The constructors are shared by both execution modes, and the two modes do not name these calls
/// alike: the tool-calling path writes `request_changes`, a program writes whatever its language's
/// SDK spells — `review.requestChanges` in TypeScript. A sentence that says "call this instead" has
/// to say something the model can write, so the name travels in rather than being a constant here.
#[test]
fn a_refusal_quotes_the_calls_the_way_its_caller_named_them() {
    let error = Ending::finished(String::new(), "harness.finish").expect_err("still empty");
    assert!(error.contains("`harness.finish`"), "{error}");
    assert!(!error.contains("`finish`"), "{error}");

    let error = Ending::changes_requested(Vec::new(), "review.requestChanges", "review.approve")
        .expect_err("still empty");
    assert!(error.contains("`review.requestChanges`"), "{error}");
    assert!(error.contains("`review.approve`"), "{error}");
    assert!(!error.contains("request_changes"), "{error}");
}

#[test]
fn requesting_changes_requires_at_least_one_change() {
    let ending = Ending::changes_requested(
        vec![
            "  fix the off-by-one in `step()`  ".to_string(),
            String::new(),
            "   ".to_string(),
            "add a test for the empty case".to_string(),
        ],
        REQUEST_CHANGES_TOOL,
        APPROVE_TOOL,
    )
    .expect("a list with real items is accepted");
    assert_eq!(
        ending,
        Ending::ChangesRequested {
            items: vec![
                "fix the off-by-one in `step()`".to_string(),
                "add a test for the empty case".to_string(),
            ],
        },
        "blank entries are dropped and the rest are trimmed"
    );
}

#[test]
fn a_rejection_with_nothing_to_act_on_cannot_be_built() {
    // The defect this whole design exists to remove: a reviewer that rejects the work and names
    // nothing leaves the agent that must fix it with no work to do. It is refused rather than
    // papered over, and the refusal points at the call that *was* appropriate.
    for empty in [vec![], vec![String::new()], vec!["  ".to_string()]] {
        let error = Ending::changes_requested(empty, REQUEST_CHANGES_TOOL, APPROVE_TOOL)
            .expect_err("an empty change list is refused");
        assert!(error.contains(REQUEST_CHANGES_TOOL), "{error}");
        assert!(error.contains(APPROVE_TOOL), "{error}");
    }
}
