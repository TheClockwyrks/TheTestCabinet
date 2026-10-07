namespace Gg;

/// <summary>Run shell commands in the workspace.</summary>
/// <remarks>Commands run with the workspace as the working directory.</remarks>
/// <ggmodule>shell</ggmodule>
public static partial class Shell
{
    /// <summary>Run a command with <c>sh -c</c> and hand back its merged output and exit status.</summary>
    /// <remarks>
    /// A non-zero exit is an ordinary result rather than a failure of the call: the output and the
    /// code both come back, so a program branches on them. Only a failure to launch the process, or
    /// the timeout killing it, throws.
    /// </remarks>
    /// <param name="command">The command line, run with the workspace as its working directory.</param>
    /// <param name="timeoutSeconds">
    /// How long to let it run before killing it. Left out, gg's default of 3600 seconds applies, and
    /// either way it is clamped to what is left of the run's wall-clock budget.
    /// </param>
    /// <returns>what the process reported, including whether the output cap cut what came back.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.LimitExceeded"/> when the timeout killed it, and
    /// <see cref="ApiErrorCode.IOError"/> when the process could not be started at all.
    /// </exception>
    /// <ggop>shell.shell</ggop>
    public static ShellOutput Run(string command, double? timeoutSeconds = null)
    {
        Internal.Wire.Check(Internal.Native.Shell(
            command,
            Internal.Wire.Slot(timeoutSeconds),
            out var hasExitCode,
            out var exitCode,
            out var output,
            out var truncated));
        return new ShellOutput(hasExitCode ? exitCode : null, output, truncated);
    }
}
