using System.Collections.Generic;

namespace Gg;

/// <summary>
/// run shell commands in the workspace
/// </summary>
/// <remarks>
/// It is one call, and it is how a program reaches everything gg has no tool for: a build, a test
/// run, <c>git</c>, <c>curl</c>, a package manager. The workspace is the working directory.
/// </remarks>
public static class system
{
    /// <inheritdoc cref="Internal.ObjectDirectory.List"/>
    public static IReadOnlyList<FunctionSummary> List() => Internal.ObjectDirectory.List("system");

    /// <summary>
    /// Run a command with <c>sh -c</c> in the workspace directory and hand back its merged standard
    /// output and standard error.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A non-zero exit is <b>not</b> a failure of this call: the output and the code both come back so
    /// your program can branch on them. Checking whether a build or a test run passed is the single
    /// most common thing a program does, so it has to work inside an expression:
    /// </para>
    /// <code>
    /// var built = system.Shell("cargo build --release");
    /// if (built.ExitCode != 0)
    /// {
    ///     view.OpenText("build", built.Output);
    /// }
    /// </code>
    /// <para>
    /// Only a failure to launch the process, or the timeout killing it, throws.
    /// </para>
    /// </remarks>
    /// <param name="command">The command line, run by <c>sh -c</c> with your workspace as its working directory.</param>
    /// <param name="timeoutSeconds">
    /// How long to let it run before killing it. Leave it out for gg's default of 120 seconds. It is
    /// clamped to whatever is left of the run's wall-clock budget either way, so one call cannot
    /// outlive the run it belongs to.
    /// </param>
    /// <returns>what the process wrote and how it exited.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.LimitExceeded"/> when the timeout killed it, and
    /// <see cref="ToolErrorCode.IOError"/> when the process could not be started at all.
    /// </exception>
    public static ShellOutput Shell(string command, double? timeoutSeconds = null)
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
