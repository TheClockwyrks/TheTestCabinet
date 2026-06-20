---
title: Authentication
---

Claude Code authenticates in one of two modes: an **Anthropic API key**, or an
**Anthropic account subscription**. Both are supported. The Test Cabinet resolves
which one a run uses, then makes the chosen credential available to the CLI inside
the run container. For the contracts shared by every harness — how a mode is
selected and how subscription credentials are copied into the container — see
[Agent Harnesses → Authentication](/components/core/harnesses/#authentication).

## API key

Claude Code reads an Anthropic API key from `ANTHROPIC_API_KEY`. Export that
variable on the host; The Test Cabinet injects it into the run container under the
same name. When a key authenticates the run, billing is charged directly against
it, and Claude Code reports the exact charge it incurred, which the run records as
its cost (see [Metrics](./metrics/)).

The key is supplied only as a container environment secret. It is never written
into the seeded repository or committed anywhere.

## Subscription

A Claude subscription is authenticated with the credential files the `claude` CLI
writes when you sign in. You are responsible for signing in with the CLI itself,
in a trusted environment, so that it creates these files; The Test Cabinet never
performs the login or mints tokens. After signing in, Claude Code keeps:

- `~/.claude/.credentials.json` — the subscription token (required).
- `~/.claude.json` — non-secret CLI state, copied when present.

For a run, these are read from your host home and copied into the container at the
matching paths under the run user's home (`/home/node/.claude/.credentials.json`
and `/home/node/.claude.json`), where the CLI reads them. No API key is injected,
so Claude Code authenticates with the subscription.

A subscription carries no per-run provider charge, but Claude Code still reports an
exact charge on its result even on a subscription, and the run records that figure
as its cost just as it does for an API-key run.

:::note[Credentials are copied in, not back out]
The run container is torn down when the run finishes. If the CLI refreshes its
token mid-session, that refreshed copy is discarded — credentials are copied **in**
only, never written back to your host. Claude Code's refresh token is long-lived,
so your host credentials stay valid for the next run.
:::

## Selecting a mode

By default The Test Cabinet **prefers a subscription** when its credentials are
present, falling back to the API key otherwise. Lock the mode with an environment
variable when you need to: `TCAB_AUTH_MODE` for every harness, or
`TCAB_AUTH_MODE_CLAUDE` for Claude Code alone (the per-harness variable wins).
Accepted values are `auto` (the default), `subscription`, and `api-key`. For
example, `TCAB_AUTH_MODE_CLAUDE=api-key` forces the API key even when you are
signed in.

---

See the [Overview](./overview/) for how Claude Code is invoked,
[Events](./events/) and [Metrics](./metrics/) for how its output and cost are
recorded, and [Agent Harnesses](/components/core/harnesses/) for the shared
authentication contract.
