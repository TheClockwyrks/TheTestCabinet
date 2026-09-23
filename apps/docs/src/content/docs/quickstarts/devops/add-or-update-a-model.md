---
title: Add or Update a Model
---

## Overview

The model catalog is owned by the backend. Any model with at least one recorded
run already appears in the Models section; curating one gives it a Test Cabinet
display name, aliases, a provider logo, and a description. Curation is an in-app
edit that takes effect immediately, with nothing to commit, build, or release.

Every run is pinned to the model developer's own OpenRouter provider, and nowhere
else. A model whose official endpoint OpenRouter does not list, or which the
account's privacy settings exclude, is not testable. Enqueue refuses it, and the
console shows the reason on the model, rather than launching it on another
provider.

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

At enqueue the backend resolves the provider pin with the context window. The
catalog entry carries the provider slug, seeded from OpenRouter's endpoints
listing by taking the endpoint whose provider is the model's developer. Set the
slug by hand where that listing's name does not match the author segment of the
model id. A model with no official endpoint refuses the enqueue with the reason.

## Verify

The new or updated entry appears in the Models section immediately, and its
aliases attribute matching runs to it.

## Next steps

- [Adding or Updating a Model](/guides/devops/adding-or-updating-a-model/) is the
  full guide.
- [Run a Test Case](/quickstarts/development/run-a-test-case/) accepts each alias
  as a valid `--model` argument.
