# Refuse the loop-intercepted tools' ordinary dispatch

Assert that each tool the agent loop intercepts answers an ordinary
`ToolRegistry::dispatch` with the gg-defect refusal its declaration promises,
rather than reporting a success it never performed.

## Current state

The intercepted tools are declared so a model can call them and are then handled
by the loop instead of by dispatch. `spawn_subagent`, `wait_for_subagents` and
`send_message` each return `handled_by_loop`
(`crates/gg/src/tools/subagents.rs:72`) from their `invoke`, at
`crates/gg/src/tools/subagents.rs:130`, `:163` and `:200`. `transition_state`,
`exec` and `fork` do the same at `crates/gg/src/tools/transitions.rs:132`, `:207`
and `:315`. `wait_for_issue` returns its own refusal at
`crates/gg/src/tools/board.rs:905-909`.

The loop routes them away from dispatch: the delegation trio through
`is_subagent_tool` (`crates/gg/src/tools/subagents.rs:63`) at
`crates/gg/src/agent.rs:8302`, and `wait_for_issue` at `:8291-8300`. That routing
is what these bodies exist to survive a change to.

No test in the crate references `handled_by_loop`, and no test dispatches any of
these names, so each body is unasserted: a tool whose `invoke` returned an ok
outcome would tell a model its subagent had been spawned while nothing ran.

`maximal_registries` (`crates/gg/src/tools/mod.test.rs:1014`) builds registries
that offer every one of them, and `all_tool_names_matches_a_maximal_registry` (`:1097`)
is the test that proves it.

## Design

One `#[tokio::test]` per tool in `crates/gg/src/tools/mod.test.rs`, beside the
dispatch tests that start at `:334`. Each builds a registry from
`maximal_registries`, dispatches a well-formed `ToolCall` for its name, and
asserts the outcome is not ok and that its output names the tool and says the
call cannot be dispatched there.

- `spawn_subagent_refuses_ordinary_dispatch` — `json!({ "prompt": "do the work",
  "agent": "root" })`.
- `wait_for_subagents_refuses_ordinary_dispatch` — `json!({})`.
- `send_message_refuses_ordinary_dispatch` — `json!({ "agentId": "agent-1",
  "message": "keep going" })`.
- `wait_for_issue_refuses_ordinary_dispatch` — `json!({ "issueId": "ISSUE-1" })`.
- `transition_state_refuses_ordinary_dispatch` — `json!({ "state": "verify" })`,
  the target the fixture's machine declares (`fsm_position`, `:823`).
- `exec_refuses_ordinary_dispatch` — `json!({ "agent": "root" })`.
- `fork_refuses_ordinary_dispatch` — `json!({ "prompt": "try the other fix" })`.

Each test passes arguments the real handler would accept, so what it proves is
the interception rather than an argument diagnostic.

## Done when

- [ ] Each intercepted name is dispatched through a real `ToolRegistry` with
      arguments its loop handler would accept.
- [ ] Each asserts a refused outcome naming the tool.
- [ ] Gates green.
