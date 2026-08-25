---
title: Adding or Updating a Model
---

## Overview

The model catalog is the list of subjects a run can be attributed to: the models
the suite drives through a [harness](/components/core/harnesses/). This guide
covers how the catalog is owned and served, how a model comes to appear, and how
to curate one. The
[Add or Update a Model](/quickstarts/devops/add-or-update-a-model/) quickstart is
the same task reduced to its steps.

## Where the catalog lives

The catalog is owned by the backend. Model records, their aliases, and their
price history live in the backend store as the `model`, `model_alias`, and
`model_price` tables. The backend serves the catalog at `GET /models` and writes
the models a published run references into the [public
projection](/components/backend/projection/), so the gallery renders model
metadata and prices without reaching the backend.

Curating a model is an in-app edit that takes effect immediately, with no
recompile and no release.

## Curated and derived models

Every model with at least one recorded run appears in the Models section
automatically:

- A derived model shows under its canonical model id, resolved from the run
  record. The `openrouter/` routing prefix is stripped for the harnesses that
  emit it (OpenCode and Kilo Code), and a trailing OpenRouter variant tag such as
  `:free` is stripped for the OpenRouter-routed harnesses (every harness except
  Codex, Claude Code, and Antigravity). That normalization collapses one
  underlying model onto a single entry.
- A curated model carries a Test-Cabinet-defined display name, provider, logo,
  description, OpenRouter slug, and one or more aliases. Its aliases attribute
  runs to it, so a curated entry absorbs the derived ids it covers.

## Curating a model in the app

Curated configuration is edited in the Models section of the web console or the
desktop app. It is a write, so it requires sign-in.

A model record has these fields:

- Display name, the Test-Cabinet name shown across the site and consoles. It is
  required and never auto-generated.
- Aliases, one or more run-record model ids this entry covers, each paired with
  the harness family it is usable with. An alias is globally unique: an id
  belongs to at most one curated model.
- Provider, for example Anthropic, OpenAI, or Google.
- Provider logo, supplied as an [svgl.app](https://svgl.app) `https://` URL. The
  backend fetches and sanitizes the SVG server-side.
- Description, markdown prose shown on the model's page.
- OpenRouter slug, the id OpenRouter lists the model under, used for the
  comparable-cost lookup. It is separate from the aliases, so a model can carry
  it without ever being run through an OpenRouter harness.

### Alias harness families

A single model is reported under different ids depending on the harness that ran
it. Most harnesses route through OpenRouter and report the slug unchanged.
OpenCode and Kilo Code prefix it with `openrouter/`, and Claude Code, Codex, and
Antigravity report a provider-native id.

A slug is meaningful only to the harnesses that speak its namespace, so each
alias is tagged with a harness family:

- Claude Code, for provider-native Anthropic ids.
- Codex, for provider-native OpenAI ids.
- Antigravity, for provider-native Google ids.
- Others (OpenRouter), for OpenRouter ids (`provider/model`), shared by Cline,
  Goose, Kilo Code, OpenCode, Pi, and gg.

Claude Opus 4.8, for example, carries `claude-opus-4-8` under Claude Code and
`anthropic/claude-opus-4.8` under Others. Listing every form maps each run
record's `subject.modelId` back to the one curated entry. The family also lets
the New Run and Coverage forms filter the model dropdown to the slugs the
selected harness can launch. See [Harnesses](/components/core/harnesses/) for the
reporting details.

## Filling the form in from OpenRouter

The form's first field is the OpenRouter slug, and Fill from OpenRouter beside it
looks the slug up in OpenRouter's catalog and fills in three fields:

- Display name and Provider, split out of OpenRouter's own `Provider: Model`
  name, so `Anthropic: Claude Sonnet 4.5` becomes the name Claude Sonnet 4.5
  under the provider Anthropic. A name carrying no such prefix falls back to the
  slug's author segment.
- Description, as OpenRouter publishes it. OpenRouter truncates long blurbs
  itself, so what lands in the field is what it serves.

When the id list is still untouched, the fill also claims the slug as the entry's
first alias under Others (OpenRouter). A list you have already put an id into is
left alone.

Fill replaces those three fields rather than filling only the blanks, and runs
only on an explicit press. Nothing persists until Save, so leaving the page
discards a fill you did not want.

Fill leaves two things alone. The provider logo comes from svgl.app and is picked
by hand. The prices, context window, release date, and input modalities are
recorded by the backend itself. A slug OpenRouter does not list reports inline
and changes nothing.

## Two ways to add a model

1. Blank form. In the Models section, click Add model and fill the form, usually
   by entering the OpenRouter slug and pressing Fill from OpenRouter, then
   adjusting.
2. Seed from a run. Open a run of a derived model and click Add this model. The
   form is pre-seeded from that run's model id as a starting alias, already
   tagged with the family of the harness that ran it.

Either way, adding goes through the form and an explicit Save, and the display
name is required.

## Price history

Comparable cost is computed from OpenRouter's per-token prices (see
[Metrics](/components/core/metrics/#cost)). The backend fetches them and retains
them as a per-model history:

- The backend fetches a model's current OpenRouter price when a run completes,
  and again on a 24-hour periodic refresh.
- It records a first observation the moment a model first appears: when you save
  it here with an OpenRouter slug, when a run that binds it is enqueued (on every
  enqueue path — the run form, a gg launch, a coverage top-up, an automatic
  retry), and at backend startup for every known model still missing one. The
  startup pass is what prices a freshly seeded deployment's curated catalog
  before its first run. All of this seeding is missing-only, so a model already
  on record is left to the two paths above.
- An observation is appended only when something changed: the price, or one of
  the catalog facts riding along on it. The stored history collapses
  consecutive-equal prices, so an observation recorded for a fact change adds no
  spurious price step.
- Fetching at run-completion time captures promotional pricing as it stood when
  the run ran.
- A `:free`-tagged OpenRouter run is priced at the model's base rate. The free
  variant is a routing tag rather than a free run.

The history is what a run's comparable cost is priced against, so a run keeps the
rate it actually ran at. It is not charted in the console: a model's price
changes rarely enough that a chart of it was almost always two or three points,
so the model's Stats tab shows the latest per-Mtok rates instead of the series.

## Catalog facts recorded with each price

Each observation carries the model's context window, release date, and input
modalities as OpenRouter reported them at that moment, which makes the catalog
the single store of those facts.

The context window is what a [gg](/gg/overview/) run's window-fullness accounting
and [compaction](/gg/compaction/) trigger are measured against. When a gg run is
enqueued the backend looks the window up here for every model the run's
capability set binds and pushes the figures onto the launch, so gg keeps no model
table of its own.

A model with no observation yet is seeded at enqueue by the launch-time price
fetch. Should that not answer, the launch falls back to a per-model lookup for
that one model. If neither can answer, the launch is rejected: gg assumes no
default window, because a run measured against a guessed one reports the wrong
thing while looking healthy. See
[Runs with no resolved window](/gg/context-visibility/#runs-with-no-resolved-window).

The input modalities (`text`, `image`, `file`, …) are shown on the model's Stats
tab under Specs as both the raw list and a plain Vision line reading either
"accepts images" or "text only". They travel to a gg run on the same launch as
the context window and decide whether the agent may be shown the reference images
a test case's specs ship. See
[Reading images](/gg/filesystem/#reading-images).

An unknown modality list is recorded as unknown and the run proceeds. gg treats
an unannotated model optimistically and recovers if the provider refuses the
image, so an empty list in the console means the modalities have yet to be
observed.

## Updating an existing model

Open the model in the Models section, click Edit, change any field, and Save. The
change is live at once, and the snapshot picks it up on the next publish.

## Probing a model

A model probe is a responses-as-code readiness check, run from the model's
Probes tab. It answers whether the model can drive [gg](/gg/overview/)'s RaC
mode at all: the backend replays gg's RaC opening request against the model's
OpenRouter slug — the `submit_program` tool offered and forced, as gg sends
it — across cases that pair two scenarios with several task prompts, per
program-language arm. A baseline case checks that the model calls the functions
whose documentation views are open; a missing-docview case checks that it opens
a missing function's documentation and stops rather than calling the function
unread. A model can hold the call shape and still fail either discipline and
waste every RaC run; the verdict says whether to run the model in RaC mode or
keep it out.

Run a probe when a new model is introduced, and again after pinning a new
provider or before committing to a language arm, since providers can serve the
same model differently. The steps are in
the [Probe a Model](/quickstarts/devops/probe-a-model/) quickstart, and the wire
contract is at [Model probes](/components/backend/api/#model-probes).

## Next steps

- [Run a Test Case](/quickstarts/development/run-a-test-case/) accepts the model
  as a valid `--model` argument.
- [Harnesses](/components/core/harnesses/) documents how each harness reports the
  model id an alias maps back to a curated entry.
