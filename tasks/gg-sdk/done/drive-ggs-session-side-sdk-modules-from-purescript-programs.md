# Drive gg's session-side SDK modules from PureScript programs

Give the PureScript arm a short, focused test for every `context`, `delegation`, `programs`, `docs`,
`views` and `session` call its SDK offers, for the feedback channel the guest reports a program's
own output and failures over, and for every distinct runtime failure each one documents — each
driven by a PureScript program the model could have written and answered by a synthesized outcome.

## Current state

The operation vocabulary these modules cover is `crates/gg/src/sandbox/operations.rs:192` through
`:272`, and the arm spells each one in `packages/gg-sandbox-purescript/src/Gg/` — `Context.purs:4`,
`Delegation.purs:7`, `Programs.purs:10`, `Docs.purs:8`, `Views.purs:4` and `Session.purs:8`. Each
function's `# Throws` section is the list of runtime failures it documents, and the catalogue the
model reads is reflected out of those same declarations. Every call lands in the TypeScript SDK's
lowering, so the guest-side argument guards are shared
(`packages/gg-sandbox-purescript/src/Gg/Internal/Wire.purs:10`).

The feedback interface is `crates/gg/wit/gg-sandbox.wit:1060` — `log` at `:1099`, `note-return` at
`:1108`, `report-deferred` at `:1116`, `report-error` at `:1131` and `report-module-error` at
`:1139`. It is not model-facing: a program reaches `log` through `Effect.Class.Console`, `report-error`
by failing, and the other three through the shapes gg's entry and its module loading produce. The
host side of each is `SandboxOutcome`'s `logs` (`crates/gg/src/sandbox/outcome.rs:74`),
`returned_value` (`:109`), `deferred_note` (`:96`), `result.error` (`:276`) and `module_errors`
(`:102`).

The arguments these calls carry are already pinned from a real program. The crossing table at
`crates/gg/src/sandbox/language/purescript.substrate.test.rs:881` runs one compiled PureScript
program through the real membrane and asserts the exact JSON that reached dispatch — the four
`context` rows at `:1049` through `:1066` and the six `delegation` rows at `:1071` through `:1098` —
and is exhaustive by construction (`:1178`). What it does not do is read a returned value back or
drive a failure.

These cases are therefore already held, and the work below leaves them alone:

- `Gg.Views.openFile`, `openText`, `openDocsView` and `close`, driven together with the view roster
  and the read that crossed under `read_file` — `purescript.substrate.test.rs:1299` through `:1350`.
  Closing a selector nothing is open under counts `0` rather than failing (`:1321`).
- `Gg.Programs.history` over an empty library, `Gg.Programs.get` answered `NotFound` and caught
  through `Gg.Core.attempt`, and `Gg.Programs.rerun` recording the hand-over — `:1358` through
  `:1379`.
- `Gg.Session.requestChanges` carrying both items (`:1361`, `:1383`), `Gg.Session.approve` (`:1391`,
  `:1409`) and `Gg.Session.finish` carrying its summary (`:1306`, `:1339`).
- `Gg.Docs.search` with the whole options record, `Gg.Docs.close` and `Gg.Docs.closeAll` against
  nothing open, each answering `0` — `:1431` through `:1461` — and `Gg.Docs.closeAll` refused
  `Unavailable` under a run that withheld the capability (`:1478`, `:1492`).
- `Gg.Delegation.send` and `Gg.Programs.sourceOf` reaching the operation each is an alias of, keyed
  on the field its subject carries — `:1219`, `:1225`, `:1250`. `sourceOf` lowers onto
  `Gg.Programs.get`, so the `NotFound` case below is the one both share.
- `feedback.report-error`: gate G8's five shapes, including an uncaught `readFile` answered
  `not-found` — `:1678`; and a failed call locating the model's own line — `:497` and `:548`.

### Harness

Everything below reuses what the arm already runs on, in
`crates/gg/src/sandbox/language/purescript.substrate.test.rs`. `prepare` at `:62` is the production
prepare step; `evaluate` at `:80` drives an already-compiled bundle through
`run_prepared_program`; `evaluate_js` at `:111` does the same with nothing else configured;
`run_as` at `:128` says the granted operations, the code modules, the ending group and the
responder explicitly; `run_with` at `:147` takes the granted set and a responder; `run` at `:164`
offers no tool at all. `program_of` at `:1111` writes the imports a model writes, `logs` at `:169`
is what a program said, and `trapped` at `:189` is what the model reads when it did not finish.

The double behind them is `crates/gg/src/sandbox/fake.test.rs` — `CallLog` at `:90` records the
exact JSON each call carried, `FakeOperationApi` at `:141` is the `OperationApi` the membrane calls,
and `canned_outcome` at `:780` answers every tool plausibly, with `evict_file_view` and
`archive_thread` carrying a `ReclaimData` (`:862`), `search_archive` a hit from the assistant
(`:889`), `fork` and `spawn_subagent` a handle (`:882`, `:899`) and `wait_for_subagents` one
completed child (`:906`).

A failure case follows the shape at `purescript.substrate.test.rs:497`: a responder that answers one
tool name with `ToolOutcome::failed(ToolFailure::…, "…")` and defers to `canned_outcome` for the
rest. The program catches the failure with `Gg.Core.attempt`
(`packages/gg-sandbox-purescript/src/Gg/Core.purs:93`) and logs `failure.operation`, `failure.code`
and the message, so the assertion reads what the model reads — the idiom at
`purescript.substrate.test.rs:1476`.

The `docs` and `views` families are answered inside the double with no tool behind them
(`crates/gg/src/sandbox/membrane/wire.arguments.test.rs:35`), so a responder cannot reach them: the
double answers every search with an empty page (`fake.test.rs:642`), opens a view for every
documentation name (`:625`) and models only the empty-label and empty-selector refusals (`:722`,
`:733`). This work therefore adds one field to `FakeOperationApi` holding an optional `ViewRefusal`,
armed by a `refusing_views(ToolFailure, &str)` builder beside `documenting` at `fake.test.rs:283`
and consulted first by `search_docs`, `open_docs_view`, `open_text_view`, `open_file_view` and
`close_view`. A test arms it and makes the one call under test, so the refusal it reads is the one
it asked for.

## Design

One new file, `crates/gg/src/sandbox/language/purescript.session.test.rs`, declared as a submodule
of `crates/gg/src/sandbox/language/purescript.rs` beside the `#[path]` declaration at `:646`. Each
case is its own `#[test]`, named as a sentence, driving one program, and every test lives on this
arm alone.

The consolidation note at `purescript.substrate.test.rs:25` is revised as part of this work to read
as guidance to give a case its own function and its own name. The library tree is unpacked once per
machine and hard-linked into each preparation in ~27 ms
(`crates/gg/src/sandbox/language/purescript.compile.rs:44`, `:66`), and a whole program costs
~298 ms end to end (`purescript.compile.rs:47`), which a case can afford.

Every `not-found`, `conflict`, `limit-exceeded`, `invalid-argument`, `refused` and `unavailable`
case asserts the caught failure's `code`, its `operation` spelled as gg's own key, and that the
injected message survives to the program. Each guest-side case additionally asserts the call log is
empty, since a refusal before the crossing is what it claims.

### context

| Test | Program and answer |
| --- | --- |
| `an_eviction_hands_back_what_it_reclaimed` | `Gg.Context.evictFileView { path: "src/a.purs" }`, canned; logs `items`, `reclaimedTokens`, `paths` and `detail` |
| `an_eviction_with_no_path_drops_every_file_view` | `Gg.Context.evictFileView {}`, canned; the log shows `path` crossed as null |
| `an_empty_eviction_path_is_an_argument_error` | `invalid-argument` injected for `evict_file_view` |
| `an_archive_hands_back_what_it_reclaimed_with_no_paths` | `Gg.Context.archiveThread [ { from: 4, to: 19 } ]`, canned; logs the report and that `paths` is empty |
| `an_empty_list_of_spans_is_an_argument_error` | `invalid-argument` injected for `archive_thread` |
| `more_than_thirty_two_spans_is_an_argument_error` | `invalid-argument` injected for `archive_thread`, message naming the bound |
| `a_span_that_ends_before_it_starts_is_an_argument_error` | `invalid-argument` injected for `archive_thread` |
| `a_negative_turn_number_is_refused_before_the_call` | `[ { from: -1, to: 4 } ]`, well-typed as `Int`; the guard at `packages/gg-sandbox/src/internal/errors.ts:209` refuses it naming `ranges[].from` |
| `an_archive_search_reads_its_hits_and_their_roles` | `Gg.Context.searchArchive "the parser"`, canned; logs `archiveEmpty`, `hits[0].seq`, the `MessageRole` arm and the text |
| `an_empty_archive_is_told_apart_from_a_search_that_matched_nothing` | responder answers `search_archive` with `archiveEmpty` true and no hits; the program logs both and does not catch |
| `an_empty_archive_query_is_an_argument_error` | `invalid-argument` injected for `search_archive` |
| `a_compaction_is_registered_and_the_program_runs_on` | `Gg.Context.compact "scaffolded the page" { files: [ "src/Main.purs" ] }`, canned, followed by a second call; both reach dispatch in order |
| `a_blank_compaction_summary_is_an_argument_error` | `invalid-argument` injected for `compact` |

### delegation

| Test | Program and answer |
| --- | --- |
| `a_spawned_child_hands_back_its_handle` | `Gg.Delegation.spawnSubagent "subagent" (Gg.Delegation.Prompt "write the lexer")`, canned; logs `id`, `slot` and `modelId` |
| `a_child_briefed_from_an_issue_crosses_as_an_issue` | the `Gg.Delegation.Issue "EPIC-1"` arm, canned; the log shows `issueId` carrying the id and `prompt` null |
| `an_agent_this_session_may_not_spawn_is_an_argument_error` | `invalid-argument` injected for `spawn_subagent`, message naming the agent |
| `a_spawn_at_the_delegation_depth_cap_is_limit_exceeded` | `limit-exceeded` injected for `spawn_subagent` |
| `a_wait_hands_back_each_childs_ending_and_summary` | `Gg.Delegation.waitForSubagents { ids: [ "agent-1" ] }`, canned; logs `AgentCompleted` and the summary |
| `a_wait_with_no_ids_collects_every_child` | `Gg.Delegation.waitForSubagents {}`, canned; the log shows `ids` crossed as null |
| `a_child_with_no_ending_yet_reads_as_nothing` | responder answers `wait_for_subagents` with a result carrying no status; the program logs the `Maybe` as `Nothing` and does not catch |
| `waiting_on_an_id_that_is_not_there_is_not_found` | `not-found` injected for `wait_for_subagents` |
| `a_message_reaches_a_running_child_and_the_program_runs_on` | `Gg.Delegation.sendMessage "agent-1" "prefer the simpler parser"`, canned, followed by a second call; both reach dispatch |
| `messaging_an_agent_that_is_not_there_is_not_found` | `not-found` injected for `send_message` |
| `messaging_a_child_that_has_returned_is_a_conflict` | `conflict` injected for `send_message` |
| `a_transition_is_registered_and_the_program_runs_on` | `Gg.Delegation.transitionState "verify" { note: "the build is green" }`, canned, followed by a second call |
| `a_state_this_session_may_not_move_to_is_an_argument_error` | `invalid-argument` injected for `transition_state` |
| `a_second_transition_in_one_turn_is_refused` | a counting responder answering `transition_state` first `ok` then `refused`; the program makes both calls and logs the second's code |
| `a_succession_is_registered_and_the_program_runs_on` | `Gg.Delegation.exec "Builder" { prompt: "pick it up from here" }`, canned, followed by a second call |
| `an_agent_this_session_may_not_become_is_an_argument_error` | `invalid-argument` injected for `exec` |
| `a_second_succession_in_one_turn_is_refused` | a counting responder answering `exec` first `ok` then `refused` |
| `a_fork_hands_back_the_copys_handle` | `Gg.Delegation.fork "try the other fix"`, canned; logs the minted `id` |
| `a_fork_at_the_delegation_depth_cap_is_limit_exceeded` | `limit-exceeded` injected for `fork` |

### programs

`Gg.Programs.history` documents no runtime failure: a session that has run nothing gets an empty
array, which is held at `purescript.substrate.test.rs:1378`.

| Test | Program and answer |
| --- | --- |
| `a_history_lists_every_program_already_run` | a double seeded through `with_program` (`fake.test.rs:295`); logs each summary's `id`, `turn`, `chars` and `ok` |
| `a_program_id_the_library_never_issued_is_not_found` | held at `purescript.substrate.test.rs:1359` and `:1378` |
| `a_handover_carries_the_source_the_model_wrote` | `Gg.Programs.rerun` with a whole module; asserts `outcome.rerun` holds those bytes verbatim |
| `a_blank_handover_source_is_an_argument_error` | `Gg.Programs.rerun "   "`; the membrane refuses it at `crates/gg/src/sandbox/membrane/programs.rs:93` |
| `a_second_handover_from_one_program_is_refused` | two `Gg.Programs.rerun` calls; the second is refused at `crates/gg/src/sandbox/membrane/programs.rs:101` and the first source is the one recorded |

### docs

| Test | Program and answer |
| --- | --- |
| `a_search_hands_back_its_page_and_leaves_a_view` | `Gg.Docs.search { query: "read" }`; logs `total`, `offset` and each hit's `key`, `kind`, `module`, `name` and `summary` |
| `a_search_naming_neither_a_query_nor_a_filter_is_an_argument_error` | `Gg.Docs.search {}`; the double armed with an `invalid-argument` `ViewRefusal` |
| `a_search_limit_of_zero_is_an_argument_error` | `Gg.Docs.search { query: "read", limit: 0 }`; the double armed with an `invalid-argument` `ViewRefusal` naming `limit` |
| `closing_a_documentation_view_reports_how_many_went` | the double holding one docs view open; `Gg.Docs.close` logs `1` |
| `closing_documentation_views_without_the_capability_is_unavailable` | `Gg.Docs.close "Gg.Files.readFile"` under `all_operations_without(CAPABILITY_DOCVIEW_CLOSE)`, mirroring `closeAll` at `purescript.substrate.test.rs:1476` |
| `closing_every_documentation_view_reports_how_many_went` | two docs views open; `Gg.Docs.closeAll` logs `2` |

### views

| Test | Program and answer |
| --- | --- |
| `a_file_view_hands_back_the_text_variant_and_opens_a_view` | `Gg.Views.openFile "notes.md" {}`, canned; logs the `TextFile` fields and asserts the view's selector |
| `a_file_view_of_an_image_hands_back_the_image_variant` | `Gg.Views.openFile "logo.png" {}`, canned (`fake.test.rs:946`); logs the `ImageFile` label and byte count |
| `a_file_view_of_a_path_that_is_not_there_is_not_found` | `not-found` injected for `read_file`, and no view is opened |
| `a_file_view_over_the_byte_cap_is_limit_exceeded` | the double armed with a `limit-exceeded` `ViewRefusal` naming the size and the bound; no view is opened |
| `a_max_line_chars_of_zero_is_an_argument_error` | the double armed with an `invalid-argument` `ViewRefusal` naming `maxLineChars` |
| `a_max_line_chars_outside_the_range_is_refused_before_the_call` | `{ maxLineChars: -1 }`, well-typed as `Int`; the guard at `packages/gg-sandbox/src/internal/errors.ts:209` refuses it and the call log is empty |
| `a_text_view_opens_under_the_label_it_was_given` | `Gg.Views.openText "summary" "eight files, two failing"`; asserts the view's selector and kind |
| `an_empty_text_view_label_is_an_argument_error` | `Gg.Views.openText "" "body"`; the double refuses it at `fake.test.rs:722` |
| `a_text_view_body_over_the_cap_is_limit_exceeded` | the double armed with a `limit-exceeded` `ViewRefusal` naming the cap; nothing is opened |
| `a_text_view_label_over_the_cap_is_limit_exceeded` | the double armed with a `limit-exceeded` `ViewRefusal` naming the label cap; a separate cause from the body above |
| `a_documentation_view_opens_under_the_name_it_was_asked_for` | `Gg.Views.openDocsView "readFile"`; asserts the docs view's selector |
| `a_documentation_name_gg_does_not_hold_is_not_found` | the double armed with a `not-found` `ViewRefusal` |
| `closing_a_view_reports_how_many_went` | held at `purescript.substrate.test.rs:1302` and `:1321`, together with the count of `0` for a selector nothing is open under |
| `an_empty_view_selector_is_an_argument_error` | `Gg.Views.close ""`; the double refuses it at `fake.test.rs:733` |
| `closing_a_view_without_agent_managed_context_is_unavailable` | `Gg.Views.close "summary"` under a run granting neither that capability nor its operations |

### session

`Gg.Session.finish` and `Gg.Session.approve` document no runtime failure of their own beyond the
role they are dispatched under, so each has one success case and one refusal.

| Test | Program and answer |
| --- | --- |
| `a_finished_session_carries_the_summary_the_model_wrote` | held at `purescript.substrate.test.rs:1306` and `:1339` |
| `finishing_under_a_review_role_is_unavailable` | `Gg.Session.finish` with `RunEnding::Role(EndingRole::Review)`; the program catches the refusal and logs its operation and code |
| `an_approval_ends_the_session_with_no_items` | held at `purescript.substrate.test.rs:1391` and `:1409` |
| `approving_under_a_standard_role_is_unavailable` | `Gg.Session.approve` with `RunEnding::Role(EndingRole::Standard)` |
| `a_change_request_carries_every_item` | held at `purescript.substrate.test.rs:1361` and `:1383` |
| `an_empty_change_request_is_an_argument_error` | `Gg.Session.requestChanges []` under the review role; the program catches the refusal and the run has no completion |
| `requesting_changes_under_a_standard_role_is_unavailable` | `Gg.Session.requestChanges [ "widen the test" ]` with `RunEnding::Role(EndingRole::Standard)` |

### feedback

`feedback.log` is what `Effect.Class.Console` writes to on this arm, and every case above reads a
program through it; the multi-line assertion at `purescript.substrate.test.rs:1250` is the standing
one. The cases below cover the line cap and the rest of the interface, each decided by what this
arm can reach.

| Test | Program and answer |
| --- | --- |
| `a_program_that_logs_past_the_line_cap_keeps_the_earlier_lines` | a loop logging past the 200-line cap at `crates/gg/src/sandbox/membrane/capture.rs:39`; asserts the kept lines are the earlier ones and `outcome.logs_suppressed` counts the rest |
| `a_main_that_returns_a_value_has_it_discarded_without_a_note` | `main :: Effect (Either String Int)` ending in `pure (Left "…")`; the entry gg synthesizes discards it (`crates/gg/src/sandbox/language/g8.rs:285`), so `outcome.returned_value` is false and the model is told nothing extra |
| `work_this_guest_defers_runs_inside_the_turn` | the shipped library set carries no `Effect.Aff` and no promise binding, so the deferral is a microtask appended to a compiled bundle and driven through `evaluate_js` at `purescript.substrate.test.rs:111`; the deferred call reaches dispatch and `outcome.deferred_note` is `None`, as on the shared guest at `crates/gg/src/sandbox.test.rs:475` |
| `a_module_that_fails_when_it_is_forced_is_the_programs_own_failure` | a code module exporting a value that raises when forced, imported and used; the reported failure names `Lib.Helpers.purs` and `outcome.module_errors` is empty, because a code module on this arm is compiled into the program's own project (`purescript.substrate.test.rs:589`) rather than evaluated separately as `lib.<name>` |

## Done when

- [ ] `crates/gg/src/sandbox/language/purescript.session.test.rs` exists, is declared as a submodule of `crates/gg/src/sandbox/language/purescript.rs`, and holds the cases above as one test each.
- [ ] Every `context`, `delegation`, `programs`, `docs`, `views` and `session` call in `packages/gg-sandbox-purescript/src/Gg/` has a PureScript program that succeeds and reads the post-call state back.
- [ ] Every failure each of those calls documents in its `# Throws` section has its own PureScript program that catches the failure and asserts its `code`, its `operation` and its message.
- [ ] `feedback.log`, `note-return`, `report-deferred` and `report-module-error` each have a PureScript case asserting the field of `SandboxOutcome` that carries them.
- [ ] `FakeOperationApi` carries an armed `ViewRefusal` consulted by its docs and view methods, and the tests that need one use it.
- [ ] Every answer comes from `FakeOperationApi`, and no test reaches a real model or provider.
- [ ] The consolidation note at `crates/gg/src/sandbox/language/purescript.substrate.test.rs:25` reads as guidance to give a case its own function and its own name.
- [ ] Gates green.
