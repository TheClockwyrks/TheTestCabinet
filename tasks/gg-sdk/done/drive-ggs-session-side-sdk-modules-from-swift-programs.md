# Drive gg's session-side SDK modules from Swift programs

Give the Swift arm a short program-level test for every call in `context`, `delegation`, `programs`,
`docs`, `views` and `session`, and for the feedback channel underneath them: one test per successful
call asserting what the program read back or what the turn recorded, and one test per distinct
runtime failure mode. Every answer is synthesized by the operation double, so no test reaches a
provider.

## Current state

The operation vocabulary these modules draw from is `crates/gg/src/sandbox/operations.rs:201` through
`:272`, from `CONTEXT_COMPACT` and `DELEGATION_SPAWN_SUBAGENT` to `SESSION_REQUEST_CHANGES`. The
Swift spellings live in `packages/gg-sandbox-swift/Sources/SDK/Modules/` — `Context.swift:6`,
`Delegation.swift:7`, `Programs.swift:9`, `Docs.swift:9`, `Views.swift:8` and `Session.swift:10` —
and each function's `- Throws:` line states the failure modes the cases below assert. The feedback
channel is `crates/gg/wit/gg-sandbox.wit:1060`; this arm reaches exactly one of its five functions,
`log`, at `packages/gg-sandbox-swift/Sources/SDK/Internal/Runtime.swift:16`.

Half of these operations are tool-backed and half are not, and the split decides how a case injects a
failure. The `context` and `delegation` calls dispatch a gg tool, so their arguments are already
pinned by the crossing table at `crates/gg/src/sandbox/language/swift.surface.test.rs:283-334` and a
responder can answer any of them with a `ToolFailure`. The `docs`, `views`, `session` and `programs`
calls have no tool behind them — `crates/gg/src/sandbox/membrane/wire.arguments.test.rs:74-77`
states this from the other side — so they are answered inside the double and their failures come from
the real rules: `FakeOperationApi::open_text_view` refuses an empty label at
`crates/gg/src/sandbox/fake.test.rs:721`, `close_view` refuses an empty selector at `:732`,
`Ending::finished` refuses a blank summary at `crates/gg/src/ending.rs:165-170`,
`Ending::changes_requested` drops blank entries and refuses what is left at `:188-193`, and the
membrane refuses a blank rerun source at `crates/gg/src/sandbox/membrane/programs.rs:93` and a second
hand-over at `:101`.

Ground this arm already holds, none of which the cases below ask for again. The whole view family
runs in one program at `swift.surface.test.rs:398-402`, with `views.close` returning `1` for an open
selector and `0` for one that was never opened at `:431`, the text window read back at `:432`, and
every view the program placed rostered at `:443-452`. `docs.search` reads its page back at `:408` and
`:437`; `docs.close` and `docs.closeAll` are refused as `unavailable` at `:411-418` and `:441-442`,
and both answer `0` once the capability is bought at `:471-476`. `session.finish` declares the
standard ending at `:420` and `:453-462`, `session.requestChanges` carries both items at `:530` and
`:542-549`, and `session.approve` is driven on its own at `:553-570`. `programs.history` reads an
empty library at `:522` and `:540`, `programs.get` catches a `.notFound` at the same lines, and
`programs.rerun` records the hand-over at `:529` and `:541`. `gg.log` is the channel every one of
those assertions reads through.

The harness is the arm's own. `super::substrate::prepare` (`swift.substrate.test.rs:80`) compiles a
whole program through the production prepare step, `evaluate` (`:107`) runs the component against the
real membrane, `evaluate_closing_docviews` (`:122`) is the shortest scope that buys the two
documentation closes, and `logs` (`:202`) and `sandbox_error` (`:217`) read what the model would
read. The surface file adds `run_with` (`swift.surface.test.rs:62`), which most cases below use. The
operation side is `crates/gg/src/sandbox/fake.test.rs`: `FakeOperationApi` (`:141`) built by `with`
(`:256`), `CallLog` with its `names` and `args` readers (`:102`, `:117`), the `canned_outcome`
responder (`:780`), `all_operations` (`:1151`), `all_operations_without` (`:1185`) and the
`with_program` builder (`:295`) that seeds the library. A failure is injected by passing a responder
that returns `ToolOutcome::failed(crate::tools::ToolFailure::<Variant>, message)`, the way
`swift.surface.test.rs:592-596` already does; the variants are at `crates/gg/src/tools/data.rs:506-530`.

## Design

Three pieces of harness land first, because several cases below cannot be written without them.

`crates/gg/src/sandbox/language/swift.substrate.test.rs` gains `evaluate_with_api`, which evaluates a
component against a caller-supplied `FakeOperationApi`. It is `evaluate_granting` (`:136`) with the
double lifted out of it, and `evaluate` keeps its signature by building the default double and
calling through.

`crates/gg/src/sandbox/fake.test.rs` gains a `refusing_views` builder beside `documenting` (`:283`)
and `with_program` (`:295`). It takes `impl FnMut(&str, &str) -> Option<ViewRefusal> + Send +
'static`, called with the operation id and with the label, name or query the call carried, and
`open_text_view` (`:717`), `open_docs_view` (`:625`) and `search_docs` (`:642`) consult it before
their default answers. It is what lets a program meet the view size ceilings, the documentation
`not-found` and the `docs.search` argument refusals, all of which live in the production api or the
documentation runtime rather than in the double.

`packages/gg-sandbox-swift/Sources/SDK/Modules/Views.swift` gains the guard its own documentation at
`:28-31` already promises: `openFile` refuses a `maxLineChars` outside `1...65536` as
`.invalidArgument` under the operation's own gg name, before dispatch. It mirrors `files.tree`'s
depth guard at `packages/gg-sandbox-swift/Sources/SDK/Modules/Files.swift:155-159`, and it is needed
for the same reason: `maxLineChars` lowers through `UInt32(truncatingIfNeeded:)` at `Views.swift:41`,
so a negative value silently becomes an enormous one.

Every case is its own `#[test]` in `crates/gg/src/sandbox/language/swift.surface.test.rs`, holding one
short program. The module comment at `swift.surface.test.rs:13-18`, which asks for a statement added
to an existing function, is revised as part of this work to ask for a function per case: the SDK and
the library set are prebuilt rather than type-checked per program (`swift.compile.rs:103-107`), so a
case costs only its own `swiftc` and `Component::new` (`swift.compile.rs:98` and `:101`), and
`cargo nextest` pays those per-process costs in parallel.

A success case grants `all_operations()`, answers with `canned_outcome`, and asserts the value the
program read back through `gg.log` or the field the turn recorded on its `SandboxOutcome`. A failure
case answers with a responder returning the named `ToolFailure`, catches `core.ApiError` in the
program, and logs `failure.code` and `failure.operation` so the assertion is on what the model reads.
Where the refusal is raised before dispatch, the case also asserts `log.names().is_empty()`.

### context

- `a_file_view_eviction_hands_a_swift_program_its_reclaim_report` — `context.evictFileView("src/a.swift")`
  logs `items`, `reclaimedTokens`, `paths` and `detail` off the returned `ReclaimReport`.
- `evicting_every_file_view_sends_no_path_from_swift` — `context.evictFileView()` reaches dispatch
  with a null `path`, which is how a program drops every view.
- `an_empty_eviction_path_is_an_argument_error_in_swift` — `InvalidArgument`.
- `an_archive_hands_a_swift_program_its_reclaim_report` — `context.archiveThread([4...19, 30...35])`
  logs the returned `ReclaimReport`.
- `an_empty_archive_span_list_is_an_argument_error_in_swift` — `InvalidArgument`.
- `too_many_archive_spans_at_once_is_an_argument_error_in_swift` — `InvalidArgument`.
- `an_archive_search_hands_a_swift_program_its_hits` — `context.searchArchive("the parser")` logs
  `archiveEmpty` and the first `ArchiveHit`'s `seq`, `role` and `text`.
- `an_empty_archive_reads_as_empty_rather_than_as_no_match_in_swift` — a responder answering with
  `archiveEmpty` true and no hits, so the program logs the distinction `ArchiveSearch` exists to
  carry (`Context.swift:137-140`).
- `every_archived_message_role_reaches_a_swift_program` — a responder answering with one hit per
  role, so each `context.MessageRole` case (`Context.swift:167-176`) is logged from the program.
- `an_empty_archive_query_is_an_argument_error_in_swift` — `InvalidArgument`.
- `a_compaction_is_registered_and_a_swift_program_runs_on` — `context.compact(summary:files:)` logs
  nothing back, so the case asserts the call reached dispatch and the line after it logged.
- `a_blank_compaction_summary_is_an_argument_error_in_swift` — `InvalidArgument`.

A span that ends before it starts is unreachable from a well-typed Swift call: the argument is a
`ClosedRange`, which refuses an inverted pair in the language (`Context.swift:38-40`). That is this
arm's answer to the failure mode, and it needs no case.

### delegation

- `spawning_a_child_hands_a_swift_program_its_handle` — `delegation.spawnSubagent("subagent", task: .prompt("write the lexer"))`
  logs `id`, `slot` and `modelId` off the returned `SubagentHandle`.
- `an_issue_brief_crosses_from_a_swift_program` — the `.issue("i1")` form of `Brief`
  (`Delegation.swift:173`) reaches dispatch as the issue key rather than as a prompt.
- `a_child_beyond_the_delegation_depth_cap_is_limit_exceeded_in_swift` — `LimitExceeded`.
- `an_agent_this_session_may_not_spawn_is_an_argument_error_in_swift` — `InvalidArgument`.
- `waiting_on_a_named_child_hands_a_swift_program_its_result` — `delegation.waitForSubagents(["agent-1"])`
  logs `id`, `status` and `summary` off the first `SubagentResult`.
- `waiting_for_every_child_sends_no_ids_from_swift` — `delegation.waitForSubagents()` reaches
  dispatch with a null `ids`.
- `a_child_with_no_ending_reports_no_status_in_swift` — a responder answering with a result whose
  status is absent, so the program reads `nil` rather than a case.
- `every_agent_status_reaches_a_swift_program` — a responder answering with one result per status, so
  each `delegation.AgentStatus` case (`Delegation.swift:194-206`) is logged.
- `waiting_on_a_child_this_session_did_not_spawn_is_not_found_in_swift` — `NotFound`.
- `a_message_reaches_a_running_child_from_swift` — `delegation.sendMessage("prefer the simpler parser", to: "agent-1")`
  returns nothing, so the case asserts the call reached dispatch and the line after it logged.
- `a_handle_delivers_its_own_message_in_swift` — the same delivery through
  `SubagentHandle.send` (`Delegation.swift:243`), which is the member spelling beside the free
  function.
- `a_message_to_an_unknown_agent_is_not_found_in_swift` — `NotFound`.
- `a_message_to_a_child_that_already_returned_is_a_conflict_in_swift` — `Conflict`.
- `a_state_transition_is_registered_and_a_swift_program_runs_on` — `delegation.transitionState(to:note:)`
  logs the lines after it, which is the whole of what deferred succession means here.
- `a_state_this_session_may_not_move_to_is_an_argument_error_in_swift` — `InvalidArgument`.
- `a_second_state_declaration_in_one_turn_is_refused_in_swift` — a responder answering the first call
  with success and the second with `Refused`, so the program reads the succession slot being taken.
- `a_transition_outside_a_machine_state_is_unavailable_in_swift` — the grant is
  `all_operations()` less `DELEGATION_TRANSITION_STATE`, which is the only way to withhold the one
  `Binding::Machine` row (`crates/gg/src/sandbox/operations.rs:214` and
  `crates/gg/src/sandbox/fake.test.rs:1151-1155`). Nothing reaches dispatch and the refusal lands on
  `outcome.refusals` under `delegation.transition_state`.
- `a_succession_is_registered_and_a_swift_program_runs_to_its_end` — `delegation.exec("Builder", prompt:)`
  returns and the statements after it log, which is the contract that makes `exec` unlike every other
  call.
- `an_agent_this_session_may_not_become_is_an_argument_error_in_swift` — `InvalidArgument`.
- `a_succession_after_a_transition_is_refused_in_swift` — one program calling `transitionState` and
  then `exec`, the second answered `Refused`, since the two share one slot.
- `a_fork_hands_a_swift_program_the_copys_id` — `delegation.fork("try the other fix")` logs the
  returned handle's `id`, minted at the call although the copy is dispatched when the turn closes.
- `a_fork_beyond_the_delegation_depth_cap_is_limit_exceeded_in_swift` — `LimitExceeded`.

### programs

`history` on an empty library, `get`'s `.notFound` and `rerun`'s recorded hand-over are held at
`swift.surface.test.rs:522-529` and `:540-542`.

- `a_program_summary_hands_a_swift_program_every_field` — a double built with `with_program`
  (`fake.test.rs:295`) and run through `evaluate_with_api`, so `programs.history()` logs `id`, `turn`,
  `lines`, `chars`, `ok` and `error` off the first `ProgramSummary` (`Programs.swift:78-90`).
- `fetching_a_stored_program_hands_a_swift_program_its_source` — `programs.get(id)` on the same
  double logs the source exactly as it ran.
- `a_summary_fetches_its_own_source_in_swift` — `ProgramSummary.source()` (`Programs.swift:109`),
  the member spelling of the same fetch.
- `a_program_the_library_dropped_is_not_found_in_swift` — a summary whose program the library no
  longer holds, which is a distinct cause from an id that was never issued.
- `an_unknown_program_id_names_what_the_library_holds_in_swift` — the message the program reads back
  lists the held ids, as `crates/gg/src/sandbox/membrane/programs.test.rs:136` phrases it.
- `a_blank_rerun_source_is_an_argument_error_in_swift` — the membrane's guard at
  `crates/gg/src/sandbox/membrane/programs.rs:93`, asserting `outcome.rerun` stayed empty.
- `a_second_hand_over_from_one_swift_program_is_refused` — the first stands and the second is
  `Refused` (`programs.rs:101`).
- `a_hand_over_is_revoked_when_the_swift_program_then_fails` — the program calls `rerun` and then
  lets a failure out, and the case asserts `outcome.revoked_rerun`.
- `the_library_is_unavailable_to_a_swift_program_without_one` — a run evaluated with `library` false
  refuses `history`, `get` and `rerun` as `.unavailable`, each under its own operation name, with
  nothing reaching dispatch.

### docs

`search`'s page, both closes refused as `unavailable`, and both closes answering `0` once granted are
held at `swift.surface.test.rs:408`, `:411-418`, `:437`, `:441-442` and `:471-476`.

- `a_search_with_no_query_and_no_filter_is_an_argument_error_in_swift` — a double armed with
  `refusing_views`, since the refusal is the documentation runtime's (`Docs.swift:41-42`).
- `a_search_limit_of_zero_is_an_argument_error_in_swift` — the same, and a separate case because it
  is a separate cause.
- `a_doc_hit_hands_a_swift_program_its_fields` — a `refusing_views` double answering with one hit, so
  the program logs `key`, `kind`, `module`, `name` and `summary` off the first `DocHit`
  (`Docs.swift:159-173`) and each `DocKind` case (`Docs.swift:113-119`).

### views

`openFile`'s text window, `openText`, `openDocsView`, `close` on an open selector and `close` on one
that was never opened are held at `swift.surface.test.rs:398-402`, `:431-432` and `:443-452`.

- `a_file_view_of_a_path_that_is_not_there_opens_nothing_in_swift` — `NotFound`, asserting
  `outcome.views_opened` never gained the path.
- `an_offset_past_the_end_of_a_file_is_an_argument_error_in_swift` — `InvalidArgument`.
- `a_file_view_over_the_text_cap_is_limit_exceeded_in_swift` — `LimitExceeded`, with the size and the
  bound reaching the program in the message.
- `a_line_cut_below_one_is_refused_before_it_is_dispatched_in_swift` — the new SDK guard, with
  `log.names()` empty.
- `a_line_cut_over_the_ceiling_is_refused_before_it_is_dispatched_in_swift` — the same guard's other
  bound, and a separate case.
- `re_opening_a_file_view_supersedes_rather_than_duplicating_in_swift` — two opens of one path, so
  the program's second view is recorded superseded.
- `an_empty_view_label_is_an_argument_error_in_swift` — the double's guard at `fake.test.rs:721`.
- `a_text_view_body_over_the_cap_is_limit_exceeded_in_swift` — a `refusing_views` double.
- `a_text_view_label_over_the_cap_is_limit_exceeded_in_swift` — the same double, a separate cap and a
  separate case.
- `a_documentation_view_of_an_unknown_name_is_not_found_in_swift` — a `refusing_views` double.
- `a_documentation_view_of_a_name_this_agent_does_not_bind_is_not_found_in_swift` — the same, and a
  separate cause.
- `an_empty_view_selector_is_an_argument_error_in_swift` — the double's guard at `fake.test.rs:732`.
- `closing_a_view_without_agent_managed_context_is_unavailable_in_swift` — the grant is
  `all_operations_without(CAPABILITY_AGENT_MANAGED_CONTEXT)`, and the refusal lands on
  `outcome.refusals` under `views.close`.

### session

`finish`'s standard ending, `approve` and `requestChanges` with both items are held at
`swift.surface.test.rs:420`, `:453-462`, `:530`, `:542-549` and `:553-570`.

- `a_blank_finish_summary_is_an_argument_error_in_swift` — `crates/gg/src/ending.rs:165-170`, asserting
  `outcome.completion` stayed empty.
- `finishing_from_a_reviewers_session_is_unavailable_in_swift` — a run evaluated in
  `EndingRole::Review`, refused under `session.finish`.
- `a_later_finish_replaces_the_summary_in_swift` — two finishes in one program, the second standing,
  with the replacement counted on the completion.
- `a_completion_is_revoked_when_the_swift_program_then_fails` — the program finishes and then lets a
  failure out, and the case asserts `outcome.revoked_completion`.
- `approving_from_a_standard_session_is_unavailable_in_swift` — refused under `session.approve`.
- `an_empty_change_list_is_an_argument_error_in_swift` — `crates/gg/src/ending.rs:193-197`.
- `a_change_list_of_blank_entries_is_an_argument_error_in_swift` — a non-empty list every entry of
  which is blank, which `ending.rs:188-193` filters to nothing, and a separate cause from the empty
  list.
- `requesting_changes_from_a_standard_session_is_unavailable_in_swift` — refused under
  `session.request_changes`.

### the feedback channel

This arm reaches one of the interface's five functions. `log` is the channel every assertion above
reads through, so it needs no case of its own; the other four are decided by the shell at
`packages/gg-sandbox-swift/Sources/shell.swift:93-107`, and each gets a case that states what this arm
does instead.

- `a_swift_program_notes_no_returned_value` — Swift's top-level code has no return value to discard,
  so a program whose last statement evaluates to something asserts `outcome.returned_value` is false
  and no note reaches the model.
- `a_swift_program_defers_nothing_past_its_end` — the shell calls the model's entry point
  synchronously and returns when it returns, so a program that finishes asserts
  `outcome.deferred_note` is empty.
- `a_broken_code_module_is_refused_before_a_swift_program_runs` — a module that does not type-check is
  a prepare-time failure on this arm (`swift.substrate.test.rs:749-775`), so the case asserts
  `compile_program` refuses the pair and `outcome.module_errors` is never reached.

An uncaught failure is a trap rather than a reported error on this arm, and that is already asserted
with gg's own sentence at `swift.surface.test.rs:604-650`.

## Done when

- [ ] Each case above is its own `#[test]` in
      `crates/gg/src/sandbox/language/swift.surface.test.rs`, driving one short Swift program.
- [ ] Every successful call in `context`, `delegation`, `programs`, `docs`, `views` and `session` has
      a Swift program that reads its post-call state back, or asserts the turn record where the call
      returns nothing, or a cited line where it already does.
- [ ] Every failure mode the arm's `- Throws:` lines name is reached from a Swift program and
      asserted as the `core.ApiError` the program catches.
- [ ] `evaluate_with_api` and `FakeOperationApi::refusing_views` exist, and the view ceilings, the
      documentation `not-found` causes and the `docs.search` argument refusals are driven through
      them.
- [ ] `views.openFile` refuses a `maxLineChars` outside `1...65536` in the SDK, and both bounds
      assert that nothing reached gg's dispatch.
- [ ] The module comment at `swift.surface.test.rs:13-18` asks for a function per case and quotes the
      measured cost.
- [ ] Gates green.
