"""Every place that runs a gate names one that exists, and the pipeline runs them all.

The hooks and the pipeline name gates by id in plain command lines, where a
renamed or deleted gate is found only when that line next runs. They are read
as text: this workspace has no YAML parser, by design, which is the same reason
`scripts/check-devcontainer.py` reads the devcontainer declaration as text.

The pipeline gives each check a step of its own so that a step's duration is
the cost of one check (`azure-pipelines.yml`). It runs the checks on two
tracks, a job per toolchain, so a check also has to land on exactly one of
them: a gate with a step in neither is a check that stopped running, and one
with a step in both is a check paid for twice whose duration is the cost of
neither track.

A gate also has to have a hook, because the hook is what runs it at commit
time; a gate with none is a check nobody meets until a pipeline run. The
exceptions are the gates the project answered are too slow for a commit, which
the template renders no hook for and which are held to having none.

The image each track runs inside is read here too. A track names a
purpose-built CI image by an immutable, content-addressed tag, which
`scripts/ci/ci-image.sh tag` computes from the checkout and writes into
`ci/images/tags.yml`, the variables template the pipeline includes. Nothing but
a test holds the file to the checkout, and the failure when they part is the
quiet kind: the run pulls the image the previous pin named and every gate
passes inside a toolchain this commit no longer describes. The other half of the same seam is that script's
input lists against `azure-pipelines-ci-images.yml`'s trigger paths — a path
the tag digests but the trigger misses is a pin that moves with no image built
for it, and one the trigger fires on but the tag ignores is a build queued for
nothing.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from collections import Counter
from collections.abc import Iterable, Mapping
from pathlib import Path

import pytest

from the_test_cabinet_ci import proc, runner

ROOT = Path(__file__).resolve().parents[2]
GATE_IDS = {gate.id for gate in runner.discover(runner.gates_dir(ROOT))}

CONFIG = ROOT / ".pre-commit-config.yaml"
PIPELINE = ROOT / "azure-pipelines.yml"
# The pipeline that builds the CI images, and the script that is the whole of
# its logic: what each image is built from, and the tag that content names.
IMAGE_PIPELINE = ROOT / "azure-pipelines-ci-images.yml"
CI_IMAGE_SCRIPT = ROOT / "scripts" / "ci" / "ci-image.sh"
# The tag of each CI image, as a variables template the pipeline includes. The
# script writes it and the template renders it once, with placeholders.
TAGS = ROOT / "ci" / "images" / "tags.yml"
TAGS_TEMPLATE = TAGS.relative_to(ROOT).as_posix()
CALLERS = [CONFIG.name, PIPELINE.name]

# The gates the project answered are too slow for a commit: they run in the
# pipeline and in `make gate`, and a commit never waits on them.
HOOKLESS = {
    "contract-drift",
    "file-endings",
    "rust-doctest",
    "rust-test",
    "site-build",
    "validators-typecheck",
    "workspace-test",
}
# The project's own gates, which the `extra_gates` answer names, each with the
# track the answer puts its step on.
PROJECT_GATES = {
    "frozen-paths": "web",
    "seeded-contract": "web",
    "spec-vocabulary": "web",
    "spec-prose": "web",
    "audio-packs": "web",
    "build-context": "web",
    "k8s-deploy-sets": "web",
    "ci-image-pins": "web",
    "scripts-test": "web",
    "file-endings": "web",
    "workspace-test": "web",
    "validators-typecheck": "web",
    "site-build": "web",
    "contract-drift": "rust",
}

# The file a tool's version is written in, which ci/images/build-args.sh reads
# the pins out of. A tag digests those pins rather than this file, so that
# bumping one no CI image installs retires no image; the image pipeline's
# trigger carries it all the same, because a pin an image does install moves
# its tag and a build has to be queued for it.
PINS = ".devcontainer/docker-compose.yml"
# The service connection the agent pulls a CI image with. One connection holds
# push rights on the registry, so it serves this pipeline's pull and the image
# pipeline's push; a second one would be a second thing to keep in step.
ACR_ENDPOINT = "the-test-cabinet-acr"
# Each track with an image, which is also the id of the job that runs in it.
TRACKS = ["rust", "web"]
# The repository each track's image is pushed to, which ci-image.sh names too.
REPOSITORY = "testcabinet.azurecr.io/ubuntu-the-test-cabinet-{track}-cicd"
# The tag a fresh render carries, which names no image any registry holds. It
# is a placeholder rather than a missing line so that the rendered pipeline is
# valid and this file can say exactly what is wrong with it.
PLACEHOLDER_TAG = "v1-000000000000"

# `gate run a b c`, up to whatever ends the ids: an option, a quote, `&&`.
GATE_RUN = re.compile(r"\bgate run((?: +[a-z0-9]+(?:-[a-z0-9]+)*)+)")
# A gate's script, as a command's argument or escaped inside a `files` regex.
GATE_SCRIPT = re.compile(r"ci/gates/([a-z0-9-]+)\\?\.py")
# A hook's id. `- id:` appears nowhere else in the configuration.
HOOK_ID = re.compile(r"^ *- id: ([a-z0-9-]+) *$", re.MULTILINE)
# `pre-commit run <id>`: one hook, which is what a step of the pipeline runs
# for a check the hook framework brings from an upstream repository. An id
# never opens with the hyphen an option does, so a bare
# `pre-commit run --all-files` matches nothing here, which is the point.
PRE_COMMIT_RUN = re.compile(r"\bpre-commit run ([a-z0-9][a-z0-9-]*)")
# A stage and a job, at the indentation the pipeline writes them at. Reading
# the file as text is what makes these the boundaries: a job runs the steps
# written after its own line and before the next job's.
STAGE = re.compile(r"^  - stage: ([a-z0-9-]+) *$", re.MULTILINE)
JOB = re.compile(r"^      - (?:job|deployment): ([A-Za-z0-9_-]+) *$", re.MULTILINE)
# The image a job declares it runs inside: a `container:` mapping at the job's
# own indentation, and the keys written under it.
JOB_CONTAINER = re.compile(r"^(?P<indent> +)container: *\n(?P<block>(?:(?P=indent)  \S.*\n)+)", re.MULTILINE)
CONTAINER_KEY = re.compile(r"^ +(?P<key>[a-z]+): (?P<value>.+?) *$", re.MULTILINE)
# The variables template holding the tags, included from the pipeline's own
# top-level variables list.
TAGS_INCLUDE = re.compile(
    r"^variables:\n(?:(?:  .*|)\n)*?  - template: " + re.escape(TAGS_TEMPLATE) + r" *$",
    re.MULTILINE,
)
# A track's tag in the tags file.
PINNED_TAG = re.compile(r"^  (?P<track>[a-z]+)ImageTag: (?P<tag>\S+) *$", re.MULTILINE)
# The schema segment every CI image tag opens with, read from the one place it
# is written rather than repeated here: bumping it is meant to be one edit.
IMAGE_SCHEMA = re.compile(r'^readonly IMAGE_SCHEMA="(?P<schema>[^"]+)" *$', re.MULTILINE)
# The paths a pipeline's trigger fires on: the `- <path>` lines of the
# `include:` block under `paths:`, comments and all.
TRIGGER_PATHS = re.compile(r"^  paths:\n    include:\n(?P<block>(?:^ {6}[#-].*\n)+)", re.MULTILINE)


def _named(text: str) -> set[str]:
    """Every gate the text names, by `gate run` or by its script's path."""
    ran = {gate_id for ids in GATE_RUN.findall(text) for gate_id in ids.split()}
    return ran | set(GATE_SCRIPT.findall(text))


def _sections(pattern: re.Pattern[str], text: str) -> dict[str, str]:
    """What each of the pattern's matches names, with the text up to the next one."""
    found = list(pattern.finditer(text))
    ends = [match.start() for match in found[1:]] + [len(text)]
    return {match.group(1): text[match.end() : end] for match, end in zip(found, ends, strict=True)}


def _gates_jobs() -> dict[str, str]:
    """The gates stage's jobs, each with the text of its own steps."""
    stages = _sections(STAGE, PIPELINE.read_text(encoding="utf-8"))
    assert "gates" in stages, f"the pipeline has no gates stage; it has {sorted(stages)}"
    return _sections(JOB, stages["gates"])


def _gates_by_job() -> dict[str, list[str]]:
    """The gates each job of the gates stage runs, in the order it runs them."""
    return {job: sorted(_named(steps)) for job, steps in _gates_jobs().items()}


def _hook_ids() -> list[str]:
    hooks = HOOK_ID.findall(CONFIG.read_text(encoding="utf-8"))
    assert hooks, "no hook has an id, so this test is reading the configuration wrong"
    return hooks


def _misplaced(checks: Iterable[str], by_job: Mapping[str, list[str]]) -> dict[str, list[str]]:
    """What the jobs given do not run exactly once between them.

    Every list is empty when each check has a step in one job and no job runs
    anything else. A check counted twice is either a step in two jobs or two
    steps in one, and neither step's duration is then the cost of that check.
    """
    checks = list(checks)
    ran = Counter(check for steps in by_job.values() for check in steps)
    return {
        "given no step": sorted(check for check in checks if ran[check] == 0),
        "given a step more than once": sorted(check for check in checks if ran[check] > 1),
        "run but not a check": sorted(set(ran) - set(checks)),
    }


def _job_container(job: str) -> dict[str, str]:
    """The keys of the `container:` mapping a job of the gates stage declares."""
    jobs = _gates_jobs()
    assert job in jobs, f"the gates stage has no {job} job; it has {sorted(jobs)}"
    found = JOB_CONTAINER.search(jobs[job])
    if found is None:
        return {}
    return {key.group("key"): key.group("value") for key in CONTAINER_KEY.finditer(found.group("block"))}


def _pinned_tags() -> dict[str, str]:
    """Each track's tag, as the tags file holds it."""
    assert TAGS.is_file(), (
        f"{TAGS_TEMPLATE} is missing, and the pipeline includes it; run `scripts/ci/ci-image.sh tag` to write it"
    )
    return {found.group("track"): found.group("tag") for found in PINNED_TAG.finditer(TAGS.read_text(encoding="utf-8"))}


def _image_schema() -> str:
    """The segment every CI image tag opens with, as ci-image.sh writes it."""
    found = IMAGE_SCHEMA.search(CI_IMAGE_SCRIPT.read_text(encoding="utf-8"))
    assert found, f"{CI_IMAGE_SCRIPT.name} sets no IMAGE_SCHEMA, so this test is reading it wrong"
    return found.group("schema")


def _ci_image(*arguments: str) -> list[str]:
    """What scripts/ci/ci-image.sh prints, as lines, run from the workspace root.

    It needs git, which reads the index for the digest, and it runs
    ci/images/build-args.sh for the pins. A freshly rendered workspace is not a
    checkout yet, and a workspace without git is no workspace this test can say
    anything about, so both are skipped rather than failed.
    """
    if shutil.which("git") is None:
        pytest.skip("git is not on PATH, and an image tag is a digest of what git has staged")
    inside = proc.git(["rev-parse", "--show-toplevel"], cwd=ROOT, quiet=True)
    if inside.returncode != 0:
        pytest.skip("this workspace is not a git checkout yet, so no image tag can be computed for it")
    if not CI_IMAGE_SCRIPT.exists():
        pytest.fail(f"{CI_IMAGE_SCRIPT} is missing, and it is what decides which image a gate track runs in")
    done = subprocess.run(
        [str(CI_IMAGE_SCRIPT), *arguments],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert done.returncode == 0, (
        f"`ci-image.sh {' '.join(arguments)}` exited {done.returncode}, so the pin below cannot be checked "
        f"against anything:\n{done.stderr.strip()}"
    )
    return done.stdout.split()


def _trigger_paths(pipeline: Path) -> list[str]:
    """The paths a pipeline's trigger fires on, in the order it writes them."""
    found = TRIGGER_PATHS.search(pipeline.read_text(encoding="utf-8"))
    assert found, f"{pipeline.name} filters its trigger on no paths, so this test is reading it wrong"
    return [
        line.strip().removeprefix("- ") for line in found.group("block").splitlines() if line.strip().startswith("- ")
    ]


@pytest.mark.parametrize("caller", CALLERS)
def test_a_caller_names_only_gates_that_exist(caller: str) -> None:
    named = _named((ROOT / caller).read_text(encoding="utf-8"))
    assert named, f"{caller} runs no gate, so this test is reading it wrong"
    assert named <= GATE_IDS, f"{caller} names no such gate: {sorted(named - GATE_IDS)}"


def test_every_hook_has_the_id_of_the_gate_it_runs() -> None:
    hooks = re.findall(
        r"- id: ([a-z0-9-]+)\n(?:(?! *- id: ).*\n)*? +entry: uv run --quiet --project ci "
        r"(?:gate run |python ci/gates/)([a-z0-9-]+)",
        CONFIG.read_text(encoding="utf-8"),
    )
    assert hooks, "no hook runs a gate, so this test is reading the configuration wrong"
    assert [hook for hook, gate in hooks if hook != gate] == []


def test_every_gate_but_the_slow_ones_has_a_hook() -> None:
    """A gate with no hook is a check nobody meets before a pipeline run.

    Every gate is cheap enough to run at commit time unless the project
    answered otherwise, so every other one has a hook. A gate added without one
    fails here, which is the moment to decide whether it is genuinely too slow
    for a commit — and if it is, to answer so, in `extra_gates` for a gate of
    the project's or `rust_test_hook` for `rust-test` and `rust-doctest`,
    rather than to drop the hook by hand.
    """
    hooks = set(_hook_ids())
    hookless = GATE_IDS - hooks
    assert hookless == HOOKLESS, (
        f"the gates without a hook in {CONFIG.name} are {sorted(hookless)}, "
        f"and the ones answered too slow for a commit are {sorted(HOOKLESS)}"
    )


def test_a_slow_gate_has_no_hook() -> None:
    """A gate answered too slow for a commit is one a commit does not wait on."""
    hooked = HOOKLESS & set(_hook_ids())
    assert hooked == set(), f"these gates were answered too slow for a commit and have a hook: {sorted(hooked)}"


@pytest.mark.parametrize("gate", sorted(PROJECT_GATES))
def test_a_project_gate_runs_on_the_track_it_was_answered(gate: str) -> None:
    track = PROJECT_GATES[gate]
    running = sorted(job for job, gates in _gates_by_job().items() if gate in gates)
    assert running == [track], f"the {gate} gate runs on {running}, and it was answered the {track} track"


def test_the_gates_stage_runs_its_checks_on_two_tracks() -> None:
    by_job = _gates_by_job()
    assert len(by_job) >= 2, f"the gates stage reads as one job: {sorted(by_job)}"
    running = sorted(job for job, gates in by_job.items() if gates)
    assert running == ["rust", "web"], f"the gates are spread over {running}, not the two tracks"


def test_a_gate_has_a_step_in_exactly_one_job_of_the_gates_stage() -> None:
    assert _misplaced(GATE_IDS, _gates_by_job()) == {
        "given no step": [],
        "given a step more than once": [],
        "run but not a check": [],
    }


def test_a_gate_with_a_step_in_two_jobs_is_caught() -> None:
    misplaced = _misplaced(["cspell", "web-test"], {"rust": ["web-test"], "web": ["cspell", "web-test"]})
    assert misplaced["given a step more than once"] == ["web-test"]
    assert misplaced["given no step"] == []


def test_a_gate_with_a_step_in_no_job_is_caught() -> None:
    misplaced = _misplaced(["cspell", "web-test"], {"rust": [], "web": ["cspell"]})
    assert misplaced["given no step"] == ["web-test"]
    assert misplaced["given a step more than once"] == []


def test_a_step_that_runs_a_gate_that_is_gone_is_caught() -> None:
    misplaced = _misplaced(["cspell"], {"rust": [], "web": ["cspell", "web-test"]})
    assert misplaced["run but not a check"] == ["web-test"]


def test_every_upstream_hook_has_a_step_in_exactly_one_job() -> None:
    """The checks the hook framework brings have no gate script, so they run as hooks.

    They are the file checks and the shell linting at the top of
    `.pre-commit-config.yaml`. Nothing else in the pipeline runs them, so each
    one needs a `pre-commit run` step exactly as much as a gate needs a
    `gate run` one.
    """
    upstream = [hook for hook in _hook_ids() if hook not in GATE_IDS]
    assert upstream, "no hook comes from an upstream repository, so this test is reading the configuration wrong"
    by_job = {job: PRE_COMMIT_RUN.findall(steps) for job, steps in _gates_jobs().items()}
    assert _misplaced(upstream, by_job) == {
        "given no step": [],
        "given a step more than once": [],
        "run but not a check": [],
    }


def test_the_pipeline_runs_every_gate() -> None:
    ran = _named(PIPELINE.read_text(encoding="utf-8"))
    assert ran >= GATE_IDS, f"the pipeline runs these gates nowhere: {sorted(GATE_IDS - ran)}"


def test_the_pipeline_includes_the_tags() -> None:
    """The pipeline reads the tags out of the file the script writes, and names none itself.

    A tag written into the pipeline is a line every workspace edits by hand in a
    file the template renders, so every workspace's pipeline would diverge from
    the template's by design.
    """
    text = PIPELINE.read_text(encoding="utf-8")
    assert TAGS_INCLUDE.search(text), f"{PIPELINE.name} includes no {TAGS_TEMPLATE} in its variables"
    assert re.search(r":v\d+-[0-9a-f]{12}\b", text) is None, (
        f"{PIPELINE.name} writes an image tag itself; the tags belong in {TAGS_TEMPLATE}"
    )


@pytest.mark.parametrize("track", TRACKS)
def test_each_track_runs_in_its_pinned_ci_image(track: str) -> None:
    """Every track declares its image, by the tag the tags file holds for it.

    A track with no `container:` runs on the hosted agent, which carries
    neither toolchain and would fail every check in a way that looks like the
    checks broke. The job names the tag through a compile-time expression, so
    what the agent pulls is exactly what the tags file says.
    """
    container = _job_container(track)
    assert container, f"the {track} job declares no container, so it would run on the bare agent"
    expected = REPOSITORY.format(track=track) + ":${{ variables." + track + "ImageTag }}"
    assert container.get("image") == expected, f"the {track} job runs in {container.get('image')!r}, not {expected!r}"
    assert container.get("endpoint") == ACR_ENDPOINT, (
        f"the {track} job pulls through {container.get('endpoint')!r}, not the {ACR_ENDPOINT!r} service connection"
    )


def test_the_tags_file_pins_every_track_and_nothing_else() -> None:
    """Every track has a tag shaped like one the script prints, and no tag floats.

    A tag that could be moved — `latest`, or anything not shaped like a digest
    — would make the reference a statement about whatever was pushed last
    rather than about this commit, which is the whole property the
    content-addressed tag exists to give.
    """
    pinned = _pinned_tags()
    assert sorted(pinned) == sorted(TRACKS), (
        f"{TAGS_TEMPLATE} pins {sorted(pinned)}, not every track {sorted(TRACKS)}; "
        f"run `scripts/ci/ci-image.sh tag` to write it again"
    )
    schema = _image_schema()
    for track, tag in sorted(pinned.items()):
        assert re.fullmatch(re.escape(schema) + "-[0-9a-f]{12}", tag), (
            f"the {track} image is pinned to {tag!r}, which is not a {schema}-<12 hex> tag "
            f"scripts/ci/ci-image.sh could ever have printed"
        )


@pytest.mark.parametrize("track", TRACKS)
def test_the_pinned_image_tag_is_the_one_this_checkout_builds(track: str) -> None:
    """The tag in the tags file is the tag this checkout's inputs digest to.

    This is the whole update mechanism. The tag is content-addressed, so the
    moment anyone touches a file an image is built from, the pin is a pin at
    the previous image — and a run under it is the quiet failure, not the loud
    one: every gate passes, inside a toolchain this commit no longer describes.
    So this test fails instead, and its message is the instruction. Run the
    script, commit the file, push, and let the image pipeline build the image
    before queueing the gates run.

    A fresh render carries a placeholder, because nothing has been pushed for
    it yet and no tag would be honest. That is reported as a skip naming the
    command that writes the real one.
    """
    pinned = _pinned_tags()
    assert track in pinned, f"{TAGS_TEMPLATE} pins no tag for the {track} track; run `scripts/ci/ci-image.sh tag`"

    if pinned[track] == PLACEHOLDER_TAG:
        pytest.skip(
            f"{TAGS_TEMPLATE} still carries the placeholder tag a render writes for {track}. "
            f"Run `scripts/ci/ci-image.sh tag`, which writes every track's tag into it."
        )

    (built,) = _ci_image("tag", track)
    assert pinned[track] == built, (
        f"the {track} image is pinned to {pinned[track]}, but this checkout builds {built}.\n"
        f"Run `scripts/ci/ci-image.sh tag`, which writes it into {TAGS_TEMPLATE}, and commit that file.\n"
        f"The image has to exist before that run can start: push the branch, let "
        f"{IMAGE_PIPELINE.name} finish, then queue the gates run."
    )


def test_the_image_pipeline_triggers_on_every_file_the_tags_hash() -> None:
    """The trigger fires on every file that can move a tag.

    The two are written in different languages — a shell heredoc and a
    trigger's path filter — and they fail in opposite directions, neither
    loudly. A path that can move a tag but the trigger misses is a pin that
    moves with no image built for it, which is the ordering rule turned into a
    permanent failure: the gates run cannot start and nothing will ever push
    what it wants. A path the trigger fires on that moves no tag is the milder
    half: a build queued that finds its tag already pushed and does nothing.

    A tag digests the input paths and the pins ci/images/build-args.sh reads,
    and it reads those out of the compose file, which is deliberately not an
    input path so that bumping a pin no CI image installs retires no image. A
    pin an image does install moves its tag, so the trigger has to carry that
    file even though no tag digests it directly, and it is the one path where
    the two lists are allowed to differ.
    """
    digested: set[str] = set()
    for track in TRACKS:
        digested |= set(_ci_image("inputs", track))
    expected = sorted(digested | {PINS})
    triggered = _trigger_paths(IMAGE_PIPELINE)
    assert triggered == expected, (
        f"{IMAGE_PIPELINE.name} triggers on {triggered}, which is not the sorted union of "
        f"`ci-image.sh inputs <track>` over every track and {PINS}, {expected}"
    )
