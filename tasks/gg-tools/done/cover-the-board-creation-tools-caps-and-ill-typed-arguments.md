# Cover the board creation tools' caps and ill-typed arguments

Surface the board's count caps to a model through `create_epic` and
`create_issue`, and give both tools a test for each argument diagnostic and
unknown reference their creation path can raise.

## Current state

`BoardStore` refuses a creation past its ceiling with `BoardError::CountCap`, for
epics at `crates/gg/src/board.rs:985-990` and for issues at `:1023-1028`, and
`failure_for` (`crates/gg/src/tools/board.rs:121`) maps it to
`ToolFailure::LimitExceeded`. No test in `crates/gg/src/tools/board.test.rs`
asserts that class, because `fixture()` (`crates/gg/src/tools/board.test.rs:33`)
builds every store on `BoardCaps::detached()` (`crates/gg/src/board.rs:209`),
whose ceilings are deliberately generous.

`create_epic` reads three required strings at
`crates/gg/src/tools/board.rs:222-234`, and the file's coverage of it is the
prefix rule (`board.test.rs:145`) and the duplicate prefix and invalid prefix
classifications (`:431`).

`create_issue` reads nine arguments at `crates/gg/src/tools/board.rs:390-426`,
including `epicId` through `optional_str` at `:415`, `blockedBy` through
`name_array` at `:419` and `reviewers` through `name_array` at `:423`.
`name_array` (`crates/gg/src/tools/board.rs:130-157`) refuses a value that is not
an array and an entry that is not a string. The structured fields are covered at
`board.test.rs:168`, the implementer policy at `:185` and the reviewer policy at
`:269`; the only ill-typed board argument asserted anywhere is
`set_issue_blocked_by`'s `"blockedBy": "b"` at `:496-498`. The store's unknown
`epicId` is asserted through `update_issue` at `:471`, never through a creation,
and `normalize_blockers` refuses an unknown blocker on creation
(`crates/gg/src/board.rs:1030`) with nothing driving it.

## Design

All of these land in `crates/gg/src/tools/board.test.rs`. Add a
`bounded_fixture(max_epics, max_issues)` beside `fixture` at `:33`, building a
`BoardStore` on a `BoardCaps` with those ceilings and `max_retries: 1`. Each case
is its own short `#[tokio::test]` calling the tool's `invoke` with a synthesized
JSON argument object, and reuses `issue_args` (`:86`) and `epic_args` (`:97`).

### `create_epic`

- `an_epic_past_the_epic_cap_is_a_limit` — a board bounded at one epic; the
  second creation is `ToolFailure::LimitExceeded` and the message names the
  ceiling.
- `an_epic_missing_a_required_argument_is_an_argument_error` — one call per
  absent field across `prefix`, `title` and `description`.
- `an_epic_with_an_ill_typed_prefix_is_an_argument_error` — `"prefix": 7`.

### `create_issue`

- `an_issue_past_the_issue_cap_is_a_limit` — a board bounded at one issue;
  `LimitExceeded`.
- `an_issue_naming_an_unknown_epic_is_not_found` — `issue_args` plus
  `"epicId": "GHOST"`; `ToolFailure::NotFound`, and the board holds no new issue.
- `an_issue_naming_an_unknown_blocker_is_not_found` — `issue_args` plus
  `"blockedBy": ["ISSUE-9"]` on an empty board; `NotFound`.
- `an_issue_whose_blocked_by_is_not_a_list_is_an_argument_error` —
  `"blockedBy": "ISSUE-1"`; `InvalidArgument`, and the message names the field.
- `an_issue_with_a_blocker_that_is_not_a_string_is_an_argument_error` —
  `"blockedBy": [7]`.
- `an_issue_whose_reviewers_are_not_a_list_is_an_argument_error` —
  `"reviewers": "critic"`.
- `an_issue_with_a_reviewer_that_is_not_a_string_is_an_argument_error` —
  `"reviewers": [{}]`.
- `an_issue_with_an_ill_typed_epic_id_is_an_argument_error` — `"epicId": 4`,
  refused by `optional_str`.
- `an_issue_missing_its_agent_is_an_argument_error` — `issue_args` with `agent`
  removed, alongside the structured-field coverage already at `:168` and the
  partial call at `:484-486`.

## Done when

- [ ] `create_epic` and `create_issue` each have a test asserting
      `ToolFailure::LimitExceeded` against a board bounded by its own ceiling.
- [ ] Every argument `create_issue` reads has a test for an ill-typed value or an
      absent required one.
- [ ] An unknown `epicId` and an unknown blocker are each asserted on the
      creation path, with the board left unchanged.
- [ ] Gates green.
