# Drive gg's workspace SDK modules from Rust programs

Cover the shell, files, memories, tasks, board and skills modules of the Rust
SDK from real Rust programs: what a successful call hands the program back, and
what a program catches for every runtime failure a well-typed call can meet.

## Current state

The Rust arm's model-facing surface is driven through the real toolchain and the
real membrane in `crates/gg/src/sandbox/language/rust.surface.test.rs`. The
crossing table at `rust.surface.test.rs:130` carries a row per bound operation,
and `every_operation_crosses_the_membrane_from_its_rust_spelling`
(`rust.surface.test.rs:384`) runs them as one program and asserts the JSON each
one put on gg's dispatch. That table is the argument-lowering gate and stays as
it is; what a program *reads back*, and what it catches, is the half these tests
add.

What this arm already drives from a program:

| Case | Where |
| --- | --- |
| `files::read_file` answering `NotFound`, both matched on and let out with `?` | `rust.surface.test.rs:694` |
| A call this run withheld answering `Unavailable` without reaching dispatch | `rust.surface.test.rs:746` |
| `board::create_issue`'s `id`, and `IssueCreated::wait` reaching `wait_for_issue` | `rust.surface.test.rs:613` |
| `memories::search_memories` hits read for `name`, and `MemoryHit::read` reaching `read_memory` | `rust.surface.test.rs:613` |
| A `FileRead::Text` arm matched on, through `views::open_file` | `rust.surface.test.rs:450` |

The harness the new tests reuse is the one those tests use. `whole`
(`rust.surface.test.rs:72`) assembles a model's whole program from its `use`
lines and a `fn main`; `run_with` (`rust.surface.test.rs:92`) compiles it through
`prepare` and drives it through `evaluate` (imported at `rust.surface.test.rs:23`
from the substrate module), handing back a `SandboxOutcome` and the `CallLog`
from `crates/gg/src/sandbox/fake.test.rs:92`. `logs` reads the lines a program
wrote with `gg::log` and `trap` reads what the model is told when a program ends
in an error. Successes are answered by `canned_outcome`
(`crates/gg/src/sandbox/fake.test.rs:780`), whose payloads are specific enough to
assert on: a shell result that exits non-zero exactly when the command says
`fail` (`fake.test.rs:928`), a picture for a `.png` path and two lines of text for
anything else (`fake.test.rs:945`), three directory entries one of which is a
directory (`fake.test.rs:793`), one search match (`fake.test.rs:813`), a memory
usage record (`fake.test.rs:821`), a task usage pair (`fake.test.rs:840`) and a
board usage record (`fake.test.rs:1126`).

Each function's runtime failures are enumerated by its own `# Errors` section in
`packages/gg-sandbox-rust/src/`, which is the list the case tables below are
built from. Rust's types remove several failures other arms carry: a `depth` is
an `Option<u32>`, so a negative one does not compile, and a mistyped argument is
a compile error rather than an `InvalidArgument` at runtime.

## Design

All of this work lands in `crates/gg/src/sandbox/language/rust.surface.test.rs`.
Its consolidation note at `rust.surface.test.rs:12-16`, and the matching one in
`rust.substrate.test.rs:42-46`, ask a reader to add statements to an existing
function rather than adding a function; revise both as part of this issue. The
cost table at `crates/gg/src/sandbox/language/rust.compile.rs:27-29` prices a
whole program at ~45-60 ms of `rustc` plus ~15 ms to instantiate, against a
prebuilt library set, so one `#[test]` per case is what this file can afford and
what the testing policy asks for.

### How each test is written

A success test runs one program through `run_with` with `all_operations`
(`fake.test.rs:1151`) and `canned_outcome`, logs the fields of the value the call
returned with `gg::log`, and asserts the lines with `logs`. A failure test passes
a responder closure that answers `ToolOutcome::failed(ToolFailure::X, "…")`, in
the shape already at `rust.surface.test.rs:711`, and the program matches on the
`Result` and logs `failure.code` and `failure.operation`; where the failure's
message carries data the model needs, the program logs `failure.message` too and
the test asserts the detail survived. Add a `fails_with(failure, detail)` helper
beside `run_with` so each failure test is a program and one assertion.

A failure test also asserts, through the `CallLog`, that the call reached gg's
dispatch carrying the arguments the program wrote. That is what makes a case like
an empty path or a zero depth meaningful on this arm: the refusal itself belongs
to gg's tool implementation, and the claim here is that the arm lowers the cause
onto an `ApiError` the program can read, under the operation's own name.

### shell

`packages/gg-sandbox-rust/src/shell.rs:40`, errors at `shell.rs:36-38`.

| Case | Test |
| --- | --- |
| A command that ran hands back `exit_code`, `output` and `truncated` | `a_shell_run_hands_the_program_its_exit_code_and_output` |
| A non-zero exit is a value rather than a failure | `a_non_zero_exit_is_a_value_the_program_reads` |
| `LimitExceeded` — the timeout killed the process | `a_shell_timeout_reaches_the_program_as_limit_exceeded` |
| `IoError` — the process could not be launched | `a_shell_that_could_not_be_launched_is_an_io_error` |

The non-zero case asks `canned_outcome` for a command containing `fail`, which
answers `ok: false` with no failure classification — the exact shape the membrane
turns back into a value.

### files

`packages/gg-sandbox-rust/src/files.rs`, each function's errors in its own
`# Errors` section.

| Case | Test |
| --- | --- |
| A text read hands back the `Text` arm's contents, line window and `byte_truncated` | `a_text_read_hands_the_program_the_text_window` |
| A read of a `.png` hands back the `Image` arm's media type, label, bytes and `shown` | `an_image_read_hands_the_program_the_image_variant` |
| A write hands back the byte count | `a_write_hands_the_program_the_byte_count` |
| `write_file` `InvalidArgument` — an empty path | `an_empty_write_path_is_an_argument_error` |
| `write_file` `IoError` — the write or its parent directories failed | `a_write_that_failed_is_an_io_error` |
| An edit that matched once returns and the program carries on | `an_edit_that_matched_once_returns_to_its_program` |
| `edit_file` `NotFound` — the text does not appear | `an_edit_whose_text_is_absent_is_not_found` |
| `edit_file` `Conflict` — the text appears more than once, the count in the message | `an_edit_whose_text_repeats_is_a_conflict_carrying_the_count` |
| A listing hands back each entry's name and `EntryKind` | `a_listing_hands_the_program_its_entries_and_their_kinds` |
| An omitted path lists the root, and no `path` key reaches dispatch | `an_omitted_listing_path_lists_the_root` |
| An empty directory is an empty list | `an_empty_directory_is_an_empty_list` |
| `list_dir` `NotFound` — the directory is not there | `a_listing_of_a_directory_that_is_not_there_is_not_found` |
| `list_dir` `InvalidArgument` — `Some("")` | `a_listing_path_that_is_given_but_empty_is_an_argument_error` |
| A tree hands back its rendering | `a_tree_hands_the_program_its_rendering` |
| `tree` `NotFound` — the path is not there | `a_tree_of_a_path_that_is_not_there_is_not_found` |
| `tree` `InvalidArgument` — the path is a file | `a_tree_rooted_at_a_file_is_an_argument_error` |
| `tree` `InvalidArgument` — `depth: Some(0)` | `a_tree_depth_of_zero_is_an_argument_error` |
| A search hands back each match's path, line and text | `a_search_hands_the_program_its_matches` |
| A search that matched nothing is an empty list | `a_search_that_matched_nothing_is_an_empty_list` |
| `search` `InvalidArgument` — a blank query | `a_blank_search_query_is_an_argument_error` |
| `search` `InvalidArgument` — a query that is not a valid pattern | `a_search_pattern_that_does_not_parse_is_an_argument_error` |
| `search` `InvalidArgument` — `limit: Some(0)` | `a_search_limit_of_zero_is_an_argument_error` |
| `search` `NotFound` — the `path` is not there | `a_search_path_that_is_not_there_is_not_found` |

`read_file`'s `NotFound` is driven at `rust.surface.test.rs:694`, in both the
matched and the `?` form, and needs nothing further.

### skills

`packages/gg-sandbox-rust/src/skills.rs:34`, errors at `skills.rs:30-32`.

| Case | Test |
| --- | --- |
| A skill read hands back the body | `a_skill_read_hands_the_program_the_skill_body` |
| `NotFound` — an unknown name, the message listing the skills that do exist | `an_unknown_skill_names_the_skills_that_exist` |

The message the failure test asserts on is the one gg produces at
`crates/gg/src/sandbox/membrane/knowledge.test.rs:31`, so the program asserts
`failure.message` holds `available skills`.

### memories

`packages/gg-sandbox-rust/src/memories.rs`. Every mutation hands back a
`MemoryUsage`, so each success test logs `count`, `max_count` and `total_chars`
off the value the call returned.

| Case | Test |
| --- | --- |
| A written memory hands back the usage after it | `a_written_memory_hands_the_program_the_usage_after_it` |
| `write_memory` `Conflict` — a duplicate name | `a_duplicate_memory_name_is_a_conflict` |
| `write_memory` `LimitExceeded` — the body breaches the run's caps | `a_memory_body_over_the_cap_is_limit_exceeded` |
| An updated memory hands back the usage after it | `an_updated_memory_hands_the_program_the_usage_after_it` |
| `update_memory` `NotFound` — no memory has that name | `an_update_of_a_memory_that_is_not_there_is_not_found` |
| A created memory, carrying `code`, hands back the usage after it | `a_created_memory_hands_the_program_the_usage_after_it` |
| `create_memory` `InvalidArgument` — a blank field | `a_blank_field_on_a_new_memory_is_an_argument_error` |
| `create_memory` `InvalidArgument` — a slug with characters a name may not hold | `a_slug_a_name_may_not_hold_is_an_argument_error` |
| `create_memory` `Conflict` — a duplicate slug | `a_duplicate_memory_slug_is_a_conflict` |
| `create_memory` `LimitExceeded` — the contents or the index entry breach a limit | `a_new_memory_over_a_limit_is_limit_exceeded` |
| A memory read hands back its contents | `a_memory_read_hands_the_program_its_contents` |
| `read_memory` `NotFound` — no memory has that slug | `a_read_of_a_memory_that_is_not_there_is_not_found` |
| An edited memory hands back the usage after it | `an_edited_memory_hands_the_program_the_usage_after_it` |
| `edit_memory` `NotFound` — the text does not appear | `a_memory_edit_whose_text_is_absent_is_not_found` |
| `edit_memory` `Conflict` — the text appears more than once | `a_memory_edit_whose_text_repeats_is_a_conflict` |
| `edit_memory` `LimitExceeded` — the result would be too long | `a_memory_edit_over_the_cap_is_limit_exceeded` |
| `edit_memory` `InvalidArgument` — the edit would leave the memory empty | `a_memory_edit_that_would_empty_it_is_an_argument_error` |
| A search hands back each hit's description, `matched`, `occurrences` and excerpt | `a_memory_search_hands_the_program_each_hits_ranking` |
| A search that matched nothing is an empty list | `a_memory_search_that_matched_nothing_is_an_empty_list` |
| `search_memories` `InvalidArgument` — every keyword is empty | `a_memory_search_of_empty_keywords_is_an_argument_error` |
| A deleted memory hands back the usage after it | `a_deleted_memory_hands_the_program_the_usage_after_it` |
| `delete_memory` `NotFound` — no memory has that name | `a_delete_of_a_memory_that_is_not_there_is_not_found` |

A hit's `name` and the `MemoryHit::read` alias are driven at
`rust.surface.test.rs:613`, so the search success test covers the ranking fields
the alias case leaves alone.

### tasks

`packages/gg-sandbox-rust/src/tasks.rs`.

| Case | Test |
| --- | --- |
| An added task hands back `count` and `max_tasks` | `an_added_task_hands_the_program_the_task_usage` |
| `add_task` `InvalidArgument` — a blank id | `a_blank_task_id_is_an_argument_error` |
| `add_task` `InvalidArgument` — a blank title | `a_blank_task_title_is_an_argument_error` |
| `add_task` `Conflict` — a duplicate id | `a_duplicate_task_id_is_a_conflict` |
| `add_task` `Conflict` — a blocker that would close a cycle | `a_task_edge_that_closes_a_cycle_is_a_conflict` |
| `add_task` `NotFound` — an unknown blocker | `an_unknown_task_blocker_is_not_found` |
| `add_task` `LimitExceeded` — the task cap | `a_task_over_the_cap_is_limit_exceeded` |
| A patch carrying `TextEdit::Clear` and a status returns to its program | `an_updated_task_returns_to_its_program` |
| `update_task` `InvalidArgument` — no field was supplied | `a_task_patch_with_no_field_is_an_argument_error` |
| `update_task` `InvalidArgument` — a field was blanked | `a_blanked_task_field_is_an_argument_error` |
| `update_task` `NotFound` — an unknown id | `an_update_of_a_task_that_is_not_there_is_not_found` |
| An empty blocker list clears the edges and returns | `a_cleared_task_blocker_list_returns_to_its_program` |
| `set_blocked_by` `InvalidArgument` — a blank id | `a_blank_id_on_a_task_blocker_list_is_an_argument_error` |
| `set_blocked_by` `InvalidArgument` — a blank blocker | `a_blank_blocker_on_a_task_is_an_argument_error` |
| `set_blocked_by` `NotFound` — the task is not on the list | `blocking_a_task_that_is_not_there_is_not_found` |
| `set_blocked_by` `NotFound` — a blocker is not on the list | `a_task_blocker_that_is_not_there_is_not_found` |
| `set_blocked_by` `Conflict` — an edge that would close a cycle | `a_task_blocker_that_closes_a_cycle_is_a_conflict` |
| `set_blocked_by` `Conflict` — a task blocked on itself | `a_task_blocked_on_itself_is_a_conflict` |
| A completion returns to its program | `a_completed_task_returns_to_its_program` |
| `complete_task` `NotFound` — an unknown id | `completing_a_task_that_is_not_there_is_not_found` |
| A removal hands back the usage after it | `a_removed_task_hands_the_program_the_usage_after_it` |
| `remove_task` `NotFound` — an unknown id | `removing_a_task_that_is_not_there_is_not_found` |

The duplicate-id conflict is produced at
`crates/gg/src/sandbox/membrane/knowledge.test.rs:333`; the test here injects the
same failure and asserts what a Rust program catches.

### board

`packages/gg-sandbox-rust/src/board.rs`. `create_epic` and `create_issue` hand
back the id gg minted and a `BoardUsage`, and the removals hand back a
`BoardUsage` alone, so each success test logs `id` where there is one plus
`board.issues` and `board.max_issues`.

| Case | Test |
| --- | --- |
| A created epic hands back its id and the board usage | `a_created_epic_hands_the_program_its_id_and_usage` |
| `create_epic` `InvalidArgument` — a prefix shorter than three letters | `a_prefix_under_three_letters_is_an_argument_error` |
| `create_epic` `InvalidArgument` — a prefix longer than six letters | `a_prefix_over_six_letters_is_an_argument_error` |
| `create_epic` `InvalidArgument` — a prefix that is not all letters | `a_prefix_that_is_not_letters_is_an_argument_error` |
| `create_epic` `InvalidArgument` — a blank required field | `a_blank_epic_field_is_an_argument_error` |
| `create_epic` `Conflict` — another epic holds the prefix | `a_prefix_another_epic_holds_is_a_conflict` |
| `create_epic` `LimitExceeded` — the epic cap | `an_epic_over_the_cap_is_limit_exceeded` |
| A created issue hands back the board usage beside its id | `a_created_issue_hands_the_program_the_board_usage` |
| `create_issue` `InvalidArgument` — a blank required field | `a_blank_issue_field_is_an_argument_error` |
| `create_issue` `InvalidArgument` — an `agent` this session may not assign | `an_agent_this_session_may_not_assign_is_an_argument_error` |
| `create_issue` `InvalidArgument` — a reviewer this session may not assign | `a_reviewer_this_session_may_not_assign_is_an_argument_error` |
| `create_issue` `NotFound` — an unknown epic | `an_issue_under_an_epic_that_is_not_there_is_not_found` |
| `create_issue` `NotFound` — an unknown blocker | `an_issue_blocker_that_is_not_there_is_not_found` |
| `create_issue` `LimitExceeded` — the issue cap | `an_issue_over_the_cap_is_limit_exceeded` |
| A patch carrying `EpicAssignment::Ungroup` and a status returns to its program | `an_updated_issue_returns_to_its_program` |
| `update_issue` `InvalidArgument` — no field was supplied | `an_issue_patch_with_no_field_is_an_argument_error` |
| `update_issue` `InvalidArgument` — a field was blanked | `a_blanked_issue_field_is_an_argument_error` |
| `update_issue` `NotFound` — an unknown issue id | `an_update_of_an_issue_that_is_not_there_is_not_found` |
| `update_issue` `NotFound` — an unknown epic id | `a_patch_naming_an_epic_that_is_not_there_is_not_found` |
| A blocker list returns to its program | `an_issue_blocker_list_returns_to_its_program` |
| `set_issue_blocked_by` `InvalidArgument` — a blank id | `a_blank_id_on_an_issue_blocker_list_is_an_argument_error` |
| `set_issue_blocked_by` `InvalidArgument` — a blank blocker | `a_blank_blocker_on_an_issue_is_an_argument_error` |
| `set_issue_blocked_by` `NotFound` — the board holds no such issue | `blocking_an_issue_that_is_not_there_is_not_found` |
| `set_issue_blocked_by` `NotFound` — the board holds no such blocker | `an_issue_blocker_the_board_lacks_is_not_found` |
| `set_issue_blocked_by` `Conflict` — an edge that would close a cycle | `an_issue_edge_that_closes_a_cycle_is_a_conflict` |
| `set_issue_blocked_by` `Conflict` — an issue blocked on itself | `an_issue_blocked_on_itself_is_a_conflict` |
| A removed epic hands back the board usage after it | `a_removed_epic_hands_the_program_the_usage_after_it` |
| `remove_epic` `NotFound` — an unknown id | `removing_an_epic_that_is_not_there_is_not_found` |
| A removed issue hands back the board usage after it | `a_removed_issue_hands_the_program_the_usage_after_it` |
| `remove_issue` `NotFound` — an unknown id | `removing_an_issue_that_is_not_there_is_not_found` |
| A wait is registered and the lines after it still run | `a_registered_wait_does_not_stop_the_program` |
| `wait_for_issue` `InvalidArgument` — a blank id | `a_blank_wait_id_is_an_argument_error` |
| `wait_for_issue` `InvalidArgument` — this session's own assigned issue | `waiting_on_this_sessions_own_issue_is_an_argument_error` |
| `wait_for_issue` `NotFound` — an id the board does not hold | `waiting_on_an_issue_that_is_not_there_is_not_found` |
| `wait_for_issue` `Unavailable` — the run has no board | `waiting_without_a_board_is_unavailable` |

The registration test is the one that pins the call's surprising half: the
program logs a line, waits, logs another, and both lines are asserted in order
alongside the `wait_for_issue` call in the `CallLog`. The `Unavailable` test runs
its program with `all_operations_without(CAPABILITY_PROJECT_MANAGEMENT)`
(`fake.test.rs:1185`) and asserts an empty `CallLog`, in the shape at
`rust.surface.test.rs:746`.

## Done when

- [ ] Every operation of the shell, files, memories, tasks, board and skills
      modules has a Rust program test asserting what a successful call hands back.
- [ ] Every runtime failure each of those functions documents in its `# Errors`
      section has its own Rust program test asserting the code, the operation and,
      where the detail is load-bearing, the message.
- [ ] Each test is one `#[test]` driving one program.
- [ ] A `fails_with` helper sits beside `run_with` and every failure test uses it.
- [ ] The consolidation notes at `rust.surface.test.rs:12-16` and
      `rust.substrate.test.rs:42-46` ask for a function per case.
- [ ] Gates green.
