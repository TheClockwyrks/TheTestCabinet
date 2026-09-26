# Dispatch every registry tool through its real name

Drive every self-contained tool the registry can offer through
`ToolRegistry::dispatch` with a synthesized `ToolCall`, so each name a model may
utter is proven to route to a tool that answers it.

## Current state

`ToolRegistry::dispatch` (`crates/gg/src/tools/mod.rs:1065`) is the one place a
tool name becomes an `invoke`, matching on `Tool::name()` and answering an
unmatched name with `ToolFailure::Unavailable`. `ALL_TOOL_NAMES`
(`crates/gg/src/tools/mod.rs:168`) is the vocabulary, and
`all_tool_names_matches_a_maximal_registry`
(`crates/gg/src/tools/mod.test.rs:1097`) holds it in lockstep with what
`maximal_registries` (`:1014`) offers.

The tests that go through `dispatch` are
`dispatch_unknown_tool_returns_error_outcome`
(`crates/gg/src/tools/mod.test.rs:334`),
`dispatch_withheld_tool_returns_error_outcome` (`:357`),
`dispatch_routes_to_the_named_tool` (`:378`, a `write_file` call) and
`dispatch_of_an_ungranted_tool_returns_error_outcome` (`:703`). Every other tool
test constructs the tool directly and calls `invoke`, so a tool that answered to
a name the registry does not bind it under would still pass.

`every_offered_tool_declares_itself_to_the_model`
(`crates/gg/src/tools/mod.test.rs:1127`) already walks `maximal_registries` and
asserts each definition's shape, which is the pattern a per-name dispatch table
follows.

`maximal_registries` builds its module runtimes inline, and `TasksRuntime`,
`BoardRuntime` and `MemoriesRuntime` each expose the shared store through
`store()` (`crates/gg/src/tasks.rs:1043`, `crates/gg/src/board.rs:1663`,
`crates/gg/src/memories.rs:2077`), so a fixture that keeps those handles can
assert what a dispatched call changed.

`read_skill` reads its `name` through `required_str`
(`crates/gg/src/tools/skills.rs:75`), and its ill-typed branch is the one
argument diagnostic in `crates/gg/src/tools/skills.test.rs` with no test:
`read_skill_errors_on_a_missing_name_argument` (`:56`) and
`an_unknown_skill_is_not_found_and_a_malformed_call_is_not` (`:81`) cover the
absent name and the unknown skill.

## Design

Add a `dispatchable_registry()` helper to `crates/gg/src/tools/mod.test.rs`
beside `maximal_registries` at `:1014`. It builds one registry over a `TempDir`
workspace with the same maximal capability set, a markdown memory strategy, a
roster, and an FSM position, and returns it alongside the `TempDir`, the skill
library and the three store handles taken from the runtimes before they are
moved into the modules.

Then add `every_self_contained_tool_answers_its_own_name`, one
`#[tokio::test]` holding a table of `(name, arguments)` pairs — one entry for
each `ALL_TOOL_NAMES` name whose tool is reached through `dispatch` — and
dispatching each in an order that leaves the stores in a state the next call can
use. The test asserts for each call that the outcome is ok, and it fails if the
table's names and `ALL_TOOL_NAMES` minus the loop-intercepted names disagree, so
a newly added tool has to be given a call here.

The table's entries, in order:

- `write_file`, `read_file`, `edit_file`, `list_dir`, `tree`, `search` over the
  `TempDir`, ending with the workspace state each left behind.
- `shell` running `printf ok`.
- `read_skill` naming a skill the seeded library holds.
- `write_memory`, `update_memory`, `create_memory`, `read_memory`,
  `edit_memory`, `search_memories`, `delete_memory`, asserted against the memory
  store handle.
- `add_task`, `update_task`, `set_blocked_by`, `complete_task`, `remove_task`,
  asserted against the task store handle.
- `create_epic`, `create_issue`, `update_issue`, `set_issue_blocked_by`,
  `remove_issue`, `remove_epic`, asserted against the board store handle.
- `evict_file_view`, `archive_thread`, `compact`, each of which validates only,
  and `search_archive` over the bound archive.

Two further tests land beside it:

- `a_dispatched_call_with_a_bad_argument_is_an_argument_error` — the same
  registry dispatching `read_file` with `"path": 7`, asserting
  `ToolFailure::InvalidArgument` reaches the caller through `dispatch` rather
  than a panic.
- `a_read_skill_name_that_is_not_a_string_is_an_argument_error`, in
  `crates/gg/src/tools/skills.test.rs` — `json!({ "name": 7 })`;
  `InvalidArgument`.

## Done when

- [ ] Every `ALL_TOOL_NAMES` name whose tool is reached through `dispatch` has a
      synthesized `ToolCall` driven through a real registry.
- [ ] The table is checked against `ALL_TOOL_NAMES` so a new tool must be given a
      call.
- [ ] Each store-backed call asserts the store's state afterwards.
- [ ] `read_skill` has a test for an ill-typed `name`.
- [ ] Gates green.
