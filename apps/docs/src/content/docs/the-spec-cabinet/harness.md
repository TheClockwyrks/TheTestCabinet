---
title: "Harness"
---

The Spec Cabinet builds off of the design established by
[gg](/gg/overview/) to implement an agentic harness itself. It drives two kinds
of agent: workflows, which a user triggers against an entity of a draft, and the
[assistant](/the-spec-cabinet/chat/), which a user talks to in the chat sidebar.
Both run the same turn loop over the same agent surface, and each is described
by an agent configuration.

## Workflows

Each workflow is identified by a name, and that name is how the UI invokes it
and how the backend reports on it. A workflow takes the entity the user is
working on in a draft as its input, so invoking a workflow is a matter of
choosing a name and a target.

A draft holds the authored result of a workflow, keeping a suite portable across
releases of The Spec Cabinet.

## Agent configuration

Each agent's configuration is a directory in the `the-spec-cabinet`
repository:

- `crates/spec-cabinet/workflows/<name>/` holds a workflow's `workflow.toml`,
  and its `system.hbs` and `brief.hbs` prompts;
- `crates/spec-cabinet/chat/` holds the assistant's `agent.toml` and its
  `system.hbs` prompt.

Prompts follow gg's `agent-prompts` skill,
`.claude/skills/agent-prompts/SKILL.md` in the `gg` repository.

An agent's id is its directory name. A workflow's id is its name, and the
assistant's id is `assistant`, which no workflow may take.

The backend reads a configuration and its prompts from disk each time a run
starts, so an edit reaches the next run without a restart or a rebuild. Every
field of the TOML file is configurable. A `.local.toml` file beside it, such as
`agent.local.toml`,
holds the current user's changes and is ignored by git. The local file is merged
over the committed one: tables merge key by key, and any other value, arrays
included, replaces the committed value whole.

A configuration that does not parse, or that names an unknown operation, entity
kind, check, language, or model slot, or an opening turn module or function that
is not a module or operation of the agent surface, is reported by the
configuration API and the status area, and runs of that agent are refused until
it is fixed. The same applies to a configuration that enables compaction with a
`summaryHeadroom` outside `0.0` to `0.9`, that sets responses as code without
all four of its parameters, that names a read mode other than `unlimited` or
`default-cap` or no `lineCap` of one or more, that names an output mode other
than `offload` or `inline` or omits either of its ceilings, or that enables loop
detection without all five of its figures. A test loads every committed configuration and
checks it is valid. A run records its fully merged configuration.

| Field             | Meaning                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `summary`         | The workflow's one-line summary. Workflows only.                                                   |
| `target`          | The entity kind a workflow runs against. Workflows only.                                           |
| `modelSlot`       | The [model slot](#models) a workflow runs on, `code` or `prose`. Workflows only.                   |
| `operations`      | The [operations](#the-agent-surface) the agent is granted.                                         |
| `writes`          | The entity kinds a workflow may change. Workflows only.                                            |
| `checks`          | The checks that decide a workflow's outcome. Workflows only.                                       |
| `[limits]`        | `maxTurns`, `maxRuntimeSecs`, `maxConsecutiveErrors`, and `maxCost`.                               |
| `[execution]`     | `mode`, and for responses as code `language`, `timeoutSecs`, `maxMemoryBytes`, and `docViewTypes`. |
| `[openingTurn]`   | `modules` and `functions`, the responses-as-code [opening turn](#execution-modes).                 |
| `[context]`       | `windowLimit`, the optional [context window override](#context-window).                            |
| `[readFile]`      | `mode` and `lineCap`, how much one [read](#reads) returns.                                         |
| `[output]`        | `mode`, `maxLines`, and `maxChars`, how much of a call's [output](#call-output) returns inline.    |
| `[loopDetection]` | `enabled` and gg's five [loop-detection](/gg/loop-detection/#configuring-it) figures.              |
| `[compaction]`    | `enabled`, `summaryHeadroom`, and `maxRetries`.                                                    |

Configurations are edited on the
[Settings page](/the-spec-cabinet/user-interface/#settings), which writes only the
fields that differ from the committed file into the local file. Resetting a field
removes it from the local file.

## Models

The settings name one model per slot:

- `code` is for workflows that write code, such as validators, demonstrations,
  workspaces, debug API declarations, and reference implementations. It defaults
  to `anthropic/claude-opus-5`.
- `prose` is for workflows that write specifications, requirements, prompts,
  changelogs, or showcases. It defaults to `openai/gpt-5.6-terra`.
- `assistant` is the model the assistant always runs on. It defaults to
  `openai/gpt-5.6-sol`.

A workflow runs on the model the settings name for that workflow, and otherwise
on the model of its `modelSlot`. The model is resolved when a run starts and is
recorded on the run.

Model settings belong to the development machine rather than to any suite, so
they are kept in a TOML file outside the test suites checkout:
`$XDG_CONFIG_HOME/tcab-spec-cabinet/settings.toml`, or
`~/.config/tcab-spec-cabinet/settings.toml` when `XDG_CONFIG_HOME` is unset.
`TCAB_SPEC_CABINET_SETTINGS` names a different file.

```toml
[models]
code = "anthropic/claude-opus-5"
prose = "openai/gpt-5.6-terra"
assistant = "anthropic/claude-opus-5"

[models.workflows]
write-prompt = "anthropic/claude-opus-5"
```

Every model id is an OpenRouter id of the form `provider/model`, written in ASCII
letters, digits, `.`, `_`, `-` and `~`, with `:` also allowed in the model half.
The file is read each time a model is resolved. A missing file is the defaults. A
file that does not parse, or that names an id of the wrong form, is reported by
the settings API and the status area, and runs are refused until it is fixed or
replaced by a save. A save writes the whole file atomically.

## Execution modes

The Spec Cabinet supports both of gg's execution modes, and `[execution].mode`
chooses one per agent.

- `tool-calling` offers the agent's [tools](#tools) as native tool definitions,
  and each tool call is dispatched and answered with its result.
- `responses-as-code` offers the single `submit_program` tool, and the agent
  answers each turn with a program over the [SDK](#sdk).

Responses as code follows gg's design as documented in
[Responses as code](/gg/responses-as-code/overview/), including its contract, its
views, its documentation search, and its sandbox limits. The Spec Cabinet binds
its own agent surface in place of gg's operations, and supports three program
languages: `javascript`, `typescript`, and `purescript`. Each is evaluated by
gg's [ECMAScript guest](/gg/languages/ecmascript-guest/) and has its own
idiomatic SDK and prompt segment, following gg's
[agent surface](/gg/languages/agent-surface/) rules.

A responses-as-code agent's fresh window is seeded with gg's
[opening turn](/gg/responses-as-code/views/#the-opening-turn). `[openingTurn]`
names the modules it lists in `modules` and the functions whose documentation it
opens in `functions`. Both lists are checked against the operation vocabulary
the way `operations` is, and an entry the agent does not hold is dropped when the
window is seeded.

## Messages

A `user` message reaches an agent from several sources: the person typing to the
assistant, the brief a workflow run opens on, and the harness itself. Every one
of them carries a heading, which is the label, a `----` rule, and the body, so
the model reads what a message is from the message. The vocabulary is closed and
the system prompt names every heading the run's configuration can produce.

| Heading          | What it carries                                      |
| ---------------- | ---------------------------------------------------- |
| `Message`        | a message the user sent to the assistant             |
| `Brief`          | the brief a workflow run opens on                    |
| `Notice`         | a fact about the run rather than about the work      |
| `Compiler error` | the diagnostic of a program that did not compile     |
| `Runtime error`  | the error of a program that compiled and then failed |

A view a program opened is headed by its selector, as gg heads it. Under
responses as code the headings and their bodies follow gg's
[messages](/gg/responses-as-code/messages/).

## The agent surface

The agent surface is the set of operations an agent can perform. Each operation
is one backend API operation, or one of the operations specific to agents:

- the granular text reads and edits, `text.read_window` and `text.splice`,
  described in
  [Collaboration](/the-spec-cabinet/collaboration/#granular-reads-and-edits);
- `skills.read_skill`, which reads one of the agent's [skills](#skills);
- `docs.search` and `docs.close`, gg's documentation search over the
  [SDK](#sdk) and its closing of documentation views;
- the view operations `views.open_file`, `views.open_text`,
  `views.open_docs_view`, and `views.close`, bound as gg binds them;
- `workflows.run` and `workflows.wait`, which block the agent until a
  [workflow run](#workflow-operations) ends;
- `session.read_location`, which answers where the user was when they sent the
  message the run is answering, granted to the assistant;
- `page.read_field` and `page.set_field`, which read and fill the fields the page
  the user is on holds the value of, granted to the assistant;
- `session.compact`, granted when compaction is enabled;
- the ending operation, `session.finish(summary)` for a workflow and
  `session.stop(message)` for the assistant.

An operation's id is `<module>.<operation>` in snake case, where the module is
its [SDK](#sdk) module. Tools and SDKs spell each id in their own idiom.

`operations` grants operations by id or by module, such as `drafts.*`. Mirroring
gg's [`Always` binding](/gg/responses-as-code/api-surface/#the-capability-gate),
`docs.search`, `views.open_text`, and `views.open_docs_view` are granted to every
agent under responses as code. The ending operation is granted to every agent,
`session.compact` to every agent with compaction enabled, and
`skills.read_skill` to every agent that holds a skill. `views.open_file` is
gated by the same grant as `files.read_file`. A call to an operation the agent
was not granted is refused with a result naming the calls the agent does have.
Every operation takes effect when it is called, and a refusal, conflict, or
failure is returned as the call's result.

A test checks that every API operation is reachable through exactly one tool and
one SDK function, apart from the settings, configuration, conversation, change
stream, and hold operations, and the run history and run event stream, which stay
with the user's client.

The whole surface is browsable in the app at
[Reference](/the-spec-cabinet/user-interface/#reference), which projects every
operation, the curated tools, each language's SDK, and the skills out of these same
definitions.

### Tools

Tool calling offers a curated set of tools rather than one tool per operation.
Each tool covers the operations on one kind of thing. Its schema is an object
with an `operation` enum and one optional argument object per operation. A call
carries its chosen operation's arguments in the property named by the operation,
and a property that is absent is the empty object, so an operation that requires
nothing is called by naming it alone. The harness refuses a call whose chosen
operation's arguments do not fit its schema.

| Tool         | Operations                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `browse`     | List suites, drafts, versions, the entities of a kind, and the files beneath a path                                           |
| `read`       | Read an entity, a source file, or a window of text                                                                            |
| `write`      | Create or replace an entity or a source file, and set a field                                                                 |
| `edit`       | Splice text in an entity's text field or a source file                                                                        |
| `organize`   | Delete, rename, move, and reorder entities                                                                                    |
| `suite`      | Create a suite, edit its manifest, publish it, and import its runs                                                            |
| `draft`      | Create, rebase, discard, compare, preview, and export a draft                                                                 |
| `check`      | List problems and run the editors' checks, such as typechecking validators and building a demo                                |
| `workflow`   | List workflows and running runs, and start, run, wait on, and cancel runs                                                     |
| `read_skill` | Read one of the agent's skills                                                                                                |
| `location`   | Read where the user was when they sent the message the run is answering, and read and fill the fields of the page they are on |
| `compact`    | Compact the context                                                                                                           |
| `finish`     | End a workflow run with a summary                                                                                             |
| `stop`       | End an assistant run with a message to the user                                                                               |

A tool is offered when the agent is granted at least one of its operations, and
its schema lists only the granted operations.

### SDK

Under responses as code, each operation is a typed function whose name and
arguments follow the API operation it performs. Functions are grouped into
modules by API area: `suites`, `drafts`, `entities`, `files`, `text`, `checks`,
`workflows`, `skills`, `docs`, `views`, `page`, and `session`.

`docs` is gg's documentation search over the SDK. One grant check decides both
what an agent can call and what a search shows, so an agent finds exactly the
functions it is granted. A module is named in the system prompt only where the
agent is granted a function in it.

A read returns data to the program and opens nothing: `entities.read_*`,
`files.read_file`, and `text.read_window` hand the program what they read and
record the revision they read. Showing material to the model is opening a view,
and the kinds, headers, caps, supersession, and budget of views follow gg's
[Views](/gg/responses-as-code/views/) page.

### Skills

The suite format documentation pages and each engine's documentation are
[skills](/gg/skills/) built into the binary, so the catalogue is fixed for a
run. The suite format skills are copies of the [Test Suites](/test-suites/overview/)
pages kept in the-spec-cabinet's `crates/spec-cabinet/skills/suite-format/`,
and a page is changed on this site first and copied there whole. Each built-in
engine's skill is the documentation directory its `engine.toml` names, read from
the engine's package as the-spec-cabinet's npm workspace installs it. Every skill an
agent holds is listed in its system prompt by name and one-line description. The
agent reads one with `skills.read_skill`, or the `read_skill` tool under tool
calling, and a read skill is retained across a compaction boundary.

The running agent's grants decide which skills it holds. Each suite format skill
declares the operations it documents, such as the validator operations for the
validators page, and is offered to an agent granted at least one of them. An
engine's skill is offered to an agent granted an operation that builds on an
engine, such as those over starter workspaces and reference implementations. A
workflow run is offered only its run's engine, and the assistant is offered every
engine.

## Reads

`files.read_file` behaves exactly like gg's
[`read_file`](/gg/filesystem/#read-modes): its read modes, its `offset` and
`limit` arguments and window note, its whole-file reads, its byte ceiling, and
its [image handling](/gg/filesystem/#reading-images), including models that
cannot see images. A model's input modalities come from OpenRouter's model
listing. `text.read_window` pages an entity's text field or a source file under
the same read mode, with the same arguments and window note.

`[readFile].mode` selects the mode per agent, and `lineCap` is required under
either mode.

| Mode          | A call that names no `limit` returns              |
| ------------- | ------------------------------------------------- |
| `unlimited`   | The rest of the target, from `offset` to its end. |
| `default-cap` | `lineCap` lines, from `offset`.                   |

Both modes honor `offset` and `limit` whenever they are given, so a `limit`
larger than `lineCap` is how an agent reads past the cap.

Every statement of the cap an agent reads is built from its configuration. The
`limit` argument's description names the default in force, and under
`default-cap` the tool-calling system prompt states the cap through the
`readFile.lineCap` prompt variable.

## Call output

Every operation's result is output, and how much of it returns inline follows
gg's shell [output offloading](/gg/shell/#output-offloading). An operation
behaves as a shell call with a fixed command: `checks.typecheck_validators` runs
the typechecker, and `drafts.compare` prints its comparison. `[output].mode`
selects the mode per agent, and `maxLines` and `maxChars` are required under
either mode.

| Mode      | Returned inline                        | On disk |
| --------- | -------------------------------------- | ------- |
| `offload` | The tail, plus a note naming the files | Both    |
| `inline`  | The whole output, capped at 16 KiB     | Nothing |

Under `offload`, every call writes its output to files in its agent's record,
under `<state>/workflows/<run-id>/output/` for a workflow run and
`<state>/chats/<conversation-id>/output/` for the assistant. An operation that runs a
command writes its stdout and stderr to separate files, and every other
operation writes one. Output that fits under the ceilings returns untouched.
Output that does not returns its tail followed by gg's truncation note, which
names each file by its absolute path and states its shape. `files.read_file`
reads those paths, and each operation's description states the rule.

One function applies the policy, so a tool call and a program's call are
governed identically, and gg's 16 KiB byte cap applies behind the ceilings. A
workflow's declared checks write their output the same way, and its run records
each check's tail and note. The policy covers every operation except:

- `entities.read_tree` and `entities.list_problems`, whose results are used whole
  whatever their length;
- the reads under the [read mode](#reads), `skills.read_skill`, and the `docs`
  and `views` operations, which follow gg's own rules for them.

## Context window

An agent's window is the model's context length from OpenRouter's model listing,
read when the run starts. `[context].windowLimit` narrows it to a smaller figure,
which lets a large model exercise compaction without filling its whole window.
When the listing cannot be reached, a set `windowLimit` is the window.

A run is refused when its `windowLimit` is larger than the model's context length,
or when it has no `windowLimit` and the listing cannot be reached. A request whose
prompt would exceed the window ends the run as `context_exceeded`, whether or not
compaction is enabled.

## Compaction

The Spec Cabinet supports one compaction strategy, gg's
[self-compaction](/gg/compaction/#in-loop-strategies), and `[compaction]`
configures it. `summaryHeadroom` and `maxRetries` mean what they mean in gg: the
window the agent works against is the window less the `summaryHeadroom`
fraction, compaction triggers at `1 - summaryHeadroom` of it, and `maxRetries`
counts the boundaries retried when a compaction leaves the window at the trigger.

The agent calls `compact(summary, resources)` with a summary and up to twelve
resources, and the harness restarts the context from them. The `compact` tool is
offered on every turn of a run with compaction enabled. At the trigger, the
harness appends an instruction to compact at the next turn boundary and refuses
every other call, the ending operation included, until `compact` is called.

The restarted context holds, in order:

1. the system prompt;
2. the workflow's brief, or for the assistant, the conversation's latest user
   message;
3. the skills the agent has read;
4. the documentation views that were open;
5. the named resources, read as the agent's reads see them;
6. the summary.

A boundary clears the read-before-write record, apart from the resources it
re-read, so a write to any other resource is refused until the agent reads it
again. A workflow keeps the revision each file had when the run first read it,
which is the revision its changeset is applied against.

A compaction that does not bring the window under the trigger, once `maxRetries`
is exhausted, ends the run as `compaction_failed`.

## The turn loop

One agent runs one conversation:

1. Render the system prompt, and the brief or the conversation, from the
   agent's templates and records.
2. Call the model with the agent's tools, or with `submit_program`.
3. Dispatch each tool call, or run each submitted program, and append its
   results, including a refusal or failure, so the model reads them on its next
   turn.
4. Compact when the window reaches the trigger.
5. Repeat until a turn ends the run or a ceiling is reached.

A turn that calls no tool is an error turn and is answered with a message naming
the ending operation. A reply that hits the provider's output cap is rejected
whole and recorded as an error turn. The streaming reply runs through a port of
gg's [loop-detection](/gg/loop-detection/) rule, and a looping reply is abandoned
before it enters the conversation. `[loopDetection]` configures it per agent with
gg's keys: `enabled`, `windowWords`, `repeatThreshold`, `minOffenders`,
`minSaturatedRun`, and `maxResponseChars`. An enabled detector runs on the
figures its configuration writes, and a disabled one abandons no reply.

The ending operation ends the run once the turn that called it completes,
following gg's [rules for ending a session](/gg/ending-a-session/). Under
responses as code, a program that throws after calling it loses the ending.

Reaching `maxTurns`, `maxRuntimeSecs`, `maxConsecutiveErrors`, or `maxCost` ends
the run as `limit_exceeded` with the ceiling named.

## Writes

A workflow's edits go through the same backend write path as an edit made by
hand. The same save rules apply, the same canonical TOML formatting is applied,
and the resulting files are identical to the files a user would have produced by
making the same edit through the UI.

A workflow writes only to drafts. Each write applies save rules through the save
path's planning step and records the change in the run's changeset rather than on
disk. A change outside the workflow's `writes` is refused as a call result. Like
a manual edit, a workflow's edits may leave the draft with problems, which are
reported the same way.

A workflow's reads see the draft as the run has changed it. Its checks run
against a scratch copy of the draft with the changeset applied, at
`<state>/workflows/<run-id>/workspace/`, on the host exactly as the editors run
them.

## Finishing and applying

When a turn ends the run through `finish`, the workflow's declared checks run
against the scratch copy, and their outcomes decide `succeeded` or `failed`. A
succeeded run applies its changeset through the write path, and each change is
broadcast like any other. The files no open editor holds are committed together, subject
`feat(<slug>/<draft>): run workflow <name> on <target>`, and a held file is
committed when its hold is released, as described in
[Collaboration](/the-spec-cabinet/collaboration/#committing). A failed run
applies nothing, and its changeset stays in the run record for review.

A draft edited since the run started is preserved. A changeset file whose
revision has advanced past the revision the run read is reported as a conflict
and left out.

## Results

A workflow reports its result against the entity it modified. The report names
the workflow, the target, and the outcome, so the record of what an agent
changed is reachable from the thing that changed.

## Runs

Runs are independent, so any number run concurrently across a draft. One run at
a time holds a given target entity, and starting a second answers with the
running one.

Each run records `<state>/workflows/<run-id>/` holding, under the state root
described in [Architecture](/the-spec-cabinet/architecture/#backend):

- `run.json`: the workflow, its merged configuration, the model, target, draft,
  base commit, the revision of each file it read, status, applied files,
  conflicts, check outcomes, usage, cost, and the resulting commit;
- `events.ndjson`: one event per turn, program, operation call, call result,
  compaction, and check, which the UI streams live;
- `journal.ndjson`: each model request and response, each program's source and
  outcome, and each call's full result.

Runs sit under the state root rather than in the suites checkout, which holds
suite data alone. A run found in flight at startup is marked `interrupted`.

### Workflow operations

An agent works with workflows through six operations:

- `workflows.list` lists the workflows, with each one's summary, target kind, and
  model.
- `workflows.start(name, target)` starts a run and returns its id, and the agent
  continues.
- `workflows.run(name, target)` starts a run and blocks the agent until the run
  ends, returning its outcome.
- `workflows.wait(run)` blocks the agent until the run ends and returns its
  outcome. A run that has already ended returns its outcome at once.
- `workflows.cancel(run)` cancels the run at its next turn boundary.
- `workflows.list_runs` lists the running runs with their ids, and the runs that
  ended during the current conversation.

An outcome is the run's status, finish summary, applied files, conflicts, check
outcomes, and cost. What a run does while it executes is shown in the UI.

A run an agent starts is independent of that agent. When the agent is stopped or
reaches a ceiling while blocked in `run` or `wait`, the run keeps going, and the
time the agent spends blocked counts against its `maxRuntimeSecs`.

| Route                                                     | Operation                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET /api/workflows`                                      | List workflows, their target kinds, and their effective models                                    |
| `POST /api/suites/{slug}/drafts/{draft}/workflows/{name}` | Start a run with a target id                                                                      |
| `GET /api/suites/{slug}/drafts/{draft}/workflows/runs`    | List runs, filterable by target                                                                   |
| `GET /api/workflows/runs`                                 | List the running runs across every suite, with each one's elapsed time and cost                   |
| `GET …/workflows/runs/{run-id}/events`                    | Stream events over SSE                                                                            |
| `POST …/workflows/runs/{run-id}/cancel`                   | Cancel at the next turn boundary                                                                  |
| `GET /api/settings`                                       | Read the settings, defaults, and any problem with the file                                        |
| `PUT /api/settings`                                       | Replace the models the settings name                                                              |
| `GET /api/settings/model-suggestions`                     | List OpenRouter's models as suggestions                                                           |
| `GET /api/agents`                                         | List the assistant and every workflow with its committed and merged configuration and any problem |
| `PUT /api/agents/{agent}/local`                           | Replace the agent's local configuration                                                           |
| `DELETE /api/agents/{agent}/local`                        | Remove the agent's local configuration                                                            |
