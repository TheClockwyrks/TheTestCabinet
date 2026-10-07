---
title: Overview
---

Google Antigravity (slug `antigravity`) is a coding agent The Test Cabinet drives
non-interactively like the other harnesses. It authenticates through a Google
account alone, so it runs under subscription authentication and becomes available
once the OAuth token its `agy` CLI writes is present. The harness itself is at
[antigravity.google](https://antigravity.google/).

## Model IDs

The session arguments carry no model flag. Antigravity drives a Google-account
session, so a run's model ID reaches nothing in the CLI.

## Invocation

The harness probes and invokes the `agy` binary, installed into the run container
at run time with:

```sh
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

A single prompt is driven to completion with:

```sh
agy --print --dangerously-skip-permissions <prompt>
```

`--print` requests non-interactive output and `--dangerously-skip-permissions`
suppresses the interactive approval prompts.

## Authentication

The harness authenticates from the Google-account OAuth token copied into the
container. With no token present, the harness reports itself unavailable with a
hint to sign in, and the run fails before a session is spent. See
[Authentication](/harnesses/antigravity/authentication/).
