# Drive gg's session-side SDK modules from JavaScript programs

Give the JavaScript arm a program-level test for every call in `context`,
`delegation`, `programs`, `docs`, `views` and `session`, and for the `feedback`
channel a program reaches through `console.*`, a module it was handed and a throw
of its own. Each call gets one short test for the successful call and one short
test per distinct runtime failure mode, all of them driven from real JavaScript
through the real membrane against the operation doubles.

## Current state

The arm's programs run in
`crates/gg/src/sandbox/language/javascript.substrate.test.rs`. Its helpers are
`javascript()` (`:50`), `run` (`:55`), `run_with` (`:61`) and `run_scoped`
(`:70`), which build a `ProgramScope` over `all_capabilities()` and hand
`run_program` a `FakeOperationApi::with(&log, canned_outcome)`; `thrown` (`:98`)
reaches the throw the guest reported and `logs` (`:105`) the lines a successful
program wrote. `crates/gg/src/sandbox/language/ecmascript.test.rs` drives plain
JavaScript on the same guest through its own `run` (`:64`) and `run_with`
(`:80`), with the guest compile paid up front by `warm` (`:75`).

The doubles these tests reuse live in `crates/gg/src/sandbox/fake.test.rs`:
`FakeOperationApi::with` takes the responder a test needs (`:258`),
`canned_outcome` answers every tool with a typed outcome (`:780`), `documenting`
(`:277`) and `with_program` (`:293`) seed the docs and library state, and
`CallLog` records each call's name and arguments exactly as the membrane composed
them (`:90`). The operations answered inside the membrane rather than by
a tool are modelled there too: `open_docs_view` (`:625`), `search_docs` (`:641`),
`close_docviews` (`:659`), `open_file_view` (`:676`), `open_text_view` (`:717`),
`close_view` (`:732`), `program_history` (`:746`) and `program_source` (`:749`).
The `SandboxOutcome` a run returns carries what a test asserts about state:
`views_opened` (`crates/gg/src/sandbox/outcome.rs:82`), `views_closed` (`:85`),
`view_refusals` (`:91`), `deferred_note` (`:96`), `module_errors` (`:102`),
`returned_value` (`:109`), `completion` (`:122`), `revoked_completion` (`:125`),
`rerun` (`:135`) and `revoked_rerun` (`:138`).

The operation vocabulary these modules name is
`crates/gg/src/sandbox/operations.rs:192-272`, and the feedback channel is
declared at `crates/gg/wit/gg-sandbox.wit:1060-1139` with its host at
`crates/gg/src/sandbox/membrane/capture.rs:253`, `:273`, `:279` and `:290`.

What the arm already drives in these modules:

- `context.compact` (`javascript.substrate.test.rs:260`,
  `ecmascript.test.rs:781`) and `context.searchArchive` as a bare crossing
  (`ecmascript.test.rs:770`).
- `delegation.sendMessage` (`javascript.substrate.test.rs:261`) and
  `delegation.spawnSubagent` with the prompt brief, whose handle the program then
  messages (`javascript.substrate.test.rs:363`).
- `docs.search` written as the documentation states it, with the page read back
  (`javascript.substrate.test.rs:274`), and `docs.closeAll` refused as
  `unavailable` with the sentence the model reads asserted
  (`javascript.substrate.test.rs:582`, `:600`).
- `views.openText` (`javascript.substrate.test.rs:255`, `:364`), its
  mistyped-argument guard (`:214`), `views.close` (`:365`), and the assertion
  that a text view and a search land in `views_opened` under their own selectors
  (`:306-312`). `views.openFile` crosses at `ecmascript.test.rs:774`.
- `programs.history` as a bare crossing (`ecmascript.test.rs:775`).
- `session.finish` (`javascript.substrate.test.rs:280`).
- The feedback channel's `report-error`, through the G8 gate
  (`javascript.substrate.test.rs:617`), an uncaught throw
  (`ecmascript.test.rs:307`) and a floating rejection (`ecmascript.test.rs:474`).

## Design

### Where the tests land

Add `crates/gg/src/sandbox/language/javascript.surface.test.rs`, declared from
`crates/gg/src/sandbox/language/javascript.rs` beside the substrate module at
`:214`, in the shape the other arms use for their model-facing surface. Each case
below is its own short `#[test]` naming one behaviour. The note at
`javascript.substrate.test.rs:25-27` is revised as part of this work to point new
cases at the surface file: the cost this arm pays per process is the guest's
encode and compile, which `ecmascript.test.rs:75` pays once at the top of each of
its own functions, and nextest runs those processes in parallel.

Make the substrate file's `run`, `run_with`, `run_scoped`, `thrown` and `logs`
`pub(super)`, and add a `run_api(program, operations, ending, api)` that takes the
`FakeOperationApi` the caller built and the `RunEnding` it wants, so a case can
inject a responder, seed a program library, and run a program in the `Review`
ending role that `run_scoped:83` fixes at `Standard`.

Failures reach a program one of two ways. For a tool-backed operation the
responder returns `ToolOutcome::failed(ToolFailure::X, "…")` and the program
catches an `ApiError`, logging `error.code`, `error.operation` and
`error.message` the way `javascript.substrate.test.rs:542` does. For an operation
the membrane answers itself the refusal is the double's or the membrane's own,
and the program reads it the same way.

Three additions to `fake.test.rs` carry the cases that have nothing to refuse
them today:

- `search_docs` (`:641`) refuses a search carrying neither a query nor a filter,
  an unrecognised `kind`, and a `limit` of zero, each as `invalid-argument`,
  matching the refusals the SDK documents at
  `packages/gg-sandbox/src/gg/docs.ts:95-99`.
- `open_docs_view` (`:625`) gains a `docs_index(known, bound)` builder: a bound
  name opens a view, a name outside `known` is `not-found` naming what is bound,
  and a known name this agent does not bind is `not-found` naming this agent's
  own set. With no builder it answers as it does today.
- `open_text_view` (`:717`) refuses a body over gg's body ceiling and a label
  over gg's label ceiling as `limit-exceeded`, each naming the cap.

### context

- `evicting_one_path_reports_what_it_freed` reads `items`, `reclaimedTokens` and
  `paths` off the report.
- `evicting_every_file_view_sends_no_path` asserts the recorded call carries no
  path.
- `an_empty_path_is_refused_on_the_argument` for `invalid-argument`.
- `archiving_a_span_lowers_from_and_to_onto_start_and_end` asserts the recorded
  arguments and reads the report back.
- `an_empty_span_list_is_refused`, `more_than_thirty_two_spans_are_refused` and
  `a_span_that_ends_before_it_starts_is_refused`, one test each.
- `a_span_missing_a_bound_is_refused_before_the_host_sees_it` for the SDK's own
  guard at `packages/gg-sandbox/src/gg/context.ts:107-116`, asserting no call was
  recorded.
- `an_archive_search_reads_back_its_hits` reads `hits[0].role`, `hits[0].seq` and
  `hits[0].text`.
- `a_search_that_matches_nothing_is_an_empty_hit_list` and
  `an_empty_archive_is_distinguished_from_no_match`, each with a responder
  answering the `ArchiveSearch` shape it needs.
- `an_empty_query_is_refused`.
- `a_compaction_is_registered_and_the_program_runs_on` asserts the recorded
  arguments carry the summary and the files, and that a line logged after the
  call is there.
- `a_blank_summary_is_refused`.

### delegation

- `a_subagent_spawned_from_an_issue_sends_no_prompt` for the `issueId` brief; the
  prompt brief is driven at `javascript.substrate.test.rs:363`.
- `a_brief_that_is_neither_a_prompt_nor_an_issue_is_refused` and
  `a_brief_that_is_both_a_prompt_and_an_issue_is_refused`, one test each.
- `an_agent_this_session_may_not_spawn_is_refused` for `invalid-argument`, and
  `the_delegation_depth_cap_is_limit_exceeded`.
- `waiting_on_named_children_collects_them_in_dispatch_order` reads each result's
  `status` and `summary`.
- `waiting_for_every_child_sends_no_ids`.
- `a_child_with_no_ending_reports_no_status`.
- `every_agent_ending_reaches_the_program_as_its_own_value` walks the
  `AgentEnding` union in one program.
- `an_unknown_child_id_is_not_found`.
- `an_unknown_agent_id_is_not_found_on_a_message` and
  `a_message_to_a_child_that_returned_is_a_conflict`; the successful message is
  driven at `javascript.substrate.test.rs:261`.
- `a_transition_is_registered_and_the_program_runs_on` asserts the recorded state
  and note.
- `a_state_this_session_may_not_move_to_is_refused`,
  `a_transition_with_nowhere_to_go_is_unavailable` and
  `a_second_succession_in_one_turn_is_refused`, the last written as one program
  calling `transitionState` and then `exec`.
- `an_exec_returns_and_the_program_runs_to_its_end` logs a line after the call,
  which is the deferred-succession contract at
  `apps/docs/src/content/docs/gg/responses-as-code/api-surface.md:88`.
- `an_agent_this_session_may_not_become_is_refused`.
- `a_forked_copy_reports_its_id_immediately` reads the handle's `id` and the
  agent and model it runs as.
- `forking_past_the_depth_cap_is_limit_exceeded`.

### programs

Each of these builds its api with `with_program` (`fake.test.rs:293`) where a
library is wanted, and withholds `program-library` through
`all_operations_without` where it is not.

- `the_history_lists_the_programs_the_library_holds` reads a summary's fields.
- `an_empty_history_is_an_empty_list`.
- `a_history_without_a_library_is_unavailable`.
- `a_program_source_is_read_back_by_its_id`.
- `an_id_the_library_never_issued_is_not_found_naming_what_is_held`.
- `an_id_whose_program_was_dropped_is_not_found`.
- `a_get_without_a_library_is_unavailable`.
- `a_hand_over_is_registered_and_the_program_runs_on` asserts `outcome.rerun`
  carries the source.
- `a_blank_source_is_refused_rather_than_handed_to_a_compiler`.
- `the_first_hand_over_stands_and_a_second_is_refused`.
- `a_hand_over_is_revoked_when_the_program_then_fails` asserts `rerun` is gone
  and `revoked_rerun` is set.
- `a_rerun_without_a_library_is_unavailable`.

### docs

- `a_search_answers_an_agent_granted_nothing`, run with every operation withheld,
  which is what `Binding::Always` buys. The documented spelling and the page's
  fields are driven at `javascript.substrate.test.rs:274`, and the search's
  results landing under gg's own selector at `:306-312`.
- `a_search_with_neither_a_query_nor_a_filter_is_refused`,
  `an_unrecognised_kind_is_refused` and `a_limit_of_zero_is_refused`.
- `closing_a_docs_view_reports_what_it_closed`, which is the arm's first program
  calling `docs.close` at all.
- `a_key_that_names_no_open_view_closes_nothing`.
- `a_close_without_the_capability_is_unavailable`.
- `closing_every_docs_view_reports_what_it_closed`.
- `closing_every_docs_view_with_none_open_is_zero`. The withheld-capability
  refusal for `closeAll` is driven at `javascript.substrate.test.rs:582`.

### views

- `a_file_view_hands_the_program_the_read_and_opens_the_view` asserts the
  `FileRead` the program read and the file view in `views_opened`.
- `a_read_that_fails_opens_no_view`, asserting `views_opened` is empty and the
  refusal is in `view_refusals`.
- `a_window_over_the_cap_is_limit_exceeded_naming_the_size_and_the_bound`.
- `a_line_cut_of_zero_is_refused` and `a_line_cut_over_the_ceiling_is_refused`,
  one test each.
- `a_run_without_read_file_cannot_open_a_file_view`.
- `re_opening_the_same_path_supersedes_the_view_it_replaces`, asserting
  `superseded` on the second `views_opened` entry.
- `a_text_view_over_the_body_ceiling_is_limit_exceeded` and
  `a_text_view_over_the_label_ceiling_is_limit_exceeded`.
- `an_empty_label_is_refused`. The successful text view is driven at
  `javascript.substrate.test.rs:255` and the mistyped arguments at `:214`.
- `a_docs_view_opens_from_the_name_the_search_reported` and
  `a_docs_view_opens_from_the_function_itself`, the second passing the function
  reference that `packages/gg-sandbox/src/gg/views.ts:94` accepts.
- `a_docs_lookup_of_a_non_function_is_refused_on_the_argument`.
- `an_unknown_documentation_name_is_not_found` and
  `a_name_this_agent_does_not_bind_is_not_found`.
- `closing_a_selector_nothing_is_open_under_is_zero` and
  `an_empty_selector_is_refused`. The successful close is driven at
  `javascript.substrate.test.rs:365`.

### session

The three endings need the role the run was dispatched in, so each of these
drives `run_api` with `RunEnding::Role(EndingRole::Standard)` or
`EndingRole::Review`.

- `a_finish_is_declared_and_the_program_runs_on` asserts `outcome.completion`
  carries the summary and that a line logged afterwards is there.
- `a_blank_summary_finishes_nothing`.
- `a_later_finish_replaces_the_summary`.
- `a_completion_is_revoked_when_the_program_then_fails`, asserting
  `revoked_completion`.
- `a_finish_outside_the_standard_role_is_unavailable`.
- `an_approval_ends_a_review`.
- `an_approval_outside_the_review_role_is_unavailable`.
- `requesting_changes_carries_every_item_through` reads the ending's items back.
- `a_rejection_with_no_changes_is_refused` and
  `a_rejection_whose_entries_are_all_blank_is_refused`, which
  `crates/gg/src/ending.rs:188-199` treats as one refusal over two causes.
- `requesting_changes_outside_the_review_role_is_unavailable`.

### feedback

- `a_logged_line_reaches_gg_in_the_order_the_program_wrote_it`.
- `a_line_over_the_line_cap_is_truncated`.
- `lines_past_the_log_cap_are_evicted_and_counted`.
- `a_top_level_return_is_the_engines_own_syntax_error`, asserting the guest
  reported the failure and `returned_value` stayed clear, which is this arm's
  form of the rule at `crates/gg/wit/gg-sandbox.wit:1100-1108`.
- `work_a_program_defers_runs_inside_its_own_turn`, asserting the deferred call
  is in the `CallLog` and `deferred_note` is clear.
- `a_module_that_throws_while_loading_is_reported_and_the_program_runs_on`,
  driven through `run_scoped` with a `CodeModule` that throws, asserting
  `module_errors` carries its name and message and that the program's own lines
  are there.
- `a_second_broken_module_is_reported_beside_the_first`.

## Done when

- [ ] `crates/gg/src/sandbox/language/javascript.surface.test.rs` exists, is
      declared from `javascript.rs`, and holds one short test per case above.
- [ ] The substrate file's helpers are reachable from it, and `run_api` takes the
      api and the ending role a case needs.
- [ ] The note at `javascript.substrate.test.rs:25-27` says where a new case
      lands.
- [ ] `fake.test.rs` refuses the docs-search arguments, resolves documentation
      names through `docs_index`, and enforces the text view's two ceilings.
- [ ] Every call in `context`, `delegation`, `programs`, `docs`, `views` and
      `session`, and each of the feedback behaviours, is driven from a JavaScript
      program.
- [ ] Gates green.
