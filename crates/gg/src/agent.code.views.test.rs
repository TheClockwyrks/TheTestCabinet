//! Tests for what the [view](crate::sandbox) caps decide.
//!
//! Every one of these asserts on the **words** as well as the classification, because a cap that
//! refuses without naming itself is a cap the model cannot work around. The whole reason a breach is
//! a catchable `limit-exceeded` rather than a silent truncation is that the model can split the
//! material, trim it, or write it to a file and open a file view of that — but only if the refusal
//! tells it which ceiling it hit.

use super::*;
use crate::context::EvictionResult;
use crate::sandbox::SandboxLimits;

/// The open-image-view cap an agent that configures no `imageViewCap` runs under — read from the
/// [ceilings](SandboxLimits) rather than restated, so a change to the default cannot leave these
/// cases asserting against a number nothing uses.
fn default_cap() -> usize {
    SandboxLimits::default().image_view_cap
}

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

// ---------------------------------------------------------------------------
// The open-image-view cap
// ---------------------------------------------------------------------------

/// Under the ceiling, nothing is refused — including the call that fills the last slot.
#[test]
fn the_image_cap_admits_everything_up_to_the_ceiling() {
    for open in 0..default_cap() {
        assert!(
            image_view_refusal(default_cap(), open, false).is_none(),
            "{open} open image views is under the cap"
        );
    }
}

/// **At the ceiling a new picture is refused — and the refusal names the cap and the remedy.**
///
/// A refusal the model cannot act on is a truncation with extra steps: it has to know both which
/// ceiling it hit and that the way out is a close it can actually perform. It also has to be told
/// that nothing happened, because the alternative reading — that the view was opened without its
/// picture — is exactly the shipped defect this replaced.
///
/// The cap names itself by its **configured** name, `imageViewCap`, and not by a Rust constant:
/// there is no longer a constant to name, and an operator reading the transcript can find the knob
/// that produced this number in the run's own configuration.
#[test]
fn the_image_cap_refuses_a_new_picture_and_names_the_way_out() {
    let refusal =
        image_view_refusal(default_cap(), default_cap(), false).expect("the window is full");
    assert_eq!(refusal.failure, ToolFailure::LimitExceeded);
    assert!(refusal.message.contains("imageViewCap"));
    assert!(
        refusal.message.contains("4"),
        "the number in force has to be in the message, not just the name of the knob: {}",
        refusal.message
    );
    assert!(
        refusal.message.contains("view.close(path)"),
        "the model has to be told what to close: {}",
        refusal.message
    );
    assert!(
        refusal.message.contains("no view was opened"),
        "a refusal must not read as a view that opened without its picture: {}",
        refusal.message
    );
}

/// **The cap that is enforced is the configured one, whatever the default says.**
///
/// A configured arm is only an arm if the number it set is the number the refusal uses: a cap of two
/// admits the second picture and refuses the third, and a cap of eight admits what the default would
/// have refused.
#[test]
fn the_configured_cap_is_the_one_enforced() {
    assert!(
        image_view_refusal(2, 1, false).is_none(),
        "under a cap of 2"
    );
    let refusal = image_view_refusal(2, 2, false).expect("a cap of 2 is spent at 2");
    assert!(
        refusal.message.contains('2'),
        "the configured number, not the default, is what the model is told: {}",
        refusal.message
    );
    assert!(
        image_view_refusal(8, default_cap(), false).is_none(),
        "a wider arm admits what the default would refuse"
    );
}

/// A cap of **zero** refuses the very first picture, rather than wrapping into something permissive.
///
/// The [resolver](crate::sandbox::resolve_sandbox_limits) never produces zero from a param — a zero
/// param reads as "not configured" — but the decision itself must not depend on that, since a cap
/// arriving from anywhere else would then silently mean "unlimited".
#[test]
fn a_cap_of_zero_refuses_the_first_picture() {
    assert!(image_view_refusal(0, 0, false).is_some());
}

/// **Re-opening a path that is already an open image view is never refused.**
///
/// It replaces an occupant rather than adding one, so the count does not move. Refusing it would
/// leave an agent at exactly the ceiling unable to refresh any of the mockups holding it there —
/// the same carve-out the open-text-view cap makes for a label that is already open.
#[test]
fn the_image_cap_admits_a_supersede_at_exactly_the_ceiling() {
    assert!(
        image_view_refusal(default_cap(), default_cap(), true).is_none(),
        "re-opening an open image view replaces one; it does not add one"
    );
    assert!(
        image_view_refusal(default_cap(), default_cap() + 3, true).is_none(),
        "a window somehow over the cap can still be refreshed, which is how it gets back under it"
    );
}
