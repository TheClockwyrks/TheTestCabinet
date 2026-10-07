---
title: Probe a Model
---

## Overview

A model probe checks whether a catalog model can drive [gg](/gg/overview/)'s
responses-as-code mode. The backend replays gg's RaC opening request through
OpenRouter — the one `submit_program` tool offered and `tool_choice` forced to
it, exactly as gg shapes the request — across the probe's cases, checks the
program each reply submitted against its case, and reduces the results to a
verdict. The cases pair two scenarios with several task prompts, per
program-language arm:

- Baseline: the conversation holds an open documentation view of every function
  the task needs, and a ready model writes a bare program calling them.
- Missing docview: the task needs a function whose documentation view is not
  open, and a ready model opens that view and stops instead of calling the
  function in the same program.

The probe is triggered from the model's Probes tab, and each run is a new dated
record beside the earlier ones.

## Prerequisites

- A signed-in account in the web console. See
  [Register and Log In](/quickstarts/setup/register-and-login/).
- A backend configured with `TCAB_OPENROUTER_API_KEY`, the key the probe's
  completion calls are billed to.

## Run a probe

1. Sign in and open the model in the Models section.
2. Open the Probes tab.
3. Optionally pick a provider to pin the probe to, pick one program-language
   arm or leave it on all languages, and adjust the sample count. Left alone,
   the probe uses the model's default OpenRouter route with eight calls per
   task prompt across every arm.
4. Click Run probe. The probe appears in the history as running and completes
   in place.

## Read the verdict

- `ready`: every probed (language, scenario) group passed at least 80% of its
  calls — bare programs making the documented calls, and docview-before-call
  discipline where the documentation was missing. Run the model in RaC mode.
- `not-ready`: at least one group fell short. The per-call labels say why — a
  program missing the needed calls, a call to a function whose documentation
  was never opened, a fenced or empty program string, or a reply that dodged
  the forced call — and the raw replies carry the evidence.

Expanding a probe shows each call's outcome by scenario and prompt, its
submitted program and raw reply, and every case's request as sent.

## Next steps

- Re-run the probe per provider and per language arm: providers serve the same
  model differently, and the history keeps every verdict.
- [Adding or Updating a Model](/guides/devops/adding-or-updating-a-model/)
  covers the catalog entry a probe targets.
- [Model probes](/components/backend/api/#model-probes) is the wire contract.
