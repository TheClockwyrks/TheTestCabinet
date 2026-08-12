//! The gg **subagent scheduler** and the per-agent delegation state.
//!
//! This module owns the mechanism behind the [subagents](https://docs.testcabinet.ai/gg/subagents/)
//! capability: an agent can **spawn** other agents, work in **parallel** with them or **block**
//! until they **return**, and **message** a running child. The [orchestration](crate::agent) that
//! builds and drives each agent lives in [`crate::agent`]; this module provides the two shared
//! coordination primitives it is built on:
//!
//! - the [`Scheduler`] — a single **global parallelism cap** with the exact grant policy the
//!   design calls for (blocked-frees-slot-with-priority, then FCFS); and
//! - the [`ParentWait`] — the per-parent wait condition a child signals as it finishes, coupled to
//!   the scheduler so a parent resumes the instant its last awaited child returns.
//!
//! plus the per-agent [`AgentCtx`] (its inbox, its spawned [children](ChildHandle), and its
//! [`ParentWait`]), the [`SubagentConfig`] resolved from the capability's params, and the
//! [`AgentReturn`] a child hands back.
//!
//! # Scheduling
//!
//! There is **one global running-slot cap** ([`SubagentConfig::max_parallel`]), counting running
//! agents regardless of which [model slot](https://docs.testcabinet.ai/gg/configurations/#model-slots) they run
//! on. The grant policy, implemented by [`select_grant_index`] and driven by [`Scheduler::pump`],
//! is:
//!
//! - A newly spawned agent must **acquire a running slot before it runs**
//!   ([`Scheduler::acquire_start`]); if none is free it **blocks until one frees**, and slots are
//!   granted **first-come, first-served** among waiters of equal priority (by monotonic ticket).
//! - When an agent **blocks waiting on its subagents** it **releases its slot**
//!   ([`Scheduler::block_and_release`]) so other work can run, but it stays recorded as a waiter
//!   that **retains priority over not-yet-started agents** for the next free slot. A blocked agent
//!   **cannot resume until its wait condition is met** (its awaited children finished), even if a
//!   slot is free — so a free slot is granted to a blocked-**and-ready** agent ahead of any
//!   fresh waiter, and only to a fresh waiter when no blocked agent is ready.
//! - A slot may additionally be held under an **exclusivity key** ([`ExclusiveKey`]), which no two
//!   running agents may hold at once. This is how a
//!   [persistent](test_cabinet_core::gg::CAPABILITY_AGENT_PERSISTENCE) agent profile is capped at
//!   one running instance: every instance takes the slot under the profile's name, so the second
//!   one queues behind the first *within* the global pool rather than getting a pool of its own. A
//!   key is held only while the agent is **running** — an agent that blocks releases it with its
//!   slot and re-takes it when it resumes — so a persistent agent waiting on a child of its own
//!   profile cannot deadlock against itself.
//!
//! The depth cap is **not** enforced here — it is a *structural* check made at spawn time (a spawn
//! below [`max_depth`](SubagentConfig::max_depth) fails as a *limit*, not queued, because the
//! request was well-formed and the run simply has no room left under it); see [`crate::agent`].

use std::collections::BTreeSet;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::AtomicBool;

use serde_json::Value;

use crate::ending::Ending;
use test_cabinet_core::gg::{CAPABILITY_SUBAGENTS, GgCapabilitySet};
use tokio::sync::{mpsc, oneshot};

/// The default global parallelism cap when the configuration declares no
/// [`maxParallel`](test_cabinet_core::gg::GgRunLimits::max_parallel).
pub const DEFAULT_MAX_PARALLEL: usize = 16;

/// The default recursion depth cap when the capability names no `maxDepth`. The root is depth `0`;
/// an agent at depth `maxDepth` may not spawn (its child would be `maxDepth + 1`).
pub const DEFAULT_MAX_DEPTH: usize = 3;

/// The subagents-capability param naming the recursion [depth cap](SubagentConfig::max_depth).
const PARAM_MAX_DEPTH: &str = "maxDepth";

/// The two bounds a run's delegation is governed by: the run-level
/// [parallelism cap](test_cabinet_core::gg::GgRunLimits::max_parallel) and the subagents capability's depth cap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SubagentConfig {
    /// The single global cap on how many agents run at once (counting the root). A spawn beyond
    /// the cap blocks until a slot frees. Clamped to at least `1` so a run always makes progress.
    pub max_parallel: usize,
    /// The maximum tree depth: an agent at this depth may not spawn (a spawn there is refused, not
    /// queued), so the deepest possible agent is at `max_depth`.
    pub max_depth: usize,
}

impl Default for SubagentConfig {
    fn default() -> Self {
        Self {
            max_parallel: DEFAULT_MAX_PARALLEL,
            max_depth: DEFAULT_MAX_DEPTH,
        }
    }
}

impl SubagentConfig {
    /// Resolve the config from a [`GgCapabilitySet`].
    ///
    /// The parallelism cap is the run's own [`limits.maxParallel`](test_cabinet_core::gg::GgRunLimits::max_parallel) when it
    /// declares one — it is a run-level guardrail, so it is readable whether or not any profile
    /// enables the [subagents](CAPABILITY_SUBAGENTS) capability, which matters for a run that
    /// delegates purely through the [board](test_cabinet_core::gg::CAPABILITY_PROJECT_MANAGEMENT).
    /// Failing that, the [default](DEFAULT_MAX_PARALLEL) applies. `max_depth` comes from the
    /// subagents capability alone (it bounds *that* capability's recursion, nothing else). A
    /// missing, zero, or non-integer value keeps the default everywhere, and `max_parallel` is
    /// clamped to at least `1` so a run always makes progress.
    pub fn resolve(set: &GgCapabilitySet) -> Self {
        let default = Self::default();
        let params = set.capability(CAPABILITY_SUBAGENTS).map(|cap| &cap.params);
        let max_parallel = set
            .limits
            .max_parallel
            .filter(|&max| max > 0)
            .map(|max| usize::try_from(max).unwrap_or(usize::MAX))
            .unwrap_or(default.max_parallel)
            .max(1);
        let max_depth = params
            .and_then(|p| positive_usize(p, PARAM_MAX_DEPTH))
            .unwrap_or(default.max_depth);
        Self {
            max_parallel,
            max_depth,
        }
    }
}

/// A positive-integer param value, or `None` when absent, zero, or non-integer.
fn positive_usize(params: &Value, key: &str) -> Option<usize> {
    params
        .get(key)
        .and_then(Value::as_u64)
        .filter(|&n| n > 0)
        .map(|n| n as usize)
}

/// The value a subagent hands back to the agent that spawned it — its
/// [return value](https://docs.testcabinet.ai/gg/subagents/).
#[derive(Debug, Clone)]
pub struct AgentReturn {
    /// The subagent's final text — its ending's own words, or a short status line when its loop
    /// produced none. This is what `wait_for_subagents` delivers to the parent.
    pub summary: String,
    /// How the subagent's loop ended (`"completed"`, `"exhausted"`, `"model_error"`, …), so the
    /// parent can tell a clean return from a failed one.
    pub status: &'static str,
    /// What the subagent **declared** when it ended, when it ended by declaring something.
    ///
    /// A dispatcher that asked for a *verdict* rather than for work reads this rather than
    /// [`summary`](Self::summary): a reviewer's approval and a judge's pick are structured facts,
    /// and turning one into prose so it can be parsed back is exactly the round trip that used to
    /// let a reviewer reject work while naming nothing to fix.
    pub ending: Option<Ending>,
}

/// A live handle the parent keeps for one spawned child: enough to **message** it while it runs
/// and to **collect** its return value once it finishes.
pub struct ChildHandle {
    /// The child's stable id.
    pub id: String,
    /// The channel `send_message` writes to; the child drains it at each turn boundary.
    pub inbox: mpsc::UnboundedSender<String>,
    /// Set by the child when its loop ends, so `send_message` can refuse a message to a child that
    /// has already returned.
    pub finished: Arc<AtomicBool>,
    /// The one-shot the child sends its [`AgentReturn`] on; taken by `wait_for_subagents` when the
    /// result is collected.
    pub result: Option<oneshot::Receiver<AgentReturn>>,
    /// Whether this child's result has already been collected by a `wait_for_subagents` call (so a
    /// later "wait for all" does not wait on it again).
    pub collected: bool,
}

impl ChildHandle {
    /// Whether the child's loop has ended.
    pub fn is_finished(&self) -> bool {
        self.finished.load(std::sync::atomic::Ordering::SeqCst)
    }
}

/// The per-agent delegation state the [turn loop](crate::agent) owns: the agent's message
/// **inbox**, the **children** it has spawned, and the shared [`ParentWait`] its children signal
/// as they finish.
pub struct AgentCtx {
    /// The shared wait condition this agent's children signal on completion, and that a
    /// `wait_for_subagents` call arms. Cloned into each child so the child can wake this parent.
    pub wait: Arc<ParentWait>,
    /// The receiving half of this agent's message inbox; drained at each turn boundary.
    pub inbox: mpsc::UnboundedReceiver<String>,
    /// The children this agent has spawned, in spawn order.
    pub children: Vec<ChildHandle>,
    /// The [exclusivity key](ExclusiveKey) this agent holds its running slot under, when it is an
    /// instance of a [persistent](test_cabinet_core::gg::CAPABILITY_AGENT_PERSISTENCE) profile.
    ///
    /// Carried here because a `wait_for_subagents` frees the agent's slot from deep inside the
    /// delegation code, which has this context in hand but not the agent's profile — and a slot
    /// released under the wrong key (or none) would leave a persistent profile held forever.
    pub exclusive: Option<String>,
}

impl AgentCtx {
    /// A fresh context owning `inbox`, with no children yet and a new [`ParentWait`], for an agent
    /// whose slot is held under `exclusive` (`None` for every non-persistent agent).
    pub fn new(inbox: mpsc::UnboundedReceiver<String>, exclusive: Option<String>) -> Self {
        Self {
            wait: Arc::new(ParentWait::new()),
            inbox,
            children: Vec::new(),
            exclusive,
        }
    }

    /// Drain every message queued in the inbox (non-blocking), in arrival order.
    pub fn drain_inbox(&mut self) -> Vec<String> {
        let mut out = Vec::new();
        while let Ok(message) = self.inbox.try_recv() {
            out.push(message);
        }
        out
    }
}

/// The **exclusivity key** a running slot may be held under: a name no two *running* agents may
/// hold at the same time, on top of the global [parallelism cap](SubagentConfig::max_parallel).
///
/// `None` — the ordinary case — is a slot held under no key, which contends with nothing. `Some(name)`
/// is how a [persistent](test_cabinet_core::gg::CAPABILITY_AGENT_PERSISTENCE) agent profile is capped
/// at one running instance: the name is the profile's, so every instance of it contends with every
/// other instance and with nothing else.
pub type ExclusiveKey<'a> = Option<&'a str>;

/// A token identifying one **blocked** waiter in the [`Scheduler`], handed to the parent by
/// [`Scheduler::block_and_release`] and used by a completing child (via [`ParentWait`]) to mark
/// that waiter ready.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WaiterToken(u64);

/// The per-parent wait condition, coupling a parent's `wait_for_subagents` to its children's
/// completions and to the [`Scheduler`].
///
/// A parent [begins a wait](Self::begin_wait) over a set of child ids; each child, on finishing,
/// [signals completion](Self::child_completed). When the last awaited child finishes, the parent's
/// blocked scheduler waiter is marked ready **and** the finishing child's slot is released in a
/// single scheduler step, so the freed slot is offered to the now-ready parent ahead of any
/// fresh waiter (the blocked-frees-slot-with-priority rule). The lock order is always
/// `ParentWait` → `Scheduler`.
pub struct ParentWait {
    inner: Mutex<ParentWaitInner>,
}

/// The guarded interior of a [`ParentWait`].
struct ParentWaitInner {
    /// Ids of children that have finished (whether or not the parent has collected them yet).
    finished: BTreeSet<String>,
    /// While the parent is blocked in `wait_for_subagents`, the still-outstanding subset of the
    /// awaited ids; `None` when the parent is not currently waiting.
    waiting_on: Option<BTreeSet<String>>,
    /// The parent's blocked scheduler waiter, set while it is waiting so the last child to finish
    /// can mark it ready.
    token: Option<WaiterToken>,
}

impl ParentWait {
    /// A fresh wait with no finished children and no active wait.
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(ParentWaitInner {
                finished: BTreeSet::new(),
                waiting_on: None,
                token: None,
            }),
        }
    }

    /// Signal that the child `child_id` has finished, releasing its running slot on `scheduler` —
    /// and with it the [exclusivity key](ExclusiveKey) `key` the child held the slot under, if any.
    ///
    /// If the parent is currently waiting and this was the **last** outstanding awaited child, the
    /// child's slot release and the parent's readiness are applied to the scheduler **together**
    /// ([`Scheduler::finish_and_ready`]) so the freed slot goes to the ready parent ahead of any
    /// fresh waiter. Otherwise the slot is simply [released](Scheduler::release).
    pub fn child_completed(&self, scheduler: &Scheduler, child_id: &str, key: ExclusiveKey<'_>) {
        let ready_token = {
            let mut inner = self.inner.lock().expect("parent wait lock");
            inner.finished.insert(child_id.to_string());
            let mut ready_token = None;
            if let Some(set) = inner.waiting_on.as_mut() {
                set.remove(child_id);
                if set.is_empty() {
                    ready_token = inner.token.take();
                    inner.waiting_on = None;
                }
            }
            ready_token
        };
        match ready_token {
            Some(token) => scheduler.finish_and_ready(token, key),
            None => scheduler.release(key),
        }
    }

    /// Begin waiting on `awaited`: register a blocked waiter (freeing the caller's slot, and the
    /// [exclusivity key](ExclusiveKey) `key` it holds that slot under) if any of the awaited children
    /// are still outstanding, and return the resume channel to await. Returns `None` when every
    /// awaited child has already finished (the caller keeps its slot — and its key — and does not
    /// block).
    ///
    /// The scheduler registration happens under this parent's lock so a child completing
    /// concurrently cannot slip between "compute outstanding" and "arm the wait".
    pub fn begin_wait(
        &self,
        scheduler: &Scheduler,
        awaited: &BTreeSet<String>,
        key: ExclusiveKey<'_>,
    ) -> Option<oneshot::Receiver<()>> {
        let mut inner = self.inner.lock().expect("parent wait lock");
        let outstanding: BTreeSet<String> = awaited
            .iter()
            .filter(|id| !inner.finished.contains(*id))
            .cloned()
            .collect();
        if outstanding.is_empty() {
            return None;
        }
        let (token, rx) = scheduler.block_and_release(key);
        inner.waiting_on = Some(outstanding);
        inner.token = Some(token);
        Some(rx)
    }
}

impl Default for ParentWait {
    fn default() -> Self {
        Self::new()
    }
}

/// One waiter queued in the [`Scheduler`]: either a **fresh** agent waiting to start or a
/// **blocked** parent waiting to resume.
struct Waiter {
    /// Monotonic FCFS ticket; smaller is older.
    ticket: u64,
    /// `true` for a blocked parent that freed its slot to wait on children; `false` for a fresh
    /// agent that has never run.
    blocked: bool,
    /// For a blocked waiter, whether its wait condition is met (its awaited children finished). A
    /// blocked waiter is ineligible for a slot until this is `true`. Always `true` for a fresh
    /// waiter.
    ready: bool,
    /// The [exclusivity key](ExclusiveKey) this waiter will hold its slot under, when it wants one.
    /// A waiter whose key is already held by a running agent is ineligible, however old its ticket
    /// and whether or not it is blocked-and-ready.
    key: Option<String>,
    /// Fired (with a slot granted) to wake the waiting task.
    wake: oneshot::Sender<()>,
}

/// The guarded interior of the [`Scheduler`].
struct SchedulerState {
    /// The single global cap on running agents.
    max_parallel: usize,
    /// How many agents currently hold a running slot.
    running: usize,
    /// The [exclusivity keys](ExclusiveKey) currently held by running agents — at most one running
    /// agent per key, which is what caps a persistent profile at one instance. A slot taken under no
    /// key adds nothing here.
    held: BTreeSet<String>,
    /// The next FCFS ticket to hand out.
    next_ticket: u64,
    /// Queued waiters (fresh and blocked), in arrival order.
    waiters: Vec<Waiter>,
}

/// The single global subagent scheduler: it caps how many agents run at once and grants freed
/// slots by the [design's priority policy](self#scheduling).
///
/// It is deliberately a **custom** scheduler rather than a bare semaphore, because the grant
/// order is not FIFO: a blocked-and-ready parent takes priority over any not-yet-started agent.
/// Every grant increments [`running`](SchedulerState::running) and wakes exactly one waiter;
/// every completion or block decrements it and re-[`pump`](Self::pump)s, so the running count is
/// always balanced.
pub struct Scheduler {
    state: Mutex<SchedulerState>,
}

impl Scheduler {
    /// A scheduler with a global cap of `max_parallel` (clamped to at least `1`).
    pub fn new(max_parallel: usize) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(SchedulerState {
                max_parallel: max_parallel.max(1),
                running: 0,
                held: BTreeSet::new(),
                next_ticket: 0,
                waiters: Vec::new(),
            }),
        })
    }

    /// Acquire a running slot to **start** an agent, blocking until one is free — and, when `key` is
    /// `Some`, until no other running agent holds that [exclusivity key](ExclusiveKey). Enqueues the
    /// caller as a fresh waiter (so it never jumps a blocked-ready waiter) and awaits the grant.
    pub async fn acquire_start(&self, key: ExclusiveKey<'_>) {
        let rx = {
            let mut state = self.state.lock().expect("scheduler lock");
            let (wake, rx) = oneshot::channel();
            let ticket = state.take_ticket();
            state.waiters.push(Waiter {
                ticket,
                blocked: false,
                ready: true,
                key: key.map(str::to_string),
                wake,
            });
            Self::pump(&mut state);
            rx
        };
        // A dropped sender (impossible here — the scheduler holds it until granted) would end the
        // wait; either way the caller proceeds only once granted.
        let _ = rx.await;
    }

    /// Release a running slot held by an agent that has finished (with no parent to wake) — freeing
    /// the [exclusivity key](ExclusiveKey) it held the slot under, if any — and grant the freed slot
    /// to the best eligible waiter.
    pub fn release(&self, key: ExclusiveKey<'_>) {
        let mut state = self.state.lock().expect("scheduler lock");
        state.running = state.running.saturating_sub(1);
        state.free_key(key);
        Self::pump(&mut state);
    }

    /// Release the caller's running slot (and its [exclusivity key](ExclusiveKey)) **and** register
    /// it as a blocked waiter (its wait condition not yet met), returning the waiter's
    /// [token](WaiterToken) and the resume channel. The freed slot is offered to the best eligible
    /// waiter (never this just-registered blocked one, which is not yet ready).
    ///
    /// The key is released with the slot and re-taken when the waiter is granted a slot again: a
    /// suspended agent is not running, so holding a key across a wait would let a persistent agent
    /// blocked on a child of its own profile deadlock against itself.
    pub fn block_and_release(&self, key: ExclusiveKey<'_>) -> (WaiterToken, oneshot::Receiver<()>) {
        let mut state = self.state.lock().expect("scheduler lock");
        let (wake, rx) = oneshot::channel();
        let ticket = state.take_ticket();
        state.waiters.push(Waiter {
            ticket,
            blocked: true,
            ready: false,
            key: key.map(str::to_string),
            wake,
        });
        state.running = state.running.saturating_sub(1);
        state.free_key(key);
        Self::pump(&mut state);
        (WaiterToken(ticket), rx)
    }

    /// Release a finishing child's slot (and its [exclusivity key](ExclusiveKey)) **and** mark the
    /// blocked waiter `token` ready, in one step, then grant. Applying both together is what lets the
    /// freed slot go to the now-ready (higher-priority) parent ahead of any fresh waiter.
    pub fn finish_and_ready(&self, token: WaiterToken, key: ExclusiveKey<'_>) {
        let mut state = self.state.lock().expect("scheduler lock");
        state.running = state.running.saturating_sub(1);
        state.free_key(key);
        if let Some(waiter) = state.waiters.iter_mut().find(|w| w.ticket == token.0) {
            waiter.ready = true;
        }
        Self::pump(&mut state);
    }

    /// Mark the blocked waiter `token` **ready** (its wait condition is now met) without releasing
    /// a slot, then grant. Used for an [issue wait](crate::agent): the agent that satisfies the
    /// wait (by completing or failing the awaited issue) is a *different* agent whose own slot is
    /// accounted for by its own lifecycle, so unlike [`finish_and_ready`](Self::finish_and_ready)
    /// this only flips readiness — the freed-slot bookkeeping is not this call's to do. A `token`
    /// that matches no current waiter is a no-op (it was already granted).
    pub fn mark_ready(&self, token: WaiterToken) {
        let mut state = self.state.lock().expect("scheduler lock");
        if let Some(waiter) = state.waiters.iter_mut().find(|w| w.ticket == token.0) {
            waiter.ready = true;
        }
        Self::pump(&mut state);
    }

    /// Exchange the [exclusivity key](ExclusiveKey) a **running** agent holds its slot under, for
    /// the one its next incarnation needs — without ever releasing the slot itself.
    ///
    /// A [succession](crate::agent) — an FSM transition, or an `exec` — replaces the running agent
    /// with one under a *different* [profile](test_cabinet_core::gg::GgAgentConfig), and the
    /// exclusivity key is derived from the profile name. The whole succession is one running slot by
    /// construction (a transition must not queue behind unrelated work), so the slot is kept and only
    /// the key changes.
    ///
    /// The interesting case is a `new` key another running agent already holds: a persistent profile
    /// may have exactly one running instance, and a succession is not exempt from that. This agent
    /// then gives its slot up and re-queues as a **blocked-and-ready** waiter under the new key,
    /// which is the same machinery a parent resuming from a `wait_for_subagents` goes through —
    /// so it outranks every not-yet-started agent and takes the first slot the key frees up, rather
    /// than spinning or deadlocking against the instance ahead of it.
    pub async fn rekey(&self, old: ExclusiveKey<'_>, new: ExclusiveKey<'_>) {
        if old == new {
            return;
        }
        let rx = {
            let mut state = self.state.lock().expect("scheduler lock");
            state.free_key(old);
            match new {
                // The successor contends with nothing: the old key is freed, the slot is kept, and
                // whoever was queued behind that key may now be granted one.
                None => {
                    Self::pump(&mut state);
                    return;
                }
                Some(key) => {
                    if !state.held.contains(key) {
                        state.held.insert(key.to_string());
                        Self::pump(&mut state);
                        return;
                    }
                    // Held by somebody else. Give the slot back and queue for it under the new key,
                    // ready from the start — this agent is not waiting on work, only on a name.
                    let (wake, rx) = oneshot::channel();
                    let ticket = state.take_ticket();
                    state.waiters.push(Waiter {
                        ticket,
                        blocked: true,
                        ready: true,
                        key: Some(key.to_string()),
                        wake,
                    });
                    state.running = state.running.saturating_sub(1);
                    Self::pump(&mut state);
                    rx
                }
            }
        };
        let _ = rx.await;
    }

    /// Grant free slots to the best eligible waiters until no slot is free or no waiter is
    /// eligible. Each grant increments `running`, removes the chosen waiter, and wakes it.
    fn pump(state: &mut SchedulerState) {
        loop {
            let view: Vec<WaiterView<'_>> = state
                .waiters
                .iter()
                .map(|w| (w.blocked, w.ready, w.ticket, w.key.as_deref()))
                .collect();
            match select_grant_index(&view, state.running, state.max_parallel, &state.held) {
                Some(index) => {
                    let waiter = state.waiters.remove(index);
                    state.running += 1;
                    // The granted agent takes its exclusivity key with the slot, so the next
                    // iteration of this very loop already sees it held and skips any other waiter
                    // queued under the same name.
                    if let Some(key) = waiter.key {
                        state.held.insert(key);
                    }
                    // A dropped receiver (the waiting task went away) just means the slot is
                    // immediately spare; the next pump reclaims it. Ignore the send result.
                    let _ = waiter.wake.send(());
                }
                None => break,
            }
        }
    }

    /// The current number of running agents (test-only introspection).
    #[cfg(test)]
    pub fn running(&self) -> usize {
        self.state.lock().expect("scheduler lock").running
    }

    /// The current number of queued waiters (test-only introspection).
    #[cfg(test)]
    pub fn waiter_count(&self) -> usize {
        self.state.lock().expect("scheduler lock").waiters.len()
    }

    /// Whether a running agent currently holds the [exclusivity key](ExclusiveKey) `key` (test-only
    /// introspection).
    #[cfg(test)]
    pub fn holds(&self, key: &str) -> bool {
        self.state
            .lock()
            .expect("scheduler lock")
            .held
            .contains(key)
    }
}

impl SchedulerState {
    /// Hand out the next FCFS ticket.
    fn take_ticket(&mut self) -> u64 {
        let ticket = self.next_ticket;
        self.next_ticket += 1;
        ticket
    }

    /// Release the [exclusivity key](ExclusiveKey) a slot was held under, so the next agent queued
    /// under that name becomes eligible. A no-op for a keyless slot.
    fn free_key(&mut self, key: ExclusiveKey<'_>) {
        if let Some(key) = key {
            self.held.remove(key);
        }
    }
}

/// One queued waiter as the [grant policy](select_grant_index) sees it: whether it is blocked,
/// whether it is ready, its FCFS ticket, and the [exclusivity key](ExclusiveKey) it would take its
/// slot under.
pub type WaiterView<'a> = (bool, bool, u64, Option<&'a str>);

/// Choose which queued waiter to grant a free slot to, or `None` when no slot is free or no
/// waiter is eligible. Pure over a [`WaiterView`] of the queue (plus the set of
/// [exclusivity keys](ExclusiveKey) running agents hold) so the grant policy is unit-tested
/// directly.
///
/// The policy: a slot is available only while `running < max`. A waiter is **eligible** if
///
/// - it is fresh, or blocked **and** ready (a blocked-but-not-ready waiter cannot resume even with a
///   free slot); **and**
/// - its exclusivity key, if it has one, is not already `held` by a running agent — the one rule
///   that a waiter cannot age out of, since it is what caps a persistent profile at one running
///   instance.
///
/// Among eligible waiters, a **blocked** (ready) one outranks any **fresh** one — the blocked-agent
/// priority — and ties within a class are broken by the smallest ticket (FCFS).
pub fn select_grant_index(
    waiters: &[WaiterView<'_>],
    running: usize,
    max: usize,
    held: &BTreeSet<String>,
) -> Option<usize> {
    if running >= max {
        return None;
    }
    waiters
        .iter()
        .enumerate()
        .filter(|(_, (blocked, ready, _, _))| if *blocked { *ready } else { true })
        .filter(|(_, (_, _, _, key))| !key.is_some_and(|key| held.contains(key)))
        // Key `(!blocked, ticket)`: a blocked waiter's `!blocked` is `false` (0) and sorts ahead
        // of a fresh waiter's `true` (1); within a class the smaller ticket (older) wins.
        .min_by_key(|(_, (blocked, _, ticket, _))| (!*blocked, *ticket))
        .map(|(index, _)| index)
}

#[cfg(test)]
#[path = "subagents.test.rs"]
mod tests;
