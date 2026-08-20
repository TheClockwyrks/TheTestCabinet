"""Run shell commands in the workspace.

One function, and the way a program reaches everything gg has no API for: a build, a test run,
`git`, `curl`, a package manager. The workspace is the working directory.

A non-zero exit is a *result* rather than a failure, because deciding whether a build or a test run
passed is the single most common thing a program does with one.
"""

from __future__ import annotations

from dataclasses import dataclass

from wit_world.imports import shell as wire

from ._registry import missing, operation
from .core import _call, _positive

__all__ = ["ShellOutput", "shell"]


@dataclass(frozen=True)
class ShellOutput:
    """What a command reported when it finished."""

    exit_code: int | None
    """The process's exit status; `None` when a signal killed it. Zero means success."""

    output: str
    """Merged stdout then stderr, tail-truncated at 16 KiB.

    Under a run that offloads shell output the ceiling is the configured line or character one
    instead, and an output that was cut ends with a note naming the two files that hold the whole of
    it.
    """

    truncated: bool
    """Whether the cap cut `output`, dropping the head and keeping the tail."""


@operation("shell.shell")
def shell(command: str, *, timeout_secs: float | None = None) -> ShellOutput:
    """Run a command with `sh -c` in the workspace and hand back its merged stdout and stderr.

    A non-zero exit is not a failure: read `exit_code` on the result. Only a process that could not
    be launched, or one the timeout killed, raises.

    This run may **offload** shell output — this call's own description says which mode is in
    force. Under `offload`, `output` holds only the tail that fits and ends with a note naming the
    two files the command's full stdout and stderr were written to. Those files are readable by
    absolute path, so a `gg.files.read_text_file` of one, or a grep, is cheaper than re-running the
    command.

    Args:
        command: The command line, run by `sh -c` with the workspace as its working directory.
        timeout_secs: How long to let it run, in seconds, before killing it. The default is gg's own
            120, clamped to whatever is left of the run's wall-clock budget.

    Returns:
        The command's merged stdout and stderr, its `exit_code` — `None` when a signal killed the
            process — and whether gg's cap `truncated` the output.

    Raises:
        ApiError: `limit-exceeded` when the timeout killed the process, and `io-error` when it could
            not be launched.
    """
    result = _call(wire.shell, command, _positive("shell", "timeout_secs", timeout_secs))
    return ShellOutput(
        exit_code=result.exit_code, output=result.output, truncated=result.truncated
    )


__getattr__ = missing(__name__, __all__)
"""What this module answers for a name it does not declare — see `gg._registry.missing`."""
