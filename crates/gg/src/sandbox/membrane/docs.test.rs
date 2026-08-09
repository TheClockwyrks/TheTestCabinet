//! Tests for the **documentation** interface — the directory every program reaches, and the two
//! closes that are bought by a capability.
//!
//! The split is the subject. Discovering what a run offers is unconditional; taking documentation
//! back out of the window is not, because an open only ever appends to the prompt while a close
//! rewrites its middle. So what is asserted here is that the gate is the *host's* — checked at the
//! boundary, inside the call's own record — rather than something a guest is trusted to have left
//! out of a scope.

use super::super::test_cabinet::gg::types::ErrorCode;
use super::*;
use crate::sandbox::fake::{CallLog, membrane, membrane_closing_docs};

/// The directory is answered whatever a run enables, and is recorded under the object the guest
/// named — the one call whose API record cannot be a fixed pair.
#[test]
fn the_directory_answers_and_is_recorded_under_the_object_it_was_asked_about() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let listed = state.list_functions("fs".to_string());
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, "fsFunction");

    assert!(
        log.names().is_empty(),
        "a directory lookup dispatches no tool"
    );
    assert_eq!(state.into_parts().api_calls, 1);
}

/// **A search is unconditional, and the view it opens is recorded as a view.**
///
/// It sits on the ungated side of this interface with the directory, and for a stronger reason:
/// once the prompt names no functions, a search is how an agent learns what it has, so a run able to
/// withhold it could withhold an agent's knowledge of its own capabilities. What is still per agent
/// is what a search *finds*, which the runtime decides and this membrane never second-guesses.
///
/// The view is on the view report rather than the tool log, because a search dispatches nothing: the
/// results it puts in the window are the same kind of thing an `openText` puts there, and are
/// accounted the same way.
#[test]
fn a_search_is_unconditional_and_records_the_view_it_opened() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let found = state
        .search("file".to_string(), None, None, None, None, None)
        .expect("a search is bound whatever a run enables");
    assert_eq!(found.total, 0, "the double models no catalogue");

    let parts = state.into_parts();
    assert!(log.names().is_empty(), "a search dispatches no tool");
    assert_eq!(parts.api_calls, 1);
    assert!(parts.refusals.is_empty(), "{:?}", parts.refusals);
    assert_eq!(
        parts.views_opened.len(),
        1,
        "the results reach the model as a view: {:?}",
        parts.views_opened
    );
    assert_eq!(parts.views_opened[0].selector, "search results");
}

/// **A close reaches the api when the agent holds the capability**, and reports what went.
#[test]
fn a_close_reaches_the_api_when_the_capability_is_held() {
    let log = CallLog::default();
    let mut state = membrane_closing_docs(&log, true);

    assert_eq!(
        state
            .close_doc_view("readFile".to_string())
            .expect("the capability is held"),
        0,
        "the double holds no window, so nothing is open to close — which is a success, not a failure"
    );
    assert_eq!(state.close_doc_views().expect("and on the blanket form"), 0);

    let parts = state.into_parts();
    assert!(parts.refusals.is_empty(), "{:?}", parts.refusals);
    assert_eq!(parts.api_calls, 2);
}

/// **The capability is a host-side check, on both calls.**
///
/// A guest that builds its scope could leave the two names out of it, but a guest that links its SDK
/// as an ordinary library has no name to withhold — so the membrane checks the flag itself, and an
/// agent without the capability is refused `unavailable` rather than answered with a cheerful `0`
/// that closed nothing.
#[test]
fn a_close_is_refused_when_the_capability_is_withheld() {
    let log = CallLog::default();
    let mut state = membrane_closing_docs(&log, false);

    for error in [
        state
            .close_doc_view("readFile".to_string())
            .expect_err("the capability is withheld"),
        state
            .close_doc_views()
            .expect_err("and on the blanket form"),
    ] {
        assert_eq!(error.code, ErrorCode::Unavailable);
        assert!(
            error
                .message
                .contains("open documentation but not close it"),
            "the refusal says what this agent may still do: {}",
            error.message
        );
    }
}

/// **A refused close is still counted as a call the model made.**
///
/// "The model reached for something this run does not offer it" is precisely what a capability
/// ablation is run to measure, so the refusal happens *inside* the call's own record rather than
/// before it. A refusal that closed no bracket would be invisible to the measurement it exists for.
#[test]
fn a_refused_close_is_recorded_as_a_call_that_failed() {
    let log = CallLog::default();
    let mut state = membrane_closing_docs(&log, false);
    let _ = state.close_doc_view("readFile".to_string());

    let parts = state.into_parts();
    assert_eq!(parts.api_calls, 1, "the model made a call, and it failed");
    assert_eq!(
        parts.refusals.len(),
        1,
        "and the reach is on the refusal roster, under gg's own name for it"
    );
    assert_eq!(parts.refusals[0].name, "docs.close");
    assert!(
        log.names().is_empty(),
        "nothing was dispatched: no tool backs a documentation close"
    );
}
