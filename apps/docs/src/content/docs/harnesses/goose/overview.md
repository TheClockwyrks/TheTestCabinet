---
title: Overview
---

Goose (slug `goose`) is a CLI coding agent, driven non-interactively through
OpenRouter. The Test Cabinet runs it headlessly with a single prompt, parses its
JSON event stream into normalized [events](/harnesses/goose/events/), and
derives token [metrics](/harnesses/goose/metrics/) from the usage it reports on
completion. See [goose-docs.ai](https://goose-docs.ai/).

## Model IDs

Goose is invoked with `--provider openrouter`, so a model ID is an OpenRouter
provider-prefixed slug. The following are illustrative:

- `z-ai/glm-5.2`
- `moonshotai/kimi-k2.7-code`
- `qwen/qwen3.7-plus`

## Invocation

The harness probes and invokes the `goose` binary. The CLI is installed into the
run container immediately before the session, so each run picks up the most
recently published version. `CONFIGURE=false` skips the installer's interactive
configuration, and the binary lands in `~/.local/bin`, which is already on
`PATH`:

```sh
curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh \
  | CONFIGURE=false bash
```

A single prompt is run to completion with `goose run`, requesting the
line-delimited JSON event stream and suppressing decorative output:

```sh
goose run --provider openrouter --model <model> \
  --output-format stream-json --quiet --text <prompt>
```

`--quiet --text` keep the stream clear of interactive UI chrome. The prompt is
the final positional argument.

## Authentication

Goose authenticates with an OpenRouter API key, read from `OPENROUTER_API_KEY`
on the host and injected into the run container under the same name. See
[Authentication](/harnesses/goose/authentication/).

## Pricing

Goose reports OpenRouter model IDs, so the ID resolves unchanged to the catalog
entry whose list price yields the comparable cost. See
[Metrics](/harnesses/goose/metrics/).
