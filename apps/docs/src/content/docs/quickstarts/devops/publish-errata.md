---
title: Publish Errata
---

Record a **known issue with a version that already shipped** — a problem found after
the fact — without cutting a new version. A version bump would change the
`(slug, version)` key every run is grouped by and drop the version's existing runs
from its metrics; an erratum instead acknowledges the issue while the version and its
runs stay put. Errata live in version control and reach a deployment the same way
every definition does — a git checkout the backend re-ingests — so publishing them
needs **no `tcab` release** and stores nothing only in a cluster.

See [Errata](/testing/end-to-end/manifests/#errata) for the full field reference
(it applies to every test type), and [Authoring Errata](/guides/devops/authoring-errata/)
for how to decide what to put in one — especially the choice between an advisory
`affects_scoring` flag and a mechanical `exclude_from_score`.

## Prerequisites

- The version already exists under `test-cases/…/<slug>/<version>/` (errata attach
  to a shipped version; you are not creating one).
- For a **remote** publish: cluster access for `scripts/reingest-cluster.sh`
  (`--env prod` or `--env staging`). For a **local** stack: the backend running and
  `scripts/reingest.sh`.

## Publish

```sh
# 1. Add (or edit) errata.toml beside the version's test-case.toml.
#    Auto-discovered — no test-case.toml change is needed.
$EDITOR test-cases/<type>/<difficulty>/<slug>/<version>/errata.toml
```

```toml
# errata.toml
[[erratum]]
id = "cue-clips-rail"
title = "Cue ball clips the rail at very high speed"
date = "2026-07-17"
severity = "major"          # info | minor | major (default: minor)
affects_scoring = true      # flags an issue reviewers must weigh
body = """
Above a certain speed the cue ball can tunnel through a rail. Do not penalise a
run for missed collisions at extreme speeds until this is fixed.
"""
# resolved_in = "v1.1.0"    # set once a later version addresses it
# review = "physics.collisions"   # tie to a scored point (item id or <item>.<sub>)
# exclude_from_score = true        # remove that `review` point from scoring for the
#                                  # version — still checked/shown, just no longer
#                                  # counted (or gating). Requires `review`.
```

Use `exclude_from_score` when a review point is **mis-scoring** runs — a buggy
automated `validation` check, or an ambiguous requirement — and you want the runs you
have already collected to re-score correctly **without** the version bump that would
evict them from the version's metrics.

```sh
# 2. Commit + push, then re-ingest so the backend reads the new errata.
#    Re-ingest is a FORCED overwrite (a version already in the store is otherwise
#    skipped), which the reingest scripts always send.
git add test-cases/<type>/<difficulty>/<slug>/<version>/errata.toml
git commit -m "docs(errata): note <slug> cue-ball rail clipping"
git push

# Remote (production or staging): the sidecar fetches HEAD and force re-ingests.
scripts/reingest-cluster.sh --env prod <slug>

# Local stack instead:
scripts/reingest.sh
```

## Verify

- The case's **Errata** tab lists the entry (grouped by version, newest first). The
  tab appears only once a version records at least one erratum.
- A **run** of that version shows a **"Known errata for this version"** callout on
  its detail view, scoped to the run's variant — so a reviewer sees the issue before
  scoring.
- The static gallery picks errata up on its **next snapshot publish**; the live
  console reflects them as soon as the re-ingest completes.

## When it is resolved

When a later version fixes the issue, set `resolved_in = "<version>"` on the erratum
(it stays visible, badged with its fix version, rather than being deleted) and record
the fix in that new version's `changelog.md`.
