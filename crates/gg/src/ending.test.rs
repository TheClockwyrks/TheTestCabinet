//! What an [`Ending`] will and will not represent.
//!
//! These are the checks that used to be impossible: under the old contract a reviewer's verdict was
//! prose the loop scraped a list out of, so "changes requested, nothing listed" was a *value* the
//! system could hold and a template had to apologise for. Here it is a constructor error, and that
//! is the whole point — so the tests below are mostly about what cannot be built.

use super::*;

#[test]
fn a_role_offers_only_its_own_ending_calls() {
    assert_eq!(EndingRole::Standard.tools(), [FINISH_TOOL]);
    assert_eq!(
        EndingRole::Review.tools(),
        [APPROVE_TOOL, REQUEST_CHANGES_TOOL]
    );
    assert_eq!(
        EndingRole::Judge { attempts: 3 }.tools(),
        [SELECT_WINNER_TOOL]
    );

    // The negative half is the one that matters: a reviewer has no `finish` to reach for, which is
    // what stops "the work is complete" being offered as a verdict.
    assert!(!EndingRole::Review.owns(FINISH_TOOL));
    assert!(!EndingRole::Standard.owns(APPROVE_TOOL));
    assert!(!EndingRole::Judge { attempts: 2 }.owns(FINISH_TOOL));
}

#[test]
fn finishing_requires_something_to_say() {
    assert!(Ending::finished("did the thing".to_string()).is_ok());
    for empty in ["", "   ", "\n\t "] {
        let error = Ending::finished(empty.to_string()).expect_err("an empty summary is refused");
        assert!(error.contains(FINISH_TOOL), "{error}");
        assert!(error.contains("NOT over"), "{error}");
    }
}

#[test]
fn requesting_changes_requires_at_least_one_change() {
    let ending = Ending::changes_requested(vec![
        "  fix the off-by-one in `step()`  ".to_string(),
        String::new(),
        "   ".to_string(),
        "add a test for the empty case".to_string(),
    ])
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
        let error = Ending::changes_requested(empty).expect_err("an empty change list is refused");
        assert!(error.contains(REQUEST_CHANGES_TOOL), "{error}");
        assert!(error.contains(APPROVE_TOOL), "{error}");
    }
}

#[test]
fn a_winner_must_be_one_of_the_attempts_it_was_shown() {
    assert!(Ending::winner(1, "cleanest".to_string(), 3).is_ok());
    assert!(Ending::winner(3, "cleanest".to_string(), 3).is_ok());

    // Zero, and past the end. Both used to be clamped into a merge of *some* attempt; neither is a
    // pick, so neither is accepted.
    for out_of_range in [0, 4, 99] {
        let error = Ending::winner(out_of_range, "cleanest".to_string(), 3)
            .expect_err("a pick outside the range is refused");
        assert!(error.contains("1 to 3"), "{error}");
    }
}

#[test]
fn a_winner_must_say_why() {
    let error = Ending::winner(2, "   ".to_string(), 3).expect_err("a blank rationale is refused");
    assert!(error.contains(SELECT_WINNER_TOOL), "{error}");
}

#[test]
fn every_ending_renders_its_own_final_text() {
    assert_eq!(
        Ending::Finished {
            summary: "wired the thing up".to_string(),
        }
        .final_text(),
        "wired the thing up"
    );
    assert_eq!(Ending::Approved.final_text(), "Approved.");
    assert_eq!(
        Ending::ChangesRequested {
            items: vec!["one".to_string(), "two".to_string()],
        }
        .final_text(),
        "Changes requested:\n1. one\n2. two",
        "the list is numbered from one, as a prompt counts"
    );
    assert_eq!(
        Ending::Winner {
            attempt: 2,
            rationale: "it handles the empty case".to_string(),
        }
        .final_text(),
        "Selected attempt 2: it handles the empty case"
    );
}

#[test]
fn every_ending_names_the_call_that_produced_it() {
    assert_eq!(
        Ending::Finished {
            summary: "done".to_string(),
        }
        .call_name(),
        FINISH_TOOL
    );
    assert_eq!(Ending::Approved.call_name(), APPROVE_TOOL);
    assert_eq!(
        Ending::ChangesRequested {
            items: vec!["one".to_string()],
        }
        .call_name(),
        REQUEST_CHANGES_TOOL
    );
    assert_eq!(
        Ending::Winner {
            attempt: 1,
            rationale: "why".to_string(),
        }
        .call_name(),
        SELECT_WINNER_TOOL
    );
}

#[test]
fn only_a_judge_carries_an_attempt_count() {
    assert_eq!(EndingRole::Standard.attempts(), 0);
    assert_eq!(EndingRole::Review.attempts(), 0);
    assert_eq!(EndingRole::Judge { attempts: 5 }.attempts(), 5);
}
