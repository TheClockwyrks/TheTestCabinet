"""The dependency edges a repository of The Test Cabinet may hold, and the check of a tree against them.

This table is the one statement of the graph the Repositories development
page draws. It is rendered into every repository by the kit and read there by
the `dependency-edges` gate, and the superrepo's `dependency-graph` gate
imports this same file by path to check every checked-out submodule, so there
is one source for the edges rather than one per repository.

The edges are drawn between repositories, not between kinds: two libraries
(`contracts` and `engines`) may depend on different things. A repository's
kind says what shape it has: whether it carries a Rust crate, whether it
commits its lock file and whether it builds an npm workspace.

A dependency is attributed to a repository of the project by where it comes
from, never by its name alone:

- a Rust dependency by its git source, the repository's GitHub mirror (or its
  Azure remote, which a pipeline rewrites the mirror to);
- an npm dependency by its package name, which `PACKAGES` maps to the
  repository producing it, because a published package is installed from the
  feed and carries no source.

A crate or package the repository holds itself is always permitted, so a
workspace's members depend on one another by path. A path dependency, Rust or
npm, that leaves the repository is refused: a repository builds on its own,
and inside the superrepo the patch table and the package links are what point
it at a sibling checkout.

An edge may be narrowed to some of the target's packages, such as `web`
taking `@clockwyrks/backend-api` from `tcab` and nothing else, and may admit
the target's npm packages without its crates. The data edges below are no
build dependency at all: they are recorded so the `dependency-graph` gate can
say which jobs need a second checkout.
"""

from __future__ import annotations

import json
import tomllib
from collections.abc import Mapping
from pathlib import Path
from typing import NamedTuple

# The superrepo, which reads every repository and which nothing depends on.
SUPERREPO = "the-test-cabinet"


class Kind(NamedTuple):
    """The shape a kind of repository has."""

    # "library", "binary", or "" for a kind that carries no Rust crate.
    crate: str
    # Whether the repository commits its Cargo.lock: an application's lock is
    # the record of the revisions that build together.
    commits_lock: bool
    # Whether the repository builds an npm workspace, which the `typescript`
    # gate installs, builds, type-checks and tests.
    typescript: bool


# The kinds of the Repositories development page.
KINDS: Mapping[str, Kind] = {
    "library": Kind(crate="library", commits_lock=False, typescript=True),
    "application": Kind(crate="binary", commits_lock=True, typescript=True),
    "site": Kind(crate="", commits_lock=False, typescript=True),
    "content": Kind(crate="", commits_lock=False, typescript=False),
}

# Every repository the kit renders, by kind. `cold-storage` is a submodule of
# the superrepo too, but it is plain content no kit renders.
REPOSITORIES: Mapping[str, str] = {
    "contracts": "library",
    "engines": "library",
    "gg": "application",
    "tcab": "application",
    "web": "application",
    "the-spec-cabinet": "application",
    "gg.rocks": "site",
    "test-suites": "content",
}
NOT_RENDERED = frozenset({"cold-storage"})

# The GitHub organisation holding the mirrors, and each repository's mirror
# there. The mirrors carry the Azure names (plan Q10), so a relative submodule
# URL resolves the same on both hosts; the superrepo's mirror predates that.
GITHUB = "https://github.com/TheClockwyrks/"
MIRRORS: Mapping[str, str] = {
    SUPERREPO: "TheTestCabinet",
    **{repo: repo for repo in REPOSITORIES},
    "cold-storage": "cold-storage",
}
# The Azure DevOps project every repository lives in, over https and ssh.
AZURE_HTTPS = "https://dev.azure.com/genyume/the-test-cabinet/_git/"
AZURE_SSH = (
    "git@ssh.dev.azure.com:v3/genyume/the-test-cabinet/",
    "ssh://git@ssh.dev.azure.com/v3/genyume/the-test-cabinet/",
)

# Each package the project publishes, to the repository producing it. A
# package no repository produces is not the project's, and a `@clockwyrks/`
# package missing here is refused, so a new package is a decision.
SCOPE = "@clockwyrks/"
PACKAGES: Mapping[str, str] = {
    "@clockwyrks/run-record": "contracts",
    "@clockwyrks/asset-contract": "contracts",
    "@clockwyrks/simple-2d": "engines",
    "@clockwyrks/simple-3d": "engines",
    "@clockwyrks/structured-2d": "engines",
    "@clockwyrks/structured-3d": "engines",
    "@clockwyrks/voxel-runtime": "engines",
    "@clockwyrks/particle-runtime": "engines",
    "@clockwyrks/case-harness": "engines",
    "@clockwyrks/browser-driver": "tcab",
    "@clockwyrks/backend-api": "tcab",
    "@clockwyrks/ui": "web",
    "@clockwyrks/run-stats": "web",
    "@clockwyrks/web": "web",
    "@clockwyrks/site": "web",
    "@clockwyrks/lattice-designer": "web",
    "@clockwyrks/gg-sandbox": "gg",
}


class Edge(NamedTuple):
    """A build dependency one repository may hold on another."""

    target: str
    # Whether the repository may name the target's crates.
    crates: bool
    # The target's npm packages it may name: None for every one, an empty set
    # for none.
    packages: frozenset[str] | None
    why: str


def _only(*packages: str) -> frozenset[str]:
    return frozenset(packages)


# The permitted build edges, plan §2.1. A repository missing a target here may
# not depend on it, and gg is no repository's target: it is used only as a
# pinned released binary.
BUILD_EDGES: Mapping[str, tuple[Edge, ...]] = {
    "contracts": (),
    "engines": (Edge("contracts", True, _only("@clockwyrks/asset-contract"), "the catalog types; never run-record"),),
    "gg": (Edge("contracts", True, None, "the gg contract types"),),
    "tcab": (
        Edge("contracts", True, None, "the contract types and the suite runtime"),
        Edge("engines", True, None, "the engine catalog and the seeded packages"),
    ),
    "web": (
        Edge("contracts", True, None, "run-record"),
        Edge("engines", True, None, "the voxel and particle runtimes"),
        Edge("tcab", False, _only("@clockwyrks/backend-api"), "the console's wire types, as a published package"),
    ),
    "the-spec-cabinet": (
        Edge("contracts", True, None, "the contract types and the suite runtime"),
        Edge("engines", True, None, "the engine catalog and docs"),
        Edge("web", False, _only("@clockwyrks/ui"), "the UI library, an explicit exception"),
    ),
    "test-suites": (Edge("engines", False, None, "the validators import the engine packages"),),
    "gg.rocks": (),
}


class DataEdge(NamedTuple):
    """A repository reading another's files: no build dependency, but a job needing a second checkout."""

    source: str
    target: str
    what: str


DATA_EDGES: tuple[DataEdge, ...] = (
    DataEdge("tcab", "test-suites", "ingest, containers/performance's lattice training data, integration tests"),
    DataEdge("tcab", "gg", "the pinned released gg binary and toolchains image (deployments/pins.toml)"),
    DataEdge("test-suites", "tcab", "audio-packs reads containers/sample-packs/; the lattice replay wasm"),
    DataEdge("web", "test-suites", "the vendored foray and lattice replay assets"),
    DataEdge("the-spec-cabinet", "test-suites", "the authoring checkout"),
)

# The sections of a manifest that declare dependencies. A target-specific
# section holds the same three under `[target.<cfg>]`.
SECTIONS = ("dependencies", "dev-dependencies", "build-dependencies")
# The fields of a package.json naming the packages it installs.
NPM_FIELDS = ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies")

# Directories a walk for manifests never enters: build output and installed
# packages hold manifests of other people's crates and packages.
SKIPPED = frozenset({"target", "node_modules", ".git", "dist"})


def edges_of(repo: str) -> tuple[Edge, ...]:
    """The build edges a repository may hold."""
    if repo not in BUILD_EDGES:
        raise ValueError(f"unknown repository {repo!r}; the repositories are {sorted(BUILD_EDGES)}")
    return BUILD_EDGES[repo]


def edge(repo: str, target: str) -> Edge | None:
    """The edge from `repo` to `target`, or None when the table draws none."""
    return next((one for one in edges_of(repo) if one.target == target), None)


def closure(repo: str) -> list[str]:
    """Every repository a build of `repo` may fetch: its Rust edges, and theirs in turn."""
    reached: list[str] = []
    pending = [one.target for one in edges_of(repo) if one.crates]
    while pending:
        target = pending.pop(0)
        if target in reached:
            continue
        reached.append(target)
        pending.extend(one.target for one in edges_of(target) if one.crates)
    return sorted(reached)


def repository_of_source(source: str) -> str | None:
    """The repository of the project a git source names, or None for a source outside it."""
    url = source.strip().removesuffix("/").removesuffix(".git")
    for prefix in (GITHUB, *AZURE_SSH, AZURE_HTTPS):
        if url.startswith(prefix):
            name = url[len(prefix) :]
            if prefix == GITHUB:
                return next((repo for repo, mirror in MIRRORS.items() if mirror == name), name)
            return name
    return None


def describe(repo: str) -> str:
    """What a repository may depend on, as the `dependency-edges` gate says it."""
    parts = []
    for one in edges_of(repo):
        if one.packages is None:
            what = "crates and packages" if one.crates else "packages"
        elif one.packages:
            names = ", ".join(sorted(one.packages))
            what = f"crates and {names}" if one.crates else names
        else:
            what = "crates"
        parts.append(f"{one.target} ({what})")
    return "; ".join(parts) if parts else "no other repository of the project"


# --- Rust ---------------------------------------------------------------------


def manifests(root: Path, name: str = "Cargo.toml") -> list[Path]:
    """Every manifest called `name` under `root`, outside build output and installed packages."""
    return [path for path in sorted(root.rglob(name)) if not SKIPPED & set(path.relative_to(root).parts)]


def declared(manifest: Mapping[str, object]) -> list[tuple[str, str, Mapping[str, object]]]:
    """Every `(section, crate, entry)` a Cargo manifest declares, workspace and target sections included."""
    tables: list[tuple[str, Mapping[str, object]]] = []
    for section in SECTIONS:
        table = manifest.get(section)
        if isinstance(table, dict):
            tables.append((section, table))
    workspace = manifest.get("workspace")
    if isinstance(workspace, dict) and isinstance(workspace.get("dependencies"), dict):
        tables.append(("workspace.dependencies", workspace["dependencies"]))
    targets = manifest.get("target")
    if isinstance(targets, dict):
        for cfg in targets.values():
            if not isinstance(cfg, dict):
                continue
            for section in SECTIONS:
                table = cfg.get(section)
                if isinstance(table, dict):
                    tables.append((section, table))
    found: list[tuple[str, str, Mapping[str, object]]] = []
    for section, table in tables:
        for key, value in table.items():
            entry = value if isinstance(value, dict) else {}
            crate = entry.get("package") if isinstance(entry.get("package"), str) else key
            found.append((section, str(crate), entry))
    return found


def _leaves(root: Path, base: Path, relative: str) -> bool:
    """Whether a path written in a manifest at `base` points outside `root`."""
    target = (base / relative).resolve()
    return not target.is_relative_to(root.resolve())


def rust_violations(root: Path, repo: str) -> list[str]:
    """Every Rust dependency under `root` the edges of `repo` refuse, one line each."""
    found: list[str] = []
    for path in manifests(root):
        manifest = tomllib.loads(path.read_text(encoding="utf-8"))
        where = path.relative_to(root)
        for section, crate, entry in declared(manifest):
            source = entry.get("git")
            relative = entry.get("path")
            if isinstance(relative, str) and _leaves(root, path.parent, relative):
                found.append(f"{where}: [{section}] {crate} is a path dependency outside the repository")
                continue
            if not isinstance(source, str):
                continue
            target = repository_of_source(source)
            if target is None or target == repo:
                continue
            permitted = edge(repo, target)
            if target not in MIRRORS:
                found.append(f"{where}: [{section}] {crate} comes from {source}, which is no repository of the project")
            elif permitted is None or not permitted.crates:
                found.append(f"{where}: [{section}] {crate} comes from {target}, whose crates {repo} may not name")
    return found


# --- npm ----------------------------------------------------------------------


def _package_json(path: Path) -> dict[str, object]:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def own_packages(root: Path) -> set[str]:
    """The packages the repository's own manifests name themselves."""
    names = set()
    for path in manifests(root, "package.json"):
        name = _package_json(path).get("name")
        if isinstance(name, str):
            names.add(name)
    return names


def npm_violations(root: Path, repo: str) -> list[str]:
    """Every npm dependency under `root` the edges of `repo` refuse, one line each."""
    own = own_packages(root)
    found: list[str] = []
    for path in manifests(root, "package.json"):
        manifest = _package_json(path)
        where = path.relative_to(root)
        for field in NPM_FIELDS:
            entries = manifest.get(field)
            if not isinstance(entries, dict):
                continue
            for package, spec in entries.items():
                spec = str(spec)
                if spec.startswith(("file:", "link:")) and _leaves(root, path.parent, spec.split(":", 1)[1]):
                    found.append(f"{where}: [{field}] {package} is a path dependency outside the repository")
                    continue
                if package in own or not package.startswith(SCOPE):
                    continue
                target = PACKAGES.get(package)
                if target is None:
                    found.append(f"{where}: [{field}] {package} is produced by no repository of the project")
                    continue
                if target == repo:
                    continue
                permitted = edge(repo, target)
                allowed = permitted is not None and (permitted.packages is None or package in permitted.packages)
                if not allowed:
                    found.append(f"{where}: [{field}] {package} comes from {target}, which {repo} may not depend on")
    return found


def violations(root: Path, repo: str) -> list[str]:
    """Every dependency under `root`, Rust and npm, the edges of `repo` refuse."""
    return [*rust_violations(root, repo), *npm_violations(root, repo)]


def table_problems() -> list[str]:
    """What is inconsistent within the table itself; empty when it is whole."""
    problems: list[str] = []
    for repo, kind in REPOSITORIES.items():
        if kind not in KINDS:
            problems.append(f"{repo} is of the kind {kind!r}, which is no kind")
        if repo not in BUILD_EDGES:
            problems.append(f"{repo} has no row of build edges")
    for repo, row in BUILD_EDGES.items():
        for one in row:
            if one.target not in REPOSITORIES:
                problems.append(f"{repo} depends on {one.target}, which is no repository")
                continue
            if one.crates and not KINDS[REPOSITORIES[one.target]].crate:
                problems.append(f"{repo} may name crates of {one.target}, which carries none")
            problems.extend(
                f"{repo} may name {package} of {one.target}, which {one.target} does not produce"
                for package in sorted(one.packages or ())
                if PACKAGES.get(package) != one.target
            )
    problems.extend(
        f"the data edge {one.source} -> {one.target} names {name}, which is no repository"
        for one in DATA_EDGES
        for name in (one.source, one.target)
        if name not in REPOSITORIES
    )
    problems.extend(
        f"{package} is produced by {repo}, which is no repository"
        for package, repo in PACKAGES.items()
        if repo not in REPOSITORIES
    )
    if any(one.target == "gg" for row in BUILD_EDGES.values() for one in row):
        problems.append("a repository depends on gg at build time; gg is used only as a released binary")
    # A cycle would leave no order to promote the repositories in.
    problems.extend(f"{repo} reaches itself through its edges" for repo in BUILD_EDGES if repo in closure(repo))
    return problems
