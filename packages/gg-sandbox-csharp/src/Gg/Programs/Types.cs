// One entry of the program library's own history, nested in the module that lists it, and the
// method that fetches the source it deliberately does not carry.

namespace Gg;

public static partial class Programs
{
    /// <summary>One program already run, as the history lists it.</summary>
    /// <remarks>
    /// It carries the shape of the program rather than its source: a directory that inlined sixty
    /// lines per entry would put the whole session back into the one place that exists to avoid
    /// re-reading it. A program that failed is kept and can still be fetched.
    /// </remarks>
    /// <param name="Turn">The turn it ran on — what <see cref="Get"/> takes.</param>
    /// <param name="Lines">How many lines of source it was.</param>
    /// <param name="Chars">How many characters of source it was.</param>
    /// <param name="Ok">Whether it ran to its end, with no uncaught exception and no ceiling stopping it.</param>
    /// <param name="Error">The error it ended with, where it did not run to its end.</param>
    public sealed record ProgramSummary(uint Turn, uint Lines, uint Chars, bool Ok, string? Error)
    {
        /// <summary>Fetch this program's source, as it was run.</summary>
        /// <remarks>
        /// <see cref="Get"/> with the turn already supplied, which is what a directory entry is for:
        /// the listing says which program is worth fetching, and this fetches that one.
        /// </remarks>
        /// <returns>this program's source, ready to patch and hand to <see cref="Rerun"/>.</returns>
        /// <exception cref="ApiException">
        /// <see cref="ApiErrorCode.NotFound"/> when the library has dropped that turn since the
        /// history was read.
        /// </exception>
        /// <ggop alias="true">programs.get</ggop>
        public string Source() => Get(Turn);
    }
}
