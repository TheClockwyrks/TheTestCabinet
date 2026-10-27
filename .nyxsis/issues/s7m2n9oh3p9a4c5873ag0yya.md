---
format: nyxsis-issue
version: 3
id: s7m2n9oh3p9a4c5873ag0yya
zone: ARENA
number: 2
title: Build the arena standalone against released contracts and engines
type: bug
priority: 2
state: done
created: 2026-10-27T19:02:24.326489573Z
modified: 2026-10-27T21:21:54.170922689Z
done: 2026-10-27T21:21:54.170922689Z
outcome: |
  Released `contracts` v0.2.5 (release PR 5409, tag on a739fb0) and `engines`
  v1.1.5 on it (PR 5411, tag on ae34fba). Both tag runs succeeded, the npm
  packages are on the feed, the tags are mirrored to GitHub, and `master` is
  merged back into each `nightly` (PRs 5410, 5412). `engines` v1.1.5 also fixes
  `engines`' `nightly` Rust gates: `match-play`'s `TournamentPairing` only exists
  from `contracts` v0.2.5, so they failed on v0.2.4.

  `microservice-arena`'s `nightly` (3f64f34) pins `contracts` v0.2.5 and `engines`
  v1.1.5 with its `Cargo.lock`. `make gate` passes in a standalone checkout
  outside the superrepo, where the patch table doesn't apply: all gates, 70 tests.
  The superrepo pins the arena at that commit.

  Left: the superrepo's `contracts` and `engines` pins stay on the commits before
  the version bump. Moving them needs `ui-common`'s exact package requirements
  moved first, filed as UICOM-3. Locally, the cspell gate checks no files in a
  worktree under `.git/` (its `**/.git/**` ignore). That is not a defect of the
  repositories: CI's cspell passes.
---

`microservice-arena`'s `nightly` (from 6f4dad2, feat(arena): record and resume
tournaments through the backend) does not compile in its own checkout: its
`Cargo.toml` pins `test-cabinet-contracts`, `test-cabinet-backend-client` and
`test-cabinet-telemetry` at the `contracts` tag `v0.2.3`, and
`test-cabinet-match-play` and `foray-core` at the `engines` tag `v1.1.2`, but
the API the tournament recording uses (`record_pending_tournament`,
`recorded_tournament`, `transition_tournament`, `record_tournament_match`,
`record_tournament_replay`, `unfinished_tournaments`, `PendingTournament`,
`TournamentBuild`, …) exists only on `contracts`' `nightly` (48d4118) and
`engines`' `nightly` (bf06d7f). No released tag of either holds it yet
(`contracts`' newest is `v0.2.4`).

So the arena repository's `rust-clippy`, `rust-doc` and `rust-test` gates fail
(`make gate` in `microservice-arena`), while the superrepo builds it through
the patch table in `.cargo/config.toml` and passes.

Release `contracts` and `engines` with that API (a `v*` tag on each, as
[Releasing](apps/docs/src/content/docs/development/releasing.md) describes),
move the arena's `Cargo.toml` pins onto the new tags with its `Cargo.lock`, and
check `make gate` passes in the arena's checkout. The edges are the ones the
[Repositories](apps/docs/src/content/docs/development/repositories.md) page
states.
