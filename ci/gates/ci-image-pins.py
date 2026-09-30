"""project jobs pin the Rust CI image.

The template's gate jobs name their CI image at the commit `ci/images/tags.yml`
pins as `ciImageTag`, through a compile-time expression, and `ci-tests` holds
that file to one variable and a full commit id. The project's own pipeline
files name the Rust CI image too: `.azure/project/jobs.yml`, which the gates
pipeline includes after that variables file, and `azure-pipelines-release.yml`,
which includes it itself. This gate holds every such reference to the same
expression, so every Rust job of a run compiles in the one image and shares
the template `rust` job's caches, and a tag written by hand cannot fall out of
step with the pin.
"""

import re
from pathlib import Path

from the_test_cabinet_ci import enter_repo_root, fail, say

# The repository each track's image is pushed to, as scripts/ci/ci-image.sh
# names it, and the one expression a job may name its tag with.
REPOSITORY = "testcabinet.azurecr.io/ubuntu-the-test-cabinet-{track}-cicd"
TAG = "${{ variables.ciImageTag }}"
# Any reference to a CI image: the repository and whatever follows its colon,
# a whole `${{ }}` expression or a bare tag.
REFERENCE = re.compile(
    r"testcabinet\.azurecr\.io/ubuntu-the-test-cabinet-(?P<track>[a-z]+)-cicd:(?P<tag>\$\{\{[^}]*\}\}|\S+)"
)
# The variables file, included from a pipeline's own top-level variables list.
TAGS = "ci/images/tags.yml"
TAGS_INCLUDE = re.compile(r"^variables:\n(?:(?:  .*|)\n)*?  - template: " + re.escape(TAGS) + r" *$", re.MULTILINE)

# The project's pipeline files that name the Rust CI image: the jobs the gates
# pipeline includes, and the release pipeline. Each must name it at least
# once, or a reference removed by mistake would pass as none to check.
NAMING = [Path(".azure/project/jobs.yml"), Path("azure-pipelines-release.yml")]
# The release pipeline reads `ciImageTag` itself, so it has to include the
# file that sets it; the jobs template is expanded inside the gates pipeline,
# which ci/tests/test_wiring.py holds to including it.
INCLUDING = [Path("azure-pipelines-release.yml")]
# Every project pipeline file, where a reference under another tag may hide.
PIPELINE_FILES = sorted({*Path(".azure").glob("**/*.yml"), Path("azure-pipelines-release.yml")})

enter_repo_root()

problems: list[str] = []
for path in PIPELINE_FILES:
    if not path.is_file():
        continue
    text = path.read_text(encoding="utf-8")
    references = [
        (number, found)
        for number, line in enumerate(text.splitlines(), 1)
        if not line.lstrip().startswith("#")
        for found in REFERENCE.finditer(line)
    ]
    if path in NAMING and not any(found["track"] == "rust" for _, found in references):
        problems.append(f"{path.as_posix()} names no Rust CI image, and its Rust jobs run in one.")
    for number, found in references:
        expected = REPOSITORY.format(track=found["track"]) + ":" + TAG
        if found.group(0) != expected:
            problems.append(f"{path.as_posix()}:{number}: names {found.group(0)}, not {expected}.")
    if path in INCLUDING and not TAGS_INCLUDE.search(text):
        problems.append(f"{path.as_posix()} reads ciImageTag and includes no {TAGS} in its variables.")

if problems:
    fail(
        "",
        *problems,
        "",
        f"A project job names its CI image as <repository>:{TAG}, which reads the commit {TAGS} pins.",
    )

say(f"Every CI image the project's pipeline files name is pinned by {TAGS}.")
