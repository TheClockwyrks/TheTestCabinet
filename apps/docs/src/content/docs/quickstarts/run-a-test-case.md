---
title: Run a Test Case
---

Drive a single test case through an agent harness and write a run record. For
the full walkthrough, prerequisites, and platform notes see
[First Time Setup](/guides/first-time-setup/).

## Prerequisites

A working setup: a container runtime on `PATH` (Podman or Docker), the harness
image built, the Chromium browser installed for the
[browser driver](/components/core/validation/), and the harness API key exported
or in a `.env`. See [First Time Setup](/guides/first-time-setup/) if any of those
are missing.

## Run it

From the repository root (so the `test-cases/` catalog and browser driver
resolve):

```sh
tcab run \
  --test-case pong --version v1.0.0 --variant base \
  --harness claude --model anthropic/claude-opus-4 \
  --out-dir runs
```

From a source checkout, substitute `cargo run -p test-cabinet-cli -- run …` for
`tcab run …`.

- `--variant` is **required**: a run targets exactly one
  [variant](/components/core/test-cases/#variants).
- `--model` is passed to the harness unchanged; it is opaque to The Test Cabinet.
- `--max-runtime <seconds>` overrides the case's `max_runtime_seconds` for this
  invocation only.

The run renders the references, seeds a fresh repository, drives the harness in a
container while printing the live [event stream](/components/core/events/), then
[validates](/components/core/validation/) and writes
`runs/<id>/run-record.json` alongside a copy of the implementation.

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
