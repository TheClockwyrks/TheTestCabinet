# Price the comparable cost at the developer's list price

Compute a run's comparable cost from the model developer's published list
price, entered on the catalog entry, so the figure the site publishes is
stable across providers and discounts.

## Current state

`crates/core/src/pricing.rs` reads a model's per-token prices from OpenRouter's
models listing and maps them onto `TokenPrices`, from which `Cost::comparable`
is computed. The backend records the prices when a model is saved, when a run
using it is enqueued, when a run completes, and on a 24-hour refresh, and the
model's Stats tab shows the latest rates. The add-or-update-a-model quickstart
describes that flow.

The listing's price is whatever endpoint OpenRouter routes to by default, so it
is one provider's price at one moment, discounts included. For `z-ai/glm-5.3`
the listing shows $0.6538 / $2.055 per Mtok, which is a single provider under a
temporary 53% discount, while Z.ai's own list price is $1.40 / $4.40. A run
priced from the listing is priced on whichever provider was cheapest that day,
and two runs of one model a week apart are not comparable.

## Design

The catalog entry carries the developer's list price: input, output and cached
input per Mtok, with the date it was taken. An operator enters it from the
developer's pricing page; Fill from OpenRouter seeds the three figures from the
official provider's endpoint in the endpoints listing (see
[`pin-every-run-to-the-model-s-official-provider.md`](../gg-client/pin-every-run-to-the-model-s-official-provider.md))
for the operator to confirm or correct. A model with no list price is refused at
enqueue with the reason, since the comparable cost is a published statistic.

`Cost::comparable` is computed from the list price and nothing else. The
figure a run was billed stays in `Cost::actual`, from the harness's own
accounting where it reports one.

The 24-hour refresh stops rewriting the price a run is scored at. It reads the
official endpoint's current price and records it beside the list price as the
billed rate, and the model's Stats tab shows both with the difference, so a
discount, a price change or a listing error is visible on the model rather than
in the runs.

Bring the add-or-update-a-model quickstart and guide, the metrics page that
defines the comparable cost, and the model form onto the list price.

## Done when

- [ ] The catalog entry carries a dated list price, and the model form edits it
      with Fill from OpenRouter seeding it from the official endpoint.
- [ ] A run's comparable cost is computed from the list price alone.
- [ ] A model without a list price is refused at enqueue.
- [ ] The refresh records the official endpoint's price as the billed rate and
      the Stats tab shows both.
- [ ] The quickstart, guide and metrics page describe the list price.
- [ ] Gates green.
