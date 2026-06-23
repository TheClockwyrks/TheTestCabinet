---
title: Set Up Authentication
---

Before a run can drive a harness, the harness needs credentials for its model
provider. The Test Cabinet authenticates each harness in one of two modes — an
**API key** or an account **subscription** — and the credential you provide never
touches the seeded repository; it is injected into the run container as a secret
(an API key) or copied in as a file (a subscription). This quickstart gives the
fastest path for each. The full contract — mode resolution, credential refresh,
and the exact variables and files each harness uses — is in
[Agent Harnesses → Authentication](/components/core/harnesses/#authentication)
and each harness's **Authentication** page under [Harnesses](/harnesses/).

## Option A: API key

Export the variable the harness reads on the host (or put it in `.env.runner`).
Each harness reads a specific variable:

| Harness | Variable |
| --- | --- |
| `claude` | `ANTHROPIC_API_KEY` |
| `codex` | `OPENAI_API_KEY` |
| `cline`, `goose`, `kilo`, `opencode`, `pi` | `OPENROUTER_API_KEY` |

The variable you export is the conventional provider one; the harness layer
injects it under whatever variable the CLI actually reads (`codex exec`, for
example, reads `CODEX_API_KEY` internally — you still export `OPENAI_API_KEY`).
Billing is charged directly against the key, so a run records an exact,
attributable cost.

The CLI loads a `.env.runner` from the working directory (or any parent) on
startup. Copy the example and fill in the keys you need:

```sh
cp .env.runner.example .env.runner
# edit .env.runner — set ANTHROPIC_API_KEY, OPENAI_API_KEY, and/or OPENROUTER_API_KEY
```

A variable already exported in the shell takes precedence over the file.

## Option B: Subscription

Sign in with the harness's own CLI, in a trusted environment, so it writes its
credential files to your home directory. The Test Cabinet never performs the
login or mints tokens — it only copies the files the CLI already wrote into the
run container. After signing in once, the credentials are reused for every run
(the harnesses use long-lived refresh tokens).

| Harness | Sign in with | Credential it writes |
| --- | --- | --- |
| `claude` | the `claude` CLI | `~/.claude/.credentials.json` |
| `codex` | `codex login` | `~/.codex/auth.json` |
| `antigravity` | the `agy` CLI (Google account) | `~/.gemini/antigravity-cli/antigravity-oauth-token` |

[Antigravity](/harnesses/antigravity/overview/) supports **only** subscription
authentication — it has no API-key mode. A subscription carries no per-run
provider charge, though a harness that still reports an exact charge (Claude Code
does) is recorded as-is, and one that reports none falls back to OpenRouter
pricing.

### Subscription in the service flow (the cluster path)

The steps above are the CLI/desktop path: the run executes on the trusted host
that signed in, so it reads the credential files straight from `~`. A
**backend-driven run** executes in an ephemeral driver pod that has no host home,
so subscription credentials are supplied to it from an operator-provided
**Secret** instead — one shared subscription per deployment.

The operator creates a `tcab-driver-subscription` Secret holding the same files
the CLI reads, keyed by each credential's **basename**, from a trusted host where
the harness CLIs are signed in:

```sh
kubectl -n tcab-prod create secret generic tcab-driver-subscription \
  --from-file=.credentials.json="$HOME/.claude/.credentials.json" \
  --from-file=auth.json="$CODEX_HOME/auth.json" \
  --from-file=antigravity-oauth-token="$HOME/.gemini/antigravity-cli/antigravity-oauth-token"
```

Point the dispatcher at it (`TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_SECRET`, see
[`deployments/k8s/base/dispatcher.yaml`](https://github.com/) and the
[dispatcher config](/components/dispatcher/overview/)); the dispatcher mounts it
read-only into every driver Job and the driver maps each basename back to the
harness's full container path. Mode selection is unchanged from the CLI path — a
console can request subscription per run (the launch request's `authMode`), or the
operator can lock it cluster-wide with `TCAB_DISPATCHER_DRIVER_AUTH_MODE`. This is
what unblocks the subscription-only Antigravity harness for console-driven runs.

The local k3d stack wires this for you: the `secrets` target in
[`deployments/local/Makefile`](https://github.com/) **optionally** builds
`tcab-driver-subscription` from your host's signed-in CLI files (it never errors
when they are absent — subscription stays opt-in). See
[Run the Local Service Stack](/guides/running-the-local-service-stack/).

The per-account credential vault (each user uploading their own subscription) is a
deferred follow-up; today's service-flow subscription is the single shared
operator Secret.

## Choosing a mode

When both an API key and a subscription are present, The Test Cabinet **prefers
the subscription** by default. Lock the mode when you need to:

```sh
export TCAB_AUTH_MODE=api-key            # every harness
export TCAB_AUTH_MODE_CLAUDE=api-key     # one harness (wins over the above)
```

Accepted values are `auto` (the default), `subscription`, and `api-key`.

## Verify

Check which harnesses are ready to run — a cost-free readiness check that reads
only whether the needed credentials are present, without starting a container:

```sh
tcab harnesses          # human-readable table; add --json for machine output
```

A harness shows as available once the credentials its resolved mode needs are in
place. From a source checkout, substitute `cargo run -p test-cabinet-cli --
harnesses` for `tcab harnesses`.

## Next steps

- [Run a Test Case](/quickstarts/run-a-test-case/) — drive a harness now that
  it's authenticated.
- [First Time Setup](/guides/first-time-setup/) — the rest of what a run needs
  (container runtime, run-container image, headless browser).
