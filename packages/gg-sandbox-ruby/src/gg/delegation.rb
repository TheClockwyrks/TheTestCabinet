# frozen_string_literal: true

module GG
  # Delegate work to child agents, and hand this session's own turn to another agent.
  #
  # `wait_for_subagents` can dominate a turn's wall clock — it blocks while real agents run — and
  # the run's budget keeps ticking while it does. A program should therefore spawn broadly and wait
  # once, rather than spawn-and-wait in a loop.
  #
  # The brief is the one place this SDK enforces an "exactly one of" that the native tool-calling
  # schema can only check at dispatch: a child is briefed either with a self-contained `prompt` or
  # with a board `issue_id`, both of them keyword arguments, and the wrapper refuses "neither" and
  # "both" by name rather than letting the membrane's variant decide which one it saw first.
  module Delegation
    extend Surface::Operations

    # The membrane's handle record, as the model-facing one.
    #
    # @param handle [Object] the wire record
    # @return [GG::Delegation::SubagentHandle] the handle a program reads
    # @api private
    def self.handle(handle)
      SubagentHandle.new(
        id: Wire.field(handle, "id"),
        slot: Wire.field(handle, "slot"),
        model_id: Wire.field(handle, "modelId")
      )
    end
    private_class_method :handle

    # Lower a brief onto the membrane's variant.
    #
    # The check is explicit rather than delegated to the bindings because "neither" is the mistake
    # that actually happens — the native JSON schema declares both fields optional and enforces the
    # choice only at dispatch — and the message that comes back has to name both options.
    #
    # @param fn [String] the gg call the failure is reported against
    # @param prompt [String, nil] self-contained instructions
    # @param issue_id [String, nil] a board issue's id
    # @return [Object] the membrane's `subagent-brief` variant
    # @raise [GG::Core::ApiError] `invalid-argument` when neither or both were given
    # @api private
    def self.brief(fn, prompt, issue_id)
      if prompt.nil? == issue_id.nil?
        raise Core::ApiError.new(fn, Core::ApiErrorCode::INVALID_ARGUMENT,
                                 "expected exactly one of `prompt` or `issue_id`")
      end

      prompt.nil? ? Wire.variant("issue", issue_id) : Wire.variant("prompt", prompt)
    end
    private_class_method :brief

    # Delegate scoped work to a child agent and hand back its handle immediately.
    #
    # The child runs in parallel while the program continues, and shares the workspace. `agent`
    # names one of the agent profiles this agent may spawn — the system prompt lists them, and the
    # profile selects the child's model, tools and instructions. The brief is exactly one of
    # `prompt` and `issue_id`.
    #
    # @param agent [String] The agent profile to run the child as, from the ones this agent may
    #   spawn. It selects the child's model, tools and instructions.
    # @param prompt [String, nil] Self-contained instructions for the child. Give this or
    #   `issue_id`, never both and never neither.
    # @param issue_id [String, nil] The board issue to brief the child from. Give this or `prompt`,
    #   never both and never neither.
    # @return [GG::Delegation::SubagentHandle] the child that is now running
    # @raise [GG::Core::ApiError] `:limit_exceeded` at the delegation depth cap, and
    #   `:invalid_argument` when `agent` is not one this agent may spawn.
    def self.spawn_subagent(agent, prompt: nil, issue_id: nil)
      handle(Wire.call("spawn_subagent", "delegation", "spawnSubagent", [
                         Wire.record("agent" => agent,
                                     "task" => brief("spawn_subagent", prompt, issue_id))
                       ]))
    end
    operation :spawn_subagent, "delegation.spawn_subagent", tool: "spawn_subagent"

    # Block until the named children have finished and collect their results in dispatch order.
    #
    # With no arguments it waits for every outstanding child. The run's wall-clock budget keeps
    # running throughout, so one wait for many children costs far less than one wait per child.
    #
    # @param ids [Array<String>] The children to wait for, splatted. Pass none to wait for every one
    #   still outstanding.
    # @return [Array<GG::Delegation::SubagentResult>] what each child finished with, in dispatch
    #   order
    # @raise [GG::Core::ApiError] `:not_found` for an id this agent did not spawn.
    def self.wait_for_subagents(*ids)
      wanted = Check.strings("wait_for_subagents", "ids", ids)
      results = Wire.call("wait_for_subagents", "delegation", "waitForSubagents",
                          [wanted.empty? ? `undefined` : wanted])
      results.map do |result|
        SubagentResult.new(
          id: Wire.field(result, "id"),
          status: Wire.symbol(Wire.field(result, "status")),
          summary: Wire.field(result, "summary")
        )
      end
    end
    operation :wait_for_subagents, "delegation.wait_for_subagents", tool: "wait_for_subagents"

    # Deliver a message to a running child agent's inbox, which it reads at its next turn.
    #
    # `GG::Delegation::SubagentHandle#send_message` is the same call with the id already supplied,
    # for the common case where the handle is in hand.
    #
    # @param agent_id [String] The child to deliver to, as `GG::Delegation.spawn_subagent` returned
    #   it.
    # @param message [String] What to put in its inbox. It reads it at its next turn.
    # @return [nil]
    # @raise [GG::Core::ApiError] `:not_found` for an unknown agent id, and `:conflict` when that
    #   child has already returned.
    def self.send_message(agent_id, message)
      Wire.call("send_message", "delegation", "sendMessage", [agent_id, message])
      nil
    end
    operation :send_message, "delegation.send_message", tool: "send_message"

    # Move the process this session is running inside on to another of its states.
    #
    # The state is named the way an agent to spawn is named. It is bound only when a state machine
    # is driving the session and the current state has somewhere to go. It is registered rather
    # than performed: the call validates the target, returns, and the program runs on to its end,
    # because replacing the agent — and its window — mid-program would pull every remaining call out
    # from under it. The first declaration in a turn is the one that stands.
    #
    # @param state [String] The state to move on to, named the way an agent to spawn is named.
    # @param note [String, nil] The opening message the next state's agent sees. Leave it out to
    #   tell it nothing.
    # @return [nil]
    # @raise [GG::Core::ApiError] `:invalid_argument` for a state this session may not move to, and
    #   `:refused` for a second declaration in one turn.
    def self.transition_state(state, note = nil)
      Wire.call("transition_state", "delegation", "transitionState", [state, Wire.js(note)])
      nil
    end
    operation :transition_state, "delegation.transition_state", tool: "transition_state"

    # Continue this session as a different agent, from the next turn.
    #
    # The named agent takes over with its own model, tools and instructions, keeping every
    # capability the two of them share — the whole conversation above all, so it needs no catching
    # up. Registered rather than performed: the call validates the target, returns, and the program
    # runs on to its end, because the window would otherwise be pulled out from under the program
    # still composing into it. A session makes one succession per turn.
    #
    # @param agent [String] The agent to become, from the ones this agent may become.
    # @param prompt [String, nil] Its opening message. It already has the whole conversation, so
    #   this is the instruction rather than a briefing.
    # @return [nil]
    # @raise [GG::Core::ApiError] `:refused` for a second succession in one turn or one after a
    #   state transition, and `:invalid_argument` for an agent this session may not become.
    def self.exec(agent, prompt = nil)
      Wire.call("exec", "delegation", "exec", [agent, Wire.js(prompt)])
      nil
    end
    operation :exec, "delegation.exec", tool: "exec"

    # Run a copy of this agent, in parallel, on something it will not do itself.
    #
    # The copy has the same model, the same tools and a private copy of the whole conversation, so
    # `prompt` is the *difference* rather than a briefing — everything already worked out is already
    # there.
    #
    # Its handle comes back immediately, but the copy itself starts once this turn's tool results
    # are recorded, because the conversation it inherits has to be a complete one. So a later turn
    # is the earliest a wait can collect it, and waiting on it in the program that made it never
    # returns it.
    #
    # @param prompt [String] What the copy is to do instead. It has the whole conversation already,
    #   so this is the difference rather than a briefing.
    # @return [GG::Delegation::SubagentHandle] the copy that starts once this turn is recorded
    # @raise [GG::Core::ApiError] `:limit_exceeded` at the delegation depth cap, and
    #   `:invalid_argument` for a blank prompt.
    def self.fork(prompt)
      handle(Wire.call("fork", "delegation", "fork", [prompt]))
    end
    operation :fork, "delegation.fork", tool: "fork"

    # A child agent that was spawned and is now running in parallel.
    class SubagentHandle
      include Value
      extend Surface::Operations

      # @return [String] The child's id — what `GG::Delegation.wait_for_subagents` and
      #   `GG::Delegation.send_message` take.
      attr_reader :id

      # @return [String] The agent profile it runs as.
      attr_reader :slot

      # @return [String] The model actually bound to that agent.
      attr_reader :model_id

      # @api private
      def initialize(id:, slot:, model_id:)
        @id = id
        @slot = slot
        @model_id = model_id
        freeze
      end

      # Deliver a message to this child's inbox, which it reads at its next turn.
      #
      # `GG::Delegation.send_message` with the id already supplied, for the common case where the
      # handle is in hand. It is spelled in full rather than as `send`, which every Ruby object
      # already answers to as the dynamic-dispatch method.
      #
      # @param message [String] What to put in its inbox.
      # @return [nil]
      # @raise [GG::Core::ApiError] `:conflict` when this child has already returned.
      def send_message(message)
        Delegation.send_message(@id, message)
      end
      member_operation :send_message, "delegation.send_message", tool: "send_message"
    end

    # How a child agent's loop ended — gg's own six words, as the tool-calling path also reports
    # them.
    #
    # Every arm is a Symbol, so a comparison may name the constant or write the literal:
    # `GG::Delegation::AgentEnding::COMPLETED` and `:completed` are the same value.
    module AgentEnding
      # It finished normally, ending its own session, and its summary is what it returned.
      COMPLETED = :completed

      # It reached the per-run turn ceiling.
      EXHAUSTED = :exhausted

      # It passed its wall-clock deadline.
      TIMED_OUT = :timed_out

      # A model turn failed.
      MODEL_ERROR = :model_error

      # The run's credential was refused.
      AUTH_ERROR = :auth_error

      # An execution ceiling stopped it — consecutive errors, error rate, or cost.
      LIMIT_EXCEEDED = :limit_exceeded
    end

    # One child agent's collected result.
    class SubagentResult
      include Value

      # @return [String] The child's id.
      attr_reader :id

      # @return [GG::Delegation::AgentEnding, nil] How it finished; `nil` when it produced no return
      #   value at all.
      attr_reader :status

      # @return [String] Its final message.
      attr_reader :summary

      # @api private
      def initialize(id:, status:, summary:)
        @id = id
        @status = status
        @summary = summary
        freeze
      end
    end
  end
end
