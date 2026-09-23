---
title: Cut a Release
---

Ship `vX.Y.Z`: prepare the release branch, rehearse on staging, promote to
`master`, then tag it. The full walkthrough and the reasoning behind each step
are in [Cutting a Release](/guides/devops/cutting-a-release/).

Four things ship on four paths, and the tag governs only the first: the
**binaries** (`tcab` and `gg`, from the tag's pipeline run), the **catalog** (a
branch tip the backend re-ingests on every deploy), the **services** (the
pipeline's deploy of the merge commit), and the **sites** (a Pages build).

```text
rel/vX.Y.Z ──▶ nightly ──▶ staging ──▶ master ──▶ tag vX.Y.Z
   the work    integration  (vX.Y.Z-rcN)  (vX.Y.Z)
```

## Prerequisites

- Push access to the Azure Repos repository, where the tag is created.
- `az` logged in to the cluster subscription, for verifying the rolls.
- `wrangler` with `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`, if any
  reference implementation needs publishing.

## 1. Prepare the release on `nightly`

Do this on the release's `rel/vX.Y.Z` branch and merge it into `nightly`.

```sh
# Changelog page — and REGISTER it in the sidebar, or nothing links to it.
$EDITOR apps/docs/src/content/docs/changelogs/vX.Y.Z.md   # title: vX.Y.Z (YYYY-MM-DD)
$EDITOR apps/docs/astro.config.mjs                        # Changelogs group, newest first

# Cases graduating out of experimental this release.
grep -rln "experimental" test-cases/ game-jams/ --include=*.toml

# Publish/republish their reference implementations, then commit the lockfile.
# The publish exits non-zero if any reference build failed, so chain the commit
# onto it rather than committing a lockfile a failed sweep only half wrote.
tcab publish-reference --env prod <slug> && \
  git add test-cases/reference-builds.lock.json && \
  git commit -m "chore(references): update reference implementations"
```

Verify the release gate — every non-experimental variant declaring a
`reference_implementation` has a `prod` lockfile entry. Silence means it passes:

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

Bump `crates/gg` and `crates/core` to `X.Y.Z` in the same branch; the tag's
version gate compares against them.

```sh
$EDITOR crates/gg/Cargo.toml crates/core/Cargo.toml   # version = "X.Y.Z"
cargo check -p test-cabinet-gg -p test-cabinet-core   # refreshes Cargo.lock
```

## 2. Rehearse on staging

Merge `nightly` into `staging` as a `vX.Y.Z-rcN` PR. The merge commit's
pipeline run builds every image at its sha and `deploy_staging` rolls the
staging cluster to them, the way [Roll Production Service
Images](/quickstarts/devops/roll-prod-service-images/) describes for prod. The
roll restarts the backend, which re-ingests the `staging` tip, so the merged
catalog is visible once `deploy_staging` succeeds.

Enqueue real runs of the cases that changed and review one end to end. Fixes go
back onto `nightly` and return as the next rc, never straight onto `staging`.

## 3. Land it in production

Promote `staging` into `master` as a `vX.Y.Z` PR. The merge commit's pipeline
run rolls `tcab-prod` to the release sha in `deploy_prod`, and the restarted
backend re-ingests the `master` tip, publishing the release's cases, errata, and
reference-build URLs. Confirm the roll as the
[roll-prod quickstart](/quickstarts/devops/roll-prod-service-images/) does.

The same run's `docs` job deploys the docs. The gallery rebuilds because a
re-ingest that changed something queues a snapshot refresh, which fires the
Pages deploy hook. A no-op re-ingest queues nothing, which is the usual reason
the gallery does not move.

## 4. Tag the release

Once the `master` run is green, tag the merge commit in Azure Repos:

```sh
git switch master && git pull
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z      # origin is the Azure Repos remote
```

The tag's pipeline run gates the commit again, fails if `gg --version` is not
`X.Y.Z`, publishes the smoke-tested `tcab` as the `tcab-linux` and
`tcab-windows` artifacts, uploads gg to the `gg-releases` blob container, and
pushes the tag to the GitHub mirror.

## Verify

```sh
git ls-remote origin refs/tags/vX.Y.Z
git ls-remote https://github.com/TheClockwyrks/TheTestCabinet refs/tags/vX.Y.Z
curl -fsI https://testcabinetartifacts.blob.core.windows.net/gg-releases/vX.Y.Z/gg-x86_64-unknown-linux-musl
```

- The tag names the same commit on Azure and on the GitHub mirror.
- The tag's pipeline run carries the `tcab-linux` and `tcab-windows` artifacts.
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
