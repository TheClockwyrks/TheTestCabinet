// What a finished process reported, nested in the module that runs one.

namespace Gg;

public static partial class Shell
{
    /// <summary>What a finished process reported.</summary>
    /// <remarks>
    /// A non-zero exit code is an ordinary result to branch on rather than a failure of the call.
    /// The output is capped at 16 KiB — or, where the run offloads shell output, at its configured
    /// ceiling, with a note naming the files that hold the whole of it.
    /// </remarks>
    /// <param name="ExitCode">The exit status, or <c>null</c> when a signal terminated the process.</param>
    /// <param name="Output">Merged standard output then standard error, tail-truncated at the cap.</param>
    /// <param name="Truncated">Whether the cap cut the output: the head was dropped, the tail kept.</param>
    public sealed record ShellOutput(int? ExitCode, string Output, bool Truncated);
}
