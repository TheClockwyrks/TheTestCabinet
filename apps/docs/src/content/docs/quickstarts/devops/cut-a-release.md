---
title: Cut a Release
---

Ship `vX.Y.Z`: prepare the release branch, rehearse on staging, promote to
`master`, then tag the releasing repositories. The full walkthrough and the
reasoning behind each step are in
[Cutting a Release](/guides/devops/cutting-a-release/).

Four things ship on four paths, and the tags govern only the first: the
**binaries** (`tcab`, `gg` and the operator client, from each repository's tag
run), the
**catalog** (a
`test-suites` branch tip the backend re-ingests on every deploy), the
**services** (the pipeline's deploy of the merge commit), and the **sites** (a
Pages build for the docs, and the gallery's index objects in the public
bucket).

```text
rel/vX.Y.Z ──▶ nightly ──▶ staging ──▶ master ──▶ tag vX.Y.Z
   the work    integration  (vX.Y.Z-rcN)  (vX.Y.Z)
```

## Prerequisites

- Push access to the Azure Repos repository, where the tag is created.
- `az` logged in to the cluster subscription, for verifying the rolls, and the
  environment's Access service token for the re-ingests.
- `wrangler` with `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`, if any
  reference implementation needs publishing.

## 1. Prepare the release on `nightly`

Do this on the release's `rel/vX.Y.Z` branch and merge it into `nightly`.

```sh
# Changelog page — and REGISTER it in the sidebar, or nothing links to it.
$EDITOR apps/docs/src/content/docs/changelogs/vX.Y.Z.md   # title: vX.Y.Z (YYYY-MM-DD)
$EDITOR apps/docs/astro.config.mjs                        # Changelogs group, newest first

# Cases graduating out of experimental this release.
grep -rln "experimental" test-suites/test-cases/ test-suites/game-jams/ --include=*.toml

# Publish/republish their reference implementations, then commit the lockfile in
# test-suites. The publish exits non-zero if any reference build failed, so chain
# the commit onto it rather than committing a lockfile a failed sweep half wrote.
tcab publish-reference --env prod <slug> && \
  git -C test-suites add test-cases/reference-builds.lock.json && \
  git -C test-suites commit -m "chore(references): update reference implementations" && \
  git -C test-suites push
```

Verify the release gate — every non-experimental variant declaring a
`reference_implementation` has a `prod` lockfile entry. Silence means it passes:

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

Bump gg's crate to `X.Y.Z` in the same branch; the tag's version gate compares
against it. The driver's gg pin moves to `vX.Y.Z` once the tag has published.

```sh
$EDITOR gg/crates/gg/Cargo.toml                 # version = "X.Y.Z"
(cd gg && cargo check -p test-cabinet-gg)       # refreshes gg's Cargo.lock
```

## 2. Rehearse on staging

Merge `nightly` into `staging` as a `vX.Y.Z-rcN` PR. The merge commit's
pipeline run rolls the staging cluster onto the deploy set its submodule
pointers name, each image pushed by its repository's pipeline at that commit
(see [Deploying](/deployment/kubernetes/overview/#deploying)). A roll that
moves the backend's pin restarts the backend, which re-ingests the `staging`
tip; after any other roll, `tcab ingest --env staging` does. Either way the
merged catalog is visible once the deploy stage succeeds.

Enqueue real runs of the cases that changed and review one end to end. Fixes go
back onto `nightly` and return as the next rc, never straight onto `staging`.

## 3. Land it in production

Promote `staging` into `master` as a `vX.Y.Z` PR. The merge commit's pipeline
run rolls `tcab-prod` onto the release commit's deploy set in the `prod` stage,
and the backend, restarted by a moved pin or refreshed by `tcab ingest --env
prod`, ingests the `master` tip, publishing the release's cases, errata, and
reference-build URLs. Confirm the roll as the
[roll-prod quickstart](/quickstarts/devops/roll-prod-service-images/) does.

The same run's `docs` stage deploys the docs. The gallery needs no rebuild: a
re-ingest that changed something queues a snapshot refresh, which writes the
updated index objects to the public bucket, and the gallery reads them at
runtime. A no-op re-ingest queues nothing, which is the usual reason the gallery
does not move.

## 4. Tag the release

Once the `master` run is green, tag each releasing repository's `master` at the
commit the superrepo's submodule pointer names. A tag of the superrepo runs
nothing (see [Release tags](/development/releasing/#release-tags)):

```sh
for repo in microservice-driver gg client-tauri; do
  git -C "$repo" switch master && git -C "$repo" pull
  git -C "$repo" tag -a vX.Y.Z -m "vX.Y.Z"
  git -C "$repo" push origin vX.Y.Z      # origin is the Azure Repos remote
done
```

Each tag runs its repository's pipeline. `microservice-driver` publishes the
smoke-tested `tcab` as the `tcab-linux` and `tcab-windows` artifacts; `gg` fails
if `gg --version` is not `X.Y.Z` and otherwise uploads gg to the `gg-releases`
blob container; `client-tauri` publishes the client bundles as `client-*`
artifacts; and each pushes its tag to the GitHub mirror.

## Verify

```sh
for repo in microservice-driver gg client-tauri; do
  git -C "$repo" ls-remote origin refs/tags/vX.Y.Z
  git ls-remote https://github.com/TheClockwyrks/$repo refs/tags/vX.Y.Z
done
curl -fsI https://testcabinetartifacts.blob.core.windows.net/gg-releases/vX.Y.Z/gg-x86_64-unknown-linux-musl
```

- Each tag names the same commit on Azure and on the GitHub mirror.
- `microservice-driver`'s tag run carries the `tcab-linux` and `tcab-windows`
  artifacts, and `client-tauri`'s the `client-*` bundles.
- `gg-releases/vX.Y.Z/` holds both gg binaries and `gg-reference.tar.gz`.
- `docs.testcabinet.ai` serves the changelog and links it in the sidebar.
- `testcabinet.ai` shows the graduated cases, each with a working **Reference**
  tab.
- The console can enqueue a run of a graduated case.
- Every `tcab-*` workload in `tcab-prod` reports the release sha.

## Next steps

- [Cutting a Release](/guides/devops/cutting-a-release/): the full sequence, the
  reasoning, and the gotcha table.
- [Releasing](/development/releasing/): what a tag publishes, the gg release
  host, and the Cloudflare Pages topology.
- [Roll Production Service Images](/quickstarts/devops/roll-prod-service-images/):
  verifying the prod roll, and rolling back.
