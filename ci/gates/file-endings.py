"""End every tracked text file outside a frozen version with exactly one newline.

The template's web job runs the pinned `end-of-file-fixer` hook over the whole
tree, and 109 files inside frozen test-case versions fail it. Those versions may
never change, and the upstream hooks take no project excludes, so the project's
web setup steps skip that one hook in the pipeline (`SKIP=end-of-file-fixer`,
recorded as gap G2 of the adoption). This gate is what stands in for it:

- it runs the same hook, at the version and with the excludes that
  `.pre-commit-config.yaml` pins, over every tracked file except those under a
  directory holding a tracked `.frozen` marker, which it never touches;
- like the commit hook, it fixes each file it fails on, so a failure leaves the
  fix in the worktree to commit;
- it holds the override narrow: the project's pipeline files may set `SKIP`
  once, in `.azure/project/setup-steps.yml`, to `end-of-file-fixer` alone. Any
  other `SKIP` would silence a check with nothing standing in for it.

It has no hook, because the commit hook already runs `end-of-file-fixer` on
every staged file; this gate catches a commit that bypassed it.
"""

import os
import re
from pathlib import Path

from the_test_cabinet_ci import GIT_LOCATION_VARIABLES, enter_repo_root, fail, git, require_tool, run, say

HOOK = "end-of-file-fixer"
MARKER = ".frozen"
BATCH = 2000

# Where the project's pipeline lives: the files the template renders once and
# leaves to the project, the project's own templates, and the release pipeline.
PIPELINE_FILES = ["azure-pipelines-release.yml"]
PIPELINE_GLOBS = [".azure/project/*.yml", ".azure/tcab/**/*"]
ALLOWED_AT = ".azure/project/setup-steps.yml"

# `##vso[task.setvariable variable=SKIP]<value>` sets it for the job's later
# steps; a `SKIP:` key under a step's `env` or a job's `variables`, or a
# `- name: SKIP` entry in a variables list, sets it for that scope.
SETVARIABLE = re.compile(r"task\.setvariable\s+variable=SKIP(?:;[^\]]*)?\](?P<value>[^\"'\s]*)")
YAML_SETTINGS = (
    re.compile(r"^\s*-?\s*SKIP\s*:"),
    re.compile(r"^\s*-?\s*name:\s*[\"']?SKIP[\"']?\s*$"),
)

enter_repo_root()


def skip_overrides() -> list[tuple[str, int, str]]:
    """Every place the pipeline files set SKIP: (path, line, value or the line)."""
    paths = [Path(name) for name in PIPELINE_FILES if Path(name).is_file()]
    for pattern in PIPELINE_GLOBS:
        paths.extend(path for path in sorted(Path().glob(pattern)) if path.is_file())
    found = []
    for path in paths:
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except UnicodeDecodeError:
            continue
        for number, line in enumerate(lines, 1):
            if line.lstrip().startswith("#"):
                continue
            found.extend((path.as_posix(), number, match["value"]) for match in SETVARIABLE.finditer(line))
            if any(setting.search(line) for setting in YAML_SETTINGS):
                found.append((path.as_posix(), number, line.strip()))
    return found


problems: list[str] = []

overrides = skip_overrides()
if [(path, value) for path, _, value in overrides] != [(ALLOWED_AT, HOOK)]:
    problems += [
        f"The project's pipeline files must set SKIP exactly once, in {ALLOWED_AT}, to {HOOK} (gap G2).",
        "It skips the one upstream hook that frozen test-case versions fail, and this gate runs",
        "that hook over everything else. Found:" if overrides else "Found no such override.",
        *(f"    {path}:{number}: {value}" for path, number, value in overrides),
        "",
    ]

require_tool("pre-commit", "The devcontainer installs it (.devcontainer/tools/uv.sh), and so does the web CI image.")

listed = git(["ls-files", "-z"])
if listed.returncode != 0:
    fail("git ls-files failed, so the tracked files are unknown.")
tracked = [path for path in listed.stdout.split("\0") if path]

# A frozen version is a directory holding a tracked marker; everything under it
# is history, including files the hook would fix.
frozen = sorted(path[: -len(MARKER)] for path in tracked if path == MARKER or path.endswith("/" + MARKER))

# A tracked path deleted from the worktree has no ending to judge, and pre-commit
# refuses a path it cannot classify.
files = [path for path in tracked if not path.startswith(tuple(frozen)) and os.path.lexists(path)]

fixed: list[str] = []
failed = False
for start in range(0, len(files), BATCH):
    batch = files[start : start + BATCH]
    # SKIP is removed so the web job's override, which this gate stands in for,
    # cannot reach the one hook it runs.
    result = run(["pre-commit", "run", HOOK, "--files", *batch], unset=["SKIP", *GIT_LOCATION_VARIABLES], capture=True)
    if result.stdout.strip():
        say(result.stdout.rstrip())
    if result.returncode != 0:
        failed = True
        fixed += [
            line.removeprefix("Fixing ").strip() for line in result.stdout.splitlines() if line.startswith("Fixing ")
        ]

if fixed:
    problems += [
        f"{HOOK} failed on {len(fixed)} file(s) outside frozen versions and fixed them in the worktree:",
        *(f"    {path}" for path in fixed),
        "Review the fix, then commit them again.",
    ]
elif failed:
    # pre-commit also fails a hook when the worktree's diff moved while it ran,
    # which is another process editing the checkout rather than a bad ending.
    problems += [
        f"{HOOK} fixed no file, yet pre-commit reported the worktree changed while it ran.",
        "Something else was editing the checkout; run the gate again once it is idle.",
    ]

if problems:
    fail("", *problems)
say(f"{len(files)} tracked files outside {len(frozen)} frozen versions end with one newline.")
