---
title: "Session records"
---

A session record pins what a gg session consumed, so a run that explains nothing
on its own can still be explained. This page specifies the record format, the
journal a running session writes, and how the host folds one into the other. The
[session record](/gg/session-record/) page describes what the capture is for.

Capture is on for every gg run and is gated by no capability.

## The shape of a record

A record is a fixed seed, an agent provenance table, three content-addressed
pools, a clip table, and an ordered log of the inputs the session consumed. Its
size is `O(unique bytes) + O(Σ window items)`.

The seed is the identity the session started from: the baseline commit gg
observed in the container, the build prompt the root agent was given, the
context window resolved for each bound model slot, and each slot's final
resolved modalities. Windows are recorded because compaction thresholds and the
fullness signal are computed against them. Modalities are recorded as resolved
rather than as initial, because a provider that refuses an image denies that
model for the rest of the run.

The pools hold messages, offered toolsets and texts. Each entry is stored once
under a content address and referenced by index.

- The message pool holds each distinct message body. Its id is a 128-bit SHA-256
  content address, computed over the message including its exact image payloads.
  The stored body has each inline image payload reduced to a descriptor.
  Addressing before the reduction is what keeps two different pictures of one
  media type and decoded size two different messages.
- The toolset pool holds each distinct offered tool-definition array. A run's
  offered toolset rarely changes, so its redundancy is the turn count.
- The text pool holds every large string payload: a tool outcome's output, a
  `git` invocation's streams, a shell command's streams. A tool's output is also
  quoted verbatim into the `tool` message that carries it into the window, so
  interning both against one table collapses the pair.

The input log is a flat, ordered list of entries. Each carries the id of the
agent that consumed the input and a globally monotonic `seq` minted across all
agents from one counter. Because a gg run holds run-global mutable state that is
rendered into every agent's pinned prompt each turn, the recorded interleaving
is part of what each agent was shown: entries read in `seq` order are the
windows the run built.

## What counts as an input

The record captures every input that changes control flow:

| Entry | What it holds |
| --- | --- |
| `model_io` | The pooled request, the response, and the call's latency |
| `model_error` | The pooled request and why the call failed |
| `tool_result` | The call and the exact outcome the dispatch returned |
| `prompt_frame` | One agent's context window as it stood for the turn just recorded |
| `shell` | One shell command gg ran, with its origin, exit status and pooled streams |
| `git` | One `git` subprocess gg's own orchestration ran, with its pooled streams |
| `cancel_probe` | One read of the cancel file, and what it found |
| `clock` | One read of the wall-clock deadline: elapsed and remaining milliseconds |

A recorded request carries two discriminators. Its `role` is either the agent's
own turn loop or the [compaction](/gg/compaction/) summarizer, which rewrites
the whole window rather than advancing the conversation; without the
discriminator the two interleave into one queue and a compaction's turn is
attributed to the agent. Its `shape` says whether the offered tool was required,
since a forced call read as a free choice is the opposite of what happened.

A recorded shell command carries its own origin: the `shell` tool, a
[responses-as-code](/gg/responses-as-code/overview/) program's `gg.shell.shell`,
or a [hook](/gg/hooks/). The origin is what keeps the commands gg runs without
the model asking distinguishable from the ones the model asked for. Every
command records where it ran, relative to the workspace wherever possible,
because an absolute path is a property of the container rather than of the run.

Model errors are recorded by class, because the class is what the loop branches
on: a missing credential, a fatal provider status, retry exhaustion, an
unsupported image modality, an unparseable response, and a response that
[loop detection](/gg/loop-detection/) abandoned on every attempt. Two of them change
control flow directly. A vision refusal strips images and re-runs the turn, and
a retry exhaustion counts against the run's error ceiling.

Prompt templates, memories, autoloaded specification files and skills are not
recorded as filesystem reads. Templates are embedded in the gg binary, so the
recorder's commit is what says which ones a run used. Every memory mutation and
every skill body a session read is a recorded tool outcome, every rendered index
is a pooled message, and an autoloaded specification reaches the model as a
message.

## The prompt frame

Four typed fields of gg's window model are recoverable from the record alone:

- `retention`, which says whether the item survives compaction verbatim;
- `region`, the `offset`/`limit` window a paged file view covers;
- `turn`, the turn the item was pushed on;
- `slot`, which of the window model's three slots it came from.

The slot matters most. A system prompt and a rebuilt context-usage signal are
otherwise indistinguishable: both are `System`-sourced, both unlabelled, both
pinned.

A frame is recorded at the one place the loop holds a turn's prompt-item stream,
which is the same call site that emits the telemetry `Prompt` event. The
recorder reaches that site directly rather than through the telemetry emitter,
which stays unaware of capture. The frame lands after the model call it
describes and before that agent's next one, the same attachment rule tool
results follow. A refused image turn therefore produces
`model_error → model_io → prompt_frame`, and the frame attaches to the call that
was actually sent.

## Agent provenance

The record carries one row per agent, in creation order, not one per turn. A row
names the agent's id, the profile it ran under, its origin, the status its turn
loop ended in, and which ceiling stopped it.

The origin is what identifies an agent across runs, because live subagent ids
come off a global counter in the order agents reach their spawn. Every origin is
keyed by a function of the run's own structure: the root agent; a spawn, by its
parent and its position in that parent's turn loop; a succession, by its
predecessor and position; an issue attempt, by the issue and which dispatch of
it this is; a reviewer, by the issue, the round and the position within the
round; a merge, by the issue and which merge of it this is. An issue attempt
counts every dispatch rather than every retry, because a review that requests
changes re-dispatches the issue without charging the retry budget.

A row is written when the agent comes into existence and again when its loop
ends, and assembly upserts by agent id, so the terminal row supersedes the
opening one. Writing the opening row is what keeps the agents worth explaining:
one parked behind the parallelism cap when the run was killed, one whose first
model call never returned, one spawned into a session that ended before it
spoke.

## The capture journal

Capture and assembly are split. In the container, gg appends one JSON object per
line to `.gg/replay.ndjson` and never holds a message body in memory. On the
host, after the tree is collected, `core` folds those lines into the served
record. That split is what keeps gg's own diagnostics off the run's runtime
budget: gg assembles nothing.

Lines are written on a dedicated OS thread rather than inline. gg runs every
agent on one `current_thread` runtime, where a synchronous file write stalls
every agent and skews the turn timings the run is measured on. The queue to that
thread is bounded, because an unbounded queue turns a stalled disk into
unbounded memory growth inside the run container.

The journal's vocabulary is a header, a seed, an agent row, one line per newly
interned pool entry, one line per input entry, and a terminating marker. The
header is the first line and carries the format version, the session id, the
capability set and the recording build. The seed line may be written again, and
assembly keeps the last one, which is how a streaming journal carries a value
that is only resolved at the end.

Every pool line names the index it occupies even though position implies it.
That redundancy is the gap detector: a pool that skips would shift every later
reference by one and substitute the wrong message body into a recorded prompt.

### Stopping capture

Minting a pool index and queueing its line happen under one critical section,
and an entry's newly interned bodies are queued together with the entry that
references them as one indivisible batch. Any failure stops capture for the
whole run, permanently, whether it is the byte ceiling, a queue the writer
cannot keep up with, or a dead writer. The written pools are therefore always a
contiguous prefix and no entry can reference a body that was never written.

Every stop is a recorded fact and the run is untouched. Capture degrades; it
never fails the run it observes.

That holds even when the failure is gg's own: a journal writer that *panics* is
reported as a write failure — never as no failure, which would describe a
journal missing an unknown number of lines as a clean recording — and it does
not end the run, which is the one gg defect that does not. The journal is a
sidecar for debugging a run rather than part of the tree the run is scored on,
so a lost journal costs the operator some replay and costs the result nothing.
Ending the run over it would discard a real result to protect a debugging aid.

### The terminating line

Capture writes a terminating line on the normal exit path, carrying how many
entries the journal holds and, when capture stopped early, why. Its absence is
the only reliable signal that a session died mid-capture, because a killed gg
cannot write a self-reported truncation marker either.

## Ceilings and clipping

Three ceilings bound what a capture costs.

| Ceiling | Value | Applies to |
| --- | --- | --- |
| Journal bytes (`replayMaxBytes`) | 256 MiB | The whole journal; capture stops |
| Subprocess stream | 32 KiB | One recorded stdout or stderr |
| Tool payload | 256 KiB | One recorded tool output or lifted data text |

The journal ceiling is configurable among the run's
[execution limits](/gg/execution-limits/). It is the one ceiling that stops the
observation rather than the run.

The two payload ceilings are separate numbers with separate reasons, and the
tool one is the larger. A recorded stream is what a process printed, of which
the `shell` tool shows the model the last 16 KiB. A recorded tool payload is
what the model was shown, and the largest such payload is a whole-file
`read_file`, capped at 256 KiB by the filesystem tool itself. Sizing the tool
ceiling at that cap preserves the invariant a reader depends on: a payload the
model was shown in full is recorded in full, so a clip in the tool pool means
the tool layer had already clipped it too.

A clipped payload keeps its tail, matching the rule gg's own shell output cap
uses. The clip table records, for each clipped pool entry, how many bytes the
whole payload had and the whole payload's content address. That address is what
keeps a clipped record checkable: a reader holding the whole output can hash it
and answer whether it is the same output. It is also what makes dedup
unambiguous, because interning keys on the address of the original, so two
payloads that share a tail occupy two entries with two rows.

An image is recorded as its media type and decoded size and never as its bytes,
which is what the telemetry stream records of the same turn.

## Assembly on the host

Assembly is a [post-run stage](/gg/analysis/overview/#where-analysis-runs) named
`gg-session-record`. It applies to gg runs that wrote a journal; a missing
journal is an ordinary absence. It writes `replay.json.gz` at the root of the
run directory, never inside `implementation/`, which is a verbatim copy of what
the model produced.

The document is never built in memory. Each of its five arrays is streamed into
a segment file as the journal is walked, and the segments are copied through a
gzip encoder into the artifact, so peak memory is one journal line. Segment
files live in a scratch directory beside the output, which is the one volume
known to have room for them.

Damage is reported when it is bounded and refused when it is not. A journal that
stops early yields a shorter record that says so; a journal whose indices do not
line up would yield a record that looks complete and describes a conversation
that never happened.

| Condition | Outcome |
| --- | --- |
| No terminating line | `session_killed`; everything read is kept |
| A torn or unparseable line | `corrupt_journal` at the last complete `seq` |
| A terminating line whose count disagrees with the walk | `corrupt_journal` |
| The journal writer failed | `write_failed`, as the recorder reported it |
| The byte ceiling was crossed | `byte_ceiling`, as the recorder reported it |
| A pool line whose index is not the next one | Refused; no record is written |
| An entry referencing past a pool's end | Refused; no record is written |
| A journal in a format this build does not write | Refused; no record is written |

The journal's structure outranks its self-report: a recorder that stopped
deliberately still wrote a correct journal, so its reported reason stands unless
the walk found damage or the entry count disagrees.

A refusal is an ordinary stage failure. The run is untouched, and the honest
signal is a run with no record rather than a run with a subtly wrong one. On
success the stage removes the journal from the collected tree, since that tree
is copied into the run's `implementation/` directory and into the archive. A
refused journal is left where it is, because it is then the only account of the
session left to diagnose the refusal from.

## Salvage from a torn-down container

A `hung` or `timed_out` run never reaches artifact collection: the engine's
error path stops the container and returns. Those are the outcomes the record
most exists for, so the engine salvages the journal before teardown. The
artifact collector copies that single file out of a possibly-dying container
into a scratch directory shaped like a collected tree, and the same assembly
stage folds it into the same run directory a completed run's record is written
into. The publish path picks it up unchanged, and the record reports itself
killed, which is what happened.

Only the journal is salvaged. Salvaging the implementation tree would change
what a hung run means to validation, publishing and the review worklist, because
a half-written build would become something reviewers could open, score and
publish. The journal renders no verdict and reaches no score. Code analysis is
deliberately not run on the salvage path, since a figure computed over an empty
scratch directory would be a convincing-looking zero rather than an absence.

Every failure on this path is swallowed and the absent artifact is the signal.
The run being reported is already failing, and reporting that failure accurately
outranks the diagnostic.

## Excluding the journal from git

The journal grows inside the model's working tree while the session runs, so it
is excluded from git at seed time by appending an anchored `/.gg/` pattern to
the workspace's `.git/info/exclude`. An uncommitted exclusion keeps the path out
of the seed commit, out of the per-file diff a
[board issue's](/gg/project-management/) reviewers are handed, out of a worktree
commit, and out of the model's own `git add -A`. That last one is what keeps a
transcript of every model call out of the public per-run repository. The
exclusion has to be in place at seed time, because no publish-time filter can
undo a commit the model already made.

## Identity and compatibility

A record carries three identities, and they answer three different questions.

| Field | Question | May a reader branch on it? |
| --- | --- | --- |
| `formatVersion` | Can this build parse this record? | Yes; the compatibility contract |
| `recorder.ggVersion` | Which build wrote it? | No; explanatory only |
| `recorder.commit` | Which exact build wrote it? | Only to verify a resolved binary |

Gating on the gg version is wrong in both directions: a version bump with no
prompt change must not invalidate every record on every release, and an
uncommitted prompt edit within one build must not pass.

Format 1 is the one format this build reads, and every other value is refused. A
record stating another format may carry entry kinds this build has never heard
of, and reporting it as a format-1 record would hand a reader entries it cannot
mean, so parsing fails instead. `formatVersion` is required: a record that states
no format at all is malformed and does not parse. The refusal costs nothing
operationally, because the backend stores and serves records as opaque bytes, so
any stored record still downloads with a run's archive.

## Serving and consuming

The record is stored gzipped at the run tree's root, mirrored into the backend
store by the driver, and served at `GET /runs/{id}/replay`, content-negotiated
on the request's `Accept-Encoding`. A browser is handed the stored bytes
verbatim; a gzip-unaware client is handed them decoded. The negotiation keys on
the request header rather than on the stored bytes, because the workspace HTTP
client is built without gzip support while browsers always advertise it. Code
analysis is served through the same helper, under the same store slot shape and
route pair.

The record has no console view. Every gg surface the console renders, live and
post-run alike, is folded from the [telemetry](/gg/telemetry/overview/) stream,
which keeps a finished run's page identical to the one its live monitor showed.
The record is the diagnostic underneath, reachable through that route and in a
run's downloadable archive.
