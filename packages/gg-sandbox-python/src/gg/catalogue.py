"""The map from gg's own vocabulary to this SDK's functions — pure data, importing nothing.

Three consumers read it, which is why it is data rather than a `match` somewhere:

1. `gg.scope`, to build a program's scope. Only the entries whose gg tool name is enabled for
   the run become attributes of an API object, so the object a model reads is the honest directory
   of what this run offers. It is **not** the capability model — the host refuses a withheld call
   whatever the guest binds — but a name a model can see is a name it will use, so the surface it
   sees is the surface it has.
2. `gg.scope.bound_tools`, which the component's `bound-tools` export answers with, and
   which gg compares against its own `ALL_TOOL_NAMES` on the *committed artifact*. That is the one
   drift check that catches a stale `.wasm` rather than a stale source file.
3. `tools/signatures.py`, which reflects each entry's declaration and docstring out of this
   package into `crates/gg/src/sandbox/guests/python.signatures.json` — the catalogue gg renders
   the system prompt and every documentation view from, for *this* language.

It holds one entry per name in `ALL_TOOL_NAMES` (`crates/gg/src/tools/mod.rs`) — there is no
class of gg tool a program is denied — and gg asserts exactly that.

The order is `ALL_TOOL_NAMES`' order, so the prompt lists tools in the same sequence gg documents
them everywhere else.

The model-facing functions that **end a session** (`SESSION_ENTRIES`), the ones that put
material into the agent's own **context window** (`VIEW_ENTRIES`), the ones that reach back
into the **program library** (`PROGRAM_ENTRIES`) and the one bound onto every object
(`META_ENTRIES`) are deliberately in none of the tool arrays. None of them is a gg tool, and
cataloguing them as ones would break the bijection consumer 2 exists to check. What they carry
instead is a `key`.

`key`: identity, as against spelling
--------------------------------------

A gg tool carries its own identity — `tool` is its name in `ALL_TOOL_NAMES`, and every
language's guest catalogues the same set of them. The model-facing functions that are **not** gg
tools have no such name, so each of them carries a `key`: a stable, language-independent identity
that a sibling guest for another language uses for the same function, however that language spells
it. `request_changes` and `requestChanges` are one function under two spellings, and `key` is
what says so — which is what lets gg assert that two registered languages offer the *same* surface
and differ only in how a program writes it.

The keys are `snake_case` because they are gg's own vocabulary, the casing its tool names, its
capability ids and its telemetry values already use — deliberately not any one SDK's spelling. That
this arm's spellings *coincide* with them is a fact about Python rather than a shortcut: Python's
own convention is `snake_case`, so the idiomatic name and the identity happen to agree, exactly as
they disagree in the TypeScript arm.
"""

from __future__ import annotations

from dataclasses import dataclass

# --- The API objects --------------------------------------------------------------------------
#
# The API objects a program's surface is divided into, each declared with the one sentence a model
# is told about it.
#
# The name is the identifier a program calls through; the docstring under it is the object's
# MODEL-FACING description, reflected into the catalogue's `objects` section by
# `tools/signatures.py` and rendered into the system prompt's API list. It is written HERE, on the
# declaration, for the same reason every function's description is written on the function: a
# description kept in a table somewhere else is a description that drifts from the thing it
# describes, and nothing would catch it.
#
# The sentences are lower-case fragments because of where they land:
# `- \`fs\` — read, write, and edit workspace files`.

OBJECT_FS = "fs"
"""read, write, and edit workspace files"""

OBJECT_SYSTEM = "system"
"""run shell commands in the workspace"""

OBJECT_PROJECT = "project"
"""the epic/issue board — decompose work into dispatchable issues"""

OBJECT_TASKS = "tasks"
"""your task list"""

OBJECT_MEMORY = "memory"
"""durable memories that survive context compaction"""

OBJECT_VIEW = "view"
"""show yourself a file, a value, or a function's documentation — the only way material enters your
context"""

OBJECT_CONTEXT = "context"
"""manage your own context window"""

OBJECT_AGENTS = "agents"
"""delegate work to child agents"""

OBJECT_SKILLS = "skills"
"""read authored skills"""

OBJECT_PROGRAMS = "programs"
"""fetch a program you already ran, and hand a patched copy back to be run"""

OBJECT_HARNESS = "harness"
"""end your session"""

OBJECT_REVIEW = "review"
"""return your verdict on the work you are reviewing"""


@dataclass(frozen=True)
class ToolEntry:
    """One gg tool: gg's name for it, this SDK's function name, and the module that defines it."""

    tool: str
    """The gg tool name, as it appears in `ALL_TOOL_NAMES` and in a run's enabled-tool set."""

    python: str
    """The function name a program calls."""

    module: str
    """The `gg.tools` module that defines it, without the package prefix."""


@dataclass(frozen=True)
class HelperEntry:
    """A helper bound alongside a tool.

    Not a tool itself, so it can never perturb the `ALL_TOOL_NAMES` bijection, but bound onto the
    same object and catalogued for the prompt whenever the tool it is built on is enabled.
    """

    key: str
    """This helper's language-independent identity, as every guest catalogues it."""

    python: str
    """The function name a program calls."""

    requires: str
    """The gg tool it is built on; the helper is bound only when that tool is enabled."""


@dataclass(frozen=True)
class SessionEntry:
    """One model-facing ending: what it is called, where it is grouped, and which role has it."""

    key: str
    """This ending's language-independent identity, as every guest catalogues it."""

    python: str
    """The function name a program calls."""

    object: str
    """The API object it is grouped under in a program's scope."""

    ending: str
    """The role whose programs it is bound for. Exactly one group is bound per program."""


@dataclass(frozen=True)
class ViewEntry:
    """One model-facing view function: what it is called, and the gg tool (if any) that gates it."""

    key: str
    """This view function's language-independent identity, as every guest catalogues it."""

    python: str
    """The function name a program calls."""

    requires: str | None = None
    """The gg tool whose being enabled binds it, or `None` when nothing gates it.

    Deliberately the same shape `HelperEntry.requires` has, and read the same way by
    `gg.scope`: a gated view function is bound exactly when its tool is, an ungated one always.
    """


@dataclass(frozen=True)
class MetaEntry:
    """One model-facing **meta** function: a call bound onto every API object rather than one."""

    key: str
    """This function's language-independent identity, as every guest catalogues it."""

    python: str
    """The function name a program calls."""


TOOL_CATALOGUE: tuple[ToolEntry, ...] = (
    ToolEntry("shell", "shell", "shell"),
    ToolEntry("read_file", "read_file", "files"),
    ToolEntry("write_file", "write_file", "files"),
    ToolEntry("edit_file", "edit_file", "files"),
    ToolEntry("list_dir", "list_dir", "files"),
    ToolEntry("read_skill", "read_skill", "skills"),
    ToolEntry("write_memory", "write_memory", "memories"),
    ToolEntry("update_memory", "update_memory", "memories"),
    ToolEntry("create_memory", "create_memory", "memories"),
    ToolEntry("read_memory", "read_memory", "memories"),
    ToolEntry("edit_memory", "edit_memory", "memories"),
    ToolEntry("search_memories", "search_memories", "memories"),
    ToolEntry("delete_memory", "delete_memory", "memories"),
    ToolEntry("add_task", "add_task", "tasks"),
    ToolEntry("update_task", "update_task", "tasks"),
    ToolEntry("set_blocked_by", "set_blocked_by", "tasks"),
    ToolEntry("complete_task", "complete_task", "tasks"),
    ToolEntry("remove_task", "remove_task", "tasks"),
    ToolEntry("create_epic", "create_epic", "board"),
    ToolEntry("create_issue", "create_issue", "board"),
    ToolEntry("update_issue", "update_issue", "board"),
    ToolEntry("set_issue_blocked_by", "set_issue_blocked_by", "board"),
    ToolEntry("remove_epic", "remove_epic", "board"),
    ToolEntry("remove_issue", "remove_issue", "board"),
    ToolEntry("wait_for_issue", "wait_for_issue", "board"),
    ToolEntry("evict_file_view", "evict_file_view", "context"),
    ToolEntry("archive_thread", "archive_thread", "context"),
    ToolEntry("search_archive", "search_archive", "context"),
    ToolEntry("compact", "compact", "context"),
    ToolEntry("spawn_subagent", "spawn_subagent", "delegation"),
    ToolEntry("wait_for_subagents", "wait_for_subagents", "delegation"),
    ToolEntry("send_message", "send_message", "delegation"),
    ToolEntry("transition_state", "transition_state", "delegation"),
    ToolEntry("exec", "exec", "delegation"),
    ToolEntry("fork", "fork", "delegation"),
)
"""Every gg tool a program can call, in `ALL_TOOL_NAMES` order."""

HELPER_CATALOGUE: tuple[HelperEntry, ...] = (
    HelperEntry("read_text_file", "read_text_file", "read_file"),
)
"""Every helper bound alongside a tool.

Deliberately one entry. Reading a file's text is the single most common thing a program does, and
forcing a variant narrowing on it is friction on the hot path; everything else a "standard library"
might add is another name in the prompt and another thing for a model to get wrong.
"""

SESSION_ENTRIES: tuple[SessionEntry, ...] = (
    SessionEntry("finish", "finish", OBJECT_HARNESS, "standard"),
    SessionEntry("approve", "approve", OBJECT_REVIEW, "review"),
    SessionEntry("request_changes", "request_changes", OBJECT_REVIEW, "review"),
)
"""Every model-facing function that ends a session — none of them a gg tool.

An ending is a **result**, and a role's result has a shape: work reports what was done, a review
returns a verdict. So there is one function per shape, each carrying exactly what that result is
made of, and `gg.scope` binds only the group matching the `ending` the host passed to `run`.
"""

VIEW_ENTRIES: tuple[ViewEntry, ...] = (
    ViewEntry("open_file", "open_file", "read_file"),
    ViewEntry("open_text", "open_text"),
    ViewEntry("open_docs_view", "open_docs_view"),
    ViewEntry("close", "close"),
    ViewEntry("current", "current"),
)
"""Every model-facing view function — the calls that put material into the agent's own context
window. None of them is a gg tool.

`open_text`, `open_docs_view`, `close` and `current` are **ungated**, the carve-out
`harness` has and for the same reason: a run that enables no tools at all must still be able to
show its model something — and must always be able to read what the functions it does have do.
`open_file` is a read, so it carries `requires="read_file"`: a run with reading withheld must not
get a read through a side door.
"""

PROGRAM_ENTRIES: tuple[MetaEntry, ...] = (
    MetaEntry("history", "history"),
    MetaEntry("get", "get"),
    MetaEntry("rerun", "rerun"),
)
"""Every model-facing function on the **program library** — the object a program reaches back
through for the source of a program it already ran. None of them is a gg tool.

They carry no gate at all, unlike `VIEW_ENTRIES`, because the whole object is bound or absent
together, from the `library` flag the host passes to `run`: a *capability* decides this family,
and no tool name stands for it. They reuse `MetaEntry` because a key and a spelling is
exactly what they carry — the object is the same for all three.
"""

META_ENTRIES: tuple[MetaEntry, ...] = (MetaEntry("list", "list"),)
"""Every model-facing function that belongs to **no API object** — because it belongs to all of them.

`list` is the whole of it: `gg.scope.build_scope` seeds it onto every object it creates,
bound from `gg.tools.docs.bind_list` with that object's name closed over, so its bound arity is
zero and there is no one object it hangs off. That is why it is a section of its own rather than an
entry in `VIEW_ENTRIES` or `TOOL_CATALOGUE`: an entry there carries an object, and any
object this one named would be a lie about the other eleven.
"""

OBJECT_FOR_MODULE: dict[str, str] = {
    "shell": OBJECT_SYSTEM,
    "files": OBJECT_FS,
    "skills": OBJECT_SKILLS,
    "memories": OBJECT_MEMORY,
    "tasks": OBJECT_TASKS,
    "board": OBJECT_PROJECT,
    "context": OBJECT_CONTEXT,
    "delegation": OBJECT_AGENTS,
    "views": OBJECT_VIEW,
    "programs": OBJECT_PROGRAMS,
    "session": OBJECT_HARNESS,
}
"""The **API object** each module's functions are grouped under in a program's scope.

A program does not receive flat identifiers (`read_file`, `create_issue`, …). It receives a small
set of namespaced objects — `fs.read_file`, `project.create_issue` — one per module that offers
at least one enabled function, so the surface a model has to reason about is a handful of objects
rather than thirty loose names.

The names are model-facing product surface, chosen for what a model already expects the object to
mean: `fs` for the workspace filesystem, `system` for running commands, `project` for the
epic/issue board, `agents` for delegation, `harness` for the calls that are about the session
itself rather than the workspace.

The role-shaped ending object — `review` — is named on `SESSION_ENTRIES` instead, because
those are grouped by *role* rather than by module: both groups are defined by the one `session`
module.

`views` maps to the singular `view` for the same reason `files` maps to `fs`: the object name
is read at a call site, and `view.open_text(...)` states an intent about one thing where
`views.open_text(...)` would read like a collection being mutated. `programs` keeps its plural for
the mirror reason: it *is* a collection, and `programs.get(12)` reads as reaching into one.
"""

OBJECT_ORDER: tuple[str, ...] = (
    OBJECT_FS,
    OBJECT_SYSTEM,
    OBJECT_PROJECT,
    OBJECT_TASKS,
    OBJECT_MEMORY,
    OBJECT_VIEW,
    OBJECT_CONTEXT,
    OBJECT_AGENTS,
    OBJECT_SKILLS,
    OBJECT_PROGRAMS,
    OBJECT_HARNESS,
    OBJECT_REVIEW,
)
"""Every API object, in the order a program's surface is listed in.

The order is model-facing: it is the sequence the system prompt's API list renders in, and the
sequence the run's agent surface reports. It runs from the objects almost every run has (`fs`,
`system`) to the ones a particular shape of agent has (`programs`, `harness`, `review`),
because a model reads a list from the top.
"""

SESSION_MODULE = "session"
"""The module every `SESSION_ENTRIES` function is defined in — a sibling of `gg.tools`,
because ending a session is not a tool family."""

VIEW_MODULE = "views"
"""The `gg.tools` module every `VIEW_ENTRIES` function is defined in."""

PROGRAM_MODULE = "programs"
"""The `gg.tools` module every `PROGRAM_ENTRIES` function is defined in."""

META_MODULE = "docs"
"""The `gg.tools` module every `META_ENTRIES` declaration lives in."""

HELPER_MODULE = "helpers"
"""The module every `HELPER_CATALOGUE` function is defined in — a sibling of `gg.tools`,
because a helper is not a tool."""

LIB_OBJECT = "lib"
"""The scope object a program reaches its loaded **code modules** through: the code of a skill or a
memory it has read, bound at `lib.<name>`.

It is not an API object and carries no `list()`: nothing there is a gg function, the members are
whatever the module's body left behind, and the host already told the model which key each one got
and what it exports when it answered the read. It is bound only when at least one module was handed
over, so a run with none has no `lib` name at all.
"""

TYPE_ORDER: tuple[str, ...] = (
    "ToolError",
    "ToolErrorCode",
    "ShellOutput",
    "TextFile",
    "ImageFile",
    "FileRead",
    "EntryKind",
    "DirEntry",
    "MemoryUsage",
    "MemoryHit",
    "TaskStatus",
    "TaskUsage",
    "IssueStatus",
    "BoardUsage",
    "EpicCreated",
    "IssueCreated",
    "Unchanged",
    "ReclaimReport",
    "TurnRange",
    "MessageRole",
    "ArchiveHit",
    "ArchiveSearch",
    "ViewKind",
    "ViewRegion",
    "OpenView",
    "SubagentHandle",
    "AgentEnding",
    "SubagentResult",
    "ProgramSummary",
    "FunctionSummary",
)
"""Every type this SDK declares, in the order the catalogue lists them.

The order is model-facing in the same way `OBJECT_ORDER` is: a documentation view appends the
declarations a signature referred to, and it appends them in this sequence. It runs from the failure
type every call can raise, through the workspace, to the session's own shapes.

Listed rather than derived because it is an *ordering*, and a reflector that sorted alphabetically
would put `AgentEnding` before `ToolError`. `tools/signatures.py` asserts that every public
declaration in `gg.types` and `gg.errors` appears here exactly once, so a type added and
not listed is a build error rather than a type nothing ever shows a model.
"""
