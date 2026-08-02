# Playback fixtures

Whole recorded `gg` sessions, checked in, each of which asserts that **this** build of
`gg` still reconstructs it. See
[`crates/gg/src/playback/fixtures.test.rs`](../../playback/fixtures.test.rs) and the
[playback docs](../../../../../apps/docs/src/content/docs/gg/analysis/playback.md).

Each file is a
[replay record](../../../../../apps/docs/src/content/docs/gg/analysis/replay-records.md) in
exactly the shape a run tree's `replay.json.gz` has — assembled by the host's own
assembler from the journal a real turn loop wrote, not serialized from memory.

| Fixture | The session shape it pins |
| --- | --- |
| `single-agent-tools.json.gz` | the plain turn loop: a write, a read of what the write made, a memory that then rides every later prompt |
| `issue-review.json.gz` | an auto-dispatched issue, a reviewer that sends it back, a second dispatch — three agents `gg` creates with **no parent**, bound only by board state |
| `responses-as-code.json.gz` | the transpiler, the `wasmtime` sandbox, the typed membrane and the deferred-effect machinery, re-run against recorded program text |
| `board-race.json.gz` | two agents genuinely in flight at once, interleaved by latency alone — the record the ordering barrier exists for |
| `delegation.json.gz` | a subagent that spawns its **own** subagent (a depth-2 spawn, the one origin that names a counter-minted id), and the only recorded `shell` commands in the suite |

## What the suite does and does not reach

Across the five records the model seam, the tool seam, `git`, the ordering barrier and — since
`delegation` — the `shell` seam are all exercised against a frozen record. Two things are
still only covered by in-process tests rather than by a committed one:

- **A handoff succession.** No fixture contains a `succession` origin, so compaction's
  agent-to-agent handoff is pinned by the loop suite alone.
- **A reconstruction whose agent ids disagree with the run's.** Every fixture replays into the
  same ids it recorded, because each was captured from a session whose agents are created in one
  ordered sequence. The origin translation that makes a depth-2 spawn bind regardless is pinned
  by `playback::binding`'s unit tests instead.

## Provenance

The records here are **not real model sessions**. No provider credential existed in the
environment they were captured in, so every one was driven by `gg`'s offline `MockClient`
— through the real turn loop, the real tools, the real recorder and the real assembler,
but against scripted model output.

That costs only the realism of the *content*. The regression signal comes from the
request `gg` builds, not from the answer it gets: edit a prompt template and every
fixture fails at once, naming the component that moved.

Real sessions are permitted here and would be strictly better. Capture one, keep it
inside the budget below, drop it in the directory — the loader discovers files rather
than listing them, so no code changes.

## Budget

At most **six** fixtures, at most **500 KB** each. Both are asserted by
`the_fixture_suite_stays_within_its_committed_budget`, because the case the cap exists
for — somebody committing a real captured session — is the case where the size is not
obvious until it is in the repository forever. Trim a real capture by shortening the
session and stripping its image blobs.

## Regenerating

```sh
cargo nextest run -p test-cabinet-gg --run-ignored only capture_the_committed_fixtures
```

Needed whenever `gg`'s prompt construction changes on purpose — which is exactly when
the suite goes red. The diff of what it regenerates is then the record of what the
change did to every recorded session's requests.
