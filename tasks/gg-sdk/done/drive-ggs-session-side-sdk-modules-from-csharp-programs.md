# Drive gg's session-side SDK modules from C# programs

Drive every `Context`, `Delegation`, `Programs`, `Docs`, `Views` and `Session` call, and the
feedback channel under them, from a real C# program: one short test for the successful call that
reads the post-call state back, and one per distinct runtime failure mode the arm's own
`<exception>` lines name.

## Current state

The operation vocabulary these modules draw from is `crates/gg/src/sandbox/operations.rs:192`
through `:272`, from `CONTEXT_EVICT_FILE_VIEW` to `SESSION_REQUEST_CHANGES`. The C# spellings live
in `packages/gg-sandbox-csharp/src/Gg/` — `Context/Context.cs:19`, `:45`, `:76` and `:113`,
`Delegation/Delegation.cs:37`, `:55`, `:64`, `:74`, `:97`, `:119` and `:140`,
`Programs/Programs.cs:20`, `:56` and `:85`, `Docs/Docs.cs:50`, `:97` and `:112`,
`Views/Views.cs:42`, `:78`, `:98` and `:112`, and `Session/Session.cs:32`, `:43` and `:59` — and
each function's `<exception>` block states the failure modes the cases below assert.

The `context` and `delegation` rows already have their argument lowering pinned from the C#
spelling by the crossing table at `crates/gg/src/sandbox/language/csharp.surface.test.rs:292`
(context) and `:314` (delegation), driven at `:345`. That table proves what gg's dispatch saw; it
reads no value back and injects no failure. The rest sit outside every crossing table, because
`sandbox_operation_names()` is the tool vocabulary rather than the API surface
(`crates/gg/src/sandbox/signatures.rs:668-677`).

A good deal of the view, documentation, library and ending ground is already held from C# programs.
`Views.OpenFile`'s text success is read back at `csharp.surface.test.rs:407` and asserted at `:427`,
with the line-cut form crossing at `:410`; `Views.OpenText` and `Views.OpenDocsView` are opened at
`:408` and `:409` and their views asserted at `:430`; `Views.Close` of an open selector and of one
never opened are driven at `:411-412` and asserted at `:426`. `Docs.Search`'s page and its two
filter forms are at `:479-480`, asserted at `:497`, with the search view's constant selector at
`:500-518`; `Docs.Close`'s `Unavailable` refusal is caught at `:485` and asserted at `:497`, and the
granted `Docs.Close` and `Docs.CloseAll` closing nothing are at `:531` and asserted at `:539`.
`Programs.History` on an empty library, `Programs.Get` of an id never issued and `Programs.Rerun`
are at `:555`, `:559` and `:565`, asserted at `:576-578`; `Session.RequestChanges` is at `:566`,
`Session.Approve` at `:590` and `Session.Finish` at `:415`. `ProgramSummary.Source` is driven from
the value the library handed back at `:700`.

The harness is the arm's own. `super::substrate::prepare` (`csharp.substrate.test.rs:72`) compiles a
program through the production prepare step; `evaluate` (`:136`) runs it against the real membrane
with the component resolved before the store; `evaluate_closing_docviews` (`:153`) adds the
`docview-close` capability; `evaluate_with_program` (`:173`) seeds the program library; `logs`
(`:269`) and `program_error` (`:285`) read what the model would read. The surface file adds
`run_with` (`csharp.surface.test.rs:70`), which is the entry point most cases below use. The
operation side is `crates/gg/src/sandbox/fake.test.rs`: `FakeOperationApi` (`:141`), `CallLog` with
its `calls`, `names` and `args` readers (`:94`, `:102`, `:117`), the `canned_outcome` responder
(`:780`), `all_operations` (`:1151`), `granted_operations` (`:1165`) and `all_operations_without`
(`:1185`) for the withheld-capability cases.

The context and delegation calls reach that double through its responder — `evict_file_view`
(`fake.test.rs:572`), `archive_thread` (`:575`), `search_archive` (`:582`), `compact` (`:585`),
`transition_state` (`:588`), `exec` (`:591`), `fork` (`:594`), `spawn_subagent` (`:597`),
`wait_for_subagents` (`:608`) and `send_message` (`:611`) — so a failure is injected by answering
with `ToolOutcome::failed(crate::tools::ToolFailure::<Variant>, message)`, the way
`csharp.surface.test.rs:714` already does for `Files.ReadFile`. `Views.OpenFile` reaches it as a
`read_file` (`fake.test.rs:676`), so it takes the same injection and leaves no view open when the
read fails (`:686-691`). The rest answer from the double's own model: `open_text_view` refuses an
empty label (`:717-730`), `close_view` an empty selector (`:732-742`), `open_docs_view` answers
every name (`:625`), `search_docs` answers every search with an empty page (`:642`),
`close_docviews` always reports zero (`:659`), and the library is a real `ProgramLibrary` with a
retention of four (`:266`, `:744`, `:748`). The ending calls are validated in
`crates/gg/src/ending.rs:166` and `:190-194` behind the role gate in
`crates/gg/src/sandbox/membrane/session.rs:46-77`, and `Programs.Rerun`'s two refusals in
`crates/gg/src/sandbox/membrane/programs.rs:93-105`.

## Design

Every case is its own `#[test]` in `crates/gg/src/sandbox/language/csharp.surface.test.rs`, holding
one short program. The module comment at `csharp.surface.test.rs:13-17`, which asks for a statement
added to an existing function, is revised as part of this work to ask for a function per case and to
quote the measured cost rather than a discouraging one: the guest is compiled once per test process
behind the `OnceLock` at `csharp.substrate.test.rs:96`, the figures for that compile are recorded at
`csharp.substrate.test.rs:124-131`, and `cargo nextest` pays the per-process cost in parallel.

A success case grants the operations the call needs, answers with `canned_outcome`, and asserts the
value the program read back through `Console.WriteLine`. A failure case answers with a responder
returning the named `ToolFailure`, catches `Gg.ApiException` in the program, and logs `failure.Code`
and `failure.Operation` so the assertion is on what the model reads. Where the refusal is the
capability gate's, the case also asserts `log.names().is_empty()`.

### What the double gains

Some of the modes below are held by the api rather than by the membrane, so the double models them,
each beside a rule it already models:

- `search_docs` (`fake.test.rs:642`) holds the two argument guards the real runtime holds at
  `crates/gg/src/docs.search.rs:526` and `:536`, refusing with
  `ViewRefusal { failure: ToolFailure::InvalidArgument }` the way `open_text_view` (`:717`) refuses
  an empty label.
- `open_text_view` also refuses a body or a label over the ceiling `Views.cs:73-77` documents, with
  `ToolFailure::LimitExceeded` naming the cap, which are two separate caps and two separate
  refusals.
- `open_docs_view` (`:625`) refuses a name outside the set a new `with_docs_names` builder seeds,
  beside `with_program` (`:295`); left unseeded it answers every name as it does now, so the tests
  that already drive it stand.
- `close_docviews` (`:659`) keeps what `open_docs_view` opened and closes it, so a close reports a
  real count instead of always zero.
- `evaluate_with_programs` lands beside `evaluate_with_program` (`csharp.substrate.test.rs:173`) and
  seeds several programs, so a test can put more in than the library's retention of four holds.

### context

The four crossings are pinned at `csharp.surface.test.rs:292-311`.

- `an_eviction_hands_a_csharp_program_what_it_freed` — `Context.EvictFileView("src/a.cs")` logs
  `Items`, `ReclaimedTokens`, `Paths` and `Detail` off the returned `Context.ReclaimReport`.
- `an_omitted_eviction_path_drops_every_view_from_csharp` — `Context.EvictFileView()` reaches
  dispatch with a null `path`, which is the wire's word for all of them.
- `an_empty_eviction_path_is_an_argument_error_in_csharp` — `InvalidArgument`.
- `an_archive_hands_a_csharp_program_what_it_freed` — `Context.ArchiveThread(new
  Context.TurnRange(4, 19))` logs the returned `ReclaimReport`.
- `an_empty_archive_list_is_an_argument_error_in_csharp` — `Context.ArchiveThread()` with no spans,
  `InvalidArgument`.
- `more_archive_spans_than_gg_takes_is_an_argument_error_in_csharp` — over thirty-two spans,
  `InvalidArgument`.
- `an_archive_span_that_ends_before_it_starts_is_an_argument_error_in_csharp` — `InvalidArgument`.
- `an_archive_search_hands_a_csharp_program_its_hits` — `Context.SearchArchive("the parser")` logs
  `ArchiveEmpty` and the first `ArchiveHit`'s `Seq`, `Role` and `Text`, with `Role` read as
  `Context.MessageRole.Assistant`.
- `an_archive_search_that_matched_nothing_is_an_empty_hit_list_in_csharp` — a responder answering
  `archive_empty: false` with no hits, so the program logs `False 0`.
- `an_empty_archive_says_so_rather_than_matching_nothing_in_csharp` — a responder answering
  `archive_empty: true`, which the program distinguishes from the case above.
- `an_empty_archive_query_is_an_argument_error_in_csharp` — `InvalidArgument`.
- `a_compaction_is_registered_and_a_csharp_program_runs_on` — `Context.Compact("scaffolded the
  page", "src/Main.cs")` returns nothing, so the case asserts the call reached dispatch carrying
  both arguments and that the statements after it logged.
- `a_blank_compaction_summary_is_an_argument_error_in_csharp` — `InvalidArgument`.

### delegation

The six crossings are pinned at `csharp.surface.test.rs:314-341`, and `SubagentHandle.Send` is
driven from a real handle at `:642`.

- `a_spawn_hands_a_csharp_program_its_childs_handle` — `Delegation.SpawnSubagent("subagent",
  Delegation.Brief.Prompt("write the lexer"))` logs `Id`, `Slot` and `ModelId`.
- `an_issue_brief_crosses_from_csharp_as_an_issue_id` — `Delegation.Brief.Issue("AUTH-1")` reaches
  dispatch with `issueId` set and `prompt` null, which is the half of the brief union no arm drives.
- `an_agent_this_session_may_not_spawn_is_an_argument_error_in_csharp` — `InvalidArgument`.
- `a_spawn_at_the_delegation_depth_cap_is_limit_exceeded_in_csharp` — `LimitExceeded`.
- `a_wait_hands_a_csharp_program_each_childs_result` — `Delegation.WaitForSubagents("agent-1")` logs
  `Id`, `Status` and `Summary` off the first `SubagentResult`, with `Status` read as
  `Delegation.AgentStatus.Completed`.
- `a_wait_with_no_ids_collects_every_child_from_csharp` — `Delegation.WaitForSubagents()` reaches
  dispatch with null `ids`, which is the form a model reaches for most.
- `a_child_with_no_ending_reports_no_status_in_csharp` — a responder answering a result whose status
  is absent, so the program logs that `Status` is null rather than a member.
- `every_agent_status_reaches_a_csharp_program_as_its_own_member` — a responder answering one result
  per wire status, so a renumbered managed enum sends one of them to the wrong member.
- `waiting_on_a_child_this_session_never_spawned_is_not_found_in_csharp` — `NotFound`.
- `a_message_reaches_a_running_child_from_csharp` — `Delegation.SendMessage("agent-1", "prefer the
  simpler parser")` returns nothing, so the case asserts the call reached dispatch with both
  arguments and the line after it logged.
- `a_message_to_a_child_that_is_not_there_is_not_found_in_csharp` — `NotFound`.
- `a_message_to_a_child_that_has_returned_is_a_conflict_in_csharp` — `Conflict`.
- `a_transition_is_registered_and_a_csharp_program_runs_on` — `Delegation.TransitionState("verify",
  note: "the build is green")` logs the lines after it, which is the whole of what registered means
  here.
- `a_state_this_session_cannot_reach_is_an_argument_error_in_csharp` — `InvalidArgument`.
- `a_second_succession_declared_from_one_csharp_program_is_refused` — one program calling
  `Delegation.Exec` and then `Delegation.TransitionState`, which share the succession slot, asserting
  the first stands and the second is `Refused`.
- `a_transition_with_no_machine_driving_the_session_is_unavailable_in_csharp` — `Unavailable`. This
  is the only `Binding::Machine` operation (`crates/gg/src/sandbox/operations.rs:691-696`), and the
  one binding kind this arm's refusal tests have never reached.
- `an_exec_is_registered_and_a_csharp_program_runs_to_its_end` — `Delegation.Exec("Builder", prompt:
  "pick it up from here")` followed by further calls and logs, all of which still happen.
- `an_agent_this_session_may_not_become_is_an_argument_error_in_csharp` — `InvalidArgument`.
- `an_exec_inside_a_state_machine_is_unavailable_in_csharp` — `Unavailable`.
- `a_fork_hands_a_csharp_program_the_copys_handle` — `Delegation.Fork("try the other fix")` logs
  `Id`, `Slot` and `ModelId`, the id being minted at the call even though the copy is dispatched
  once the turn closes.
- `a_blank_fork_prompt_is_an_argument_error_in_csharp` — `InvalidArgument`.
- `a_fork_at_the_delegation_depth_cap_is_limit_exceeded_in_csharp` — `LimitExceeded`.
- `a_fork_with_no_delegation_runtime_is_unavailable_in_csharp` — `Unavailable`.

### programs

The empty history, the `NotFound` on an id never issued and the successful hand-over are held at
`csharp.surface.test.rs:555`, `:559` and `:565`, asserted at `:576-578`.

- `a_history_hands_a_csharp_program_each_programs_shape` — a library seeded through
  `evaluate_with_programs` logs `Id`, `Turn`, `Lines`, `Chars`, `Ok` and `Error` off the first
  `ProgramSummary`.
- `a_history_without_a_library_is_unavailable_in_csharp` — `Programs.History()` for an agent granted
  no `program-library` capability, `Unavailable`, with nothing reaching the api.
- `a_get_hands_a_csharp_program_the_source_that_ran` — `Programs.Get` of a seeded id logs the source
  back verbatim.
- `an_id_the_library_has_dropped_is_not_found_in_csharp` — more programs seeded than the retention
  of four holds (`fake.test.rs:266`), so the oldest id is `NotFound` for a reason distinct from
  never having been issued, and the message names the ids that are held.
- `a_get_without_a_library_is_unavailable_in_csharp` — `Unavailable`.
- `a_blank_rerun_source_is_an_argument_error_in_csharp` — `InvalidArgument`, refused at
  `crates/gg/src/sandbox/membrane/programs.rs:93-99`.
- `a_second_rerun_from_one_csharp_program_is_refused` — `Refused`, the first hand-over standing
  (`programs.rs:100-105`).
- `a_rerun_a_failing_csharp_program_declared_is_revoked` — a program that hands over and then throws,
  asserting `outcome.rerun.is_none()`, which is the mode a model hits by accident.
- `a_rerun_without_a_library_is_unavailable_in_csharp` — `Unavailable`.

### docs

`Docs.Search`'s page and filters, `Docs.Close`'s `Unavailable` refusal, and both closes reporting
zero with nothing open are held at `csharp.surface.test.rs:479-497`, `:485` and `:531-539`. An
unrecognised `kind` is not a mode this arm has: `Docs.DocKind` is an enum, so it cannot be written
wrong in a well-typed program.

- `a_search_with_no_query_and_no_filter_is_an_argument_error_in_csharp` — `InvalidArgument`.
- `a_search_limit_of_zero_is_an_argument_error_in_csharp` — `InvalidArgument`.
- `a_search_answers_a_csharp_program_granted_nothing` — `Docs.Search` from an agent granted no
  operations at all, which is what `Binding::Always`
  (`crates/gg/src/sandbox/operations.rs:710`) buys and what a session's first turn depends on.
- `a_close_takes_one_documentation_view_back_out_in_csharp` — `Views.OpenDocsView` then
  `Docs.Close` of the same key logs `1`, and the view report shows it closed.
- `a_close_all_takes_every_documentation_view_out_in_csharp` — two opens then `Docs.CloseAll()` logs
  `2`, recorded under gg's own word for all of them.
- `a_close_all_without_the_capability_is_unavailable_in_csharp` — `Unavailable` on `Docs.CloseAll`,
  the `NO_INPUT` half of the pair (`operations.rs:718-722`), which the existing refusal case reaches
  only through `Docs.Close`.

### views

`Views.OpenFile`'s text success and line cut, `Views.OpenText`, `Views.OpenDocsView` and
`Views.Close` of an open and of an unopened selector are held at `csharp.surface.test.rs:407-412`,
asserted at `:426-430` and `:449-463`.

- `an_image_view_reaches_a_csharp_program_as_the_image_variant` — `Views.OpenFile("logo.png")`
  branches to `Files.ImageFile` and logs `MediaType`, `Label`, `Bytes` and `Shown`; the double
  answers a `.png` path with the image payload (`fake.test.rs:946-955`).
- `a_file_view_of_a_path_that_is_not_there_is_not_found_in_csharp` — `NotFound`, asserting
  `outcome.views_opened` is empty because a failed read opens nothing.
- `a_file_view_offset_past_the_end_is_an_argument_error_in_csharp` — `InvalidArgument`.
- `a_file_view_width_of_zero_is_an_argument_error_in_csharp` — `maxLineChars: 0`,
  `InvalidArgument`.
- `a_file_view_width_over_the_bound_is_an_argument_error_in_csharp` — `maxLineChars: 65_537`,
  `InvalidArgument`, a separate cause from the zero above.
- `a_file_view_over_the_size_cap_is_limit_exceeded_in_csharp` — `LimitExceeded`, asserting the
  message names the size the way `Views.cs:35-39` promises.
- `a_file_view_without_read_file_is_unavailable_in_csharp` — `all_operations_without("read-file")`,
  `Unavailable`, with nothing reaching dispatch.
- `an_empty_text_view_label_is_an_argument_error_in_csharp` — `InvalidArgument`, refused by the
  double at `fake.test.rs:717-730`.
- `a_text_view_body_over_the_cap_is_limit_exceeded_in_csharp` — `LimitExceeded` naming the body's
  cap.
- `a_text_view_label_over_the_cap_is_limit_exceeded_in_csharp` — `LimitExceeded` naming the label's
  cap, which is a different cap from the body's.
- `a_documentation_name_nothing_on_this_surface_has_is_not_found_in_csharp` — `Views.OpenDocsView`
  of an unknown name, `NotFound`.
- `a_documentation_name_this_agent_does_not_bind_is_not_found_in_csharp` — a name the double is
  seeded with for another agent, `NotFound`, a separate cause from the unknown name above.
- `an_empty_view_selector_is_an_argument_error_in_csharp` — `Views.Close("")`, `InvalidArgument`,
  refused by the double at `fake.test.rs:732-742`.
- `a_view_close_without_agent_managed_context_is_unavailable_in_csharp` —
  `all_operations_without("agent-managed-context")`, `Unavailable`. This is the call the
  context-pressure prompt points an agent at, and it shares a name with `Docs.Close`, so the case
  also asserts the refusal names `views.close` rather than its neighbour.

### session

`Session.Finish`'s ending, `Session.Approve` and `Session.RequestChanges` with two items are held at
`csharp.surface.test.rs:415-444`, `:590-601` and `:566-585`.

- `a_blank_finish_summary_is_an_argument_error_in_csharp` — `InvalidArgument`, refused at
  `crates/gg/src/ending.rs:166`.
- `a_later_finish_in_one_csharp_program_replaces_the_summary` — two `Session.Finish` calls, the
  second standing.
- `a_completion_a_failing_csharp_program_declared_is_revoked` — `Session.Finish` then an uncaught
  throw, asserting the completion is taken back and the program error is kept.
- `a_reviewers_program_cannot_finish_in_csharp` — `Session.Finish` under `EndingRole::Review`,
  `Unavailable`, the refusal naming the call in this arm's own spelling.
- `a_standard_agents_program_cannot_approve_in_csharp` — `Session.Approve` under
  `EndingRole::Standard`, `Unavailable`.
- `a_standard_agents_program_cannot_request_changes_in_csharp` — `Unavailable`.
- `an_empty_change_list_is_an_argument_error_in_csharp` — `Session.RequestChanges()` with no items,
  `InvalidArgument`, refused at `crates/gg/src/ending.rs:193`.
- `a_change_list_of_blank_entries_is_an_argument_error_in_csharp` — a non-empty list every entry of
  which is blank, which `ending.rs:190-194` filters to nothing and refuses for a reason the model
  reads differently from the empty list above.
- `a_verdict_a_failing_csharp_program_declared_is_revoked` — `Session.Approve` then an uncaught
  throw, asserting the verdict is dropped.

### feedback

This arm reaches `log` and `report-error` of the functions on
`crates/gg/wit/gg-sandbox.wit:1060-1139`. `log` is
every `Console.Write` and `Console.WriteLine`, redirected onto the feedback channel by the
`[ModuleInitializer]` at
`packages/gg-sandbox-csharp/src/Gg/Internal/OperatorConsole.cs:71` through the `TextWriter` at
`:25`. `report-error` is reached from the guest shell three ways: an uncaught exception
(`packages/gg-sandbox-csharp/Sources/shell.c:279-289`), a non-zero entry-point status (`:370-373`)
and a guest-side failure before the program runs (`:337-348`). `note-return` and
`report-module-error` have no C# call site, since a returned value is the entry-point status here
and a code module reaches this guest already compiled as one of the manifest's assemblies
(`shell.c:300-324`), so their absence is recorded in the module comment rather than tested.

The uncaught-`ApiException` path is held at `csharp.surface.test.rs:714`, and every way a status
reaches the model at `csharp.substrate.test.rs:853`.

- `a_partial_line_a_csharp_program_wrote_still_reaches_the_model` — `Console.Write` with no newline
  after it, flushed by the shell once the program has ended (`OperatorConsole.cs:54-57`).
- `console_error_is_a_different_channel_from_a_csharp_programs_log` — a program writing to both,
  asserting only the `Console.Out` line is in `outcome.logs`.
- `a_csharp_program_that_logged_before_it_threw_keeps_what_it_logged` — the lines before an uncaught
  failure stand beside the reported error.

## Done when

- [ ] Each case above is its own `#[test]` in
      `crates/gg/src/sandbox/language/csharp.surface.test.rs`, driving one short C# program.
- [ ] Every successful call in `Context`, `Delegation`, `Programs`, `Docs`, `Views` and `Session`
      has a C# program that reads its post-call state back, or a cited crossing row where the call
      returns nothing.
- [ ] Every failure mode the arm's `<exception>` blocks name is injected and asserted as the
      `Gg.ApiException` the program catches, by `Code` and by `Operation`.
- [ ] The capability and role refusals assert that nothing reached gg's dispatch.
- [ ] `FakeOperationApi` models every rule listed under _What the double gains_, each documented
      beside the rule it sits next to, and the tests already driving `open_docs_view` and
      `search_docs` still pass unseeded.
- [ ] The module comment at `csharp.surface.test.rs:13-17` asks for a function per case and quotes
      the measured guest-compile cost, and records that `note-return` and `report-module-error` have
      no call site on this arm.
- [ ] Gates green.
