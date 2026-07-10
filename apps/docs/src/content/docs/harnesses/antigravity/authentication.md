---
title: Authentication
---

Antigravity authenticates **only** through a Google account, so it has no API-key
mode — it runs under subscription authentication alone. The Test Cabinet makes the
account credential available to the `agy` CLI inside the run container. For the
contracts shared by every harness — how a mode is selected and how subscription
credentials are copied into the container — see
[Agent Harnesses → Authentication](/components/core/harnesses/#authentication).

## Subscription

A Google-account session is authenticated with the OAuth token the `agy` CLI writes
when you sign in. You are responsible for signing in with the CLI itself, in a
trusted environment, so that it creates the token; The Test Cabinet never performs
the Google sign-in or mints tokens. The CLI stores the token as a file at
`~/.gemini/antigravity-cli/antigravity-oauth-token`.

For a run, that token is copied into the container at
`/home/node/.gemini/antigravity-cli/antigravity-oauth-token`, where the CLI reads
it. On the CLI/desktop path it is read from your host home; on the
**backend-driven (cluster) path** it comes from an operator-provided Secret the
dispatcher mounts into the driver pod instead — so Antigravity, despite being
subscription-only, now runs from the console too, not just locally (see
[the service flow](/quickstarts/setup/set-up-authentication/#subscription-in-the-service-flow-the-cluster-path)).
If `agy` cannot authenticate from the copied token, the run fails with a clear
error rather than dropping into an interactive login that would block it.

Antigravity reports no token usage and accepts no model ID in its non-interactive
mode, so a run records no usage and no harness-reported cost (see
[Metrics](./metrics/)).

:::note[Credentials are copied in, not back out]
The run container is torn down when the run finishes. If the CLI refreshes the
token mid-session, that refreshed copy is discarded — the token is copied **in**
only, never written back to your host.
:::

## Selecting a mode

Antigravity has only one mode, so there is nothing to choose: when its token is
present it is available, and otherwise it reports unavailable with a hint to sign
in. The `TCAB_AUTH_MODE` lock still applies in the obvious way —
`TCAB_AUTH_MODE_ANTIGRAVITY=api-key` simply leaves the harness unavailable, since
it has no API-key mode.

---

See the [Overview](./overview/) for how Antigravity is invoked, [Events](./events/)
and [Metrics](./metrics/) for how its output is recorded, and
[Agent Harnesses](/components/core/harnesses/) for the shared authentication
contract.
