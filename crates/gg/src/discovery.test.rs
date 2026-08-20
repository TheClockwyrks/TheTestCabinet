//! Tests for [discovery](super)'s own two decisions: which calls gg spells at the model itself, and
//! how often an operator is told that a model is not looking anything up.
//!
//! What a *view* clears is not here — that is the loop's state and is tested where the state is:
//! `recording.test.rs` for the bracket that asks, and `agent.discovery.test.rs` for whole
//! sessions in which a model does and does not open one first.

use super::*;
use crate::sandbox::{
    Binding, DOCS_SEARCH, FILES_READ_FILE, OPERATIONS, SESSION_APPROVE, SESSION_FINISH,
    SESSION_REQUEST_CHANGES, VIEWS_CURRENT, VIEWS_OPEN_DOCS_VIEW, operation,
};

/// **The exemption is the ending calls and nothing else**, checked against the whole table rather
/// than against a sample.
///
/// The list is derived from [`Binding::Ending`], so the risk it guards against is not a typo but a
/// widening: a future arm of the binding, or a second reason somebody thought was as good as the
/// prompt's. Comparing the two whole sets is what makes such a change visible in this test rather
/// than in a study whose numbers quietly dropped.
#[test]
fn only_the_calls_ggs_own_prompt_spells_are_exempt() {
    let exempt: Vec<String> = OPERATIONS
        .iter()
        .filter(|operation| spelled_by_gg(operation.id))
        .map(|operation| operation.id.to_string())
        .collect();
    assert_eq!(
        exempt,
        vec![
            "session.finish".to_string(),
            "session.approve".to_string(),
            "session.request_changes".to_string(),
        ],
        "the prompt's `Ending your session` section names these three by name and no other call \
         anywhere"
    );
    // The same set read the other way round: every exempt row is an ending, and every ending is
    // exempt.
    for row in OPERATIONS {
        assert_eq!(
            spelled_by_gg(row.id),
            matches!(row.binding, Binding::Ending(_)),
            "{} is exempt exactly when it is an ending call",
            row.id
        );
    }
    assert!(spelled_by_gg(SESSION_FINISH));
    assert!(spelled_by_gg(SESSION_APPROVE));
    assert!(spelled_by_gg(SESSION_REQUEST_CHANGES));
}

/// **The two calls discovery itself is made of are deliberately not exempt.**
///
/// They do not need to be: the [bootstrap](crate::bootstrap) opens a documentation view of each,
/// before the model's first turn, so they are documented from turn one — and an agent that closed
/// those views and went on calling is guessing exactly as much as it would be about anything else.
/// An exemption here would be a permanent blind spot over the one pair the mechanism is built on.
#[test]
fn the_discovery_calls_are_not_exempt_because_the_bootstrap_documents_them() {
    assert!(!spelled_by_gg(DOCS_SEARCH));
    assert!(!spelled_by_gg(VIEWS_OPEN_DOCS_VIEW));
    // Nor is the one call that takes no arguments at all: it still has a signature, a return type
    // and a page, and a model that never read it is still guessing.
    assert!(!spelled_by_gg(VIEWS_CURRENT));
    assert!(!spelled_by_gg(FILES_READ_FILE));
}

/// An id no row carries answers `false` — the conservative reading, since an exemption is the arm
/// that records nothing.
#[test]
fn an_operation_gg_has_no_row_for_is_not_exempt() {
    let unknown = crate::sandbox::OperationId {
        namespace: "nowhere",
        key: "nothing",
    };
    assert!(operation(unknown).is_none(), "the fixture must be unknown");
    assert!(!spelled_by_gg(unknown));
}

/// **One line per run, whoever gets there first.** Every agent of a run holds a clone of one latch,
/// so the second agent to record a violation finds it already claimed.
#[test]
fn the_runs_one_warning_is_claimed_once_across_every_agent_that_holds_it() {
    let root = DiscoveryWarning::default();
    let subagent = root.clone();
    let reviewer = root.clone();

    assert!(
        root.claim(),
        "the first agent to record one writes the line"
    );
    assert!(!subagent.claim(), "a clone is the same latch, not a second");
    assert!(!reviewer.claim());
    assert!(
        !root.claim(),
        "and the first agent's own next call is not a second line either"
    );
}

/// Two runs are two latches: the state is per run and nothing about it is global, so a second
/// session in the same process starts un-warned.
#[test]
fn a_second_run_starts_with_its_own_unclaimed_warning() {
    assert!(DiscoveryWarning::default().claim());
    assert!(DiscoveryWarning::default().claim());
}
