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

The agent harness layer must support the following harnesses. Each is identified
by a stable slug used throughout run records and the site.

| Harness | Slug |
| ------- | ---- |
| Anthropic Claude Code | `claude` |
| OpenAI Codex | `codex` |
| Cline | `cline` |
| Google Antigravity | `antigravity` |
| Goose | `goose` |
| Kilo Code | `kilo` |
| OpenCode | `opencode` |
| Pi | `pi` |

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
workspace with an [init command](/components/core/test-cases/#init), and it runs
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
- The variable a user exports on the host is the conventional provider one (for
  example `OPENAI_API_KEY`), but the variable a harness's CLI actually reads can
  differ. The agent harness layer absorbs this: it reads the key from the host
  variable and injects it into the container under whatever variable the harness
  requires. Codex is the current example — its non-interactive `codex exec`
  authenticates only from `CODEX_API_KEY`, so the key exported as
  `OPENAI_API_KEY` is injected as `CODEX_API_KEY`.
- Subscription based authentication is intentionally out of scope for the first
  version. It may be added later for harnesses that support it.

> **Antigravity is API-key incompatible.** Google Antigravity authenticates only
> through a Google account and reports no token usage in its non-interactive
> mode. Because the first version supports API-key authentication only, the
> `antigravity` adapter reports itself unavailable and a run against it fails
> with a clear error. It remains in the catalog for when subscription auth is
> added.

## Usage Reporting

Every invocation must return normalized usage data so that runs are comparable
across harnesses regardless of how each harness reports its own numbers. The
agent harness layer is responsible for translating each harness's raw output into
the normalized token classes defined in [Metrics](/components/core/metrics/#tokens).

An invocation must also surface any **exact run cost the harness reports for
itself**. A harness that drives a single provider directly through an API key may
report the precise amount charged — for example, Claude Code emits a
`total_cost_usd` figure on its terminal result. When such a figure is present the
harness layer returns it, and the orchestrator uses it for both cost figures
without consulting OpenRouter, as described in
[Harness-reported cost](/components/core/metrics/#harness-reported-cost).
Harnesses that report no cost (for example Codex, whose output carries only
token counts) leave the reported cost unset and fall back to OpenRouter-derived
pricing.

When a no-cost harness is priced through OpenRouter, the harness layer maps its
model ID to the slug OpenRouter lists it under. Harnesses that route through
OpenRouter already use OpenRouter model IDs and pass them through unchanged.
Harnesses that take a provider-native model ID map it to its OpenRouter
equivalent — for example Codex receives an OpenAI ID such as `gpt-5.5`, which
OpenRouter lists as `openai/gpt-5.5`.

## Event Reporting

Beyond its terminal outcome, every invocation produces a live stream of
normalized [harness events](/components/core/events/) as the harness runs. The
agent harness layer translates each harness's raw output into that uniform
stream so callers can render progress while a run is in progress and, when a
harness fails, see the harness's own diagnostic output instead of a single
opaque error. The command line interface prints these events as they arrive.
