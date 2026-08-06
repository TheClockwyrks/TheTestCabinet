"""The **model-facing** shapes the tool functions accept and return.

These are deliberately not the membrane's generated records. Four differences matter, and each one
exists so a program reads like Python rather than like a WIT file:

* **A union of records, not a tagged variant.** `fs.read_file` returns a `TextFile` or an
  `ImageFile`, which a program narrows with `isinstance` or with a `match` statement, rather than the
  component model's `FileRead_Text(value=TextRead(...))` wrapper — two attribute hops to reach a
  field, and a name no Python programmer would write.
* **gg's vocabulary, not WIT's.** Nothing here is spelled with a hyphen, because a WIT identifier
  cannot contain an underscore while gg's stores, schemas and tool-calling mode all use one. The SDK
  translates at the boundary, so a model sees one vocabulary in both execution modes.
* **Enums a program can complete.** A fixed choice is an `enum.Enum` member with a real name, so
  `entry.kind is EntryKind.FILE` is a comparison the language checks rather than a string a model has
  to spell from memory. A misspelled string is not an error — it is a branch that never runs.
* **Prose written for the model.** Every docstring here is reflected into the signature catalogue and
  is what a documentation view shows. The membrane's own comments are written for whoever implements
  the host; these are written for whoever writes the program.

Every declaration in this module is listed in `gg.catalogue.TYPE_ORDER`, and `tools/signatures.py`
fails the build if one is not — a type a signature mentions and the catalogue does not carry is a
dangling reference in front of a model.

Docstrings here are **markdown**, not reStructuredText, because they are rendered into a markdown
system prompt rather than into HTML: a single backtick is code, and there is no role syntax to leak.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

__all__ = [
    "AgentEnding",
    "ArchiveHit",
    "ArchiveSearch",
    "BoardUsage",
    "DirEntry",
    "EntryKind",
    "EpicCreated",
    "FileRead",
    "FunctionSummary",
    "ImageFile",
    "IssueCreated",
    "IssueStatus",
    "MemoryHit",
    "MemoryUsage",
    "MessageRole",
    "OpenView",
    "ProgramSummary",
    "ReclaimReport",
    "ShellOutput",
    "SubagentHandle",
    "SubagentResult",
    "TaskStatus",
    "TaskUsage",
    "TextFile",
    "ToolErrorCode",
    "TurnRange",
    "UNCHANGED",
    "Unchanged",
    "ViewKind",
    "ViewRegion",
]


class ToolErrorCode(Enum):
    """Why a call failed — the `code` on a raised `ToolError`, and the value a handler branches on
    instead of matching on prose."""

    INVALID_ARGUMENT = "invalid-argument"
    """The arguments were malformed, ill-typed, or out of range — including a path that is absolute
    or climbs out of the workspace, and an agent name this run does not declare."""

    NOT_FOUND = "not-found"
    """The named file, skill, memory, task, epic, issue, subagent, stored program, or documentation
    entry does not exist."""

    CONFLICT = "conflict"
    """Well-formed, but in conflict with the current state: an ambiguous edit, a dependency cycle, a
    duplicate id, a subagent that already returned."""

    REFUSED = "refused"
    """gg refused the call on a rule about your state: a compaction in flight that this call is not
    the one it asked for, a memory call while your memories are read-only, a second ending or
    hand-over in a turn that already declared one, or a hook that blocked it. A ceiling you ran into
    is `LIMIT_EXCEEDED`, not this."""

    UNAVAILABLE = "unavailable"
    """The call exists but this run's capability set does not offer it. Your program can see every
    function this SDK has; the ones the run withheld are refused here, by gg, rather than hidden."""

    LIMIT_EXCEEDED = "limit-exceeded"
    """A gg-side ceiling was hit: a shell timeout, a store cap, the delegation depth cap, one of the
    view caps this program spends, or the run's wall-clock budget."""

    IO_ERROR = "io-error"
    """The underlying I/O or process failed."""

    OTHER = "other"
    """The failure was not classified. Reserved for outcomes raised outside a tool implementation
    (gg's own bridge and degradation paths); nothing you call produces it."""


@dataclass(frozen=True)
class ShellOutput:
    """What a command `system.shell` ran reported when it finished."""

    exit_code: int | None
    """The process's exit status; `None` when a signal killed it. Zero means success."""

    output: str
    """Merged stdout-then-stderr, tail-truncated at 16 KiB — or, when the run offloads shell output,
    at the configured line/character ceiling, with a note naming the files holding the whole of it.
    Under the default `adaptive` mode a command that succeeded returns just that note."""

    truncated: bool
    """Whether the cap cut `output`, dropping the head and keeping the tail."""


@dataclass(frozen=True)
class TextFile:
    """A text file's contents, or the window of lines a capped read policy returned."""

    contents: str
    """The file's text, or just the requested window under a capped read policy."""

    first_line: int
    """The 1-based first line returned."""

    last_line: int
    """The 1-based last line returned."""

    total_lines: int
    """The file's total line count, so you know whether to page again."""

    byte_truncated: bool
    """A 256 KiB byte ceiling cut the returned text."""


@dataclass(frozen=True)
class ImageFile:
    """A picture gg found where you read a file: what it is, rather than its bytes.

    The pixels never enter your program. `view.open_file` is what attaches the picture to your turn so
    you can look at it, which is worth far more than base64 in a variable.
    """

    media_type: str
    """The IANA media type (`image/png`, `image/jpeg`, `image/gif`, `image/webp`)."""

    label: str
    """The short format label (`PNG`, `JPEG`, `GIF`, `WebP`)."""

    bytes: int
    """The file's size in bytes."""

    shown: bool
    """Whether the picture is being attached to this turn for you to look at."""

    not_shown_reason: str | None
    """Why it is not being shown; `None` when `shown` is true."""


FileRead = TextFile | ImageFile
"""What a read returned: a text file's window, or a picture's description.

A picture is a different kind of thing from text, so it is a different class rather than a string
that happens to be binary — `isinstance(read, TextFile)`, or a `match` on the two, is what narrows
it, and a program that treats an image as text is caught by that check instead of silently writing an
empty string somewhere.
"""


class EntryKind(Enum):
    """What a directory entry is."""

    FILE = "file"
    """An ordinary file."""

    DIRECTORY = "directory"
    """A directory, which you can list in its own right."""

    OTHER = "other"
    """Everything that is neither, a symlink among them."""


@dataclass(frozen=True)
class DirEntry:
    """One entry `fs.list_dir` found: a bare name, and its kind."""

    name: str
    """The entry's bare name, with no directory part. Join it with the directory you listed."""

    kind: EntryKind
    """What the entry is."""


@dataclass(frozen=True)
class MemoryUsage:
    """How much of the run's durable-memory budget is used, after the call that returned it.

    Every maximum is optional: each limit can be turned off, and a run's memory strategy applies only
    some of them, so `None` means nothing bounds that axis — check before subtracting.
    """

    count: int
    """Memories currently held."""

    max_count: int | None
    """The most memories this run allows, if it limits the count."""

    total_chars: int
    """Characters of body currently held, across all memories."""

    max_total_chars: int | None
    """The most characters of body this run allows in total, if it limits the aggregate."""

    index_chars: int | None
    """Characters the memory index occupies, under a run that keeps one."""

    max_index_chars: int | None
    """The most characters the index may occupy, if it is limited."""


@dataclass(frozen=True)
class MemoryHit:
    """One memory `memory.search_memories` matched, and the numbers it was ranked by."""

    name: str
    """The memory's slug — what `memory.read_memory` takes."""

    description: str
    """Its description, or the empty string when it was created without one."""

    matched: int
    """How many of your distinct keywords it matched — the primary ranking."""

    occurrences: int
    """How many times those keywords occur in it — the tiebreak."""

    excerpt: str
    """A short window of the memory around its first match."""


class TaskStatus(Enum):
    """Where a task stands."""

    PENDING = "pending"
    """Not started. Every task begins here."""

    IN_PROGRESS = "in_progress"
    """Being worked on now."""

    DONE = "done"
    """Finished. Tasks blocked on it become actionable once all their blockers are done."""


@dataclass(frozen=True)
class TaskUsage:
    """How much of the run's task budget is used, after the call that returned it."""

    count: int
    """Tasks currently on the list."""

    max_tasks: int
    """The most tasks this run allows."""


class IssueStatus(Enum):
    """Where an issue stands."""

    OPEN = "open"
    """Not started, and dispatchable once its blockers are done."""

    IN_PROGRESS = "in_progress"
    """Dispatched, with its assigned agent working on it."""

    DONE = "done"
    """Finished and, where this run requires reviewers, approved."""


@dataclass(frozen=True)
class BoardUsage:
    """How much of the run's board budget is used, after the call that returned it."""

    epics: int
    """Epics currently on the board."""

    max_epics: int
    """The most epics this run allows."""

    issues: int
    """Issues currently on the board."""

    max_issues: int
    """The most issues this run allows."""


@dataclass(frozen=True)
class EpicCreated:
    """An epic that was just created: the id its prefix resolved to, and the board budget."""

    id: str
    """The epic's id — the prefix you gave, upper-cased (`auth` becomes `AUTH`). Group issues under it
    with this, and its issues are numbered from it (`AUTH-1`)."""

    board: BoardUsage
    """How much of the board budget is used."""


@dataclass(frozen=True)
class IssueCreated:
    """An issue that was just created: the id the board assigned it, and the board budget."""

    id: str
    """The id the board assigned (`AUTH-1`) — you do not choose it. Use it to block later issues on
    this one, or to wait for it."""

    board: BoardUsage
    """How much of the board budget is used."""


class Unchanged(Enum):
    """The "leave this field exactly as it is" value, and the default of every patch argument that
    can also be *cleared*.

    A field a patch may clear has three states rather than two, and Python already spells "absent" as
    `None` — which here is the request to clear it. So the third state gets a name of its own: leave
    the argument out (or pass `UNCHANGED`) to keep what is there, pass `None` to empty it, pass a
    value to replace it. A field with no clear state is an ordinary `X | None = None`, where `None`
    simply means you are not changing it.
    """

    UNCHANGED = "unchanged"
    """The only member; `UNCHANGED` is the name you write."""


UNCHANGED = Unchanged.UNCHANGED
"""The default of every patch argument that can also be cleared: leave the argument out to keep what
is there, and pass `None` to empty it."""


@dataclass(frozen=True)
class ReclaimReport:
    """What a context reclaim actually freed from the live context window."""

    items: int
    """Context items dropped from the live window."""

    reclaimed_tokens: int
    """Approximately how many tokens that freed."""

    paths: list[str]
    """The workspace paths whose views were evicted. Empty for an archive."""

    detail: str
    """The prose summary of what was reclaimed."""


@dataclass(frozen=True)
class TurnRange:
    """An inclusive span of turn numbers, the unit `context.archive_thread` moves out of your window.

    The numbers are the ones on the header of every result you are given, so `TurnRange(4, 19)` means
    exactly the turns you can see numbered 4 through 19 — both ends included.
    """

    start: int
    """The first turn in the span."""

    end: int
    """The last turn in the span, inclusive."""


class MessageRole(Enum):
    """Who said an archived message."""

    SYSTEM = "system"
    """Your system prompt."""

    USER = "user"
    """A message addressed to you — a turn's results, or an operator's instruction."""

    ASSISTANT = "assistant"
    """You."""

    TOOL = "tool"
    """A tool result, from a session that ran in tool-calling mode."""


@dataclass(frozen=True)
class ArchiveHit:
    """One archived message that matched a search."""

    seq: int
    """The archived message's sequence number."""

    role: MessageRole
    """Who said it."""

    text: str
    """The message text."""


@dataclass(frozen=True)
class ArchiveSearch:
    """What `context.search_archive` found."""

    archive_empty: bool
    """Nothing has been archived yet, so there was nothing to search. Deliberately distinct from a
    search that ran and matched nothing, so you do not archive again believing the first archive
    failed."""

    hits: list[ArchiveHit]
    """The matches, most recent first, at most 8."""


class ViewKind(Enum):
    """Which of the three kinds a view is.

    The taxonomy is closed at three on purpose: everything on disk is a file, everything a program can
    compute is a string, and documentation is neither — gg holds it.
    """

    FILE = "file"
    """A file you opened; its selector is the path."""

    TEXT = "text"
    """A value you showed yourself; its selector is the label you gave it. A directory listing, a
    command's output, a child agent's answer and a table you assembled are all this kind."""

    DOCS = "docs"
    """A function's documentation; its selector is the function's name."""


@dataclass(frozen=True)
class ViewRegion:
    """The window of lines a **paged** file view covers; absent for a whole-file view."""

    offset: int
    """The 1-based first line the view shows."""

    limit: int
    """How many lines it shows."""


@dataclass(frozen=True)
class OpenView:
    """One view open in your context window, as `view.current()` reports it."""

    kind: ViewKind
    """Whether it is a file, text, or documentation view."""

    selector: str
    """What `view.close` takes: a file's path, a text view's label, or a docs view's function name."""

    tokens: int
    """Roughly what holding it costs you, in tokens."""

    region: ViewRegion | None
    """The line window a paged file view covers; `None` for a whole-file view and for text views."""


@dataclass(frozen=True)
class SubagentHandle:
    """A child agent that was spawned and is now running in parallel."""

    id: str
    """The child's id — pass it to `agents.wait_for_subagents` or `agents.send_message`."""

    slot: str
    """The agent profile it runs as."""

    model_id: str
    """The model actually bound to that agent."""


class AgentEnding(Enum):
    """How a child agent's loop ended — gg's own six words, as the native path also reports them."""

    COMPLETED = "completed"
    """It finished normally: it called `harness.finish`, and its summary is what it returned."""

    EXHAUSTED = "exhausted"
    """It hit the per-run turn ceiling."""

    TIMED_OUT = "timed_out"
    """It passed its wall-clock deadline."""

    MODEL_ERROR = "model_error"
    """A model turn failed."""

    AUTH_ERROR = "auth_error"
    """The run's credential was refused."""

    LIMIT_EXCEEDED = "limit_exceeded"
    """An execution ceiling stopped it — consecutive errors, error rate, or cost."""


@dataclass(frozen=True)
class SubagentResult:
    """One child agent's collected result."""

    id: str
    """The child's id."""

    status: AgentEnding | None
    """How it finished; `None` when it produced no return value at all."""

    summary: str
    """Its final message."""


@dataclass(frozen=True)
class ProgramSummary:
    """One program you have already run, as `programs.history()` lists it.

    It describes the program's **shape**, never its source: a directory that inlined every program
    would put the whole session back in front of you, which is the one thing the library exists to
    avoid. Fetch the source you actually want with `programs.get(turn)`.
    """

    turn: int
    """The turn it ran on — what `programs.get` takes."""

    lines: int
    """How many lines of source it was."""

    chars: int
    """How many characters of source it was."""

    ok: bool
    """Whether it ran to its end, with nothing raised and no sandbox ceiling stopping it."""

    error: str | None
    """The error it ended with, when it did not run to its end; `None` when it did."""


@dataclass(frozen=True)
class FunctionSummary:
    """One function in an API object's directory, as `list()` returns it.

    It is the entry of the one function every API object carries whatever a run enables, so a program
    can always discover what it has. The summary is one line; the whole documentation of a function —
    every shape it may be called in, what to put in each argument, and the types it refers to — is a
    view, opened with `view.open_docs_view`.
    """

    name: str
    """The function name on its object — `read_file` in `fs.read_file(...)`."""

    summary: str
    """One line saying what it does: the first sentence of its documentation."""
