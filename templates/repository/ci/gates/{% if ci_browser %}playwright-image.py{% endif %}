"""Hold the npm workspace's Playwright to the browser the CI image carries.

The Rust suite's browser tests drive Chromium through the workspace's own
`playwright` package, and the browser itself belongs to the image: the
rust-browser image installs it at the version the superrepo's devcontainer
pins as `PLAYWRIGHT_VERSION`. A `playwright` of another version asks for a
browser build the image does not carry, and every browser test then fails deep
inside its provider. This gate asks the workspace's Playwright where its
Chromium is, as the superrepo's `web-browser-test` gate does, and says plainly
when it is not there, naming the workspace's version and the directory
Playwright looked in (`PLAYWRIGHT_BROWSERS_PATH`).

Where the browser is required (`TCAB_REQUIRE_BROWSER=1`, which the pipeline's
Rust job sets) a missing `node`, an uninstalled workspace or an absent browser
fails the gate. Anywhere else the browser tests skip without one, and so does
this gate, with a notice.

The fix for a skew is to move the workspace's `playwright` devDependency to the
image's version. The superrepo's Repositories page holds the rule: an image bump
that moves `PLAYWRIGHT_VERSION` moves this repository's `playwright` in the same
change as the `scripts/repos/render.py --update` that brings the new pins.
"""

import json
import os

from the_test_cabinet_ci import enter_repo_root, fail, run, say, skip

REQUIRED = os.environ.get("TCAB_REQUIRE_BROWSER") == "1"

# Run from the workspace root, where `require` resolves the workspace's own
# packages. It prints one JSON object: whether the package is installed, its
# version, and the executable it would launch.
PROBE = """
const { existsSync } = require("node:fs");
let playwright;
try {
  playwright = require("playwright");
} catch {
  process.stdout.write(JSON.stringify({ installed: false }));
  process.exit(0);
}
let version = "";
try {
  version = require("playwright/package.json").version;
} catch {}
let path = "";
try {
  path = playwright.chromium.executablePath();
} catch {}
process.stdout.write(JSON.stringify({ installed: true, version, path, present: Boolean(path) && existsSync(path) }));
"""


def unmet(*lines: str) -> None:
    """Fail where the browser is required, and skip with the lines as a notice elsewhere."""
    if REQUIRED:
        fail(*lines)
    skip(*lines, "(the browser is not required here, so the gate passes)")


enter_repo_root()
browsers = os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or "unset, so Playwright's default cache"

probe = run(["node", "--eval", PROBE], capture=True)
if probe.returncode != 0:
    unmet("node could not ask the workspace's Playwright where its browser is.")
found = json.loads(probe.stdout or "{}")
if not found.get("installed"):
    unmet(
        "The npm workspace has no `playwright` installed, so no browser test can run.",
        "Install the workspace first:",
        "    npm ci",
    )
version = found.get("version") or "of an unknown version"
if not found.get("present"):
    unmet(
        f"The workspace's playwright {version} finds no Chromium:",
        f"    it looked for {found.get('path') or 'an executable it could not name'}",
        f"    PLAYWRIGHT_BROWSERS_PATH is {browsers}",
        "The image carries the browser of the superrepo's PLAYWRIGHT_VERSION; move the",
        "workspace's `playwright` devDependency to that version, or run in an image",
        "built for this one.",
    )
say(f"playwright {version} finds its Chromium at {found['path']}")
