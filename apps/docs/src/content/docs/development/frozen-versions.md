---
title: Frozen Versions
---

A test-case version directory that has runs recorded against it is **history**.
The runs stored in the backend reference the case by slug and version, but they
do not snapshot the prompt, specs, or reference mockups those runs were actually
produced from — the repository is the only record of that. Editing
`test-cases/<type>/<difficulty>/<slug>/vX.Y.Z/` in place therefore silently
invalidates every run already scored against it: the runs stay in the metrics
and on the leaderboard, but they were produced from inputs that no longer exist,
and nothing in the data says so.

The rule is simple, and predates this gate: **to change a case, add a new version
directory.** Never edit a version that has been run.

The `.frozen` marker enforces that rule mechanically, because the failure mode is
not disagreeing with it — it is not *remembering*, at the moment of editing, that
a given version was ever used.

## How it works

A directory is frozen by a `.frozen` file inside it, which records a digest of
that directory's tracked contents:

```toml
digest = "sha256-of-the-directory-listing"
frozen_at = "2026-07-19"
reason = "runs recorded against this version"
```

The digest is the SHA-256 of the directory's `git ls-files -s` listing with the
marker itself excluded. That listing covers every tracked path, blob hash, and
file mode under the directory, so **any** change — an edit, an addition, a
deletion, a rename, a permission flip — moves the digest.

Two gates recompute and compare it:

| Gate | Where | Catches |
| --- | --- | --- |
| `scripts/hooks/frozen-paths.sh` | pre-commit hook | the mistake, at the moment you make it |
| `scripts/ci/frozen-check.sh` | Azure + GitHub CI | commits made with `--no-verify` or without hooks installed |

Both read the **git index**, not a diff against a base branch. That is why the CI
job needs no merge base, no fetch depth, and no toolchain: it checks that the
tree it has in hand is internally consistent, which holds on every branch and
every history shape.

## Freezing a version

```sh
scripts/freeze.sh test-cases/end-to-end/easy/carom/v1.0.0
```

Do this **as soon as you trigger the first run** against a version. That is the
moment it stops being editable, and — as the incident that motivated this gate
showed — the moment you are least likely to be thinking about it.

The script refuses to freeze a directory with uncommitted changes, so the digest
always records settled contents.

## Unfreezing, and legitimate changes

Deleting the `.frozen` file unfreezes the directory. This is deliberately a
visible, reviewable commit rather than a flag or an override: unfreezing means
accepting that recorded runs will no longer match their inputs, which should
never be a quiet decision.

Re-running `scripts/freeze.sh` against an already-frozen directory re-baselines
the digest to its current contents. That is the escape hatch for changes that are
genuinely not content changes — a repo-wide path restructure, for instance, of
the kind that moved every case under `test-cases/<type>/<difficulty>/`. The
digest change still shows up in review.

## What is frozen today

Every version of a non-experimental case except its newest, for cases that have
more than one version — the versions that were superseded, and so are the ones
with runs behind them.

Note the gap this leaves: a case with a **single** version that has already been
run is not covered by that rule, because there is no newer version to distinguish
it from. That is precisely the Valence situation before its v1.0.0/v2.0.0 split.
Freeze those individually as you run them, with `scripts/freeze.sh`.

The durable fix is to derive the frozen set from the backend's record of which
case versions actually have runs, rather than from a
more-than-one-version heuristic. Until then, freezing is a manual step at
first-run time.
