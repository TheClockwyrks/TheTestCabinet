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
[Harnesses](/harnesses/), each identified by a stable slug (`claude`, `codex`,
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

A run corresponds to a single harness session driven to completion. The
harness's own agent loop performs the work of the run; orchestrating multiple
chained sessions is out of scope for now.

This reflects a deliberate scoping decision: The Test Cabinet currently measures
what the supported harnesses can do out of the box, driving each through a
single session with no additional orchestration layered on top. Multi-session
orchestration is a planned future capability, but it is intentionally excluded
so that early results reflect the harnesses' own unaided behavior.

## Availability

Because the harness CLI is installed at run time rather than present in an image,
availability is checked in two stages.

Outside a run — for example the `tcab harnesses` status listing — availability is
a **cost-free readiness check** from configuration alone: a harness is available
when it supports API-key authentication (the only mode supported for now) and its
key variable is set in the environment. This never starts a container, so it can
report which harnesses are ready to run without installing anything. It cannot
confirm a harness's CLI will install successfully without actually running it;
that is left to the run.

During a run, the stronger check happens **inside the started container, after
the install command has run**: the run probes the installed binary (for example
with `--version`) to confirm the install produced a working CLI and to capture
the harness version recorded for the run. A failed probe — a missing or broken
binary — aborts the run with a clear error before a session is spent. This probe
must **never** start a session or take any other action that could incur cost.

## Authentication

For its first version, The Test Cabinet supports **API key authentication only**.
This keeps setup simple and yields an exact, attributable cost for every run.

- API keys must be supplied to the run's container as secrets and must never be
  written into the seeded repository or committed anywhere.
- The variable a user exports on the host is the conventional provider one, but
  the variable a harness's CLI actually reads can differ. The agent harness
  layer absorbs this: it reads the key from the host variable and injects it
  into the container under whatever variable the harness requires. Each
  harness's Overview page under [Harnesses](/harnesses/) names the host variable
  it reads and the container variable it is injected as.
- Subscription based authentication is intentionally out of scope for the first
  version. It may be added later for harnesses that support it.

A harness that cannot authenticate with an API key — one that requires an
account-based login instead — therefore reports itself **unavailable** under the
current version: its adapter declares no API-key variable, so the layer has no
credential to inject and a run against it fails with a clear error before a
session is spent. Such a harness remains in the catalog for when subscription
auth is added. [Antigravity](/harnesses/antigravity/overview/) is the current
example.

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
is documented on that harness's Metrics page under [Harnesses](/harnesses/).

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
**Events** page under [Harnesses](/harnesses/).
