---
title: Overview
---

The Test Cabinet's CLI is the `tcab` binary, the second binary of the
`microservice-driver` repository, built over the same run engine as the
[driver](/components/driver/overview/). It is the tool a developer or an
operator runs on their own machine: it validates a tree, analyzes its code,
captures and publishes a case's references, ingests definitions into a backend,
and inspects what a run would seed and prompt. A run itself is launched from the
[console](/components/web/overview/) and executed by a driver; the CLI launches
nothing.

The CLI needs no container runtime. A command that resolves a test case takes
it from the local checkout or from a backend (`TCAB_BACKEND_URL`), and a
command that reaches a deployed environment crosses its
[edge](/deployment/kubernetes/edge/) with an Access credential, a person's user
token or automation's service token.

## Commands

### Inspecting a run's inputs

- `seed` runs only the [seeding](/components/driver/execution/#seeding) step for
  a chosen variant and leaves the result on disk, so the exact inputs a harness
  would receive can be inspected without launching a container.
- `prompt` renders and prints the prompt a run would hand the harness for a
  given variant, without seeding or launching anything.
- `validate` runs [validation](/components/driver/validation/) over a produced
  implementation and reports whether the tree satisfied everything the case
  declares. It leaves the directory as it found it, apart from the install and
  build it runs there and the media it synthesizes under `.vendor/`, so it is
  safe to point at a case's committed reference implementation. See [Exit
  codes](#exit-codes) for what makes it fail.

`seed`, `prompt` and `validate` each name a test case by its slug and version,
resolving it against the local checkout or the backend. A
[test suite](/test-suites/overview/)'s test case is named the same way, by the
catalog identity its definition was ingested under. `--variant` defaults to
`base`, which is the only variant a suite-defined test case carries; naming a
variant the case does not declare is refused. `--engine` selects the
[engine](/components/engines/engines/) the seed, the prompt and the validation
are rendered for, defaulting to `none`.

### Definitions

- `ingest` scans the backend's checkout and copies what it finds into the
  [definition store](/components/backend/overview/), so edits to test cases and
  test suites reach a running backend. Targets are positional, each a bare id
  expanding to every version it declares or an `id@version` naming exactly one,
  and naming none scans the whole checkout. `--force` overwrites a version the
  store already holds, which is what iterating in place on one version string
  needs. `--changed` limits the scan to the versions whose content differs from
  what the store holds, and combines with a target and with `--env`. The
  command prints a line per version as it lands and closes with the
  ingested and skipped counts. Against a local backend it requires
  `TCAB_BACKEND_URL` and the backend's service token (`TCAB_BACKEND_SERVICE_TOKEN`).
  See [Running](/development/running/) for the local loop this sits in.
  `--env <staging|prod>` targets a deployed environment instead, through its
  edge hostname with the [service token](#authentication): the backend's ingest
  sidecar refreshes its `test-suites` checkout, and the `cold-storage` clone
  beside it, to the tip of the branch the environment ingests, then scans it,
  and the feed streams back as it does locally.

### Reference implementations and baselines

`publish-reference --env <prod|staging> <slug> [<version>] [--variant <slug>]
[--engine <slug>] [--all-variants]` deploys a case's [reference
implementations](/components/backend/results/#reference-implementations) and
records where they landed. `--env` is required, so a publish always names the
environment it targets. It selects the Cloudflare Pages project, prod's
`test-cabinet-references` or staging's `test-cabinet-references-staging`.
`--dry-run` prints the plan without building, deploying or writing anything.

The unit of work is the variant-on-an-engine pair, resolved from each targeted
variant's [`reference_implementation`](/testing/end-to-end/manifests/) key. For
each pair the command runs the case's `[build]` install then build in that
pair's reference directory, scrubs the output with the same secret-redaction
pass a run's [publish](/components/backend/results/#secret-redaction) uses,
deploys the static build to that Pages project under a per-variant, per-engine
branch alias, reads the served URL back out of `wrangler`'s output, and writes
it into the committed `test-cases/reference-builds.lock.json` under the `--env`
key. The URL is parsed rather than constructed because Cloudflare truncates long
subdomains.

The command contacts no backend, so it requires only `wrangler`. The private
backends ingest the lockfile from their own checkout on the next
`tcab ingest --env <env>`, which upserts the `case_reference_build` table the
version response and public dataset read. The command also refreshes each
variant's committed baseline validation media from the build it deploys.
`--skip-baselines` deploys without re-capturing when that media is current.

`publish-asset-reference --env <prod|staging> <slug> [<version>]
[--variant <slug>] [--all-variants]` is the counterpart for an
[asset-generation](/testing/asset-generation/overview/) case, which declares no
`[build]` table and produces no site. It seeds a scratch workspace from the
manifest, runs the variant's `reference-impl/<variant>/draw.sh` with the case's
drawing binary on `PATH`, and writes the frames and action logs to the public
bucket under `media/references/<slug>/<version>/<variant>/frames/` through the
environment's [artifacts service](/components/artifacts/overview/#routes)
(`PUT /public/{key}`), crossing the edge with the service token. It writes no
lockfile because the keys are constructible, so the backend discovers what
exists by listing that prefix at ingest.

`capture-baselines <slug> [<version>] [--variant <slug>] [--all-variants]
[--engine <slug>] [--dry-run]` regenerates a case version's committed baseline
[validation](/testing/end-to-end/instrumentation/) media. A variant has one
reference implementation per [engine](/components/engines/engines/), so the
unit it works in is the variant/engine pair. For each targeted pair it runs the
case's `[build]` install then build in that reference-implementation directory,
produces every [scripted review
item](/testing/end-to-end/manifests/#automated-validation)'s declared outputs
from it, and writes them under the version's
`validation-baseline/<engine>/<variant>/` in the `cold-storage` submodule,
together with the [shared image
store](/components/driver/validation/#the-shared-image-store) the recordings
among them draw from. That directory is regenerated wholesale, so a renamed or
removed output never lingers. The media is the expected-behavior half of the
comparison a reviewer makes and is a fixed property of the case version.

The cold-storage root defaults to `cold-storage/` beside the catalog's
`test-cases/`, and `TCAB_COLD_STORAGE_DIR` overrides it (see [where baselines
live](/components/driver/validation/#where-baselines-live)). A capture into the
default root refuses to run until the submodule is checked out.

How the outputs are produced follows the case, exactly as it does per run: a
case shipping a validator project for the engine has its baseline recorded by
running those suites against the reference implementation, and a case shipping
none has its reference build served and driven in a browser. Both halves of
that comparison therefore come from the same scenario driven the same way.

A reference implementation is the case's own answer, so every unit is expected
to run clean against it. A unit that does not fails its target. The sweep still
runs every remaining target first, so one pass reports every fault.
`publish-reference` shares that rule through the same capture, and a target
whose baseline it could not produce is never deployed.

`capture-baselines` deploys nothing and writes no lockfile, so it takes no
`--env` and requires only the case's toolchain, plus a browser for a case
decided by browser scripts.

### Analysis

`analyze` runs the [static code analyzer](/gg/analysis/code-analysis/) over a
directory and prints what it found:

```text
analyze <dir> [--seed-commit <sha>] [--tree-basis <pre-validation|post-validation>]
              [--top <n>] [--json]
```

It is the same analysis a run records about its produced tree, the driver's own
module pointed at any tree on disk, so it needs no run, container, backend or
credentials, and it executes nothing in the tree it reads.

`--seed-commit` makes the authored set exact when the directory is a seeded run
workspace. Left off, every file in the tree is treated as authored, which is the
right answer for an ordinary source tree. `--json` prints the full analysis
document for piping onward.

## Exit codes

`tcab` exits `0` only when the thing it was asked to do succeeded, so a script
or a CI step reads the status rather than the log. Anything that stopped a
command from doing its job, such as an unresolvable case, an unreachable
backend, a missing browser or a refused service token, exits non-zero with the
reason on standard error.

Two commands additionally carry a verdict: they ran to completion and the answer
they arrived at is itself a pass or a fail. Both report every fault they found.

`validate` exits non-zero when the tree it was pointed at failed the case. Each
of these is a fault the tree earned:

- The implementation did not load.
- A required install or build step failed or was never reached, for a case whose
  validation runs them.
- A declared check could not be reached. The similarity a reached check records
  is a signal rather than a threshold, so it never decides the exit code.
- A declared proof-of-implementation artifact is missing.
- A gating validator decided a verdict against the build.
- A gating validator did not run against the build, whether it failed the
  debug-API contract or was recorded
  [inconclusive](/components/driver/validation/#validators). Scoring skips an
  inconclusive unit, but `validate` asks whether the tree satisfied everything
  the case declares, and a unit that decided nothing has not. The final line
  separates the two: contract failures by verdict id, and inconclusive units
  grouped by kind and reason, with the ids listed when there are few and one
  shared reason quoted once when every unit failed for it. A point an erratum
  excludes from scoring costs nothing.
- An [adversarial](/testing/adversarial/overview/) submission forfeited its
  match, which is a failure to present a playable controller. A loss or a draw
  is a result rather than a fault.
- A requirement of a [test suite](/test-suites/overview/)'s test case failed, or
  a functional one was left undecided by validators that could not be run. A
  non-functional requirement is judged by review and decides nothing here.

`capture-baselines` exits non-zero when any targeted reference build failed to
build or left a unit that did not run clean. The sweep finishes every target
first, so one pass reports every fault. `publish-reference` decides a baseline
capture by the same rule and skips deploying the target whose media it could not
produce.

## Authentication

The CLI keeps its credentials apart.

- A deployed environment is reached through its edge with an Access credential
  on every request. As a person, it is a user token from `cloudflared access
  login` on the environment's origin, placed in `TCAB_ACCESS_TOKEN` and sent as
  the `cf-access-token` header; the assertion the edge mints carries the
  person's `email`. For automation, it is the service token
  `TCAB_ACCESS_CLIENT_ID` and `TCAB_ACCESS_CLIENT_SECRET`, sent as the
  `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers, whose assertion
  carries a `common_name`, which is what the backend records the call under.
  `--env` selects the hostname, `console.testcabinet.ai` for prod and
  `console.staging.testcabinet.ai` for staging, and the command addresses the
  backend under `/api/` and the artifacts service under `/artifacts/`. See
  [Identity](/components/auth/overview/).
- A local backend is reached directly, and `ingest` presents its service token.
  `seed`, `prompt` and `validate` read definitions, which any identity may do.
- Release credentials for a reference implementation, the Cloudflare token
  `wrangler` deploys with, live in `wrangler`'s own configuration. The
  credentials that release a run's code and playable build live with the
  [repos service](/components/repos/overview/) and the publisher Job rather
  than with `tcab`.
