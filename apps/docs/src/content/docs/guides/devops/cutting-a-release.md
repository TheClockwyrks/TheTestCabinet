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

| What                                               | Reaches users by                                                         | Triggered by                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `tcab` and `gg`                                    | the tag's pipeline artifacts (`tcab`) and the `gg-releases` blobs (`gg`) | pushing the `vX.Y.Z` tag to Azure Repos                                    |
| The catalog (test cases, jams, references, errata) | the backend ingesting a **branch tip**                                   | merging to `master`, whose deploy restarts the backend and re-ingests      |
| The running services                               | the Azure pipeline's deploy of a commit                                  | merging to `master`                                                        |
| The gallery and the docs                           | a Cloudflare Pages build                                                 | a push to `master` (docs) and the backend's snapshot deploy hook (gallery) |

The version tag governs only the binaries. The catalog and the services ship
because the pipeline deployed a merge commit, and nothing else in the system
reads the tag. A release is "these four are at the same commit", not "the tag
was pushed".

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

Each backend ingests its catalog from a stable **branch**, never a tag —
`staging` for staging, `master` for prod (`TCAB_INGEST_BRANCH` in
`scripts/lib/env.sh`). Every merge to either branch deploys its commit's images,
which restarts the backend, and the backend's ingest sidecar force-ingests the
branch tip on start, so code and catalog ship together.
`scripts/reingest-cluster.sh` republishes the catalog between deploys.

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
grep -rln "experimental" test-cases/ game-jams/ --include=*.toml
```

Every version you un-flag is publicly runnable the moment prod re-ingests.

### Reference implementations, and the release gate

Every reference-capable case must ship its
[reference implementation](/components/core/results/#reference-implementations) by
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
# wrote. The baselines land in the cold-storage submodule, which is committed and
# pushed first so the superproject pins a commit its master already holds.
git submodule update --init --depth 1 cold-storage
tcab publish-reference --env prod <slug> && \
  git -C cold-storage switch -C master && \
  git -C cold-storage add test-cases && \
  git -C cold-storage commit -m "feat: recapture <slug> baselines" && \
  git -C cold-storage push origin master && \
  git add cold-storage test-cases/reference-builds.lock.json && \
  git commit -m "chore(references): update reference implementations"
```

Then verify the gate mechanically, rather than from memory — every
non-experimental variant that declares a `reference_implementation` must have a
`prod` entry in the lockfile:

```sh
python3 - <<'PY'
import json, pathlib, tomllib
lock = json.load(open("test-cases/reference-builds.lock.json"))["prod"]
for m in sorted(pathlib.Path("test-cases").rglob("test-case.toml")):
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

`crates/gg` and `crates/core` carry the release version, and a test pins them to
each other. Bump both to `X.Y.Z` on the release branch. The tag's pipeline run
fails its gates when `gg --version` differs from the tag with its `v` stripped,
naming the two crates, so a missed bump surfaces on the tag rather than in a
deployment. See [Releasing `gg`](/development/releasing/#releasing-gg).

### Green CI

The Azure pipeline gates every push on Linux and Windows. Frozen versions need
no action: [the `.frozen` gate](/development/frozen-versions/) is enforced by
the commit hook and by CI, so a green pipeline already proves no version with
runs against it was edited.

## Phase 2 — Rehearse on staging

Merge `nightly` into `staging` as `vX.Y.Z-rcN`. Staging is a faithful mirror of
prod — same manifests, differing only in namespace, `TCAB_ENV`, secrets, and the
resources they point at — so it is a real rehearsal of everything Phase 3 will
do to production, and its tip is what Phase 3 promotes.

1. **Let the pipeline deploy it.** The merge commit runs the gates, the GitHub
   mirror, the `images` stage, which builds every service and run-container
   image at the rc sha, and `deploy_staging`, which rolls the staging cluster to
   them and waits for every rollout. The mechanics are identical to
   [rolling prod](/guides/devops/rolling-prod-service-images/), with the staging
   cluster and namespace. The run images recompile Rust and wasm, so the
   `images` stage is the slow part.
2. **Confirm the catalog.** The deploy restarts the backend, whose ingest
   sidecar force-ingests the `staging` tip. That is what makes the merged catalog
   visible, including the cases that just stopped being experimental.
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

1. **Confirm the prod roll.** The merge commit's pipeline run builds every image
   at the release sha and `deploy_prod` rolls `tcab-prod` to them, service images
   and run images together. Full walkthrough:
   [Rolling Production Service Images](/guides/devops/rolling-prod-service-images/).
2. **Confirm the catalog.** The roll restarts the backend, whose ingest sidecar
   force-ingests the `master` tip. That publishes the release's test-case work:
   new versions, graduated cases, errata, and the reference-build URLs from the
   committed lockfile. A whole-catalog forced ingest also prunes versions the
   checkout no longer declares (except any a published run still references), so
   a case deleted in this release disappears here.
3. **Let the sites rebuild.** Both are automatic, for different reasons:
   - The **docs** deploy from the pipeline's `docs` job on every `master` build
     that reaches the `deploy` stage.
   - The **gallery** rebuilds because an ingest that actually changed something
     queues a snapshot refresh, and the backend fires the Pages deploy hook after
     uploading the snapshot. A no-op ingest queues nothing, so if the gallery
     does not move, check that the re-ingest reported work before suspecting the
     hook.

The same run's `mirror` job pushes the merge commit to the GitHub mirror once
it passes the gates.

## Phase 4 — Tag the release

Once the `master` run is green, tag its merge commit in Azure Repos and push the
tag:

```sh
git switch master && git pull
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z      # origin is the Azure Repos remote
```

The tag's pipeline run:

1. **Gates the commit again**, including the gg version gate.
2. **Publishes `tcab`.** The `binary` job release-builds and smoke-tests `tcab`
   on Linux and Windows and keeps each binary as the run's `tcab-linux` and
   `tcab-windows` artifacts.
3. **Publishes `gg`.** `gg_publish` uploads both static gg binaries and
   `gg-reference.tar.gz` to `gg-releases/vX.Y.Z/` and reads each back.
4. **Mirrors the tag.** The `mirror` job pushes it to the GitHub mirror.

The tag run builds no images and deploys nothing, because `master` already did.

### Verify

- `git ls-remote` shows `vX.Y.Z` at the same commit on Azure Repos and on the
  GitHub mirror.
- The tag's pipeline run carries the `tcab-linux` and `tcab-windows` artifacts.
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
test-cases/<type>/<difficulty>/<slug>/vX.Y.Z` — at the moment you trigger that
  first run, not later. See [Frozen Versions](/development/frozen-versions/).
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
| The tag's run fails "gg version matches the tag"               | `crates/gg` and `crates/core` were not bumped to the tag's version. Bump both on `nightly`, promote again, and tag the new `master` commit.     |
| A graduated case is missing its **Reference** tab              | The lockfile has no `prod` entry for that variant, or prod has not re-ingested since it gained one.                                             |
| The gallery still shows the old catalog                        | The re-ingest was a no-op (nothing changed), so no snapshot refresh and no deploy hook.                                                         |
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
