---
title: Run a Test Case
---

## Overview

Launch one test case variant through an agent harness and watch it to completion.
The [console](/components/web/overview/) enqueues the run at the backend, which
executes it as a per-run [driver](/components/driver/overview/) Job. The
[CLI](/components/cli/overview/) inspects the inputs a run is given without
contacting anything.

## Prerequisites

- A reachable console whose backend queue an in-cluster
  [dispatcher](/components/dispatcher/overview/) is draining: a deployment's
  `console.testcabinet.ai`, reached through Cloudflare Access, or the local
  [k3d service stack](/quickstarts/development/run-the-local-service-stack/).
- Harness credentials configured in that deployment
  ([Set Up Authentication](/quickstarts/setup/set-up-authentication/)). The
  launching machine needs no container runtime and no provider key of its own.

## Run it

In the console, open the case's page, pick the version and the
[variant](/testing/end-to-end/overview/#variants), choose the harness and the
model, and start the run. A run targets exactly one variant, and the model is
passed to the harness unchanged. The launch form's optional settings:

- The maximum runtime overrides the case's `max_runtime_hours` for this run.
  Fractional hours are accepted, for example `0.5`.
- The authentication mode (`auto`, `subscription` or `api-key`) selects how the
  harness authenticates for this run.
- The retry count sets how many times the backend retries the run after a
  terminal infrastructure error. The default is one retry; `0` disables
  retries.
- The orchestrator selects what conducts the harness sessions. It defaults to
  `one-shot`; see [Orchestrators](/orchestrators/overview/).
- The engine selects the [engine](/components/engines/overview/) the produced
  build is written against, one the case supports. It defaults to `none`.

The console shows the queued job, streams the live
[event stream](/components/driver/events/) as the driver seeds the repository,
drives the harness, and [validates](/components/driver/validation/) the result,
then shows the [run record](/components/contracts/run-records/) summary.

## Inspect the inputs without a run

From the `microservice-driver` checkout, or with a released `tcab`:

```sh
tcab prompt --test-case carom --version v1.0.0 --variant base   # the rendered prompt
tcab seed   --test-case carom --version v1.0.0 --variant base   # the seeded repo, on disk
```

These read the `test-suites` checkout and contact nothing. From source,
substitute `cargo run -p test-cabinet-driver --bin tcab -- prompt …` for
`tcab prompt …`.

## Next steps

- [Review a Run](/quickstarts/development/review-a-run/) once it finishes.
- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/)
  for the full review workflow.
