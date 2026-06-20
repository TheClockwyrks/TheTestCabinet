---
title: Authentication
---

Codex authenticates in one of two modes: an **OpenAI API key**, or a **ChatGPT
account subscription**. Both are supported. The Test Cabinet resolves which one a
run uses, then makes the chosen credential available to the CLI inside the run
container. For the contracts shared by every harness — how a mode is selected and
how subscription credentials are copied into the container — see
[Agent Harnesses → Authentication](/components/core/harnesses/#authentication).

## API key

Non-interactive `codex exec` reads its key from `CODEX_API_KEY`, **not** from
`OPENAI_API_KEY` — that variable is only honored by Codex's interactive login, so a
key supplied through it fails with a missing-authentication error even when the key
is valid. To absorb this, The Test Cabinet reads the key from the conventional
`OPENAI_API_KEY` you export on the host and injects it into the run container as
`CODEX_API_KEY`. Because the container starts clean, no stray `OPENAI_API_KEY`
leaks in to interfere.

When a key authenticates the run, billing is charged directly against it. The key
is supplied only as a container environment secret — never written into the seeded
repository or committed anywhere.

## Subscription

A ChatGPT subscription is authenticated with the tokens the `codex` CLI writes when
you sign in (for example with `codex login`). You are responsible for signing in
with the CLI itself, in a trusted environment, so that it creates the tokens; The
Test Cabinet never performs the login or mints tokens. Codex stores them in
`auth.json` inside its home directory — `CODEX_HOME` when set, otherwise
`~/.codex`.

For a run, `auth.json` is read from that location and copied into the container at
`/home/node/.codex/auth.json`, where the CLI reads it. No API key is injected, so
`codex exec` authenticates with the subscription.

A subscription carries no per-run provider charge. Codex reports no cost figure of
its own in either mode, so a run's comparable cost is derived from OpenRouter
pricing (see [Metrics](./metrics/)) regardless of which mode authenticated it.

:::note[Credentials are copied in, not back out]
The run container is torn down when the run finishes. If the CLI refreshes its
tokens mid-session, that refreshed copy is discarded — credentials are copied
**in** only, never written back to your host. Codex's refresh token is long-lived,
so your host credentials stay valid for the next run.
:::

## Selecting a mode

By default The Test Cabinet **prefers a subscription** when its credentials are
present, falling back to the API key otherwise. Lock the mode with an environment
variable when you need to: `TCAB_AUTH_MODE` for every harness, or
`TCAB_AUTH_MODE_CODEX` for Codex alone (the per-harness variable wins). Accepted
values are `auto` (the default), `subscription`, and `api-key`. For example,
`TCAB_AUTH_MODE_CODEX=api-key` forces the API key even when you are signed in.

---

See the [Overview](./overview/) for how Codex is invoked, [Events](./events/) and
[Metrics](./metrics/) for how its output and cost are recorded, and
[Agent Harnesses](/components/core/harnesses/) for the shared authentication
contract.
