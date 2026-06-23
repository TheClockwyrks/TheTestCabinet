---
title: Overview
---

The arena service is the dedicated **execution host** for the
[adversarial](/testing/adversarial/overview/) test type's head-to-head play: quick
**matches** (pit two controllers, get a replay back immediately) and **tournaments**
(run every pair in a field, streaming live per-match progress). Running those matches
is **CPU-bound, in-process wasm** — fast but heavy — so it lives in its own service
rather than the single-replica control-plane [backend](/components/backend/overview/).

It is a deliberate data-plane peer, kept **separate** from the backend the same way
the [artifact service](/components/artifacts/overview/) is: the backend owns the data
(controller inputs, published tournaments, stored replays); the arena owns the
*execution*. A [console](/components/web/overview/) POSTs a match or tournament to the
arena and streams a tournament's live progress from it; arena **reads** (published
tournaments + per-match replays) stay on the backend. The backend reports the arena's
public base URL (`TCAB_ARENA_PUBLIC_URL`) via `GET /config`, and the console fetches
it for those run actions.

## Stateless by design

The arena holds **no database and no disk**. It fetches every controller input from
the backend over HTTP — resolve a test-case version, a baseline's
`references/<id>.wasm`, a pushed run's `controller.wasm`, and the pushed-controller
listing — and persists a finished tournament and its per-match replays back to the
backend. Only two controller kinds are resolvable in this topology: committed
**baselines** and **pushed-run** controllers. A *run-local* controller (one resolved
from a host's own run output dir) has no home in a stateless service, so it is
rejected with a `400`; the desktop app, which runs the same engine in-process against
its local worker, is the only place those resolve.

Because the in-flight tournament registry and its live progress channel are
**in-memory and per-pod**, the arena runs as a **single replica**. Scale its
throughput with its CPU and the concurrency cap, not the replica count.

## Capacity guard

The arena is the CPU-bound pod of the topology, so it bounds concurrent work hard: a
semaphore (`TCAB_ARENA_MAX_CONCURRENT`, default `2`) caps how many matches/tournaments
run their wasm at once. At capacity it **rejects** with `503` (and a `warn` log)
rather than queueing — a match holds one permit for its single blocking execution; a
tournament holds one for its whole background drive. Its Kubernetes `Deployment`
carries real CPU `requests`/`limits` to match.

## Auth

The arena's run endpoints (`POST /matches`, `POST /tournaments`,
`GET /matches/controllers`, `GET /tournaments/{id}/events`) are **unauthenticated**
behind the private-network boundary — faithful to the worker the console still posts
them token-less to. It has **no** Kubernetes API access; it only talks HTTP to the
backend.

## Status

The arena service is implemented as the `test-cabinet-arena` crate (`crates/arena`),
an [Axum](https://github.com/tokio-rs/axum) server reusing the shared
[`match_play`](/components/core/overview/) engine (and, through it, the `foray-host`
wasm sandbox). Its configuration is entirely environment variables, documented on its
[`config.rs`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/crates/arena/src/config.rs).
It binds all interfaces by default (`0.0.0.0:8791`) because the console reaches it over
the cluster network; the deployment fronts it with the same private-network boundary
as the other services. It is deployed as a single-replica `Deployment` + `Service` +
its own `ServiceAccount` (no API access, no PVC — it is stateless) — see
[Kubernetes: staging & prod](/deployment/kubernetes/).
