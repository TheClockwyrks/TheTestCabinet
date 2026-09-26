// One entry of the program library's own history, nested in the module that lists it, and the
// method that fetches the source it deliberately does not carry.

namespace Gg;

public static partial class Programs
{
    /// <summary>One program already run, as the history lists it.</summary>
    /// <remarks>
    /// It carries the shape of the program rather than its source. A program that failed is kept and
    /// can still be fetched.
    /// </remarks>
    /// <param name="Id">The id its acknowledgement carried.</param>
    /// <param name="Turn">The turn it ran on.</param>
    /// <param name="Lines">How many lines of source it was.</param>
    /// <param name="Chars">How many characters of source it was.</param>
    /// <param name="Ok">Whether it ran to its end, with no uncaught exception and no ceiling stopping it.</param>
    /// <param name="Error">The error it ended with, where it did not run to its end.</param>
    public sealed record ProgramSummary(string Id, uint Turn, uint Lines, uint Chars, bool Ok, string? Error)
    {
        /// <summary>Fetch this program's source, as it was run.</summary>
        /// <returns>this program's source.</returns>
        /// <exception cref="ApiException">
        /// <see cref="ApiErrorCode.NotFound"/> when the library has dropped that program since the
        /// history was read.
        /// </exception>
        /// <ggop alias="true">programs.get</ggop>
        public string Source() => Get(Id);
    }
}
