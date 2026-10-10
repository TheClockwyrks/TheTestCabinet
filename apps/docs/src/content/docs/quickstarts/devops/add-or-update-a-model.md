---
title: Add or Update a Model
---

## Overview

The model catalog is owned by the backend. Any model with at least one recorded
run already appears in the Models section; curating one gives it a Test Cabinet
display name, aliases, a provider logo, and a description. Curation is an in-app
edit that takes effect immediately, with nothing to commit, build, or release.

A gg run of a model runs on the providers of its candidate list, one at a time,
with OpenRouter as the gateway and the bill. The list keeps the providers that
serve the model at its native quantization, at or below its developer's prices,
with a cache-read price and the parameters the run sends, and not banned on the
model's entry. The developer's own endpoint comes first when it passes, so a
model whose developer endpoint is excluded, by the filters or by the account's
privacy settings, runs on the next candidate. A model with no candidate is not
testable, and enqueue refuses it with the reason.

The full walkthrough is
[Adding or Updating a Model](/guides/devops/adding-or-updating-a-model/).

## Prerequisites

- A signed-in account in the web console. See
  [Register and Log In](/quickstarts/setup/register-and-login/).
- The model's provider logo URL on [svgl.app](https://svgl.app), which the
  backend fetches and sanitizes server-side, and its OpenRouter slug when it has
  one.

## Add a model

1. Sign in and open the Models section.
2. Click Add model for a blank form. When the model already has runs but no
   curated entry, open its derived entry and click Add this model to seed the
   form from that run.
3. Enter the OpenRouter slug and click Fill from OpenRouter to populate the
   display name, provider, and description from OpenRouter's catalog. For a model
   OpenRouter does not list, fill the fields in by hand.
4. Check the model's list price: the uncached input, cached input, and output
   rates per Mtok, and the date the figures were taken. Fill from OpenRouter
   seeds the three rates. For a model OpenRouter does not list, enter them from
   the developer's pricing page. Save refuses a partial or undated set.
5. Check the result and adjust the wording. A display name is required. Add one
   model id per alias, each paired with the harness family it works with (Claude
   Code, Codex, Antigravity, or Others/OpenRouter) so the run form offers a
   harness only the slugs it can launch. The svgl logo URL is optional.
6. Click Save.

## Update a model

Open the model in the Models section, click Edit, change the display name,
aliases and their harness families, provider, logo, description, OpenRouter
slug, list price, or provider fields, then Save.

Fill from OpenRouter replaces the name, provider, and description rather than
filling only the empty fields, and seeds the three list-price rates, so reach
for it when you want OpenRouter's wording back.

## Refresh list prices

A run's comparable cost is priced from the model's list price. The backend
refreshes every curated model's list price from OpenRouter every 24 hours, and
fills a missing one when a run binding the model is first enqueued. A model the
catalog has no entry for, or one OpenRouter yields no rate for, is refused at
enqueue with the reason named.

To refresh on demand, open the Models section and click Refresh, beside Add
model. The page reports how many models were updated, confirmed unchanged,
and left as they were. A price entered by hand stands until a refresh resolves
a rate for that model from OpenRouter.

## Provider fields

The form's provider fields decide the candidate list:

- Developer provider, set where OpenRouter's name for the developer's endpoint
  does not match the model id's author segment (`qwen/…` served by `Alibaba`).
  Its standard endpoint's rates are the list price whenever it lists a complete
  set, on every refresh. Without it, a model whose developer OpenRouter spells
  differently is priced at the model's own price in OpenRouter's models listing
  (the `pricing` field of its `/models` entry), a third party's rate.
- Quantization filter, switched off for a model whose precision no provider
  discloses, so that every endpoint passes at whatever level it declares.
- Native quantization, set where the highest level any endpoint declares is
  wrong for the model.
- Price ceiling, per Mtok, used when OpenRouter lists no developer endpoint.
- Banned providers, removed from every gg run of the model.
- Unknown-quantization providers, kept despite declaring `unknown`.

At enqueue the backend reads the model's endpoints listing, builds the list and
stamps it onto the launch with the context window. The model's Stats tab shows
the list the next enqueue would build, or the reason it would refuse. See
[choosing the providers a gg run uses](/guides/devops/adding-or-updating-a-model/#choosing-the-providers-a-gg-run-uses).

## Verify

The new or updated entry appears in the Models section immediately, and its
aliases attribute matching runs to it.

## Next steps

- [Adding or Updating a Model](/guides/devops/adding-or-updating-a-model/) is the
  full guide.
- [Run a Test Case](/quickstarts/development/run-a-test-case/) accepts each alias
  as a valid `--model` argument.
