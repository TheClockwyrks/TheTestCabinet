# Drive gg's session-side SDK modules from Rust programs

Give the Rust arm a program-level test for every call in `context`, `delegation`,
`programs`, `docs`, `views` and `session`, and for the feedback channel underneath
them: one short test per successful call asserting the state it leaves behind, and
one short test per distinct runtime failure mode. Every test drives a real `rustc`
compile through the real membrane against a synthesized answer; none reaches a
model or a provider.

## Current state

The operation vocabulary these modules name is
`crates/gg/src/sandbox/operations.rs:192` through `:272`. Four binding kinds decide
who holds each one: `delegation.transition_state` is the single `Binding::Machine`
row (`crates/gg/src/sandbox/operations.rs:695`), and `docs.search`
(`:710`), `views.open_text` (`:729`) and `views.open_docs_view` (`:733`) are
`Binding::Always` — bound to a program whose run granted nothing at all.

The arm's SDK is `packages/gg-sandbox-rust/src/`, one module per family. It carries
no guest-side guards: every function is a thin `wire::lift` over the membrane import
(`packages/gg-sandbox-rust/src/context.rs:38`,
`packages/gg-sandbox-rust/src/views.rs:41`), so every failure mode is produced by the
host or by the api behind it and reaches the program as an `ApiError` carrying a code,
the operation's key and gg's own sentence. The rustdoc on each function is the
contract: `context.rs:35`, `:60`, `:83`, `:106`; `delegation.rs:43`, `:70`, `:87`,
`:107`, `:129`, `:157`; `docs.rs:44`, `:74`, `:91`; `views.rs:37`, `:59`, `:85`,
`:109`; `programs.rs:72`; `session.rs:24`, `:55`.

The harness is already in place. `crates/gg/src/sandbox/language/rust.substrate.test.rs:72`
`prepare` runs the production compile step; `:99` `evaluate` runs the component
through the real membrane with a stated operation list, ending role and library flag;
`:117` `evaluate_closing_docviews` grants everything with no ending group; `:137`
`evaluate_with_program` seeds a library holding one program under an id and turn.
`:228` `logs`, `:249` `trap` and `:265` `program_error_location` read the outcome back.
`crates/gg/src/sandbox/language/rust.surface.test.rs:72` `whole` writes a program the
way a model writes one, and `:92` `run_with` is the no-ending shorthand. The double is
`crates/gg/src/sandbox/fake.test.rs`: `FakeOperationApi` answers every call,
`CallLog` records the name and JSON each one arrived with (`:102`, `:117`),
`canned_outcome` (`:780`) supplies a typed payload per tool, and `with_program`
(`:295`) seeds the library. `all_operations` (`:1151`) and `all_operations_without`
(`:1185`) build the grant.

What the arm covers today:

- Every `context` and `delegation` call crosses the membrane with the right JSON, from
  the table at `rust.surface.test.rs:130` driven at `:384`. The table pins arguments
  only; no test reads the values these calls hand back.
- `views.open_file`, `open_text`, `open_docs_view`, `close`, `docs.search`,
  `docs.close`, `docs.close_all` and `session.finish` are driven at
  `rust.surface.test.rs:436`. `views.close` of an open selector and of one never opened
  are both there (`:447` and `:448`, asserted `:482`). `docs.close` and `docs.close_all`
  refused for a withheld `docview-close` are asserted at `:492` and `:493`, and both
  closing nothing is asserted at `:525`, which covers the whole of those two calls.
- `programs.history` on an empty library, `programs.get` on an id never issued,
  `programs.rerun` and `session.request_changes` are driven at `rust.surface.test.rs:538`;
  `session.approve` at `:577`. `ProgramSummary::source` over a seeded library is at `:681`.
- `SubagentHandle::send` and the handle's own id are read at `rust.surface.test.rs:613`.
- A failure read as a `Result` and a failure let out with `?` are at
  `rust.surface.test.rs:694`; a withheld capability refused as `Unavailable` at `:746`.
- `gg::log` is the only feedback call this arm's guest makes
  (`packages/gg-sandbox-rust/src/lib.rs:174`). Its `Display` argument is exercised by
  the custom `Display` type at `rust.substrate.test.rs:296`. An uncaught failure dies as
  a trap rather than over `report-error`, gated for all five shapes at
  `rust.substrate.test.rs:870`, and a code module the compiler refuses is refused at
  prepare time in its author's own coordinates (`rust.substrate.test.rs:793`).

Both files carry a comment telling the reader to add statements to an existing function
rather than adding one (`rust.surface.test.rs:14`, `rust.substrate.test.rs:42`), on the
ground that a compile is expensive. `crates/gg/src/sandbox/language/rust.compile.rs:29`
measures it: the whole `rustc` compile and encode is ~45-60 ms, and the wasmtime
`Component::new` beside it ~15 ms.

## Design

### Shape

Every case below is its own `#[test]` in
`crates/gg/src/sandbox/language/rust.surface.test.rs`, driving one program and asserting
one behaviour. Revise the consolidation comments at `rust.surface.test.rs:14` and
`rust.substrate.test.rs:42` to record the measured per-program cost and to say that a
behaviour gets a function of its own. Divide
`the_views_module_the_helper_and_the_standard_ending_are_reached_in_rust_too`
(`rust.surface.test.rs:436`) and
`the_program_library_and_a_reviewers_verdict_are_reached_in_rust_too` (`:538`) into one
function per behaviour as part of the same work; the crossing table at `:130` stays as it
is, because its claim is the byte-identical argument lowering shared with the other arms.

A success case asserts the post-call state, not the crossing: the value the program read
back, the views the outcome recorded, the completion or hand-over it registered. A failure
case asserts the code, the operation key and the sentence the program read.

### Producing a failure

Three mechanisms, by module:

- `context` and `delegation` are tool-backed, so the test's responder returns
  `ToolOutcome::failed(ToolFailure::…, "…")` for that tool name and the program reads the
  lifted `ApiError`, exactly as `rust.surface.test.rs:694` does for `read_file`.
- `programs.rerun` and all three `session` calls are refused inside the membrane —
  `crates/gg/src/sandbox/membrane/programs.rs:94` and `:100`, and
  `crates/gg/src/ending.rs:166` and `:191` behind
  `crates/gg/src/sandbox/membrane/session.rs:49` — so a bad argument in the program text
  drives the real guard with no seam at all. The role gate is the `RunEnding` the test passes.
- `views` and `docs` are refused by the api behind the membrane
  (`crates/gg/src/sandbox/membrane/views.rs:113`,
  `crates/gg/src/sandbox/membrane/docs.rs:134`). The double models an empty
  `open_text_view` label (`fake.test.rs:723`) and an empty `close_view` selector
  (`:734`) and nothing else. Add one builder to `FakeOperationApi`, beside `with_program`,
  that arms the next `open_text_view`, `open_docs_view` or `search_docs` to answer a given
  `ViewRefusal`; the cases below name which refusal each uses. `views.open_file` needs no
  seam: it dispatches a `read_file` (`fake.test.rs:676`), so its failures come from the
  responder.

Withholding `delegation.transition_state` needs a grant that drops one instance operation
rather than one capability's: build it as `all_operations()` filtered to remove
`DELEGATION_TRANSITION_STATE`.

### context

| Case | Test |
| --- | --- |
| `evict_file_view` of a named path | reads the `ReclaimReport` back: `items`, `reclaimed_tokens`, `paths`, `detail` |
| `evict_file_view` with no path | `None` sends `{"path": null}` and drops every file view |
| `evict_file_view` of an empty path | `InvalidArgument` |
| `archive_thread` over two spans | reads the `ReclaimReport` back |
| `archive_thread` of an empty list | `InvalidArgument` |
| `archive_thread` of more spans than the cap | `InvalidArgument` |
| `archive_thread` of a span that ends before it starts | `InvalidArgument` |
| `search_archive` that matches | reads `archive_empty` false, the hit's `seq`, its `MessageRole` and its text |
| `search_archive` over an empty archive | a responder answering `archive_empty` true with no hits, told apart from a search that matched nothing |
| `search_archive` of an empty query | `InvalidArgument` |
| `compact` | returns nothing, the program runs on and logs after it, and the compaction is registered rather than performed |
| `compact` with a blank summary | `InvalidArgument` |

### delegation

| Case | Test |
| --- | --- |
| `spawn_subagent` with `Brief::Prompt` | reads the handle's `id`, `slot` and `model_id` |
| `spawn_subagent` with `Brief::Issue` | the issue form of the brief, asserting `{"agent": …, "prompt": null, "issueId": …}` |
| `spawn_subagent` at the depth cap | `LimitExceeded` |
| `spawn_subagent` of an agent this session may not spawn | `InvalidArgument` |
| `wait_for_subagents` with an id list | reads each `SubagentResult`'s `id`, `Some(AgentStatus::Completed)` and summary |
| `wait_for_subagents` with no ids | `None` sends `{"ids": null}` and waits for every outstanding child |
| `wait_for_subagents` over a child with no ending | `status` reads `None` |
| `wait_for_subagents` on an id this session did not spawn | `NotFound` |
| `send_message` to a running child | delivered, and the program runs on |
| `send_message` to an unknown agent id | `NotFound` |
| `send_message` to a child that has returned | `Conflict` |
| `transition_state` | registered, and the program runs to its end after it |
| `transition_state` to a state this session may not move to | `InvalidArgument` |
| `transition_state` twice in one turn | `Refused`, and the first declaration stands |
| `transition_state` with the operation withheld | `Unavailable`, from the `Machine` binding rather than from a capability |
| `exec` | returns, the program keeps running and logs after it, and the succession is applied when the turn closes |
| `exec` of an agent this session may not become | `InvalidArgument` |
| `exec` from a session a state machine is driving | `Unavailable`, which a state transition is the way out of |
| `exec` after a `transition_state` in one program | `Refused` — the two share the succession slot and the first wins |
| `fork` | the copy's id comes back immediately, before the copy has started |
| `fork` with a blank prompt | `InvalidArgument` |
| `fork` at the depth cap | `LimitExceeded` |
| `fork` with the capability withheld | `Unavailable` |

### programs

| Case | Test |
| --- | --- |
| `history` over a seeded library | reads the summary's `id`, `turn`, `lines`, `chars`, `ok` and `error` |
| `history` with no library | `Unavailable` |
| `get` of a seeded id | reads the program's source back |
| `get` of an id a non-empty library does not hold | `NotFound`, the sentence naming the ids that are held |
| `get` with no library | `Unavailable` |
| `rerun` with a blank source | `InvalidArgument` |
| `rerun` twice in one program | `Refused`, and the first hand-over stands |
| `rerun` with no library | `Unavailable` |
| `rerun` from a program that then fails | the hand-over is taken back: `rerun` is empty and `revoked_rerun` is set |

`history` over an empty library and `get` of an id never issued are already driven at
`rust.surface.test.rs:545` and `:547`, asserted together at `:563`.

### docs

| Case | Test |
| --- | --- |
| `search` from an agent granted nothing | a run with no operations still answers, which is the `Always` binding |
| `search` with neither a query nor a filter | `InvalidArgument` |
| `search` with a `limit` of zero | `InvalidArgument` |

The successful `search` and its `search results` view are at `rust.surface.test.rs:454`
and `:498`. `close` and `close_all` have one failure mode each and both are covered, at
`:492` and `:493`, with the nothing-open answer at `:525`. An unrecognised `kind` is not
a case on this arm: `DocKind` is an enum, so the program does not compile.

### views

| Case | Test |
| --- | --- |
| `open_file` | reads the `FileRead` back and records one view under the path |
| `open_file` of a path that is not there | `NotFound`, and no view is opened |
| `open_file` with an offset past the end of the file | `InvalidArgument` |
| `open_file` with a `max_line_chars` of zero | `InvalidArgument` |
| `open_file` with a `max_line_chars` over the ceiling | `InvalidArgument` |
| `open_file` whose window would exceed the size cap | `LimitExceeded`, the sentence naming the size and the bound |
| `open_file` with `read-file` withheld | `Unavailable` |
| `open_file` twice under one selector | the second supersedes rather than duplicating |
| `open_text` from an agent granted nothing | a run with no operations still shows the model something |
| `open_text` with an empty label | `InvalidArgument` |
| `open_text` with a body over the cap | `LimitExceeded`, the sentence naming the cap |
| `open_text` with a label over the cap | `LimitExceeded` — a cap of its own |
| `open_docs_view` from an agent granted nothing | every view the call placed is recorded |
| `open_docs_view` of an unknown name | `NotFound` |
| `open_docs_view` of a name this agent does not bind | `NotFound`, worded to point at `docs.search` |
| `close` with an empty selector | `InvalidArgument` |
| `close` with `agent-managed-context` withheld | `Unavailable` |

The successful `open_text`, `open_docs_view` and `close` and the close of a selector
nothing is open under are at `rust.surface.test.rs:445`, `:446`, `:447` and `:448`.

### session

| Case | Test |
| --- | --- |
| `finish` with a blank summary | `InvalidArgument` |
| `finish` twice in one program | the later summary replaces the earlier one and the replacement is counted |
| `finish` from a program that then fails | the completion is taken back: `completion` is empty and `revoked_completion` holds the ending |
| `finish` from a review session | `Unavailable`, the sentence naming this role's own endings |
| `approve` from a standard session | `Unavailable` |
| `request_changes` with an empty list | `InvalidArgument` |
| `request_changes` with a list whose entries are all blank | `InvalidArgument` — a distinct cause from the empty list, per `crates/gg/src/ending.rs:191` |
| `request_changes` from a standard session | `Unavailable` |

The successful `finish`, `approve` and `request_changes` are at
`rust.surface.test.rs:470`, `:577` and `:552`.

### feedback

The Rust guest calls one function on `crates/gg/wit/gg-sandbox.wit:1060`'s interface,
`log`, and that is the arm's whole feedback surface. The other four are host-side facts
this arm has to pin rather than exercise, because its shell reaches the model's `main`
through the platform entry symbol and propagates the status
(`packages/gg-sandbox-rust/src/program.rs:50`).

| Case | Test |
| --- | --- |
| `gg::log` of a value that is not a string | any `Display` reaches the operator log |
| a line over the per-line ceiling | truncated rather than dropped, per `crates/gg/src/sandbox/membrane/capture.rs:254` |
| more lines than the line ceiling | the oldest go and `logs_suppressed` counts them |
| lines past the byte ceiling | the same eviction, driven by bytes rather than by count |
| `println!` beside a `gg::log` | standard output reaches nobody and the logged line is kept |
| the channels this arm never uses | a program that logs and returns leaves `returned_value` false, `deferred_note` empty and `module_errors` empty |

`report-error` is covered by the gate at `rust.substrate.test.rs:870`, which asserts that
an uncaught failure on this arm is a trap rather than a reported program error.

## Done when

- [ ] Each case above is its own `#[test]`, driving one program and asserting one behaviour.
- [ ] Every successful call in `context`, `delegation`, `programs`, `docs`, `views` and
      `session` has a test reading the state it left behind.
- [ ] Every runtime failure mode named in those modules' rustdoc has a test of its own.
- [ ] `FakeOperationApi` carries a builder that arms a view or documentation-search
      refusal, and the cases that need one use it.
- [ ] The two consolidation comments record the measured per-program cost and direct a
      new behaviour to a new function.
- [ ] `the_views_module_the_helper_and_the_standard_ending_are_reached_in_rust_too` and
      `the_program_library_and_a_reviewers_verdict_are_reached_in_rust_too` are divided
      into one function per behaviour.
- [ ] Every test answers from a synthesized outcome, and no test reaches a provider.
- [ ] Gates green.
