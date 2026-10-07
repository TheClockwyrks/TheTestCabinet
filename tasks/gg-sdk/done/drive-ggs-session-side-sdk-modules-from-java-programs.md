# Drive gg's session-side SDK modules from Java programs

Drive every `context`, `delegation`, `programs`, `docs`, `views` and `session` operation, and the
feedback channel underneath them, from a real Java program: one test for the successful call that
reads the post-call state back, and one test for each distinct runtime failure mode the arm's own
Javadoc names.

## Current state

The operation vocabulary these modules draw from is `crates/gg/src/sandbox/operations.rs:192`
onwards, from `CONTEXT_EVICT_FILE_VIEW` through `SESSION_REQUEST_CHANGES`.
`DELEGATION_TRANSITION_STATE` is the surface's one `Binding::Machine` row
(`crates/gg/src/sandbox/operations.rs:692`), bought by where an instance stands rather than by a
capability. The Java spellings live in `packages/gg-sandbox-java/src/gg/` — `context/Context.java:33`,
`delegation/Delegation.java:40`, `programs/Programs.java:36`, `docs/Docs.java:45`,
`views/Views.java:41` and `session/Session.java:26` — and each function's `@throws` line states the
failure modes the cases below assert. The arm writes no guest-side guard: every argument goes out
positionally through `gg.internal.Coding.call` (`packages/gg-sandbox-java/src/gg/internal/Coding.java:35`),
so each refusal below is the host's, raised into the program as an `ApiError`.

The feedback channel is `crates/gg/wit/gg-sandbox.wit:1060-1139`, hosted at
`crates/gg/src/sandbox/membrane/capture.rs:253` (`log`), `:273` (`note_return`), `:279`
(`report_deferred`), `:290` (`report_module_error`) and `:309` (`report_error`). Its five ids are
dispatched by name at `crates/gg/src/sandbox/membrane/wire.rs:280-285` and are gated by nothing
(`wire.rs:296-303`). `Gg.log` (`packages/gg-sandbox-java/src/gg/Gg.java:31`) is the arm's model-facing
half; the other four are its runtime's, and this arm's runtime reports an uncaught failure as a trap
carrying TeaVM's own words instead (`crates/gg/src/sandbox/language/java.substrate.test.rs:265-274`).

Argument lowering is already pinned for the context and delegation families by the crossing table at
`crates/gg/src/sandbox/language/java.surface.test.rs:179`, driven at `:422`: rows `:365`, `:373`,
`:378` and `:383` for context, `:390`, `:395`, `:400`, `:405`, `:410` and `:415` for delegation. The
table proves what gg's dispatch saw; it reads no value back and injects no failure.

Ground already held from Java programs sits in
`the_documentation_the_views_the_program_library_the_helper_and_the_endings_are_reached_too`
(`java.surface.test.rs:470`). `Views.openFile`'s windowed read and its `maxLineChars` overload are
driven at `:477` and `:480` with their dispatch arguments asserted at `:523` and `:534`, and the
`TextFile` arm of `FileRead` is read at `:498`. `Views.openText`, `Views.openDocsView` and
`Views.close` are driven at `:478`, `:479`, `:481` and `:482`, with `1 0` asserted at `:497` — a
selector that is open and one that never was — and the recorded views at `:499`. `Programs.history`'s
empty answer and `Programs.get`'s `NOT_FOUND` are asserted at `:553`, `Programs.rerun`'s hand-over at
`:554`, `Session.requestChanges`'s two items at `:557` and `Session.approve` at `:566`.
`Delegation.spawnSubagent` with a prompt brief and `SubagentHandle#send` are driven at `:599` and
asserted at `:623` and `:634`. `Docs.search` is driven from both filter forms at `:650`, for an agent
granted nothing, and asserted at `:666` along with `Docs.close`'s `UNAVAILABLE`; `Docs.close` and
`Docs.closeAll` answering `0` for an agent that holds `docview-close` are asserted at `:703`.
`Session.finish` is driven at `java.substrate.test.rs:1208`, and `Gg.log`'s lines standing after a
program failed at `java.surface.test.rs:775`.

The harness is the arm's own. `super::substrate::prepare` (`java.substrate.test.rs:119`) compiles a
whole program through the production prepare step, `evaluate`, `evaluate_as` and
`evaluate_closing_docviews` (`:146`, `:164`, `:178`) run the component against the real membrane,
`whole` (`:76`) wraps a statement body in the `class` and `main` this arm asks for, and `logs` and
`trap` (`:252`, `:274`) read what the model would read. The surface file adds `run_with` and `run_as`
(`java.surface.test.rs:147` and `:129`), which are the entry points most cases below use. The
operation side is `crates/gg/src/sandbox/fake.test.rs`: `FakeOperationApi` (`:248`) and its `with`
(`:256`), `documenting` (`:283`) and `with_program` (`:295`) builders, `CallLog` with its `names` and
`args` readers (`:102`, `:117`), the `canned_outcome` responder (`:780`), and `all_operations`
(`:1151`) and `all_operations_without` (`:1185`) for the grant. `canned_outcome` already carries a
sidecar for every operation here: the reclaim report at `:862`, the registered compaction at `:871`,
the two successions at `:875` and `:878`, the fork's handle at `:882`, the archive hit at `:889`, the
spawn's handle at `:899`, the collected child at `:906` and the delivered message at `:915`. A failure
is injected by passing a responder returning
`ToolOutcome::failed(crate::tools::ToolFailure::<Variant>, message)`, the way `java.surface.test.rs:760`
already does; the variants are at `crates/gg/src/tools/data.rs:506-530`.

## Design

Every case is its own `#[test]` in `crates/gg/src/sandbox/language/java.surface.test.rs`, holding one
short Java program. The module comment at `java.surface.test.rs:13-18`, which asks for a statement
added to an existing function, is revised as part of this work to ask for a function per case and to
quote the measured cost: a pooled JVM serves four compilations from one start
(`java.substrate.test.rs:995`), a warm build is a fraction of a cold one, and `cargo nextest` pays
the per-process cost in parallel. The crossing table at `:422` stays one function, because its claim
is the order the calls arrived in.

A success case grants `all_operations()`, answers with `canned_outcome`, and asserts what the program
read back through `Gg.log` plus the dispatch the double recorded. A failure case answers with a
responder returning the named `ToolFailure`, catches `gg.ApiError` in the program, and logs
`failure.code()` and `failure.operation()` so the assertion is on what the model reads. A case whose
refusal is raised before dispatch also asserts `log.names().is_empty()`.

Three additions carry the cases the shared double cannot express today. `FakeOperationApi` gains
`refusing_docs(ToolFailure, &str)`, which makes `search_docs` (`fake.test.rs:642`) and
`close_docviews` (`:661`) answer a `ViewRefusal`, and `refusing_views(ToolFailure, &str)`, which does
the same for `open_text_view` (`:717`), `open_docs_view` (`:625`) and `close_view` (`:732`).
`java.substrate.test.rs` gains `evaluate_with_api`, an `evaluate_as` that takes a prepared
`FakeOperationApi` rather than a responder, so a case can arm those knobs or seed the program library
with `with_program`.

### context

- `an_eviction_of_every_file_view_sends_no_path_from_java` — `Context.evictFileView()` reaches
  dispatch with a null `path`, the way the membrane records it at
  `crates/gg/src/sandbox/membrane/context.test.rs:70`, and logs `items`, `reclaimedTokens` and
  `detail` off the returned `ReclaimReport`.
- `an_eviction_of_one_file_view_hands_a_java_program_its_reclaim` — `Context.evictFileView("src/a.java")`
  logs the same three fields; the crossing row at `:365` holds the arguments.
- `an_empty_eviction_path_is_an_argument_error_in_java` — `InvalidArgument`.
- `an_archive_hands_a_java_program_its_reclaim` — `Context.archiveThread(new Context.TurnRange(4, 19))`
  logs the returned `ReclaimReport`.
- `an_archive_of_no_spans_is_an_argument_error_in_java` — `Context.archiveThread()` with no ranges,
  `InvalidArgument`.
- `an_archive_of_more_than_thirty_two_spans_is_an_argument_error_in_java` — `InvalidArgument`.
- `an_archive_span_that_ends_before_it_starts_is_an_argument_error_in_java` — `InvalidArgument`.
- `an_archive_search_hands_a_java_program_its_hits` — `Context.searchArchive("the parser")` logs
  `archiveEmpty`, and `seq`, `role` and `text` off the first `ArchiveHit`, reading
  `Context.MessageRole.ASSISTANT` back as the constant.
- `an_archive_search_that_matched_nothing_is_an_empty_list_in_java` — a responder answering with no
  hits and `archiveEmpty` false, so the program logs `false 0`.
- `an_empty_archive_is_told_apart_from_no_match_in_java` — a responder answering `archiveEmpty` true,
  so the program logs `true 0`.
- `an_empty_archive_query_is_an_argument_error_in_java` — `InvalidArgument`.
- `a_compaction_is_registered_and_a_java_program_runs_on` — `Context.compact("scaffolded the page",
  "src/Main.java")` returns, the statements after it log, and the call reached dispatch with its
  summary and file list.
- `a_blank_compaction_summary_is_an_argument_error_in_java` — `InvalidArgument`.

### delegation

- `a_spawn_hands_a_java_program_its_childs_handle` — `Delegation.spawnSubagent("subagent",
  Delegation.Brief.prompt("write the lexer"))` logs `id`, `slot` and `modelId` off the returned
  `SubagentHandle`.
- `a_spawn_on_an_issue_carries_the_issue_id_from_java` — `Delegation.Brief.issue("EPIC-1")`
  (`Delegation.java:241`) reaches dispatch with `issueId` set and `prompt` null, which is the half of
  the brief variant the crossing row at `:390` leaves undriven.
- `a_spawn_at_the_delegation_depth_cap_is_limit_exceeded_in_java` — `LimitExceeded`.
- `a_spawn_of_an_agent_this_session_may_not_start_is_an_argument_error_in_java` — `InvalidArgument`.
- `a_collection_hands_a_java_program_each_childs_ending` — `Delegation.waitForSubagents("agent-1")`
  logs `id`, `status` and `summary` off the first `SubagentResult`, reading
  `Delegation.AgentEnding.COMPLETED` back as the constant.
- `every_agent_ending_reaches_a_java_program_as_its_own_constant` — a responder answering one child
  per `AgentEnding` constant (`Delegation.java:190`), so each lowers onto the Java constant the
  membrane pairs it with at `crates/gg/src/sandbox/membrane/delegation.test.rs:129`.
- `a_child_with_no_ending_reports_no_status_in_java` — the returned `Optional<AgentEnding>` is empty
  and the program logs so.
- `collecting_every_child_sends_no_ids_from_java` — `Delegation.waitForSubagents()` reaches dispatch
  with a null `ids`, the way the membrane records the blanket form at `delegation.test.rs:79`. The
  empty varargs form lowers to `Value.none()` rather than an empty list, which is the correction this
  case carries into `packages/gg-sandbox-java/src/gg/delegation/Delegation.java:58`.
- `collecting_an_id_that_is_not_there_is_not_found_in_java` — `NotFound`.
- `a_message_to_a_child_is_delivered_from_java` — `Delegation.sendMessage` returns and the statement
  after it logs; the arguments are held at `java.surface.test.rs:634`.
- `a_message_to_an_agent_that_is_not_there_is_not_found_in_java` — `NotFound`.
- `a_message_to_a_child_that_already_returned_is_a_conflict_in_java` — `Conflict`.
- `a_transition_is_registered_and_a_java_program_runs_on` — `Delegation.transitionState("verify")`,
  the one-argument overload (`Delegation.java:88`), reaches dispatch with a null `note` and the
  statements after it log.
- `a_state_this_session_may_not_move_to_is_an_argument_error_in_java` — `InvalidArgument`.
- `a_transition_from_an_agent_in_no_machine_state_is_unavailable_in_java` — `all_operations()` with
  `DELEGATION_TRANSITION_STATE` filtered out, which is the only way to withhold the surface's one
  `Binding::Machine` row, asserting `UNAVAILABLE` and that nothing reached dispatch.
- `a_succession_after_a_transition_is_refused_in_java` — one program calling `transitionState` and
  then `exec`, asserting the second is `REFUSED` and the first stands, which is the succession slot
  `crates/gg/src/agent.transitions.test.rs:141` holds at the agent level.
- `an_exec_is_registered_and_a_java_program_runs_on` — `Delegation.exec("Builder")`, the
  one-argument overload (`Delegation.java:120`), reaches dispatch with a null `prompt`, the
  statements after it log, and the program runs to its end.
- `an_agent_this_run_may_not_become_is_an_argument_error_in_java` — `InvalidArgument`.
- `a_fork_hands_a_java_program_the_copys_handle_and_runs_on` — `Delegation.fork("try the other fix")`
  logs `id`, `slot` and `modelId`, and the statements after it log, since the copy is dispatched when
  the turn closes.
- `a_fork_at_the_delegation_depth_cap_is_limit_exceeded_in_java` — `LimitExceeded`.

### programs

The empty history, `get`'s `NOT_FOUND` and `rerun`'s hand-over are held at `java.surface.test.rs:553`
and `:554`, and `ProgramSummary#source`'s `NOT_FOUND` at `:623`.

- `a_history_hands_a_java_program_each_programs_summary` — a double seeded through `with_program`, so
  the program logs `id`, `turn`, `lines`, `chars` and `ok` off the first `ProgramSummary`.
- `a_history_without_a_library_is_unavailable_in_java` — the `library` flag off, asserting
  `UNAVAILABLE`.
- `a_stored_program_hands_a_java_program_its_source` — `Programs.get` on a seeded id logs the source
  back.
- `an_id_the_library_never_issued_is_not_found_in_java` — `NOT_FOUND` whose message names the ids that
  are held, the way the membrane phrases it at `crates/gg/src/sandbox/membrane/programs.test.rs:136`.
- `an_id_the_library_has_dropped_is_not_found_in_java` — a double seeded past the library's retention,
  so an id it once issued is gone.
- `a_program_fetch_without_a_library_is_unavailable_in_java` — `UNAVAILABLE`, and the capability is
  read before the argument, as at `programs.test.rs:116`.
- `a_hand_over_is_registered_and_a_java_program_runs_on` — `Programs.rerun` returns, the statements
  after it log, and `outcome.rerun` carries the source.
- `a_blank_hand_over_source_is_an_argument_error_in_java` — `InvalidArgument`.
- `a_second_hand_over_from_one_java_program_is_refused` — `REFUSED`, with the first source standing.
- `a_hand_over_is_revoked_when_the_java_program_then_fails` — a program that hands over and then
  throws, asserting `outcome.revoked_rerun`.
- `a_hand_over_without_a_library_is_unavailable_in_java` — `UNAVAILABLE`.

### docs

`search` from both filter forms, its unconditional binding for an agent granted nothing, the
`SEARCH_RESULTS_VIEW` selector its page lands under and `close`'s `UNAVAILABLE` are held at
`java.surface.test.rs:650-672`; `close` and `closeAll` answering `0` for a holder of `docview-close`
are held at `:703`.

- `a_search_carrying_no_words_and_no_filters_is_an_argument_error_in_java` — an empty
  `Docs.SearchFilters`, `InvalidArgument` through `refusing_docs`.
- `a_search_kind_that_is_not_a_kind_is_an_argument_error_in_java` — `InvalidArgument`.
- `a_search_limit_of_zero_is_an_argument_error_in_java` — `InvalidArgument`.
- `closing_a_documentation_view_hands_a_java_program_the_count` — `Docs.close` on a key the double
  holds, logging `1`.
- `closing_every_documentation_view_is_unavailable_in_java` — `Docs.closeAll` for an agent without
  `docview-close`, asserting `UNAVAILABLE close_all` and that the refusal is on `outcome.refusals`.

### views

`openFile`'s windowed and line-cut forms, `openText`, `openDocsView` and `close` are held at
`java.surface.test.rs:477-534`.

- `a_bare_file_view_sends_no_window_from_java` — `Views.openFile("notes.md")` (`Views.java:41`)
  reaches dispatch with `path` alone.
- `a_file_views_second_int_is_its_line_cut_in_java` — `Views.openFile("wide.md", 80)`
  (`Views.java:61`) reaches dispatch with `maxLineChars` of 80 and no offset, which is the overload a
  reader most easily mistakes for a window.
- `an_image_file_view_reaches_a_java_program_as_the_image_variant` — `Views.openFile("logo.png")`
  branches to `Files.ImageFile` and logs `label`, `bytes` and `shown`.
- `a_file_view_of_a_path_that_is_not_there_is_not_found_in_java` — `NotFound`, asserting
  `outcome.views_opened` is empty, the rule the membrane holds at
  `crates/gg/src/sandbox/membrane/views.test.rs:61`.
- `a_file_view_offset_past_the_end_is_an_argument_error_in_java` — `InvalidArgument`.
- `a_file_view_line_cut_of_zero_is_an_argument_error_in_java` — `InvalidArgument`, the cut the
  membrane declines to normalise at `crates/gg/src/sandbox/membrane/views.rs:85`.
- `a_file_view_line_cut_over_sixty_five_thousand_is_an_argument_error_in_java` — `InvalidArgument`
  for 65,537.
- `a_file_view_over_the_window_cap_is_limit_exceeded_in_java` — `LimitExceeded`, asserting the size
  and the bound reach the program in the message.
- `reopening_a_file_view_supersedes_it_in_java` — the same path opened twice, asserting the second
  `SandboxViewOpened` carries `superseded`.
- `a_file_view_without_the_read_capability_is_unavailable_in_java` — `all_operations_without("read-file")`,
  asserting `UNAVAILABLE`.
- `an_empty_text_view_label_is_an_argument_error_in_java` — `InvalidArgument`, which the double
  raises at `fake.test.rs:717`.
- `a_text_view_body_over_the_cap_is_limit_exceeded_in_java` — `LimitExceeded` through
  `refusing_views`, asserting the cap is named.
- `a_text_view_label_over_the_cap_is_limit_exceeded_in_java` — `LimitExceeded` for the label's own,
  separate cap.
- `a_documentation_view_of_an_unknown_name_is_not_found_in_java` — `NotFound`.
- `a_documentation_view_of_a_name_this_agent_does_not_bind_is_not_found_in_java` — `NotFound`, with
  the message naming the binding rather than the spelling.
- `an_empty_view_selector_is_an_argument_error_in_java` — `Views.close("")`, `InvalidArgument`, which
  the double raises at `fake.test.rs:732`.
- `closing_a_view_without_agent_managed_context_is_unavailable_in_java` —
  `all_operations_without("agent-managed-context")`, asserting `UNAVAILABLE`.

### session

`finish`'s success is held at `java.substrate.test.rs:1208`, `approve`'s at `java.surface.test.rs:566`
and `requestChanges`'s two items at `:557`.

- `a_blank_finish_summary_is_an_argument_error_in_java` — `INVALID_ARGUMENT`, carrying the sentence
  `crates/gg/src/ending.rs:165` writes, and the run is still open.
- `a_later_finish_replaces_the_summary_in_java` — two `Session.finish` calls in one program,
  asserting the second summary stands and `completion.superseded` counts the first.
- `a_finish_declared_then_thrown_away_is_revoked_in_java` — a program that finishes and then throws,
  asserting `outcome.revoked_completion` carries the ending and `outcome.completion` is empty.
- `a_finish_from_a_reviewing_java_program_is_unavailable` — `RunEnding::Role(EndingRole::Review)`,
  asserting `UNAVAILABLE` and that the refusal names this arm's own spelling of the endings the role
  does hold, the way the membrane phrases it at `crates/gg/src/sandbox/membrane/session.test.rs:409`.
- `an_approval_from_a_standard_java_program_is_unavailable` — `RunEnding::Role(EndingRole::Standard)`,
  asserting `UNAVAILABLE` and that the refusal lands on `outcome.refusals`.
- `a_rejection_with_no_changes_is_an_argument_error_in_java` — `Session.requestChanges()` with no
  items, `INVALID_ARGUMENT` carrying the sentence `crates/gg/src/ending.rs:183` writes.
- `a_rejection_whose_changes_are_all_blank_is_an_argument_error_in_java` — `Session.requestChanges("
  ", "")`, which is refused after the blank entries are dropped, and is a separate cause from the
  empty list.
- `a_rejection_from_a_standard_java_program_is_unavailable` — `UNAVAILABLE`.
- `an_on_use_java_program_has_no_ending_calls_in_scope` — `RunEnding::None`, asserting each of the
  three ending calls is refused.

### feedback

`Gg.log` is this arm's model-facing half and is read by every case above; the other four ids belong to
a guest's runtime, and this arm's runtime reports an uncaught failure as a trap instead
(`java.substrate.test.rs:265-274`), so a broken code module is a compile refusal
(`java.substrate.test.rs:627` and `:705`). Those four are therefore driven from a Java program
through this arm's own door, `gg.internal.Coding.call` (`Coding.java:35`), which is exactly the call
a runtime would make, and each case asserts the turn state the host kept.

- `a_java_programs_logs_arrive_in_the_order_it_wrote_them` — three `Gg.log` lines, asserting
  `outcome.logs` in order.
- `a_java_program_over_the_log_cap_keeps_the_last_lines_and_counts_the_rest` — a loop writing past
  `MAX_LOG_LINES`, asserting the oldest are evicted and `outcome.logs_suppressed` counts them, the
  rule at `crates/gg/src/sandbox/membrane/capture.rs:253-264`.
- `logging_is_answered_for_a_java_program_granted_nothing` — `run_with("...", &[], ...)`, since the
  channel is gated by nothing (`crates/gg/src/sandbox/membrane/wire.rs:296-303`).
- `a_returned_value_is_noted_for_a_java_program` — `feedback.note_return` through the door, asserting
  `outcome.returned_value`.
- `a_deferred_call_is_noted_once_for_a_java_program` — two `feedback.report_deferred` notes,
  asserting `outcome.deferred_note` carries the first.
- `a_reported_failure_revokes_a_java_programs_completion` — a program that finishes and then reports
  a `feedback.report_error` record, asserting the turn carries a `ProgramError` with the kind and
  code the record named and that `outcome.revoked_completion` holds the ending.
- `every_broken_module_is_reported_to_a_java_program` — two `feedback.report_module_error` calls,
  asserting `outcome.module_errors` carries both names and messages.

## Done when

- [ ] Each case above is its own `#[test]` in
      `crates/gg/src/sandbox/language/java.surface.test.rs`, driving one short Java program.
- [ ] Every successful call in `context`, `delegation`, `programs`, `docs`, `views` and `session` has
      a Java program that reads its post-call state back, or a cited line where the call returns
      nothing and its dispatch is already pinned.
- [ ] Every failure mode the arm's `@throws` lines name is injected and asserted as the `gg.ApiError`
      the program catches, with its code and its operation read the way the model reads them.
- [ ] `Delegation.waitForSubagents()` with no ids reaches dispatch with a null `ids`.
- [ ] `FakeOperationApi` offers `refusing_docs` and `refusing_views`, and `java.substrate.test.rs`
      offers `evaluate_with_api`.
- [ ] The four feedback ids a runtime sends are driven from a Java program through
      `gg.internal.Coding.call` and asserted on the turn's own state.
- [ ] The module comment at `java.surface.test.rs:13-18` asks for a function per case and quotes the
      measured build cost.
- [ ] Gates green.
