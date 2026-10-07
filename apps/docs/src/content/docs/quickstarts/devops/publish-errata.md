---
title: Publish Errata
---

## Overview

An erratum records a known issue with a version that already shipped, keeping the
version and its recorded runs in place. A version bump changes the
`(slug, version)` key runs are grouped by and drops the version's existing runs
from its metrics; an erratum acknowledges the issue instead.

Errata live in version control and reach a deployment the way every definition
does: a git checkout the backend re-ingests. Publishing one needs no `tcab`
release. The field reference is [Errata](/testing/end-to-end/manifests/#errata),
and the guidance on what to put in one is
[Authoring Errata](/guides/devops/authoring-errata/).

## Prerequisites

- The version already exists under `test-cases/…/<slug>/<version>/`.
- Cluster access for `scripts/reingest-cluster.sh --env <prod|staging>`, or a
  running local stack for `scripts/reingest.sh`.

## Publish

Add or edit `errata.toml` beside the version's `test-case.toml`. It is
auto-discovered, so `test-case.toml` stays untouched:

```sh
$EDITOR test-cases/<type>/<difficulty>/<slug>/<version>/errata.toml
```

```toml
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
# resolved_in = "v1.1.0"         # set once a later version addresses it
# variant = "base"               # scope the entry to one declared variant
# review = "physics.collisions"  # a review item id, or <item>.<sub>
# exclude_from_score = true      # drop that review point from scoring for this
#                                # version. Requires `review`.
```

`id`, `title`, and `body` are required. Use `exclude_from_score` when a review
point is mis-scoring runs, such as a buggy automated check or an ambiguous
requirement: the point keeps being checked and shown, stops contributing to any
run's score, and stops gating the run when it is auto-validated.

Then commit, push, and re-ingest. Re-ingest forces an overwrite of a version
already in the store, which the reingest scripts always request:

```sh
git add test-cases/<type>/<difficulty>/<slug>/<version>/errata.toml
git commit -m "docs(errata): note <slug> cue-ball rail clipping"
git push

scripts/reingest-cluster.sh --env prod <slug>   # production or staging
scripts/reingest.sh                             # a local stack instead
```

## Verify

- The case's Errata tab lists the entry, grouped by version, newest first. The
  tab appears once a version records at least one erratum.
- A run of that version shows a known-errata callout on its detail view, scoped
  to the run's variant, so a reviewer sees the issue before scoring.
- The live console reflects the entry as soon as the re-ingest completes; the
  static gallery picks it up on the snapshot refresh the re-ingest queues.

## When it is resolved

When a later version fixes the issue, set `resolved_in = "<version>"` on the
erratum so it stays visible badged with its fix version, and record the fix in
that version's `changelog.md`.
