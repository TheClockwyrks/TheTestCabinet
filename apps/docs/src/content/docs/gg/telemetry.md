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
view over the same stream — live, then rebuilt from the recording) reads a run
through **two** surfaces:

- The **Dashboard** — the whole-run read-out: status, the token/cost tally with its
  **caching** (cached vs uncached input) and **reasoning** (reasoning vs non-reasoning
  output) splits shown as rings, an **overview of the agents** that ran, the enforced
  FSM process, and the configuration the run's [independent variable](/gg/overview/)
  is, plus the **turns** the session has spent across every agent. The agent overview
  is more than a count: each agent reads as a row carrying its **own turn count**, the
  **peak** its context window reached, its **share of the run's tokens**, and the
  **tools it used** — and each row is a link into that agent's files in the Agents
  explorer, so the whole-run view and the per-agent one are one click apart.
- The **Project** view — the run-global [Project management](/gg/project-management/)
  board. Because the board is now shared run-wide rather than per agent, it is its own
  top-level section, **not** a file under any one agent.
- The **Agents** explorer — everything else. The rich views (the prompt the agent was
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
