# Drive gg's workspace SDK modules from TypeScript programs

Give the TypeScript arm a short, focused test for every `shell`, `files`, `memories`, `tasks`,
`board` and `skills` call the SDK offers, and for every distinct runtime failure each one
documents, each driven by a program the model could have written and answered by a synthesized
outcome.

## Current state

The operation vocabulary these modules cover is
`crates/gg/src/sandbox/operations.rs:110` through `:189`, and the arm spells each one in
`packages/gg-sandbox/src/gg/` — `shell.ts:49`, `files.ts:122`, `memories.ts:159`, `tasks.ts:67`,
`board.ts:148` and `skills.ts:27` are the first of each module. The catalogue the model reads is
reflected out of those same declarations (`crates/gg/src/sandbox/language/typescript.rs:72`), so
the spelling a test writes is the spelling the model is told.

The arguments every one of these calls carries are already pinned from a real program. The crossing
table at `crates/gg/src/sandbox.membrane.test.rs:27` runs a one-line TypeScript program per tool
through the real `tsc` and the real guest and asserts the exact JSON that reached dispatch —
`shell` at `:30`, the six `files` calls at `:35` through `:60`, `read_skill` at `:65`, the seven
`memories` calls at `:70` through `:100`, the five `tasks` calls at `:105` through `:129`, and the
seven `board` calls at `:134` through `:192`. The table is exhaustive by construction
(`crates/gg/src/sandbox.membrane.test.rs:283`). What it does not do is read a returned value back
or drive a failure.

Some cases are therefore already held, and the work below leaves them alone:

- `readFile` answered `not-found`, uncaught, located at the model's own line —
  `crates/gg/src/sandbox/language/typescript.substrate.test.rs:120` and
  `crates/gg/src/sandbox.faults.test.rs:29`; caught and read back as `code`/`operation` at
  `crates/gg/src/sandbox.faults.test.rs:80`.
- `editFile` answered `conflict`, with the match count surviving onto the caught error —
  `crates/gg/src/sandbox.faults.test.rs:110`.
- `readFile` given a number where a string belongs, and `addTask` missing a required field —
  `crates/gg/src/sandbox.faults.test.rs:299`.
- `readFile` given a negative `offset`, refused guest-side before the wrap —
  `crates/gg/src/sandbox.faults.test.rs:199`.
- `shell` given its options object positionally — `crates/gg/src/sandbox.faults.test.rs:190`.
- `addTask` with `blockedBy` omitted, defaulted to `[]` — `crates/gg/src/sandbox.faults.test.rs:210`.
- `searchMemories` and `readMemory` read back as typed data, and `createMemory`'s returned
  `MemoryUsage` — `crates/gg/src/sandbox.test.rs:369`.
- `updateTask` clearing a description through `null`, and `updateIssue`'s omitted-versus-null
  distinction — `crates/gg/src/sandbox.membrane.test.rs:110` and `:160`.

### Harness

Everything below reuses what the arm already runs on. `crates/gg/src/sandbox.test.rs:36` `run`
evaluates a TypeScript program with every operation granted and the canned answers; `:52`
`run_with` takes the granted set, the limits and a responder, which is how a failure is
synthesized; `:130` `logs` is what a program said, `:159` `logged_json` is its one line parsed,
`:147` `uncaught` is the throw it did not catch, and `:198` `program_failure` is what the model
reads when it did not. The double behind them is
`crates/gg/src/sandbox/fake.test.rs` — `CallLog` at `:88` records the exact JSON each call carried,
`FakeOperationApi` at `:129` is the `OperationApi` the membrane calls, and `canned_outcome` at
`:773` answers every tool plausibly, with `shell` exiting non-zero for a command containing `fail`
(`:928`) and `read_file` answering a `.png` path with the image variant (`:946`).

A failure case follows the shape at `crates/gg/src/sandbox.faults.test.rs:30`: a responder that
answers one tool name with `ToolOutcome::failed(ToolFailure::…, "…")` and defers to
`canned_outcome` for the rest. The program catches the `ApiError` and logs its `code`, its
`operation` and its message, so the assertion reads what the model reads.

## Design

Two new submodules of `crates/gg/src/sandbox.test.rs`, declared beside the existing `#[path]`
declarations at `crates/gg/src/sandbox.test.rs:26`, sharing its helpers the way
`sandbox.membrane.test.rs` and `sandbox.faults.test.rs` do:

- `crates/gg/src/sandbox.workspace.test.rs` — `shell`, `files` and `skills`.
- `crates/gg/src/sandbox.knowledge.test.rs` — `memories`, `tasks` and `board`.

Each case is its own `#[test]`, named as a sentence, driving one program. The note at
`crates/gg/src/sandbox.test.rs:3` that tells a reader to add a program to an existing function
rather than adding a function is revised as part of this work: the component is compiled once per
process and an instantiation costs microseconds (`crates/gg/src/sandbox.membrane.test.rs:12`), so a
case earns its own function and its own name.

Every `not-found`, `conflict`, `limit-exceeded`, `invalid-argument` and `io-error` case asserts the
caught `ApiError`'s `code`, its `operation` spelled as the tool name, and that the injected message
survives to the program.

### shell

| Test | Program and answer |
| --- | --- |
| `a_shell_run_hands_back_the_exit_code_and_output` | `gg.shell.shell("npm test")`, canned; logs `exitCode` and the output body |
| `a_non_zero_exit_is_a_value_rather_than_a_throw` | `gg.shell.shell("npm test || fail")`, canned; the program runs on and logs the non-zero `exitCode` without catching anything |
| `a_shell_timeout_is_a_limit_exceeded_the_program_catches` | `limit-exceeded` injected for `shell` |
| `a_shell_that_could_not_launch_is_an_io_error` | `io-error` injected for `shell` |
| `a_nonsense_shell_timeout_is_refused_before_the_call` | `{ timeoutSecs: Number.NaN }`; the guard at `packages/gg-sandbox/src/internal/errors.ts:232` throws `invalid-argument` naming `timeoutSecs`, and the call log is empty |

### files

| Test | Program and answer |
| --- | --- |
| `a_text_read_arrives_as_the_text_variant` | `gg.files.readFile("src/a.ts")`, canned; logs the contents and the line numbers off `TextFile` |
| `an_image_read_arrives_as_the_image_variant` | `gg.files.readFile("logo.png")`, canned; logs the label, the byte count and whether it was shown, and that the text fields are absent |
| `an_empty_read_path_is_an_argument_error` | `gg.files.readFile("")`; `invalid-argument` injected for `read_file`, and the log shows `path` crossed as `""` |
| `a_write_hands_back_the_byte_count` | `gg.files.writeFile("out.txt", "hello")`, canned; logs the returned number |
| `an_empty_write_path_is_an_argument_error` | `invalid-argument` injected for `write_file` |
| `a_write_that_fails_on_disk_is_an_io_error` | `io-error` injected for `write_file` |
| `an_edit_whose_old_text_is_absent_is_not_found` | `not-found` injected for `edit_file` |
| `a_listing_hands_back_its_entries_and_their_kinds` | `gg.files.listDir("src")`, canned; logs each entry's `name` and `kind` |
| `an_empty_directory_is_an_empty_list` | responder answers `list_dir` with no entries; the program logs a length of zero and does not catch |
| `an_empty_listing_path_is_an_argument_error` | `gg.files.listDir("")`; `invalid-argument` injected, and the log shows `path` crossed as `""` rather than the null an omitted path lowers to |
| `a_listing_of_a_directory_that_is_not_there_is_not_found` | `not-found` injected for `list_dir` |
| `a_tree_hands_back_its_rendering` | `gg.files.tree({ path: "src", depth: 3 })`, canned; logs the returned string |
| `a_tree_of_a_path_that_is_not_there_is_not_found` | `not-found` injected for `tree` |
| `a_tree_of_something_that_is_not_a_directory_is_an_argument_error` | `invalid-argument` injected for `tree` |
| `a_tree_depth_of_zero_is_refused_before_the_call` | `{ depth: 0 }`; the guard at `packages/gg-sandbox/src/gg/files.ts:214` throws `invalid-argument` naming `depth`, and the call log is empty |
| `a_search_hands_back_its_matches_with_paths_and_line_numbers` | `gg.files.search("todo")`, canned; logs each `SearchMatch` |
| `a_blank_search_query_is_an_argument_error` | `invalid-argument` injected for `search` |
| `a_search_pattern_that_does_not_parse_is_an_argument_error` | `invalid-argument` injected for `search`, message naming the regex |
| `a_search_limit_of_zero_is_refused_before_the_call` | `{ limit: 0 }`; the guard at `packages/gg-sandbox/src/gg/files.ts:260` throws, and the call log is empty |
| `a_search_under_a_path_that_is_not_there_is_not_found` | `not-found` injected for `search` |

### skills

| Test | Program and answer |
| --- | --- |
| `a_skill_read_hands_back_its_body` | `gg.skills.readSkill("testing")`, canned; logs the contents |
| `an_unknown_skill_is_not_found_and_names_the_skills_that_exist` | `not-found` injected for `read_skill` with a message ending `available skills: testing`; the program asserts that sentence reaches it, mirroring `crates/gg/src/sandbox/membrane/knowledge.test.rs:31` at the membrane |

### memories

| Test | Program and answer |
| --- | --- |
| `a_memory_write_hands_back_the_budget` | `gg.memories.writeMemory({ … })`, canned; logs `count`, `maxCount`, `indexChars` |
| `a_duplicate_memory_name_is_a_conflict` | `conflict` injected for `write_memory` |
| `a_memory_body_over_the_cap_is_limit_exceeded` | `limit-exceeded` injected for `write_memory` |
| `a_memory_update_hands_back_the_budget` | `gg.memories.updateMemory({ … })`, canned |
| `an_update_of_a_memory_that_is_not_there_is_not_found` | `not-found` injected for `update_memory` |
| `a_memory_replacement_over_the_cap_is_limit_exceeded` | `limit-exceeded` injected for `update_memory` |
| `a_duplicate_memory_slug_is_a_conflict` | `conflict` injected for `create_memory` |
| `a_created_memory_over_the_cap_is_limit_exceeded` | `limit-exceeded` injected for `create_memory` |
| `a_read_of_a_memory_that_is_not_there_is_not_found` | `not-found` injected for `read_memory` |
| `a_memory_edit_returns_the_budget` | `gg.memories.editMemory({ … })`, canned |
| `a_memory_edit_whose_text_is_absent_is_not_found` | `not-found` injected for `edit_memory` |
| `a_memory_edit_whose_text_repeats_is_a_conflict` | `conflict` injected for `edit_memory` |
| `a_memory_edit_that_grows_past_the_cap_is_limit_exceeded` | `limit-exceeded` injected for `edit_memory` |
| `a_memory_edit_that_would_empty_it_is_an_argument_error` | `invalid-argument` injected for `edit_memory` |
| `a_search_hit_reads_its_own_memory` | `gg.memories.searchMemories(["cargo"])[0].read()`, canned; asserts the member helper supplies the hit's name, so the log shows `search_memories` followed by `read_memory` carrying that name |
| `a_memory_search_with_nothing_to_match_is_an_empty_list` | responder answers `search_memories` with no hits; the program logs a length of zero and does not catch |
| `a_memory_search_of_only_blank_keywords_is_an_argument_error` | `invalid-argument` injected for `search_memories` |
| `a_memory_delete_hands_back_the_budget` | `gg.memories.deleteMemory("build-commands")`, canned |
| `a_delete_of_a_memory_that_is_not_there_is_not_found` | `not-found` injected for `delete_memory` |

### tasks

| Test | Program and answer |
| --- | --- |
| `an_added_task_hands_back_the_task_budget` | `gg.tasks.addTask({ id: "t1", title: "T" })`, canned; logs the `TaskUsage` fields |
| `a_duplicate_task_id_is_a_conflict` | `conflict` injected for `add_task`, message naming the id |
| `a_task_blocker_that_would_close_a_cycle_is_a_conflict` | `conflict` injected for `add_task`, message naming the cycle; a separate cause from the duplicate id above and therefore its own test |
| `a_task_update_reaches_the_board_and_returns_nothing` | `gg.tasks.updateTask("t1", { status: "in_progress" })`, canned; logs that the program continued |
| `an_update_of_a_task_that_is_not_there_is_not_found` | `not-found` injected for `update_task` |
| `an_unrecognised_task_status_is_refused_by_the_compiler` | `status: "underway"` behind `as any`; the case asserts the compile refusal names the status, since `TaskStatus` at `packages/gg-sandbox/src/gg/tasks.ts:16` is a union |
| `blockers_set_on_a_task_clear_when_the_list_is_empty` | `gg.tasks.setBlockedBy("t1", [])`, canned; the program runs on |
| `setting_blockers_on_a_task_that_is_not_there_is_not_found` | `not-found` injected for `set_blocked_by` |
| `a_blocker_edge_that_would_close_a_cycle_is_a_conflict` | `conflict` injected for `set_blocked_by` |
| `a_completed_task_returns_nothing_and_the_program_runs_on` | `gg.tasks.completeTask("t1")`, canned |
| `completing_a_task_that_is_not_there_is_not_found` | `not-found` injected for `complete_task` |
| `a_removed_task_hands_back_the_task_budget` | `gg.tasks.removeTask("t1")`, canned |
| `removing_a_task_that_is_not_there_is_not_found` | `not-found` injected for `remove_task` |

### board

| Test | Program and answer |
| --- | --- |
| `a_created_epic_hands_back_its_upper_cased_id` | `gg.board.createEpic({ prefix: "auth", … })`, canned; logs `id` and the `BoardUsage` fields |
| `an_epic_prefix_that_is_too_short_is_an_argument_error` | `invalid-argument` injected for `create_epic` |
| `an_epic_prefix_that_is_too_long_is_an_argument_error` | `invalid-argument` injected for `create_epic` |
| `an_epic_prefix_that_is_not_letters_is_an_argument_error` | `invalid-argument` injected for `create_epic` |
| `an_epic_prefix_another_epic_holds_is_a_conflict` | `conflict` injected for `create_epic` |
| `a_created_issue_hands_back_the_id_the_board_assigned` | `gg.board.createIssue({ … })`, canned; logs `id`, `board.issues` and `board.maxIssues` |
| `an_issue_assigned_to_an_agent_that_cannot_take_it_is_an_argument_error` | `invalid-argument` injected for `create_issue`, message naming the agent |
| `an_issue_reviewer_that_cannot_take_it_is_an_argument_error` | `invalid-argument` injected for `create_issue`, message naming the reviewer; a separate cause from the agent above |
| `an_issue_blocker_that_would_close_a_cycle_is_a_conflict` | `conflict` injected for `create_issue` |
| `a_created_issue_waits_on_itself_through_its_own_handle` | `gg.board.createIssue({ … }).wait()`, canned; asserts the member helper supplies the minted id, so the log shows `create_issue` then `wait_for_issue` carrying it |
| `an_issue_update_reaches_the_board_and_the_program_runs_on` | `gg.board.updateIssue("EPIC-1", { … })`, canned |
| `an_update_of_an_issue_that_is_not_there_is_not_found` | `not-found` injected for `update_issue` |
| `blockers_set_on_an_issue_clear_when_the_list_is_empty` | `gg.board.setIssueBlockedBy("EPIC-1", [])`, canned |
| `setting_blockers_on_an_issue_that_is_not_there_is_not_found` | `not-found` injected for `set_issue_blocked_by` |
| `an_issue_blocker_edge_that_would_close_a_cycle_is_a_conflict` | `conflict` injected for `set_issue_blocked_by` |
| `a_removed_epic_hands_back_the_board_budget` | `gg.board.removeEpic("EPIC")`, canned; logs the remaining counts |
| `removing_an_epic_that_is_not_there_is_not_found` | `not-found` injected for `remove_epic` |
| `removing_an_epic_that_still_holds_issues_shows_in_the_budget` | responder answers `remove_epic` with a `BoardUsage` whose issue count is unchanged; the program logs that count, which is the only signal it gets |
| `a_removed_issue_hands_back_the_board_budget` | `gg.board.removeIssue("EPIC-1")`, canned |
| `removing_an_issue_that_is_not_there_is_not_found` | `not-found` injected for `remove_issue` |
| `a_registered_wait_lets_the_rest_of_the_program_run` | `gg.board.waitForIssue("EPIC-1")` followed by two more calls; asserts the acknowledgement is logged and both later calls reached dispatch, so the wait is registered rather than blocking |
| `waiting_on_an_issue_that_is_not_there_is_not_found` | `not-found` injected for `wait_for_issue` |
| `waiting_on_this_sessions_own_issue_is_an_argument_error` | `invalid-argument` injected for `wait_for_issue` |

## Done when

- [ ] `crates/gg/src/sandbox.workspace.test.rs` and `crates/gg/src/sandbox.knowledge.test.rs` exist, are declared as submodules of `crates/gg/src/sandbox.test.rs`, and hold the cases above as one test each.
- [ ] Every `shell`, `files`, `memories`, `tasks`, `board` and `skills` call in `crates/gg/src/sandbox/operations.rs:110`–`:189` has a TypeScript program that succeeds and reads the post-call state back.
- [ ] Every failure each of those calls documents in its `@throws` line has its own TypeScript program that catches the `ApiError` and asserts its `code`, its `operation` and its message.
- [ ] No test invokes a real model or provider; every answer comes from `FakeOperationApi`.
- [ ] The consolidation note at `crates/gg/src/sandbox.test.rs:3` reads as guidance to give a case its own function and its own name.
- [ ] Gates green.
