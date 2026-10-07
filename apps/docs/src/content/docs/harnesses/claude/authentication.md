---
title: Authentication
---

Claude Code authenticates in one of two modes: an Anthropic API key, or an
Anthropic account subscription. The Test Cabinet resolves which mode a run uses,
then makes the chosen credential available to the CLI inside the run container.
The contracts shared by every harness are defined in [Agent
Harnesses](/components/core/harnesses/#authentication).

## API key

Claude Code reads an Anthropic API key from `ANTHROPIC_API_KEY`. Export that
variable on the host; The Test Cabinet injects it into the run container under
the same name. The per-harness override `TCAB_API_KEY_CLAUDE` takes precedence
when it is set.

Billing is charged directly against the key, and Claude Code reports the exact
charge it incurred as the run's cost. The key is supplied only as a container
environment secret.

## Subscription

A Claude subscription is authenticated with the credential files the `claude`
CLI writes when a user signs in. The user signs in with the CLI itself, in a
trusted environment, so that it creates these files. The Test Cabinet performs
no login and mints no tokens. The files are:

- `~/.claude/.credentials.json`: the subscription token, required.
- `~/.claude.json`: non-secret CLI state, copied when present.

For a run these are read from the host home and copied into the container at
`/home/node/.claude/.credentials.json` and `/home/node/.claude.json`, where the
CLI reads them. The container starts with no `ANTHROPIC_API_KEY`, so Claude Code
authenticates with the subscription.

Credentials are copied into the container only. The container is torn down when
the run finishes, so a token the CLI refreshes mid-session is discarded. Claude
Code's refresh token is long-lived, so the host credentials stay valid for the
next run.

A subscription carries no per-run provider charge. Claude Code still reports an
exact charge on its result, and the run records that figure as its cost exactly
as it does for an API-key run.

## Selecting a mode

The Test Cabinet prefers a subscription when its credentials are present, and
falls back to the API key otherwise. An environment variable locks the mode:
`TCAB_AUTH_MODE` for every harness, or `TCAB_AUTH_MODE_CLAUDE` for Claude Code
alone, which wins. Accepted values are `auto` (the default), `subscription`, and
`api-key`. `TCAB_AUTH_MODE_CLAUDE=api-key` forces the API key even when a
subscription is signed in.
