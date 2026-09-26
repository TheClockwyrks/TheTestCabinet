---
title: Set Up Authentication
---

## Overview

A run's harness authenticates to its model provider in one of two modes: an API
key, or an account subscription. The deployment that executes the run supplies
the credential to the run container, so the credential is configured where the
run executes rather than where it is launched. The full contract is in
[Agent Harnesses](/components/core/harnesses/#authentication).

## API key

Each harness reads one provider variable:

| Harness                                          | Variable             |
| ------------------------------------------------ | -------------------- |
| `claude`                                         | `ANTHROPIC_API_KEY`  |
| `codex`                                          | `OPENAI_API_KEY`     |
| `cline`, `goose`, `kilo`, `opencode`, `pi`, `gg` | `OPENROUTER_API_KEY` |

Billing is charged against the key, so the run records an attributable cost.

For the local k3d stack, export at least one variable (or set it in the
repository's `.env`) before bringing the stack up. The `secrets` target reads it
from there into the cluster's `tcab-driver-secrets` Secret, and the dispatcher
injects that Secret into every driver Job:

```sh
export OPENROUTER_API_KEY=…
make -C deployments/local local-up
```

For a remote deployment, the operator creates the same `tcab-driver-secrets`
Secret in the target namespace, following
`deployments/k8s/base/secrets.example.yaml`.

## Subscription

Sign in with the harness's own CLI on a trusted machine so it writes its
credential files. The Test Cabinet copies those files into the run container; it
performs no login and mints no tokens.

| Harness       | Sign in with                   | Credential it writes                                |
| ------------- | ------------------------------ | --------------------------------------------------- |
| `claude`      | the `claude` CLI               | `~/.claude/.credentials.json`, `~/.claude.json`     |
| `codex`       | `codex login`                  | `~/.codex/auth.json` (`$CODEX_HOME` relocates it)   |
| `antigravity` | the `agy` CLI (Google account) | `~/.gemini/antigravity-cli/antigravity-oauth-token` |

[Antigravity](/harnesses/antigravity/overview/) authenticates by subscription
only. A subscription carries no per-run provider charge. A harness that reports
an exact charge has it recorded as the run's actual cost, and one that reports
none records the comparable cost as its actual cost. Either way the comparable
cost is computed from the model's list price.

The local k3d stack builds the `tcab-driver-subscription` Secret from whichever
of those files exist on the host, as part of the same `make local-up`.
Subscription support is opt-in, so absent files leave runs on API keys.

For a remote deployment, upload the same files from a machine where the harness
CLIs are signed in. The cluster reconciles them into the Secret on its own:

```sh
scripts/upload-subscription-creds.sh --env prod
```

Re-run it whenever the tokens refresh. The dispatcher mounts the Secret read-only
into every driver Job, and the driver maps each credential's basename back to the
path its harness reads.

## Choosing a mode

Accepted modes are `auto`, `subscription`, and `api-key`. `auto` is the default
and uses a subscription when its credentials are present, an API key otherwise.
Lock the mode at one of three levels:

- Per run: `tcab run --auth-mode subscription …`, forwarded to the backend and
  applied by the driver.
- Per deployment: the dispatcher's `TCAB_DISPATCHER_DRIVER_AUTH_MODE`, forwarded
  into every driver Job.
- Per process: `TCAB_AUTH_MODE`, or `TCAB_AUTH_MODE_<SLUG>` for a single harness,
  which wins over the global variable.

## Verify

`tcab harnesses` reports, for each harness, whether the credentials its resolved
mode needs are present on this machine. It reads configuration only and starts no
container:

```sh
tcab harnesses          # add --json for machine output
```

From a source checkout, substitute
`cargo run -p test-cabinet-cli -- harnesses`.

## Next steps

- [Run a Test Case](/quickstarts/development/run-a-test-case/).
- [First Time Setup](/guides/setup/first-time-setup/) for the rest of a working
  machine.
