---
title: "Response healing"
---

Under [responses as code](/gg/responses-as-code/overview/) a model's whole reply
is the program. Models break that contract in a few measured ways. They wrap the
program in a Markdown fence, they glue a sentence onto the closing fence, and
they explain themselves above and below the code. A provider may also return a
completion that is the program followed by a byte-identical copy of itself.

Healing is the pass that turns those replies into the program the model meant.
It repairs only shapes it can prove are safe to delete, and it counts every
repair on the run, so "how often did this model still send a fence?" is a figure
a study can group by.

Healing tells the model nothing. A repaired reply is simply the reply that runs.
The repairs are reported to the operator on the run's stream and recorded in the
run's telemetry.

## Where healing sits

```text
the model's reply
        │
        ▼
   heal(reply, config, dialect)      text repair
        │
        ▼
   prepare ──▶ instantiate ──▶ run   syntax, then execution
```

Every reply travels the whole way. Healing asks no question about whether a
reply is a program: that question belongs to the program language's prepare
step, which answers it with a located compiler diagnostic over the model's own
text. An empty reply becomes an empty program that runs and does nothing. A
reply that is two programs pasted together fails to compile with the
redeclaration error the compiler itself reports. A reply of prose fails to
compile too, and the model is shown that error.

`heal` is a pure function of the reply, the resolved configuration and the
language's dialect. It performs no I/O, reads no clock, and imports nothing from
the sandbox, so turning a strategy off changes only what one function returns.

The assistant message gg records for the turn is governed by the
`assistantMessages` param rather than by healing. Its default records the reply
the model sent, so the transcript answers "did this model still emit a fence?"
alongside the counters.

## Canonicalisation

A byte-order mark, the blank lines before the first content line and trailing
whitespace are removed on the way in. A program that differs from another only
in those is the same program, so this is canonicalisation rather than repair and
nothing is counted.

The indentation of the first content line is kept. Four spaces of indentation
make an indented code block rather than a fence, so removing that indent would
answer the question the fence scanner exists to ask. What is left of a block's
indentation once a wrapper comes off is the dedent's business.

## The delete-only invariant

> **Healing only ever deletes.** Every strategy removes contiguous text, and the
> two that unwrap something additionally remove the indentation the body's lines
> share. No strategy inserts a character, moves a line, rewrites a token in
> place, or reorders anything. Therefore the healed program, with whitespace
> removed, is a subsequence of the response with whitespace removed.

That one sentence covers both "never invents code" and "never reorders". It is
enforced as a property test over the whole fixture corpus, under every one of
the eight configurations.

Because it compares only non-whitespace characters, it says nothing about
indentation, so unwrapping carries a second invariant:

> **Unwrapping moves every line by the same indent.** After `strip-fences` and
> `strip-prose`, there is a single indent that, put back in front of every
> non-blank line of the program, yields a line the model really sent.

One indent for all of them means the block moved; two would mean gg misaligned
it. The distinction is invisible in a language that ignores leading whitespace
and is a syntax error in one where indentation is punctuation, so it is asserted
separately.

Where a strategy cannot apply cleanly it declines silently, leaving the text
exactly as it was. The asymmetry is deliberate: a missed repair costs one turn
and a located diagnostic, while a wrong repair deletes the model's work.

## The pipeline

The strategies run in this order, repeated to a fixpoint:

```text
trim  ->  [ strip-fences -> strip-prose -> drop-doubled-response ]*
            ^                                                  |
            +------ repeat until a pass applies nothing -------+
```

Fences come first, because until the wrapper is off, "is this line prose?" is a
question about the wrong text. `strip-prose` says so itself and declines while a
fenced block survives. `drop-doubled-response` comes last, because the doubling
it recognises is a property of the whole text and the other two change what the
whole text is. A fence around a doubled body becomes a doubling the moment the
fence comes off, and going last is what lets the same pass see it.

The loop runs to a fixpoint because a pass's output is what the next pass reads.
A fence nested inside a fence is one wrapper per pass and needs two. A doubled
reply whose halves are each a fenced program offers `strip-fences` two
candidates, so it declines until `drop-doubled-response` halves the reply at the
end of the pass and leaves the single block the next pass unwraps.

The fixpoint is bounded at four passes, one of which is spent observing that
nothing changed. If the bound is reached, every repair is discarded, the reply
runs exactly as it was sent, the run logs a `warn`, and the turn's record
carries `didNotConverge`. An untouched program beside an empty repair list is
otherwise byte-identical to a clean response.

## strip-fences

Matches a Markdown code fence wrapping the program, tagged or not, closed
properly, closed with prose glued to the closing line, or never closed. Rewrites
the reply to the body of the one candidate block, dedented. Everything outside
the fences goes.

The scan implements CommonMark's fence rules rather than searching for the next
run of three backticks. A program routinely contains a fenced block, and a model
writing one opens its program with a longer fence. So the opening fence's length
is recorded, both fences must start their own line, and a closing fence must be
at least as long as the opening one. Three shapes are accepted beyond a
well-formed pair, and none of them touches the length rule.

| Shape | What the scanner does |
| --- | --- |
| the glued open — prose and the next fence on one line | opens a block when the text before the run is neither blank nor certainly code; that text becomes an outside line |
| the glued close — a closing run with text after it | closes the block as `glued`; the trailing text becomes an outside line |
| end of input with a block open | closes it as `unterminated` and runs what it holds |

Candidacy is a three-tier ladder, and the first non-empty tier wins: blocks
tagged with one of this language's program tags; otherwise blocks with no tag;
otherwise blocks whose unrecognised tag is anything else and whose body contains
a line that is certainly code. The tag list is a closed, recognised list, since
a block tagged `json`, `text`, `bash` or `md` is context the model showed. Tier
3 is what keeps that closed list from trapping a lone block tagged something gg
has never heard of.

The decline ladder is part of the specification:

| # | Condition | Result |
| --- | --- | --- |
| D1 | no blocks at all | not applicable; nothing recorded |
| D2 | two or more candidates | decline; picking one would delete a program the model wrote |
| D3 | exactly one candidate, but a line outside the fences is certainly code | decline; unwrapping would delete real code |
| D4 | zero candidates | decline |
| — | otherwise | unwrap to the single candidate's body, dedented |

The body is dedented rather than trimmed. CommonMark lets an opening fence carry
up to three spaces, and models routinely indent a whole block under a lead-in.
Trimming would put line 1 at the margin and leave every line after it where the
model had it, so the indentation every line shares is removed from all of them
instead and the block's internal shape survives.

D2 leaves the reply exactly as the model sent it and compiles it, so what comes
back is the compiler's error over the model's own text. Counting how many
programs a reply contains is an analysis of the text, and the only analysis this
pipeline performs is the one it can prove is a safe deletion.

D3 asks about every line outside the fences, above the block and below it. What
tells a fence inside a program from a fence around one is whether real code
survives outside it, and a model that fences the working half of its program and
writes its ending call underneath has written one program across a fence. An
unwrap keeps only the candidate's body and reports which blocks it left alone,
so unwrapping there would delete the ending and never say so. The narrowness
lives in the code predicate instead, where only shapes English lacks count as
code.

Blocks left where they were are counted, and so is how many of those contained a
code-shaped line. The second count is the one shape where "gg removed a wrapper"
understates what happened, most often a three-backtick program that itself
writes Markdown and whose inner fence closed the outer block early.

## strip-prose

Matches contiguous runs of certainly-prose lines at the start and the end of the
text, and nowhere else: the longest leading run in which every non-blank line is
certainly prose and at least one line is, and symmetrically at the end. The
middle is never touched. What it keeps is dedented, for the reason an unwrapped
fence is.

It declines at the first line that is not certainly prose, without scanning past
it. It declines while the text still holds a fenced block, since its
precondition is a program with prose around it. It declines when removal would
leave nothing at all: a reply that is prose from end to end has no program under
the explanation, and it goes to the language's prepare step as the model wrote
it.

The prose test is deliberately severe, and each language's dialect defines it.
Measured replies produced no bare programs with prose around them, since every
model fenced, so a strategy with no evidence behind it takes the setting where a
false positive costs one turn.

## drop-doubled-response

Matches a reply that is one completion concatenated with a byte-identical copy
of itself. Let `t` be the text with trailing whitespace trimmed: when `t.len()`
is even and `t[..t.len()/2] == t[t.len()/2..]`, it rewrites to the first half.

```text
"foo();\nbar();foo();\nbar();"   ->   "foo();\nbar();"
```

The comparison is of exact bytes. Whitespace is not normalised, line structure
is not consulted, and no token is parsed, because the defect is a byte-exact
concatenation performed by the transport. An inexact near-doubling is the
model's own text and goes to the language's prepare step as it arrived.

| # | Condition | Result |
| --- | --- | --- |
| D1 | `t` has odd length | decline; a string of odd length cannot be `X + X` |
| D2 | the midpoint is not a character boundary | decline; panic-safety, since slicing a multi-byte sequence down the middle panics |
| D3 | the halves differ in any byte | decline |
| D4 | the half is empty | decline; the only size floor there is |
| — | otherwise | keep the first half |

D2 is panic-safety rather than a heuristic, and it excludes nothing a rule would
want to keep: a midpoint inside a character means the halves hold different
fragments of it, so they could not have compared equal.

### The separator argument

This is the one strategy whose warrant is other than "the reply could not have
run as sent". A doubled reply could have run, twice, so the reason it is safe is
the separator:

> A model that means to repeat a statement writes something between the two
> copies. `step(); step();` has a space; `step();\nstep();` has a newline. Any
> odd-length separator makes the whole reply odd-length, so D1 declines on
> arithmetic alone. Two copies compare equal only when the model emitted them
> with no separator at all, which is not a shape models produce. The defect is
> exactly that, because nothing wrote a separator.

Two consequences follow. There is no minimum length:
the observed doubling frequently happens on a run's first turn, where the
program is a line or two, so any floor worth the name would miss the case the
strategy exists for. D4's "not empty" is the whole size rule, and it keeps a
whitespace-only reply from being repaired into itself and counted. A single-line
reply that is an exact doubling is the defect for the same reason, so there is
no newline requirement and no minimum statement count.

The arithmetic bounds what this strategy repairs. A doubling in which each copy
ends with a newline has odd length once the trailing whitespace is trimmed, so
D1 declines it and the reply reaches its language's prepare step as it arrived.

It applies once per pass, so a quadrupled reply is halved twice by the fixpoint
loop. Each halving leaves a shorter text on which the same match either holds
again or does not.

## Language dialects

Healing splits in two. The skeleton is everything above: which repairs exist,
the order they run in, what makes each of them decline, and what is counted. It
holds in every program language, since a model that fences, explains or doubles
its program does so whatever language it was asked to write.

A dialect answers the lexical questions the skeleton asks about one language:

- which fenced-block tags mean "this block is the program", as a closed
  recognised list;
- whether a line is certainly code;
- whether a line is certainly prose.

Each answer's errors must be asymmetric. A clause of the code test must be a
shape only code has, since a false positive costs one fence that could have been
unwrapped. A clause of the prose test must be a shape only English has, since a
false positive deletes a line of the model's program. The two are neither
complements nor disjoint, and the fixpoint loop resolves the overlap. The trait
also carries a lexical code mask over a source, which each language's own
preparation reads.

The trait is declared with the skeleton and each language implements it beside
the rest of that language, so healing keeps its independence from the sandbox. A
dialect that answers "no" to every question is legal: `strip-prose` goes inert,
`strip-fences` narrows to the untagged blocks it recognises without help, and
`drop-doubled-response` works exactly as it does under any other dialect, since
it asks a dialect nothing. A language contributes fixtures the whole pipeline is
run over under every configuration, so the delete-only invariant is re-earned
per language rather than inherited.

Two languages share one dialect where they share one syntax, and the two
ECMAScript arms do. Each arm's own answers are on its own page under
[program languages](/gg/languages/overview/).

## Configuration

Healing is configured per agent, in the `responses-as-code` capability's params,
as a `healing` object keyed by strategy id. The object is a delta against the
defaults: a strategy absent from it takes its own default. The run's launch log
and session summary record the root agent's resolved set.

```jsonc
{ "id": "responses-as-code", "enabled": true,
  "params": { "timeoutSecs": 30, "maxMemoryBytes": 268435456,
              "healing": { "strip-fences": false, "drop-doubled-response": true } } }
```

| `params.healing` | Meaning |
| --- | --- |
| absent / `null` / `true` / `{}` | the defaults: the two on, `drop-doubled-response` off |
| `false` | every strategy off, the master switch |
| `{ "strip-prose": false }` | `strip-prose` off, the rest at their defaults |
| `{ "drop-doubled-response": true }` | `drop-doubled-response` on, the rest at their defaults |
| `{ "strip-prose": 0 }` | `strip-prose` at its default, since a non-boolean is not a toggle, and the key is reported |
| `{ "stripProse": false }` | the defaults, and `healing.stripProse` is reported as unreadable |
| `5`, `"off"`, `[]` | the defaults, and `healing` is reported as unreadable |

An unreadable key is reported at `warn` on the run's own stream before the first
turn and changes nothing. `{"stripFences": false}` would otherwise run the
default arm under the disabled arm's name, and every number that comparison
produced would measure the wrong thing. No such warning fails a launch, since a
sweep's one shared configuration document has to stay interpretable by every
arm.

In the [configuration editor](/gg/configurations/) the strategies are switches
on the capability, and only the ones moved off their default are written into
the saved configuration. The underlying params are a delta, so writing out the
untouched ones would turn every saved configuration into an explicit opt-in that
a later change of default could not reach.

### Which strategies are armed by default

A strategy is armed by default when repairing is strictly safer than not
repairing. `strip-fences` and `strip-prose` qualify, and the warrant is the same
for both: the reply each of them deletes from could not have run as sent. A
fenced reply is not a program in any language, nor is one with prose around it,
so declining to repair either costs the turn outright.

`drop-doubled-response` is the exception. The half it deletes is valid code
under any reading other than "the transport duplicated this", so where the other
two turn a dead reply into a live one, this one changes what a live reply does.
The separator argument is why its match rule is safe with almost no guards,
which is a different question from whether every model should have the repair
armed. It is armed deliberately, per run, by an operator who has seen the
defect, and the default arm every study compares against is the other one. The
master switch turns it off with everything else.

Each toggle creates an arm worth measuring:

| Off | The run then |
| --- | --- |
| `strip-fences` | compiles a fenced reply with its fence, so the turn is a preparation error. This arm measures what a fence costs when nothing catches it. |
| `strip-prose` | compiles a bare program with its explanation around it, which fails to prepare |
| `drop-doubled-response`, which is its default | compiles a doubled reply whole: a redeclaration error, or, for a body of bare statements, a program that runs and does every piece of its work twice |

Under the master switch every reply is compiled exactly as the model sent it.
Healing still runs and still canonicalises, and it repairs nothing.

## Metrics

Per turn, on the `code_execution` [telemetry](/gg/telemetry/overview/) event.
The object is omitted for a clean reply, so its presence is "something was
unusual about this response":

```jsonc
"healing": {
  "strategies": ["strip-fences", "strip-prose"],    // in application order, repeats kept
  "didNotConverge": false                           // omitted when false
}
```

Per run, on the session summary's `healing` rollup, folded from that same event
so numerator and denominator come from one mechanism:

| Field | What it counts |
| --- | --- |
| `healed` | Responses that had to be repaired and then ran. |
| `applications` | Total strategy applications, at least `healed`, since one response may need several repairs. |
| `stripFences`, `stripProse`, `dropDoubledResponse` | Applications of each strategy. |
| `enabled` | The strategies armed for the run, in application order. Empty means every one was off for a code-mode run; `executionMode` tells that apart from a tool-calling run, where healing never runs. |

`enabled` is what makes an arm legible from the telemetry alone. Every
other figure counts what fired, and a run in which nothing fired is
byte-identical whether its strategies were all armed or all disabled. It is
therefore always written, empty list included. The same resolved set is named on
the run's launch log, beside the ceilings:

```text
response healing: strip-fences, strip-prose
response healing: strip-fences, strip-prose, drop-doubled-response
```

The first line is the default arm, printed by a run that says nothing about
healing. The second is what a run that armed the extra strategy prints, and the
one strategy between them is the whole difference. A run with every strategy off
logs `response healing: disabled`, followed by the note that a reply is compiled
exactly as the model sent it.

A response is healed exactly when at least one repair was applied to it, since
every healed reply then runs. The denominator for every rate is
`codeExecutions`, one per code-shaped turn, including the turns whose reply did
not compile.

That denominator also includes the one turn whose compiler could not finish,
which says nothing about healing: the compiler crashed, hit its timeout, or was
missing from the image, so nothing read the reply. It is the last turn of the
run, which ends under `internal_error`, so an arm whose compiler is flaky is
read from the runs that got that far rather than from a rate.

Read the per-strategy counts as what gg's pipeline did rather than as what the
model wrote. The pipeline applies its strategies in a fixed order to a fixpoint,
so which strategy gets the credit for a response several could have repaired is
a property of that order.

The rollup omits one fact by design. A reply that defeated the pipeline, whose
repairs never reached a fixpoint and were all discarded, folds in as an ordinary
response and contributes only to the denominator. That diagnosis lives on the
turn's own `didNotConverge` and on the live feed, because it describes one
pathological reply rather than a rate a study slices on.

### Querying the rollup

The whole rollup is flattened into the run document of the
[query language](/gg/analysis/query-language/), so every counter above is a
queryable name: `summary.healing.healed`, `summary.healing.applications`, and
one per strategy. `enabled` is a list, and a list contributes only its length,
as `summary.healing.enabled.count`.

```text
has.summary:true | stats avg(summary.healing.healed) as healed by model
```

The rate is `healed / codeExecutions` and is deliberately not stored as a third
field, for the reason no error percentage is: a figure that can disagree with
its own denominator is worse than one the reader divides.

A comparison needs nothing further. A capability's params are flattened into the
same document, so each strategy's declaration is its own field under
`cap.responses-as-code.healing.<strategy>`, and a run that left a strategy at
its default falls out of the comparison rather than being counted as a value it
never declared. For the two default-on strategies the absent bucket is on, and
for `drop-doubled-response` it is off.
