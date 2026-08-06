"""The one helper bound alongside the tools.

Exactly one, deliberately. Reading a file's text is the single most common thing a program does, and
forcing a narrowing on it (`read = fs.read_file(p); if isinstance(read, TextFile): …`) is friction on
the hot path. Everything else a "standard library" might add is another name in the system prompt and
another thing for a model to get wrong, so nothing else is added here.

A helper is not a tool: it is catalogued separately, so it cannot perturb the one-to-one
correspondence between the guest's bound names and gg's `ALL_TOOL_NAMES`, and it is bound onto the
object of the tool it is built on only when that tool is enabled.

It is also not a **wrapper written here**, though it reads like one. It calls its own host import,
because a helper composed in the guest out of `read_file` is invisible to the host: gg would see the
read and record it under the name the model did not write, while `read_text_file` itself reported a
zero — a page telling its reader the model ignored a call it in fact used. The shared core lives on
the far side of the membrane, where sharing a core costs nothing.
"""

from __future__ import annotations

from wit_world.imports import helpers as wire

from .errors import _call, _uint


def read_text_file(path: str, *, offset: int | None = None, limit: int | None = None) -> str:
    """Read a text file and return its contents directly — `fs.read_file` without the narrowing, for
    the common case.

    Takes the same `offset`/`limit` window arguments.

    Args:
        path: The file to read. Relative to your workspace, or absolute.
        offset: The 1-based line to start at. Honoured only under a capped read policy.
        limit: How many lines to return from `offset`. Honoured only under a capped read policy.

    Raises:
        ToolError: `invalid-argument` when the path names a picture; use `fs.read_file` to inspect
            those.
    """
    return _call(
        wire.read_text_file,
        path,
        _uint("read_text_file", "offset", offset),
        _uint("read_text_file", "limit", limit),
    )
