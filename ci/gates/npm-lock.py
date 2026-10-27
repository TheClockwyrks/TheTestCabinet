"""Fail when `npm ci` would not install the npm workspace from package-lock.json.

`npm ci` installs exactly the tree package-lock.json records, and refuses when
the lock and the workspace's manifests disagree: a workspace the lock does not
list or one it lists that is gone, a dependency added, removed or moved in a
manifest without the lock following it, or a package requiring a version of a
workspace package the workspace does not hold. The last one is the quiet kind.
The workspace lists the packages of three submodules (contracts', engines' and
ui-common's), so a pin move alone can change a manifest the lock was written
against, and npm then looks for the required version on the public registry,
where `@clockwyrks/*` is not published, and fails with a 404. The devcontainer's
`post-create.sh` and the pipeline's `scripts/ci/npm-install.sh` both run
`npm ci`, so a lock out of step with the checkout is a container that cannot be
created and a web job that stops before its first check. This gate is that
check at commit time, triggered by the root manifest, the lock, every
workspace manifest and the three gitlinks.

It runs `npm ci --dry-run`, which resolves the tree from the lock and checks it
against the manifests without touching node_modules or the lock, so it needs no
installed workspace. `--ignore-scripts` keeps every lifecycle script out of it,
and `--no-audit --no-fund` keeps the registry calls to the ones resolving a
package the lock does not already hold. It takes about a second and a half
(1.4 s measured on a consistent tree, 1.6 s on one failing with the 404).

A checkout whose workspace submodules are not initialized has no manifests to
hold the lock to, and `npm ci` cannot run in it at all, so the gate skips and
says which submodule is missing, as the devcontainer's own script does.
"""

import json
import re
from pathlib import Path

from the_test_cabinet_ci import enter_repo_root, fail, git, require_tool, say, skip, succeeded

# From the workspace root, so npm reads the root package.json and its lock
# regardless of the caller's working directory.
root = enter_repo_root()

require_tool("npm", "Install Node.js and npm (the devcontainer image carries both).")

manifest = json.loads((root / "package.json").read_text(encoding="utf-8"))
patterns: list[str] = manifest.get("workspaces", [])

# The submodule paths `.gitmodules` declares. A workspace glob under one of them
# names nothing until that submodule is checked out.
listed = git(["config", "-f", ".gitmodules", "--get-regexp", r"^submodule\..*\.path$"], quiet=True)
submodules = {line.split(maxsplit=1)[1] for line in listed.stdout.splitlines() if " " in line}

missing = sorted(
    {
        top
        for top in (pattern.split("/", 1)[0] for pattern in patterns)
        if top in submodules and not (root / top / ".git").exists()
    }
)
if missing:
    skip(
        "npm-lock: the npm workspace lists the packages of "
        + ", ".join(f"{name}/" for name in missing)
        + (", which are" if len(missing) > 1 else ", which is")
        + " not checked out, so `npm ci` cannot run here. Check out first:",
        "    git submodule update --init " + " ".join(missing),
    )

command = ["npm", "ci", "--dry-run", "--ignore-scripts", "--no-audit", "--no-fund"]
if succeeded(command):
    say("", "npm-lock: package-lock.json installs the npm workspace as checked out.")
    raise SystemExit(0)

# npm's own error says what it could not do but not why, and the commonest
# cause, a workspace package required at a version the workspace does not
# hold, reads as a registry 404. Name every exact requirement of that kind.
EXACT = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]*)?$")
DEPENDENCY_FIELDS = ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies")

workspaces: dict[str, tuple[str, Path]] = {}
for pattern in patterns:
    for path in sorted(root.glob(f"{pattern}/package.json")):
        package = json.loads(path.read_text(encoding="utf-8"))
        if "name" in package:
            workspaces[package["name"]] = (package.get("version", ""), path.relative_to(root))

drift: list[str] = []
for _name, (_version, path) in sorted(workspaces.items()):
    package = json.loads((root / path).read_text(encoding="utf-8"))
    for field in DEPENDENCY_FIELDS:
        for dependency, requirement in sorted(package.get(field, {}).items()):
            if dependency not in workspaces or not EXACT.match(str(requirement)):
                continue
            held, held_at = workspaces[dependency]
            if requirement != held:
                drift.append(
                    f"    {path} requires {dependency} {requirement} ({field}), "
                    f"but the workspace holds {held} at {held_at.parent}"
                )

lines = [
    "",
    "npm-lock: `npm ci` would not install the npm workspace from package-lock.json",
    "as committed: a workspace manifest and the lock disagree.",
]
if drift:
    lines += [
        "",
        "A workspace package is required at a version the workspace does not hold,",
        "so npm looks for it on the registry instead:",
        *drift,
        "",
        "Move the submodule pin, or the requirement, to the version the workspace",
        "holds, so the lock as committed matches again.",
    ]
else:
    lines += [
        "",
        "Bring the lock and the manifests back in step (a dependency changed without",
        "the lock following it, a workspace added or removed, or a submodule pin",
        "moved to a commit whose manifests the lock was not written against).",
    ]
lines += ["", "Reproduce it with:", "    " + " ".join(command)]
fail(*lines)
