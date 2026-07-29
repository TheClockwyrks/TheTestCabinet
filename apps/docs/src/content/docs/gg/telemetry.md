---
title: "Telemetry"
---

Because gg is **part of The Test Cabinet**, it streams **far richer telemetry** back
than the normalized [event](/components/core/events/)/[metric](/components/core/metrics/)
contract requires, and the backend and console understand it **natively**. And
because gg is [headless](/gg/overview/#how-gg-fits-into-the-test-cabinet) — no TUI of
its own — this stream is the **only** live window into a run, which is why it is
first-party and rich rather than an afterthought.

The telemetry must let the console display:

- The **[Project management](/gg/project-management/)** board and its issue statuses
  (the live, run-global board).
- The **[agents/subagents](/gg/subagents/)** that are running, and the **tree** they
  form.
- For each agent, whether it is **actively executing or blocked** waiting on other
  agents.
- The **[context-window breakdown](/gg/context-visibility/)** over time — the
  stacked line graph.
- **Where each turn's time went** — one `turn_timing` per turn, splitting the turn's
  wall-clock into the three phases it passes through (see
  [below](#where-a-turns-time-went)).
- The **[message log](/gg/context-visibility/#the-message-log-the-exact-requests-de-duplicated)** —
  the exact request each turn sent and the reply it got, streamed as a de-duplicated pool
  of message bodies (`context_message`) plus one pointer list per turn (`prompt`), so the
  console can reconstruct every prompt without the stream carrying a repeated message twice.

The very first event of a session, `session_started`, carries the run's whole
[capability set](/gg/overview/#the-capability-set). That is what lets a console shape
itself to the run from the moment it starts watching rather than only once the run
record lands. A stream recorded before gg announced it simply omits the field, and
the recorded set on the run record stands in.

The console (the live monitor and a finished run's gg tab, which are the **same**
view over the same stream — live, then rebuilt from the recording, and laid out
identically down to the order of the cards) reads a run through these surfaces:

- The **Dashboard** — the whole-run read-out: status, the token/cost tally with its
  **caching** (cached vs uncached input) and **reasoning** (reasoning vs non-reasoning
  output) splits shown as rings, an **overview of the agents** that ran, the enforced
  FSM process, and the configuration the run's [independent variable](/gg/overview/)
  is, plus the two figures that read beside the status: the **turns** the session has
  spent across every agent, and its **tokens / s** — everything the run generated over
  the time it spent inside its model calls, which is the average across every model it
  used (a multi-model run's card names each model's own rate on hover). The two counts
  say how much a run has done and spent; the rate is what says whether the wall-clock
  behind them went into generating or into waiting. The agent overview
  is more than a count: each agent reads as a row carrying its **own turn count**, the
  **peak** its context window reached, its **share of the run's tokens**, and the
  **tools it used** — and each row is a link into that agent's files in the Instances
  explorer, so the whole-run view and the per-agent one are one click apart. The
  **cost** read-out leads the row it shares with the token tally, and is the taller
  tile — it carries the run's whole account of its spend, with the configuration
  slotted in under the tokens beside it. That account is the total, the split **per
  class** (input, cached input, reasoning, output) by pricing each token against the
  model that produced it — never at one blanket rate — the input-vs-output ring, and
  *where* the money went: bars **per slot**, each naming the model that slot was bound
  to, and bars **per model**, the same spend folded onto the models that did it — which
  a per-slot read alone cannot say whenever one model is bound to more than one slot.
  Both are always shown; a run that binds one model per slot lists the same rows twice,
  which is a fact about that configuration rather than a reason to withhold the reading.
  A run binds one model per [agent profile](/gg/configurations/), so every
  `usage` event names the profile and model that spent it; every one of those splits is
  therefore derived from the delta stream, and reads the same on a run spanning five
  models as on one spanning a single model — from the run's first turn, not once its
  agents finish.
  (The end-of-agent `slot_usage` rollups carry the same figures for the durable record;
  a consumer sums the deltas, never both.)
- The **Agents** panel — the run read per **configured agent** rather than per running
  one. A configuration declares agent [profiles](/gg/configurations/) and the run makes
  as many instances of each as the work calls for, so a profile that spawns twelve
  implementers is *one* arm of the experiment, not twelve; this panel groups the
  instances by the profile they ran under and sums them. It is **one collapsible row per
  agent, all closed to begin with**: closed, a row is the comparison line — instances,
  turns, tokens, cost, and peak context, each with its share of the run — so the panel
  is a short list to read down a column of. Clicking a row opens that agent's detail,
  and only that agent's: how many instances ran and how they ended, what a *typical* one
  cost, how full a typical window got against the worst one, how often they compacted,
  the same Tokens and Cost widgets the Dashboard uses, the tools they called between
  them, and the **context spend** described
  [below](#what-filled-the-window-and-what-it-cost). A profile the configuration
  declares but the run never instantiated still gets a row, because "the reviewer never
  ran" is a result. Each instance is a chip that opens it in the Instances explorer.
- The **Project** view — the run-global [Project management](/gg/project-management/)
  board. Because the board is now shared run-wide rather than per agent, it is its own
  top-level section, **not** a file under any one agent.
- The **Instances** explorer — everything else, one running agent at a time. The rich
  views (the prompt the agent was
  given, activity, context-window breakdown, the [message log](/gg/context-visibility/#the-message-log-the-exact-requests-de-duplicated),
  the **metric graphs** — [where each turn's time went](#where-a-turns-time-went),
  then throughput (tokens/s), cost per request, cache-read
  share and reasoning share, each gaining one point per model call and each point
  carrying [the figures behind it](#reading-the-metric-graphs) on hover — plan, tasks,
  knowledge) are inherently **per agent** — *whose*
  window filled, *whose* task list this is — so they cannot honestly be shown as one
  global panel. The explorer lays the run out as a **filesystem**: every agent is a
  folder, the things you can monitor about it are its files, and every agent an agent
  spawned is a folder under a `subagents` folder — so the
  [delegation tree](/gg/subagents/) *is* the directory tree, rooted at the main agent.
  Each agent folder leads with its **lifecycle dot** (running / waiting / done /
  failed) in place of a folder glyph, and carries the profile it runs under on the
  row's trailing edge. Only the main agent is named `root`: an agent the board
  [dispatched for an issue](/gg/project-management/) is a top-level folder *beside* it
  and reads by its own issue-derived name (`AUTH-1.0i`, its reviewers `AUTH-1.0i.0r`),
  everywhere it is named — the tree, its Overview, and the Dashboard's agent overview
  — so a fleet of concurrent agents says which piece of work each one is on.
  A file is offered when the run's configuration justifies it, not when data happens
  to have arrived: a capability the run **has** always has its file (showing its own
  "nothing yet" state until the first event streams), a capability the run **lacks**
  has none, and **Context** is always offered because every run has a window that
  fills. Overview, **Prompt**, and activity are unconditional too — every agent was
  given *something* (for a subagent, the **brief its parent handed it**, which rides
  on the always-present spawn event; for the main agent, its opening prompt), so the
  Prompt file is always there. The **Overview** also carries the agent's own
  **tool-usage breakdown** — the itemized version of the Dashboard row's tool chips:
  every tool it called, how many times, and how much each tool's results added to its
  window — its **working directory** (the isolated
  [worktree](/gg/project-management/) checkout its tools are rooted at, or the shared
  workspace), and, while it is blocked, **what it is waiting on**: `blocked` on its
  own is indistinguishable from stuck, so the wait names its condition (the issue it
  suspended for, or the subagents it is collecting).

## What filled the window, and what it cost

The [context graph](/gg/context-visibility/) says how many tokens each **band** held at
a point in time; the Cost widget says what the run spent. Neither answers the question
a configuration is actually tuned on: *which material drove the bill* — which file sat
in the window for eighty turns, which tool returned output nobody read again, whether
the [autoloaded specifications](/gg/autoload-specifications/) are worth what they cost.
The Agents panel's **context spend** answers it, and the arithmetic is worth stating
because it is not the obvious one.

gg's window is [append-only](/gg/context-visibility/): a turn **re-sends** everything
still in it. A message's cost is therefore not what it cost to bring in once — it is
its size multiplied by every turn it survived. A 900-token specification read on turn 2
of a 90-turn run outspends a 5,000-token file read on the last turn by an order of
magnitude, and any read that ranks material by per-message tokens gets that backwards.

So the console folds the [message log](/gg/context-visibility/#the-message-log-the-exact-requests-de-duplicated)
turn by turn. Each turn's **reported** input tokens (uncached + cached) and the cost
those carry at the agent's model's rates are split across that turn's request messages
in proportion to each message's estimated share of the request. Summing per message —
then per band, per file, and per tool — gives what each is answerable for across the
whole run, grounded in reported usage rather than estimates alone. Two figures come out
of it and they mean different things: the material's **own size** (each message counted
once — what it cost to *bring in*) and its **billed tokens** (the same material summed
over every turn it was resident — what it cost to *keep*). The bars rank the second.

Only the **input** side is attributed. Output and reasoning tokens are what the model
produced, not material the window carried, so they are no file's or tool's doing and
stay with the Cost widget's own account.

Attributing a file view to a *path* is what the `context_message` event's **`label`**
carries: the window item's selector tag — the same tag `evict_file_view { path }`
targets. It rides on the pooled definition (emitted once per distinct message) rather
than on each turn's pointer, because it is a property of the material, not of the turn.
The tag also survives what the message envelope does not: a **locked**, autoloaded
specification is re-framed as a `user` message across a
[compaction](/gg/compaction/) boundary, which discards the `tool_call_id` pairing its
synthesized read was answered under — so the tag is the only thing left that says which
file the biggest band in the window is. A stream recorded before gg carried the tag
falls back to the `read_file` call the view answers; whatever neither resolves is
reported as unattributed rather than dropped, so the file list never quietly
understates the band it decomposes.

## Where a turn's time went

A gg turn is not one operation but three, and they drag for entirely different
reasons. gg therefore emits one **`turn_timing`** per turn, splitting the turn's
wall-clock into the phase it was actually spent in:

| Phase | What it covers |
| --- | --- |
| `promptMs` | **Prompt construction** — draining the agent's inbox, refreshing the pinned blocks, running any triggered [compaction](/gg/compaction/), resolving the offered toolset. From the turn's start to the moment the request was dispatched. |
| `requestMs` | **Request** — the model call itself, including any vision-recovery retry. The same figure the turn's `prompt` event carries as `durationMs`, so the two never disagree. |
| `responseMs` | **Response processing** — dispatching and answering every tool call (or running the turn's [program](/gg/responses-as-code/)), applying the state transitions the turn asked for, and closing the turn. |

The three are a **partition** of the turn, not three independent stopwatches: gg
derives the response phase as the remainder, so they always sum to exactly the turn's
duration. That is what lets the console stack them into one bar per turn with no gap —
each bar's height *is* the turn — on the **Time per turn** graph that heads an agent's
Metrics file. Hovering a bar gives the turn's raw figures and each phase's share.

Because a run can take hundreds of turns and fifty-odd bars is the most that stays
comparable, the graph **windows**: a size control picks how many turns are in frame
and a range control slides that frame over the run. The frame follows the newest turn
until a reader moves it, so a live run keeps showing its latest work.

A turn that ends **abnormally** — a ceiling breached mid-turn, a model call that
failed — still reports a timing, carrying the phases it reached with the ones it never
entered at `0`. The accounting closes when the turn's scope does, which is also why
such a timing lands *after* the event that ended the turn.

## Reading the metric graphs

Under the Time-per-turn bars, the Metrics file plots four per-request figures —
throughput, cost per request, cache-read share, reasoning share — one point per model
call, against the same turn axis the [context graph](/gg/context-visibility/) uses.
A request with no datum for a metric (throughput on a call gg did not time, reasoning
share when the harness folds reasoning into output) is **skipped** rather than drawn
as a zero it did not report.

A point is a single number, and a single number cannot show its own arithmetic.
Hovering one therefore marks it, and names the turn it belongs to, the value plotted,
and the figures that value came from: the tokens generated and the latency behind a
throughput, the input and output tokens behind a price (plus what the provider
actually charged, when that differs from the comparable figure the point plots), and
the numerator and denominator behind a share — 60% of a small prompt and 60% of a huge
one are the same point on the line and nothing like the same request.

The turn leads every tooltip because it is what ties the point to the same turn on the
Time-per-turn and Context graphs, which is the path from *this request was slow* to
*why*.

## Two events every run may end on

Beyond the per-turn model, tool and context events, two carry outcomes a study reads
directly:

- **`code_execution`** — one per **code-shaped turn** of a
  [responses-as-code](/gg/responses-as-code/) run, including a turn whose reply was not a
  program at all, which is what makes its count the exact denominator for every healing
  rate. It carries whether the program ran, how many calls it composed, how long its own
  execution took, the failure if there was one, `finished` — the summary a program passed to
  `finish`, present on exactly the turn that ended the run and absent on every other —
  and `healing`, the record of what gg had to repair before it could run the reply
  (omitted entirely for a clean one). It also carries `compileWaitMs` on the one turn that
  ever needs it: the sandbox's ~13 MB interpreter component is compiled once per process
  and the run starts that compile before its first model request, but starting it early
  only *overlaps* it with the request — so a model that answers quickly, on a container
  with one or two cores, gets its first program back before the warm-up has finished and
  that program compiles the component inside its own span. The field is what separates
  "this program was slow" from "this program paid the one shared compile", and it is
  absent on every turn that did not. A run's conclusion lives in `finished` and nowhere
  else, which is why the console's event feed surfaces it as the agent's own message:
  under this capability every assistant message is a page of TypeScript.
- **`limit_exceeded`** — emitted once by each agent that stops on an
  [execution ceiling](/gg/execution-limits/), immediately before its loop returns,
  carrying which ceiling, what it was set to, what was observed, and after how many
  turns. A structured event rather than only a log line, because "which ceiling ends my
  runs, at what value?" is a question a study asks of thousands of runs, and prose cannot
  be grouped by.

This telemetry is **custom** — a purpose-built structured stream to The Test
Cabinet, designed to carry the live, hierarchical, high-cardinality state above (the
agent tree and the issue board), which pure metrics and plain spans model poorly. A
run **may also** export [OpenTelemetry](/development/observability/)
(spans/metrics/logs, as any run can), but the **primary** telemetry is the custom
channel, not OTel.

It rides an **additional channel** on top of the standard harness contract, so a gg
run is still a valid, scoreable run with the extended telemetry stripped (see
[Overview → How gg fits into The Test Cabinet](/gg/overview/#how-gg-fits-into-the-test-cabinet)).
The custom schema is what [result aggregation](/gg/result-aggregation/) queries, so
the two are designed together.
