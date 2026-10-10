"""Run the web app's browser tests in the engines its test configuration names.

It runs the app's own `test:browser` script through the npm workspace, which is
`vitest run` over the browser project `apps/web/vite.config.ts` names. That
configuration decides the file set and the instances, so no path is passed.

The suite is a gate of its own because it drives real engines, which is the
only way to read what a browser decides: the layout a viewport width selects,
the color the cascade resolves a token to, and whether the document overflows
its own width. All three read correctly under jsdom, which lays nothing out, so
`web-test.py` beside this file sees none of them.

Asked for artifacts, it adds vitest's JUnit report and nothing else. The test
configuration reads `CI_GATE_ARTIFACTS` as the directory the reports go in, and
`CI_GATE_COVERAGE=0` as this suite's refusal of the v8 coverage `web-test.py`
wants of the jsdom project: instrumenting three real engines costs time and
states nothing the jsdom run does not.

The report is asked for through that configuration rather than on vitest's
command line because the JUnit reporter's `classnameTemplate` can only be given
there, and that template is what keeps this suite's six runs of one file six
distinct tests in the metrics rather than one.
"""

import json
import re

from the_test_cabinet_ci import artifacts_dir, enter_repo_root, fail, run, succeeded

# From the workspace root, so npm finds the workspace regardless of the
# caller's working directory.
root = enter_repo_root()

if not (root / "node_modules").is_dir():
    fail("The npm workspace is not installed. Install it first:", "    npm ci")

# Playwright is pinned twice, and the two pins are one version. The build
# argument in the devcontainer's compose file is what downloads the engines
# into the image, and the `playwright` package in apps/web/package.json is the
# client vitest drives them through. A client resolves an engine by the build
# its own release names, so a pin that moves alone leaves the client asking for
# a revision the cache does not hold, and the failure surfaces deep inside the
# browser provider rather than here. Nothing else in the workspace holds the
# two together, so this does.
COMPOSE = ".devcontainer/docker-compose.yml"
pins = re.findall(r"^ *PLAYWRIGHT_VERSION: *(.*)$", (root / COMPOSE).read_text(encoding="utf-8"), flags=re.MULTILINE)
image_pin = "\n".join(pins)
client = run(
    ["node", "--eval", 'process.stdout.write(require("playwright/package.json").version)'],
    capture=True,
)
if client.returncode != 0:
    # node has already said why on stderr.
    fail("The `playwright` package could not be read from the npm workspace.")
client_pin = client.stdout
if image_pin != client_pin:
    fail(
        "Playwright's two pins disagree, so the client asks for engines the image does not carry:",
        f"    {COMPOSE} names {image_pin}, which is what installs the engines",
        f"    apps/web/package.json names {client_pin}, which is what drives them",
        "Move both to the same version, then reinstall the engines:",
        "    bash .devcontainer/tools/browsers.sh",
    )

# The contracts submodule pins a third: its own `playwright`, which its Rust
# browser tests drive the engines of the same image through. Its pipeline runs
# in the image this checkout names, and moving the image is this repository's
# change, so this is where the three are held to one version. A checkout that
# has not initialized the submodule has nothing to compare.
CONTRACTS = root / "contracts" / "package.json"
if CONTRACTS.is_file():
    contracts_manifest = json.loads(CONTRACTS.read_text(encoding="utf-8"))
    contracts_pin = contracts_manifest.get("devDependencies", {}).get("playwright")
    if contracts_pin != image_pin:
        fail(
            "The contracts submodule's Playwright pin disagrees with the image's:",
            f"    {COMPOSE} names {image_pin}, which is what installs the engines",
            f"    contracts/package.json names {contracts_pin}, which is what its tests drive them with",
            "Move contracts' pin in the contracts repository (scripts/repos/render.py --update contracts),",
            "then bump the submodule pin here with it.",
        )

# The engines belong to the image this suite runs in, not to the npm workspace:
# they are downloaded when that image is built, so `npm ci` leaves them absent
# in an image built before this gate existed, and vitest then fails deep inside
# its browser provider. The check below needs to know where they live, because
# it asks Playwright itself, which honours PLAYWRIGHT_BROWSERS_PATH. It then
# says plainly which ones are missing.
ABSENT_ENGINES = """
const { existsSync } = require("node:fs");
const playwright = require("playwright");
const absent = ["chromium", "firefox", "webkit"].filter((engine) => {
  try {
    return !existsSync(playwright[engine].executablePath());
  } catch {
    return true;
  }
});
process.stdout.write(absent.join(", "));
"""
engines = run(["node", "--eval", ABSENT_ENGINES], capture=True)
if engines.returncode != 0:
    # node has already said why on stderr.
    fail("Playwright could not be asked where its engines live.")
missing = engines.stdout
if missing:
    fail(
        f"Playwright has no browser to drive ({missing}). Install the engines with:",
        "    bash .devcontainer/tools/browsers.sh",
        "or rebuild the devcontainer, which installs them as part of the image.",
    )

# The variable may name a relative path, and npm runs the suite from the app's
# folder: the absolute form means the same directory there. The `0` is what
# leaves coverage out of this suite alone.
artifacts = artifacts_dir()
environment = {} if artifacts is None else {"CI_GATE_ARTIFACTS": str(artifacts), "CI_GATE_COVERAGE": "0"}

if not succeeded(["npm", "run", "--silent", "--workspace", "apps/web", "test:browser"], env=environment):
    fail(
        "",
        "The web app's browser tests failed. Reproduce them with:",
        "    npm run --workspace apps/web test:browser",
    )
