/// Run shell commands in the workspace.
///
/// One function, and the way a program reaches everything gg has no tool for: a build, a test run,
/// `git`, `curl`, a package manager. The workspace is the working directory.
///
/// A non-zero exit is a *result* rather than a failure, because deciding whether a build or a test
/// run passed is the single most common thing a program does with one.
///
/// - ggmodule: shell
public enum shell {
    /// The gg tools this module dispatches — see `files.ggTools`.
    static let ggTools = ["shell"]

    /// Run a command with `sh -c` in the workspace and hand back its merged stdout and stderr.
    ///
    /// A non-zero exit is not a failure: read `exitCode` on the result. Only a process that could
    /// not be launched, or one the timeout killed, throws.
    ///
    /// This run may offload shell output — the `shell` tool's own description says which mode is in
    /// force. Under `offload`, `output` holds only the tail that fits and ends with a note naming
    /// the two files the command's full stdout and stderr were written to. Under `adaptive`, the
    /// default, a command that succeeded returns no output at all, only that note, and one that
    /// failed returns the tail. Grepping the named files is cheaper than re-running the command.
    ///
    /// - Parameters:
    ///   - command: The command line, run by `sh -c` with the workspace as its working directory.
    ///   - timeout: How long to let it run, in seconds, before killing it. Left out, it takes gg's
    ///     default of 120, clamped to whatever is left of the run's wall-clock budget.
    /// - Returns: what the process printed, and how it exited.
    /// - Throws: `core.ToolError` with `.limitExceeded` when the timeout killed the process, and
    ///   `.ioError` when it could not be launched.
    /// - ggop: shell.shell
    @discardableResult
    public static func run(_ command: String, timeout: Double? = nil) throws -> ShellOutput {
        try withScratch { scratch in
            var command = scratch.string(command)
            var ret = test_cabinet_gg_shell_shell_output_t()
            var err = test_cabinet_gg_types_tool_error_t()
            let ok = withOptional(timeout) { timeout in
                test_cabinet_gg_shell_shell(&command, timeout, &ret, &err)
            }
            guard ok else { throw lift(failure: &err) }
            let output = ShellOutput(wire: ret)
            test_cabinet_gg_shell_shell_output_free(&ret)
            return output
        }
    }

    /// What a command reported when it finished.
    public struct ShellOutput: Sendable {
        /// The process's exit status; `nil` when a signal killed it. Zero means success.
        public let exitCode: Int?
        /// Merged stdout then stderr, tail-truncated at 16 KiB.
        ///
        /// Under a run that offloads shell output the ceiling is the configured line or character
        /// one, and a note naming the files holding the whole of it follows. Under the default
        /// `adaptive` mode a command that succeeded returns just that note.
        public let output: String
        /// Whether the cap cut `output`, dropping the head and keeping the tail.
        public let truncated: Bool

        init(wire: test_cabinet_gg_shell_shell_output_t) {
            exitCode = wire.exit_code.is_some ? Int(wire.exit_code.val) : nil
            output = lift(wire.output)
            truncated = wire.truncated
        }
    }
}
