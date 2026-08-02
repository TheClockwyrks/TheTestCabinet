//! The **session observer**: the one hook a session offers into per-agent events that are not
//! inputs, so a [playback](crate::playback) can bind live agents to recorded ones and compare
//! re-executed tool outcomes against the record.
//!
//! # Why this is not a third seam
//!
//! gg has exactly [two seams](crate::agent::SessionSeams) — the model call and the shell — and they
//! travel together in one parameter precisely so half of a substitution cannot be assembled by
//! accident. This is deliberately *not* one of them, and the distinction is worth stating because
//! a reader who mistakes it for one will look for the guarantee that pairing provides:
//!
//! - a seam **substitutes** an input the session cannot compute for itself. Getting one wrong makes
//!   real, paid API calls or runs a real `npm install` against a scratch tree;
//! - an observer **watches** things the session computes for itself, and may correct one of them.
//!   A session with no observer is byte-for-byte the session it has always been, which is why the
//!   field defaults to absent rather than to a named no-op pairing.
//!
//! # The four events, and why exactly these four
//!
//! Each one exists because a reconstruction cannot derive it any other way:
//!
//! - [`agent_created`](SessionObserver::agent_created) is the **only** place a live agent's id and
//!   its [provenance](GgReplayAgentOrigin) are both in hand. The id comes off a global counter in
//!   the order agents reach their spawn, so a reconstruction assigns it differently; the origin is
//!   a function of a parent's own ordered turn loop or of board state, so a reconstruction
//!   re-derives it exactly. Bringing the two together here is what lets everything downstream —
//!   the recorded shell's per-agent queues, the terminal comparison — speak in live ids and read
//!   recorded ones.
//! - [`agent_ended`](SessionObserver::agent_ended) is what makes a stalled
//!   [ordering barrier](crate::replay_inputs::ReplayInputs::await_turn) *provable*: an agent
//!   waiting behind an input a finished agent owed can be told so immediately rather than waiting
//!   out a timeout.
//! - [`tool_completed`](SessionObserver::tool_completed) is the one point every dispatched call
//!   funnels through with its final outcome — the same choke point replay capture records at. A
//!   playback re-executes the tool for real (which is what builds the workspace the next call
//!   reads) and then **prefers the record**, because the reconstructed context window has to equal
//!   the recorded one for anything extracted from a playback to be valid.
//!
//! - [`git_invoked`](SessionObserver::git_invoked) is the one *ordering* event. gg's own `git` runs
//!   for real under a playback — it is bookkeeping rather than model-visible non-determinism — but
//!   it is not therefore invisible to a reconstruction: an [issue](https://docs.testcabinet.ai/gg/project-management/)'s accept-and-merge
//!   is a `git` sequence that moves the **board**, and the board is rendered into every agent's
//!   pinned prompt. So a reconstruction has to know when the run's recorded `git` invocations have
//!   been overtaken, which is what tells the
//!   [barrier](crate::replay_inputs::ReplayInputs::await_turn) that a merge has landed and the next
//!   agent may have its turn. Without it, the barrier orders only what it *serves*, and every
//!   concurrent board run drifts on the one block that matters.
//!
//! Only [`tool_completed`](SessionObserver::tool_completed) is `async`, because only it has a queue
//! to wait on.

use async_trait::async_trait;
use test_cabinet_core::gg_replay::GgReplayAgentOrigin;

use crate::model::ToolCall;
use crate::tools::ToolOutcome;

/// Watches a session's agents come into existence, end, and finish tool calls.
///
/// Every method has a no-op default, so an implementor writes only the events it has a use for and
/// a later event costs existing implementors nothing.
#[async_trait]
pub trait SessionObserver: Send + Sync + std::fmt::Debug {
    /// An agent came into existence: `agent_id` is the id this run minted for it, and `origin` is
    /// how it came to exist.
    ///
    /// Called once per agent, before its first turn — including for an agent whose loop never runs
    /// a turn at all.
    fn agent_created(&self, agent_id: &str, origin: &GgReplayAgentOrigin) {
        let _ = (agent_id, origin);
    }

    /// An agent's loop ended and it will never ask for another input.
    fn agent_ended(&self, agent_id: &str) {
        let _ = agent_id;
    }

    /// `agent_id` finished a `git` invocation — `command` as the record spells it (`git <args>`).
    ///
    /// Reported **after** the process exited, at the same choke point capture records at, so an
    /// observer sees exactly the invocations a record holds and in the order a record holds them.
    /// The result is deliberately not offered: a playback re-runs `git` for real, so there is
    /// nothing here for a caller to substitute — what this event carries is *when*, not *what*.
    fn git_invoked(&self, agent_id: &str, command: &str) {
        let _ = (agent_id, command);
    }

    /// A dispatched tool call produced its final outcome, after any
    /// [agent-managed-context](crate::agent) reclaim rewrote it.
    ///
    /// `outcome` is `&mut` because the one implementor that exists **replaces** it: a playback
    /// re-runs the tool for real and then feeds the *recorded* outcome forward, which is what keeps
    /// the reconstructed conversation equal to the recorded one. An observer that only watches
    /// leaves it untouched.
    async fn tool_completed(&self, agent_id: &str, call: &ToolCall, outcome: &mut ToolOutcome) {
        let _ = (agent_id, call, outcome);
    }
}
