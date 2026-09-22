# Pin every run to the model's official provider

Send every request of a run to one provider, the model developer's own
endpoint, with fallbacks refused, so OpenRouter cannot move a run and
invalidate its cache or its cost record.

## Current state

gg keeps a run on one endpoint only by asking: every request carries the run's
key as `session_id`, `prompt_cache_key` and the `x-session-id` header, and no
`provider` object. OpenRouter treats the key as a routing preference. On
2026-09-22 a run of `openai/gpt-5.6-sol` was moved from OpenAI to Azure at its
fifty-fourth request, with no error, retry or change on gg's side. The first
Azure request re-read the whole 101k-token prefix uncached at $0.64, against
$0.04 for the OpenAI turn before it, and every turn afterwards ran at Azure's
$5/$30 rate against OpenAI's $2/$10. The run stayed on Azure to the end.

A run's cost figure is one of the things The Test Cabinet records, and a
reroute puts part of a run on one price basis and the rest on another with
nothing in the record saying so. Near a full window the single cold request
would cost more than the rest of the run.

The backend resolves each bound model's context window from OpenRouter at
enqueue and stamps it onto the launch as `modelWindows`, and gg refuses a launch
missing one. OpenRouter's endpoints listing
(`/api/v1/models/{author}/{slug}/endpoints`) names each endpoint's
`provider_name` beside its pricing. Every model of interest is offered by its
own developer there.

## Policy

Every run runs on the model developer's own provider, and nowhere else. A model
whose official endpoint OpenRouter does not list, or which the account's
privacy settings exclude, is not testable. It is refused rather than run on
another provider.

## Design

### The invocation

`GgInvocation` gains `modelProviders`, keyed by model id like `modelWindows`,
naming the one OpenRouter provider slug the model's requests go to. It is
required on the same terms as `modelWindows`: a bound model with no provider
refuses the launch, and validation reports every missing one together.

### The request

Every request carries OpenRouter's `provider` object with `only` naming the
pinned slug and `allow_fallbacks` false. The sticky key stays, since it still
keeps a run on one endpoint within the provider. With fallbacks refused a
provider's outage reaches gg as the error it is, so this issue depends on
[`ride-out-a-provider-outage-with-ten-retries.md`](ride-out-a-provider-outage-with-ten-retries.md).

Every response names the provider that served it, which `usage` already
records. A response from any other provider ends the run as a harness failure,
`provider_mismatch`, because the cost recorded from that point would be on a
different basis. The event names the pinned and the served providers.

### Resolution at enqueue

The backend resolves the provider with the window. The catalog entry for a
model carries its provider slug, seeded from the endpoints listing by taking
the endpoint whose provider is the model's developer, and set by hand where the
listing's naming does not match the author segment of the model id. A model
with no official endpoint refuses the enqueue with the reason, and the console
shows it on the model rather than on a failed run.

`session_started` records the pin beside the session id.

### Direct invocations

`scripts/model-windows.sh` under the `driving-gg-directly` skill prints
`modelProviders` beside the two objects it prints today, from the endpoints
listing, and fails naming the model when no endpoint belongs to the developer.
The three templates carry the field.

### Documentation

Describe the pin in the prompt caching section of
`apps/docs/src/content/docs/gg/overview.md`, the invocation contract in
`configurations.md`, the `usage` and `session_started` events in the telemetry
pages, and the resolution step in the add-or-update-a-model quickstart. State
the policy on the quickstart.

## Done when

- [ ] A launch with a bound model missing from `modelProviders` is refused.
- [ ] Every request carries the pinned provider with fallbacks refused.
- [ ] A response from another provider ends the run as `provider_mismatch`.
- [ ] The backend resolves and stamps the provider at enqueue and refuses a
      model without an official endpoint.
- [ ] The skill's script and templates carry the field.
- [ ] The pages above describe the pin and the policy.
- [ ] Gates green.
