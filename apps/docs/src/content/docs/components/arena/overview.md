---
title: Overview
---

The arena service is the execution host for the
[adversarial](/testing/adversarial/overview/) test type's head-to-head play:
matches, which pit two controllers and return a replay immediately, and
tournaments, which run every pair in a field while streaming live per-match
progress. Running those matches is CPU-bound, in-process wasm, so it lives in
its own service rather than in the control-plane
[backend](/components/backend/overview/).

The arena is a data-plane peer of the backend. The backend owns the data
(controller inputs, published tournaments, stored replays) and the arena owns
the execution. A [console](/components/web/overview/) posts a match or
tournament to the arena at `/arena/` on its own origin and streams a
tournament's live progress from it, while arena reads stay on the backend.

## Routes

| Route                          | Purpose                                          |
| ------------------------------ | ------------------------------------------------ |
| `GET /matches/controllers`     | List the controllers a case can pit              |
| `POST /matches`                | Run one head-to-head match and return its replay |
| `POST /tournaments`            | Record a tournament and drive it in background   |
| `GET /tournaments/{id}`        | Read a tournament's recorded status              |
| `GET /tournaments/{id}/events` | Stream a tournament's live progress              |

Every request reaches the arena through the [edge](/deployment/kubernetes/edge/)
and carries an Access assertion, which the arena verifies as the backend does.
A tournament the console submits is authorized by that assertion; the arena
then presents its own service token to the backend when it records the
tournament and its matches. The CPU-bound execution behind the routes is bounded by the
capacity guard. The arena has no Kubernetes API access and only talks HTTP to
the backend, through the contracts repository's
[backend client](/components/contracts/overview/#telemetry-redaction-and-the-backend-client).

## State

The arena holds no database and no disk. It fetches every controller input from
the backend over HTTP: a resolved test-case version, a baseline's
`references/<id>.wasm`, a pushed run's `controller.wasm`, and the
pushed-controller listing. Every tournament it accepts is recorded through the
backend, which keeps the tournament and its match records in Postgres and each
replay in the artifacts service.

Two controller kinds are resolvable in this topology: committed baselines,
checked against the arena's opponent allowlist, and pushed-run controllers. A
run-local controller is resolved from a host's own run output directory, which a
stateless service does not have, so the arena rejects one with a `400`.

The live progress channel is in-memory and per-pod, and one arena owns the
resumption of every unfinished tournament, so the arena runs as a single
replica. Scale its throughput with its CPU and the concurrency cap.

## Durable tournaments

A tournament is durable from the moment the arena accepts it. `POST
/tournaments` resolves every participant, then records the tournament through
the backend with its test case, variant, participants and the full list of its
pairings, each pairing a match with no result. The arena returns `202` only
once that record is stored, so an accepted tournament survives any restart that
follows.

Each match is recorded as it completes. The arena stores the match's replay
first and then records its summary, so a match with a recorded result always
has its replay stored. A match that ends in a load forfeit produces no replay
and records its result alone. A match id is derived from its pairing, so
recording a match again overwrites it with identical content.

A tournament is complete once every pairing has a recorded result. The arena
then records the standings and marks the tournament succeeded, which is the
state the gallery reads. A tournament the gallery lists as succeeded therefore
holds every replay its matches name. A tournament that cannot complete, such as
one whose engine fails a match, is marked failed with its reason.

`GET /tournaments/{id}` reads the recorded tournament, so its status is the same
from any arena process. `GET /tournaments/{id}/events` replays the recorded
matches as its backlog and then streams each match as it completes.

### Resuming after a restart

On start, the arena lists every tournament the backend holds as queued or
running and resumes each one. A resumed tournament plays only the pairings
without a recorded result, keeping every completed match and its replay. Each
resumed tournament waits for a capacity permit like any other tournament, so a
restart never runs more matches at once than the cap allows.

### Shutdown

On `SIGTERM` the arena stops accepting matches and tournaments, answering each
with `503`. A tournament finishes the match it is on and records it when that
match completes within the pod's termination grace period. A match still
running when the grace period ends is abandoned without a recorded result, so
the next arena plays it again from the start. Every match recorded before the
signal is kept.

## Capacity guard

A semaphore (`TCAB_ARENA_MAX_CONCURRENT`, default `2`) caps how many matches and
tournaments run their wasm at once. At capacity the arena rejects a new
submission with `503` and a `warn` log rather than queueing, so a flood of
submissions cannot pile up unbounded blocking tasks and stall the pod. A match
holds one permit for its single blocking execution, and a tournament holds one
across its whole background drive, including recording its matches. A
tournament resumed after a restart is queued until a permit frees. Its
Kubernetes `Deployment` carries CPU requests and limits to match.

## Deployment

The arena service is the `tcab-arena` binary of the `microservice-arena`
[repository](/development/repositories/), an Axum server running the
[match runner](/components/engines/overview/#foray-lattice-and-the-match-runner)
and the `foray-host` wasm sandbox from the engines repository. Its configuration
is entirely environment variables, documented in its `crates/arena/src/config.rs`.

It binds all interfaces by default (`0.0.0.0:8791`), because the tunnel reaches
it over the cluster network as a `ClusterIP` service. It is deployed as a
single-replica `Deployment` with a `Service` and its own `ServiceAccount`, with
no API access and no volume. See [Run plane](/deployment/kubernetes/run-plane/).
