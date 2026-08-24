---
title: Probe a Model
---

## Overview

A model probe checks whether a catalog model can drive [gg](/gg/overview/)'s
responses-as-code mode. The backend replays gg's real RaC opening request
through OpenRouter — the one `submit_program` tool offered and `tool_choice`
forced to it, exactly as gg shapes the request — samples it several times,
classifies the program each reply submitted, and reduces the results to a
verdict. The probe is triggered from the model's Probes tab, and each run is a
new dated record beside the earlier ones.

## Prerequisites

- A signed-in account in the web console or desktop app. See
  [Register and Log In](/quickstarts/setup/register-and-login/).
- A backend configured with `TCAB_OPENROUTER_API_KEY`, the key the probe's
  completion calls are billed to.

## Run a probe

1. Sign in and open the model in the Models section.
2. Open the Probes tab.
3. Optionally pick a provider to pin the probe to, and adjust the number of
   calls. Left alone, the probe uses the model's default OpenRouter route with
   three calls.
4. Click Run probe. The probe appears in the history as running and completes in
   place.

## Read the verdict

- `ready`: at least 80% of the calls submitted a clean program — a bare program
  over the gg modules, with no fence and no prose inside the string. Run the
  model in RaC mode.
- `not-ready`: too few calls submitted a clean program. The per-call labels say
  why — a fenced or prose-wrapped program string, a program that never imports
  the gg modules, a reply that dodged the forced call, or an empty submission —
  and the raw replies carry the evidence.

Expanding a probe shows each call's classification, its submitted program and
raw reply, and the request as sent.

## Next steps

- Re-run the probe per provider and over time: providers serve the same model
  differently, and the history keeps every verdict.
- [Adding or Updating a Model](/guides/devops/adding-or-updating-a-model/)
  covers the catalog entry a probe targets.
- [Model probes](/components/backend/api/#model-probes) is the wire contract.
