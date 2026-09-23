# Cover the board mutators' unknown ids and removals

Give `update_issue`, `set_issue_blocked_by`, `remove_epic` and `remove_issue` a
test for each argument diagnostic and each store refusal their own call path can
raise, and pin down what a removal leaves behind.

## Current state

The four mutators read their arguments through the same helpers the creation
tools do. `update_issue` reads `id` and seven optional strings at
`crates/gg/src/tools/board.rs:569-600`, `set_issue_blocked_by` reads `id` and a
required `blockedBy` list at `:707-712`, and `remove_epic` and `remove_issue`
each read `id` at `:777` and `:840`.

`each_store_refusal_is_classified_from_its_variant`
(`crates/gg/src/tools/board.test.rs:431`) covers an unknown issue on
`update_issue` (`:466-468`), an unknown `epicId` (`:470-473`), an unknown blocker
on `set_issue_blocked_by` (`:475-478`), an unparseable status, a revision with no
fields, and `set_issue_blocked_by` with a non-array `blockedBy` (`:496-498`).
`unknown_issue_is_a_recoverable_tool_error` (`:374`) and
`set_issue_blocked_by_surfaces_a_cycle_as_a_tool_error_without_mutating` (`:322`)
cover the rest of what is asserted today.

What no test reaches: `BoardError::EmptyField`
(`crates/gg/src/board.rs:748`), raised through `require_field` when a revision
supplies a field as an empty string; `BoardError::SelfBlock`
(`crates/gg/src/board.rs:760`, raised at `:1419`), which is its own variant
beside `Cycle`; a `set_issue_blocked_by` whose subject issue does not exist; an
absent `id` or `blockedBy` key on any of the four; and both removals' unknown
ids.

The removals' contracts are settled in the store. `remove_epic`
(`crates/gg/src/board.rs:1344`) clears `epic_id` on every issue grouped under the
epic, and `remove_issue` (`:1360`) strips the removed id from every other issue's
`blocked_by`. Both succeed; the tests assert what they leave behind.

`fixture()` (`crates/gg/src/tools/board.test.rs:33`), `issue_args` (`:86`),
`epic_args` (`:97`) and `assigned_id` (`:25`) are the harness.

## Design

All of these land in `crates/gg/src/tools/board.test.rs`, each a short
`#[tokio::test]` calling the tool's `invoke` with a synthesized JSON argument
object.

### `update_issue`

- `a_revision_that_empties_a_required_field_is_an_argument_error` — an existing
  issue revised with `"inScope": ""`; `ToolFailure::InvalidArgument`, and the
  issue keeps its previous text.
- `a_revision_missing_its_id_is_an_argument_error` — `json!({ "title": "T" })`.
- `a_revision_with_an_ill_typed_field_is_an_argument_error` — `"title": 7`, and a
  second call with `"epicId": []`.

### `set_issue_blocked_by`

- `an_issue_blocked_by_itself_is_a_conflict` — an issue naming its own id;
  `ToolFailure::Conflict`, and its `blocked_by` is untouched.
- `blocking_an_unknown_issue_is_not_found` — a subject id the board does not
  hold, with an existing blocker; `ToolFailure::NotFound`.
- `a_set_issue_blocked_by_missing_its_list_is_an_argument_error` —
  `json!({ "id": "ISSUE-1" })`; the message names `blockedBy`.
- `a_set_issue_blocked_by_missing_its_id_is_an_argument_error` —
  `json!({ "blockedBy": [] })`.

### `remove_epic`

- `removing_an_unknown_epic_is_not_found` — `ToolFailure::NotFound`.
- `a_remove_epic_missing_its_id_is_an_argument_error` — `json!({})`, and a second
  call with `"id": 7`.
- `removing_an_epic_ungroups_the_issues_it_held` — an epic with an issue filed
  under it; the removal succeeds, the issue survives, and its `epic_id` is
  cleared.

### `remove_issue`

- `removing_an_unknown_issue_is_not_found` — `ToolFailure::NotFound`.
- `a_remove_issue_missing_its_id_is_an_argument_error` — `json!({})`, and a
  second call with `"id": null`.
- `removing_a_blocker_unblocks_the_issues_it_blocked` — two issues with an edge
  between them; removing the blocker succeeds and the dependent's `blocked_by` is
  empty.

## Done when

- [ ] Each of the four mutators has a test for an absent `id` and an ill-typed
      one.
- [ ] `BoardError::EmptyField` and `BoardError::SelfBlock` each reach a model
      through a board tool in at least one test.
- [ ] `set_issue_blocked_by`, `remove_epic` and `remove_issue` each have a test
      for an id the board does not hold.
- [ ] Both removals assert what the board holds afterwards.
- [ ] Gates green.
