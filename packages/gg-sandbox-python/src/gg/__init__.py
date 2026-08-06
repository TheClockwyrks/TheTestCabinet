"""gg's Python SDK: the typed, namespaced surface a program written in Python calls gg through.

A program does not normally import anything from here. `gg.scope` binds the API objects — `fs`,
`system`, `project`, `view`, `harness`, … — and every type they speak in directly into the program's
own namespace, so `fs.read_file("main.py")` and `except ToolError` both work in a file with no import
line at all. The package is importable all the same, because a Python programmer who wants to be
explicit should be able to write `from gg import ToolError, TaskStatus` and have it mean the same
thing.

What this package is, and what it is not
----------------------------------------

It is **hand-written and idiomatic**, not generated. Underneath it sits `wit_world`, the bindings
`componentize-py` generates from `crates/gg/wit/gg-sandbox.wit`, and those are exactly where a
generator belongs: a mechanical lowering of typed values across a membrane, which nobody reads. This
layer is the one a model reads, so it is written the way Python is written — required arguments
positional, optional ones as keyword arguments with real defaults, results as frozen dataclasses,
fixed choices as enums, a failure as a raised `ToolError`, and `None` where another language would
say `undefined`.

It is **not the capability model**. Every function is here whatever a run enables; gg refuses the
ones the run withheld, at the host, with `ToolErrorCode.UNAVAILABLE`. What the run decides is which
of them are bound onto an API object, and therefore which a model is ever shown.

Its documentation is **the** documentation. Every docstring on a catalogued function, argument, type
and type member in this package is reflected by `tools/signatures.py` into
`crates/gg/src/sandbox/guests/python.signatures.json`, which is what gg renders the system prompt and
every documentation view from. There is nowhere else for a description of this surface to live, which
is what stops one from drifting.
"""

from __future__ import annotations

from .errors import ToolError
from .types import (
    UNCHANGED,
    AgentEnding,
    ArchiveHit,
    ArchiveSearch,
    BoardUsage,
    DirEntry,
    EntryKind,
    EpicCreated,
    FileRead,
    FunctionSummary,
    ImageFile,
    IssueCreated,
    IssueStatus,
    MemoryHit,
    MemoryUsage,
    MessageRole,
    OpenView,
    ProgramSummary,
    ReclaimReport,
    ShellOutput,
    SubagentHandle,
    SubagentResult,
    TaskStatus,
    TaskUsage,
    TextFile,
    ToolErrorCode,
    TurnRange,
    Unchanged,
    ViewKind,
    ViewRegion,
)

__all__ = [
    "UNCHANGED",
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
    "ToolError",
    "ToolErrorCode",
    "TurnRange",
    "Unchanged",
    "ViewKind",
    "ViewRegion",
]
