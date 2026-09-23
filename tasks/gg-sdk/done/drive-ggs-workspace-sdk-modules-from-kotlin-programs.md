# Drive gg's workspace SDK modules from Kotlin programs

Drive every `shell`, `files`, `memories`, `tasks`, `board` and `skills` operation from a real Kotlin
program: one test for the successful call that reads the post-call state back, and one test for each
distinct runtime failure mode the arm's own documentation names.

## Current state

The operation vocabulary these modules draw from is `crates/gg/src/sandbox/operations.rs:110`
onwards, from `SHELL_SHELL` through `BOARD_WAIT_FOR_ISSUE`. The Kotlin spellings live in
`packages/gg-sandbox-kotlin/src/gg/` — `shell/Shell.kt:36`, `files/Files.kt:40`,
`skills/Skills.kt:32`, `memories/Memories.kt:41`, `tasks/Tasks.kt:37` and `board/Board.kt:41` — and
each function's `@throws` line states the failure modes the tests below assert.

Every one of these operations already has its argument lowering pinned from its Kotlin spelling by
the crossing table at `crates/gg/src/sandbox/language/kotlin.surface.test.rs:108`, driven at `:352`.
That table proves what gg's dispatch saw. What it does not do is read a value back or inject a
failure, and the arm's only failure injections are three `NotFound` responses for `readFile` at
`kotlin.surface.test.rs:703`, `:720` and `:744`.

Some ground is already held from Kotlin programs. `files.readFile`'s text success is read back at
`kotlin.surface.test.rs:1049-1055`; its `NOT_FOUND` is caught, escaped and taken through
`runCatching` at `:689`; `memories.searchMemories` and `memories.readMemory` are reached through
`hits[0].read()` at `:536` and asserted at `:561`; `board.createIssue` and `board.waitForIssue` are
reached through `created.wait()` at `:534` and asserted at the same line; and the `FileRead` sealed
interface is branched on at `:413-416`.

The harness is the arm's own. `super::substrate::prepare` (`kotlin.substrate.test.rs:93`) compiles a
whole program through the production prepare step, `evaluate` and `evaluate_as` (`:120` and `:138`)
run the component against the real membrane, `whole` (`:75`) wraps a statement body in the `fun
main()` a model writes, and `logs` and `trap` (`:252`, `:274`) read what the model would read. The
surface file adds `run_with` and `run_as` (`kotlin.surface.test.rs:77` and `:54`), which are the two
entry points every case below uses. The operation side is `crates/gg/src/sandbox/fake.test.rs`:
`FakeOperationApi` (`:248`), `CallLog` with its `names` and `args` readers (`:102`, `:117`), the
`canned_outcome` responder (`:780`) for a successful call, and `all_operations` (`:1151`) for the
grant. A failure is injected by passing a responder that returns
`ToolOutcome::failed(crate::tools::ToolFailure::<Variant>, message)`, the way `:703` already does;
the variants are at `crates/gg/src/tools/data.rs:509-529`.

## Design

Every case is its own `#[test]` in `crates/gg/src/sandbox/language/kotlin.surface.test.rs`, holding
one short program. The module comment at `kotlin.surface.test.rs:13-18`, which asks for a statement
added to an existing function, is revised as part of this work to ask for a function per case, and
to quote the measured cost rather than a discouraging one: a JVM start is 0.5 s and the first build
inside it four or five seconds (`kotlin.substrate.test.rs:1129`), a warm pool's build is a few
hundred milliseconds (`kotlin.surface.test.rs:356`), and `cargo nextest` pays the per-process cost in
parallel.

A success case grants `all_operations()`, answers with `canned_outcome`, and asserts the value the
program read back through `gg.log`. A failure case answers with a responder returning the named
`ToolFailure`, catches `gg.core.ApiError` in the program, and logs `failure.code` and
`failure.operation` so the assertion is on what the model reads. Where the refusal is raised by the
SDK itself, the case also asserts `log.names().is_empty()`.

### shell

- `a_shell_run_hands_a_kotlin_program_its_exit_code_and_output` — `gg.shell.run("npm test")` logs
  `exitCode`, `output` and `truncated` off the returned `ShellOutput`.
- `a_non_zero_shell_exit_is_a_value_a_kotlin_program_reads` — a command carrying `fail`, which the
  canned responder exits 1 for (`fake.test.rs:930`), logs `1` and the lines after it still run.
- `a_shell_timeout_reaches_a_kotlin_program_as_limit_exceeded` — `LimitExceeded`.
- `a_shell_that_could_not_be_launched_is_an_io_error_in_kotlin` — `IoError`.
- `a_negative_shell_timeout_is_an_argument_error_in_kotlin` — `timeoutSecs = -4` is refused by the
  membrane's `clamp_timeout` (`crates/gg/src/sandbox/membrane/workspace.rs:266`) as
  `INVALID_ARGUMENT`, with nothing reaching dispatch.

### files

`readFile`'s text success and its `NOT_FOUND` are held at `kotlin.surface.test.rs:1049` and `:689`.

- `an_image_read_reaches_a_kotlin_program_as_the_image_variant` — `gg.files.readFile("logo.png")`
  branches to `gg.files.ImageFile` and logs `label`, `bytes` and `shown`.
- `an_empty_path_read_is_an_argument_error_in_kotlin` — `INVALID_ARGUMENT`.
- `a_write_hands_a_kotlin_program_the_byte_count` — `gg.files.writeFile("out.txt", "hello")` logs the
  returned `Int`.
- `an_empty_path_write_is_an_argument_error_in_kotlin` — `INVALID_ARGUMENT`.
- `a_write_that_could_not_land_is_an_io_error_in_kotlin` — `IoError`.
- `an_edit_that_succeeded_lets_a_kotlin_program_carry_on` — `gg.files.editFile` returns nothing, so
  the case asserts the call reached dispatch and the line after it logged.
- `an_edit_whose_old_text_is_absent_is_not_found_in_kotlin` — `NotFound`.
- `an_edit_whose_old_text_repeats_is_a_conflict_in_kotlin` — `Conflict`, asserting the match count in
  the message reaches the program.
- `a_listing_hands_a_kotlin_program_its_entries_and_their_kinds` — `gg.files.listDir("src")` logs each
  `DirEntry`'s `name` and `kind`, including `gg.files.EntryKind.DIRECTORY` for `sub`.
- `an_omitted_listing_path_lists_the_root_from_kotlin` — `gg.files.listDir()` reaches dispatch with no
  `path` key at all.
- `an_empty_listing_path_is_an_argument_error_in_kotlin` — `INVALID_ARGUMENT`.
- `a_listing_of_a_directory_that_is_not_there_is_not_found_in_kotlin` — `NotFound`.
- `a_tree_hands_a_kotlin_program_its_rendering` — `gg.files.tree(path = "src", depth = 3)` logs the
  returned `String`.
- `a_tree_of_a_path_that_is_not_there_is_not_found_in_kotlin` — `NotFound`.
- `a_tree_of_something_that_is_not_a_directory_is_an_argument_error_in_kotlin` — `InvalidArgument`.
- `a_tree_depth_of_zero_is_refused_before_it_is_dispatched_in_kotlin` — the SDK's own guard at
  `packages/gg-sandbox-kotlin/src/gg/files/Files.kt:117-123`, so nothing reaches dispatch.
- `a_search_hands_a_kotlin_program_its_matches` — `gg.files.search("answer", path = "src")` logs each
  `SearchMatch`'s `path`, `line` and `text`.
- `a_blank_search_query_is_an_argument_error_in_kotlin` — `InvalidArgument`.
- `a_search_pattern_that_does_not_parse_is_an_argument_error_in_kotlin` — `InvalidArgument`.
- `a_search_limit_of_zero_is_refused_before_it_is_dispatched_in_kotlin` — the SDK's own guard at
  `Files.kt:157-163`, so nothing reaches dispatch.
- `a_search_of_a_path_that_is_not_there_is_not_found_in_kotlin` — `NotFound`.

### skills

- `a_skill_read_hands_a_kotlin_program_the_skill_body` — `gg.skills.readSkill("testing")` logs the
  returned `String`.
- `an_unknown_skill_is_not_found_in_kotlin` — `NotFound`, asserting the program reads back a message
  that lists the skills that do exist, the way the membrane phrases it at
  `crates/gg/src/sandbox/membrane/knowledge.test.rs:31`.

### memories

`readMemory`'s success and `searchMemories`'s hit list are reached through `MemoryHit.read` at
`kotlin.surface.test.rs:536` and asserted at `:561`.

- `a_memory_write_hands_a_kotlin_program_its_budget` — `gg.memories.writeMemory` logs `count`,
  `maxCount` and `totalChars` off the returned `MemoryUsage`.
- `a_duplicate_memory_name_is_a_conflict_in_kotlin` — `Conflict`.
- `a_memory_body_over_the_cap_is_limit_exceeded_in_kotlin` — `LimitExceeded`.
- `a_memory_update_hands_a_kotlin_program_its_budget` — `gg.memories.updateMemory` logs the returned
  `MemoryUsage`.
- `an_update_of_a_memory_that_is_not_there_is_not_found_in_kotlin` — `NotFound`.
- `a_memory_creation_hands_a_kotlin_program_its_budget` — `gg.memories.createMemory` logs the returned
  `MemoryUsage`, and the case keeps the crossing's point that `body` lowers onto `contents`.
- `a_duplicate_memory_slug_is_a_conflict_in_kotlin` — `Conflict`.
- `memory_contents_over_the_cap_are_limit_exceeded_in_kotlin` — `LimitExceeded`.
- `a_read_of_a_memory_that_is_not_there_is_not_found_in_kotlin` — `NotFound`.
- `a_memory_edit_hands_a_kotlin_program_its_budget` — `gg.memories.editMemory` logs the returned
  `MemoryUsage`.
- `an_edit_whose_text_is_absent_from_a_memory_is_not_found_in_kotlin` — `NotFound`.
- `an_edit_whose_text_repeats_in_a_memory_is_a_conflict_in_kotlin` — `Conflict`.
- `an_edit_that_would_overrun_a_memory_is_limit_exceeded_in_kotlin` — `LimitExceeded`.
- `an_edit_that_would_empty_a_memory_is_an_argument_error_in_kotlin` — `InvalidArgument`.
- `a_memory_hit_hands_a_kotlin_program_its_ranking` — `gg.memories.searchMemories("cargo", "nextest")`
  logs `name`, `description`, `matched`, `occurrences` and `excerpt` off the first `MemoryHit`.
- `a_memory_search_that_matched_nothing_is_an_empty_list_in_kotlin` — a responder answering with no
  hits, so the program logs `0` rather than catching anything.
- `a_memory_search_of_empty_keywords_is_an_argument_error_in_kotlin` — `InvalidArgument`.
- `a_memory_deletion_hands_a_kotlin_program_its_budget` — `gg.memories.deleteMemory` logs the returned
  `MemoryUsage`.
- `a_deletion_of_a_memory_that_is_not_there_is_not_found_in_kotlin` — `NotFound`.

### tasks

`updateTask`, `setBlockedBy` and `completeTask` return nothing, and their successful calls are pinned
by the crossing rows at `kotlin.surface.test.rs:206`, `:217` and `:222`.

- `adding_a_task_hands_a_kotlin_program_its_budget` — `gg.tasks.addTask` logs `count` and `maxTasks`
  off the returned `TaskUsage`.
- `a_duplicate_task_id_is_a_conflict_in_kotlin` — `Conflict`.
- `a_task_edge_that_would_close_a_cycle_is_a_conflict_in_kotlin` — `Conflict` on an `addTask` carrying
  `blockedBy`.
- `an_update_of_a_task_that_is_not_there_is_not_found_in_kotlin` — `NotFound`.
- `re_blocking_a_task_that_is_not_there_is_not_found_in_kotlin` — `NotFound` on
  `gg.tasks.setBlockedBy`.
- `a_blocker_set_that_would_close_a_cycle_is_a_conflict_in_kotlin` — `Conflict` on
  `gg.tasks.setBlockedBy`.
- `completing_a_task_that_is_not_there_is_not_found_in_kotlin` — `NotFound`.
- `removing_a_task_hands_a_kotlin_program_its_budget` — `gg.tasks.removeTask` logs the returned
  `TaskUsage`.
- `removing_a_task_that_is_not_there_is_not_found_in_kotlin` — `NotFound`.

### board

`updateIssue` and `setIssueBlockedBy` return nothing, and their successful calls are pinned by the
crossing rows at `kotlin.surface.test.rs:255` and `:274`. `createIssue`'s minted id and
`waitForIssue`'s acknowledgement are read at `:534` and asserted at `:561`.

- `creating_an_epic_hands_a_kotlin_program_its_id_and_budget` — `gg.board.createEpic("epc", "E", "D")`
  logs `id` off the returned `EpicCreated` and `epics`, `maxEpics`, `issues` and `maxIssues` off its
  `board`.
- `an_epic_prefix_under_three_letters_is_an_argument_error_in_kotlin` — `InvalidArgument`.
- `an_epic_prefix_over_six_letters_is_an_argument_error_in_kotlin` — `InvalidArgument`.
- `an_epic_prefix_that_is_not_letters_is_an_argument_error_in_kotlin` — `InvalidArgument`.
- `an_epic_prefix_another_epic_holds_is_a_conflict_in_kotlin` — `Conflict`.
- `creating_an_issue_hands_a_kotlin_program_its_id_and_budget` — `gg.board.createIssue` logs `id` off
  the returned `IssueCreated` and the four `BoardUsage` fields off its `board`.
- `an_issue_agent_that_cannot_be_assigned_is_an_argument_error_in_kotlin` — `InvalidArgument`.
- `an_issue_reviewer_that_cannot_be_assigned_is_an_argument_error_in_kotlin` — `InvalidArgument`.
- `an_issue_blocker_that_would_close_a_cycle_is_a_conflict_in_kotlin` — `Conflict`.
- `an_update_of_an_issue_that_is_not_there_is_not_found_in_kotlin` — `NotFound`.
- `re_blocking_an_issue_that_is_not_there_is_not_found_in_kotlin` — `NotFound`.
- `an_issue_edge_that_would_close_a_cycle_is_a_conflict_in_kotlin` — `Conflict` on
  `gg.board.setIssueBlockedBy`.
- `removing_an_epic_hands_a_kotlin_program_its_budget` — `gg.board.removeEpic` logs the returned
  `BoardUsage`.
- `removing_an_epic_that_is_not_there_is_not_found_in_kotlin` — `NotFound`.
- `removing_an_issue_hands_a_kotlin_program_its_budget` — `gg.board.removeIssue` logs the returned
  `BoardUsage`.
- `removing_an_issue_that_is_not_there_is_not_found_in_kotlin` — `NotFound`.
- `a_wait_is_registered_and_a_kotlin_program_runs_on` — `gg.board.waitForIssue("i1")` logs the
  acknowledgement and the statements after it log too, which is the whole of what deferred
  registration means here.
- `waiting_on_an_issue_that_is_not_there_is_not_found_in_kotlin` — `NotFound`.

## Done when

- [ ] Each case above is its own `#[test]` in
      `crates/gg/src/sandbox/language/kotlin.surface.test.rs`, driving one short Kotlin program.
- [ ] Every successful call in `shell`, `files`, `memories`, `tasks`, `board` and `skills` has a
      Kotlin program that reads its post-call state back, or a cited crossing row where the call
      returns nothing.
- [ ] Every failure mode the arm's `@throws` lines name is injected through a responder and asserted
      as the `gg.core.ApiError` the program catches.
- [ ] The guest-side refusals for a `tree` depth of zero and a `search` limit of zero assert that
      nothing reached gg's dispatch.
- [ ] The module comment at `kotlin.surface.test.rs:13-18` asks for a function per case and quotes
      the measured build cost.
- [ ] Gates green.
