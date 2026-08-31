# frozen_string_literal: true

module GG
  # Run shell commands in the workspace.
  #
  # The workspace is the working directory. A non-zero exit is a result rather than a failure.
  module Shell
    extend Surface::Operations

    # Run a command with `sh -c` in the workspace and hand back its merged stdout and stderr.
    #
    # A non-zero exit is not a failure: read `exit_code` on the result. Only a process that could
    # not be launched, or one the timeout killed, raises.
    #
    # This run may offload shell output. Under `offload`, `output` holds only the tail that fits
    # and ends with a note naming the two files the command's full stdout and stderr were written
    # to. Those files are readable by absolute path.
    #
    # @param command [String] The command line, run by `sh -c` with the workspace as its working
    #   directory.
    # @param timeout_secs [Numeric, nil] How long to let it run, in seconds, before killing it.
    #   Leave it out for gg's default of 120, clamped to whatever is left of the run's wall-clock
    #   budget.
    # @return [GG::Shell::ShellOutput] what the process reported when it finished
    # @raise [GG::Core::ApiError] `:limit_exceeded` when the timeout killed the process, and
    #   `:io_error` when it could not be launched.
    def self.run(command, timeout_secs: nil)
      result = Wire.call("shell", "shell", "shell",
                         [command, Wire.js(Check.positive("shell", "timeout_secs", timeout_secs))])
      ShellOutput.new(
        exit_code: Wire.field(result, "exitCode"),
        output: Wire.field(result, "output"),
        truncated: Wire.field(result, "truncated")
      )
    end
    operation :run, "shell.shell", tool: "shell"

    # What a command reported when it finished.
    class ShellOutput
      include Value

      # @return [Integer, nil] The process's exit status; `nil` when a signal killed it. Zero means
      #   success.
      attr_reader :exit_code

      # Merged stdout then stderr, tail-truncated at 16 KiB.
      #
      # Under a run that offloads shell output the ceiling is the configured line or character one
      # instead, and an output that was cut ends with a note naming the two files that hold the
      # whole of it.
      #
      # @return [String]
      attr_reader :output

      # @api private
      def initialize(exit_code:, output:, truncated:)
        @exit_code = exit_code
        @output = output
        @truncated = truncated
        freeze
      end

      # @return [Boolean] Whether the cap cut `output`, dropping the head and keeping the tail.
      def truncated?
        @truncated
      end
    end
  end
end
