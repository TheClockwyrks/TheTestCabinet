---
title: Agent Harnesses
---

One of the goals of The Test Cabinet is to evaluate not only models but also the
coding harnesses that drive them. If a model performs significantly better in
one harness than another, that is a useful data point. The agent harness layer
provides a single abstraction for invoking any supported third party harness so
that the same test case can be run against any of them without the rest of the
testing harness needing to know harness specific details.

This layer is responsible for absorbing harness specific quirks, including how
each harness is invoked non interactively, how each one reports its usage, and
how each one's activity is translated into the normalized stream defined in
[Events](/components/core/events/).

## Supported Harnesses

The agent harness layer supports the harnesses catalogued under
[Harnesses](/harnesses/overview/), each identified by a stable slug (`claude`, `codex`,
`cline`, and so on) used throughout run records and the site. That catalogue is
the authoritative list — its pages cover each harness's website, accepted model
IDs, invocation, and per-harness event and metric mapping. This page defines the
contracts those pages share.

Each harness has two halves. Its **declarative** half — name, the CLI binary, and
the command that installs that CLI — is authored as a manifest in the repo under
`harnesses/<slug>/harness.toml` (see `harnesses/README.md`), structured much like
a test case under `test-cases/`. Its **imperative** half — the non-interactive
invocation, usage parsing, and event translation described below — is code, in
the adapter for that slug in `crates/core/src/harness_registry.rs`. Adding a new
harness means both a manifest and an adapter.

## Installation

The run container ships **no agent harness**. The selected harness's CLI is
installed into the running container at run time, just before the session, by
running the manifest's `install` command — typically `npm install -g …` or a
curl-piped installer. This is the same mechanism a test case uses to prepare its
workspace with an [init command](/testing/end-to-end/overview/#init), and it runs
just before init does (see [Harness install](/components/core/execution/#harness-install)).

Installing at run time, rather than baking each harness into a container image,
is a deliberate choice: it means a run always exercises the harness's most
recently published version, with no image to rebuild when a harness ships an
update. The install command runs as the container's unprivileged run user and is
bounded by the run's maximum runtime, so it needs no root and can never run
unbounded.

## Invocations

A harness invocation must be given at least:

- The harness slug, which selects the underlying harness to invoke.
- A model ID, which is treated as an opaque string and passed to the harness
  unchanged. The caller is responsible for supplying a valid value for the
  selected harness.
- The prompt, which is the initial instruction handed to the harness. For a test
  case this directs the harness to build the game from the seeded specification.

A harness session is one unit of work: the harness's own agent loop is handed a
prompt and driven to completion. How many sessions a run drives, and how they
chain, is decided by the run's [orchestrator](/components/core/orchestrators/),
which owns the loop around the harness while the harness layer owns each
individual session. A run defaults to a single session (`one-shot`).

## Availability

Because the harness CLI is installed at run time rather than present in an image,
availability is checked in two stages.

Outside a run — for example the `tcab harnesses` status listing — availability is
a **cost-free readiness check** from configuration alone: a harness is available
when the credentials its resolved [authentication mode](#authentication) needs are
present — an API key set in the environment, or subscription credential files on
disk. This never starts a container (and never reads credential contents), so it
can report which harnesses are ready to run without installing anything. It cannot
confirm a harness's CLI will install successfully without actually running it;
that is left to the run.

During a run, the stronger check happens **inside the started container, after
the install command has run**: the run probes the installed binary (for example
with `--version`) to confirm the install produced a working CLI and to capture
the harness version recorded for the run. A failed probe — a missing or broken
binary — aborts the run with a clear error before a session is spent. This probe
must **never** start a session or take any other action that could incur cost.

## Per-harness configuration

A harness's **identity** — its name, CLI binary, and install command — is static and
checked in (`harnesses/<slug>/harness.toml` + the code adapter). Separately, an
operator can tune a few **mutable, per-harness knobs** at run time, stored in the
backend's `harness_config` table (keyed by slug) and edited from the console's
**Settings → Harnesses** section. A harness with no row runs fully default.

Today the only knob is **maximum parallelism**: the largest number of runs of a
harness the Test Cabinet will drive at once (`null` = unlimited). It exists because
running many instances of some harnesses in parallel is unreliable. The limit is
enforced by the backend's queue **at claim time**: the backend only hands a
dispatcher a job whose harness has fewer runs already occupying a slot (`dispatched`,
`starting`, or `running`) than its limit; any surplus run of that harness is held in
the **`pending`** state — a run the Test Cabinet _will_ run but is intentionally
holding back — until an in-flight run of the same harness finishes and frees a slot.
This per-harness cap composes with the dispatcher's global in-flight cap
(`TCAB_DISPATCHER_MAX_INFLIGHT`): a run must clear both to start.

The setting is served at `GET /harness-config` (open read; enumerates every harness
with its current config) and changed at `POST /harness-config/{slug}` (requires a
bearer token). Because it is backend-backed, it works identically in the web console
and the desktop app; the neighboring **authentication** controls on the same page are
host-local to the desktop app (see [Authentication](#authentication)) and are hidden
in the web console.

## Authentication

The Test Cabinet authenticates a harness in one of two modes:

- **API key.** A provider key the user exports on the host is injected into the
  run container as an environment variable. Billing is charged directly against
  the key, which yields an exact, attributable cost for the run. The variable the
  user exports is the conventional provider one, but the variable a harness's CLI
  actually reads can differ — `codex exec` reads `CODEX_API_KEY`, not
  `OPENAI_API_KEY` — and the harness layer absorbs this, reading the key from the
  host variable and injecting it under whatever variable the harness requires. A
  **per-harness override** `TCAB_API_KEY_<SLUG>` (for example `TCAB_API_KEY_KILO`)
  takes precedence over the shared provider variable, so harnesses that share a
  provider key — the OpenRouter harnesses all read `OPENROUTER_API_KEY` — can be
  given independent keys. The override is read in both the host (CLI/desktop) and
  the driver-pod paths.
- **Subscription.** The credential files a harness's CLI writes when the user
  signs in (for example `~/.codex/auth.json`) are copied into the run container at
  the paths the CLI reads under the run user's home, so the harness authenticates
  with the account subscription. The user signs in with the harness CLI itself in
  a trusted environment; The Test Cabinet never performs the login or mints
  tokens. A subscription carries no per-run provider charge — though a harness
  that still reports an exact charge (Claude Code does, even on a subscription) is
  recorded as-is, and one that reports none falls back to OpenRouter pricing.

Credentials and keys are supplied only as container secrets or copied-in files;
they are never written into the seeded repository or committed anywhere. Each
harness's **Authentication** page under [Harnesses](/harnesses/overview/) names the exact
variables and credential files it uses.

### Selecting a mode

The mode is resolved once, from the harness's declared capabilities and the host
environment, so the orchestrator and the `tcab harnesses` readiness listing select
identically. By default The Test Cabinet **prefers a subscription** when its
credentials are present, falling back to an API key otherwise. A user can lock the
mode with `TCAB_AUTH_MODE` (every harness) or `TCAB_AUTH_MODE_<SLUG>` (one harness,
which wins); the accepted values are `auto` (the default), `subscription`, and
`api-key`.

Selecting subscription means simply *not* injecting an API key: because the run
container starts clean, there is no ambient key for the harness to prefer, so the
copied-in credentials authenticate it.

A harness supports whichever modes its adapter declares. One that supports neither
the configured key nor a usable subscription reports itself **unavailable**, and a
run against it fails with a clear error — naming what to set or sign in to — before
a session is spent. [Antigravity](/harnesses/antigravity/overview/) supports only
subscription authentication: it is unavailable until the user signs in with its
CLI, and runnable once they have.

### Credential refresh

A subscription CLI may refresh its tokens mid-session, rewriting the credential
file inside the container. The container is ephemeral and torn down after the run,
so that refreshed copy is discarded — credentials are copied **in** only, never
written back to the host. The supported subscription harnesses use long-lived
refresh tokens, so the host credentials stay valid for the next run.

### Where the subscription credentials come from

Mode *selection* is the same everywhere; only *where the credential bytes are
read from* differs by run path, behind a single seam (`CredBytesSource`):

- **CLI/desktop (in-process).** The run executes on the trusted host that signed
  in, so the credentials are read straight from the user's home directory
  (`HostCreds`). This is the default and is unchanged.
- **Driver/cluster (backend-driven).** A driver pod is ephemeral and has no host
  home, so the credentials are supplied by an operator-provided **Secret** the
  dispatcher mounts into the pod, and the driver reads them from the mount
  (`MapCreds`) instead of `~`. Core selects the mode identically via
  `resolve_auth_with`, so a subscription harness — including the subscription-only
  [Antigravity](/harnesses/antigravity/overview/) — now runs on the cluster path
  too, not just locally. The Secret holds the same files `CredFile` names, keyed by
  basename; one shared subscription per deployment. See
  [Set Up Authentication → the service flow](/quickstarts/setup/set-up-authentication/#subscription-in-the-service-flow-the-cluster-path)
  and the [dispatcher](/components/dispatcher/overview/) config. The
  [desktop app](/components/tauri/overview/) is one such cluster deployment: it
  builds this Secret itself from the host's signed-in credential files, driven by
  its **Authentication** settings, so the desktop user manages keys, methods, and
  subscriptions through the UI rather than environment variables.

A **per-account credential vault** (each user supplying their own subscription,
keyed to their account) is a deferred follow-up — it would slot in as another
`CredBytesSource` with no change to the selection policy or this seam.

## Usage Reporting

Every invocation must return normalized usage data so that runs are comparable
across harnesses regardless of how each harness reports its own numbers. The
agent harness layer is responsible for translating each harness's raw output into
the normalized token classes defined in [Metrics](/components/core/metrics/#tokens).
A class a harness does not report is left `null` (not determinable) rather than
`0`, so a class the harness genuinely reports as zero stays distinguishable from
one it never reports — only the classes whose JSON keys a harness's usage shape
declares are filled in; the rest are `null`.

An invocation must also surface any **exact run cost the harness reports for
itself**. A harness that drives a single provider directly through an API key may
report the precise amount charged on its terminal result. When such a figure is
present the harness layer returns it, and the orchestrator uses it for both cost
figures without consulting OpenRouter, as described in
[Harness-reported cost](/components/core/metrics/#harness-reported-cost).
Harnesses that report no cost leave the reported cost unset and fall back to
OpenRouter-derived pricing.

When a no-cost harness is priced through OpenRouter, the harness layer maps its
model ID to the slug OpenRouter lists it under. Harnesses that route through
OpenRouter already use OpenRouter model IDs and pass them through unchanged;
harnesses that take a provider-native model ID map it to its OpenRouter
equivalent. Which case a harness falls into, and the exact mapping it applies,
is documented on that harness's Metrics page under [Harnesses](/harnesses/overview/).

## Event Reporting

Beyond its terminal outcome, every invocation produces a live stream of
normalized [harness events](/components/core/events/) as the harness runs. The
agent harness layer translates each harness's raw output into that uniform
stream so callers can render progress while a run is in progress and, when a
harness fails, see the harness's own diagnostic output instead of a single
opaque error. The command line interface prints these events as they arrive.

The layer uses one of two strategies to map a harness's output:

- **Structured mapping.** When a harness emits a documented machine readable
  event stream, the layer parses it and maps each record to its precise
  normalized event type. Most supported harnesses are mapped this way.
- **Best-effort mapping.** For a harness whose event format is not yet modeled
  in detail, the layer surfaces output as it streams — recognizable diagnostics
  become warning or error events and everything else becomes an unknown event
  carrying the raw output. This still gives callers live visibility and full
  failure output, and a harness can be promoted to a structured mapping later
  without changing the event contract.

Regardless of strategy, output a harness writes to standard error is surfaced as
warning events while the run is in progress, and an invocation that exits non
zero produces a terminal error event carrying the harness's own failure output —
the exit status alone is never the only signal a caller receives. A structured
mapping's exact field names are confirmed against real CLI output rather than a
published schema; where a stream has not yet been captured, the mapping reads
each field from a small set of candidate locations and falls back to an unknown
event rather than guessing, and the
[`raw.jsonl` and `events.jsonl`](/components/core/run-records/#co-located-run-files)
files a run records make it straightforward to confirm and refine those names
against an actual stream.

The mapping each individual harness applies — its raw stream shape, tool names,
and quirks, including which strategy it uses — is documented on that harness's
**Events** page under [Harnesses](/harnesses/overview/).
