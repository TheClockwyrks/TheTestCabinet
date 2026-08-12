---
title: Run a Test Case
---

## Overview

Launch one test case variant through an agent harness and watch it to completion.
This page uses the [CLI](/components/cli/overview/); the
[desktop app](/components/tauri/overview/) and the
[web console](/components/web/overview/) launch the same run. Every launcher
enqueues the run at the backend, which executes it as a per-run
[driver](/components/driver/overview/) Job.

## Prerequisites

- `TCAB_BACKEND_URL` pointing at a reachable backend whose queue an in-cluster
  [dispatcher](/components/dispatcher/overview/) is draining. Locally that is the
  [k3d service stack](/quickstarts/development/run-the-local-service-stack/).
- A signed-in account
  ([`tcab login`](/quickstarts/setup/register-and-login/)).
- Harness credentials configured in that deployment
  ([Set Up Authentication](/quickstarts/setup/set-up-authentication/)). The
  launching machine needs no container runtime and no provider key of its own.

## Run it

```sh
tcab run \
  --test-case carom --version v1.0.0 --variant base \
  --harness claude --model claude-opus-4-8
```

`--test-case`, `--version`, `--variant`, `--harness`, and `--model` are all
required: a run targets exactly one
[variant](/testing/end-to-end/overview/#variants), and `--model` is passed to the
harness unchanged. The optional flags:

- `--max-runtime <hours>` overrides the case's `max_runtime_hours` for this
  invocation. Fractional hours are accepted, for example `0.5`.
- `--auth-mode <auto|subscription|api-key>` selects the harness authentication
  mode for this run.
- `--retry-count <n>` sets how many times the backend retries the run after a
  terminal infrastructure error. The default is one retry; `0` disables retries.
- `--orchestrator <slug>` selects the orchestrator that conducts the harness
  sessions. It defaults to `one-shot`; see `tcab orchestrators`.
- `--out-dir <dir>` also writes the finished run record JSON there.

The command prints the queued job id, streams the live
[event stream](/components/core/events/) as the driver seeds the repository,
drives the harness, and [validates](/components/core/validation/) the result,
then prints the [run record](/components/core/run-records/) summary.

From a source checkout, substitute `cargo run -p test-cabinet-cli -- run …` for
`tcab run …`.

## Inspect the inputs without a run

```sh
tcab prompt --test-case carom --version v1.0.0 --variant base   # the rendered prompt
tcab seed   --test-case carom --version v1.0.0 --variant base   # the seeded repo, on disk
tcab harnesses                                                  # harness availability
```

These read the local checkout and contact nothing.

## Next steps

- [Review a Run](/quickstarts/development/review-a-run/) once it finishes.
- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/)
  for the full review workflow.
