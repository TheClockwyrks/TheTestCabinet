# frozen_string_literal: true

module GG
  # End the session, with the ending that belongs to this agent's role.
  #
  # Under responses as code every reply is a program, so there is no prose turn that could mean "the
  # work is done" — a model that answers "task complete" has written a reply that failed to be a
  # program, not an ending. These are the calls that mean it, and a run binds only the group its
  # agent's role has: an agent doing work gets `finish`, and a reviewer gets `approve` and
  # `request_changes` instead.
  #
  # None of them stops the program. Whatever follows an ending still runs, so an ending belongs last
  # — and a program that then fails has its ending revoked along with everything else it decided.
  module Session
    extend Surface::Operations

    # End the session, reporting what was done in a sentence or two.
    #
    # This is the only thing that ends a working agent's session. It does not stop the program —
    # whatever follows it still runs — so it belongs last, once the tools have confirmed the work is
    # really done. A program that then fails has the ending cancelled and gets another turn.
    #
    # @param summary [String] What was done, in a sentence or two.
    # @return [nil]
    # @raise [GG::Core::ToolError] `:invalid_argument` for a blank summary.
    def self.finish(summary)
      Wire.call("finish", "session", "finish", [summary])
      nil
    end
    operation :finish, "session.finish"

    # Accept the work under review: it meets every completion criterion and stays in scope.
    #
    # This ends the session. It does not stop the program — whatever follows it still runs — so it
    # belongs last, once the change has actually been read. It takes nothing, because an approval
    # carries no obligation beyond itself.
    #
    # @return [nil]
    def self.approve
      Wire.call("approve", "session", "approve", [])
      nil
    end
    operation :approve, "session.approve"

    # Reject the work under review, listing every change that must be made before it can be
    # accepted.
    #
    # This ends the session, and does not stop the program. Each item says what is wrong and what to
    # change.
    #
    # @param items [Array<String>] Every change that must be made before the work can be accepted,
    #   splatted, one per entry: what is wrong, and what to change. It may not be empty.
    # @return [nil]
    # @raise [GG::Core::ToolError] `:invalid_argument` when the list is empty.
    def self.request_changes(*items)
      Wire.call("request_changes", "session", "requestChanges",
                [Check.strings("request_changes", "items", items)])
      nil
    end
    operation :request_changes, "session.request_changes"
  end
end
