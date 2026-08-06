# frozen_string_literal: true

module GG
  # The `agents` family: handing scoped work to child agents.
  #
  # `wait_for_subagents` can dominate a turn's wall clock — it blocks while real agents run — and
  # the run's budget keeps ticking while it does. A program should therefore spawn broadly and wait
  # once, not spawn-and-wait in a loop.
  #
  # The brief is the one place this SDK enforces an "exactly one of" the native tool-calling schema
  # can only check at dispatch: a child is briefed either with a self-contained `prompt` or with a
  # board `issue_id`, both of them keyword arguments, and the wrapper refuses "neither" and "both"
  # by name rather than letting the membrane's variant decide which one it saw first.
  #
  # @api private
  module Delegation
    # The membrane's handle record, as the model-facing one.
    #
    # @param handle [Object] the wire record
    # @return [SubagentHandle] the handle a program reads
    def self.handle(handle)
      SubagentHandle.new(
        id: Wire.field(handle, "id"),
        slot: Wire.field(handle, "slot"),
        model_id: Wire.field(handle, "modelId")
      )
    end

    # Lower a brief onto the membrane's variant.
    #
    # The check is explicit rather than delegated to the bindings because "neither" is the mistake
    # that actually happens — the native JSON schema declares both fields optional and enforces the
    # choice only at dispatch — and the message a model gets back has to name both options.
    #
    # @param fn [String] the gg call the failure is reported against
    # @param prompt [String, nil] self-contained instructions
    # @param issue_id [String, nil] a board issue's id
    # @return [Object] the membrane's `subagent-brief` variant
    # @raise [ToolError] `invalid-argument` when neither or both were given
    def self.brief(fn, prompt, issue_id)
      if prompt.nil? == issue_id.nil?
        raise ToolError.new(fn, ToolErrorCode::INVALID_ARGUMENT,
                            "expected exactly one of `prompt` or `issue_id`")
      end

      prompt.nil? ? Wire.variant("issue", issue_id) : Wire.variant("prompt", prompt)
    end

    # Delegate scoped work to a child agent and return its handle immediately — the child runs in
    # parallel while your program continues.
    #
    # Brief it with exactly one of `prompt` (self-contained instructions) or `issue_id` (a board
    # issue). The child shares your workspace.
    #
    # @param agent [String] The agent profile to run the child as, from the ones you may spawn —
    #   the system prompt lists them. It selects the child's model, tools and instructions.
    # @param prompt [String, nil] Self-contained instructions for the child. Give this or
    #   `issue_id`, never both and never neither.
    # @param issue_id [String, nil] The board issue to brief the child from. Give this or `prompt`,
    #   never both and never neither.
    # @return [SubagentHandle] the child that is now running
    # @raise [ToolError] `:limit_exceeded` at the delegation depth cap, and `:invalid_argument` if
    #   `agent` is not one you may spawn.
    def self.spawn_subagent(agent, prompt: nil, issue_id: nil)
      handle(Wire.call("spawn_subagent", "delegation", "spawnSubagent", [
                         Wire.record("agent" => agent,
                                     "task" => brief("spawn_subagent", prompt, issue_id))
                       ]))
    end

    # Block until the named children have finished — or, with no arguments, until every outstanding
    # child has — and collect their results in dispatch order.
    #
    # The run's wall-clock budget keeps running while you wait, so wait once for many children
    # rather than once per child.
    #
    # @param ids [Array<String>] The children to wait for, splatted. Pass none to wait for every
    #   one still outstanding.
    # @return [Array<SubagentResult>] what each child finished with, in dispatch order
    # @raise [ToolError] `:not_found` for an unknown id.
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

    # Deliver a message to a running child agent's inbox; it reads the message at its next turn.
    #
    # @param agent_id [String] The child to deliver to, as `spawn_subagent` returned it.
    # @param message [String] What to put in its inbox. It reads it at its next turn.
    # @return [nil] nothing; the message either landed or raised
    # @raise [ToolError] `:not_found` for an unknown agent id, and `:conflict` when that child has
    #   already returned.
    def self.send_message(agent_id, message)
      Wire.call("send_message", "delegation", "sendMessage", [agent_id, message])
      nil
    end

    # Move the process you are running inside on to another of its states, naming the state the way
    # you name an agent to spawn.
    #
    # Bound only when a state machine is driving you and the state you are in has somewhere to go.
    # Like `context.compact` it is registered rather than performed: the call validates the target,
    # returns, and your program runs on to its end — the transition happens after that, because
    # replacing your agent (and your window) mid-program would pull every remaining call out from
    # under it. The FIRST declaration stands.
    #
    # @param state [String] The state to move on to, named the way you name an agent to spawn.
    # @param note [String, nil] The opening message the next state's agent sees.
    # @return [nil] nothing; the declaration is recorded and your program runs on
    # @raise [ToolError] `:refused` for a second declaration in one turn, and `:invalid_argument`
    #   for a state you may not move to.
    def self.transition_state(state, note = nil)
      Wire.call("transition_state", "delegation", "transitionState", [state, Wire.js(note)])
      nil
    end

    # Continue this session as a different agent: the named agent takes over from your next turn
    # with its own model, tools and instructions, keeping every capability the two of you both have
    # — your whole conversation above all, so it needs no catching up.
    #
    # Registered rather than performed, exactly as `transition_state` is and for the same reason:
    # your window would otherwise be pulled out from under the program still composing into it. A
    # session makes one succession per turn. Bound only when your agent may make agent transitions
    # and has agents it may become, and never while a state machine is driving you.
    #
    # @param agent [String] The agent to become, from the ones you may become.
    # @param prompt [String, nil] Its opening message. It already has your whole conversation, so
    #   this is the instruction rather than a briefing.
    # @return [nil] nothing; the succession is recorded and your program runs on
    # @raise [ToolError] `:refused` for an `exec` after a `transition_state` or a second `exec`,
    #   and `:invalid_argument` for an agent you may not become.
    def self.exec(agent, prompt = nil)
      Wire.call("exec", "delegation", "exec", [agent, Wire.js(prompt)])
      nil
    end

    # Run a copy of yourself, in parallel, on something you will not do yourself.
    #
    # The copy has your model, your tools and a private copy of your whole conversation, so
    # `prompt` is the *difference* rather than a briefing — everything you have worked out is
    # already there.
    #
    # Its handle comes back immediately, but the copy itself starts once this turn's tool results
    # are recorded (the conversation it inherits has to be a complete one), so
    # `wait_for_subagents` can only collect it on a later turn — do not wait on it in the program
    # that made it.
    #
    # @param prompt [String] What the copy is to do instead of what you are doing. It has your
    #   whole conversation already, so write the difference rather than a briefing.
    # @return [SubagentHandle] the copy that will start once this turn is recorded
    # @raise [ToolError] `:limit_exceeded` at the delegation depth cap.
    def self.fork(prompt)
      handle(Wire.call("fork", "delegation", "fork", [prompt]))
    end
  end
end
