//! Tests for what the [view](crate::sandbox) caps decide.
//!
//! Every one of these asserts on the **words** as well as the classification, because a cap that
//! refuses without naming itself is a cap the model cannot work around. The whole reason a breach is
//! a catchable `limit-exceeded` rather than a silent truncation is that the model can split the
//! material, trim it, or write it to a file and open a file view of that — but only if the refusal
//! tells it which ceiling it hit.

use super::*;
use crate::context::EvictionResult;

/// A body under the ceiling, with a label, is simply allowed.
#[test]
fn an_ordinary_text_view_passes_every_cap() {
    assert!(text_view_refusal("build failures", "3 tests failed in x.ts", &[]).is_none());
}

/// **An empty body is allowed.**
///
/// It is how a program says that something it was showing is now empty — "no failures this time" —
/// and refusing it would make that unexpressible, leaving the model to either keep a stale view or
/// invent a sentence.
#[test]
fn an_empty_body_is_allowed() {
    assert!(text_view_refusal("failures", "", &[]).is_none());
}

/// **An empty label is not.** A view with no selector could never be closed, replaced or
/// attributed, so it is an argument error rather than a cap.
#[test]
fn a_blank_label_is_an_argument_error() {
    let refusal = text_view_refusal("  \t ", "body", &[]).expect("a blank label names nothing");
    assert_eq!(refusal.failure, ToolFailure::InvalidArgument);
    assert!(refusal.message.contains("non-empty label"));
}

/// Both size caps refuse, name themselves, and say what was NOT done — nothing was truncated and
/// nothing was shown.
#[test]
fn the_size_caps_name_themselves_and_promise_no_truncation() {
    let long_label = "l".repeat(MAX_VIEW_LABEL_BYTES + 1);
    let refusal = text_view_refusal(&long_label, "body", &[]).expect("the label is over the cap");
    assert_eq!(refusal.failure, ToolFailure::LimitExceeded);
    assert!(refusal.message.contains("MAX_VIEW_LABEL_BYTES"));

    let long_body = "b".repeat(MAX_TEXT_VIEW_BYTES + 1);
    let refusal = text_view_refusal("notes", &long_body, &[]).expect("the body is over the cap");
    assert_eq!(refusal.failure, ToolFailure::LimitExceeded);
    assert!(refusal.message.contains("MAX_TEXT_VIEW_BYTES"));
    assert!(
        refusal.message.contains("Nothing was truncated"),
        "the model must be able to tell a refusal from a silent cut: {}",
        refusal.message
    );
}

/// A label of exactly the cap is fine: the ceiling is inclusive, and an off-by-one here would refuse
/// a call the documented number says is legal.
#[test]
fn the_size_caps_are_inclusive() {
    let label = "l".repeat(MAX_VIEW_LABEL_BYTES);
    let body = "b".repeat(MAX_TEXT_VIEW_BYTES);
    assert!(text_view_refusal(&label, &body, &[]).is_none());
}

/// **At the ceiling, a NEW label is refused and an existing one is not.**
///
/// Re-opening a label replaces a view rather than adding one, so refusing it would leave an agent
/// holding fifty views unable to correct any of them — which is exactly the state in which it most
/// needs to.
#[test]
fn the_open_count_cap_still_admits_a_replacement() {
    let open: Vec<String> = (0..MAX_OPEN_TEXT_VIEWS)
        .map(|index| format!("view-{index}"))
        .collect();

    let refusal = text_view_refusal("view-new", "body", &open).expect("the window is full");
    assert_eq!(refusal.failure, ToolFailure::LimitExceeded);
    assert!(refusal.message.contains("MAX_OPEN_TEXT_VIEWS"));
    assert!(
        refusal.message.contains("view.close"),
        "a refusal has to say what to do about it: {}",
        refusal.message
    );

    assert!(
        text_view_refusal("view-7", "a better summary", &open).is_none(),
        "re-opening an open label replaces a view rather than adding one"
    );
}

/// The per-program operation budget refuses only once it is actually spent, and names itself.
#[test]
fn the_op_budget_refuses_only_when_spent() {
    assert!(view_ops_refusal(0).is_none());
    assert!(view_ops_refusal(MAX_VIEW_OPS_PER_PROGRAM - 1).is_none());

    let refusal = view_ops_refusal(MAX_VIEW_OPS_PER_PROGRAM).expect("the budget is spent");
    assert_eq!(refusal.failure, ToolFailure::LimitExceeded);
    assert!(refusal.message.contains("MAX_VIEW_OPS_PER_PROGRAM"));
    assert!(
        refusal
            .message
            .contains("already opened are in your window"),
        "the views it did open are not lost, and the model must not think they are: {}",
        refusal.message
    );
}

/// A blank selector is an argument error; anything else is left to close whatever it names —
/// including nothing.
#[test]
fn only_a_blank_close_selector_is_refused() {
    assert!(close_selector_refusal("src/a.ts").is_none());
    assert!(
        close_selector_refusal("never-opened").is_none(),
        "closing something that is not open is 0, not a failure"
    );

    let refusal = close_selector_refusal("   ").expect("a blank selector names nothing");
    assert_eq!(refusal.failure, ToolFailure::InvalidArgument);
}

/// **A close that reclaimed nothing emits nothing.**
///
/// `ContextManaged` is the operator's record of the window actually changing. A zero-item event
/// would put a line on that stream for a call that did not change it, and a program that closes
/// defensively makes exactly those calls.
#[test]
fn a_close_that_reclaimed_nothing_emits_no_event() {
    assert!(
        view_close_event(
            GgContextAction::CloseTextViews,
            "notes",
            &EvictionResult::default()
        )
        .is_none()
    );
}

/// The two bands report as the two actions the contract declares, each naming what it closed.
#[test]
fn a_close_reports_the_band_it_reclaimed_from() {
    let reclaimed = EvictionResult {
        items: 2,
        tokens: 300,
        paths: vec!["src/a.ts".to_string()],
    };

    let files = view_close_event(GgContextAction::EvictFileViews, "src/a.ts", &reclaimed)
        .expect("two file views were closed");
    match files {
        GgTelemetryKind::ContextManaged {
            action,
            reclaimed_tokens,
            items,
            detail,
        } => {
            assert_eq!(action, GgContextAction::EvictFileViews);
            assert_eq!((reclaimed_tokens, items), (300, 2));
            assert!(detail.contains("file view(s)"));
            assert!(detail.contains("src/a.ts"));
        }
        other => panic!("a close reports as a context-managed event, not {other:?}"),
    }

    let texts = view_close_event(GgContextAction::CloseTextViews, "notes", &reclaimed)
        .expect("a text view was closed");
    match texts {
        GgTelemetryKind::ContextManaged { action, detail, .. } => {
            assert_eq!(action, GgContextAction::CloseTextViews);
            assert!(detail.contains("text view(s)"));
        }
        other => panic!("a close reports as a context-managed event, not {other:?}"),
    }
}
