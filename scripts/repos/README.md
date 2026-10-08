# Repository scripts

The scripts that turn the repository kit under `templates/repository/` into a
repository of The Test Cabinet, merge a kit change into one, and derive what
follows from where the repositories live, each with its test beside it. Every
one of them runs from the `ci` uv project, which carries copier:

```sh
uv run --project ci scripts/repos/render.py contracts \
  --description "The data contracts every component reads and writes."
scripts/repos/bootstrap.sh contracts
uv run --project ci scripts/repos/render.py --update contracts
```

The [Repositories](../../apps/docs/src/content/docs/development/repositories.md)
development page is the authoritative account of the repositories, their
edges and the kit; this file says what each script does.

| Script | What it does |
| --- | --- |
| `render.py <name> --description "..."` | Renders the kit into `<superrepo>/<name>` through `copier copy`, answering the template's three questions (`name`, `kind`, `description`) from the arguments and the table of repositories. Leaves `.copier-answers.yml`, which copier maintains, and `.test-cabinet-repo.toml`, rendered for the `dependency-edges` gate. `--into` names another directory, `--source` another superrepo to render from. |
| `render.py --update <name>` | Merges the kit's change since the repository's last render into it through `copier update`: a three-way merge of the template rendered at the recorded commit and at the current one, with inline conflict markers where both sides changed a line. Refuses a dirty working tree. |
| `context.py` | The template's context extension, named in `copier.yml`. Every value a file derives from the three answers (the crate, the workspace's dependencies, the pipeline's resources and images) is computed here from the tables `render.py` and the kit's `edges.py` hold, so none is recorded as an answer. |
| `bootstrap.sh <name>` | Makes a rendered directory a repository on `master`, resolves an application's `Cargo.lock` outside the patch table, commits it, pushes it to the remote of the same name beside the superrepo's own, and adds it as a submodule by a relative URL. Every step is skipped once it has happened. |
| `protect.py [--like <repository>] [--dry-run] <name>...` | Gives a repository on Azure DevOps its long-lived branches and their policies: creates `staging` and `nightly` at `master`, and copies the policies the superrepo carries, those on its `master` onto `master` and `staging` and those on the repository as a whole. The build validation names the pipeline called after the repository and is left out while there is none. Every step is skipped once it has happened. |
| `sources.py patch-table [--write]` | The `[patch]` tables of the superrepo's `.cargo/config.toml`, between two marker lines that leave the file's aliases and build settings alone: one per repository carrying a crate, from its public source to the sibling checkout, a comment while the repository is not checked out. |
| `sources.py package-links [--write]` | The superrepo's `.package-links.json`, the npm counterpart of the patch table: every package the npm workspace at the root of each checked-out repository produces, and its directory. A repository that is not checked out keeps the entries the file holds for it. |
| `sources.py link-plan` | The steps that link every checked-out workspace naming a package another repository produces, from the written table: `install` a workspace with the directories of its links and `build` a producer before anything that links it, one tab-separated line each. |
| `link-packages.sh` | Writes the table and runs the plan: a workspace with links is checked against its lock by a dry run of `npm ci`, then installed with `npm install --no-save --install-links=false` and the producers' directories, so each linked package is a symlink to the sibling checkout, no linked version is fetched from the feed and the manifests and the lock stay as committed. Run it again after a repository gains a package or a workspace. |
| `sources.py rewrites [--apply \| --env]` | The git rewrites sending a fetch of each public source to the Azure remote, printed as `git config` commands, applied to the user's configuration, or printed as `GIT_CONFIG_*` environment. |
| `sources.py mirror <name>` | The GitHub name of a repository, such as `TheTestCabinet` for the superrepo. |

## The template

`copier.yml` at the superrepo root declares the kit as a copier template,
because copier reads a template's configuration from the root of its git
repository and records that repository's commit as the version a rendered
repository was made from. `_subdirectory` names `templates/repository/` as the
tree rendered. A file whose name ends in `.jinja` is a Jinja template and every
other file is copied as it is; every path is rendered, which is how a file some
kinds alone carry is named, such as
`ci/gates/{% if typescript_workspace %}typescript.py{% endif %}.jinja`, a name
that renders to nothing for a kind without the gate and so is skipped. A set of
files a kind leaves out is listed under `_exclude` in a block conditional on a
derived value: a kind carrying no Rust crate (`rust_crate`) is rendered no
workspace, no Rust configuration and no Rust gate.

The superrepo's own `.copier-answers.yml` is unrelated: it records the fleet's
workspace template the superrepo is rendered from, and `copier update` of the
superrepo reads its template from there.

The kinds are `library`, `application`, `site` and `content`, the table
`edges.py` in the kit's `ci` library holds with each repository's kind and the
edges between them; the render reads it for the workspace it writes and the
rendered `dependency-edges` gate reads it to hold the repository to it.
`render.py` holds what the kit derives beside it: the crate each repository
carrying one is scaffolded with (`CRATES`, directories and names kept from the
monorepo), the Rust track (`RUST_TRACKS`: the repositories whose suite drives a
browser run in the `rust-browser` image), the image pins (`ciImageTag` from
`ci/images/tags.yml`), the feed (`FEED_REGISTRY`), the long-lived branches
(`BRANCHES`) and the release tags each dependent pins (`TAGS`).

## The two records

`.copier-answers.yml` holds the three answers, `_src_path`, which is `..` for a
repository checked out inside the superrepo and so resolves on every machine,
and `_commit`, the superrepo commit the repository was last rendered or updated
from, which is what the next update merges from. `.test-cabinet-repo.toml` is
rendered from the answers for the `dependency-edges` gate in every repository,
the superrepo's `dependency-graph` gate and `bootstrap.sh`, each of which has
the standard library alone.

The kit is rendered at the superrepo's committed `HEAD`, named by its hash, so
`_commit` names a commit that exists. `--uncommitted` renders the working tree
instead, which is how a kit change is tried against a repository before it is
committed; the record such a render leaves is not for committing.

## Tests

`test_render.py`, `test_sources.py`, `test_protect.py` and
`test_link_packages_npm.py` run under the `ci-tests` gate, and
`bootstrap.test.sh` and `link-packages.test.sh` under `shell-tests`.
`test_render.py` renders from a small superrepo of its own (`conftest.py`),
since a render clones the superrepo it renders and this one is the whole
monorepo, and runs each kind's rendered `ci/tests` inside the render.
`test_link_packages_npm.py` runs `link-packages.sh` with the real npm, offline,
against a throwaway superrepo.
