/// Delegate work to child agents, and hand this session's own turn to another agent.
///
/// `waitForSubagents` can dominate a turn's wall clock — it blocks while real agents run — and the
/// run's budget keeps ticking while it does. A program should therefore spawn broadly and wait once,
/// rather than spawn-and-wait in a loop.
///
/// The brief is where this arm's types earn their keep: a child is briefed either with a
/// self-contained `Brief.prompt` or with a board `Brief.issue`, and because that choice is one
/// `enum` rather than two optional arguments, "both" and "neither" are programs that do not compile.
///
/// - ggmodule: delegation
public enum delegation {
    /// The gg tools this module dispatches — see `files.ggTools`.
    static let ggTools = [
        "spawn_subagent", "wait_for_subagents", "send_message", "transition_state", "exec", "fork",
    ]

    /// Delegate scoped work to a child agent and hand back its handle immediately.
    ///
    /// The child runs in parallel while the program continues. `agent` names one of the agent
    /// profiles this agent may spawn — the system prompt lists them, and the profile selects the
    /// child's model, tools and instructions. The brief is either
    /// `.prompt("self-contained instructions")` or `.issue("AUTH-1")`. The child shares the
    /// workspace.
    ///
    /// - Parameters:
    ///   - agent: The agent profile to run the child as, from the ones this agent may spawn. It
    ///     selects the child's model, tools and instructions.
    ///   - task: What the child is to do: `.prompt` with self-contained instructions, or `.issue`
    ///     with the id of a board issue to brief it from.
    /// - Returns: the child's handle, to wait on or to message.
    /// - Throws: `core.ToolError` with `.limitExceeded` at the delegation depth cap, and
    ///   `.invalidArgument` when `agent` is not one this agent may spawn.
    /// - ggop: delegation.spawn_subagent
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

    /// Block until the named children have finished and collect their results in dispatch order.
    ///
    /// With the ids left out it waits for every outstanding child. The run's wall-clock budget keeps
    /// running throughout, so one wait for many children costs far less than one wait per child.
    ///
    /// - Parameter ids: The children to wait for, as `delegation.spawnSubagent` returned them. Left
    ///   out, it waits for every one still outstanding.
    /// - Returns: each child's status and final message.
    /// - Throws: `core.ToolError` with `.notFound` for an id this agent did not spawn.
    /// - ggop: delegation.wait_for_subagents
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

    /// Deliver a message to a running child agent's inbox, which it reads at its next turn.
    ///
    /// `SubagentHandle.send` is the same call with the id already supplied, for the common case
    /// where the handle is in hand.
    ///
    /// - Parameters:
    ///   - message: What to put in its inbox. It reads it at its next turn.
    ///   - to: The child to deliver to, as `delegation.spawnSubagent` returned it.
    /// - Throws: `core.ToolError` with `.notFound` for an unknown agent id, and `.conflict` when
    ///   that child has already returned.
    /// - ggop: delegation.send_message
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

    /// Move the process this session is running inside on to another of its states.
    ///
    /// The state is named the way an agent to spawn is named. It is bound only when a state machine
    /// is driving the session and the current state has somewhere to go. Like `context.compact` it
    /// is registered rather than performed: the call validates the target, returns, and the program
    /// runs on to its end, because replacing the agent — and its window — mid-program would pull
    /// every remaining call out from under it. The first declaration in a turn is the one that
    /// stands.
    ///
    /// - Parameters:
    ///   - to: The state to move on to, named the way an agent to spawn is named.
    ///   - note: The opening message the next state's agent sees. Left out, it is told nothing.
    /// - Throws: `core.ToolError` with `.invalidArgument` for a state this session may not move to,
    ///   and `.refused` for a second declaration in one turn.
    /// - ggop: delegation.transition_state
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

    /// Continue this session as a different agent, from the next turn.
    ///
    /// The named agent takes over with its own model, tools and instructions, keeping every
    /// capability the two of them share — the whole conversation above all, so it needs no catching
    /// up. Registered rather than performed, exactly as `delegation.transitionState` is and for the
    /// same reason: the window would otherwise be pulled out from under the program still composing
    /// into it. A session makes one succession per turn. It is bound only when this agent may make
    /// agent transitions and has agents it may become, and never while a state machine is driving
    /// the session.
    ///
    /// - Parameters:
    ///   - agent: The agent to become, from the ones this agent may become.
    ///   - prompt: Its opening message. It already has the whole conversation, so this is the
    ///     instruction rather than a briefing. Left out, it is told nothing.
    /// - Throws: `core.ToolError` with `.invalidArgument` for an agent this session may not become,
    ///   and `.refused` for a second succession in one turn.
    /// - ggop: delegation.exec
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

    /// Run a copy of this agent, in parallel, on something it will not do itself.
    ///
    /// The copy has the same model, the same tools and a private copy of the whole conversation, so
    /// `prompt` is the *difference* rather than a briefing — everything already worked out is
    /// already there.
    ///
    /// Its handle comes back immediately, but the copy itself starts once this turn's tool results
    /// are recorded, because the conversation it inherits has to be a complete one. So
    /// `delegation.waitForSubagents` can only collect it on a later turn, and waiting on it in the
    /// program that made it never returns it.
    ///
    /// - Parameter prompt: What the copy is to do instead. It has the whole conversation already, so
    ///   this is the difference rather than a briefing.
    /// - Returns: the copy's handle, collectable on a later turn.
    /// - Throws: `core.ToolError` with `.limitExceeded` at the delegation depth cap.
    /// - ggop: delegation.fork
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

    /// What a child agent is briefed with.
    ///
    /// The choice is an `enum` rather than a pair of optional arguments, so "both" and "neither" are
    /// programs that do not compile instead of calls that fail at run time.
    public enum Brief: Sendable {
        /// Self-contained instructions for a child that needs no other context.
        case prompt(String)
        /// The id of a board issue to brief the child from, as `board.createIssue` returned it.
        case issue(String)
    }

    /// A child agent that was spawned and is now running in parallel.
    public struct SubagentHandle: Sendable {
        /// The child's id — what `delegation.waitForSubagents` and `delegation.sendMessage` take.
        public let id: String
        /// The agent profile it runs as.
        public let slot: String
        /// The model actually bound to that agent.
        public let modelId: String

        init(wire: test_cabinet_gg_delegation_subagent_handle_t) {
            id = lift(wire.id)
            slot = lift(wire.slot)
            modelId = lift(wire.model_id)
        }
    }

    /// How a child agent's loop ended — gg's own six words, as the tool-calling path also reports
    /// them.
    public enum AgentStatus: Sendable {
        /// It finished normally, calling `session.finish`, and its summary is what it returned.
        case completed
        /// It reached the per-run turn ceiling.
        case exhausted
        /// It passed its wall-clock deadline.
        case timedOut
        /// A model turn failed.
        case modelError
        /// The run's credential was refused.
        case authError
        /// An execution ceiling stopped it — consecutive errors, error rate, or cost.
        case limitExceeded

        init(wire: test_cabinet_gg_delegation_agent_status_t) {
            switch Int32(wire) {
            case TEST_CABINET_GG_DELEGATION_AGENT_STATUS_COMPLETED: self = .completed
            case TEST_CABINET_GG_DELEGATION_AGENT_STATUS_EXHAUSTED: self = .exhausted
            case TEST_CABINET_GG_DELEGATION_AGENT_STATUS_TIMED_OUT: self = .timedOut
            case TEST_CABINET_GG_DELEGATION_AGENT_STATUS_MODEL_ERROR: self = .modelError
            case TEST_CABINET_GG_DELEGATION_AGENT_STATUS_AUTH_ERROR: self = .authError
            default: self = .limitExceeded
            }
        }
    }

    /// One child agent's collected result.
    public struct SubagentResult: Sendable {
        /// The child's id.
        public let id: String
        /// How it finished; `nil` when it produced no return value at all.
        public let status: AgentStatus?
        /// Its final message.
        public let summary: String

        init(wire: test_cabinet_gg_delegation_subagent_result_t) {
            id = lift(wire.id)
            status = wire.status.is_some ? AgentStatus(wire: wire.status.val) : nil
            summary = lift(wire.summary)
        }
    }
}

extension delegation.SubagentHandle {
    /// Deliver a message to this child's inbox, which it reads at its next turn.
    ///
    /// `delegation.sendMessage` with the id already supplied, for the common case where the handle
    /// is in hand.
    ///
    /// - Parameter message: What to put in its inbox.
    /// - Throws: `core.ToolError` with `.conflict` when this child has already returned.
    /// - ggop-alias: delegation.send_message
    public func send(_ message: String) throws {
        try delegation.sendMessage(message, to: id)
    }
}
