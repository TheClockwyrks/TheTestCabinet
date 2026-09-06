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

The arena is a data-plane peer of the backend, like the [artifact
service](/components/artifacts/overview/). The backend owns the data (controller
inputs, published tournaments, stored replays) and the arena owns the execution.
A [console](/components/web/overview/) posts a match or tournament to the arena
and streams a tournament's live progress from it, while arena reads stay on the
backend. The backend reports the arena's public base URL
(`TCAB_ARENA_PUBLIC_URL`) via `GET /config`, and the console fetches it for
those actions.

## Routes

| Route                          | Purpose                                          |
| ------------------------------ | ------------------------------------------------ |
| `GET /matches/controllers`     | List the controllers a case can pit              |
| `POST /matches`                | Run one head-to-head match and return its replay |
| `POST /tournaments`            | Submit a tournament, driven in the background    |
| `GET /tournaments/{id}`        | Read a tournament job's status                   |
| `GET /tournaments/{id}/events` | Stream a tournament's live progress              |

These endpoints are unauthenticated behind the private-network boundary. Their
CPU-bound execution is bounded by the capacity guard rather than by auth. The
arena has no Kubernetes API access and only talks HTTP to the backend.

## State

The arena holds no database and no disk. It fetches every controller input from
the backend over HTTP: a resolved test-case version, a baseline's
`references/<id>.wasm`, a pushed run's `controller.wasm`, and the
pushed-controller listing. It persists a finished tournament and its per-match
replays back to the backend.

Two controller kinds are resolvable in this topology: committed baselines,
checked against the arena's opponent allowlist, and pushed-run controllers. A
run-local controller is resolved from a host's own run output directory, which a
stateless service does not have, so the arena rejects one with a `400`. The
desktop app runs the same engine in-process and is where those resolve.

The in-flight tournament registry and its live progress channel are in-memory
and per-pod, so the arena runs as a single replica. Scale its throughput with
its CPU and the concurrency cap.

## Capacity guard

The arena is the CPU-bound pod of the topology, so it bounds concurrent work
hard. A semaphore (`TCAB_ARENA_MAX_CONCURRENT`, default `2`) caps how many
matches and tournaments run their wasm at once. At capacity it rejects with
`503` and a `warn` log rather than queueing, so a flood of submissions cannot
pile up unbounded blocking tasks and stall the pod. A match holds one permit for
its single blocking execution; a tournament holds one across its whole
background drive, including publishing. Its Kubernetes `Deployment` carries CPU
requests and limits to match.

## Deployment

The arena service is the `test-cabinet-arena` crate (`crates/arena`), an
[Axum](https://github.com/tokio-rs/axum) server reusing the shared
[`match_play`](/components/core/overview/) engine and, through it, the
`foray-host` wasm sandbox. Its configuration is entirely environment variables,
documented in `crates/arena/src/config.rs`.

It binds all interfaces by default (`0.0.0.0:8791`), because the console reaches
it over the cluster network, and the deployment fronts it with the same
private-network boundary as the other services. It is deployed as a
single-replica `Deployment` with a `Service` and its own `ServiceAccount`, with
no API access and no volume. See [Kubernetes: staging &
prod](/deployment/kubernetes/run-plane/).
