//! **Agent persistence**: the run-wide state that makes one
//! [agent profile](test_cabinet_core::gg::GgAgentConfig) behave like a single long-lived worker
//! rather than a pool of interchangeable ones.
//!
//! This module owns the mechanism behind the
//! [agent-persistence](test_cabinet_core::gg::CAPABILITY_AGENT_PERSISTENCE) capability. It has two
//! halves, and both are deliberately small because the hard parts live elsewhere:
//!
//! - **One instance at a time.** A persistent profile's instances take their running slot under the
//!   profile's name as an [exclusivity key](crate::subagents::ExclusiveKey), so the existing
//!   [scheduler](crate::subagents::Scheduler) queues the second instance behind the first — inside
//!   the run's one global parallelism pool, not beside it. [`exclusive_key`] is the whole of it.
//! - **The desk carries over.** [`AgentPersistence`] is the run-global record of which
//!   [file views](crate::context::OpenFileView) each persistent profile had open when one of its
//!   instances last finished successfully. The next instance
//!   [re-opens them](restore_file_views) as the first thing in its window.
//!
//! # Why re-read rather than replay
//!
//! What is recorded is the *reference* to each read — the path and the `offset`/`limit` region — never
//! the bytes it returned. An instance may sit queued for a long time behind the one ahead of it, and
//! the instance ahead of it is very often editing the exact files in question. Replaying the stored
//! text would hand the next instance a confident, wrong picture of the workspace; re-reading hands it
//! the file as it stands the moment it starts work. That is also why the restore happens at the top of
//! [`crate::agent`]'s turn loop (which runs *after* the slot is granted) rather than when the instance
//! was spawned.
//!
//! # What is not persisted
//!
//! Only file views. Not the thread, not the task list, not memories, not skills — an agent that
//! carried its whole conversation over would be one long agent with a confusing turn count, and
//! [memories](test_cabinet_core::gg::CAPABILITY_MEMORIES) already exist for state a profile wants to
//! *narrate* across sessions. Persistence answers the narrower question of which files the worker was
//! looking at.
//!
//! A [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) agent puts no file view
//! in its window at all (a program's reads are consumed inside the program), so a persistent code-mode
//! profile records and restores nothing. Its one-instance-at-a-time half still applies.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use serde_json::json;
use test_cabinet_core::gg::{CAPABILITY_AGENT_PERSISTENCE, GgAgentConfig, GgTelemetryKind};

use crate::context::{ContextModel, OpenFileView};
use crate::model::ToolCall;
use crate::telemetry::Emitter;
use crate::tools::{READ_FILE_TOOL, ReadFileTool, ReadPolicy, Tool, ToolContext};

/// The prefix of the synthesized `read_file` call ids a [restore](restore_file_views) pairs its
/// re-opened views with. Distinct from the turn loop's own ids (and from autoload's), so a restored
/// view can never collide with a call the model actually made.
const RESTORED_CALL_PREFIX: &str = "persisted";

/// Whether `profile` is **persistent** — its instances are serialized and carry their open file views
/// between sessions.
pub fn is_persistent(profile: &GgAgentConfig) -> bool {
    profile.is_enabled(CAPABILITY_AGENT_PERSISTENCE)
}

/// The [exclusivity key](crate::subagents::ExclusiveKey) an agent running under `profile` holds its
/// scheduler slot under: the profile's own name when it is [persistent](is_persistent), and `None`
/// otherwise.
///
/// The key is the profile name rather than anything about the *instance* — that is the entire point:
/// every instance of the profile contends with every other instance, wherever it was spawned from and
/// whichever [worktree](test_cabinet_core::gg::CAPABILITY_PROJECT_MANAGEMENT) it was dispatched into,
/// and with no other profile.
///
/// Taken off the **resolved** profile rather than a name, so it cannot disagree with the profile the
/// agent actually runs under: an agent naming a profile the set does not declare runs under the root's,
/// and must therefore hold the root's key when the root is the persistent one.
pub fn exclusive_key(profile: &GgAgentConfig) -> Option<String> {
    is_persistent(profile).then(|| profile.name.clone())
}

/// The run-global record of what each **persistent** profile had open when one of its instances last
/// finished successfully, keyed by profile name.
///
/// One per run, shared (`Arc`) by every agent: the whole point is that a *later* instance reads what an
/// *earlier* one recorded, so this cannot be per-agent state. A profile with no entry (nothing has
/// finished yet, or the capability is off) restores nothing, which is exactly how a first instance
/// opens.
#[derive(Debug, Default)]
pub struct AgentPersistence {
    /// The open [file views](OpenFileView) recorded against each profile, replaced wholesale each time
    /// one of its instances finishes. Guarded because instances of *different* persistent profiles run
    /// concurrently.
    views: Mutex<HashMap<String, Vec<OpenFileView>>>,
}

impl AgentPersistence {
    /// A fresh, empty record, shared across the run's agents.
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Record `views` as what the profile named `agent` has open, replacing whatever it had recorded
    /// before.
    ///
    /// A wholesale replacement rather than a union: the record is meant to be the desk as the last
    /// instance left it, so a file that instance closed (evicted, or summarized away by
    /// [compaction](crate::compaction)) must not come back. An instance that finishes with nothing open
    /// therefore clears the record, which is the honest reading of "this is what I had open".
    pub fn record(&self, agent: &str, views: Vec<OpenFileView>) {
        self.views
            .lock()
            .expect("agent persistence lock")
            .insert(agent.to_string(), views);
    }

    /// The file views recorded against the profile named `agent`, in the order they were opened —
    /// empty when nothing has been recorded for it.
    pub fn views(&self, agent: &str) -> Vec<OpenFileView> {
        self.views
            .lock()
            .expect("agent persistence lock")
            .get(agent)
            .cloned()
            .unwrap_or_default()
    }
}

/// One agent's persistence setup, resolved from its own profile: whether it is persistent, the profile
/// name its record is keyed by, and the run-global [record](AgentPersistence) it reads and writes.
///
/// Resolved per agent (persistence is a per-agent capability) and inert when the capability is off — a
/// non-persistent agent restores nothing and records nothing, so the loop needs no branch of its own.
#[derive(Clone)]
pub struct PersistenceSetup {
    /// The profile name this agent's views are recorded under, `None` when it is not persistent.
    agent: Option<String>,
    /// The run-global record. Held even when this agent is not persistent (it costs one `Arc` clone)
    /// so the setup is one shape rather than two.
    store: Arc<AgentPersistence>,
}

impl PersistenceSetup {
    /// Resolve the setup for an agent running under `profile`, against the run's `store`.
    pub fn resolve(profile: &GgAgentConfig, store: Arc<AgentPersistence>) -> Self {
        Self {
            agent: is_persistent(profile).then(|| profile.name.clone()),
            store,
        }
    }

    /// A setup that persists nothing, over a record of its own. What the turn-loop tests that are not
    /// about persistence pass; production resolves from a profile, which yields the same shape for a
    /// non-persistent one.
    #[cfg(test)]
    pub fn disabled() -> Self {
        Self {
            agent: None,
            store: AgentPersistence::new(),
        }
    }

    /// Whether this agent is persistent.
    pub fn enabled(&self) -> bool {
        self.agent.is_some()
    }

    /// The file views this agent's profile last recorded — empty when it is not persistent or when no
    /// instance of it has finished yet.
    pub fn restored(&self) -> Vec<OpenFileView> {
        match &self.agent {
            Some(agent) => self.store.views(agent),
            None => Vec::new(),
        }
    }

    /// Record the file views `context` currently holds against this agent's profile — what a
    /// successfully finished instance hands to the next one. A no-op for a non-persistent agent.
    pub fn record(&self, context: &ContextModel) {
        if let Some(agent) = &self.agent {
            self.store.record(agent, context.open_file_views());
        }
    }
}

/// Re-open `views` in `context` as though the agent had already `read_file`d each: one synthesized
/// `read_file` assistant call per view, immediately answered by what the file says **now**.
///
/// The same shape [autoload](crate::agent) seeds a test case's specifications with, and for the same
/// reason: a file view the model can act on is a well-formed call/result pair, not a narrated summary
/// of one. Each view is read through this agent's own `read_policy`, so a re-opened window is the same
/// size the agent's own reads are, and a paged view is re-read over the region it covered rather than
/// from the top of the file. The views are ordinary [ephemeral](crate::context::Retention::Ephemeral)
/// reads — compaction may summarize them and agent-managed context may evict them, exactly as if the
/// agent had opened them itself, which it effectively did.
///
/// A view of a path that was **already open before the restore** is skipped: a persistent agent that
/// also [autoloads specifications](test_cabinet_core::gg::CAPABILITY_AUTOLOAD_SPECS) would otherwise get
/// two copies of every spec it had read. The comparison is against the window as it stood on entry, not
/// as the restore is building it, so a desk that held two *different windows* of one large file gets both
/// back. A file that can no longer be read — deleted, renamed, or moved since it was recorded — is
/// skipped with a warning rather than failing the agent: the desk it was on is gone, which is a normal
/// thing to come back to. Returns how many views were actually re-opened.
pub async fn restore_file_views(
    context: &mut ContextModel,
    views: &[OpenFileView],
    read_policy: ReadPolicy,
    tool_ctx: &ToolContext,
    emitter: &Emitter,
) -> usize {
    if views.is_empty() {
        return 0;
    }
    let already_open: HashSet<String> = context
        .open_file_views()
        .into_iter()
        .map(|open| open.path)
        .collect();
    let reader = ReadFileTool::new(read_policy);
    let mut restored = 0;
    for (index, view) in views.iter().enumerate() {
        if already_open.contains(&view.path) {
            continue;
        }
        let mut arguments = json!({ "path": view.path });
        if let Some(region) = view.region {
            if let Some(offset) = region.offset {
                arguments["offset"] = json!(offset);
            }
            if let Some(limit) = region.limit {
                arguments["limit"] = json!(limit);
            }
        }
        let outcome = reader.invoke(arguments.clone(), tool_ctx).await;
        if !outcome.ok {
            emitter.emit(GgTelemetryKind::Log {
                level: "warn".to_string(),
                message: format!(
                    "could not re-open `{}`, which you had open when you last finished: {}",
                    view.path, outcome.output
                ),
            });
            continue;
        }
        // A deterministic id the turn loop never mints, so the synthesized pair cannot collide with a
        // real call's.
        let call_id = format!("{RESTORED_CALL_PREFIX}-{index}");
        context.push_assistant(
            None,
            vec![ToolCall {
                id: call_id.clone(),
                name: READ_FILE_TOOL.to_string(),
                arguments,
            }],
        );
        context.push_file_view(
            Some(view.path.clone()),
            view.region,
            &call_id,
            outcome.output,
            outcome.images,
        );
        restored += 1;
    }
    restored
}

#[cfg(test)]
#[path = "persistence.test.rs"]
mod tests;
