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
//! - **The desk carries over.** [`AgentPersistence`] is the run-global record of the
//!   [views](crate::context::ContextModel::open_views) — [files](crate::context::OpenFileView) and
//!   [text](crate::context::OpenTextView) alike — each persistent profile had open when one of its
//!   instances last finished successfully. The next instance re-opens them
//!   ([files](restore_file_views), then [text](restore_text_views)) as the first thing in its
//!   window.
//!
//! # Why a file view is re-read rather than replayed
//!
//! What is recorded for a **file** view is the *reference* to the read — the path and the
//! `offset`/`limit` region — never the bytes it returned. An instance may sit queued for a long time
//! behind the one ahead of it, and the instance ahead of it is very often editing the exact files in
//! question. Replaying the stored text would hand the next instance a confident, wrong picture of the
//! workspace; re-reading hands it the file as it stands the moment it starts work. That is also why
//! the restore happens at the top of [`crate::agent`]'s turn loop (which runs *after* the slot is
//! granted) rather than when the instance was spawned.
//!
//! # Why a text view is the exception
//!
//! A [text view](crate::context::OpenTextView) is recorded **with its body**, and that is not an
//! inconsistency — it is the same rule applied to material of a different kind. "Record the
//! reference, never the bytes" earns its keep because a file has an on-disk truth that can move
//! under a stored snapshot, so a reference is the only thing that stays true. A text view is
//! whatever the agent composed — a diff it computed, a table it assembled, a subagent's answer — and
//! it exists nowhere but the window. There is no truth for it to go stale against, and a reference
//! to it would name nothing re-readable: recording the label alone would restore an empty desk while
//! reporting a full one. So the body is the record, and the next instance is handed back exactly
//! what the last one had in front of it.
//!
//! # What is not persisted
//!
//! Only views. Not the thread, not the task list, not memories, not skills — an agent that carried
//! its whole conversation over would be one long agent with a confusing turn count, and
//! [memories](test_cabinet_core::gg::CAPABILITY_MEMORIES) already exist for state a profile wants to
//! *narrate* across sessions. Persistence answers the narrower question of what the worker was
//! looking at.
//!
//! Both halves work under [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE)
//! as they do under tool calling: a program's `view.openFile` pushes a real file view and its
//! `view.openText` a real text view, so a code-mode profile's desk is recorded and restored like any
//! other. (A bare `fs.readFile` still puts nothing in the window and so persists nothing — it fetches
//! bytes for the program rather than showing a file to the agent, and that separation is the point.)

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};

use serde_json::json;
use test_cabinet_core::gg::{
    CAPABILITY_AGENT_PERSISTENCE, GgAgentConfig, GgProgramLanguage, GgTelemetryKind,
};

use crate::context::{ContextModel, DocviewOpen, OpenFileView, OpenTextView, Retention};
use crate::docs::DocsRuntime;
use crate::model::ToolCall;
use crate::sandbox::FileWindow;
use crate::telemetry::Emitter;
use crate::tools::{READ_FILE_TOOL, ReadFileTool, ReadPolicy, Tool, ToolContext};

/// The prefix of the synthesized `read_file` call ids a [restore](restore_file_views) pairs its
/// re-opened views with. Distinct from the turn loop's own ids (and from autoload's), so a restored
/// view can never collide with a call the model actually made.
const RESTORED_CALL_PREFIX: &str = "persisted";

/// The one file-view program gg synthesizes to restore `view` on a
/// [code-mode](ContextModel::code_mode) agent's behalf, spelled the way the agent would have had to
/// spell it: the bare path for a whole-file view, the `offset`/`limit` window for a paged one, so a
/// restored page reads as the paging call that produced it.
///
/// It is written by the agent's own
/// [program language](crate::sandbox::ProgramLanguage::open_file_program) rather than here, because
/// this is pushed into the transcript as an **assistant** turn: it has to be a reply the agent could
/// have sent, down to how that language writes an optional argument and whatever else that language
/// requires of a whole program.
fn open_file_call(language: GgProgramLanguage, view: &OpenFileView) -> String {
    crate::sandbox::language(language).open_file_program(&[(
        view.path.as_str(),
        view.region.map(|region| FileWindow {
            offset: region.offset,
            limit: region.limit,
        }),
    )])
}

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
/// agent actually runs under. There is no case in which the two could differ by *substitution*: an
/// agent naming a profile the set does not declare is refused at launch, and one that reached a run
/// anyway [ends as gg's own defect](test_cabinet_core::gg::GgCapabilitySet::root_name) rather than
/// being run as the root. What this signature buys is that the key cannot be computed from a name
/// somebody spelled twice — the caller has already resolved the profile, so the key is the one the
/// agent really holds.
pub fn exclusive_key(profile: &GgAgentConfig) -> Option<String> {
    is_persistent(profile).then(|| profile.name.clone())
}

/// One persistent profile's **desk**: everything an instance of it had open in its window when it
/// last finished successfully, in the order it opened each.
///
/// The three kinds are held apart rather than in one list because they are restored by three
/// different mechanisms — a file view is [re-read from disk](restore_file_views), a text view is
/// [handed back verbatim](restore_text_views), and a documentation view is
/// [re-rendered from its key](restore_docviews) — and because only one of them can fail to come back.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PersistedDesk {
    /// The [file views](OpenFileView) open in the window: a path and the region of it the read
    /// covered, never the bytes. See the module's *Why a file view is re-read rather than replayed*.
    pub files: Vec<OpenFileView>,
    /// The [text views](OpenTextView) open in the window, **with their bodies** — the agent composed
    /// them and the window is their only copy. See the module's *Why a text view is the exception*.
    pub texts: Vec<OpenTextView>,
    /// The [documentation views](crate::context::OpenDocview) open in the window, as **keys** — the
    /// reference half of the same principle the file half follows, and for a stronger reason.
    ///
    /// A file's reference is recorded because its truth can move; a documentation key's cannot move
    /// at all, and is recorded anyway because the body is *derived* from it. Storing the rendered
    /// text would put a second copy of gg's own catalogue in a profile's desk, and a stale one the
    /// moment the next instance's scope differs by a tool — which is exactly when re-rendering is
    /// the right answer and replaying is the wrong one.
    pub docviews: Vec<String>,
}

impl PersistedDesk {
    /// The desk a [`ContextModel`] currently holds — what a successfully finished instance
    /// [records](PersistenceSetup::record) for the next one.
    pub fn of(context: &ContextModel) -> Self {
        Self {
            files: context.open_file_views(),
            texts: context.open_text_views(),
            docviews: context
                .open_docviews()
                .into_iter()
                .map(|open| open.key)
                .collect(),
        }
    }
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
    /// The [desk](PersistedDesk) recorded against each profile, replaced wholesale each time one of
    /// its instances finishes. Guarded because instances of *different* persistent profiles run
    /// concurrently.
    desks: Mutex<BTreeMap<String, PersistedDesk>>,
}

impl AgentPersistence {
    /// A fresh, empty record, shared across the run's agents.
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Record `desk` as what the profile named `agent` has open, replacing whatever it had recorded
    /// before.
    ///
    /// A wholesale replacement rather than a union: the record is meant to be the desk as the last
    /// instance left it, so a view that instance closed (evicted, closed by `view.close`, or
    /// summarized away by [compaction](crate::compaction)) must not come back. An instance that
    /// finishes with nothing open therefore clears the record, which is the honest reading of "this
    /// is what I had open".
    pub fn record(&self, agent: &str, desk: PersistedDesk) {
        self.desks
            .lock()
            .expect("agent persistence lock")
            .insert(agent.to_string(), desk);
    }

    /// The [desk](PersistedDesk) recorded against the profile named `agent` — bare when nothing has
    /// been recorded for it.
    pub fn desk(&self, agent: &str) -> PersistedDesk {
        self.desks
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

    /// The [desk](PersistedDesk) this agent's profile last recorded — bare when it is not persistent
    /// or when no instance of it has finished yet.
    pub fn restored(&self) -> PersistedDesk {
        match &self.agent {
            Some(agent) => self.store.desk(agent),
            None => PersistedDesk::default(),
        }
    }

    /// Record the [desk](PersistedDesk) `context` currently holds against this agent's profile —
    /// what a successfully finished instance hands to the next one. A no-op for a non-persistent
    /// agent.
    pub fn record(&self, context: &ContextModel) {
        if let Some(agent) = &self.agent {
            self.store.record(agent, PersistedDesk::of(context));
        }
    }
}

/// Re-open `views` in `context` as though the agent had already opened each itself, answered by what
/// each file says **now**.
///
/// The same shape [autoload](crate::agent) seeds a test case's specifications with, and for the same
/// reason: a file view the model can act on is a turn it could have taken, not a narrated summary of
/// one. That means the *envelope* follows the run's protocol — a synthesized `read_file` call/result
/// pair on the tool-calling path, a synthesized program opening a file view on the
/// [responses-as-code](crate::sandbox) path, where there are no tools to call and an assistant turn
/// is a program. Each view is read through this agent's own `read_policy`, so a re-opened window is the same
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
    language: GgProgramLanguage,
    emitter: &Emitter,
) -> usize {
    if views.is_empty() {
        return 0;
    }
    let already_open: BTreeSet<String> = context
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
        let arguments = match view.region {
            Some(region) => json!({
                "path": view.path,
                "offset": region.offset,
                "limit": region.limit,
            }),
            None => json!({ "path": view.path }),
        };
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
        if context.code_mode() {
            // One program per restored view rather than one for all of them: a restore is a list of
            // windows, not a single opening brief, and a per-view program keeps each assistant turn
            // paired with the view it produced even when a later read fails and is skipped.
            context.push_assistant(Some(open_file_call(language, view)), Vec::new());
            context.seed_file_view(
                view.path.clone(),
                outcome.output,
                outcome.images,
                Retention::Ephemeral,
            );
            restored += 1;
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

/// Re-open `views` in `context` as the [text views](crate::context::ContextModel::open_text_view)
/// they were: each label carrying the body the last instance composed for it, byte for byte.
///
/// The counterpart of [`restore_file_views`], and deliberately *not* the same mechanism. There is
/// nothing to re-read — a text view is a diff the agent computed, a table it assembled, a subagent's
/// answer — so there is no fresher truth to prefer and no read that can fail. Handing the body back
/// is the only restore that restores anything (see the module's *Why a text view is the exception*).
///
/// No skip-if-already-open pass either, unlike the file half: opening a label that is already open
/// [supersedes](crate::context::ContextModel::open_text_view) it rather than duplicating it, so the
/// restore is idempotent by construction. The views land as ordinary
/// [ephemeral](crate::context::Retention::Ephemeral) items the agent can close and a
/// [compaction](crate::compaction) will drop — exactly as if it had opened them itself, which it
/// effectively did. Returns how many were re-opened.
pub fn restore_text_views(context: &mut ContextModel, views: &[OpenTextView]) -> usize {
    for view in views {
        context.open_text_view(view.label.clone(), view.body.clone());
    }
    views.len()
}

/// Re-open the [documentation views](crate::context::OpenDocview) the last instance had open, by
/// **re-rendering each key** through this instance's own [documentation runtime](DocsRuntime).
///
/// The third of the three restores, and the only one that is neither a re-read nor a replay. There
/// is nothing on disk to re-read, and replaying the stored text would hand the next instance a
/// description of a surface it may not have: the runtime answers through *this* agent's scope, so a
/// key whose function this instance does not bind renders nothing and is skipped rather than
/// restored as documentation for a call it cannot make.
///
/// **A view of a loaded module is dropped here, always.** A restored instance starts with nothing
/// loaded — [code is not a module](crate::knowledge) and nothing transfers it — so a key naming a
/// declaration of some [code skill or memory](crate::docs::LoadedDocs) the last instance used
/// resolves to nothing in this one, and falls out through the same `None`. That is the whole of the
/// enforcement, and it is enforcement rather than accident: those views describe code the new
/// instance cannot call until it uses the skill itself, and using the skill is what opens them
/// again. Re-rendering from the key is exactly what makes the distinction free — a replay would have
/// carried the text across with nothing behind it.
///
/// No skip-if-already-open pass, for the reason the text half has none and a stronger one:
/// [`open_docview`](ContextModel::open_docview) is a no-op on a key that is open, so the restore is
/// idempotent by construction.
///
/// Returns how many views actually **arrived**, which is not the same as how many keys were tried
/// and is the number the [note](restore_note) reports to an operator. Every code agent's saved desk
/// holds the [bootstrap](crate::bootstrap) keys — the bootstrap is seeded first of all the opening
/// steps and this restore runs last of them, so by the time it reaches them those views are already
/// in the window — and counting the no-ops would tell the operator views came back when nothing did.
/// With a longer desk the note would be over by exactly the number of bootstrap keys.
pub fn restore_docviews(context: &mut ContextModel, keys: &[String], docs: &DocsRuntime) -> usize {
    let mut restored = 0;
    for key in keys {
        let Some(body) = docs.read_any(key) else {
            continue;
        };
        if let DocviewOpen::Placed { .. } = context.open_docview(key.clone(), body) {
            restored += 1;
        }
    }
    restored
}

/// The one-line note a restored instance logs about the desk it opened on — what came back, and by
/// which of the two mechanisms.
///
/// The distinction is worth the words to an operator reading the stream: the file views are the
/// workspace **as it stands now**, which may differ from what the last instance saw, while the text
/// views are that instance's own material reproduced exactly, and the documentation views are
/// re-rendered for whatever scope *this* instance has. An agent whose window disagrees with its
/// predecessor's is behaving correctly on the first and third counts and would be broken on the
/// second.
pub fn restore_note(files: usize, texts: usize, docviews: usize) -> String {
    let mut parts = Vec::new();
    if files > 0 {
        parts.push(format!(
            "re-opened {files} file view(s), re-read from the workspace as it stands now"
        ));
    }
    if texts > 0 {
        parts.push(format!(
            "restored {texts} text view(s) exactly as it composed them"
        ));
    }
    if docviews > 0 {
        parts.push(format!(
            "re-opened {docviews} documentation view(s), rendered again for this agent's own scope"
        ));
    }
    if parts.is_empty() {
        return "agent persistence enabled; nothing carried over from an earlier session of this \
                agent."
            .to_string();
    }
    format!(
        "agent persistence enabled; {} — what this agent had open when it last finished.",
        parts.join(", and ")
    )
}

#[cfg(test)]
#[path = "persistence.test.rs"]
mod tests;
