---
title: Overview
---

The Test Cabinet's CLI is the `tcab` binary. It is a thin
[runner](/components/architecture/#runners-and-reporters) over the
[core](/components/core/overview/): it exposes the core's run functionality on the
command line so that test case runs can be scripted, and so benchmark sweeps can
be run in batch without a person driving an interface. It is the most direct way
to automate The Test Cabinet.

Because `tcab` is a runner it needs a supported container runtime (Docker or a
compatible runtime) on the machine it runs on. See
[Execution](/components/core/execution/).

## Commands

`tcab` surfaces the core's orchestration as a small set of subcommands, including:

- **`run`** — execute a test case: resolve a version and
  [variant](/components/core/test-cases/#variants), seed the repository, drive
  the selected [harness](/components/core/harnesses/) in a container while
  printing the live [event stream](/components/core/events/), then validate and
  write the [run record](/components/core/run-records/). A run's per-invocation
  cap can be overridden with `--max-runtime`.
- **`seed`** — run only the [seeding](/components/core/execution/#seeding) step
  for a chosen variant and leave the result on disk, so the exact inputs a
  harness would receive can be inspected without launching a container.
- **`prompt`** — render and print the
  [prompt](/components/core/test-cases/#prompt-template) a run would hand the
  harness for a given variant, without seeding or launching anything.
- **`validate`** — run [validation](/components/core/validation/) over a produced
  implementation.
- **`publish`** — [publish](/components/core/results/) a finished run, including
  in batch: release its code and build to a public repository, then submit its
  record and review to the [backend](/components/backend/overview/), which records
  it and refreshes the public snapshot.
- **`catalog`** / **`harnesses`** — inspect the available test cases and the
  supported agent harnesses.

## Authentication

The CLI deals with several independent kinds of credential, and never conflates
them:

- **Harness API keys** are supplied to the run's container as secrets so the agent
  harness can reach its model provider. See
  [Authentication](/components/core/harnesses/#authentication).
- **Backend access** for resolving definitions and submitting results is handled
  at the network layer — the CLI must be on the backend's private network rather
  than presenting a token. See [Backend](/components/backend/overview/#authentication).
- **Release credentials** are used for the operator's half of
  [publishing](/components/core/results/#publishing): a repository host credential
  (for example a GitHub token) to release a run's code to its own public
  repository, and a Cloudflare token (`CLOUDFLARE_API_TOKEN` with the Pages: Edit
  permission, plus `CLOUDFLARE_ACCOUNT_ID`) to deploy its build to Cloudflare
  Pages. Because releasing per-run artifacts is the operator's half, these live
  with the operator, not on the backend.
