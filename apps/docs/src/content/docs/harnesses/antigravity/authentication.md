---
title: Authentication
---

Antigravity authenticates through a Google account, so it runs under
subscription authentication alone. The Test Cabinet makes the account credential
available to the `agy` CLI inside the run container. For the contracts shared by
every harness, covering how a mode is selected and how subscription credentials
are copied into the container, see
[Agent Harnesses](/components/core/harnesses/#authentication).

## Subscription

A Google-account session is authenticated with the OAuth token the `agy` CLI
writes at sign-in. Signing in with the CLI, in a trusted environment, is the
user's responsibility; The Test Cabinet reads the resulting token and never
performs the Google sign-in itself. The CLI stores it at
`~/.gemini/antigravity-cli/antigravity-oauth-token`.

For a run, that token is copied into the container at
`/home/node/.gemini/antigravity-cli/antigravity-oauth-token`, where the CLI reads
it. On the CLI and desktop path it is read from the host home. On the
backend-driven cluster path it comes from an operator-provided Secret mounted
into the driver pod, so Antigravity runs from the console as well as locally. See
[Set Up Authentication](/quickstarts/setup/set-up-authentication/) for that
service flow.

When `agy` cannot authenticate from the copied token, the run fails with a clear
error instead of dropping into an interactive login.

:::note[Credentials are copied in only]
The run container is torn down when the run finishes, so a token the CLI
refreshes mid-session is discarded with it.
:::

## Selecting a mode

Antigravity has one mode. It is available when its token is present, and
otherwise reports itself unavailable with a hint to sign in. The
`TCAB_AUTH_MODE` lock still applies: `TCAB_AUTH_MODE_ANTIGRAVITY=api-key` leaves
the harness unavailable.
