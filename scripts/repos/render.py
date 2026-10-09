#!/usr/bin/env python3
"""Render the repository kit into a repository of The Test Cabinet, or merge a kit change into one.

    uv run --project ci scripts/repos/render.py <name> --description "<one line>" [--kind <kind>] [--into DIR]
    uv run --project ci scripts/repos/render.py --update <name> [--into DIR]

The kit under templates/repository/ is a copier template, declared by the
copier.yml at the superrepo root; this script is the one way it is rendered.
A first render answers copier's three questions (`name`, `kind`,
`description`) from the arguments and the table of repositories, and every
other value a file needs is derived from those three by the context extension
beside this script (`context.py`), which reads the tables held here and in the
kit's edge table. The render leaves two records at the repository's root:
`.copier-answers.yml`, which copier maintains and which holds the answers, the
template's source and the superrepo commit the repository was rendered from,
and `.test-cabinet-repo.toml`, rendered for the `dependency-edges` gate.

An update is a three-way merge. Copier renders the template at the commit
`.copier-answers.yml` records and at the superrepo's current commit, takes the
difference, and applies it to the repository, so a line the repository added
to a rendered file survives and a line the kit changed arrives; a hunk that
meets a line both sides changed is written with inline conflict markers. Every
rendered file merges this way; the crate's source files alone are written once
and then left to the repository (`_skip_if_exists` in copier.yml).

The kit is rendered at the superrepo's committed HEAD, so the record names a
commit that exists. `--uncommitted` renders the working tree instead, which is
how a kit change is tried against a repository before it is committed; the
record such a render leaves names a commit copier made up, and is not for
committing.

Copier clones the superrepo to render it, and the superrepo is the whole of
The Test Cabinet while the monorepo still sits at its root, so a render takes
as long as a checkout of it does. `--source` names another superrepo to render
from, which is how the tests render from a small one of their own.
"""

from __future__ import annotations

import argparse
import functools
import importlib.util
import json
import os
import re
import subprocess
import sys
import textwrap
import tomllib
from collections.abc import Iterator
from contextlib import chdir, contextmanager
from pathlib import Path
from types import ModuleType
from typing import NamedTuple

SUPERREPO = Path(__file__).resolve().parents[2]
KIT = SUPERREPO / "templates" / "repository"
EDGES = KIT / "ci" / "src" / "the_test_cabinet_ci" / "edges.py"
COPIER_CONFIG = SUPERREPO / "copier.yml"
RECORD = ".test-cabinet-repo.toml"
ANSWERS = ".copier-answers.yml"
# How copier's git is configured while it clones the superrepo to render it.
# The superrepo's submodules are the repositories themselves and cold-storage,
# which a render of the template has no use for, and their relative URLs
# resolve to nothing beside a clone in a temporary directory; a pathspec no
# submodule matches keeps `git submodule update --init` from registering any. A
# submodule whose checkout has moved is not a change to the kit, so the check
# copier makes for uncommitted template changes leaves submodules out.
GIT_ENVIRONMENT = {
    "GIT_CONFIG_COUNT": "2",
    "GIT_CONFIG_KEY_0": "submodule.active",
    "GIT_CONFIG_VALUE_0": "no-submodule-of-the-template",
    "GIT_CONFIG_KEY_1": "diff.ignoreSubmodules",
    "GIT_CONFIG_VALUE_1": "all",
}
# The variables that tell git which repository it is in. A commit hook runs
# with them pointing at the repository being committed to, and a render run
# from one would otherwise clone, check and commit in that repository instead
# of its own, so every git this script starts, copier's included, runs without
# them.
GIT_LOCATING = (
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_PREFIX",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
)
CONFLICT_MARKER = "<<<<<<<"

# Where every repository lives: the Azure DevOps project, over ssh (what work is
# pushed to) and over https (what a pipeline's token reaches), and the name a
# pipeline declares a repository resource by.
AZURE_ORGANISATION = "https://dev.azure.com/genyume"
AZURE_PROJECT = "the-test-cabinet"
AZURE_REMOTE = "git@ssh.dev.azure.com:v3/genyume/the-test-cabinet/{repo}"
AZURE_HTTPS = "https://dev.azure.com/genyume/the-test-cabinet/_git/{repo}"
AZURE_PROJECT_REPOSITORY = "the-test-cabinet/{repo}"

# The CI images the superrepo builds and every repository's pipeline pins: the
# registry, the service connection a pipeline pulls through, and the name of a
# track's image. Each is tagged with the commit whose image pipeline run built
# it, which ci/images/tags.yml pins as `ciImageTag`.
CI_REGISTRY = "testcabinet.azurecr.io"
CI_IMAGE_ENDPOINT = "the-test-cabinet-acr"
CI_IMAGE = "ubuntu-the-test-cabinet-{track}-cicd"
CI_IMAGES = SUPERREPO / "ci" / "images"
CI_IMAGE_TAGS = CI_IMAGES / "tags.yml"
CI_IMAGE_TAG = re.compile(r"^\s*ciImageTag:\s*([0-9a-f]{40})\s*$", re.MULTILINE)
# The track every repository runs its prose and npm gates on, and the track a
# repository runs its Rust gates on unless `RUST_TRACKS` names another.
CI_WEB_TRACK = "web"
CI_SHARED_RUST_TRACK = "rust"
# The repositories whose Rust suite needs a browser: the validation tests the
# suite runtime carries drive Chromium through Playwright, and the rust-browser
# image is the Rust image with Node and that browser on top. A job in it runs
# with TCAB_REQUIRE_BROWSER=1, so a browser test that finds no browser fails
# rather than skipping.
RUST_TRACKS: dict[str, str] = {
    "contracts": "rust-browser",
    "the-spec-cabinet": "rust-browser",
}
BROWSER_TRACKS = frozenset({"rust-browser"})

# The crate a render scaffolds in each repository carrying one: its directory
# under crates/ and its package name. The monorepo's crates keep their
# directories when a repository is extracted, so the scaffold is named as the
# crate it becomes: the CLI is `crates/cli`, gg `crates/gg`.
CRATES: dict[str, tuple[str, str]] = {
    "contracts": ("contracts", "test-cabinet-contracts"),
    "engines": ("engines", "test-cabinet-engines"),
    "gg": ("gg", "test-cabinet-gg"),
    "platform": ("cli", "test-cabinet-cli"),
    "web": ("console-app", "test-cabinet-console-app"),
    "the-spec-cabinet": ("spec-cabinet", "test-cabinet-spec-cabinet"),
}

# The release tag each repository's dependents pin, for the repositories that
# have cut one. A manifest names a dependency at its public source on this tag,
# and on the `master` branch while the repository has none.
TAGS: dict[str, str] = {}

# The npm registry of the `the-test-cabinet` feed of the project's Azure
# Artifacts, as the Repositories development page names it. A tag's run
# publishes the repositories' packages there, and a workspace that names one
# installs it from there when it builds outside the superrepo.
FEED_REGISTRY = "https://pkgs.dev.azure.com/genyume/the-test-cabinet/_packaging/the-test-cabinet/npm/registry/"
NPM_FEED_SCRIPT = "scripts/ci/npm-feed.sh"
PUBLISH_SCRIPT = "scripts/ci/publish-packages.sh"
PUBLISH_STAGE = "publish"
RELEASE_TAGS = "v*"
# The long-lived branches of every repository, whose push runs its pipeline
# and which a repository's mirror stage pushes to the mirror. `master` and
# `staging` are protected by branch policy and take pull requests alone;
# `nightly` takes pushes.
BRANCHES = ("master", "staging", "nightly")
# The secure file holding a repository's GitHub deploy key. GitHub refuses one
# key on two repositories, so each mirror has its own.
MIRROR_KEY = "github-mirror-key-{repo}"
MIRROR_SCRIPT = "scripts/ci/mirror.sh"
# What a hosted agent carries that no job here uses, removed before a Rust job
# so the build output and its cache archive fit on the disk together.
HOST_DISK_COMMAND = (
    "sudo rm -rf /usr/share/dotnet /usr/local/lib/android /opt/ghc /usr/local/.ghcup /opt/hostedtoolcache/CodeQL"
)
CHECKS_SOURCES = "$(Build.SourcesDirectory)"


class RenderError(Exception):
    """A render that cannot proceed, with the reason as its message."""


@functools.cache
def edge_table() -> ModuleType:
    """The kit's own edge table, loaded by path so the render and the gate agree."""
    spec = importlib.util.spec_from_file_location("test_cabinet_kit_edges", EDGES)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def kinds() -> list[str]:
    """The kinds a repository may be, as the `kind` question offers them."""
    return sorted(edge_table().KINDS)


def repositories() -> dict[str, str]:
    """Every repository the kit renders, to its kind."""
    return dict(edge_table().REPOSITORIES)


def public_source(repo: str) -> str:
    """The public git source of a repository: its GitHub mirror, without a `.git` suffix."""
    edges = edge_table()
    if repo not in edges.MIRRORS:
        raise RenderError(f"{repo} has no public mirror")
    return f"{edges.GITHUB}{edges.MIRRORS[repo]}"


def azure_remote(repo: str) -> str:
    """The Azure DevOps remote of a repository, the one the work is pushed to."""
    return AZURE_REMOTE.format(repo=repo)


def azure_https(repo: str) -> str:
    """The Azure DevOps remote over https, the one a pipeline's token reaches."""
    return AZURE_HTTPS.format(repo=repo)


def ci_sources() -> str:
    """One line per repository, `<azure https> <public source>`, for a pipeline's git rewrites.

    Every repository carrying a crate is listed rather than the ones this one
    may depend on, so the rendered file is the same in every repository and a
    crate that takes up a new edge needs no re-render to fetch it.
    """
    edges = edge_table()
    rust = [repo for repo, kind in edges.REPOSITORIES.items() if edges.KINDS[kind].crate]
    return "\n".join(f"{azure_https(repo)} {public_source(repo)}" for repo in rust)


def fetched_repositories(name: str) -> list[str]:
    """The repositories a pipeline of `name` may fetch: the closure of its Rust edges."""
    return list(edge_table().closure(name))


def uses_block(aliases: list[str]) -> str:
    """A job's `uses.repositories` list of the resources named, or nothing when there is none."""
    if not aliases:
        return ""
    lines = ["        uses:", "          repositories:"]
    lines += [f"            - {alias}" for alias in aliases]
    return "\n".join(lines)


def ci_image_tag(source: Path = SUPERREPO) -> str:
    """The commit ci/images/tags.yml pins as `ciImageTag`, the tag of every CI image."""
    path = source / CI_IMAGE_TAGS.relative_to(SUPERREPO)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise RenderError(f"{path} cannot be read, so no CI image can be pinned: {error}") from error
    found = CI_IMAGE_TAG.search(text)
    if found is None:
        raise RenderError(f"{path} pins no forty-character ciImageTag, so no CI image can be pinned")
    return found.group(1)


def image_reference(track: str, source: Path = SUPERREPO) -> str:
    """The image a track runs in, at the commit the superrepo pins."""
    dockerfile = source / CI_IMAGES.relative_to(SUPERREPO) / f"{track}.Dockerfile"
    if not dockerfile.is_file():
        raise RenderError(f"the superrepo builds no {track} CI image ({dockerfile} does not exist)")
    return f"{CI_REGISTRY}/{CI_IMAGE.format(track=track)}:{ci_image_tag(source)}"


def rust_track(name: str) -> str:
    """The track a repository runs its Rust job in."""
    return RUST_TRACKS.get(name, CI_SHARED_RUST_TRACK)


def ci_tracks(name: str, kind: str) -> tuple[str, ...]:
    """The tracks a repository's pipeline declares a container for, in the order it writes them."""
    if edge_table().KINDS[kind].crate:
        return (rust_track(name), CI_WEB_TRACK)
    return (CI_WEB_TRACK,)


def ci_resources(name: str, kind: str) -> str:
    """The pipeline's `resources` block: the repositories a run may fetch, and the images.

    A project that protects repository access in YAML pipelines gives a run's
    token only the repositories the pipeline declares, so every one a fetch
    may reach is declared here.
    """
    lines = ["resources:"]
    repos = fetched_repositories(name)
    if repos:
        lines += [
            "  # Every repository the run may fetch, so the job's access token may",
            "  # read each one.",
            "  repositories:",
        ]
        for repo in repos:
            lines += [
                f"    - repository: {repo}",
                "      type: git",
                f"      name: {AZURE_PROJECT_REPOSITORY.format(repo=repo)}",
                "      ref: master",
            ]
    lines += [
        "  # The images the tracks run in, built by the superrepo's image pipeline",
        f"  # and pulled through the service connection {CI_IMAGE_ENDPOINT} before a",
        "  # job starts. Each tag is the commit whose image pipeline run built the",
        "  # image, which the superrepo's ci/images/tags.yml pins; a bump arrives",
        "  # with `scripts/repos/render.py --update`.",
        "  containers:",
    ]
    for track in ci_tracks(name, kind):
        lines += [
            f"    - container: {track}",
            f"      image: {image_reference(track)}",
            f"      endpoint: {CI_IMAGE_ENDPOINT}",
        ]
    return "\n".join(lines)


def ci_rust_variables(name: str) -> str:
    """The Rust job's `variables`: the cargo home under the cache, and the browser requirement on its track."""
    lines = [
        "        variables:",
        "          CARGO_HOME: $(ciCache)/cargo-home",
        "          CARGO_INCREMENTAL: 0",
    ]
    if rust_track(name) in BROWSER_TRACKS:
        lines.append("          TCAB_REQUIRE_BROWSER: 1")
    return "\n".join(lines)


class KindCheck(NamedTuple):
    """A gate a kind adds under `ci/gates/`, run by the pipeline alone.

    Such a gate builds or runs a test suite, so it has no hook: its id joins
    `PIPELINE_ONLY` in the rendered `ci/tests/test_wiring.py`, and it runs as
    one step of the pipeline's checks job, inside the web image, after the
    prose gates. A gate that runs tests is given an artifacts directory and
    its JUnit report is published as the run's test results.
    """

    id: str
    display_name: str
    # What the gate's tests are called in the run's test results, or None for
    # a gate that runs no tests.
    tests: str | None = None


# The `typescript` gate, `ci/gates/typescript.py` in a render of a kind that
# carries it, which installs, builds, type-checks and tests the npm workspace
# at the repository root.
TYPESCRIPT_CHECK = KindCheck("typescript", "TypeScript (npm ci, build, type-check, test)", "TypeScript")


def kind_checks(kind: str) -> tuple[KindCheck, ...]:
    """The gates the kind adds, in the order the checks job runs them."""
    return (TYPESCRIPT_CHECK,) if edge_table().KINDS[kind].typescript else ()


def typescript_workspace(kind: str) -> str:
    """The npm workspace the kind's `typescript` gate builds, `.` for the root, or nothing for a kind without it.

    The kit's gate, its test and the `.npmrc` carry a conditional name on this
    value, so a kind is rendered them exactly when it carries the gate.
    """
    return "." if TYPESCRIPT_CHECK in kind_checks(kind) else ""


def npm_feed_step() -> str:
    """The step writing the job's access token as npm's credential for the feed."""
    return (
        f"          - script: {NPM_FEED_SCRIPT} {FEED_REGISTRY}\n"
        "            displayName: Authenticate npm to the package feed\n"
        "            env:\n"
        "              SYSTEM_ACCESSTOKEN: $(System.AccessToken)"
    )


def ci_npm_feed(kind: str) -> str:
    """The feed step a checks job runs before its first `npm ci`, or nothing for a kind building no workspace."""
    return npm_feed_step() if typescript_workspace(kind) else ""


def ci_kind_checks(kind: str) -> str:
    """The checks-job steps of the gates the kind adds, or nothing."""
    lines: list[str] = []
    for check in kind_checks(kind):
        lines += [
            f"          - script: uv run --quiet --project ci gate run {check.id}",
            f"            displayName: {check.display_name}",
            "            condition: eq(variables['checksReady'], 'true')",
        ]
        if check.tests is None:
            continue
        artifacts = f"target/gate-artifacts/{check.id}"
        lines += [
            "            env:",
            f"              CI_GATE_ARTIFACTS: {artifacts}",
            "          - task: PublishTestResults@2",
            f"            displayName: Publish the {check.tests} test results",
            "            condition: succeededOrFailed()",
            "            inputs:",
            "              testResultsFormat: JUnit",
            f"              testResultsFiles: {CHECKS_SOURCES}/{artifacts}/junit.xml",
            f"              testRunTitle: {check.tests} tests",
            "              failTaskOnMissingResultsFile: false",
        ]
    return "\n".join(lines)


def pipeline_only_of_kind(kind: str) -> str:
    """The ids the kind adds to `PIPELINE_ONLY`, as the words of one string."""
    return " ".join(check.id for check in kind_checks(kind))


def ci_publish(kind: str) -> str:
    """The stage publishing the workspace's public packages on a tag.

    Every kind is rendered the stage and the trigger on tags, and the stage
    comes before the mirror stage, which stays the pipeline's last. A kind
    without the `typescript` gate has no workspace to publish, and the script
    skips it with a notice, or refuses a workspace no gate of the repository
    builds.
    """
    lines = [
        f"  - stage: {PUBLISH_STAGE}",
        "    displayName: Publish",
        "    dependsOn: gates",
        "    condition: and(succeeded(), startsWith(variables['Build.SourceBranch'], 'refs/tags/v'))",
        "    jobs:",
        "      - job: packages",
        "        displayName: Publish the TypeScript packages",
        "        timeoutInMinutes: 30",
        f"        container: {CI_WEB_TRACK}",
        "        steps:",
        "          - checkout: self",
        "            fetchDepth: 1",
        "            clean: true",
        f"          - script: {PUBLISH_SCRIPT} . {FEED_REGISTRY} $(Build.SourceBranch)",
        "            displayName: Publish the packages to the feed",
        "            env:",
        "              SYSTEM_ACCESSTOKEN: $(System.AccessToken)",
    ]
    return "\n".join(lines)


def crate_of(name: str) -> tuple[str, str]:
    """The directory under crates/ and the package name of a repository's scaffolded crate."""
    if name not in CRATES:
        raise RenderError(f"{name} carries a crate, and the kit names none for it in CRATES")
    return CRATES[name]


def pinned_reference(repo: str) -> str:
    """The reference a manifest pins a repository at: its recorded tag, else `master`."""
    tag = TAGS.get(repo)
    return f'tag = "{tag}"' if tag is not None else 'branch = "master"'


def workspace_dependencies(name: str) -> str:
    """The `[workspace.dependencies]` body: the crate of each repository the Rust edges permit."""
    edges = edge_table()
    lines = []
    for one in edges.edges_of(name):
        if not one.crates:
            continue
        _, crate = crate_of(one.target)
        lines.append(f'{crate} = {{ git = "{public_source(one.target)}", {pinned_reference(one.target)} }}')
    return "\n".join(lines) if lines else f"# {name} depends on no crate of another repository."


def lock_file_rule(kind: str) -> str:
    """The lock-file rule of the kind, as a wrapped list item, or nothing for a kind carrying no crate."""
    shape = edge_table().KINDS[kind]
    if not shape.crate:
        return ""
    if shape.commits_lock:
        rule = (
            "It commits its lock file: an application's lock file is the record of the "
            "revisions that build together. Inside the superrepo every build rewrites the "
            "working copy under the patch table; that copy is never committed, and "
            "`scripts/resolve-lock.sh` writes the standalone one back."
        )
    else:
        rule = (
            "It commits no lock file: a library's revisions that build together are recorded "
            "by each application's lock file, and its pipeline builds it on its own."
        )
    return textwrap.fill(rule, width=80, initial_indent="- ", subsequent_indent="  ")


def edges_rule(name: str) -> str:
    """What the repository may depend on, as a wrapped list item of CLAUDE.md."""
    rule = (
        f"It depends on {edge_table().describe(name)}, and on no other repository of the project; the "
        "`dependency-edges` gate holds every Cargo and npm manifest to the edges the "
        "superrepo's Repositories page draws."
    )
    return textwrap.fill(rule, width=80, initial_indent="- ", subsequent_indent="  ", break_on_hyphens=False)


# A value of the derived context: the template interpolates the strings and
# tests the flags.
Variables = dict[str, str | bool | list[str]]


def variables(name: str, kind: str, description: str) -> Variables:
    """Every value a template derives from the answers."""
    edges = edge_table()
    if kind not in edges.KINDS:
        raise RenderError(f"unknown kind {kind!r}; the kinds are {kinds()}")
    if name not in edges.REPOSITORIES:
        raise RenderError(f"{name} is no repository the kit renders; they are {sorted(edges.REPOSITORIES)}")
    if edges.REPOSITORIES[name] != kind:
        raise RenderError(f"{name} is a {edges.REPOSITORIES[name]} repository, not a {kind} one")
    if '"' in description or "\\" in description or "\n" in description:
        raise RenderError("a description is one line holding no double quote or backslash")
    shape = edges.KINDS[kind]
    crate_dir, crate = crate_of(name) if shape.crate else ("", "")
    return {
        "name": name,
        "kind": kind,
        "description": description,
        # The same sentence as a Markdown paragraph, held to 80 columns.
        "description_wrapped": textwrap.fill(description, width=80),
        "crate": crate,
        "crate_dir": crate_dir,
        "public_source": public_source(name),
        "azure_remote": azure_remote(name),
        "workspace_dependencies": workspace_dependencies(name) if shape.crate else "",
        "lock_file_rule": lock_file_rule(kind),
        "edges_rule": edges_rule(name),
        "ci_sources": ci_sources(),
        "ci_resources": ci_resources(name, kind),
        "ci_rust_track": rust_track(name) if shape.crate else "",
        "ci_rust_variables": ci_rust_variables(name),
        "ci_uses": uses_block(fetched_repositories(name)),
        "ci_npm_feed": ci_npm_feed(kind),
        "ci_kind_checks": ci_kind_checks(kind),
        "ci_publish": ci_publish(kind),
        "ci_image_endpoint": CI_IMAGE_ENDPOINT,
        "ci_registry": CI_REGISTRY,
        "ci_image_tag": ci_image_tag(),
        "checks_root": CHECKS_SOURCES,
        "branches": list(BRANCHES),
        "release_tags": RELEASE_TAGS,
        "feed_registry": FEED_REGISTRY,
        "pipeline_only_of_kind": pipeline_only_of_kind(kind),
        "typescript_workspace": typescript_workspace(kind),
        "host_disk_command": HOST_DISK_COMMAND,
        "rust_crate": shape.crate,
        "commits_lock": shape.commits_lock,
        # Every repository of the project has a GitHub mirror (plan Q10).
        "ci_mirror": name in edges.MIRRORS,
        "mirror_key": MIRROR_KEY.format(repo=name),
        "mirror_script": MIRROR_SCRIPT,
        # The same repositories as a Python list, for ci/tests/test_wiring.py.
        "fetched_list": json.dumps(fetched_repositories(name)),
    }


# --- Rendering ----------------------------------------------------------------


class Outcome(NamedTuple):
    """What a render or an update did to a repository."""

    # The paths written, removed or merged, relative to the repository root.
    written: list[str]
    # The paths left with inline conflict markers for the updater to settle.
    conflicts: list[str]


def _git(args: list[str], cwd: Path, *, check: bool = True) -> subprocess.CompletedProcess[str]:
    env = {key: value for key, value in os.environ.items() if key not in GIT_LOCATING}
    return subprocess.run(["git", *args], cwd=cwd, env=env, capture_output=True, text=True, check=check)


@contextmanager
def _copier() -> Iterator[ModuleType]:
    """Copier, with its git configured for the superrepo while the block runs.

    Copier runs git through plumbum, whose environment is a copy of the
    process's taken when it is imported, so both are given the settings, and
    lose the variables that locate a repository, and both are given back what
    they held afterwards.
    """
    import copier
    import plumbum

    keys = (*GIT_ENVIRONMENT, *GIT_LOCATING)
    saved = {key: os.environ.get(key) for key in keys}
    saved_plumbum = {key: plumbum.local.env.get(key) for key in keys}
    for environment in (os.environ, plumbum.local.env):
        for key in GIT_LOCATING:
            environment.pop(key, None)
        environment.update(GIT_ENVIRONMENT)
    try:
        yield copier
    finally:
        for environment, held in ((os.environ, saved), (plumbum.local.env, saved_plumbum)):
            for key, value in held.items():
                if value is None:
                    environment.pop(key, None)
                else:
                    environment[key] = value


def template_ref(source: Path, *, uncommitted: bool) -> str:
    """The ref copier renders the superrepo at.

    The committed HEAD, named by its hash so the record names a commit that
    exists, unless the working tree is asked for: copier includes a local
    template's uncommitted changes when it renders the literal `HEAD`, by
    committing them in its clone, and records that made-up commit.
    """
    if uncommitted:
        return "HEAD"
    return _git(["rev-parse", "HEAD"], source).stdout.strip()


def read_record(root: Path) -> dict[str, object]:
    record = root / RECORD
    if not record.is_file():
        raise RenderError(f"{record} is missing, so this is not a rendered repository")
    return tomllib.loads(record.read_text(encoding="utf-8"))


def read_answers(root: Path) -> dict[str, object]:
    import yaml

    answers = root / ANSWERS
    if not answers.is_file():
        raise RenderError(f"{answers} is missing, so this is not a rendered repository")
    return yaml.safe_load(answers.read_text(encoding="utf-8"))


def _is_dirty(root: Path) -> bool:
    return bool(_git(["status", "--porcelain"], root).stdout.strip())


def _files(tree: Path) -> set[str]:
    return {
        path.relative_to(tree).as_posix()
        for path in tree.rglob("*")
        if path.is_file() and ".git" not in path.relative_to(tree).parts
    }


def _conflicted(root: Path, paths: list[str]) -> list[str]:
    conflicted = []
    for relative in paths:
        path = root / relative
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        if any(line.startswith(CONFLICT_MARKER) for line in text.splitlines()):
            conflicted.append(relative)
    return conflicted


def _changed(root: Path) -> list[str]:
    """The paths git sees changed under `root`, deletions included, relative to it."""
    out = _git(["status", "--porcelain", "--untracked-files=all"], root).stdout
    return sorted(line[3:] for line in out.splitlines())


def render(
    root: Path,
    name: str,
    kind: str,
    description: str,
    *,
    source: Path = SUPERREPO,
    uncommitted: bool = False,
) -> Outcome:
    """Render the template into `root`, which must not exist or be empty."""
    if root.exists() and any(root.iterdir()):
        raise RenderError(f"{root} is not empty; use --update to refresh a rendered repository")
    variables(name, kind, description)
    root.mkdir(parents=True, exist_ok=True)
    ref = template_ref(source, uncommitted=uncommitted)
    # Run from the repository, naming the superrepo relative to it, so the
    # `_src_path` the record holds is `..` for a repository checked out inside
    # the superrepo, and resolves on every machine the checkout is on.
    with _copier() as copier, chdir(root):
        try:
            copier.run_copy(
                os.path.relpath(source, root),
                ".",
                data={"name": name, "kind": kind, "description": description},
                vcs_ref=ref,
                unsafe=True,
                defaults=True,
                quiet=True,
            )
        except copier.errors.CopierError as error:
            raise RenderError(f"copier could not render {name}: {error}") from error
    return Outcome(sorted(_files(root)), [])


def update(root: Path, *, source: Path = SUPERREPO, uncommitted: bool = False) -> Outcome:
    """Merge the kit's change since the repository's last render into it."""
    if _is_dirty(root):
        raise RenderError(
            f"{root} has uncommitted changes; the merge is against committed state, so commit or stash them first"
        )
    answers = read_answers(root)
    recorded = (root / str(answers["_src_path"])).resolve()
    if recorded != source.resolve():
        raise RenderError(
            f"{root / ANSWERS} names {recorded} as the template, not {source}; "
            "the record's `_src_path` is relative to the repository"
        )
    ref = template_ref(source, uncommitted=uncommitted)
    # From the repository, where the record's `_src_path` resolves.
    with _copier() as copier, chdir(root):
        try:
            copier.run_update(
                ".",
                vcs_ref=ref,
                unsafe=True,
                defaults=True,
                skip_answered=True,
                conflict="inline",
                overwrite=True,
                quiet=True,
            )
        except copier.errors.CopierError as error:
            raise RenderError(f"copier could not update {root.name}: {error}") from error
    changed = _changed(root)
    return Outcome(changed, _conflicted(root, changed))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("name", help="the repository, such as contracts")
    parser.add_argument("--kind", help="the repository's kind, which the table of repositories otherwise gives")
    parser.add_argument("--description", help="one line saying what the repository holds")
    parser.add_argument("--into", type=Path, help="the directory to render into (default: <superrepo>/<name>)")
    parser.add_argument(
        "--update", action="store_true", help="merge the kit's change since the last render into a rendered repository"
    )
    parser.add_argument(
        "--uncommitted",
        action="store_true",
        help="render the superrepo's working tree rather than its committed HEAD, to try a kit change; "
        "the record it leaves is not for committing",
    )
    parser.add_argument(
        "--source", type=Path, default=SUPERREPO, help="the superrepo to render from (default: this one)"
    )
    args = parser.parse_args(argv)
    root = args.into if args.into is not None else args.source / args.name
    try:
        if args.update:
            outcome = update(root, source=args.source, uncommitted=args.uncommitted)
            kind = str(read_record(root)["kind"])
        else:
            kind = args.kind or repositories().get(args.name)
            if kind is None:
                raise RenderError(f"{args.name} is not a known repository; they are {sorted(repositories())}")
            if not args.description:
                raise RenderError("--description is required for a first render")
            outcome = render(root, args.name, kind, args.description, source=args.source, uncommitted=args.uncommitted)
    except RenderError as error:
        print(f"render: {error}", file=sys.stderr)
        return 1
    for path in outcome.written:
        print(path)
    print(f"{'updated' if args.update else 'rendered'} {args.name} ({kind}) at {os.path.relpath(root)}")
    if args.uncommitted:
        print(
            "render: the record names a commit copier made up for the uncommitted kit; do not commit it",
            file=sys.stderr,
        )
    if outcome.conflicts:
        print("render: conflicts to settle before committing:", file=sys.stderr)
        for path in outcome.conflicts:
            print(f"    {path}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
