---
title: Authentication
---

The Test Cabinet drives OpenCode with API-key authentication against the
OpenRouter-backed models it is configured for. For the contracts shared by every
harness, see [Agent Harnesses](/components/core/harnesses/#authentication).

## API key

OpenCode reads an OpenRouter API key from `OPENROUTER_API_KEY`. Export that
variable on the host; The Test Cabinet injects it into the run container under
the same name. `TCAB_API_KEY_OPENCODE` overrides it for this harness alone, so
OpenCode can use a different key from the other OpenRouter-routed harnesses.

Billing is charged against the OpenRouter account backing the key. The key is
supplied to the container as an environment secret, and its value is redacted
from a run's published source.

## Subscription

OpenCode declares no subscription credentials, so every run authenticates with
the API key above.

## Selecting a mode

`TCAB_AUTH_MODE` selects the mode for every harness and
`TCAB_AUTH_MODE_OPENCODE` selects it for OpenCode alone, taking precedence.
Accepted values are `auto` (the default), `api-key`, and `subscription`.

With only the API-key mode available, both `auto` and `api-key` resolve to the
API key, and OpenCode is ready once `OPENROUTER_API_KEY` is set. Requesting
`subscription` leaves the harness unavailable.
