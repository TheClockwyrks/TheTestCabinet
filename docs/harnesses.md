# Agent Harnesses

## Overview

One of the goals of The Test Cabinet is to evaluate not only models but also the
coding harnesses that drive them. If a model performs significantly better in one
harness than another, that is a useful data point. The agent harness layer
provides a single abstraction for invoking any supported third party harness so
that the same test case can be run against any of them without the rest of the
testing harness needing to know harness specific details.

This layer is responsible for absorbing harness specific quirks, including how
each harness is invoked non interactively and how each one reports its usage.

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

## Invocations

A harness invocation must be given at least:

- The harness slug, which selects the underlying harness to invoke.
- A model ID, which is treated as an opaque string and passed to the harness
  unchanged. The caller is responsible for supplying a valid value for the
  selected harness.
- The prompt, which is the initial instruction handed to the harness. For a test
  case this directs the harness to build the game from the seeded specification.

A run corresponds to a single harness session driven to completion. The harness's
own agent loop performs the work of the run; orchestrating multiple chained
sessions is out of scope for now.

This reflects a deliberate scoping decision: The Test Cabinet currently measures
what the supported harnesses can do out of the box, driving each through a single
session with no additional orchestration layered on top. Multi-session
orchestration is a planned future capability, but it is intentionally excluded so
that early results reflect the harnesses' own unaided behavior.

## Availability

The testing harness must be able to determine whether a harness is available by
resolving its binary on the host and confirming it can be invoked, for example
with a `--version` check. If an unavailable harness is requested, the run must
fail with a clear error.

Availability checks must **never** start a session or take any other action that
could incur cost. Any stronger check must be triggered explicitly by the user.

## Authentication

For its first version, The Test Cabinet supports **API key authentication only**.
This keeps setup simple and yields an exact, attributable cost for every run.

- API keys must be supplied to the run's container as secrets and must never be
  written into the seeded repository or committed anywhere.
- Subscription based authentication is intentionally out of scope for the first
  version. It may be added later for harnesses that support it.

## Usage Reporting

Every invocation must return normalized usage data so that runs are comparable
across harnesses regardless of how each harness reports its own numbers. The
agent harness layer is responsible for translating each harness's raw output into
the normalized token classes defined in [Metrics](./metrics.md#tokens).
