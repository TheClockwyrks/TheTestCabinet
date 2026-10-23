---
format: nyxsis-issue
version: 2
id: tdr9hbk4hq2c93hj9maqvdez
zone: ARENA
number: 1
title: Record and resume arena tournaments through the backend
type: generic
state: open
depends_on:
  - tssf0pps2q535nzes4ewupxm
created: 2026-10-19T00:39:23.732814668Z
---

The arena keeps every accepted tournament in an in-memory registry
(`TournamentRegistry` in `crates/arena/src/tournaments.rs`) and drives it on a
detached task (`drive_tournament` in `crates/arena/src/api.rs`). A restart of
the arena pod loses every running tournament and its completed matches, and
`GET /tournaments/{id}` then answers `404`. The tournament record is posted
before its replays, so an interruption between the two leaves a published
tournament whose matches name replays the backend never stored. The binary
serves with `axum::serve` and no shutdown signal, so `SIGTERM` kills the match
in progress with nothing recorded.

`apps/docs/src/content/docs/components/arena/overview.md`, sections "State",
"Durable tournaments", "Resuming after a restart", "Shutdown" and "Capacity
guard", describes the intended behaviour, and
`apps/docs/src/content/docs/components/backend/overview.md`, section "Durable
state", where the backend keeps a tournament and its matches.

## What is missing

- `POST /tournaments` records the tournament through the backend with its test
  case, variant, participants and every pairing as a match without a result,
  and returns `202` only once that record is stored.
- Each match is recorded as it completes: its replay is stored first, then its
  summary. A load forfeit records its summary alone.
- The tournament is marked succeeded with its standings once every pairing has
  a recorded result, and marked failed with its reason when it cannot complete.
- `GET /tournaments/{id}` reads the recorded tournament, and
  `GET /tournaments/{id}/events` replays the recorded matches as its backlog
  before streaming live progress.
- On start, the arena lists the queued and running tournaments the backend
  holds and resumes each, playing only the pairings without a recorded result.
  A resumed tournament waits for a capacity permit.
- On `SIGTERM` the arena answers new submissions with `503`, records the match
  each tournament is on if it completes within the grace period, and exits
  leaving any unfinished match without a result.
- `run_tournament` in the match runner plays a given subset of pairings and
  reports each match's summary and replay through its callback, so the arena
  can record and resume per match.
- The backend routes that record a pending tournament, a match result and the
  final standings, and list unfinished tournaments, with the backend client's
  calls to them.

## Verify

- Submit a tournament of four or more participants, restart the arena pod
  after some matches have completed, and confirm the tournament resumes,
  replays only the matches without a recorded result, and succeeds with every
  match's replay readable from the backend.
- Kill the arena between a match's replay write and its summary write in a
  test, and confirm the resumed tournament plays that match once more and
  the finished tournament lists every replay it names.
- Send `SIGTERM` during a tournament and confirm the match in progress is
  either recorded or left without a result, and a new submission answers
  `503` until exit.
- `GET /tournaments/{id}` and its events stream answer the same recorded
  state before and after a restart.
- Run the arena crate's tests and `make gate`.
