# Choose the provider for every request in gg

Build the list of providers a model may run on from OpenRouter's endpoints
listing, filtered to the model's native quantization and a price ceiling, send
every request to exactly one of them, and let gg's own record of how each
provider behaves decide when a run moves to the next, so OpenRouter is the
gateway and the bill and nothing more.

## Current state

OpenRouter stays the one gateway, so that a model needs no account with its
provider. Its routing decides which provider serves a request from the
account's preferences, which weigh tool-call well-formedness and price but not
quantization, and it moves a run to another provider after a single failed
response. On 2026-09-22 one 502 from OpenAI moved a run of
`openai/gpt-5.6-sol` onto Azure, at a cold cache and a rate two and a half
times higher, for the rest of the run.

[`pin-every-run-to-the-model-s-official-provider.md`](pin-every-run-to-the-model-s-official-provider.md)
takes the choice away from OpenRouter for one provider: every request carries
`provider.only` naming the developer's slug with `allow_fallbacks` false, and a
model whose developer endpoint the account cannot use is refused. A run of
`deepseek/deepseek-v4.1-flash` is refused on those terms, since the account's
data policy excludes DeepSeek's own endpoint, while OpenRouter lists other
providers serving it at its native precision.

OpenRouter's health signals are narrower than gg's. A provider that accepts a
request and never streams a delta produces no error OpenRouter counts, so a run
of `z-ai/glm-5.3` kept being sent to a provider that had stalled it for 900
seconds. A provider that ignores its own input cache and charges the whole
prefix returns a well-formed reply with `cached_tokens` at zero, which
OpenRouter treats as success. gg sees both: after
[`detect-a-stalled-model-stream-within-a-minute.md`](detect-a-stalled-model-stream-within-a-minute.md)
a stall is a transport error on the client's retry schedule, and every reply's
cached-token count and serving provider are folded into the run record's
per-provider slices, `GgProviderStat`.

The endpoints listing (`/api/v1/models/{author}/{slug}/endpoints`) carries, for
each endpoint, the provider's slug and display name, its declared
quantization, its input, output and cache-read prices, its supported
parameters and its recent uptime. The `provider` request object accepts
`only`, `quantizations`, `max_price` and `allow_fallbacks`.

## Design

### The candidate list

`modelProviders` in `GgInvocation`, one slug per model under the pin, becomes
an ordered list of candidates per model. A candidate names a provider slug and
the quantization it serves. The list is what a run may use, in the order it
tries them, and a one-entry list is the pin.

The backend builds the list at enqueue from the endpoints listing:

- Quantization at the model's native level. Native is the highest level any
  endpoint of the model declares, and the catalog entry for a model can set it
  by hand. An endpoint declaring `unknown` is left out unless the catalog
  entry allows it by name.
- Price at or below the developer endpoint's input and output rates, or the
  ceiling the catalog entry sets when the developer endpoint is unavailable.
- A cache-read price, so that a prefix is worth building there at all.
- Every parameter the run sends among the endpoint's `supported_parameters`:
  tools and `tool_choice` for a tool-calling agent, `reasoning` when the agent
  sets an effort.
- Absent from the catalog entry's ban list.

The developer's endpoint comes first when it passes, then the rest by the
provider's fault rate across the backend's recorded runs, then by price. A
model with no candidate refuses the enqueue with the reason, and the console
shows it on the model. A model whose developer endpoint is excluded runs on
the next candidate, which replaces the pin's refusal, and the quickstart's
policy statement says so.

### The request

Every request names one candidate: `provider.only` carries its slug,
`provider.quantizations` its level, and `allow_fallbacks` is false. A reply
served by any other provider is the pin's `provider_mismatch`.

### Faults and the move to the next candidate

Faults are counted per provider within the run, and two kinds are told apart:

- A failed call: an HTTP error, a rate limit, a transport error or a stall.
  The client's retry schedule retries it on the same provider. When the
  schedule is spent, the run moves to the next candidate for the request and
  every request after it.
- An unexpected cache miss: a reply whose `cached_tokens` is below the shared
  prefix of the previous request on the same provider, sent within the cache
  lifetime of that request and above the provider's minimum cacheable size.
  The reply stands, since it is a good turn, and the miss is counted.
  `GgRunLimits` gains `providerCacheMissLimit`, default 2; a provider reaching
  it is left at the next request. A miss is the cheapest moment to move, since
  the prefix has to be rebuilt either way.

A move emits `provider_switch` naming the provider left, the provider taken
and the fault that decided it. The run's cost record already slices per
provider, so a run that moved says so on its own. A run whose last candidate
is spent ends as the harness failure the pin defines for an outage.

### What the backend keeps

`GgProviderStat` gains the counts of stalls and unexpected misses beside its
error count. The backend rolls the slices up per provider and model across
runs, which gives the fault rate the candidate order sorts by, and the catalog
entry's ban list is where a provider is removed for good. Both are edited on
the model's page in the console.

### Direct invocations

`scripts/model-windows.sh` under the `driving-gg-directly` skill prints the
candidate list per model from the endpoints listing with the same filters,
official endpoint first, and the three templates carry the shape.

### Documentation

Rewrite the prompt caching section of
`apps/docs/src/content/docs/gg/overview.md` around the candidate list and the
move, describe the invocation shape on `configurations.md`, the miss limit on
`execution-limits.md`, `provider_switch` and the widened `GgProviderStat` on
the telemetry and run record pages, and the resolution and the policy on the
add-or-update-a-model quickstart.

## Done when

- [ ] `modelProviders` carries an ordered candidate list per model, and the
      backend builds it at enqueue from the endpoints listing under the
      filters above.
- [ ] Every request names one provider and one quantization with fallbacks
      refused.
- [ ] A spent retry schedule moves the run to the next candidate, and a
      provider reaching `providerCacheMissLimit` is left at the next request,
      each recorded as `provider_switch`.
- [ ] `GgProviderStat` counts stalls and unexpected misses, the backend rolls
      them up per provider, and the console edits a model's native level,
      price ceiling and ban list.
- [ ] The skill's script prints the candidate list and the templates carry the
      shape.
- [ ] The pages above describe the list, the request, the move and the policy.
- [ ] Gates green.
