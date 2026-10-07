# Refuse wait_for_issue's malformed and unreachable calls

Script the `wait_for_issue` calls that are answered before the agent ever
suspends, and assert each refusal reaches the model with its own class.

## Current state

`wait_for_issue` is declared in `crates/gg/src/tools/board.rs:879` and handled by
the agent loop, so its behaviour lives in `crates/gg/src/agent.rs` and its tests
belong in the agent test files rather than under `crates/gg/src/tools/`.
`handle_wait_for_issue` (`crates/gg/src/agent.rs:2892`) reads `issueId` and
refuses an absent, ill-typed or blank one at `:2899-2907`, then hands off to
`wait_for_issue_by_id` (`:2921`). That function refuses a wait on the agent's own
assigned issue at `:2930-2935` and an issue the board does not hold at
`:2936-2941`, and short-circuits on one already terminal at `:2942-2944`.

What is covered lives in `crates/gg/src/agent.waits.test.rs`: a wait that
completes (`crates/gg/src/agent.test.rs:7133`), a wait released by a fault
(`agent.waits.test.rs:247`), a wait behind a failing blocker (`:356`), and a wait
on an already-unreachable issue (`:420`), which also covers the
already-terminal short-circuit at `:449-453`.

The malformed call and the two guards ahead of the board lookup have nothing
driving them, so a model that fumbles the argument has no asserted answer.

The harness is `bounded` (`crates/gg/src/agent.waits.test.rs:48`),
`one_slot_board` (`:116`), `file_issue` (`:143`), `wait_on` (`:159`) — which
builds the synthesized `WAIT_FOR_ISSUE_TOOL` call — and `wait_results` (`:89`),
which reads each `wait_for_issue` `ToolResult` as an `(ok, summary)` pair.

## Design

All of these land in `crates/gg/src/agent.waits.test.rs`, in a section beside the
refusal tests. Each is its own `#[tokio::test]` running a scripted session
through `bounded`, with a root whose script issues one synthesized `ToolCall`
named `WAIT_FOR_ISSUE_TOOL` and then stops. Each asserts through `wait_results`
that the call was refused, that its summary names the reason, and that the
session still ends of its own accord.

Add a `wait_with(call_id, arguments)` helper beside `wait_on` at `:159`, building
the same response over an arbitrary argument object, so a malformed call is as
easy to script as a well-formed one.

- `a_wait_with_no_issue_id_is_refused_on_the_call` — `json!({})`;
  `ToolFailure::InvalidArgument`.
- `a_wait_whose_issue_id_is_not_a_string_is_refused_on_the_call` —
  `"issueId": 7`.
- `a_wait_with_a_blank_issue_id_is_refused_on_the_call` — `"issueId": "   "`.
- `a_wait_on_an_issue_the_board_does_not_hold_is_not_found` —
  `"issueId": "ISSUE-99"` on a board holding one other issue;
  `ToolFailure::NotFound`, and the message names the id.
- `a_wait_on_the_agents_own_assigned_issue_is_refused` — an agent dispatched to
  implement an issue waits on that issue's id; `ToolFailure::InvalidArgument`,
  and the message says it is the agent's own issue.

## Done when

- [ ] Every refusal ahead of the suspension is driven by a synthesized
      `ToolCall` through the real agent loop.
- [ ] Each asserts the failure class and that the session ends on its own.
- [ ] No test in the file calls a real model or provider.
- [ ] Gates green.
