package gg;

import gg.internal.Read;
import gg.internal.Wire;
import org.teavm.jso.JSObject;

/**
 * The {@code system} object: running commands in the workspace.
 *
 * <p>Its one call is the door out of the sandbox and into the run container, so a build, a test
 * suite and a {@code git} invocation all go through it.
 */
public final class Shell extends ApiObject {
    Shell() {
        super("system");
    }

    @Override
    JSObject target() {
        return Wire.system();
    }

    /**
     * Run a command with {@code sh -c} in the workspace directory and hand back its merged stdout
     * and stderr.
     *
     * <p>A non-zero exit is NOT a failure — read {@code exitCode} on the result; only a process
     * that could not be launched, or one the timeout killed, raises.
     *
     * <p>This run may <b>offload</b> shell output — the {@code shell} tool's own description says
     * which mode is in force. Under {@code offload}, {@code output} holds only the tail that fits
     * and ends with a note naming the two files the command's full stdout and stderr were written
     * to. Under {@code adaptive} (the default), a command that <b>succeeded</b> returns no output
     * at all, only that note; one that <b>failed</b> returns the tail. Grep the named files
     * instead of re-running the command.
     *
     * @param command The command line, run by {@code sh -c} with your workspace as its working
     *     directory.
     * @return what the command printed, and how it exited
     * @throws ToolError {@code LIMIT_EXCEEDED} when the timeout killed the process, and
     *     {@code IO_ERROR} when it could not be launched.
     */
    public ShellOutput shell(String command) {
        return Read.shellOutput(Wire.call("shell", target(), object(), "shell",
                Wire.args(Wire.text(command))));
    }

    /**
     * Run a command with a deadline of your own rather than gg's default of 120 seconds.
     *
     * @param command The command line, run by {@code sh -c} with your workspace as its working
     *     directory.
     * @param timeoutSecs How long to let it run, in seconds, before killing it. It is clamped to
     *     whatever is left of the run's wall-clock budget.
     * @return what the command printed, and how it exited
     * @throws ToolError {@code LIMIT_EXCEEDED} when the timeout killed the process, and
     *     {@code IO_ERROR} when it could not be launched.
     */
    public ShellOutput shell(String command, int timeoutSecs) {
        JSObject options = Wire.object();
        Wire.set(options, "timeoutSecs", Wire.number(timeoutSecs));
        return Read.shellOutput(Wire.call("shell", target(), object(), "shell",
                Wire.args(Wire.text(command), options)));
    }
}
