//! **A panicked agent** — the one gg defect the agent that meets it cannot report, and the seam
//! that reports it instead.
//!
//! Every other defect of gg's own is met by an agent that is still running: it says what it met on
//! its own stream, raises the run's [fault latch](crate::fault), and every other agent reads that
//! latch at its next turn boundary and winds down. A **panic** is the one case that machinery
//! cannot cover, because the agent it strikes never reaches another turn boundary — the frame that
//! would have read the latch is the frame being unwound. It is not a hypothetical: gg reads every
//! one of its own locks with `.expect("… lock")`, and a single panic while one is held poisons it
//! for every agent that touches it afterwards.
//!
//! # What an uncaught panic leaves behind
//!
//! Exactly the two outcomes the [latch](crate::fault) exists to rule out. The task dies holding its
//! running slot, without flipping `finished`, without delivering a return value, and without
//! signalling its spawner, so:
//!
//! - a parent blocked in `wait_for_subagents` waits to the run's wall-clock deadline and the session
//!   ends `timed_out`, a ceiling status a reader attributes to the model; and
//! - when nobody is waiting, the session runs to its natural end, reports `completed`, and is
//!   **scored** — with that agent's work missing from the tree and nothing in the record saying so.
//!
//! # So the seam above the loop finishes what the agent could not
//!
//! [`run_agent`] catches the unwind one frame above the turn loop and hands it here. Everything the
//! agent would have done on its way out is done by [`AgentTeardown`] instead: the fault is latched
//! (so the run ends `internal_error` and exits non-zero, whichever agent panicked and whatever the
//! root goes on to do), whoever was waiting on this agent is woken *now* rather than at the
//! deadline, and the running slot — with the [exclusivity key](crate::subagents::ExclusiveKey) it was held under — is
//! returned to the [scheduler](Scheduler) so the rest of the tree is not capped out by an agent
//! that no longer exists.
//!
//! That is why the teardown **owns** those wires rather than borrowing them for the panic path: the
//! exclusivity key, the spawner's [wait condition](ParentWait), the result channel and the
//! `finished` flag are read here on both paths — the ordinary return calls
//! [`returned`](AgentTeardown::returned) or [`released`](AgentTeardown::released) — so there is one
//! account of what ending an agent means and no way for the panic path to drift from it.
//!
//! # What is lost, and what is not
//!
//! The panicked incarnation's turn count, tokens and cost died with the frame that held them, so
//! the [`LoopEnd`] this hands back carries none of them. Nothing is invented in their place: the
//! per-turn [`Usage`](GgTelemetryKind::Usage) events the agent already emitted are on the stream,
//! and the session summary is folded from the telemetry rather than from this value. The one figure
//! that understates is the closing log line's turn count, on a run that is being disqualified
//! rather than measured.
//!
//! The panic's **message** is carried into the diagnostic; its source location is not, because a
//! payload does not hold one — only the process-wide panic hook sees it, and it has already printed
//! the whole panic, location included, to the harness's stderr.

use super::*;

use std::any::Any;

use crate::fault::panic_message;

/// The three wires a spawned agent answers its spawner on, held together because they are used
/// together: whichever way the agent ends, all three are touched in this order or none is.
///
/// Only a [`Sub`](AgentRole::Sub) agent has them. The root answers to nobody, and an
/// [issue](AgentRole::Issue) agent answers to the board rather than to a spawner.
pub(super) struct SpawnerLink {
    /// The spawner's wait condition, signalled as this agent finishes — which is what wakes a
    /// parent blocked in `wait_for_subagents`, and what releases this agent's running slot.
    pub(super) parent_wait: Arc<ParentWait>,
    /// The channel this agent's [return value](AgentReturn) is delivered on. Dropped without a send
    /// when the agent panicked: a synthesized return would tell the spawner the child answered.
    pub(super) result: oneshot::Sender<AgentReturn>,
    /// Flipped when the agent's loop ends, so its spawner's `send_message` refuses to message an
    /// agent that has returned.
    pub(super) finished: Arc<AtomicBool>,
}

/// What ending one agent means — held by [`run_agent`] outside the frame that can panic, so that a
/// panicked agent ends the same way a returning one does.
pub(super) struct AgentTeardown {
    /// The run this agent belongs to: its [fault latch](crate::fault), its
    /// [scheduler](Scheduler) and — for an issue agent — its [board].
    orch: Arc<Orchestrator>,
    /// The agent as it stands **now**, re-pointed at each [succession](Handoff) so a diagnostic
    /// names the instance that actually panicked rather than the one that started.
    agent: Agent,
    /// How that instance came to exist, kept beside it for the same reason and for the terminal
    /// [provenance row](record_session_agent) this writes when the agent panicked.
    origin: GgSessionAgentOrigin,
    /// The current instance's stream, set once its emitter exists. `None` only in the sliver before
    /// the first incarnation opens one — a panic there is still latched and still wakes the
    /// spawner; it simply has no per-agent node to say so on.
    emitter: Option<Emitter>,
    /// The [exclusivity key](crate::subagents::ExclusiveKey) the running slot is held under, `None` for an ordinary
    /// agent. Owned here rather than in the loop because it is what a release must be made with:
    /// a slot returned under the wrong key leaves a [persistent](crate::persistence) profile
    /// pinned for the rest of the run.
    exclusive: Option<String>,
    /// Whether the running slot is still held. Cleared by whichever path releases it, so a panic
    /// *after* an ordinary release — in an issue's reconciliation, say — cannot hand the scheduler
    /// a second release of one slot.
    slot_held: bool,
    /// What this agent owes on its way out, by role.
    role: TeardownRole,
}

/// The role-specific half of a teardown: who is waiting on this agent.
enum TeardownRole {
    /// The root, which nothing waits on — the session joins the tree after it returns.
    Root,
    /// An [issue](crate::board) agent. Nobody holds a handle to it, but agents may be blocked in
    /// `wait_for_issue` on the issue it is implementing, and the board is what says whether that
    /// work happened.
    Issue {
        /// The issue this agent was dispatched to implement.
        issue_id: String,
    },
    /// A spawned subagent, holding its spawner's wires until it answers on them. `None` once it
    /// has: an agent answers exactly once.
    Sub(Option<SpawnerLink>),
}

impl AgentTeardown {
    /// Take the agent's ending wires out of its `role` and resolve the
    /// [exclusivity key](Orchestrator::exclusive_key) its slot will be held under.
    ///
    /// Built **before** the slot is acquired and outside the frame that drives the agent, which is
    /// the whole point: every state the panic path needs has to be somewhere the panic does not
    /// unwind through.
    pub(super) fn new(
        orch: &Arc<Orchestrator>,
        agent: &Agent,
        origin: &GgSessionAgentOrigin,
        role: &mut AgentRole,
    ) -> Self {
        let teardown_role = match role {
            AgentRole::Root => TeardownRole::Root,
            AgentRole::Issue { issue_id, .. } => TeardownRole::Issue {
                issue_id: issue_id.clone(),
            },
            AgentRole::Sub { link, .. } => TeardownRole::Sub(link.take()),
        };
        Self {
            orch: Arc::clone(orch),
            agent: agent.clone(),
            origin: origin.clone(),
            emitter: None,
            exclusive: orch.exclusive_key(&agent.slot),
            slot_held: false,
            role: teardown_role,
        }
    }

    /// Record that the agent now holds a running slot, so a panic gives it back.
    ///
    /// Separate from construction because an agent parked behind the parallelism cap holds nothing:
    /// a release it never earned would hand the scheduler a slot that was not this agent's and free
    /// an [exclusivity key](crate::subagents::ExclusiveKey) another instance of the profile may be running under.
    pub(super) fn acquired(&mut self) {
        self.slot_held = true;
    }

    /// The [exclusivity key](crate::subagents::ExclusiveKey) the slot is held under — every release in the loop reads
    /// it from here.
    pub(super) fn exclusive(&self) -> Option<&str> {
        self.exclusive.as_deref()
    }

    /// The same key as an owned value, for the [delegation context](AgentCtx::exclusive) that frees
    /// this agent's slot from inside a `wait_for_subagents`.
    pub(super) fn exclusive_owned(&self) -> Option<String> {
        self.exclusive.clone()
    }

    /// Point the teardown at this incarnation's stream, so a panic is reported on the panicking
    /// agent's own node in the tree and not only at run level.
    pub(super) fn on_stream(&mut self, emitter: &Emitter) {
        self.emitter = Some(emitter.clone());
    }

    /// Re-point the teardown at the successor a [succession](Handoff) produced, whose slot is the
    /// same one under a (possibly) different key — [exchanged](Scheduler::rekey), never released,
    /// by the caller.
    pub(super) fn succeeded(
        &mut self,
        agent: &Agent,
        origin: &GgSessionAgentOrigin,
        exclusive: Option<String>,
    ) {
        self.agent = agent.clone();
        self.origin = origin.clone();
        self.exclusive = exclusive;
    }

    /// The ordinary ending for an agent nobody collects a return value from — the root, and an
    /// issue agent whose reconciliation runs after this: give the running slot back.
    pub(super) fn released(&mut self) {
        if self.slot_held {
            self.slot_held = false;
            self.orch.scheduler.release(self.exclusive.as_deref());
        }
    }

    /// The ordinary ending for a spawned subagent: flip `finished` and deliver `returned` **before**
    /// signalling the spawner, so by the time the spawner is woken its collect finds the result
    /// ready. Signalling releases the slot, which is why this does not also call
    /// [`released`](Self::released).
    pub(super) fn returned(&mut self, returned: AgentReturn) {
        let TeardownRole::Sub(link) = &mut self.role else {
            debug_assert!(
                false,
                "only a spawned subagent returns a value to a spawner"
            );
            return;
        };
        let Some(link) = link.take() else {
            debug_assert!(false, "an agent answers its spawner exactly once");
            return;
        };
        link.finished.store(true, Ordering::SeqCst);
        let _ = link.result.send(returned);
        self.slot_held = false;
        link.parent_wait.child_completed(
            &self.orch.scheduler,
            &self.agent.id,
            self.exclusive.as_deref(),
        );
    }

    /// Finish an agent whose task **panicked**: latch the fault, say so where the agent's failure
    /// belongs, wake whatever was waiting on it, and hand back the [`LoopEnd`] its caller was
    /// promised.
    ///
    /// The order is deliberate. The fault is latched first, so an agent woken by the steps below
    /// reads a run that has already faulted at its next boundary rather than racing it. The agent's
    /// own stream and its terminal provenance row come next, while nothing is waiting on them. Only
    /// then is anybody woken — the same rule an ordinary return follows, for the same reason: what
    /// a waiter finds must already be there when it wakes.
    pub(super) fn panicked(&mut self, payload: &(dyn Any + Send)) -> LoopEnd {
        let detail = format!("its task panicked: {}", panic_message(payload));
        self.orch
            .fault
            .in_agent(&self.agent.id, &self.agent.slot, &detail);

        let end = LoopEnd {
            status: STATUS_INTERNAL_ERROR,
            // Not "this agent took no turns": the count, the tokens and the cost died with the
            // frame that was keeping them. See the module docs for what still reports them.
            turns: 0,
            tokens: TokenCounts::default(),
            cost: None,
            slot: self.agent.slot.clone(),
            // The agent's last word, phrased for any of the three roles: this value reaches a
            // spawner only through a return that a panicked agent never makes, so what reads it is
            // the run's own epilogue when the panicked agent was the root.
            final_text: Some(format!("(agent ended: {STATUS_INTERNAL_ERROR}; {detail})")),
            ending: None,
            limit: None,
            handoff: None,
        };
        if let Some(emitter) = &self.emitter {
            emitter.emit(log(
                "error",
                format!(
                    "agent `{}` (profile `{}`) {detail}. It cannot reach another turn boundary to \
                     wind itself down, so the run is ended from outside it — and it is ended as \
                     `{STATUS_INTERNAL_ERROR}`, because a panic in gg's own machinery is our \
                     defect and never the model's.",
                    self.agent.id, self.agent.slot
                ),
            ));
            if self.orch.multi_agent() {
                emitter.emit(agent_status(GgAgentStatus::Failed));
            }
        }
        // The terminal row for this instance, which the loop would otherwise have written on its way
        // out. Without it the session record shows an agent that started and never ended — the
        // shape a predecessor that handed off leaves, which is the one thing this is not.
        record_session_agent(&self.orch, &self.agent, &self.origin, Some(&end));

        match &mut self.role {
            TeardownRole::Root => self.released(),
            TeardownRole::Issue { issue_id } => {
                let issue_id = issue_id.clone();
                self.fail_issue(&issue_id);
                self.released();
            }
            TeardownRole::Sub(link) => match link.take() {
                // The result channel is dropped rather than sent on: a spawner that collects
                // `None` reports that its child produced no result, which is true, where a
                // synthesized return would tell it the child answered.
                Some(link) => {
                    link.finished.store(true, Ordering::SeqCst);
                    drop(link.result);
                    // Both paths wake a spawner blocked on this child; they differ only in whether
                    // there is a slot to give back with the wake. An agent that panicked while still
                    // queued behind the parallelism cap never held one.
                    if self.slot_held {
                        self.slot_held = false;
                        link.parent_wait.child_completed(
                            &self.orch.scheduler,
                            &self.agent.id,
                            self.exclusive.as_deref(),
                        );
                    } else {
                        link.parent_wait
                            .child_abandoned(&self.orch.scheduler, &self.agent.id);
                    }
                }
                // The agent had already answered its spawner and the panic came afterwards. Its
                // spawner is not waiting on anything, and its slot went back with the answer.
                None => self.released(),
            },
        }
        end
    }

    /// Fail the [issue](crate::board) a panicked agent was implementing, and wake whoever was
    /// waiting on it.
    ///
    /// Nobody holds a handle to an issue agent, so the board is the only account of whether its work
    /// happened — and agents suspended in a `wait_for_issue` resume only when the issue they are
    /// waiting on is terminal. Failing it is therefore both the honest state and the thing that
    /// stops those agents waiting out the run's deadline.
    ///
    /// An issue that is **already** terminal is left as it is: the panic then struck after the work
    /// was reconciled, and re-failing a merged issue would rewrite the board's account of work that
    /// did happen. Waking is idempotent, so it is done either way.
    ///
    /// New board state is emitted rather than dispatched on. gg's ordinary response to a board move
    /// is to dispatch whatever the move made actionable, which is exactly the wrong thing here: the
    /// run is over, and standing fresh agents up under a raised fault buys nothing but turns nobody
    /// will read.
    fn fail_issue(&mut self, issue_id: &str) {
        if !self.orch.board.issue_is_terminal(issue_id) {
            self.orch.board.fail_issue(issue_id);
        }
        if let Some(emitter) = &self.emitter
            && let Some(state) = self.orch.board.state_event()
        {
            emitter.emit(state);
        }
        self.orch.wake_issue_waiters(issue_id);
    }
}
