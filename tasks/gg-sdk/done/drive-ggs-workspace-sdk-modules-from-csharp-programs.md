# Drive gg's workspace SDK modules from C# programs

Cover the shell, files, memories, tasks, board and skills modules of the C# SDK
from real C# programs: what a successful call hands the program back, and what a
program catches for every runtime failure a well-typed call can meet.

## Current state

The C# arm's model-facing surface is driven through the real `csc` and the real
membrane in `crates/gg/src/sandbox/language/csharp.surface.test.rs`. The crossing
table at `csharp.surface.test.rs:110` carries a row per bound operation, and
`every_operation_crosses_the_membrane_from_its_csharp_spelling`
(`csharp.surface.test.rs:346`) runs them as one program and asserts the JSON each
one put on gg's dispatch. That table is the argument-lowering gate and stays as
it is; what a program *reads back*, and what it catches, is the half these tests
add.

What this arm already drives from a program:

| Case | Where |
| --- | --- |
| `Files.ReadFile` answering `NotFound`, both caught with a `when` clause on the code and let out uncaught | `csharp.surface.test.rs:715` |
| A call this run withheld answering `Unavailable` without reaching dispatch | `csharp.surface.test.rs:865` |
| `Board.CreateIssue`'s `Id`, and `IssueCreated.Wait` reaching `wait_for_issue` | `csharp.surface.test.rs:625` |
| `Memories.SearchMemories` hits read for `Name`, and `MemoryHit.Read` reaching `read_memory` | `csharp.surface.test.rs:625` |
| A `Files.TextFile` pattern matched out of a `FileRead`, through `Views.OpenFile` | `csharp.surface.test.rs:397` |

The harness the new tests reuse is the one those tests use. `prepare`
(`csharp.substrate.test.rs:72`) runs the production prepare step over a whole C#
compilation unit, `evaluate` (`csharp.substrate.test.rs:136`) drives the result
through the prebuilt guest and the production linker, and `run_with`
(`csharp.surface.test.rs:71`) wraps the pair for a program with no ending group,
handing back a `SandboxOutcome` and the `CallLog` from
`crates/gg/src/sandbox/fake.test.rs:90`. `logs`
(`csharp.substrate.test.rs:269`) reads the lines a program wrote with
`Console.WriteLine` and `program_error` (`csharp.substrate.test.rs:285`) reads
what the model is told when a program ends in an uncaught exception. Successes
are answered by `canned_outcome` (`fake.test.rs:780`), whose payloads are
specific enough to assert on: a shell result that exits non-zero exactly when the
command says `fail` (`fake.test.rs:928`), a picture for a `.png` path and text
for anything else (`fake.test.rs:945`), three directory entries one of which is a
directory (`fake.test.rs:793`), one search match (`fake.test.rs:813`), a memory
usage record (`fake.test.rs:822`), a memory hit carrying its ranking
(`fake.test.rs:832`), a task usage pair (`fake.test.rs:840`) and a board usage
record (`fake.test.rs:1126`).

Each function's runtime failures are enumerated by its own `<exception>` element
in `packages/gg-sandbox-csharp/src/Gg/`, which is the list the case tables below
are built from. C#'s types remove several failures other arms carry: `offset`,
`limit` and `depth` are `uint?`, so a negative one does not compile, and a
mistyped argument is a compile error rather than an `InvalidArgument` at runtime.
Two refusals are raised guest-side before the call leaves the program — a `depth`
of zero at `packages/gg-sandbox-csharp/src/Gg/Files/Files.cs:144` and a `limit`
of zero at `Files.cs:194` — and those two are the cases whose test asserts an
empty `CallLog`.

## Design

All of this work lands in `crates/gg/src/sandbox/language/csharp.surface.test.rs`.
Its consolidation note at `csharp.surface.test.rs:13-17`, and the matching one at
`csharp.substrate.test.rs:42-45`, ask a reader to add statements to an existing
function rather than adding a function; revise both as part of this issue to ask
for a function per case. The arm's measured cost table
(`crates/gg/src/sandbox/language/csharp.compile.rs:27-46`) prices a program at
~0.22 s of `csc` against gg's SDK assembly, built once per machine, plus a share
of one `Component::new` on the prebuilt guest paid once per test process. That
is the price of one `#[test]` per case here, and it is what the testing policy
asks for.

### How each test is written

A success test runs one program through `run_with` with `all_operations`
(`fake.test.rs:1151`) and `canned_outcome`, writes the fields of the value the
call returned with `Console.WriteLine`, and asserts the lines with `logs`. A
failure test passes a responder closure answering
`ToolOutcome::failed(ToolFailure::X, "…")`, in the shape already at
`csharp.surface.test.rs:737`, and the program catches `ApiException` and writes
`failure.Code` and `failure.Operation`; where the failure's message carries data
the model needs, the program writes `failure.Message` too and the test asserts
the detail survived. Add a `fails_with(failure, detail)` helper beside `run_with`
so each failure test is a program and one assertion.

A failure test also asserts, through the `CallLog`, that the call reached gg's
dispatch carrying the arguments the program wrote. That is what makes a case like
an empty path meaningful on this arm: the refusal itself belongs to gg's tool
implementation, and the claim here is that the arm lowers the cause onto an
`ApiException` the program can read, under the operation's own name. The two
guest-side guards are the exception to that shape — `Files.Tree(depth: 0)` and
`Files.Search(limit: 0)` assert an empty `CallLog` instead, because the whole
point of the guard is that nothing crosses.

### shell

`packages/gg-sandbox-csharp/src/Gg/Shell/Shell.cs:25`, exceptions at
`Shell.cs:20-23`. `ShellOutput` carries `ExitCode`, `Output` and `Truncated`
(`packages/gg-sandbox-csharp/src/Gg/Shell/Types.cs:16`).

| Case | Test |
| --- | --- |
| A command that ran hands back `ExitCode`, `Output` and `Truncated` | `a_shell_run_hands_the_program_its_exit_code_and_output` |
| A non-zero exit is a value rather than a thrown failure | `a_non_zero_exit_is_a_value_the_program_reads` |
| `LimitExceeded` — the timeout killed the process | `a_shell_timeout_reaches_the_program_as_limit_exceeded` |
| `IOError` — the process could not be started at all | `a_shell_that_could_not_be_started_is_an_io_error` |

The non-zero case asks `canned_outcome` for a command containing `fail`, which
answers `ok: false` with no failure classification — the exact shape the membrane
turns back into a value.

### files

`packages/gg-sandbox-csharp/src/Gg/Files/Files.cs`, each function's failures in
its own `<exception>` element. `TextFile` and `ImageFile` are records
(`packages/gg-sandbox-csharp/src/Gg/Files/Types.cs:17` and `:35`), so a success
test pattern-matches the `FileRead` and writes the arm's fields.

| Case | Test |
| --- | --- |
| A text read hands back `Contents`, `FirstLine`, `LastLine`, `TotalLines` and `ByteTruncated` | `a_text_read_hands_the_program_the_text_window` |
| A read of a `.png` hands back `MediaType`, `Label`, `Bytes`, `Shown` and `NotShownReason` | `an_image_read_hands_the_program_the_image_record` |
| A write hands back the byte count | `a_write_hands_the_program_the_byte_count` |
| `WriteFile` `InvalidArgument` — an empty path | `an_empty_write_path_is_an_argument_error` |
| `WriteFile` `IOError` — the write or its parent directories failed | `a_write_that_failed_is_an_io_error` |
| An edit that matched once returns and the program carries on | `an_edit_that_matched_once_returns_to_its_program` |
| `EditFile` `NotFound` — the text does not appear | `an_edit_whose_text_is_absent_is_not_found` |
| `EditFile` `Conflict` — the text appears more than once, the count in the message | `an_edit_whose_text_repeats_is_a_conflict_carrying_the_count` |
| A listing hands back each entry's `Name` and `Kind` | `a_listing_hands_the_program_its_entries_and_their_kinds` |
| An omitted path lists the root, and no `path` key reaches dispatch | `an_omitted_listing_path_lists_the_root` |
| An empty directory is an empty list | `an_empty_directory_is_an_empty_list` |
| `ListDir` `NotFound` — the directory is not there | `a_listing_of_a_directory_that_is_not_there_is_not_found` |
| `ListDir` `InvalidArgument` — a path given as `""` | `a_listing_path_that_is_given_but_empty_is_an_argument_error` |
| A tree hands back its rendering | `a_tree_hands_the_program_its_rendering` |
| `Tree` `NotFound` — the path is not there | `a_tree_of_a_path_that_is_not_there_is_not_found` |
| `Tree` `InvalidArgument` — the path is a file | `a_tree_rooted_at_a_file_is_an_argument_error` |
| `Tree` `InvalidArgument` — `depth: 0`, raised guest-side, empty `CallLog` | `a_tree_depth_of_zero_is_refused_before_it_crosses` |
| A search hands back each match's `Path`, `Line` and `Text` | `a_search_hands_the_program_its_matches` |
| A search that matched nothing is an empty list | `a_search_that_matched_nothing_is_an_empty_list` |
| `Search` `InvalidArgument` — a blank query | `a_blank_search_query_is_an_argument_error` |
| `Search` `InvalidArgument` — a query that is not a valid pattern | `a_search_pattern_that_does_not_parse_is_an_argument_error` |
| `Search` `InvalidArgument` — `limit: 0`, raised guest-side, empty `CallLog` | `a_search_limit_of_zero_is_refused_before_it_crosses` |
| `Search` `NotFound` — the `path` is not there | `a_search_path_that_is_not_there_is_not_found` |

`ReadFile`'s `NotFound` is driven at `csharp.surface.test.rs:715`, in both the
caught and the uncaught form, and needs nothing further.

### skills

`packages/gg-sandbox-csharp/src/Gg/Skills/Skills.cs:26`, exceptions at
`Skills.cs:22-24`.

| Case | Test |
| --- | --- |
| A skill read hands back the body | `a_skill_read_hands_the_program_the_skill_body` |
| `NotFound` — an unknown name, the message listing the skills that do exist | `an_unknown_skill_names_the_skills_that_exist` |

The message the failure test asserts on is the one gg produces at
`crates/gg/src/sandbox/membrane/knowledge.test.rs:31`, so the program asserts
`failure.Message` holds `available skills`.

### memories

`packages/gg-sandbox-csharp/src/Gg/Memories/Memories.cs`. Every mutation hands
back a `MemoryUsage` (`packages/gg-sandbox-csharp/src/Gg/Memories/Types.cs:15`),
so each success test writes `Count`, `MaxCount` and `TotalChars` off the value
the call returned.

| Case | Test |
| --- | --- |
| A written memory hands back the usage after it | `a_written_memory_hands_the_program_the_usage_after_it` |
| `WriteMemory` `Conflict` — a name already held | `a_duplicate_memory_name_is_a_conflict` |
| `WriteMemory` `LimitExceeded` — a body that breaches a cap | `a_memory_body_over_the_cap_is_limit_exceeded` |
| An updated memory hands back the usage after it | `an_updated_memory_hands_the_program_the_usage_after_it` |
| `UpdateMemory` `NotFound` — no memory is held under that name | `an_update_of_a_memory_that_is_not_there_is_not_found` |
| A created memory, carrying `code`, hands back the usage after it | `a_created_memory_hands_the_program_the_usage_after_it` |
| `CreateMemory` `InvalidArgument` — a blank field | `a_blank_field_on_a_new_memory_is_an_argument_error` |
| `CreateMemory` `InvalidArgument` — a name carrying characters a slug may not hold | `a_slug_a_name_may_not_hold_is_an_argument_error` |
| `CreateMemory` `Conflict` — a name already held | `a_duplicate_memory_slug_is_a_conflict` |
| `CreateMemory` `LimitExceeded` — the contents or the index entry over a cap | `a_new_memory_over_a_limit_is_limit_exceeded` |
| A memory read hands back its contents | `a_memory_read_hands_the_program_its_contents` |
| `ReadMemory` `NotFound` — no memory is held under that name | `a_read_of_a_memory_that_is_not_there_is_not_found` |
| An edited memory hands back the usage after it | `an_edited_memory_hands_the_program_the_usage_after_it` |
| `EditMemory` `NotFound` — the text is not there | `a_memory_edit_whose_text_is_absent_is_not_found` |
| `EditMemory` `Conflict` — the text is there more than once | `a_memory_edit_whose_text_repeats_is_a_conflict` |
| `EditMemory` `LimitExceeded` — the result would be over a cap | `a_memory_edit_over_the_cap_is_limit_exceeded` |
| `EditMemory` `InvalidArgument` — the edit would leave the memory empty | `a_memory_edit_that_would_empty_it_is_an_argument_error` |
| A search hands back each hit's `Description`, `Matched`, `Occurrences` and `Excerpt` | `a_memory_search_hands_the_program_each_hits_ranking` |
| A search that matched nothing is an empty list | `a_memory_search_that_matched_nothing_is_an_empty_list` |
| `SearchMemories` `InvalidArgument` — an empty keyword list | `a_memory_search_of_empty_keywords_is_an_argument_error` |
| A deleted memory hands back the usage after it | `a_deleted_memory_hands_the_program_the_usage_after_it` |
| `DeleteMemory` `NotFound` — no memory is held under that name | `a_delete_of_a_memory_that_is_not_there_is_not_found` |

A hit's `Name` and the `MemoryHit.Read` alias are driven at
`csharp.surface.test.rs:625`, so the search success test covers the ranking
fields the alias case leaves alone.

### tasks

`packages/gg-sandbox-csharp/src/Gg/Tasks/Tasks.cs`. `AddTask` and `RemoveTask`
hand back a `TaskUsage` (`packages/gg-sandbox-csharp/src/Gg/Tasks/Types.cs:64`),
so those success tests write `Count` and `MaxTasks`.

| Case | Test |
| --- | --- |
| An added task hands back `Count` and `MaxTasks` | `an_added_task_hands_the_program_the_task_usage` |
| `AddTask` `InvalidArgument` — a blank id | `a_blank_task_id_is_an_argument_error` |
| `AddTask` `InvalidArgument` — a blank title | `a_blank_task_title_is_an_argument_error` |
| `AddTask` `Conflict` — an id already in use | `a_duplicate_task_id_is_a_conflict` |
| `AddTask` `Conflict` — a blocker that would make a cycle | `a_task_edge_that_closes_a_cycle_is_a_conflict` |
| `AddTask` `NotFound` — a blocker that is not on the list | `an_unknown_task_blocker_is_not_found` |
| `AddTask` `LimitExceeded` — the task cap | `a_task_over_the_cap_is_limit_exceeded` |
| A patch carrying `Tasks.TextEdit.Clear` and a status returns to its program | `an_updated_task_returns_to_its_program` |
| `UpdateTask` `InvalidArgument` — nothing at all was changed | `a_task_patch_with_no_field_is_an_argument_error` |
| `UpdateTask` `InvalidArgument` — a field that may not be blanked | `a_blanked_task_field_is_an_argument_error` |
| `UpdateTask` `NotFound` — an unknown id | `an_update_of_a_task_that_is_not_there_is_not_found` |
| An empty blocker list clears the edges and returns | `a_cleared_task_blocker_list_returns_to_its_program` |
| `SetBlockedBy` `InvalidArgument` — a blank id | `a_blank_id_on_a_task_blocker_list_is_an_argument_error` |
| `SetBlockedBy` `InvalidArgument` — a blank blocker | `a_blank_blocker_on_a_task_is_an_argument_error` |
| `SetBlockedBy` `NotFound` — the task is not on the list | `blocking_a_task_that_is_not_there_is_not_found` |
| `SetBlockedBy` `NotFound` — a blocker is not on the list | `a_task_blocker_that_is_not_there_is_not_found` |
| `SetBlockedBy` `Conflict` — an edge that would make a cycle | `a_task_blocker_that_closes_a_cycle_is_a_conflict` |
| `SetBlockedBy` `Conflict` — a task blocked on itself | `a_task_blocked_on_itself_is_a_conflict` |
| A completion returns to its program | `a_completed_task_returns_to_its_program` |
| `CompleteTask` `NotFound` — an unknown id | `completing_a_task_that_is_not_there_is_not_found` |
| A removal hands back the usage after it | `a_removed_task_hands_the_program_the_usage_after_it` |
| `RemoveTask` `NotFound` — an unknown id | `removing_a_task_that_is_not_there_is_not_found` |

The duplicate-id conflict is produced at
`crates/gg/src/sandbox/membrane/knowledge.test.rs:333`; the test here injects the
same failure and asserts what a C# program catches.

### board

`packages/gg-sandbox-csharp/src/Gg/Board/Board.cs`. `CreateEpic` and
`CreateIssue` hand back the id gg minted alongside a `BoardUsage`
(`packages/gg-sandbox-csharp/src/Gg/Board/Types.cs:57`), and the removals hand
back a `BoardUsage` alone, so each success test writes `Id` where there is one
plus `Board.Issues` and `Board.MaxIssues`.

| Case | Test |
| --- | --- |
| A created epic hands back its `Id` and the board usage | `a_created_epic_hands_the_program_its_id_and_usage` |
| `CreateEpic` `InvalidArgument` — a prefix shorter than three letters | `a_prefix_under_three_letters_is_an_argument_error` |
| `CreateEpic` `InvalidArgument` — a prefix longer than six letters | `a_prefix_over_six_letters_is_an_argument_error` |
| `CreateEpic` `InvalidArgument` — a prefix that is not all letters | `a_prefix_that_is_not_letters_is_an_argument_error` |
| `CreateEpic` `InvalidArgument` — a blank field | `a_blank_epic_field_is_an_argument_error` |
| `CreateEpic` `Conflict` — a prefix already in use | `a_prefix_another_epic_holds_is_a_conflict` |
| `CreateEpic` `LimitExceeded` — the epic cap | `an_epic_over_the_cap_is_limit_exceeded` |
| A created issue hands back the board usage beside its `Id` | `a_created_issue_hands_the_program_the_board_usage` |
| `CreateIssue` `InvalidArgument` — a blank field | `a_blank_issue_field_is_an_argument_error` |
| `CreateIssue` `InvalidArgument` — an `agent` outside the spawnable set | `an_agent_outside_the_spawnable_set_is_an_argument_error` |
| `CreateIssue` `NotFound` — an epic the board does not hold | `an_issue_under_an_epic_that_is_not_there_is_not_found` |
| `CreateIssue` `NotFound` — a blocker the board does not hold | `an_issue_blocker_that_is_not_there_is_not_found` |
| `CreateIssue` `LimitExceeded` — the issue cap | `an_issue_over_the_cap_is_limit_exceeded` |
| A patch carrying `Board.EpicAssignment.Ungroup` and a status returns to its program | `an_updated_issue_returns_to_its_program` |
| `UpdateIssue` `InvalidArgument` — nothing at all was changed | `an_issue_patch_with_no_field_is_an_argument_error` |
| `UpdateIssue` `InvalidArgument` — a field that may not be blanked | `a_blanked_issue_field_is_an_argument_error` |
| `UpdateIssue` `NotFound` — an unknown issue id | `an_update_of_an_issue_that_is_not_there_is_not_found` |
| `UpdateIssue` `NotFound` — an unknown epic id | `a_patch_naming_an_epic_that_is_not_there_is_not_found` |
| A blocker list returns to its program | `an_issue_blocker_list_returns_to_its_program` |
| `SetIssueBlockedBy` `InvalidArgument` — a blank id | `a_blank_id_on_an_issue_blocker_list_is_an_argument_error` |
| `SetIssueBlockedBy` `InvalidArgument` — a blank blocker | `a_blank_blocker_on_an_issue_is_an_argument_error` |
| `SetIssueBlockedBy` `NotFound` — an issue the board does not hold | `blocking_an_issue_that_is_not_there_is_not_found` |
| `SetIssueBlockedBy` `NotFound` — a blocker the board does not hold | `an_issue_blocker_the_board_lacks_is_not_found` |
| `SetIssueBlockedBy` `Conflict` — an edge that would make a cycle | `an_issue_edge_that_closes_a_cycle_is_a_conflict` |
| `SetIssueBlockedBy` `Conflict` — an issue blocked on itself | `an_issue_blocked_on_itself_is_a_conflict` |
| A removed epic hands back the board usage after it | `a_removed_epic_hands_the_program_the_usage_after_it` |
| `RemoveEpic` `NotFound` — an unknown id | `removing_an_epic_that_is_not_there_is_not_found` |
| A removed issue hands back the board usage after it | `a_removed_issue_hands_the_program_the_usage_after_it` |
| `RemoveIssue` `NotFound` — an unknown id | `removing_an_issue_that_is_not_there_is_not_found` |
| A wait is registered and the lines after it still run | `a_registered_wait_does_not_stop_the_program` |
| `WaitForIssue` `InvalidArgument` — a blank id | `a_blank_wait_id_is_an_argument_error` |
| `WaitForIssue` `InvalidArgument` — the issue this run was itself assigned | `waiting_on_this_runs_own_issue_is_an_argument_error` |
| `WaitForIssue` `NotFound` — an id the board does not hold | `waiting_on_an_issue_that_is_not_there_is_not_found` |
| `WaitForIssue` `Unavailable` — the run has no board | `waiting_without_a_board_is_unavailable` |

The registration test is the one that pins the call's surprising half: the
program writes a line, calls `Board.WaitForIssue`, writes another, and both lines
are asserted in order alongside the `wait_for_issue` call in the `CallLog`. The
`Unavailable` test runs its program with
`all_operations_without(CAPABILITY_PROJECT_MANAGEMENT)` (`fake.test.rs:1185`,
constant at `crates/core/src/gg.rs:1065`) and asserts an empty `CallLog`, in the
shape at `csharp.surface.test.rs:865`.

## Done when

- [ ] Every operation of the shell, files, memories, tasks, board and skills
      modules has a C# program test asserting what a successful call hands back.
- [ ] Every runtime failure each of those functions documents in its
      `<exception>` element has its own C# program test asserting the code, the
      operation and, where the detail is load-bearing, the message.
- [ ] The two guest-side guards assert an empty `CallLog`.
- [ ] Each test is one `#[test]` driving one program.
- [ ] A `fails_with` helper sits beside `run_with` and every failure test uses it.
- [ ] The consolidation notes at `csharp.surface.test.rs:13-17` and
      `csharp.substrate.test.rs:42-45` ask for a function per case.
- [ ] Gates green.
