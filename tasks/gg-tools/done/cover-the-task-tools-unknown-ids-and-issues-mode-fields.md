# Cover the task tools' unknown ids and issues-mode fields

Drive the task tools in issues mode, and give each of them a test for the
unknown id and the argument diagnostics its adapter raises.

## Current state

`TaskStore` runs in one of two list modes (`crates/gg/src/tasks.rs:132`).
`TaskStore::with_mode` (`crates/gg/src/tasks.rs:524`) selects one, and
`TaskMode::Issues` turns on two pieces of tool surface: `read_structured`
(`crates/gg/src/tools/tasks.rs:261`) parses the `inScope`, `outOfScope` and
`completionCriteria` arguments, and `merge_structured_properties`
(`crates/gg/src/tools/tasks.rs:271`) adds them to the declared schema and to the
required list, at `crates/gg/src/tools/tasks.rs:164-165` for `add_task` and
`:331` for `update_task`. The store then requires all three in issues mode
(`resolve_structured`, `crates/gg/src/tasks.rs:625`).

`fixture(max_tasks)` (`crates/gg/src/tools/tasks.test.rs:14`) always builds
`TaskStore::new`, which is simple mode (`crates/gg/src/tasks.rs:519`), so nothing
in the file drives either piece.

The argument coverage is uneven. `tools_validate_their_arguments`
(`crates/gg/src/tools/tasks.test.rs:125`) and
`each_store_refusal_is_classified_from_its_variant` (`:201`) cover `add_task` and
`set_blocked_by`'s `blockedBy`, the unparseable status and the DAG refusals.
`update_task` reads `id`, `title`, `description` and `status` at
`crates/gg/src/tools/tasks.rs:346-374`, `complete_task` and `remove_task` each
read `id`, and no test hands any of them an absent or ill-typed one, nor an id
the store does not hold.

`TaskStore::remove` (`crates/gg/src/tasks.rs:745`) removes the task and then
strips its id from every other task's `blocked_by`, so removing a blocker
succeeds and leaves the tasks it blocked unblocked. That is the contract the
tests assert.

## Design

All of these land in `crates/gg/src/tools/tasks.test.rs`. Add an
`issues_fixture(max_tasks)` beside `fixture` at `:14`, building
`TaskStore::with_mode(max_tasks, TaskMode::Issues)` and returning the same
triple. Each case is its own short `#[tokio::test]` calling the tool's `invoke`
with a synthesized JSON argument object.

### Issues mode

- `an_issues_mode_task_carries_its_three_sections` — `add_task` with `id`,
  `title` and all three sections succeeds, and reading the task back off the
  store shows each section stored.
- `an_issues_mode_task_missing_a_section_is_an_argument_error` — one call per
  absent section, each `ToolFailure::InvalidArgument` with the field named.
- `an_issues_mode_section_that_is_not_a_string_is_an_argument_error` —
  `"inScope": 7`, refused by `read_structured` before the store is touched.
- `the_add_task_schema_declares_its_sections_only_in_issues_mode` — the
  `definition()` of an `AddTaskTool` over a simple-mode store declares neither
  the three properties nor the three required names, and over an issues-mode
  store declares both.
- `an_issues_mode_update_may_revise_one_section` — `update_task` naming only
  `completionCriteria` succeeds and leaves the other two as they were.
- `an_issues_mode_update_with_an_ill_typed_section_is_an_argument_error` —
  `"outOfScope": []`.

### Unknown ids and argument diagnostics

- `an_update_of_an_unknown_task_is_not_found` — `ToolFailure::NotFound`.
- `an_update_missing_its_id_is_an_argument_error` — `json!({ "title": "T" })`.
- `an_update_with_an_ill_typed_title_is_an_argument_error` — `"title": 7`; a
  second call asserts the same for `description`.
- `blocking_an_unknown_task_is_not_found` — `set_blocked_by` naming a subject the
  store does not hold, with an existing blocker; `NotFound`.
- `a_set_blocked_by_missing_its_id_is_an_argument_error` —
  `json!({ "blockedBy": [] })`.
- `completing_an_unknown_task_is_not_found` — `NotFound`.
- `a_complete_missing_its_id_is_an_argument_error` — `json!({})`; a second call
  with `"id": 1` asserts the ill-typed branch.
- `removing_an_unknown_task_is_not_found` — `NotFound`.
- `a_remove_missing_its_id_is_an_argument_error` — `json!({})`; a second call
  with `"id": null` asserts the ill-typed branch.
- `removing_a_blocker_unblocks_the_tasks_it_blocked` — two tasks with an edge
  between them; removing the blocker succeeds and the dependent's `blocked_by` is
  empty.

## Done when

- [ ] Every task tool has a test for an absent `id` and an ill-typed one.
- [ ] `update_task`, `set_blocked_by`, `complete_task` and `remove_task` each
      have a test for an id the store does not hold.
- [ ] `add_task` and `update_task` are driven against an issues-mode store, and
      the issues-mode schema is asserted from `definition()`.
- [ ] Removing a task other tasks are blocked by is asserted to leave them
      unblocked.
- [ ] Gates green.
