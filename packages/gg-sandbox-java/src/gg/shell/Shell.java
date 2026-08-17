package gg.shell;

import gg.ApiError;
import gg.ApiErrorCode;
import gg.internal.Coding;
import gg.internal.Read;
import gg.internal.Value;
import java.util.OptionalInt;

/**
 * Run shell commands in the workspace.
 *
 * <p>One call, and the way a program reaches everything gg has no tool for: a build, a test run,
 * {@code git}, {@code curl}, a package manager. The workspace is the working directory.
 *
 * @ggmodule shell
 */
public final class Shell {
    private Shell() {
    }

    /**
     * Run a command with {@code sh -c} in the workspace and hand back what it printed.
     *
     * <p>A non-zero exit is not a failure: it arrives as {@code exitCode} on the result. Only a
     * process that could not be launched, or one the timeout killed, throws.
     *
     * <p>This run may offload shell output, and the {@code shell} tool's own description says which
     * mode is in force. Under {@code offload}, {@code output} holds the tail that fits and ends with
     * a note naming the two files the whole of stdout and stderr went to. Under {@code adaptive},
     * the default, a command that succeeded returns only that note and one that failed returns the
     * tail. Grepping the named files beats running the command again.
     *
     * @param command The command line, run by {@code sh -c} with the workspace as its working
     *     directory.
     * @return what the command printed, and how it exited
     * @throws ApiError {@link ApiErrorCode#LIMIT_EXCEEDED} when the timeout killed the process,
     *     and {@link ApiErrorCode#IO_ERROR} when it could not be launched.
     * @ggop shell.shell
     */
    public static ShellOutput shell(String command) {
        return Read.shellOutput(Coding.call("shell.shell", Value.of(command), Value.none()));
    }

    /**
     * Run a command with a deadline of the program's own rather than gg's default of 120 seconds.
     *
     * @param command The command line, run by {@code sh -c} with the workspace as its working
     *     directory.
     * @param timeoutSecs How long to let it run before killing it, in seconds. It is clamped to
     *     whatever is left of the run's wall-clock budget.
     * @return what the command printed, and how it exited
     * @throws ApiError {@link ApiErrorCode#LIMIT_EXCEEDED} when the timeout killed the process,
     *     and {@link ApiErrorCode#IO_ERROR} when it could not be launched.
     * @ggop shell.shell
     */
    public static ShellOutput shell(String command, int timeoutSecs) {
        return Read.shellOutput(Coding.call("shell.shell", Value.of(command),
                Value.of((double) timeoutSecs)));
    }

    // -------------------------------------------------------------------------------------------
    // The type a command hands back
    // -------------------------------------------------------------------------------------------

    /**
     * What a command reported when it finished.
     *
     * @param exitCode The process's exit status; empty when a signal killed it. Zero means success.
     * @param output Merged stdout then stderr, tail-truncated at this run's own ceiling.
     * @param truncated Whether the cap cut {@code output}, dropping the head and keeping the tail.
     */
    public record ShellOutput(OptionalInt exitCode, String output, boolean truncated) {
    }
}
