---
title: "Context visibility"
---

gg tracks what is consuming each agent's context window, broken down by source,
and streams that breakdown every turn as [telemetry](/gg/telemetry/overview/)
alongside the exact messages it sent. The same accounting powers the
context-usage signal in [agent-managed context](/gg/agent-managed-context/) and
the trigger in [compaction](/gg/compaction/).

Context visibility is intrinsic to every gg run rather than a capability. Every
run emits the per-source breakdown and the message log, and neither can be
switched off. The one configurable lever here is the
[Context Window Override](#the-window-a-run-is-measured-against), which narrows
the window a run is measured against.

## The bands

Every contribution to the window is tagged with one source. The console draws
one band per source, in this fixed order.

| Band            | What it holds                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| System          | The system prompt and gg's own notices.                                                                                   |
| User prompt     | The build prompt the agent was given.                                                                                     |
| Assistant       | The agent's own turns: its text, its tool calls, its programs.                                                            |
| Tool output     | The results of tools a tool-calling agent requested.                                                                      |
| Compiler errors | A program that failed to compile, carrying the compiler's error.                                                          |
| Runtime errors  | A program that compiled and then threw, or that the sandbox stopped.                                                      |
| File views      | The contents of files read into the window.                                                                               |
| Agent views     | Material a program composed and opened for itself, keyed by label.                                                        |
| Documentation   | The documentation views an agent opened, keyed by name, and the ones using a code skill or memory opened from its module. |
| Doc search      | The agent's last documentation search, and the opening turn's listing of the modules its configuration names.             |
| Skills          | The [skills](/gg/skills/) shown and used.                                                                                 |
| Memories        | The [memories](/gg/memories/) in play.                                                                                    |
| Task list       | The [task](/gg/tasks/) list.                                                                                              |
| Board           | The [project board](/gg/project-management/).                                                                             |
| History         | Prior-turn material attributable to no more specific source.                                                              |

Token counts are estimates. Exact per-provider counts are unavailable across
providers, so every item is counted with one BPE tokenizer as a documented
cross-model approximation.

Documentation does not follow from a capability. It holds the views a
[responses-as-code](/gg/responses-as-code/overview/) program opened with
`gg.views.openDocsView`, which every agent may call, because reading the
signature of a call an agent was given is not a privilege. So a run with skills
switched off can still fill it. Using a code skill or memory fills it from that
module: one view per function the module declares, plus the type views the
agent's `docViewTypes` flags ask for.

Doc search holds two kinds of listing under two kinds of selector. An agent's
own searches are keyed by the constant `search results`, so each of them
replaces the last. The
[opening turn](/gg/responses-as-code/views/#the-opening-turn) keys its listing of
the modules its configuration names under those modules' paths, so the listing
stands until exactly those modules are listed again. The band sits apart from
Documentation so that what a model spends finding its surface is readable
separately from what it spends reading it.

Compiler errors and Runtime errors sit directly after tool output rather
than inside it. Under responses as code a program that compiled and ran earns no
message back at all, since the views it opened are the result, so the only thing
gg has to say is a diagnostic. The two are separate bands because the failures
have different recoveries. A compiler error means nothing ran and the remedy is
to resend the whole program; a runtime error means the program ran up to the
throw and everything it did before that stands.

## The window a run is measured against

gg resolves the fullness denominator per agent, from that agent's own model, in
two steps:

1. The model's window, from the
   [model catalog](/quickstarts/devops/add-or-update-a-model/), narrowed by the
   Context Window Override capability's `windowLimit` when that capability is
   enabled.
2. The working window, that figure less the summary reserve when
   [compaction](/gg/compaction/) is on.

gg holds no model table of its own. The catalog the backend owns is the single
store of model facts, so the window is resolved where the catalog lives and
pushed into the run at enqueue: the backend looks up every model the capability
set binds and stamps the figures onto the launch, which carry through the driver
into gg's invocation. A run whose [agents](/gg/configurations/#agents) span
several models carries one entry per bound model, so each agent is measured
against its own model's window. A run container never reaches back out for this.

A model the catalog has not observed yet, which is the first run against a
just-released model, is fetched from OpenRouter at that moment, for that model
alone rather than for the whole catalog.

### Runs with no resolved window

If neither the catalog nor a live lookup can answer, the launch is rejected.
There is no default window and no guess from the model id. The check is enforced
three times over: the backend refuses to enqueue such a run, `core` refuses to
launch one, and gg refuses to start a session.

The window is the denominator of every fullness figure, it decides when
compaction fires, and it is the denominator of every share in the context-usage
signal the agent steers by. A run against a guessed window looks healthy and
measures the wrong thing, and a study built on it compares runs that were never
measured the same way.

One consequence: gg's scripted `mock/…` provider is test-only infrastructure
rather than a launchable model. No catalog or provider lists it, so this same
rule refuses it. It reaches gg only from a test that builds the invocation
itself and supplies the windows a launch would have.

### Narrowing the window

`windowLimit` may only make the window smaller. The model's real window is a
hard limit, so a value above it refuses the launch, on the same rule an
unresolvable window is refused under. A `windowLimit` of `0` refuses the launch
too, since an override that narrows nothing is an override the run records and
never applied. Narrowing is how a study exercises compaction against a
million-token model without spending a million tokens of input per boundary:
give the run a 100k window and the same summarize-and-restart behaviour plays
out an order of magnitude sooner.

Narrowing is its own capability, Context Window Override, and an enabled one
writes the `windowLimit` it narrows to. A profile that leaves the capability off
is measured against the model's full window.

## Reading the graph

The console renders the breakdown as a stacked line graph of how an agent's
window fills over the run. It is framed to what the run used rather than to the
window: the top of the scale is the tallest stack so far plus a quarter again,
capped at the window limit. A run that used 40k of a million-token window would
otherwise draw as a flat line along the axis. The dashed window-limit rule
appears once the frame reaches it.

The legend lists the sources this run's [configuration](/gg/configurations/) can
produce, so a run with the board disabled has no Board band to explain. A source
that holds tokens is listed whatever the configuration says.

The bands give the window's shape and the figures come on hover. Pointing at any
turn marks it with a rule and gives that turn's whole composition: the window
total, the share of the window that is, and every band's tokens and share, with
the band under the pointer marked. Every band at a turn carries the same
breakdown, since the question at a bulge is what the window held then. The rows
keep the graph's fixed source order rather than sorting by size.

## The message log

The graph shows the window's composition; the message log shows its contents. It
records the precise messages gg sent the model each turn and the reply it got
back, and the console renders it as a Requests file beside Context in the
Instances explorer. A turn's request reads as the actual system prompt, build
prompt, tool results and file views that filled it, each tagged with the band it
occupies and its own estimated token cost, so a band on the graph and the
messages that make it up line up one to one.

The log is content-addressed. Because the window is
[append-only](#the-append-only-prompt), most of a turn's messages are
byte-identical to ones sent on earlier turns, and recording every turn's whole
prompt verbatim would be quadratic. Each message is fingerprinted by its content
and its body is streamed once, the first time it appears; every turn is then a
sequence of pointers into that shared message set, plus the id of the reply. A
message that sits unchanged in the window for forty turns costs one body and
forty pointers. The pool is per agent, so each agent's stream carries the
definitions its own prompts reference and reads on its own.

An attached image is logged as a descriptor giving its media type, decoded size
and the tokens it is charged, never its base64 bytes.

Each turn's `prompt` entry carries the provider that served the call when the
gateway named one, beside the finish reason, usage and latency it already
carries, so a provider-shaped reply is attributable from the log alone. A
[rejected length-capped reply](/gg/execution-limits/#model-api-errors) is logged
too, as an exchange whose finish reason is the provider's own `length`: the
reply never enters the window, and the log is where it stays inspectable.

A pooled message also carries its window item's selector tag where it has one:
for a file view the workspace path it shows, and for an agent view the label the
agent opened it under. The tag is what makes the window's material attributable
rather than only its bands, and it is how the console totals a run's context
spend per view (see
[what filled the window](/gg/telemetry/context-spend/)).
Because the tag is a property of the item rather than of the message envelope,
it survives a [compaction](/gg/compaction/) re-framing a pinned view as a `user`
message.

## The append-only prompt

A turn never rewrites what an earlier turn already sent. Everything already in
the window stays where it is, byte for byte, and a turn only appends. gg holds
itself to this rule because it is the basis of provider prompt caching: a
request reads the cache only for a prefix the provider has already seen, so an
edit behind the end of the prompt throws away the cache for every message after
it. On a long run that is most of the token bill.

Two kinds of state make that non-trivial.

### Mutable blocks

The memory block, the task list and the board are each rebuilt from their
backing store at every turn boundary so the model always sees current state, and
each is a single live block. Two rules keep the rebuild append-only:

- An unchanged block does not move. When it comes back byte-identical the
  rebuild is skipped and the block keeps its position. Re-appending it would
  rewrite the prompt just before its end every turn, so no turn would ever
  extend the last one.
- A changed block is superseded, not removed. The old copy stays where it
  sits and is retagged as ordinary ephemeral history, and the new one is
  appended at the tail. Deletion would be at its most expensive precisely when
  the block had held still longest, since that is when the most history sits
  behind it.

A superseded copy is the record of what the model was told at that point in the
thread, the model reads the newest block as current, and a compaction summarizes
the old one away. It costs one block's worth of tokens per real change and is
accounted as history rather than inflating the source's own band.

### Slots

Three messages are slots rather than thread items, so assigning one overwrites
rather than accumulates.

The [context-usage signal](/gg/agent-managed-context/) is rendered after the
whole conversation and is always the last message of the prompt. Its figures
move every turn, so as a thread item it would supersede itself every turn and
leave a trail of stale readings. Everything a cache can read sits before it,
rewriting it invalidates no prefix, and it is exactly because it costs nothing
to rewrite that it reports exact figures rather than rounded ones.

The system prompt is always the first message of the prompt. It describes the
agent, its toolset, its roster and its ending calls rather than the
conversation, so it is the one thing a
[succession or a fork](/gg/fork-and-exec/) must not carry: a transferred window
arrives with the slot empty and the successor's loop sets its own. A window
therefore never carries two `system` messages, which a provider that
concatenates them would otherwise render as one instruction block naming two
toolsets.

### File views

A `read_file` result is a snapshot of the file as it was read, and nothing later
rewrites it. Each read appends its own view, so an agent that needs the current
contents of a file it has changed reads it again, which appends. The earlier
view is what the agent actually saw at that point in the thread.

How much enters the window per read is configurable: under a capped
[read mode](/gg/filesystem/#read-modes) a view holds only the window that call
returned, and paging through a file appends one view per page.

### Views a program opened

Under [responses as code](/gg/responses-as-code/overview/) a program puts
material in front of itself by opening a view, and gg pushes one message per
open view into the next prompt. The spellings below are TypeScript's; each
[language](/gg/languages/overview/) spells them its own way.

- `gg.views.openFile(path)` lands in the File views band, keyed by path, and
  arrives headed `File: <path>:<first>-<last> of <N> lines`, the 1-based
  inclusive line range the view shows and the file's total line count (a whole
  file's range runs `1-N`).
- `gg.views.openText(label, body)` lands in Agent views, keyed by the label.
- `gg.views.openDocsView(name)` lands in Documentation, keyed by the name of the
  thing it documents.
- `gg.docs.search(...)` opens its results in Doc search, under the constant
  selector `search results`, so each search an agent runs replaces the last. The
  opening turn's module listing lands in the same band keyed by the paths of the
  modules it names, and stands until exactly those are listed again.

The bands are separate because the authorship is: a file view is workspace
material with an on-disk truth behind it, tool output is gg's reporting back to
the agent, documentation is gg describing its own surface, and an agent view
exists nowhere but the window.

Re-opening a selector supersedes the view that was under it, which is the one
place the append-per-read rule does not apply. The difference is what the two
calls name. A `read_file` names an action: it happened, it returned what the
file said at that moment, and each one appends. `gg.views.openFile`,
`gg.views.openText` and a search's results view name an intent, and re-stating
an intent replaces it. A program that loops over changed files and re-opens each
one therefore leaves one view per file rather than one per iteration.

`gg.views.openDocsView` is the exception. Re-opening a key under the body already
open does nothing at all: the view is not moved, not re-emitted and not retagged.
The documentation gg's own surface renders for one key is the same bytes every
time, so moving the item to the tail would rewrite the middle of the prompt in
exchange for text the model already has. A page whose text has changed, which
only a revised [loaded module](/gg/skills/) produces, supersedes the copy that
was open on the rules below. The documentation band is otherwise append-only, and
placement is first-open order.

Superseding still honours append-only. A copy already sent on an earlier turn
stays where it sits and is retagged as ordinary history with its selector
cleared, and the new copy is appended at the tail. A copy pushed in the current
turn, which no provider has seen, is replaced in place instead, so a view opened
and closed inside one program reaches the window not at all.

### What removes material from the middle

Removing material from the middle of the window reclaims tokens at the cost of
the provider's cache from that position onward. These are the removals:

- `evict_file_view` and `archive_thread`, both
  [invoked by the agent](/gg/agent-managed-context/).
- `gg.views.close(selector)`, bought by the same
  [agent-managed-context](/gg/agent-managed-context/) capability, since closing
  a view is context management too. It sweeps the file, agent-view and
  doc-search bands, because a selector is what the model wrote and it need not
  say which band it meant.
- `gg.docs.close` and `gg.docs.closeAll`, which reach the documentation band and
  are bought by the `docview-close` capability.
- A [compaction](/gg/compaction/) boundary, which rewrites the window wholesale.
