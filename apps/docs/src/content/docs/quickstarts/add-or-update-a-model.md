---
title: Add or Update a Model
---

Curate a model in the app — give it a Test-Cabinet display name, aliases, a
provider logo, and a description — or edit one that already exists. The model
catalog is owned by the **backend** now, not a file in the repo: any model with
at least one recorded run already appears in the Models section, and curating one
is an in-app edit that needs no recompile or release.

For the full walkthrough and the *why* — curated vs. derived models, why one
entry covers several run-record ids, and how prices are recorded — see [Adding or
Updating a Model](/guides/adding-or-updating-a-model/).

## Prerequisites

- A signed-in account in the **web console** or **desktop app** (curating the
  catalog is a write, so it requires sign-in). See
  [Register and Log In](/quickstarts/register-and-login/).
- The model's **provider logo URL** on [svgl.app](https://svgl.app) (the backend
  fetches and sanitizes it server-side), and its **OpenRouter slug** if you have
  one.

## Add a new model

1. Sign in and open the **Models** section.
2. Click **Add model** for a blank form, or — if the model already has runs but
   isn't curated yet — open it from its derived entry and click **Add this
   model** to seed the form from that run.
3. Fill in the **display name** (required — it is never auto-generated), one or
   more **aliases** (the run-record model ids this entry should cover), the
   **provider**, the **svgl logo URL**, a markdown **description**, and the
   **OpenRouter slug**.
4. Click **Save**.

That's it — the change is live immediately, with no build or release.

## Update an existing model

Open the model in the **Models** section, click **Edit**, change the display
name, aliases, provider, logo, description, or OpenRouter slug, and **Save**.

Prices are not edited here: the backend records each model's OpenRouter price
automatically — once when a run completes and again on a 24-hour refresh — and
the model's detail page shows that history as a graph and a table.

## Verify

The new or updated entry appears in the **Models** section immediately, and its
aliases now attribute matching runs to it. There is nothing to commit.

## Next steps

- [Adding or Updating a Model](/guides/adding-or-updating-a-model/) — the full
  guide: curated vs. derived models, aliases, seed-from-run, and price history.
- [Run a Test Case](/quickstarts/run-a-test-case/) — the model is a valid
  `--model` argument.
