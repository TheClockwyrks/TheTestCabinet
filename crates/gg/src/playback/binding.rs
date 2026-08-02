//! The **binding table**: which live agent is which recorded agent, and the two things that follow
//! from knowing it — a recorded queue per live agent, and a
//! record-preferring tool comparison.
//!
//! # Why a table at all
//!
//! A subagent's id comes off a **global counter**, minted in the order agents happen to reach their
//! spawn. A playback removes model latency entirely, so two concurrent agents interleave
//! differently than they did and the counter hands out its ids in a different order. Every
//! id-keyed lookup a reconstruction could make is therefore wrong in exactly the way that matters
//! most: agent A is served the responses recorded for agent B, silently.
//!
//! So an agent is identified by its [provenance](GgReplayAgentOrigin) — a spawner and a spawn
//! ordinal, a predecessor and an ordinal, or board state (an issue and an attempt, a review round
//! and position, a merge ordinal). Every one of those is a function of something a reconstruction
//! re-derives on its own; none of them is the counter. The record's
//! [agent table](test_cabinet_core::gg_replay::GgReplayRecord::agents) maps provenance to the
//! recorded id, and this table adds
//! the half the record cannot have: which *live* id the reconstruction gave the agent with that
//! provenance.
//!
//! ```text
//!   live id  ──(session observer, at creation)──▶  origin  ──(record's agent table)──▶  recorded id
//! ```
//!
//! Both directions are kept, because both are asked for: the recorded shell and the tool
//! comparison hold a live id and need a queue, and the [terminal comparison](super) holds a
//! recorded row and needs to know whether the reconstruction ever produced it.
//!
//! # All five creation paths, and the one the table exists for
//!
//! [`Root`](GgReplayAgentOrigin::Root) is trivial. The other five are not, and three of them are
//! the reason a parent-keyed scheme was never enough: an [issue attempt](GgReplayAgentOrigin::IssueAttempt),
//! a [reviewer](GgReplayAgentOrigin::Reviewer) and a [merge agent](GgReplayAgentOrigin::Merge) are
//! all dispatched by gg itself with **no parent at all**. A merge agent is the row that proves the
//! point: its live id comes off the global counter and it has no spawner, so the only thing it can
//! be bound by is what it was dispatched *for*. Issue worktrees, reviewers and a required merge
//! agent are the v0.7.0 multi-agent headline, so that is not an edge case — it is the common case.
//!
//! # The fingerprint is the second, independent defence
//!
//! A mis-bound agent's very first request carries a different profile's system prompt and toolset,
//! so two [components](test_cabinet_core::gg_replay::GgFingerprintComponent) move immediately and
//! the reconstruction says so on turn one. Neither mechanism has to be perfect alone — which
//! matters, because this table is only ever as complete as the capture that wrote the record's.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use test_cabinet_core::gg_replay::{GgReplayAgentOrigin, fingerprint_exact};

use super::drift::{Drift, DriftKind, DriftLedger};
use crate::model::ToolCall;
use crate::observer::SessionObserver;
use crate::replay_inputs::{ReplayError, ReplayInputs};
use crate::tools::ToolOutcome;

/// The live ↔ recorded agent map a reconstruction fills in as it creates its agents, and the
/// observer that fills it.
///
/// Shared (`Arc`) by the recorded [client factory](super::client::RecordedClientFactory), the
/// recorded [shell](super::shell::RecordedShellRunner) and the playback's own end-of-run sweeps:
/// gg runs every agent on one runtime, and a second table that could disagree with this one would
/// be worse than no table.
#[derive(Debug)]
pub struct AgentBindings {
    /// The record's inputs — the agent table to bind against, and the queues to retire and to
    /// compare tool outcomes with.
    inputs: Arc<ReplayInputs>,
    /// Where every binding divergence is written down.
    ledger: Arc<DriftLedger>,
    /// The map, both ways.
    state: Mutex<BindingState>,
}

/// The mutable half of the [table](AgentBindings).
#[derive(Debug, Default)]
struct BindingState {
    /// Live id → recorded id, for the seams that hold a live id.
    live_to_recorded: BTreeMap<String, String>,
    /// Recorded id → live id, for the sweeps that hold a recorded row.
    recorded_to_live: BTreeMap<String, String>,
}

impl AgentBindings {
    /// An empty table over `inputs`, reporting into `ledger`.
    pub fn new(inputs: Arc<ReplayInputs>, ledger: Arc<DriftLedger>) -> Self {
        Self {
            inputs,
            ledger,
            state: Mutex::new(BindingState::default()),
        }
    }

    /// The recorded agent whose queue answers an agent created by `origin`, or `None` when the
    /// record's table has no such row.
    ///
    /// A linear scan over the table rather than a map: an origin is a small enum with no `Hash`,
    /// the table is one row per agent (tens, at the very most), and the scan is made once per agent
    /// rather than once per turn. Building an index would trade a real derive-or-encode decision
    /// for nothing measurable.
    pub fn recorded_for_origin(&self, origin: &GgReplayAgentOrigin) -> Option<&str> {
        self.inputs
            .record()
            .agents
            .iter()
            .find(|agent| &agent.origin == origin)
            .map(|agent| agent.agent_id.as_str())
    }

    /// The recorded agent a **live** agent is bound to, or `None` for a live agent the record has
    /// no row for (and for one whose creation this table was never told about).
    pub fn recorded_for_live(&self, live_id: &str) -> Option<String> {
        self.state
            .lock()
            .expect("agent bindings lock")
            .live_to_recorded
            .get(live_id)
            .cloned()
    }

    /// The live agent a **recorded** row was bound to, or `None` when the reconstruction never
    /// produced it.
    pub fn live_for_recorded(&self, recorded_id: &str) -> Option<String> {
        self.state
            .lock()
            .expect("agent bindings lock")
            .recorded_to_live
            .get(recorded_id)
            .cloned()
    }

    /// Record the pair, reporting a recorded row that two live agents both claim.
    ///
    /// A double binding is not merely surprising — it means two agents are drawing from one queue
    /// and each is being served the other's turns — so it is reported at the moment it happens
    /// rather than inferred later from the wreckage.
    fn bind(&self, live_id: &str, recorded_id: &str, origin: &GgReplayAgentOrigin) {
        let mut state = self.state.lock().expect("agent bindings lock");
        if let Some(existing) = state.recorded_to_live.get(recorded_id)
            && existing != live_id
        {
            let existing = existing.clone();
            drop(state);
            self.ledger.record(Drift::reported(
                DriftKind::UnboundAgent,
                recorded_id,
                format!(
                    "two live agents (`{existing}` and `{live_id}`) were both created by {} and \
                     would draw from one recorded queue; the later one is unbound",
                    super::client::describe_origin(origin),
                ),
            ));
            return;
        }
        state
            .live_to_recorded
            .insert(live_id.to_string(), recorded_id.to_string());
        state
            .recorded_to_live
            .insert(recorded_id.to_string(), live_id.to_string());
    }
}

#[async_trait]
impl SessionObserver for AgentBindings {
    /// Bind the agent the reconstruction just created to the recorded row with its provenance.
    ///
    /// A provenance the record has no row for is a **reported** divergence rather than a refusal:
    /// the reconstruction gained an agent the recorded run did not have, which is exactly what a
    /// resolution that failed in the run and succeeds here (a missing credential cannot recur under
    /// a record) produces. That agent's client is [unbound](super::client), so it ends loudly on
    /// its first turn and the rest of the reconstruction carries on.
    fn agent_created(&self, agent_id: &str, origin: &GgReplayAgentOrigin) {
        // A succession is the one origin that also says something about a *different* agent: the
        // predecessor named in it has handed off and will never consume another recorded input.
        // Retiring it here is what turns a barrier wait behind its leftovers into a provable
        // [deadlock](ReplayError::Deadlock) instead of a timeout, and the predecessor's own
        // `agent_ended` never comes — its loop did not end, it continued as somebody else.
        if let GgReplayAgentOrigin::Succession { predecessor, .. } = origin
            && let Some(recorded) = self.recorded_for_live(predecessor)
        {
            self.inputs.retire(&recorded);
        }
        let Some(recorded_id) = self.recorded_for_origin(origin).map(str::to_string) else {
            self.ledger.record(Drift::reported(
                DriftKind::UnboundAgent,
                agent_id,
                format!(
                    "this reconstruction created an agent by {} and the record's agent table has \
                     no row for it, so nothing can answer its turns",
                    super::client::describe_origin(origin),
                ),
            ));
            return;
        };
        self.bind(agent_id, &recorded_id, origin);
    }

    /// The agent's loop ended, so [retire](ReplayInputs::retire) its recorded queue: nobody will
    /// ever consume what is left in it, and every agent waiting behind one of its entries can be
    /// told so immediately rather than waiting out the stall ceiling.
    fn agent_ended(&self, agent_id: &str) {
        if let Some(recorded) = self.recorded_for_live(agent_id) {
            self.inputs.retire(&recorded);
        }
    }

    /// Retire the recorded `git` invocation this one corresponds to, and report it when the two are
    /// not the same command.
    ///
    /// **Nothing is served here.** A playback re-runs `git` for real — it is gg's own bookkeeping
    /// rather than model-visible non-determinism, and worktree/merge/conflict handling is loop
    /// behaviour worth exercising — so the recorded result is never fed forward. What this is for is
    /// the [barrier](ReplayInputs::await_turn), and the case is the one the whole multi-agent
    /// milestone turns on:
    ///
    /// > An [issue](https://docs.testcabinet.ai/gg/project-management/)'s accept-and-merge is a `git` sequence, it moves the **board**,
    /// > and the board is rendered into every agent's pinned prompt every turn.
    ///
    /// So the board mutates at a point that is not a served input. If the recorded `git` entries
    /// stayed in the barrier's set unconsumed, the merge would be un-ordered: whichever agent's next
    /// recorded input came first would take its turn against a board the run had already moved past,
    /// and every concurrent board record would drift on the one block that matters. Consuming them
    /// here places the merge in the recorded order exactly as a served input would.
    ///
    /// A mismatch is reported and consumed anyway. The queue is a position, not a set — leaving an
    /// entry that demonstrably did not match would answer some *later* invocation by accident and
    /// would block the barrier behind something nobody will ask for again — and the divergence that
    /// matters shows up on the next turn's conversation regardless.
    fn git_invoked(&self, agent_id: &str, command: &str) {
        // An unbound agent has no queue, and has already reported that once at its creation.
        let Some(recorded_id) = self.recorded_for_live(agent_id) else {
            return;
        };
        match self.inputs.next_git(&recorded_id) {
            Ok(recorded) if invocation_shape(&recorded.command) == invocation_shape(command) => {}
            Ok(recorded) => self.ledger.record(Drift::reported(
                DriftKind::GitInvocation,
                &recorded_id,
                format!(
                    "the record's next `git` for this agent is `{}` (seq {}) and this build ran \
                     `{command}` — gg's own bookkeeping has moved, so the recorded interleaving is \
                     being restored against a different sequence of invocations",
                    recorded.command, recorded.seq,
                ),
            )),
            Err(ReplayError::Exhausted { .. }) => self.ledger.record(Drift::reported(
                DriftKind::GitInvocation,
                &recorded_id,
                format!(
                    "this build ran `{command}` and the record has no `git` left for this agent, so \
                     the reconstruction is doing bookkeeping the run did not"
                ),
            )),
            // `ReplayInputs` parses every entry at index-build time, so nothing else can surface
            // here; reporting rather than unwrapping keeps that an assumption the ledger can
            // survive being wrong about.
            Err(err) => self.ledger.record(Drift::reported(
                DriftKind::GitInvocation,
                &recorded_id,
                format!("the recorded `git` beside `{command}` could not be read: {err}"),
            )),
        }
    }

    /// Compare the outcome this build's tool just produced against the recorded one, and feed the
    /// **record** forward when they differ.
    ///
    /// Both halves are deliberate, and neither works without the other:
    ///
    /// - **Re-running is what builds the workspace the next call reads.** An `edit_file` needs the
    ///   file the previous `write_file` made, and a `read_file` is a pure function of the workspace
    ///   and its arguments — so re-execution is both necessary and a free regression signal
    ///   (*"did we change `read_file`'s truncation footer?"* is answered by playing back any
    ///   session that read a long file).
    /// - **Preferring the record is what keeps the reconstructed context window equal to the
    ///   recorded one**, which is the entire basis on which anything extracted from a playback is
    ///   valid. A tool that legitimately answers differently here — the archetype is reading a file
    ///   a *shell* command created in the real run, which the stubbed shell created nothing of —
    ///   would otherwise send every later turn a conversation the record cannot answer.
    ///
    /// The one case that inverts the preference is a **clipped** record. A standard-fidelity
    /// capture stores the tail of an over-long tool payload plus the whole payload's
    /// [content address](test_cabinet_core::gg_replay::GgReplayTextClip::original_id), while the message pool stores what the
    /// model was shown **whole** — so feeding the tail forward would diverge the very conversation
    /// this is protecting. When the live payload's address matches the clip's, the two are the same
    /// text and the live one is the complete copy of it, so the live outcome stands.
    async fn tool_completed(&self, agent_id: &str, call: &ToolCall, outcome: &mut ToolOutcome) {
        let Some(recorded_id) = self.recorded_for_live(agent_id) else {
            // An unbound agent has no queue; its client already reported the binding failure and
            // its loop is ending. Reporting again here would put one divergence in the ledger per
            // tool call of an agent nobody could answer.
            return;
        };
        let recorded = match self.inputs.next_tool(&recorded_id) {
            Ok(recorded) => recorded,
            Err(ReplayError::Exhausted { .. }) => {
                self.ledger.record(Drift::reported(
                    DriftKind::ToolResult,
                    &recorded_id,
                    format!(
                        "this build dispatched `{}` and the record has no outcome left for this \
                         agent, so what the next turn is shown is this reconstruction's rather \
                         than the run's",
                        call.name,
                    ),
                ));
                return;
            }
            // `ReplayInputs` parses every entry at index-build time, so nothing else can surface
            // here; reporting it rather than unwrapping keeps that an assumption the ledger can
            // survive being wrong about.
            Err(err) => {
                self.ledger.record(Drift::reported(
                    DriftKind::ToolResult,
                    &recorded_id,
                    format!(
                        "the recorded outcome for `{}` could not be served: {err}",
                        call.name
                    ),
                ));
                return;
            }
        };

        if recorded.call.name != call.name {
            self.ledger.record(Drift::reported(
                DriftKind::ToolResult,
                &recorded_id,
                format!(
                    "the recorded call at this position (seq {}) is `{}` and this build dispatched \
                     `{}` — the record's tool results are no longer aligned with what the loop does",
                    recorded.seq, recorded.call.name, call.name,
                ),
            ));
        }

        match &recorded.output_clip {
            // The overwhelming majority: the record holds the whole payload, so the comparison is
            // exact and the record wins.
            None => {
                if let Some(difference) = difference(&recorded.outcome, outcome) {
                    self.ledger.record(Drift::reported(
                        DriftKind::ToolResult,
                        &recorded_id,
                        format!(
                            "`{}` (recorded at seq {}) answered differently in this \
                             reconstruction: {difference}. The recorded outcome was fed forward, \
                             so the conversation stays the run's.",
                            call.name, recorded.seq,
                        ),
                    ));
                }
                *outcome = recorded.outcome;
            }
            Some(clip) if fingerprint_exact(outcome.output.as_bytes()) == clip.original_id => {
                // Same payload, and this build has the whole of it. Keeping the live outcome is
                // what makes a clipped record playable at all.
            }
            Some(clip) => {
                self.ledger.record(Drift::reported(
                    DriftKind::ClippedRecord,
                    &recorded_id,
                    format!(
                        "`{}` (recorded at seq {}) answered differently in this reconstruction, \
                         and the record holds only the last {} of {} byte(s) of what the run's \
                         call returned — so this reconstruction fed its own outcome forward and \
                         the conversation is no longer the run's. Re-record at full fidelity to \
                         compare it.",
                        call.name,
                        recorded.seq,
                        recorded.outcome.output.len(),
                        clip.original_bytes,
                    ),
                ));
            }
        }
    }
}

/// A `git` invocation with its absolute paths dropped — what two invocations are compared on.
///
/// A playback builds in a deliberately **different** directory, and gg's own `git` puts absolute
/// paths on the command line: a worktree add names the worktree's location, a worktree remove names
/// it again. Comparing the raw text would therefore report every worktree invocation of every record
/// as changed bookkeeping, which is not a finding — it is the relocation the whole design is built
/// around, and it is exactly why a recorded working directory is stored as a
/// [`GgShellCwd`](test_cabinet_core::gg_replay::GgShellCwd) rather than as a path.
///
/// What is left is the part that is a claim about **this build**: the subcommand, its flags, and its
/// refs. A `worktree add -q -b …` that stops passing `-q`, or a `merge --no-ff` that becomes a
/// `merge`, still reports.
fn invocation_shape(command: &str) -> Vec<&str> {
    command
        .split_whitespace()
        .filter(|token| !token.starts_with('/'))
        .collect()
}

/// How two tool outcomes differ, in one sentence a reader can act on — or `None` when they do not.
///
/// Deliberately over the **model-facing** facts and nothing else: whether the call worked, the text
/// the model was shown, its one-line summary, its attached images and its failure class. The typed
/// [`ToolData`](crate::tools::ToolData) sidecar is excluded because it is computed from the same
/// locals the prose is and its own text half travels through the record's clipping pool, so
/// comparing it would report the record's fidelity as a change in this build.
fn difference(recorded: &ToolOutcome, live: &ToolOutcome) -> Option<String> {
    if recorded.ok != live.ok {
        return Some(format!(
            "the recorded call {} and this one {}",
            if recorded.ok { "succeeded" } else { "failed" },
            if live.ok { "succeeded" } else { "failed" },
        ));
    }
    if recorded.failure != live.failure {
        return Some(format!(
            "the recorded failure class is {:?} and this one is {:?}",
            recorded.failure, live.failure,
        ));
    }
    if recorded.output != live.output {
        return Some(format!(
            "the output moved ({} recorded byte(s), {} live)",
            recorded.output.len(),
            live.output.len(),
        ));
    }
    if recorded.summary != live.summary {
        return Some(format!(
            "the summary moved ({:?} recorded, {:?} live)",
            recorded.summary, live.summary,
        ));
    }
    if recorded.images.len() != live.images.len() {
        return Some(format!(
            "the recorded call attached {} image(s) and this one attached {}",
            recorded.images.len(),
            live.images.len(),
        ));
    }
    None
}

#[cfg(test)]
#[path = "binding.test.rs"]
mod tests;
