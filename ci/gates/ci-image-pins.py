"""project jobs pin the Rust CI image.

The template's gate jobs name their CI image at the commit `ci/images/tags.yml`
pins as `ciImageTag`, through a compile-time expression, and `ci-tests` holds
that file to one variable and a full commit id. The project's Rust jobs run in
that image too, and a template file cannot read the expression: a
`${{ variables.* }}` inside a jobs template that a pipeline includes expands to
nothing, which a preview compile of this pipeline showed as an image named
with an empty tag. So the root pipeline, `azure-pipelines.yml`, is the only
file that names a CI image, with that expression; the gates pipeline hands it to `.azure/project/jobs.yml`
as its `rustImage` parameter, and a file under `.azure/` takes the image as a
parameter and never names one. This gate holds all of that, so every Rust job
of a run compiles in the one image and shares the template `rust` job's
caches, and a tag written by hand cannot fall out of step with the pin.

It also holds Playwright's pins to one version. The playwright image the
devcontainer's compose file names is what holds the browser engines, and its
reference's tag is the Playwright version that downloaded them; each
`playwright` package that drives those engines is a client, which resolves an
engine by the build its own release names. A pin that moves alone leaves a
client asking for a revision the image does not carry, and the failure surfaces
deep inside a browser provider rather than here. The clients are the one this
workspace's lock resolves, the contracts checkout's and the console's
(console.testcabinet.ai's app). Each repository's pipeline runs in the CI image
this checkout pins, and moving that image is this repository's change, so this
is where they are held together; a checkout that has not initialized a
submodule has nothing of it to compare, and is said to.
"""

import json
import re
from pathlib import Path

from the_test_cabinet_ci import enter_repo_root, fail, say

# The repository each track's image is pushed to, as scripts/ci/ci-image.sh
# names it, and the one expression a root pipeline may name its tag with.
REPOSITORY = "testcabinet.azurecr.io/ubuntu-the-test-cabinet-{track}-cicd"
TAG = "${{ variables.ciImageTag }}"
RUST_IMAGE = REPOSITORY.format(track="rust") + ":" + TAG
# Any reference to a CI image: the repository and whatever follows its colon,
# a whole `${{ }}` expression or a bare tag. A track's name may be hyphenated,
# as `rust-browser` is, and a reference to one is held like any other.
REFERENCE = re.compile(
    r"testcabinet\.azurecr\.io/ubuntu-the-test-cabinet-(?P<track>[a-z]+(?:-[a-z]+)*)-cicd:"
    r"(?P<tag>\$\{\{[^}]*\}\}|\S+)"
)
# The variables file, included from a pipeline's own top-level variables list.
TAGS = "ci/images/tags.yml"
TAGS_INCLUDE = re.compile(r"^variables:\n(?:(?:  .*|)\n)*?  - template: " + re.escape(TAGS) + r" *$", re.MULTILINE)

# The root pipelines, the only files that may name a CI image. Each names the
# Rust one at least once, or a reference removed by mistake would pass as none
# to check, and each includes the file that sets the tag.
ROOTS = [Path("azure-pipelines.yml")]
# The project's jobs, which the gates pipeline includes with the image as this
# parameter.
JOBS = Path(".azure/project/jobs.yml")
JOBS_INCLUDE = re.compile(r"^( *)- template: " + re.escape(JOBS.as_posix()) + r" *$", re.MULTILINE)
PARAMETER = "rustImage"
# Every file under .azure/, where a CI image named outright would hide.
TEMPLATES = sorted(Path(".azure").glob("**/*.yml"))

enter_repo_root()


def references(text: str) -> list[tuple[int, re.Match[str]]]:
    return [
        (number, found)
        for number, line in enumerate(text.splitlines(), 1)
        if not line.lstrip().startswith("#")
        for found in REFERENCE.finditer(line)
    ]


def passes_image(text: str) -> bool:
    """Whether the include of the project's jobs passes `rustImage` as the expression."""
    for include in JOBS_INCLUDE.finditer(text):
        indent = len(include.group(1))
        for line in text[include.end() :].splitlines()[1:]:
            if line.strip() and (len(line) - len(line.lstrip())) <= indent:
                break
            if line.strip() == f"{PARAMETER}: {RUST_IMAGE}":
                return True
    return False


problems: list[str] = []
for path in ROOTS:
    text = path.read_text(encoding="utf-8")
    found = references(text)
    if not any(match["track"] == "rust" for _, match in found):
        problems.append(f"{path.as_posix()} names no Rust CI image, and its Rust jobs run in one.")
    for number, match in found:
        expected = REPOSITORY.format(track=match["track"]) + ":" + TAG
        if match.group(0) != expected:
            problems.append(f"{path.as_posix()}:{number}: names {match.group(0)}, not {expected}.")
    if not TAGS_INCLUDE.search(text):
        problems.append(f"{path.as_posix()} reads ciImageTag and includes no {TAGS} in its variables.")

gates = ROOTS[0].read_text(encoding="utf-8")
if not JOBS_INCLUDE.search(gates):
    problems.append(f"{ROOTS[0].as_posix()} does not include {JOBS.as_posix()}.")
elif not passes_image(gates):
    problems.append(f"{ROOTS[0].as_posix()} includes {JOBS.as_posix()} without `{PARAMETER}: {RUST_IMAGE}`.")

for path in TEMPLATES:
    text = path.read_text(encoding="utf-8")
    for number, match in references(text):
        problems.append(
            f"{path.as_posix()}:{number}: names {match.group(0)}; a template takes the image as a parameter."
        )
jobs = JOBS.read_text(encoding="utf-8")
if not re.search(r"^  - name: " + PARAMETER + r" *$", jobs, re.MULTILINE):
    problems.append(f"{JOBS.as_posix()} declares no `{PARAMETER}` parameter.")
if "${{ parameters." + PARAMETER + " }}" not in jobs:
    problems.append(f"{JOBS.as_posix()} runs no job in `${{{{ parameters.{PARAMETER} }}}}`.")

if problems:
    fail(
        "",
        *problems,
        "",
        f"A root pipeline names a CI image as <repository>:{TAG}, which reads the commit {TAGS} pins,",
        f"and passes it to {JOBS.as_posix()} as `{PARAMETER}`; a file under .azure/ never names one.",
    )

say(f"Every CI image the project's pipelines name is pinned by {TAGS}, and the project's jobs take it as a parameter.")

# Playwright's pins: the compose file's image tag, then every client of it.
COMPOSE = Path(".devcontainer/docker-compose.yml")
LOCK = Path("package-lock.json")
# A submodule's manifest naming `playwright` among its devDependencies, and the
# command that moves it in that repository.
CLIENTS = {
    Path("contracts/package.json"): "scripts/repos/render.py --update contracts",
    Path("console.testcabinet.ai/apps/web/package.json"): "an edit of apps/web/package.json in console.testcabinet.ai",
}

images = re.findall(r"^ *PLAYWRIGHT_IMAGE: *(\S+?) *$", COMPOSE.read_text(encoding="utf-8"), flags=re.MULTILINE)
if len(images) != 1:
    fail(f"{COMPOSE.as_posix()} names PLAYWRIGHT_IMAGE {len(images)} times; it names the one playwright image once.")
image_pin = images[0].rpartition(":")[2]

disagreements: list[str] = []
locked = json.loads(LOCK.read_text(encoding="utf-8")).get("packages", {}).get("node_modules/playwright", {})
if locked and locked.get("version") != image_pin:
    disagreements.append(f"    {LOCK.as_posix()} resolves playwright {locked.get('version')}")
absent: list[str] = []
for manifest, move in CLIENTS.items():
    if not manifest.is_file():
        absent.append(manifest.parts[0])
        continue
    pin = json.loads(manifest.read_text(encoding="utf-8")).get("devDependencies", {}).get("playwright")
    if pin != image_pin:
        disagreements.append(f"    {manifest.as_posix()} names {pin} (moved by {move})")
if disagreements:
    fail(
        "Playwright's pins disagree, so a client asks for engines the image does not carry:",
        f"    PLAYWRIGHT_IMAGE in {COMPOSE.as_posix()} holds the engines of {image_pin}",
        *disagreements,
        "Move each client to the image's version (a submodule's in its own repository, then",
        "bump the submodule pin here), or update the workspace to a template version whose",
        "playwright image holds the clients' version and rebuild the devcontainer.",
    )
if absent:
    say(f"Not initialized, so their Playwright pins were not compared: {', '.join(absent)}.")
say(f"Every Playwright client this checkout holds names {image_pin}, the version of the engines the image carries.")
