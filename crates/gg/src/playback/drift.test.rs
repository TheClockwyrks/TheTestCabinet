//! The drift matrix and the ledger.
//!
//! The matrix test is deliberately a **table** rather than a handful of cases: it is the one place
//! the design's strictness rule is written down as code, and a table makes a changed cell visible
//! as a changed row rather than as a passing test somebody deleted.

use super::*;

/// Every cell of the [matrix](self#the-matrix), asserted as the table it is.
#[test]
fn the_matrix_says_what_each_component_costs_under_each_mode() {
    use GgFingerprintComponent::{Conversation, Messages, System, Tools};
    let table = [
        (Strictness::Exact, Messages, DriftVerdict::Fatal),
        (Strictness::Exact, System, DriftVerdict::Fatal),
        (Strictness::Exact, Tools, DriftVerdict::Fatal),
        (Strictness::Exact, Conversation, DriftVerdict::Fatal),
        // Shape's principle: the same number of questions, with the same instruments.
        (Strictness::Shape, Messages, DriftVerdict::Fatal),
        (Strictness::Shape, Tools, DriftVerdict::Fatal),
        (Strictness::Shape, System, DriftVerdict::Reported),
        (Strictness::Shape, Conversation, DriftVerdict::Reported),
        // None requires nothing — but still reports everything.
        (Strictness::None, Messages, DriftVerdict::Reported),
        (Strictness::None, System, DriftVerdict::Reported),
        (Strictness::None, Tools, DriftVerdict::Reported),
        (Strictness::None, Conversation, DriftVerdict::Reported),
    ];
    for (strictness, component, expected) in table {
        assert_eq!(
            strictness.verdict(component),
            expected,
            "{strictness:?} × {component:?}"
        );
    }
}

/// Only `Exact` can produce a faithful reconstruction — the clause that makes reaching for a
/// relaxed mode visible in the one boolean every consumer reads.
#[test]
fn only_exact_can_be_faithful() {
    assert!(Strictness::Exact.can_be_faithful());
    assert!(!Strictness::Shape.can_be_faithful());
    assert!(!Strictness::None.can_be_faithful());
}

/// The ledger keeps detection order and answers "what stopped it?" with the **first** fatal
/// finding, not the last.
#[test]
fn the_ledger_reports_the_first_fatal_divergence() {
    let ledger = DriftLedger::new();
    ledger.record(Drift::reported(
        DriftKind::ClientRole,
        "root",
        "second client",
    ));
    ledger.record(
        Drift::reported(DriftKind::RecordExhausted, "root", "no turns left")
            .with_verdict(DriftVerdict::Fatal),
    );
    ledger.record(
        Drift::reported(
            DriftKind::Fingerprint(GgFingerprintComponent::System),
            "root",
            "the system prompt moved",
        )
        .with_verdict(DriftVerdict::Fatal),
    );

    let drifts = ledger.drifts();
    assert_eq!(drifts.len(), 3);
    assert_eq!(drifts[0].kind, DriftKind::ClientRole, "detection order");
    let stopped = ledger
        .stopped_on()
        .expect("a fatal divergence was recorded");
    assert_eq!(
        stopped.kind,
        DriftKind::RecordExhausted,
        "the first fatal one, not the last"
    );
}

/// A ledger with nothing fatal in it stops on nothing — the state a faithful reconstruction ends
/// in.
#[test]
fn a_ledger_with_no_fatal_finding_stops_on_nothing() {
    let ledger = DriftLedger::new();
    ledger.record(Drift::reported(
        DriftKind::TerminalStatus,
        "a1",
        "ended differently",
    ));
    assert!(ledger.stopped_on().is_none());
}

/// The rendered prompt region shows the **first** difference with context either side, which is
/// the whole reason detection alone was not enough.
#[test]
fn the_prompt_diff_renders_the_first_differing_region() {
    let recorded = (1..=20)
        .map(|n| format!("line {n}"))
        .collect::<Vec<_>>()
        .join("\n");
    let live = recorded.replace("line 10", "line 10 (edited)");

    let diff = prompt_diff_region(&recorded, &live).expect("the two prompts differ");
    assert!(diff.contains("line 10\n"), "the recorded side: {diff}");
    assert!(diff.contains("line 10 (edited)"), "the live side: {diff}");
    // Three lines of context each way, and nothing beyond it: the answer is one glance, not a
    // document.
    assert!(diff.contains("line 7"), "leading context: {diff}");
    assert!(diff.contains("line 13"), "trailing context: {diff}");
    assert!(!diff.contains("line 6"), "no more than three lines: {diff}");
    assert!(
        !diff.contains("line 14"),
        "no more than three lines: {diff}"
    );
}

/// Identical prompts render nothing — a diff is a finding, and there is nothing to find.
#[test]
fn identical_prompts_render_no_diff() {
    assert!(prompt_diff_region("you are gg", "you are gg").is_none());
}

/// A prompt that merely grew still renders: the difference is the tail, and the region starts
/// where the shorter one ended.
#[test]
fn an_appended_prompt_renders_the_tail() {
    let diff = prompt_diff_region("a\nb", "a\nb\nc").expect("the two prompts differ");
    assert!(diff.contains('c'), "{diff}");
}
