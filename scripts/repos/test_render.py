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
ONE_OF_EACH = {"library": "contracts", "application": "platform", "site": "gg.rocks", "content": "test-suites"}


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
        assert crate.startswith("test-cabinet-")
    assert render.crate_of("platform") == ("cli", "test-cabinet-cli")


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


def test_a_repository_without_a_tag_pins_master() -> None:
    assert render.workspace_dependencies("platform").splitlines() == [
        'test-cabinet-contracts = { git = "https://github.com/TheClockwyrks/contracts", branch = "master" }',
        'test-cabinet-engines = { git = "https://github.com/TheClockwyrks/engines", branch = "master" }',
    ]
    assert render.workspace_dependencies("contracts") == "# contracts depends on no crate of another repository."


def test_a_pipeline_declares_the_closure_of_its_rust_edges() -> None:
    resources = render.ci_resources("web", "application")
    assert re.findall(r"name: (\S+)", resources) == ["the-test-cabinet/contracts", "the-test-cabinet/engines"]
    assert "repositories:" not in render.ci_resources("contracts", "library")


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
    assert not [path for path in files if path.endswith(".jinja") or "{%" in path or "{{" in path]
    assert not [path for path in files if path.startswith(("tasks/", ".codex/"))]
    if shape.crate:
        directory, crate = render.crate_of(name)
        manifest = tomllib.loads((root / "crates" / directory / "Cargo.toml").read_text(encoding="utf-8"))
        assert manifest["package"]["name"] == crate
        assert ("/Cargo.lock" in (root / ".gitignore").read_text(encoding="utf-8")) is not shape.commits_lock


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
