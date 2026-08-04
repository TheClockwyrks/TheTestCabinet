---
title: "Loop detection"
---

Some models, on some turns, stop answering and start **cycling**. The reply is a program
for a few hundred tokens and then it is `void 0;`, over and over, one line at a time,
until the provider's own output cap ends it. It is not a wrong answer and not a refusal —
it is a *period*, and nothing in the reply will ever terminate it.

Loop detection is the guardrail for that shape: gg watches a reply **as it arrives** and
abandons one that has stopped being a reply. It is deliberately **off by default** and
armed per agent, because arming it also changes that agent's transport — see
[the transport it implies](#the-transport-it-implies).

## What a loop costs

Four things go at once, and only one of them is recoverable after the fact:

| Cost | Why it hurts |
| --- | --- |
| **The money** | Output tokens are the expensive side of a request, and a capped reply is the single largest one the provider will sell. |
| **The wall clock** | Tens of thousands of tokens take minutes, and the run's clock is the host's rather than the model's — a looping turn spends the [runtime budget](/gg/execution-limits/) as surely as productive work would. |
| **The turn** | The reply is not a program and not a tool call. Whatever the turn was for did not happen. |
| **The next turn** | The looping reply enters the context window, where it is the most recent and most repetitive thing the model can see — which makes the *following* turn more likely to do the same thing. A loop that is paid for is also a loop that is **reinforced**. |

The last one can be undone by a harness that reads completed replies: gg could refuse to
push it into the context. The first three cannot. By the time a buffering transport has a
reply in hand, every token in it has been generated and billed. That is the whole reason
this reads the stream rather than judging a finished response.

## The rule

> **A reply is looping when several distinct words have each been over-represented in the
> recent window for a long, unbroken stretch of the reply.**

Three terms, and each is doing a job no other one can:

- **Frequency** — a word occurring more than `repeatThreshold` times in the last
  `windowWords` is *over-represented*. Alone this is the naive rule, and it fires on any
  dense literal.
- **Breadth** — a single very common token (`the`, `0,`, a brace) is ordinary text; a loop
  repeats a whole **fragment**, and a fragment is more than one word, so it necessarily
  over-represents several words together. Requiring `minOffenders` of them at once is what
  tells a repeated *phrase* from a common *word*.
- **Persistence** — `minSaturatedRun` consecutive words must arrive while the window stays
  saturated. This is the term the detector actually turns on, and it gets its own section.

Everything is measured over a rolling window of the most recent `windowWords` words, kept
as 64-bit hashes rather than as the words themselves, so the detector's memory is
`windowWords × 8` bytes whatever the reply contains. Offender bookkeeping is
**incremental** — a counter is adjusted only when some word's count crosses the threshold
in one direction or the other — so the map is never scanned and the cost is O(1) per word
however long the reply runs.

## Why the sustained-run term exists

Frequency and breadth together fire on the most ordinary thing a model writes for a game:
a **tilemap literal**.

```ts
const level = [
  0, 0, 1, 0, 0, 2, 0, 0, 1, 0, 0, 0, 2, 0, 1, 0, 0, 0, 0, 1, 0, 0, 2, 0,
  // …fifteen hundred more entries…
];
```

Two or three tile ids each occupy a third of any window you look at. By the frequency rule
this is indistinguishable from a loop, and so is a long Markdown table, a colour palette, a
list of waypoints, a wave definition, a base64 blob.

What separates them is not *how* repetitive they are but **that they end**. Legitimate
repetitive data is a bounded region of a reply: the model writes its fifteen hundred tiles,
writes `];`, and carries on with the rest of the program. A loop has no such region,
because there is nothing after it to write. So the detector does not ask "is this stretch
repetitive?", which cannot be answered correctly — it asks **"has this stretch been
repetitive for longer than any real data literal could be?"**, which can.

The numbers are chosen against that question rather than tuned against a corpus. A 64×64
tilemap is 4,096 entries; the default sustained run of **3,000 words** sits at roughly a
55×55 map. The realistic 1,504-entry level in gg's own test corpus peaks at a saturated run
of **1,409** words against that ceiling — so a level about twice the size of a real one
would still be read as the data it is. That margin is the figure any future adjustment to
either number has to be weighed against.

Note what this buys and what it costs. The detector is **late by construction**: it lets
several thousand words of a loop through before it acts. That is the right trade. The reply
is already being abandoned at a small fraction of the output cap — the observed `void 0;`
shape trips 12,261 characters in, about 5% of the length backstop — and the alternative,
tripping early, is a detector that deletes the model's tilemap and reports a loop that never
happened.

### What `minSaturatedRun: 0` gives up

Zero is legal and means "trip the moment the window is both full and saturated" — the
unmodified frequency rule, with none of the paragraphs above. An operator who sets it is
choosing to **discard any reply containing a large data literal**, because such a reply is
not distinguishable from a loop by frequency and breadth alone. It exists because a study
measuring the frequency rule itself needs to be able to ask for it, and because a model
known to emit no literals at all can be watched more tightly. It is not the knob to reach
for when the defaults feel slow.

## What a word is

A word is a whitespace-separated run of characters, **terminated by whitespace and never
counted before it is**. An identifier that arrives split across three stream chunks is one
word rather than three, which is the whole reason the pending run is buffered instead of
each chunk being tokenised on its own. A reply's final partial word is therefore never
counted at all, and that costs nothing: a reply that ends is not looping. Indentation,
blank lines and the space after a newline contribute no words whatever.

A run that never terminates would otherwise be one unbounded word — a whitespace-free loop
(`a();a();a();…`) would defeat both the memory bound and the detection — so a pending run is
flushed as a word once it reaches **128 characters**. Such a "word" is a fixed-width slice
of the stream rather than a lexical word, and that is exactly what makes a periodic
whitespace-free loop detectable: a repeating period cut at a fixed width yields a small,
fixed set of slices that recur, which the frequency rule sees as ordinary offenders.

One consequence worth knowing before reading a negative result: a whitespace-free loop is
only detectable when its period does **not** divide the 128-character cap. A period that
divides it makes every cap-flushed slice identical, which is exactly one offender — and one
offender never meets the default `minOffenders: 2`. A six-character period (`void0;`) works
because 128 mod 6 is 2, so successive slices cycle through three distinct recurring strings.
128 is comfortably above any identifier, URL or base64 line a model writes as one run, so an
ordinary reply is tokenised lexically and this path never fires.

## The transport it implies

gg's ordinary model transport **buffers**: it posts the request, awaits the whole response
body, and parses it. A detector on that path could only ever judge a reply whose every cost
had already been paid. So arming loop detection for an agent also switches that agent onto
a **streaming** transport, and that is a change worth declaring rather than burying:

- The request carries `"stream": true` and `"stream_options": { "include_usage": true }`.
  The second is not optional garnish — it is what makes OpenRouter attach a usage block to
  the final chunk, and therefore what lets a streamed turn account its tokens and cost at
  all.
- Server-sent events are assembled by a **pure accumulator**: `data:` lines are parsed as
  `chat.completion.chunk` objects, `delta.content` is concatenated into the reply text,
  `delta.tool_calls[]` are assembled by their `index` with their `arguments` fragments
  concatenated, the first non-null `finish_reason` wins, and the `data: [DONE]` sentinel
  ends the read. Keep-alive comments (OpenRouter sends `: OPENROUTER PROCESSING`) and blank
  lines are ignored; a `data:` line that is neither the sentinel nor parseable JSON is an
  error rather than something to skip past.
- The two transports are held to producing **the same `ModelResponse`**, by a test that
  feeds the accumulator an SSE transcript one byte at a time and asserts equality against
  the buffered fixture it was split from.
- Status classification happens on the response **head**, before a single chunk is read, so
  a `4xx` refusal (including the recoverable image-unsupported one), a `5xx` and a transport
  failure are handled by exactly the same rules on both paths.

**An agent that does not arm loop detection sees no change at all** — same request body,
same buffered read, byte for byte. This is a per-agent lever precisely so a run whose root
runs on a model that loops does not pay the streaming path for a reviewer that does not.

### What the detector is shown, and what it is not

The detector is fed `delta.content` and nothing else — not the SSE framing, not the JSON
escaping, and **not tool-call arguments**. That is a real limit and worth stating plainly: a
model that loops *inside* a tool call's `arguments` — a `write_file` whose contents repeat
forever — is caught by **neither** rule, since both the window and the length backstop are
measured over that same content stream, and is bounded only by the provider's own output
cap.

The exclusion is right anyway. Arguments arrive as a JSON string, so the detector would be
judging escaped, quoted fragments rather than the model's words, and the defect this exists
for is a [responses-as-code](/gg/responses-as-code/) program, which arrives as `content`.

## What happens on a trip

A trip is treated **exactly as an HTTP 5xx is**, inside the model client's existing retry
loop:

1. The response is **dropped unread**. The connection closes and the provider stops sending;
   gg neither reads nor pays for the remainder.
2. The failure is recorded, the client backs off, and it asks again. A fresh detector is
   built per **attempt**, not per turn, so words from a discarded reply can never condemn its
   replacement.
3. The retry usually answers properly, and the turn proceeds on that answer. The looping
   reply is never streamed as an assistant message, never enters the context window, and
   never appears in the [replay record](/gg/analysis/replay-records/), which journals the
   response a turn was *given*. Only its count survives — which is correct, because a
   replayed run must re-drive the turn the model actually got.
4. The turn logs one `warn` naming what was thrown away:

```text
loop detection discarded 2 looping model responses on turn 14 before one completed;
gg paid for every one of them and none of them entered the context.
```

If **every** attempt loops, the turn fails — and it fails under its own name rather than as
a generic exhausted retry, because "retries exhausted" would send an operator looking at the
provider for an outage that never happened:

```text
model turn 14 failed — generation loop (every attempt looped): model looped:
2 words repeated across 3000 consecutive words, 3065 words into the reply
(3065 words, 12261 characters read before it was abandoned); discarded 4 response(s)
```

That ends the session with the terminal status `model_error`, on exactly the same terms
[a failed model call always has](/gg/execution-limits/#a-model-api-error-is-still-fatal),
and the turn is recorded with the error kind `model_api`. There is deliberately no
`response_loop` **error kind**: by the time a loop reaches the turn loop it is a model-client
failure after that client exhausted its own budget, indistinguishable at that seam from any
other, and a kind nothing could distinguish would be a bucket in every console and every
aggregation that is permanently zero. What *is* distinguished is the count of discarded
replies, which is the figure worth acting on.

The [replay record](/gg/analysis/replay-records/) does keep that failure, as a recorded
model error of kind `response_loop` carrying how many replies were discarded — because
unlike a discarded attempt, a turn that *failed* is a turn a replayed run has to reproduce.

## Configuring it

Loop detection is a **per-agent** setting on an agent [profile](/gg/configurations/#agents),
beside its [prompt-cache lifetime](/gg/configurations/#prompt-cache-lifetime) — not a
capability, and pointedly not a [responses-as-code](/gg/responses-as-code/) param, because a
tool-calling model loops in exactly the same way.

```jsonc
{
  "name": "Implementer",
  "modelSlot": "primary",
  "loopDetection": { "enabled": true },
  "capabilities": [ /* … */ ]
}
```

`{ "enabled": true }` is the whole ordinary declaration; every knob below is optional and an
absent one takes gg's default. A profile that never touched the setting omits the key
entirely, so every configuration stored before loop detection existed round-trips byte for
byte.

### The knobs

| Key | Default | What it does |
| --- | --- | --- |
| `enabled` | `false` | Whether the detector runs for this agent at all — and therefore whether this agent streams. |
| `windowWords` | `256` | `N`, the lookback the frequency rule is measured over. Wide enough that a genuinely repeated phrase repeats several times inside it; narrow enough that a region of a long reply is judged on its own terms rather than diluted by the thousands of ordinary words around it. Also the minimum sample: the repetition rule cannot fire until the window has actually observed `N` words. |
| `repeatThreshold` | `32` | `P`. A word is an offender at **strictly more** than `P` occurrences in the window — one word occupying more than an eighth of the default window. Ordinary prose puts its commonest word at around 6% of a passage, so this is several times above anything a reply that is *saying something* reaches, while a two-word period saturates it after 66 words. |
| `minOffenders` | `2` | `M`, how many distinct offenders make the window *saturated*. Two is the smallest number that expresses "a phrase, not a word"; raising it mainly delays detection of short periods. |
| `minSaturatedRun` | `3000` | `R`, how many consecutive words must arrive while the window stays saturated. [The term that does the work](#why-the-sustained-run-term-exists). `0` is the plain frequency rule. |
| `maxResponseChars` | `250000` | The hard length backstop, for a runaway that is not *repetitive* enough to trip the window rule — a model generating novel garbage rather than a period. Well above any legitimate reply (a 2,000-line program is around 60,000 characters) and well below a provider's output cap. `0` turns it off. |

In the [configuration editor](/gg/configurations/) it is a per-agent fieldset, in the same
place the prompt-cache lifetime is: a switch that arms it plus the five knobs, each left
empty to take gg's default.

### Resolution is total

An unusable knob **warns and launches**, never fails — the same rule the
[execution ceilings](/gg/execution-limits/#configuring-them) are resolved under, and for the
same reason: a sweep's one shared configuration document has to stay interpretable by every
arm.

| Declaration | Resolves to | Warning |
| --- | --- | --- |
| `loopDetection` absent, or `enabled: false` | detector **off**; the agent keeps the buffering transport | — |
| `enabled: true` with no knobs | gg's defaults | — |
| `windowWords: 0` | `256` | a window of no words has nothing to look back over |
| `repeatThreshold: 0` | `32` | every word would count as an offender, so no reply could be told apart from a loop |
| `minOffenders: 0` | `2` | a window with no offenders in it would count as saturated |
| `minOffenders` > `windowWords` | **armed as declared** | the window cannot hold that many distinct words, so only the length backstop can fire |
| `minSaturatedRun: 0` | `0` — the plain frequency rule | — |
| `maxResponseChars: 0` | the backstop is **off** | — |

The two zeroes that are not warned about are the two that **mean** something. The cross-knob
row is warned about but armed rather than defaulted, on the same terms
`errorRateWindow ≥ maxTurns` is: which of the two knobs the operator meant is not knowable,
and silently replacing one of them would hide the mistake rather than report it. A
declaration with `enabled: false` produces no warnings at all whatever its knobs say —
nothing is going to read them, and a warning about a value that will never be used is noise
in the one log an operator reads to find out what a run was configured to do.

Warnings are named with the agent that declared them (``agent `Implementer`: …``), because a
configuration with eight profiles gives an unattributed warning nowhere to land.

## Reading it

A run whose root has the detector armed names its configuration once, at launch, beside the
[ceilings](/gg/execution-limits/) and the [healing](/gg/response-healing/) set:

```text
loop detection: armed — a reply is abandoned after 3000 consecutive words during which
2 or more words have each occurred more than 32 times in the last 256, or once it passes
250000 characters
```

There is deliberately **no disarmed spelling**, which is the opposite of the choice
[healing's launch line](/gg/response-healing/#metrics) makes — and the difference is that
this setting is already recorded where a study reads it. The detector lives on the agent
profile, and the profile is part of the [capability set the run records](/gg/configurations/),
so the two arms of a loop-detection ablation are distinguishable in the durable data whether
or not anything was ever discarded. The launch line is an operator's convenience, not the
record, so a run that armed nothing has nothing to say.

Per **turn**, on the [`turn_outcome`](/gg/telemetry/#how-a-turn-ended) event:

```jsonc
{ "type": "turn_outcome", "outcome": "progressed",
  "consecutiveErrors": 0, "turns": 14,
  "loopAborts": 2 }                    // omitted when zero
```

This is the **one** place discarded attempts are published. A discarded attempt is never a
turn of its own — it produced nothing and the request was retried — so it has no event to be
counted on; carrying the count on the turn that eventually succeeded keeps it on the stream
without inventing an event for a reply that does not exist.

Per **run**, on the session summary's [error rollup](/gg/telemetry/#the-run-rollup):

```jsonc
"errors": { "turns": 96, "errors": 4, "maxConsecutive": 2,
            "modelApi": 1, "transpile": 2, "programFault": 1,
            "sandboxLimit": 0, "missingCompletion": 0,
            "loopAborts": 7 }
```

`loopAborts` is a plain sum over every turn's count, and it is **not** an error count: a
discarded attempt whose retry succeeded cost money and wall clock but did not fail a turn. It
is counted because that cost is exactly what this guardrail exists to bound, and the figure
is what says whether arming it was worth it. It is `0` for every run whose agents all left the
detector disarmed, which is the default.

Both are queryable through the [query language](/gg/analysis/query-language/), since the whole
summary is flattened:

```text
has.summary:true | stats sum(summary.errors.loopAborts) as aborts by model
```

answers "which models are looping, and how much am I paying for it?" across every recorded
run.

## What it deliberately does not do

- **It does not tell the model.** Nothing about a discarded reply reaches the context window,
  in the prompt or in turn feedback — for the same reason a
  [ceiling](/gg/execution-limits/) is never announced. A model told that its replies are
  being watched for repetition behaves differently *because it was told*, which confounds the
  measurement.
- **It does not repair.** [Healing](/gg/response-healing/) deletes text from a reply and runs
  what is left; this deletes the whole reply and asks again. A half-generated loop is not a
  program with a repetitive tail — it is a reply that never reached its end, and running its
  prefix would be running something the model never finished writing.
- **It does not judge a completed reply.** There is no post-hoc mode. Reading a finished
  response would be free to implement and would recover only the fourth of the
  [four costs](#what-a-loop-costs); the other three are the reason the feature exists.
- **It does not bound the run.** A run in which every turn loops once and then succeeds on
  the retry costs roughly double and finishes normally — and no
  [error ceiling](/gg/execution-limits/) sees it, because none of those turns failed. Only
  `maxCost` and `maxRuntimeSecs` bound that shape. `summary.errors.loopAborts` is what tells
  you it is happening, and setting one of those two is the answer.
