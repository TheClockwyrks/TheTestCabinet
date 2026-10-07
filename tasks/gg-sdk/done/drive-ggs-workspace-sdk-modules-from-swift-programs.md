# Drive gg's workspace SDK modules from Swift programs

Drive every `shell`, `files`, `memories`, `tasks`, `board` and `skills` operation from a real Swift
program: one test for the successful call that reads the post-call state back, and one test for each
distinct runtime failure mode the arm's own `- Throws:` lines name.

## Current state

The operation vocabulary these modules draw from is `crates/gg/src/sandbox/operations.rs:110`
onwards, from `SHELL_SHELL` through `BOARD_WAIT_FOR_ISSUE`. The Swift spellings live in
`packages/gg-sandbox-swift/Sources/SDK/Modules/` — `Shell.swift:32`, `Files.swift:38`,
`Skills.swift:25`, `Memories.swift:36`, `Tasks.swift:26` and `Board.swift:31` — and each function's
`- Throws:` line states the failure modes the cases below assert. Swift's argument labels are part of
each function's name, so `files.editFile("a", replacing: "x", with: "y")` and
`memories.editMemory("m", replacing: "x", with: "y")` are the spellings a case writes.

Every one of these operations already has its argument lowering pinned from its Swift spelling by the
crossing table at `crates/gg/src/sandbox/language/swift.surface.test.rs:100`, driven at `:340`. That
table proves what gg's dispatch saw. What it does not do is read a value back or inject a failure.

Some ground is already held from Swift programs. `files.readFile`'s text success is switched on and
read back at `swift.surface.test.rs:500-509`; its `NotFound` is caught in a `catch ... where` clause
at `:584` and let out uncaught at `:611`; `files.tree`'s rendering is logged at `:669` and its
guest-side depth guard is driven for both `0` and `-1` at `:663`, asserting that only the well-formed
depth reached dispatch at `:673-687`; and `shell.run` refused as `unavailable` is at `:702`.

The harness is the arm's own. `super::substrate::prepare` (`swift.substrate.test.rs:80`) compiles a
whole program through the production prepare step, `evaluate` (`:107`) runs the component against the
real membrane, and `logs` and `sandbox_error` (`:202`, `:217`) read what the model would read. The
surface file wraps those in `run_with` (`swift.surface.test.rs:62`), which is the entry point every
case below uses. The operation side is `crates/gg/src/sandbox/fake.test.rs`: `FakeOperationApi`
(`:141`), `CallLog` with its `names` and `args` readers (`:102`, `:117`), the `canned_outcome`
responder (`:780`) for a successful call, and `all_operations` (`:1151`) for the grant. A failure is
injected by passing a responder returning `ToolOutcome::failed(crate::tools::ToolFailure::<Variant>,
message)`, the way `:584`'s responder already does; the variants are at
`crates/gg/src/tools/data.rs:506-530`.

## Design

Every case is its own `#[test]` in `crates/gg/src/sandbox/language/swift.surface.test.rs`, holding
one short Swift program. The module comment at `swift.surface.test.rs:13-18`, which asks for a
statement added to an existing function, is revised as part of this work to ask for a function per
case and to quote the measured cost from `crates/gg/src/sandbox/language/swift.compile.rs:98-101`: a
`swiftc` is ~0.3 s, the encode ~10 ms and `Component::new` ~1.3 s, with the SDK and the library set
prebuilt so they cost the table nothing, and `cargo nextest` pays the per-process cost in parallel.

A success case grants `all_operations()`, answers with `canned_outcome`, and asserts the value the
program read back through `gg.log`. A failure case answers with a responder returning the named
`ToolFailure`, catches `core.ApiError` in the program, and logs `failure.code` and
`failure.operation` so the assertion is on what the model reads. Where the refusal is raised by the
SDK itself, the case also asserts `log.names().is_empty()`.

Two guest-side guards are added alongside the cases that assert them. `files.readFile`'s `offset` and
`limit` and `files.search`'s `limit` are signed `Int`s lowered with `UInt32(truncatingIfNeeded:)`
(`Files.swift:346-348` and `:211`), so a value below `1` reaches the host as an enormous number
rather than as a refusal. Each gets the guard `files.tree`'s `depth` already has at
`Files.swift:155-159`: an `invalidArgument` `core.ApiError` under the call's own gg name, raised
before anything reaches dispatch.

### shell

- `a_shell_run_hands_a_swift_program_its_exit_code_and_output` — `shell.run("npm test")` logs
  `exitCode`, `output` and `truncated` off the returned `shell.ShellOutput`.
- `a_non_zero_shell_exit_is_a_value_a_swift_program_reads` — a command carrying `fail`, which the
  canned responder exits `1` for (`fake.test.rs:928`), logs `1`, and the line after it still runs.
- `a_shell_timeout_reaches_a_swift_program_as_limit_exceeded` — `LimitExceeded`.
- `a_shell_that_could_not_be_launched_is_an_io_error_in_swift` — `IoError`.
- `a_negative_shell_timeout_is_an_argument_error_in_swift` — `timeout: -4` is refused by the
  membrane's `clamp_timeout` (`crates/gg/src/sandbox/membrane/workspace.rs:266-280`) as
  `invalidArgument`, with nothing reaching dispatch.

### files

`readFile`'s text success is held at `swift.surface.test.rs:500`, its `NotFound` at `:584`, `tree`'s
success at `:669` and `tree`'s depth guard at `:663`.

- `an_image_read_reaches_a_swift_program_as_the_image_case` — `files.readFile("logo.png")` switches
  to `case .image(let picture)` and logs `label`, `bytes` and `shown`, which the canned responder
  answers as a PNG (`fake.test.rs:944-950`).
- `an_empty_path_read_is_an_argument_error_in_swift` — `invalidArgument`.
- `a_read_offset_below_one_is_refused_before_it_is_dispatched_in_swift` — the new guard.
- `a_read_limit_below_one_is_refused_before_it_is_dispatched_in_swift` — the new guard.
- `a_write_hands_a_swift_program_the_byte_count` — `files.writeFile("out.txt", contents: "hello")`
  logs the returned `Int`.
- `an_empty_path_write_is_an_argument_error_in_swift` — `invalidArgument`.
- `a_write_that_could_not_land_is_an_io_error_in_swift` — `IoError`.
- `an_edit_that_succeeded_lets_a_swift_program_carry_on` — `files.editFile` returns nothing, so the
  case asserts the call reached dispatch and the line after it logged.
- `an_edit_whose_old_text_is_absent_is_not_found_in_swift` — `NotFound`.
- `an_edit_whose_old_text_repeats_is_a_conflict_in_swift` — `Conflict`, asserting the match count in
  the message reaches the program.
- `a_listing_hands_a_swift_program_its_entries_and_their_kinds` — `files.listDir("src")` logs each
  `files.DirEntry`'s `name` and `kind`, including `.directory` for `sub`.
- `an_omitted_listing_path_lists_the_root_from_swift` — `files.listDir()` reaches dispatch with no
  `path` key at all.
- `an_empty_listing_path_is_an_argument_error_in_swift` — `invalidArgument`.
- `a_listing_of_a_directory_that_is_not_there_is_not_found_in_swift` — `NotFound`.
- `a_tree_of_a_path_that_is_not_there_is_not_found_in_swift` — `NotFound`.
- `a_tree_of_something_that_is_not_a_directory_is_an_argument_error_in_swift` — `InvalidArgument`.
- `a_search_hands_a_swift_program_its_matches` — `files.search("answer", path: "src")` logs each
  `files.SearchMatch`'s `path`, `line` and `text`.
- `a_search_that_matched_nothing_is_an_empty_array_in_swift` — a responder answering with no matches,
  so the program logs `0` rather than catching anything.
- `a_blank_search_query_is_an_argument_error_in_swift` — `InvalidArgument`.
- `a_search_pattern_that_does_not_parse_is_an_argument_error_in_swift` — `InvalidArgument`.
- `a_search_limit_of_zero_is_an_argument_error_in_swift` — `InvalidArgument` from gg.
- `a_negative_search_limit_is_refused_before_it_is_dispatched_in_swift` — the new guard.
- `a_search_of_a_path_that_is_not_there_is_not_found_in_swift` — `NotFound`.

### skills

- `a_skill_read_hands_a_swift_program_the_skill_body` — `skills.readSkill("testing")` logs the
  returned `String`.
- `an_unknown_skill_is_not_found_in_swift` — `NotFound`, asserting the program reads back a message
  that lists the skills that do exist, the way the membrane phrases it at
  `crates/gg/src/sandbox/membrane/knowledge.test.rs:31-45`.

### memories

- `a_memory_write_hands_a_swift_program_its_budget` — `memories.writeMemory` logs `count`, `maxCount`
  and `totalChars` off the returned `memories.MemoryUsage`.
- `a_duplicate_memory_name_is_a_conflict_in_swift` — `Conflict`.
- `a_memory_body_over_the_cap_is_limit_exceeded_in_swift` — `LimitExceeded`.
- `a_memory_update_hands_a_swift_program_its_budget` — `memories.updateMemory` logs the returned
  `MemoryUsage`.
- `an_update_of_a_memory_that_is_not_there_is_not_found_in_swift` — `NotFound`.
- `a_memory_creation_hands_a_swift_program_its_budget` — `memories.createMemory` logs the returned
  `MemoryUsage`, and the case keeps the crossing's point that `body` lowers onto `contents`.
- `a_duplicate_memory_slug_is_a_conflict_in_swift` — `Conflict`.
- `memory_contents_over_the_cap_are_limit_exceeded_in_swift` — `LimitExceeded`.
- `a_memory_read_hands_a_swift_program_its_contents` — `memories.readMemory("cargo")` logs the
  returned `String`.
- `a_read_of_a_memory_that_is_not_there_is_not_found_in_swift` — `NotFound`.
- `a_memory_edit_hands_a_swift_program_its_budget` — `memories.editMemory` logs the returned
  `MemoryUsage`.
- `an_edit_whose_text_is_absent_from_a_memory_is_not_found_in_swift` — `NotFound`.
- `an_edit_whose_text_repeats_in_a_memory_is_a_conflict_in_swift` — `Conflict`.
- `an_edit_that_would_overrun_a_memory_is_limit_exceeded_in_swift` — `LimitExceeded`.
- `an_edit_that_would_empty_a_memory_is_an_argument_error_in_swift` — `InvalidArgument`.
- `a_memory_hit_hands_a_swift_program_its_ranking` — `memories.searchMemories(["cargo", "nextest"])`
  logs `name`, `description`, `matched`, `occurrences` and `excerpt` off the first
  `memories.MemoryHit`, then reaches the memory through the hit's own `read()`
  (`Memories.swift:264`).
- `a_memory_search_that_matched_nothing_is_an_empty_array_in_swift` — a responder answering with no
  hits, so the program logs `0`.
- `a_memory_search_of_empty_keywords_is_an_argument_error_in_swift` — `InvalidArgument`.
- `a_hit_whose_memory_has_since_gone_is_not_found_in_swift` — `NotFound` raised by `MemoryHit.read()`
  (`Memories.swift:257`).
- `a_memory_deletion_hands_a_swift_program_its_budget` — `memories.deleteMemory` logs the returned
  `MemoryUsage`.
- `a_deletion_of_a_memory_that_is_not_there_is_not_found_in_swift` — `NotFound`.

### tasks

`updateTask`, `setBlockedBy` and `completeTask` return nothing, and their successful calls are pinned
by the crossing rows at `swift.surface.test.rs:196`, `:206` and `:211`.

- `adding_a_task_hands_a_swift_program_its_budget` — `tasks.addTask` logs `count` and `maxTasks` off
  the returned `tasks.TaskUsage`.
- `a_duplicate_task_id_is_a_conflict_in_swift` — `Conflict`, the class the store keeps at
  `crates/gg/src/sandbox/membrane/knowledge.test.rs:334-351`.
- `a_task_edge_that_would_close_a_cycle_is_a_conflict_in_swift` — `Conflict` on an `addTask` carrying
  `blockedBy`.
- `a_task_blocker_that_is_not_there_is_not_found_in_swift` — `NotFound` on `addTask`.
- `a_task_list_at_its_cap_is_limit_exceeded_in_swift` — `LimitExceeded` on `addTask`.
- `an_update_of_a_task_that_is_not_there_is_not_found_in_swift` — `NotFound`.
- `an_update_that_named_nothing_to_change_is_an_argument_error_in_swift` — `InvalidArgument` on
  `tasks.updateTask("t1")` with every edit left at its default.
- `re_blocking_a_task_that_is_not_there_is_not_found_in_swift` — `NotFound` on `tasks.setBlockedBy`.
- `a_blocker_set_that_would_close_a_cycle_is_a_conflict_in_swift` — `Conflict` on
  `tasks.setBlockedBy`.
- `completing_a_task_that_is_not_there_is_not_found_in_swift` — `NotFound`.
- `removing_a_task_hands_a_swift_program_its_budget` — `tasks.removeTask` logs the returned
  `TaskUsage`.
- `removing_a_task_that_is_not_there_is_not_found_in_swift` — `NotFound`.

### board

`updateIssue` and `setIssueBlockedBy` return nothing, and their successful calls are pinned by the
crossing rows at `swift.surface.test.rs:245` and `:263`.

- `creating_an_epic_hands_a_swift_program_its_id_and_budget` — `board.createEpic(prefix: "EPC", ...)`
  logs `id` off the returned `board.EpicCreated` and `epics`, `maxEpics`, `issues` and `maxIssues`
  off its `board`.
- `an_epic_prefix_that_is_not_three_to_six_letters_is_an_argument_error_in_swift` —
  `InvalidArgument`.
- `an_epic_prefix_another_epic_holds_is_a_conflict_in_swift` — `Conflict`.
- `a_board_at_its_epic_cap_is_limit_exceeded_in_swift` — `LimitExceeded`.
- `creating_an_issue_hands_a_swift_program_its_id_and_budget` — `board.createIssue` logs `id` off the
  returned `board.IssueCreated` and the four `board.BoardUsage` fields off its `board`.
- `an_issue_agent_this_run_does_not_permit_is_an_argument_error_in_swift` — `InvalidArgument`.
- `an_issue_reviewer_this_run_does_not_permit_is_an_argument_error_in_swift` — `InvalidArgument`.
- `an_issue_epic_or_blocker_that_is_not_there_is_not_found_in_swift` — `NotFound`.
- `an_issue_blocker_that_would_close_a_cycle_is_a_conflict_in_swift` — `Conflict`.
- `an_update_of_an_issue_or_epic_that_is_not_there_is_not_found_in_swift` — `NotFound`.
- `an_issue_update_that_named_nothing_to_change_is_an_argument_error_in_swift` — `InvalidArgument`.
- `re_blocking_an_issue_that_is_not_there_is_not_found_in_swift` — `NotFound`.
- `an_issue_edge_that_would_close_a_cycle_is_a_conflict_in_swift` — `Conflict` on
  `board.setIssueBlockedBy`.
- `removing_an_epic_hands_a_swift_program_its_budget` — `board.removeEpic` logs the returned
  `BoardUsage`.
- `removing_an_epic_that_is_not_there_is_not_found_in_swift` — `NotFound`.
- `removing_an_issue_hands_a_swift_program_its_budget` — `board.removeIssue` logs the returned
  `BoardUsage`.
- `removing_an_issue_that_is_not_there_is_not_found_in_swift` — `NotFound`.
- `a_wait_is_registered_and_a_swift_program_runs_on` — `board.waitForIssue("ISSUE-1")` logs the
  acknowledgement and the statements after it log too, which is the whole of what deferred
  registration means here; the same case reaches it a second time through `IssueCreated.wait()`
  (`Board.swift:327`).
- `waiting_on_an_issue_that_is_not_there_is_not_found_in_swift` — `NotFound`.
- `waiting_on_this_sessions_own_issue_is_an_argument_error_in_swift` — `InvalidArgument`.

## Done when

- [ ] Each case above is its own `#[test]` in
      `crates/gg/src/sandbox/language/swift.surface.test.rs`, driving one short Swift program.
- [ ] Every successful call in `shell`, `files`, `memories`, `tasks`, `board` and `skills` has a
      Swift program that reads its post-call state back, or a cited crossing row where the call
      returns nothing.
- [ ] Every failure mode the arm's `- Throws:` lines name is injected through a responder and
      asserted as the `core.ApiError` the program catches, under gg's own operation key.
- [ ] `files.readFile`'s `offset` and `limit` and `files.search`'s `limit` refuse a value below `1`
      in the SDK, and their cases assert that nothing reached gg's dispatch.
- [ ] The module comment at `swift.surface.test.rs:13-18` asks for a function per case and quotes the
      measured build cost.
- [ ] Gates green.
