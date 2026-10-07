# frozen_string_literal: true

module GG
  # The types every other module's signatures name: how a call fails, and what a patch leaves alone.
  #
  # Every function in this SDK raises `GG::Core::ApiError` when it fails. This module declares no
  # function of its own.
  module Core
    # A gg call that failed.
    #
    # Every function in this SDK raises one of these rather than returning a status. A program that
    # rescues nothing ends on the raise, and gg is told which call failed and on which line. It is a
    # `StandardError`, so a bare `rescue => failure` catches it too, and `code` is the value a
    # rescue branches on.
    class ApiError < StandardError
      # The call that failed, by the key of the operation the program reached for (`read_file`,
      # `spawn_subagent`).
      #
      # It is gg's key rather than this SDK's method name.
      #
      # @return [String]
      attr_reader :operation

      # @return [Symbol] The failure class, one of `GG::Core::ApiErrorCode`'s symbols.
      attr_reader :code

      # @param operation [String] gg's own key for the call that failed
      # @param code [Symbol] the failure class
      # @param message [String] the model-facing guidance
      # @api private
      def initialize(operation, code, message)
        super(message)
        @operation = operation
        @code = code
      end

      # @return [String] the failure, with the call and the class in front of the message
      # @api private
      def inspect
        "#<ApiError #{@operation} (#{@code}): #{message}>"
      end
    end

    # Why a gg call failed — the `code` on a raised `GG::Core::ApiError`.
    #
    # Every arm is a Symbol: `GG::Core::ApiErrorCode::NOT_FOUND` and `:not_found` are the same
    # value.
    module ApiErrorCode
      # The arguments were malformed, ill-typed, or out of range.
      #
      # It covers a path that is absolute or climbs out of the workspace, and an agent name this run
      # does not declare.
      INVALID_ARGUMENT = :invalid_argument

      # The named thing does not exist.
      #
      # A file, a skill, a memory, a task, an epic, an issue, a subagent, a stored program, or a
      # documentation entry.
      NOT_FOUND = :not_found

      # Well-formed, but in conflict with the current state.
      #
      # An ambiguous edit, a dependency cycle, a duplicate id, a subagent that has already returned.
      CONFLICT = :conflict

      # gg refused the call on a rule about the session's state.
      #
      # A compaction in flight that this call is not the one it asked for, a memory call while
      # memories are read-only, a second ending or hand-over in a turn that already declared one, or
      # a hook that blocked it. A ceiling that was reached is `LIMIT_EXCEEDED` rather than this.
      REFUSED = :refused

      # The call exists and this run's capability set does not offer it.
      #
      # A module carries only the functions its run offers, so reaching for one it does not raises
      # `NoMethodError` instead.
      UNAVAILABLE = :unavailable

      # A gg-side ceiling was reached.
      #
      # A shell timeout, a store cap, the delegation depth cap, one of the view caps a program
      # spends, or the run's wall-clock budget.
      LIMIT_EXCEEDED = :limit_exceeded

      # The underlying input, output or process failed.
      IO_ERROR = :io_error

      # The failure was not classified.
      OTHER = :other
    end

    # The "leave this field exactly as it is" value a three-way patch argument defaults to.
    #
    # On an argument that may also be cleared, `nil` clears the field, and `GG::Core::UNCHANGED`
    # — or leaving the argument out — keeps it. On an argument with no clear state, `nil` means
    # it is not being changed.
    module Unchanged
      # Leave the field exactly as it is.
      UNCHANGED = :unchanged
    end

    # The value that keeps a three-way patch field exactly as it is.
    UNCHANGED = Unchanged::UNCHANGED
  end
end
