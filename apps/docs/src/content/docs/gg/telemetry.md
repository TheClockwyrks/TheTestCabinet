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
- For each agent, **what it was offered to call** — the toolset gg resolved for it, or
  the API objects a [code-shaped](/gg/responses-as-code/) agent's programs bind — because
  a tool that was never on the table and a tool the model ignored are otherwise the same
  silence (see [below](#what-an-agent-is-offered)).
- Every **succession** — an [`exec`](/gg/fork-and-exec/), a `fork`, or an
  [FSM transition](/gg/fsms/). One `agent_transition` on the outgoing instance's stream
  carries what happened to each [module](/gg/modules/) — one row per kind naming its
  disposition (`carried`, `copied`, `linked`, `dropped`, `initialized`, `absent`) and the
  store id on each side of the handoff — and an `fsm_state` on the incoming one names the
  machine, the state, and the state it came from. Without them a handoff would arrive as
  an unexplained second agent.
- The **[context-window breakdown](/gg/context-visibility/)** over time — the
  stacked line graph.
- **Where each turn's time went** — one `turn_timing` per turn, splitting the turn's
  wall-clock into the three phases it passes through (see
  [below](#where-a-turns-time-went)).
- **How each turn ended** — one `turn_outcome` per turn, carrying gg's own judgement of
  whether the turn did what it declared, why it did not, and how long the agent's failing
  streak is (see [below](#how-a-turn-ended)). Without it a run's error rate is only
  observable for the runs a [ceiling](/gg/execution-limits/) actually stopped.
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
  output) splits shown as rings, an **overview of the agents** that ran, and the
  configuration the run's [independent variable](/gg/overview/)
  is, plus the figures that read beside the status: the **turns** the session has
  spent across every agent, and its **tokens / s** — everything the run generated over
  the time it spent inside its model calls, which is the average across every model it
  used (a multi-model run's card names each model's own rate on hover). The two counts
  say how much a run has done and spent; the rate is what says whether the wall-clock
  behind them went into generating or into waiting. Next to the turn count sits the
  **errors** card, which shares its denominator: how many of those turns failed, what
  fraction that is, the longest failing streak any one agent reached, and
  [which way they failed](#how-a-turn-ended) — because "the run finished" and "the run
  finished having failed a third of its turns" are very different results. Beside them the
  **runtime** states
  the run's two clocks, because either alone misleads: the **wall clock** the run has
  occupied (what the [timeout](/gg/execution-limits/) is measured against), and under it
  every agent's **active** time summed — the gap between the two being the parallelism
  the configuration bought. Active means *working*: an agent blocked waiting on its
  [subagents](/gg/subagents/) or on a [board issue](/gg/project-management/) has freed
  its running slot and is doing nothing, so its wait is left out of the sum and stated
  after it (`active 1h 12m across 9 agents, 46m waiting`) rather than folded in — a
  delegating run whose parents mostly wait would otherwise report a figure several times
  the work it actually did, growing with every level of the tree. The agent overview
  is more than a count: each agent reads as a row carrying its **own turn count**, the
  **peak** its context window reached, its **share of the run's tokens**, and **what it
  called** — chipped in that agent's own vocabulary, so a tool-calling agent's chips name
  its tools and a [code-shaped](/gg/responses-as-code/) one's name the API functions its
  programs wrote (`fs.readFile`, not the `read_file` gg dispatched to serve it). Each row
  is a link into that agent's files in the Instances
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
  the same Tokens and Cost widgets the Dashboard uses, what they called between
  them, and the **context spend** described
  [below](#what-filled-the-window-and-what-it-cost). A profile the configuration
  declares but the run never instantiated still gets a row, because "the reviewer never
  ran" is a result. The detail **leads** with the profile's **instances** — one chip
  each, opening that instance in the Instances explorer — because they are the concrete
  thing the row was opened to reach: every figure under them is a sum over them, and a
  reader after one particular instance should not have to scroll past the arm's
  configuration to find it. What the profile *asked for* (the capability chips) and what
  gg **resolved out of them** annotate those instances, in that order: the offered set,
  headed **Tools** or **APIs** by the mode the instances reported answering in, is the
  same statement the chips make one step later — see
  [what an agent is offered](#what-an-agent-is-offered). It is a **union** across the
  profile's instances and pointedly not a sum: an offered set is not a quantity, and
  instances of one profile legitimately differ, since where an instance stands in its
  [machine](/gg/fsms/) gates what it may call — so an entry only some of them were
  offered carries the fraction that says so rather than being averaged away or dropped.
  An entry the profile never called reads a real `0×` and is muted rather than removed,
  which is the whole contrast; the observed-usage section at the foot of the detail is the
  other half of it, and the two are deliberately separate read-outs. That section is headed
  by the surface its instances actually called on — **API calls** for a
  [code-shaped](/gg/responses-as-code/) profile and **Tool calls** for a tool-calling one,
  the same split the **Failed API calls** / **Failed tool calls** ranking makes
  [below](#what-an-agent-is-offered) — and it itemizes the profile in that surface's own
  vocabulary. Heading a code profile's usage *Tool calls*, three lines under an offered
  section already reading it as APIs, put two halves of one panel in disagreement about
  what the profile did.
  Under the offered set sits the one read-out on the panel that is **not** a sum: what this
  profile's instances *hold*. Module state does not fold — twelve instances may be reading
  one store or twelve, and which of those it is *is* the configuration under test — so
  each [module](/gg/modules/#the-agents-tab-what-a-profiles-instances-hold) kind states
  its distribution instead, and the one shape whose contents honestly belong to the agent
  (a single store every instance binds at once) shows them inline, framed as the agent's.
- The **Project** view — the run-global [Project management](/gg/project-management/)
  board. Because the board is now shared run-wide rather than per agent, it is its own
  top-level section, **not** a file under any one agent.
- The **Instances** explorer — everything else, one running agent at a time. The rich
  views (the prompt the agent was
  given, activity, context-window breakdown, the [message log](/gg/context-visibility/#the-message-log-the-exact-requests-de-duplicated),
  the **metric graphs** — [where each turn's time went](#where-a-turns-time-went),
  then throughput (tokens/s), cost per request, cache-read
  share and reasoning share, each gaining one point per model call and each point
  carrying [the figures behind it](#reading-the-metric-graphs) on hover) are inherently
  **per agent** — *whose* window filled, *whose* requests these were — so they cannot
  honestly be shown as one global panel. The explorer lays the run out as a
  **filesystem**: every agent is a
  folder, the things you can monitor about it are its files, and every agent an agent
  **spawned** is a folder under a `subagents` folder — so the
  [delegation tree](/gg/subagents/) *is* the directory tree, rooted at the main agent.
  What the agent **holds** rather than what it did lives one level in, under a
  [`modules` folder](/gg/modules/#the-instances-tab-a-modules-folder-per-agent) of its
  own: a file per module, each stating which store it is, who else is holding it, and
  what it costs this window — so an agent's own files stay facts about the agent, and a
  store that four agents share is legible as one store from any of them.
  An agent that did not spawn but **succeeded** another — an
  [`exec`](/gg/fork-and-exec/) or an [FSM transition](/gg/fsms/) — is not delegation and
  is not drawn as such: it hangs directly off its predecessor's folder, tagged with where
  it came from (`⇢ verify`, `⇢ exec`), so a chain of incarnations reads as the one lineage
  it is rather than as N unrelated agents that happened to appear in order. A
  [`fork`](/gg/fork-and-exec/) *is* a genuine child and does go under `subagents`, tagged
  `⑂ fork` so a copy reads as a copy. Either way the arriving agent's Overview states what
  it inherited — the state it entered, and which [modules](/gg/modules/) were carried,
  copied, linked, dropped and started fresh — and both halves of the handoff appear in
  the activity feed on the streams they actually landed on.
  Each agent folder leads with its **lifecycle dot** (running / waiting / done /
  failed) in place of a folder glyph, and carries the profile it runs under on the
  row's trailing edge. Only the main agent is named `root`: an agent the board
  [dispatched for an issue](/gg/project-management/) is a top-level folder *beside* it
  and reads by its own issue-derived name (`AUTH-1.0i`, its reviewers `AUTH-1.0i.0r`),
  everywhere it is named — the tree, its Overview, and the Dashboard's agent overview
  — so a fleet of concurrent agents says which piece of work each one is on.
  With one exception, a file is offered when the run's configuration justifies it, not
  when data happens
  to have arrived: a capability the run **has** always has its file (showing its own
  "nothing yet" state until the first event streams), a capability the run **lacks**
  has none, and **Context** is always offered because every run has a window that
  fills. Overview, **Prompt**, and activity are unconditional too — every agent was
  given *something* (for a subagent, the **brief its parent handed it**, which rides
  on the always-present spawn event; for the main agent, its opening prompt), so the
  Prompt file is always there. Directly after Prompt sits the one file gated on the
  **instance** rather than on the configuration: what that instance was
  [offered to call](#what-an-agent-is-offered), named **tools** for an agent that
  answers in tool calls and **apis** for a
  [code-shaped](/gg/responses-as-code/) one — the same set reached two different ways,
  and one name for both would misname whichever agent it was not written for. It is
  offered exactly when that instance reported a surface, because a stream recorded
  before gg reported one carries none at all and a file showing an empty toolset for
  those runs would assert the very thing it exists to distinguish. Every row reads
  **count first** — `12× read_file` — because every row names something the instance was
  *given*, so the names are the column that repeats and the figures are the column that
  differs, and a figure in a fixed leading column can be read straight down the list. A
  tool the instance never reached for reads a real `0×` and is **muted rather than
  dropped**, which is the entire point of the file; the row's hover text says the same
  zero in the same words the cell does ("offered, 0 calls") and spends the rest of its
  length on what the figure cannot carry — that this is a finding about something the
  agent *held*, which is not the same finding as one it was never offered and which
  therefore has no row here at all. Beside them sit the tools this
  instance's [ablation](/gg/toolset-ablation/) withheld, marked as such rather than
  merely absent. That withheld list is gg's own, reported on the same
  event rather than re-read from the configuration, so a `disabledTools` entry that
  names nothing gg offers is never shown here as an applied ablation. A code agent reads
  the same thing through its
  objects: one card per object, carrying the one-line description its own system prompt
  introduced the object by, over the functions this instance bound, each carrying **its
  own** count. No gg tool name appears anywhere on that file: gg records a model-facing
  call under the function the model wrote, so a view call, a documentation lookup, an
  ending call, a [program-library](/gg/program-library/) call and the `list` every object
  ends with are counted exactly as a file read is, and three functions over one core
  (`fs.readFile`, `fs.readTextFile` and `view.openFile` all run a `read_file`) are three
  figures rather than one shared between them. The only row with no figure at all is one
  read off a record written **before** gg counted per function — a fact about the record,
  said as one on hover, since a zero there would accuse the model of ignoring everything
  it was given.
  The **Overview** also carries the agent's own call
  breakdown — the itemized version of the Dashboard row's chips: everything it *called*,
  how many times, and how much each call's results added to its window (what it was
  *offered* is the file above; the two are named apart because they are the two halves of
  one question, not one read-out twice). Like every other read-out of what an agent did, it
  is taken on the surface that agent called on and says which in its caption: **Tool
  calls** for a tool-calling instance, **API calls** for a code-shaped one, whose programs
  wrote `fs.readFile` and never uttered the name of the tool underneath it. The API view
  carries no per-entry token column, and its absence is the honest reading rather than a
  gap: a code turn produces no tool-role messages at all, so there is nothing in the window
  to attribute per function. Beside it sits its own **Errors**
  widget (its errored turns against the turns it took, its worst *unbroken* streak of
  them, its ranked [error types](#the-taxonomy-has-two-levels), and — the one reading
  the Dashboard's error row does not carry — the **calls** it failed, ranked by class:
  the run-wide figures on the Dashboard are a sum, in which an instance that failed
  every turn it took and one that failed none are indistinguishable, and a failure class
  summed over every agent names no agent. The call ranking is captioned **Failed API
  calls** for a [code-shaped](/gg/responses-as-code/) instance and **Failed tool calls**
  for a tool-calling one, because those are two records over one core and not one figure:
  the first is what the model's own programs were thrown — including the calls no gg tool
  ever ran — and the second is what gg dispatched. They are never summed, and they are
  never mixed into the turn ranking above them, which counts turns rather than calls) —
  its **working
  directory** (the isolated
  [worktree](/gg/project-management/) checkout its tools are rooted at, or the shared
  workspace), and, while it is blocked, **what it is waiting on**: `blocked` on its
  own is indistinguishable from stuck, so the wait names its condition (the issue it
  suspended for, or the subagents it is collecting).
- The **Modules** explorer — the run read by the **state it holds** rather than by the
  agents holding it, sitting between Instances and Project. Module instances are grouped
  by kind, one row per **backing store** however many agents hold it, and each kind's
  group leads with a whole-run
  [overview](/gg/modules/#the-modules-tab-the-run-read-by-the-state-it-holds) of how that
  capability is actually being used — how many stores exist, how widely they are shared,
  what they cost every turn, and how many were never written to. It exists because the
  Dashboard, the Agents panel and the Instances explorer are all read **per agent**, which
  is the wrong axis for a thing several agents can hold at once: read per agent, one store
  shared by four reviewers looks
  exactly like four stores that happen to agree, and that is the difference between "the
  shared-memory arm worked" and "it silently fell back to private notebooks". Offered
  whenever the run enables a module-backed capability; a shell-only run has no tab,
  because a tab that can only ever be empty is worse than no tab.

## What an agent holds

A [module](/gg/modules/) instance is no longer one-to-one with an agent instance — one
store can be held by several agents at once, carried whole to a successor, or copied when
its holder forks — so the stream carries the store's **[identity](/gg/modules/#identity-which-store-is-this)**
rather than leaving a reader to infer sharing from panels that happen to match. Four
things carry it:

- **`agent_modules`** — the **roster**: one row per module kind, naming the store the
  instance bound (`memories-2`), whether the capability is on, whether the prompt
  [carries](/gg/modules/#ownership) it, how this holder came by it (`created`,
  `inherited`, `profile`, `run`, `transferred`, `forked`), and — for memories — the
  declared `scope` and whether this holder may write. Emitted **once per incarnation, for
  every instance**: the root, every subagent, every successor, immediately after that
  instance's `agent_spawned` (and its `fsm_state`, where it stands in a machine).

  It is the only event that reports a module an agent holds but has **not yet touched**,
  which is what makes a read-only inherited holder that never writes appear in the record
  at all. It deliberately carries no holder count — a count is stale the moment a sibling
  spawns, while every instance's roster together is the exact holder set, live status
  included. Rows are emitted for the kinds the profile switched **off** as well, so an
  [ablation](/gg/toolset-ablation/)'s off arm is legible rather than absent.

  Its `scope` × `origin` pair is worth the field on its own: it is the only place a
  *declared* binding rule and the *resolved* answer to it appear side by side, so a holder
  reporting `scope: inherited` with `origin: created` is one whose inheritance silently
  fell back — which the console reports as a
  [divergence](/gg/modules/#the-agents-tab-what-a-profiles-instances-hold).

- **`module_id` on every state snapshot** — `memory_state`, `tasks_state`, `board_state`
  and `skills_state` each name the store they are a snapshot **of**, not merely the agent
  that emitted them. That is what lets a consumer attribute two agents' identical panels
  to one store rather than to a coincidence, and what lets a store's contents be shown
  once, under the store, rather than N times under N agents.

- **`archive_state`** — what `archive_thread` has put away, emitted as an agent opens (the
  capability being on) and again after every archival, beside the `context_managed` event
  that records the *act*. The two answer different questions: that one is "the window was
  reclaimed by this much", this one is "here is what is now out of it". Entries carry the
  ordinal, band, role and length, plus a **bounded preview** — never the bodies. The
  [archive](/gg/agent-managed-context/) exists precisely so that material is out of the
  request, and re-streaming it would put a second copy of the whole thread on disk for no
  reader's benefit; the searchable body stays recoverable through `search_archive`, which
  is whose question it is.

- **`agent_transition.modules`** — the per-kind account of a
  [succession](/gg/fork-and-exec/), carrying both store ids, so a fork's **linked** board
  and its **copied** task list are distinguishable and a store swapped underneath a
  successor (a `shared` profile re-binding its own instance) is visible as the two
  different ids it is.

## What an agent is offered

A roster says what an agent **holds**. It does not say what the agent may **call**, and
until this release nothing on the stream did: a `tool_call` reports only what an agent
reached for, so *"the model was never given that tool"* and *"the model had it and never
touched it"* arrive as the same silence.

For a [responses-as-code](/gg/responses-as-code/) agent there is a second silence, and it
is on the *called* side: a `tool_call` says what **ran**, not what the model **wrote**. The
two are separate surfaces over one core of typed functions, so a program's `view.openFile`
runs a `read_file`, a `fs.readTextFile` runs the same one, and a `context.list` runs nothing
at all. gg therefore records the model-facing call in its own right:

- **`api_call`** / **`api_result`** — one pair per call a program makes, naming the API
  `object` and the function's language-independent `function` key (`view` / `open_file`),
  and nothing else. No tool name, and no arguments: the `ToolCall` beside a bridged call
  already carries those, and a carve-out's are either trivial (`list("fs")`) or enormous
  (`view.openText(label, body)`). The opening half is emitted **before** the call runs, so a
  bridged `tool_call`/`tool_result` pair and a delegation's whole subtree of child events
  land inside the bracket. `ok` is the verdict the *program* saw, settled after the result
  was converted into what it was handed — which can legitimately differ from the
  `tool_result` beside it. A **tool-calling** agent emits none of these, and a call the
  sandbox refused emits a pair with `ok: false` where the tool layer emits nothing at all:
  the model made the call, and that it went nowhere is a fact about the run's capability
  set. `code_execution.apiCalls` is the turn's total, and legitimately exceeds
  `toolCalls` by exactly those two things. Those are opposite findings — the first is a fact
about the run, the second a fact about the model — and telling them apart is the entire
question a [toolset ablation](/gg/toolset-ablation/) is run to answer. So the offered set
is its own event, the other half of the pair `agent_modules` opens:

- **`agent_surface`** — the **offered set**: how the instance answers a turn
  (`executionMode`, `tool_calling` or `responses_as_code`), every gg tool it was offered
  (`tools`), for a [responses-as-code](/gg/responses-as-code/) agent the namespaced
  API objects its programs bind (`apis`), and the ablation gg really applied to it
  (`withheld`). Emitted **once per incarnation, for every
  instance** — the root, every subagent, every successor — immediately after that
  instance's `agent_modules`, and **un-gated**: an agent offered nothing at all still says
  so, which is a finding rather than an absence. It is never re-emitted, for the same
  reason a roster is not: everything that changes what an agent may call — an
  [`exec`](/gg/fork-and-exec/), a `fork`, an [FSM transition](/gg/fsms/) — mints a new
  agent id, and the arriving instance reports its own surface.

  `tools` is the **resolved** set, read off the registry gg actually hands the provider
  rather than re-derived from anything: after the capabilities this profile has, the
  [modules](/gg/modules/) it really bound, the [memory](/gg/memories/) strategy behind
  them, where the instance stands in its [machine](/gg/fsms/), and the per-tool
  `disabledTools` [ablation](/gg/toolset-ablation/) that strikes a tool whose capability is
  on. Re-deriving it from the run's capability set can know none of those, which is why it
  is a fact the run reports rather than one a console computes. It is populated in **both**
  execution modes: a code agent reaches these same tools through its objects, and its calls
  are recorded under these names.

  It ends with the **ending calls** the agent's dispatched role may finish on — `finish`,
  or a reviewer's `approve` / `request_changes`, or a judge's `select_winner`. Those are
  appended by the loop to every request rather than contributed by a capability, but the
  model is genuinely offered them every turn, and a surface that left them out would answer
  *"was `finish` offered?"* with silence.

  `apis` is present only for a code agent — empty for a tool-calling one, which has no such
  surface rather than an unknown one. One entry per object (`fs`, `view`, `harness`),
  carrying the same one-line description the agent's own system prompt introduced the
  object by and the functions this instance actually bound; an object nothing bound is
  absent rather than listed empty. Every object ends with `list`, the meta function the
  guest seeds onto every object it creates and no tool gates — the
  [directory](/gg/responses-as-code/#reading-the-documentation-is-opening-a-view) a
  program consults to find out what it may call. It is bound but not *catalogued*, since
  the catalogue is reflected out of the SDK's exported signatures and `list` is the
  documentation carve-out's own, so the surface appends it rather than finding it — last,
  where the model's own `object.list()` puts it, so the read-out and the directory the
  model gets for itself agree function for function. Each function names its own
  language-independent **key** (`read_file`, `open_file`, `finish`, `list`), and that field
  is the load-bearing one: every call a program makes is recorded as an `api_call` under
  exactly that key, so it is the join from a bound function to how many times *it* was
  called. No gg tool name appears here at all. A responses-as-code agent does not call
  tools — it writes `view.openFile`, and the `read_file` underneath is gg's business — so
  naming one would report a call the model never made.

  The join is at the grain of the **function**, which is what makes the two halves of the
  contrast trustworthy in both directions. A function with no tool behind it is counted like
  any other, so an ending call and an `object.list()` have figures instead of blanks; and
  three functions over one core (`fs.readFile`, `fs.readTextFile`, `view.openFile` all run a
  `read_file`) are three figures, so a function the model genuinely ignored reads as ignored
  rather than inheriting its neighbour's calls. The only entry with no figure is one from a
  record written *before* gg counted per function, and the console says exactly that — a
  zero there would accuse the model of ignoring what it was given.

  `withheld` is the other side of `tools`: what this instance's per-agent
  `disabledTools` [ablation](/gg/toolset-ablation/) actually took away, which is the
  names it lists that **are gg tools**. A name gg does not know — a typo, a tool since
  removed — is absent from the field, because it withheld nothing: gg warns about it at
  startup and offers the agent exactly the surface it would have had. That is the whole
  reason the field is reported rather than re-read from the configuration, where a
  mistyped ablation is indistinguishable from an applied one, and it is why a consumer
  may state each of these as an applied ablation without checking it against a tool
  vocabulary it has no way to know. A name that *is* here was asked for, which is not
  quite the same as taken: an ablation may also name a real tool no enabled capability
  was contributing, which withholds nothing in practice but is still a deliberate arm of
  a sweep. What was actually offered is `tools`; the two together say which of those
  happened, and neither derives the other. Empty for an agent that ablates nothing.

The [Reference](/gg/reference/) section answers a neighbouring but different question. It
is what gg **can** offer, catalogue-wide, projected out of gg's own definitions; this event
is what **one instance** of **one run** was actually offered, after every gate the
configuration and the run's own shape imposed. A tool present in the reference and absent
from an instance's surface is exactly the interesting case.

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
then per band, per view, and per tool — gives what each is answerable for across the
whole run, grounded in reported usage rather than estimates alone. (The console's own word
for the middle grain is **Views**, since a view is what a window item is: a file the agent
read, or material it composed and showed itself.) Two figures come out
of it and they mean different things: the material's **own size** (each message counted
once — what it cost to *bring in*) and its **billed tokens** (the same material summed
over every turn it was resident — what it cost to *keep*). The bars rank the second.

Only the **input** side is attributed. Output and reasoning tokens are what the model
produced, not material the window carried, so they are no file's or tool's doing and
stay with the Cost widget's own account.

Attributing a view to its *selector* is what the `context_message` event's **`label`**
carries: the window item's selector tag — a file view's workspace path, the same tag
`evict_file_view { path }` targets; the label a program opened an
[agent view](/gg/responses-as-code/#showing-yourself-things) under, which
`view.close(label)` targets; or, for a **docs view**, the name of the function it
documents, which is both its heading (`Documentation: openText`) and what
`view.close(name)` targets. It rides on the pooled definition (emitted once per distinct message) rather
than on each turn's pointer, because it is a property of the material, not of the turn.
The tag also survives what the message envelope does not: a **locked**, autoloaded
specification is re-framed as a `user` message across a
[compaction](/gg/compaction/) boundary, which discards the `tool_call_id` pairing its
synthesized read was answered under — so the tag is the only thing left that says which
file the biggest band in the window is. A stream recorded before gg carried the tag
falls back to the `read_file` call the view answers; whatever neither resolves is
reported as unattributed rather than dropped, so the view list never quietly
understates the band it decomposes. A path and a label are kept apart even when they read
the same: a workspace file called `notes` and a view an agent labelled `notes` are two
different things, and summing them would invent a row that was never in the window.

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

## How a turn ended

gg already **judges** every turn: the same sentence the
[execution ceilings](/gg/execution-limits/#what-counts-as-an-error) are enforced on —
*was the work the turn declared carried out as declared?* — is evaluated once per turn, per
agent. That judgement used to be thrown away when the agent's loop ended. A run that failed
a third of its turns and finished anyway was, in the durable record, indistinguishable from
one that never failed a turn at all.

So one **`turn_outcome`** rides on the stream per turn, emitted from the *one* seam where
gg records an outcome against an agent's ceilings — which is what makes it impossible for
this event and the ceilings to disagree about what an error is. A run emits exactly one per
model call it made:

```jsonc
{ "type": "turn_outcome", "outcome": "error", "error": "transpile",
  "errorType": "transpile_syntax", "consecutiveErrors": 2, "turns": 31 }
```

| Field | What it carries |
| --- | --- |
| `outcome` | `progressed` (the turn did its declared work), `finished` (the turn ended the session — never an error: a session that ends on purpose has not failed), `error`, or `fatal` (gg's own machinery broke, which is recorded so the turn accounting stays whole but is deliberately **not** charged to the model's error budget). |
| `error` | Why, at the **base** level, on an `error` outcome, and **absent on every other** — so `error != null` and `outcome == "error"` are the same statement. One of `model_api`, `transpile`, `program_fault`, `sandbox_limit`, `missing_completion`. |
| `errorType` | Why, **specifically** — the leaf of the two-level taxonomy. Present on exactly the turns `error` is, and its base *is* the `error` beside it: gg holds one value and derives both halves when it emits the event, so the two cannot drift. Absent only on a stream recorded before gg published types. |
| `consecutiveErrors` | This agent's failing streak **after** this turn. |
| `turns` | How many turns this agent has recorded, including this one — its own running total, not the run's, and the same figure its turn ceiling is measured against. |
| `loopAborts` | How many replies [loop detection](/gg/loop-detection/) discarded before this turn produced one. Omitted when zero, which is every turn of every run that left the detector disarmed. |

Two of those need their exact meaning stating, because a reader who guesses will guess
wrong.

**`consecutiveErrors` is `0` on every non-error turn**, including a `finished` or `fatal`
one that followed failures. gg's internal counter is only *cleared* by a turn that carried
out its declared work, so an agent that failed twice and then finished still holds a count
of 2 — but publishing that would put a streak on a turn that did not fail, and would
contradict the field's own definition. The invariant the stream guarantees instead is
simply: `consecutiveErrors > 0` if and only if `outcome` is `error`.

**`consecutiveErrors` is carried rather than re-derived** because the count is **per agent**
and the stream is run-wide. Turns from concurrently running agents interleave arbitrarily,
so a reader folding the stream could only ever reconstruct a run-wide streak — which is an
artefact of scheduling rather than a fact about any agent.

Under [responses as code](/gg/responses-as-code/) this event sits beside `code_execution`
and does not duplicate it: that one reports what a **program** did and exists only in that
mode, while this is the mode-agnostic judgement of the **turn**. A tool-calling run emits
`turn_outcome` too, which is what lets one error rate be compared across both modes. The
turn that used to be silent entirely — a tool-calling turn that ends with no tool call,
where [ending a session](/gg/ending-a-session/) is always an explicit call — is reported
here as `missing_completion`.

### The taxonomy has two levels

The six `error` values are the **base** kinds: *whose layer failed*. They are what an
execution ceiling acts on, what a cross-run comparison groups by, and what every stored run
already keys on — so they do not change, ever. `transpile` in particular keeps a name it
outgrew (it dates from when every program was TypeScript and preparing one meant stripping
its types), because the value is what persisted records carry.

Underneath each of them sits an `errorType`, and that is where the failure is actually
named. gg was already making these distinctions internally and discarding them at the
recording seam — a four-way classification of a model failure was computed only to pick a
word for a log line, a sandbox ceiling was reached through a branch that never looked at
*which* ceiling, and the class the guest types every uncaught throw with was thrown away in
favour of "the program faulted". Twenty-one types, one per distinction gg already had:

| Base kind | Types under it |
| --- | --- |
| `model_api` | `model_auth` (the credential was refused), `model_rejected` (another non-retryable `4xx`), `model_retry_exhausted` (the provider never served the request), `model_response_loop` (it served it and [loop detection](/gg/loop-detection/) discarded every answer), `model_vision_unsupported`, `model_parse` |
| `transpile` | `transpile_syntax`, `transpile_semantic`, `transpile_compile` (the language's compiler read the whole program and rejected it — TypeScript's `tsc` pass), `transpile_lowering`, `transpile_unsupported` |
| `program_fault` | `program_tool_error` (an **uncaught failed call** — the model is fighting the API rather than mis-writing it), `program_unknown_name` (it reached for something this run does not offer it: a name that is not in scope, or a call the host refused as `unavailable` — [the same fact](/gg/responses-as-code/#capability-gating), told two ways by two kinds of guest), `program_throw` |
| `sandbox_limit` | `sandbox_timeout`, `sandbox_out_of_memory`, `sandbox_trap` |
| `toolchain` | `toolchain_failed` (the language's compiler crashed, was killed by its timeout, or is not installed — nothing was decided about the program, so this is the one base kind that is **not** the model's; see [execution limits](/gg/execution-limits/#a-broken-compiler-counts-but-is-not-the-models-error)) |
| `missing_completion` | `missing_completion_no_call`, `missing_completion_compaction` (a prose reply where a compaction was pending — a different failure, answered differently) |

:::caution[`transpile` is empty by construction for an eval-in-guest arm]
A [program language](/gg/program-languages/) whose guest carries its own interpreter — Python
today — hands the model's source straight to that interpreter, so nothing on gg's side ever
reads the program and there is no preparation step to fail. A Python `SyntaxError` is raised by
CPython *while the program runs*, and lands in `program_fault` with every other uncaught
exception. Python therefore records **zero** `transpile` failures however badly its programs are
written, and its syntax errors are not separable in TCQ from a genuine runtime bug.

So a slice on this base kind is not a valid cross-arm comparison: read `transpile` as *"programs
this arm refused before running"*, which is a thing only an arm with a host-side preparation step
does. The same caveat applies to any future arm that evaluates the model's source in the guest.
:::

Every type's id names its base, because a *"top error types"* ranking shows one row per type
with no heading over it. Each also carries a human-readable **label**, and the labels live in
Rust beside the variants and are generated into the TypeScript contract — so a type gg gains
arrives already labelled rather than rendering as a raw wire value in a console, and gg's own
`error` log line names the failure in the same words the console does.

### Why a failed call now says why

The class a failed call was raised with — `not-found`, `invalid-argument`, `limit-exceeded`
— was computed where the failure happened, handed to the program to branch on, and then
dropped at the telemetry seam. Both halves of a call's record now carry it:

- **`tool_result.failure`** — what *ran*. Present on exactly the results whose `ok` is
  `false`, with `other` for a failure raised outside a tool implementation.
- **`api_result.failure`** — what the *model wrote*. This is the **only** record of the class
  for the calls that never reach a tool: a [carve-out](/gg/responses-as-code/) no tool backs,
  and a call the membrane refused before dispatch (a spent wall-clock budget, a name this run
  does not offer).

The two overlap for a bridged call, deliberately, for the same reason `code_execution`'s
`apiCalls` and `toolCalls` do: they are two surfaces over one core and neither is derived
from the other. They are not summed.

### The run rollup

Folded from those same events onto the session summary, so numerator and denominator can
never come from different mechanisms:

```jsonc
"errors": { "turns": 96, "errors": 4, "maxConsecutive": 2,
            "modelApi": 1, "transpile": 2, "programFault": 1,
            "sandboxLimit": 0, "toolchain": 0, "missingCompletion": 0,
            "loopAborts": 7,
            "byType": { "model_response_loop": 1, "transpile_syntax": 2,
                        "program_tool_error": 1 },
            "toolFailures": { "not-found": 12, "invalid-argument": 3 } }
```

`turns` is the denominator and counts every turn whatever its outcome — a `fatal` one
included, so the accounting stays whole even though no ceiling ever observes it. `errors` is
exactly the sum of the six per-kind counters. `maxConsecutive` is the **maximum over
agents** of the per-turn `consecutiveErrors` above, which is the only honest way to summarise
a per-agent counter on a run-wide record, and the peak of the same counter
`maxConsecutiveErrors` is enforced on.

**No percentage is stored.** The error rate is `errors / turns` and the reader divides. A
stored rate is a figure that can disagree with its own denominator — after a rounding change,
a partially recorded run, or a reader that averages two runs' rates — and the one thing that
must be trustworthy here is that the numbers add up.

`byType` is the same errors split by their **specific** type, keyed by the `errorType` wire
id. Two things hold for any run this gg writes: it sums to `errors`, and regrouping it by
each type's base reproduces the six named counters exactly. It is a **map keyed by a string**
rather than by the enum on purpose — a run recorded by a newer gg must still read back in an
older backend or console, and an unknown enum key would fail the whole summary where an
unknown string degrades to one unlabelled row in a ranking. It is omitted from the wire when
empty, which a reader must render as *not recorded* rather than as *nothing went wrong*;
`errors` is what says whether there were any.

`toolFailures` counts **calls**, not turns: every dispatched tool call that failed, by class,
whether or not the program that made it caught the failure. It is a rollup of dispatches, so
a code-mode call that never reached a tool is not in it — those are on the stream as
`api_result` with their class, where a console folds them.

What it deliberately does not count **as an error**: a **tool call that failed inside a
program that carried on** (the program handled it, which is the whole point of the typed
surface, and charging it would make the one capability that expects failures the one that
cannot survive them — it is counted in `toolFailures` instead, because a model fighting the
same `not-found` forty times is one of the most actionable facts a run has), a **healed**
reply ([healing](/gg/response-healing/) repairs the message, not the turn), and **per-agent
attribution** — these are run-wide totals, and the per-agent breakdown lives on the stream,
where every `turn_outcome` rides on its own agent's id.

The console folds the same figures off the live stream for its Dashboard, deliberately beside
the turn count they share a denominator with, because "seven" and "seven of two hundred" are
not the same claim: errored turns, the rate they are of, the longest streak, the per-kind
split, the replies [loop detection](/gg/loop-detection/) discarded when there were any, and
the most common error **types** with their counts. An errored turn renders no row of its own
on the live event feed — gg already logs why a turn failed in its own words, in the recorded
type's vocabulary, and a second row would say the same thing in weaker terms.

Because the whole summary is flattened into the
[query language](/gg/analysis/query-language/)'s document, every field above is directly
queryable — including the open breakdowns, whose keys become fields of their own:

```text
has.summary:true | stats avg(summary.errors.maxConsecutive) as streak by model
has.summary:true | stats sum(summary.errors.byType.program_tool_error) as fighting by model
```

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

Each card is **headed by the agent's figure, not the last request's**, wherever the
metric is a property of the agent rather than of one call: throughput heads with the
agent's whole generation over its whole model time, the same tok/s its Overview states,
and the two shares head with their summed numerator over their summed denominator. Only
*cost per request*, which is per-request by definition, heads with the latest point.
This matters most for throughput: the last request of a session is characteristically
its least representative one — a two-line sign-off pays the same fixed round-trip as a
working turn, so it reads several times slower than the agent ever generated — and a
card headed by it would contradict the Overview beside it.

## Two events every run may end on

Beyond the per-turn model, tool and context events, two carry outcomes a study reads
directly:

- **`code_execution`** — one per **code-shaped turn** of a
  [responses-as-code](/gg/responses-as-code/) run, including a turn whose reply never
  compiled, which is what makes its count the exact denominator for every healing rate. It carries whether the program ran, how many calls it composed, how long its own
  execution took, the failure if there was one, `finished` — the summary a program passed to
  `finish`, present on exactly the turn that ended the run and absent on every other —
  and `healing`, the record of what gg had to repair before it could run the reply
  (omitted entirely for a clean one). It also carries `logs`: every line the program wrote
  with `console.*`, plus `logsSuppressed` for the lines the capture caps dropped. That is
  the **only** record of a program's output — `console.*` is not a channel into the model's
  own window (what a program shows itself is a
  [view](/gg/responses-as-code/#showing-yourself-things), which arrives as its own context
  message), so a log line goes to whoever is watching the run and nowhere else. Both fields
  are omitted for a turn that printed nothing. The same is now true of far more than the
  logs. A program that ran is told **nothing** — an
  [error message carries the error alone](/gg/responses-as-code/), and a successful one
  earns no message at all — so this event and the operator-facing lines gg writes beside it
  on the run's own stream are the *only* surviving record of what a turn actually did: every
  refused call and how many further refusals the cap suppressed, every refused view, every
  view opened, replaced or closed with its selector and token estimate, the roster's count
  of composed calls, a value the program returned and gg discarded, the summary a program
  ended with, and the revocation when a program called an ending function and then threw.
  None of that reaches the model any more, which makes losing it here losing it outright —
  the reason it is written at all. It also carries `compileWaitMs` on the one turn that
  ever needs it: the sandbox's ~13 MB interpreter component is compiled once per process
  and the run starts that compile before its first model request, but starting it early
  only *overlaps* it with the request — so a model that answers quickly, on a container
  with one or two cores, gets its first program back before the warm-up has finished and
  that program compiles the component inside its own span. The field is what separates
  "this program was slow" from "this program paid the one shared compile", and it is
  absent on every turn that did not. Beside it is `compileMs`, which is the *other*
  compile and belongs to the turn rather than to the process: what this turn's
  [language](/gg/program-languages/) spent compiling for it, including any compiler that
  step shells out to — the program itself, each replacement it handed over to, the code
  half of every skill or memory it brought into use, and each on-use script such a read
  queued. It is absent for a language whose prepare step is in-process and free, where the
  figure would be a zero on every turn of every run —
  [JavaScript](/gg/program-languages/#javascript-the-same-arm-unchecked), which is the one a
  checked arm is compared against, and
  [Python](/gg/program-languages/#python-a-guest-that-carries-its-own-interpreter), which has
  no host-side compiler at all, are both that arm — and present on every turn of a
  language that compiles, whether that compiler checks types
  ([TypeScript](/gg/program-languages/#stripped-and-checked), and
  [PureScript](/gg/program-languages/#purescript-a-compiler-in-the-image-a-library-set-in-the-binary),
  whose check is a real type system rather than a gradual one, and the two JVM arms,
  [Java](/gg/program-languages/#java-a-warm-jvm-and-two-compilers-per-program) and
  [Kotlin](/gg/program-languages/#kotlin-a-program-that-is-a-script), whose ~0.3–0.6 s per turn
  through a warm JVM is the largest figure this field carries — and whose readings are directly
  comparable, since the two spend it on one road) or only grammar
  ([Ruby](/gg/program-languages/#ruby-compiled-to-javascript-before-it-crosses)),
  **including the turn whose
  program the compiler rejected**. That turn is the one the field exists for, because it
  is the only reading of that turn which is not zero. The sandbox's own clock starts once
  a program is prepared, so without this field a compiled arm's per-turn compile cost
  would land in neither `durationMs` nor `compileWaitMs` and would be absorbed into the
  turn's response time alongside minutes of `shell` — which is to say two language arms
  could not be compared on what compiling cost them. A run's conclusion lives in
  `finished` and nowhere else, which is why the console's event feed surfaces it as the
  agent's own message: under this capability every assistant message is a page of
  TypeScript.
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
