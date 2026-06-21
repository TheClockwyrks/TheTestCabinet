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

`tcab` surfaces the core's orchestration as a small set of subcommands,
including:

- **`run`** — execute a test case: resolve a version and
  [variant](/testing/end-to-end/overview/#variants), seed the repository, drive
  the selected [harness](/components/core/harnesses/) in a container while
  printing the live [event stream](/components/core/events/), then validate and
  write the [run record](/components/core/run-records/). A run's per-invocation
  cap can be overridden with `--max-runtime`.
- **`seed`** — run only the [seeding](/components/core/execution/#seeding) step
  for a chosen variant and leave the result on disk, so the exact inputs a
  harness would receive can be inspected without launching a container.
- **`prompt`** — render and print the
  [prompt](/testing/end-to-end/overview/#prompt-template) a run would hand the
  harness for a given variant, without seeding or launching anything.
- **`validate`** — run [validation](/components/core/validation/) over a
  produced implementation.
- **`register`** — create a user [account](/components/backend/overview/#accounts)
  on the [auth service](/components/auth/overview/) (`--username`,
  `--display-name`, `--password` or interactive), then log in and store the
  resulting token.
- **`login`** — log in to the auth service (`--username`, `--password`, or
  `TCAB_PASSWORD`, or interactive) and store the bearer token at
  `~/.config/tcab/credentials.json` (overridable with `$TCAB_CONFIG_DIR`) for
  subsequent mutating calls.
- **`logout`** — discard the stored token (calls the auth service's
  `POST /auth/logout`).
- **`push`** — the **release** half of [getting a run on the
  gallery](/components/core/results/#lifecycle): release a finished run's source
  and playable build, and store its record on the
  [backend](/components/backend/overview/) **without** a review. The run is private
  (not in the gallery) but its build is playable so it can be reviewed. Takes
  multiple records for batch. Requires a logged-in account.
- **`review`** — submit a [review](/components/core/results/#reviews) for a pushed
  run: `tcab review <run-record> [--writeup writeup.md]`, attributed to the
  logged-in account. A run may carry several reviews, one per account.
- **`publish`** — the solo convenience that does **push + self-review + publish**
  in one step: release a finished, locally-reviewed run, attach the operator's own
  review, and flip it public — including in batch. Publishing a run requires it to
  have at least one review; the self-review satisfies that. For the three-step
  flow where different people review, use `push` then `review` then have an
  operator publish. Requires a logged-in account.
- **`catalog`** — regenerate the bundled model dataset (`models.json`) every host
  ships, refreshing each model's OpenRouter prices, context window, and release
  date. (Test-case data is served from the backend's public snapshot, not emitted
  here.)
- **`harnesses`** — inspect the supported agent harnesses.

## Authentication

The CLI deals with several independent kinds of credential, and never conflates
them:

- **Harness API keys** are supplied to the run's container as secrets so the
  agent harness can reach its model provider. See
  [Authentication](/components/core/harnesses/#authentication).
- **Backend reads** — resolving definitions and reading runs — are handled at the
  network layer: the CLI must be on the backend's private network, but presents no
  token to read. See [Backend](/components/backend/overview/#authentication).
- **Account credentials** authenticate the *mutating* backend calls (`push`,
  `review`, `publish`). `tcab login` (or `register`) signs in to the
  [auth service](/components/auth/overview/) (`TCAB_AUTH_URL`) and stores the
  resulting bearer token at `~/.config/tcab/credentials.json` (overridable with
  `$TCAB_CONFIG_DIR`); the CLI sends it on every push, review, and publish so the
  account is recorded. A password may be supplied with `--password` or
  `TCAB_PASSWORD` rather than interactively. These calls fail without a logged-in
  account; reads do not.
- **Release credentials** are used for the operator's half of
  [pushing](/components/core/results/#push): a repository host credential (for
  example a GitHub token) to release a run's code to its own public repository, and
  a Cloudflare token (`CLOUDFLARE_API_TOKEN` with the Pages: Edit permission, plus
  `CLOUDFLARE_ACCOUNT_ID`) to deploy its build to Cloudflare Pages. Because
  releasing per-run artifacts is the operator's half, these live with the operator,
  not on the backend.
