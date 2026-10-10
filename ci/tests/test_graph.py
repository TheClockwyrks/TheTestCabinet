"""The dependency-graph check, against throwaway superrepos judged by this checkout's kit."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from the_test_cabinet_ci import graph

ROOT = Path(__file__).resolve().parents[2]
render = graph.load_render(ROOT)
edges = graph.load_edges(ROOT)
links = graph.load_links(ROOT)
CONTRACTS = "https://github.com/TheClockwyrks/contracts"


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _gitmodules(root: Path, *names: str) -> None:
    _write(
        root / ".gitmodules",
        "".join(f'[submodule "{name}"]\n\tpath = {name}\n\turl = ../{name}\n' for name in names),
    )


def _patch_table(root: Path, active: dict[str, dict[str, str]] | None = None) -> None:
    """A cargo configuration holding every Rust repository's table, commented but for `active`."""
    active = active or {}
    blocks = []
    for repo, kind in edges.REPOSITORIES.items():
        if not edges.KINDS[kind].crate:
            continue
        source = render.public_source(repo)
        if repo in active:
            body = "\n".join(f'{crate} = {{ path = "{path}" }}' for crate, path in active[repo].items())
            blocks.append(f'[patch."{source}"]\n{body}')
        else:
            blocks.append(f'#   [patch."{source}"]')
    _write(root / ".cargo" / "config.toml", "\n\n".join(blocks) + "\n")


def _links(root: Path, workspaces: dict[str, dict[str, str]] | None = None) -> None:
    _write(root / links.TABLE, links.render_table(workspaces or {}))


@pytest.fixture
def superrepo(tmp_path: Path) -> Path:
    """A superrepo holding only cold-storage, as nightly does: every table present, nothing checked out."""
    root = tmp_path / "super"
    shutil.copytree(ROOT / "ci" / "images", root / "ci" / "images")
    _gitmodules(root, "cold-storage")
    _patch_table(root)
    _links(root)
    return root


def _pipeline(name: str, tracks: tuple[str, ...] | None = None, source: Path = ROOT) -> str:
    kind = edges.REPOSITORIES[name]
    tracks = tracks if tracks is not None else render.ci_tracks(name, kind)
    lines = ["resources:", "  containers:"]
    for track in tracks:
        lines += [
            f"    - container: {track}",
            f"      image: {render.image_reference(track, source=source)}",
            "      endpoint: the-test-cabinet-acr",
        ]
    return "\n".join(lines) + "\n"


def _checkout(root: Path, name: str, *, crate: bool = True, package: dict[str, object] | None = None) -> Path:
    """A checked-out repository as the kit renders it: its record, its scaffolded crate and its pipeline."""
    repo = root / name
    kind = edges.REPOSITORIES[name]
    _write(repo / graph.RECORD, f'name = "{name}"\nkind = "{kind}"\ndescription = "x"\n')
    _write(repo / graph.PIPELINE, _pipeline(name))
    if crate and edges.KINDS[kind].crate:
        directory, crate_name = render.crate_of(name)
        _write(repo / "crates" / directory / "Cargo.toml", f'[package]\nname = "{crate_name}"\n')
    if package is not None:
        _write(repo / "package.json", json.dumps(package))
    return repo


def test_this_superrepo_passes() -> None:
    report = graph.check(ROOT)
    assert report.problems == []


def test_a_superrepo_holding_cold_storage_alone_passes_with_a_notice(superrepo: Path) -> None:
    report = graph.check(superrepo, kit=ROOT)
    assert report.problems == []
    assert "cold-storage is a submodule the kit renders nothing into, so it has no edges" in report.notices
    assert report.checked == []


def test_a_submodule_the_table_does_not_name_is_refused(superrepo: Path) -> None:
    _gitmodules(superrepo, "cold-storage", "elsewhere")
    report = graph.check(superrepo, kit=ROOT)
    assert any("the kit's table of repositories names no elsewhere" in problem for problem in report.problems)


def test_a_repository_without_a_patch_table_is_refused(superrepo: Path) -> None:
    config = superrepo / ".cargo" / "config.toml"
    config.write_text(config.read_text(encoding="utf-8").replace(f'#   [patch."{CONTRACTS}"]\n', ""), encoding="utf-8")
    report = graph.check(superrepo, kit=ROOT)
    assert report.problems == [
        (
            f".cargo/config.toml has no [patch] table for {CONTRACTS}, the source of contracts;"
            " run scripts/repos/sources.py patch-table --write"
        )
    ]


def test_a_repository_that_is_not_checked_out_is_skipped(superrepo: Path) -> None:
    _gitmodules(superrepo, "cold-storage", "contracts")
    (superrepo / "contracts").mkdir()
    report = graph.check(superrepo, kit=ROOT)
    assert report.problems == []
    assert "contracts is not checked out; its manifests are judged by its own pipeline" in report.notices


def test_a_checked_out_repository_patched_and_pinned_as_rendered_passes(superrepo: Path) -> None:
    _gitmodules(superrepo, "cold-storage", "contracts")
    _checkout(superrepo, "contracts")
    _patch_table(superrepo, {"contracts": {"test-cabinet-contracts": "contracts/crates/contracts"}})
    report = graph.check(superrepo, kit=ROOT)
    assert report.problems == []
    assert report.checked == ["contracts"]


def _with_contracts_and_a_lock(superrepo: Path) -> None:
    _gitmodules(superrepo, "cold-storage", "contracts")
    _checkout(superrepo, "contracts")
    _patch_table(superrepo, {"contracts": {"test-cabinet-contracts": "contracts/crates/contracts"}})
    _write(superrepo / "Cargo.lock", "version = 4\n")


def test_a_lock_current_against_the_checked_out_crates_passes(superrepo: Path) -> None:
    _with_contracts_and_a_lock(superrepo)
    asked: list[Path] = []
    report = graph.check(superrepo, kit=ROOT, lock=lambda root: asked.append(root) or [])
    assert report.problems == []
    assert asked == [superrepo]


def test_a_lock_stale_against_the_checked_out_crates_is_refused(superrepo: Path) -> None:
    _with_contracts_and_a_lock(superrepo)
    report = graph.check(superrepo, kit=ROOT, lock=lambda root: ["Cargo.lock is stale"])
    assert report.problems == ["Cargo.lock is stale"]


def test_a_superrepo_without_a_lock_is_not_asked_about_one(superrepo: Path) -> None:
    _with_contracts_and_a_lock(superrepo)
    (superrepo / "Cargo.lock").unlink()
    report = graph.check(superrepo, kit=ROOT, lock=lambda root: pytest.fail("the lock was checked"))
    assert report.problems == []


def test_the_lock_check_reads_the_root_lock_and_the_nested_ones(tmp_path: Path) -> None:
    _write(tmp_path / "Cargo.toml", '[package]\nname = "x"\nversion = "0.1.0"\nedition = "2024"\n')
    _write(tmp_path / "src" / "lib.rs", "")
    _write(tmp_path / "Cargo.lock", "version = 4\n")
    if shutil.which("cargo") is None:
        pytest.skip("cargo is not installed here")
    nested = tmp_path / "packages" / "guest"
    _write(nested / "Cargo.toml", '[package]\nname = "guest"\nversion = "0.1.0"\nedition = "2024"\n')
    _write(nested / "src" / "lib.rs", "")
    _write(nested / "Cargo.lock", "version = 4\n")
    stale = "is not current against the checked-out crates; " + graph.LOCK_FIX
    assert graph.lock_problems(tmp_path) == [f"Cargo.lock {stale}", f"packages/guest/Cargo.lock {stale}"]
    for workspace in (tmp_path, nested):
        (workspace / "Cargo.lock").unlink()
        subprocess.run(["cargo", "generate-lockfile", "--offline"], cwd=workspace, check=True, capture_output=True)
    assert graph.lock_problems(tmp_path) == []


def test_a_checked_out_repository_without_its_record_is_refused(superrepo: Path) -> None:
    _gitmodules(superrepo, "contracts")
    _write(superrepo / "contracts" / "README.md", "# contracts\n")
    report = graph.check(superrepo, kit=ROOT)
    assert report.problems == [
        "contracts is checked out but carries no .test-cabinet-repo.toml; render it with scripts/repos/render.py"
    ]


def test_a_record_naming_another_kind_is_refused(superrepo: Path) -> None:
    _gitmodules(superrepo, "contracts")
    repo = _checkout(superrepo, "contracts")
    _write(repo / graph.RECORD, 'name = "contracts"\nkind = "application"\n')
    report = graph.check(superrepo, kit=ROOT)
    assert len(report.problems) == 1
    assert "records 'contracts', a 'application' repository" in report.problems[0]


def test_a_crate_the_table_does_not_patch_is_refused(superrepo: Path) -> None:
    _gitmodules(superrepo, "contracts")
    _checkout(superrepo, "contracts")
    report = graph.check(superrepo, kit=ROOT)
    assert report.problems == [
        (
            f".cargo/config.toml does not patch test-cabinet-contracts of {CONTRACTS};"
            " run scripts/repos/sources.py patch-table --write"
        )
    ]


def test_a_patch_to_a_crate_that_is_not_there_is_refused(superrepo: Path) -> None:
    _gitmodules(superrepo, "contracts")
    _checkout(superrepo, "contracts")
    _patch_table(
        superrepo,
        {"contracts": {"test-cabinet-contracts": "contracts/crates/gone", "test-cabinet-other": "contracts/crates/x"}},
    )
    report = graph.check(superrepo, kit=ROOT)
    assert sorted(report.problems) == [
        ".cargo/config.toml patches test-cabinet-contracts to contracts/crates/gone, which holds no Cargo.toml",
        f".cargo/config.toml patches test-cabinet-other of {CONTRACTS}, which contracts does not declare",
    ]


def test_a_dependency_off_the_edges_is_refused_with_its_path(superrepo: Path) -> None:
    _gitmodules(superrepo, "contracts")
    repo = _checkout(superrepo, "contracts")
    _patch_table(superrepo, {"contracts": {"test-cabinet-contracts": "contracts/crates/contracts"}})
    _write(
        repo / "crates" / "contracts" / "Cargo.toml",
        '[package]\nname = "test-cabinet-contracts"\n[dependencies]\n'
        'e = { package = "test-cabinet-engines", git = "https://github.com/TheClockwyrks/engines" }\n',
    )
    report = graph.check(superrepo, kit=ROOT)
    assert report.problems == [
        (
            "contracts/crates/contracts/Cargo.toml: [dependencies] test-cabinet-engines comes from engines,"
            " whose crates contracts may not name"
        )
    ]


def test_an_image_pinned_at_another_commit_is_refused(superrepo: Path) -> None:
    _gitmodules(superrepo, "contracts")
    repo = _checkout(superrepo, "contracts")
    _patch_table(superrepo, {"contracts": {"test-cabinet-contracts": "contracts/crates/contracts"}})
    pipeline = repo / graph.PIPELINE
    tag = render.ci_image_tag(ROOT)
    pipeline.write_text(pipeline.read_text(encoding="utf-8").replace(tag, "0" * 40), encoding="utf-8")
    report = graph.check(superrepo, kit=ROOT)
    assert len(report.problems) == 2
    assert all("and this checkout names" in problem and "--update contracts" in problem for problem in report.problems)


def test_a_track_the_repository_does_not_run_is_refused(superrepo: Path) -> None:
    _gitmodules(superrepo, "gg.rocks")
    repo = _checkout(superrepo, "gg.rocks")
    _write(repo / graph.PIPELINE, _pipeline("gg.rocks", ("rust", "web")))
    report = graph.check(superrepo, kit=ROOT)
    assert report.problems == [
        (
            "gg.rocks/azure-pipelines.yml pins the rust track, which gg.rocks does not run;"
            " run scripts/repos/render.py --update gg.rocks"
        )
    ]


def test_a_package_the_table_does_not_link_is_refused(superrepo: Path) -> None:
    _gitmodules(superrepo, "contracts")
    repo = _checkout(superrepo, "contracts", package={"name": "contracts", "workspaces": ["packages/*"]})
    _write(repo / "packages" / "run-record" / "package.json", json.dumps({"name": "@clockwyrks/run-record"}))
    _patch_table(superrepo, {"contracts": {"test-cabinet-contracts": "contracts/crates/contracts"}})
    report = graph.check(superrepo, kit=ROOT)
    assert report.problems == [
        (
            ".package-links.json does not link @clockwyrks/run-record, which contracts/packages/run-record produces;"
            " run scripts/repos/link-packages.sh"
        )
    ]
    _links(superrepo, {"contracts": {"@clockwyrks/run-record": "packages/run-record"}})
    assert graph.check(superrepo, kit=ROOT).problems == []


def test_a_link_to_a_repository_not_checked_out_is_noted_and_any_other_stale_one_refused(superrepo: Path) -> None:
    _gitmodules(superrepo, "contracts")
    (superrepo / "contracts").mkdir()
    _links(
        superrepo,
        {"contracts": {"@clockwyrks/run-record": "packages/run-record"}, "web": {"@clockwyrks/ui": "packages/ui"}},
    )
    report = graph.check(superrepo, kit=ROOT)
    assert ".package-links.json links the packages of contracts, which is not checked out" in report.notices
    assert report.problems == [
        (
            ".package-links.json links @clockwyrks/ui to web/packages/ui, a directory that does not exist;"
            " run scripts/repos/link-packages.sh"
        )
    ]


def test_a_missing_link_table_is_refused(superrepo: Path) -> None:
    (superrepo / links.TABLE).unlink()
    report = graph.check(superrepo, kit=ROOT)
    assert report.problems == [".package-links.json is missing; write it with scripts/repos/link-packages.sh"]


def test_the_data_edges_of_a_checked_out_repository_are_noted(superrepo: Path) -> None:
    _gitmodules(superrepo, "test-suites")
    _checkout(superrepo, "test-suites")
    report = graph.check(superrepo, kit=ROOT)
    assert report.problems == []
    noted = [notice for notice in report.notices if notice.startswith("the data edge")]
    assert noted and all("test-suites" in notice for notice in noted)


def test_the_generated_patch_table_is_what_the_check_reads() -> None:
    """The tables `sources.py` writes: active for a registered submodule, commented for a repository that is not one."""
    rust = [repo for repo, kind in edges.REPOSITORIES.items() if edges.KINDS[kind].crate]
    registered = set(graph.submodules(ROOT))
    assert set(graph.patches(ROOT)) == {render.public_source(repo) for repo in rust if repo in registered}
    assert graph.commented_patches(ROOT) == {render.public_source(repo) for repo in rust if repo not in registered}
