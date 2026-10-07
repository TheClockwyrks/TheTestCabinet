# Drive gg's workspace SDK modules from Java programs

Give the Java arm a program-level test for every call in its `shell`, `files`,
`memories`, `tasks`, `board` and `skills` modules: one for the successful call
and one for each runtime failure the arm's own Javadoc declares.

## Current state

The arm's crossing table drives all six modules from their Java spellings and
asserts the JSON each call put on the wire
(`crates/gg/src/sandbox/language/java.surface.test.rs:179` for the table,
`:422` for the assertion). It proves the lowering of arguments and nothing about
what a call hands back or what a failed one raises, because every row is answered
by `canned_outcome`.

What a call returns is read back from a Java program in four places, all of them
in `the_documentation_the_views_the_program_library_the_helper_and_the_endings_are_reached_too`:
the `FileRead` a `Views.openFile` hands over, switched across its two arms at
`java.surface.test.rs:484`; `Board.IssueCreated#await` at `:593`;
`Memories.MemoryHit#read` at `:597`; and `Views.close`'s count at `:602`. The
`FileRead` switch is driven with a `notes.md` path, so the text arm runs and the
image arm is written but never taken.

One operation-level failure is driven from a Java program: `files.read_file`
answering `not-found`, caught at `java.surface.test.rs:737` and left to escape at
`:756`. The membrane holds the rest of the story at its own tier —
`crates/gg/src/sandbox/membrane/workspace.test.rs:16` for shell's non-zero exit,
`:67` for the timeout, `:190` for a nonsense timeout, and
`crates/gg/src/sandbox/membrane/knowledge.test.rs:31` for an unknown skill naming
the skills that exist and `:333` for a duplicate task id — so none of it says
whether this arm's SDK turns the answer into an `ApiError` a Java program can
catch.

The harness is already in place. `prepare` (`java.substrate.test.rs:119`) and
`evaluate` (`:146`) are the production compile and the real membrane;
`run_with` (`java.surface.test.rs:147`) wraps both and takes the responder;
`logs` (`java.substrate.test.rs:252`) and `trap` (`:274`) read a program's output
and a program's dying words. The double behind all of them is
`FakeOperationApi` with `CallLog` and `canned_outcome`
(`crates/gg/src/sandbox/fake.test.rs:141`, `:90`, `:780`), so a success case
passes `canned_outcome` and a failure case passes a closure returning
`ToolOutcome::failed(ToolFailure::…, message)`.

## Design

Every case below lands in `crates/gg/src/sandbox/language/java.surface.test.rs`
as its own `#[test]`, named as listed. A failure that is reportable on its own is
the point of the work, so the consolidation comments at
`java.surface.test.rs:13-18` and `java.substrate.test.rs:35-40` are revised in
this issue to direct a reader to add a function per case rather than a statement
to an existing one.

A success case runs the call through `run_with(…, &all_operations(),
canned_outcome)`, logs the fields of what came back and asserts the logged line.
Where `canned_outcome` carries no shape for the case — an empty listing, an empty
match list, an empty hit list — the test passes its own responder returning
`ToolOutcome::ok` with the sidecar it needs. Where the SDK method returns
`void`, the success assertion is the `CallLog` row plus a `Gg.log` line after the
call, which is what says the program ran on past it.

A failure case wraps the call in `catch (ApiError failure)` and logs
`failure.code()`, `failure.operation()` and, where the message is the contract,
`failure.detail()`. Guest-side guards additionally assert `log.names()` is empty,
because the refusal is the SDK's and nothing should reach dispatch.

### shell

- `a_shell_command_hands_java_its_exit_code_and_output` — `Shell.shell("npm test")`
  reads `exitCode`, `output` and `truncated` off the `ShellOutput`.
- `a_non_zero_exit_is_a_shell_output_not_a_throw` — a command whose text contains
  `fail` gives `shell_outcome` (`fake.test.rs:928`) an exit of 1 with no failure
  class; the program reads the code and logs a line after it.
- `a_shell_timeout_is_a_limit_exceeded_api_error` — injected `LimitExceeded`.
- `a_shell_that_could_not_launch_is_an_io_error` — injected `IoError`.
- `a_negative_shell_timeout_is_refused_before_dispatch` —
  `Shell.shell("npm test", -5)` crosses as an `option<f64>`
  (`crates/gg/wit/gg-sandbox.wit:123`) and `clamp_timeout`
  (`crates/gg/src/sandbox/membrane/workspace.rs:266`) refuses it, so the program
  catches `INVALID_ARGUMENT` on `shell` and nothing reached the double.

### files

`Files.readFile`:

- `a_text_read_hands_java_its_window_and_line_numbers` — the `TextFile` arm's
  `contents`, `firstLine`, `lastLine`, `totalLines` and `byteTruncated`.
- `an_image_read_arrives_as_the_image_arm_of_file_read` — a `.png` path gives
  `read_outcome` (`fake.test.rs:945`) the image sidecar; the switch takes the
  `ImageFile` arm and reads `mediaType`, `label`, `bytes` and `shown`.
- The missing-path case is driven at `java.surface.test.rs:737` and `:756` and
  needs nothing further.
- `an_empty_path_read_is_an_argument_error` — injected `InvalidArgument`.

`Files.writeFile`:

- `a_write_hands_java_the_byte_count`.
- `an_empty_path_write_is_an_argument_error`.
- `a_write_that_could_not_land_is_an_io_error`.

`Files.editFile`:

- `an_edit_that_landed_returns_nothing_and_the_program_runs_on`.
- `an_edit_whose_old_text_is_absent_is_not_found`.
- `an_edit_whose_old_text_repeats_is_a_conflict` — the injected message carries
  the match count and `failure.detail()` is asserted to keep it.

`Files.listDir`:

- `a_listing_hands_java_its_entries_and_their_kinds` — the three canned entries,
  their names and their `EntryKind` constants.
- `an_empty_directory_is_an_empty_list` — a responder answering with no entries;
  the list is empty and no exception is raised.
- `the_no_argument_listing_lowers_a_null_path` — `Files.listDir()` records
  `{"path": null}` where `Files.listDir("src")` records `{"path": "src"}`.
- `an_empty_path_listing_is_an_argument_error` — `Files.listDir("")` records
  `{"path": ""}` and the host refuses it, which is the distinction
  `Files.java:117-119` states.
- `a_listing_of_a_missing_directory_is_not_found`.

`Files.tree`:

- `a_tree_hands_java_its_rendered_block`.
- `a_tree_of_a_missing_path_is_not_found`.
- `a_tree_of_a_file_is_an_argument_error`.
- `a_tree_depth_below_one_is_refused_before_dispatch` — the guard at
  `Files.java:197`; the detail names `depth` and nothing reached the double.

`Files.search`:

- `a_search_hands_java_its_matches_with_paths_and_line_numbers`.
- `a_search_that_matched_nothing_is_an_empty_list`.
- `a_blank_search_query_is_an_argument_error`.
- `a_search_pattern_that_does_not_parse_is_an_argument_error`.
- `a_search_under_a_missing_path_is_not_found`.
- `a_search_limit_of_zero_is_refused_before_dispatch` — the guard at
  `Files.java:269`, with the same two assertions the tree guard gets.

### skills

- `a_skill_read_hands_java_the_skill_body`.
- `an_unknown_skill_is_not_found_and_names_the_skills_that_exist` — the injected
  message takes the shape `knowledge.test.rs:31` uses and `failure.detail()` is
  asserted to contain `available skills`, which is the promise
  `Skills.java:31-32` makes.

### memories

`Memories.writeMemory`:

- `a_memory_write_hands_java_its_usage_record` — `count`, `maxCount` and
  `totalChars` off the `MemoryUsage`.
- `a_duplicate_memory_name_is_a_conflict`.
- `a_memory_body_over_the_cap_is_limit_exceeded`.

`Memories.updateMemory`:

- `a_memory_update_hands_java_its_usage_record`.
- `an_update_of_an_unknown_memory_is_not_found`.
- `a_replacement_over_the_cap_is_limit_exceeded`.

`Memories.createMemory`:

- `a_memory_creation_hands_java_its_usage_record`.
- `a_duplicate_memory_slug_is_a_conflict`.
- `memory_contents_over_the_cap_are_limit_exceeded`.
- `a_memory_index_entry_over_the_cap_is_limit_exceeded` — the second of the two
  limits `Memories.java:101-103` names; the two share a code and are told apart
  by the detail each test asserts.

`Memories.readMemory`:

- `a_memory_read_hands_java_its_contents` — the module spelling, alongside the
  member form already driven at `java.surface.test.rs:597`.
- `a_read_of_an_unknown_memory_is_not_found`.

`Memories.editMemory`:

- `a_memory_edit_hands_java_its_usage_record`.
- `an_edit_whose_text_is_absent_is_not_found`.
- `an_edit_whose_text_repeats_is_a_conflict`.
- `an_edit_that_would_overrun_the_cap_is_limit_exceeded`.
- `an_edit_that_would_empty_the_memory_is_an_argument_error`.

`Memories.searchMemories`:

- `a_memory_search_hands_java_its_hits_as_data` — `name`, `description`,
  `matched`, `occurrences` and `excerpt` off the first `MemoryHit`.
- `a_memory_search_that_matched_nothing_is_an_empty_list`.
- `a_search_whose_keywords_are_all_empty_is_an_argument_error`.

`Memories.deleteMemory`:

- `a_memory_deletion_hands_java_its_usage_record`.
- `a_deletion_of_an_unknown_memory_is_not_found`.

### tasks

`Tasks.addTask`:

- `a_task_addition_hands_java_its_usage_record` — `count` and `maxTasks` off the
  `TaskUsage`.
- `a_duplicate_task_id_is_a_conflict`.
- `a_task_edge_that_would_close_a_cycle_is_a_conflict`.

`Tasks.updateTask`:

- `a_task_patch_returns_nothing_and_the_program_runs_on`.
- `an_update_of_an_unknown_task_is_not_found`.
- The `TaskStatus` enum at `Tasks.java:146` is the only way to spell a status on
  this arm, so an unrecognised status word is unwritable here and has no case.

`Tasks.setBlockedBy`:

- `restating_a_tasks_blockers_returns_nothing_and_the_program_runs_on`.
- `blocking_an_unknown_task_is_not_found`.
- `a_task_blocker_edge_that_would_close_a_cycle_is_a_conflict`.

`Tasks.completeTask`:

- `completing_a_task_returns_nothing_and_the_program_runs_on`.
- `completing_an_unknown_task_is_not_found`.

`Tasks.removeTask`:

- `a_task_removal_hands_java_its_usage_record`.
- `removing_an_unknown_task_is_not_found`.

### board

`Board.createEpic`:

- `an_epic_creation_hands_java_its_id_and_board_usage` — `id` off the
  `EpicCreated` and all four fields of the `BoardUsage` behind it.
- `an_epic_prefix_below_three_letters_is_an_argument_error`.
- `an_epic_prefix_above_six_letters_is_an_argument_error`.
- `an_epic_prefix_that_is_not_letters_is_an_argument_error`.
- `an_epic_prefix_another_epic_holds_is_a_conflict`.

`Board.createIssue`:

- `an_issue_creation_hands_java_its_id_and_board_usage` — `created.id()` and
  `created.board()`, which is the half the `await` member at
  `java.surface.test.rs:593` leaves unread.
- `an_agent_this_run_may_not_assign_is_an_argument_error`.
- `a_reviewer_this_run_may_not_assign_is_an_argument_error`.
- `an_issue_blocker_that_would_close_a_cycle_is_a_conflict`.

`Board.updateIssue`:

- `an_issue_patch_returns_nothing_and_the_program_runs_on`.
- `an_update_of_an_unknown_issue_is_not_found`.

`Board.setIssueBlockedBy`:

- `restating_an_issues_blockers_returns_nothing_and_the_program_runs_on`.
- `blocking_an_unknown_issue_is_not_found`.
- `an_issue_blocker_edge_that_would_close_a_cycle_is_a_conflict`.

`Board.removeEpic`:

- `an_epic_removal_hands_java_the_boards_remaining_budget`.
- `removing_an_unknown_epic_is_not_found`.

`Board.removeIssue`:

- `an_issue_removal_hands_java_the_boards_remaining_budget`.
- `removing_an_unknown_issue_is_not_found`.

`Board.waitForIssue`:

- `a_registered_wait_hands_java_its_acknowledgement_and_the_program_runs_on` —
  the wait is registered rather than awaited, so a `Gg.log` line after the call
  is part of the assertion.
- `waiting_on_an_unknown_issue_is_not_found`.
- `waiting_on_this_sessions_own_issue_is_an_argument_error` — the rule
  `Board.java:159` states about the id.

### Javadoc the cases hold the arm to

Two refusals a program can provoke are unnamed by the methods that raise them.
Add `INVALID_ARGUMENT` for an empty path to `Files.readFile`'s `@throws`
(`Files.java:43` and `:61`) and `INVALID_ARGUMENT` for a timeout that is not a
positive number of seconds to `Shell.shell`'s (`Shell.java:35` and `:51`),
following the SDK documentation policies. The catalogue is reflected out of this
Javadoc, so the words a model reads change with it.

## Done when

- [ ] Each case above is its own `#[test]` in `java.surface.test.rs`, carrying the
      name it is listed under.
- [ ] Every success case reads the call's own return value out of the program and
      asserts the logged fields, and every `void` call asserts its `CallLog` row
      and a line logged after it.
- [ ] Every failure case catches an `ApiError` and asserts its code and operation,
      with the detail asserted wherever the message is the contract.
- [ ] The two guest-side guards assert that nothing reached the double.
- [ ] The consolidation comments at `java.surface.test.rs:13-18` and
      `java.substrate.test.rs:35-40` direct a reader to add a function per case.
- [ ] `Files.readFile` and `Shell.shell` name the argument refusals a program can
      provoke, and the reflected catalogue carries the change.
- [ ] Gates green.
