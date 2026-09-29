"""project jobs pin the Rust CI image.

The template's gate jobs read the Rust CI image's tag out of
`ci/images/tags.yml`, and the `ci-tests` gate holds that file to what the
image's inputs digest to. The project's own Rust jobs in
`.azure/project/jobs.yml` cannot read that variable, since a jobs template is
expanded before the pipeline's variables are, so they name the image as the
literal default of a `rustImage` parameter instead.
`scripts/ci/tcab-image-pin.sh --check` fails while that literal is not the tag
`tags.yml` pins, which is what keeps every Rust job of a run in one image and
lets them share the template `rust` job's caches.
"""

from the_test_cabinet_ci import GIT_LOCATION_VARIABLES, enter_repo_root, fail, run, say

enter_repo_root()

if run(["scripts/ci/tcab-image-pin.sh", "--check"], unset=GIT_LOCATION_VARIABLES).returncode != 0:
    fail(
        "",
        "The project's Rust jobs pin another image than ci/images/tags.yml names.",
        "Write the pin, then commit both files together:",
        "    scripts/ci/tcab-image-pin.sh",
    )

say("The project's Rust jobs pin the image ci/images/tags.yml names.")
