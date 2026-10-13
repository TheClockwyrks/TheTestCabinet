---
title: Overview
---

The arena service is the execution host for the
[adversarial](/testing/adversarial/overview/) test type's head-to-head play:
matches, which pit two controllers and return a replay immediately, and
tournaments, which run every pair in a field while streaming live per-match
progress. Running those matches is CPU-bound, in-process wasm, so it lives in
its own service rather than in the single-replica control-plane
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
| `POST /tournaments`            | Submit a tournament, driven in the background    |
| `GET /tournaments/{id}`        | Read a tournament job's status                   |
| `GET /tournaments/{id}/events` | Stream a tournament's live progress              |

Every request reaches the arena through the [edge](/deployment/kubernetes/edge/)
and carries an Access assertion, which the arena verifies as the backend does.
A tournament the console submits is authorized by that assertion; the arena
then presents its own service token to the backend when it persists the
tournament. The CPU-bound execution behind the routes is bounded by the
capacity guard. The arena has no Kubernetes API access and only talks HTTP to
the backend, through the contracts repository's
[backend client](/components/contracts/overview/#telemetry-redaction-and-the-backend-client).

## State

The arena holds no database and no disk. It fetches every controller input from
the backend over HTTP: a resolved test-case version, a baseline's
`references/<id>.wasm`, a pushed run's `controller.wasm`, and the
pushed-controller listing. It persists a finished tournament and its per-match
replays back to the backend.

Two controller kinds are resolvable in this topology: committed baselines,
checked against the arena's opponent allowlist, and pushed-run controllers. A
run-local controller is resolved from a host's own run output directory, which a
stateless service does not have, so the arena rejects one with a `400`.

The in-flight tournament registry and its live progress channel are in-memory
and per-pod, so the arena runs as a single replica. Scale its throughput with
its CPU and the concurrency cap.

## Capacity guard

A semaphore (`TCAB_ARENA_MAX_CONCURRENT`, default `2`) caps how many matches and
tournaments run their wasm at once. At capacity the arena rejects with `503` and
a `warn` log rather than queueing, so a flood of submissions cannot pile up
unbounded blocking tasks and stall the pod. A match holds one permit for its
single blocking execution, and a tournament holds one across its whole
background drive, including publishing. Its Kubernetes `Deployment` carries CPU
requests and limits to match.

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
