# The Test Suites Checkout Is A Submodule

Make `test-suites/` a real git submodule with a populated checkout, so The Spec
Cabinet has a tree to author into and The Test Cabinet has one to ingest from.

## Current state

`test-suites/` holds a tracked `.gitkeep` and nothing else, there is no
`.gitmodules`, and the suites repository does not exist yet.

No gate reads the tree. Every job in `.github/workflows/ci.yml` and every job in
`azure-pipelines.yml` takes a plain checkout with no submodule option.
`scripts/format-check.mjs` hands prettier the output of `git ls-files`, where a
submodule is a single gitlink rather than its files, and `.markdownlint-cli2.yaml`
and `cspell.json` are scoped by allowlist globs over `test-cases/`, `game-jams/`,
`test-case-groups/` and the documentation site.

The documentation settles the shape. [Test
Suites](../../apps/docs/src/content/docs/test-suites/overview.md) states that
suites are authored in their own repository, included here as a submodule checked
out at `test-suites/`, releasing on a cadence independent of The Test Cabinet,
and that every path a suite page names is relative to the suites repository root.
[Test Suites](../../apps/docs/src/content/docs/the-spec-cabinet/test-suites.md)
states that the checkout is the only place The Spec Cabinet looks, and that a
save commits inside the submodule and moves the superproject pointer.

## Design

Create the suites repository in the same Azure DevOps organization as this one,
with an empty initial commit on the default branch and no suite content. The
first suite is authored through The Spec Cabinet once its service can reach a
checkout, so this issue delivers the plumbing and an empty tree.

Add the submodule at `test-suites/` and delete the `.gitkeep`. Record the remote
in `.gitmodules` in the same form as the superproject's own origin, so a
recursive clone authenticates with the credentials that already fetched the
superproject, and record the branch the submodule tracks so
`git submodule update --remote` has a meaning. The pointer is a commit like any
other submodule pointer, and that pointer is what names the suite state a Spec
Cabinet save produced.

The suites repository owns its own formatting and spelling. The superproject's
style gates already stop at the submodule boundary, so verify that behavior with
a populated checkout rather than adding ignore rules for it. A CI job takes a
submodule checkout with the issue that first gives its script a reason to read
the tree, which keeps every checkout in `.github/workflows/ci.yml` and
`azure-pipelines.yml` as it is here.

Check the hooks and the frozen gate against a populated checkout.
`scripts/setup-hooks.sh` installs the pre-commit and pre-push hooks, and
`scripts/lib/frozen.sh` reads `git ls-files` over the superproject index, where
the submodule appears as a gitlink. Confirm that no hook or gate walks into the
submodule expecting tracked files.

Confirm the cluster path rather than change it. `deployments/local/Makefile`
mounts the repository at `/repo` on the k3d server node, and
`deployments/k8s/overlays/local/patch-backend.yaml` mounts that into the backend
pod read-only at `/checkout`, so a populated submodule is visible in-cluster at
`/checkout/test-suites` with no mount change. The backend configuration that
points at that path belongs to
`tasks/test-suites/run-a-suite-on-the-local-cluster.md`.

Leave a fresh environment with a populated tree. The devcontainer's
`postCreateCommand` in `.devcontainer/devcontainer.json` populates the submodule
alongside the hook and toolchain steps it already runs, and the `Layout` section
of [`development/building.md`](../../apps/docs/src/content/docs/development/building.md)
names the clone and update commands for a clone made outside the container.

Suite reading, validation, and ingestion are out of scope here and belong to
`tasks/spec-cabinet/spec-cabinet-service.md` and
`tasks/test-suites/suite-ingestion.md`. This issue ends when a checkout exists
everywhere those issues expect one.

## Done when

- [ ] The suites repository exists with an empty initial commit on its default branch.
- [ ] `.gitmodules` records `test-suites/` with its URL and tracked branch, and the
      superproject commits a pointer into it.
- [ ] `test-suites/.gitkeep` is gone.
- [ ] `git clone --recurse-submodules` of the superproject populates `test-suites/`, and
      `git submodule update --init` populates it in an existing clone.
- [ ] `npm run lint:format` and `npm run lint:specs` report the same results with the
      submodule populated as they do with it empty.
- [ ] The pre-commit hooks, the pre-push hooks, and `scripts/ci/frozen-check.sh` pass with
      the submodule populated.
- [ ] The devcontainer creates a container whose `test-suites/` is populated.
- [ ] `make local-up` brings up a cluster whose backend pod lists the suites tree at
      `/checkout/test-suites`, with no change to the mounts declared under `deployments/`.
- [ ] `development/building.md` names the clone and update commands for the submodule.
- [ ] Gates green.
