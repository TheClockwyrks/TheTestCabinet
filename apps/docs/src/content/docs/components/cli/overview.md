---
title: Overview
---

The Test Cabinet's CLI is the `tcab` binary. It is a thin
[runner](/components/architecture/#runners-and-reporters) — an **enqueue + watch**
client of the [backend](/components/backend/overview/), exactly like the
[web console](/components/web/overview/). It exposes the backend's run-queue
control plane on the command line so that test case runs can be scripted, and so
benchmark sweeps can be run in batch without a person driving an interface. It is
the most direct way to automate The Test Cabinet.

`tcab` does **not** execute runs locally: it enqueues a run on the backend's
`/jobs` queue, a [dispatcher](/components/dispatcher/overview/) claims it, and a
per-run [driver](/components/driver/overview/) pod executes it (in a container, on
the cluster) and streams the run's progress back through the backend. So `tcab`
needs no container runtime of its own — it needs a reachable backend
(`TCAB_BACKEND_URL`) and a logged-in account. See
[Execution](/components/core/execution/).

## Commands

`tcab` surfaces the core's orchestration as a small set of subcommands,
including:

- **`run`** — enqueue a test case run on the backend (selecting a version,
  [variant](/testing/end-to-end/overview/#variants),
  [harness](/components/core/harnesses/), model, and
  [orchestrator](/components/core/orchestrators/)), print the queued job id, then
  stream the run's live [event stream](/components/core/events/) until it finishes
  and read the produced [run record](/components/core/run-records/) back to print
  its summary. Requires `TCAB_BACKEND_URL` and a logged-in account. A run's
  per-invocation cap can be overridden with `--max-runtime`; the harness auth mode
  with `--auth-mode`. Passing `--out-dir` also writes the fetched record JSON
  there (otherwise nothing is written locally — the backend holds the artifacts).
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
- **`review`** — submit a [review](/components/core/results/#reviews) for a produced
  run by id: `tcab review <run-id> [--writeup writeup.md]`, attributed to the
  logged-in account, from a writeup the reviewer authored locally (defaulting to
  `writeup.md` in the working directory). A run may carry several reviews, one per
  account.
- **`publish`** — the solo convenience that does **self-review + publish** in one
  step, by run id: submit the operator's own review (from a `<run-id>.md` writeup
  in the working directory) and flip the run public — including in batch.
  Publishing a run requires it to have at least one review; the self-review
  satisfies that. For the flow where different people review, use `review` then
  have an operator publish. Requires a logged-in account.
- **`publish-reference`** — deploy a case's
  [reference implementations](/components/core/results/#reference-implementations)
  and record their URLs: `tcab publish-reference --env <prod|staging> <slug>
  [<version>] [--variant <slug>] [--all-variants]`. The required `--env` selects
  the Cloudflare Pages project (prod's `test-cabinet-references` or staging's
  `test-cabinet-references-staging`); it has no default, so a publish can never
  silently target prod. For each targeted variant that declares a
  [`reference_implementation`](/testing/end-to-end/manifests/), it runs the case
  `[build]` install then build in that directory, scrubs the output with the same
  secret-redaction pass the [publisher](/components/core/results/#secret-redaction)
  uses, deploys the static build to that Pages project
  (`wrangler pages deploy <out> --project-name <project>
  --branch <slug>-<version-with-dots-as-dashes>-<variant>`), reads the served URL
  back from `wrangler`'s output (Cloudflare truncates long subdomains, so the URL
  is parsed rather than constructed), and **writes it into the committed
  `test-cases/reference-builds.lock.json`** under the `--env` key. It does not
  contact the backend: the private backends **ingest** that lockfile from their own
  checkout on the next `scripts/reingest-cluster.sh`, which upserts the
  `case_reference_build` table the version response and public snapshot read.
  Because the command only writes a local file, it needs no backend URL or login —
  just `wrangler`. Unlike a run's build, a reference implementation is **never
  seeded** and is deployed out-of-band by a person — this command is that step; it
  is also wired as a `workflow_dispatch` GitHub Actions job that commits the
  lockfile. It also refreshes each variant's committed **baseline** validation media
  from the build it deploys (the same capture `capture-baselines` performs), keeping
  the two in lockstep; pass `--skip-baselines` to deploy without re-capturing when
  that media is known to be current.

  For an **asset-generation** case the same command takes a different path,
  because such a case has no `[build]` table and produces no site: it seeds a
  scratch workspace from the manifest, runs the variant's
  `reference-impl/<variant>/draw.sh` with the case's drawing binary on `PATH`, and
  uploads the frames and action logs it produced to the public snapshot bucket
  under `media/references/<slug>/<version>/<variant>/frames/`. That needs the
  target environment's `TCAB_R2_*` credentials instead of `wrangler`, and writes
  **no lockfile** — the keys are constructible, so the backend discovers what
  exists by listing that prefix at ingest. See
  [Script references](/components/core/results/#script-references-asset-generation).
- **`capture-baselines`** — (re)generate a case version's committed **baseline**
  [validation](/testing/end-to-end/instrumentation/) media:
  `tcab capture-baselines <slug> [<version>] [--variant <slug>] [--all-variants]
  [--dry-run]`. For each targeted variant it runs the case `[build]` install then
  build in the variant's `reference_implementation` directory and drives every
  [scripted review item](/testing/end-to-end/manifests/#automated-validation)
  against that build, writing each declared output under the version folder's
  `validation-baseline/<variant>/` (regenerated wholesale, so a renamed or removed
  output never lingers). That media is the *expected-behavior* half of the reviewer's
  side-by-side — a fixed property of the case version, captured here rather than
  re-driven per run. Unlike `publish-reference` it deploys nothing and writes no
  lockfile, so it takes **no `--env`** and needs no Cloudflare credentials — just the
  case's toolchain and a browser. This is the command to run while authoring or
  revising debug scripts; `publish-reference` is only for the deploy.
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
- **Account credentials** authenticate the *mutating* backend calls (launching a
  `run`, plus `review` and `publish`) and the launch gate. `tcab login` (or
  `register`) signs in to the [auth service](/components/auth/overview/)
  (`TCAB_AUTH_URL`) and stores the resulting bearer token at
  `~/.config/tcab/credentials.json` (overridable with `$TCAB_CONFIG_DIR`); the CLI
  sends it on every launch, review, and publish so the account is recorded. A
  password may be supplied with `--password` or `TCAB_PASSWORD` rather than
  interactively. These calls fail without a logged-in account; reads do not.
- **Release credentials** — the repository-host and Cloudflare tokens used to
  [release](/components/core/results/#publish) a run's code and playable build — do
  **not** live with `tcab`: the public release happens in the backend's
  `tcab-publisher` Job at publish time, so the CLI carries no release credentials.
