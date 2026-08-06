# frozen_string_literal: true

module GG
  # The `programs` object: the library of programs this agent has already run.
  #
  # These are not gg tools. No capability offers one *as a tool*, nothing dispatches one by name,
  # and cataloguing them among the tools would break the bijection the committed component is
  # checked against — so, like `Session`, `Docs` and `Views`, they have their own membrane
  # interface, their own `Catalogue::PROGRAMS` list, and their own object. Unlike those three,
  # `GG::Scope` binds this one from the `library` flag the host passes to `run`, because it is
  # gated by a capability rather than by a tool or a role.
  #
  # **Why the object exists.** Under responses-as-code a reply is a whole program, so a
  # one-character mistake in a sixty-line program costs the sixty lines again. The library makes
  # the fix proportional to the mistake: fetch what ran, patch it with ordinary string work, hand
  # it back.
  #
  #     source = programs.get
  #     programs.rerun(source.sub("improt", "import"))
  #
  # @api private
  module Programs
    # The programs you have already run this session, oldest first — each with the turn it ran on,
    # how big it was, and whether it ran to its end.
    #
    # It lists shapes, not sources: fetch the one you want with `programs.get(turn)`. The list
    # survives a compaction, so it is also how you find a program whose text has left your context
    # window. It is empty — never an error — for a session that has run nothing yet.
    #
    # @return [Array<ProgramSummary>] every program this session has run, oldest first
    def self.history
      Wire.call("history", "programs", "history", []).map do |entry|
        ProgramSummary.new(
          turn: Wire.field(entry, "turn"),
          lines: Wire.field(entry, "lines"),
          chars: Wire.field(entry, "chars"),
          ok: Wire.field(entry, "ok"),
          error: Wire.field(entry, "error")
        )
      end
    end

    # The exact source of one program you ran, as a string. With no argument, your most recent one.
    #
    # This is the first half of fixing a program without rewriting it: get what ran, patch it with
    # ordinary string work (`sub`, an interpolation, a regexp), and hand the result to
    # `programs.rerun`. What comes back is the program that **executed** — so when a turn's program
    # was itself handed over by `programs.rerun`, you get the program that ran, not the few lines
    # that asked for it, and fetch-patch-run composes turn after turn.
    #
    # @param turn [Integer, nil] The turn whose program to fetch, as `programs.history` reports it.
    #   Leave it out for your most recent one.
    # @return [String] the program's source, exactly as it ran
    # @raise [ToolError] `:not_found`, naming the turns that are held, for a turn that ran no
    #   program or one old enough that the library has dropped it.
    def self.get(turn = nil)
      Wire.call("get", "programs", "get", [Wire.js(Check.uint("get", "turn", turn))])
    end

    # Hand gg a program to run in place of this one. Your program finishes, then gg runs `source`
    # as this turn's program.
    #
    # Use it with `programs.get` to fix a program without re-emitting it. Nothing is undone: every
    # call your program already made stands, and the program that runs next sees the world your
    # program left behind — so hand over BEFORE doing work you do not want done twice.
    #
    # The first call stands. If your program then raises, the hand-over is cancelled along with
    # everything else the failed program decided, and you get an ordinary error turn instead.
    # Chains are bounded: hand over once per turn, and write the fixed program to do the work.
    #
    # @param source [String] The program to run in place of this one. It may not be blank.
    # @return [nil] nothing; the hand-over happens once your program has ended
    # @raise [ToolError] `:refused` for a second hand-over in one turn — a silently replaced
    #   program is a change you cannot see — and `:invalid_argument` for a blank source.
    def self.rerun(source)
      Wire.call("rerun", "programs", "rerun", [source])
      nil
    end
  end
end
