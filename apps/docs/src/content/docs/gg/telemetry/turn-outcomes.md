---
title: "Turn outcomes"
---

gg judges every turn on the sentence the
[execution ceilings](/gg/execution-limits/#what-counts-as-an-error) are enforced
on: was the work the turn declared carried out as declared? One `turn_outcome`
rides on the stream per turn, carrying that judgement, emitted from the one seam
where gg records an outcome against an agent's ceilings. That seam is what makes
it impossible for this event and the ceilings to disagree about what an error is.
A run emits exactly one per model call it made.

```jsonc
{ "type": "turn_outcome", "outcome": "error", "error": "transpile",
  "errorType": "transpile_syntax", "consecutiveErrors": 2, "turns": 31 }
```

| Field | What it carries |
| --- | --- |
| `outcome` | `progressed` (the turn did its declared work), `finished` (the turn ended the session, which is never an error), `error`, or `fatal` (gg's own machinery broke, recorded so the turn accounting stays whole and deliberately not charged to the model's error budget). |
| `error` | Why, at the base level, on an `error` outcome, and absent on every other, so `error != null` and `outcome == "error"` are the same statement. One of `model_api`, `transpile`, `program_fault`, `sandbox_limit`, `missing_completion`. |
| `errorType` | Why, specifically: the leaf of the two-level taxonomy. Present on exactly the turns `error` is, and its base is the `error` beside it, since gg holds one value and derives both halves when it emits the event. |
| `consecutiveErrors` | This agent's failing streak after this turn. |
| `turns` | How many turns this agent has recorded, including this one. It is this agent's own running total rather than the run's, and the same figure its turn ceiling is measured against. |
| `loopAborts` | How many replies [loop detection](/gg/loop-detection/) discarded before this turn produced one. Omitted when zero. |
| `loopAbortWords`, `loopAbortChars` | How much generated output those discarded replies produced, measured by the detector as they streamed. Present on exactly the turns `loopAborts` is. There is no token count and no price, since an abandoned stream reports no usage, and this output is deliberately absent from the turn's cost. |
| `responseChars`, `responseOutputTokens` | The reply's size: its raw text in characters, and its completion tokens (output plus reasoning, the unit a provider's output cap is measured in). Omitted when zero. The summary folds `maxResponseChars` and `maxResponseOutputTokens` as maxima over the turns whose outcome was `progressed` or `finished`, which is the datum an output ceiling would later be chosen from. |

`consecutiveErrors` is `0` on every non-error turn, including a `finished` or
`fatal` one that followed failures. gg's internal counter is cleared only by a
turn that carried out its declared work, so an agent that failed twice and then
finished still holds a count of 2, and publishing that would put a streak on a
turn that did not fail. The invariant the stream guarantees is
`consecutiveErrors > 0` if and only if `outcome` is `error`.

The count is carried rather than re-derived because it is per agent while the
stream is run-wide. Turns from concurrently running agents interleave
arbitrarily, so a reader folding the stream could only reconstruct a run-wide
streak, which is an artefact of scheduling rather than a fact about any agent.

Under [responses as code](/gg/responses-as-code/overview/) this event sits beside
[`code_execution`](/gg/telemetry/code-execution/) and does not duplicate it. That
one reports what a program did and exists only in that mode; this is the
mode-agnostic judgement of the turn. A tool-calling run emits `turn_outcome` too,
which is what lets one error rate be compared across both modes. A tool-calling
turn that ends with no tool call is reported here as `missing_completion`, since
[ending a session](/gg/ending-a-session/) is always an explicit call.

## The error taxonomy

The five `error` values are the base kinds: whose layer failed. They are what an
execution ceiling acts on, what a cross-run comparison groups by, and what every
stored run keys on, so they are stable. `transpile` in particular keeps a name
wider than its meaning, because the value is what persisted records carry.

Underneath each base kind sits an `errorType`, and that is where the failure is
named. There are nineteen types, one per distinction gg makes.

| Base kind | Types under it |
| --- | --- |
| `model_api` | `model_auth` (the credential was refused), `model_rejected` (another non-retryable `4xx`), `model_retry_exhausted` (the provider never served the request), `model_response_loop` (it served it and [loop detection](/gg/loop-detection/) discarded every answer), `model_vision_unsupported`, `model_parse`, `model_timeout` (the call ran into gg's [per-call ceiling](/gg/execution-limits/#model-api-errors)), `model_length_capped` (the reply hit the provider's output cap and was [rejected whole](/gg/execution-limits/#model-api-errors)) |
| `transpile` | `transpile_syntax`, `transpile_compile` (the language's compiler read the whole program and rejected it), `transpile_unsupported` |
| `program_fault` | `program_api_error` (an uncaught failed call: the model is fighting the API rather than mis-writing it), `program_unknown_name` (it reached for something this run does not offer it, either a name that is not in scope or a call the host refused as `unavailable`), `program_throw` |
| `sandbox_limit` | `sandbox_timeout`, `sandbox_out_of_memory`, `sandbox_trap` |
| `missing_completion` | `missing_completion_no_call`, `missing_completion_compaction` (a prose reply where a compaction was pending, which is answered differently), `missing_completion_no_program` (a responses-as-code reply that made no `submit_program` call) |

:::caution[`transpile` is empty by construction for an eval-in-guest arm]
A [program language](/gg/languages/overview/) whose guest carries its own
interpreter, such as [Python](/gg/languages/python/), hands the model's source
straight to that interpreter, so nothing on gg's side reads the program and there
is no preparation step to fail. A Python `SyntaxError` is raised by CPython while
the program runs and lands in `program_fault` with every other uncaught
exception. Python therefore records zero `transpile` failures however badly its
programs are written, and its syntax errors are not separable in TCQ from a
runtime bug.

A slice on this base kind is therefore not a valid cross-arm comparison. Read
`transpile` as the programs this arm refused before running, which only an arm
with a host-side preparation step does.
:::

:::caution[`sandbox_limit` is a ceiling or a real trap, and some arms still trap on a throw]
A program owns its failures, and gg reads what the program's own runtime said
rather than intercepting the throw. An arm whose guest can see an uncaught
failure at its entry point reports it over `feedback.report-error` with the
failure's class, so an uncaught failed call is `program_api_error`, an unknown
name `program_unknown_name` and anything else `program_throw` — the same event
files the same way on every arm that reports. Python, Ruby, C++, TypeScript,
JavaScript and PureScript report; C# reports but with no code, so its failed
calls land in `program_throw`.

`sandbox_limit` is reserved for a ceiling gg imposed or a real wasmtime trap.
`sandbox_timeout` and `sandbox_out_of_memory` are the two ceilings;
`sandbox_trap` is a store that died — an explicit `exit`, a native fault the
runtime never saw, and, on the arms whose runtime kills the program before any
entry point can report it, an ordinary uncaught throw. Rust, Swift, Kotlin and
Java still file every uncaught throw, failed calls included, as `sandbox_trap`,
and a few shapes trap on otherwise-reporting arms: a native fault on C++, a
stack overflow on C++ and C#, an explicit exit on C++, C# and Python. A slice on
`program_fault` across arms therefore undercounts the trapping ones, and a slice
on `sandbox_trap` overcounts them. The
[per-arm table](/gg/languages/static-sdks/#the-turn-error-for-an-uncaught-refusal)
says which arm files which shape where, and `crates/gg/src/sandbox/language/g8.rs`
drives every cell of it.
:::

Every type's id names its base, because a "top error types" ranking shows one row
per type with no heading over it. Each also carries a human-readable label. The
labels live in Rust beside the variants and are generated into the TypeScript
contract, so a type gg gains arrives already labelled and gg's own `error` log
line names the failure in the same words the console does.

## The run rollup

Folded from those same events onto the session summary, so numerator and
denominator can never come from different mechanisms.

```jsonc
"errors": { "turns": 96, "errors": 4, "maxConsecutive": 2,
            "modelApi": 1, "transpile": 2, "programFault": 1,
            "sandboxLimit": 0, "missingCompletion": 0,
            "loopAborts": 7, "loopAbortWords": 21455,
            "loopAbortChars": 136150,
            "byType": { "model_response_loop": 1, "transpile_syntax": 2,
                        "program_api_error": 1 },
            "toolFailures": { "not-found": 12, "invalid-argument": 3 } }
```

`turns` is the denominator and counts every turn whatever its outcome, a `fatal`
one included, so the accounting stays whole even though no ceiling observes it.
`errors` is exactly the sum of the five per-kind counters. `maxConsecutive` is the
maximum over agents of the per-turn `consecutiveErrors` above, which is the only
honest way to summarise a per-agent counter on a run-wide record, and the peak of
the same counter `maxConsecutiveErrors` is enforced on.

No percentage is stored. The error rate is `errors / turns` and the reader
divides. A stored rate is a figure that can disagree with its own denominator
after a rounding change, a partially recorded run, or a reader that averages two
runs' rates, and the one thing that must be trustworthy here is that the numbers
add up.

`byType` is the same errors split by their specific type, keyed by the
`errorType` wire id. Two things hold: it sums to `errors`, and regrouping it by
each type's base reproduces the six named counters exactly. It is a map keyed by
a string rather than by the enum, so that a run recorded by a newer gg still
reads back in an older backend or console: an unknown enum key would fail the
whole summary, where an unknown string degrades to one unlabelled row in a
ranking. It is omitted from the wire when empty, which is exactly a run with no
errors.

`toolFailures` counts calls rather than turns: every dispatched tool call that
failed, by [class](/gg/telemetry/agent-surface/#failure-classes), whether or
not the program that made it caught the failure. It is a rollup of dispatches, so
a code-mode call that never reached a tool is not in it. Those are on the stream
as `api_result` with their class, where a console folds them. The summary's
top-level `toolCalls` counts every dispatched call, failed or not. It is the
denominator `toolFailures` is read against, so `toolCalls` minus the failures is
the count of calls that succeeded. It is omitted from the wire when zero, so a
reader must treat a summary with failures but no `toolCalls` as one whose total
was not recorded rather than as a contradiction.

A [rejected length-capped reply](/gg/execution-limits/#model-api-errors) is an
error turn here and is additionally recorded on its own terms: a
`response_rejected` event carries the reply's size, usage, cost and serving
provider, and the summary's `rejectedResponses` rollup sums the count, tokens
and cost. That spend is deliberately absent from the run's own usage and cost —
a degenerate generation must not make a run look expensive — so the rollup is
the one place it appears.

Two things are deliberately excluded from the error counts. A tool call that
failed inside a program that carried on is counted in `toolFailures` instead: the
program handled it, which is the point of the typed surface, and charging it
would make the one capability that expects failures the one that cannot survive
them. Per-agent attribution is excluded because these
are run-wide totals, and the per-agent breakdown lives on the stream, where every
`turn_outcome` rides on its own agent's id.

The console folds the same figures off the live stream for its Dashboard, beside
the turn count they share a denominator with, because "seven" and "seven of two
hundred" are not the same claim: errored turns, the rate they are of, the longest
streak, the replies [loop detection](/gg/loop-detection/) discarded when there
were any, and the most common error types with their counts, each row carrying
its base kind as a badge.
An errored turn renders no row of its own on the live event feed, since gg
already logs why a turn failed in the recorded type's vocabulary.

The whole summary is flattened into the
[query language](/gg/analysis/query-language/)'s document, so every field above is
directly queryable, including the open breakdowns, whose keys become fields of
their own.

```text
has.summary:true | stats avg(summary.errors.maxConsecutive) as streak by model
has.summary:true | stats sum(summary.errors.byType.program_api_error) as fights by model
```

## Provider attribution

A run's model calls may be served by different upstream providers — OpenRouter
names the serving provider on each response — and provider-specific failures are
only diagnosable from a record that says who served what. The summary therefore
carries `providerStats`: one slice per `(provider, model)` pair observed, folded
from the same stream as the rollups above.

```jsonc
"providerStats": [
  { "provider": "DeepInfra", "modelId": "qwen/qwen3.8-2.4t-a95b",
    "calls": 41, "tokens": { "uncachedInput": 63167, "output": 71310 },
    "cost": { "comparable": 0.70, "actual": 0.70 },
    "turns": 41, "working": 39, "errors": { "transpile_compile": 2 } }
]
```

Each slice records the calls that reported usage (`calls`, with their summed
tokens and cost), the length-capped replies the provider served (`rejected`),
and the turns attributed to it: `turns`, the `working` (progressed or finished)
turns among them, and an `errors` map keyed by the same `errorType` wire ids
`byType` uses. Two invariants hold: the slices' `turns` sum to `errors.turns`,
and a slice's `turns` minus `working` minus its error count is its fatal turns.

A turn is attributed to the provider named by its own call's `usage`, `prompt`
or `response_rejected` event. A call that produced no reply — a model timeout —
names no provider, so its turn lands on the slice with no `provider` key, as
does any call whose gateway named none. The `modelId` is the one the agent's
usage deltas named, so a turn before an agent's first usage report carries none.
The array is omitted from the wire when no call, turn or rejection was ever
folded into it.

## Ceilings

`limit_exceeded` is emitted once by each agent that stops on an
[execution ceiling](/gg/execution-limits/), immediately before its loop returns,
carrying which ceiling, what it was set to, what was observed, and after how many
turns. It is a structured event rather than only a log line, because "which
ceiling ends my runs, at what value?" is a question a study asks of thousands of
runs, and prose cannot be grouped by.
