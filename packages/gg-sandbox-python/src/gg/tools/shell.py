"""The `system` family: running commands in the workspace.

The one behavioural rule worth stating twice is that a **non-zero exit is a success of the call**.
Checking whether a build or a test run passed is the most common thing a program does, so raising on
it would make `shell` unusable inside an expression; only a process that could not be launched, or
one the timeout killed, raises.
"""

from __future__ import annotations

from wit_world.imports import shell as wire

from ..errors import _call, _positive
from ..types import ShellOutput


def shell(command: str, *, timeout_secs: float | None = None) -> ShellOutput:
    """Run a command with `sh -c` in the workspace directory and return its merged stdout and stderr.

    A non-zero exit is NOT a failure — check `exit_code` on the result; only a process that could not
    be launched, or one the timeout killed, raises. `timeout_secs` defaults to 120 seconds and is
    clamped to whatever is left of the run's wall-clock budget.

    This run may **offload** shell output — the `shell` tool's own description says which mode is in
    force. Under `offload`, `output` holds only the tail that fits and ends with a note naming the two
    files the command's full stdout and stderr were written to. Under `adaptive` (the default), a
    command that **succeeded** returns no output at all, only that note; one that **failed** returns
    the tail. Grep the named files instead of re-running the command.

    Args:
        command: The command line, run by `sh -c` with your workspace as its working directory.
        timeout_secs: How long to let it run before killing it. Leave it out for gg's own default of
            120 seconds, which is clamped to whatever is left of the run's wall-clock budget.
    """
    result = _call(wire.shell, command, _positive("shell", "timeout_secs", timeout_secs))
    return ShellOutput(
        exit_code=result.exit_code, output=result.output, truncated=result.truncated
    )
