---
title: Cut a Release
---

Ship `vX.Y.Z`: prepare the release branch, rehearse on staging, publish the
binaries and desktop app from GitHub, then land the catalog and the services in
production. The full walkthrough and the _why_ behind each step are in
[Cutting a Release](/guides/devops/cutting-a-release/).

Four things ship on four separate paths, and the tag governs only the first:
**artifacts** (the GitHub release), the **catalog** (a branch tip the backend
re-ingests on every deploy), the **services** (the pipeline's deploy of the merge
commit), and the **sites** (a Pages build). There is **no version to bump**
anywhere in the repository, and no tag to push — the Release workflow creates it.

```text
rel/vX.Y.Z ──▶ nightly ──▶ staging ──▶ master
   the work    integration  (vX.Y.Z-rcN)  (vX.Y.Z)
```

## Prerequisites

- `gh` authenticated against `TheClockwyrks/TheTestCabinet`, the GitHub mirror
  the pipeline pushes gated commits to (public releases are cut there; Azure
  DevOps is private).
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

Then: Azure CI green, and dispatch `binary-macos.yml` (Azure has no macOS agents,
so this is the only macOS check before the artifacts are built).

## 2. Rehearse on staging

Merge `nightly` into `staging` as a `vX.Y.Z-rcN` PR. The merge commit's
pipeline run builds every image at its sha and `deploy_staging` rolls the
staging cluster to them, the way [Roll Production Service
Images](/quickstarts/devops/roll-prod-service-images/) describes for prod. The
roll restarts the backend, which re-ingests the `staging` tip, so the merged
catalog is visible once `deploy_staging` succeeds.

Enqueue real runs of the cases that changed and review one end to end. Fixes go
back onto `nightly` and return as the next rc — never straight onto `staging`.

## 3. Cut the artifacts

```sh
# Promote staging -> master as a `vX.Y.Z` PR (the rehearsed tree). The pipeline's
# mirror job pushes the merge to GitHub once it passes the gates.

# The desktop app pulls the GHCR images; both GitHub image workflows run on every
# master push, so wait for them (the release gates on it either way).
gh run list --workflow=build-service-images.yml --branch master --limit 5 \
  --json headSha,conclusion,createdAt
gh run list --workflow=build-containers.yml --branch master --limit 5 \
  --json headSha,conclusion,createdAt

gh workflow run release.yml --ref master -f version=vX.Y.Z   # builds + PRERELEASE + tag
# ... download every platform's artifacts and exercise them (this is the only gate
#     the servers and the desktop app get) ...
gh workflow run release-promote.yml -f tag=vX.Y.Z            # flips to latest, no rebuild
```

## 4. Land it in production

The merge into `master` already did it: the pipeline's `deploy_prod` rolled every
image to the release sha, and the restarted backend re-ingested the `master` tip,
publishing the release's cases, errata, and reference-build URLs. Confirm the
roll as the [roll-prod quickstart](/quickstarts/devops/roll-prod-service-images/)
does.

The pipeline's `docs` job deploys the docs on the same `master` build; the
gallery rebuilds because a re-ingest that changed something
queues a snapshot refresh, which fires the Pages deploy hook. A **no-op** re-ingest
queues nothing — that, not a broken hook, is the usual reason the gallery does not
move.

## Verify

- The GitHub release is **Latest**, not a prerelease, with every archive, both
  installers, and `SHA256SUMS`.
- `docs.testcabinet.ai` serves the changelog _and_ links it in the sidebar.
- `testcabinet.ai` shows the graduated cases, each with a working **Reference**
  tab.
- The console can enqueue a run of a graduated case.
- Every `tcab-*` workload in `tcab-prod` reports the release sha.

## Next steps

- [Cutting a Release](/guides/devops/cutting-a-release/) — the full sequence, the
  reasoning, and the gotcha table.
- [Releasing](/development/releasing/) — the Release workflows, the unsigned-macOS
  workaround, and the Cloudflare Pages topology.
- [Roll Production Service Images](/quickstarts/devops/roll-prod-service-images/) —
  verifying Phase 4's roll, and rolling back.
