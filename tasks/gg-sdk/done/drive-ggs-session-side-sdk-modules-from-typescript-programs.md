# Drive gg's session-side SDK modules from TypeScript programs

The `context`, `delegation`, `programs`, `docs`, `views` and `session` modules,
plus the `feedback` channel underneath them, are the half of gg's
responses-as-code surface that no gg tool backs. Give the TypeScript arm one
short program-level test for each of their operations' successful calls and one
for each distinct runtime failure mode a well-typed call can hit.

## Current state

The operation vocabulary is `crates/gg/src/sandbox/operations.rs`: the rows
from `CONTEXT_EVICT_FILE_VIEW` (`:192`) to `SESSION_REQUEST_CHANGES` (`:272`),
with what binds each in the table at `:651`-`:775`. The TypeScript spelling of each
is `packages/gg-sandbox/src/gg/context.ts`, `delegation.ts`, `programs.ts`,
`docs.ts`, `views.ts` and `session.ts`, and each function's `@throws` clause names
the failure modes it is documented to have. The `feedback` interface is
`crates/gg/wit/gg-sandbox.wit:1060`-`:1139`, hosted at
`crates/gg/src/sandbox/membrane/capture.rs:251` onwards.

The arm's harness is `crates/gg/src/sandbox.test.rs`, whose helpers every
submodule declared at `:26`-`:33` shares: `run` (`:36`) grants every operation and
answers with `canned_outcome`; `run_with` (`:52`) narrows the granted operations,
the limits and the responder; `run_with_library` (`:82`) binds the program library
and seeds it; `run_as` (`:107`) picks the ending role and grants nothing else.
Readers: `logs` (`:130`), `uncaught` (`:147`), `logged_json` (`:159`), `completion`
(`:175`), `summary_of` (`:183`) and `program_failure` (`:198`). The double is
`crates/gg/src/sandbox/fake.test.rs`: `FakeOperationApi` (`:141`), the tool-call
record `CallLog` (`:90`) with `names` (`:102`) and `args` (`:117`), the
operation-level record `ApiLog` (`:183`) reached through `api_log` (`:272`), the
builders `documenting` (`:283`) and `with_program` (`:295`), and the default
answers in `canned_outcome` (`:780`). `crates/gg/src/sandbox/language/typescript.substrate.test.rs:120`
builds a scope directly, for a test that wants a scope none of the four helpers
gives.

What the arm already drives from a program: `views.openText`, `views.close`,
`views.openFile` and `views.openDocsView` across `sandbox.test.rs:1001`-`:1154`,
including the empty-label refusal at `:1113` and the withheld-capability refusals
at `:1026` and `:1065`; `openDocsView`'s argument-shape guard at
`crates/gg/src/sandbox.faults.test.rs:330`; the program library's binding,
`history`, `get`, `get`'s `not-found` and `rerun`'s revoke-on-failure at
`sandbox.test.rs:1156`-`:1232`; `session.finish` at `:684` and the ending-role gate
across all three ending calls at `:859`; `context.compact` and
`delegation.sendMessage` at `:309`-`:310`; `docs.search` at
`crates/gg/src/agent.sandbox.test.rs:1400`; and `views.openFile`'s `not-found` at
`typescript.substrate.test.rs:120`.

The failure modes reached through the double are answered two ways. Every
`context` and `delegation` row is tool-backed, so `run_with`'s responder answers
it and a test injects the refusal the same way
`crates/gg/src/sandbox/language/python.substrate.test.rs:1561` does. For
`archive_thread` the responder hands its arguments to gg's own guard,
`ArchiveThreadTool::archive` at `crates/gg/src/tools/context.rs:242`, so the
refusal under test is the production message rather than one the test wrote. An
operation no tool backs is answered by the double itself, which models the
`open_text` and `close` argument guards (`fake.test.rs:717`, `:732`) and nothing
else.

The module header at `crates/gg/src/sandbox.test.rs:3`-`:10` asks the reader to
add programs to an existing function rather than add a function, on the grounds
that the component compile is per process. Revise it as part of this work: it
scopes the existing consolidated functions, and the short focused tests below are
each their own function.

## Design

The tests land in a new submodule, `crates/gg/src/sandbox.surface.test.rs`,
declared beside the three at `crates/gg/src/sandbox.test.rs:26`-`:33` and sharing
its helpers. One short function per case below, named as written.

Two shapes recur, so state them once. A successful call asserts the post-call
state: the arguments the membrane composed (`log.args`), the operations the model
reached for (`api_log().operations()`), the value the program logged
(`logged_json`), and the view, ending or hand-over the outcome carries. A refusal
is caught in the program and logged as
`{ operation, code }` off `gg.core.ApiError`, the way `sandbox.test.rs:1041`
does. A refusal raised host-side carries the operation's own segment
(`evict_file_view`, `open_text`); a refusal raised by the SDK before the crossing
carries the SDK function's name (`openDocsView`, `spawnSubagent`).

### The double's new knobs

Three cases need state the double does not model. Add to `FakeOperationApi`:
`refusing(operation, failure, message)`, which makes one operation answer with
that failure — the only way to reach a `docs`, `views` or `programs` refusal that
the production api raises; and `keeping(n)`, which builds its `ProgramLibrary`
(`fake.test.rs:264`) with a retention of `n` rather than `None`, so a seeded
program can be dropped. `run_with_library` gains a sibling that takes the built
double.

### context

| Test | What it drives |
| --- | --- |
| `a_file_view_is_evicted_by_its_path` | `evictFileView("src/a.ts")`; the recorded path, and the `ReclaimReport` read back |
| `evicting_every_file_view_sends_no_path` | `evictFileView()`; the recorded path is null |
| `an_empty_path_is_refused_on_an_eviction` | `invalid-argument` |
| `two_spans_are_archived_as_pairs` | `archiveThread([{from,to},{from,to}])`; each record lowers onto a two-element array |
| `an_empty_span_list_is_refused` | `invalid-argument` |
| `more_than_thirty_two_spans_are_refused` | `invalid-argument`, from `MAX_ARCHIVE_RANGES` |
| `a_span_that_ends_before_it_starts_is_refused` | `invalid-argument`, naming the range |
| `an_archive_search_hands_a_program_its_hits` | `searchArchive("the parser")`; `archiveEmpty`, and a hit's role and sequence number |
| `an_archive_search_that_matches_nothing_is_an_empty_hit_list` | an empty list over an archive that is not empty |
| `an_empty_archive_is_not_a_search_that_missed` | `archiveEmpty` is true and the hits are empty |
| `an_empty_archive_query_is_refused` | `invalid-argument` |
| `a_blank_compaction_summary_is_refused` | `invalid-argument` |

`compact`'s successful call is already driven at `sandbox.test.rs:309`.

### delegation

| Test | What it drives |
| --- | --- |
| `a_child_is_spawned_on_a_prompt` | `spawnSubagent({agent, prompt})`; the recorded brief, and the handle's id, agent and model |
| `a_child_is_spawned_on_a_board_issue` | the `issueId` form; the recorded brief carries the issue and no prompt |
| `a_brief_carrying_both_a_prompt_and_an_issue_is_lowered_as_a_prompt` | cast through `any`; `brief` (`delegation.ts:105`) takes the prompt |
| `a_brief_that_is_neither_a_prompt_nor_an_issue_is_refused` | the SDK's own `invalid-argument`, before the crossing |
| `an_agent_this_session_may_not_spawn_is_refused` | `invalid-argument` |
| `the_delegation_depth_cap_refuses_a_spawn` | `limit-exceeded` |
| `named_children_are_waited_for_in_dispatch_order` | `waitForSubagents([a, b])`; the recorded ids, and each result's status and summary |
| `waiting_for_every_child_sends_no_ids` | `waitForSubagents()`; the recorded ids are null |
| `every_agent_ending_reaches_the_program_in_ggs_spelling` | each `AgentEnding` value, proving `ending` (`delegation.ts:131`) translates the membrane's hyphens |
| `a_child_with_no_ending_reports_no_status` | the status is undefined and the program branches on it |
| `waiting_on_an_unknown_child_is_not_found` | `not-found` |
| `an_unknown_agent_id_is_not_found_on_a_message` | `not-found` |
| `messaging_a_child_that_has_returned_is_a_conflict` | `conflict` |
| `a_state_transition_is_declared_and_the_program_runs_on` | `transitionState("review", note)`; the recorded state and note, and a line logged afterwards |
| `a_state_this_session_may_not_move_to_is_refused` | `invalid-argument` |
| `a_second_state_declaration_in_one_turn_is_refused` | `refused`; the first declaration is the recorded one |
| `an_agent_outside_a_machine_cannot_transition` | `unavailable` — the only `Binding::Machine` row (`operations.rs:214`), reached with `run_with` granting every operation but that one |
| `an_exec_returns_and_the_program_runs_to_its_end` | `exec("reviewer")` then a logged line; the succession is recorded and the program did not stop |
| `an_agent_this_session_may_not_become_is_refused` | `invalid-argument` |
| `a_second_succession_in_one_turn_is_refused` | `refused` from an `exec` after a `transitionState`, sharing one slot |
| `a_fork_hands_back_a_handle_the_same_program_cannot_wait_on` | `fork(prompt)`; the id is real, and a `waitForSubagents` naming it is `not-found` |
| `the_delegation_depth_cap_refuses_a_fork` | `limit-exceeded` |

`sendMessage`'s successful call is already driven at `sandbox.test.rs:310`.

### docs

| Test | What it drives |
| --- | --- |
| `a_search_with_neither_a_query_nor_a_filter_is_refused` | `invalid-argument` |
| `an_unrecognised_doc_kind_is_refused` | `invalid-argument` |
| `a_search_limit_of_zero_is_refused` | `invalid-argument` |
| `a_search_answers_an_agent_granted_nothing` | `run_as` with no operations; `docs.search` is `Binding::Always` (`operations.rs:710`) and returns a page |
| `a_search_files_its_results_under_ggs_own_selector` | the view opened is `SEARCH_RESULTS_VIEW`, not a selector the program chose |
| `a_documentation_view_is_closed_by_its_key` | `docs.close(key)`; the count returned, and `views_closed` |
| `closing_a_key_nothing_is_open_under_returns_zero` | zero rather than a failure |
| `every_documentation_view_is_closed_at_once` | `docs.closeAll()`; the count, over two open views |
| `closing_every_documentation_view_with_none_open_returns_zero` | zero rather than a failure |
| `a_docs_close_is_refused_without_the_capability` | `unavailable`, `run_with` omitting `docview-close` |
| `a_docs_close_all_is_refused_without_the_capability` | `unavailable`, separately from the above |
| `docs_close_and_views_close_are_separate_operations` | one `docs.close` and one `views.close` in one program; `api_log().operations()` reads `docs.close` then `views.close`, which no arm that crossed the two would produce |

`docs.search`'s successful call is already driven at `agent.sandbox.test.rs:1400`.
The last row is the one guard against the name collision the catalogue gates
cannot see, since both are spelled `close`.

### views

| Test | What it drives |
| --- | --- |
| `a_window_over_the_text_cap_is_refused` | `openFile` of a file whose text is over the cap; `limit-exceeded`, the message naming the size and the bound, and no view opened |
| `a_max_line_chars_of_zero_is_refused` | `invalid-argument` |
| `a_max_line_chars_over_the_bound_is_refused` | `invalid-argument`, at 65,537 |
| `re_opening_a_file_view_supersedes_it` | two `openFile`s of one path; the second `SandboxViewOpened` is superseded and there is one view |
| `a_spent_wall_clock_budget_refuses_the_read_but_not_the_report` | `run_with` under a spent budget |
| `a_text_body_over_the_cap_is_refused` | `limit-exceeded`, the message naming the cap |
| `a_text_label_over_the_cap_is_refused` | `limit-exceeded`, a cap distinct from the body's |
| `an_unknown_documentation_name_is_not_found` | `openDocsView("gg.views.noSuchThing")` |
| `a_documentation_name_this_agent_does_not_bind_is_not_found` | a real catalogue name outside this agent's scope — a cause distinct from the above, and the one the `documenting` builder is for |
| `an_empty_view_selector_is_refused` | `views.close("")`; `invalid-argument` |

The four successful calls and the two capability refusals are already driven at
`sandbox.test.rs:1001`-`:1154`, and the argument-shape guard at
`sandbox.faults.test.rs:330`.

### programs

| Test | What it drives |
| --- | --- |
| `an_empty_history_is_an_empty_list` | `history()` before the first program; a list, not a failure |
| `a_dropped_programs_id_is_not_found` | `keeping(2)` with three seeded programs; `get` of the dropped id is `not-found`, a cause distinct from an id never issued |
| `the_library_capability_is_checked_before_the_id` | `get("")` without the library; `unavailable`, not `invalid-argument` |
| `a_blank_rerun_source_is_refused` | `invalid-argument`; nothing is compiled |
| `a_second_hand_over_from_one_program_is_refused` | `refused`; the first source is the one the outcome carries |
| `a_rerun_refused_over_its_argument_is_not_on_the_refusal_roster` | `outcome.refusals` is empty, unlike a gate refusal |
| `a_rerun_is_unavailable_without_the_library` | `unavailable` |

`history`, `get`, `get`'s never-issued `not-found`, `rerun` and its
revoke-on-failure are already driven at `sandbox.test.rs:1156`-`:1232`.

### session

| Test | What it drives |
| --- | --- |
| `a_blank_summary_finishes_nothing` | `finish("  ")`; `invalid-argument`, and `completion` is none |
| `a_later_finish_replaces_the_summary` | two `finish` calls; the second summary stands and the replacement is counted |
| `a_program_that_finishes_and_then_throws_loses_the_ending` | `completion` is none and `revoked_completion` carries the summary |
| `finishing_is_allowed_after_the_budget_is_spent` | `run_with` under a spent budget; the ending stands |
| `a_reviewer_approves_and_the_run_ends` | `run_as(Review)`; the `Approved` ending |
| `a_withheld_ending_lands_on_the_refusal_roster` | `approve` from a standard role; `outcome.refusals` names it |
| `a_rejection_with_no_changes_is_refused` | `requestChanges([])`; `invalid-argument` |
| `a_rejection_whose_every_entry_is_blank_is_refused` | `requestChanges(["", "  "])`; a cause distinct from the empty list, per `gg-sandbox.wit:693` and `crates/gg/src/ending.rs:183` |
| `a_rejection_lists_its_changes_verbatim` | `requestChanges(["a", "b"])`; the ending carries both |

`finish`'s successful call is at `sandbox.test.rs:684`, and the ending-role gate
across all three at `:859`.

### feedback

| Test | What it drives |
| --- | --- |
| `logging_past_the_line_cap_keeps_the_last_lines_and_counts_the_rest` | a program logging past `MAX_LOG_LINES` (`capture.rs:39`); `logs` holds the tail and `logs_suppressed` holds the count |
| `a_line_over_the_byte_cap_is_cut_on_a_character_boundary` | one line over `MAX_LOG_LINE_BYTES` (`capture.rs:47`) |
| `a_broken_module_is_named_in_the_turns_feedback` | `run_with_modules` with a module that throws while loading; `outcome.module_errors` carries the binding key and the message |

`log` itself is driven at `sandbox.test.rs:258`. `note-return` is unreachable from a
TypeScript program, because `tsc` refuses a top-level `return`, which
`sandbox.test.rs:823` asserts for five spellings of one. `report-deferred` is likewise
unreachable: this guest drains the job queue before the turn closes, so a deferred
call is part of the program and `deferred_note` stays none, which
`sandbox.test.rs:466`-`:476` asserts. `report-error` is driven in all five of its
shapes by the G8 gate at
`crates/gg/src/sandbox/language/typescript.substrate.test.rs:18`.

## Done when

- [ ] `crates/gg/src/sandbox.surface.test.rs` exists, is declared beside the
      submodules at `crates/gg/src/sandbox.test.rs:26`, and holds one short
      function per case above.
- [ ] `FakeOperationApi` carries `refusing` and `keeping`, each documented with
      what it models and what it leaves to the production api.
- [ ] Every operation in `context`, `delegation`, `programs`, `docs`, `views` and
      `session` has a TypeScript program-level test of its successful call and one
      per documented failure mode, counting the tests cited above as existing.
- [ ] The consolidation note at `crates/gg/src/sandbox.test.rs:3` is revised to
      scope it to the functions it describes.
- [ ] No test in the new submodule reaches a model or a provider.
- [ ] Gates green.
