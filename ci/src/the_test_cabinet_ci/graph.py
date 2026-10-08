"""The dependency graph across the repositories, and the patch table and package links that join them.

The superrepo holds each repository of The Test Cabinet as a submodule, and
two generated files join them inside it: the `[patch]` tables of
`.cargo/config.toml`, which redirect each repository's public git source to
the sibling checkout, and `.package-links.json`, the npm counterpart, which
names the packages each checked-out repository's workspace produces. This
module holds them to each other and to the edges the Repositories development
page draws.

The edges, the table of repositories and the link derivation are the
repository kit's own, `templates/repository/ci/src/the_test_cabinet_ci/`,
loaded by path, so the superrepo judges by the same table each repository's
`dependency-edges` gate does; the public sources and the CI image pins come
from `scripts/repos/render.py`, which wrote them into every repository.

What is asked:

- every submodule `.gitmodules` registers is a repository of the kit's table,
  or one the kit never renders (`NOT_RENDERED`, such as cold-storage);
- `.cargo/config.toml` holds the patch table of every repository carrying a
  crate, active or commented while the repository is not checked out. The
  check is of coverage, not of currency: `scripts/repos/sources.py
  patch-table --write` is what makes it current;
- a checked-out repository carries the kit's record naming itself and its
  kind, a patch entry per crate it declares pointing at a directory that
  exists, manifests its edges permit, and a pipeline pinning the image this
  checkout names on each track it runs;
- `.package-links.json` links every package a checked-out workspace
  produces, links nothing else, and an installed workspace naming a linked
  package resolves it to the sibling checkout.

The data edges, the ones no manifest can name (a run reading a suite, a CLI
pinning gg's released binary), are reported as notes and never refused.

A submodule that is not checked out, which is every one on the pipeline's
shallow checkout, is skipped with a notice: its manifests are its own
pipeline's to judge.
"""

from __future__ import annotations

import configparser
import importlib.util
import re
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from types import ModuleType

GITMODULES = ".gitmodules"
CARGO_CONFIG = Path(".cargo") / "config.toml"
RECORD = ".test-cabinet-repo.toml"
KIT_LIBRARY = Path("templates") / "repository" / "ci" / "src" / "the_test_cabinet_ci"
EDGES = KIT_LIBRARY / "edges.py"
LINKS = KIT_LIBRARY / "links.py"
RENDER = Path("scripts") / "repos" / "render.py"
LINK_SCRIPT = "scripts/repos/link-packages.sh"
PATCH_SCRIPT = "scripts/repos/sources.py patch-table --write"
PIPELINE = "azure-pipelines.yml"
# A container entry of a pipeline's resources, and the image it names.
CONTAINER = re.compile(r"^    - container: (?P<name>\S+) *\n      image: (?P<image>\S+) *$", re.MULTILINE)


def _load(path: Path, name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise FileNotFoundError(path)
    module = importlib.util.module_from_spec(spec)
    # A dataclass resolves its module through sys.modules while it is defined.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_edges(kit: Path) -> ModuleType:
    """The kit's edge table, imported from the file the kit renders into every repository."""
    return _load(kit / EDGES, "test_cabinet_kit_edges")


def load_links(kit: Path) -> ModuleType:
    """The kit's package-link derivation, imported from the file the kit renders into every repository."""
    return _load(kit / LINKS, "test_cabinet_kit_links")


def load_render(kit: Path) -> ModuleType:
    """The render script, imported by path: it holds the public sources and the image pins."""
    return _load(kit / RENDER, "test_cabinet_render")


def submodules(root: Path) -> dict[str, str]:
    """Each submodule `.gitmodules` registers, name to path."""
    path = root / GITMODULES
    if not path.exists():
        return {}
    parser = configparser.ConfigParser()
    parser.read(path, encoding="utf-8")
    found: dict[str, str] = {}
    for section in parser.sections():
        if section.startswith('submodule "') and section.endswith('"'):
            name = section[len('submodule "') : -1]
            found[name] = parser.get(section, "path", fallback=name)
    return found


def patches(root: Path) -> dict[str, dict[str, str]]:
    """Each active `[patch."<source>"]` table of the cargo configuration, crate to path."""
    path = root / CARGO_CONFIG
    if not path.exists():
        return {}
    config = tomllib.loads(path.read_text(encoding="utf-8"))
    found: dict[str, dict[str, str]] = {}
    for source, crates in config.get("patch", {}).items():
        if isinstance(crates, dict):
            found[source] = {
                crate: entry["path"] for crate, entry in crates.items() if isinstance(entry, dict) and "path" in entry
            }
    return found


def commented_patches(root: Path) -> set[str]:
    """The sources whose patch table the cargo configuration holds as a comment, for a repository not checked out."""
    path = root / CARGO_CONFIG
    if not path.exists():
        return set()
    return set(re.findall(r'^#   \[patch\."(?P<source>[^"]+)"\] *$', path.read_text(encoding="utf-8"), re.MULTILINE))


def record(repo: Path) -> dict[str, object] | None:
    """A checked-out repository's `.test-cabinet-repo.toml`, or None when it is absent."""
    path = repo / RECORD
    if not path.exists():
        return None
    return tomllib.loads(path.read_text(encoding="utf-8"))


def pinned_images(repo: Path) -> dict[str, str]:
    """The image each container resource of a checked-out repository's pipeline names."""
    path = repo / PIPELINE
    if not path.exists():
        return {}
    return {match.group("name"): match.group("image") for match in CONTAINER.finditer(path.read_text(encoding="utf-8"))}


def crates_of(repo: Path) -> set[str]:
    """The crates a checked-out repository declares under `crates/`."""
    names: set[str] = set()
    for manifest in sorted((repo / "crates").glob("*/Cargo.toml")):
        package = tomllib.loads(manifest.read_text(encoding="utf-8")).get("package")
        if isinstance(package, dict) and isinstance(package.get("name"), str):
            names.add(package["name"])
    return names


def checked_out(repo: Path) -> bool:
    return repo.is_dir() and any(repo.iterdir())


@dataclass
class Report:
    """What a check of the superrepo found."""

    problems: list[str] = field(default_factory=list)
    notices: list[str] = field(default_factory=list)
    checked: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.problems


def check(root: Path, kit: Path | None = None) -> Report:
    """Hold the submodules, the patch table, the package links and each checked-out repository together.

    `root` is the superrepo checkout, and `kit` the superrepo whose kit and
    render script judge it, `root` itself unless a test names another.
    """
    kit = root if kit is None else kit
    report = Report()
    edges = load_edges(kit)
    render = load_render(kit)
    update = "run scripts/repos/render.py --update {name}"

    rust = [repo for repo, kind in edges.REPOSITORIES.items() if edges.KINDS[kind].crate]
    table = patches(root)
    commented = commented_patches(root)
    for repo in rust:
        source = str(render.public_source(repo))
        if source not in table and source not in commented:
            report.problems.append(
                f"{CARGO_CONFIG} has no [patch] table for {source}, the source of {repo}; run {PATCH_SCRIPT}"
            )

    registered = submodules(root)
    if not registered:
        report.notices.append(f"{GITMODULES} registers no submodule")
    present: list[str] = []
    references: dict[str, str] = {}
    for name, path in sorted(registered.items()):
        if name in edges.NOT_RENDERED:
            report.notices.append(f"{path} is a submodule the kit renders nothing into, so it has no edges")
            continue
        if name not in edges.REPOSITORIES:
            report.problems.append(
                f"{path} is a submodule, and the kit's table of repositories names no {name}; "
                f"they are {sorted(edges.REPOSITORIES)}"
            )
            continue
        repo = root / path
        if not checked_out(repo):
            report.notices.append(f"{path} is not checked out; its manifests are judged by its own pipeline")
            continue
        kind = edges.REPOSITORIES[name]
        recorded = record(repo)
        if recorded is None:
            report.problems.append(
                f"{path} is checked out but carries no {RECORD}; render it with scripts/repos/render.py"
            )
            continue
        if recorded.get("name") != name or recorded.get("kind") != kind:
            report.problems.append(
                f"{path}/{RECORD} records {recorded.get('name')!r}, a {recorded.get('kind')!r} repository, and the"
                f" kit's table says {name!r}, a {kind!r} one; {update.format(name=name)}"
            )
            continue
        if edges.KINDS[kind].crate:
            source = str(render.public_source(name))
            entries = table.get(source, {})
            declared = crates_of(repo)
            for crate in sorted(declared - set(entries)):
                report.problems.append(f"{CARGO_CONFIG} does not patch {crate} of {source}; run {PATCH_SCRIPT}")
            for crate, target in sorted(entries.items()):
                if crate not in declared:
                    report.problems.append(f"{CARGO_CONFIG} patches {crate} of {source}, which {path} does not declare")
                elif not (root / target / "Cargo.toml").is_file():
                    report.problems.append(f"{CARGO_CONFIG} patches {crate} to {target}, which holds no Cargo.toml")
        report.problems.extend(f"{path}/{violation}" for violation in edges.violations(repo, name))
        pinned = pinned_images(repo)
        tracks = tuple(str(track) for track in render.ci_tracks(name, kind))
        for track in tracks:
            if track not in references:
                references[track] = str(render.image_reference(track, source=root))
            if pinned.get(track) != references[track]:
                report.problems.append(
                    f"{path}/{PIPELINE} runs the {track} track in {pinned.get(track, 'no image')}, and this checkout"
                    f" names {references[track]}; {update.format(name=name)}"
                )
        report.problems.extend(
            f"{path}/{PIPELINE} pins the {track} track, which {name} does not run; {update.format(name=name)}"
            for track in sorted(set(pinned) - set(tracks))
        )
        report.checked.append(path)
        present.append(path)

    report.notices.extend(
        f"the data edge {one.source} -> {one.target} ({one.what}) is reported, not checked"
        for one in edges.DATA_EDGES
        if one.source in present or one.target in present
    )
    check_links(root, kit, registered, present, report)
    return report


def check_links(root: Path, kit: Path, registered: dict[str, str], present: list[str], report: Report) -> None:
    """Hold `.package-links.json` and the installed workspaces to the checked-out repositories.

    A repository's npm workspace is its root. An entry for a registered
    submodule that is not checked out is noted, since its packages cannot be
    read here, and every other entry no checked-out workspace produces is a
    link to nothing.
    """
    links = load_links(kit)
    try:
        written = links.load_table(root)
    except links.LinkTableError as error:
        report.problems.append(f"{error}; write it again with {LINK_SCRIPT}")
        return
    if not (root / links.TABLE).is_file():
        report.problems.append(f"{links.TABLE} is missing; write it with {LINK_SCRIPT}")
        return
    workspaces = [path for path in present if (root / path / "package.json").is_file()]
    derived = links.produced(root, workspaces)
    fix = f"run {LINK_SCRIPT}"

    for package, producing in sorted(links.producers(derived).items()):
        if len(producing) > 1:
            report.problems.append(f"{package} is produced by {' and '.join(producing)}, so no link can name one")

    for workspace, packages in derived.items():
        linked = written.get(workspace, {})
        for package, directory in sorted(packages.items()):
            if package not in linked:
                report.problems.append(
                    f"{links.TABLE} does not link {package}, which {workspace}/{directory} produces; {fix}"
                )
            elif linked[package] != directory:
                report.problems.append(
                    f"{links.TABLE} links {package} to {workspace}/{linked[package]}, and {workspace}/{directory}"
                    f" produces it; {fix}"
                )
        report.problems.extend(
            _stale(root, links.TABLE, package, f"{workspace}/{directory}", fix)
            for package, directory in sorted(linked.items())
            if package not in packages
        )

    not_checked_out = {path for path in registered.values() if path not in present}
    for workspace, packages in sorted(written.items()):
        if workspace in derived:
            continue
        if workspace.split("/", 1)[0] in not_checked_out:
            report.notices.append(f"{links.TABLE} links the packages of {workspace}, which is not checked out")
            continue
        report.problems.extend(
            _stale(root, links.TABLE, package, f"{workspace}/{directory}", fix)
            for package, directory in sorted(packages.items())
        )

    for workspace in workspaces:
        expected = links.links_of(root, derived, workspace)
        if not expected:
            continue
        if not links.installed(root / workspace):
            report.notices.append(f"{workspace} is not installed; {LINK_SCRIPT} installs it with its links")
            continue
        for link in expected:
            if links.linked(root, workspace, link):
                continue
            entry = root / workspace / links.NODE_MODULES / link.package
            if entry.is_symlink() and not entry.exists():
                report.problems.append(
                    f"{workspace}/{links.NODE_MODULES}/{link.package} links to a directory that does not exist; {fix}"
                )
            else:
                report.problems.append(
                    f"{workspace} resolves {link.package} from its own install rather than {link.directory}; {fix}"
                )


def _stale(root: Path, table_name: str, package: str, directory: str, fix: str) -> str:
    """What a table entry no checked-out workspace produces is wrong with."""
    if not (root / directory / "package.json").is_file():
        return f"{table_name} links {package} to {directory}, a directory that does not exist; {fix}"
    return f"{table_name} links {package} to {directory}, which does not produce it; {fix}"
