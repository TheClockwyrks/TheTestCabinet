---
title: "Context visibility"
---

gg **tracks what is consuming the context window**, broken down by source: skills,
memories, file contents, material an agent composed and showed itself, the
thread/history, tool output, and so on.

- Internally this is the accounting that powers the context-usage signal in
  [agent-managed context](/gg/agent-managed-context/) and the trigger in
  [compaction](/gg/compaction/).
- Externally this breakdown is streamed as [telemetry](/gg/telemetry/) and rendered
  in the console as a **stacked line graph** showing how an agent's context window
  fills over the course of a run, by category.

Context visibility is **not a capability** — it is intrinsic to every gg run and
cannot be switched off; every run emits the breakdown and the message log. The one
thing you _can_ configure here is the [**Context Window Override**](#the-window-a-run-is-measured-against),
a capability that narrows the window a run is measured against.

## The window a run is measured against

gg resolves the fullness denominator per agent, from the agent's own model, in two
steps:

1. **The model's window**, from the [model catalog](/quickstarts/devops/add-or-update-a-model/),
   optionally **narrowed** by the [Context Window Override](/gg/configurations/)
   capability's `windowLimit`.
2. **The working window** — that figure less the summary reserve when
   [compaction](/gg/compaction/#enabling-compaction-shrinks-the-window-the-agent-gets)
   is on.

**gg holds no model table of its own.** The catalog the backend owns is the single
store of model facts, so the window is resolved _where the catalog lives_ and
**pushed into the run** when it is triggered: at enqueue the backend looks up every
model the capability set binds and stamps the figures onto the launch, which carry
through the driver into gg's invocation. A run whose [agents](/gg/configurations/#agents)
span several models carries one entry per bound model, so each agent is measured
against its own model's window rather than the root's. A run container never reaches
back out for this.

A model the catalog has not observed yet — the first run against a just-released
model — is fetched from OpenRouter at that moment, for **that model only**, not the
whole catalog.

## A run with no window does not start

If neither the catalog nor a live lookup can answer, **the launch is rejected**.
There is no default window and no guess from the model id.

This is deliberate, and it is the one place gg refuses to degrade gracefully. An
assumed window is not a slightly-worse answer: it is the denominator of every
fullness figure, it decides when [compaction](/gg/compaction/) fires, and it is the
denominator of every share in the
[context-usage signal](/gg/agent-managed-context/) the agent itself steers by. A run against a guessed
window looks completely healthy and measures the wrong thing — and an ablation study
built on it compares runs that were never measured the same way. A rejected launch
tells you the catalog needs the model; a fabricated one tells you nothing.

The check is enforced three times over — the backend refuses to enqueue such a run,
`core` refuses to launch one, and gg refuses to start a session — so no path reaches
a turn without a stated window.

One consequence worth knowing: gg's scripted `mock/…` provider is **test-only
infrastructure**, not a launchable model. No catalog or provider lists it, so it is
refused by this same rule rather than by a special case; it reaches gg only from a
test that builds the invocation itself and supplies the windows a launch would have.

`windowLimit` can only make the window _smaller_. The model's real window is a hard
limit, so a larger value is not a configuration gg can honor; it is clamped back
down to the catalog's figure rather than rejected, so a study that misjudged a window
still runs. Narrowing it is how you exercise compaction against a million-token model
**without spending a million tokens of input per boundary**: give the run a 100k
window and the same summarize-and-restart behavior plays out an order of magnitude
sooner and cheaper.

This narrowing is its own capability — **Context Window Override** — **off by
default**, so a normal run is measured against the model's full window. Turning it on
with a `windowLimit` narrows the window; a value of `0` (or a disabled override) narrows
nothing. It is the one lever that touches this window: context visibility itself is not a
capability and cannot be switched off.

## Reading the graph

The graph is framed to **what the run used**, not to the window: its top is the
tallest stack so far plus a quarter again, capped at the window limit. A run that
uses 40k of a million-token window would otherwise draw as a flat line along the
axis — the composition the graph exists to show, unreadable. The dashed window-limit
rule appears once the frame actually reaches it.

The legend lists only the sources this run's [configuration](/gg/configurations/)
can produce: with [skills](/gg/skills/) disabled there is no Skills band to explain.
A source that holds tokens is never hidden, whatever the configuration says, so
nothing can silently drop out of the stack.

The bands give the window's **shape**; the figures come on **hover**. Pointing at any
turn marks it with a rule and gives that turn's whole composition — the window total,
how full the window that makes it, and every band's tokens and share, with the band
under the pointer marked. Every band at a turn carries the same breakdown, because the
question a reader has at a bulge is what the window held *then*, not only how tall that
one band was; the marker is what says which band they are pointed at. The rows keep the
graph's fixed source order rather than sorting by size, so the same window never reads
differently from one turn to the next.

## The message log: the exact requests, de-duplicated

The graph shows the window's _composition_; the **message log** shows its _contents_ —
the precise messages gg sent the model each turn, and the reply it got back. It is the
itemized companion to the graph, and the console renders it as a **Requests** file beside
Context in the [Instances explorer](/gg/telemetry/). Reading it, a turn's request is no
longer a stack of coloured bands but the actual system prompt, build prompt, tool results,
and file views that filled them — each tagged with the band it occupies (the same palette
as the graph) and its own estimated token cost, so a band on the graph and the messages
that make it up line up one to one.

Recording every turn's whole prompt verbatim would be quadratic: because the window is
[append-only](#the-window-renders-as-an-append-only-prompt), the overwhelming majority of a
turn's messages are byte-identical to ones sent on earlier turns. So the log is
**content-addressed**. Each message is fingerprinted by its content and its body is streamed
**once**, the first time it appears; every turn is then a sequence of **pointers** into that
shared message set — the request as an ordered list of ids, plus the id of the reply (which,
being a message too, is pooled and reappears as a pointer on the next turn). A message that
sits unchanged in the window for forty turns costs one body and forty pointers, not forty
copies. The pool is **per agent**, so each agent's stream carries the definitions its own
prompts reference and reads on its own.

An attached image is logged as a **descriptor** — its media type, decoded size, and the
tokens it is charged — never its base64 bytes: a request log exists to show what was sent,
and a multi-megabyte inline picture is neither readable nor worth storing once per unique
read.

A pooled message also carries its window item's **selector tag** (`label`) where it has
one — for a **file view**, the workspace path it shows; for an **agent view**, the label
the agent opened it under. That is what makes the window's
_material_ attributable and not merely its bands: it is how the console totals a run's
context spend **per view** (see
[what filled the window](/gg/telemetry/#what-filled-the-window-and-what-it-cost)), and,
because the tag is a property of the item rather than of the message envelope, it is
what survives a [compaction](/gg/compaction/) re-framing a pinned view as a `user`
message and dropping the `tool_call_id` pairing its read was answered under.

The log and the graph are both context visibility, which is intrinsic to every gg run —
there is no capability to switch it off — so every run emits both, and the Requests file
is always offered.

## The window renders as an append-only prompt

**A turn never rewrites what an earlier turn already sent.** Everything already in the
window stays exactly where it is, byte for byte; a turn only _appends_. This is a rule
gg holds itself to, not an implementation detail, because it is the whole basis of
provider **prompt caching**: a request reads the cache only for a prefix the provider
has already seen, so any edit _behind_ the end of the prompt throws away the cache for
every message after the edit. On a long run that is most of its token bill.

Two kinds of state make that non-trivial.

**Mutable blocks.** The memory block, the task list, and the
[Project management](/gg/project-management/) board are each rebuilt from their backing
store at every turn boundary so the model always sees current state, and each is a
_single_ live block. Two rules keep the rebuild append-only:

- **An unchanged block does not move.** When it comes back byte-identical the rebuild is
  skipped and the block keeps its position, rather than being lifted to the tail behind
  the history accumulated since. Re-appending an unchanged block would rewrite the prompt
  just before its end _every turn_, so no turn would ever extend the last one.
- **A changed block is superseded, not removed.** The old copy is left exactly where it
  sits and retagged as ordinary ephemeral history; the new one is appended at the tail.
  Deleting it instead would be at its most expensive precisely when the block had held
  still longest, since that is when the most history sits behind it.

A superseded copy is the honest record of what the model was told at that point in the
thread — no different from a tool result — and the model reads the newest block as
current. It costs one block's worth of tokens per real change, is accounted as history
rather than inflating the source's own band, and a compaction summarizes it away.

The [context-usage signal](/gg/agent-managed-context/) is deliberately **not** one of
these blocks. Its figures move every turn — that is the whole point of it — so as a block
in the thread it would supersede itself every turn and leave a trail of stale readings
behind it. It is rendered instead from a **slot of its own, after the whole conversation**,
so it is always the last message of the prompt: everything a cache can read sits _before_
it, rewriting it invalidates no prefix, and assigning the slot overwrites rather than
accumulates. It is exactly because it costs nothing to rewrite that it can report exact
figures rather than rounded ones.

**The system prompt is the same shape at the other end.** It, too, is a slot rather than a
thread item — always the **first** message of the prompt, never one of the items. That is
what makes it safe for one agent to hand its whole conversation to another: the prompt
describes the *agent* (its toolset, its roster, its ending calls), not the conversation, so
it is the one thing a [succession or a fork](/gg/fork-and-exec/) must not carry. A
transferred window arrives with the slot empty and the successor's loop sets its own, which
also means a window can never end up carrying two `system` messages — a provider that
concatenates them (Anthropic's shape does) would otherwise hand the model one instruction
block naming two toolsets and two sets of ending calls.

**File views.** A `read_file` result is a snapshot of the file _as it was read_, and
nothing later rewrites it — not a `write_file`, not an `edit_file`, not a re-read. Each
read appends its own view. So the agent's own writes never silently rewrite the prompt
behind them, and an agent that needs the current contents of a file it has changed reads
it again, which appends. This is also the honest reading: the earlier view is what the
agent actually saw at that point, and editing history to show contents the agent never
read would be a lie about the thread as well as a cache miss.

How much _enters_ the window per read is configurable: under a capped
[read mode](/gg/filesystem/#read-modes) a view holds only the window that call returned,
and paging through a file appends one view per page.

**Views a program opened.** Under [responses as code](/gg/responses-as-code/) a program
puts material in front of itself by opening a **view** — `view.openFile(path)` for a file,
`view.openText(label, body)` for something it computed — and gg pushes one message per open
view into the next prompt. A file view lands in the same band a `read_file` result does; a
text view lands in a band of its own, **Agent views**, keyed by the label the agent gave it.
The band is separate because the *authorship* is: a file view is workspace material with an
on-disk truth behind it, tool output is gg's own reporting back to the agent, and an agent
view exists nowhere but the window.

Re-opening a selector **supersedes** the view that was under it, which is the one place this
page's append-per-read rule does not apply — and the difference is what the two calls name:

- `read_file` names an **action**. It happened; it returned what the file said at that
  moment; each one appends. Collapsing two reads would be rewriting the thread.
- `view.openFile` / `view.openText` name an **intent** — _this should be visible to me_.
  Re-stating an intent replaces it. A program that loops over changed files and re-opens
  each one would otherwise pile up a duplicate per turn, and the per-item accounting the
  view mechanism exists to deliver would be worse than the single blob it replaced.

Superseding still honours append-only: a copy already sent on an earlier turn is left where
it sits and retagged as ordinary history with its selector cleared, and the new copy is
appended at the tail — exactly what a changed mutable block does. A copy pushed **in the
current turn**, which no provider has seen, is replaced in place instead, because there is
no cached prefix to protect and no history worth keeping; a view opened and closed inside
one program therefore reaches the window not at all.

Four things do remove material from the middle of the window, and each is a deliberate
choice whose point is to reclaim tokens: `evict_file_view` and `archive_thread`, both
[invoked by the agent](/gg/agent-managed-context/); `view.close(selector)`, which a code-mode
program may call whether or not it holds the agent-managed-context capability, since closing
what it opened itself is not a privilege; and a [compaction](/gg/compaction/) boundary, which
rewrites the window wholesale. Each necessarily resets the cache; that is the price of the
space they buy back.
