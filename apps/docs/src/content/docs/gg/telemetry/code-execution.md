---
title: "Code execution"
---

One `code_execution` event rides on the stream per code-shaped turn of a
[responses-as-code](/gg/responses-as-code/overview/) run, including a turn whose
reply never compiled. That inclusion is what makes its count the exact
denominator for every healing rate. A run with the capability off emits none.

## What the event carries

| Field | What it carries |
| --- | --- |
| `ok` | Whether the program returned normally. A failed code turn is a turn outcome fed back to the model rather than a crash of the run, and it is independent of `finished`: a program that finished the run and then threw is `ok: false` with `finished` present. |
| `toolCalls` | How many of the program's calls reached the turn loop and were dispatched against gg's real machinery, rather than being answered inside the sandbox or refused before dispatch. A program streams no `tool_call`/`tool_result` pair; the events bracketing each of these are its own `api_call`/`api_result` pair. |
| `apiCalls` | The turn's total of [model-facing calls](/gg/telemetry/agent-surface/#model-facing-calls), and the complete count. It exceeds `toolCalls` by the calls that dispatch nothing and the calls the membrane refused. Omitted when zero. |
| `durationMs` | How long the program's own execution took, excluding time parked in a bridged call. Reported on every path that reached the engine, including a fault, a trap, or an execution-timeout stop, where it is the time burned up to the stop rather than the ceiling. |
| `error` | The failure message when `ok` is `false`. Absent on a clean execution. |
| `finished` | The summary a program passed to `finish`, present on exactly the turn that ended the run. |
| `logs` / `logsSuppressed` | Every line the program logged, and how many lines the capture caps dropped. Both omitted for a turn that printed nothing. |
| `compileWaitMs` | What this program spent obtaining the sandbox's compiled component. |
| `compileMs` | What this turn's [language](/gg/languages/overview/) spent compiling for it. |
| `healing` | What gg had to repair before it could run the reply. Omitted entirely for a clean one. |

## Logs and the operator-facing record

`logs` is the only record of a program's output. What a program shows itself is
a [view](/gg/responses-as-code/views/), which arrives as its own context
message, so a logged line reaches whoever is watching the run and nowhere else.
The capture keeps the tail under caps of 200 lines, 16 KiB and 2 KiB per line,
and `logsSuppressed` says how many lines were dropped.

The same holds for far more than the logs. An
[error message carries the error alone](/gg/responses-as-code/overview/), and a
clean program earns no message at all beyond a process notice. Such a notice
names a fact nothing the program can observe reveals, such as a
[replacement program](/gg/program-library/) it handed over that gg did not run.

This event and the operator-facing lines gg writes beside it on the run's own
stream are therefore the only surviving record of what a turn did. That record
covers every refused call and how many further refusals the cap suppressed,
every refused view, every view opened, replaced or closed with its selector and
token estimate, the roster's count of composed calls, the summary a program
ended with, and the revocation when a program called an ending function and then
threw. A run's conclusion
lives in `finished` and nowhere else, which is why the console's event feed
surfaces it as the agent's own message.

## The two compile figures

`compileWaitMs` belongs to the process. An arm with an embedded guest component
compiles that component once per process, and a run that enables the capability
starts the compile before its first model request. Starting it early only
overlaps it with the request: on a container with one or two cores, a model that
answers quickly gets its first program back before the warm-up has finished, and
that program compiles the component inside its own span. The field is what
separates "this program was slow" from "this program paid the one shared
compile", and it is absent on every turn that did not pay it.

An arm whose prepare step produces the component for one program alone has no
shared component to warm. There the field is present on every turn, carrying what
compiling that turn's own artifact into the engine cost.

`compileMs` belongs to the turn. It is the whole of the language's prepare step,
including any compiler it shells out to: the program itself, each replacement it
handed over to, and the code half and on-use script of every skill or memory this
agent first used on this turn. Both halves are prepared once per agent and re-run
as prepared, so a repeat use queues a run and no compile, while a skill used by a
second agent is compiled again for it. Leaving those out would make a
skill-heavy compiled arm report less than it spent.

The field is absent for a language whose prepare step compiles nothing, which is
[JavaScript](/gg/languages/javascript/) and [Python](/gg/languages/python/). It
is present on every turn of a language that compiles, including the turn whose
program the compiler rejected. That turn is the one the field exists for, because
it is the only reading of that turn which is not zero. The sandbox's own clock
starts once a program is prepared, so without this field a compiled arm's
per-turn compile cost would land in neither `durationMs` nor `compileWaitMs` and
would be absorbed into the turn's response time alongside minutes of `shell`,
which is to say two language arms could not be compared on what compiling cost
them.
