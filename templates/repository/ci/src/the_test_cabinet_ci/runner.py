"""Finding the gates under ``ci/gates/`` and running them.

A gate is a script whose file stem is its id. It is described by reading its
source, and run as a child process, so nothing here ever imports one.
"""

from __future__ import annotations

import ast
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from the_test_cabinet_ci.proc import ARTIFACTS_ENV

# Lowercase letters, digits and hyphens: the form an issue's `gates` list uses.
GATE_ID = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")

RESULTS_FILE = "results.json"
LOG_FILE = "output.log"

# The variables that make a tool colour output it is not writing to a terminal.
_FORCES_COLOUR = ("FORCE_COLOR", "CLICOLOR_FORCE")


class UnknownGate(Exception):
    """An id that names no script under the gates directory."""

    def __init__(self, unknown: list[str], known: list[str]) -> None:
        self.unknown = unknown
        self.known = known
        noun = "gate" if len(unknown) == 1 else "gates"
        listed = ", ".join(known) if known else "(none)"
        super().__init__(f"unknown {noun}: {', '.join(unknown)}. Known gates: {listed}")


@dataclass(frozen=True)
class Gate:
    id: str
    path: Path

    @property
    def description(self) -> str:
        return describe(self.path)


@dataclass(frozen=True)
class GateResult:
    id: str
    exit_code: int
    seconds: float
    log: Path | None = None
    artifacts: Path | None = None

    @property
    def ok(self) -> bool:
        return self.exit_code == 0

    def as_json(self) -> dict[str, object]:
        return {
            "id": self.id,
            "ok": self.ok,
            "exit_code": self.exit_code,
            "seconds": round(self.seconds, 3),
            "log": str(self.log),
            "artifacts": str(self.artifacts),
        }


def gates_dir(root: Path) -> Path:
    return root / "ci" / "gates"


def discover(directory: Path) -> list[Gate]:
    """Every gate in the directory, sorted by id.

    A file whose stem is not shaped like an id (`_shared.py`, say) is a helper
    and not a gate.
    """
    if not directory.is_dir():
        return []
    return sorted(
        (Gate(path.stem, path) for path in directory.glob("*.py") if path.is_file() and GATE_ID.fullmatch(path.stem)),
        key=lambda gate: gate.id,
    )


def describe(path: Path) -> str:
    """The first line of the script's module docstring, or "" without one.

    The source is parsed and never executed: listing the gates must cost
    nothing and must work for a gate whose tools are absent.
    """
    try:
        docstring = ast.get_docstring(ast.parse(path.read_text(encoding="utf-8")))
    except (OSError, SyntaxError, ValueError):
        return ""
    if not docstring:
        return ""
    return docstring.strip().splitlines()[0].strip()


def select(directory: Path, ids: list[str], *, everything: bool = False) -> list[Gate]:
    """The gates to run, in the order asked for, each once.

    Every id is checked before anything runs, so a typo in the last one costs
    no time on the ones before it.
    """
    known = discover(directory)
    if everything:
        return known
    by_id = {gate.id: gate for gate in known}
    unknown = [gate_id for gate_id in dict.fromkeys(ids) if gate_id not in by_id]
    if unknown:
        raise UnknownGate(unknown, sorted(by_id))
    return [by_id[gate_id] for gate_id in dict.fromkeys(ids)]


def _command(gate: Gate) -> list[str]:
    # This interpreter is the project's own, so the gate can import the_test_cabinet_ci.
    return [sys.executable, str(gate.path)]


def run_streaming(gate: Gate) -> GateResult:
    """Run a gate with the caller's streams, for a terminal or a commit hook."""
    sys.stdout.flush()
    sys.stderr.flush()
    started = time.monotonic()
    exit_code = subprocess.run(_command(gate), check=False).returncode
    return GateResult(gate.id, exit_code, time.monotonic() - started)


def run_captured(gate: Gate, report_dir: Path) -> GateResult:
    """Run a gate with all of its output in a log under the report directory.

    The gate has one folder in the report, named after it. Its log is there,
    and so is whatever it writes as artifacts.
    """
    artifacts = report_dir / gate.id
    artifacts.mkdir(parents=True, exist_ok=True)
    log = artifacts / LOG_FILE
    # A log is read with grep and tail, often by an agent, and escape codes are
    # noise to both. A terminal session commonly forces colour on (FORCE_COLOR),
    # which a tool obeys even when it writes to a file.
    environment = {name: value for name, value in os.environ.items() if name not in _FORCES_COLOUR}
    environment.update({"NO_COLOR": "1", "CARGO_TERM_COLOR": "never", ARTIFACTS_ENV: str(artifacts)})
    started = time.monotonic()
    with log.open("wb") as sink:
        exit_code = subprocess.run(
            _command(gate),
            env=environment,
            # No terminal on any stream: a tool that finds one may prompt, or
            # draw a progress bar into the log.
            stdin=subprocess.DEVNULL,
            stdout=sink,
            stderr=subprocess.STDOUT,
            check=False,
        ).returncode
    return GateResult(gate.id, exit_code, time.monotonic() - started, log, artifacts)


def run_report(gates: list[Gate], report_dir: Path, root: Path, files: dict[str, Path]) -> dict[str, object]:
    """Run every gate into the report directory and write `results.json`.

    Every gate runs whatever the ones before it did: the caller wants the whole
    picture from one pass. `files` are what the caller goes on to write beside
    the results, by the key each is recorded under. Returns what was written.
    """
    report_dir = report_dir.resolve()
    report_dir.mkdir(parents=True, exist_ok=True)
    results = [run_captured(gate, report_dir) for gate in gates]
    report: dict[str, object] = {
        "ok": all(result.ok for result in results),
        "report_dir": str(report_dir),
        # The checkout the gates ran in. The metrics make coverage paths
        # relative to it, wherever they are collected from.
        "root": str(root),
        "gates": [result.as_json() for result in results],
        **{key: str(path) for key, path in files.items()},
    }
    (report_dir / RESULTS_FILE).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report
