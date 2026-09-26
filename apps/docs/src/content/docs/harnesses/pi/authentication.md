---
title: Authentication
---

The Test Cabinet drives Pi with API-key authentication against the
OpenRouter-backed models it is configured for. For the contracts shared by every
harness, see
[Agent Harnesses](/components/core/harnesses/#authentication).

## API key

Pi reads an OpenRouter API key from `OPENROUTER_API_KEY`. Export that variable
on the host and The Test Cabinet injects it into the run container under the
same name. Billing is charged against the OpenRouter account backing the key.

The key is supplied only as a container environment secret. It is never written
into the seeded repository.

## Selecting a mode

Pi supports the API-key mode alone, so the default `auto` selection resolves to
the API key and Pi is available once `OPENROUTER_API_KEY` is set. The
`TCAB_AUTH_MODE` lock still applies: `TCAB_AUTH_MODE_PI=subscription` leaves the
harness unavailable.
