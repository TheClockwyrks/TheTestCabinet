---
format: nyxsis-issue
version: 3
id: s7m2n9oh3p9a4c5873ag0yya
zone: ARENA
number: 2
title: Build the arena standalone against released contracts and engines
type: bug
priority: 2
state: open
created: 2026-10-27T19:02:24.326489573Z
modified: 2026-10-27T19:02:24.326489573Z
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
