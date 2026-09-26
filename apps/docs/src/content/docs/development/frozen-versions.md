---
title: Frozen Versions
---

A test-case version directory that has runs recorded against it is history. Runs
stored in the backend reference the case by slug and version, and they do not
snapshot the prompt, specs, or reference mockups they were produced from; the
repository is the only record of that. Editing
`test-cases/<type>/<difficulty>/<slug>/vX.Y.Z/` in place therefore invalidates
every run already scored against it. Those runs stay in the metrics and on the
leaderboard, produced from inputs that no longer exist, with nothing in the data
saying so.

**To change a case, add a new version directory.** Never edit a version that has
been run.

The `.frozen` marker enforces that rule mechanically, because the failure mode is
forgetting at the moment of editing that a given version was ever used.

## The marker and its gates

A directory is frozen by a `.frozen` file inside it, which records a digest of
that directory's tracked contents:

```toml
digest = "sha256-of-the-directory-listing"
frozen_at = "2026-07-19"
reason = "runs recorded against this version"
```

The digest is the SHA-256 of the directory's `git ls-files -s` listing with the
marker itself excluded. That listing covers every tracked path, blob hash, and
file mode under the directory, so an edit, an addition, a deletion, a rename, or
a permission flip all move the digest.

A version's baseline validation media lives in the `cold-storage` submodule
rather than in the version folder (see [where baselines
live](/components/core/validation/#where-baselines-live)), so the digest never
covers it. A baseline is evidence beside a verdict and backs no point, so
recapturing a frozen version's baselines changes no recorded score and needs no
new version.

Two gates recompute and compare it:

| Gate                            | Where             | Catches                                                    |
| ------------------------------- | ----------------- | ---------------------------------------------------------- |
| `scripts/hooks/frozen-paths.sh` | pre-commit hook   | the mistake, at the moment you make it                     |
| `scripts/ci/frozen-check.sh`    | Azure + GitHub CI | commits made with `--no-verify` or without hooks installed |

Both read the git index rather than a diff against a base branch, so the CI job
needs no merge base, no fetch depth, and no toolchain. It checks that the tree it
has in hand is internally consistent, which holds on every branch and every
history shape.

## Freezing a version

```sh
scripts/freeze.sh test-cases/end-to-end/easy/carom/v1.0.0
```

Do this as soon as you trigger the first run against a version. That is the
moment it stops being editable.

The script refuses to freeze a directory whose working tree differs from the
index, so the digest always records exactly what the commit will hold. Stage a
change first to re-baseline over it in the same commit. It accepts several
directories at once and takes an optional `--reason` for the marker.

## Unfreezing and re-baselining

Deleting the `.frozen` file unfreezes the directory. Unfreezing means accepting
that recorded runs no longer match their inputs, so it is a visible, reviewable
commit rather than a flag or an override.

Re-running `scripts/freeze.sh` against an already-frozen directory re-baselines
the digest to its current contents. That is the escape hatch for changes that are
not content changes, such as a repository-wide path restructure. The digest
change still shows up in review.

## The frozen set

Every version of a non-experimental case except its newest, for cases that have
more than one version. Those are the superseded versions, and so the ones with
runs behind them.

A case with a single version that has already been run falls outside that rule,
because there is no newer version to distinguish it from. Freeze those
individually as you run them, with `scripts/freeze.sh`.
