"""The repository kit's render: its tables, what each kind is given, and the update's merge."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tomllib
from collections.abc import Callable
from pathlib import Path

import pytest
import yaml

import render
from conftest import commit, git

EDGES = render.edge_table()
KINDS = sorted(EDGES.KINDS)
# One repository of each kind, the one each test renders.
ONE_OF_EACH = {
    "library": "contracts",
    "tool": "tool-sprite",
    "application": "microservice-arena",
    "shell": "client-tauri",
    "site": "gg.rocks",
    "content": "test-suites",
}


def test_one_repository_of_each_kind_is_rendered_here() -> None:
    assert sorted(ONE_OF_EACH) == KINDS
    assert all(render.repositories()[name] == kind for kind, name in ONE_OF_EACH.items())


def test_the_template_asks_for_the_kinds_of_the_edge_table() -> None:
    config = yaml.safe_load(render.COPIER_CONFIG.read_text(encoding="utf-8"))
    assert config["_subdirectory"] == "templates/repository"
    assert config["kind"]["choices"] == "{{ project_kinds }}"
    assert "scripts/repos/context.py:CabinetContext" in config["_jinja_extensions"]
    assert render.kinds() == KINDS


def test_every_repository_carrying_a_crate_names_one() -> None:
    rust = [repo for repo, kind in EDGES.REPOSITORIES.items() if EDGES.KINDS[kind].crate]
    assert sorted(render.CRATES) == sorted(rust)
    for directory, crate in render.CRATES.values():
        assert re.fullmatch(r"[a-z0-9-]+", directory)
        # The publisher's crate kept the binary's name when it was scaffolded.
        assert crate.startswith(("test-cabinet-", "tcab-"))
    assert render.crate_of("microservice-driver") == ("driver", "test-cabinet-driver")


def test_the_rust_tracks_are_images_the_superrepo_builds() -> None:
    for track in {*render.RUST_TRACKS.values(), render.CI_SHARED_RUST_TRACK, render.CI_WEB_TRACK}:
        assert (render.CI_IMAGES / f"{track}.Dockerfile").is_file(), track
    assert set(render.RUST_TRACKS) <= set(render.CRATES)


def test_an_image_is_pinned_at_the_commit_the_superrepo_pins() -> None:
    tag = re.search(r"ciImageTag: ([0-9a-f]{40})", render.CI_IMAGE_TAGS.read_text(encoding="utf-8"))
    assert tag
    assert render.image_reference("web") == f"testcabinet.azurecr.io/ubuntu-the-test-cabinet-web-cicd:{tag.group(1)}"
    with pytest.raises(render.RenderError, match="builds no nowhere CI image"):
        render.image_reference("nowhere")


def test_a_dependency_is_pinned_at_its_tag_or_on_master() -> None:
    """`contracts` and `engines` have cut tags, which their dependents pin.

    `tool-sprite` has none, so its dependents follow its `master`.
    """
    assert render.workspace_dependencies("microservice-arena").splitlines() == [
        'test-cabinet-contracts = { git = "https://github.com/TheClockwyrks/contracts", tag = "v0.2.1" }',
        'test-cabinet-engines = { git = "https://github.com/TheClockwyrks/engines", tag = "v1.1.1" }',
    ]
    assert (
        'test-cabinet-draw = { git = "https://github.com/TheClockwyrks/tool-sprite", branch = "master" }'
        in render.workspace_dependencies("microservice-driver").splitlines()
    )
    assert render.workspace_dependencies("contracts") == "# contracts depends on no crate of another repository."


def test_a_pipeline_declares_the_closure_of_its_rust_edges() -> None:
    resources = render.ci_resources("microservice-arena", "application")
    assert re.findall(r"name: (\S+)", resources) == ["the-test-cabinet/contracts", "the-test-cabinet/engines"]
    assert "repositories:" not in render.ci_resources("contracts", "library")


def test_a_repository_without_edges_says_so_once() -> None:
    alone = render.edges_rule("contracts")
    assert alone.count("no other repository of the project") == 1, alone
    assert alone.startswith("- It depends on no other repository of the project; the")
    arena = " ".join(render.edges_rule("microservice-arena").split())
    assert arena.startswith("- It depends on contracts (crates and packages); engines (")
    assert "and on no other repository of the project; the `dependency-edges` gate" in arena


def test_a_browser_track_carries_an_npm_workspace() -> None:
    """The browser tests drive the workspace's Playwright, so a browser track's repository has a workspace."""
    for name, track in render.RUST_TRACKS.items():
        if track in render.BROWSER_TRACKS:
            assert EDGES.KINDS[EDGES.REPOSITORIES[name]].typescript, name
            assert render.ci_rust_npm(name, EDGES.REPOSITORIES[name])
    assert render.ci_rust_npm("microservice-arena", "application") == ""


def test_the_windows_and_extra_gate_tables_name_repositories_carrying_a_crate() -> None:
    rust = {repo for repo, kind in EDGES.REPOSITORIES.items() if EDGES.KINDS[kind].crate}
    assert rust >= render.WINDOWS_TESTS
    assert set(render.EXTRA_GATES) <= set(EDGES.REPOSITORIES)
    # A gate a kind or track carries has a conditional name, read without its tags.
    kit_gates = {re.sub(r"\{%.*?%\}", "", path.name).split(".")[0] for path in (render.KIT / "ci" / "gates").iterdir()}
    for name in render.EXTRA_GATES:
        jobs = render.extra_gates(name, EDGES.REPOSITORIES[name])
        own = [gate_id for ids in jobs.values() for gate_id in ids]
        assert not set(own) & kit_gates, f"{name} adds a gate the kit already renders"
    assert render.EXTRA_GATES["contracts"] == {"rust": ("contract-drift",)}
    # The content gates the catalog brought with it run beside the kit's prose gates.
    assert render.extra_gates("test-suites", "content") == {
        "checks": ("frozen-paths", "spec-prose", "spec-vocabulary", "audio-packs", "validators-typecheck")
    }
    # gg, an application, takes the kit's `build-context` gate, which holds its
    # Dockerfiles (the `gg-toolchains` image's among them) to its build context.
    assert render.extra_gates("gg", "application") == {}
    assert render.builds_image("application")


def test_an_extra_gate_in_a_job_the_pipeline_lacks_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(render.EXTRA_GATES, "gg.rocks", {"rust": ("site-build",)})
    with pytest.raises(render.RenderError, match="name the job 'rust'"):
        render.variables("gg.rocks", "site", "The site")
    monkeypatch.setitem(render.EXTRA_GATES, "gg.rocks", {"checks": ("Site_Build",)})
    with pytest.raises(render.RenderError, match="not shaped like a gate id"):
        render.variables("gg.rocks", "site", "The site")


def test_the_project_pipeline_table_names_repositories_and_stages() -> None:
    assert set(render.PROJECT_PIPELINE) <= set(EDGES.REPOSITORIES)
    assert render.PROJECT_PIPELINE["gg"] == ("release",)
    for name in render.PROJECT_PIPELINE:
        assert render.project_stages(name)
    assert render.project_stages("microservice-arena") == ()
    assert render.project_parameters("microservice-arena", "application") == {}
    assert render.ci_project_jobs("microservice-arena", "application") == ""
    assert render.ci_project_stages("microservice-arena", "application") == ""
    assert render.ci_project_setup("microservice-arena", "application") == ""
    assert render.ci_project_setup("gg", "application") == f"          - template: {render.PROJECT_SETUP}"
    assert set(render.RUST_TIMEOUTS) <= set(EDGES.REPOSITORIES)
    assert render.rust_timeout("gg") == 120
    assert render.rust_timeout("microservice-arena") == render.RUST_TIMEOUT


def test_the_project_pipeline_is_handed_the_rust_image_the_registry_and_the_arm64_pool() -> None:
    assert render.project_parameters("gg", "application") == {
        "rustImage": render.image_reference("rust"),
        "registry": render.CI_REGISTRY,
        "registryEndpoint": render.CI_IMAGE_ENDPOINT,
        "arm64Pool": render.ARM64_POOL,
    }


def test_the_kits_arm64_pool_is_the_superrepos() -> None:
    jobs = (render.SUPERREPO / ".azure" / "project" / "jobs.yml").read_text(encoding="utf-8")
    pool = re.search(r"^  - name: arm64Pool\n(?:    .*\n)*?    default: (\S+) *$", jobs, re.MULTILINE)
    assert pool, "the superrepo's project jobs declare no arm64Pool default"
    assert pool.group(1) == render.ARM64_POOL


@pytest.mark.parametrize(
    ("stages", "said"),
    [
        (("Release",), "is not shaped like a stage id"),
        (("1release",), "is not shaped like a stage id"),
        (("mirror",), "is one the kit's pipeline declares"),
        (("release", "release"), "names one of its own stages twice"),
        ((), "names none of its stages"),
    ],
)
def test_a_project_stage_the_pipeline_cannot_carry_is_refused(
    monkeypatch: pytest.MonkeyPatch, stages: tuple[str, ...], said: str
) -> None:
    monkeypatch.setitem(render.PROJECT_PIPELINE, "gg", stages)
    with pytest.raises(render.RenderError, match=re.escape(said)):
        render.variables("gg", "application", "x")


def test_the_kits_nextest_is_the_superrepos() -> None:
    pin = re.compile(r'^NEXTEST_VERSION="\$\{NEXTEST_VERSION:-(.+)\}"$', re.MULTILINE)
    kit = pin.search((render.KIT / render.NEXTEST_SCRIPT).read_text(encoding="utf-8"))
    compose = re.search(
        r"^\s*NEXTEST_VERSION:\s*(\S+)\s*$",
        (render.SUPERREPO / ".devcontainer" / "docker-compose.yml").read_text(encoding="utf-8"),
        re.MULTILINE,
    )
    assert kit and compose
    assert kit.group(1) == compose.group(1)
    superrepo = render.SUPERREPO / "scripts" / "ci" / "install-nextest.sh"
    if superrepo.is_file():
        own = pin.search(superrepo.read_text(encoding="utf-8"))
        assert own and own.group(1) == kit.group(1)


def test_a_kind_that_builds_an_image_carries_a_crate() -> None:
    """The image is built from the workspace, fetching its dependencies as the Rust job does."""
    assert {"application"} == render.IMAGE_KINDS
    for kind in render.IMAGE_KINDS:
        assert EDGES.KINDS[kind].crate == "binary", kind
    assert render.ci_image_stage("contracts", "library") == ""


def test_the_image_stage_builds_each_architecture_then_fuses_them() -> None:
    stage = render.ci_image_stage("microservice-arena", "application")
    assert stage.startswith("  - stage: image\n    displayName: Image\n    dependsOn: gates\n")
    branches = "in(variables['Build.SourceBranch'], 'refs/heads/master', 'refs/heads/staging')"
    assert f"    condition: and(succeeded(), {branches})\n" in stage
    jobs = re.findall(r"^      - job: (\S+)$", stage, re.MULTILINE)
    assert jobs == ["image_amd64", "image_arm64", "image_manifest"]
    amd64, arm64, manifest = (_job(stage + "\n", job) for job in jobs)
    assert "          vmImage: ubuntu-24.04\n" in amd64
    assert f"          name: {render.ARM64_POOL}\n" in arm64
    for arch, job in (("amd64", amd64), ("arm64", arm64)):
        assert re.findall(r"^            - (\S+)$", job, re.MULTILINE) == ["contracts", "engines"], arch
        assert "- script: scripts/ci/git-sources.sh\n" in job
        assert f"containerRegistry: {render.CI_IMAGE_ENDPOINT}\n" in job
        assert job.endswith(
            '- script: scripts/ci/image.sh microservice-arena "$(Build.SourceVersion)"\n'
            f"            displayName: Build and push the image ({arch})\n"
        )
    assert ("sudo rm -rf" in amd64, "sudo rm -rf" in arm64) == (True, False)
    assert "        dependsOn:\n          - image_amd64\n          - image_arm64\n" in manifest
    assert '- script: scripts/ci/manifest.sh "$(Build.SourceVersion)" microservice-arena\n' in manifest


def test_the_image_pins_the_kits_rust() -> None:
    toolchain = tomllib.loads((render.KIT / "rust-toolchain.toml").read_text(encoding="utf-8"))
    assert render.rust_channel() == toolchain["toolchain"]["channel"]


def test_an_application_is_rendered_its_image(rendered: Callable[[str], Path]) -> None:
    """The scaffold builds the crate from the Rust the kit pins, and the render passes its own build-context gate."""
    root = rendered("microservice-arena")
    _, crate = render.crate_of("microservice-arena")
    dockerfile = (root / "Dockerfile").read_text(encoding="utf-8")
    assert f"FROM docker.io/library/rust:{render.rust_channel()}-bookworm AS build\n" in dockerfile
    assert f"cargo build --release --locked -p {crate}" in dockerfile
    assert "--mount=type=secret,id=gitconfig,target=/root/.gitconfig,required=false" in dockerfile
    assert f'ENTRYPOINT ["{crate}"]' in dockerfile
    env = {key: value for key, value in os.environ.items() if key not in render.GIT_LOCATING}
    done = subprocess.run(
        ["scripts/ci/build-context.sh"], cwd=root, env=env, capture_output=True, text=True, check=False
    )
    assert done.returncode == 0, done.stdout + done.stderr
    pipeline = (root / "azure-pipelines.yml").read_text(encoding="utf-8")
    assert pipeline.count("gate run build-context\n") == 1
    assert "gate run build-context\n" in _job(pipeline, "checks")
    hooks = (root / ".pre-commit-config.yaml").read_text(encoding="utf-8")
    assert "      - id: build-context\n" in hooks
    assert yaml.safe_load(pipeline)["stages"][1]["stage"] == "image"


@pytest.mark.parametrize(
    ("name", "kind", "description", "said"),
    [
        ("contracts", "application", "x", "contracts is a library repository, not a application one"),
        ("elsewhere", "library", "x", "elsewhere is no repository the kit renders"),
        ("contracts", "engine", "x", "unknown kind 'engine'"),
        ("contracts", "library", 'say "hi"', "no double quote or backslash"),
    ],
)
def test_the_answers_are_refused_when_the_table_disagrees(name: str, kind: str, description: str, said: str) -> None:
    with pytest.raises(render.RenderError, match=re.escape(said)):
        render.variables(name, kind, description)


@pytest.mark.parametrize("kind", KINDS)
def test_each_kind_is_rendered_its_shape(kind: str, rendered: Callable[[str], Path]) -> None:
    name = ONE_OF_EACH[kind]
    root = rendered(name)
    shape = EDGES.KINDS[kind]
    files = {path.relative_to(root).as_posix() for path in root.rglob("*") if ".git" not in path.parts}
    assert {"CLAUDE.md", "README.md", "azure-pipelines.yml", ".copier-answers.yml", render.RECORD} <= files
    assert ".nyxsis/mirrors.toml" in files
    assert ("Cargo.toml" in files) is bool(shape.crate)
    assert ("ci/gates/rust-test.py" in files) is bool(shape.crate)
    assert ("ci/gates/typescript.py" in files) is shape.typescript
    assert (".npmrc" in files) is shape.typescript
    assert ("scripts/resolve-lock.sh" in files) is shape.commits_lock
    image = render.builds_image(kind)
    for path in ("Dockerfile", ".dockerignore", "ci/gates/build-context.py", "scripts/ci/build-context.sh"):
        assert (path in files) is image, path
    for path in ("scripts/ci/image.sh", "scripts/ci/manifest.sh"):
        assert (path in files) is image, path
    pipeline = (root / "azure-pipelines.yml").read_text(encoding="utf-8")
    assert ("  - stage: image\n" in pipeline) is image
    assert not [path for path in files if path.endswith(".jinja") or "{%" in path or "{{" in path]
    assert not [path for path in files if path.startswith(("tasks/", ".codex/"))]
    if shape.crate:
        directory, crate = render.crate_of(name)
        manifest = tomllib.loads((root / "crates" / directory / "Cargo.toml").read_text(encoding="utf-8"))
        assert manifest["package"]["name"] == crate
        assert ("/Cargo.lock" in (root / ".gitignore").read_text(encoding="utf-8")) is not shape.commits_lock


@pytest.mark.parametrize("kind", KINDS)
def test_each_kind_is_rendered_its_npm_workspace(kind: str, rendered: Callable[[str], Path]) -> None:
    """Every kind carries the workspace; a content repository's members are its authoring tools."""
    assert EDGES.KINDS[kind].typescript
    root = rendered(ONE_OF_EACH[kind])
    manifest = json.loads((root / "package.json").read_text(encoding="utf-8"))
    members = ["tools/*"] if kind == "content" else ["packages/*", "apps/*"]
    assert manifest["workspaces"] == members
    assert manifest["private"] is True
    assert {"build", "typecheck", "test"} <= set(manifest["scripts"])
    claude = (root / "CLAUDE.md").read_text(encoding="utf-8")
    dirs = ", ".join(f"`{member.removesuffix('*')}`" for member in members)
    assert f"| {dirs} | The npm workspace's members" in claude
    pipeline = (root / "azure-pipelines.yml").read_text(encoding="utf-8")
    checks = _job(pipeline, "checks")
    assert checks.index(f"- script: {render.NPM_FEED_SCRIPT} ") < checks.index("gate run typescript")


def test_a_kind_without_a_workspace_names_no_members(monkeypatch: pytest.MonkeyPatch) -> None:
    shape = EDGES.KINDS["content"]
    monkeypatch.setattr(render.edge_table(), "KINDS", {**EDGES.KINDS, "content": shape._replace(typescript=False)})
    assert render.npm_workspaces("content") == []
    assert render.typescript_workspace("content") == ""
    assert render.ci_npm_feed("content") == ""


def _job(pipeline: str, job: str) -> str:
    """One job of a rendered pipeline's gates stage, up to the next job or stage."""
    found = re.search(rf"^      - job: {job}\n((?:(?!      - job: |  - stage: ).*\n)*)", pipeline, re.MULTILINE)
    assert found, f"the pipeline has no {job} job"
    return found.group(1)


def test_a_browser_track_installs_its_workspace_and_checks_its_playwright(rendered: Callable[[str], Path]) -> None:
    contracts = (rendered("contracts") / "azure-pipelines.yml").read_text(encoding="utf-8")
    rust = _job(contracts, "rust")
    feed, install = rust.index(f"- script: {render.NPM_FEED_SCRIPT} "), rust.index("- script: npm ci\n")
    assert feed < install < rust.index("gate run")
    assert "gate run playwright-image\n" in rust
    assert (rendered("contracts") / "ci" / "gates" / "playwright-image.py").is_file()
    arena = rendered("microservice-arena")
    assert "- script: npm ci\n" not in _job((arena / "azure-pipelines.yml").read_text(encoding="utf-8"), "rust")
    assert not (arena / "ci" / "gates" / "playwright-image.py").exists()
    assert not (arena / "ci" / "tests" / "test_playwright_image_gate.py").exists()


def test_a_windows_repository_is_rendered_its_windows_job(rendered: Callable[[str], Path]) -> None:
    contracts = (rendered("contracts") / "azure-pipelines.yml").read_text(encoding="utf-8")
    windows = _job(contracts, "windows")
    assert f"vmImage: {render.WINDOWS_IMAGE}\n" in windows
    assert f"- bash: {render.NEXTEST_SCRIPT}\n" in windows
    assert "- bash: cargo nextest run --workspace --no-tests=pass --profile ci\n" in windows
    assert "gate run" not in windows
    arena = (rendered("microservice-arena") / "azure-pipelines.yml").read_text(encoding="utf-8")
    assert "- job: windows" not in arena


def test_an_extra_gate_is_given_a_step_in_its_job(rendered: Callable[[str], Path]) -> None:
    contracts = (rendered("contracts") / "azure-pipelines.yml").read_text(encoding="utf-8")
    rust = _job(contracts, "rust")
    assert rust.count("gate run contract-drift\n") == 1
    assert rust.index("gate run contract-drift\n") < rust.index("- script: scripts/ci/prune-target.sh")
    assert "contract-drift" not in _job(contracts, "checks")
    wiring = (rendered("contracts") / "ci" / "tests" / "test_wiring.py").read_text(encoding="utf-8")
    assert 'REPOSITORY_PIPELINE_ONLY = "playwright-image contract-drift"' in wiring


def test_a_project_pipeline_includes_its_own_jobs_and_stages(rendered: Callable[[str], Path]) -> None:
    pipeline = (rendered("gg") / "azure-pipelines.yml").read_text(encoding="utf-8")
    parameters = "".join(f"{key}: {value}\n" for key, value in render.project_parameters("gg", "application").items())
    jobs = pipeline.index(f"      - template: {render.PROJECT_JOBS}\n        parameters:\n")
    stages = pipeline.index(f"  - template: {render.PROJECT_STAGES}\n    parameters:\n")
    assert pipeline.index("  - stage: gates\n") < jobs < pipeline.index("  - stage: publish\n") < stages
    assert stages < pipeline.index("  - stage: mirror\n")
    assert parameters.replace("\n", "\n          ").strip() in pipeline[jobs:]
    assert parameters.replace("\n", "\n      ").strip() in pipeline[stages:]
    mirror = pipeline[pipeline.index("  - stage: mirror\n") :]
    assert "      - gates\n      - publish\n      - release\n    condition:" in mirror
    assert "in(dependencies.release.result, 'Succeeded', 'Skipped')," in mirror
    setup = pipeline.index(f"          - template: {render.PROJECT_SETUP}\n")
    rust = pipeline.index("      - job: rust\n")
    assert rust < pipeline.index("scripts/ci/git-sources.sh", rust) < setup
    assert setup < pipeline.index("variable=checksReady]true", rust) < pipeline.index("gate run", rust)
    assert setup < pipeline.index("      - job: checks\n")
    assert pipeline.count(render.PROJECT_SETUP) == 1
    assert "        timeoutInMinutes: 120\n" in pipeline[rust : pipeline.index("      - job: checks\n")]
    arena = (rendered("microservice-arena") / "azure-pipelines.yml").read_text(encoding="utf-8")
    assert ".azure/project/" not in arena
    assert "      - job: rust\n        displayName: Rust\n        timeoutInMinutes: 60\n" in arena
    assert "      - gates\n      - publish\n    condition:" in arena


def test_a_project_pipeline_repository_passes_its_own_ci_tests(rendered: Callable[[str], Path]) -> None:
    """The wiring test holds the includes to the stand-in templates its first commit carries."""
    root = rendered("gg")
    env = {key: value for key, value in os.environ.items() if key not in render.GIT_LOCATING}
    env["PYTHONPATH"] = str(root / "ci" / "src")
    done = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-o", "addopts=", "tests/test_wiring.py"],
        cwd=root / "ci",
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert done.returncode == 0, done.stdout[-4000:] + done.stderr[-2000:]
    for command in (["check", "ci"], ["format", "--check", "ci"]):
        linted = subprocess.run(
            [sys.executable, "-m", "ruff", *command], cwd=root, capture_output=True, text=True, check=False
        )
        assert linted.returncode == 0, linted.stdout + linted.stderr


def test_a_crate_is_never_published_and_resolves_as_the_monorepo_does(rendered: Callable[[str], Path]) -> None:
    root = rendered("contracts")
    manifest = tomllib.loads((root / "Cargo.toml").read_text(encoding="utf-8"))
    assert manifest["workspace"]["resolver"] == "3"
    assert manifest["workspace"]["package"]["publish"] is False
    monorepo = tomllib.loads((render.SUPERREPO / "Cargo.toml").read_text(encoding="utf-8"))
    assert manifest["workspace"]["resolver"] == monorepo["workspace"]["resolver"]
    crate = tomllib.loads((root / "crates" / "contracts" / "Cargo.toml").read_text(encoding="utf-8"))
    assert crate["package"]["publish"] == {"workspace": True}


def test_rustdoc_documents_the_private_items(rendered: Callable[[str], Path]) -> None:
    config = tomllib.loads((rendered("contracts") / ".cargo" / "config.toml").read_text(encoding="utf-8"))
    assert config["build"]["rustdocflags"] == ["--document-private-items"]
    superrepo = tomllib.loads((render.SUPERREPO / ".cargo" / "config.toml").read_text(encoding="utf-8"))
    assert "--document-private-items" in superrepo["build"]["rustdocflags"]


@pytest.mark.parametrize("kind", KINDS)
def test_text_checks_out_lf_and_the_media_as_binary(kind: str, rendered: Callable[[str], Path]) -> None:
    """The first rule makes every text file LF on every host, and the binary list follows it to override it."""
    root = rendered(ONE_OF_EACH[kind])
    rules = [
        line.split()[0]
        for line in (root / ".gitattributes").read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    ]
    assert rules[0] == "*"
    for media in ("*.wasm", "*.glb", "*.webm", "*.wav", "*.mp3", "*.ogg", "*.mid", "*.png", "*.woff2"):
        assert media in rules[1:], media
    asked = git(["check-attr", "text", "eol", "binary", "--", "src/lib.rs", "theme.wav", "ball.vox"], root)
    assert asked.splitlines() == [
        "src/lib.rs: text: auto",
        "src/lib.rs: eol: lf",
        "src/lib.rs: binary: unspecified",
        "theme.wav: text: unset",
        "theme.wav: eol: lf",
        "theme.wav: binary: set",
        "ball.vox: text: auto",
        "ball.vox: eol: lf",
        "ball.vox: binary: unspecified",
    ]


@pytest.mark.parametrize("kind", KINDS)
def test_a_render_records_its_answers(kind: str, rendered: Callable[[str], Path], mini_superrepo: Path) -> None:
    name = ONE_OF_EACH[kind]
    root = rendered(name)
    answers = yaml.safe_load((root / ".copier-answers.yml").read_text(encoding="utf-8"))
    assert {key: answers[key] for key in ("name", "kind", "description")} == {
        "name": name,
        "kind": kind,
        "description": f"The {name} repository",
    }
    assert (root / answers["_src_path"]).resolve() == mini_superrepo.resolve()
    assert answers["_commit"] == git(["rev-parse", "--short", "HEAD"], mini_superrepo)
    assert render.read_record(root) == {"name": name, "kind": kind, "description": f"The {name} repository"}
    mirrors = tomllib.loads((root / ".nyxsis" / "mirrors.toml").read_text(encoding="utf-8"))
    assert mirrors == {"mirror": [{"url": render.public_source(name)}]}


@pytest.mark.parametrize("kind", KINDS)
def test_a_rendered_repository_passes_its_own_ci_tests(kind: str, rendered: Callable[[str], Path]) -> None:
    """The kit's own tests, the wiring of the pipeline included, pass in every kind's render."""
    root = rendered(ONE_OF_EACH[kind])
    env = {key: value for key, value in os.environ.items() if key not in render.GIT_LOCATING}
    env["PYTHONPATH"] = str(root / "ci" / "src")
    done = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-o", "addopts=", "tests"],
        cwd=root / "ci",
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert done.returncode == 0, done.stdout[-4000:] + done.stderr[-2000:]


@pytest.mark.parametrize("kind", KINDS)
def test_a_rendered_repositorys_python_satisfies_ruff(kind: str, rendered: Callable[[str], Path]) -> None:
    """A gate written as a template is not Python until it is rendered, so ruff judges the render."""
    root = rendered(ONE_OF_EACH[kind])
    for command in (["check", "ci"], ["format", "--check", "ci"]):
        done = subprocess.run(
            [sys.executable, "-m", "ruff", *command], cwd=root, capture_output=True, text=True, check=False
        )
        assert done.returncode == 0, done.stdout + done.stderr


@pytest.mark.parametrize("kind", KINDS)
def test_a_rendered_repository_passes_its_own_shell_tests(kind: str, rendered: Callable[[str], Path]) -> None:
    """Every table test the render carries passes in it, the ones of a rendered `.jinja` script among them.

    The superrepo's `shell-tests` gate cannot run a test whose script is a
    template until it is rendered, so they are run here, as the rendered
    repository's own `shell-tests` gate runs them, with the hooks' tests too.
    """
    root = rendered(ONE_OF_EACH[kind])
    env = {key: value for key, value in os.environ.items() if key not in render.GIT_LOCATING}
    tests = [
        test
        for directory in ("scripts", "scripts/ci", ".claude/hooks")
        for test in sorted((root / directory).glob("*.test.sh"))
    ]
    assert tests, "the render carries no shell test"
    failed = []
    for test in tests:
        done = subprocess.run([str(test)], cwd=root, env=env, capture_output=True, text=True, check=False)
        if done.returncode != 0:
            failed.append(f"{test.relative_to(root)}:\n{done.stdout[-2000:]}{done.stderr[-1000:]}")
    assert failed == []


def test_a_render_refuses_a_directory_that_is_not_empty(tmp_path: Path, mini_superrepo: Path) -> None:
    (tmp_path / "contracts").mkdir()
    (tmp_path / "contracts" / "stray").write_text("x", encoding="utf-8")
    with pytest.raises(render.RenderError, match="is not empty"):
        render.render(tmp_path / "contracts", "contracts", "library", "x", source=mini_superrepo)


def test_a_render_leaves_the_process_environment_as_it_found_it(tmp_path: Path, mini_superrepo: Path) -> None:
    before = dict(os.environ)
    render.render(tmp_path / "gg.rocks", "gg.rocks", "site", "The site", source=mini_superrepo)
    assert dict(os.environ) == before


def test_an_update_merges_a_kit_change_and_keeps_the_repositorys_own(tmp_path: Path, own_superrepo: Path) -> None:
    root = tmp_path / "contracts"
    render.render(root, "contracts", "library", "The contracts", source=own_superrepo)
    git(["init", "--quiet", "--initial-branch=master"], root)
    readme = root / "README.md"
    readme.write_text(readme.read_text(encoding="utf-8") + "\nA line the repository wrote.\n", encoding="utf-8")
    commit(root, "chore: scaffold")

    template = own_superrepo / "templates" / "repository" / "README.md.jinja"
    text = template.read_text(encoding="utf-8").replace(
        "One command runs every gate:", "Every gate runs from one command:"
    )
    template.write_text(text, encoding="utf-8")
    commit(own_superrepo, "change the kit")

    outcome = render.update(root, source=own_superrepo)
    assert outcome.conflicts == []
    merged = readme.read_text(encoding="utf-8")
    assert "Every gate runs from one command:" in merged
    assert "A line the repository wrote." in merged
    answers = yaml.safe_load((root / ".copier-answers.yml").read_text(encoding="utf-8"))
    assert answers["_commit"] == git(["rev-parse", "--short", "HEAD"], own_superrepo)


def test_an_update_leaves_an_applications_dockerfile_to_it(tmp_path: Path, own_superrepo: Path) -> None:
    """The Dockerfile is a scaffold the repository grows, so an update of the kit never merges into it."""
    root = tmp_path / "microservice-arena"
    render.render(root, "microservice-arena", "application", "The arena", source=own_superrepo)
    git(["init", "--quiet", "--initial-branch=master"], root)
    (root / "Dockerfile").write_text("FROM scratch\n", encoding="utf-8")
    commit(root, "chore: scaffold")

    template = own_superrepo / "templates" / "repository" / "{% if ci_image %}Dockerfile{% endif %}.jinja"
    template.write_text(template.read_text(encoding="utf-8") + "# A line the kit added.\n", encoding="utf-8")
    commit(own_superrepo, "change the kit's Dockerfile")

    outcome = render.update(root, source=own_superrepo)
    assert outcome.conflicts == []
    assert (root / "Dockerfile").read_text(encoding="utf-8") == "FROM scratch\n"


def test_an_update_refuses_uncommitted_changes(tmp_path: Path, own_superrepo: Path) -> None:
    root = tmp_path / "gg.rocks"
    render.render(root, "gg.rocks", "site", "The site", source=own_superrepo)
    git(["init", "--quiet", "--initial-branch=master"], root)
    commit(root, "chore: scaffold")
    (root / "README.md").write_text("changed\n", encoding="utf-8")
    with pytest.raises(render.RenderError, match="uncommitted changes"):
        render.update(root, source=own_superrepo)


def test_the_command_line_renders_and_reports(tmp_path: Path, mini_superrepo: Path, capsys) -> None:
    into = tmp_path / "out" / "test-suites"
    status = render.main(
        ["test-suites", "--description", "The suites", "--into", str(into), "--source", str(mini_superrepo)]
    )
    assert status == 0
    assert "rendered test-suites (content)" in capsys.readouterr().out
    assert json.loads((into / "package.json").read_text(encoding="utf-8"))["name"] == "test-suites-repository"
    assert render.main(["nowhere", "--description", "x", "--source", str(mini_superrepo)]) == 1
