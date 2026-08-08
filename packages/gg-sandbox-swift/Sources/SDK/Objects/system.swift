/// run shell commands in the workspace
///
/// One function, and it is the widest one this SDK has: everything a command line can do, a program
/// can do through it. A non-zero exit is a *result* rather than a failure, because deciding whether a
/// build or a test run passed is the single most common thing a program does with it.
public enum system: ApiObject {
    public static let ggObject = "system"

    /// The gg tools this object dispatches — see `fs.ggTools`.
    static let ggTools = ["shell"]

    /// Run a command with `sh -c` in the workspace directory and hand back its merged stdout and
    /// stderr.
    ///
    /// A non-zero exit is NOT a failure — read `exitCode` on the result; only a process that could
    /// not be launched, or one the timeout killed, throws.
    ///
    /// This run may **offload** shell output — the `shell` tool's own description says which mode is
    /// in force. Under `offload`, `output` holds only the tail that fits and ends with a note naming
    /// the two files the command's full stdout and stderr were written to. Under `adaptive` (the
    /// default), a command that **succeeded** returns no output at all, only that note; one that
    /// **failed** returns the tail. Grep the named files instead of re-running the command.
    ///
    /// - Parameters:
    ///   - command: The command line, run by `sh -c` with your workspace as its working directory.
    ///   - timeout: How long to let it run, in seconds, before killing it. Left out, it takes gg's
    ///     default of 120, which is clamped to whatever is left of the run's wall-clock budget.
    /// - Returns: what the process printed, and how it exited.
    /// - Throws: `ToolError` with `.limitExceeded` when the timeout killed the process, and
    ///   `.ioError` when it could not be launched.
    @discardableResult
    public static func shell(_ command: String, timeout: Double? = nil) throws -> ShellOutput {
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
}
