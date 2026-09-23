---
title: Add or Update a Model
---

## Overview

The model catalog is owned by the backend. Any model with at least one recorded
run already appears in the Models section; curating one gives it a Test Cabinet
display name, aliases, a provider logo, and a description. Curation is an in-app
edit that takes effect immediately, with nothing to commit, build, or release.

Every run runs on one provider at a time, chosen from the ordered candidate list
the backend builds for the model at enqueue. OpenRouter is the gateway and the
bill. A model with no candidate is not testable, and enqueue refuses it with the
reason rather than launching it.

The full walkthrough is
[Adding or Updating a Model](/guides/devops/adding-or-updating-a-model/).

## Prerequisites

- A signed-in account in the web console or desktop app. See
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
4. Check the result and adjust the wording. A display name is required. Add one
   model id per alias, each paired with the harness family it works with (Claude
   Code, Codex, Antigravity, or Others/OpenRouter) so the run form offers a
   harness only the slugs it can launch. The svgl logo URL is optional.
5. Click Save.

## Update a model

Open the model in the Models section, click Edit, change the display name,
aliases and their harness families, provider, logo, description, or OpenRouter
slug, then Save.

Fill from OpenRouter replaces the name, provider, and description rather than
filling only the empty fields, so reach for it when you want OpenRouter's wording
back.

Prices are recorded by the backend rather than edited here: when the model is
saved, when a run using it is enqueued, when a run completes, and on a 24-hour
refresh. The model's Stats tab shows the latest per-Mtok rates.

The catalog records, beside each model's prices, the facts the candidate list is
built from. Native quantization is the highest level any endpoint of the model
declares, and a level entered in the form's Native quantization field wins over
the observed one. The price ceiling is the developer endpoint's input and output
rates when that endpoint is listed, and a ceiling entered in the form's Price
ceiling field when it is not. The ban list names the providers a run of the
model never tries, one slug per line. Allowed unknown names the providers whose
`unknown` quantization is accepted by name. The model's Stats tab shows the
native level, the ceiling, the ban list and the allow list.

At enqueue the backend reads the model's endpoints listing and keeps an endpoint
whose quantization is the native level (an endpoint declaring `unknown` only
when the catalog entry allows that provider by name), whose input and output
prices are at or below the ceiling, which publishes a cache-read price, which
supports every parameter the run sends, and which is absent from the ban list.
The developer's own endpoint comes first when it passes. The rest follow by the
provider's fault rate across the backend's recorded runs of the model, then by
price. The resulting list is stamped onto the launch with the context window. A
model with no candidate refuses the enqueue, naming the model and the reason. A
model whose developer endpoint is excluded runs on the next candidate.

## Verify

The new or updated entry appears in the Models section immediately, and its
aliases attribute matching runs to it.

## Next steps

- [Adding or Updating a Model](/guides/devops/adding-or-updating-a-model/) is the
  full guide.
- [Run a Test Case](/quickstarts/development/run-a-test-case/) accepts each alias
  as a valid `--model` argument.
