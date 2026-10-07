# Drive handle_transition and handle_fork with synthesized tool calls

Give `transition_state` and `fork` the same call-level coverage `exec` already
has: a synthesized `ToolCall` per refusal, judged by the handler that answers it.

## Current state

The three succession tools are declared in `crates/gg/src/tools/transitions.rs`
and handled by the agent loop, so their behaviour lives in
`crates/gg/src/agent.transitions.rs` and their tests belong in the agent test
files rather than under `crates/gg/src/tools/`. The handlers are
`handle_transition` (`crates/gg/src/agent.transitions.rs:282`), `handle_exec`
(`:343`) and `handle_fork` (`:396`).

`handle_exec` is driven directly from
`crates/gg/src/agent.transitions.test.rs`, each test building a call with
`call(name, arguments)` at `:81`: the out-of-roster target (`:99`), the missing
target (`:122`), a second succession in one turn (`:141`), an ending declared
earlier in the turn (`:179`), and an agent standing in a machine (`:209`).

`handle_transition` is reached by no test. `succession_gates`
(`crates/gg/src/agent.transitions.rs:249`) refuses a transition in a turn that
already declared an ending (`:254-259`) or a succession (`:260-268`), and
`handle_transition` refuses an absent or blank `state` at `:288-300`, listing the
legal targets. What is covered lives a level up, through whole scripted machine
runs: `an_undeclared_target_is_refused_and_the_machine_carries_on`
(`crates/gg/src/agent.fsm.test.rs:448`) and the successful walks at `:202`,
`:291` and `:414`.

`handle_fork` refuses an absent or blank `prompt` at
`crates/gg/src/agent.transitions.rs:403-410`, ahead of the depth cap at
`:414-422`. The depth cap is driven at
`crates/gg/src/agent.transitions.test.rs:1001-1010`, inside
`a_fork_opens_holding_the_state_its_forker_built` (`:873`); the `prompt`
diagnostic is not. `handle_fork` takes a `&mut SubagentContext`, so its cases are
driven through a scripted session the way the depth cap is, rather than by a
direct call.

An `FsmPosition` for a direct `handle_transition` call is built the way
`fsm_position` does it in `crates/gg/src/tools/mod.test.rs:823`: a
`GgAgentConfig` declaring a two-state machine, `FsmSpec::resolve`, then
`entry_position()`.

## Design

### `handle_transition`, in `crates/gg/src/agent.transitions.test.rs`

Add a `position()` helper beside `call` at `:81`, returning the entry position of
a two-state machine whose entry state declares one target. Each case is its own
`#[test]` calling `handle_transition(&position, &declared_ending, &mut declared,
&call(TRANSITION_STATE_TOOL, arguments))` and asserting the outcome's class, that
the message names what it should, and what `declared` holds afterwards.

- `a_transition_is_captured_as_a_handoff_to_the_named_state` — the declared
  target; the outcome is ok and `declared` holds a `Handoff` naming the
  successor's profile and state.
- `a_transition_with_no_state_is_refused_with_the_legal_targets` — `json!({})`;
  `ToolFailure::InvalidArgument`, the message lists the targets, and `declared`
  is still `None`.
- `a_transition_with_a_blank_state_is_refused_with_the_legal_targets` —
  `"state": "  "`.
- `a_transition_naming_an_undeclared_target_is_refused_and_captures_nothing` —
  a state the entry state does not declare; `InvalidArgument`.
- `a_second_succession_in_one_turn_refuses_a_later_transition` — a `declared`
  already holding a handoff; `ToolFailure::Refused`, and the first handoff
  stands.
- `an_ending_declared_this_turn_beats_a_later_transition` — a `declared_ending`
  of `Some`; `Refused`, and `declared` is still `None`.

### `handle_fork`, in `crates/gg/src/agent.transitions.test.rs`

Two `#[tokio::test]`s running a scripted session on a set that grants
`CAPABILITY_FORK`, each with a root whose script issues one synthesized `fork`
call and then stops, read through the same `FORK_TOOL` `ToolResult` filter used
at `:1001-1010`.

- `a_fork_with_no_prompt_is_refused` — `json!({})`; the result is not ok, its
  summary names `prompt`, and no copy agent is spawned.
- `a_fork_with_a_blank_prompt_is_refused` — `"prompt": "   "`, with the same
  assertions.

## Done when

- [ ] `handle_transition` is called directly by a test for the captured handoff
      and for each of its four refusals.
- [ ] Both succession gates are asserted on the `transition_state` path.
- [ ] `fork`'s `prompt` diagnostic is driven by a synthesized `ToolCall` through
      a scripted session, and asserts no copy was spawned.
- [ ] No test in the file calls a real model or provider.
- [ ] Gates green.
