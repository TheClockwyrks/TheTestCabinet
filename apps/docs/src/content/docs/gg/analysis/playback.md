---
title: "Playback"
---

**Playback** re-runs a recorded gg session through the **real** turn loop, with
only the model call and the shell answered from the
[record](/gg/analysis/replay-records/) and every other side effect performed for
real. A 38-minute session reconstructs in seconds, for free, emitting the full
telemetry stream **this build** of gg would emit.

## Passive replay, and active playback

gg already has a replay driver, and it is a different thing. Keeping the two names
distinct in code, docs, and flags is deliberate — confusing them is how somebody
ends up believing a transcript viewer proved a regression.

| | Passive replay (exists) | Playback (this page) |
| --- | --- | --- |
| Drives | its own walk of the record | the real turn loop |
| Side effects | none at all | everything except the model and `sh -c` |
| Produces | a step list for the console | a real telemetry stream, a real workspace, a session summary, a divergence report |
| Consumer | the console's Replay tab | a CLI, and gg's own test suite |
| Detects | gaps _within_ a record | divergence between the record and **this build of gg** |

Passive replay's behaviour is unchanged by this work, **including for every record
already captured**.

## The two seams

A gg session has exactly two inputs that are not a function of its own state, and
between them they are ~all of a run's wall clock and ~all of its cost.

**The model call** already has a seam — the client factory every agent resolves
through — and it is already proven injectable by the test suite's scripted factory.
It needs one thing it does not have: **who is asking**. A record is indexed by
agent, and there are eight resolution sites, one of which re-resolves the
*forker's own* binding purely to name a model in an answer. A recorded factory
that failed there would make every [fork](/gg/fork-and-exec/) silently fail while
the recorded success was fed forward — the parent's reconstructed context would
claim a fork that does not exist.

**The shell** has no seam. Three call paths reach a command line — the `shell`
tool, a [responses-as-code](/gg/responses-as-code/) program's `system.shell(…)`,
and a [hook](/gg/hooks/)'s commands — and the only
thing all three share is the tool context. So the seam goes there, and it carries
**the calling agent** and **which of the three paths it came from**: a runner given
only a workspace path cannot know whose recorded commands to draw from, every shell
divergence names an agent, and a hook's command has to stay off the agent's
ordinary queue. A hook in particular must be attributed to the agent it fired for —
an [agent-stop](/gg/hooks/#agent-stop) gate to the agent whose ending it holds — or
its commands land on an unattributed queue.

Capture rides the same seam, as a decorator around whatever runner is installed.
That is not an incidental symmetry: the seam is the only place all three paths meet,
and a capture that sits above it — as the ending gate's briefly did, because that
call site happened to hold a recorder — records one path and silently misses the
other two. Recording *below* the seam also pins what the process did, before the
output policy merged the streams and added gg's notes, which is the right side of
that line: a reconstruction re-applies this build's presentation to the recorded
bytes.

The two seams travel together as one parameter into the loop. A playback with a
recorded model and a *real* shell would run real installs against a scratch tree
while claiming to reconstruct a session, and there must be no way to assemble that
by accident.

## Not a capability, and not an invocation field

Playback is a separate library entrypoint with two front doors — a CLI, and a
test-only builder. Both alternatives were considered and rejected for the same
underlying reason.

A **capability** is wrong three times over. The capability set is the run's
*experimental configuration*; it is lifted into the session summary and rendered by
the configuration editor, and "answer from a record instead of calling the model"
does not belong in that space. A playback must run under the **recorded** capability
set verbatim, so adding one changes the thing being reconstructed. And decisively:
an unrecognized capability value is a **warning, not a launch failure**, so a
`recorded` shell implementation handed to an older gg silently resolves to the real
one and runs real commands against a real workspace.

An **invocation field** has the same hazard in milder form: an older gg deserializing
a newer invocation ignores the unknown field and runs a real, paid session. A field
that can be silently ignored must not decide whether real API calls happen.

With a separate entrypoint there is no field and no capability to ignore. To get a
playback you must call a different function, so a gg that does not have this feature
cannot be asked for one.

## What is stubbed, and what is real

| Side effect | Playback | Why |
| --- | --- | --- |
| Model requests | **stubbed** | The cost and ~all the wall clock |
| `sh -c` — tool, program, hook | **stubbed** | Reaches the network, the clock, and the machine's toolchain |
| `git` subprocesses, worktrees, merges | **real**, and *watched* | gg's own bookkeeping, and the hardest paths to test — but see the barrier below, which needs to know when a merge landed |
| `write_file` / `edit_file` | **real**, into a scratch tree | An `edit_file` needs the file the previous `write_file` made |
| `read_file` / `list_dir` / `read_skill` | **real**, compared against the record | Pure functions of workspace + args, so a difference is a regression signal |
| The scheduler, parallelism, exclusive keys | **real** | Loop behaviour |
| Agent interleaving | **constrained** to the recorded order | See the barrier below |
| Subagents, issue dispatch, speculation, fork | **real** | Exactly what a hand-scripted test cannot cover |
| [Compaction](/gg/compaction/), all strategies | **real** — its model calls come from the record | First time compaction is testable end to end against real summaries |
| The wasm sandbox | **real** | The recorded response *contains the program*. Running it is the point |
| Telemetry | **real and complete** | This is the *product* of a playback |
| Turn and cost ceilings | **real, as recorded** | Recorded responses carry their recorded usage, so a ceiling trips at the same turn |
| Wall-clock deadline, cancellation | **not reproduced** | See terminal drift below |
| Network to the provider | **impossible** | No live client is ever constructed |

`git` staying real is a line drawn on purpose. It is gg's own bookkeeping rather
than model-visible non-determinism, its results are a function of a workspace the
playback reconstructs, and worktree/merge/conflict handling is *loop behaviour
worth exercising* — a playback that stubbed it would prove nothing about the
[issue-worktree](/gg/project-management/) paths, which are the hardest to test any
other way.

Real, but not invisible. Each real invocation **retires the recorded one it
corresponds to**, and that retirement is load-bearing: an issue's
accept-and-merge is a `git` sequence, it moves the board, and the board is
rendered into every agent's pinned prompt. Without it the merge would be the one
run-global state change the barrier below does not order, and every concurrent
board record would drift on exactly the block that matters. The comparison that
rides along is deliberately over the invocation's *shape* — the subcommand, its
flags, its refs — and not its absolute paths, because a playback builds somewhere
else on purpose and a worktree names its own location.

### The playback workspace is not the produced tree

A playback builds in an **empty** directory, and refuses any existing non-empty
one. This is the single guardrail between playback and
[code analysis](/gg/analysis/code-analysis/), and it is stated as the strict rule
rather than a marker heuristic on purpose: a collected run's produced tree lives at
a path containing none of the obvious markers, so a marker check would have let a
playback's real `write_file` and git mutate the produced tree in place.

Say it plainly: **the recorded shell commands did not run**, so anything a command
created — `node_modules/`, `dist/`, `target/`, a scaffolded project — is absent. A
playback tree must never be fed to produced-code analysis.

## Staleness: is this recorded answer still an answer?

A recorded model response is only a valid input while gg's prompt construction is
unchanged. Edit a system prompt template and every recorded response becomes an
answer to a question gg no longer asks — silently, if nothing checks.

So each turn carries a **content fingerprint** of the request, computed by **one
function on both sides**: the recorder stamps it, the playback recomputes it from
the live request and compares. That single-source property is the whole guarantee;
two implementations would drift and the detector would become the bug. Under format
v2's pooling this is nearly free — the pooled ids are already content addresses, so
the fingerprint is a fold over them.

Comparison is component by component, in the order **message count → system →
tools → conversation**, because the first component that moves is the most
informative. Three strictness modes decide what is fatal:

- **Exact** (the default) — every component must match. **The only setting under
  which a playback's output is a faithful reconstruction.**
- **Shape** — the message count and the offered toolset must match, but the system
  prompt and the transcript text may have moved. The principled relaxation: the
  count and the toolset say _the loop asked the same number of questions with the
  same instruments_, which is what keeps the recorded answers corresponding turn
  for turn. Everything else is wording. For extracting data from sessions recorded
  before a prompt edit.
- **None** — nothing is required to match. Triage only, and the report says so.

Detection is not enough on its own. When the system prompt is what moved, the
report renders the **first differing region of the two prompts with three lines of
context each way**, so the answer to "what did I break?" is on screen rather than a
diffing exercise.

One thing the fingerprint cannot see, and its answer: vision recovery can call the
model twice for one turn, and only the successful stripped call is recorded — so a
playback that started with an un-denied vision state would drift on every image
turn for a reason that has nothing to do with a real change. The record carries the
run's **final, resolved** modality state, so the first call matches.

## Keying recorded shell commands

**Position is the key; content is the check.** A run runs `npm run build` five
times and gets five different answers, so the command text is not an identity — the
order is. Keying on a hash of command plus prior state would need the state, which
is the thing being reconstructed.

Lookup for a given agent, in order:

1. **Head match** — the head of that agent's queue has the same command and
   directory. The overwhelmingly common case, and under the ordering barrier it is
   essentially always this one.
2. **Out-of-order, same agent** — the pair occurs later; consume what is between,
   report it, use the match. Covers the benign case where gg's own machinery stopped
   issuing a command.
3. **Cross-agent** — the pair occurs in another agent's remaining commands. The
   safety net for an imperfect agent binding; reporting it is what makes the binding
   auditable.
4. **Miss** — synthesize a classified failure whose text says the command was not
   recorded (the default), stop, or actually execute it (never without an explicit
   flag).

Synthesizing is the default rather than stopping because the *model's* next answer
still comes from the record, so the fingerprint check on the very next turn is what
actually settles whether the session diverged — and it says something far more
precise than "a command was missing". Stopping is available for a caller who would
rather have nothing than a session in which a build's output was invented.

A directory mismatch on an otherwise-identical command falls to step 2 or 3 and is
reported, never silently accepted: the same command in a different tree is a
different command.

Steps 2 and 3 differ in what they consume. Stepping over commands within one agent
**consumes them**, because a recorded command the reconstruction demonstrably did not
ask for must not stay in the queue to answer a later one by accident — and because
leaving it in would block the ordering barrier behind an entry nobody will ever take.
A cross-agent hit takes only the entry it matched: the other agent has not finished,
and its earlier commands are still its own to ask for.

One thing a served command cannot give back is a stream a standard-fidelity capture
clipped. Unlike a re-executed tool there is no live payload to prefer instead — the
command did not run — so the tail is served and the clip is reported, because the
conversation drift it causes a turn or two later is otherwise inexplicable. Its
answer is to re-record at full fidelity.

### The other tools

Every non-shell tool is **re-executed for real**, then compared against the record,
and the **recorded** outcome is fed forward when they differ. Both halves are
deliberate. Re-running is what builds the workspace the next call reads and what
puts the real tool code under test; preferring the record is what keeps the
reconstructed context window equal to the recorded one, which is the entire basis
on which anything extracted from a playback is valid.

The comparison is a free regression signal — _"did we change `read_file`'s
truncation footer?"_ is answered by playing back any session that read a long file.

One benign drift is worth naming so nobody chases it: reading a file that a
**shell command** created in the real run diverges, because the stubbed shell
created nothing. It is classified as such, reported, the record wins, and the
session continues correctly.

## Binding live agents to recorded agents

Subagent ids come from a global counter minted in the order agents reach their
spawn. gg runs on a single-threaded runtime, and a playback removes model latency
entirely — so the interleaving of two concurrent agents **will** differ from the
recorded run. Id-keyed lookup would then hand agent A the responses recorded for
agent B: silent, catastrophic, and exactly the failure class this feature exists to
eliminate.

So an agent is identified by its **provenance**, and there are two kinds because
there are two kinds of creation:

| Path | Bound by | Deterministic because |
| --- | --- | --- |
| Root | trivially | — |
| Spawn — delegate, review, **fork** | recorded spawner + spawn ordinal | A parent's spawns are strictly ordered within its own turn loop |
| Succession | recorded predecessor + ordinal | Same |
| Issue attempt | issue + **dispatch ordinal** | A function of board state |
| Reviewer | issue + round and position | A function of board state |
| **Merge agent** | issue + merge ordinal | Its live id comes off the **global counter**, so it can only be bound by what it was dispatched *for* |

The merge agent is the row that proves the point, and the three board-dispatched
rows are why this needed a second kind at all: issue agents, reviewers, and merge
agents are all created with **no parent**, so a parent-keyed scheme leaves every one
of them unbindable — and an unbound agent dies on its first turn. Issue worktrees,
reviewers, and a required merge agent are the v0.7.0 multi-agent headline, so that
is not an edge case.

The spawn key is an ordinal across **all** spawn kinds, not per profile: a fork runs
the forker's own profile, so a fork child and a same-profile delegated subagent from
one parent would otherwise compete for the same queue.

The issue key is the **dispatch** ordinal and not the retry count, which is a
distinction learned the hard way. A review that requests changes re-dispatches the
issue to a fresh agent and deliberately does *not* charge the retry budget — rework
asked for by a reviewer is not a failed attempt — so keying on the retry count gave
two genuinely different agents one identical origin, and a reconstruction served the
second one the first one's turns. The same reasoning as the spawn key: the key has to
be unique per agent, and "which attempt" is not.

**The fingerprint is a second, independent check on the binding.** A mis-bound
agent's very first request carries a different profile's system prompt and toolset,
so two components move immediately. Neither mechanism has to be perfect alone.

## The ordering barrier

A gg run has **run-global mutable state rendered into every agent's pinned prompt
every turn**. The clearest case is the [board](/gg/project-management/): one store,
shared across the whole run, mutated by every agent's board tools, and refreshed
into the pinned block at each turn boundary. Inter-agent messages and collected
subagent results have the same shape.

So if agent A's issue took eleven minutes of installing in the real run and
finishes instantly under playback — which is the entire point of a playback — then
the root's turn-N conversation contains a **different board block** than the
recorded one. The conversation component moves. Under Exact strictness that is
fatal, which would make Exact unreachable for any concurrent multi-agent run.

The fix uses something the record already has. The recorder mints a **globally
monotonic `seq` across all agents** precisely so the interleaving is
reconstructable. The barrier enforces it: a recorded input is served only once
every recorded entry with a lower `seq` has been. The real scheduler still runs and
every agent is still driven concurrently — what is constrained is only the order in
which the two recorded inputs are handed back.

It cannot deadlock on itself: a waiter only ever waits on strictly **lower** seqs,
so the owner of the lowest unserved seq never waits. It can **stall** — the lowest
unserved entry may belong to an agent blocked on something else, or be an entry the
reconstruction never demands. That is a real divergence, not a bug, so the wait is
bounded and expiry releases the lowest waiter and reports it.

A consumer also has to say which categories of input it **does not serve**, once,
before the first turn, because a waiter blocks on *every* lower unserved seq and a
single entry nobody will ever consume would otherwise block every agent behind it
for the whole reconstruction. For a playback those are the clock and the cancel
probe, which it does not reproduce at all.

`git` is deliberately not among them even though a playback does not *serve* it
either: it re-runs each invocation for real and retires the recorded one, which is
what puts an issue's merge back in the recorded order. That has one consequence
worth naming, because it is the case a concurrent board record hits immediately:
gg's own bookkeeping **outlives the loop that dispatched it**. An issue is
dispatched, worked, committed and merged under the root's name, and every one of
those invocations is recorded after the root's own `finish`. So an agent's
retirement covers what its *loop* owes and not what its `git` still owes — a wait
behind a merge that has not run yet is a real wait, not a provable deadlock.

The barrier can be turned **off**, and that is deliberate: a claim about it that could
not be turned off would be an argument rather than a measurement. Reconstruct a
two-issue board record both ways — one issue's agent slow, the other's fast, so the
recorded interleaving is one that *only* latency produced — and the ordered
reconstruction is faithful while the unordered one diverges on the conversation,
because the slow agent's second turn is built before the other issue merged rather
than after. Note that the difference only shows on a record whose agents were
genuinely in flight at once: a review→rework→approve cycle on a single issue is
sequential, and so is a speculation fan-out where each attempt has a window of its
own, so both reconstruct identically either way.

One thing gg's own commits had to change for any of this to be reachable. A commit id
hashes the timestamps as well as the tree, and an issue review brief names the commit
the work is measured against so the reviewer can diff it — so a clock-derived commit
date made every issue-worktree run impossible to reconstruct, for a reason that had
nothing to do with the run. gg now stamps a fixed date on its own commits alongside the
fixed identity it already stamped, which makes its git history a pure function of its
content. Nobody reads those dates; `git log` is topological.

The waits must yield. gg runs every agent on one `current_thread` runtime, so a
blocking spin deadlocks the process rather than stalling one agent.

**What the barrier does not claim.** It orders the *recorded inputs*, not everything
else a run does — and "recorded inputs" had to be read literally rather than
generously. The first concurrent board record built to test this found the gap
immediately: the board's `in review → done` transition happens at an issue's
**merge**, which is not a served input, so the recorded interleaving was restored
everywhere except at the one state change the record was built to exercise. That is
why gg's own `git` invocations retire against the record rather than being ignored;
with them ordered, every run-global prompt input gg has today — the board,
inter-agent messages, collected subagent results — moves at a point the barrier
holds, and a round-trip over a concurrent record proves it empirically rather than
by argument.

The general shape of the hazard remains, and is worth stating as the rule: run-global
prompt state that mutates at a point the record does not pin is state the barrier
cannot order. The resulting drift is reported rather than hidden, which is how this
one was found.

## Endings

A playback cannot reproduce a wall-clock ending: it takes seconds. Rather than fake
a clock — gg has no clock seam, and adding one would touch every timestamp in the
crate — playback is **honest about it**. The run's wall-clock ceiling is disabled,
each agent's recorded terminal status is compared against the reconstructed one, and
a difference is reported as terminal drift.

A record whose turns are exhausted because the run ended on its deadline surfaces
as a playback-specific model error, so the agent ends and the comparison reports
`max_runtime → model_error` rather than inventing an ending. This is the same shape
as [Foray's](/testing/adversarial/foray/architecture/) replay drift: reconstruct,
compare against what was committed, report the gap.

Cost and turn ceilings are the opposite case and are **honored as recorded** —
reproducing a limit-hit is a feature.

## The faithful flag

Every consumer — a CLI exit code, a test assertion — reads one boolean, computed in
exactly one place and never set by a call site:

> A reconstruction is **faithful** iff it ran under Exact strictness with the
> ordering barrier and record-preferring tool comparison, was not stopped early, and
> recorded **no** divergence of any kind.

Anything else reconstructs something that did not happen, and the report says so.

A fatal divergence returns a **report carrying what stopped it**, not an error that
throws the report away — the divergences found before that point are exactly what a
developer wants.

## The command line

```sh
tcab gg-playback --record run/replay.json.gz --report report.json
```

A record is named exactly the two ways `tcab gg-replay` names one — a run id, which
is fetched from the backend, or `--record` pointing at a file (plain or gzipped, a
run tree's copy being `replay.json.gz`). No provider credential is read and none is
needed: a playback constructs no live client, so the headline invocation runs with
`OPENROUTER_API_KEY` unset and finishes a half-hour session in seconds.

The last line is the verdict, and the exit code carries the **mode** as well as it:

| Code | Meaning |
| --- | --- |
| 0 | faithful |
| 1 | Exact, and it diverged |
| 2 | reconstructed under `--strictness shape` |
| 3 | reconstructed under `--strictness none` |

Distinguishing 2 and 3 from 1 is the point. A script that checks `!= 0` behaves the
same either way, and one that checks `== 0` cannot mistake a relaxed reconstruction
for a clean one — precisely the mistake a mode reached for to unblock a red build
invites.

Every flag beyond naming the record is a relaxation, and each one costs the
reconstruction its faithfulness:

| Flag | What it gives up |
| --- | --- |
| `--strictness shape\|none` | the staleness check, in the [two grades](#staleness-is-this-recorded-answer-still-an-answer) the matrix defines |
| `--ordering free` | the [ordering barrier](#the-ordering-barrier) — a measurement instrument, not a convenience |
| `--execute-unrecorded` | the guarantee that a playback starts **no** process at all |
| `--stop-on-unrecorded` | nothing; the opposite posture, for a caller who would rather have nothing than a session in which a build's output was invented |

`--report` is written on every path that reached a reconstruction, **including** the
one a fatal divergence stopped — that is the library's error design surfacing at the
front end. `--events` writes the reconstructed telemetry as NDJSON, which is the
same stream a live run emits and the actual *product* of a playback.

With no `--workspace` the reconstruction builds in a temporary directory and removes
it afterwards. Name one to keep the tree — but never point it at a run's produced
tree, which is why a non-empty directory is refused rather than merged into.

A kept tree holds one thing worth knowing about: **its own capture journal**. Capture
is always on and a playback runs the real loop, so a playback records itself. The CLI
neither suppresses that nor mentions it — suppressing it would mean reconstructing
under a configuration the recorded run did not have, and mentioning it would put a
line in every report about a file the default invocation deletes moments later. It is
a perfectly good record, and it plays back like any other.

### The committed fixture suite

The other consumer of a playback is gg's own test suite, and it is the reason to keep
records around. `crates/gg/src/testdata/playback/` holds whole recorded sessions —
capped at six, at 500 KB each, both asserted rather than noted — and each one asserts
faithfulness on every test run. Because those records were written by an *earlier*
build, they catch what an in-process round trip structurally cannot: a prompt-template
edit. Change one and every fixture fails at once, naming the component that moved.

The records committed today were driven by gg's offline `MockClient` rather than by a
model, which the directory's `README` says plainly. That costs only the realism of the
content: the signal comes from the request gg builds, not from the answer it gets.

## What this does for gg's test suite

This is the second reason to build it, and on some days the better one.

The [responses-as-code](/gg/responses-as-code/) loop suite is driven entirely by
**hand-written programs** — string literals an engineer wrote — and each scenario
costs a large component compile, so scenarios are deliberately few. The repository
already committed a corpus of real model replies because the assumption that a
developer knows what a model writes kept being wrong. Playback generalizes that from
a *snippet* to a *whole session*: the transpiler, the membrane, the healing path,
the loop, and the deferred-effect machinery all run against real model output, in
sequence, with the real tool results the model was reacting to.

It also gives gg a regression signal it has never had. Committed real-session
fixtures each assert faithfulness, so when a prompt template, a tool description, or
the context-usage block changes, **every fixture fails at once**, naming the
diverged component and showing the diff.

One measurement the round trip must **not** make: byte-identical telemetry. A
prompt event carries a real model-call duration and every turn timing is wall
clock, so a playback's figures are legitimately different. The comparison is a named
projection — every context message, every prompt's ordered request, token totals,
finish reasons, costs, and the terminal summary — with wall clock the only
exclusion.
