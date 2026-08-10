// The thin layer between the bridge's primitives and the public surface. Not model-facing, not
// catalogued, and written with `//` comments so the reflector cannot mistake it for surface.

using System;
using System.Runtime.CompilerServices;

namespace Gg.Internal;

// What the SDK does with the bridge's conventions.
internal static class Wire
{
    // The `option<u32>` sentinel: no `u32` is negative, so one number can carry both facts.
    internal const long Absent = -1;

    // Turn a `false` from the bridge into the exception a C# caller expects, reading the failure the
    // guest parked. It is `[MethodImpl(NoInlining)]` for one reason a reader would otherwise wonder
    // about: it keeps `Wire.Check` out of the frame a model reads at the top of an uncaught
    // `ToolException`'s stack trace, so the first line names the SDK function that failed.
    [MethodImpl(MethodImplOptions.NoInlining)]
    internal static void Check(bool ok)
    {
        if (ok)
        {
            return;
        }
        Native.TakeError(out var code, out var tool, out var message);
        throw new ToolException((ToolErrorCode)code, tool, message);
    }

    // An `option<u32>` on the way out.
    internal static uint? Count(long value) => value < 0 ? null : (uint)value;

    // An `option<u32>` on the way in, for the line offsets and turn numbers a `u32` bounds. It is
    // an `int` rather than a `long` because the bridge's signature shapes are what decide which
    // interpreter trampolines the guest has to carry, and every one of these values is a line number
    // — see `packages/gg-sandbox-csharp/Sources/m2n.c`.
    internal static int Slot(uint? value) => value.HasValue ? (int)value.Value : (int)Absent;

    // An `option<f64>` on the way in. NaN is the sentinel because it is the one `double` that is
    // never equal to itself, so it can never be a timeout a caller meant.
    internal static double Slot(double? value) => value ?? double.NaN;

    // A `board-usage` as the bridge hands it back: one array in declaration order, which is what
    // keeps the calls that carry one inside the interpreter's argument-count ceiling.
    internal static Gg.Board.BoardUsage Board(uint[] board) =>
        new(board[0], board[1], board[2], board[3]);

    // A list argument the caller left out. The bridge lowers an empty array as an empty list, which
    // is what every one of these means: "no blockers", "no reviewers".
    internal static string[] Or(string[]? values) => values ?? [];
}
