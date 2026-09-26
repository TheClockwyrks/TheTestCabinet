# frozen_string_literal: true

module GG
  # Fetch a program that already ran, and hand a patched copy back to be run.
  module Programs
    extend Surface::Operations

    # List the programs this session has already run, oldest first.
    #
    # Each carries its id, the turn it ran on, how big it was, and whether it ran to its end. It
    # lists shapes, not sources. The list survives a compaction. A session that has run nothing yet
    # gets an empty array rather than an error.
    #
    # @return [Array<GG::Programs::ProgramSummary>] every program this session has run, oldest first
    # @raise [GG::Core::ApiError] `:unavailable` under a run that keeps no program library.
    def self.history
      Wire.call("history", "programs", "history", []).map do |entry|
        ProgramSummary.new(
          id: Wire.field(entry, "id"),
          turn: Wire.field(entry, "turn"),
          lines: Wire.field(entry, "lines"),
          chars: Wire.field(entry, "chars"),
          ok: Wire.field(entry, "ok"),
          error: Wire.field(entry, "error")
        )
      end
    end
    operation :history, "programs.history"

    # Fetch the exact source of one program that ran, by the id its acknowledgement carried.
    #
    # The source comes back as a string. What comes back is the program that executed, so when a
    # submission's program was itself handed over, the program that ran is what arrives rather than
    # the few lines that asked for it. A rerun keeps the id of the submission it replaced.
    #
    # @param id [String] The program's id, as its acknowledgement carried it.
    # @return [String] the program's source, exactly as it ran
    # @raise [GG::Core::ApiError] `:not_found`, naming the ids that are held, for an id this session
    #   was never issued or one whose program the library has dropped.
    def self.get(id)
      Wire.call("get", "programs", "get", [id])
    end
    operation :get, "programs.get"

    # Hand gg a program to run in place of this one.
    #
    # The calling program finishes, then gg compiles and runs `source` as this submission's
    # program, under the same id. Nothing is undone: every call the calling program already made
    # stands, and the program that runs next sees the world it left behind.
    #
    # The first call in a program is the one that stands. If the calling program then fails, the
    # hand-over is cancelled along with everything else that program decided, and the turn ends in
    # an ordinary error. A submission runs at most four programs: this one plus three handed over.
    #
    # @param source [String] The program to run in place of this one, as Ruby. It may not be blank.
    # @return [nil]
    # @raise [GG::Core::ApiError] `:refused` for a second hand-over from the same program, and
    #   `:invalid_argument` for a blank source.
    def self.rerun(source)
      Wire.call("rerun", "programs", "rerun", [source])
      nil
    end
    operation :rerun, "programs.rerun"

    # One program that already ran, as `GG::Programs.history` lists it.
    #
    # It describes the program's shape, never its source.
    class ProgramSummary
      include Value
      extend Surface::Operations

      # @return [String] The id its `submit_program` acknowledgement carried.
      attr_reader :id

      # @return [Integer] The turn it ran on.
      attr_reader :turn

      # @return [Integer] How many lines of source it was.
      attr_reader :lines

      # @return [Integer] How many characters of source it was.
      attr_reader :chars

      # @return [String, nil] The error it ended with, when it did not run to its end; `nil` when it
      #   did.
      attr_reader :error

      # @api private
      def initialize(id:, turn:, lines:, chars:, ok:, error:)
        @id = id
        @turn = turn
        @lines = lines
        @chars = chars
        @ok = ok
        @error = error
        freeze
      end

      # @return [Boolean] Whether it ran to its end, with nothing raised and no sandbox ceiling
      #   stopping it.
      def ok?
        @ok
      end

      # Fetch this program's source, which a summary does not carry.
      #
      # @return [String] the program's source, exactly as it ran
      # @raise [GG::Core::ApiError] `:not_found` when the library has since dropped that program.
      def source
        Programs.get(@id)
      end
      member_operation :source, "programs.get"
    end
  end
end
