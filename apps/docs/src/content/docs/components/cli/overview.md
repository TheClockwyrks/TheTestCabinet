---
title: Overview
---

The Test Cabinet's CLI is the `tcab` binary, an enqueue-and-watch client of the
[backend](/components/backend/overview/). It exposes the backend's run-queue
control plane on the command line so test case runs can be scripted and
benchmark sweeps run in batch.

`tcab` executes no runs locally. `tcab run` enqueues a run on the backend's job
queue, a [dispatcher](/components/dispatcher/overview/) claims it, and a per-run
[driver](/components/driver/overview/) pod executes it and streams progress back
through the backend. The CLI therefore needs no container runtime of its own. It
needs a reachable backend (`TCAB_BACKEND_URL`) and a logged-in account. See
[Execution](/components/core/execution/).

## Commands

### Running

- `run` enqueues a run for a test case version,
  [variant](/testing/end-to-end/overview/),
  [harness](/components/core/harnesses/), model,
  [orchestrator](/components/core/orchestrators/) and
  [engine](/components/core/engines/), prints the queued job id,
  streams the run's live [event stream](/components/core/events/) until it
  finishes, then reads the produced [run record](/components/core/run-records/)
  back and prints its summary. `--max-runtime` overrides the case's per-run cap,
  `--auth-mode` selects the harness authentication mode, and `--retry-count`
  sets how many times the backend retries the run after a terminal
  infrastructure error or a catastrophic build, with `0` disabling retries.
  `--out-dir` also writes the fetched record as `<record-id>.json` there.
  Requires `TCAB_BACKEND_URL` and a logged-in account.

  `--harness` selects one of the third-party CLI harnesses. A
  [gg](/gg/overview/) run carries a capability set and is launched from a
  console. `--engine` selects the runtime the game is built on, defaulting to
  `none`, and `seed` and `validate` take the same flag.

- `seed` runs only the [seeding](/components/core/execution/#seeding) step for a
  chosen variant and leaves the result on disk, so the exact inputs a harness
  would receive can be inspected without launching a container.
- `prompt` renders and prints the prompt a run would hand the harness for a
  given variant, without seeding or launching anything.
- `validate` runs [validation](/components/core/validation/) over a produced
  implementation and reports whether the tree satisfied everything the case
  declares. It leaves the directory as it found it, apart from the install and
  build it runs there and the media it synthesizes under `.vendor/`, so it is safe
  to point at a case's committed reference implementation. See [Exit
  codes](#exit-codes) for what makes it fail.
- `harnesses` lists the supported agent harnesses and whether each one's
  resolved authentication mode has the credentials it needs.
- `orchestrators` lists the built-in orchestrators and what each one does.
- `engines` lists the built-in engines and what each one provides.
- `test-case-groups` lists the [test-case
  groups](/components/core/test-case-groups/) and each one's member cases.

These listings accept `--json`.

### Accounts

- `register` creates an account on the [auth
  service](/components/auth/overview/) (`--username`, `--display-name`,
  `--password` or `TCAB_PASSWORD`), then logs in and stores the resulting token.
- `login` logs in to an existing account and stores the bearer token.
- `logout` discards the stored token.

### Reviewing and publishing

- `review <run-id> [--writeup writeup.md]` submits a
  [review](/components/core/results/#reviews) for a produced run, attributed to
  the logged-in account, from a writeup the reviewer authored locally. It
  defaults to `writeup.md` in the working directory. For a validator-rated run
  the writeup carries a single run-wide `aesthetic` rating and may carry
  `review.<id>` lines overriding individual validator verdicts; for a legacy
  run it carries `rating.<domain>` ratings with checklist verdicts. A run may
  carry several reviews, one per account.
- `publish <run-id>...` does self-review and publish in one step: it submits the
  operator's own review from a `<run-id>.md` writeup in the working directory,
  enqueues the publish, and prints the release's live progress until it
  finishes. Publishing a legacy run requires at least one review, which the
  self-review satisfies. A validator-rated run with no writeup is published
  without a self-review, and the command says so; whether a writeup-less run is
  validator-rated is decided by asking the backend for the run's case version, so
  a run that lacks a writeup while the backend cannot be reached is refused with
  that reason. Every run's writeup is gated before anything is submitted, so a
  batch is never left half-published. `--dry-run` prints the plan instead.
  Where different people review, use `review` and have an operator publish.

### Reference implementations and baselines

`publish-reference --env <prod|staging> <slug> [<version>] [--variant <slug>]
[--engine <slug>] [--all-variants]` deploys a case's [reference
implementations](/components/core/results/#reference-implementations) and
records where they landed. `--env` is required, so a publish can never silently
target prod; it selects the Cloudflare Pages project (prod's
`test-cabinet-references` or staging's `test-cabinet-references-staging`).
`--dry-run` prints the plan without building, deploying or writing anything.

The unit of work is the variant-on-an-engine pair, resolved from each targeted
variant's [`reference_implementation`](/testing/end-to-end/manifests/) key. For
each pair the command runs the case's `[build]` install then build in that
pair's reference directory, scrubs the output with the same secret-redaction
pass the [publisher](/components/core/results/#secret-redaction) uses, deploys
the static build to that Pages project under a per-variant, per-engine branch
alias, reads the served URL back out of `wrangler`'s output, and writes it into
the committed `test-cases/reference-builds.lock.json` under the `--env` key. The URL is parsed
rather than constructed because Cloudflare truncates long subdomains.

The command never contacts the backend, so it needs no backend URL or login,
only `wrangler`. The private backends ingest the lockfile from their own
checkout on the next `scripts/reingest-cluster.sh`, which upserts the
`case_reference_build` table the version response and public snapshot read. The
command also refreshes each variant's committed baseline validation media from
the build it deploys; `--skip-baselines` deploys without re-capturing when that
media is current.

An [asset-generation](/testing/asset-generation/overview/) case declares no
`[build]` table and produces no site, so the same command takes a different path
for it: it seeds a scratch workspace from the manifest, runs the variant's
`reference-impl/<variant>/draw.sh` with the case's drawing binary on `PATH`, and
uploads the frames and action logs to the public snapshot bucket under
`media/references/<slug>/<version>/<variant>/frames/`. That path needs the
target environment's `TCAB_R2_*` credentials rather than `wrangler`, and writes
no lockfile: the keys are constructible, so the backend discovers what exists by
listing that prefix at ingest.

`capture-baselines <slug> [<version>] [--variant <slug>] [--all-variants]
[--engine <slug>] [--dry-run]` regenerates a case version's committed baseline
[validation](/testing/end-to-end/instrumentation/) media. A variant has one
reference implementation per [engine](/components/core/engines/), so the unit it
works in is the variant/engine pair. For each targeted pair it runs the case's
`[build]` install then build in that reference-implementation directory,
produces every [scripted review
item](/testing/end-to-end/manifests/#automated-validation)'s declared outputs
from it, and writes them under the version folder's
`validation-baseline/<engine>/<variant>/`. That directory is regenerated
wholesale, so a renamed or removed output never lingers. The media is the
expected-behavior half of the reviewer's side-by-side and is a fixed property of
the case version.

How the outputs are produced follows the case, exactly as it does per run: a
case shipping a validator project for the engine has its baseline recorded by
running those suites against the reference implementation, and a case shipping
none has its reference build served and driven in a browser. Either way both
panes a reviewer compares come from the same scenario driven the same way, which
is the only thing that makes the comparison mean anything.

A reference implementation is the case's own answer, so every unit is expected to
run clean against it. A unit that does not is named as it is found and fails its
target; the sweep still runs every remaining target first, so one pass reports
every fault. `publish-reference` shares that rule through the same capture, and a
target whose baseline it could not produce is never deployed.

The command deploys nothing and writes no lockfile, so it takes no `--env` and
needs no Cloudflare credentials, only the case's toolchain — and a browser for a
case decided by browser scripts. It is the command to run while authoring or
revising validators.

### Analysis

`analyze` runs the [static code analyzer](/gg/analysis/code-analysis/) over a
directory and prints what it found:

```text
analyze <dir> [--seed-commit <sha>] [--tree-basis <pre-validation|post-validation>]
              [--top <n>] [--json]
```

It is the same analysis a run records about its produced tree, pointed at any
tree on disk, so it needs no run, container, backend or credentials, and it
executes nothing in the tree it reads.

The report leads with the figures that characterise a tree in one line, lays the
rest out by family in the order of the analyzer's own metric catalog, and
finishes with the specifics worth acting on: the most complex functions with
their file and line, the largest files, the import cycles, and the largest
duplicated blocks. `--seed-commit` makes the authored set exact when the
directory is a seeded run workspace; without it every file in the tree is
treated as authored, which is the right answer for an ordinary source tree.
`--json` prints the full analysis document for piping onward.

## Exit codes

`tcab` exits `0` only when the thing it was asked to do succeeded, so a script or
a CI step reads the status rather than the log. Anything that stopped a command
from doing its job — an unresolvable case, an unreachable backend, a missing
browser, a rejected login — exits non-zero with the reason on standard error.

Two commands additionally carry a _verdict_: they ran to completion and the
answer they arrived at is itself a pass or a fail. Both print a final line naming
every fault, so the tail of a log says what went wrong.

`validate` exits non-zero when the tree it was pointed at failed the case. Each
of these is a fault the tree earned:

- The implementation did not load.
- A required install or build step failed or was never reached, for a case whose
  validation runs them.
- A declared check could not be reached. The similarity a reached check records
  is a signal rather than a threshold, so it never decides the exit code.
- A declared proof-of-implementation artifact is missing.
- A gating validator did not run against the build, or decided a verdict against
  it. A validator recorded
  [inconclusive](/components/core/validation/#validators) said nothing about the
  build and leaves its point for a human, and a point an erratum excludes from
  scoring costs nothing, so neither fails the command.
- An [adversarial](/testing/adversarial/overview/) submission forfeited its
  match, which is a failure to present a playable controller. A loss or a draw is
  a result rather than a fault.

`capture-baselines` exits non-zero when any targeted reference build failed to
build or left a unit that did not run clean. The sweep finishes every target
first, so one pass reports every fault, and the final line names the targets that
failed. `publish-reference` decides a baseline capture by the same rule and skips
deploying the target whose media it could not produce.

## Authentication

The CLI deals with several independent kinds of credential and keeps them apart.

- Harness API keys are supplied to the run's container as secrets so the agent
  harness can reach its model provider. See
  [Authentication](/components/core/harnesses/#authentication).
- Backend reads, meaning resolving definitions and reading runs, are handled at
  the network layer: the CLI must be on the backend's private network, and
  presents no token to read.
- Account credentials authenticate the mutating backend calls (launching a run,
  reviewing, publishing) and the launch gate. `tcab login` or `tcab register`
  signs in to the [auth service](/components/auth/overview/) (`TCAB_AUTH_URL`)
  and stores the resulting bearer token at `~/.config/tcab/credentials.json`,
  overridable with `TCAB_CONFIG_DIR`. The CLI sends it on every launch, review
  and publish so the account is recorded. `TCAB_TOKEN` overrides the stored
  token for non-interactive use, and a password may be supplied with
  `--password` or `TCAB_PASSWORD`.
- Release credentials, the repository-host and Cloudflare tokens used to
  [release](/components/core/results/#publish) a run's code and playable build,
  live with the backend's publisher Job rather than with `tcab`.
