"""Read the skills this run authored.

A skill name is a plain string rather than an enum of the run's skills, because the catalogue is
per-run while this component is baked once. The names available are listed in the system prompt, and
an unknown one comes back as `not-found` carrying the full list.
"""

from __future__ import annotations

from wit_world.imports import skills as wire

from ._registry import missing, operation
from .core import _call

__all__ = ["read_skill"]


@operation("skills.read_skill")
def read_skill(name: str) -> str:
    """Read a skill from the run's authored library, by name.

    Reading it also pins that body permanently into context, so a skill that has been read stays
    read.

    A skill may be **code** rather than prose, or as well as it. Code is bound at `lib.<key>` for the
    rest of the session and the reply names the key and what it offers. An on-use script runs once
    this program has ended, and whatever it shows arrives on the next turn.

    Args:
        name: The skill's name, as the system prompt lists it.

    Returns:
        The skill's body with its front matter stripped, and — where the skill is code — the
            `lib.<key>` its public names are now bound at.

    Raises:
        ToolError: `not-found` — listing the skills that do exist — when the name is unknown.
    """
    return _call(wire.read_skill, name)


__getattr__ = missing(__name__, __all__)
"""What this module answers for a name it does not declare — see `gg._registry.missing`."""
