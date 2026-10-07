"""Read JSON with comments, which ``devcontainer.json`` is written in.

The devcontainer specification defines that file as JSONC: JSON that also
carries ``//`` and ``/* */`` comments and trailing commas. Comments in it are
ordinary, and a developer writing one is writing a valid file, so what reads
the file reads the format it is actually in rather than reporting a correct
file as invalid.

``scripts/check-devcontainer.py`` imports this, so every reader of the
devcontainer declaration reads it the same way.
"""

from __future__ import annotations

import json
import re

# A string, a block comment, or a line comment. Strings are matched first, so a
# `//` or a `/*` inside one stays part of the string rather than opening a
# comment.
STRING_OR_COMMENT = re.compile(r'"(?:\\.|[^"\\])*"|/\*.*?\*/|//[^\n]*', re.DOTALL)

# A string, or a comma with nothing but whitespace between it and the end of the
# object or array holding it.
STRING_OR_TRAILING_COMMA = re.compile(r'"(?:\\.|[^"\\])*"|,(?=\s*[}\]])')


def blanked(match: re.Match[str]) -> str:
    """The match itself when it is a string, and whitespace when it is not."""
    token = match.group(0)
    if token.startswith('"'):
        return token
    return "".join(character if character == "\n" else " " for character in token)


def loads(text: str) -> object:
    """The document *text* holds, read as JSONC.

    Comments and trailing commas are blanked rather than removed, so a parse
    error still reports the line and column the file has in an editor.
    """
    return json.loads(STRING_OR_TRAILING_COMMA.sub(blanked, STRING_OR_COMMENT.sub(blanked, text)))
