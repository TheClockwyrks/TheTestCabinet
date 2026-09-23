# Drive gg's session-side SDK modules from C++ programs

Drive every `context`, `delegation`, `programs`, `docs`, `views` and `session` operation, and the
feedback channel behind `gg::log`, from a real C++ program: one test for the successful call that
reads the post-call state back, and one test for each distinct runtime failure mode the arm's own
headers name.

## Current state

The operation vocabulary these modules draw from is `crates/gg/src/sandbox/operations.rs:192`
through `:272`, `CONTEXT_EVICT_FILE_VIEW` through `SESSION_REQUEST_CHANGES`. The C++ spellings live
in `packages/gg-sandbox-cpp/Sources/sdk/gg/` — `context.hpp:90`, `:103`, `:112` and `:131`;
`delegation.hpp:67`, `:110`, `:120`, `:131`, `:141`, `:156`, `:172` and `:188`; `programs.hpp:46`,
`:58`, `:72` and `:87`; `docs.hpp:113`, `:127` and `:139`; `views.hpp:64`, `:76`, `:92` and `:109`;
and `session.hpp:33`, `:42` and `:55`. Each function's `\throws` line states the failure modes the
cases below assert.

The context and delegation halves are gg tools, so their argument lowering is already pinned from
this arm's spelling by the crossing table at `crates/gg/src/sandbox/language/cpp.surface.test.rs:329`
through `:383`, driven at `:390`. That table proves what gg's dispatch saw; it reads no value back
and injects no failure. The other four modules are answered inside the membrane with no tool behind
them, which is why they are absent from the table and why
`crates/gg/src/sandbox/membrane/wire.arguments.test.rs:74-77` records them as the argument gate's
own blind spot.

Ground already held from C++ programs sits in two functions. `cpp.surface.test.rs:436` opens a file
view, a text view and a documentation view, closes a text view and a selector that is not open
(`:443-448`, asserted `"1 0"` at `:477`), reads the opened file's first line (`:452`), searches the
documentation and reads the page back (`:453-455`, asserted `"0 0 0"` at `:483`), reads the withheld
documentation closes as `unavailable` (`:457-465`, asserted at `:487-488`), records every selector
opened (`:491-499`), and ends with `gg::session::finish` (`:466`); the granted documentation closes
are a second program asserting `["0 0"]` at `:520`, and the view's own `read_file` dispatch is
asserted at `:525-530`. `cpp.surface.test.rs:533` reads an empty `programs::history` and a
`not_found` from `programs::get` (`:540-544`, asserted `["0", "not-found"]` at `:556`), registers a
`programs::rerun` (`:546`, asserted at `:557`), ends with `session::request_changes` (`:547`,
asserted at `:558-566`), and ends a second program with `session::approve` (`:571`).

The harness is the arm's own. `super::substrate::prepare` (`cpp.substrate.test.rs:72`) compiles a
whole program through the production prepare step, `evaluate` (`:97`) runs the component against the
real membrane with the scope stated, `evaluate_closing_docviews` (`:112`) is the grant the
documentation closes need, `evaluate_granting` (`:126`) is what both are, and `logs` (`:192`) and
`program_error` (`:396`) read what the model would read. The surface file adds `program` (`:87`),
`program_with` (`:93`) for a body reaching past the four shared headers, and `run_with` (`:102`),
which is the entry point most cases below use; `super::compile::warm` (`cpp.compile.rs:493`) is the
warm-up the compile-heavy functions already call. The operation side is
`crates/gg/src/sandbox/fake.test.rs`: `FakeOperationApi` (`:141`) with `new` (`:250`), `with`
(`:256`), `documenting` (`:283`) and `with_program` (`:295`); `CallLog` (`:90`) with its `names` and
`args` readers (`:102`, `:117`); the `canned_outcome` responder (`:780`); and `all_capabilities`
(`:1136`), `all_operations` (`:1151`) and `all_operations_without` (`:1185`) for the grant. A
failure on a tool-backed call is injected by passing a responder returning
`ToolOutcome::failed(crate::tools::ToolFailure::<Variant>, message)`, the way
`cpp.surface.test.rs:609` already does.

`canned_outcome` already answers the successful shapes these cases need: `evict_file_view` and
`archive_thread` with a reclaim record (`fake.test.rs:862`), `search_archive` with one hit (`:889`),
`compact` (`:871`), `spawn_subagent` (`:899`), `wait_for_subagents` (`:906`), `send_message`
(`:915`), `transition_state` (`:875`), `exec` (`:878`), `fork` (`:882`), and a picture for a `.png`
path (`:944-946`).

## Design

Every case is its own `#[test]` in `crates/gg/src/sandbox/language/cpp.surface.test.rs`, holding one
short program. The module comment at `cpp.surface.test.rs:13-18` and its counterpart at
`cpp.substrate.test.rs:44-49`, which ask for a statement added to an existing function, are revised
as part of this work to ask for a function per case and to quote the measured cost the arm's own
table records: `clang++` is ~90 ms plus the parse of what the program included, and
`Component::new` ~25 ms, for a program that includes little
(`crates/gg/src/sandbox/language/cpp.compile.rs:111-114`), and `cargo nextest` pays the per-process
cost in parallel. A body naming a header outside `program`'s four writes its own list through
`program_with`.

A success case grants `all_operations()`, answers with `canned_outcome`, and asserts the value the
program read back through `gg::log`. A failure case on a tool-backed call answers with a responder
returning the named `ToolFailure`, catches `gg::core::api_error` in the program, and logs
`gg::core::gg_name(failure.code())` and `failure.operation()` so the assertion is on what the model
reads. A failure on a membrane-answered call pulls one of two levers instead: the argument the
program passes, or the scope the evaluation grants. Where the refusal comes from the scope, the case
also asserts `log.names()` holds nothing the call should not have reached.

Two harness additions carry the cases that need a seeded double. `evaluate_granting` grows a sibling
that takes a `FakeOperationApi` rather than building one, so a case can hand it
`FakeOperationApi::new(&log).with_program(...)` for the program library and
`FakeOperationApi::new(&log).documenting(...)` for the documentation catalogue. Both are exported
from `cpp.substrate.test.rs` beside `evaluate`.

### context

Each of these four is a gg tool, so both halves are driven through a responder.

- `a_file_view_eviction_hands_a_cpp_program_what_it_freed` — `gg::context::evict_file_view("src/a.cpp")`
  logs `items`, `reclaimed_tokens`, `paths.size()` and `detail` off the returned `reclaim_report`.
- `an_omitted_eviction_path_drops_every_file_view_from_cpp` — `gg::context::evict_file_view()` reaches
  dispatch with no `path` key at all, which is how every file view is dropped
  (`packages/gg-sandbox-cpp/Sources/sdk/gg/context.hpp:88-89`).
- `an_empty_eviction_path_is_an_argument_error_in_cpp` — `invalid_argument`.
- `an_archive_hands_a_cpp_program_what_it_freed` — `gg::context::archive_thread({{4, 19}})` logs the
  returned `reclaim_report`, with `paths` empty as the header promises.
- `a_span_that_is_not_turn_numbers_is_an_argument_error_in_cpp` — `invalid_argument`.
- `an_archive_search_hands_a_cpp_program_its_hits` — `gg::context::search_archive("the parser")` logs
  `archive_empty`, `hits[0].seq`, `hits[0].role` and `hits[0].text`.
- `an_archive_with_nothing_in_it_is_not_a_failure_in_cpp` — a responder answering with
  `archive_empty` set and no hits, so the program logs the flag rather than catching anything.
- `an_empty_archive_query_is_an_argument_error_in_cpp` — `invalid_argument`.
- `a_compaction_is_registered_and_a_cpp_program_runs_on` — `gg::context::compact("scaffolded the page",
  {"src/main.cpp"})` logs a line after the call, and the case asserts the request reached dispatch
  with both arguments.
- `a_blank_compaction_summary_is_an_argument_error_in_cpp` — `invalid_argument`.

### delegation

- `a_spawn_hands_a_cpp_program_its_childs_handle` — `gg::delegation::spawn_subagent("subagent",
  gg::delegation::brief::prompt("write the lexer"))` logs `id`, `slot` and `model_id` off the
  returned `subagent_handle`.
- `a_brief_naming_an_issue_spawns_from_the_board_in_cpp` — the same call with
  `gg::delegation::brief::issue("i1")`, asserting the call arrived carrying `issueId` and no prompt.
- `a_spawn_at_the_delegation_depth_cap_is_limit_exceeded_in_cpp` — `LimitExceeded`.
- `a_spawn_of_an_agent_this_run_forbids_is_an_argument_error_in_cpp` — `InvalidArgument`.
- `waiting_for_every_child_hands_a_cpp_program_their_results` — `gg::delegation::wait_for_subagents()`,
  the no-argument overload, logs `id`, `status` and `summary` off the first `subagent_result`.
- `waiting_for_named_children_hands_a_cpp_program_their_results` — the overload taking
  `{"agent-1"}` logs the same three fields and the case asserts the ids reached dispatch.
- `waiting_on_a_child_that_is_not_there_is_not_found_in_cpp` — `NotFound`.
- `a_child_that_returned_nothing_is_an_empty_status_in_cpp` — a responder answering with a result
  whose status is absent, so the program branches on the empty `std::optional` rather than catching.
- `a_message_reaches_a_running_child_from_cpp` — `gg::delegation::send_message("agent-1", "prefer the
  simpler parser")` returns nothing, so the case asserts the call reached dispatch with both
  arguments and the line after it logged.
- `messaging_a_child_that_is_not_there_is_not_found_in_cpp` — `NotFound`.
- `messaging_a_child_that_already_returned_is_a_conflict_in_cpp` — `Conflict`.
- `a_handles_own_send_reaches_the_same_child_from_cpp` — `handle.send("...")` on the value a spawn
  returned arrives under `send_message`, which is what the alias at `delegation.hpp:64-67` claims.
- `a_handles_send_to_a_child_that_returned_is_a_conflict_in_cpp` — `Conflict` through the member.
- `a_state_transition_is_registered_and_a_cpp_program_runs_on` — `gg::delegation::transition_state("verify",
  "the build is green")` logs a line after the call, and the case asserts the outcome records the
  move.
- `an_omitted_transition_note_tells_the_next_state_nothing_in_cpp` — the same call with the note left
  out reaches dispatch with no `note` key.
- `a_state_this_session_may_not_move_to_is_an_argument_error_in_cpp` — `InvalidArgument`.
- `a_second_transition_in_one_turn_is_refused_in_cpp` — `Refused`.
- `a_succession_is_registered_and_a_cpp_program_runs_on` — `gg::delegation::exec("Builder", "pick it up
  from here")` logs a line after the call, and the case asserts the outcome records the succession.
- `an_omitted_succession_prompt_tells_the_next_agent_nothing_in_cpp` — the same call with the prompt
  left out reaches dispatch with no `prompt` key.
- `an_agent_this_session_may_not_become_is_an_argument_error_in_cpp` — `InvalidArgument`.
- `a_second_succession_in_one_turn_is_refused_in_cpp` — `Refused`.
- `a_fork_hands_a_cpp_program_the_copys_handle` — `gg::delegation::fork("try the other fix")` logs the
  returned handle's `id`.
- `a_fork_at_the_delegation_depth_cap_is_limit_exceeded_in_cpp` — `LimitExceeded`.

### programs

The empty history, `get`'s `not_found` and the registered hand-over are held at
`cpp.surface.test.rs:540-550`.

- `a_history_hands_a_cpp_program_every_programs_shape` — an evaluation whose double was seeded with
  `with_program` logs `id`, `turn`, `lines`, `chars`, `ok` and the `error` option off the first
  `program_summary`.
- `a_session_that_keeps_no_library_is_unavailable_in_cpp` — an evaluation granting no program library
  makes `gg::programs::history()` throw `unavailable`.
- `a_fetch_hands_a_cpp_program_the_source_that_ran` — `gg::programs::get("k3p9")` against the seeded
  double logs the program's exact source back.
- `a_summarys_own_source_call_fetches_the_same_program_in_cpp` — `history()[0].source()` against the
  same seed logs that source, which is what the alias at `programs.hpp:41-46` claims.
- `a_summarys_source_call_for_a_dropped_program_is_not_found_in_cpp` — `NotFound` through the member.
- `a_second_hand_over_from_one_cpp_program_is_refused` — two `gg::programs::rerun` calls; the first
  stands and the second throws `refused`, with the outcome still holding the first source.
- `a_blank_hand_over_source_is_an_argument_error_in_cpp` — `invalid_argument`.

### docs

The empty page a search hands back is held at `cpp.surface.test.rs:453-455` and asserted at `:483`;
the granted `close` and `close_all` are held at `:512-520`, and both refused as `unavailable` at
`:457-465` and `:487-488`.

- `a_documentation_search_hands_a_cpp_program_its_hits` — an evaluation whose double was seeded with
  `documenting` logs `total`, `offset` and, off the first `doc_hit`, `key`, `kind`, `module`, `name`
  and `summary`.
- `a_search_naming_nothing_at_all_is_an_argument_error_in_cpp` — `gg::docs::search({})` throws
  `invalid_argument`, as `docs.hpp:111-112` states.
- `a_search_limit_of_zero_is_an_argument_error_in_cpp` — `invalid_argument`.

### views

The text open, the text read-back, the documentation open, a close that closed one and a close that
closed nothing are held at `cpp.surface.test.rs:443-448` and asserted at `:477` and `:491-499`.

- `an_image_view_reaches_a_cpp_program_as_the_image_variant` — `gg::views::open_file("logo.png")`
  branches to `gg::files::image_file` and logs `label`, `bytes` and `shown`.
- `opening_a_view_on_a_file_that_is_not_there_is_not_found_in_cpp` — `NotFound` injected on the
  `read_file` the view dispatches, which `cpp.surface.test.rs:525-530` shows is the call it makes.
- `an_offset_past_the_end_of_a_file_is_an_argument_error_in_cpp` — `invalid_argument`.
- `a_line_cut_outside_its_range_is_an_argument_error_in_cpp` — `{.max_line_chars = 0}`, refused for
  being outside `1..=65536` (`views.hpp:60-62`).
- `a_view_body_over_the_window_cap_is_limit_exceeded_in_cpp` — a read answering with more than 65,536
  bytes throws `limit_exceeded` naming the size and the bound, and nothing is opened.
- `an_empty_text_view_label_is_an_argument_error_in_cpp` — `invalid_argument`.
- `a_text_view_over_its_cap_is_limit_exceeded_in_cpp` — a body past gg's cap throws `limit_exceeded`
  naming the cap.
- `opening_documentation_for_a_name_that_is_not_bound_is_not_found_in_cpp` — `not_found` from
  `gg::views::open_docs_view` against a double seeded with `documenting` for other operations.
- `an_empty_view_selector_is_an_argument_error_in_cpp` — `invalid_argument` from `gg::views::close("")`.
- `closing_a_view_without_the_capability_is_unavailable_in_cpp` — an evaluation granting
  `all_operations_without(test_cabinet_core::gg::CAPABILITY_AGENT_MANAGED_CONTEXT)` makes
  `gg::views::close("summary")` throw `unavailable` under its own name.

### session

`finish`'s success is held at `cpp.surface.test.rs:466` and asserted at `:499-507`;
`request_changes`'s and `approve`'s at `:547` and `:571`, asserted at `:558-566` and `:577-587`.

- `finishing_a_session_that_ends_another_way_is_unavailable_in_cpp` — a program calling
  `gg::session::finish` under `RunEnding::Role(EndingRole::Review)` throws `unavailable`.
- `an_empty_finishing_summary_is_an_argument_error_in_cpp` — `invalid_argument`.
- `approving_outside_a_review_is_unavailable_in_cpp` — `gg::session::approve()` under
  `RunEnding::Role(EndingRole::Standard)` throws `unavailable`.
- `requesting_changes_outside_a_review_is_unavailable_in_cpp` — the same scope, through
  `gg::session::request_changes`.
- `an_empty_change_list_is_an_argument_error_in_cpp` — `invalid_argument`.

### feedback

`gg::log` is the only channel a program has for showing gg a value
(`crates/gg/wit/gg-sandbox.wit:1096-1098`), and `report-error` is the only other member of the
interface this arm's shell calls: an uncaught throw at
`packages/gg-sandbox-cpp/Sources/shell.cpp:143-157` and a non-zero entry-point status at `:166-173`. Both
roads are held — the throw at `cpp.surface.test.rs:614-646` and
`cpp.substrate.test.rs:411`, the status at `cpp.substrate.test.rs:1107`.

`note-return` and `report-deferred` stay unreachable here, and that is the contract rather than a
gap: a C++ entry point returns a status, which this arm reports through `report-error` at
`shell.cpp:166-173`, and the deferred channel describes work pushed into a microtask
(`crates/gg/wit/gg-sandbox.wit:1109-1116`), which this arm has no engine to hold. `report-module-error`
is likewise unreachable, because a code module on this arm is an input to the compile that binds it
(`cpp.substrate.test.rs:621`) and a module that does not build is refused at prepare rather than
handed to a program as an empty namespace.

- `what_a_cpp_program_logs_past_the_kept_cap_is_its_tail` — a program logging past
  `MAX_LOG_LINES` (`crates/gg/src/sandbox/membrane/capture.rs:39`) reads back the last lines rather
  than the first, which is what `capture.rs:240-245` promises the model.
- `a_log_line_past_its_own_cap_is_cut_and_marked_in_cpp` — one line past `MAX_LOG_LINE_BYTES`
  (`capture.rs:47`) arrives cut, carrying the truncation marker `capture.rs:355` describes.
- `a_module_that_does_not_build_is_refused_before_a_cpp_program_binds_it` — `compile::compile_module`
  on a source with a type error is a `PrepareError::Compile` naming the module, so no program runs
  with a namespace that is missing its exports.

## Done when

- [ ] Each case above is its own `#[test]` in
      `crates/gg/src/sandbox/language/cpp.surface.test.rs`, driving one short C++ program.
- [ ] Every operation in `context`, `delegation`, `programs`, `docs`, `views` and `session` has a C++
      program that reads its post-call state back, or a cited existing case that already does.
- [ ] Every failure mode the arm's headers name under `\throws` is reached and asserted as the
      `gg::core::api_error` the program catches, under the call's own operation name.
- [ ] The scope-driven refusals assert that the withheld call reached no tool implementation.
- [ ] `cpp.substrate.test.rs` exports an evaluation that takes a prepared `FakeOperationApi`, and the
      program-library and documentation-catalogue cases use it.
- [ ] The feedback cases cover the log caps and the module-build refusal, and the file records that
      `note-return`, `report-deferred` and `report-module-error` are not reachable on this arm.
- [ ] The consolidation comments at `cpp.surface.test.rs:13-18` and `cpp.substrate.test.rs:44-49` ask
      for a function per case and quote the measured build cost.
- [ ] Gates green.
