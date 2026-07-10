---
title: Adding or Updating a Model
---

The model catalog is the list of subjects a run can be attributed to — the
Anthropic, OpenAI, Google, and other models the suite drives through a
[harness](/components/core/harnesses/). This guide covers how the catalog is
owned and served, how a model comes to appear, and how to curate one. If you just
need the steps, the [Add or Update a Model](/quickstarts/devops/add-or-update-a-model/)
quickstart is faster.

## Where the catalog lives

The catalog is **owned by the backend**, not by files in the repo. Model records,
their aliases, and their price history live in the backend store (the `model`,
`model_alias`, and `model_price` tables). The backend serves the catalog at
`GET /models`, and it is also baked into the public R2 snapshot (as `models.json`,
pointed to by the snapshot `index.json`'s `modelsKey`) so the static gallery
renders model metadata and prices without a backend round-trip.

There is no on-disk model dataset anymore — no `models/<slug>.toml`/`.md` files,
no bundled `models.json`, and no `tcab catalog` build step. Curating a model is
an in-app edit that takes effect immediately, with no recompile or release.

## Curated vs. derived models

Every model that has at least one recorded run **appears in the Models section
automatically**, whether or not anyone has curated it:

- A **derived** (uncurated) model shows under its canonical model id, resolved
  from the run record. The `openrouter/` routing prefix is stripped for the
  harnesses that require it (OpenCode and Kilo Code), and a trailing OpenRouter
  variant tag such as `:free` is stripped for OpenRouter-accessed harnesses
  (every harness except Codex, Claude Code, and Antigravity). This normalization
  keeps the same underlying model from splitting into phantom duplicate entries.
- A **curated** model is one someone has configured in the app: it carries a
  Test-Cabinet-defined display name, provider, logo, description, OpenRouter
  slug, and one or more aliases. Its aliases are what attribute runs to it, so a
  curated entry absorbs the derived ids it covers.

## Curating a model in the app

Curated configuration is edited in the **web console** or **desktop app**, in the
**Models** section. Because it is a write, it **requires sign-in**.

A model record has these fields, all set in the app:

- **Display name** — the Test-Cabinet name shown across the site and consoles. It
  is **required** and never auto-generated; adding a model always goes through the
  form and an explicit **Save**.
- **Aliases** — one or more run-record model ids this entry covers. Different
  harnesses report the same model under different ids, so one curated model
  usually carries several aliases (see below).
- **Provider** — e.g. Anthropic, OpenAI, Google.
- **Provider logo** — supplied as an [svgl.app](https://svgl.app) `https://` URL.
  The backend fetches and sanitizes the SVG server-side; you don't paste markup.
- **Description** — markdown prose shown on the model's page.
- **OpenRouter slug** — the id OpenRouter lists the model under, used for pricing.

### Why one model needs several aliases

Aliases exist because a single model is reported under different ids depending on
the harness that ran it:

- **Most harnesses** route through OpenRouter and report the slug unchanged.
- **OpenCode and Kilo Code** also route through OpenRouter but prefix the slug
  with their own `openrouter/` provider id.
- **Anthropic and OpenAI** run through Claude Code and Codex, which report a
  **provider-native** id (e.g. `claude-sonnet-5`) rather than an OpenRouter slug.

Listing every form a model can appear under as an alias is what maps each run
record's `subject.modelId` back to the one curated entry. See
[Harnesses](/components/core/harnesses/) for the reporting details.

## Two ways to add a model

1. **Blank form.** In the Models section, click **Add model** and fill the form
   from scratch.
2. **Seed from a run.** When a run of an unknown (derived) model appears, open it
   and click **Add this model**: the form is pre-seeded from that run's model id
   as a starting alias. You still fill in the display name and the rest, and
   **Save**.

Either way, adding always goes through the form and an explicit Save — the
display name is required, so nothing is created implicitly.

## Prices are recorded as a history

Comparable cost is still computed from OpenRouter's per-token prices exactly as
before (see [Metrics](/components/core/metrics/#cost)). What changed is *who*
fetches them and that they are **retained as a per-model history** instead of a
single committed number:

- The **backend** fetches a model's current OpenRouter price **when a run
  completes**, and again on a **24-hour periodic refresh**.
- An observation is appended to the price history **only when the price changed**,
  so the table doesn't grow on every identical fetch.
- Fetching at run-completion time means **promotional pricing** (e.g. a
  launch-week discount) is captured as it was when the run actually ran.
- A `:free`-tagged OpenRouter run is priced at the model's **base rate**, never
  `$0` — the free variant is a routing tag, not a genuinely free run.

A model's detail page shows this history as a **graph** and a **table**, with one
table row per newly-observed price.

## Updating an existing model

Open the model in the **Models** section, click **Edit**, change any field
(display name, aliases, provider, logo, description, OpenRouter slug), and
**Save**. There is nothing to regenerate or commit — the change is live at once,
and the snapshot picks it up on the next publish.

## Next steps

- [Run a Test Case](/quickstarts/development/run-a-test-case/) — the model is a valid
  `--model` argument.
- [Harnesses](/components/core/harnesses/) — how each harness reports the model id
  that an alias maps back to a curated entry.
