# Drive gg's session-side SDK modules from Kotlin programs

Give the Kotlin arm a program-level test for every operation in the context,
delegation, programs, docs, views and session modules, and for the feedback
channel underneath them: one short test for each successful call and one short
test for each distinct runtime failure mode. Every test synthesizes the model's
response as a Kotlin program and asserts the state the call left behind.

## Current state

The operation vocabulary these modules are named from is
`crates/gg/src/sandbox/operations.rs`, from `CONTEXT_EVICT_FILE_VIEW` at line 192
through `SESSION_REQUEST_CHANGES` at line 272. The arm spells them in
`packages/gg-sandbox-kotlin/src/gg/`: `context/Context.kt:35`, `51`, `76` and
`94`; `delegation/Delegation.kt:39`, `56`, `70`, `89`, `110` and `130`;
`programs/Programs.kt:35`, `51` and `69`; `docs/Docs.kt:50`, `83` and `94`;
`views/Views.kt:42`, `65`, `81` and `102`; `session/Session.kt:25`, `37` and
`53`; and `feedback.log` as `gg.log` at `Gg.kt:24`.

The arm's tests live in `crates/gg/src/sandbox/language/kotlin.surface.test.rs`
and `kotlin.substrate.test.rs`. The harness is the substrate file's own helpers,
re-exported into the surface file at `kotlin.surface.test.rs:23`: `whole` wraps a
statement body in the `fun main()` this arm asks for, `prepare` compiles it
through the production prepare step, and `evaluate_as`
(`kotlin.substrate.test.rs:138`) drives the component through the real membrane
with the granted operations, the ending group and the program-library flag said
out loud. `evaluate_closing_docviews` (`:152`) adds `docview-close`, and
`evaluate_with_program` (`:171`) seeds the library with a program recorded under
an id. `logs` (`:252`) reads what a clean program logged and `trap` (`:274`)
reads a failed program's own dying words. The surface file wraps these as
`run_as` (`:54`), `prepare_program` (`:72`) and `run_with` (`:77`).

The double behind all of it is `crates/gg/src/sandbox/fake.test.rs`:
`FakeOperationApi` (`:141`) answers every gg tool through a responder and models
the view window and the program library itself, `CallLog` (`:90`) records the
JSON each call reached gg's dispatch with, `canned_outcome` (`:780`) is the
plausible-answer responder, and `all_operations` (`:1151`) and
`all_operations_without` (`:1185`) are the grant sets. A failure mode carried by
a gg tool is produced by handing `run_as` a responder that returns
`ToolOutcome::failed`, the way `kotlin.surface.test.rs:702` does.

Two facts decide where each failure mode comes from. The context and delegation
operations dispatch to gg tools, so their refusals arrive from the responder and
their sidecar-shaped answers come back through the membrane's `missing_data`
path when the outcome carries none (`crates/gg/src/sandbox/membrane/context.rs:122`,
`membrane/delegation.rs:50`). The docs, views, programs and session operations
are answered inside the membrane and the double, so their refusals are real:
`membrane/programs.rs:94` refuses a blank rerun source, `membrane/session.rs:49`
routes a summary through `crate::ending::Ending::finished` (`ending.rs:165`), and
`fake.test.rs:722` and `:733` refuse a blank view label and a blank selector.

What the arm already drives is listed per module below, and every case named
there is cited rather than asked for again.

## Design

### The seam the double needs

`FakeOperationApi` gains one builder beside `documenting`
(`fake.test.rs:283`) and `with_program` (`:295`):

```rust
pub(crate) fn refusing(mut self, operation: OperationId, failure: ToolFailure, message: &str) -> Self
```

It makes the named membrane-answered operation return that refusal in place of
its canned success, and it is reached from this arm through a new
`evaluate_refusing` helper beside `evaluate_with_program` in
`kotlin.substrate.test.rs`. It is what the ceilings and the catalogue-shaped
`not-found` cases are driven with: the double models no catalogue and no view
size cap, so `docs.search`'s two argument refusals, `views.open_docs_view`'s two
`not-found` causes and `views.open_text`'s two ceilings reach a program only
through it. Every other arm's equivalent cases use the same builder.

### Where the tests land

New cases for the six modules go in `kotlin.surface.test.rs`, which is where this
arm's model-facing surface is asserted. The ending-role cases join
`kotlin.substrate.test.rs` beside
`an_agents_ending_group_decides_what_its_program_may_call` (`:1331`). Each case is
its own `#[test]` with its own short program, so the consolidation notes at
`kotlin.surface.test.rs:13`-`18` and `kotlin.substrate.test.rs:36`-`41` are
revised as part of this work: they record what a program costs on this arm
(`kotlin.substrate.test.rs:1129` measures a JVM start at half a second and the
first build in it at four or five) rather than directing a reader to extend an
existing function.

Two failure modes the policy would otherwise ask for are compile errors on this
arm and are recorded as such rather than tested. A brief that is neither a prompt
nor an issue, and one that is both, are unrepresentable because `Brief` is a
sealed interface (`Delegation.kt:136`), as `kotlin.surface.test.rs:318`-`:319` already
says. An unrecognised documentation `kind` is unrepresentable because `DocKind`
is an enum (`Docs.kt:104`).

### context

Held already: the arguments each of the four calls reaches gg's dispatch with,
in the crossing table at `kotlin.surface.test.rs:294`-`316`.

- `an_evicted_file_view_reports_what_it_reclaimed` — `gg.context.evictFileView("src/a.kt")` and read `items`, `reclaimedTokens`, `paths` and `detail` off the `ReclaimReport`.
- `evicting_every_file_view_names_no_path` — `gg.context.evictFileView()` sends no path.
- `an_empty_path_is_refused_rather_than_evicting_everything` — the responder answers `invalid-argument`.
- `an_eviction_with_no_reclaim_report_is_a_missing_sidecar` — the responder answers ok with no data.
- `an_archived_span_reports_what_it_reclaimed` — `gg.context.archiveThread(4..19, 30..<36)` and read the report back.
- `archiving_no_spans_at_all_is_refused` — `gg.context.archiveThread()`.
- `archiving_more_than_thirty_two_spans_is_refused`.
- `a_span_that_ends_before_it_starts_is_refused` — `gg.context.archiveThread(19..4)`.
- `an_archive_with_no_reclaim_report_is_a_missing_sidecar`.
- `a_search_of_the_archive_reads_its_hits_back` — `archiveEmpty` false, and the hit's `seq`, `role` as `gg.context.MessageRole.ASSISTANT` and `text`.
- `a_search_that_matches_nothing_is_an_empty_hit_list` — `archiveEmpty` false with no hits.
- `an_empty_archive_is_told_apart_from_no_match` — `archiveEmpty` true.
- `an_empty_archive_query_is_refused`.
- `a_search_with_no_archive_payload_is_a_missing_sidecar`.
- `a_compaction_is_registered_and_the_program_carries_on` — `gg.context.compact("scaffolded the page", "src/Main.kt")` returns and a later `gg.log` still runs.
- `a_blank_compaction_summary_is_refused`.

### delegation

Held already: the arguments each of the six calls reaches dispatch with
(`kotlin.surface.test.rs:317`-`349`), and the `SubagentHandle.send` member
carrying the child's id across (`:521`-`:560`).

- `a_spawned_child_hands_back_its_own_handle` — read `id`, `slot` and `modelId` off the `SubagentHandle`.
- `a_child_can_be_briefed_with_an_issue` — `gg.delegation.Brief.Issue("EPIC-1")` sends `issueId` and no prompt.
- `a_spawn_past_the_delegation_depth_cap_is_refused` — `limit-exceeded`.
- `an_agent_this_session_may_not_spawn_is_refused` — `invalid-argument`.
- `a_spawn_with_no_handle_is_a_missing_sidecar`.
- `a_waited_child_reports_its_id_status_and_summary` — `gg.delegation.waitForSubagents("agent-1")` and read the `SubagentResult`.
- `waiting_for_every_child_names_no_ids` — `gg.delegation.waitForSubagents()`.
- `a_child_with_no_ending_reports_a_null_status`.
- `every_agent_ending_reaches_its_kotlin_entry` — one program reading each `gg.delegation.AgentEnding` entry (`Delegation.kt:183`) back off a seeded result.
- `waiting_on_an_id_nobody_issued_is_not_found`.
- `a_wait_with_no_results_is_a_missing_sidecar`.
- `a_message_reaches_a_running_child` — the module spelling, asserting the call reached dispatch.
- `messaging_an_agent_that_does_not_exist_is_not_found`.
- `messaging_a_child_that_has_returned_is_a_conflict`.
- `a_transition_is_registered_and_the_program_carries_on`.
- `a_transition_without_a_note_sends_none` — the `note` default at `Delegation.kt:89`.
- `a_state_this_session_may_not_move_to_is_refused` — `invalid-argument`.
- `an_agent_standing_in_no_machine_state_is_told_the_transition_is_unavailable` — run with no operations granted; this is the only `Binding::Machine` row (`operations.rs:214`, `:314`) and the arm's existing refusal case at `kotlin.surface.test.rs:753` exercises a `Binding::Capability` row.
- `a_transition_after_an_exec_is_refused_and_the_first_succession_stands` — one program calling `gg.delegation.exec` then `gg.delegation.transitionState`.
- `an_exec_is_registered_and_the_program_runs_to_its_end` — a `gg.log` after the call still reaches the outcome.
- `an_exec_without_a_prompt_sends_none`.
- `an_agent_this_session_may_not_become_is_refused`.
- `a_fork_hands_back_the_copys_handle_immediately` — `id`, `slot` and `modelId` off the fork sidecar.
- `a_fork_past_the_delegation_depth_cap_is_refused`.
- `a_fork_with_no_handle_is_a_missing_sidecar`.

### programs

Held already: an empty history reading `0` and an id the library never issued
reading `NOT_FOUND`, at `kotlin.surface.test.rs:485`; the hand-over being
recorded, at `:486`; and `ProgramSummary.source` fetching by id out of a seeded
library, at `:572`-`:578`.

- `a_seeded_history_reports_each_programs_id_and_turn` — through `evaluate_with_program`.
- `a_history_call_without_a_library_is_unavailable`.
- `a_program_the_library_holds_is_fetched_by_id` — `gg.programs.get` directly rather than through the member.
- `a_fetch_that_names_no_held_id_says_what_is_held` — assert the message names the seeded ids.
- `a_fetch_without_a_library_is_unavailable`.
- `a_blank_rerun_source_is_refused` — `membrane/programs.rs:94`.
- `a_second_hand_over_is_refused_and_the_first_stands` — `membrane/programs.rs:100`.
- `a_hand_over_is_revoked_when_the_program_then_throws`.
- `a_rerun_without_a_library_is_unavailable`.

### docs

Held already: a search by query alone and a search by filters alone
(`kotlin.surface.test.rs:601`-`623`), both run with no operations granted, which
is this arm's proof of the `Binding::Always` row; each search's page landing in
the window under `SEARCH_RESULTS_VIEW` (`:626`-`:648`); the `unavailable` refusal
on a close without `docview-close` (`:623`); and both closes answering `0` with
nothing open (`:651`-`:662`).

- `a_search_carrying_neither_a_query_nor_a_filter_is_refused` — `gg.docs.search()`.
- `a_search_limit_of_zero_is_refused`.
- `a_blanket_close_without_the_capability_is_unavailable` — `gg.docs.closeAll()` for an agent that does not hold `docview-close`.

### views

Held already: a file view opened with an offset and a limit and its text read
back through `gg.files.TextFile`, a text view, a documentation view, a close of an
open selector reading `1` and a close of a selector never opened reading `0`, and
the recorded selectors of all four, at `kotlin.surface.test.rs:405`-`440`; a
second file view carrying its own `maxLineChars` across, at `:409` and `:463`.

- `an_image_file_view_reads_back_as_the_image_variant` — the `gg.files.ImageFile` arm of the `when` at `:413`-`:416`, driven with a responder that answers an image.
- `opening_a_view_of_a_file_that_is_not_there_opens_nothing` — the read fails and `views_opened` stays empty.
- `a_line_cut_of_zero_is_refused`.
- `a_line_cut_over_the_ceiling_is_refused` — sixty-five thousand five hundred and thirty-six is the bound.
- `a_run_without_read_file_cannot_open_a_file_view` — `all_operations_without(CAPABILITY_READ_FILE)`.
- `re_opening_the_same_selector_supersedes_the_view_it_replaces`.
- `a_blank_text_view_label_is_refused` — `fake.test.rs:722`.
- `a_text_view_body_over_the_ceiling_is_refused` — through the new `refusing` builder.
- `a_text_view_label_over_the_ceiling_is_refused` — a ceiling distinct from the body's.
- `a_documentation_view_of_a_name_nothing_declares_is_not_found`.
- `a_documentation_view_of_a_name_this_agent_does_not_bind_is_not_found`.
- `a_blank_close_selector_is_refused` — `fake.test.rs:733`.
- `a_run_without_agent_managed_context_cannot_close_a_view`.

### session

Held already: a standard agent finishing and the ending recorded, at
`kotlin.substrate.test.rs:1331`; a reviewer requesting two changes and the
verdict recorded, at `kotlin.surface.test.rs:487`-`:494`; a reviewer approving, at
`:509`-`:519`.

- `a_blank_finish_summary_is_refused` — `ending.rs:165`.
- `a_later_finish_replaces_the_summary_it_stands_on`.
- `a_completion_is_revoked_when_the_program_then_throws`.
- `a_reviewer_has_no_finish_to_call` — a `Review` agent calling `gg.session.finish`, refused `unavailable`, with the message naming the endings in this arm's own spelling.
- `a_standard_agent_has_no_approve_to_call`.
- `a_standard_agent_has_no_request_changes_to_call`.
- `a_rejection_with_no_changes_at_all_is_refused` — `gg.session.requestChanges()`.
- `a_rejection_whose_every_change_is_blank_is_refused` — a distinct cause from the empty list, because blank entries are dropped first (`ending.rs:188`).

### feedback

`gg.log` is the whole of this arm's spelling of the interface at
`crates/gg/wit/gg-sandbox.wit:1060`: `Gg.kt:24` calls `feedback.log`, and nothing
in this arm's SDK or in gg's generated entry class reaches `note-return`,
`report-deferred`, `report-error` or `report-module-error`. An uncaught failure
is captured as the guest runtime's own trap rather than intercepted
(`kotlin.substrate.test.rs:266`-`273`), `fun main()` returns nothing for
`note-return` to note, and a module that fails is refused at prepare
(`kotlin.substrate.test.rs:742`) so no module error can reach a running program.

Held already: lines logged by a clean program, read through `logs`
(`kotlin.surface.test.rs:423`-`:427`); an uncaught API failure arriving as the
runtime's own words at the model's own line, with what was logged before it still
standing (`:717`-`:734`).

- `a_logged_line_is_the_only_value_a_program_shows_gg` — `gg.log` is absent from this arm's catalogue (`Gg.kt:18`-`19`), asserted off `crate::sandbox::catalogue_functions` the way `kotlin.surface.test.rs:668`-`683` reads the member functions.
- `an_ordinary_throw_reaches_the_model_as_its_runtimes_own_words` — a program that logs and then throws a plain Kotlin exception rather than a `gg.core.ApiError`, read through `trap`, with the lines it logged first still standing.

## Done when

- [ ] `FakeOperationApi::refusing` exists in `crates/gg/src/sandbox/fake.test.rs` and is reachable from this arm through an `evaluate_refusing` helper in `kotlin.substrate.test.rs`.
- [ ] Every case listed above has its own `#[test]` in `kotlin.surface.test.rs` or `kotlin.substrate.test.rs`, each driving one short Kotlin program and asserting the state the call left behind.
- [ ] Each test grants exactly the operations its case needs, so a refusal case proves the refusal rather than the grant.
- [ ] The consolidation notes at `kotlin.surface.test.rs:13`-`18` and `kotlin.substrate.test.rs:36`-`41` record this arm's per-program cost and direct a reader to add a function.
- [ ] No test in either file reaches a model or a provider.
- [ ] Gates green.
