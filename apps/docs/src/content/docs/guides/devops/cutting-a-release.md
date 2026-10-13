---
title: Cutting a Release
---

A release of The Test Cabinet is not one button. Four independent things ship,
each by its own path and on its own trigger, and a release is the act of moving
all four to the same commit and confirming they agree. This guide is the whole
sequence, in order, with the reasoning for each step; the
[Cut a Release](/quickstarts/devops/cut-a-release/) quickstart is the terse version
for someone who has done it before.

It links to the mechanics documented elsewhere rather than restating them:
[Releasing](/development/releasing/) for what a tag publishes and the Cloudflare
Pages topology,
[Rolling Production Service Images](/guides/devops/rolling-prod-service-images/)
for the cluster roll, and
[Publishing a Reference Implementation](/guides/devops/publishing-a-reference-implementation/)
for the answer keys.

## What ships, and by what path

| What                                               | Reaches users by                                                                                                                                                    | Triggered by                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `tcab`, `gg` and the operator client               | each repository's tag run: `tcab` as `microservice-driver`'s pipeline artifacts, `gg` as the `gg-releases` blobs, the client as `client-tauri`'s pipeline artifacts | pushing a `vX.Y.Z` tag to each of those repositories' `master` in Azure Repos       |
| The catalog (test cases, jams, references, errata) | the backend ingesting a **branch tip**                                                                                                                              | merging to `master`, whose deploy restarts the backend and re-ingests               |
| The running services                               | the Azure pipeline's deploy of a commit                                                                                                                             | merging to `master`                                                                 |
| The docs and the gallery's dataset                 | a Cloudflare Pages build (docs) and the index objects in the public bucket (gallery)                                                                                | a push to `master` (docs) and an ingest or publish that changed something (gallery) |

The version tags govern only the binaries, and a tag of the superrepo runs
nothing. The catalog and the services ship because the pipeline deployed a
merge commit, and nothing else in the system reads a tag. A release is "these
four are at the same commit", not "the tags were pushed".

## What is _not_ a release step

- **The model catalog is not a release artifact.** Models are curated in the app
  and served from the backend; see
  [Adding or Updating a Model](/guides/devops/adding-or-updating-a-model/).
- **The generated contract artifacts need no regeneration pass.** CI regenerates
  the TypeScript bindings and JSON Schemas and fails on any diff, so a green
  pipeline already proves they match the Rust source.

## The branch flow

A release's work is done on its `rel/vX.Y.Z` branch and merged into `nightly`,
which is the integration branch every release is cut from. From there it reaches
the two deployed environments by being merged, in order, into the branch each one
tracks — and `master` is promoted from `staging`, so the released tree is
literally the one that was rehearsed:

```text
rel/vX.Y.Z ──▶ nightly ──▶ staging ──▶ master
   the work    integration   rehearsal   release
                            (vX.Y.Z-rcN)  (vX.Y.Z)
```

Those PR titles are the convention: each staging merge is a release candidate
(`vX.Y.Z-rc1`, `-rc2`, …) and the final promotion into `master` is `vX.Y.Z`. A
fix found during the rehearsal goes back through the same route — onto `nightly`,
then a fresh rc into `staging` — rather than being applied to `staging` directly,
so the branches never diverge.

Each backend ingests its catalog from a stable **branch** of the `test-suites`
repository, never a tag — `staging` for staging, `master` for prod
(`TCAB_INGEST_BRANCH`). A release's catalog work moves through the same branch
flow in that repository. Every merge to either superrepo branch deploys its
commit's deploy set, and a deploy that moves the backend's pin restarts the
backend, whose ingest sidecar force-ingests the `test-suites` branch tip on
start, so code and catalog ship together. `tcab ingest --env <env> --changed`
republishes the catalog after any other deploy and between deploys.

## Phase 1 — Prepare the release on `nightly`

All of this belongs on the release's `rel/vX.Y.Z` branch and merged into
`nightly` before anything reaches `staging`.

### The changelog

Add `apps/docs/src/content/docs/changelogs/vX.Y.Z.md` — title `vX.Y.Z
(YYYY-MM-DD)`, `slug: changelogs/vX.Y.Z` — and **register it in the sidebar**:
the `Changelogs` group in `apps/docs/astro.config.mjs` lists every page
explicitly, newest first. A changelog that is not listed there is published but
unreachable, which is the single easiest thing to forget in this whole process.

### Cases graduating out of experimental

A case being iterated on carries `experimental = true` in its `test-case.toml`,
which hides it from the catalog and refuses to resolve it for new runs unless the
deployment sets `TCAB_BACKEND_ALLOW_EXPERIMENTAL` (the local cluster does;
production does not). A release is where those flags come off — and removing one
is what makes that case's other release obligations real, so do it first:

```sh
grep -rln "experimental" test-suites/test-cases/ test-suites/game-jams/ --include=*.toml
```

Every version you un-flag is publicly runnable the moment prod re-ingests.

### Reference implementations, and the release gate

Every reference-capable case must ship its
[reference implementation](/components/backend/results/#reference-implementations) by
the release that makes it non-experimental — a case graduating without its answer
key means the case page has no **Reference** tab and reviewers have no baseline to
compare against. Republish any whose reference implementation or debug scripts
changed, too: `tcab publish-reference` re-captures the committed
[validation baselines](/guides/devops/publishing-a-reference-implementation/#baseline-validation-media)
as part of the build, so a case whose scripts moved in this release needs its
baselines regenerated or reviewers see a side-by-side against media captured from
an older script.

```sh
# Per case; commits nothing itself. The publish exits non-zero if any reference
# build failed to build, capture its baselines, or deploy, so the commits are
# chained onto it rather than run over media and a lockfile a failed sweep half
# wrote. The baselines land in the cold-storage repository and the lockfile in
# test-suites; each is committed and pushed, then the superrepo's pointers move.
git submodule update --init --depth 1 cold-storage
tcab publish-reference --env prod <slug> && \
  git -C cold-storage switch -C master && \
  git -C cold-storage add test-cases && \
  git -C cold-storage commit -m "feat: recapture <slug> baselines" && \
  git -C cold-storage push origin master && \
  git -C test-suites add test-cases/reference-builds.lock.json && \
  git -C test-suites commit -m "chore(references): update reference implementations" && \
  git -C test-suites push && \
  git add cold-storage test-suites && \
  git commit -m "chore(references): update reference implementations"
```

Then verify the gate mechanically, rather than from memory — every
non-experimental variant that declares a `reference_implementation` must have a
`prod` entry in the lockfile:

```sh
python3 - <<'PY'
import json, pathlib, tomllib
lock = json.load(open("test-suites/test-cases/reference-builds.lock.json"))["prod"]
for m in sorted(pathlib.Path("test-suites/test-cases").rglob("test-case.toml")):
    case = tomllib.load(open(m, "rb"))
    if case.get("experimental"):
        continue
    slug, version = case.get("slug", m.parent.parent.name), m.parent.name
    for v in sorted((m.parent / "variants").glob("*.toml")):
        variant = tomllib.load(open(v, "rb"))
        if "reference_implementation" not in variant:
            continue
        name = variant.get("slug", v.stem)
        if "build" not in case:
            print(f"script reference (R2, not the lockfile): {slug} {version} {name}")
        elif not lock.get(slug, {}).get(version, {}).get(name):
            print(f"MISSING: {slug} {version} {name}")
PY
```

Silence means the gate passes. An
[asset-generation](/testing/asset-generation/overview/) case's reference is a
script whose frames are uploaded to R2 rather than recorded in the lockfile, so it
is reported separately — confirm those by re-running `publish-reference` for the
case, which overwrites the objects in place.

### Errata

If this release _acknowledges_ a known issue in a version that has already shipped
rather than fixing it in a new version, that is an
[erratum](/guides/devops/authoring-errata/), authored beside the version's
manifest. Errata ride the catalog, so they land with the same re-ingest as
everything else — no separate deploy.

### The version

gg's crate carries the release version. Bump it to `X.Y.Z` on the release
branch. gg's tag run fails when `gg --version` differs from the tag with its
`v` stripped, so a missed bump surfaces on the tag rather than in a deployment.
The driver declares the gg release it runs as a pin independent of any crate
version, and that pin moves to `vX.Y.Z` in the release that follows the tag's
publish. See
[Releasing `gg`](/development/releasing/#releasing-gg).

### Green CI

The Azure pipeline gates every push on Linux and Windows. Frozen versions need
no action: [the `frozen-paths` gate](/development/frozen-versions/) is enforced
by the commit hook and by CI, so a green pipeline already proves no version with
runs against it was edited.

## Phase 2 — Rehearse on staging

Merge `nightly` into `staging` as `vX.Y.Z-rcN`. Staging is a faithful mirror of
prod — same manifests, differing only in namespace, `TCAB_ENV`, secrets, and the
resources they point at — so it is a real rehearsal of everything Phase 3 will
do to production, and its tip is what Phase 3 promotes.

1. **Let the pipeline deploy it.** The merge commit runs the gates, then the
   GitHub mirror, then the workspace template's `deploy` stage, which pins the
   `staging` overlay to the commits the superrepo's submodule pointers name,
   rolls the staging cluster onto that set and waits for every rollout. Each
   image was built by its repository's pipeline at the pinned commit, so the
   deploy builds nothing. The route differs from
   [rolling prod](/guides/devops/rolling-prod-service-images/) (see
   [Deploying](/deployment/kubernetes/overview/#deploying)), but the set, the
   overlay's content and the waits are the same, with the staging cluster and
   namespace.
2. **Confirm the catalog.** A deploy that moves the backend's pin restarts the
   backend, whose ingest sidecar force-ingests the `staging` tip; after any
   other deploy, `tcab ingest --env staging` does. That is what makes the
   merged catalog visible, including the cases that just stopped being
   experimental.
3. **Exercise it.** Enqueue runs of the cases that changed in this release,
   through the harness they will actually be run with, and review one end to end.
   A validator repair that was verified locally against a reference build is not
   the same evidence as a real run through the deployed driver.

Anything the rehearsal turns up goes back onto `nightly` and comes through as the
next rc, so the sha `master` is eventually promoted from is one that was actually
exercised here. Each rc merge deploys itself.

If you want the reference-publish flow rehearsed as well, `tcab publish-reference
--env staging <slug>` deploys to the staging Pages project and records under the
lockfile's `staging` key; prod and staging entries live side by side in the one
file and neither disturbs the other.

## Phase 3 — Land it in production

Promote `staging` into `master` as a `vX.Y.Z` PR. Promote the tree that was
rehearsed rather than a fresh merge from `nightly`.

1. **Confirm the prod roll.** The merge commit's pipeline run gates and
   mirrors the commit, and the `prod` stage's `deploy_prod` rolls `tcab-prod`
   onto the deploy set its submodule pointers name, service images and run
   images together, each built by its repository's pipeline at the pinned
   commit. Full walkthrough:
   [Rolling Production Service Images](/guides/devops/rolling-prod-service-images/).
2. **Confirm the catalog.** A roll that moves the backend's pin restarts the
   backend, whose ingest sidecar force-ingests the `master` tip; after any
   other roll, `tcab ingest --env prod` does. That publishes the release's
   test-case work:
   new versions, graduated cases, errata, and the reference-build URLs from the
   committed lockfile. A whole-catalog forced ingest also prunes versions the
   checkout no longer declares (except any a published run still references), so
   a case deleted in this release disappears here.
3. **Let the sites update.** Both are automatic, for different reasons:
   - The **docs** deploy from the pipeline's `docs` stage on every `master`
     build that passed the gates.
   - The **gallery** needs no rebuild. An ingest that actually changed something
     queues a snapshot refresh, which writes the updated documents and index
     objects to the public bucket through the artifacts service, and the static
     gallery reads them at runtime. A no-op ingest queues nothing, so if the
     gallery does not move, check that the re-ingest reported work.

The same run's `mirror` job pushes the merge commit to the GitHub mirror once
it passes the gates.

## Phase 4 — Tag the release

Once the `master` run is green, tag each releasing repository's `master` at the
commit the superrepo's submodule pointer names, and push each tag to Azure
Repos. A tag of the superrepo runs nothing; see
[Release tags](/development/releasing/#release-tags).

```sh
for repo in microservice-driver gg client-tauri; do
  git -C "$repo" switch master && git -C "$repo" pull
  git -C "$repo" tag -a vX.Y.Z -m "vX.Y.Z"
  git -C "$repo" push origin vX.Y.Z      # origin is the Azure Repos remote
done
```

Each tag runs its repository's own pipeline: the gates, then the release jobs
of its kind, then the mirror of the tag to GitHub.

1. **`microservice-driver` publishes `tcab`.** Its release jobs release-build
   and smoke-test `tcab` and keep each binary as the run's `tcab-linux` and
   `tcab-windows` artifacts.
2. **`gg` publishes gg.** Its release jobs rebuild both static binaries and fail
   when `gg --version` differs from the tag; `gg_publish` then uploads both and
   `gg-reference.tar.gz` to `gg-releases/vX.Y.Z/` and reads each back.
3. **`client-tauri` publishes the operator client.** Its release jobs build a
   bundle per target and keep each as a `client-*` artifact of the run.

A tag's run builds no images and deploys nothing, because `master` already did.

### Verify

- `git ls-remote` shows `vX.Y.Z` at the same commit on Azure Repos and on the
  GitHub mirror, for each tagged repository.
- `microservice-driver`'s tag run carries the `tcab-linux` and `tcab-windows`
  artifacts, and `client-tauri`'s the `client-*` bundles.
- `https://testcabinetartifacts.blob.core.windows.net/gg-releases/vX.Y.Z/` holds
  both gg binaries and `gg-reference.tar.gz`.
- `docs.testcabinet.ai` serves the new changelog **and** links it in the sidebar.
- `testcabinet.ai` shows the cases that graduated this release, each with a
  working **Reference** tab.
- The console can enqueue a run of a graduated case, which is the sharpest
  single check that the catalog, the images, and the run containers agree.
- Every `tcab-*` workload in `tcab-prod` reports the release sha.

## After the release

- **Freeze each version as its first run lands.** `scripts/freeze.sh
test-suites/test-cases/<type>/<difficulty>/<slug>/vX.Y.Z` — at the moment you
  trigger that first run, not later. See
  [Frozen Versions](/development/frozen-versions/).
- **A problem found in a shipped version is an erratum, not an edit.** Editing a
  version with runs against it invalidates them silently, which is exactly what
  the frozen gate exists to prevent.
- **A hotfix is just a smaller release**: the same four phases at
  `vX.Y.Z+1`. There is no shortcut path that skips the staging rehearsal, because
  the rehearsal is the only place a broken driver or a mis-ingested case surfaces
  before users see it.

## Gotchas

| Symptom                                                        | Cause                                                                                                                                           |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| The changelog is live but nothing links to it                  | Not added to the `Changelogs` sidebar group in `apps/docs/astro.config.mjs`.                                                                    |
| gg's tag run fails "gg version matches the tag"                | gg's crate was not bumped to the tag's version. Bump it on `nightly`, promote again, and tag gg's new `master` commit.                          |
| A graduated case is missing its **Reference** tab              | The lockfile has no `prod` entry for that variant, or prod has not re-ingested since it gained one.                                             |
| The gallery still shows the old catalog                        | The re-ingest was a no-op (nothing changed), so no snapshot refresh wrote new index objects.                                                    |
| Reviewers see baselines that disagree with the current scripts | Scripts changed without a `publish-reference` / `tcab capture-baselines` pass on that case.                                                     |
| Prod runs behave like the old code                             | `deploy_prod` failed and undid a rollout, leaving that workload on its previous image; its job log carries the workload's description and logs. |

## Next steps

- [Cut a Release](/quickstarts/devops/cut-a-release/): the same sequence as
  copy-paste commands.
- [Releasing](/development/releasing/): what a tag publishes, the gg release
  host, and the one-time Cloudflare Pages setup behind each static site.
- [Rolling Production Service Images](/guides/devops/rolling-prod-service-images/):
  the cluster half of Phase 3, and rolling back.
- [Publishing a Reference Implementation](/guides/devops/publishing-a-reference-implementation/):
  the reference flow and the non-experimental gate it enforces.
