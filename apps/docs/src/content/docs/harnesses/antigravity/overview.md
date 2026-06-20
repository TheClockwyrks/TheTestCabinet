---
title: Overview
---

Google Antigravity is a coding agent that The Test Cabinet drives
non-interactively like the other harnesses. It authenticates only through a Google
account, so it has no API-key mode and runs under **subscription authentication**
alone — it is unavailable until you sign in with its `agy` CLI, and runnable once
you have. See the project's own site at
[antigravity.google](https://antigravity.google/) and the
[Authentication](./authentication/) page for how to sign in.

:::note[Subscription only]
The `antigravity` adapter declares no API-key environment variable
(`api_key_env: None`); it is authenticated by the Google-account OAuth token the
`agy` CLI writes, copied into the run container. Until that token exists the
harness reports itself **unavailable** with a hint to sign in. It also accepts
**no model ID** — Antigravity drives a Google-account session rather than a chosen
model — and reports no token usage in its non-interactive mode.
:::

## Model IDs

Antigravity accepts **no model ID** for a run. It drives a Google-account session
rather than a chosen model, so there is no model ID to supply and none is passed
through to the CLI.

## Invocation

The CLI binary is `agy`, which the manifest installs into the run container at run
time with:

```sh
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

A single prompt is driven to completion with the non-interactive session flags:

```sh
agy --print --dangerously-skip-permissions <prompt>
```

`--print` requests non-interactive output and `--dangerously-skip-permissions`
suppresses the interactive approval prompts. No model flag is passed, because no
model ID is accepted. The harness authenticates from the Google-account OAuth
token copied into the container (see [Authentication](./authentication/)); with no
token present, the run reports the harness unavailable and fails before a session
is spent.

See the [Authentication](./authentication/) page for signing in, the
[Events](./events/) and [Metrics](./metrics/) pages for how Antigravity output is
normalized, and [Harnesses](/components/core/harnesses/) for the harness layer
overall.
