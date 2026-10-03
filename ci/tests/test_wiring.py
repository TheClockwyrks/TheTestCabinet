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
exceptions are the gates a project has found too slow for a commit, which it
names in `HOOKLESS` below when it drops their hooks and which are held to
having none.

The image each track runs inside is read here too. A track names a
purpose-built CI image at the commit whose image pipeline run built it, which
`ci/images/tags.yml`, the variables template the pipeline includes, holds as
its one variable, `ciImageTag`. The pipeline is held to naming every track's
image at that variable and writing no tag of its own, and the file to holding
that one variable as a full commit id, so a pin can name nothing but an image a
run of the project's own image pipeline pushed.

A gate that calls `artifacts_dir()` writes its test tool's JUnit report there
when `CI_GATE_ARTIFACTS` names a directory, and only then. Its step is held to
naming `target/gate-artifacts/<id>`, and the job running it to ending with the
collection of those reports and their publish as the artifact
`test-results-<job>-$(System.JobAttempt)`, both whether the tests passed or
failed, which is what a run's test results are read from.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable, Mapping
from pathlib import Path

import pytest

from the_test_cabinet_ci import runner

ROOT = Path(__file__).resolve().parents[2]
GATE_IDS = {gate.id for gate in runner.discover(runner.gates_dir(ROOT))}

CONFIG = ROOT / ".pre-commit-config.yaml"
PIPELINE = ROOT / "azure-pipelines.yml"
# The commit the CI images were built from, as a variables template the
# pipeline includes. The template renders it with a placeholder, and the
# workspace writes the commit over it.
TAGS = ROOT / "ci" / "images" / "tags.yml"
TAGS_TEMPLATE = TAGS.relative_to(ROOT).as_posix()
CALLERS = [CONFIG.name, PIPELINE.name]

# The gates too slow for a commit: they run in the pipeline and in `make gate`,
# and a commit never waits on them. Each has no hook in
# `.pre-commit-config.yaml`, and a template update carries both edits.
HOOKLESS: set[str] = {
    # Regenerates the contract bindings and schemas from the Rust types, which
    # is a cargo build of the workspace before the comparison starts.
    "contract-drift",
    # rustdoc's harness compiles every crate and each doc example in it.
    "rust-doctest",
    # Compiles every crate's test binary and runs the whole suite.
    "rust-test",
    # Builds every workspace package the gallery imports, then Vite's
    # production build of it.
    "site-build",
    # Builds the workspace packages, then runs tsc over one validator project
    # per engine of every test-case version.
    "validators-typecheck",
    # Builds the workspace packages, then runs every npm workspace's vitest
    # suite.
    "workspace-test",
}

# The service connection the agent pulls a CI image with. One connection holds
# push rights on the registry, so it serves this pipeline's pull and the image
# pipeline's push; a second one would be a second thing to keep in step.
ACR_ENDPOINT = "the-test-cabinet-acr"
# Each track with an image, which is also the id of the job that runs in it.
TRACKS = ["rust", "web"]
# The repository each track's image is pushed to, which ci-image.sh names too.
REPOSITORY = "testcabinet.azurecr.io/ubuntu-the-test-cabinet-{track}-cicd"
# The one variable the tags file holds, and the only way a job names its tag.
TAG_VARIABLE = "ciImageTag"
IMAGE_TAG = "${{ variables." + TAG_VARIABLE + " }}"

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
# A variable of the tags file: a key at the indentation of the `variables:`
# mapping, and the value written after it.
TAGS_VARIABLE = re.compile(r"^  (?P<name>\S+?): *(?P<value>.*?) *$", re.MULTILINE)
# A full commit id, which is the only tag the image pipeline pushes.
COMMIT = re.compile(r"[0-9a-f]{40}")
# A tag written literally after an image repository.
LITERAL_TAG = re.compile(r"-cicd:(?!\$\{\{)\S+")
# A step of a gates job, at the indentation the pipeline writes one at.
STEP = re.compile(r"^          - ", re.MULTILINE)
# The artifact directory a step hands its gate.
ARTIFACTS = re.compile(r"^ +CI_GATE_ARTIFACTS: *(\S+) *$", re.MULTILINE)
# What a gate's script calls to learn where its report goes.
ASKS_FOR_ARTIFACTS = "artifacts_dir("
# Where the pipeline has each test gate leave its report, which is also where
# the collection reads it from and the name of its folder in the artifact.
GATE_ARTIFACTS = "target/gate-artifacts/{gate}"
# The script collecting a job's reports, and the directory it collects them in.
COLLECT = "scripts/ci/collect-test-results.sh"
TEST_RESULTS = "$(Build.SourcesDirectory)/target/test-results"
# The artifact a job's test results are published as.
TEST_RESULTS_ARTIFACT = "test-results-{job}-$(System.JobAttempt)"
# The step's condition keyed by its own line, so a condition is read whole.
CONDITION = re.compile(r"^ +condition: *(.+?) *$", re.MULTILINE)


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


def _steps(job: str) -> list[str]:
    """The text of each step a job's text holds, in order."""
    found = list(STEP.finditer(job))
    ends = [match.start() for match in found[1:]] + [len(job)]
    return [job[match.start() : end] for match, end in zip(found, ends, strict=True)]


def _test_gates() -> set[str]:
    """The gates whose script asks where its test report goes."""
    gates = runner.gates_dir(ROOT)
    return {gate for gate in GATE_IDS if ASKS_FOR_ARTIFACTS in (gates / f"{gate}.py").read_text(encoding="utf-8")}


def _condition(step: str) -> str:
    found = CONDITION.search(step)
    return found.group(1) if found else ""


def _artifacts_problems(gate: str, steps: list[str]) -> list[str]:
    """Every way the steps of a job fail to hand a test gate its artifact directory."""
    running = [step for step in steps if gate in _named(step)]
    if len(running) != 1:
        return [f"{gate} is run by {len(running)} steps of its job, expected one"]
    named = ARTIFACTS.findall(running[0])
    expected = GATE_ARTIFACTS.format(gate=gate)
    if named != [expected]:
        return [f"the {gate} step names CI_GATE_ARTIFACTS {named}, expected [{expected!r}]"]
    return []


def _test_results_problems(job: str, steps: list[str]) -> list[str]:
    """Every way a job running a test gate fails to end by publishing its test results.

    The last two steps collect the reports and publish them as the job's
    `test-results-` artifact, each whether the tests passed or failed.
    """
    if len(steps) < 2:
        return [f"the {job} job has {len(steps)} steps, so it cannot end by publishing its test results"]
    problems: list[str] = []
    collect, publish = steps[-2], steps[-1]
    if COLLECT not in collect:
        problems.append(f"the {job} job's second-to-last step does not run {COLLECT}")
    elif "succeededOrFailed()" not in _condition(collect):
        problems.append(
            f"the {job} job collects its test results under {_condition(collect)!r}, so a failed run collects none"
        )
    artifact = TEST_RESULTS_ARTIFACT.format(job=job)
    if f"- publish: {TEST_RESULTS}\n" not in publish or f"artifact: {artifact}\n" not in publish:
        problems.append(f"the {job} job's last step does not publish {TEST_RESULTS} as {artifact}")
    elif "succeededOrFailed()" not in _condition(publish):
        problems.append(
            f"the {job} job publishes its test results under {_condition(publish)!r}, so a failed run publishes none"
        )
    return problems


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


def _tags_variables() -> dict[str, str]:
    """Each variable the tags file sets, with the value written for it."""
    assert TAGS.is_file(), f"{TAGS_TEMPLATE} is missing, and the pipeline includes it"
    text = TAGS.read_text(encoding="utf-8")
    return {found.group("name"): found.group("value") for found in TAGS_VARIABLE.finditer(text)}


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

    Every gate is cheap enough to run at commit time unless the project named
    it in `HOOKLESS`, so every other one has a hook. A gate added without one
    fails here, which is the moment to decide whether it is genuinely too slow
    for a commit — and if it is, to name it in `HOOKLESS` beside dropping its
    hook.
    """
    hooks = set(_hook_ids())
    hookless = GATE_IDS - hooks
    assert hookless == HOOKLESS, (
        f"the gates without a hook in {CONFIG.name} are {sorted(hookless)}, "
        f"and the ones named too slow for a commit are {sorted(HOOKLESS)}"
    )


def test_a_slow_gate_has_no_hook() -> None:
    """A gate named too slow for a commit is one a commit does not wait on."""
    hooked = HOOKLESS & set(_hook_ids())
    assert hooked == set(), f"these gates are named too slow for a commit and have a hook: {sorted(hooked)}"


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
    """The pipeline reads the commit out of the tags file, and names no tag itself.

    A tag written into the pipeline is a line every workspace edits by hand in a
    file the template renders, so every workspace's pipeline would diverge from
    the template's by design.
    """
    text = PIPELINE.read_text(encoding="utf-8")
    assert TAGS_INCLUDE.search(text), f"{PIPELINE.name} includes no {TAGS_TEMPLATE} in its variables"
    written = LITERAL_TAG.findall(text)
    assert not written, f"{PIPELINE.name} writes the image tags {written} itself; the commit belongs in {TAGS_TEMPLATE}"


@pytest.mark.parametrize("track", TRACKS)
def test_each_track_runs_in_its_pinned_ci_image(track: str) -> None:
    """Every track declares its image, at the commit the tags file pins.

    A track with no `container:` runs on the hosted agent, which carries
    neither toolchain and would fail every check in a way that looks like the
    checks broke. The job names the tag through a compile-time expression, so
    what the agent pulls is exactly what the tags file says.
    """
    container = _job_container(track)
    assert container, f"the {track} job declares no container, so it would run on the bare agent"
    expected = REPOSITORY.format(track=track) + ":" + IMAGE_TAG
    assert container.get("image") == expected, f"the {track} job runs in {container.get('image')!r}, not {expected!r}"
    assert container.get("endpoint") == ACR_ENDPOINT, (
        f"the {track} job pulls through {container.get('endpoint')!r}, not the {ACR_ENDPOINT!r} service connection"
    )


def test_the_tags_file_pins_one_commit() -> None:
    """The tags file holds `ciImageTag` alone, as a full commit id.

    The image pipeline tags every image with the commit its run is on, so a
    full commit id is the only tag that can name one. Anything else — `latest`,
    an abbreviated id, a second variable a job might read instead — would make
    the reference a statement about something other than the run that built
    the image. A render writes forty zeros, which is shaped like a commit and
    names no image, so the pipeline stays valid until the workspace pins one.
    """
    variables = _tags_variables()
    assert sorted(variables) == [TAG_VARIABLE], (
        f"{TAGS_TEMPLATE} sets {sorted(variables)}, and it holds {TAG_VARIABLE} alone"
    )
    pinned = variables[TAG_VARIABLE]
    assert COMMIT.fullmatch(pinned), (
        f"{TAGS_TEMPLATE} pins {TAG_VARIABLE} to {pinned!r}, which is not the forty lowercase hex characters of "
        "the commit an azure-pipelines-ci-images.yml run built the images on"
    )


def test_some_gate_asks_where_its_test_report_goes() -> None:
    assert _test_gates(), f"no gate calls {ASKS_FOR_ARTIFACTS}), so this test is reading the gates wrong"


def test_every_test_gate_step_names_its_artifact_directory() -> None:
    """A test gate writes its JUnit report only where its step names a directory."""
    jobs = _gates_jobs()
    problems = [
        problem
        for gate in sorted(_test_gates())
        for job, steps in jobs.items()
        if gate in _named(steps)
        for problem in _artifacts_problems(gate, _steps(steps))
    ]
    assert problems == []


def test_every_job_running_a_test_gate_publishes_its_test_results() -> None:
    """Each such job ends with its `test-results-<job>-<attempt>` artifact, pass or fail."""
    gates = _test_gates()
    jobs = {job: steps for job, steps in _gates_jobs().items() if gates & _named(steps)}
    assert jobs, "no job runs a test gate, so this test is reading the pipeline wrong"
    problems = [
        problem for job, steps in sorted(jobs.items()) for problem in _test_results_problems(job, _steps(steps))
    ]
    assert problems == []


GATE_STEP = """\
          - script: uv run --quiet --project ci gate run web-test
            condition: eq(variables['checksReady'], 'true')
            env:
              CI_GATE_ARTIFACTS: target/gate-artifacts/web-test
"""
COLLECT_STEP = """\
          - script: scripts/ci/collect-test-results.sh
            condition: and(succeededOrFailed(), eq(variables['checksReady'], 'true'))
"""
PUBLISH_STEP = (
    "          - publish: $(Build.SourcesDirectory)/target/test-results\n"
    "            artifact: test-results-web-$(System.JobAttempt)\n"
    "            condition: and(succeededOrFailed(), eq(variables['checksReady'], 'true'), "
    "eq(variables['testResultsCollected'], 'true'))\n"
)


def test_a_wired_job_passes() -> None:
    steps = _steps(GATE_STEP + COLLECT_STEP + PUBLISH_STEP)
    assert len(steps) == 3
    assert _artifacts_problems("web-test", steps) == []
    assert _test_results_problems("web", steps) == []


def test_a_test_gate_step_naming_no_artifact_directory_is_caught() -> None:
    step = GATE_STEP.replace("            env:\n              CI_GATE_ARTIFACTS: target/gate-artifacts/web-test\n", "")
    assert _artifacts_problems("web-test", _steps(step)) == [
        "the web-test step names CI_GATE_ARTIFACTS [], expected ['target/gate-artifacts/web-test']"
    ]


def test_a_test_gate_step_naming_another_directory_is_caught() -> None:
    step = GATE_STEP.replace("gate-artifacts/web-test", "elsewhere")
    assert _artifacts_problems("web-test", _steps(step)) == [
        "the web-test step names CI_GATE_ARTIFACTS ['target/elsewhere'], expected ['target/gate-artifacts/web-test']"
    ]


def test_a_job_publishing_no_test_results_is_caught() -> None:
    problems = _test_results_problems("web", _steps(GATE_STEP + COLLECT_STEP))
    assert any("does not publish" in problem for problem in problems), problems


def test_a_job_publishing_its_test_results_under_another_name_is_caught() -> None:
    publish = PUBLISH_STEP.replace("test-results-web-", "test-results-")
    problems = _test_results_problems("web", _steps(GATE_STEP + COLLECT_STEP + publish))
    assert problems == [
        f"the web job's last step does not publish {TEST_RESULTS} as test-results-web-$(System.JobAttempt)"
    ]


def test_test_results_published_on_success_alone_are_caught() -> None:
    publish = PUBLISH_STEP.replace("succeededOrFailed(), ", "")
    problems = _test_results_problems("web", _steps(GATE_STEP + COLLECT_STEP + publish))
    assert len(problems) == 1 and "so a failed run publishes none" in problems[0], problems


def test_test_results_collected_on_success_alone_are_caught() -> None:
    collect = COLLECT_STEP.replace("succeededOrFailed(), ", "")
    problems = _test_results_problems("web", _steps(GATE_STEP + collect + PUBLISH_STEP))
    assert len(problems) == 1 and "so a failed run collects none" in problems[0], problems


def test_test_results_published_before_the_job_ends_are_caught() -> None:
    problems = _test_results_problems("web", _steps(COLLECT_STEP + PUBLISH_STEP + GATE_STEP))
    assert problems, "a job whose test results are published before its last gate passed"
