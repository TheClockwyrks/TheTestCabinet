"""The `skills` family: the authored skill library.

A skill name is a plain string rather than an enum of the run's skills, because the catalogue is
per-run while this component is baked once. The names available are listed in the system prompt, and
an unknown one comes back as `not-found` carrying the full list.
"""

from __future__ import annotations

from wit_world.imports import skills as wire

from ..errors import _call


def read_skill(name: str) -> str:
    """Read a skill by name and return its body with the front matter stripped; reading it also pins
    that body permanently into your context, so a skill you have read stays read.

    A skill may be **code** rather than prose, or as well as it. If it carries code, reading it binds
    that code at `lib.<key>` for the rest of your session and the reply names the key and what it
    exports. If it carries an on-use script, gg runs it once your program has ended, and whatever it
    shows you arrives on your next turn.

    Args:
        name: The skill's name, as the system prompt lists it.

    Raises:
        ToolError: `not-found`, listing the skills that do exist, when the name is unknown.
    """
    return _call(wire.read_skill, name)
