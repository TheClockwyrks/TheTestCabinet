---
title: Cutting a Release
---

A release of The Test Cabinet is not one button. Four independent things ship,
each by its own path and on its own trigger, and a release is the act of moving
all four to the same commit and confirming they agree. This guide is the whole
sequence, in order, with the reasoning for each step; the
[Cut a Release](/quickstarts/devops/cut-a-release/) quickstart is the terse version
for someone who has done it before.

It assumes the mechanics documented elsewhere and links to them rather than
restating them: [Releasing](/development/releasing/) for the two GitHub Release
workflows and the Cloudflare Pages topology,
[Rolling Production Service Images](/guides/devops/rolling-prod-service-images/)
for the cluster roll, and
[Publishing a Reference Implementation](/guides/devops/publishing-a-reference-implementation/)
for the answer keys.

## What ships, and by what path

| What | Reaches users by | Triggered by |
| --- | --- | --- |
| `tcab`, the services, the desktop app | a GitHub release at `vX.Y.Z` | the **Release** + **Release (promote)** workflows, by hand |
| The catalog (test cases, jams, references, errata) | the backend ingesting a **branch tip** | merging to `master`, then `scripts/reingest-cluster.sh --env prod` |
| The running services | a **git-sha** pinned in the prod overlay | re-pinning `overlays/azure-prod` and applying it |
| The gallery and the docs | a Cloudflare Pages build | a push to `master` (docs) and the backend's snapshot deploy hook (gallery) |

The important consequence: **the version tag governs only the downloadable
artifacts.** Nothing else in the system knows about `v0.6.1`. The catalog ships
because a branch moved; the services ship because a sha was pinned. A release is
"these four are at the same commit", not "the tag was pushed".

## What is *not* a release step

- **There is no version to bump.** The Cargo workspace stays at `version =
  "0.0.0"` and `tauri.conf.json` at `"0.0.0"`; the Release workflow stamps the
  desktop app's version from its `version` input, and the tag itself is the
  version. Nothing in the repository names the release except the changelog.
- **There is no tag to push.** The Release workflow's `gh release create
  --target <sha>` creates the tag at the commit it was dispatched on.
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
`scripts/lib/env.sh`). Service **code** is pinned separately by sha in the
overlay. That split is why a test-case-only change can ship to prod with a
re-ingest and no cluster roll, and why a code change needs the roll even though
the catalog did not move.

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
tcab publish-reference --env prod <slug>          # per case; commits nothing itself
git add test-cases/reference-builds.lock.json
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

If this release *acknowledges* a known issue in a version that has already shipped
rather than fixing it in a new version, that is an
[erratum](/guides/devops/authoring-errata/), authored beside the version's
manifest. Errata ride the catalog, so they land with the same re-ingest as
everything else — no separate deploy.

### Green CI, including macOS

Azure is the primary CI and covers Linux and Windows on every push. It has **no
macOS agents**, so the macOS binary is validated on demand: dispatch
`binary-macos.yml` before you cut. Skipping it means the first macOS build of the
release is the one being published to users.

Frozen versions need no action — [the `.frozen` gate](/development/frozen-versions/)
is enforced by the commit hook and by CI, so a green pipeline already proves no
version with runs against it was edited.

## Phase 2 — Rehearse on staging

Merge `nightly` into `staging` as `vX.Y.Z-rcN`. Staging is a faithful mirror of
prod — same manifests, differing only in namespace, `TCAB_ENV`, secrets, and image
tags — so it is a real rehearsal of everything Phase 4 will do to production, and
its tip is what gets promoted in Phase 3.

1. **Let CI build the images.** Both `build-service-images.yml` and
   `build-containers.yml` run on **every** push to `staging`, unfiltered, each
   tagging `:latest` and `:<git-sha>`. So every rc sha carries a complete set —
   services *and* run containers — and the sha you rehearse on is one you can pin
   everything to. (`build-containers` is the slow one; it recompiles Rust and wasm
   uncached, so give it time before re-pinning.)
2. **Re-pin `overlays/azure-staging`** to the new sha (the `images:` block plus
   the two env-value image refs, `TCAB_CONTAINER_TAG` among them), apply it, and
   confirm the rollout. The mechanics
   are identical to
   [rolling prod](/guides/devops/rolling-prod-service-images/), with the staging
   cluster and namespace.
3. **Re-ingest:** `scripts/reingest-cluster.sh --env staging`. This is what makes
   the merged catalog visible — including the cases that just stopped being
   experimental.
4. **Exercise it.** Enqueue runs of the cases that changed in this release,
   through the harness they will actually be run with, and review one end to end.
   A validator repair that was verified locally against a reference build is not
   the same evidence as a real run through the deployed driver.

Anything the rehearsal turns up goes back onto `nightly` and comes through as the
next rc, so the sha `master` is eventually promoted from is one that was actually
exercised here. Re-pin and re-apply staging for each rc that changes service code.

If you want the reference-publish flow rehearsed as well, `tcab publish-reference
--env staging <slug>` deploys to the staging Pages project and records under the
lockfile's `staging` key; prod and staging entries live side by side in the one
file and neither disturbs the other.

## Phase 3 — Cut the artifacts on GitHub

Promote `staging` into `master` as a `vX.Y.Z` PR — the tree that was rehearsed,
not a fresh merge from `nightly` — and make sure the **GitHub mirror** carries
that merge commit; public releases are cut on GitHub because the Azure DevOps
repository is private, and every release workflow lives there:

```sh
git push gh master
```

Then, in order:

1. **Wait for the image workflows to publish at the master sha.** The Release
   workflow bakes `TCAB_DESKTOP_IMAGE_TAG=<sha>` into the desktop app, which is how
   the self-contained cluster the app stands up pins the images it pulls; if no
   images exist at that sha, the shipped app cannot pull anything. Both workflows
   run **unfiltered** on every `master` push, so the merge always publishes at this
   sha regardless of what it touched — there is nothing to dispatch by hand, only
   a run to wait for. Release also refuses to build the desktop app until those
   images resolve (its `images` job), so a premature dispatch fails in CI in
   seconds rather than in a user's hands at first launch.
2. **Dispatch the Release workflow** on `master` with `version = vX.Y.Z`. It
   builds the five headless binaries for Linux (static musl), Windows, and macOS,
   smoke-tests every platform's `tcab`, builds the desktop installers, and
   publishes the lot — plus a `SHA256SUMS` — as a **prerelease**, creating the tag
   at that commit. Re-running for the same tag refreshes its assets.
3. **Download and exercise the artifacts.** The binaries are smoke-tested in the
   workflow; the servers and the desktop app are not, and this is the only gate
   they get. On macOS the app is
   [unsigned](/development/releasing/#macos-the-desktop-app-is-unsigned) and needs
   its quarantine attribute cleared — the prerelease notes say so, but confirm the
   note is there.
4. **Dispatch Release (promote)** with the same tag. It flips the prerelease to
   the latest full release without rebuilding, so exactly what you tested is what
   ships.

## Phase 4 — Land it in production

The GitHub release is downloads. Production is still on the previous sha and the
previous catalog until you move it.

1. **Roll the prod service images** to the release sha — re-pin the three files in
   `overlays/azure-prod`, preview, apply, verify, commit. Full walkthrough:
   [Rolling Production Service Images](/guides/devops/rolling-prod-service-images/).
   Advance `TCAB_CONTAINER_TAG` to the same sha: `build-containers` runs on every
   `master` push too, so the release sha carries run images as well and the two
   pins move together.
2. **Re-ingest the catalog:** `scripts/reingest-cluster.sh --env prod`. This is
   the step that publishes the release's test-case work — new versions, graduated
   cases, errata, and the reference-build URLs from the committed lockfile. A
   whole-catalog re-ingest also prunes versions the checkout no longer declares
   (except any a published run still references), so a case deleted in this
   release disappears here.
3. **Let the sites rebuild.** Both are automatic, but for different reasons, and
   both are worth watching:
   - The **docs** deploy from `deploy-docs.yml` on a push to `master` that touched
     `apps/docs/**` — which a release always does, because of the changelog. If a
     release somehow carried no docs change, dispatch the workflow by hand.
   - The **gallery** rebuilds because an ingest that actually changed something
     queues a snapshot refresh, and the backend fires the Pages deploy hook after
     uploading the snapshot. A no-op ingest queues nothing — so if the gallery
     does not move, check that the re-ingest reported work rather than assuming
     the hook failed.

### Verify

- The GitHub release for `vX.Y.Z` is marked **Latest**, is not a prerelease, and
  carries every platform's archives, the installers, and `SHA256SUMS`.
- `docs.testcabinet.ai` serves the new changelog **and** links it in the sidebar.
- `testcabinet.ai` shows the cases that graduated this release, each with a
  working **Reference** tab.
- The console can enqueue a run of a graduated case — the sharpest single check
  that the catalog, the images, and the run containers agree.
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

| Symptom | Cause |
| --- | --- |
| The changelog is live but nothing links to it | Not added to the `Changelogs` sidebar group in `apps/docs/astro.config.mjs`. |
| The Release workflow fails at `Verify service images exist at this commit` | Dispatched before `build-service-images` finished at that sha, or that run failed. Wait for it (or fix and re-run it), then re-dispatch — never work around the gate; it is the only thing between a bad sha and an installer that dies at first launch. |
| A graduated case is missing its **Reference** tab | The lockfile has no `prod` entry for that variant, or prod has not re-ingested since it gained one. |
| The gallery still shows the old catalog | The re-ingest was a no-op (nothing changed), so no snapshot refresh and no deploy hook. |
| Reviewers see baselines that disagree with the current scripts | Scripts changed without a `publish-reference` / `tcab capture-baselines` pass on that case. |
| Prod runs behave like the old code | Images rolled but not re-ingested, or re-ingested but not rolled — the two are separate steps by design. |

## Next steps

- [Cut a Release](/quickstarts/devops/cut-a-release/) — the same sequence as
  copy-paste commands.
- [Releasing](/development/releasing/) — the Release workflows, the macOS signing
  gap, and the one-time Cloudflare Pages setup behind each static site.
- [Rolling Production Service Images](/guides/devops/rolling-prod-service-images/)
  — the cluster half of Phase 4 in full.
- [Publishing a Reference Implementation](/guides/devops/publishing-a-reference-implementation/)
  — the reference flow and the non-experimental gate it enforces.
