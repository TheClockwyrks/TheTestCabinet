//! What gates each tool: the capability that contributes it, and any further condition.
//!
//! This is the one part of the [reference](super) that is *authored* rather than projected, and it
//! is authored because the fact does not exist anywhere else in a readable form. A tool's gate is
//! spread across a chain of `if`s in [`ToolRegistry::from_run`](crate::tools::ToolRegistry::from_run)
//! — a capability check, a module's `offers_*`, a strategy's shape, a roster's emptiness — and no
//! [`ToolDefinition`](crate::model::ToolDefinition) carries any of it. A reader of the console's
//! Reference section who cannot tell *what buys this tool* is left with the same question the page
//! was built to answer.
//!
//! It is kept honest by a test asserting the table covers **exactly**
//! [`ALL_TOOL_NAMES`](crate::tools::ALL_TOOL_NAMES) — no missing entry, no stale one — so a tool
//! cannot be added to gg without its gate being written down here, and one that is removed cannot
//! leave a ghost behind.
//!
//! The notes are written for a human reading a catalogue, in the second person the tool
//! descriptions themselves are not: they describe the *run*, not the model's options.

use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_COMPACTION, CAPABILITY_EDIT_FILE, CAPABILITY_EXEC,
    CAPABILITY_FORK, CAPABILITY_FSM, CAPABILITY_LIST_DIR, CAPABILITY_MEMORIES,
    CAPABILITY_PROJECT_MANAGEMENT, CAPABILITY_READ_FILE, CAPABILITY_SHELL, CAPABILITY_SKILLS,
    CAPABILITY_SUBAGENTS, CAPABILITY_TASKS, CAPABILITY_WRITE_FILE,
};

/// What buys one tool.
pub(super) struct ToolGate {
    /// The tool's name — a member of
    /// [`ALL_TOOL_NAMES`](crate::tools::ALL_TOOL_NAMES), exactly.
    pub(super) tool: &'static str,
    /// The capability id that contributes it. Never absent: every tool gg offers is contributed by
    /// some capability, including `transition_state`, which is contributed by the
    /// [`fsm`](CAPABILITY_FSM) capability of the *shell* profile driving the machine rather than by
    /// anything on the agent's own — which is exactly what its [note](Self::note) says.
    pub(super) capability: &'static str,
    /// The condition beyond the capability, when there is one, or `None` when the capability alone
    /// decides. Written as a sentence, because it is displayed as one.
    pub(super) note: Option<&'static str>,
}

/// A gate, spelled compactly. The two forms are "the capability decides" and "the capability plus
/// this".
macro_rules! gate {
    ($tool:expr, $capability:expr) => {
        ToolGate {
            tool: $tool,
            capability: $capability,
            note: None,
        }
    };
    ($tool:expr, $capability:expr, $note:expr) => {
        ToolGate {
            tool: $tool,
            capability: $capability,
            note: Some($note),
        }
    };
}

/// Every tool gg can offer, and what buys it. Order is [`ALL_TOOL_NAMES`](crate::tools::ALL_TOOL_NAMES)'s,
/// so the two lists can be read side by side.
pub(super) const TOOL_GATES: &[ToolGate] = &[
    gate!("shell", CAPABILITY_SHELL),
    gate!("read_file", CAPABILITY_READ_FILE),
    gate!("write_file", CAPABILITY_WRITE_FILE),
    gate!("edit_file", CAPABILITY_EDIT_FILE),
    gate!("list_dir", CAPABILITY_LIST_DIR),
    gate!(
        "read_skill",
        CAPABILITY_SKILLS,
        "Only when the agent's skill library holds at least one skill — there would otherwise be \
         nothing to read. Both the description and the `name` enum list that library, so they are \
         per run."
    ),
    gate!(
        "write_memory",
        CAPABILITY_MEMORIES,
        "Only under the `scratchpad` memory strategy, and only for an agent whose memory handle is \
         writable."
    ),
    gate!(
        "update_memory",
        CAPABILITY_MEMORIES,
        "Only under the `scratchpad` memory strategy, and only for an agent whose memory handle is \
         writable."
    ),
    gate!(
        "create_memory",
        CAPABILITY_MEMORIES,
        "Only under the file-shaped `markdown` and `keyword-search` strategies, and only for an \
         agent whose memory handle is writable. The two ask for different arguments: the entry \
         below is `markdown`'s, which requires the `description` its pinned index is made of, and \
         `keyword-search`'s — where the `description` is optional — is carried as a variant."
    ),
    gate!(
        "read_memory",
        CAPABILITY_MEMORIES,
        "Only under the file-shaped `markdown` and `keyword-search` strategies — the scratchpad \
         has no read call, its memories being the pinned block itself. Offered to a read-only \
         holder too. The entry below is `markdown`'s, which points at the index in front of the \
         model; `keyword-search` has no index and is carried as a variant."
    ),
    gate!(
        "edit_memory",
        CAPABILITY_MEMORIES,
        "Only under the file-shaped `markdown` and `keyword-search` strategies, and only for an \
         agent whose memory handle is writable."
    ),
    gate!(
        "search_memories",
        CAPABILITY_MEMORIES,
        "Only under the `keyword-search` strategy, the one strategy that indexes for it."
    ),
    gate!(
        "delete_memory",
        CAPABILITY_MEMORIES,
        "Offered by every memory strategy, but only to an agent whose memory handle is writable."
    ),
    gate!(
        "add_task",
        CAPABILITY_TASKS,
        "Only when the agent holds a task-list module. The list's `mode` param decides the call's \
         shape: the entry below is `simple`'s, and the `issues` variant beside it additionally \
         *requires* a task's in-scope, out-of-scope and completion criteria."
    ),
    gate!(
        "update_task",
        CAPABILITY_TASKS,
        "Only when the agent holds a task-list module. The list's `mode` param decides the call's \
         shape: the entry below is `simple`'s, and the `issues` variant beside it can also revise \
         a task's structured scope and completion sections."
    ),
    gate!(
        "set_blocked_by",
        CAPABILITY_TASKS,
        "Only when the agent holds a task-list module."
    ),
    gate!(
        "complete_task",
        CAPABILITY_TASKS,
        "Only when the agent holds a task-list module."
    ),
    gate!(
        "remove_task",
        CAPABILITY_TASKS,
        "Only when the agent holds a task-list module."
    ),
    gate!(
        "create_epic",
        CAPABILITY_PROJECT_MANAGEMENT,
        "Only when the agent holds the run's board. An agent dispatched to *implement* an issue \
         needs no board tool of its own, so an implementer profile is normally configured without \
         this capability."
    ),
    gate!(
        "create_issue",
        CAPABILITY_PROJECT_MANAGEMENT,
        "Only when the agent holds the run's board. The profiles it may assign the work to, and \
         name as reviewers, are its own roster's implementer and reviewer entries — so those lists \
         are per run."
    ),
    gate!(
        "update_issue",
        CAPABILITY_PROJECT_MANAGEMENT,
        "Only when the agent holds the run's board."
    ),
    gate!(
        "set_issue_blocked_by",
        CAPABILITY_PROJECT_MANAGEMENT,
        "Only when the agent holds the run's board."
    ),
    gate!(
        "remove_epic",
        CAPABILITY_PROJECT_MANAGEMENT,
        "Only when the agent holds the run's board."
    ),
    gate!(
        "remove_issue",
        CAPABILITY_PROJECT_MANAGEMENT,
        "Only when the agent holds the run's board."
    ),
    gate!(
        "wait_for_issue",
        CAPABILITY_PROJECT_MANAGEMENT,
        "Only when the agent holds the run's board. Declared like the delegation calls and \
         intercepted by the loop, which suspends the agent on the orchestrator's issue-wait \
         registry."
    ),
    gate!(
        "evict_file_view",
        CAPABILITY_AGENT_MANAGED_CONTEXT,
        "Only when the agent holds a thread archive."
    ),
    gate!(
        "archive_thread",
        CAPABILITY_AGENT_MANAGED_CONTEXT,
        "Only when the agent holds a thread archive."
    ),
    gate!(
        "search_archive",
        CAPABILITY_AGENT_MANAGED_CONTEXT,
        "Only when the agent holds a thread archive — the store this one reads."
    ),
    gate!(
        "compact",
        CAPABILITY_COMPACTION,
        "Only under the `self-compaction` strategy, which hands the compaction to the working model \
         itself — or under `self-summarization` in code mode, where an agent has no prose to answer \
         in. Offered on every turn of such a run, not only when the window fills, so the cached \
         prompt prefix never changes."
    ),
    gate!(
        "spawn_subagent",
        CAPABILITY_SUBAGENTS,
        "Only when the agent's roster lists at least one agent it may spawn. The description \
         enumerates that roster with each entry's caller-scoped guidance, so it is per run."
    ),
    gate!(
        "wait_for_subagents",
        CAPABILITY_SUBAGENTS,
        "Offered to an agent that can have children at all — either a non-empty roster or the \
         `fork` its own capability buys it."
    ),
    gate!(
        "send_message",
        CAPABILITY_SUBAGENTS,
        "Offered to an agent that can have children at all — either a non-empty roster or the \
         `fork` its own capability buys it."
    ),
    gate!(
        "transition_state",
        CAPABILITY_FSM,
        "Offered from where the agent *stands* rather than from its own profile: the machine is \
         declared by a separate FSM shell agent, and the call appears only in a state that has \
         somewhere to go. Its description names that state and its own outgoing edges, so it is per \
         machine."
    ),
    gate!(
        "exec",
        CAPABILITY_EXEC,
        "Only when the agent's roster is non-empty, and never for an agent standing in a machine \
         state — there, where the run goes next is the machine's decision and `transition_state` is \
         how it is made. The description enumerates the roster, so it is per run."
    ),
    gate!(
        "fork",
        CAPABILITY_FORK,
        "Also requires the `subagents` capability, which is what buys the `wait_for_subagents` and \
         `send_message` calls that collect the copy; a fork nobody can collect is a leak rather \
         than a second worker."
    ),
];
