import org.teavm.jso.JSObject

/**
 * The `system` object: running commands in the workspace.
 *
 * Its one call is the door out of the sandbox and into the run container, so a build, a test suite and
 * a `git` invocation all go through it.
 */
public class Shell internal constructor() : ApiObject("system") {
    override fun target(): JSObject? = systemObject()

    /**
     * Run a command with `sh -c` in the workspace directory and hand back its merged stdout and
     * stderr.
     *
     * A non-zero exit is NOT a failure — read `exitCode` on the result; only a process that could not
     * be launched, or one the timeout killed, raises.
     *
     * This run may **offload** shell output — the `shell` tool's own description says which mode is in
     * force. Under `offload`, `output` holds only the tail that fits and ends with a note naming the two
     * files the command's full stdout and stderr were written to. Under `adaptive` (the default), a
     * command that **succeeded** returns no output at all, only that note; one that **failed** returns
     * the tail. Grep the named files instead of re-running the command.
     *
     * @param command The command line, run by `sh -c` with your workspace as its working directory.
     * @param timeoutSecs How long to let it run, in seconds, before killing it, clamped to whatever is
     *   left of the run's wall-clock budget. Leave it out for gg's default of 120 seconds.
     * @return what the command printed, and how it exited
     * @throws ToolError `LIMIT_EXCEEDED` when the timeout killed the process, and `IO_ERROR` when it
     *   could not be launched.
     */
    public fun shell(command: String, timeoutSecs: Int? = null): ShellOutput {
        val args =
            if (timeoutSecs == null) {
                ggArgs(ggText(command))
            } else {
                val options = ggRecord()
                ggSet(options, "timeoutSecs", ggNumber(timeoutSecs))
                ggArgs(ggText(command), options)
            }
        return Read.shellOutput(ggCall("shell", target(), owner, "shell", args))
    }
}
