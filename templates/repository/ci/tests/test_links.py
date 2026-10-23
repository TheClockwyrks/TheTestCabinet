"""The package links: the table, which workspace links what, and in which order they are built."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from the_test_cabinet_ci import links

MODEL = "@clockwyrks/run-record"
VIEWS = "@clockwyrks/asset-contract"
UI = "@clockwyrks/voxel-runtime"


def _write(path: Path, body: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(body), encoding="utf-8")


def _workspace(
    root: Path,
    workspace: str,
    produces: dict[str, str],
    names: tuple[str, ...] = (),
    lock: tuple[str, ...] = (),
) -> Path:
    """A workspace whose members produce `produces`, each naming `names`, with `lock` entries in its lock."""
    directory = root / workspace
    _write(directory / "package.json", {"name": "workspace", "private": True, "workspaces": ["packages/*"]})
    for package, member in produces.items():
        _write(directory / member / "package.json", {"name": package, "dependencies": dict.fromkeys(names, "1.0.0")})
    if lock:
        _write(directory / "package-lock.json", {"packages": {entry: {"version": "1.0.0"} for entry in lock}})
    return directory


@pytest.fixture
def superrepo(tmp_path: Path) -> Path:
    """contracts producing the model and views, web linking the model and producing the UI."""
    root = tmp_path / "super"
    _workspace(root, "contracts", {MODEL: "packages/model", VIEWS: "packages/views"})
    _workspace(root, "engines", {UI: "packages/ui"}, names=(MODEL, "react"))
    _workspace(root, "web", {"@clockwyrks/ui": "packages/desktop"}, names=(UI,))
    return root


def _table(root: Path) -> links.Table:
    return links.produced(root, ["contracts", "engines", "web"])


def test_the_members_are_read_from_the_workspaces_the_manifest_names(tmp_path: Path) -> None:
    directory = _workspace(tmp_path, "w", {MODEL: "packages/model"})
    _write(directory / "package.json", {"workspaces": {"packages": ["packages/model", "missing/*"]}})
    _write(directory / "stray" / "package.json", {"name": "@clockwyrks/stray"})
    assert links.members(directory) == {MODEL: "packages/model"}


def test_a_workspace_names_its_manifests_dependencies_and_every_lock_entry(tmp_path: Path) -> None:
    directory = _workspace(
        tmp_path,
        "w",
        {UI: "packages/ui"},
        names=(MODEL,),
        lock=("", "packages/ui", "node_modules/react", f"node_modules/react-dom/node_modules/{VIEWS}"),
    )
    assert links.named(directory) == {MODEL, "react", VIEWS}


def test_the_table_is_what_each_workspace_produces(superrepo: Path) -> None:
    assert _table(superrepo) == {
        "contracts": {MODEL: "packages/model", VIEWS: "packages/views"},
        "engines": {UI: "packages/ui"},
        "web": {"@clockwyrks/ui": "packages/desktop"},
    }
    assert links.produced(superrepo, ["absent"]) == {}


def test_the_table_round_trips_through_its_file(superrepo: Path) -> None:
    text = links.render_table(_table(superrepo))
    assert links.parse_table(text) == _table(superrepo)
    (superrepo / links.TABLE).write_text(text, encoding="utf-8")
    assert links.load_table(superrepo) == _table(superrepo)


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("not json", "is not JSON"),
        ("[]", 'holds no "workspaces" object'),
        ('{"workspaces": {"w": ["x"]}}', "w does not map each package to a directory"),
    ],
)
def test_a_table_of_another_shape_is_refused(text: str, message: str) -> None:
    with pytest.raises(links.LinkTableError, match=message):
        links.parse_table(text)


def test_a_superrepo_without_a_table_has_no_links(tmp_path: Path) -> None:
    assert links.load_table(tmp_path) == {}


def test_the_superrepo_is_the_nearest_directory_above_the_repository_holding_the_table(superrepo: Path) -> None:
    repository = superrepo / "engines"
    assert links.find_superrepo(repository) is None
    (superrepo / links.TABLE).write_text(links.render_table({}), encoding="utf-8")
    (repository / links.TABLE).write_text(links.render_table({}), encoding="utf-8")
    assert links.find_superrepo(repository) == superrepo.resolve()


def test_a_repository_outside_every_superrepo_has_no_surrounding_table(tmp_path: Path) -> None:
    assert links.surrounding(tmp_path / "alone") == (None, {})


def test_a_workspace_links_each_package_it_names_that_another_workspace_produces(superrepo: Path) -> None:
    table = _table(superrepo)
    assert links.links_of(superrepo, table, "engines") == [links.Link(MODEL, "contracts", "contracts/packages/model")]
    assert links.links_of(superrepo, table, "contracts") == []


def test_a_workspace_never_links_a_package_it_produces_itself(superrepo: Path) -> None:
    _workspace(superrepo, "engines", {UI: "packages/ui"}, names=(UI,))
    assert links.links_of(superrepo, _table(superrepo), "engines") == []


def test_a_producer_that_is_not_checked_out_is_not_linked(superrepo: Path) -> None:
    table = _table(superrepo)
    table["contracts"][MODEL] = "packages/elsewhere"
    assert links.links_of(superrepo, table, "engines") == []


def test_a_package_the_lock_alone_names_is_linked(superrepo: Path) -> None:
    _workspace(
        superrepo,
        "web",
        {"@clockwyrks/ui": "packages/desktop"},
        lock=(f"node_modules/{VIEWS}",),
    )
    assert [link.package for link in links.links_of(superrepo, _table(superrepo), "web")] == [VIEWS]


def test_producers_are_built_before_the_workspaces_that_link_them(superrepo: Path) -> None:
    table = _table(superrepo)
    assert links.build_order(superrepo, table, "web") == [
        "contracts",
        "engines",
    ]
    assert links.build_order(superrepo, table, "contracts") == []


def test_workspaces_linking_each_other_cannot_be_built(superrepo: Path) -> None:
    _workspace(superrepo, "contracts", {MODEL: "packages/model", VIEWS: "packages/views"}, names=(UI,))
    with pytest.raises(links.LinkCycleError, match="engines -> contracts -> engines"):
        links.build_order(superrepo, _table(superrepo), "engines")


def test_the_plan_installs_and_builds_each_producer_once_before_its_consumers(superrepo: Path) -> None:
    table = _table(superrepo)
    steps = links.plan(superrepo, table, ["contracts", "engines", "web"])
    assert [(step.action, step.workspace, [link.package for link in step.links]) for step in steps] == [
        ("install", "contracts", []),
        ("build", "contracts", []),
        ("install", "engines", [MODEL]),
        ("build", "engines", []),
        ("install", "web", [UI]),
    ]


def test_a_workspace_is_linked_when_its_install_resolves_to_the_producer(superrepo: Path) -> None:
    link = links.links_of(superrepo, _table(superrepo), "engines")[0]
    workspace = superrepo / "engines"
    assert not links.installed(workspace)
    entry = workspace / "node_modules" / MODEL
    entry.parent.mkdir(parents=True)
    entry.mkdir()
    assert links.installed(workspace)
    assert not links.linked(superrepo, "engines", link)
    entry.rmdir()
    entry.symlink_to(superrepo / link.directory, target_is_directory=True)
    assert links.linked(superrepo, "engines", link)


def test_the_install_links_the_producers_without_saving(superrepo: Path) -> None:
    link = links.links_of(superrepo, _table(superrepo), "engines")[0]
    assert links.install_arguments(superrepo, []) == ["npm", "ci", "--no-audit", "--no-fund"]
    assert links.install_arguments(superrepo, [link]) == [
        "npm",
        "install",
        "--no-save",
        "--install-links=false",
        "--no-audit",
        "--no-fund",
        str((superrepo / "contracts" / "packages" / "model").resolve()),
    ]
    assert links.LOCK_CHECK[:3] == ["npm", "ci", "--dry-run"]
