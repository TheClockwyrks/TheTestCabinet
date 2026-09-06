---
title: "Loop detection"
---

Some models, on some turns, stop answering and start cycling: the reply is a
program for a few hundred tokens and then it is `void 0;`, over and over, until
the provider's own output cap ends it. Loop detection watches a reply as it
arrives and abandons one that has become a repetition. It is armed per agent,
because arming it also moves that agent onto a
[streaming transport](#the-transport-it-implies).

A loop costs four things at once, and only the last of them can be recovered
after the fact.

- The money. Output tokens are the expensive side of a request, and a capped
  reply is the largest one the provider will sell.
- The wall clock. Tens of thousands of tokens take minutes, and the run's clock
  belongs to the host rather than the model.
- The turn. The reply is neither a program nor a tool call, so whatever the turn
  was for did not happen.
- The next turn. The looping reply enters the context window as the most recent
  and most repetitive thing the model can see, which makes the following turn
  more likely to do the same thing.

A harness that reads completed replies can refuse to push the last one into the
context. The first three are already paid by the time a buffering transport has
the reply in hand, which is why the detector reads the stream.

## The rule

> A reply is looping when several distinct words have each been
> over-represented in the recent window for a long, unbroken stretch of the
> reply.

Three terms, each doing a job no other one can.

- Frequency. A word occurring more than `repeatThreshold` times in the last
  `windowWords` is over-represented. Alone this is the naive rule, and it fires
  on any dense literal.
- Breadth. A single very common token (`the`, `0,`, a brace) is ordinary text,
  while a loop repeats a whole fragment, and a fragment is more than one word.
  Requiring `minOffenders` of them at once tells a repeated phrase from a common
  word.
- Persistence. `minSaturatedRun` consecutive words must arrive while the window
  stays saturated. This is the term that separates a loop from a data literal.

Everything is measured over a rolling window of the most recent `windowWords`
words, kept as 64-bit hashes rather than as the words themselves, so the
detector's memory is `windowWords × 8` bytes whatever the reply contains.
Offender bookkeeping is incremental: a counter is adjusted only when some word's
count crosses the threshold in one direction or the other, so the map is never
scanned and the cost is O(1) per word however long the reply runs.

## The sustained-run term

Frequency and breadth together fire on the most ordinary thing a model writes
for a game, a tilemap literal.

```ts
const level = [
  0, 0, 1, 0, 0, 2, 0, 0, 1, 0, 0, 0, 2, 0, 1, 0, 0, 0, 0, 1, 0, 0, 2, 0,
  // …fifteen hundred more entries…
];
```

Two or three tile ids each occupy a third of any window. By the frequency rule
that is indistinguishable from a loop, and so is a long Markdown table, a colour
palette, a list of waypoints, a wave definition or a base64 blob.

What separates them is that they end. Legitimate repetitive data is a bounded
region of a reply: the model writes its fifteen hundred tiles, writes `];`, and
carries on with the rest of the program. A loop has no such region, because
there is nothing after it to write. So the detector asks whether a stretch has
been repetitive for longer than any real data literal could be.

The numbers are chosen against that question. A 64×64 tilemap is 4,096 entries,
and a sustained run of 3,000 words sits at roughly a 55×55 map. The
realistic 1,504-entry level in gg's own test corpus peaks at a saturated run of
1,409 words against that ceiling, so a level about twice the size of a real one
is still read as the data it is. That margin is what any adjustment to either
number has to be weighed against.

The detector is late by construction: it lets several thousand words of a loop
through before it acts. The reply is still abandoned at a small fraction of the
output cap, and the observed `void 0;` shape trips 12,261 characters in, about
5% of the length backstop. Tripping earlier would delete the model's tilemap and
report a loop that never happened.

`minSaturatedRun: 0` is legal and means "trip the moment the window is both full
and saturated", the unmodified frequency rule. An operator who sets it is
choosing to discard any reply containing a large data literal, because such a
reply is not distinguishable from a loop by frequency and breadth alone. It
exists for a study measuring the frequency rule itself, and for a model known to
emit no literals at all.

## What a word is

A word is a whitespace-separated run of characters, terminated by whitespace and
never counted before it is. An identifier that arrives split across three stream
chunks is one word rather than three, which is why the pending run is buffered
instead of each chunk being tokenised on its own. A reply's final partial word
is therefore never counted, which costs nothing: a reply that ends is not
looping. Indentation, blank lines and the space after a newline contribute no
words.

A run that never terminates would otherwise be one unbounded word, and a
whitespace-free loop (`a();a();a();…`) would defeat both the memory bound and
the detection. A pending run is therefore flushed as a word once it reaches 128
characters. Such a word is a fixed-width slice of the stream rather than a
lexical word, and that is what makes a periodic whitespace-free loop detectable:
a repeating period cut at a fixed width yields a small, fixed set of slices that
recur, which the frequency rule sees as ordinary offenders.

One consequence is worth knowing before reading a negative result. A
whitespace-free loop is detectable only when its period does not divide the
128-character cap. A period that divides it makes every cap-flushed slice
identical, which is exactly one offender, and one offender never meets the
`minOffenders` of 2. A six-character period (`void0;`) works because 128
mod 6 is 2, so successive slices cycle through three distinct recurring strings.
128 is comfortably above any identifier, URL or base64 line a model writes as
one run, so an ordinary reply is tokenised lexically and this path never fires.

## The transport it implies

gg's ordinary model transport buffers: it posts the request, awaits the whole
response body, and parses it. A detector on that path could only judge a reply
whose every cost had already been paid. Arming loop detection for an agent
therefore switches that agent onto a streaming transport.

- The request carries `"stream": true` and
  `"stream_options": { "include_usage": true }`. The second is what makes
  OpenRouter attach a usage block to the final chunk, and therefore what lets a
  streamed turn account its tokens and cost.
- Server-sent events are assembled by a pure accumulator. `data:` lines are
  parsed as `chat.completion.chunk` objects, `delta.content` is concatenated
  into the reply text, `delta.tool_calls[]` are assembled by their `index` with
  their `arguments` fragments concatenated, the first non-null `finish_reason`
  wins, and the `data: [DONE]` sentinel ends the read. Keep-alive comments
  (OpenRouter sends `: OPENROUTER PROCESSING`) and blank lines are ignored, and
  a `data:` line that is neither the sentinel nor parseable JSON is an error.
- The two transports produce the same `ModelResponse`, held there by a test that
  feeds the accumulator an SSE transcript one byte at a time and asserts
  equality against the buffered fixture it was split from.
- Status classification happens on the response head, before a single chunk is
  read, so a `4xx` refusal (including the recoverable image-unsupported one), a
  `5xx` and a transport failure are handled by the same rules on both paths.

An agent that leaves loop detection disarmed keeps the buffered read and the
same request body. This is a per-agent lever so that a run whose root runs on a
model that loops does not pay the streaming path for a reviewer that does not.

The detector is fed `delta.content` and nothing else: not the SSE framing, not
the JSON escaping, and not tool-call arguments. A model that loops inside a tool
call's `arguments` is caught by neither rule, since both the window and the
length backstop are measured over that same content stream, and is bounded only
by the provider's own output cap. Arguments arrive as a JSON string, so the
detector would be judging escaped, quoted fragments rather than the model's
words, and the defect this exists for is a
[responses-as-code](/gg/responses-as-code/overview/) program, which arrives as
`content`.

## What happens on a trip

A trip is treated exactly as an HTTP 5xx is, inside the model client's existing
retry loop.

1. The response is dropped unread. The connection closes and the provider stops
   sending, so gg neither reads nor pays for the remainder.
2. The failure is recorded, the client backs off, and it asks again. A fresh
   detector is built per attempt rather than per turn, so words from a discarded
   reply can never condemn its replacement.
3. The retry usually answers properly and the turn proceeds on that answer. The
   looping reply is never streamed as an assistant message, never enters the
   context window, and never appears in the
   [session record](/gg/analysis/session-records/), which journals the response
   a turn was given. What survives it is a count and a size.
4. The turn logs one `warn` naming what was thrown away:

```text
loop detection discarded 2 looping model responses on turn 14 before one completed,
throwing away 6130 words of generated output (38900 characters); it was all paid for
and none of it entered the context.
```

If every attempt loops, the turn fails under its own name rather than as a
generic exhausted retry, because "retries exhausted" would send an operator
looking at the provider for an outage that never happened:

```text
model turn 14 failed — model looped every attempt: model looped: 2 words repeated
across 3000 consecutive words, 3065 words into the reply (3065 words, 12261
characters read before it was abandoned); discarded 4 response(s) totalling 49044
characters of generated output
```

That ends the session with the terminal status `model_error`, on the terms
[a failed model call always has](/gg/execution-limits/#model-api-errors). The
turn is recorded with the base error kind `model_api` and the error type
`model_response_loop`. What is worth acting on beyond that is how many replies
were discarded and how much they generated.

The [session record](/gg/analysis/session-records/) keeps the failure as a
recorded model error of kind `response_loop` carrying how many replies were
discarded. Unlike a discarded attempt, a turn that failed is a turn that changed
the run.

## Configuring it

Loop detection is a per-agent setting on an agent
[profile](/gg/configurations/#agents), beside its
[prompt-cache lifetime](/gg/configurations/#prompt-cache-lifetime). It is not a
capability and not a responses-as-code param, because a tool-calling model loops
in the same way.

```jsonc
{
  "id": "implementer",
  "name": "Implementer",
  "modelSlot": "primary",
  "loopDetection": {
    "enabled": true,
    "windowWords": 256,
    "repeatThreshold": 32,
    "minOffenders": 2,
    "minSaturatedRun": 3000,
    "maxResponseChars": 250000,
  },
  "capabilities": [
    /* … */
  ],
}
```

An armed detector writes all five knobs. What the rule trips on is the whole
five-way relationship between a window, a threshold, a breadth, a run length and
a backstop, so a detector armed on figures nobody chose measures gg rather than
the model.

| Key                | What it does                                               |
| ------------------ | ---------------------------------------------------------- |
| `enabled`          | Whether the detector runs, and whether the agent streams.  |
| `windowWords`      | `N`, the lookback the frequency rule is measured over.     |
| `repeatThreshold`  | `P`, occurrences in the window above which a word offends. |
| `minOffenders`     | `M`, distinct offenders that make the window saturated.    |
| `minSaturatedRun`  | `R`, consecutive words that must arrive while saturated.   |
| `maxResponseChars` | A hard ceiling on reply length. `0` turns it off.          |

The figures in the snippet above are what the console seeds a freshly armed
detector with, and they are the figures the rest of this page reasons about. An
operator keeps or edits them, and gg runs on whatever the profile carries.

`windowWords` is also the minimum sample: the repetition rule cannot fire until
the window has observed `N` words. It is wide enough that a genuinely repeated
phrase repeats several times inside it, and narrow enough that a region of a
long reply is judged on its own terms rather than diluted by the thousands of
ordinary words around it.

A word is an offender at strictly more than `repeatThreshold` occurrences, which
at 32 in a window of 256 is one word occupying more than an eighth of the window.
Ordinary prose puts its commonest word at around 6% of a passage, so that is
several times above anything a reply that is saying something reaches, while a
two-word period saturates it after 66 words. `minOffenders` of 2 is the smallest
number that expresses "a phrase, not a word", and raising it delays detection of
short periods. `maxResponseChars` is the backstop for a runaway that generates
novel garbage rather than a period; a 2,000-line program is around 60,000
characters.

In the [configuration editor](/gg/configurations/) it is a per-agent fieldset,
in the same place as the prompt-cache lifetime: a switch that arms it plus the
five knobs, which arming fills in.

A knob missing from an armed detector refuses the launch. A knob that is present
is read exactly as written, and one gg cannot arm that way refuses the launch, on
the same terms the [execution
ceilings](/gg/execution-limits/#configuring-them) are resolved under. A knob is
judged as written whether or not the detector is armed.

| Declaration                                                 | Result                                                           |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `loopDetection` absent, or `enabled: false`                 | detector off, transport buffered                                 |
| `enabled: true` missing any of the five knobs               | refused                                                          |
| `minSaturatedRun: 0`                                        | `0`, the plain frequency rule                                    |
| `maxResponseChars: 0`                                       | the backstop is off                                              |
| `minOffenders` > `windowWords`                              | armed as declared, warned that only the length backstop can fire |
| `windowWords: 0`, `repeatThreshold: 0` or `minOffenders: 0` | refused                                                          |
| a knob gg cannot read as the number it is                   | refused                                                          |

The two zeroes in the table are the two that mean something. The cross-knob row
is armed rather than refused, on the same terms `errorRateWindow` ≥ `maxTurns`
is: which of the two knobs the operator meant is not knowable, and gg arms
exactly what the declaration says.

A refusal and a warning are both named with the agent that declared the knob
(``agent `Implementer`: …``), because a configuration with eight profiles gives
an unattributed message nowhere to land.

## Reading it

A run whose root has the detector armed names its configuration once, at launch,
beside the [ceilings](/gg/execution-limits/):

```text
loop detection: armed — a reply is abandoned after 3000 consecutive words during which
2 or more words have each occurred more than 32 times in the last 256, or once it passes
250000 characters
```

A run that armed nothing logs no line. The detector lives on the agent profile,
and the profile is part of the [capability set the run records](/gg/configurations/),
so the two arms of a loop-detection comparison are distinguishable in the
durable data whether or not anything was ever discarded.

Per turn, on the [`turn_outcome`](/gg/telemetry/turn-outcomes/) event:

```jsonc
{
  "type": "turn_outcome",
  "outcome": "progressed",
  "consecutiveErrors": 0,
  "turns": 14,
  "loopAborts": 2, // omitted when zero
  "loopAbortWords": 6130,
  "loopAbortChars": 38900,
}
```

This is the one place discarded attempts are published. A discarded attempt is
never a turn of its own, so it has no event of its own; carrying the three
figures on the turn that eventually succeeded keeps them on the stream without
inventing an event for a reply that does not exist.

Per run, on the session summary's
[error rollup](/gg/telemetry/turn-outcomes/#the-run-rollup):

```jsonc
"errors": { "turns": 96, "errors": 4, "maxConsecutive": 2,
            "modelApi": 1, "transpile": 2, "programFault": 1,
            "sandboxLimit": 0, "missingCompletion": 0,
            "loopAborts": 7, "loopAbortWords": 21455,
            "loopAbortChars": 136150 }
```

Each is a plain sum over every turn's figure, and none of them is an error
count: a discarded attempt whose retry succeeded cost generation and wall clock
without failing a turn. `loopAborts` says how often the model looped, and the
two sizes say how much generation it cost to find out. All three are `0` for
every run whose agents left the detector disarmed.

All are queryable through the [query language](/gg/analysis/query-language/),
since the whole summary is flattened:

```text
has.summary:true | stats sum(summary.errors.loopAbortChars) as thrown by model
```

That answers "which models are looping, and how much generation am I paying for
across every recorded run?"

## What the discarded output costs

A reply that was generated is billed whether or not anybody reads it, so the
tokens behind those characters are on the provider's invoice. They are absent
from the run's recorded cost and token counts, by ruling: a looping reply is a
model defect, and a run must not be made to look expensive for one.

gg publishes the size in words and characters, and publishes no token count and
no price for it. Cost and tokens come from the provider's usage payload, which
arrives at the end of a stream that was deliberately never read to its end, so
there is no measurement to report and an estimate would sit where every
neighbouring figure is measured. Words and characters are what the detector
counted itself as the reply streamed.

The run's [cost ceiling](/gg/execution-limits/) is measured against the recorded
cost and therefore never sees this output either. A run whose every turn loops
once and then succeeds spends roughly double at the provider while staying well
inside a ceiling, which is why `loopAbortChars` is the figure that says it is
happening.

## Boundaries

- The model is told nothing. Nothing about a discarded reply reaches the context
  window, in the prompt or in turn feedback, for the same reason a
  [ceiling](/gg/execution-limits/) is never announced: a model told that its
  replies are being watched for repetition behaves differently because it was
  told, which confounds the measurement.
- It repairs nothing: it deletes the whole reply and asks again. A
  half-generated loop is a reply that never reached its end, and running its
  prefix would be running something the model never finished writing.
- It judges only a reply in flight. Reading a finished response would recover
  only the fourth of the four costs above.
- It bounds a reply rather than a run. A run in which every turn loops once and
  then succeeds on the retry costs roughly double at the provider and finishes
  normally, and no [error ceiling](/gg/execution-limits/) sees it, because none
  of those turns failed. Only `maxRuntimeSecs` bounds that shape, and
  `summary.errors.loopAborts` with the two sizes beside it is what says it is
  happening.
