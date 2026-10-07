---
title: Authentication
---

Codex authenticates in one of two modes: an OpenAI API key, or a ChatGPT account
subscription. The Test Cabinet resolves which mode a run uses, then makes the
chosen credential available to the CLI inside the run container. The contracts
shared by every harness are defined in [Agent
Harnesses](/components/core/harnesses/#authentication).

## API key

Non-interactive `codex exec` reads its key from `CODEX_API_KEY`, which is the
only variable that authenticates it; `OPENAI_API_KEY` is honored by Codex's
interactive login alone. The Test Cabinet absorbs the difference: it reads the
key from the conventional `OPENAI_API_KEY` exported on the host and injects it
into the run container as `CODEX_API_KEY`. The per-harness override
`TCAB_API_KEY_CODEX` takes precedence when it is set.

Billing is charged directly against the key. The key is supplied only as a
container environment secret.

## Subscription

A ChatGPT subscription is authenticated with the tokens the `codex` CLI writes
when a user signs in, for example with `codex login`. The user signs in with the
CLI itself, in a trusted environment, so that it creates the tokens. The Test
Cabinet performs no login and mints no tokens. Codex stores them in `auth.json`
inside its home directory, which is `CODEX_HOME` when set and `~/.codex`
otherwise.

For a run, `auth.json` is read from that location and copied into the container
at `/home/node/.codex/auth.json`, where the CLI reads it. The container starts
with no API key, so `codex exec` authenticates with the subscription.

Credentials are copied into the container only. The container is torn down when
the run finishes, so tokens the CLI refreshes mid-session are discarded. Codex's
refresh token is long-lived, so the host credentials stay valid for the next
run.

A subscription carries no per-run provider charge. Codex reports no cost figure
in either mode, so a run's comparable cost is computed from the model's list
price whichever mode authenticated it. See [Metrics](/harnesses/codex/metrics/).

## Selecting a mode

The Test Cabinet prefers a subscription when its credentials are present, and
falls back to the API key otherwise. An environment variable locks the mode:
`TCAB_AUTH_MODE` for every harness, or `TCAB_AUTH_MODE_CODEX` for Codex alone,
which wins. Accepted values are `auto` (the default), `subscription`, and
`api-key`. `TCAB_AUTH_MODE_CODEX=api-key` forces the API key even when a
subscription is signed in.
