---
title: Authentication
---

The Test Cabinet drives Pi with **API-key authentication**, against the
OpenRouter-backed models it is configured for. For the contracts shared by every
harness, see
[Agent Harnesses → Authentication](/components/core/harnesses/#authentication).

## API key

Pi reads an OpenRouter API key from `OPENROUTER_API_KEY`. Export that variable on
the host; The Test Cabinet injects it into the run container under the same name.
Billing is charged against the OpenRouter account backing the key, and the run's
cost is taken from what Pi reports, or derived from OpenRouter pricing when it
reports only token usage (see [Metrics](./metrics/)).

The key is supplied only as a container environment secret. It is never written
into the seeded repository or committed anywhere.

## Subscription

Subscription-style authentication is **not** supported for Pi today: The Test
Cabinet drives it through the OpenRouter API key above. Subscription support may be
added later for the harnesses that can use it.

## Selecting a mode

With only the API-key mode available, the default `auto` selection resolves to the
API key, and Pi is ready once `OPENROUTER_API_KEY` is set. The `TCAB_AUTH_MODE`
lock still applies: `TCAB_AUTH_MODE_PI=subscription` simply leaves the harness
unavailable, since it has no subscription mode here.

---

See the [Overview](./overview/) for how Pi is invoked, [Events](./events/) and
[Metrics](./metrics/) for how its output and cost are recorded, and
[Agent Harnesses](/components/core/harnesses/) for the shared authentication
contract.
