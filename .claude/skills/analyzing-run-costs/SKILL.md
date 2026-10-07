---
name: analyzing-run-costs
description: Read this skill before comparing what runs cost across harnesses, models, or gg configurations — "why is gg more expensive than pi", "did that capability change help", "where are the tokens going". Covers what telemetry each harness actually emits, why the recorded cost column is not comparable between harnesses, how to normalize onto one price basis, and how to decompose a run into turns × context.
---

# Analyzing run costs

A run's cost is **turns × context**, plus output. Almost every surprising cost
result is a turn-count result: a harness that re-sends a modest context thirty
times costs more than one that re-sends a large context ten times. Start from the
turn count, not the token total.

## What each harness emits

`GET /runs/{id}/events` is the normalized stream. What it contains differs by
harness, and the difference decides what you can measure:

| Harness  | Per-request usage                              | Turn count           | Notes                                                                                   |
| -------- | ---------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------- |
| gg       | `event.type == "usage"` (nested under `event`) | exact                | also `turn_started`, `context_breakdown`, `turn_timing`, `tool_call`, `session_summary` |
| pi       | top-level `type == "usage"`                    | exact                |                                                                                         |
| opencode | top-level `type == "usage"`                    | exact                |                                                                                         |
| codex    | **none**                                       | **must be inferred** | see below                                                                               |

Codex's `--json` output emits one session-level `turn.completed` carrying
aggregate usage and no per-request breakdown. Its **cost is exact**; its turn
count is not available. Infer it from `item.completed` lines in the raw stream
and say in the writeup that it is inferred.

Two more sources:

- `GET /runs/{id}` → `record.metrics.tokens` (whole-run totals),
  `record.subject.ggCapabilitySet` (the configuration that ran),
  `record.subject.ggSummary` (gg's own tallies), and
  `record.validation.debugScripts[].verdicts[].pass` (whether the run actually
  worked — always check this before celebrating a cheap run).
- `scripts/extract-assets.sh <run-id>` → `tmp/assets/<run-id>/raw.jsonl`, the
  unnormalized harness stdout. Reach for it when the normalized stream drops
  something: pi's per-request `cacheWrite` and codex's item stream are only here.

## Normalize the prices — the recorded cost is not comparable

Three separate reasons the `cost` column cannot be compared across harnesses
as recorded. Do not skip this step; it is not a rounding concern.

1. **gg is priced differently from everything else.** A harness that reports its
   own cost has that figure used verbatim and the catalog skipped entirely
   (`crates/core/src/lib.rs:1405`, `:1107`). gg reports the gateway's actual
   charge; every other harness is priced from the model catalog.
2. **The catalog has no cache-write class.** `TokenCounts` carries uncached and
   cached input only, so cache-creation tokens land in `uncachedInput` and are
   priced at the plain input rate. They are billed at a premium — measured at
   **1.25×** on GPT-5.6 Sol. This understates every catalog-priced harness.
3. **OpenRouter routes to providers that charge differently.** The same model
   slug can arrive via OpenAI direct at a discount or Azure/Amazon at a markup.
   Two runs of the same config can bill differently for reasons nothing in the
   run controls.

So recompute every run from token counts on one scale. The defaults in the
script below treat **all non-cache-read input as cache-write** — in a coding
harness, turns run well over a 90% cache hit rate, so the premium is effectively
a price bump on all input:

```
cache-write input   base × 1.25
cache-read input    base × 0.10
output + reasoning  the output rate; reasoning is billed as output
```

Both halves of that model are measurable, and worth re-confirming on a new model
rather than assuming:

- gg's `usage` events carry an inline gateway `cost`, so a run can be solved by
  least squares for implied per-token prices. On GPT-5.6 Sol every gg run
  returned catalog × (1.25, 1.00, 1.00) with a residual near 10⁻⁷.
- pi's `raw.jsonl` reports `cacheWrite` as its own field. 99.8% of what the
  catalog files as "uncached input" was cache-write.

## Run the report

```sh
# by case slug, or by explicit run ids
.claude/skills/analyzing-run-costs/scripts/run-economics.py --case pong
.claude/skills/analyzing-run-costs/scripts/run-economics.py <run-id> <run-id> …

# a different model's rates
… --input 5.00 --output 30.00 --write-multiplier 1.25 --read-fraction 0.10
```

Needs `make -C deployments/local local-forward` running (or `TCAB_BACKEND` set to
a reachable backend). Pulled JSON is cached under `tmp/analysis/`, so re-runs are
free and the raw material stays available for follow-up questions.

It prints per-run and per-configuration tables, the per-turn input-token series,
and — for gg — execution mode, tool calls per turn, bookkeeping-only turn count,
every image in context with the turn it entered on, and the per-turn tokens that
sit outside `context_breakdown`.

## Decompose, don't just rank

The per-configuration table gives the answer; the decomposition gives the reason.
Two numbers separate any two harnesses:

- **Turns** — model round-trips. gg, pi and opencode report these exactly.
- **Context per turn** — total input ÷ turns.

Attribute the gap before proposing a fix. A harness losing on turns needs fewer
round-trips; a harness losing on context needs a smaller prompt. They are
different problems and the wrong one is easy to guess: a harness can carry a
_smaller_ context than its competitor and still cost twice as much.

Then split the cost by token class. Cache-read input is the direct price of
re-sending context once per turn, so a large cache-read line is the signature of
a turn-count problem.

## Reading gg specifically

- **`context_breakdown` is text-only, and misses two different things.** Subtract
  it from the same turn's `usage` input and the remainder is the tool-schema block
  **plus** the amount by which gg under-counts images. Do not report that
  remainder as the schema block: in one measured configuration it was 3,017
  tokens, of which roughly 600 were schemas and roughly 2,400 was image
  undercount.
  - **Images are the bigger term, and gg's estimate is ~8x low.** A 1280x720 PNG
    bills around 1,130 tokens; gg's per-message `tokens` field put the same file
    at 122-426 and scaled it with _file size_, which is not what images are
    billed on. Any image in context rides on every subsequent request.
  - **To size the schemas, difference two configurations** rather than reading the
    remainder directly. The images cancel, so the subtraction is exact: two
    configurations 8 tools apart differed by 841 tokens, giving ~105 per task
    tool.
  - **Attribute a step in the remainder to an image, not to prose.** The step
    appears on the turn after a read, and its size divided by ~1,130 is the
    number of images.
- **Turns holding only task or context-management calls did no work.** Classify a
  turn by its `tool_call` names: a turn whose calls are all drawn from
  `add_task`, `update_task`, `set_blocked_by`, `complete_task`, `remove_task`,
  `evict_file_view`, `compact` produced nothing but bookkeeping and still paid a
  full-context request.
- **`slot_usage` is root-scoped and whole-run.** Drop it from per-agent folds or
  you will double-count. Sum the per-turn `usage` events instead.
- **A preset name is not a configuration.** Saved gg configs live in the
  `gg_config` table and are edited in place, so two runs can share a preset name
  and not a capability set. Group by `ggSummary.effectiveTools`, never by name —
  the script warns when a name covers more than one tool set.

## Before reporting

- **Check the run worked.** Count passing verdicts in
  `record.validation.debugScripts[].verdicts[]`. A configuration change that
  makes runs cheaper by making them skip work is not a win, and a fresh run has
  no human review to catch it.
- **Say which numbers are measured and which are inferred.** Codex's turn count
  is inferred. A counterfactual computed by dropping turns from a recorded trace
  is measured; one computed by scaling an average is not.
- **Report the spread, not only the mean.** Three runs per configuration is a
  small sample and the distributions often overlap at the edges — that overlap
  is usually the honest answer to "is it comparable now".
