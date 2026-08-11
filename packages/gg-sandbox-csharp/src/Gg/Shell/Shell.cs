namespace Gg;

/// <summary>Run shell commands in the workspace.</summary>
/// <remarks>
/// One call, and the way a program reaches everything gg has no tool for: a build, a test run,
/// <c>git</c>, <c>curl</c>, a package manager. The workspace is the working directory.
/// </remarks>
/// <ggmodule>shell</ggmodule>
public static partial class Shell
{
    /// <summary>Run a command with <c>sh -c</c> and hand back its merged output and exit status.</summary>
    /// <remarks>
    /// <para>
    /// A non-zero exit is an ordinary result rather than a failure of the call: the output and the
    /// code both come back, so a program branches on them. Only a failure to launch the process, or
    /// the timeout killing it, throws.
    /// </para>
    /// <code>
    /// var built = Shell.Run("cargo build --release");
    /// if (built.ExitCode != 0)
    /// {
    ///     Views.OpenText("build", built.Output);
    /// }
    /// </code>
    /// </remarks>
    /// <param name="command">The command line, run with the workspace as its working directory.</param>
    /// <param name="timeoutSeconds">
    /// How long to let it run before killing it. Left out, gg's default of 120 seconds applies, and
    /// either way it is clamped to what is left of the run's wall-clock budget.
    /// </param>
    /// <returns>what the process reported, including whether the output cap cut what came back.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.LimitExceeded"/> when the timeout killed it, and
    /// <see cref="ToolErrorCode.IOError"/> when the process could not be started at all.
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
