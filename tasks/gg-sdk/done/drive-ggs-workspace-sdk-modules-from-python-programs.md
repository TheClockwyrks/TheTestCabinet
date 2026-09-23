# Drive gg's workspace SDK modules from Python programs

Give the Python arm a program-level test for every call in `shell`, `files`,
`memories`, `tasks`, `board` and `skills`: one for the successful call, asserting
what the program reads back, and one for each distinct runtime failure a
well-typed call can hit.

## Current state

The arm's programs run through `run_with` at
`crates/gg/src/sandbox/language/python.substrate.test.rs:84`, which instantiates
the embedded guest against the real membrane with
`FakeOperationApi` (`crates/gg/src/sandbox/fake.test.rs:141`) behind it and a
`CallLog` (`crates/gg/src/sandbox/fake.test.rs:90`) recording the JSON each call
arrived as. `run_as` (`:135`) is the same thing with the ending group and the
program library said explicitly. `logs` (`:206`) reads what a program printed and
insists it did not throw; `program_error` (`:221`) reads the throw it did not
catch. `canned_outcome` (`crates/gg/src/sandbox/fake.test.rs:780`) answers every
operation with a fixed success, and a responder closure standing in for it
injects one `ToolOutcome::failed` for the call under test and defers the rest —
the shape at `python.substrate.test.rs:1559-1566`.

`every_operation_crosses_the_membrane_from_its_python_spelling`
(`python.substrate.test.rs:1400`) already asserts, for every operation, that the
Python spelling reaches gg's dispatch under the right tool name with the right
arguments, and is exhaustive by construction against
`sandbox_operation_names()`. That is the argument half. What a program reads back
from a successful call, and what it gets when a call fails, is covered for a
handful of calls and absent for the rest.

The failure classes a call can carry are `ToolFailure`'s variants at
`crates/gg/src/tools/data.rs:506`. Four refusals happen guest-side, before the
host is reached: `_uint` at `packages/gg-sandbox-python/src/gg/core.py:154` for
`read_file`'s `offset` and `limit`, `tree`'s `depth` and `search`'s `limit`;
`_positive` at `core.py:173` for `shell`'s `timeout_secs`; and the two explicit
zero guards at `packages/gg-sandbox-python/src/gg/files.py:292` and `:338`. A
guest-side refusal leaves `CallLog::calls` empty, which is the assertion that
tells the two apart.

The file's note at `python.substrate.test.rs:24-28` asks the reader to add a
program to an existing function rather than adding a function. Revise it as part
of this work: each case below is its own `#[test]`, named for the behaviour it
proves, so a failure names the case.

## Design

Every test lands in `crates/gg/src/sandbox/language/python.substrate.test.rs`.
Each is one short program run through `run_with` with `all_operations()` granted
and `SandboxLimits::AMPLE`. A successful call asserts what the program printed;
an injected failure is either caught with `except gg.core.ApiError` and its
`operation`, `code` and `str(failure)` printed, or left uncaught and read through
`program_error`. A guest-side refusal also asserts `log.calls().is_empty()`.

### shell

The happy path is covered at `python.substrate.test.rs:1469-1470`, asserted
`"0 False"` at `:1500`.

- `a_non_zero_exit_is_a_value_not_a_raise` — `gg.shell.shell("make fail")` under
  `canned_outcome`, whose `shell_outcome` (`fake.test.rs:928`) returns exit code
  1 for a command containing `fail`; the program prints `exit_code` and reaches
  the line after it.
- `a_shell_timeout_is_a_limit_exceeded_error` — inject `LimitExceeded`.
- `a_shell_that_cannot_be_launched_is_an_io_error` — inject `IoError`.
- `a_negative_shell_timeout_is_refused_before_the_host` —
  `timeout_secs=-1`; the message names `timeout_secs`.
- `a_shell_timeout_that_is_not_a_number_is_refused_before_the_host` —
  `timeout_secs=float("nan")`.

### files

Covered already: the text read at `:1455-1458`, the image variant at
`:1459-1462` (both asserted at `:1497-1500`), the directory listing at
`:1463-1464`, the uncaught `not-found` read at `:1581-1604`, the negative
`offset` at `:1613-1629`, the workspace search and its `limit=0` refusal at
`:2417-2421`.

- `a_read_limit_that_is_not_a_whole_number_is_refused_before_the_host` —
  `gg.files.read_file("a.py", limit=True)`.
- `an_empty_read_path_is_an_argument_error` — inject `InvalidArgument`.
- `a_write_hands_back_the_bytes_it_wrote` — `gg.files.write_file("out.txt",
  "hello")` returns 5, the length `canned_outcome` reports at
  `fake.test.rs:790-791`.
- `an_empty_write_path_is_an_argument_error` — inject `InvalidArgument`.
- `a_write_that_cannot_reach_the_disk_is_an_io_error` — inject `IoError`.
- `an_edit_whose_old_text_is_absent_is_not_found` — inject `NotFound`. The
  `conflict` case is covered at `:1546-1574` and the edit's own crossing at
  `:1198-1201`.
- `an_empty_directory_is_an_empty_list` — the responder answers `list_dir` with
  an empty `ApiData::DirEntries`; the program prints the length and continues.
- `an_omitted_listing_path_lowers_as_null` — `gg.files.list_dir()`, asserted
  through `log.args("list_dir")`.
- `a_listing_of_a_missing_directory_is_not_found` — inject `NotFound`.
- `an_empty_listing_path_is_an_argument_error` — inject `InvalidArgument`.
- `a_tree_hands_back_the_text_gg_rendered` — `gg.files.tree(path="src",
  depth=3)` returns the canned rendering at `fake.test.rs:810`.
- `a_tree_depth_of_zero_is_refused_before_the_host` — the guard at
  `files.py:292`; the message names `depth`.
- `a_tree_depth_that_is_not_a_whole_number_is_refused_before_the_host` —
  `depth=-1`.
- `a_tree_of_a_missing_path_is_not_found` — inject `NotFound`.
- `a_tree_of_a_file_is_an_argument_error` — inject `InvalidArgument`.
- `a_search_limit_that_is_not_a_whole_number_is_refused_before_the_host` —
  `limit=True`.
- `a_blank_search_query_is_an_argument_error` — inject `InvalidArgument`.
- `a_search_pattern_that_does_not_parse_is_an_argument_error` — inject
  `InvalidArgument` carrying a regex-compilation message.
- `a_search_of_a_missing_path_is_not_found` — inject `NotFound`.

### skills

- `a_skill_read_hands_back_its_body` — `gg.skills.read_skill("testing")` returns
  the canned body at `fake.test.rs:820`. The crossing is at `:1218-1221`.
- `an_unknown_skill_is_not_found_and_names_the_skills_that_exist` — inject
  `NotFound` with the message shape at
  `crates/gg/src/sandbox/membrane/knowledge.test.rs:31`; assert the code and that
  the message reaching the program still carries `available skills`.

### memories

Covered already: the `MemoryUsage` from `write_memory` at `:1466-1467`, and
`search_memories` with `read_memory` reached through `MemoryHit.read` at
`:1970-1971`, asserted at `:1992`.

- `a_duplicate_memory_name_is_a_conflict` — inject `Conflict` on `write_memory`.
- `a_memory_body_over_the_cap_is_limit_exceeded` — inject `LimitExceeded` on
  `write_memory`.
- `an_update_hands_back_the_memory_budget` — `gg.memories.update_memory` reads
  `count`, `max_count` and `total_chars` off the result.
- `an_update_of_an_unknown_memory_is_not_found` — inject `NotFound`.
- `an_updated_memory_over_the_cap_is_limit_exceeded` — inject `LimitExceeded`.
- `a_created_memory_hands_back_the_memory_budget` — `gg.memories.create_memory`
  reads the same three fields.
- `a_duplicate_memory_slug_is_a_conflict` — inject `Conflict` on
  `create_memory`.
- `a_created_memory_over_the_cap_is_limit_exceeded` — inject `LimitExceeded`.
- `a_blank_memory_field_is_an_argument_error` — inject `InvalidArgument`, the
  first of the two causes at `packages/gg-sandbox-python/src/gg/memories.py:212`.
- `a_memory_slug_with_characters_a_name_may_not_hold_is_an_argument_error` — the
  second.
- `a_read_of_an_unknown_memory_is_not_found` — inject `NotFound` on
  `read_memory`.
- `an_edit_hands_back_the_memory_budget` — `gg.memories.edit_memory` reads the
  result's fields.
- `an_edit_whose_text_is_absent_is_not_found` — inject `NotFound`.
- `an_edit_whose_text_appears_twice_is_a_conflict` — inject `Conflict`.
- `an_edited_memory_over_the_cap_is_limit_exceeded` — inject `LimitExceeded`.
- `an_edit_that_would_empty_a_memory_is_an_argument_error` — inject
  `InvalidArgument`.
- `a_memory_hit_carries_its_counts_and_its_excerpt` — read `description`,
  `matched`, `occurrences` and `excerpt` off the hit `canned_outcome` returns at
  `fake.test.rs:833-839`.
- `a_memory_search_that_matches_nothing_is_an_empty_list` — the responder answers
  `search_memories` with an empty `ApiData::MemoryHits`.
- `a_memory_search_whose_keywords_are_all_empty_is_an_argument_error` — inject
  `InvalidArgument`.
- `a_delete_hands_back_the_memory_budget` — `gg.memories.delete_memory` reads the
  result's fields.
- `a_delete_of_an_unknown_memory_is_not_found` — inject `NotFound`.

### tasks

Covered already: the crossings for `update_task` and its clearing sentinel at
`:1263-1271`, `set_blocked_by` at `:1273-1276`, `complete_task` at `:1278-1281`
and `remove_task` at `:1283-1286`; the missing required argument reported as
Python's own `TypeError` at `:1631-1644`.

- `an_added_task_hands_back_the_task_budget` — `gg.tasks.add_task("t1", "T")`
  reads `count` and `max_tasks` off the result, which `canned_outcome` reports as
  2 and 20 at `fake.test.rs:840-841`.
- `a_duplicate_task_id_is_a_conflict` — inject `Conflict`; the membrane
  counterpart is at `knowledge.test.rs:333`.
- `a_task_added_with_an_edge_that_closes_a_cycle_is_a_conflict` — inject
  `Conflict` carrying a cycle message.
- `a_blank_task_id_is_an_argument_error` — inject `InvalidArgument`.
- `an_update_of_an_unknown_task_is_not_found` — inject `NotFound`.
- `a_task_update_with_no_field_is_an_argument_error` — inject
  `InvalidArgument`.
- `blocking_an_unknown_task_is_not_found` — inject `NotFound` on
  `set_blocked_by`.
- `a_blocked_by_edge_that_closes_a_cycle_is_a_conflict` — inject `Conflict`.
- `a_blank_blocker_id_is_an_argument_error` — inject `InvalidArgument`.
- `completing_an_unknown_task_is_not_found` — inject `NotFound`.
- `a_removed_task_hands_back_the_task_budget` — `gg.tasks.remove_task("t1")`
  reads `count` and `max_tasks`.
- `removing_an_unknown_task_is_not_found` — inject `NotFound`.

### board

Covered already: the `IssueCreated` and its `BoardUsage` at `:1478-1479`,
asserted at `:1506`; `wait_for_issue` reached through `IssueCreated.wait` at
`:1971-1972`; the crossings for `update_issue` and its ungrouping sentinel at
`:1310-1325` and for `set_issue_blocked_by` at `:1327-1330`.

- `a_created_epic_hands_back_its_id_and_the_board_budget` —
  `gg.board.create_epic("epc", "E", "D")` reads `id`, `board.epics` and
  `board.max_epics`, which `canned_outcome` reports at `fake.test.rs:845-850`
  and `:1126`.
- `an_epic_prefix_under_three_letters_is_an_argument_error` — inject
  `InvalidArgument`.
- `an_epic_prefix_over_six_letters_is_an_argument_error` — inject
  `InvalidArgument`.
- `an_epic_prefix_that_is_not_letters_is_an_argument_error` — inject
  `InvalidArgument`.
- `a_duplicate_epic_prefix_is_a_conflict` — inject `Conflict`.
- `an_issue_assigned_to_an_unassignable_agent_is_an_argument_error` — inject
  `InvalidArgument`.
- `an_issue_reviewed_by_an_unassignable_agent_is_an_argument_error` — inject
  `InvalidArgument`.
- `an_issue_blocker_that_closes_a_cycle_is_a_conflict` — inject `Conflict`.
- `a_blank_issue_field_is_an_argument_error` — inject `InvalidArgument`.
- `an_update_of_an_unknown_issue_is_not_found` — inject `NotFound`.
- `an_issue_update_with_no_field_is_an_argument_error` — inject
  `InvalidArgument`.
- `blocking_an_unknown_issue_is_not_found` — inject `NotFound` on
  `set_issue_blocked_by`.
- `an_issue_edge_that_closes_a_cycle_is_a_conflict` — inject `Conflict`.
- `a_removed_epic_hands_back_the_board_budget` — `gg.board.remove_epic("e1")`
  reads `epics`, `max_epics`, `issues` and `max_issues`.
- `removing_an_unknown_epic_is_not_found` — inject `NotFound`.
- `a_removed_issue_hands_back_the_board_budget` — `gg.board.remove_issue("i1")`
  reads the same four fields.
- `removing_an_unknown_issue_is_not_found` — inject `NotFound`.
- `waiting_on_an_unknown_issue_is_not_found` — inject `NotFound`.
- `waiting_on_this_sessions_own_issue_is_an_argument_error` — inject
  `InvalidArgument`, the second cause at
  `packages/gg-sandbox-python/src/gg/board.py:340`.
- `a_registered_wait_lets_the_rest_of_the_program_run` — the call returns
  `"wait registered"` and the program prints a line after it.

## Done when

- [ ] Every operation in `shell`, `files`, `memories`, `tasks`, `board` and
      `skills` has a Python program asserting what a successful call hands back,
      either newly written or cited above as already present.
- [ ] Every failure listed above is driven from a Python program and asserted
      through `gg.core.ApiError` or `program_error`.
- [ ] Each guest-side refusal asserts that nothing reached the host.
- [ ] Each case is its own `#[test]`, and the note at
      `crates/gg/src/sandbox/language/python.substrate.test.rs:24-28` says so.
- [ ] No test in the file calls a real model or provider.
- [ ] Gates green.
