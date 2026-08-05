---
title: "Session records"
---

A **session record** pins what a gg session consumed, so a run that explains
nothing on its own can still be explained. This page specifies **format v2**,
which rewrites the record from a per-turn transcript into a content-addressed
input log — and, because that removes the quadratic term, makes capture
**always-on** rather than an opt-in debugging capability.

The [session record](/gg/session-record/) page describes what the capture is for.
This is its format.

## The problem with v1

Today's record is a transcript: every turn re-serializes the whole conversation
and the whole offered-tool array. It is quadratic in messages, linear-times-N in
tool definitions, and carries full base64 image bytes inside that quadratic term.

The numbers come from a real captured record — a 23-entry, 12-turn, single-agent,
no-image session:

| Measure | Bytes |
| --- | ---: |
| On disk (pretty-printed) | 245,510 |
| Compact re-serialization | 157,593 |
| Σ per-turn conversation | 62,758 |
| Unique messages / unique bytes | 28 / 9,756 — **6.4× redundancy at 12 turns** |
| Σ per-turn tool definitions | 82,224 |
| Distinct toolsets | **1** — **12× redundancy, i.e. exactly N** |

The finding that reshaped the design: **the offered tool array was 52% of the
record — larger than the messages.** Pooling messages alone leaves half the bytes
on the table for a short run and a permanent `O(N)` term for a long one.

Images are the catastrophic case. A view's base64 payload is re-serialized every
turn it survives: one 500 KB PNG is ~67 MB over 100 turns, and
[autoloading a case's specifications](/gg/autoload-specifications/) seeds _all_ of
its reference mockups — four images across 100 turns is ~267 MB. Pooled, the same
four images are 2.7 MB, flat.

## The shape

> `seed` (fixed identity) + four content-addressed pools + an ordered input log

This is [Foray's](/testing/adversarial/foray/architecture/) replay shape applied to
gg: a fixed header plus the ordered inputs the session consumed. Size becomes
`O(unique bytes) + O(Σ window items)`.

**The four pools.** Messages, toolsets, texts, and image blobs. Each entry is
stored once under a content address and referenced by **index**.

- The **message pool** holds each distinct message body. Its id is a 128-bit
  SHA-256 content address over the message _including its exact image payloads_ —
  deliberately **not** the telemetry
  [`fingerprint`](/gg/context-visibility/), which is a 64-bit hash over image
  _descriptors_ and therefore not a content address for images at all. Two
  different pictures of the same media type and decoded size fingerprint
  identically, which is harmless for a telemetry log that discards the pixels and
  catastrophic for a replay that must send them again.
- The **toolset pool** holds each distinct offered tool-definition array. The
  measured 12× redundancy above collapses to 1.
- The **text pool** holds every large string payload — a tool outcome's output, a
  `git` invocation's stdout, a probe body. It exists because the two largest
  unpooled payloads are *duplicates of pooled material*: a tool's output is quoted
  verbatim into the `tool` message that carries it into the window, and an
  [issue review](/gg/project-management/)'s diff is quoted verbatim into the
  reviewer's prompt. Interning both against one table collapses each pair.
- The **blob pool** holds each image's base64 bytes.

**The input log** is a flat, ordered list of entries, each carrying the agent that
consumed the input and a globally monotonic `seq`.

## What counts as an input

The reason to enumerate this exhaustively is that v1 silently dropped four
categories that change control flow — so the record was blank precisely where a
developer was most likely to be looking.

| Input | Changes control flow? | v1 | v2 |
| --- | --- | --- | --- |
| Model responses | yes | captured | captured, tagged with the call shape |
| Model **errors** | **yes** — a vision refusal strips images and re-runs the turn; a retry exhaustion counts against an error ceiling | **dropped** | captured |
| [Handoff-compaction](/gg/compaction/) summarizer calls | yes — they rewrite the whole window | **not captured at all** | captured, on their own queue |
| Tool outcomes | yes | captured | captured, typed, text and images pooled |
| Orchestrator `git` — worktree add/commit/merge/diff | **yes** — a merge conflict changes the run | **bypasses tool dispatch entirely** | captured |
| Cancel-file probe | **yes** — it ends the session | dropped | captured |
| Deadline clock | **yes** | dropped | captured |
| Latency clocks | no — metrics only | dropped | captured at full fidelity only |
| Startup filesystem (skills, memories, autoloaded files, templates) | — | dropped | **not captured at either fidelity** — see below |
| Bulky text payloads (a command's streams, a tool's output) | yes | inline, whole | pooled; clipped at standard, whole at full |
| Cross-agent interleaving | yes | _observed_ via `seq` | the recorded `seq` **is** the input |
| RNG | — | none exists | none exists |

That handoff-summarizer row was a straight bug: gg's second compaction client was
never wrapped in the recording decorator, so **every handoff-compaction model call
in every record captured before v2 is missing**. Fixing it needed a discriminator
on the entry — otherwise a compaction turn and the agent's own turn interleave into
one indistinguishable queue. The client role is that discriminator.

Two categories are recorded as the **decision** rather than the mechanism: thread
interleaving (recorded as `seq`) and provider non-determinism (recorded as the
response).

## The prompt frame

The single most valuable thing v2 adds is not a size win. Four typed context
fields exist in gg's window model and are recoverable from **nowhere** — not the
telemetry stream, not the raw output, not the v1 record:

- an item's **retention** — whether it survives compaction verbatim;
- a paged file view's **region** — the `offset`/`limit` window it covers;
- the **turn** it was pushed on;
- its **slot** — which of the window model's three slots it came from.

The last one matters more than it looks. A system prompt and a rebuilt
context-usage signal are otherwise indistinguishable on the wire: both `System`
band, both unlabelled, both pinned.

v2 records all four as a `PromptFrame` entry at the one place in gg that holds the
`PromptItem` stream — the same call site that emits the telemetry
[`Prompt`](/gg/telemetry/) event. The frame lands after the model call it
describes and before that agent's next one, which is the same attachment rule tool
results already use, and it handles vision recovery correctly for free: a refused
image turn produces `error → call → frame`, so the frame attaches to the call that
was actually sent.

The recorder does **not** thread through the telemetry emitter to get this. The
emitter is telemetry and stays unaware of capture.

## Capture is a journal, and assembly is somebody else's job

v1 held every entry as an owned JSON value in a mutex for the whole run, then
serialized the lot in one shot at the end. v2 splits capture from assembly:

- **In the container, gg appends NDJSON lines to `.gg/replay.ndjson`** through a
  dedicated writer thread and never holds bodies in memory. A dedicated OS thread
  rather than a mutex-guarded writer, because gg runs every agent on one
  `current_thread` runtime — a synchronous file write on that runtime stalls every
  agent and skews the very turn timings the run is measured on.
- **On the host, after collection, `core` folds the journal into the served
  `replay.json.gz`**, streaming through gzip via segment files so peak memory is
  one journal line rather than one record. This is what satisfies the
  [budget constraint](/gg/analysis/overview/#design-principles): gg assembles
  nothing.

### Capture stops atomically — it never drops a line

A dropped pool line leaves a hole that positional assembly silently shifts,
substituting the wrong message body into a recorded prompt. That is
unacceptable, so nothing is ever dropped individually. Index minting and line
sending happen under **one** critical section, and any failure — a size ceiling, a
stalled disk, a dead writer — stops capture for the **whole run**. The pool arrays
are therefore always a contiguous prefix and no entry can reference a body that was
never written. Serialization happens outside the lock, so the lock is held for
nanoseconds.

### A record can never lie about being complete

Capture writes a **mandatory `End` line** on the normal exit path. Its absence is
the only reliable signal that a session died mid-capture — a killed gg cannot write
a self-reported truncation marker either, so assembly reads the _absence_ rather
than waiting for a report. No `End` ⇒ the record is marked killed. A torn final
line, a pool index that skips, or an entry referencing a body past the pool's end
all mark the record corrupt **at the last complete `seq`**, keeping everything
before it.

## The journal must be invisible to the run it observes

Streaming capture means the journal now grows *inside the model's working tree
during the run*, which is a new interaction with gg's own git plumbing that v1
never had. Left alone, the consequences are all real:

- an [issue's](/gg/project-management/) reviewers are handed a per-file diff stat
  built by staging the whole tree — the journal would be **in the diff they read**,
  growing it every round;
- a worktree commit would commit it;
- and the model has a shell and its own `git add -A`, so a mid-run model commit
  would push the journal to the **public per-run repository**. A publish-time
  exclusion cannot undo a commit the model already made.

The fix is to exclude `.gg/` at **seed** time through `.git/info/exclude` — the
mechanism seeding already uses for a game jam's prior-entries folder, and for
exactly the stated reason: an uncommitted ignore keeps a path out of both the seed
commit and the model's own `git add -A`, and travels with the repository into the
container and into every worktree.

This also fixes a **pre-existing** exposure: today a replay-captured run's
`.gg/replay.json` _is_ caught by the publisher's blanket `git add --all`. Already
published repositories are not retroactively cleaned; any containing a
`.gg/replay.json` need a separate audit.

## Salvaging the runs the record exists for

Streaming capture does not, on its own, rescue the runs that most need rescuing. A
`hung` or `timed_out` run **never reaches artifact collection** — the engine's
error path stops the container and returns before the collector runs — so there is
no collected tree and therefore no journal to assemble. Those are precisely the
surprising outcomes the record was built for.

So the artifact collector grows one narrowly-scoped method: copy a single sidecar
file out of a possibly-dying container, best-effort, returning "not found" rather
than failing the run's error path. The engine salvages the journal **before**
teardown and assembles it into the same directory the failed record is later
written to, so the two land together and the existing publish path picks it up
unchanged.

## Identity, and what a reader may branch on

The record carries three identities because they answer three different questions,
and conflating them is how a version check becomes the bug:

| Field | Question | May a reader branch on it? |
| --- | --- | --- |
| `formatVersion` | Can this build parse this record at all? | **Yes** — this is the compatibility contract |
| `ggVersion` | Which build wrote it? | No — explanatory only |
| `commit` | Which _exact_ build wrote it? | Only to verify a resolved binary is the one that recorded |

Using `ggVersion` as the gate is wrong in **both** directions: a version bump with
no prompt change must not invalidate every record on every release, and an
uncommitted prompt edit _within_ one build must not pass.

`formatVersion` is `#[serde(default)]`, and its absence means format 1. This is
not cosmetic — every record captured to date has no version field, and the backend
stores and serves them as opaque bytes. A required field would fail to parse all of
them.

Foray writes a replay version and never checks it. Do not copy that omission: a
record from a newer gg is **refused**, not guessed at.

## Always-on

With pooling, a projected 200-turn run drops from **~187 MB to ~3.6 MB compact,
~0.5 MB gzipped**. Against a run tree that already carries tens of megabytes of
produced source, capture is no longer a cost worth gating.

So **standard capture is always on**, and the `replay`
[capability](/gg/configurations/) is repurposed to escalate a run to **full**
fidelity — every clock read, and no payload clipping. Three reasons, in order of
weight:

1. **An opt-in debugging capture is never on when you need it.** The record exists
   for surprising outcomes, which are by definition not predicted.
2. **It is now the only artifact from which the four typed context fields exist at
   all.** Making that opt-in makes gg's own context construction unauditable by
   default.
3. It costs under a megabyte.

Always-on also removes a defect on the way past: the capability was read from the
**root agent only**, so enabling `replay` on a non-root agent silently did nothing.
The full-fidelity escalation reads any agent.

A per-run byte ceiling bounds the worst case. Crossing it stops capture and marks
the record truncated — **capture degrades, it never fails the run it observes.**

### What the two fidelities actually differ by

The difference is deliberately small. A capture that is on for every run is only
worth having if what it captures is enough on its own, so **every input that
changes control flow is recorded at both fidelities** — including the deadline
clock, which is the one clock read the loop branches on.

**Full adds two things.** It stores every text payload whole, and it records each
model call's measured latency.

**A clipped payload says so.** The text pool is a flat array of strings with
nowhere to record that an entry is a fragment, and a reader handed 32 KiB of a
command's output cannot otherwise tell a command that printed exactly that much
from one that printed forty megabytes — which is precisely the case where the
missing part is the part worth having. So the record carries a sparse **clip
table**: for each clipped pool entry, how many bytes the whole payload had and
**its content address**. That address is what keeps a clipped record *checkable*:
anyone holding the whole output can hash it and answer "is this the same output?"
exactly, from a record that kept a fraction of it. It is also what makes the pool's
dedup unambiguous — interning
keys on the address of the original, so two payloads that happen to share a tail
are two entries with two rows rather than one entry whose single row could
describe only one of them.

### The startup filesystem is not a fidelity axis

The original design named a third full-only category — the startup filesystem,
"digested at standard, verbatim at full". Implementing it established that it
decomposes into four parts, none of which is a fidelity distinction:

- **Prompt templates** are embedded in the gg binary at compile time. They are
  never read from a filesystem, so there is nothing to digest; which templates a
  run used is exactly what the recorder's `commit` answers.
- **Memories** are created during the session, not loaded at startup. Every
  mutation is already a recorded tool outcome and every rendered index is already
  a pooled message.
- **Autoloaded specification files** belong to the seed as blob references —
  verbatim at *both* fidelities and for zero additional bytes, since they were
  sent to the model and are in the blob pool either way. Withholding them at
  standard would make a record less self-contained while saving nothing.
- **Skills** are a real directory read, but every skill body that influences the
  run reaches the record verbatim regardless: the description listing is part of
  the pooled system message, and reading one is a recorded tool outcome. What a
  verbatim capture would add is the body of a skill the session *never read* —
  inventory rather than input, and not something the session ever consumed.

## Serving and consuming

The record is stored gzipped at the run tree's root, mirrored into the backend
store, and served content-negotiated on the request's `Accept-Encoding`. That
negotiation is required rather than cosmetic: the workspace HTTP client is built
without gzip support, so it neither advertises the encoding nor decodes it, while
browsers always advertise it. Keying on the stored bytes instead of the request
header is simply the wrong axis.

This is the artifact convention the rest of gg analysis follows —
[code analysis](/gg/analysis/code-analysis/) uses the same store slot shape, route
pair, driver mirror, and negotiation helper.

The record has no console view. Every gg surface the console renders — live and
post-run alike — is folded from the [telemetry](/gg/telemetry/) stream, which is
what keeps a finished run's page identical to the page its live monitor showed. The
record is the diagnostic underneath, reachable in a run's downloadable archive.
