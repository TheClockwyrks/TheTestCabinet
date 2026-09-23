# Drive gg's workspace SDK modules from Ruby programs

Give the Ruby arm a program-level test for every call in `shell`, `files`,
`memories`, `tasks`, `board` and `skills`: one for the successful call, read back
the way a model reads it, and one for each runtime failure mode a well-typed call
can hit.

## Current state

Every operation in these six families already has a crossing row, so the
arguments a Ruby spelling lowers onto the wire are checked exhaustively:
`crates/gg/src/sandbox/language/ruby.substrate.test.rs:880` builds the table and
`:1102` drives it against `sandbox_operation_names()`. What the table cannot say
is what a program reads back, because every row is answered by `canned_outcome`
and asserted on the recorded JSON alone.

A handful of returns and failures are already driven from real Ruby.
`the_sdk_hands_a_program_values_ruby_can_read` (`:409`) reads a `TextFile` back
at `:417`, a `DirEntry` and its `EntryKind` at `:435`, and a `ShellOutput` at
`:440`; it rescues `read_file`'s `not_found` at `:473` and reads `update_task`'s
bad-status refusal at `:480`. `the_workspace_search_and_the_line_cut_cross_from_ruby`
(`:2377`) reads a `SearchMatch` back at `:2380`, and refuses a `limit` of zero at
`:2384` and a Regexp `query` at `:2389`. `read_file`'s uncaught `not_found` is
gate G8's first case at `:2112`, and the same failure read as a `ToolFailure`
kind sits at `:639`.

The harness these tests reuse is this file's own. `run_with`
(`crates/gg/src/sandbox/language/ruby.substrate.test.rs:230`) compiles Ruby
through the production prepare step and evaluates it against the real membrane,
returning the outcome and a `CallLog`; `run_as` (`:96`) is the same with an
ending and a program library; `run` (`:240`) grants nothing. `logs` (`:256`)
asserts the program did not raise and hands back what it printed, and
`program_error` (`:271`) hands back the raise it did not rescue. The tool side is
`FakeOperationApi` (`crates/gg/src/sandbox/fake.test.rs:141`) writing into a
`CallLog` (`:90`, with `names` at `:102`, `args` at `:117` and `calls` at `:94`),
answering with `canned_outcome` (`:780`). A failure is injected by wrapping
`canned_outcome` in a responder that returns
`ToolOutcome::failed(ToolFailure::NotFound, "…")` for the one call under test,
the shape already written at `:486`.

## Design

Every test below lands in
`crates/gg/src/sandbox/language/ruby.substrate.test.rs`, is its own `#[test]`,
and drives one short Ruby program through `run_with` with `all_operations()`
granted. The consolidation note at `:19` is revised as part of this work: a
distinct runtime failure mode gets its own function, and the guidance it keeps is
that each program stays short.

Two rules decide what counts as one case. A refusal the SDK raises guest-side is
its own case and asserts that the `CallLog` stayed empty, because the value never
reached the wire. A refusal the host would raise is one case per `ApiErrorCode`
the program can branch on, because the double answers whatever the responder
returns and a second injection of the same code with a different sentence proves
nothing further.

A failure test rescues `GG::Core::ApiError`, prints `failure.operation`,
`failure.code` and whatever of `failure.message` the case is about, and asserts
the printed line. A success test prints the readers off the returned value and
asserts the printed line, and where the call returns `nil` the crossing row
already carries the assertion and is cited rather than repeated.

### shell

- `a_shell_output_is_read_back_from_ruby` — covered at `:440`.
- `a_non_zero_exit_is_a_value_rather_than_a_raise` — `GG::Shell.run("make fail")`
  outside any `begin`, reading `exit_code` as 1; `shell_outcome`
  (`crates/gg/src/sandbox/fake.test.rs:928`) exits non-zero for a command
  containing `fail`.
- `a_killed_shell_is_a_limit_exceeded_the_program_rescues` — inject
  `ToolFailure::LimitExceeded`.
- `a_shell_that_could_not_launch_is_an_io_error` — inject `ToolFailure::IoError`.
- `a_nonsense_shell_timeout_never_reaches_the_wire` — `timeout_secs: -1`, refused
  by `Check.positive` (`packages/gg-sandbox-ruby/src/gg/check.rb:45`) naming
  `timeout_secs`, with the log empty.

### files

- `a_text_read_is_read_back_from_ruby` — covered at `:417`.
- `an_image_read_narrows_to_the_image_class` —
  `GG::Files.read_file("logo.png")` returns `GG::Files::ImageFile`, read through
  the `case` the SDK documents; `read_outcome`
  (`crates/gg/src/sandbox/fake.test.rs:946`) answers a `.png` path with the image
  variant.
- `a_missing_file_is_a_not_found_the_program_rescues` — covered at `:473`.
- `an_empty_read_path_is_an_argument_error` — inject
  `ToolFailure::InvalidArgument`.
- `a_negative_read_offset_never_reaches_the_wire` — `offset: -1`, refused by
  `Check.uint` (`packages/gg-sandbox-ruby/src/gg/check.rb:29`) naming `offset`,
  with the log empty.
- `a_write_hands_back_the_bytes_it_wrote` — read the `Integer` return of
  `GG::Files.write_file`.
- `a_write_with_neither_contents_nor_a_block_is_refused` — guest-side at
  `packages/gg-sandbox-ruby/src/gg/files.rb:57`, with the log empty.
- `an_empty_write_path_is_an_argument_error` — inject `InvalidArgument`.
- `a_write_that_failed_is_an_io_error` — inject `IoError`.
- `an_edit_whose_text_is_absent_is_a_not_found` — inject `NotFound`.
- `an_edit_that_matches_twice_is_a_conflict_carrying_the_count` — inject
  `Conflict` with a message naming the match count, and assert the count survives
  into what the program printed.
- `a_directory_listing_is_read_back_from_ruby` — covered at `:435`.
- `an_empty_directory_is_an_empty_array` — responder returns
  `ApiData::DirEntries(vec![])`; the program prints `entries.empty?`.
- `an_omitted_list_path_lowers_as_null` — `GG::Files.list_dir` with no argument
  must arrive as `{ "path": null }`.
- `a_missing_directory_is_a_not_found` — inject `NotFound`.
- `an_empty_list_path_is_an_argument_error` — inject `InvalidArgument`.
- `a_tree_hands_back_its_rendering` — read the `String` return.
- `a_tree_depth_of_zero_never_reaches_the_wire` — guest-side at
  `packages/gg-sandbox-ruby/src/gg/files.rb:129`, with the log empty.
- `a_tree_of_a_missing_path_is_a_not_found` — inject `NotFound`.
- `a_tree_of_something_that_is_not_a_directory_is_an_argument_error` — inject
  `InvalidArgument`.
- `a_search_match_is_read_back_from_ruby` — covered at `:2380`.
- `a_search_limit_of_zero_never_reaches_the_wire` — covered at `:2384`.
- `a_regexp_query_never_reaches_the_wire` — covered at `:2389`.
- `a_blank_search_query_is_an_argument_error` — inject `InvalidArgument`.
- `a_search_of_a_missing_path_is_a_not_found` — inject `NotFound`.

The unparseable pattern and the blank query are one injected `InvalidArgument`
between them, so the blank-query case stands for both.

### skills

- `a_skill_body_is_read_back_from_ruby` — read the `String` return of
  `GG::Skills.read_skill("testing")`.
- `an_unknown_skill_names_the_skills_that_exist` — inject `NotFound` with a
  message that names the skills that do exist, and assert the program printed
  that list.

### memories

Each creation and mutation returns a `GG::Memories::MemoryUsage`, so its success
test prints `count`, `max_count`, `total_chars` and `max_total_chars`.

- `writing_a_memory_hands_back_the_budget`.
- `a_memory_carrying_code_and_an_on_use_note_lowers_both` — `code:` and
  `on_use:` given, asserted on the recorded JSON, which the crossing row at
  `:924` sends as null.
- `writing_a_memory_that_already_exists_is_a_conflict` — inject `Conflict`.
- `writing_a_memory_past_the_cap_is_a_limit_exceeded` — inject `LimitExceeded`.
- `updating_a_memory_hands_back_the_budget`.
- `updating_a_memory_that_is_not_there_is_a_not_found` — inject `NotFound`.
- `updating_a_memory_past_the_cap_is_a_limit_exceeded` — inject `LimitExceeded`.
- `creating_a_memory_hands_back_the_budget`.
- `creating_a_memory_whose_slug_is_taken_is_a_conflict` — inject `Conflict`.
- `creating_a_memory_past_the_cap_is_a_limit_exceeded` — inject `LimitExceeded`.
- `reading_a_memory_hands_back_its_contents` — read the `String` return.
- `reading_a_memory_that_is_not_there_is_a_not_found` — inject `NotFound`.
- `editing_a_memory_hands_back_the_budget`.
- `editing_a_memory_whose_text_is_absent_is_a_not_found` — inject `NotFound`.
- `editing_a_memory_that_matches_twice_is_a_conflict` — inject `Conflict`.
- `editing_a_memory_past_the_cap_is_a_limit_exceeded` — inject `LimitExceeded`.
- `an_edit_that_would_empty_a_memory_is_an_argument_error` — inject
  `InvalidArgument`.
- `a_memory_search_hit_is_read_back_from_ruby` — print `name`, `description`,
  `matched`, `occurrences` and `excerpt`.
- `a_memory_hit_reads_its_own_memory` — `hits.first.read`, the member spelling at
  `packages/gg-sandbox-ruby/src/gg/memories.rb:262`, arriving under `read_memory`
  with the hit's name.
- `a_memory_search_that_matched_nothing_is_an_empty_array` — responder returns
  `ApiData::MemoryHits(vec![])`.
- `a_memory_search_with_no_keywords_is_an_argument_error` — inject
  `InvalidArgument`.
- `a_non_string_keyword_never_reaches_the_wire` — refused by `Check.strings`
  (`packages/gg-sandbox-ruby/src/gg/check.rb:66`), with the log empty.
- `deleting_a_memory_hands_back_the_budget`.
- `deleting_a_memory_that_is_not_there_is_a_not_found` — inject `NotFound`.

### tasks

- `adding_a_task_hands_back_the_budget` — print `count` and `max_tasks` off the
  returned `GG::Tasks::TaskUsage`.
- `adding_a_task_whose_id_is_taken_is_a_conflict` — inject `Conflict`.
- `adding_a_task_that_would_close_a_cycle_is_a_conflict` — inject `Conflict` with
  a message naming the edge, and assert the program printed it, so the two
  conflict causes are told apart by what the model reads.
- `a_non_string_blocker_never_reaches_the_wire` — `blocked_by: ["t0", 7]`,
  refused by `Check.strings`, with the log empty.
- `updating_a_task_crosses_with_its_sentinels` — covered by the crossing row at
  `:964`.
- `updating_a_task_that_is_not_there_is_a_not_found` — inject `NotFound`.
- `an_unknown_task_status_never_reaches_the_wire` — covered at `:480`.
- `restating_a_tasks_blockers_crosses_from_ruby` — covered by the crossing row
  at `:974` and the splat form at `:2072`.
- `restating_the_blockers_of_a_task_that_is_not_there_is_a_not_found` — inject
  `NotFound`.
- `a_blocker_edge_that_would_close_a_cycle_is_a_conflict` — inject `Conflict`.
- `completing_a_task_crosses_from_ruby` — covered by the crossing row at `:979`.
- `completing_a_task_that_is_not_there_is_a_not_found` — inject `NotFound`.
- `removing_a_task_hands_back_the_budget`.
- `removing_a_task_that_is_not_there_is_a_not_found` — inject `NotFound`.

### board

The two creations return an id and a `GG::Board::BoardUsage`, so their success
tests print the id alongside `epics`, `max_epics`, `issues` and `max_issues`.

- `creating_an_epic_hands_back_its_id_and_the_budget`.
- `a_bad_epic_prefix_is_an_argument_error` — inject `InvalidArgument`; the
  too-short, too-long and non-letter prefixes are one refusal the host writes
  three messages for.
- `an_epic_prefix_already_taken_is_a_conflict` — inject `Conflict`.
- `creating_an_issue_hands_back_its_id_and_the_budget`.
- `an_unassignable_agent_is_an_argument_error` — inject `InvalidArgument`; the
  unassignable reviewer is the same refusal.
- `an_issue_blocker_that_would_close_a_cycle_is_a_conflict` — inject `Conflict`.
- `a_non_string_reviewer_never_reaches_the_wire` — refused by `Check.strings`,
  with the log empty.
- `updating_an_issue_crosses_with_its_sentinels` — covered by the crossing row at
  `:1011`.
- `updating_an_issue_that_is_not_there_is_a_not_found` — inject `NotFound`.
- `an_unknown_issue_status_never_reaches_the_wire` — refused by `Check.choice`
  (`packages/gg-sandbox-ruby/src/gg/board.rb:132`) naming the accepted symbols,
  with the log empty.
- `restating_an_issues_blockers_crosses_from_ruby` — covered by the crossing row
  at `:1028`.
- `restating_the_blockers_of_an_issue_that_is_not_there_is_a_not_found` — inject
  `NotFound`.
- `an_issue_edge_that_would_close_a_cycle_is_a_conflict` — inject `Conflict`.
- `removing_an_epic_hands_back_the_budget`.
- `removing_an_epic_that_is_not_there_is_a_not_found` — inject `NotFound`.
- `removing_an_issue_hands_back_the_budget`.
- `removing_an_issue_that_is_not_there_is_a_not_found` — inject `NotFound`.
- `a_registered_wait_lets_the_program_run_on` — print the acknowledgement
  `GG::Board.wait_for_issue` returns and a line after it, so the registration is
  visibly not a block.
- `a_created_issue_waits_on_itself` — `created.wait`, the member spelling at
  `packages/gg-sandbox-ruby/src/gg/board.rb:287`, arriving under
  `wait_for_issue` with the id the board assigned.
- `waiting_on_an_issue_that_is_not_there_is_a_not_found` — inject `NotFound`.
- `waiting_on_this_sessions_own_issue_is_an_argument_error` — inject
  `InvalidArgument`.

## Done when

- [ ] Every call in `shell`, `files`, `memories`, `tasks`, `board` and `skills`
      has a Ruby program that makes it succeed and reads the result back, or a
      cited crossing row that already asserts it.
- [ ] Every runtime failure mode listed above has its own `#[test]` driving a
      Ruby program that rescues `GG::Core::ApiError` and reads the code.
- [ ] Every guest-side refusal asserts that the `CallLog` stayed empty.
- [ ] The consolidation note at
      `crates/gg/src/sandbox/language/ruby.substrate.test.rs:19` reads as a rule
      about program length rather than about function count.
- [ ] Gates green.
