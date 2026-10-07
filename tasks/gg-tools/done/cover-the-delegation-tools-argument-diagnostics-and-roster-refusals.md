# Cover the delegation tools' argument diagnostics and roster refusals

Script the malformed and out-of-roster `spawn_subagent`, `wait_for_subagents` and
`send_message` calls a model actually makes, and assert the refusals their loop
handlers answer with.

## Current state

These three tools are declared in `crates/gg/src/tools/subagents.rs` and handled
by the agent loop, so their behaviour lives in `crates/gg/src/agent.rs` and their
tests belong in the agent test files rather than under
`crates/gg/src/tools/`. The handlers are `spawn_subagent`
(`crates/gg/src/agent.rs:4675`), `wait_for_subagents` (`:5114`) and
`send_message` (`:5287`).

Each holds refusals nothing drives:

- `spawn_subagent` refuses an absent or blank `prompt` at
  `crates/gg/src/agent.rs:4676-4684`, and `resolve_delegation_target`
  (`crates/gg/src/agent.rs:4802`) refuses an `agent` outside the spawner's roster
  at `:4838-4844` and an absent `agent` at `:4845-4851`, both listing the ids it
  may name.
- `wait_for_subagents` refuses an `ids` entry naming an agent it did not spawn at
  `crates/gg/src/agent.rs:5127-5134`, an entry that is not a string at
  `:5138-5142`, and an `ids` value that is not an array at `:5155-5160`. With no
  outstanding children it answers ok with an empty `ApiData::SubagentResults`
  sidecar (`:5163-5173`), which the comment there explains a program depends on.
- `send_message` refuses an absent or blank `agentId` at
  `crates/gg/src/agent.rs:5288-5296` and the same for `message` at `:5297-5305`.

What is covered: the spawn depth cap
(`spawn_is_refused_at_the_max_depth`, `crates/gg/src/agent.test.rs:6173`),
recursion within it (`:6238`), a message reaching a running child (`:6366`), and
messages to an unknown and to a finished target
(`send_message_refuses_unknown_and_finished_targets`, `:6465`). Every
`wait_for_subagents` test omits `ids` and waits for all.

The harness is `invocation` (`crates/gg/src/agent.test.rs:83`) with
`subagent_set(max_parallel, max_depth, extra_agents)` (`:5646`), a
`ScriptedFactory` whose slots hand back `MockClient`s over scripted
`ModelResponse`s, and the telemetry readers the existing tests use to find a
`GgTelemetryKind::ToolResult` by name and agent.

## Design

All of these land in `crates/gg/src/agent.test.rs`, beside the delegation tests
that start at `:6173`. Each is its own `#[tokio::test]`: a root whose script
issues one synthesized `ToolCall` for the case, then a `stop_response()`, run
through `run_with_factory`. Each asserts the `ToolResult` telemetry for that
tool name is not ok, that its summary carries the named diagnostic, and that no
child agent was spawned where that is the point.

### `spawn_subagent`

- `a_spawn_with_no_prompt_is_refused` — `json!({ "agent": "subagent" })`.
- `a_spawn_with_a_blank_prompt_is_refused` — `"prompt": "   "`.
- `a_spawn_with_no_agent_is_refused_with_the_alternatives` —
  `json!({ "prompt": "do the work" })`; the message lists the roster ids.
- `a_spawn_naming_an_agent_outside_the_roster_is_refused_with_the_alternatives` —
  `"agent": "elsewhere"`, on a set whose `extra_agents` do not include it.

### `wait_for_subagents`

- `a_wait_naming_an_agent_this_agent_did_not_spawn_is_not_found` — the root
  spawns one child, then waits on `["agent-99"]`.
- `a_wait_whose_ids_hold_a_non_string_is_refused` — `"ids": [7]`.
- `a_wait_whose_ids_are_not_a_list_is_refused` — `"ids": "agent-1"`.
- `a_wait_with_no_outstanding_subagents_succeeds_with_an_empty_result_list` — a
  root that waits without ever spawning; the `ToolResult` is ok and the call
  carries an empty `SubagentResults` sidecar.
- `a_wait_on_an_explicit_id_collects_that_child` — the root spawns two children
  and waits on one by id; that child's return reaches the root and the other is
  still uncollected.

### `send_message`

- `a_message_with_no_agent_id_is_refused` — `json!({ "message": "keep going" })`.
- `a_message_with_a_blank_agent_id_is_refused` — `"agentId": "   "`.
- `a_message_with_no_message_is_refused` — `json!({ "agentId": "agent-1" })`.
- `a_message_with_a_blank_message_is_refused` — `"message": "  "`.

## Done when

- [ ] Every argument diagnostic in the three handlers is driven by a synthesized
      `ToolCall` through the real agent loop.
- [ ] `wait_for_subagents` has tests for an explicit `ids` list, an id it did not
      spawn, an ill-typed entry, an ill-typed list and an empty wait.
- [ ] The empty wait is asserted to succeed and to carry an empty
      `SubagentResults` sidecar.
- [ ] No test in the file calls a real model or provider.
- [ ] Gates green.
