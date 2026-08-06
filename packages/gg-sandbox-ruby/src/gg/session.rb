# frozen_string_literal: true

module GG
  # Ending the session — the model-facing functions that are not gg tools.
  #
  # They live beside the tools rather than among them because nothing about them is a tool: no
  # capability offers them, they dispatch nothing, and one group of them is bound into every
  # program's scope including one in a run that enables no tools at all. Keeping them out of
  # `Catalogue::TOOLS` is what keeps that list in exact bijection with the gg tool vocabulary the
  # component is checked against.
  #
  # **Why a session needs them at all.** Under responses-as-code every reply is a program, so there
  # is no prose turn that could mean "I am done" — a model that answers "task complete" has written
  # a reply that failed to be a program, not an ending.
  #
  # **Why there is more than one.** An ending is a *result*, and different roles produce different
  # results: an agent doing work reports what it did, and a reviewer returns a verdict. Each is a
  # different shape, so each is a different call whose signature carries exactly what that result
  # is made of, and `GG::Scope` binds one group per program.
  #
  # **Why they are one line each.** Ending is a fact about the *agent*, not about the program that
  # declared it, so the flag lives in the agent's host-side context and this module holds none of
  # it: no module state to reset between programs, no sentinel exception, no unwind.
  #
  # @api private
  module Session
    # End your session, reporting what you did in a sentence or two. This is the only thing that
    # ends it.
    #
    # It does not stop your program — whatever follows it still runs — so call it last, once the
    # tools have confirmed the work is really done. If your program then fails, the ending is
    # cancelled and you get another turn.
    #
    # @param summary [String] What you did, in a sentence or two.
    # @return [nil] nothing; your program runs on
    def self.finish(summary)
      Wire.call("finish", "session", "finish", [summary])
      nil
    end

    # Accept the work you are reviewing: it meets every completion criterion and stays in scope.
    # This ends your session.
    #
    # It does not stop your program — whatever follows it still runs — so call it last, once you
    # have actually read the change.
    #
    # @return [nil] nothing; your program runs on
    def self.approve
      Wire.call("approve", "session", "approve", [])
      nil
    end

    # Reject the work you are reviewing, listing every change that must be made before it can be
    # accepted.
    #
    # Each item says what is wrong and what to change; the list may not be empty. This ends your
    # session, and does not stop your program.
    #
    # @param items [Array<String>] Every change that must be made before the work can be accepted,
    #   splatted, one per entry: what is wrong, and what to change. It may not be empty.
    # @return [nil] nothing; your program runs on
    def self.request_changes(*items)
      Wire.call("request_changes", "session", "requestChanges",
                [Check.strings("request_changes", "items", items)])
      nil
    end
  end
end
