---
title: "Overview"
---

**gg** is The Test Cabinet's own coding harness — the first authored _inside_ this
repository rather than integrated from a third party, and the headline feature of
**v0.7.0**. This section documents its design: what gg is, how a run is configured,
how it fits into The Test Cabinet, and each capability it ships (one page per
capability).

gg lives in **its own top-level section**, not under
[Harnesses](/harnesses/overview/). That catalogue describes third-party tools The
Test Cabinet integrates with from _one_ side; gg is different in kind. We own
**both sides**, so gg is a distinct **run mode** with its own configuration
surface, its own result views, and its own comparison space — a first-party
subsystem of The Test Cabinet, not a ninth entry in the harness catalogue.

## How gg fits into The Test Cabinet

gg is its own run mode, separate from the existing harness-driven runs — not a
`(harness, model, orchestrator)` point in the current pipeline. Three consequences
of owning both sides drive that separation:

- **Its configuration surface is much richer and unshared.** A conventional run is
  a flat tuple of harness + model + orchestrator. A gg run is configured by a
  [capability set](#the-capability-set) — a set of **per-agent
  [profiles](/gg/configurations/#agents)**, each with its own capabilities, tool
  implementations, and one **possibly cross-provider model**. None of that maps onto
  the existing run dimensions, so gg gets its own
  configuration space rather than overloading them.
- **Its results belong in a separate comparison space.** The current metric graphs
  plot results **per model**, precisely because the third-party harnesses are so
  similar that which harness ran barely matters. gg breaks both assumptions: it is
  deliberately _not_ similar, and a run whose agents span several models has **no
  single model to plot**. Lumping gg in would distort both the existing graphs and gg's own data,
  so gg results are surfaced **separately**, in views built for them (the agent
  tree, the run-global project board, context-fill graphs, and
  [Kibana-style aggregation](/gg/result-aggregation/)).
- **It is invoked directly, not as an orchestrated subprocess.** The
  [orchestrator](/orchestrators/overview/) layer exists to loop a _stateless
  external harness_ across sessions, because such a harness cannot continue past
  its own context window — the reason the built-in that did so (`ralph`) has been
  removed now that gg exists. gg continues _within_ one logical session
  via [compaction](/gg/compaction/) and integrates directly with The Test Cabinet,
  so there is **no external session loop, no `tcab-session` wrapper, and no harness
  subprocess** to orchestrate. The orchestrator dimension does not apply to a gg
  run: gg **is** the executor.

What gg **does** reuse is the shared run _infrastructure_, since that is
test-case-level, not harness-level: the run container, the test case's seeding and
`init`, the run's maximum-runtime bound, and the
[validation](/components/core/validation/) and scoring of the produced game. A gg
run still yields a playable, scoreable, reviewable artifact — it just gets there
through its own executor and records a far richer run record on the way.

gg is **headless**: it has no TUI and no direct user interaction of its own. It is
configured, launched, and monitored **entirely through the Test Cabinet UI** — the
capability set is assembled there as a named
[configuration](/gg/configurations/), launched from the ordinary new-run form by
picking gg as the orchestrator, and the [telemetry](/gg/telemetry/) channel is a
run's only live window into what its agents are doing. Building that UI is therefore
not a follow-on to gg but a **co-requirement**: each capability ships with the UI to
drive and observe it, from the very first runnable version onward.

## The capability set

gg is a **small core** — the agent turn loop, tool dispatch, and message transport
— plus a set of independently pluggable **capabilities**, one per page in this
section. Every capability is:

- **Toggleable.** It can be switched off entirely. With a capability off, gg
  behaves as if the feature does not exist — no tools for it are exposed to the
  model, no [prompt text](/gg/prompts/) describes it, and it consumes no context.
  This is the basis for **ablation studies**: run the same model on the same test
  case with a capability on and off, and the difference is attributable to it.
- **Configurable.** A capability that is on can be parameterized (for example the
  compaction trigger threshold, the subagent parallelism cap, or the memory
  budget).
- **Swappable**, where it matters — by offering a different tool or a different
  implementation of a tool (see [Modularity](#modularity-through-tools)). This is
  the basis for **A/B comparisons** between two implementations of the same
  capability.

A gg run is configured by a **capability set**: one or more per-agent
[profiles](/gg/configurations/#agents) — each with its own enabled capabilities,
their implementations and parameters, and one model binding — plus the run-level
model slots and limits. The capability set is the
_independent variable_ of an experiment — freeze the model and the test case, vary
the capability set, and the harness becomes a laboratory. It must be:

- **Declarative and inspectable** — expressible as data, so a run's exact
  configuration is recorded and reproducible, not implied by code.
- **Recorded on the run** — captured in the run record and surfaced in the console,
  so every result is traceable to the exact configuration that produced it (this is
  what makes an ablation study analyzable after the fact; see
  [Result aggregation](/gg/result-aggregation/)).
- **Named / preset-able** — common configurations ("full", "minimal",
  "no-compaction", "memories-A") should be nameable presets, so a study is a sweep
  over presets rather than hand-assembled flag soup. A named capability set is a
  [configuration](/gg/configurations/): registered on an operator's account, then
  picked by name when a run is launched.

The set carries one thing that is _not_ a capability: the run's
[**execution limits**](/gg/execution-limits/) — the ceilings on turns, wall clock,
consecutive errors, recent error rate and cost that stop a run and record which one
stopped it. They live here rather than among the capabilities because a capability is a
feature under ablation while a ceiling is an operator's guardrail over all of them, and
because the set is what a run _records_, so a run stopped by a ceiling carries both the
breach and the ceiling that produced it.

The capability set is a **first-class Test Cabinet concept** that **replaces** the
`harness + model + orchestrator` tuple for a gg run (only the test case and variant
carry over — those are test-case-level). Making it first-class is what keeps an
experiment reproducible and lets [result aggregation](/gg/result-aggregation/)
slice results by configuration natively, and it is a large part of the Test Cabinet
UI work gg requires, since none of the existing run-configuration or result
surfaces fit it.

## Modularity through tools

Modularity is deliberately kept cheap. gg ships **one or more agent-loop
implementations**, and _beyond that_ modularity comes almost entirely from **which
tools are offered to the agents** — a different set of tools, or a different
implementation of a given tool, reconfigures behaviour without a combinatorial
explosion of pluggable subsystems. So "swap the compaction strategy" or "swap the
memory strategy" is, in practice, "offer a different tool (or tool implementation)
for it", not a bespoke plugin interface per capability. The agent loop is the only
coarse-grained plug point. Treating the toolset itself as an experimental variable
is [toolset ablation](/gg/toolset-ablation/).

## Prompt caching

An agent loop re-sends its whole conversation every turn, so most of what a run
pays for is the same tokens over and over: the system prompt, the tool schemas,
the build prompt, any [autoloaded specifications](/gg/autoload-specifications/),
and the thread so far. Provider prompt caches exist to make that cheap, and gg
asks for one on every request.

Two separate things have to be true for a cached read to happen, and gg does both:

- **The request has to reach the endpoint that holds the cache.** Every client in a
  run stamps the same **`session_id`** — the run's session id, shared by the root
  agent and every [subagent](/gg/subagents/) — so a run's turns stay on one
  provider endpoint, and agents that open on the same prefix reuse each other's
  warmed cache rather than each paying to warm their own. `session_id` is
  OpenRouter's sticky-routing key; gg sends the same value as `prompt_cache_key`
  too, for the providers that read the OpenAI-style field instead. Sending only
  `prompt_cache_key` is not enough — OpenRouter treats it as a fallback, and
  without a sticky key it is free to balance byte-identical requests across
  endpoints, which reads as a 0% cache rate turn after turn even when the provider
  *name* never changes.
- **The request has to say what to cache.** OpenAI and Gemini cache long prefixes
  implicitly, but Anthropic caches _only_ what a request explicitly marks with
  `cache_control`. Marking nothing means caching nothing — an Anthropic run is
  billed at the full input rate on every turn no matter how much of the request is
  byte-identical to the last one.

gg marks up to four breakpoints per request (Anthropic's cap): one **anchor** at
the end of the opening context — everything before the first assistant turn, which
covers the tool schemas, the system prompt and the autoloaded specs, and never
moves for the life of the agent — up to two **rolling** points over the
accumulating thread, and one at the **tail**, which writes this turn's prefix so
the next turn can read it. The rolling points are snapped to a fixed grid of
message indices so that they name the same prefix from one turn to the next; a
marker at a shifting offset would describe a prefix no earlier turn ever wrote,
and so would never be a cache hit.

The markers go **only** to the Anthropic family, which is the family that caches
nothing without them. Every other provider gg reaches caches long prefixes
implicitly, and for those the markers are worse than useless: `cache_control` has to
ride a content block, so marking a text-only message promotes it from a bare string
to a one-element array — and because the rolling breakpoints move every turn, the
same message then goes out as a string on one turn and as an array on the next.
Anthropic normalizes both to content blocks and never notices. A provider matching
the forwarded OpenAI-shaped payload sees the prefix change underneath it and re-bills
the request in full, which is why gg marked requests read 0% on turns that read 98%
unmarked.

How long those entries live is a **per-agent** setting — the
[prompt-cache lifetime](/gg/configurations/#prompt-cache-lifetime) on each agent
profile. Left alone, every entry takes the provider default of five minutes. An agent
switched to the **extended** (one-hour) lifetime asks for it on its anchor and rolling
points only; the tail keeps the default whatever the agent is set to, because it is
rewritten every turn and read exactly once, by the turn immediately after it — an hour
would pay the higher write premium for material superseded in seconds.

The five-minute default is written for a chat turn, not a harness turn: one gg turn can
run a build, a test suite or a browser pass, and every agent in a run shares one runtime
thread, so the gap between one agent's successive requests can be minutes. A gap past
five minutes means the next turn re-sends a prefix whose entry has expired, and is
billed for it in full. But the extended lifetime is charged a higher write premium — on
Anthropic, 2× the base input rate against five minutes' 1.25× — so it is worth buying
only for the agents that actually come back to their context that late, which is why it
is set per agent rather than for the run.

This is also why [compaction](/gg/compaction/) and
[agent-managed context](/gg/agent-managed-context/) go to such lengths to keep the
window **append-only**: a cache is read by matching a prefix, so rewriting anything
already sent — even a single line in the middle of the prompt — discards the cached
prefix from that point on and re-bills the rest of the request in full.

## Installation & distribution

gg is installed by context. **Locally**, it runs with **no external resources** — a
hard requirement for rapid iteration, so a developer can exercise it fully offline
from a local build. **In k8s**, it is **published as a GitHub release and
downloaded from there** at run time — the same shape as the third-party harnesses'
install step, but pulling our own release rather than a public registry.

The release asset is a bare static-musl executable named `gg-<target>`, hanging off
the release tag `v<version>`, published for both `x86_64` and `aarch64` (the
architecture is chosen by the *driver* asking, not by the run container). The version
in that URL is `core`'s own — and `gg --version`, read out of the run container, is
what a run records as its `subject.harnessVersion`, so the two crates are versioned in
lockstep. See [Releasing `gg`](/development/releasing/#releasing-gg).

## Capabilities

Each capability has its own page. They are grouped here by concern for reading; the
grouping is editorial, not a structural distinction. How a capability set is named,
saved, launched, and analyzed in the console is
[Configurations](/gg/configurations/).

**Context**

- [Autoload specifications](/gg/autoload-specifications/) — seed an agent's opening
  context with the whole test-case brief, optionally locked in place.
- [Compaction](/gg/compaction/) — summarize and restart a thread to continue past
  the context window.
- [Context Window Override](/gg/context-visibility/#the-window-a-run-is-measured-against)
  — narrow the window a run is measured against, to exercise compaction against a
  large-window model cheaply. (The per-source [context visibility](/gg/context-visibility/)
  accounting itself is intrinsic, not a capability.)
- [Agent-managed context](/gg/agent-managed-context/) — let an agent evict file
  views and archive thread history.
- [Modules](/gg/modules/) — what an agent *holds* rather than what it can do: the six
  units of per-agent state, whether its prompt carries each one, and what happens to
  them when it is copied or succeeded. Not a capability of its own — the model every
  other capability's state is kept under.

**Knowledge**

- [Skills](/gg/skills/) — pre-authored markdown, description shown up front, body
  retained across compaction once read.
- [Memories](/gg/memories/) — the same, but curated by the model itself, and
  bounded.

**Work tracking**

- [Tasks](/gg/tasks/) — a lightweight blocked-by DAG of to-dos.
- [Project management](/gg/project-management/) — a run-global board of scoped,
  auto-dispatched work items.

**Delegation**

- [Subagents](/gg/subagents/) — spawn, parallelize, block on, and message other
  agents.
- [Workflows](/gg/workflows/) — declared subagent fan-out plus sequencing.
- [Speculative execution](/gg/speculative-execution/) — best-of-K attempts judged
  to a winner.
- [Agent persistence](/gg/agent-persistence/) — make one profile a single long-lived
  worker: one instance runs at a time, and each opens on the files the last one left
  open.
- [Fork & exec](/gg/fork-and-exec/) — let an agent become a different agent, carrying
  its conversation with it, or run a copy of itself that starts already knowing
  everything it knows.

**Process & quality**

- [FSM-driven processes](/gg/fsms/) — a state table the agent is driven through, each
  state running an agent profile of your choosing and each transition naming the
  modules the next state inherits.
- [Completion](/gg/completion/) — how a run decides it is finished: the completion
  signal, and the optional validation commands that gate it.

**Models & tools**

- [Shell](/gg/shell/) — run commands in the run container, and the output-offloading
  mode that keeps a chatty build out of the context window.
- [Filesystem tools](/gg/filesystem/) — read, write, edit, and list files; one
  capability per tool, and `read_file`'s read modes.
- [Toolset ablation](/gg/toolset-ablation/) — treat the offered toolset as an
  experimental variable.
- [Responses as code](/gg/responses-as-code/) — agents emit code run in a wasmtime
  sandbox instead of discrete tool calls.
- [Response healing](/gg/response-healing/) — the counted, disclosed repairs gg makes
  to a reply before running it as a program.

**Observability**

- [Telemetry](/gg/telemetry/) — the custom, first-party stream the console renders.
- [Result aggregation](/gg/result-aggregation/) — Kibana-style queries across many
  gg sessions.
- [Replay](/gg/replay/) — always-on capture of every run's non-deterministic inputs,
  so a session can be replayed exactly.
