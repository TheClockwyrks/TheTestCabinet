# Task 8 — Restore adversarial arena execution in the new topology

**Status:** not started. **Depends on:** Phase 2 backend (done). **Relates to:**
the deleted worker (resurrect from `3e7e86e^`).

## Goal

Re-implement **arena execution** — quick **matches** and **tournaments** between
controller WASM programs — which was worker-only and was dropped in the cutover
(`3e7e86e`). The worker's arena HTTP surface is gone; the web console's arena
**run actions** call backend endpoints that don't exist, so launching a match or a
tournament from the console fails today. Arena **reads** (published tournaments,
stored replays, controller listings) still work.

## What's missing vs. what exists

**Console expects (against the one backend URL)** —
`apps/web/src/transport/httpArena.ts`:

| Method + path | Purpose | Backend today |
| --- | --- | --- |
| `GET /matches/controllers?testCase=` | list baselines + run-produced controllers | **missing** |
| `POST /matches` | run one head-to-head match (synchronous) | **missing** |
| `POST /tournaments` | submit a tournament (async, `202` + job id) | exists as **publish**, not execute |
| `GET /tournaments/{id}` | poll job status / get finished record | read-only get exists |
| `GET /tournaments/{id}/events` | NDJSON live per-match progress | **missing** |
| `GET /tournaments`, `…/matches/{m}/replay.json` | read published + replays | exist |

So the gap is the **execution layer**: `POST /matches`, `GET /matches/controllers`,
the **executing** `POST /tournaments` + live `…/events`, and an in-flight
tournament job tracker. The read/publish/replay-store endpoints in
`crates/backend/src/api/tournaments.rs` stay.

## The pieces to build on

- **Core engine (unchanged, reuse):** `crates/core/src/match_play.rs` —
  `canonical_match_setup`, `run_quick_match(test_case, red, blue) -> MatchOutcome`,
  `run_tournament(test_case, variant, id, created_at, participants, on_match)
  -> TournamentBuild` (the `on_match(played, total, &summary)` callback is the live
  progress hook). Matches execute **in-process wasm** via
  `crates/foray-host` `run_match` — **CPU-bound**, must run **off the async
  runtime** (`spawn_blocking`). A match is ~seconds; a tournament is O(n²) matches.
- **Backend already holds the inputs:** pushed controller wasm + the
  `GET /adversarial/controllers?testCase=` listing
  (`crates/backend/src/api/runs.rs` → `adversarial_controllers`), per-run
  `controller.wasm` (`crates/backend/src/api/test_cases.rs`), and the tournament
  store (`db.publish_tournament`, `store.write/read_tournament_match`).
- **Worker reference (resurrect, don't reinvent):**
  `3e7e86e^:crates/worker/src/api/matches.rs`,
  `3e7e86e^:crates/worker/src/api/tournaments.rs`, and
  `3e7e86e^:crates/worker/src/tournaments.rs` (the in-memory `TournamentJob`
  tracker + `drive_tournament` + NDJSON event stream). The handler/return shapes
  the console still expects come straight from these.

## Design decision to make (the load-bearing one)

**Where does arena execution run?** Matches are fast, in-process wasm (not
container sandboxes), and their controllers are backend-stored — so the per-run
**Job queue / driver path is the wrong fit** (a pod spawn dwarfs a seconds-long
in-memory match). The realistic options:

1. **In the backend (recommended v1).** Mirror the worker: `POST /matches` runs
   synchronously via `spawn_blocking`; `POST /tournaments` starts a background task
   with an in-memory job tracker and streams `on_match` progress over a live
   channel (reuse the relay infra added in Phase 2, or a dedicated NDJSON stream as
   the worker had), then `db.publish_tournament` on completion. Controllers resolve
   from existing backend storage. Closest to what the console already expects.
   **Tension to respect:** the whole refactor pushed heavy work **off** the
   single-replica control-plane backend, and arena is CPU-bound. So bound arena
   concurrency hard (a small `spawn_blocking` pool / semaphore) and keep it from
   starving the queue/relay. `log` any rejection when at capacity.
2. **Its own small `tcab-arena` service** (the artifacts-style split). Cleaner
   isolation of CPU-bound work from the control plane, scales independently, but a
   new binary + deployment + the console learning one more URL. Defer unless (1)'s
   load proves a problem.

Recommendation: **(1)** for parity now, with bounded concurrency; note **(2)** as
the escape hatch if arena CPU load starts to hurt the backend. Fix the choice here
before building.

## Steps (for option 1)

1. **`crates/backend/src/api/matches.rs` (new):** `POST /matches` (sync match via
   `run_quick_match` on `spawn_blocking`; resolve red/blue controllers from backend
   storage + baselines) and `GET /matches/controllers` (baselines + pushed
   controllers for a case). Register routes in `crates/backend/src/api.rs`.
2. **Tournament execution:** add an **executing** `POST /tournaments` (distinct
   from today's publish) returning `202 { tournamentId, statusUrl, eventsUrl }`, an
   in-memory job tracker (port `TournamentJob`), a `GET /tournaments/{id}` status
   that returns the finished `TournamentRecord`, and `GET /tournaments/{id}/events`
   NDJSON live progress. Persist via the existing `db.publish_tournament` +
   `store.write_tournament_match` on completion. Keep the existing read endpoints.
3. **Concurrency guard:** a bounded executor/semaphore for arena work so CPU-bound
   matches can't starve the control plane; reject/queue past the cap with a log.
4. **Contract codegen:** if the console adopts generated bindings for the arena
   types (`MatchBody`/`MatchResponse`/`TournamentBody`/`SubmitAck`/job status),
   add them to `crates/contract-codegen` and keep drift CI green; otherwise leave
   `httpArena.ts`'s hand types as-is (confirm they match the new handlers).
5. **Docs:** drop the "arena execution is not yet wired" caveat from
   `guides/running-the-local-service-stack.md` and update
   `testing/adversarial/overview.md` once execution works end to end.

## Out of scope

Tournament **scoring/standings** semantics are unchanged (the engine already does
fuel tie-breaks, wins-based ranking — see the `adversarial-fuel-tiebreak` /
`adversarial-arena` memory notes). This task restores the **execution + live
streaming surface**, not the rules.

## Verification

- `cargo build`/`clippy` (warnings denied); backend unit tests for the match and
  controller-listing handlers.
- A quick match from the console returns a `MatchSummary` (+ replay); a tournament
  streams per-match progress live, then is readable/published with replays served.
- Arena execution under load does not stall the backend's queue/relay (the
  concurrency guard holds).
