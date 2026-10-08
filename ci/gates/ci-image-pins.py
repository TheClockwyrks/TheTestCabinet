"""project jobs pin the Rust CI image.

The template's gate jobs name their CI image at the commit `ci/images/tags.yml`
pins as `ciImageTag`, through a compile-time expression, and `ci-tests` holds
that file to one variable and a full commit id. The project's Rust jobs run in
that image too, and a template file cannot read the expression: a
`${{ variables.* }}` inside a jobs template that a pipeline includes expands to
nothing, which a preview compile of this pipeline showed as an image named
with an empty tag. So the root pipelines, `azure-pipelines.yml` and
`azure-pipelines-release.yml`, are the only files that name a CI image, each
with that expression; the gates pipeline hands it to `.azure/project/jobs.yml`
as its `rustImage` parameter, and a file under `.azure/` takes the image as a
parameter and never names one. This gate holds all of that, so every Rust job
of a run compiles in the one image and shares the template `rust` job's
caches, and a tag written by hand cannot fall out of step with the pin.
"""

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
ROOTS = [Path("azure-pipelines.yml"), Path("azure-pipelines-release.yml")]
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
