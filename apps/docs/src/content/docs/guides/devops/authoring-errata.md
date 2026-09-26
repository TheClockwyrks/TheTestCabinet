---
title: Authoring Errata
---

## Overview

An erratum records a known issue with a test-case version that has already
shipped, so the issue can be acknowledged without cutting a new version. This
guide covers what goes in one, the two ways an erratum can touch scoring, and how
to author one against a frozen version. The
[Publish Errata](/quickstarts/devops/publish-errata/) quickstart is the same task
reduced to its steps, and
[Errata](/testing/end-to-end/manifests/#errata) in the manifest docs is the
exhaustive field reference.

## When an erratum applies

Runs are grouped in the metrics by their exact `(slug, version)` key. Bumping the
version changes that key for every future run, so the version's graphs and
leaderboard no longer roll up the runs already recorded against it. An erratum
leaves the version and its recorded runs where they are.

Use an erratum when the thing to change is metadata about a shipped version.
Changing the prompt, specs, or reference of a case is always a new version.

## Where errata live

An erratum is authored as a `[[erratum]]` entry in an `errata.toml` file beside
the version's manifest:

```
test-cases/<type>/<difficulty>/<slug>/<version>/errata.toml
```

Three properties follow from that location:

- Auto-discovered. No manifest key declares the file; the backend finds it by
  presence. Errata can therefore be added to an already-reviewed version without
  touching the reviewed definition.
- Site-facing. Like a changelog, an erratum is reporter-side material. It changes
  what reviewers and the gallery see and score, and an agent receives none of it.
- Shared by every test type. The mechanism is identical for end-to-end,
  full-stack, asset-generation, adversarial, performance, and game-jam cases.

Errata live in the same tree the backend ingests from a git checkout, so
publishing one takes no `tcab` release: commit the file and re-ingest.

## Anatomy of an erratum

```toml
[[erratum]]
id = "cue-clips-rail"                 # required, unique within the file
title = "Cue ball clips the rail at very high speed"   # required
date = "2026-07-17"                   # optional YYYY-MM-DD
severity = "major"                    # info | minor | major (default: minor)
affects_scoring = true                # advisory: a reviewer should weigh this
body = """
Above a certain speed the cue ball can tunnel through a rail. Do not penalise a
run for missed collisions at extreme speeds until this is fixed.
"""
# resolved_in = "v1.1.0"              # set once a later version addresses it
# variant = "kindle"                  # scope to one variant; omit = all variants
# review = "physics.collisions"       # tie to a review point (id or <item>.<sub>)
# exclude_from_score = true           # mechanically drop that point from scoring
```

Notes on the fields the [field reference](/testing/end-to-end/manifests/#errata)
leaves to judgment:

- `severity` (`info` / `minor` / `major`) is a badge. It signals how seriously a
  reader should take the entry and leaves every score untouched.
- `resolved_in` names the version that fixes the issue and may name a version
  that does not exist yet. A resolved erratum stays visible, badged with its fix
  version. Record the actual fix in that new version's `changelog.md`.
- `variant` scopes an erratum to a single declared variant. Omit it and the
  erratum applies to every variant of the version.
- `review` ties the erratum to a scored point: a review item id, or a composite
  `<item id>.<sub-item id>`. On its own it surfaces the note beside that point.
  It becomes mechanical only when paired with `exclude_from_score`.

## The scoring decision

Two fields touch scoring.

### `affects_scoring`

`affects_scoring = true` flags an issue a reviewer should take into account by
hand when grading. Nothing is removed and no score is recomputed. Use it when the
issue is real but judgment is still required, and as the signal that the eventual
fix would otherwise warrant a version bump.

### `exclude_from_score`

`exclude_from_score = true` requires a `review` link and removes the linked
review point from scoring for the version. It does two things:

- It stops counting. The point contributes to neither the earned nor the total
  side of every run's score; the ratio is computed as if the point were absent
  from the checklist. Existing runs re-score on the next ingest.
- It un-gates automated validation. When the point is
  [auto-validated](/testing/end-to-end/instrumentation/), a failed drive of it
  leaves the run
  [ungated](/testing/end-to-end/instrumentation/#the-reliability-principle).

The point is still shown and still driven, and its proof media is still captured.
In the review editor it is marked not scored with its Pass/Fail control disabled,
and a run's verdict view shows the same marker.

Reach for `exclude_from_score` when a review point is mis-scoring runs: a buggy
automated `validation` check, or a requirement that proved ambiguous.
Already-collected runs then re-score correctly without the version bump that
would evict them from the version's metrics.

### Choosing between them

| You want to…                                                  | Use                             |
| ------------------------------------------------------------- | ------------------------------- |
| Note a real flaw but leave grading to the reviewer's judgment | `affects_scoring`               |
| Surface a note next to a specific review point, still scored  | `review` (alone)                |
| Stop a specific point from counting at all, for every run     | `exclude_from_score` + `review` |

On a single point: when a human can reasonably still judge the point, keep it
scored and use `affects_scoring`; when the point itself is broken or
unanswerable, retire it with `exclude_from_score`.

## Authoring against a frozen version

A superseded version is typically [frozen](/development/frozen-versions/): it
carries a `.frozen` marker, and both the pre-commit hook and CI reject any change
under a frozen directory, including a new `errata.toml`.

Stage the erratum, re-baseline the directory's digest over it, then commit:

```sh
git add test-cases/<type>/<difficulty>/<slug>/<version>/errata.toml
scripts/freeze.sh test-cases/<type>/<difficulty>/<slug>/<version>
git commit -m "docs(errata): note <slug> <erratum-id>"
```

`scripts/freeze.sh` records the directory's new contents as the frozen baseline.
The digest change is visible in review, so the decision stays auditable. See
[Frozen versions](/development/frozen-versions/) for the mechanism.

## Resolving an erratum

When a later version fixes the issue:

1. Set `resolved_in = "<version>"` on the erratum. It stays visible, badged with
   its fix version.
2. Record the actual fix in the new version's `changelog.md`.

An `exclude_from_score` erratum on the old version goes on excluding that point
for the version's existing runs. The new version carries the corrected review
point in its own definition.

## Next steps

- [Publish Errata](/quickstarts/devops/publish-errata/) gives the steps to commit
  and re-ingest an erratum.
- [Errata field reference](/testing/end-to-end/manifests/#errata) lists every
  field, its default, and its validation rules.
- [Frozen versions](/development/frozen-versions/) covers why superseded versions
  are locked and how re-baselining works.
