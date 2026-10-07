# Drive gg's workspace SDK modules from JavaScript programs

Give the JavaScript arm a program-level test for every call in `shell`, `files`,
`memories`, `tasks`, `board` and `skills`: one short test per successful call
asserting what the program read back, and one short test per distinct runtime
failure mode. Every response is synthesized by the operation double, so no test
reaches a provider.

## Current state

The arm's operation vocabulary is `crates/gg/src/sandbox/operations.rs:110`
(`SHELL_SHELL`) through `:192`, and its SDK spelling is
`packages/gg-sandbox/src/gg/` — `shell.ts:49`, `files.ts:122`–`:254`,
`memories.ts:159`–`:256`, `tasks.ts:67`–`:146`, `board.ts:148`–`:313` and
`skills.ts:27`. Each function's `@throws` line names the failure classes it
lowers, and the guest-side argument validators in
`packages/gg-sandbox/src/internal/errors.ts` — `opts` at `:177`, `uint` at
`:209`, `positive` at `:231`, `arrayArg` at `:246` — refuse three more before
anything crosses.

`crates/gg/src/sandbox/language/javascript.substrate.test.rs` runs five programs
inside one test function. It reads back `listDir` entries and `readFile`
contents (`:169`–`:171`), reaches dispatch for `shell.shell`, `board.createEpic`,
`tasks.addTask`, `memories.readMemory` and `skills.readSkill` without reading
any of their answers (`:256`–`:262`), catches the `offset: -1` guard as an
`ApiError` (`:263`–`:267`, asserted `:320`), and reads the `createIssue` id and
the `searchMemories` hit back through their convenience helpers (`:358`–`:391`).
G8 case (a) at `:625`–`:640` is the arm's one `not-found`, uncaught.

`crates/gg/src/sandbox/language/ecmascript.test.rs` runs plain JavaScript on the
same guest: `:759` walks every family across the membrane and asserts the call
names it saw, and `:822` reads a `FileRead` variant, a `DirEntry` list with its
`EntryKind`, and `writeFile`'s `u64` narrowed to a number.

The harness a new test reuses is the substrate file's own: `javascript()` at
`:50`, `run` at `:55`, `run_with` at `:61`, `run_scoped` at `:70`, `thrown` at
`:98` and `logs` at `:105`, each driving `run_program` against
`FakeOperationApi::with(&log, canned_outcome)`. The double lives in
`crates/gg/src/sandbox/fake.test.rs`: `CallLog` at `:90` with `names` at `:102`
and `args` at `:117`, `FakeOperationApi` at `:141` with `new` at `:250` and
`with` at `:256`, and the canned answer table at `:780`. The table is what the
success assertions below are written against — a non-zero `shell` exit exactly
when the command says `fail` (`:928`), an image read for a `.png` path (`:944`),
three directory entries (`:794`), a memory usage of one of eight (`:824`), a task
usage of two of twenty (`:840`) and a board usage of one epic and three issues
(`:1126`).

## Design

### Where the tests land

A new file, `crates/gg/src/sandbox/language/javascript.workspace.test.rs`, wired
beside the substrate module in `crates/gg/src/sandbox/language/javascript.rs:212`
as `#[cfg(test)] #[path = "javascript.workspace.test.rs"] mod workspace;`. It
carries its own copies of `javascript`, `run`, `run_with`, `thrown` and `logs`,
modelled on the substrate file's, plus one addition:

```rust
/// Run `program` with one tool answered by `responder` and every other answered as usual.
fn run_answering(
    program: &str,
    tool: &'static str,
    responder: impl Fn() -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog)
```

built on `FakeOperationApi::with` (`crates/gg/src/sandbox/fake.test.rs:256`),
falling back to `canned_outcome` (`:780`) for every other name — the shape
`crates/gg/src/sandbox/language/python.substrate.test.rs:1546` uses. A failure
test injects one `ToolOutcome::failed(ToolFailure::…, "…")`
(`crates/gg/src/tools/data.rs:506`) and asserts the `ApiError` the program
caught: its `operation`, its `code`, and the sentence the model reads.

One `#[test]` per case, each a handful of lines. The note at
`crates/gg/src/sandbox/language/javascript.substrate.test.rs:25`, which directs a
reader to add a program to the existing function rather than a function beside
it, is revised as part of this work to say that it governs the five observation
programs in that file; the guest compiles once per process against the shared
engine, and a per-case test in the new file is the shape this issue asks for.

### The program shape

Every success test writes the documented spelling — `import { files } from "gg";`
— calls once, `console.log`s the fields it read, and asserts on `logs(&outcome)`
and on `log.args(tool)`. Every failure test wraps the call in
`try { … } catch (error) { console.log(`${error.code} ${error.operation}`); … }`
with `ApiError` imported from `"gg"`, as
`javascript.substrate.test.rs:263`–`:267` already does, and asserts that
`log.calls()` is empty wherever the guest refused the call before it crossed.

### shell

| Test | What it drives |
| --- | --- |
| `a_command_that_succeeded_reads_back_its_exit_code_and_output` | `shell.shell("ls")`, reading `exitCode` 0, `output` containing ``ran `ls` `` and `truncated` false |
| `a_non_zero_exit_is_a_value_the_program_reads_rather_than_a_throw` | `shell.shell("fail")`, reading `exitCode` 1 with nothing caught and the program running on |
| `a_shell_timeout_reaches_the_program_as_limit_exceeded` | injected `LimitExceeded` |
| `a_process_that_could_not_be_launched_reaches_the_program_as_io_error` | injected `IoError` |
| `a_nonsense_shell_timeout_is_refused_before_it_crosses` | `{ timeoutSecs: -1 }`, the `positive` guard's sentence, an empty call log |
| `a_positional_second_argument_to_shell_names_the_options_object` | `shell.shell("npm test", 300)`, the `opts` guard's sentence, an empty call log |

### files

| Test | What it drives |
| --- | --- |
| `a_text_read_arrives_as_the_text_arm_of_a_file_read` | `readFile("notes.md")`, reading `kind`, `contents`, `firstLine`, `lastLine`, `totalLines`, `byteTruncated` |
| `an_image_read_arrives_as_the_image_arm_of_a_file_read` | `readFile("logo.png")`, reading `kind`, `mediaType`, `label`, `bytes`, `shown`, `notShownReason` |
| `an_empty_path_to_read_file_is_an_argument_failure` | injected `InvalidArgument` |
| `a_fractional_read_limit_is_refused_before_it_crosses` | `{ limit: 0.5 }`, the `uint` guard naming `limit`, an empty call log |
| `a_positional_second_argument_to_read_file_names_the_options_object` | `readFile("a.ts", 5)`, the `opts` guard, an empty call log |
| `a_write_reports_the_bytes_it_wrote_as_a_number` | `writeFile`, reading the count and `log.args("write_file")` |
| `an_empty_path_to_write_file_is_an_argument_failure` | injected `InvalidArgument` |
| `a_write_that_could_not_reach_the_disk_is_an_io_error` | injected `IoError` |
| `an_edit_reaches_the_host_with_the_two_strings_it_was_given` | `editFile`, asserting `log.args("edit_file")` |
| `text_that_is_not_in_the_file_is_a_not_found_edit` | injected `NotFound` |
| `text_that_appears_more_than_once_is_a_conflicting_edit` | injected `Conflict`, the message carrying the match count |
| `a_directory_that_is_not_there_is_a_not_found_listing` | injected `NotFound` |
| `an_empty_path_to_list_dir_is_an_argument_failure` | injected `InvalidArgument` |
| `a_tree_reads_back_as_one_block_of_text` | `tree({ path: "src", depth: 2 })`, reading the rendering and `log.args("tree")` |
| `a_tree_depth_of_zero_is_refused_before_it_crosses` | the guard at `packages/gg-sandbox/src/gg/files.ts:214`, an empty call log |
| `a_negative_tree_depth_is_refused_before_it_crosses` | the `uint` guard naming `depth`, an empty call log |
| `a_tree_root_that_is_not_a_directory_is_an_argument_failure` | injected `InvalidArgument` |
| `a_tree_root_that_is_not_there_is_not_found` | injected `NotFound` |
| `a_search_reads_back_its_matches_with_paths_and_line_numbers` | `search("answer")`, reading `path`, `line`, `text` off the first match |
| `a_search_limit_of_zero_is_refused_before_it_crosses` | the guard at `packages/gg-sandbox/src/gg/files.ts:260`, an empty call log |
| `a_blank_search_query_is_an_argument_failure` | injected `InvalidArgument` |
| `a_search_pattern_that_does_not_parse_is_an_argument_failure` | injected `InvalidArgument`, the message naming the pattern |
| `a_search_root_that_is_not_there_is_not_found` | injected `NotFound` |

`listDir`'s success and `writeFile`'s `u64` narrowing are already read back from a
JavaScript program at `crates/gg/src/sandbox/language/ecmascript.test.rs:830`
and `:834`, and the omitted-path form that lists the workspace root at `:764`;
`readFile`'s uncaught `not-found` is G8 case (a) at
`crates/gg/src/sandbox/language/javascript.substrate.test.rs:625`, and the
out-of-range `offset` guard is caught and read at `:263` with its code asserted
at `:320`. Those five cases need nothing further.

### memories

| Test | What it drives |
| --- | --- |
| `a_written_memory_reports_the_budget_it_now_occupies` | `writeMemory`, reading `count`, `maxCount`, `totalChars`, `maxTotalChars` |
| `a_duplicate_memory_name_is_a_conflicting_write` | injected `Conflict` |
| `a_memory_body_over_the_cap_is_a_limit_exceeded_write` | injected `LimitExceeded` |
| `an_updated_memory_reports_the_budget_after_the_replacement` | `updateMemory`, reading the usage and asserting `log.args("update_memory")` carries the replacement |
| `updating_a_memory_that_is_not_held_is_not_found` | injected `NotFound` |
| `a_replacement_over_the_cap_is_a_limit_exceeded_update` | injected `LimitExceeded` |
| `a_created_memory_reports_the_budget_it_now_occupies` | `createMemory`, reading the same four fields |
| `a_duplicate_memory_slug_is_a_conflicting_creation` | injected `Conflict` |
| `a_creation_over_the_cap_is_limit_exceeded` | injected `LimitExceeded` |
| `reading_a_memory_that_is_not_held_is_not_found` | injected `NotFound` |
| `an_edited_memory_reports_the_budget_after_the_revision` | `editMemory`, reading the usage and asserting `log.args("edit_memory")` |
| `text_that_is_not_in_the_memory_is_a_not_found_revision` | injected `NotFound` |
| `text_that_appears_more_than_once_is_a_conflicting_revision` | injected `Conflict` |
| `a_revision_over_the_cap_is_limit_exceeded` | injected `LimitExceeded` |
| `a_revision_that_would_empty_the_memory_is_an_argument_failure` | injected `InvalidArgument` |
| `a_memory_search_reads_back_the_numbers_each_hit_was_ranked_by` | `searchMemories(["build"])`, reading `name`, `description`, `matched`, `occurrences`, `excerpt` |
| `a_memory_search_of_only_empty_keywords_is_an_argument_failure` | injected `InvalidArgument` |
| `a_deleted_memory_reports_the_budget_that_is_left_in_use` | `deleteMemory`, reading the usage |
| `deleting_a_memory_that_is_not_held_is_not_found` | injected `NotFound` |

`readMemory`'s successful call is read back through the search hit's `read()`
helper at `crates/gg/src/sandbox/language/javascript.substrate.test.rs:362`, with
the contents asserted at `:369` and the slug the helper supplied at `:393`.

### tasks

| Test | What it drives |
| --- | --- |
| `an_added_task_reports_the_budget_it_now_occupies` | `addTask`, reading `count` and `maxTasks`, and `log.args("add_task")` |
| `a_duplicate_task_id_is_a_conflicting_addition` | injected `Conflict` |
| `a_blocker_edge_that_would_close_a_cycle_is_a_conflicting_addition` | injected `Conflict`, the message naming the cycle |
| `a_blocked_by_that_is_not_an_array_is_refused_before_it_crosses` | the `arrayArg` guard naming `blockedBy`, an empty call log |
| `a_task_update_carries_its_title_status_and_cleared_description` | `updateTask("t1", { title, description: null, status: "in_progress" })`, asserting `log.args("update_task")` holds the clear sentinel and the `in-progress` wire spelling |
| `updating_a_task_that_is_not_on_the_list_is_not_found` | injected `NotFound` |
| `a_task_status_outside_the_three_names_the_cases_that_exist` | `status: "bogus"`, the binding's own sentence, an empty call log |
| `replacing_a_task_s_blockers_carries_the_whole_new_set` | `setBlockedBy`, asserting `log.args("set_blocked_by")`, and an empty array clearing them |
| `blocking_a_task_that_is_not_on_the_list_is_not_found` | injected `NotFound` |
| `a_blocker_replacement_that_would_close_a_cycle_is_a_conflict` | injected `Conflict` |
| `a_blocker_replacement_that_is_not_an_array_is_refused_before_it_crosses` | the `arrayArg` guard, an empty call log |
| `completing_a_task_reaches_the_host_with_its_id` | `completeTask`, asserting `log.args("complete_task")` |
| `completing_a_task_that_is_not_on_the_list_is_not_found` | injected `NotFound` |
| `a_removed_task_reports_the_budget_that_is_left_in_use` | `removeTask`, reading the usage |
| `removing_a_task_that_is_not_on_the_list_is_not_found` | injected `NotFound` |

### board

| Test | What it drives |
| --- | --- |
| `a_created_epic_reads_back_its_id_and_the_board_budget` | `createEpic`, reading `id`, `board.epics`, `board.maxEpics`, `board.issues`, `board.maxIssues` |
| `a_prefix_outside_three_to_six_letters_is_an_argument_failure` | injected `InvalidArgument` |
| `a_prefix_another_epic_holds_is_a_conflicting_creation` | injected `Conflict` |
| `a_created_issue_reads_back_the_id_the_board_assigned_and_the_budget` | `createIssue`, reading `id` and the four `board` fields |
| `an_agent_this_session_may_not_spawn_is_an_argument_failure` | injected `InvalidArgument`, the message naming the agent |
| `a_reviewer_this_session_may_not_spawn_is_an_argument_failure` | injected `InvalidArgument`, the message naming the reviewer |
| `an_issue_blocker_edge_that_would_close_a_cycle_is_a_conflict` | injected `Conflict` |
| `issue_blockers_that_are_not_an_array_are_refused_before_they_cross` | the `arrayArg` guard naming `blockedBy`, an empty call log |
| `issue_reviewers_that_are_not_an_array_are_refused_before_they_cross` | the `arrayArg` guard naming `reviewers`, an empty call log |
| `an_issue_update_carries_its_status_cleared_description_and_detachment` | `updateIssue("EPIC-1", { description: null, status: "done", epicId: null })`, asserting `log.args("update_issue")` holds both sentinels |
| `updating_an_issue_that_is_not_on_the_board_is_not_found` | injected `NotFound` |
| `an_issue_status_outside_its_cases_names_the_ones_that_exist` | `status: "bogus"`, the binding's own sentence, an empty call log |
| `replacing_an_issue_s_blockers_carries_the_whole_new_set` | `setIssueBlockedBy`, asserting `log.args("set_issue_blocked_by")` |
| `blocking_an_issue_that_is_not_on_the_board_is_not_found` | injected `NotFound` |
| `an_issue_blocker_replacement_that_would_close_a_cycle_is_a_conflict` | injected `Conflict` |
| `an_issue_blocker_replacement_that_is_not_an_array_is_refused_before_it_crosses` | the `arrayArg` guard, an empty call log |
| `a_removed_epic_reports_the_board_budget_that_is_left` | `removeEpic`, reading the four usage fields |
| `removing_an_epic_that_is_not_on_the_board_is_not_found` | injected `NotFound` |
| `a_removed_issue_reports_the_board_budget_that_is_left` | `removeIssue`, reading the four usage fields |
| `removing_an_issue_that_is_not_on_the_board_is_not_found` | injected `NotFound` |
| `a_registered_wait_reads_back_gg_s_acknowledgement` | `waitForIssue("EPIC-1")`, reading the returned line and `log.args("wait_for_issue")` |
| `waiting_on_an_issue_that_is_not_on_the_board_is_not_found` | injected `NotFound` |
| `waiting_on_this_session_s_own_issue_is_an_argument_failure` | injected `InvalidArgument` |

The wait registered through the `IssueCreated.wait()` helper is already driven and
asserted at `crates/gg/src/sandbox/language/javascript.substrate.test.rs:361`,
`:369` and `:388`.

### skills

| Test | What it drives |
| --- | --- |
| `a_read_skill_hands_the_program_the_body_it_returned` | `readSkill("testing")`, reading the returned string |
| `an_unknown_skill_is_not_found_and_lists_the_ones_that_exist` | injected `NotFound` whose message carries `available skills`, mirroring `crates/gg/src/sandbox/membrane/knowledge.test.rs:31` at the program level |

## Done when

- [ ] `crates/gg/src/sandbox/language/javascript.workspace.test.rs` exists and is wired into `crates/gg/src/sandbox/language/javascript.rs` beside the substrate module.
- [ ] The file carries a `run_answering` helper built on `FakeOperationApi::with`, so one tool can be failed while the rest answer from `canned_outcome`.
- [ ] Every call in `shell`, `files`, `memories`, `tasks`, `board` and `skills` has a JavaScript program-level test that reads its answer back, either in the new file or at the citation this issue credits.
- [ ] Every failure mode listed above has its own short test asserting the `ApiError`'s `code`, `operation` and sentence.
- [ ] Every guest-side argument refusal asserts that the call log is empty.
- [ ] The consolidation note at `crates/gg/src/sandbox/language/javascript.substrate.test.rs:25` is revised to govern that file's own five programs.
- [ ] Gates green.
