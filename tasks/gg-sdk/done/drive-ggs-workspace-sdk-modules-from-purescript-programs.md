# Drive gg's workspace SDK modules from PureScript programs

Give the PureScript arm a short program-level test for every successful call and
every distinct runtime failure of `shell`, `files`, `memories`, `tasks`, `board`
and `skills`, so that each result the SDK builds and each `ApiError` it lowers is
read back by a real PureScript program rather than inferred from the arguments
that crossed.

## Current state

The arm's substrate tests live in
`crates/gg/src/sandbox/language/purescript.substrate.test.rs`. It already has the
whole harness these tests need: `prepare` (:62) and `prepare_with` (:67) run the
production `purs`/`esbuild` step, `evaluate` (:80) drives the compiled bundle
through `run_prepared_program` against the real membrane, `run_with` (:147) and
`run_as` (:128) compile and run in one call, `logs` (:169) reads what a program
printed while insisting it did not fail, `trapped` (:189) reads what the model
sees when it did, and `program_of` (:1111) builds a program importing every
catalogue module from a list of statements. The double behind all of it is
`crates/gg/src/sandbox/fake.test.rs`: `FakeOperationApi` (:141), built with
`FakeOperationApi::with` (:256) from a responder, `CallLog` (:90) with `names`
(:102) and `args` (:117), and `canned_outcome` (:780), whose answers for these
modules are the fixed values every success assertion below is written against.

`every_operation_crosses_the_membrane_from_its_purescript_spelling` (:1132)
drives all twenty-seven of these operations from their PureScript spellings and
asserts the JSON each carried, so the argument half of every crossing is settled.
It answers with `canned_outcome` and discards every result, so what the SDK
builds out of an answer is untested apart from four places:
`a_convenience_function_reaches_the_operation_it_is_an_alias_of` (:1199) reads
`issue.id` off `Gg.Board.createIssue` and a hit's `name` off
`Gg.Memories.searchMemories` (:1213-1218, asserted :1255-1258), and the docs and
views families are covered in the neighbouring test at :1291.

Three failures already reach a PureScript program.
`a_capability_this_run_withheld_is_refused_as_unavailable` (:1496) catches a
`not-found` from `Gg.Files.readFile` with `Gg.Core.attempt` and branches on its
code and operation (:1519-1542). `a_located_failure_names_the_model_s_own_purescript`
(:437) drives an uncaught `not-found` from `Gg.Files.readFile` (:497) and an
uncaught `not-found` from `Gg.Files.editFile` (:548).
`g8_a_runtime_failure_reaches_the_model` (:1678) carries the uncaught
`Gg.Files.readFile` `not-found` again as its `ApiError` case. Every other runtime
failure of these modules is answered at the membrane or not at all.

The operation vocabulary is `crates/gg/src/sandbox/operations.rs:110-189`, and
each function's declared failures are the `# Throws` block of its definition
under `packages/gg-sandbox-purescript/src/Gg/`.

## Design

Each case below is its own `#[test]` in
`crates/gg/src/sandbox/language/purescript.substrate.test.rs`, compiling one
small program and asserting one thing. The file's consolidation note (:24-29) is
revised as part of this work: it justifies many programs per test function by a
per-process guest compile and a 1.4 MB library unpack, and
`crates/gg/src/sandbox/language/purescript.compile.rs:66` and :1036 record that
the tree is content-keyed and unpacked once per machine, with a whole program
costing ~298 ms end to end (:37-47). Revise it to say that a case gets its own
function and that a table over the whole vocabulary stays one program.

A success case runs `run_with(&program_of(&[…]), &all_operations(), &[],
canned_outcome)` and asserts `logs(&outcome)` against the values
`canned_outcome` hands back for that tool. A failure case runs the same program
against a responder of the shape at :1535-1540, returning
`ToolOutcome::failed(crate::tools::ToolFailure::X, "…".to_string())`, and the
program catches with `Gg.Core.attempt` and logs
`show failure.code <> " " <> failure.operation <> " " <> failure.message`. Every
failure assertion names the code, the operation key from `operations.rs`, and the
part of the message that is the promise being kept.

`program_of` emits neither `Data.Either` nor `Effect.Class.Console`, and the
existing cases patch them in with the `.replace` at :1528-1532. Lift that into a
helper beside `program_of` — one that takes the statements and returns the
program with both imports already in it — so each test below is its statements
and its assertion and nothing else.

### shell

- `a_shell_command_hands_the_program_its_exit_code_and_output` — `Gg.Shell.shell
  "npm test" {}` logs `exitCode`, `output` and `truncated`.
- `a_non_zero_exit_is_a_value_the_program_reads_rather_than_a_throw` — a command
  whose text contains `fail` gives `exitCode` of `Just 1`, and the program logs a
  line after the call.
- `a_shell_timeout_reaches_a_purescript_program_as_limit_exceeded`.
- `a_shell_that_could_not_be_launched_reaches_a_program_as_an_io_error`.
- `a_negative_shell_timeout_reaches_a_program_as_an_argument_error` — `{
  timeoutSecs: -1 }`, refused by `clamp_timeout`
  (`crates/gg/src/sandbox/membrane/workspace.rs:266`); the message names
  `timeout_secs`.

### files

- `a_text_read_hands_a_purescript_program_the_text_file_arm` — a `case` over
  `FileRead` logging `contents`, `firstLine`, `lastLine`, `totalLines` and
  `byteTruncated`.
- `an_image_read_hands_a_purescript_program_the_image_file_arm` — a path ending
  `.png` takes the other arm, logging `mediaType`, `label`, `bytes`, `shown` and
  `notShownReason`.
- `an_empty_read_path_reaches_a_program_as_an_argument_error`.
- A missing read path is covered at :1519-1542 and again uncaught at :497.
- `a_write_hands_the_program_the_byte_count_it_wrote`.
- `an_empty_write_path_reaches_a_program_as_an_argument_error`.
- `a_write_that_failed_reaches_a_program_as_an_io_error`.
- `an_edit_that_matched_lets_the_program_carry_on` — `Gg.Files.editFile` answers
  with `Unit`, so the post-call state is the later line the program logs.
- An edit whose text is absent is covered at :548.
- `an_ambiguous_edit_reaches_a_program_as_a_conflict_carrying_the_count` — the
  message the program logs names how many times the text appeared.
- `a_listing_hands_the_program_its_entries_with_their_kinds` — `show` over the
  entries' `name` and `kind`, which puts `FileEntry` and `DirectoryEntry` in the
  log.
- `an_omitted_listing_path_lists_the_workspace_root` — `Gg.Files.listDir {}`
  succeeds and `log.args("list_dir")` carries no path.
- `an_empty_listing_is_an_empty_array_rather_than_a_failure`.
- `an_empty_listing_path_reaches_a_program_as_an_argument_error` — `{ path: "" }`,
  the case the omitted form is distinguished from.
- `a_listing_of_a_missing_directory_reaches_a_program_as_not_found`.
- `a_tree_hands_the_program_its_rendering`.
- `a_tree_of_a_missing_path_reaches_a_program_as_not_found`.
- `a_tree_rooted_at_a_file_reaches_a_program_as_an_argument_error`.
- `a_tree_depth_of_zero_reaches_a_program_as_an_argument_error`.
- `a_search_hands_the_program_its_matches` — each match's `path`, `line` and
  `text`.
- `a_blank_search_query_reaches_a_program_as_an_argument_error`.
- `a_search_pattern_that_does_not_parse_reaches_a_program_as_an_argument_error`.
- `a_search_limit_of_zero_reaches_a_program_as_an_argument_error`.
- `a_search_under_a_missing_path_reaches_a_program_as_not_found`.

### skills

- `a_skill_read_hands_the_program_the_skill_body`.
- `an_unknown_skill_reaches_a_program_as_not_found_listing_the_skills_that_exist`
  — the caught message contains `available skills`, which is the promise
  `packages/gg-sandbox-purescript/src/Gg/Skills.purs:34` makes.

### memories

Every call in this module that answers with a `MemoryUsage` gets one success test
logging `count`, `maxCount`, `totalChars`, `maxTotalChars` and `indexChars`, so
the `Maybe` fields are read as well as the totals.

- `a_memory_write_hands_the_program_the_budget_it_left`.
- `a_duplicate_memory_name_reaches_a_program_as_a_conflict`.
- `a_memory_body_over_the_cap_reaches_a_program_as_limit_exceeded`.
- `a_memory_update_hands_the_program_the_budget_it_left`.
- `an_update_of_an_unknown_memory_reaches_a_program_as_not_found`.
- `a_replacement_body_over_the_cap_reaches_a_program_as_limit_exceeded` — the
  `# Throws` block at `Memories.purs:136-138` gains this line as part of the
  work, so the documented surface and the tested one agree.
- `a_memory_creation_hands_the_program_the_budget_it_left`.
- `a_duplicate_memory_slug_reaches_a_program_as_a_conflict`.
- `memory_contents_over_the_cap_reach_a_program_as_limit_exceeded`.
- `a_memory_index_entry_over_the_cap_reaches_a_program_as_limit_exceeded` — the
  second of the two limits `Memories.purs:176-177` names under one code; the
  message is what tells them apart.
- `a_memory_read_hands_the_program_its_body`.
- `a_read_of_an_unknown_memory_reaches_a_program_as_not_found`.
- `a_memory_edit_hands_the_program_the_budget_it_left`.
- `a_memory_edit_that_matched_nothing_reaches_a_program_as_not_found`.
- `an_ambiguous_memory_edit_reaches_a_program_as_a_conflict`.
- `a_memory_edit_over_the_cap_reaches_a_program_as_limit_exceeded`.
- `an_edit_that_would_empty_a_memory_reaches_a_program_as_an_argument_error`.
- `a_memory_hit_carries_its_counts_and_excerpt_into_the_program` — `description`,
  `matched`, `occurrences` and `excerpt`, the fields the hit at :1213-1218 leaves
  unread.
- `a_memory_search_that_matched_nothing_is_an_empty_array`.
- `a_memory_search_of_empty_keywords_reaches_a_program_as_an_argument_error`.
- `a_memory_deletion_hands_the_program_the_budget_it_left`.
- `a_deletion_of_an_unknown_memory_reaches_a_program_as_not_found`.

### tasks

`Gg.Tasks.TaskStatus` is a closed sum, so an unrecognised status word is a
program that does not compile and needs no test. The three calls answering with
`Unit` assert the line the program logs after the call.

- `a_task_addition_hands_the_program_the_task_budget` — `count` and `maxTasks`.
- `a_duplicate_task_id_reaches_a_program_as_a_conflict`.
- `an_added_task_blocked_into_a_cycle_reaches_a_program_as_a_conflict` — the
  second cause behind the same code, told apart by its message.
- `a_task_update_lets_the_program_carry_on`.
- `an_update_of_an_unknown_task_reaches_a_program_as_not_found`.
- `setting_a_tasks_blockers_lets_the_program_carry_on`.
- `setting_blockers_on_an_unknown_task_reaches_a_program_as_not_found`.
- `setting_task_blockers_into_a_cycle_reaches_a_program_as_a_conflict`.
- `completing_a_task_lets_the_program_carry_on`.
- `completing_an_unknown_task_reaches_a_program_as_not_found`.
- `a_task_removal_hands_the_program_the_task_budget`.
- `removing_an_unknown_task_reaches_a_program_as_not_found`.

### board

Each success test that reads a `BoardUsage` logs `epics`, `maxEpics`, `issues`
and `maxIssues`, whose canned values are at `fake.test.rs:1126-1133`.

- `an_epic_creation_hands_the_program_its_id_and_the_board_budget`.
- `an_epic_prefix_under_three_letters_reaches_a_program_as_an_argument_error`.
- `an_epic_prefix_over_six_letters_reaches_a_program_as_an_argument_error`.
- `an_epic_prefix_that_is_not_letters_reaches_a_program_as_an_argument_error`.
- `a_prefix_another_epic_holds_reaches_a_program_as_a_conflict`.
- `an_issue_creation_hands_the_program_its_id_and_the_board_budget` — the id is
  read at :1255; this adds `issue.board`.
- `an_agent_this_session_may_not_assign_reaches_a_program_as_an_argument_error`.
- `a_reviewer_this_session_may_not_assign_reaches_a_program_as_an_argument_error`.
- `an_issue_blocked_into_a_cycle_reaches_a_program_as_a_conflict`.
- `an_issue_update_lets_the_program_carry_on`.
- `an_update_of_an_unknown_issue_reaches_a_program_as_not_found`.
- `setting_an_issues_blockers_lets_the_program_carry_on`.
- `setting_blockers_on_an_unknown_issue_reaches_a_program_as_not_found`.
- `setting_issue_blockers_into_a_cycle_reaches_a_program_as_a_conflict`.
- `an_epic_removal_hands_the_program_the_board_budget`.
- `removing_an_epic_that_still_holds_issues_hands_back_the_ungrouped_board` — the
  epic's issues survive and are ungrouped
  (`packages/gg-sandbox-purescript/src/Gg/Board.purs:249`), so the returned
  `BoardUsage` is the whole signal and the program logs it.
- `removing_an_unknown_epic_reaches_a_program_as_not_found`.
- `an_issue_removal_hands_the_program_the_board_budget`.
- `removing_an_unknown_issue_reaches_a_program_as_not_found`.
- `a_registered_wait_hands_the_program_its_acknowledgement_and_runs_on` — the
  call answers at once, so the program logs the acknowledgement and then a second
  line, which is what proves the wait is registered rather than blocking
  (`Board.purs:291-294`).
- `waiting_on_an_unknown_issue_reaches_a_program_as_not_found`.
- `waiting_on_this_sessions_own_issue_reaches_a_program_as_an_argument_error`.

## Done when

- [ ] Every operation of `shell`, `files`, `memories`, `tasks`, `board` and
      `skills` has a PureScript program asserting what a successful call handed
      back, either newly written or already cited above.
- [ ] Every distinct runtime failure listed above has its own PureScript test
      asserting the caught `ApiError`'s code, operation and message.
- [ ] Each new test is one program and one assertion.
- [ ] The import helper beside `program_of` supplies `Data.Either` and
      `Effect.Class.Console`, and the cases at :1519-1542 use it.
- [ ] The consolidation note at the head of the file states that a case gets its
      own function.
- [ ] `Gg.Memories.updateMemory`'s `# Throws` block names `LimitExceeded`.
- [ ] Gates green.
