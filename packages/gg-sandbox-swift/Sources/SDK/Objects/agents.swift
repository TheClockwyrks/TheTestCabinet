/// delegate work to child agents
///
/// `waitForSubagents` can dominate a turn's wall clock — it blocks while real agents run — and the
/// run's budget keeps ticking while it does. A program should therefore spawn broadly and wait once,
/// not spawn-and-wait in a loop.
///
/// The brief is where this arm's types earn their keep: a child is briefed either with a
/// self-contained `.prompt(…)` or with a board `.issue(…)`, and because that choice is one `enum`
/// rather than two optional arguments, "both" and "neither" are programs that do not compile.
public enum agents: ApiObject {
    public static let ggObject = "agents"

    /// The gg tools this object dispatches — see `fs.ggTools`.
    static let ggTools = [
        "spawn_subagent", "wait_for_subagents", "send_message", "transition_state", "exec", "fork",
    ]

    /// Delegate scoped work to a child agent and hand back its handle immediately — the child runs in
    /// parallel while your program continues.
    ///
    /// Name the agent to run it as (one of the agents you may spawn — the system prompt lists them;
    /// it selects the child's model, tools, and instructions) and brief it with either
    /// `.prompt("self-contained instructions")` or `.issue("AUTH-1")`. The child shares your
    /// workspace.
    ///
    /// - Parameters:
    ///   - agent: The agent profile to run the child as, from the ones you may spawn. It selects the
    ///     child's model, tools and instructions.
    ///   - task: What the child is to do: `.prompt(…)` with self-contained instructions, or
    ///     `.issue(…)` with the id of a board issue to brief it from.
    /// - Returns: the child's handle, to wait on or to message.
    /// - Throws: `ToolError` with `.limitExceeded` at the delegation depth cap, and
    ///   `.invalidArgument` if `agent` is not one you may spawn.
    @discardableResult
    public static func spawnSubagent(_ agent: String, task: Brief) throws -> SubagentHandle {
        try withScratch { scratch in
            var request = test_cabinet_gg_delegation_spawn_request_t(
                agent: scratch.string(agent), task: scratch.brief(task))
            var ret = test_cabinet_gg_delegation_subagent_handle_t()
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_delegation_spawn_subagent(&request, &ret, &err) else {
                throw lift(failure: &err)
            }
            let handle = SubagentHandle(wire: ret)
            test_cabinet_gg_delegation_subagent_handle_free(&ret)
            return handle
        }
    }

    /// Block until the named children have finished — or, with the ids left out, until every
    /// outstanding child has — and collect their results in dispatch order.
    ///
    /// The run's wall-clock budget keeps running while you wait, so wait once for many children
    /// rather than once per child.
    ///
    /// - Parameter ids: The children to wait for, as `agents.spawnSubagent` returned them. Left out,
    ///   it waits for every one still outstanding.
    /// - Returns: each child's status and final message.
    /// - Throws: `ToolError` with `.notFound` for an unknown id.
    public static func waitForSubagents(_ ids: [String]? = nil) throws -> [SubagentResult] {
        try withScratch { scratch in
            var ret = test_cabinet_gg_delegation_list_subagent_result_t()
            var err = test_cabinet_gg_types_tool_error_t()
            let ok = withOptional(ids.map { scratch.list($0) }) { ids in
                test_cabinet_gg_delegation_wait_for_subagents(ids, &ret, &err)
            }
            guard ok else { throw lift(failure: &err) }
            let results = lift(ret.ptr, ret.len) { SubagentResult(wire: $0) }
            test_cabinet_gg_delegation_list_subagent_result_free(&ret)
            return results
        }
    }

    /// Deliver a message to a running child agent's inbox; it reads the message at its next turn.
    ///
    /// - Parameters:
    ///   - message: What to put in its inbox. It reads it at its next turn.
    ///   - to: The child to deliver to, as `agents.spawnSubagent` returned it.
    /// - Throws: `ToolError` with `.notFound` for an unknown agent id, and `.conflict` when that
    ///   child has already returned.
    public static func sendMessage(_ message: String, to agentId: String) throws {
        try withScratch { scratch in
            var agentId = scratch.string(agentId)
            var message = scratch.string(message)
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_delegation_send_message(&agentId, &message, &err) else {
                throw lift(failure: &err)
            }
        }
    }

    /// Move the process you are running inside on to another of its states, naming the state the way
    /// you name an agent to spawn.
    ///
    /// Bound only when a state machine is driving you and the state you are in has somewhere to go.
    /// Like `context.compact` it is registered rather than performed: the call validates the target,
    /// returns, and your program runs on to its end — the transition happens after that, because
    /// replacing your agent (and your window) mid-program would pull every remaining call out from
    /// under it. The FIRST declaration stands.
    ///
    /// - Parameters:
    ///   - to: The state to move on to, named the way you name an agent to spawn.
    ///   - note: The opening message the next state's agent sees. Left out, it is told nothing.
    /// - Throws: `ToolError` with `.invalidArgument` for a state you may not move to, and `.refused`
    ///   for a second declaration in one turn.
    public static func transitionState(to state: String, note: String? = nil) throws {
        try withScratch { scratch in
            var state = scratch.string(state)
            var err = test_cabinet_gg_types_tool_error_t()
            let ok = withOptional(note.map { scratch.string($0) }) { note in
                test_cabinet_gg_delegation_transition_state(&state, note, &err)
            }
            guard ok else { throw lift(failure: &err) }
        }
    }

    /// Continue this session as a different agent: the named agent takes over from your next turn
    /// with its own model, tools and instructions, keeping every capability the two of you both have
    /// — your whole conversation above all, so it needs no catching up.
    ///
    /// Registered rather than performed, exactly as `agents.transitionState` is and for the same
    /// reason: your window would otherwise be pulled out from under the program still composing into
    /// it. A session makes one succession per turn. Bound only when your agent may make agent
    /// transitions and has agents it may become, and never while a state machine is driving you.
    ///
    /// - Parameters:
    ///   - agent: The agent to become, from the ones you may become.
    ///   - prompt: Its opening message. It already has your whole conversation, so this is the
    ///     instruction rather than a briefing. Left out, it is told nothing.
    /// - Throws: `ToolError` with `.invalidArgument` for an agent you may not become, and `.refused`
    ///   for a second succession in one turn.
    public static func exec(_ agent: String, prompt: String? = nil) throws {
        try withScratch { scratch in
            var agent = scratch.string(agent)
            var err = test_cabinet_gg_types_tool_error_t()
            let ok = withOptional(prompt.map { scratch.string($0) }) { prompt in
                test_cabinet_gg_delegation_exec(&agent, prompt, &err)
            }
            guard ok else { throw lift(failure: &err) }
        }
    }

    /// Run a copy of yourself, in parallel, on something you will not do yourself.
    ///
    /// The copy has your model, your tools and a private copy of your whole conversation, so `prompt`
    /// is the *difference* rather than a briefing — everything you have worked out is already there.
    ///
    /// Its handle comes back immediately, but the copy itself starts once this turn's tool results
    /// are recorded (the conversation it inherits has to be a complete one), so
    /// `agents.waitForSubagents` can only collect it on a later turn — do not wait on it in the
    /// program that made it.
    ///
    /// - Parameter prompt: What the copy is to do instead of what you are doing. It has your whole
    ///   conversation already, so write the difference rather than a briefing.
    /// - Returns: the copy's handle, collectable on a later turn.
    /// - Throws: `ToolError` with `.limitExceeded` at the delegation depth cap.
    @discardableResult
    public static func fork(_ prompt: String) throws -> SubagentHandle {
        try withScratch { scratch in
            var prompt = scratch.string(prompt)
            var ret = test_cabinet_gg_delegation_subagent_handle_t()
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_delegation_fork(&prompt, &ret, &err) else {
                throw lift(failure: &err)
            }
            let handle = SubagentHandle(wire: ret)
            test_cabinet_gg_delegation_subagent_handle_free(&ret)
            return handle
        }
    }
}
