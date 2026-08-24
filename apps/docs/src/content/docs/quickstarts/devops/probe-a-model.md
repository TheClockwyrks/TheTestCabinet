---
title: Probe a Model
---

## Overview

A model probe checks whether a catalog model can drive [gg](/gg/overview/)'s
responses-as-code mode. The backend replays gg's real RaC opening request
through OpenRouter under four prompt conditions, classifies the shape of every
reply, and reduces the results to a verdict. The probe is triggered from the
model's Probes tab, and each run is a new dated record beside the earlier ones.

## Prerequisites

- A signed-in account in the web console or desktop app. See
  [Register and Log In](/quickstarts/setup/register-and-login/).
- A backend configured with `TCAB_OPENROUTER_API_KEY`, the key the probe's
  completion calls are billed to.

## Run a probe

1. Sign in and open the model in the Models section.
2. Open the Probes tab.
3. Optionally pick a provider to pin the probe to, and adjust the samples per
   condition. Left alone, the probe uses the model's default OpenRouter route
   with three samples per condition.
4. Click Run probe. The probe appears in the history as running and completes in
   place.

## Read the verdict

- `ready`: the model answers with a clean program under every condition. Run it
  in RaC mode as-is.
- `ready-with-reminders`: the model behaves once the contract is restated.
  Enable cross-model prompt reminders for it.
- `tool-call-overfit`: the model emits tool-call syntax even when the contract
  is restated. It is not worth running in RaC mode.
- `not-ready`: the model misses the clean-rate threshold for reasons that are
  not tool-shaped. The raw replies say what they are.

Expanding a probe shows the per-condition results, each call's classification
and raw reply, and the request as sent.

## Next steps

- Re-run the probe per provider and over time: providers serve the same model
  differently, and the history keeps every verdict.
- [Adding or Updating a Model](/guides/devops/adding-or-updating-a-model/)
  covers the catalog entry a probe targets.
- [Model probes](/components/backend/api/#model-probes) is the wire contract.
