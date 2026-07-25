---
title: Authoring Errata
---

An **erratum** records a known issue with a test-case version that has already
shipped — a problem found after the fact — so it can be acknowledged **without
cutting a new version**. This guide covers what errata are, how to decide what to
put in one (especially the two very different ways an erratum can touch scoring),
and the one authoring gotcha to watch for. If you just need the steps to write and
deploy one, the [Publish Errata](/quickstarts/devops/publish-errata/) quickstart is
faster. For the exhaustive field reference, see
[Errata](/testing/end-to-end/manifests/#errata) in the manifest docs (it applies to
every test type).

## Why errata exist

A run is grouped in the metrics by its exact `(slug, version)` key. If you fixed a
problem by bumping the version, that bump would change the key of every future run
and **evict every existing run** from the version's graphs and leaderboard — the
runs stay in the store, but they'd no longer roll up under the version anyone is
looking at. An erratum is the alternative: it says "this is known" (and optionally
adjusts scoring) while the version — and all the runs already scored against it —
stay exactly where they are.

So reach for an erratum whenever the thing you want to change is **metadata about a
shipped version**, not the version's inputs. Changing the prompt, specs, or
reference of a case is always a new version; recording that a shipped version has a
known flaw is an erratum.

## Where errata live

An erratum is authored as a `[[erratum]]` entry in an **`errata.toml`** file placed
**beside the version's `test-case.toml`**:

```
test-cases/<type>/<difficulty>/<slug>/<version>/errata.toml
```

Three properties follow from that location:

- **Auto-discovered.** No `test-case.toml` key declares the file — the backend
  finds it by presence. That is deliberate: it means you can add errata to an
  already-reviewed version **without touching the reviewed definition**.
- **Site-facing only.** Like a changelog, an erratum is never seeded into a run. It
  is reporter-side material — it changes what reviewers and the gallery *see and
  score*, never what an agent *receives*.
- **Shared by every test type.** The mechanism is identical for end-to-end,
  full-stack, asset-generation, adversarial, performance, and game-jam cases.

Because errata live in the same `test-cases/` tree the backend ingests from a git
checkout, publishing one needs **no `tcab` release** — you commit the file and
re-ingest. Those steps are the [Publish Errata](/quickstarts/devops/publish-errata/)
quickstart.

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

Most fields are self-explanatory and fully specified in the
[field reference](/testing/end-to-end/manifests/#errata); the authoring judgment is
almost entirely in **how you touch scoring**, below. A few notes on the rest:

- **`severity`** (`info` / `minor` / `major`) is a **badge only**. It has no
  automatic effect on any score — it just signals how seriously a reader should
  take the entry.
- **`resolved_in`** names the version that fixes the issue and **need not exist
  yet** — the fix may merely be planned. A resolved erratum stays visible, badged
  with its fix version, rather than being deleted. Record the actual fix in that
  new version's `changelog.md`.
- **`variant`** scopes an erratum to a single declared variant; omit it and the
  erratum applies to every variant of the version.
- **`review`** ties the erratum to a scored point — a review item id, or a
  composite `<item id>.<sub-item id>`. On its own it only *surfaces the note beside
  that point*; it becomes mechanical only when paired with `exclude_from_score`.

## The scoring decision: advisory vs. mechanical

This is the whole of authoring an erratum that affects grading, and it is a choice
between two fields that sound similar but do very different things.

### `affects_scoring` — an advisory a human weighs

Set `affects_scoring = true` to flag an issue a **reviewer should take into account
by hand** when grading. It changes nothing mechanically: no point is removed, no
score is recomputed. It is the right tool when the issue is real but judgment is
still required — "the physics is slightly off at extreme speeds; don't over-penalise
a run for it." It is also the signal that the eventual fix would otherwise warrant a
version bump.

### `exclude_from_score` — a mechanical retirement of a point

Set `exclude_from_score = true` (which **requires** a `review` link) to **remove the
linked review point from scoring for the version**. This is not advice; it is
mechanical, and it does two things:

- **It stops counting.** The point contributes to neither the earned nor the total
  side of every run's score — the ratio is computed as if the point were not on the
  checklist. Existing runs re-score correctly on the next ingest.
- **It un-gates automated validation.** If the point is
  [auto-validated](/testing/end-to-end/instrumentation/), a failed drive of it no
  longer [gates](/testing/end-to-end/instrumentation/#the-reliability-principle) the
  run — a broken validation script can no longer auto-fail runs and rate them broken.

The point is still **shown** and still **driven** (its proof media is captured as
before) — it simply no longer counts. In the review editor it is surfaced marked
*not scored*, and its Pass/Fail control is disabled, so a reviewer is never asked to
grade a point that can't affect the outcome; on a run's verdict view it shows the
same *not scored* marker rather than a pass/fail.

Reach for `exclude_from_score` when a review point turns out to be **mis-scoring
runs** — a **buggy automated `validation` check**, or a **requirement that proved
ambiguous** — so the runs you have already collected re-score correctly *without* the
version bump that would evict them from the version's metrics.

### Choosing between them

| You want to… | Use |
| --- | --- |
| Note a real flaw but leave grading to the reviewer's judgment | `affects_scoring` |
| Surface a note next to a specific review point, still scored | `review` (alone) |
| Stop a specific point from counting at all, for every run | `exclude_from_score` + `review` |

They are not mutually exclusive on a case, but on a single point think of it as: if a
human can reasonably still judge the point, keep it scored and use `affects_scoring`;
if the point itself is broken or unanswerable, retire it with `exclude_from_score`.

## Authoring against a frozen (superseded) version

Errata most often target a version that is **actively accumulating runs**, which is
usually the case's current version — that version has no `.frozen` marker, so adding
`errata.toml` commits normally.

But an erratum can equally target a **superseded** version, and superseded versions
are typically [frozen](/development/frozen-versions/): they carry a `.frozen` marker,
and both the pre-commit hook and CI reject *any* change under a frozen directory —
including a brand-new `errata.toml`. That guard exists to stop edits that would
silently invalidate recorded runs, but an erratum is exactly the kind of additive,
site-facing metadata that *doesn't* change what a run was produced from.

When you hit that gate on a frozen version, re-baseline the directory's digest with
the documented escape hatch and then commit:

```sh
scripts/freeze.sh test-cases/<type>/<difficulty>/<slug>/<version>
git add test-cases/<type>/<difficulty>/<slug>/<version>/errata.toml
git commit -m "docs(errata): note <slug> <erratum-id>"
```

Re-running `scripts/freeze.sh` records the directory's new contents (now including
`errata.toml`) as the frozen baseline; the digest change is visible in review, so
the decision stays auditable. See
[Frozen versions](/development/frozen-versions/) for the full mechanism.

## Resolving an erratum

When a later version fixes the issue:

1. Set `resolved_in = "<version>"` on the erratum. It stays visible, now badged with
   its fix version, rather than being deleted — the history of the known issue is
   worth keeping.
2. Record the actual fix in the **new** version's `changelog.md`.

An `exclude_from_score` erratum on the old version stays as it is: it goes on
excluding that point for the version's existing runs. The new version simply carries
the corrected (or removed) review point in its own definition.

## Next steps

- [Publish Errata](/quickstarts/devops/publish-errata/) — the copy-paste steps to
  commit and re-ingest an erratum you've authored.
- [Errata field reference](/testing/end-to-end/manifests/#errata) — every field, its
  default, and its validation rules.
- [Frozen versions](/development/frozen-versions/) — why superseded versions are
  locked and how re-baselining works.
