# Drive gg's workspace SDK modules from C++ programs

Drive every `shell`, `files`, `memories`, `tasks`, `board` and `skills` operation from a real C++
program: one short test for the successful call that reads the post-call state back, and one short
test for each distinct runtime failure mode of that call.

## Current state

The operation vocabulary these modules draw from runs from `crates/gg/src/sandbox/operations.rs:110`
(`SHELL_SHELL`) to `:189` (`BOARD_WAIT_FOR_ISSUE`). The C++ spellings are the declarations in
`packages/gg-sandbox-cpp/Sources/sdk/gg/` — `shell.hpp:58`, `files.hpp:146` onwards, `skills.hpp:38`,
`memories.hpp:92` onwards, `tasks.hpp:99` onwards and `board.hpp:142` onwards — and each
declaration's `\throws` line states the failure classes the tests below assert.

Every one of these operations already has its argument lowering pinned from its C++ spelling by the
crossing table at `crates/gg/src/sandbox/language/cpp.surface.test.rs:145`, driven at `:390`. That
table proves what gg's dispatch saw; it reads no value back and injects no failure.

Some ground is held from C++ programs already. The text variant of a read is reached and its
contents logged at `cpp.surface.test.rs:443` and asserted at `:478`, through `gg::views::open_file`,
whose dispatch arrives as `read_file` (`:525`). `files.read_file`'s `not_found` is caught in a
`catch (const gg::core::api_error&)` at `:596` and asserted at `:612`, and the same failure let out
of `main` is asserted at `:634`. A withheld `files.write_file` is refused as `unavailable` with
nothing reaching dispatch at `:651-673`.

This arm's SDK adds no guard of its own: `packages/gg-sandbox-cpp/Sources/sdk/files.cpp` lowers,
calls and lifts, so every refusal below is the host's and every case injects it through the
responder. The one exception is the shell timeout, which the membrane's `clamp_timeout`
(`crates/gg/src/sandbox/membrane/workspace.rs:266-277`) refuses before dispatch.

The harness is the arm's own. `super::substrate::prepare` (`cpp.substrate.test.rs:72`) compiles a
whole program through the production prepare step, `evaluate` (`:97`) runs the component against the
real membrane, `logs` reads what the model would read and `program_error` (`:396`, in use at
`cpp.surface.test.rs:632`) reads an uncaught failure back. The surface file wraps both in `run_with`
(`cpp.surface.test.rs:102`), which is the entry point every case below uses, and builds the program
text with `program` (`:87`) or, for a body that names other standard headers, `program_with` (`:93`).
The operation side is `crates/gg/src/sandbox/fake.test.rs`: `FakeOperationApi` (`:141`, built with
`with` at `:254`), `CallLog` (`:90`) and its `names` (`:102`) and `args` (`:117`) readers,
`canned_outcome` (`:780`) for a successful call, and `all_operations` (`:1151`) for the grant. A
failure is injected by passing a responder returning
`ToolOutcome::failed(crate::tools::ToolFailure::<Variant>, message)`, exactly as
`cpp.surface.test.rs:607` does.

## Design

Every case is its own `#[test]` in `crates/gg/src/sandbox/language/cpp.surface.test.rs`, holding one
short program. The comment at `cpp.surface.test.rs:13-18`, which asks for a statement added to an
existing function, is revised as part of this work to ask for a function per case and to quote the
measured cost: a small program is ~90 ms of `clang++` plus the parse of what it included, ~2 ms of
encode and ~25 ms of `Component::new` (`crates/gg/src/sandbox/language/cpp.compile.rs:111-114`), the
toolchain is unpacked once by `compile::warm` (`cpp.compile.rs:493`), and `cargo nextest` pays the
per-process cost in parallel. A case whose body names fewer standard headers than `program`'s four
uses `program_with` to keep that parse small.

A success case grants `all_operations()`, answers with `canned_outcome`, and asserts through
`gg::log` the value the program read back. A failure case answers with a responder returning the
named `ToolFailure`, catches `gg::core::api_error` in the program, and logs
`gg::core::gg_name(failure.code())` and `failure.operation()` so the assertion is on what the model
reads. Where the refusal is raised before dispatch, the case also asserts `log.names().is_empty()`.
Where a call returns `void`, the success case asserts the call reached dispatch under its own tool
name and that the statement after it logged.

### shell

- `a_shell_run_hands_a_cpp_program_its_exit_code_and_output` — `gg::shell::run("npm test")` logs
  `exit_code`, `output` and `truncated` off the returned `gg::shell::shell_output`.
- `a_non_zero_shell_exit_is_a_value_a_cpp_program_reads` — a command carrying `fail`, which the
  canned responder exits 1 for (`fake.test.rs:929`), logs `1`, and the statements after it run.
- `a_shell_timeout_reaches_a_cpp_program_as_limit_exceeded` — `LimitExceeded`.
- `a_shell_that_could_not_be_launched_is_an_io_error_in_cpp` — `IoError`.
- `a_negative_shell_timeout_is_an_argument_error_in_cpp` — `gg::shell::run("npm test", -4.0)` is
  refused by `clamp_timeout` as `invalid_argument`, with nothing reaching dispatch.

### files

`read_file`'s text success is read back at `cpp.surface.test.rs:478` and its `not_found` is asserted
caught at `:612` and uncaught at `:634`. `write_file`'s refusal when the run withheld it is asserted
at `:668`.

- `an_image_read_reaches_a_cpp_program_as_the_image_variant` — `gg::files::read_file("logo.png")`
  narrows with `std::get_if<gg::files::image_file>` and logs `label`, `bytes` and `shown`, which the
  canned responder answers `PNG`, `1234` and true for (`fake.test.rs:946-955`).
- `an_empty_path_read_is_an_argument_error_in_cpp` — `InvalidArgument`, the refusal
  `crates/gg/src/tools/filesystem.rs:336-341` gives an empty path.
- `a_write_hands_a_cpp_program_the_byte_count` — `gg::files::write_file("out.txt", "hello")` logs the
  returned `std::uint64_t`.
- `an_empty_path_write_is_an_argument_error_in_cpp` — `InvalidArgument`.
- `a_write_that_could_not_land_is_an_io_error_in_cpp` — `IoError`.
- `an_edit_that_succeeded_lets_a_cpp_program_carry_on` — `gg::files::edit_file` returns nothing, so
  the case asserts `log.names()` holds `edit_file` and the statement after it logged.
- `an_edit_whose_old_text_is_absent_is_not_found_in_cpp` — `NotFound`.
- `an_edit_whose_old_text_repeats_is_a_conflict_in_cpp` — `Conflict`, asserting the match count in
  the message reaches the program.
- `an_empty_old_string_edit_is_an_argument_error_in_cpp` — `InvalidArgument`, the refusal
  `crates/gg/src/tools/filesystem.rs:927-929` gives an empty `old_string`.
- `an_edit_whose_two_strings_match_is_an_argument_error_in_cpp` — `InvalidArgument`, the refusal at
  `crates/gg/src/tools/filesystem.rs:930-932`.
- `a_listing_hands_a_cpp_program_its_entries_and_their_kinds` — `gg::files::list_dir("src")` logs each
  `gg::files::dir_entry`'s `name` and `kind`, including `gg::files::entry_kind::directory` for `sub`
  (`fake.test.rs:793-808`).
- `an_omitted_listing_path_lists_the_root_from_cpp` — `gg::files::list_dir()` reaches dispatch with no
  `path` key at all.
- `an_empty_listing_path_is_an_argument_error_in_cpp` — `InvalidArgument`.
- `a_listing_of_a_directory_that_is_not_there_is_not_found_in_cpp` — `NotFound`.
- `a_tree_hands_a_cpp_program_its_rendering` — `gg::files::tree({.path = "src", .depth = 3})` logs the
  returned `std::string`.
- `a_tree_of_a_path_that_is_not_there_is_not_found_in_cpp` — `NotFound`.
- `a_tree_of_something_that_is_not_a_directory_is_an_argument_error_in_cpp` — `InvalidArgument`.
- `a_tree_depth_of_zero_is_an_argument_error_in_cpp` — `InvalidArgument`, which this arm reads back
  from the host rather than from a guest-side guard.
- `a_search_hands_a_cpp_program_its_matches` — `gg::files::search("answer", {.path = "src"})` logs the
  first `gg::files::search_match`'s `path`, `line` and `text` (`fake.test.rs:813-818`).
- `a_search_that_matched_nothing_is_an_empty_vector_in_cpp` — a responder answering with no matches,
  so the program logs `0` rather than catching anything.
- `a_blank_search_query_is_an_argument_error_in_cpp` — `InvalidArgument`.
- `a_search_pattern_that_does_not_parse_is_an_argument_error_in_cpp` — `InvalidArgument`.
- `a_search_limit_of_zero_is_an_argument_error_in_cpp` — `InvalidArgument`.
- `a_search_of_a_path_that_is_not_there_is_not_found_in_cpp` — `NotFound`.

### skills

- `a_skill_read_hands_a_cpp_program_the_skill_body` — `gg::skills::read_skill("testing")` logs the
  returned `std::string`.
- `an_unknown_skill_is_not_found_in_cpp` — `NotFound`, asserting the program reads back a message
  listing the skills that do exist, the way the membrane phrases it at
  `crates/gg/src/sandbox/membrane/knowledge.test.rs:31`.

### memories

- `a_memory_write_hands_a_cpp_program_its_budget` — `gg::memories::write_memory("layout", "d", "b")`
  logs `count`, `max_count` and `total_chars` off the returned `gg::memories::memory_usage`
  (`fake.test.rs:821-830`).
- `a_duplicate_memory_name_is_a_conflict_in_cpp` — `Conflict`.
- `a_memory_body_over_the_cap_is_limit_exceeded_in_cpp` — `LimitExceeded`.
- `a_memory_update_hands_a_cpp_program_its_budget` — `gg::memories::update_memory` logs the returned
  `memory_usage`.
- `an_update_of_a_memory_that_is_not_there_is_not_found_in_cpp` — `NotFound`.
- `an_update_over_the_cap_is_limit_exceeded_in_cpp` — `LimitExceeded`.
- `a_memory_creation_hands_a_cpp_program_its_budget` — `gg::memories::create_memory` logs the returned
  `memory_usage`, and the case keeps the crossing's point at `cpp.surface.test.rs:203` that `body`
  lowers onto `contents`.
- `a_duplicate_memory_slug_is_a_conflict_in_cpp` — `Conflict`.
- `memory_contents_over_the_cap_are_limit_exceeded_in_cpp` — `LimitExceeded`.
- `a_memory_read_hands_a_cpp_program_its_contents` — `gg::memories::read_memory("layout")` logs the
  returned `std::string`.
- `a_read_of_a_memory_that_is_not_there_is_not_found_in_cpp` — `NotFound`.
- `a_memory_edit_hands_a_cpp_program_its_budget` — `gg::memories::edit_memory` logs the returned
  `memory_usage`.
- `an_edit_whose_text_is_absent_from_a_memory_is_not_found_in_cpp` — `NotFound`.
- `an_edit_whose_text_repeats_in_a_memory_is_a_conflict_in_cpp` — `Conflict`.
- `an_edit_that_would_overrun_a_memory_is_limit_exceeded_in_cpp` — `LimitExceeded`.
- `an_edit_that_would_empty_a_memory_is_an_argument_error_in_cpp` — `InvalidArgument`.
- `a_memory_hit_hands_a_cpp_program_its_ranking` — `gg::memories::search_memories({"cargo",
  "nextest"})` logs `name`, `description`, `matched`, `occurrences` and `excerpt` off the first
  `gg::memories::memory_hit` (`fake.test.rs:832-839`).
- `a_memory_search_that_matched_nothing_is_an_empty_vector_in_cpp` — a responder answering with no
  hits, so the program logs `0`.
- `a_memory_search_of_empty_keywords_is_an_argument_error_in_cpp` — `InvalidArgument`.
- `a_hit_reads_its_own_memory_from_a_cpp_program` — `hits[0].read()` (`memories.hpp:62`) logs the
  contents and reaches dispatch as `read_memory`.
- `a_hit_whose_memory_was_deleted_is_not_found_in_cpp` — `NotFound` from that same member.
- `a_memory_deletion_hands_a_cpp_program_its_budget` — `gg::memories::delete_memory` logs the returned
  `memory_usage`.
- `a_deletion_of_a_memory_that_is_not_there_is_not_found_in_cpp` — `NotFound`.

### tasks

`update_task`, `set_blocked_by` and `complete_task` return nothing, and their argument lowering is
pinned by the crossing rows at `cpp.surface.test.rs:239`, `:251` and `:256`; each success case below
asserts the call reached dispatch and the statement after it logged.

- `adding_a_task_hands_a_cpp_program_its_budget` — `gg::tasks::add_task("t1", "T")` logs `count` and
  `max_tasks` off the returned `gg::tasks::task_usage` (`fake.test.rs:840-841`).
- `a_duplicate_task_id_is_a_conflict_in_cpp` — `Conflict`.
- `a_task_edge_that_would_close_a_cycle_is_a_conflict_in_cpp` — `Conflict` on an `add_task` carrying
  `.blocked_by`.
- `a_task_update_lets_a_cpp_program_carry_on` — the `void` success.
- `an_update_of_a_task_that_is_not_there_is_not_found_in_cpp` — `NotFound`.
- `a_task_patch_that_changes_nothing_is_an_argument_error_in_cpp` — `InvalidArgument` on
  `gg::tasks::update_task("t1", {})`, which `tasks.hpp:78` and `:102` both state is refused.
- `re_blocking_a_task_lets_a_cpp_program_carry_on` — the `void` success on
  `gg::tasks::set_blocked_by`.
- `re_blocking_a_task_that_is_not_there_is_not_found_in_cpp` — `NotFound`.
- `a_blocker_set_that_would_close_a_cycle_is_a_conflict_in_cpp` — `Conflict`.
- `completing_a_task_lets_a_cpp_program_carry_on` — the `void` success.
- `completing_a_task_that_is_not_there_is_not_found_in_cpp` — `NotFound`.
- `removing_a_task_hands_a_cpp_program_its_budget` — `gg::tasks::remove_task` logs the returned
  `task_usage`.
- `removing_a_task_that_is_not_there_is_not_found_in_cpp` — `NotFound`.

### board

`update_issue` and `set_issue_blocked_by` return nothing, and their argument lowering is pinned by
the crossing rows at `cpp.surface.test.rs:289` and `:308`.

- `creating_an_epic_hands_a_cpp_program_its_id_and_budget` — `gg::board::create_epic("epc", "E", "D")`
  logs `id` off the returned `gg::board::epic_created` and `epics`, `max_epics`, `issues` and
  `max_issues` off its `board` (`fake.test.rs:1126-1133`).
- `an_epic_prefix_under_three_letters_is_an_argument_error_in_cpp` — `InvalidArgument`.
- `an_epic_prefix_over_six_letters_is_an_argument_error_in_cpp` — `InvalidArgument`.
- `an_epic_prefix_that_is_not_letters_is_an_argument_error_in_cpp` — `InvalidArgument`.
- `an_epic_prefix_another_epic_holds_is_a_conflict_in_cpp` — `Conflict`.
- `creating_an_issue_hands_a_cpp_program_its_id_and_budget` — `gg::board::create_issue` logs `id` off
  the returned `gg::board::issue_created` and the four `board_usage` fields off its `board`.
- `an_issue_agent_that_cannot_be_assigned_is_an_argument_error_in_cpp` — `InvalidArgument`.
- `an_issue_reviewer_that_cannot_be_assigned_is_an_argument_error_in_cpp` — `InvalidArgument`.
- `an_issue_blocker_that_would_close_a_cycle_is_a_conflict_in_cpp` — `Conflict`.
- `an_issue_update_lets_a_cpp_program_carry_on` — the `void` success.
- `an_update_of_an_issue_that_is_not_there_is_not_found_in_cpp` — `NotFound`.
- `an_issue_patch_that_changes_nothing_is_an_argument_error_in_cpp` — `InvalidArgument` on
  `gg::board::update_issue("i1", {})`, which `board.hpp:111` states is refused.
- `re_blocking_an_issue_lets_a_cpp_program_carry_on` — the `void` success on
  `gg::board::set_issue_blocked_by`.
- `re_blocking_an_issue_that_is_not_there_is_not_found_in_cpp` — `NotFound`.
- `an_issue_edge_that_would_close_a_cycle_is_a_conflict_in_cpp` — `Conflict`.
- `removing_an_epic_hands_a_cpp_program_its_budget` — `gg::board::remove_epic` logs the returned
  `gg::board::board_usage`.
- `removing_an_epic_that_is_not_there_is_not_found_in_cpp` — `NotFound`.
- `removing_an_issue_hands_a_cpp_program_its_budget` — `gg::board::remove_issue` logs the returned
  `board_usage`.
- `removing_an_issue_that_is_not_there_is_not_found_in_cpp` — `NotFound`.
- `a_wait_is_registered_and_a_cpp_program_runs_on` — `gg::board::wait_for_issue("i1")` logs the
  acknowledgement and the statements after it log too, which is the whole of what deferred
  registration means here.
- `waiting_on_an_issue_that_is_not_there_is_not_found_in_cpp` — `NotFound`.
- `waiting_on_this_sessions_own_issue_is_an_argument_error_in_cpp` — `InvalidArgument`.
- `a_created_issue_waits_on_itself_from_a_cpp_program` — `created.wait()` (`board.hpp:94`) logs the
  acknowledgement and reaches dispatch as `wait_for_issue` carrying the id the board minted.

## Done when

- [ ] Each case above is its own `#[test]` in
      `crates/gg/src/sandbox/language/cpp.surface.test.rs`, driving one short C++ program.
- [ ] Every successful call in `shell`, `files`, `memories`, `tasks`, `board` and `skills` has a C++
      program that reads its post-call state back, or asserts the dispatch and the statement after
      it where the call returns `void`.
- [ ] Every failure class the arm's `\throws` lines name is injected through a responder and
      asserted as the `gg::core::api_error` the program catches, by
      `gg::core::gg_name(failure.code())` and `failure.operation()`.
- [ ] The negative shell timeout asserts that nothing reached gg's dispatch.
- [ ] The comment at `cpp.surface.test.rs:13-18` asks for a function per case and quotes the
      measured compile cost.
- [ ] Gates green.
