"""gg's Python SDK: the capability modules a program written in Python calls gg through.

The surface is **thirteen modules** — `gg.docs`, `gg.files`, `gg.shell`, `gg.board`, `gg.tasks`,
`gg.memories`, `gg.views`, `gg.context`, `gg.delegation`, `gg.skills`, `gg.programs`, `gg.session`,
and a `gg.core` that declares no function and holds the types the other twelve's signatures name.
Each module owns the types it produces, so `gg.files.FileRead` is both the key a documentation view
is opened by and a path a program can write.

`gg.docs` comes first because a session starts there: the system prompt names modules and no
function, so a program finds a name by searching this module and reads it in full by opening a
documentation view of what it found.

`import gg` is the line a program writes to reach any of it, and after it every name below is
written the way the documentation spells it: `gg.files.read_file("a.py")`, `except
gg.core.ToolError`. Python's other spellings mean the same thing, so `from gg import files` and
`from gg.files import read_file` reach the same objects.

What this package is, and what it is not
----------------------------------------

It is **hand-written and idiomatic**, not generated. Underneath it sits `wit_world`, the bindings
`componentize-py` generates from `crates/gg/wit/gg-sandbox.wit`, and those are exactly where a
generator belongs: a mechanical lowering of typed values across a membrane, which nobody reads. This
layer is the one a model reads, so it is written the way Python is written — module-level functions
rather than a class of static methods, required arguments positional, optional ones as keyword
arguments with real defaults, results as frozen dataclasses, fixed choices as enums, a failure as a
raised `ToolError`, and `None` where another language would say `undefined`.

It is **not the capability model**. Every function is here whatever a run enables; gg refuses the
ones the run withheld, at the host, with `ToolErrorCode.UNAVAILABLE`. What the run decides is which
of them a model is shown by a documentation search.

Its documentation is **the** documentation. Every docstring on a catalogued function, argument, type
and type member in this package is reflected by `tools/signatures.py` into the
`python.signatures.json` that `crates/gg/build.rs` writes into its own `OUT_DIR`, which is what gg
answers a documentation search and every documentation view from; the system prompt renders no
signature at all, and takes only the module paths and the one-line brief each module introduces
itself by. There is nowhere else for a description of this surface to live, which is what stops one
from drifting.

A docstring's **first line is its brief** and everything after the blank line is its detail, which is
PEP 257's own shape and the shape every arm's catalogue carries. The reflector refuses a first
paragraph that runs over one line, so the split is a rule the author is held to where the author is
standing.
"""

from __future__ import annotations

from . import (
    board,
    context,
    core,
    delegation,
    docs,
    files,
    memories,
    programs,
    session,
    shell,
    skills,
    tasks,
    views,
)
from ._registry import missing
from .core import UNCHANGED, ToolError, ToolErrorCode, Unchanged

__all__ = [
    "UNCHANGED",
    "ToolError",
    "ToolErrorCode",
    "Unchanged",
    "board",
    "context",
    "core",
    "delegation",
    "docs",
    "files",
    "memories",
    "programs",
    "session",
    "shell",
    "skills",
    "tasks",
    "views",
]


__getattr__ = missing(__name__, __all__)
"""What this package answers for a name it does not declare — see `gg._registry.missing`."""
