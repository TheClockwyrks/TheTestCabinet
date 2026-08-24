# frozen_string_literal: true

module GG
  # The types every other module's signatures name: how a call fails, and what a patch leaves alone.
  #
  # A capability module owns the types it produces, so `GG::Files::TextFile` belongs to `GG::Files`
  # and `GG::Board::IssueCreated` to `GG::Board`. The declarations here belong to none of them
  # because they belong to all of them: every function in this SDK raises `GG::Core::ApiError` when
  # it fails.
  #
  # This module declares no function of its own, which is why it comes last in the surface: there is
  # nothing here to call, only shapes to read.
  module Core
    # A gg call that failed.
    #
    # Every function in this SDK raises one of these rather than returning a status, which is what a
    # Ruby author expects of a library and what makes a failure compose: a program that rescues
    # nothing ends on the raise, and gg is told which call failed and on which line. It is a
    # `StandardError`, so a bare `rescue => failure` catches it too.
    #
    # A failure a program expects is an ordinary `rescue` branching on `code`:
    #
    # ```ruby
    # begin
    #   GG::Views.open_text("build log", log)
    # rescue GG::Core::ApiError => failure
    #   raise unless failure.code == GG::Core::ApiErrorCode::LIMIT_EXCEEDED
    #
    #   GG::Views.open_text("build log (tail)", log[-40_000..])
    # end
    # ```
    class ApiError < StandardError
      # The call that failed, by the key of the operation the program reached for (`read_file`,
      # `spawn_subagent`).
      #
      # It is gg's key rather than this SDK's method name, so it is the same string on every
      # language a program may be written in.
      #
      # @return [String]
      attr_reader :operation

      # @return [Symbol] The failure class, so a rescue branches on a value rather than on prose.
      #   One of `GG::Core::ApiErrorCode`'s symbols.
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
    # Every arm is a Symbol, so a rescue may match the constant or the literal a program writes:
    # `GG::Core::ApiErrorCode::NOT_FOUND` and `:not_found` are the same value.
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
      # It is gg's own last word on a withheld call, reported whichever guest reached the membrane.
      # A Ruby program rarely sees it, because a module carries only the functions its run offers
      # and reaching for one it does not raises `NoMethodError` on the line that wrote it.
      UNAVAILABLE = :unavailable

      # A gg-side ceiling was reached.
      #
      # A shell timeout, a store cap, the delegation depth cap, one of the view caps a program
      # spends, or the run's wall-clock budget.
      LIMIT_EXCEEDED = :limit_exceeded

      # The underlying input, output or process failed.
      IO_ERROR = :io_error

      # The failure was not classified.
      #
      # Reserved for outcomes raised outside a tool implementation; no call in this SDK produces it.
      OTHER = :other
    end

    # The "leave this field exactly as it is" value a three-way patch argument defaults to.
    #
    # A field a patch may also *clear* has three states rather than two, and Ruby already spells
    # absent as `nil` — which here is the request to clear it. So the third state gets a name: leave
    # the argument out, or pass `GG::Core::UNCHANGED`, to keep what is there. A field with no clear
    # state is an ordinary `nil` default, where `nil` simply means it is not being changed.
    module Unchanged
      # Leave the field exactly as it is.
      UNCHANGED = :unchanged
    end

    # The value `GG::Core::Unchanged` names, so a patch argument reads `GG::Core::UNCHANGED` rather
    # than repeating the module.
    UNCHANGED = Unchanged::UNCHANGED
  end
end
