---
title: "Overview"
---

gg is The Test Cabinet's own coding harness, authored inside this repository
rather than integrated from a third party. This section documents what gg is,
how a run is configured, how it fits into The Test Cabinet, and each capability
it ships.

gg has its own top-level section rather than an entry in
[Harnesses](/harnesses/overview/). That catalogue describes third-party tools
The Test Cabinet integrates with from one side. The Test Cabinet owns both sides
of gg, so gg is a distinct run mode with its own configuration surface, its own
result views, and its own comparison space.

## How gg fits into The Test Cabinet

A gg run is its own run mode rather than a `(harness, model, orchestrator)`
point in the harness pipeline. Three properties keep it separate.

- Its configuration surface is richer and unshared. A gg run is configured by a
  [capability set](#the-capability-set): per-agent
  [profiles](/gg/configurations/#agents), each with its own capabilities, tool
  implementations, and one model that may come from a different provider than
  the next profile's. None of that maps onto the existing run dimensions.
- Its results belong in a separate comparison space. The metric graphs over
  harness runs plot results per model, and a gg run whose agents span several
  models has no single model to plot. gg results are surfaced separately, in
  views built for them: the agent tree, the run-global project board,
  context-fill graphs, and the [analysis section](/gg/analysis/overview/).
- It is invoked directly rather than as an orchestrated subprocess. The
  [orchestrator](/orchestrators/overview/) layer loops a stateless external
  harness across sessions, because such a harness cannot continue past its own
  context window. gg continues within one logical session through
  [compaction](/gg/compaction/) and integrates directly with The Test Cabinet,
  so the orchestrator dimension does not apply to a gg run. gg is the executor.

gg reuses the shared run infrastructure, which is test-case-level rather than
harness-level: the run container, the test case's seeding and `init`, the run's
maximum-runtime bound, and the [validation](/components/core/validation/) and
scoring of the produced game. A gg run yields the same playable, scoreable,
reviewable artifact, and records a richer run record on the way.

gg is headless. It is configured, launched, and monitored entirely through the
Test Cabinet UI: the capability set is assembled there as a named
[configuration](/gg/configurations/), launched from the ordinary new-run form by
picking gg as the orchestrator, and the [telemetry](/gg/telemetry/overview/)
channel is a run's live window into what its agents are doing. Each capability
ships with the UI that drives and observes it.

## The capability set

gg is a small core, holding the agent turn loop, tool dispatch and message
transport, plus a set of independently pluggable capabilities, one per page in
this section. Every capability is:

- Toggleable. With a capability off, gg behaves as though the feature does not
  exist: no tools for it are offered to the model, no [prompt
  text](/gg/prompts/) describes it, and it consumes no context. This is what
  makes two configurations comparable. Run the same model on the same test case
  with a capability on and off, and the difference is attributable to it.
- Configurable. A capability that is on can be parameterized, for example the
  compaction trigger threshold, the subagent parallelism cap, or the memory
  budget.
- Swappable where it matters, by offering a different tool or a different
  implementation of a tool (see [Modularity](#modularity-through-tools)). This
  is the basis for A/B comparisons between two implementations of one
  capability.

A gg run is configured by a capability set: one or more per-agent
[profiles](/gg/configurations/#agents), each with its own enabled capabilities,
their implementations and parameters, its
[model slots](/gg/configurations/#model-slots) and one model binding, plus the
run-level launch inputs and limits. The capability set is the independent variable of an
experiment. Freeze the model and the test case, vary the capability set, and the
harness becomes a laboratory. It must be:

- Declarative and inspectable, expressible as data, so a run's exact
  configuration is recorded and reproducible rather than implied by code.
- Recorded on the run, captured in the run record and surfaced in the console,
  so every result is traceable to the exact configuration that produced it.
- Named. A capability set is saved to an operator's account as a
  [configuration](/gg/configurations/) and picked by name when a run is
  launched. The run records that name, so a study is a sweep over
  configurations.
- Honoured exactly as written. gg checks the whole set before the first turn,
  and a value it cannot honour refuses the launch. One refusal names every such
  value in the set, so one pass over the configuration fixes them all. An
  enabled capability is written out in full, and a required value left absent
  refuses the launch with the rest.

That last property is what makes the recorded configuration the configuration a
result was produced under: every run that produced a result ran the set its
record carries.

The set carries two things that are not capabilities. The first is the run's
[execution limits](/gg/execution-limits/), the ceilings on turns, wall clock,
consecutive errors, recent error rate, and cost that stop a run and record which
one stopped it. A capability is a feature a study varies; a ceiling is an
operator's guardrail over all of them. Because the set is what a run records, a
run stopped by a ceiling carries both the breach and the ceiling that produced
it.

The second is [hooks](/gg/hooks/), the commands and scripts gg runs at ten
points of a run's lifecycle. Three of those events let a hook block the
operation it precedes, and all but two let a hook put text in front of the
model. They are the operator reaching into the run from outside it. The model
is told nothing about a hook and is offered no tool for one. A hook's event
decides where it is declared: the run's two session events
belong to the capability set, and the other eight fire because a particular
agent wrote, ran, compacted, started, or stopped, so they belong to that agent.

Each agent profile carries three more settings that are not capabilities
either. Each shapes how the profile's requests are made rather than what they
say, and each comes out differently for each model in the same run: its
[prompt-cache lifetime](/gg/configurations/#prompt-cache-lifetime), its
[reasoning effort](/gg/configurations/#reasoning-effort), and [loop
detection](/gg/loop-detection/), which reads that agent's replies as they stream
and abandons one that has stopped answering and started repeating itself.

The capability set is a first-class Test Cabinet concept, and it stands where
the `harness + model + orchestrator` tuple stands for a harness run. Only the
test case and variant carry over, since those are test-case-level. Making it
first-class is what keeps an experiment reproducible and lets the [query
language](/gg/analysis/query-language/) slice results by configuration natively.

## Modularity through tools

Modularity is deliberately kept cheap. gg ships one or more agent-loop
implementations, and beyond that modularity comes from which tools are offered
to the agents. A different set of tools, or a different implementation of a
given tool, reconfigures behaviour without a combinatorial explosion of
pluggable subsystems. So "swap the compaction strategy" or "swap the memory
strategy" is, in practice, "offer a different tool or tool implementation for
it" rather than a bespoke plugin interface per capability. The agent loop is the
only coarse-grained plug point. The offered set of calls is itself an
experimental variable, since each agent profile names the calls it is granted
(see [Configurations](/gg/configurations/#granting-calls)).

What every one of those tools, and every responses-as-code function, says to a
model is the [Reference](/gg/reference/). It is projected from gg's own
definitions and served to the console, so it cannot drift from what a run sends.

## Prompt caching

An agent loop re-sends its whole conversation every turn, so most of what a run
pays for is the same tokens repeatedly: the system prompt, the tool schemas, the
build prompt, any [autoloaded specifications](/gg/autoload-specifications/), and
the thread so far. gg asks for a provider prompt cache on every request. Two
things have to hold for a cached read to happen, and gg does both: the request
has to reach the endpoint that holds the cache, and it has to stay on one
provider long enough for that cache to be worth building.

### The candidate list

OpenRouter is the gateway and the bill. Which of a model's providers serves a
request is gg's choice, made from the ordered candidate list the launch carries
as `modelProviders`. A candidate names a provider slug and the quantization it
serves. The list is what a run of that model may use, in the order it tries
them, and a one-entry list is a pin: every request of the run goes to that one
provider.

The backend builds the list at enqueue from OpenRouter's endpoints listing,
keeping an endpoint that passes every filter:

- Its declared quantization is the model's native level. Native is the highest
  level any endpoint of the model declares, and a catalog entry can set the
  level by hand. An endpoint declaring `unknown` is left out unless the catalog
  entry allows that provider by name.
- Its input and output prices are at or below the developer endpoint's rates,
  or at or below the ceiling the catalog entry sets when the developer endpoint
  is unavailable.
- It publishes a cache-read price, so a prefix is worth building there at all.
- It supports every parameter the run sends: `tools` and `tool_choice` for a
  tool-calling agent, and `reasoning` when the agent sets an effort.
- It is absent from the catalog entry's ban list.

The developer's own endpoint comes first when it passes. The rest follow by the
provider's fault rate across the backend's recorded runs of the model, then by
price. A model with no candidate refuses the enqueue with the reason, and the
console shows the reason on the model. A model whose developer endpoint is
excluded runs on the next candidate.

### The request

Every request names exactly one candidate: `provider.only` carries its slug,
`provider.quantizations` its level, and `allow_fallbacks` is false. Every
request of the run carries the candidate in force, including a subagent's and a
handoff compaction's. A reply served by any other provider ends the run as a
harness failure, because the cost recorded from that point would be on a
different price basis. The turn is recorded as a `model_provider_mismatch`
error, the session record's model error as `provider_mismatch`, and both name
the candidate and the provider that served the call. The two are compared
ignoring case and punctuation, so `z-ai` and `Z.AI` are one provider.

Within that provider, the request has to reach the endpoint that holds the
cache. gg mints one routing key per run at launch, a cuid2, and every client in
the run stamps it on every request as `session_id`. That covers the root agent,
every [subagent](/gg/subagents/) and the client a compaction resolves. A run's
turns therefore stay on one endpoint of the provider in force, and agents that
open on the same prefix reuse each other's warmed cache.

`session_id` is OpenRouter's sticky-routing key, and gg sends the same key as
`prompt_cache_key` for the providers that read the OpenAI-style field.
`prompt_cache_key` alone leaves routing on OpenRouter's fallback, which is free
to balance byte-identical requests across endpoints and reads as a 0% cache rate
turn after turn. The key is a preference within the candidate. With fallbacks
refused, a provider's outage reaches gg as the error it is and is retried on
the run's [retry schedule](/gg/execution-limits/).

The key is minted rather than taken from the run's session id, which is
caller-supplied text of any length. A cuid2 is 24 characters, inside both
OpenRouter's 256-character cap on `session_id` and OpenAI's 64-character cap on
`prompt_cache_key`, and the only property routing needs is that every request of
the run carries the same value. The key is announced on `session_started` and
kept in the [session record](/gg/session-record/), so a provider dashboard row
can be matched to its run.

### Moving to the next candidate

Faults are counted per provider within the run, and two kinds are told apart.

A failed call is an HTTP error, a rate limit, a transport error or a stall. The
client's retry schedule retries it on the same provider. When the schedule is
spent, the run moves to the next candidate for that request and every request
after it.

An unexpected cache miss is a reply whose `cached_tokens` is below the shared
prefix of the previous request on the same provider, sent within that request's
cache lifetime and above the provider's minimum cacheable size. The reply
stands, since it is a good turn, and the miss is counted. A provider that
reaches [`providerCacheMissLimit`](/gg/execution-limits/#providercachemisslimit)
is left at the next request. A miss is the cheapest moment to move, since the
prefix has to be rebuilt either way.

A move emits `provider_switch`, naming the provider left, the provider taken
and the fault that decided it. The run's cost record already slices per
provider, so a run that moved says so on its own. A run whose last candidate is
spent ends as the harness failure an outage ends on.

The key is minted rather than taken from the run's session id, which is
caller-supplied text of any length. A cuid2 is 24 characters, inside both
OpenRouter's 256-character cap on `session_id` and OpenAI's 64-character cap on
`prompt_cache_key`, and the only property routing needs is that every request of
the run carries the same value. The key is announced on `session_started` and
kept in the [session record](/gg/session-record/), so a provider dashboard row
can be matched to its run.

The request has to say what to cache. OpenAI and Gemini cache long prefixes
implicitly. Anthropic caches only what a request marks with `cache_control`, so
an unmarked Anthropic run is billed at the full input rate on every turn however
much of the request is byte-identical to the last one.

gg marks up to four breakpoints per request, which is Anthropic's cap:

- one anchor at the message before the agent's first assistant turn, covering
  the tool schemas and the system prompt, which never moves for the life of the
  agent. A code agent's opening context holds a synthesized assistant turn, so
  the anchor stops there and the grid points cover whatever was seeded after it;
- up to two rolling points over the accumulating thread, snapped to a fixed grid
  of message indices so that they name the same prefix from one turn to the next
  (a marker at a shifting offset would describe a prefix no earlier turn ever
  wrote, and so would never be a cache hit);
- one at the tail, which writes this turn's prefix for the next turn to read.
  The tail walks back past the trailing slot message — the context-usage signal,
  re-rendered at the end of every request — because a prefix ending on it never
  recurs, so a marker there writes an entry nothing ever reads.

The markers go only to the Anthropic family, and every content-bearing message
of a marked request is serialized as a one-element content array whether or not
a marker rides it. `cache_control` has to ride a content block, and the rolling
breakpoints move: without the uniform shape, a sent message would flip between a
bare string and an array on the turn the grid crossed it — a byte-level edit
mid-prefix, observed collapsing a run's cached read from 24.7k tokens to 2.6k on
the turn a marker moved. With it, only the marker metadata comes and goes, and a
sent message's wire shape is a function of the message alone.

Every other provider gg reaches caches long prefixes implicitly and is sent no
markers and no array promotion at all: a provider matching the forwarded
OpenAI-shaped payload sees any shape change as a different prefix and re-bills
the request in full, so their messages keep the bare-string shape on every
turn.

How long those entries live is the per-agent [prompt-cache
lifetime](/gg/configurations/#prompt-cache-lifetime). Left alone, every entry
takes the provider default of five minutes. An agent switched to the extended
one-hour lifetime asks for it on its anchor and rolling points only. The tail
keeps the default whatever the agent is set to, because it is rewritten every
turn and read exactly once, by the turn immediately after it.

One gg turn can run a build, a test suite, or a browser pass, and every agent in
a run shares one runtime thread, so the gap between one agent's successive
requests is routinely minutes. A gap past five minutes means the next turn
re-sends a prefix whose entry has expired and is billed for it in full. The
extended lifetime is charged a higher write premium, on Anthropic 2× the base
input rate against five minutes' 1.25×, so it is set per agent and bought only
for the agents that come back to their context that late.

Prefix matching is also why [compaction](/gg/compaction/) and [agent-managed
context](/gg/agent-managed-context/) go to such lengths to keep the window
append-only. Rewriting anything already sent, even a single line in the middle
of the prompt, discards the cached prefix from that point on and re-bills the
rest of the request in full.

## Installation & distribution

gg is installed by context. Locally it runs with no external resources, so a
developer can exercise it fully offline from a local build. In k8s it is
published as a GitHub release and downloaded from there at run time, the same
shape as the third-party harnesses' install step. The install runs in the run's
setup stage, so it is recorded as
[setup](/components/core/metrics/#durations) rather than as the model's session.

The release asset is a bare static-musl executable named `gg-<target>`, hanging
off the release tag `v<version>`, published for both `x86_64` and `aarch64`. The
driver picks the architecture, not the run container. The version in that URL is
`core`'s own, and `gg --version`, read out of the run container, is what a run
records as its `subject.harnessVersion`, so the two crates are versioned in
lockstep. See [Releasing `gg`](/development/releasing/#releasing-gg).

## Capabilities

Each capability has its own page. The grouping below is editorial rather than a
structural distinction. How a capability set is named, saved, and launched in
the console is [Configurations](/gg/configurations/).

### Context

- [Autoload specifications](/gg/autoload-specifications/) — seed an agent's
  opening context with the whole test-case brief, optionally locked in place.
- [Compaction](/gg/compaction/) — summarize and restart a thread to continue
  past the context window.
- [Context window
  override](/gg/context-visibility/#the-window-a-run-is-measured-against) —
  narrow the window a run is measured against, to exercise compaction against a
  large-window model cheaply. The per-source [context
  visibility](/gg/context-visibility/) accounting itself is intrinsic rather
  than a capability.
- [Agent-managed context](/gg/agent-managed-context/) — let an agent evict file
  views and archive thread history.
- [Modules](/gg/modules/) — the six units of per-agent state, whether an agent's
  prompt carries each one, and what happens to them when it is copied or
  succeeded. This is the model every other capability's state is kept under
  rather than a capability of its own.

### Knowledge

- [Skills](/gg/skills/) — pre-authored knowledge, catalogued in the prompt and
  used by name: prose retained across compaction once used, a code library the
  agent's programs import and whose declarations open as documentation views, or
  both. gg ships twelve of its own, one per family of the functions it offers.
- [Memories](/gg/memories/) — the same, curated by the model itself and bounded,
  code included.

### Work tracking

- [Tasks](/gg/tasks/) — a lightweight blocked-by DAG of to-dos.
- [Project management](/gg/project-management/) — a run-global board of scoped,
  auto-dispatched work items.

### Delegation

- [Subagents](/gg/subagents/) — spawn, parallelize, block on, and message other
  agents.
- [Agent persistence](/gg/agent-persistence/) — make one profile a single
  long-lived worker: one instance runs at a time, and each opens on the files
  the last one left open.
- [Exec & fork](/gg/fork-and-exec/) — two independent capabilities. One lets an
  agent become a different agent, carrying its conversation with it; the other
  lets it run a copy of itself that starts already knowing everything it knows.

### Process & quality

- [FSM-driven processes](/gg/fsms/) — a state table the agent is driven through,
  each state running an agent profile of your choosing and each transition
  naming the modules the next state inherits.
- [Ending a session](/gg/ending-a-session/) — how a run decides it is finished:
  the typed ending call each role makes, which is not configurable.

### Models & tools

- [Shell](/gg/shell/) — run commands in the run container, and the
  output-offloading mode that keeps a chatty build out of the context window.
- [Filesystem tools](/gg/filesystem/) — read, write, edit, and list files; one
  capability per tool, and `read_file`'s read modes.
- [Responses as code](/gg/responses-as-code/overview/) — agents emit code run in
  a wasmtime sandbox instead of discrete tool calls.
- [Languages](/gg/languages/overview/) — which language a program is written in,
  treated as an axis: the rules an agent-facing surface obeys in any language,
  what a language supplies to be registered, and what adding another one costs.
- [Program library](/gg/program-library/) — keep every program an agent runs, so
  it can fetch one back, patch it, and hand it over to be run again.
- Close documentation (`docview-close`) — let an agent take a [documentation
  view](/gg/responses-as-code/views/) back out of its own window. It is its own
  capability because closing takes back a page the agent
  still holds, and it disturbs a prompt prefix the documentation band otherwise
  keeps intact for a whole session.

### Observability

- [Telemetry](/gg/telemetry/overview/) — the first-party stream the console
  renders.
- [The session record](/gg/session-record/) — always-on capture of what each
  agent was asked and what came back, salvaged out of a run that hung so the one
  outcome that collects nothing can still be explained.
- [Analysis](/gg/analysis/overview/) — querying, dashboarding, and measuring
  across every recorded gg session.
