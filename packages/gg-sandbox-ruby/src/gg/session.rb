# frozen_string_literal: true

module GG
  # End the session.
  #
  # None of these calls stops the program: whatever follows an ending still runs. A program that
  # then fails has its ending revoked along with everything else it decided.
  module Session
    extend Surface::Operations

    # End the session, reporting what was done in a sentence or two.
    #
    # It does not stop the program: whatever follows it still runs. A program that then fails has
    # the ending cancelled and gets another turn.
    #
    # @param summary [String] What was done, in a sentence or two.
    # @return [nil]
    # @raise [GG::Core::ApiError] `:invalid_argument` for a blank summary.
    def self.finish(summary)
      Wire.call("finish", "session", "finish", [summary])
      nil
    end
    operation :finish, "session.finish"

    # Accept the work under review: it meets every completion criterion and stays in scope.
    #
    # This ends the session. It does not stop the program: whatever follows it still runs.
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
    # @raise [GG::Core::ApiError] `:invalid_argument` when the list is empty.
    def self.request_changes(*items)
      Wire.call("request_changes", "session", "requestChanges",
                [Check.strings("request_changes", "items", items)])
      nil
    end
    operation :request_changes, "session.request_changes"
  end
end
