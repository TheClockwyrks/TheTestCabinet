---
title: Overview
---

Goose is a CLI coding agent that The Test Cabinet drives non-interactively
through OpenRouter. The Test Cabinet runs it headlessly with a single prompt,
parses its JSON event stream into normalized [harness
events](./events/), and derives token [metrics](./metrics/) from the usage it
reports on completion. See the project's own documentation at
[goose-docs.ai](https://goose-docs.ai/).

## Model IDs

Goose is invoked with `--provider openrouter`, so the model ID is an OpenRouter
provider-prefixed slug, passed through unchanged for the comparable-cost lookup.
Examples (illustrative, not exhaustive):

- `z-ai/glm-5.2`
- `moonshotai/kimi-k2.7-code`
- `qwen/qwen3.7-plus`

## Invocation

The CLI binary is `goose`, installed into the run container at run time with:

```sh
curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | CONFIGURE=false bash
```

A single prompt is run to completion with `goose run`, requesting the
line-delimited JSON event stream and suppressing decorative output:

```sh
goose run --provider openrouter --model <model> --output-format stream-json --quiet --text <prompt>
```

The `--quiet --text` flags keep the stream clean of interactive UI chrome.
Authentication uses the host's `OPENROUTER_API_KEY`, which is injected into the
container under the same name.

Pricing uses `PricingModelId::Passthrough`: Goose already reports OpenRouter
model IDs, so the ID is used as-is for the OpenRouter price lookup.

See the [Events](./events/) and [Metrics](./metrics/) pages for how Goose's
output is normalized, and [Harnesses](/components/core/harnesses/) for the
harness layer overall.
