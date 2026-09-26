//! **Internal faults** — how a gg defect met by *one* agent ends the *whole* run, and why that
//! is a latch every agent reads rather than a status propagated up the spawn paths.
//!
//! # Why a run gg broke in must not be allowed to finish
//!
//! A gg run's output is **attribution data**: the tree it leaves behind is scored against the
//! model that produced it, and compared against the tree another configuration produced. A run
//! gg's own machinery broke in did not produce that tree. Somewhere in it is work an agent was
//! stopped in the middle of, or work the rest of the run went on to do around the hole — and
//! nothing downstream can tell the difference between that tree and a clean one. The run reads
//! like a result while being a measurement of gg's defect, which is worse than no result at all:
//! a missing run is visible, and a wrong one that looks fine is not.
//!
//! So the first gg defect **anywhere** in the tree ends the run, whichever agent met it, and the
//! session's terminal status is `internal_error` so `core` records a harness error instead of
//! collecting a tree to score. Recording a defect below the root as nothing more than a failed node
//! in a session that carries on is exactly the shape ruled out above: the failed node is the part
//! that is visible, and the tree around it is the part that gets scored.
//!
//! # The wind-down is [cancellation](crate::cancel)'s
//!
//! Every agent reads this latch at its own turn boundary, next to the
//! [cancellation sentinel](crate::cancel) and the two run-wide [ceilings](crate::limits), on the
//! same terms and for the same reasons: a turn is the loop's atomic unit, so the wind-down bound
//! is one turn per agent and no turn is ever abandoned half-applied. What the run keeps is
//! therefore what a killed run keeps — every event already emitted, the per-slot rollups, the
//! session summary and the session record — which is the whole of what an operator debugs a gg
//! defect from. Killing the tree outright would destroy the evidence for the bug the run just
//! found.
//!
//! There is one agent a boundary cannot reach: one gg has **suspended**. An agent
//! blocked in a `wait_for_issue` is inside a tool call, and the only thing that ends that call is
//! the awaited issue reaching a terminal state — which a faulted run has stopped bringing about,
//! since it dispatches nothing further. So the latch is also **awaitable**
//! ([`FaultLatch::until_raised`]), and every suspended wait is armed with it: the wait ends on
//! whichever comes first, its own condition or the run breaking. A released agent then rejoins the
//! scheduler's queue exactly as a woken one does and winds down at the boundary it finally reaches,
//! which is what keeps the bound at one turn per agent for suspended and running agents alike.
//!
//! One defect cannot be met that way, and it is the reason [`crate::agent`] has a teardown: an
//! agent whose task **panicked** never reaches another boundary to read this from, because the
//! frame that would read it is the one being unwound. That fault is raised on the agent's behalf by
//! the seam above its loop, which also has to do the waking and the slot release the agent itself
//! would have done — so a latch nobody is left running to read still ends the run.
//!
//! One defect of gg's is deliberately **not** raised here, and it is worth naming so the rule reads
//! as a rule rather than as wherever somebody remembered to latch: a panicked
//! [capture](crate::capture) writer thread. The journal it was filling is a sidecar for debugging a
//! run, not part of the tree the run is scored on — so what that panic costs is some replay, and
//! ending the run over it would throw a real result away to protect a debugging aid. It is reported
//! as a write failure instead, on the report the operator reads, which is the half that must not be
//! lost: a short journal claiming to be whole would be this module's own kind of lie.
//!
//! It is **not** recorded as a cancellation. Nobody stopped this run: `canceled` is the one status
//! that says a human intervened and says nothing about the model, and reporting our own defect as
//! an operator's decision would hide the bug in the one field a study reads to find out why runs
//! stop.
//!
//! # Why it is not [`CancelWatch`](crate::cancel::CancelWatch)
//!
//! The two are checked at one boundary and wind the run down identically, and they are still
//! different things. A cancellation is an **input**: a file the host may create at any moment,
//! which a [replay](crate::capture) has to record probe by probe because nothing else in the
//! record explains why a session stopped. A fault is gg's own state, raised from inside this
//! process by a site that has already said what it met on the stream, so a recorded probe would
//! be a reconstruction of something the record already holds. And a fault carries a **diagnostic**
//! — which agent, which profile, what broke — where a sentinel carries only its own existence.

#[cfg(test)]
#[path = "fault.test.rs"]
mod tests;

use std::any::Any;
use std::sync::{Arc, OnceLock};

use tokio::sync::Notify;

/// What a panic said, as far as its payload knows.
///
/// A `panic!` with a formatted message carries a `String` and one with a literal carries a
/// `&'static str`; anything else is a `panic_any` of a type this cannot read, which nothing in gg
/// does. The fallback still produces a sentence, because a diagnostic that named where gg broke and
/// then said nothing about what happened would be barely better than the status alone.
///
/// The **location** is not here because a payload does not carry one — only the process-wide panic
/// hook sees it, and it has already printed the whole panic, location and all, to the harness's
/// stderr. What this is for is the half that has to reach the run record.
///
/// It lives beside the latch because both readers of it are reporting the same thing: a
/// [panicked agent](crate::agent), and a panicked [capture](crate::capture) writer thread.
pub fn panic_message(payload: &(dyn Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&'static str>() {
        return (*message).to_string();
    }
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }
    "a panic carrying no readable message".to_string()
}

/// The run-wide record of gg's **first** defect: the diagnostic, if one has been raised.
///
/// Cloning shares the latch (it is `Arc`-backed), so the agent that met the defect and every agent
/// winding down because of it are reading one decision rather than each discovering the fault
/// separately — which they could not do anyway, since a defect happens to one agent.
///
/// A [`Default`] latch is an unfaulted run, which is almost every run: no call site needs an
/// `Option`.
#[derive(Debug, Clone, Default)]
pub struct FaultLatch {
    /// The first diagnostic raised, or unset. `OnceLock` is the type of the rule: **first fault
    /// wins**, and a later one cannot overwrite it.
    fault: Arc<OnceLock<String>>,
    /// Fired once, when the first fault is latched, to release every agent that is
    /// [awaiting the latch](FaultLatch::until_raised) rather than reading it at a turn boundary.
    ///
    /// A turn boundary is where an agent that is *running* meets the fault, and it is enough for
    /// every agent that is running. It is not enough for an agent gg has **suspended**: an agent
    /// blocked in a `wait_for_issue` is inside a tool call, so it reaches no boundary until its
    /// wait resolves, and the thing its wait resolves on — a board issue reaching a terminal state
    /// — is exactly what a faulted run stops making happen. Without a wake-up of its own such an
    /// agent is parked for the rest of the run: its session future never returns, no session
    /// ending is ever emitted, and the host eventually records the run as hung, which is neither
    /// gg's status nor a run anybody can debug.
    wake: Arc<Notify>,
}

impl FaultLatch {
    /// Record that `agent_id`, running under `profile`, walked into a gg defect, `detail` being
    /// the site's own words for it.
    pub fn in_agent(&self, agent_id: &str, profile: &str, detail: impl std::fmt::Display) {
        self.latch(format!(
            "gg broke while running agent `{agent_id}` (profile `{profile}`): {detail}"
        ));
    }

    /// Record that gg could not stand an agent up for board issue `issue_id` at all, `profile`
    /// being the assignee or reviewer it was reaching for when there is one.
    ///
    /// Held apart from [`in_agent`](Self::in_agent) because no agent ran: there is no instance to
    /// name, and the issue is what an operator will be looking at on the board. The consequence is
    /// the same, and for the same reason — the run's tree is missing whatever that issue was for,
    /// and nothing in the record it leaves says the work was ever attempted.
    pub fn in_dispatch(
        &self,
        issue_id: &str,
        profile: Option<&str>,
        detail: impl std::fmt::Display,
    ) {
        let assignee = profile
            .map(|profile| format!(" (agent `{profile}`)"))
            .unwrap_or_default();
        self.latch(format!(
            "gg broke dispatching issue `{issue_id}`{assignee}: {detail}"
        ));
    }

    /// The diagnostic for the run's first gg defect, or `None` while the run is healthy — read by
    /// every agent at its turn boundary, and by the session epilogue to decide the run's terminal
    /// status.
    pub fn raised(&self) -> Option<&str> {
        self.fault.get().map(String::as_str)
    }

    /// Resolve once a fault has been raised — **immediately** if one already has, otherwise the
    /// moment the first one is.
    ///
    /// This is the half of the latch a **suspended** agent reads: something that is awaited beside
    /// whatever else it is waiting for, so that a wait gg's own defect has made unsatisfiable ends
    /// anyway. See [`wake`](Self::wake) for why a turn boundary cannot serve that agent.
    ///
    /// **No test holds the ordering below, and none can.** The window it closes is the few
    /// instructions between the read and the registration, and the only thing that fits in it is a
    /// [`latch`](Self::latch) running on another thread at that instant. Reversing the two lines
    /// leaves every *observable* behaviour of this future identical — a `Notified` that was never
    /// enabled registers on its first poll, which is inside the same uninterrupted poll as the
    /// read — so a caller cannot tell the versions apart by polling, and there is no seam to
    /// schedule the race at. What holds it is the argument, which is why the argument is written
    /// out rather than left to a test name.
    pub async fn until_raised(&self) {
        // Registered *before* the latch is read: `Notify::notify_waiters` wakes only the waiters
        // registered at the instant it fires, so a fault raised between the read and the
        // registration would be missed and this would go on waiting for a second fault that a
        // one-shot latch can never produce.
        let mut waiting = std::pin::pin!(self.wake.notified());
        waiting.as_mut().enable();
        if self.raised().is_some() {
            return;
        }
        waiting.await;
    }

    /// Latch one composed diagnostic.
    ///
    /// **The first fault wins and later ones are dropped.** Once a run is winding down, everything
    /// gg's machinery reports afterwards is downstream of the first fault — an agent stopped
    /// mid-delegation, an issue whose implementer never ran — and the diagnostic worth keeping is
    /// the one that names where the run actually broke. A latch that recorded the last fault would
    /// hand the operator the consequence and throw away the cause.
    ///
    /// The sentences are composed by the two methods above rather than by their call sites, so
    /// every fault reaches the operator naming **where** gg was as well as what it met. A detail
    /// alone is not enough to debug from: it says a profile could not be resolved without saying
    /// which node of the tree, or which issue, was waiting on it.
    ///
    /// The wake-up rides on the *winning* set, which is the one moment the run's answer changes
    /// from "healthy" to a diagnostic. Every [awaiting agent](Self::until_raised) is released here,
    /// wherever in the run it is suspended, rather than by each fault site remembering to release
    /// the agents its own defect stranded.
    fn latch(&self, sentence: String) {
        if self.fault.set(sentence).is_ok() {
            self.wake.notify_waiters();
        }
    }
}
