"""The `typescript` gate, run against a stand-in workspace and a stub npm.

The stub records every call it gets, with its working directory and the
artifacts directory it was handed, and does what the test tells it to through
its environment: fail a script, write the reports, or leave a build output
behind. An install given package directories writes a symlink to each into
`node_modules`, as npm does with `--install-links=false`. No test installs a
package or reaches a registry.

The linked cases stand the checkout inside a throwaway superrepo: the test's
temporary directory holds the link table and a producer workspace beside the
checkout, as the superrepo holds each repository beside its siblings.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from the_test_cabinet_ci import proc

GATE = Path(__file__).resolve().parents[1] / "gates" / "typescript.py"
FEED = re.search(r'^FEED_REGISTRY = "(.+)"$', GATE.read_text(encoding="utf-8"), re.MULTILINE)
SCRIPTS = {"build": "tsc -b", "typecheck": "tsc -b --noEmit", "test": "vitest run"}

STUB = """\
#!/bin/sh
# Records the call, then does what the test asked for.
echo "$(basename "$PWD") $* artifacts=${CI_GATE_ARTIFACTS-unset}" >> "$STUB_LOG"
script="$2"
if [ "$1" = run ] && [ "$script" = "${STUB_FAIL-}" ]; then exit 1; fi
if [ "$1" = ci ] && [ "$2" = --dry-run ]; then
  if [ "${STUB_FAIL-}" = dry-run ]; then exit 1; fi
  exit 0
fi
if [ "$1" = ci ] && [ "${STUB_FAIL-}" = ci ]; then exit 1; fi
if [ "$1" = ci ] || [ "$1" = install ]; then mkdir -p node_modules; fi
if [ "$1" = install ] && [ -z "${STUB_NO_LINK-}" ]; then
  for argument in "$@"; do
    case "$argument" in
    /*)
      name="$(sed -n 's/.*"name": *"\\([^"]*\\)".*/\\1/p' "$argument/package.json" | head -n 1)"
      mkdir -p "node_modules/$(dirname "$name")"
      ln -s "$argument" "node_modules/$name"
      ;;
    esac
  done
fi
if [ "$1" = run ] && [ "$script" = build ] && [ -n "${STUB_BUILD_OUTPUT-}" ]; then
  mkdir -p "$(dirname "$STUB_BUILD_OUTPUT")" && echo built > "$STUB_BUILD_OUTPUT"
fi
if [ "$1" = run ] && [ "$script" = test ] && [ -n "${STUB_WRITE_REPORTS-}" ]; then
  echo '<testsuites/>' > "$CI_GATE_ARTIFACTS/junit.xml"
  echo '{"total": {}}' > "$CI_GATE_ARTIFACTS/coverage-summary.json"
fi
exit 0
"""


@pytest.fixture
def repo(checkout: Path) -> Path:
    """A checkout with the gate in it and a committed workspace at its root, holding one package."""
    shutil.copy(GATE, checkout / "ci" / "gates" / GATE.name)
    _manifest(checkout, SCRIPTS)
    _package(checkout / "packages" / "app", "@clockwyrks/app")
    (checkout / "package-lock.json").write_text("{}\n", encoding="utf-8")
    (checkout / ".gitignore").write_text("dist/\nnode_modules/\n", encoding="utf-8")
    for args in (
        ["config", "user.email", "gate@example.invalid"],
        ["config", "user.name", "Gate"],
        ["add", "."],
        ["commit", "--quiet", "-m", "the workspace"],
    ):
        assert proc.git(args, cwd=checkout).returncode == 0
    return checkout


def _manifest(root: Path, scripts: dict[str, str]) -> None:
    manifest = {"name": "workspace", "private": True, "workspaces": ["packages/*", "apps/*"], "scripts": scripts}
    (root / "package.json").write_text(json.dumps(manifest) + "\n", encoding="utf-8")


def _run(root: Path, tmp_path: Path, **env: str) -> tuple[subprocess.CompletedProcess[str], list[str]]:
    """Run the gate from `root` with the stub npm first on PATH; return it and the stub's calls."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    npm = bin_dir / "npm"
    npm.write_text(textwrap.dedent(STUB), encoding="utf-8")
    npm.chmod(0o755)
    log = tmp_path / "npm.log"
    log.unlink(missing_ok=True)
    environment = {name: value for name, value in os.environ.items() if name != "CI_GATE_ARTIFACTS"}
    environment.update({"PATH": f"{bin_dir}{os.pathsep}{environment.get('PATH', '')}", "STUB_LOG": str(log)})
    environment.update(env)
    done = subprocess.run(
        [sys.executable, str(root / "ci" / "gates" / GATE.name)],
        cwd=root,
        env=environment,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        check=False,
    )
    calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return done, calls


def test_a_repository_without_the_workspace_passes_with_a_notice(checkout: Path, tmp_path: Path) -> None:
    shutil.copy(GATE, checkout / "ci" / "gates" / GATE.name)
    done, calls = _run(checkout, tmp_path)
    assert done.returncode == 0, done.stderr
    assert "No TypeScript package yet" in done.stdout
    assert calls == []


def test_a_workspace_with_no_package_yet_passes_with_a_notice(checkout: Path, tmp_path: Path) -> None:
    shutil.copy(GATE, checkout / "ci" / "gates" / GATE.name)
    _manifest(checkout, SCRIPTS)
    done, calls = _run(checkout, tmp_path)
    assert done.returncode == 0, done.stderr
    assert "No TypeScript package yet" in done.stdout
    assert calls == []


def test_the_workspace_is_installed_from_its_lock_then_built_checked_and_tested(repo: Path, tmp_path: Path) -> None:
    done, calls = _run(repo, tmp_path)
    assert done.returncode == 0, done.stderr
    assert calls == [
        "checkout ci --no-audit --no-fund artifacts=unset",
        "checkout run build artifacts=unset",
        "checkout run typecheck artifacts=unset",
        "checkout run test artifacts=unset",
    ]


def _member(repo: Path, directory: str, manifest: dict[str, object]) -> None:
    (repo / "packages" / directory).mkdir(parents=True, exist_ok=True)
    (repo / "packages" / directory / "package.json").write_text(json.dumps(manifest) + "\n", encoding="utf-8")


def test_the_gate_knows_the_feed() -> None:
    assert FEED and FEED.group(1).startswith("https://") and FEED.group(1).endswith("/")


@pytest.mark.parametrize(
    ("config", "said"),
    [
        (None, "names no registry under publishConfig"),
        ({"access": "restricted"}, "names no registry under publishConfig"),
        ({"registry": "https://registry.npmjs.org/"}, "names https://registry.npmjs.org/ under publishConfig"),
    ],
)
def test_a_public_package_not_naming_the_feed_is_refused_before_anything_runs(
    repo: Path, tmp_path: Path, config: dict[str, str] | None, said: str
) -> None:
    assert FEED
    manifest: dict[str, object] = {"name": "@clockwyrks/model", "version": "1.0.0"}
    if config is not None:
        manifest["publishConfig"] = config
    _member(repo, "model", manifest)
    _member(repo, "views", {"name": "@clockwyrks/views", "publishConfig": {"registry": FEED.group(1)}})
    _member(repo, "internal", {"name": "@clockwyrks/internal", "private": True})
    done, calls = _run(repo, tmp_path)
    assert done.returncode == 1
    assert f"@clockwyrks/model (packages/model/package.json) {said}" in done.stderr
    assert "@clockwyrks/views" not in done.stderr
    assert "@clockwyrks/internal" not in done.stderr
    assert f'"publishConfig": {{"registry": "{FEED.group(1)}"}}' in done.stderr
    assert calls == []


@pytest.mark.parametrize("registry", ["feed", "feed without its final slash"])
def test_a_public_package_naming_the_feed_and_a_private_one_naming_none_pass(
    repo: Path, tmp_path: Path, registry: str
) -> None:
    assert FEED
    named = FEED.group(1) if registry == "feed" else FEED.group(1).rstrip("/")
    _member(repo, "model", {"name": "@clockwyrks/model", "publishConfig": {"registry": named}})
    _member(repo, "internal", {"name": "@clockwyrks/internal", "private": True})
    _commit(repo, "the packages")
    done, _ = _run(repo, tmp_path)
    assert done.returncode == 0, done.stdout + done.stderr


def test_a_workspace_without_its_lock_is_refused(repo: Path, tmp_path: Path) -> None:
    (repo / "package-lock.json").unlink()
    done, calls = _run(repo, tmp_path)
    assert done.returncode == 1
    assert "package-lock.json is missing" in done.stderr
    assert calls == []


def test_a_manifest_missing_a_script_is_refused_before_anything_runs(repo: Path, tmp_path: Path) -> None:
    _manifest(repo, {"build": "tsc -b"})
    done, calls = _run(repo, tmp_path)
    assert done.returncode == 1
    assert "declares no 'typecheck', 'test' script" in done.stderr
    assert calls == []


@pytest.mark.parametrize("failing", ["ci", "build", "typecheck", "test"])
def test_a_failing_step_fails_the_gate_and_stops_it(repo: Path, tmp_path: Path, failing: str) -> None:
    done, calls = _run(repo, tmp_path, STUB_FAIL=failing)
    assert done.returncode == 1
    order = ["ci", "build", "typecheck", "test"]
    assert [call.split()[1] if call.split()[1] == "ci" else call.split()[2] for call in calls] == order[
        : order.index(failing) + 1
    ]


def test_the_tests_alone_are_handed_the_artifacts_directory(repo: Path, tmp_path: Path) -> None:
    artifacts = tmp_path / "artifacts"
    done, calls = _run(repo, tmp_path, CI_GATE_ARTIFACTS=str(artifacts), STUB_WRITE_REPORTS="1")
    assert done.returncode == 0, done.stderr
    assert calls[-1] == f"checkout run test artifacts={artifacts.resolve()}"
    assert all(call.endswith("artifacts=unset") for call in calls[:-1])
    assert (artifacts / "junit.xml").is_file()
    assert (artifacts / "coverage-summary.json").is_file()


def test_a_test_run_that_writes_no_reports_fails_when_they_were_asked_for(repo: Path, tmp_path: Path) -> None:
    artifacts = tmp_path / "artifacts"
    done, _ = _run(repo, tmp_path, CI_GATE_ARTIFACTS=str(artifacts))
    assert done.returncode == 1
    assert "did not write junit.xml, coverage-summary.json" in done.stderr


def test_reports_an_earlier_run_left_are_not_this_runs(repo: Path, tmp_path: Path) -> None:
    artifacts = tmp_path / "artifacts"
    artifacts.mkdir()
    for name in ("junit.xml", "coverage-summary.json"):
        (artifacts / name).write_text("stale", encoding="utf-8")
        os.utime(artifacts / name, (0, 0))
    done, _ = _run(repo, tmp_path, CI_GATE_ARTIFACTS=str(artifacts))
    assert done.returncode == 1
    assert "did not write junit.xml, coverage-summary.json" in done.stderr


def test_a_build_output_git_would_offer_to_commit_fails_the_gate(repo: Path, tmp_path: Path) -> None:
    done, _ = _run(repo, tmp_path, STUB_BUILD_OUTPUT="packages/view/lib/index.js")
    assert done.returncode == 1
    assert "?? packages/view/lib/index.js" in done.stderr


def test_an_ignored_build_output_passes(repo: Path, tmp_path: Path) -> None:
    done, _ = _run(repo, tmp_path, STUB_BUILD_OUTPUT="packages/view/dist/index.js")
    assert done.returncode == 0, done.stderr


def test_a_build_that_rewrites_a_tracked_file_fails_the_gate(repo: Path, tmp_path: Path) -> None:
    done, _ = _run(repo, tmp_path, STUB_BUILD_OUTPUT="package-lock.json")
    assert done.returncode == 1
    assert " M package-lock.json" in done.stderr


# --- Inside the superrepo ------------------------------------------------------

MODEL = "@clockwyrks/run-record"
PRODUCER = "contracts"


def _package(directory: Path, name: str, names: tuple[str, ...] = ()) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    manifest = {"name": name, "version": "1.0.0", "private": True, "dependencies": dict.fromkeys(names, "1.0.0")}
    (directory / "package.json").write_text(json.dumps(manifest) + "\n", encoding="utf-8")


@pytest.fixture
def superrepo(repo: Path, tmp_path: Path) -> Path:
    """The checkout inside a superrepo whose contracts workspace produces run-record, which the checkout names."""
    root = tmp_path
    producer = root / PRODUCER
    producer.mkdir(parents=True)
    workspace = {"name": "contracts", "private": True, "workspaces": ["packages/*"], "scripts": SCRIPTS}
    (producer / "package.json").write_text(json.dumps(workspace) + "\n", encoding="utf-8")
    _package(producer / "packages" / "model", MODEL)
    table = {"$comment": "a test's", "workspaces": {PRODUCER: {MODEL: "packages/model"}}}
    (root / ".package-links.json").write_text(json.dumps(table) + "\n", encoding="utf-8")
    _package(repo / "packages" / "app", "@clockwyrks/app", names=(MODEL, "react"))
    _commit(repo, "the app")
    return root


def _commit(repo: Path, message: str) -> None:
    for args in (["add", "."], ["commit", "--quiet", "-m", message]):
        assert proc.git(args, cwd=repo).returncode == 0


def _model(root: Path) -> str:
    return str((root / PRODUCER / "packages" / "model").resolve())


def test_inside_the_superrepo_the_producer_is_built_and_the_workspace_installed_with_its_link(
    repo: Path, superrepo: Path, tmp_path: Path
) -> None:
    done, calls = _run(repo, tmp_path)
    assert done.returncode == 0, done.stdout + done.stderr
    assert calls == [
        "contracts ci --no-audit --no-fund artifacts=unset",
        "contracts run build artifacts=unset",
        "checkout ci --dry-run --no-audit --no-fund artifacts=unset",
        (f"checkout install --no-save --install-links=false --no-audit --no-fund {_model(superrepo)} artifacts=unset"),
        "checkout run build artifacts=unset",
        "checkout run typecheck artifacts=unset",
        "checkout run test artifacts=unset",
    ]
    assert f"{MODEL} from {PRODUCER}/packages/model" in done.stdout
    entry = repo / "node_modules" / MODEL
    assert entry.is_symlink() and entry.resolve() == Path(_model(superrepo))


def test_an_installed_producer_is_built_without_installing_it_again(
    repo: Path, superrepo: Path, tmp_path: Path
) -> None:
    (superrepo / PRODUCER / "node_modules").mkdir()
    done, calls = _run(repo, tmp_path)
    assert done.returncode == 0, done.stdout + done.stderr
    assert [call for call in calls if call.startswith("contracts ")] == ["contracts run build artifacts=unset"]


def test_a_workspace_naming_the_package_only_in_its_lock_is_linked(repo: Path, superrepo: Path, tmp_path: Path) -> None:
    _package(repo / "packages" / "app", "@clockwyrks/app", names=("react",))
    lock = {"packages": {f"node_modules/{MODEL}": {"version": "1.0.0"}}}
    (repo / "package-lock.json").write_text(json.dumps(lock) + "\n", encoding="utf-8")
    _commit(repo, "the lock names the model")
    done, calls = _run(repo, tmp_path)
    assert done.returncode == 0, done.stdout + done.stderr
    assert any(call.startswith("checkout install --no-save") for call in calls)


def test_a_workspace_naming_no_linked_package_installs_from_its_lock_inside_the_superrepo(
    repo: Path, superrepo: Path, tmp_path: Path
) -> None:
    _package(repo / "packages" / "app", "@clockwyrks/app", names=("react",))
    _commit(repo, "the app names no sibling")
    done, calls = _run(repo, tmp_path)
    assert done.returncode == 0, done.stdout + done.stderr
    assert calls[0] == "checkout ci --no-audit --no-fund artifacts=unset"
    assert not [call for call in calls if call.startswith("contracts ")]


def test_a_producer_that_is_not_checked_out_is_installed_from_the_feed(
    repo: Path, superrepo: Path, tmp_path: Path
) -> None:
    shutil.rmtree(superrepo / PRODUCER)
    done, calls = _run(repo, tmp_path)
    assert done.returncode == 0, done.stdout + done.stderr
    assert calls[0] == "checkout ci --no-audit --no-fund artifacts=unset"


def test_the_workspace_never_links_a_package_it_produces(repo: Path, superrepo: Path, tmp_path: Path) -> None:
    table = {"workspaces": {PRODUCER: {MODEL: "packages/model"}, "checkout": {"@clockwyrks/app": "packages/app"}}}
    (superrepo / ".package-links.json").write_text(json.dumps(table) + "\n", encoding="utf-8")
    _package(repo / "packages" / "app", "@clockwyrks/app", names=("@clockwyrks/app", MODEL))
    _commit(repo, "the app names itself")
    done, calls = _run(repo, tmp_path)
    assert done.returncode == 0, done.stdout + done.stderr
    install = next(call for call in calls if " install " in call)
    assert install.split()[-2] == _model(superrepo)


def test_a_lock_that_disagrees_with_the_manifests_fails_before_the_install(
    repo: Path, superrepo: Path, tmp_path: Path
) -> None:
    done, calls = _run(repo, tmp_path, STUB_FAIL="dry-run")
    assert done.returncode == 1
    assert "did not install with its links" in done.stderr
    assert not [call for call in calls if " install " in call]
    assert not [call for call in calls if call.startswith("checkout run")]


def test_a_producer_that_does_not_build_fails_the_gate(repo: Path, superrepo: Path, tmp_path: Path) -> None:
    done, calls = _run(repo, tmp_path, STUB_FAIL="build")
    assert done.returncode == 1
    assert f"{PRODUCER}, whose packages this workspace links, did not build." in done.stderr
    assert not [call for call in calls if call.startswith("checkout ")]


def test_an_install_that_leaves_a_package_unlinked_fails_the_gate(repo: Path, superrepo: Path, tmp_path: Path) -> None:
    done, calls = _run(repo, tmp_path, STUB_NO_LINK="1")
    assert done.returncode == 1
    assert f"{MODEL} (expected a symlink to {PRODUCER}/packages/model)" in done.stderr
    assert not [call for call in calls if call.startswith("checkout run")]


def test_a_table_of_another_shape_fails_the_gate(repo: Path, superrepo: Path, tmp_path: Path) -> None:
    (superrepo / ".package-links.json").write_text("[]\n", encoding="utf-8")
    done, calls = _run(repo, tmp_path)
    assert done.returncode == 1
    assert 'holds no "workspaces" object' in done.stderr
    assert calls == []


def test_the_manifests_and_the_lock_stay_as_committed(repo: Path, superrepo: Path, tmp_path: Path) -> None:
    done, _ = _run(repo, tmp_path)
    assert done.returncode == 0, done.stdout + done.stderr
    assert proc.git(["status", "--porcelain"], cwd=repo).stdout == ""
