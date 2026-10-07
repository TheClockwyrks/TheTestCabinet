# Drive gg's session-side SDK modules from Python programs

The Python arm's own test file drives the workspace half of gg's surface hard and
leaves the half that acts on the session thinly covered: context, delegation,
programs, docs, views, session and the feedback channel. Give every operation in
those modules a Python program that makes the successful call and asserts the
state it left, and a Python program per runtime failure mode that reads the
failure back the way a model would.

## Current state

The arm's harness is
[`python.substrate.test.rs`](../../crates/gg/src/sandbox/language/python.substrate.test.rs)
and every case here reuses it. `run_with` (`python.substrate.test.rs:84`) runs one
program against the real membrane with an operation allowlist, ceilings and a
responder; `run_as` (`:135`) adds the two things a role decides, the ending group
and whether the run keeps a program library; `run` (`:188`) is the bare form.
`logs` (`:206`) reads what a program printed and insists it did not throw, and
`program_error` (`:221`) reads the throw it did not catch. The guest comes from
the production component cache through `component` (`:66`).

The tool side is `FakeOperationApi` (`crates/gg/src/sandbox/fake.test.rs:141`)
with its `CallLog` (`:90`), which records the exact JSON each call arrived as.
`canned_outcome` (`:780`) answers every tool plausibly, and a closure in its place
is how a case injects one failure — the pattern `a_failed_call_arrives_as_a_python_exception`
already uses to make `edit_file` a conflict (`python.substrate.test.rs:1555-1567`).
`all_operations` (`fake.test.rs:1151`), `all_operations_without` (`:1185`) and
`granted_operations` (`:1165`) build the allowlists, and `with_program` (`:295`)
seeds the library.

What these modules already have on this arm: the crossing table
(`python.substrate.test.rs:1180-1398`) drives the four context calls and the six
delegation calls and asserts the JSON each composed; `the_sdk_hands_a_program_values_python_can_read`
reads a `SubagentResult` back from a no-argument `wait_for_subagents` and an
`ArchiveSearch` back from `search_archive` (`:1472-1476`, asserted at `:1504-1505`);
the neither-nor-both subagent brief is refused by the guest (`:1648-1667`);
`the_views_the_docs_and_the_program_library_modules_are_reached_in_python_too`
drives `views.open_text`, `views.close` including a selector nothing is open under,
`views.open_docs_view` by function reference and by string, `views.open_file` whole
and paged, `programs.history`, `programs.get` including its `not-found`,
`programs.rerun`, `docs.search` with its results view, `docs.close` and
`docs.close_all` over an empty window, and `docs.close_all` refused as `unavailable`
(`:2080-2324`); the line cut crosses at `:2423`; `ProgramSummary.source` and
`SubagentHandle.send` reach their operations at `:1977` and `:2059`. On the
feedback channel, `log` is covered including a partial line and `sys.stderr`
(`:456-462`), `report_error` at `:1537-1605` and through gate G8 at `:2325`, and
`report_module_error` at `:1063-1078`.

Nothing in the session module is called from a Python program: `session.finish`,
`session.approve` and `session.request_changes` are only checked for bindability
(`:1836`, `:1905`).

The file's note at `:24-29` asks a reader to add a program to an existing function
rather than a function, with the cost explained at `:110-125`. Revise it as part
of this work: the component is compiled once per process behind a `OnceLock`, and
a whole program costs a fraction of that compile, so each case below is its own
short `#[test]` driving one Python program with one assertion. The guidance the
note keeps is that each program stays short.

## Design

### The double answers the refusals it does not model yet

Several documented failure modes cannot be produced from any program because the
double answers those calls itself. Teach it the rules the production api already
enforces, so the case list below is reachable:

- `open_text_view` (`fake.test.rs:717`) refuses a label over 200 bytes and a body
  over 65,536 bytes with `ToolFailure::LimitExceeded`, naming the size and the
  bound, mirroring `crates/gg/src/agent.code.rs:2775` and `:2784`. It already
  refuses a blank label.
- `open_file_view` (`fake.test.rs:676`) refuses a `max_line_chars` outside 1 to
  65,536 with `InvalidArgument` and a window whose body is over 65,536 bytes with
  `LimitExceeded`, mirroring `agent.code.rs:2838` and `:2820`.
- `search_docs` (`fake.test.rs:642`) refuses a search carrying neither a query nor
  a filter, an unrecognised `kind`, and a `limit` of zero, each `InvalidArgument`
  naming the argument — the three the SDK documents at
  `packages/gg-sandbox/src/gg/docs.ts:97-99`. No existing case passes any of them,
  so this is additive.
- `search_docs` gains an opt-in builder in the shape of `with_program`, seeding one
  `DocHit`, so a program can read a hit's `key`, `kind`, `module`, `name` and
  `summary` back. Unset, it keeps answering an empty page.
- `open_docs_view` (`fake.test.rs:625`) gains an opt-in builder naming the entries
  the double knows and, for each, whether this agent binds it. An unknown name
  refuses `not-found` naming it; a known name the agent does not bind refuses
  `not-found` saying so. Unset, it keeps opening a view for every name.

### context

Lands in a new function beside the crossing table. The successful crossings of all
four calls are at `python.substrate.test.rs:1347-1366` and are not repeated;
what is added is the state each call left and the failures.

- an eviction hands back a reclaim report whose items, reclaimed tokens, paths and
  detail the program reads.
- an eviction with no path drops every file view and sends no path.
- an eviction of an empty path is `invalid-argument`.
- an archive hands back a report whose paths list is empty.
- an archive of an empty list is `invalid-argument`.
- an archive of more than thirty-two spans is `invalid-argument`.
- an archive of a span that ends before it starts is `invalid-argument`.
- an archive of an entry that is not a `TurnRange` is refused by the guest, naming
  the argument, and reaches no tool (`packages/gg-sandbox-python/src/gg/context.py:115-135`).
- an archive of a `TurnRange` carrying a negative end is refused by the guest before
  it wraps into a `u32`.
- an archive search reads its hits back — covered at `:1475-1476`.
- an archive search over an empty archive reports the archive empty and no hits.
- an archive search that matched nothing reports the archive not empty and no hits.
- an archive search of an empty query is `invalid-argument`.
- a compaction is registered and the program keeps running, logging a line after
  the call.
- a compaction of a blank summary is `invalid-argument`.
- a compaction with no files sends an empty list.
- a compaction handed a bare string for its files is refused by the guest
  (`packages/gg-sandbox-python/src/gg/core.py:186-208`).

### delegation

- a subagent briefed from an issue id crosses carrying the issue brief; the prompt
  form is at `:1367-1371`.
- a spawned child's handle carries the id, slot and model the program reads.
- a spawn at the delegation depth cap is `limit-exceeded`.
- a spawn of an agent this session may not spawn is `invalid-argument`.
- a brief that is neither a prompt nor an issue, and one that is both, are refused
  by the guest — covered at `:1648-1667`.
- a wait on an explicit id list crosses — covered at `:1372-1376`.
- a wait with no ids collects every child and reads a status back — covered at
  `:1472-1473`.
- a wait on an unknown id is `not-found`.
- a wait over a child that has not ended reads no status.
- every `AgentEnding` member reaches the program as its own member.
- a message to a child crosses — covered at `:1377-1381`.
- a message to an unknown agent id is `not-found`.
- a message to a child that already returned is `conflict`.
- a state transition crosses — covered at `:1382-1386`.
- a transition to a state this session may not move to is `invalid-argument`.
- a second succession in one turn is `refused` and the program keeps running, with
  the responder failing the second call; the rule itself is asserted at
  `crates/gg/src/agent.transitions.test.rs:141`.
- a transition from an agent standing in no machine state is `unavailable`, driven
  from an allowlist that omits the one `Binding::Machine` row
  (`crates/gg/src/sandbox/operations.rs:692-697`).
- an exec crosses — covered at `:1387-1391`.
- an exec of an agent this session may not become is `invalid-argument`.
- an exec returns and the program runs to its end, logging a line after it.
- an exec after a transition in the same program is `refused`, since the two share
  the succession slot.
- a fork crosses — covered at `:1392-1396`.
- a fork hands back a handle the program can name.
- a fork at the delegation depth cap is `limit-exceeded`.

### docs

- a search crosses, lowers its `DocKind` argument and leaves its page in the window
  under gg's own selector — covered at `:2274-2310`.
- a search reads a hit's key, kind, module, name and summary back.
- a search answers a program granted nothing at all, which is what `Binding::Always`
  means (`operations.rs:710`).
- a search carrying neither a query nor a filter is `invalid-argument`.
- a search with an unrecognised kind is `invalid-argument`.
- a search with a limit of zero is `invalid-argument`.
- a close of a key naming no open documentation view closes nothing and is not an
  error — covered at `:2282`.
- a close is `unavailable` when the run did not enable `docview-close`; the blanket
  form is covered at `:2311-2324`.
- a blanket close over an empty window returns zero — covered at `:2282`.
- a close aimed at a text view's label closes no text view, and the outcome's closed
  views stay empty: `docs.close` and `views.close` are separate operations
  (`operations.rs:231`, `:253`) sharing one word.

### views

- a whole file, a page and a line cut open — covered at `:2098`, `:2136` and `:2423`.
- an open of a missing path is `not-found` and opens no view.
- an open with a `max_line_chars` of zero is `invalid-argument`.
- an open with a `max_line_chars` over 65,536 is `invalid-argument`.
- an open whose window would be over the byte cap is `limit-exceeded`, naming the
  size and the bound.
- an open with a negative offset is refused by the guest and reaches no tool; the
  `files.read_file` counterpart is at `:1611-1625`.
- an open is `unavailable` when the run withholds `read-file`.
- a text view opens under its label — covered at `:2089-2090`.
- a text view with a blank label is `invalid-argument` and opens nothing.
- a text view with a body over the ceiling is `limit-exceeded`.
- a text view with a label over the ceiling is `limit-exceeded`.
- a text view opens for a program granted nothing at all.
- re-opening one label supersedes the view rather than adding a second.
- documentation opens by function reference and by name — covered at `:2095-2096`.
- a documentation lookup of a value that is neither is refused by the guest —
  covered at `:2163`.
- a documentation lookup of an unknown name is `not-found`.
- a documentation lookup of a name this agent does not bind is `not-found`.
- a close reports how many went, and zero for a selector nothing is open under —
  covered at `:2091`.
- a close of an empty selector is `invalid-argument`.
- a close is `unavailable` when the run withholds `agent-managed-context`.

### programs

- history, get and rerun run against a seeded library, and get of an id never issued
  is `not-found` — covered at `:2209-2224`.
- history before the first program is an empty list.
- history, get and rerun are each `unavailable` for a run with no library, driven
  from `all_operations_without(CAPABILITY_PROGRAM_LIBRARY)` and `library` false.
- get of an id the library has dropped since the history was read is `not-found`,
  driven by seeding more programs than the library's retention holds.
- a rerun of a blank source is `invalid-argument`
  (`crates/gg/src/sandbox/membrane/programs.rs:92-97`).
- a second rerun from one program is `refused` and the first hand-over stands.
- a rerun refused over its argument leaves the refusal roster empty, unlike a
  refusal from a gate.
- a program that reruns and then raises has its hand-over revoked.
- a summary's `source` method fetches that program — covered at `:2059`.

### session

Each case runs through `run_as` with the role it needs.

- a finish records a completion carrying the summary.
- a second finish in one program replaces the summary and the replacement is
  counted.
- a finish of a blank summary is `invalid-argument` and the run stays live.
- a program that finishes and then raises has its completion revoked and kept.
- a finish from a review session is `unavailable`.
- an approve records the review ending.
- an approve from a standard session is `unavailable`.
- a request for changes records its items.
- a request for changes with an empty list is `invalid-argument`.
- a request for changes every entry of which is blank is `invalid-argument`
  (`crates/gg/wit/gg-sandbox.wit:693`).
- a request for changes mixing blank and real entries records the real ones,
  trimmed.
- a request for changes from a standard session is `unavailable`.

Finishing after the wall-clock budget is spent is asserted where the clock is, at
`crates/gg/src/sandbox/membrane/session.test.rs:166`.

### feedback

The Python guest reports through three of the five calls
(`packages/gg-sandbox-python/src/shim.py:39-46`, `:493`, `:347`). The two it does
not are a contract worth pinning rather than a gap.

- printing reaches the host a line at a time, a partial line is flushed at the end,
  and `sys.stderr` is the same channel — covered at `:456-462`.
- an uncaught failed call is reported with its code and the program's own line —
  covered at `:1537-1605`.
- a code module that throws is reported against its own name and the program still
  runs — covered at `:1063-1078`.
- a program whose last statement evaluates to a value notes no return, because a
  Python module has no return value to discard.
- a program that runs work through `asyncio.run` makes its calls inside the program
  and leaves no deferred note, because this guest has no post-program continuation.

## Done when

- [ ] The double refuses the view ceilings, the `max_line_chars` range and the three
      documentation-search argument mistakes, and can be seeded with a documentation
      hit and with the entries it knows.
- [ ] Every case listed for context, delegation, docs, views, programs, session and
      feedback that is not already cited is its own short `#[test]` in
      `python.substrate.test.rs`, driving one Python program with one assertion.
- [ ] The consolidation note at
      `crates/gg/src/sandbox/language/python.substrate.test.rs:24` reads as a rule
      about program length rather than about function count.
- [ ] Every operation in those modules has a Python program that makes the
      successful call and asserts the state it left.
- [ ] No case reaches a real model or provider.
- [ ] Gates green.
