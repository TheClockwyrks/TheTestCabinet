---
title: Run a Test Case
---

Launch a single test case through an agent harness and watch it to completion.
This quickstart uses the [CLI](/components/cli/overview/), the most direct path
for scripting and batch sweeps. You can also launch and watch runs interactively
in the [Tauri desktop app](/components/tauri/overview/) or the
[web console](/components/web/overview/). All three **enqueue** the run at the
backend, which executes it server-side as a per-run
[driver](/components/driver/overview/) `Job`. For the full walkthrough,
prerequisites, and platform notes see [First Time Setup](/guides/first-time-setup/).

## Prerequisites

A working setup: a **reachable backend** (`TCAB_BACKEND_URL`) whose run queue an
in-cluster [dispatcher](/components/dispatcher/overview/) is draining — for local
development, the [k3d service stack](/development/running/) brought up and
forwarded — plus a logged-in account (`tcab login`). `tcab` needs **no** container
runtime of its own; the cluster supplies the harness credentials to the run. See
[First Time Setup](/guides/first-time-setup/) if any of those are missing.

## Run it

```sh
tcab run \
  --test-case pong --version v1.0.0 --variant base \
  --harness claude --model claude-opus-4-8
```

From a source checkout, substitute `cargo run -p test-cabinet-cli -- run …` for
`tcab run …`.

- `--variant` is **required**: a run targets exactly one
  [variant](/testing/end-to-end/overview/#variants).
- `--model` is passed to the harness unchanged; it is opaque to The Test Cabinet.
- `--max-runtime <seconds>` overrides the case's `max_runtime_seconds` for this
  invocation only.
- `--out-dir runs` is optional: it writes the fetched run record JSON locally
  (otherwise nothing is written — the backend holds the artifacts).

`tcab run` enqueues the run on the backend's queue, prints the queued job id,
streams the live [event stream](/components/core/events/) as the driver executes
it (seeding a fresh repository, driving the harness in a sandbox pod, then
[validating](/components/core/validation/)), and reads the produced
[run record](/components/core/run-records/) back to print its summary.

## Inspect inputs without a run

```sh
tcab prompt --test-case pong --version v1.0.0 --variant base   # the rendered prompt
tcab seed   --test-case pong --version v1.0.0 --variant base   # the seeded repo, on disk
tcab harnesses                                                 # harness availability
```

See the [CLI overview](/components/cli/overview/) for every subcommand.

## Next steps

- [Review a Run](/quickstarts/review-a-run/) once it finishes.
- [Reviewing Test Run Results](/guides/reviewing-test-run-results/) for the full
  review workflow.
