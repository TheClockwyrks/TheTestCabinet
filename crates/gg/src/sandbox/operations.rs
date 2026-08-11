//! gg's own vocabulary of **operations**: every model-facing call the surface has, and — for each —
//! the one thing that decides whether an agent is given it.
//!
//! An operation is a *capability a program can exercise*, named once, on gg's side, in gg's own
//! words. It is deliberately not a function: a function is a spelling, and every registered
//! [language](mod@super::language) spells the same operation its own way. `request_changes` and
//! `requestChanges` are one operation; so are a free function and the method some arm hangs off the
//! type it operates on.
//!
//! # What this replaces, and why it is stronger
//!
//! The table below is the successor of `MODEL_FACING_CALLS`, which enumerated the same 47 calls as
//! bare `(object, key)` pairs and stopped there. Everything *about* a call that gg then had to act
//! on — the tool whose being enabled binds it, the [ending role](EndingRole) whose programs get it,
//! the fact that the [program library](crate::programs)'s three are bought by a capability — lived
//! in eleven committed catalogues, one per arm, as the `requires` and `ending` fields a reflector
//! wrote. Eleven copies of one fact, kept equal by comparing them to each other.
//!
//! Here it is stated once, by gg, as a [`Binding`]. An arm no longer has a field it can be wrong in,
//! and the [documentation runtime](crate::docs::DocsRuntime::bound) — the single predicate deciding
//! what a model may be shown — reads this rather than the arm's own claim about itself.
//!
//! # No arm, and no committed catalogue, ever learns a capability id
//!
//! [`Binding::Capability`] names a gg capability id (`program-library`), and that name appears
//! **only** here. It is not in any `signatures.json`, not in any SDK, and not in anything a
//! reflector emits — a catalogue that carried one would be an arm asserting something about gg's
//! configuration surface, which is the one thing an arm cannot be held to. The
//! [projection](super::signatures::CatalogueFunction::capability) that carries the id to the docs
//! runtime reads it off the [`Binding`] here, and this table is the only place it is written down.
//!
//! # The transitional field
//!
//! [`Operation::call`] is gg's own `(object, key)` name for an operation. Every arm now writes its
//! operation id on the declaration itself, so no catalogue is *resolved* through this pair any more
//! — what still is, is gg's own sentences: the [`SurfaceCall`] constants are how a prompt or a
//! refusal names a call, and [`spell`](super::language::spell) turns one into the arm's spelling by
//! way of this field. It goes when those constants are replaced by operation ids.

use std::fmt;

use test_cabinet_core::gg::{CAPABILITY_PROGRAM_LIBRARY, GgProgramLanguage};

use crate::ending::EndingRole;
use crate::tools::ALL_TOOL_NAMES;

use super::language::{
    AGENTS_EXEC, AGENTS_FORK, AGENTS_SEND_MESSAGE, AGENTS_SPAWN_SUBAGENT, AGENTS_TRANSITION_STATE,
    AGENTS_WAIT_FOR_SUBAGENTS, CONTEXT_ARCHIVE_THREAD, CONTEXT_COMPACT, CONTEXT_EVICT_FILE_VIEW,
    CONTEXT_SEARCH_ARCHIVE, FS_EDIT_FILE, FS_LIST_DIR, FS_READ_FILE, FS_READ_TEXT_FILE,
    FS_WRITE_FILE, HARNESS_FINISH, MEMORY_CREATE_MEMORY, MEMORY_DELETE_MEMORY, MEMORY_EDIT_MEMORY,
    MEMORY_READ_MEMORY, MEMORY_SEARCH_MEMORIES, MEMORY_UPDATE_MEMORY, MEMORY_WRITE_MEMORY,
    PROGRAMS_GET, PROGRAMS_HISTORY, PROGRAMS_RERUN, PROJECT_CREATE_EPIC, PROJECT_CREATE_ISSUE,
    PROJECT_REMOVE_EPIC, PROJECT_REMOVE_ISSUE, PROJECT_SET_ISSUE_BLOCKED_BY, PROJECT_UPDATE_ISSUE,
    PROJECT_WAIT_FOR_ISSUE, REVIEW_APPROVE, REVIEW_REQUEST_CHANGES, SKILLS_READ_SKILL,
    SYSTEM_SHELL, SurfaceCall, TASKS_ADD_TASK, TASKS_COMPLETE_TASK, TASKS_REMOVE_TASK,
    TASKS_SET_BLOCKED_BY, TASKS_UPDATE_TASK, VIEW_CLOSE, VIEW_CURRENT, VIEW_OPEN_DOCS_VIEW,
    VIEW_OPEN_FILE, VIEW_OPEN_TEXT,
};
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
    /// The two are held in bijection by this module's tests, so the short name is a rename of one
    /// vocabulary rather than a second one.
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

/// What buys one operation — the whole of gg's gating vocabulary, and the only place any of it is
/// written down.
///
/// The four arms are not four spellings of one condition; they are four different *kinds* of thing
/// deciding, and an agent's scope is assembled from all four at once. Modelling them as one
/// `Option<String>` was what forced the [program library](crate::programs) to travel as a boolean
/// beside the gate it could not be expressed in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Binding {
    /// Bound when the run enables this gg tool — a member of [`ALL_TOOL_NAMES`], exactly.
    ///
    /// More than one operation may name the same tool, and three do: `files.read_file`,
    /// `files.read_text_file` and `views.open_file` are three operations over one read. They are
    /// separate operations because they are separately *documented* and separately called, and one
    /// tool because there is one thing they do to the workspace.
    Tool(&'static str),
    /// Bound for agents dispatched in this [ending role](EndingRole), and withheld from every
    /// other: "the work is complete" is not a verdict a reviewer is asked for.
    Ending(EndingRole),
    /// Bound when the agent holds this gg capability — the gate neither of the two above can
    /// express, because nothing dispatches it and no role decides it.
    Capability(&'static str),
    /// Bound to every program whatever a run enables. A run that offers no tools at all must still
    /// be able to show its model something, which is why the view surface is mostly this.
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
    /// Every registered language offers it. The default, and the state of all 47 today.
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
    reason = "a run reads two of these fields — `call` to resolve a catalogue entry to its row, and \
              `binding` to decide whether the agent has it. The other four are read by the \
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
    /// The `(object, key)` pair today's catalogues file this operation under.
    ///
    /// Transitional, and the only field here that is about *spelling*: it exists because an arm's
    /// committed catalogue still says which API object a function hangs off, and that pair is the
    /// only join gg has to it until each arm writes the operation id on the declaration itself. It
    /// is also what gg [spells](super::language::spell) the operation with when it names the call
    /// back at a model.
    pub call: SurfaceCall,
    /// What buys it. gg decides this; **no arm declares it**.
    pub binding: Binding,
    /// Whether a program passes it anything at all.
    ///
    /// One bit rather than a shape, because the shape is spelling — an optional argument is an
    /// overload pair in one language and a default in another — while *takes nothing* is a property
    /// of the operation that every arm must agree on. It is what catches the failure a reflector
    /// emitting empty parameters for everything would otherwise slip past: three operations take no
    /// input, and any arm claiming a fourth is wrong about its own signatures.
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
pub(crate) const FAMILY_VIEWS: &str = "gg-views";
pub(crate) const FAMILY_PROGRAMS: &str = "gg-programs";
pub(crate) const FAMILY_SESSION: &str = "gg-session";

/// [`Operation::takes_input`], spelled. A bare `true` at the end of a row says nothing about which
/// field it is, and this table is read far more often than it is written.
const TAKES_INPUT: bool = true;
/// [`Operation::takes_input`], spelled — the three operations a program calls with nothing.
const NO_INPUT: bool = false;

/// One operation, spelled compactly: its id, its family, the call today's catalogues file it under,
/// what binds it, and whether it takes input.
///
/// The second form carries [exemptions](Applicability::UniversalExcept). It has no uses today —
/// every arm offers every operation — and it is written down all the same, because the first arm
/// that legitimately cannot offer one must have somewhere to say so *here*, in the diff that
/// excuses it.
macro_rules! operation {
    ($namespace:literal, $key:literal, $family:expr, $call:expr, $binding:expr, $input:expr) => {
        Operation {
            id: OperationId::new($namespace, $key),
            family: $family,
            call: $call,
            binding: $binding,
            takes_input: $input,
            applies: Applicability::Universal,
        }
    };
    ($namespace:literal, $key:literal, $family:expr, $call:expr, $binding:expr, $input:expr, $except:expr) => {
        Operation {
            id: OperationId::new($namespace, $key),
            family: $family,
            call: $call,
            binding: $binding,
            takes_input: $input,
            applies: Applicability::UniversalExcept($except),
        }
    };
}

/// **Every model-facing operation gg has**, in catalogue order.
///
/// Enumerated rather than derived, for the reason its predecessor was: it is one half of an
/// agreement. An operation with no arm behind it puts a sentence in front of a model naming
/// something its scope does not hold; an arm binding something with no row here is a call gg has no
/// identity to record, gate or document under. Deriving either from the other would prove neither.
///
/// The **tool** half is nonetheless held to [`ALL_TOOL_NAMES`] by a `const` assertion below, so a
/// tool added to gg fails this file to compile until it has an operation. That is the one direction
/// where derivation is safe, because the tool vocabulary is already gg's own.
///
/// The [documentation carve-out](crate::docs)'s own calls are deliberately absent, exactly as they
/// were absent from the table this replaces: no arm's committed catalogue spells them, so there is
/// no binding for a row here to join to and nothing a spelling could be resolved from.
pub const OPERATIONS: &[Operation] = &[
    operation!(
        "shell",
        "shell",
        FAMILY_SHELL,
        SYSTEM_SHELL,
        Binding::Tool("shell"),
        TAKES_INPUT
    ),
    operation!(
        "files",
        "read_file",
        FAMILY_FILESYSTEM,
        FS_READ_FILE,
        Binding::Tool("read_file"),
        TAKES_INPUT
    ),
    operation!(
        "files",
        "read_text_file",
        FAMILY_FILESYSTEM,
        FS_READ_TEXT_FILE,
        Binding::Tool("read_file"),
        TAKES_INPUT
    ),
    operation!(
        "files",
        "write_file",
        FAMILY_FILESYSTEM,
        FS_WRITE_FILE,
        Binding::Tool("write_file"),
        TAKES_INPUT
    ),
    operation!(
        "files",
        "edit_file",
        FAMILY_FILESYSTEM,
        FS_EDIT_FILE,
        Binding::Tool("edit_file"),
        TAKES_INPUT
    ),
    operation!(
        "files",
        "list_dir",
        FAMILY_FILESYSTEM,
        FS_LIST_DIR,
        Binding::Tool("list_dir"),
        TAKES_INPUT
    ),
    operation!(
        "skills",
        "read_skill",
        FAMILY_SKILLS,
        SKILLS_READ_SKILL,
        Binding::Tool("read_skill"),
        TAKES_INPUT
    ),
    operation!(
        "memories",
        "write_memory",
        FAMILY_MEMORY,
        MEMORY_WRITE_MEMORY,
        Binding::Tool("write_memory"),
        TAKES_INPUT
    ),
    operation!(
        "memories",
        "update_memory",
        FAMILY_MEMORY,
        MEMORY_UPDATE_MEMORY,
        Binding::Tool("update_memory"),
        TAKES_INPUT
    ),
    operation!(
        "memories",
        "create_memory",
        FAMILY_MEMORY,
        MEMORY_CREATE_MEMORY,
        Binding::Tool("create_memory"),
        TAKES_INPUT
    ),
    operation!(
        "memories",
        "read_memory",
        FAMILY_MEMORY,
        MEMORY_READ_MEMORY,
        Binding::Tool("read_memory"),
        TAKES_INPUT
    ),
    operation!(
        "memories",
        "edit_memory",
        FAMILY_MEMORY,
        MEMORY_EDIT_MEMORY,
        Binding::Tool("edit_memory"),
        TAKES_INPUT
    ),
    operation!(
        "memories",
        "search_memories",
        FAMILY_MEMORY,
        MEMORY_SEARCH_MEMORIES,
        Binding::Tool("search_memories"),
        TAKES_INPUT
    ),
    operation!(
        "memories",
        "delete_memory",
        FAMILY_MEMORY,
        MEMORY_DELETE_MEMORY,
        Binding::Tool("delete_memory"),
        TAKES_INPUT
    ),
    operation!(
        "tasks",
        "add_task",
        FAMILY_TASKS,
        TASKS_ADD_TASK,
        Binding::Tool("add_task"),
        TAKES_INPUT
    ),
    operation!(
        "tasks",
        "update_task",
        FAMILY_TASKS,
        TASKS_UPDATE_TASK,
        Binding::Tool("update_task"),
        TAKES_INPUT
    ),
    operation!(
        "tasks",
        "set_blocked_by",
        FAMILY_TASKS,
        TASKS_SET_BLOCKED_BY,
        Binding::Tool("set_blocked_by"),
        TAKES_INPUT
    ),
    operation!(
        "tasks",
        "complete_task",
        FAMILY_TASKS,
        TASKS_COMPLETE_TASK,
        Binding::Tool("complete_task"),
        TAKES_INPUT
    ),
    operation!(
        "tasks",
        "remove_task",
        FAMILY_TASKS,
        TASKS_REMOVE_TASK,
        Binding::Tool("remove_task"),
        TAKES_INPUT
    ),
    operation!(
        "board",
        "create_epic",
        FAMILY_PROJECT,
        PROJECT_CREATE_EPIC,
        Binding::Tool("create_epic"),
        TAKES_INPUT
    ),
    operation!(
        "board",
        "create_issue",
        FAMILY_PROJECT,
        PROJECT_CREATE_ISSUE,
        Binding::Tool("create_issue"),
        TAKES_INPUT
    ),
    operation!(
        "board",
        "update_issue",
        FAMILY_PROJECT,
        PROJECT_UPDATE_ISSUE,
        Binding::Tool("update_issue"),
        TAKES_INPUT
    ),
    operation!(
        "board",
        "set_issue_blocked_by",
        FAMILY_PROJECT,
        PROJECT_SET_ISSUE_BLOCKED_BY,
        Binding::Tool("set_issue_blocked_by"),
        TAKES_INPUT
    ),
    operation!(
        "board",
        "remove_epic",
        FAMILY_PROJECT,
        PROJECT_REMOVE_EPIC,
        Binding::Tool("remove_epic"),
        TAKES_INPUT
    ),
    operation!(
        "board",
        "remove_issue",
        FAMILY_PROJECT,
        PROJECT_REMOVE_ISSUE,
        Binding::Tool("remove_issue"),
        TAKES_INPUT
    ),
    operation!(
        "board",
        "wait_for_issue",
        FAMILY_PROJECT,
        PROJECT_WAIT_FOR_ISSUE,
        Binding::Tool("wait_for_issue"),
        TAKES_INPUT
    ),
    operation!(
        "context",
        "evict_file_view",
        FAMILY_CONTEXT,
        CONTEXT_EVICT_FILE_VIEW,
        Binding::Tool("evict_file_view"),
        TAKES_INPUT
    ),
    operation!(
        "context",
        "archive_thread",
        FAMILY_CONTEXT,
        CONTEXT_ARCHIVE_THREAD,
        Binding::Tool("archive_thread"),
        TAKES_INPUT
    ),
    operation!(
        "context",
        "search_archive",
        FAMILY_CONTEXT,
        CONTEXT_SEARCH_ARCHIVE,
        Binding::Tool("search_archive"),
        TAKES_INPUT
    ),
    operation!(
        "context",
        "compact",
        FAMILY_CONTEXT,
        CONTEXT_COMPACT,
        Binding::Tool("compact"),
        TAKES_INPUT
    ),
    operation!(
        "delegation",
        "spawn_subagent",
        FAMILY_DELEGATION,
        AGENTS_SPAWN_SUBAGENT,
        Binding::Tool("spawn_subagent"),
        TAKES_INPUT
    ),
    operation!(
        "delegation",
        "wait_for_subagents",
        FAMILY_DELEGATION,
        AGENTS_WAIT_FOR_SUBAGENTS,
        Binding::Tool("wait_for_subagents"),
        TAKES_INPUT
    ),
    operation!(
        "delegation",
        "send_message",
        FAMILY_DELEGATION,
        AGENTS_SEND_MESSAGE,
        Binding::Tool("send_message"),
        TAKES_INPUT
    ),
    operation!(
        "delegation",
        "transition_state",
        FAMILY_DELEGATION,
        AGENTS_TRANSITION_STATE,
        Binding::Tool("transition_state"),
        TAKES_INPUT
    ),
    operation!(
        "delegation",
        "exec",
        FAMILY_DELEGATION,
        AGENTS_EXEC,
        Binding::Tool("exec"),
        TAKES_INPUT
    ),
    operation!(
        "delegation",
        "fork",
        FAMILY_DELEGATION,
        AGENTS_FORK,
        Binding::Tool("fork"),
        TAKES_INPUT
    ),
    operation!(
        "views",
        "open_file",
        FAMILY_VIEWS,
        VIEW_OPEN_FILE,
        Binding::Tool("read_file"),
        TAKES_INPUT
    ),
    operation!(
        "views",
        "open_text",
        FAMILY_VIEWS,
        VIEW_OPEN_TEXT,
        Binding::Always,
        TAKES_INPUT
    ),
    operation!(
        "views",
        "open_docs_view",
        FAMILY_VIEWS,
        VIEW_OPEN_DOCS_VIEW,
        Binding::Always,
        TAKES_INPUT
    ),
    operation!(
        "views",
        "close",
        FAMILY_VIEWS,
        VIEW_CLOSE,
        Binding::Always,
        TAKES_INPUT
    ),
    operation!(
        "views",
        "current",
        FAMILY_VIEWS,
        VIEW_CURRENT,
        Binding::Always,
        NO_INPUT
    ),
    operation!(
        "programs",
        "history",
        FAMILY_PROGRAMS,
        PROGRAMS_HISTORY,
        Binding::Capability(CAPABILITY_PROGRAM_LIBRARY),
        NO_INPUT
    ),
    operation!(
        "programs",
        "get",
        FAMILY_PROGRAMS,
        PROGRAMS_GET,
        Binding::Capability(CAPABILITY_PROGRAM_LIBRARY),
        TAKES_INPUT
    ),
    operation!(
        "programs",
        "rerun",
        FAMILY_PROGRAMS,
        PROGRAMS_RERUN,
        Binding::Capability(CAPABILITY_PROGRAM_LIBRARY),
        TAKES_INPUT
    ),
    operation!(
        "session",
        "finish",
        FAMILY_SESSION,
        HARNESS_FINISH,
        Binding::Ending(EndingRole::Standard),
        TAKES_INPUT
    ),
    operation!(
        "session",
        "approve",
        FAMILY_SESSION,
        REVIEW_APPROVE,
        Binding::Ending(EndingRole::Review),
        NO_INPUT
    ),
    operation!(
        "session",
        "request_changes",
        FAMILY_SESSION,
        REVIEW_REQUEST_CHANGES,
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
    match function.operation {
        // A catalogue in the [normalized schema](super::signatures::SchemaVersion::V2) names its
        // operation on the declaration itself, which is the end state this join was always heading
        // for: the id is the entry's identity rather than something recovered from where it was
        // filed. An id no row carries is not silently re-resolved through the pair below — an arm
        // that named an operation gg does not have has said something wrong, and answering it with
        // whatever `(object, key)` happens to match would hide that.
        Some(id) => operation_by_id(id),
        // The transitional half, for the catalogues still filing entries under an API object. It
        // goes with the last of them.
        None => OPERATIONS.iter().find(|operation| {
            operation.call.object == function.object && operation.call.key == function.key
        }),
    }
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

/// `&str` equality, in a `const` context, where `==` is not available.
const fn same(left: &str, right: &str) -> bool {
    let (left, right) = (left.as_bytes(), right.as_bytes());
    if left.len() != right.len() {
        return false;
    }
    let mut i = 0;
    while i < left.len() {
        if left[i] != right[i] {
            return false;
        }
        i += 1;
    }
    true
}

/// Whether some operation is bound by the gg tool `tool`.
const fn some_operation_binds(tool: &str) -> bool {
    let mut i = 0;
    while i < OPERATIONS.len() {
        match OPERATIONS[i].binding {
            Binding::Tool(bound) => {
                if same(bound, tool) {
                    return true;
                }
            }
            Binding::Ending(_) | Binding::Capability(_) | Binding::Always => {}
        }
        i += 1;
    }
    false
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

/// Whether `tool` is one of the tools gg can offer.
const fn is_a_gg_tool(tool: &str) -> bool {
    let mut i = 0;
    while i < ALL_TOOL_NAMES.len() {
        if same(ALL_TOOL_NAMES[i], tool) {
            return true;
        }
        i += 1;
    }
    false
}

/// **The bijection between the tool half of this table and gg's tool vocabulary**, asserted at
/// compile time rather than under test — because the failure it catches is a tool being *added* to
/// gg, and a table that has to be remembered is a table that will not be. A `cargo build` fails
/// here, before anything has a chance to run and quietly not document it.
///
/// It is a bijection of **sets**, not of rows, and deliberately: three operations share the
/// `read_file` tool (see [`Binding::Tool`]), so a row-for-row equality would be a claim that no tool
/// may back more than one operation, which is false and is not the property worth holding.
const _: () = {
    let mut i = 0;
    while i < ALL_TOOL_NAMES.len() {
        assert!(
            some_operation_binds(ALL_TOOL_NAMES[i]),
            "every gg tool must have a model-facing operation bound to it — a tool added to \
             `ALL_TOOL_NAMES` needs a row in `OPERATIONS`"
        );
        i += 1;
    }
    let mut j = 0;
    while j < OPERATIONS.len() {
        match OPERATIONS[j].binding {
            Binding::Tool(tool) => assert!(
                is_a_gg_tool(tool),
                "an operation is bound to a name that is not a gg tool — check it against \
                 `ALL_TOOL_NAMES`"
            ),
            Binding::Ending(_) | Binding::Capability(_) | Binding::Always => {}
        }
        j += 1;
    }
};

/// **Every [exemption](Applicability::UniversalExcept) carries a written reason**, asserted at
/// compile time for the same reason the tool bijection is: the failure is an omission, and an
/// omission is exactly what a reviewer skims past.
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
/// on a table of 47 the next step is to read the exemptions rather than to follow the error. The
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
