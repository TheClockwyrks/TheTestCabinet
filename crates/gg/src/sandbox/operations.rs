//! gg's own vocabulary of **operations**: every call a [responses-as-code](crate::sandbox) program
//! can make, and — for each — the one thing that decides whether an agent is given it.
//!
//! An operation is a *capability a program can exercise*, named once, on gg's side, in gg's own
//! words. It is deliberately not a function: a function is a spelling, and every registered
//! [language](mod@super::language) spells the same operation its own way. `request_changes` and
//! `requestChanges` are one operation; so are a free function and the method some arm hangs off the
//! type it operates on.
//!
//! # This is the responses-as-code vocabulary, and only that
//!
//! gg has two model-facing surfaces over one core of typed implementations, and an agent has
//! **exactly one** of them: a tool-calling agent emits a JSON tool call, a responses-as-code agent
//! writes a program that calls typed API functions. The two are independent all the way down to the
//! typed implementation they share — the chain is *tool → internal* and *operation → internal*, never
//! one through the other — and the names are independent with them. An operation id is not usable as
//! a tool name and a tool name is not usable here; nothing in this table is derived from gg's tool
//! vocabulary, and nothing in that vocabulary is derived from this table.
//!
//! Which is not to say the two are equals. Responses-as-code is the strictly richer surface: fourteen
//! operations have no tool behind them at all, three operations share one read, and a program
//! composes calls a tool-calling turn can only make one at a time. Tool calling is the **subset**,
//! and a gate that held the two in bijection would be asserting a symmetry gg does not have.
//!
//! # Every SDK is static, so this table is the enforcement
//!
//! No arm withholds a name. Every function of every arm's SDK is compiled, linked and callable
//! whatever the run enabled, and what a program gets for calling one it was not granted is a
//! **refusal from the host** rather than an unknown identifier from the language. That is what makes
//! this table load-bearing rather than descriptive: [`Grants::permits`] is the whole gate, asked
//! once by the [membrane](super::membrane) when a call arrives and once by the
//! [documentation runtime](crate::docs::DocsRuntime::bound) when a search decides what to show, and
//! the two cannot disagree because there is one implementation of the question.
//!
//! # No arm, and no reflected catalogue, ever learns a capability id
//!
//! [`Binding::Capability`] names a gg capability id (`read-file`, `program-library`), and that name
//! appears **only** here. It is not in any `signatures.json`, not in any SDK, and not in anything a
//! reflector emits — a catalogue that carried one would be an arm asserting something about gg's
//! configuration surface, which is the one thing an arm cannot be held to. The
//! [projection](super::signatures::CatalogueFunction::capability) that carries the id to the docs
//! runtime reads it off the [`Binding`] here, and this table is the only place it is written down.

use std::collections::BTreeSet;
use std::fmt;

use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_COMPACTION, CAPABILITY_DOCVIEW_CLOSE,
    CAPABILITY_EDIT_FILE, CAPABILITY_EXEC, CAPABILITY_FORK, CAPABILITY_LIST_DIR,
    CAPABILITY_MEMORIES, CAPABILITY_PROGRAM_LIBRARY, CAPABILITY_PROJECT_MANAGEMENT,
    CAPABILITY_READ_FILE, CAPABILITY_SHELL, CAPABILITY_SKILLS, CAPABILITY_SUBAGENTS,
    CAPABILITY_TASKS, CAPABILITY_WRITE_FILE, GgProgramLanguage,
};

use crate::ending::EndingRole;

use super::signatures::CatalogueFunction;

/// One operation's **identity**: the family it belongs to, and gg's own key for it within that
/// family. Rendered `files.read_file`.
///
/// Two fields rather than one string because both halves are read separately and neither may be
/// recovered by splitting: the namespace is the grouping every cross-arm readout joins on, and the
/// key is the word gg names the operation by wherever an arm's spelling would be wrong to quote. A
/// single `"files.read_file"` would have to be split at a dot to get either, and an id whose key
/// contained one would split wrongly and silently.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct OperationId {
    /// The [family](Operation::family)'s short name — `files`, `board`, `views`.
    ///
    /// It is the family's *name*, not its id: the skills library files the filesystem family under
    /// `gg-filesystem`, because a skill's id is a handle a model reads, and an operation id
    /// carrying that prefix would spell `gg-filesystem.read_file` — gg's own name for gg, twice.
    /// The two are held in bijection by the [capability gate](mod@super::language), so the short name is
    /// a rename of one vocabulary rather than a second one.
    pub namespace: &'static str,
    /// gg's own key for the operation within its family: `read_file`, `request_changes`. Always
    /// `snake_case`, and deliberately not any one SDK's spelling of it.
    pub key: &'static str,
}

impl OperationId {
    /// The operation `key` names within `namespace`.
    const fn new(namespace: &'static str, key: &'static str) -> Self {
        Self { namespace, key }
    }
}

impl fmt::Display for OperationId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}", self.namespace, self.key)
    }
}

// ---------------------------------------------------------------------------------------------
// The ids
// ---------------------------------------------------------------------------------------------

// Every operation gg has, named once. A constant rather than a literal at the row below it because
// these are what the rest of gg *quotes*: the membrane opens each call's record under one, the
// prompt names calls by one, and a refusal spells one back at the model in the arm's own words. Two
// literals for one operation — one in the table and one at the call site — is the drift the surface
// call pair used to be, and it disagreed with the table on seven of twelve groupings before it was
// deleted.
//
// The constant is named for the id it carries, namespace first, so that a reader who has the
// rendered id from an event (`memories.update_memory`) can find its row by reading the name.

/// Run a shell command in the workspace.
pub const SHELL_SHELL: OperationId = OperationId::new("shell", "shell");

/// Read a workspace file, as the variant the read returns.
pub const FILES_READ_FILE: OperationId = OperationId::new("files", "read_file");

/// Read a workspace file's text directly — the one helper, which shares
/// [`read_file`](FILES_READ_FILE)'s gate and has an identity of its own.
pub const FILES_READ_TEXT_FILE: OperationId = OperationId::new("files", "read_text_file");

/// Write a workspace file whole.
pub const FILES_WRITE_FILE: OperationId = OperationId::new("files", "write_file");

/// Replace one string in a workspace file.
pub const FILES_EDIT_FILE: OperationId = OperationId::new("files", "edit_file");

/// List a workspace directory.
pub const FILES_LIST_DIR: OperationId = OperationId::new("files", "list_dir");

/// Read an authored skill.
pub const SKILLS_READ_SKILL: OperationId = OperationId::new("skills", "read_skill");

/// Write the agent's single scratchpad memory.
pub const MEMORIES_WRITE_MEMORY: OperationId = OperationId::new("memories", "write_memory");

/// Update an existing memory whole.
pub const MEMORIES_UPDATE_MEMORY: OperationId = OperationId::new("memories", "update_memory");

/// Create a new memory.
pub const MEMORIES_CREATE_MEMORY: OperationId = OperationId::new("memories", "create_memory");

/// Read one memory.
pub const MEMORIES_READ_MEMORY: OperationId = OperationId::new("memories", "read_memory");

/// Replace one string in a memory.
pub const MEMORIES_EDIT_MEMORY: OperationId = OperationId::new("memories", "edit_memory");

/// Search the memory index by keyword.
pub const MEMORIES_SEARCH_MEMORIES: OperationId = OperationId::new("memories", "search_memories");

/// Delete a memory.
pub const MEMORIES_DELETE_MEMORY: OperationId = OperationId::new("memories", "delete_memory");

/// Add a task to the agent's own list.
pub const TASKS_ADD_TASK: OperationId = OperationId::new("tasks", "add_task");

/// Patch a task.
pub const TASKS_UPDATE_TASK: OperationId = OperationId::new("tasks", "update_task");

/// Re-state a task's dependencies.
pub const TASKS_SET_BLOCKED_BY: OperationId = OperationId::new("tasks", "set_blocked_by");

/// Mark a task done.
pub const TASKS_COMPLETE_TASK: OperationId = OperationId::new("tasks", "complete_task");

/// Drop a task.
pub const TASKS_REMOVE_TASK: OperationId = OperationId::new("tasks", "remove_task");

/// Open an epic on the board.
pub const BOARD_CREATE_EPIC: OperationId = OperationId::new("board", "create_epic");

/// File an issue on the board.
pub const BOARD_CREATE_ISSUE: OperationId = OperationId::new("board", "create_issue");

/// Patch an issue.
pub const BOARD_UPDATE_ISSUE: OperationId = OperationId::new("board", "update_issue");

/// Re-state an issue's dependencies.
pub const BOARD_SET_ISSUE_BLOCKED_BY: OperationId =
    OperationId::new("board", "set_issue_blocked_by");

/// Remove an epic.
pub const BOARD_REMOVE_EPIC: OperationId = OperationId::new("board", "remove_epic");

/// Remove an issue.
pub const BOARD_REMOVE_ISSUE: OperationId = OperationId::new("board", "remove_issue");

/// Register a deferred wait on a board issue.
pub const BOARD_WAIT_FOR_ISSUE: OperationId = OperationId::new("board", "wait_for_issue");

/// Reclaim a file view from the agent's own window.
pub const CONTEXT_EVICT_FILE_VIEW: OperationId = OperationId::new("context", "evict_file_view");

/// Archive a range of the agent's own thread.
pub const CONTEXT_ARCHIVE_THREAD: OperationId = OperationId::new("context", "archive_thread");

/// Search what the agent has archived.
pub const CONTEXT_SEARCH_ARCHIVE: OperationId = OperationId::new("context", "search_archive");

/// Register a compaction of the agent's own window.
pub const CONTEXT_COMPACT: OperationId = OperationId::new("context", "compact");

/// Spawn a child agent.
pub const DELEGATION_SPAWN_SUBAGENT: OperationId = OperationId::new("delegation", "spawn_subagent");

/// Block until child agents return.
pub const DELEGATION_WAIT_FOR_SUBAGENTS: OperationId =
    OperationId::new("delegation", "wait_for_subagents");

/// Send a message to a running child.
pub const DELEGATION_SEND_MESSAGE: OperationId = OperationId::new("delegation", "send_message");

/// Declare a move to another state of this agent's machine.
pub const DELEGATION_TRANSITION_STATE: OperationId =
    OperationId::new("delegation", "transition_state");

/// Declare that this session continues as another agent.
pub const DELEGATION_EXEC: OperationId = OperationId::new("delegation", "exec");

/// Register a copy of this agent.
pub const DELEGATION_FORK: OperationId = OperationId::new("delegation", "fork");

/// **The call the whole discovery loop begins at**: search the surface this agent binds by keyword,
/// by module, or by both, and read the briefs that come back.
///
/// The prompt names no function, so this is the only way a model can learn what it holds without
/// having been told a name first — which is why it is bound to every program whatever a run enables.
pub const DOCS_SEARCH: OperationId = OperationId::new("docs", "search");

/// Take one documentation view back out of the agent's window, by the key it was opened under.
pub const DOCS_CLOSE: OperationId = OperationId::new("docs", "close");

/// Take **every** documentation view out of the agent's window — the blanket form of
/// [`DOCS_CLOSE`], behind the same capability.
pub const DOCS_CLOSE_ALL: OperationId = OperationId::new("docs", "close_all");

/// Read a workspace file **and** show it to the agent. It shares the read gate with
/// [`files.read_file`](FILES_READ_FILE) and is recorded as itself: what the model wrote is
/// `views.open_file`, and what runs underneath is the execution layer's business.
pub const VIEWS_OPEN_FILE: OperationId = OperationId::new("views", "open_file");

/// The call that shows the agent a value it computed — quoted in the prompt's account of the
/// message kinds an agent receives.
pub const VIEWS_OPEN_TEXT: OperationId = OperationId::new("views", "open_text");

/// Show the agent one function's documentation.
pub const VIEWS_OPEN_DOCS_VIEW: OperationId = OperationId::new("views", "open_docs_view");

/// The call that closes a view — what the context-pressure block points an agent at when text views
/// are holding window it could reclaim. Bought by
/// [`agent-managed-context`](CAPABILITY_AGENT_MANAGED_CONTEXT): closing what the program opened is
/// managing the window, exactly as evicting a file view is.
pub const VIEWS_CLOSE: OperationId = OperationId::new("views", "close");

/// What is open in the agent's window right now. Bought by
/// [`agent-managed-context`](CAPABILITY_AGENT_MANAGED_CONTEXT) beside [`close`](VIEWS_CLOSE): the
/// listing exists to decide what to close.
pub const VIEWS_CURRENT: OperationId = OperationId::new("views", "current");

/// The [program library](crate::programs)'s own directory.
pub const PROGRAMS_HISTORY: OperationId = OperationId::new("programs", "history");

/// The program-library call that fetches a program the agent already ran.
pub const PROGRAMS_GET: OperationId = OperationId::new("programs", "get");

/// The program-library call that hands gg a program to run in place of the current one — quoted in
/// every notice about a hand-over gg did not honour.
pub const PROGRAMS_RERUN: OperationId = OperationId::new("programs", "rerun");

/// The [standard](crate::ending::EndingRole::Standard) role's ending call.
pub const SESSION_FINISH: OperationId = OperationId::new("session", "finish");

/// The [review](crate::ending::EndingRole::Review) role's approval.
pub const SESSION_APPROVE: OperationId = OperationId::new("session", "approve");

/// The review role's change request.
pub const SESSION_REQUEST_CHANGES: OperationId = OperationId::new("session", "request_changes");

/// What buys one operation — the whole of gg's gating vocabulary for the responses-as-code surface,
/// and the only place any of it is written down.
///
/// The four arms are not four spellings of one condition; they are four different *kinds* of thing
/// deciding, and an agent's scope is assembled from all four at once.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Binding {
    /// Bound for agents dispatched in this [ending role](EndingRole), and withheld from every
    /// other: "the work is complete" is not a verdict a reviewer is asked for.
    ///
    /// The one gate no configuration reaches. A role is what an agent was *dispatched* as, so an
    /// allowlist that could withhold an ending would be a configuration in which an agent cannot end
    /// its own session.
    Ending(EndingRole),
    /// Bought by this gg capability, and — within it — by the agent's own operation allowlist. Every
    /// operation a run can configure at all is one of these; see [`Grants::permits`] for why both
    /// halves are asked.
    ///
    /// More than one operation may name the same capability, and most do: a capability is a *family*
    /// of calls in gg's configuration surface, and `read-file` alone buys three — `files.read_file`,
    /// `files.read_text_file` and `views.open_file` are three operations over one read. They are
    /// separate operations because they are separately documented, separately called and separately
    /// grantable.
    Capability(&'static str),
    /// Bought by **where this instance stands**, and by nothing on its own profile: the one call an
    /// agent holds because of a machine it was placed in rather than because of a capability
    /// somebody switched on for it.
    ///
    /// It has exactly one member, [`transition_state`](DELEGATION_TRANSITION_STATE), and the arm
    /// exists because that call cannot be spelled as a capability without becoming unreachable. The
    /// [`fsm`](test_cabinet_core::gg::CAPABILITY_FSM) capability is what makes a profile the *shell*
    /// driving a machine, and a shell takes no turns; the profile that actually runs a state is an
    /// ordinary one that never declares it. Filing the row under that capability would therefore ask
    /// a question whose answer is `false` for every agent that could ever make the call, and leave a
    /// program standing in a state it cannot move out of.
    ///
    /// No allowlist reaches it either, for the same reason and by the same argument the ending calls
    /// make: an agent's configuration is written where the machine is not visible, so a list that
    /// could withhold the transition would be a configuration in which a state has no exit.
    /// [`Grants`] carries it as a granted operation the run resolved rather than as one the
    /// configuration named — see [`crate::sandbox::granted_operations`].
    Machine,
    /// Bound to every program whatever a run enables. A run that grants nothing at all must still be
    /// able to show its model something — and must always be able to *find* what it does hold —
    /// which is why the two view calls that *open* something gg holds or the program computed
    /// ([`open_text`](VIEWS_OPEN_TEXT), [`open_docs_view`](VIEWS_OPEN_DOCS_VIEW)) are this and why
    /// the documentation search ([`search`](DOCS_SEARCH)) is exactly it. Those three are the whole
    /// of it: closing a view and listing what is open are context management and are bought by
    /// [`agent-managed-context`](CAPABILITY_AGENT_MANAGED_CONTEXT) like the rest of that family.
    Always,
}

/// Which registered [languages](GgProgramLanguage) are expected to offer an operation at all.
///
/// It is declared **gg-side, per operation**, and that placement is the whole point: an arm that
/// simply never bound an operation would otherwise be indistinguishable from an arm where the
/// operation makes no sense, and the difference between those two is a judgement nobody can compute.
/// Writing it here makes the judgement explicit, central, and reviewed in the same diff as the
/// operation it excuses — rather than implicit in the omitting package, where the only evidence is
/// an absence.
///
/// It ranges over **operations, not spellings**, and the boundary is worth stating because it is
/// where the propagation rule stops. A helper that is a new *capability* becomes a row here, and
/// every arm that has not followed goes red by name. A helper that is a second way into a
/// capability every arm already binds — the method some arm hangs off the type it operates on,
/// beside the free function everybody has — names an operation that already exists, so it needs no
/// row, no exemption and no reason, and an arm may ship it where another does not. That is
/// deliberate: requiring the rest to follow would be requiring eleven arms to agree on a receiver,
/// which is the shape parity the capability gate was re-founded to retire. The capability gate's
/// module header states the same boundary from the other side.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(
    dead_code,
    reason = "the propagation rule this expresses is enforced by the capability gate rather than \
              read at run time, and no arm needs an exemption today — the type is here so that the \
              first one that does is written down beside the operation instead of in the package \
              that omits it. Both of its arms are exercised: the gate's tests add an operation no \
              arm binds and watch every arm fail, then excuse them and watch it pass."
)]
pub enum Applicability {
    /// Every registered language offers it. The default, and the state of all 50 today.
    Universal,
    /// Every registered language offers it **except** these, each paired with the reason — prose,
    /// required, and reviewed. An exemption naming a language that in fact binds the operation is
    /// dead and fails the gate, so the list cannot rot into a blanket waiver.
    ///
    /// The reason being *required* is the whole of the clause's value, so it is held at compile time
    /// rather than under test: a blank one would satisfy every run-time check here — the arm really
    /// does not bind the operation, so the dead-exemption converse stays quiet — and waive the
    /// operation on that arm permanently with nothing written down. See the `const` assertion below.
    UniversalExcept(&'static [(GgProgramLanguage, &'static str)]),
}

/// One model-facing operation: what it is called in gg's own vocabulary, which family it belongs to,
/// what binds it, and whether a program passes it anything.
#[derive(Debug, Clone, Copy)]
#[allow(
    dead_code,
    reason = "a run reads two of these fields — `id` to resolve a catalogue entry to its row, and \
              `binding` to decide whether the agent has it. The other three are read by the \
              capability gate (`language/agreement.rs`), which is where a table that exists to be \
              *correct* rather than to be *called* earns its keep; each becomes a run-time read as \
              the stages that consume it land."
)]
pub struct Operation {
    /// gg's stable identity for it, and the cross-arm join key: `files.read_file`.
    pub id: OperationId,
    /// The [family](crate::skills) it belongs to, by that family's own id (`gg-filesystem`) — the
    /// one grouping that survives every arm being idiomatic, and therefore the one the
    /// [id](Self::id) is namespaced on.
    pub family: &'static str,
    /// What buys it. gg decides this; **no arm declares it**.
    pub binding: Binding,
    /// Whether a program passes it anything at all.
    ///
    /// One bit rather than a shape, because the shape is spelling — an optional argument is an
    /// overload pair in one language and a default in another — while *takes nothing* is a property
    /// of the operation that every arm must agree on. It is what catches the failure a reflector
    /// emitting empty parameters for everything would otherwise slip past: four operations take no
    /// input, and any arm claiming a fifth is wrong about its own signatures.
    pub takes_input: bool,
    /// Which languages are expected to offer it. See [`Applicability`].
    pub applies: Applicability,
}

/// The [family](Operation::family) ids, named once so that a row of the table below files an
/// operation under a family by a name a typo cannot survive. Each is asserted to be a real
/// `skills::builtin` family.
pub(crate) const FAMILY_FILESYSTEM: &str = "gg-filesystem";
pub(crate) const FAMILY_SHELL: &str = "gg-shell";
pub(crate) const FAMILY_PROJECT: &str = "gg-project";
pub(crate) const FAMILY_TASKS: &str = "gg-tasks";
pub(crate) const FAMILY_MEMORY: &str = "gg-memory";
pub(crate) const FAMILY_SKILLS: &str = "gg-skills";
pub(crate) const FAMILY_CONTEXT: &str = "gg-context";
pub(crate) const FAMILY_DELEGATION: &str = "gg-delegation";
pub(crate) const FAMILY_DOCS: &str = "gg-docs";
pub(crate) const FAMILY_VIEWS: &str = "gg-views";
pub(crate) const FAMILY_PROGRAMS: &str = "gg-programs";
pub(crate) const FAMILY_SESSION: &str = "gg-session";

/// [`Operation::takes_input`], spelled. A bare `true` at the end of a row says nothing about which
/// field it is, and this table is read far more often than it is written.
const TAKES_INPUT: bool = true;
/// [`Operation::takes_input`], spelled — the operations a program calls with nothing.
const NO_INPUT: bool = false;

/// One operation, spelled compactly: its id, its family, what binds it, and whether it takes input.
///
/// The second form carries [exemptions](Applicability::UniversalExcept). It has no uses today —
/// every arm offers every operation — and it is written down all the same, because the first arm
/// that legitimately cannot offer one must have somewhere to say so *here*, in the diff that
/// excuses it.
macro_rules! operation {
    ($id:expr, $family:expr, $binding:expr, $input:expr) => {
        Operation {
            id: $id,
            family: $family,
            binding: $binding,
            takes_input: $input,
            applies: Applicability::Universal,
        }
    };
    ($id:expr, $family:expr, $binding:expr, $input:expr, $except:expr) => {
        Operation {
            id: $id,
            family: $family,
            binding: $binding,
            takes_input: $input,
            applies: Applicability::UniversalExcept($except),
        }
    };
}

/// **Every operation a responses-as-code program can make**, in catalogue order.
///
/// Enumerated rather than derived, because it is one half of an agreement. An operation with no arm
/// behind it puts a sentence in front of a model naming something its scope does not hold; an arm
/// binding something with no row here is a call gg has no identity to record, gate or document
/// under. Deriving either from the other would prove neither.
///
/// It is derived from nothing at all on the *tool* side either, and that is the point of the whole
/// table: a tool name is a second, independent vocabulary belonging to the other surface, and a row
/// here says which **capability** buys the call. Two operations that a tool-calling agent would reach
/// through one tool are two rows; fourteen rows correspond to no tool whatsoever.
///
/// # The `docs` family, and why it is a family of its own
///
/// The three [documentation](crate::docs) calls were the one part of the model-facing surface this
/// table did not carry. The host implemented all three — the index, the ranking, the permission
/// filter, the WIT interface, the membrane — and none of them was ever enrolled here, so the
/// register gate (`language/register.rs`) and the capability gate (`language/agreement.rs`), which
/// are both keyed on this table, had nothing to look for. Every arm's SDK could therefore omit them
/// with every gate green, and every arm did: the [prompt](crate::prompts) tells a model to search
/// and no arm gives it a name to call. Enrolling them is what turns that silence into eleven named
/// failures.
///
/// They are filed under a **twelfth** family rather than joined to `views`, for three reasons that
/// point the same way. Their gating does not fit that family's rule — opening a view is bound to
/// every program except where it reads the workspace, and managing one is bought by
/// `agent-managed-context` (the capability gate's `views` rule), and two of these are bought by a
/// capability of their own, so folding them in would mean weakening the rule that keeps a gate off
/// the only channel into a model's window. The namespace and the family are held in
/// bijection, so a `views` family would force `views.search`, naming a search over gg's
/// documentation after the surface a model shows *itself* things through. And the seam is already
/// drawn this way everywhere else: they have their own WIT interface, their own membrane file, and
/// their own [runtime](crate::docs::DocsRuntime).
///
/// What stays behind in `views` is [`open_docs_view`](VIEWS_OPEN_DOCS_VIEW), and that is the right
/// side of the line rather than a leftover: opening a documentation view *is* putting material into
/// the window, which is what the view family is, and it is the one of the four that a run can
/// neither buy nor withhold. Closing a view and listing what is open are the family's other half —
/// managing the window rather than filling it — and are bought by
/// [`agent-managed-context`](CAPABILITY_AGENT_MANAGED_CONTEXT) with the evictions and the archive.
pub const OPERATIONS: &[Operation] = &[
    operation!(
        SHELL_SHELL,
        FAMILY_SHELL,
        Binding::Capability(CAPABILITY_SHELL),
        TAKES_INPUT
    ),
    operation!(
        FILES_READ_FILE,
        FAMILY_FILESYSTEM,
        Binding::Capability(CAPABILITY_READ_FILE),
        TAKES_INPUT
    ),
    operation!(
        FILES_READ_TEXT_FILE,
        FAMILY_FILESYSTEM,
        Binding::Capability(CAPABILITY_READ_FILE),
        TAKES_INPUT
    ),
    operation!(
        FILES_WRITE_FILE,
        FAMILY_FILESYSTEM,
        Binding::Capability(CAPABILITY_WRITE_FILE),
        TAKES_INPUT
    ),
    operation!(
        FILES_EDIT_FILE,
        FAMILY_FILESYSTEM,
        Binding::Capability(CAPABILITY_EDIT_FILE),
        TAKES_INPUT
    ),
    operation!(
        FILES_LIST_DIR,
        FAMILY_FILESYSTEM,
        Binding::Capability(CAPABILITY_LIST_DIR),
        TAKES_INPUT
    ),
    operation!(
        SKILLS_READ_SKILL,
        FAMILY_SKILLS,
        Binding::Capability(CAPABILITY_SKILLS),
        TAKES_INPUT
    ),
    operation!(
        MEMORIES_WRITE_MEMORY,
        FAMILY_MEMORY,
        Binding::Capability(CAPABILITY_MEMORIES),
        TAKES_INPUT
    ),
    operation!(
        MEMORIES_UPDATE_MEMORY,
        FAMILY_MEMORY,
        Binding::Capability(CAPABILITY_MEMORIES),
        TAKES_INPUT
    ),
    operation!(
        MEMORIES_CREATE_MEMORY,
        FAMILY_MEMORY,
        Binding::Capability(CAPABILITY_MEMORIES),
        TAKES_INPUT
    ),
    operation!(
        MEMORIES_READ_MEMORY,
        FAMILY_MEMORY,
        Binding::Capability(CAPABILITY_MEMORIES),
        TAKES_INPUT
    ),
    operation!(
        MEMORIES_EDIT_MEMORY,
        FAMILY_MEMORY,
        Binding::Capability(CAPABILITY_MEMORIES),
        TAKES_INPUT
    ),
    operation!(
        MEMORIES_SEARCH_MEMORIES,
        FAMILY_MEMORY,
        Binding::Capability(CAPABILITY_MEMORIES),
        TAKES_INPUT
    ),
    operation!(
        MEMORIES_DELETE_MEMORY,
        FAMILY_MEMORY,
        Binding::Capability(CAPABILITY_MEMORIES),
        TAKES_INPUT
    ),
    operation!(
        TASKS_ADD_TASK,
        FAMILY_TASKS,
        Binding::Capability(CAPABILITY_TASKS),
        TAKES_INPUT
    ),
    operation!(
        TASKS_UPDATE_TASK,
        FAMILY_TASKS,
        Binding::Capability(CAPABILITY_TASKS),
        TAKES_INPUT
    ),
    operation!(
        TASKS_SET_BLOCKED_BY,
        FAMILY_TASKS,
        Binding::Capability(CAPABILITY_TASKS),
        TAKES_INPUT
    ),
    operation!(
        TASKS_COMPLETE_TASK,
        FAMILY_TASKS,
        Binding::Capability(CAPABILITY_TASKS),
        TAKES_INPUT
    ),
    operation!(
        TASKS_REMOVE_TASK,
        FAMILY_TASKS,
        Binding::Capability(CAPABILITY_TASKS),
        TAKES_INPUT
    ),
    operation!(
        BOARD_CREATE_EPIC,
        FAMILY_PROJECT,
        Binding::Capability(CAPABILITY_PROJECT_MANAGEMENT),
        TAKES_INPUT
    ),
    operation!(
        BOARD_CREATE_ISSUE,
        FAMILY_PROJECT,
        Binding::Capability(CAPABILITY_PROJECT_MANAGEMENT),
        TAKES_INPUT
    ),
    operation!(
        BOARD_UPDATE_ISSUE,
        FAMILY_PROJECT,
        Binding::Capability(CAPABILITY_PROJECT_MANAGEMENT),
        TAKES_INPUT
    ),
    operation!(
        BOARD_SET_ISSUE_BLOCKED_BY,
        FAMILY_PROJECT,
        Binding::Capability(CAPABILITY_PROJECT_MANAGEMENT),
        TAKES_INPUT
    ),
    operation!(
        BOARD_REMOVE_EPIC,
        FAMILY_PROJECT,
        Binding::Capability(CAPABILITY_PROJECT_MANAGEMENT),
        TAKES_INPUT
    ),
    operation!(
        BOARD_REMOVE_ISSUE,
        FAMILY_PROJECT,
        Binding::Capability(CAPABILITY_PROJECT_MANAGEMENT),
        TAKES_INPUT
    ),
    operation!(
        BOARD_WAIT_FOR_ISSUE,
        FAMILY_PROJECT,
        Binding::Capability(CAPABILITY_PROJECT_MANAGEMENT),
        TAKES_INPUT
    ),
    operation!(
        CONTEXT_EVICT_FILE_VIEW,
        FAMILY_CONTEXT,
        Binding::Capability(CAPABILITY_AGENT_MANAGED_CONTEXT),
        TAKES_INPUT
    ),
    operation!(
        CONTEXT_ARCHIVE_THREAD,
        FAMILY_CONTEXT,
        Binding::Capability(CAPABILITY_AGENT_MANAGED_CONTEXT),
        TAKES_INPUT
    ),
    operation!(
        CONTEXT_SEARCH_ARCHIVE,
        FAMILY_CONTEXT,
        Binding::Capability(CAPABILITY_AGENT_MANAGED_CONTEXT),
        TAKES_INPUT
    ),
    operation!(
        CONTEXT_COMPACT,
        FAMILY_CONTEXT,
        Binding::Capability(CAPABILITY_COMPACTION),
        TAKES_INPUT
    ),
    operation!(
        DELEGATION_SPAWN_SUBAGENT,
        FAMILY_DELEGATION,
        Binding::Capability(CAPABILITY_SUBAGENTS),
        TAKES_INPUT
    ),
    operation!(
        DELEGATION_WAIT_FOR_SUBAGENTS,
        FAMILY_DELEGATION,
        Binding::Capability(CAPABILITY_SUBAGENTS),
        TAKES_INPUT
    ),
    operation!(
        DELEGATION_SEND_MESSAGE,
        FAMILY_DELEGATION,
        Binding::Capability(CAPABILITY_SUBAGENTS),
        TAKES_INPUT
    ),
    operation!(
        DELEGATION_TRANSITION_STATE,
        FAMILY_DELEGATION,
        Binding::Machine,
        TAKES_INPUT
    ),
    operation!(
        DELEGATION_EXEC,
        FAMILY_DELEGATION,
        Binding::Capability(CAPABILITY_EXEC),
        TAKES_INPUT
    ),
    operation!(
        DELEGATION_FORK,
        FAMILY_DELEGATION,
        Binding::Capability(CAPABILITY_FORK),
        TAKES_INPUT
    ),
    operation!(DOCS_SEARCH, FAMILY_DOCS, Binding::Always, TAKES_INPUT),
    operation!(
        DOCS_CLOSE,
        FAMILY_DOCS,
        Binding::Capability(CAPABILITY_DOCVIEW_CLOSE),
        TAKES_INPUT
    ),
    operation!(
        DOCS_CLOSE_ALL,
        FAMILY_DOCS,
        Binding::Capability(CAPABILITY_DOCVIEW_CLOSE),
        NO_INPUT
    ),
    operation!(
        VIEWS_OPEN_FILE,
        FAMILY_VIEWS,
        Binding::Capability(CAPABILITY_READ_FILE),
        TAKES_INPUT
    ),
    operation!(VIEWS_OPEN_TEXT, FAMILY_VIEWS, Binding::Always, TAKES_INPUT),
    operation!(
        VIEWS_OPEN_DOCS_VIEW,
        FAMILY_VIEWS,
        Binding::Always,
        TAKES_INPUT
    ),
    operation!(
        VIEWS_CLOSE,
        FAMILY_VIEWS,
        Binding::Capability(CAPABILITY_AGENT_MANAGED_CONTEXT),
        TAKES_INPUT
    ),
    operation!(
        VIEWS_CURRENT,
        FAMILY_VIEWS,
        Binding::Capability(CAPABILITY_AGENT_MANAGED_CONTEXT),
        NO_INPUT
    ),
    operation!(
        PROGRAMS_HISTORY,
        FAMILY_PROGRAMS,
        Binding::Capability(CAPABILITY_PROGRAM_LIBRARY),
        NO_INPUT
    ),
    operation!(
        PROGRAMS_GET,
        FAMILY_PROGRAMS,
        Binding::Capability(CAPABILITY_PROGRAM_LIBRARY),
        TAKES_INPUT
    ),
    operation!(
        PROGRAMS_RERUN,
        FAMILY_PROGRAMS,
        Binding::Capability(CAPABILITY_PROGRAM_LIBRARY),
        TAKES_INPUT
    ),
    operation!(
        SESSION_FINISH,
        FAMILY_SESSION,
        Binding::Ending(EndingRole::Standard),
        TAKES_INPUT
    ),
    operation!(
        SESSION_APPROVE,
        FAMILY_SESSION,
        Binding::Ending(EndingRole::Review),
        NO_INPUT
    ),
    operation!(
        SESSION_REQUEST_CHANGES,
        FAMILY_SESSION,
        Binding::Ending(EndingRole::Review),
        TAKES_INPUT
    ),
];

/// The operation governing one [catalogue function](CatalogueFunction), or `None` for an entry gg
/// has no identity for.
///
/// The lookup is by the operation the entry **names**, never by the name a program calls it by,
/// which is exactly the half that differs between arms. A `None` is a **drift**: an arm binding
/// something gg does not know about, or gg having renamed a key without the arm following. Callers
/// treat it as unbound rather than panicking, because degrading one function out of a model's
/// documentation is a smaller failure than a run that stops — and
/// `every_catalogued_function_has_an_operation` proves the case unreachable for every registered
/// language, while the capability gate (`language/agreement.rs`) is what reports it *by name*.
pub fn operation_of(function: &CatalogueFunction) -> Option<&'static Operation> {
    operation_by_id(function.operation)
}

/// The operation `id` names, written as a catalogue writes it — `files.read_file` — or `None` for an
/// id gg has no row for.
///
/// The split is at the **first** dot rather than the last, and that is safe by construction: an
/// [`OperationId`]'s key is `snake_case` and its namespace is one word, so neither half can contain
/// one. Splitting a rendered id back into its two halves is the only thing this does that
/// [`Display`](OperationId) does not, and it is here — beside the table — so that the round trip is
/// one file's problem rather than every caller's.
pub fn operation_by_id(id: &str) -> Option<&'static Operation> {
    let (namespace, key) = id.split_once('.')?;
    OPERATIONS
        .iter()
        .find(|operation| operation.id.namespace == namespace && operation.id.key == key)
}

/// The row `id` belongs to, or `None` for an id no row carries.
///
/// The membrane is the caller: every host function opens its bracket with one of the
/// [id constants](SHELL_SHELL) above, and needs the row's [binding](Operation::binding) to ask
/// whether this agent has the call. `every_host_function_records_its_own_api_call` asserts that the
/// set of ids so recorded is exactly this table's, so the `None` arm is unreachable from there. It is
/// still an `Option` rather than a panic for the reason [`operation_of`] is: an id gg has no row for
/// is drift, and taking a run down over drift is the larger failure.
pub fn operation(id: OperationId) -> Option<&'static Operation> {
    OPERATIONS.iter().find(|operation| operation.id == id)
}

/// The [family](Operation::family) whose operations are namespaced on `module` — `gg-filesystem` for
/// `files` — or `None` for a module that carries no operation at all.
///
/// The [reference](crate::reference) is the caller: it files a module under the family the console
/// groups by, and the module id *is* the namespace of every operation in it, so the join is the
/// table's rather than a second mapping written beside it. `None` is a real answer rather than a
/// defect — every arm has a module for the type declarations that belong to no capability, and
/// nothing in it is callable — which is why the caller renders it as "no category" instead of
/// falling back to a family it guessed.
///
/// A namespace that covered two families would make this ambiguous; the capability gate holds the
/// two in bijection in both directions (`identities` in `language/agreement.rs`), so the first match
/// is the only match.
pub fn family_of_module(module: &str) -> Option<&'static str> {
    OPERATIONS
        .iter()
        .find(|operation| operation.id.namespace == module)
        .map(|operation| operation.family)
}

/// **Every gg capability that buys part of this surface**, in table order and each once.
///
/// Derived rather than listed, because a list beside the table is a list that will disagree with it.
/// Two callers need it and both need it to be complete: the [reference](crate::reference), which
/// documents the surface as a maximally-granted agent sees it, and gg's own fixtures, which build
/// such an agent. Neither is asking "which capabilities does gg have" — that is
/// [the catalog](test_cabinet_core::gg_query::GG_CAPABILITY_CATALOG), and most of its entries buy no
/// call at all.
pub fn gating_capabilities() -> Vec<&'static str> {
    let mut out: Vec<&'static str> = Vec::new();
    for operation in OPERATIONS {
        if let Binding::Capability(id) = operation.binding
            && !out.contains(&id)
        {
            out.push(id);
        }
    }
    out
}

/// **Every operation the gg capabilities in `capabilities` offer** — the whole of what a run *could*
/// grant with those capabilities on, in table order.
///
/// It is not what any agent holds. A grant is an [allowlist](Grants), so an agent holds the subset of
/// this its configuration names; what this answers is the question the other side of that
/// configuration asks — *which calls are there to choose from?* The console's agent editor seeds a
/// capability's calls from this set the moment the capability is switched on, and gg's own fixtures
/// build a fully-granted agent from it rather than writing fifty ids out by hand. Both would
/// otherwise keep a copy of the capability-to-operation mapping, and a copy of this table is a copy
/// that will disagree with it.
pub fn capability_operations<'a>(
    capabilities: impl IntoIterator<Item = &'a str>,
) -> Vec<OperationId> {
    let held: BTreeSet<&str> = capabilities.into_iter().collect();
    OPERATIONS
        .iter()
        .filter(|operation| match operation.binding {
            Binding::Capability(id) => held.contains(id),
            Binding::Ending(_) | Binding::Machine | Binding::Always => false,
        })
        .map(|operation| operation.id)
        .collect()
}

/// **Every operation bought by where an instance stands** rather than by anything its configuration
/// says — the [`Machine`](Binding::Machine) rows, in table order.
///
/// Two callers, and they are the two that have to agree with each other: the run, which adds these
/// to an agent's grant when the agent really is standing in a machine state, and the
/// [reference](crate::reference), which documents the surface as a maximally-granted agent sees it
/// and would otherwise leave out a call no capability can be switched on to reach. Deriving both
/// from the table is what keeps the page and the run describing one surface.
pub fn instance_operations() -> Vec<OperationId> {
    OPERATIONS
        .iter()
        .filter(|operation| matches!(operation.binding, Binding::Machine))
        .map(|operation| operation.id)
        .collect()
}

/// The operations `names` grant, and every name that grants nothing — the resolution of a configured
/// allowlist against this table.
///
/// The unresolved half is returned rather than dropped because it **refuses the launch** rather than
/// sitting inert: a name that answers to no operation is either a typo or a call from the other
/// surface's vocabulary (a bare `read_file`, which is a gg tool and not an operation id), and in
/// both cases the agent would silently have been granted less than whoever configured it intended. A
/// list that quietly ignores what it cannot read is a list nobody can tell is wrong.
///
/// Order and duplication are the table's, not the caller's: the granted ids come back in table
/// order and each at most once, so two configurations that name the same set resolve to the same
/// value however they were written.
pub fn resolve_operations<'a>(
    names: impl IntoIterator<Item = &'a str>,
) -> (Vec<OperationId>, Vec<String>) {
    let mut granted: BTreeSet<OperationId> = BTreeSet::new();
    let mut unknown = Vec::new();
    for name in names {
        match operation_by_id(name) {
            Some(operation) => {
                granted.insert(operation.id);
            }
            None => unknown.push(name.to_string()),
        }
    }
    let granted = OPERATIONS
        .iter()
        .map(|operation| operation.id)
        .filter(|id| granted.contains(id))
        .collect();
    (granted, unknown)
}

/// **What one agent was granted**, and therefore the one answer to "may this agent call X".
///
/// It is the counterpart of [`Binding`]: a binding says what buys an operation, and this says what
/// this agent holds — the gg capabilities on its profile, the [ending role](EndingRole) it was
/// dispatched in (or none at all, for the on-use script of a skill or a memory), and the operations
/// it was [granted](crate::sandbox::granted_operations). [`permits`](Self::permits) is where the two
/// meet, and it is the **only** place in gg where they meet.
///
/// # Why there is exactly one of these
///
/// Because the question is asked by two things that must never disagree. The
/// [documentation runtime](crate::docs::DocsRuntime) asks it to decide what a
/// [search](crate::docs::DocsRuntime::search) may return and what a documentation view may describe;
/// the [membrane](super::membrane) asks it to decide whether a call the program actually made is
/// serviced or refused. Every arm's SDK is **static** — every function is compiled, linked and
/// callable whatever the run enabled — so the membrane's answer is the whole enforcement, and a
/// membrane that said yes where search said no would be offering a capability the model was told it
/// did not have. The reverse is worse: search would advertise a call the host then refuses.
///
/// So both hold one of these, both call [`permits`](Self::permits), and neither carries a reading of
/// its own.
#[derive(Debug, Clone, Default)]
pub struct Grants {
    /// The gg capability ids this agent's profile enables.
    capabilities: BTreeSet<String>,
    /// The [ending role](EndingRole) this agent was dispatched in, or `None` for code that is not
    /// the agent's own turn at all and may therefore not declare the session over.
    ending: Option<EndingRole>,
    /// **The operations this agent was granted**, as
    /// [resolved for the instance](crate::sandbox::granted_operations): what its own allowlist names,
    /// narrowed to what its run can actually service, plus whatever its position bought it. Empty
    /// grants nothing that a capability gates; see [`permits`](Self::permits).
    operations: BTreeSet<OperationId>,
}

impl Grants {
    /// What an agent holding `capabilities`, dispatched in `ending`, and granted `operations` was
    /// given.
    pub fn new(
        capabilities: impl IntoIterator<Item = String>,
        ending: Option<EndingRole>,
        operations: impl IntoIterator<Item = OperationId>,
    ) -> Self {
        Self {
            capabilities: capabilities.into_iter().collect(),
            ending,
            operations: operations.into_iter().collect(),
        }
    }

    /// **Whether this agent may exercise `operation`.**
    ///
    /// The four arms are four different kinds of thing deciding, and each is checked against the
    /// half of the grant that can answer it. Nothing here falls back: an operation whose capability
    /// is off is not reachable by naming it in an allowlist, and an ending belonging to another role
    /// is not reachable by holding every capability gg has.
    ///
    /// # Why a capability gate *and* an allowlist
    ///
    /// Because they are answers to two different questions, and a configuration that could only ask
    /// one of them could not express what runs are actually compared. The capability says whether the
    /// machinery exists for this agent at all — whether it has a memory store, a board, a library of
    /// its own programs. The allowlist says which of that capability's calls this agent was handed,
    /// which is how one run gives an agent memories it may read and not revise while another gives it
    /// both.
    ///
    /// The allowlist is an allowlist and not a set of exceptions: an absent or empty list grants
    /// **nothing** the capability offers, because the list *is* the grant. There is no configuration
    /// that means "everything" and nothing here supplies one — what looks like that in the console is
    /// its editor writing the capability's whole set into the list when the capability is switched
    /// on, which is a fact about the editor and not a default here.
    ///
    /// # A [`Machine`](Binding::Machine) row asks the allowlist half alone
    ///
    /// Because there is no capability half to ask: the capability that declares a machine sits on a
    /// profile that takes no turns, so a conjunction naming it would be `false` for every agent that
    /// could make the call. What the set holds for such a row is not a configured entry at all but
    /// the run's own answer to "does this instance stand somewhere it can move from", written into
    /// the grant by [`granted_operations`](crate::sandbox::granted_operations) beside everything
    /// else, so that one predicate still decides every call.
    pub fn permits(&self, operation: &Operation) -> bool {
        match operation.binding {
            Binding::Capability(id) => {
                self.capabilities.contains(id) && self.operations.contains(&operation.id)
            }
            Binding::Machine => self.operations.contains(&operation.id),
            Binding::Ending(role) => self.ending == Some(role),
            Binding::Always => true,
        }
    }

    /// **Every operation this agent may exercise**, in table order.
    ///
    /// [`permits`](Self::permits) answered for the whole table at once, which is what a reader that
    /// has to *state* a grant rather than check one call against it needs: what the guest is told it
    /// was given, and what the agent's own surface record publishes. Derived here rather than
    /// assembled by each of them, so that "what this agent holds" and "what this agent is refused"
    /// cannot be computed two ways.
    pub fn granted(&self) -> Vec<OperationId> {
        OPERATIONS
            .iter()
            .filter(|operation| self.permits(operation))
            .map(|operation| operation.id)
            .collect()
    }

    /// The [ending role](EndingRole) this agent was dispatched in, for a refusal that has to name
    /// the ending calls the agent **does** have rather than only the one it does not.
    pub fn ending(&self) -> Option<EndingRole> {
        self.ending
    }
}

/// Whether `text` is empty or nothing but ASCII whitespace.
///
/// `str::trim` is not available in a `const` context, so the emptiness a reason is held to is spelled
/// out here rather than borrowed. Only ASCII whitespace is recognised, which is enough: a reason made
/// of non-breaking spaces is not the failure mode this guards against.
const fn is_blank(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if !bytes[i].is_ascii_whitespace() {
            return false;
        }
        i += 1;
    }
    true
}

/// **Every [exemption](Applicability::UniversalExcept) carries a written reason**, asserted at
/// compile time because the failure it catches is an omission, and an omission is exactly what a
/// reviewer skims past.
///
/// Coverage cannot catch this one. A blank reason still excuses the arm, so the arm really does not
/// bind the operation, the dead-exemption converse stays quiet, and the operation is waived there
/// for good with the justification the clause exists to force left unwritten. The capability gate
/// (`language/agreement.rs`) reports it too — that is the copy that can be *watched* rejecting a
/// table, since this one cannot be handed a wrong table at all — and here it fails a `cargo check`,
/// before there is a green suite to be reassured by.
///
/// An empty exemption *list* fails too. `UniversalExcept(&[])` is [`Applicability::Universal`] said
/// in a way that reads like a waiver, and a row that reads like a waiver is one a later edit will
/// append to without re-deriving whether it should exist at all.
///
/// **This is the message a developer actually sees**, and it is the less helpful of the two. A
/// `const` block is evaluated before anything runs, so a blank reason fails the build here and the
/// gate's own sentence — which names both the operation and the arm (``` `files.list_dir` is
/// excused on `ruby` with no reason ```) — is never reached on the real table. What this one can
/// say is that *a* row is wrong, with the span pointing at the assertion rather than at the row, so
/// on a table of 50 the next step is to read the exemptions rather than to follow the error. The
/// two are not redundant: [`is_blank`] recognises ASCII whitespace only, where the gate's
/// `reason.trim()` also strips U+00A0, so the gate is the stricter of the two on a reason it will
/// never be shown — and the gate is the copy that can be *watched* rejecting a table, which this
/// one, being unable to be handed a wrong table at all, cannot.
const _: () = {
    let mut i = 0;
    while i < OPERATIONS.len() {
        if let Applicability::UniversalExcept(exemptions) = OPERATIONS[i].applies {
            assert!(
                !exemptions.is_empty(),
                "an operation excuses nobody — an empty exemption list is `Applicability::Universal`, \
                 and should be spelled that way"
            );
            let mut j = 0;
            while j < exemptions.len() {
                assert!(
                    !is_blank(exemptions[j].1),
                    "an operation is excused on an arm with no reason — an exemption's reason is \
                     prose, required, and reviewed, because it is the only record of why that arm \
                     is permanently waived"
                );
                j += 1;
            }
        }
        i += 1;
    }
};

#[cfg(test)]
#[path = "operations.test.rs"]
mod tests;
