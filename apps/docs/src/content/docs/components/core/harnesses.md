---
title: Agent Harnesses
---

## Overview

The Test Cabinet evaluates coding harnesses as well as models: a model that
performs significantly better in one harness than another is a useful data
point. The agent harness layer provides a single abstraction for invoking any
supported third-party harness, so the same test case runs against any of them
without the rest of the system knowing harness-specific details.

The layer absorbs those details. It owns how each harness is invoked
non-interactively, how each reports its usage, and how each one's activity is
translated into the normalized stream defined in
[Events](/components/core/events/).

## Supported harnesses

The layer supports the harnesses catalogued under
[Harnesses](/harnesses/overview/), each identified by a stable slug (`claude`,
`codex`, `cline`, and so on) used throughout run records and the site. That
catalogue is the authoritative list, covering each harness's website, accepted
model IDs, invocation, and per-harness event and metric mapping. This page
defines the contracts those pages share.

Each harness has two halves:

- The declarative half is a manifest at `harnesses/<slug>/harness.toml`,
  declaring the harness's name, its CLI binary, and the command that installs
  that CLI.
- The imperative half is code, in the adapter for that slug in
  `crates/core/src/harness_registry.rs`: the non-interactive invocation, usage
  parsing, and event translation described below.

Adding a harness means authoring both.

[gg](/gg/overview/) is The Test Cabinet's own harness and sits outside this
catalogue. It is a binary that runs inside the run container carrying its own
model client and agent loop, and it is invoked on its own path with no manifest
and no CLI install. A gg run still produces an ordinary [run
record](/components/core/run-records/) carrying `harness_slug: gg`.

## Installation

The run container ships no agent harness. The selected harness's CLI is
installed into the running container just before the session by running the
manifest's `install` command. This is the same mechanism a test case uses to
prepare its workspace with an [init
command](/testing/end-to-end/overview/#init), and it runs just before init does.

Installing at run time means a run always exercises the harness's most recently
published version, with no image to rebuild when a harness ships an update. The
install command runs as the container's unprivileged run user and is bounded by
the run's maximum runtime, so it needs no root and cannot run unbounded. A
non-zero exit or a timeout ends the run before a session is spent.

## Invocations

A harness invocation must be given at least:

- The harness slug, which selects the underlying harness to invoke.
- A model ID, treated as an opaque string and passed to the harness unchanged.
  The caller supplies a value valid for the selected harness.
- The prompt, the initial instruction handed to the harness. For a test case
  this directs the harness to build from the seeded specification.

A harness session is one unit of work: the harness's own agent loop is handed a
prompt and driven to completion. How many sessions a run drives, and how they
chain, is decided by the run's [orchestrator](/components/core/orchestrators/),
which owns the loop around the harness while this layer owns each individual
session. A run defaults to a single session (`one-shot`).

## Availability

Because the harness CLI is installed at run time rather than present in an
image, availability is checked in two stages.

Outside a run, for example the `tcab harnesses` status listing, availability is
a cost-free readiness check from configuration alone. A harness is available
when the credentials its resolved [authentication mode](#authentication) needs
are present: an API key set in the environment, or subscription credential files
on disk. This starts no container and reads no credential contents, so it
reports which harnesses are ready to run without installing anything. Whether a
harness's CLI installs successfully is left to the run.

During a run the stronger check happens inside the started container, after the
install command has run. The run probes the installed binary, for example with
`--version`, to confirm the install produced a working CLI and to capture the
harness version recorded for the run. A failed probe ends the run with a clear
error before a session is spent. This probe must **never** start a session or
take any other action that could incur cost.

## Per-harness configuration

A harness's identity is static and checked in. Separately, an operator can tune
mutable per-harness knobs at run time, stored in the backend's `harness_config`
table keyed by slug and edited from the console's Settings → Harnesses section.
A harness with no row runs at its defaults.

The only knob is maximum parallelism: the largest number of runs of a harness
the Test Cabinet drives at once, or `null` for unlimited. It exists because
running many instances of some harnesses in parallel is unreliable.

[gg](/gg/overview/) carries the knob too, even though it ships no manifest and
installs no CLI. Its runs occupy the queue exactly as a third-party harness's do,
and a [coverage plan](/components/backend/coverage/#harness-parallelism-comes-first)
reads the cap to decide what to launch first, so leaving gg off the surface would
leave the majority of the queue untunable.

The backend's queue enforces the limit at claim time. It hands a dispatcher only
a job whose harness has fewer runs already occupying a slot (`dispatched`,
`starting`, or `running`) than its limit. A surplus run of that harness is held
in the `pending` state until an in-flight run of the same harness frees a slot.
A `pending` run is one the Test Cabinet will run once a slot opens. This
per-harness cap composes with the dispatcher's global in-flight cap
(`TCAB_DISPATCHER_MAX_INFLIGHT`): a run must clear both to start.

The setting is served at `GET /harness-config`, an open read enumerating every
harness with its current config, and changed at `POST /harness-config/{slug}`,
which requires a bearer token. Being backend-backed, it works identically in the
web console and the desktop app. The neighbouring authentication controls on the
same page are host-local to the desktop app and are hidden in the web console.

## Authentication

The Test Cabinet authenticates a harness in one of two modes.

API key. A provider key the user exports on the host is injected into the run
container as an environment variable. Billing is charged directly against the
key, which yields an exact, attributable cost for the run. The variable the user
exports is the conventional provider one, and the variable a harness's CLI
actually reads can differ, so the layer reads the key from the host variable and
injects it under whatever variable the harness requires. `codex exec` reads
`CODEX_API_KEY` rather than `OPENAI_API_KEY`.

A per-harness override `TCAB_API_KEY_<SLUG>`, for example `TCAB_API_KEY_KILO`,
takes precedence over the shared provider variable. Harnesses that share a
provider key, such as the OpenRouter harnesses all reading `OPENROUTER_API_KEY`,
can therefore be given independent keys. The override is read in both the host
(CLI and desktop) and the driver-pod paths.

Subscription. The credential files a harness's CLI writes when the user signs
in, for example `~/.codex/auth.json`, are copied into the run container at the
paths the CLI reads under the run user's home, so the harness authenticates with
the account subscription. The user signs in with the harness CLI itself in a
trusted environment; The Test Cabinet performs no login and mints no tokens. A
subscription carries no per-run provider charge. A harness that still reports an
exact charge, as Claude Code does even on a subscription, has that figure
recorded as-is; one that reports none falls back to OpenRouter pricing.

Credentials and keys are supplied only as container secrets or copied-in files,
and are never written into the seeded repository. Each harness's Authentication
page under [Harnesses](/harnesses/overview/) names the exact variables and
credential files it uses.

### Selecting a mode

The mode is resolved once, from the harness's declared capabilities and the host
environment, so the run path and the `tcab harnesses` readiness listing select
identically. By default The Test Cabinet prefers a subscription when its
credentials are present and falls back to an API key otherwise. A user can lock
the mode with `TCAB_AUTH_MODE` for every harness or `TCAB_AUTH_MODE_<SLUG>` for
one harness, which wins. The accepted values are `auto` (the default),
`subscription`, and `api-key`.

Selecting subscription means declining to inject an API key. The run container
starts clean, so there is no ambient key for the harness to prefer and the
copied-in credentials authenticate it.

A harness supports whichever modes its adapter declares. One with neither a
configured key nor a usable subscription reports itself unavailable, and a run
against it fails before a session is spent, with an error naming what to set or
sign in to. [Antigravity](/harnesses/antigravity/overview/) declares
subscription authentication only: it is runnable once the user has signed in
with its CLI.

### Credential refresh

A subscription CLI may refresh its tokens mid-session, rewriting the credential
file inside the container. The container is ephemeral and torn down after the
run, so that refreshed copy is discarded. Credentials are copied in only. The
supported subscription harnesses use long-lived refresh tokens, so the host
credentials stay valid for the next run.

### Subscription credential sources

Mode selection is the same everywhere. Only where the credential bytes are read
from differs by run path, behind a single seam (`CredBytesSource`):

- CLI and desktop, in process. The run executes on the trusted host that signed
  in, so the credentials are read from the user's home directory (`HostCreds`).
- Driver on a cluster. A driver pod is ephemeral and has no host home, so the
  credentials come from an operator-provided Secret the dispatcher mounts into
  the pod, which the driver reads (`MapCreds`). Core selects the mode
  identically through `resolve_auth_with`, so a subscription harness runs on the
  cluster path as well as locally. The Secret holds the same files the adapter's
  credential spec names, keyed by basename, giving one shared subscription per
  deployment. See [Set Up
  Authentication](/quickstarts/setup/set-up-authentication/).

The [desktop app](/components/tauri/overview/) is one such cluster deployment.
It builds this Secret itself from the host's signed-in credential files, driven
by its Authentication settings, so the desktop user manages keys, methods, and
subscriptions through the UI rather than environment variables.

## Usage reporting

Every invocation must return normalized usage data so runs are comparable across
harnesses regardless of how each reports its own numbers. The layer translates
each harness's raw output into the normalized token classes defined in
[Metrics](/components/core/metrics/#tokens). Only the classes whose JSON keys a
harness's usage shape declares are filled in; the rest are `null`, so a class a
harness genuinely reports as zero stays distinguishable from one it never
reports.

An invocation must also surface any exact run cost the harness reports for
itself. A harness that drives a single provider directly through an API key may
report the precise amount charged on its terminal result. The layer returns that
figure and it becomes both cost figures, with no OpenRouter lookup, as described
in [Harness-reported cost](/components/core/metrics/#harness-reported-cost).
Harnesses that report no cost leave it unset and are priced from OpenRouter.

When a harness is priced through OpenRouter, the layer maps its model ID to the
slug OpenRouter lists it under. Harnesses that route through OpenRouter already
use OpenRouter model IDs and pass them through unchanged; harnesses that take a
provider-native model ID have it mapped to its OpenRouter equivalent. Which case
a harness falls into, and the exact mapping it applies, is documented on that
harness's Metrics page.

## Event reporting

Beyond its terminal outcome, every invocation produces a live stream of
normalized [harness events](/components/core/events/) as the harness runs. The
layer translates each harness's raw output into that uniform stream, so callers
render progress while a run is in progress and see a failing harness's own
diagnostic output rather than a single opaque error. The command line interface
prints these events as they arrive.

The layer uses one of two strategies to map a harness's output:

- Structured mapping. A harness that emits a documented machine-readable event
  stream has it parsed and each record mapped to its precise normalized event
  type. Most supported harnesses are mapped this way.
- Best-effort mapping. A harness whose event format is not yet modelled in
  detail has its output surfaced as it streams: each standard-output line
  becomes an unknown event carrying the raw output, as a JSON value where the
  line is JSON. Callers still get live visibility and full failure output, and
  the harness can be promoted to a structured mapping later without changing the
  event contract.

Under either strategy, output a harness writes to standard error is surfaced as
warning events while the run is in progress, and an invocation that exits
non-zero produces a terminal error event carrying the harness's own failure
output, so a caller always receives more than the exit status.

A structured mapping's field names are confirmed against real CLI output rather
than a published schema. Where a stream has not yet been captured, the mapping
reads each field from a small set of candidate locations and falls back to an
unknown event rather than guessing. The [`raw.jsonl` and
`events.jsonl`](/components/core/run-records/#co-located-run-files) files every
run records make it straightforward to confirm and refine those names against an
actual stream.

The mapping each harness applies, including which strategy it uses, is
documented on that harness's Events page under
[Harnesses](/harnesses/overview/).
