---
title: Authentication
---

Goose authenticates with an API key, against the OpenRouter-backed models it is
configured for. The contracts shared by every harness are defined in [Agent
Harnesses](/components/core/harnesses/#authentication).

## API key

Goose reads an OpenRouter API key from `OPENROUTER_API_KEY`. Export that
variable on the host; The Test Cabinet injects it into the run container under
the same name. The per-harness override `TCAB_API_KEY_GOOSE` takes precedence
when it is set, which is how Goose is given a key of its own while the other
OpenRouter harnesses share `OPENROUTER_API_KEY`.

Billing is charged against the OpenRouter account backing the key, and the run's
cost is derived from OpenRouter pricing applied to the tokens Goose reports. See
[Metrics](/harnesses/goose/metrics/).

The key is supplied only as a container environment secret.

## Subscription

Goose runs under API-key authentication alone. It declares no subscription
credentials, so a run authenticates it with `OPENROUTER_API_KEY`.

## Selecting a mode

With the API key as the only mode, the default `auto` selection resolves to it,
and Goose is ready once `OPENROUTER_API_KEY` is set. The `TCAB_AUTH_MODE` lock
still applies: `TCAB_AUTH_MODE_GOOSE=subscription` leaves the harness
unavailable.
