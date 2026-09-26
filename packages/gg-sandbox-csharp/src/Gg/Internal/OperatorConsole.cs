// Where `Console.WriteLine` goes on this arm, and why the answer is not "nowhere".
//
// gg's telemetry stream IS the host process's standard output, so the sandbox builds its guests
// without one: a write to fd 1 from inside the guest would corrupt the run's event stream, and
// `crates/gg/src/sandbox/membrane.rs` says so in as many words. Every other arm answers this by
// giving a program a named function — `console.log`, `gg::log` — and pointing its prompt at it.
//
// This arm does not need a name, because C# already has one. `Console.SetOut` is the .NET way to say
// where written text goes, and a `[ModuleInitializer]` runs before the program's `Main` does, so a
// model writing the first line of C# it would write anywhere else reaches the operator's log. That
// is a better answer than a `gg.Log(…)` nobody would think to call, and it is why this arm has no
// logging function in its catalogue: there is nothing to catalogue, only `Console`.
//
// `Console.Error` is deliberately left alone. It goes to the guest's real standard error, which the
// host keeps and shows in front of a failure — a different channel meaning a different thing, and
// the runtime's own dying words belong in it.

using System;
using System.Runtime.CompilerServices;
using System.Text;

namespace Gg.Internal;

// `Console.Out`, redirected onto gg's feedback channel a line at a time.
internal sealed class OperatorConsole : System.IO.TextWriter
{
    // The partial line written so far. `Console.Write` is under no obligation to end with a newline,
    // and a channel that takes whole lines has to be handed whole lines.
    private readonly StringBuilder pending = new();

    public override Encoding Encoding => Encoding.UTF8;

    public override void Write(char value)
    {
        if (value == '\n')
        {
            Flush();
            return;
        }
        if (value != '\r')
        {
            pending.Append(value);
        }
    }

    public override void Write(string? value)
    {
        foreach (var character in value ?? string.Empty)
        {
            Write(character);
        }
    }

    // Send whatever has been written, whether or not it ended in a newline. Called on every newline,
    // and once more by the shell after the program has ended, so a `Console.Write` with no `WriteLine`
    // after it is not silently dropped.
    public override void Flush()
    {
        if (pending.Length == 0)
        {
            return;
        }
        var line = pending.ToString();
        pending.Clear();
        Native.Log(line);
    }

    // The single writer the program's `Console.Out` is set to, kept so the shell can flush it.
    private static readonly OperatorConsole Installed = new();

    [ModuleInitializer]
    internal static void Install() => Console.SetOut(Installed);

    // Called by `Sources/shell.c` once the program's `Main` has returned or thrown.
    internal static void FlushPending() => Installed.Flush();
}
