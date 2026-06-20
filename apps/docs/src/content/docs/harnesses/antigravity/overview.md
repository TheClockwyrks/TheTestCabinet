---
title: Overview
---

Google Antigravity is a coding agent that The Test Cabinet defines so it can be
driven non-interactively like the other harnesses. It is, however, **not
currently runnable**: Antigravity authenticates only through a Google account and
reports no token usage in its non-interactive mode, which is incompatible with
The Test Cabinet's API-key-only authentication. The adapter is kept in the
catalog for when subscription-based authentication is added. See the project's
own site at [antigravity.google](https://antigravity.google/).

:::caution[Currently unavailable]
The `antigravity` adapter declares no API-key environment variable
(`api_key_env: None`), so it reports itself **unavailable** and a run against it
fails with a clear error. It also accepts **no model ID** — Antigravity drives a
Google-account session rather than a chosen model. This is by design; see the
[API-key incompatibility note](/components/core/harnesses/#authentication).
:::

## Model IDs

Antigravity accepts **no model ID** for a run. Because it authenticates through a
Google account and never participates in an API-key-only run, there is no model
ID to supply and none would be passed through to the CLI. When subscription auth
is added, the set of selectable models will be defined then. For why the harness
cannot run today, see the
[availability rationale](/components/core/harnesses/#authentication).

## Invocation

The CLI binary is `agy`, which the manifest would install into the run container
at run time with:

```sh
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

Were it runnable, a single prompt would be driven to completion with the
non-interactive session flags:

```sh
agy --print --dangerously-skip-permissions <prompt>
```

`--print` requests non-interactive output and `--dangerously-skip-permissions`
suppresses the interactive approval prompts. No model flag is passed, because no
model ID is accepted. Crucially, the adapter declares **no API-key environment
variable**, so The Test Cabinet has no credential to inject into the container
and the run cannot proceed: it reports the harness unavailable and fails before a
session is spent.

See the [Events](./events/) and [Metrics](./metrics/) pages for how Antigravity
output would be normalized, and [Harnesses](/components/core/harnesses/) for the
harness layer overall.
