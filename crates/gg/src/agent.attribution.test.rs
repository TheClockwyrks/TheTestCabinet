//! The [ending attribution](super) rule itself, stated once against a latch that is up and once
//! against one that is not.
//!
//! The loop tests prove the rule reaches an agent's ending and its final word; these prove the rule.
//! They are cheap enough to enumerate every status, which is what stops the next status added to the
//! vocabulary from being attributed by accident.

use super::*;

use crate::agent::{
    STATUS_AUTH_ERROR, STATUS_CANCELED, STATUS_COMPLETED, STATUS_EXHAUSTED, STATUS_HOOK_ERROR,
    STATUS_LIMIT_EXCEEDED, STATUS_MODEL_ERROR, STATUS_TIMED_OUT,
};

/// A run that is nothing but its [latch](FaultLatch) — which is the whole of what an attribution
/// reads.
///
/// The real implementors of [`FaultedRun`] are the orchestrator and the loop's
/// [ceilings](crate::agent::LimitsSetup), neither of which can be built in three lines and neither
/// of which would change a single answer below. It is `#[cfg(test)]`, like everything in this file,
/// so the seam production code has is still exactly the two run-scoped values.
struct TestRun(FaultLatch);

impl FaultedRun for TestRun {
    fn fault(&self) -> &FaultLatch {
        &self.0
    }
}

/// A run nothing has broken, as almost every agent of almost every run sees it.
fn healthy() -> TestRun {
    TestRun(FaultLatch::default())
}

/// A run with a fault already latched, as every agent of a broken run sees it.
fn broken() -> TestRun {
    let run = healthy();
    run.0.in_agent("agent-2", "reviewer", "its task panicked");
    run
}

/// **On a healthy run every ending is its own.**
///
/// The control the rest of the file is read against: a latch nobody has raised changes nothing at
/// all, which is every ending of almost every run.
#[test]
fn a_healthy_run_leaves_every_ending_alone() {
    let healthy = healthy();
    for status in [
        STATUS_COMPLETED,
        STATUS_EXHAUSTED,
        STATUS_TIMED_OUT,
        STATUS_LIMIT_EXCEEDED,
        STATUS_CANCELED,
        STATUS_MODEL_ERROR,
        STATUS_AUTH_ERROR,
        STATUS_HOOK_ERROR,
        STATUS_INTERNAL_ERROR,
    ] {
        assert_eq!(
            TerminalStatus::attributed(status, &healthy),
            status,
            "nothing broke, so `{status}` is the whole account of how the agent ended"
        );
    }
}

/// **Every failure ending taken on a broken run is gg's.**
///
/// The three that are somebody else's on a healthy run are the point: a provider that refused, a
/// credential that was rejected and an operator's script that exited non-zero are all things that
/// happen *around* a run gg had already broken, and none of them is what disqualified it. Filing any
/// of them as the agent's ending puts our defect in somebody else's column.
#[test]
fn a_broken_run_attributes_every_failure_ending_to_gg() {
    let broken = broken();
    for status in [
        STATUS_MODEL_ERROR,
        STATUS_AUTH_ERROR,
        STATUS_HOOK_ERROR,
        STATUS_INTERNAL_ERROR,
    ] {
        let attributed = TerminalStatus::attributed(status, &broken);
        assert_eq!(
            attributed, STATUS_INTERNAL_ERROR,
            "`{status}` on a run gg broke is gg's"
        );
        assert!(
            attributed.is_failure(),
            "and it is still an agent that failed"
        );
    }
}

/// **A run gg broke does not rewrite the endings agents genuinely reached.**
///
/// The disqualification belongs to the session, which reads the latch itself. An agent that declared
/// it was done did the work that is in the tree, and one a ceiling or a host stopped was stopped by
/// the thing that stopped it — restating the fault on each of them would lose that, and would tell a
/// spawner its child failed when the child finished.
#[test]
fn a_broken_run_leaves_a_non_failure_ending_as_it_was() {
    let broken = broken();
    for status in [
        STATUS_COMPLETED,
        STATUS_EXHAUSTED,
        STATUS_TIMED_OUT,
        STATUS_LIMIT_EXCEEDED,
        STATUS_CANCELED,
    ] {
        let attributed = TerminalStatus::attributed(status, &broken);
        assert_eq!(
            attributed, status,
            "`{status}` says what this agent did, which a fault elsewhere does not change"
        );
        assert!(
            !attributed.is_failure(),
            "and it is not an agent that failed"
        );
    }
}
