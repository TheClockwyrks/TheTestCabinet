//! **Whose failure an agent's *ending* is** — the one place a terminal status is decided, read
//! against the run's [fault latch](crate::fault).
//!
//! [`Agent::attributed`](super::Agent::attributed) closes this question for a *turn*: an error turn
//! taken while the latch is up is recorded as [`RunBroken`](crate::limits::FatalFault::RunBroken)
//! rather than as something the model did. An agent's **ending** is the same event one layer up, and
//! it used to be decided separately — each ending path picking a status from what it could see from
//! where it stood, which is the model's answer, a hook's exit code, a refused credential. On a run
//! gg had already broken, the two records of one event disagreed: the turn said gg, and the ending
//! said the model.
//!
//! That is not a cosmetic disagreement. The ending is carried into the run record's per-agent
//! provenance, and — for a spawned subagent — into the sentence its **spawner** is handed as the
//! child's final word, which is text put in front of a model. A run gg broke that tells a model
//! "the agent ended: model_error" is filing our defect in the model's column of the very
//! attribution data the run exists to produce.
//!
//! # Why a type rather than a check at each ending
//!
//! Because there are sixteen ways an agent's loop can end and there will be more. A rule enforced
//! by every one of them remembering it is a rule that holds until somebody adds the seventeenth —
//! which is exactly how the disagreement above came about, since the turn-level attribution landed
//! and the ending paths carried on as they were.
//!
//! So the *type* of a terminal status is "a status the latch has already had its say about".
//! [`TerminalStatus`] wraps its `&'static str` privately and this module is the only place one can
//! be made, so an ending path cannot state a status without naming the run it is attributed
//! against — the compiler asks the question for us. The rendered [final text](super::ended_text) is
//! derived from the same value, so the sentence a spawner reads cannot name a status the record does
//! not, and so is the [`error` line](super::model_call_failed) the operator reads beside it.
//!
//! # What the type closes, and what it does not
//!
//! It closes **"somebody forgot"**: there is no way to state a terminal status without asking the
//! attribution question first. It cannot, by itself, close **"somebody asked the wrong thing"** —
//! no Rust type tells two values of one type apart, so a `&FaultLatch` parameter would happily
//! accept a `FaultLatch::default()`, which is an *unfaulted* run and would hand every ending
//! straight back to whoever the error blamed. So the question is not asked of a latch at all: it is
//! asked of a [`FaultedRun`], which is implemented for the two run-scoped values every ending path
//! is already holding and for nothing else. Answering with a latch of one's own no longer compiles.
//!
//! What is left is an ending path that builds a whole [`LimitsSetup`](super::LimitsSetup) of its
//! own to ask, which is not something anybody does by accident. And the residual risk is narrower
//! still than that: at most of the sixteen endings the run cannot change the answer, because a
//! status that is not a failure — or that is already [`STATUS_INTERNAL_ERROR`] — comes back
//! unchanged whatever it is read against. The reading is load-bearing at exactly the endings whose
//! own status is a failure *somebody else* owns: the model-error/auth-error ending of a failed
//! model call, the three hook-error endings, and the auth-error ending of a successor whose
//! credential was refused.
//!
//! Two of those five are pinned by tests driving a broken run into them — the failed model call,
//! and the [`hook_failed`](super::hook_failed) exit that seven of the loop's hook sites share. The
//! other three are not, and it is worth saying which rather than implying a clean sweep: the two
//! hook errors reached only from *inside* a turn (one of them in code mode, which costs a component
//! compile) and the successor whose credential was refused. Each would need a scenario out of all
//! proportion to the risk, which is a line reading `&limits` in the middle of a function whose every
//! other line reads `&limits` too.
//!
//! # The rule
//!
//! A **failure** ending ([`is_failure_status`] — a model error, a refused credential, a broken
//! hook) taken while the latch is up becomes [`STATUS_INTERNAL_ERROR`]. Everything else passes
//! through unchanged, and the two halves of that are deliberate:
//!
//! * A run that broke is disqualified whatever any one agent ends as, so nothing is lost by
//!   recording a genuine model error on a broken run as gg's — that figure is on a run nobody will
//!   ever score. The failure in the other direction is a defect of ours recorded as somebody else's
//!   on a run somebody does read.
//! * A `completed` ending is **not** upgraded, because it is true: that agent declared it was done
//!   and its work is in the tree, whether or not another agent walked into a gg defect afterwards.
//!   The run-level status is read off the latch by the session epilogue, so the disqualification is
//!   recorded once, where it belongs, rather than smeared over every agent that finished before it.
//!   The ceiling endings and a cancellation pass through for the same reason, and in practice cannot
//!   coincide with a raised latch at all: the loop reads the latch at its turn boundary *before* it
//!   reads either.

#[cfg(test)]
#[path = "agent.attribution.test.rs"]
mod tests;

use std::sync::Arc;

use crate::fault::FaultLatch;

use super::{STATUS_INTERNAL_ERROR, is_failure_status};

/// A **run**, for the purpose of attributing one of its endings: whoever holds the run's
/// [fault latch](FaultLatch).
///
/// This exists so that [`attributed`](TerminalStatus::attributed) asks the *run* rather than
/// accepting a latch, for the reason the module docs give: a latch parameter cannot tell the run's
/// latch from a fresh one, and a fresh one says every ending is somebody else's. It is implemented
/// for the two values that genuinely carry the run's latch — the [orchestrator](super::Orchestrator)
/// every agent task is cloned from, and the [ceilings](super::LimitsSetup) threaded into every turn
/// loop, whose latch is a clone of the orchestrator's taken at the one place the loop is set up —
/// and deliberately for nothing else.
pub(super) trait FaultedRun {
    /// The run's [latch](FaultLatch): the first gg defect *any* agent of it met.
    fn fault(&self) -> &FaultLatch;
}

/// An `Arc`-held run is the same run. Every agent task holds the orchestrator this way, so without
/// this each of those endings would have to reach through the `Arc` by hand — a deref is not a
/// second opinion about which run this is.
impl<T: FaultedRun> FaultedRun for Arc<T> {
    fn fault(&self) -> &FaultLatch {
        (**self).fault()
    }
}

/// The terminal [`SessionEnded`](test_cabinet_core::gg::GgTelemetryKind::SessionEnded) status an
/// agent's loop ends under, **after** the run's [fault latch](FaultLatch) has had its say.
///
/// Constructed only by [`attributed`](Self::attributed), which is what makes the attribution
/// unskippable rather than customary. See the module docs for why that is worth a type.
#[derive(Debug, Clone, Copy)]
pub(super) struct TerminalStatus(&'static str);

impl TerminalStatus {
    /// The status `status` really ends an agent on, given the state of `run`: itself, unless it is
    /// a failure taken on a run gg had already broken, which is [`STATUS_INTERNAL_ERROR`] instead.
    ///
    /// It is deliberately the **run's** latch rather than "did this agent's own ending fault",
    /// because no ending path can know: a defect met by any agent of the run reaches this one as a
    /// raised latch and nothing else. That is the same reading, for the same reason, as the
    /// turn-level [`Agent::attributed`](super::Agent::attributed) — and reading it the same way is
    /// the whole point, since the two describe one event.
    ///
    /// The run is asked through [`FaultedRun`] rather than handed over as a latch so that the one
    /// thing an ending path must not be able to do — answer this question with a latch of its own,
    /// which is an unbroken run whatever the real one is doing — does not compile.
    pub(super) fn attributed(status: &'static str, run: &impl FaultedRun) -> Self {
        if is_failure_status(status) && run.fault().raised().is_some() {
            return Self(STATUS_INTERNAL_ERROR);
        }
        Self(status)
    }

    /// The status as the wire, the log lines and the session record spell it.
    pub(super) fn as_str(self) -> &'static str {
        self.0
    }

    /// Whether this ending means the agent **failed**, as opposed to finishing, exhausting a
    /// ceiling, or being killed — [`is_failure_status`] read off an attributed status, so a caller
    /// cannot ask the question of a status the latch has not seen.
    pub(super) fn is_failure(self) -> bool {
        is_failure_status(self.0)
    }
}

impl std::fmt::Display for TerminalStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}

/// Comparison against the status constants themselves, so a reader (and a test) asks
/// `status == STATUS_COMPLETED` rather than unwrapping the newtype first. The `&str` half is
/// always one of the constants above: this compares two terminal statuses, not a status against
/// arbitrary text.
impl PartialEq<&str> for TerminalStatus {
    fn eq(&self, other: &&str) -> bool {
        self.0 == *other
    }
}
