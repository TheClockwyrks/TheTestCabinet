/**
 * Run shell commands in the workspace.
 *
 * One function, and the way a program reaches everything gg has no tool for: a build, a test run,
 * `git`, `curl`, a package manager. The workspace is the working directory.
 *
 * A non-zero exit is a result rather than a failure, because deciding whether a build or a test run
 * passed is the single most common thing a program does with one.
 *
 * @ggmodule shell
 */
package gg.shell

import gg.core.ApiError
import gg.internal.Read
import gg.internal.ggCall
import gg.internal.ggNumber
import gg.internal.ggText


/**
 * Run a command with `sh -c` in the workspace and hand back its merged output.
 *
 * A non-zero exit is not a failure: [ShellOutput.exitCode] carries it. Only a process that could not
 * be launched, or one the timeout killed, raises.
 *
 * This run may offload shell output, and the `shell` tool's own description says which mode is in
 * force. Under `offload`, [ShellOutput.output] holds only the tail that fits and ends with a note
 * naming the two files the command's full standard output and standard error were written to. Those
 * files are readable by absolute path, so a `gg.files.readTextFile` of one, or a grep, is cheaper
 * than running the command again.
 *
 * @ggop shell.shell
 * @param command The command line, run by `sh -c` with the workspace as its working directory.
 * @param timeoutSecs How long to let it run, in seconds, before killing it, clamped to whatever is
 *   left of the run's wall-clock budget. Left out, gg's default of 120 applies.
 * @return what the command printed, and how it exited
 * @throws ApiError `LIMIT_EXCEEDED` when the timeout killed the process, and `IO_ERROR` when it
 *   could not be launched.
 */
public fun run(command: String, timeoutSecs: Int? = null): ShellOutput =
    Read.shellOutput(ggCall("shell.shell", ggText(command), ggNumber(timeoutSecs)))

/**
 * What a command reported when it finished.
 *
 * @property exitCode The process's exit status; `null` when a signal killed it. Zero means success.
 * @property output Merged standard output then standard error, tail-truncated at 16 KiB.
 * @property truncated Whether the cap cut `output`, dropping the head and keeping the tail.
 */
public data class ShellOutput(val exitCode: Int?, val output: String, val truncated: Boolean)
