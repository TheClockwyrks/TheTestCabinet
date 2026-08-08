// gg's parse-only Roslyn driver: WHICH STAGE rejected a program, asked of the compiler rather than
// guessed at.
//
// WHY IT EXISTS. The seam keeps a syntax error and a compile error in separate bands, and they mean
// different things about a model: a syntax error is a typo, and a compile error is a program written
// whole and coherently against a surface the model got wrong — which is the single most interesting
// thing a checked language's arm can report about the SDK it was handed. `csc` cannot tell gg which
// it is. Its command line reports every diagnostic in one stream with no stage attached, and
// Roslyn's own `ErrorFacts.IsParseError` is `internal`, so the only honest way to ask is to ask the
// parser directly. That is the whole of this program: parse the file, print the parser's own errors,
// print nothing if it parsed. gg reads the answer off the emptiness of the output.
//
// WHY IT IS NOT A COMPILER SERVER. It parses one file and exits. It holds nothing between
// invocations, resolves no references, binds nothing and writes nothing — so it is a process gg
// starts per preparation, in that preparation's own isolated environment, exactly as `csc` is. What
// the seam's isolation contract forbids is the RESIDENT compiler `VBCSCompiler` is, which is why
// that one is deleted from the image rather than merely unused.
//
// WHY IT RUNS ONLY ON THE FAILING PATH. A program that compiled has no band to decide. This costs
// nothing on the turn path and one process on a turn that was already lost.
//
// It is built by `crates/gg/src/sandbox/language/csharp.compile.rs` into a shared, content-keyed
// toolchain directory, against the `Microsoft.CodeAnalysis.CSharp.dll` that ships beside `csc.dll`
// in the toolchain `scripts/ci/install-dotnet.sh` installs. Nothing is fetched and nothing is
// committed.

using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.Text;

namespace Tools;

internal static class Parse
{
    // usage: Parse <language-version> <file>
    //
    // Exit 0 having printed the parser's errors, one per line, in `csc`'s own format — or nothing at
    // all when the file parsed. Exit 2 for a usage or I/O failure, which gg reads as "this classifier
    // could not answer" rather than as "the program parsed".
    internal static int Main(string[] arguments)
    {
        if (arguments.Length != 2)
        {
            Console.Error.WriteLine("usage: Parse <language-version> <file>");
            return 2;
        }
        if (!LanguageVersionFacts.TryParse(arguments[0], out var version))
        {
            Console.Error.WriteLine($"unknown C# language version '{arguments[0]}'");
            return 2;
        }

        string source;
        try
        {
            source = File.ReadAllText(arguments[1]);
        }
        catch (Exception failure)
        {
            Console.Error.WriteLine($"could not read {arguments[1]}: {failure.Message}");
            return 2;
        }

        // The file name alone, and no directory: it is what `csc` itself prints when its input is
        // under the working directory, and a model must never be shown the preparation's own path.
        var tree = CSharpSyntaxTree.ParseText(
            SourceText.From(source, Encoding.UTF8),
            new CSharpParseOptions(version),
            path: Path.GetFileName(arguments[1]));

        var output = new StringBuilder();
        foreach (var diagnostic in tree.GetDiagnostics().Where(IsError))
        {
            output.AppendLine(Format(diagnostic));
        }
        Console.Out.Write(output.ToString());
        return 0;
    }

    // `csc`'s own rendering, written out rather than taken from `Diagnostic.ToString()` for one
    // reason: the MAPPED span. A code module is compiled inside a class body gg wrote around it, with
    // a `#line` directive restoring the author's own coordinates — and only the mapped span honours
    // it. `ToString()` reports where the text really is, which is a line number nobody wrote.
    private static string Format(Diagnostic diagnostic)
    {
        var span = diagnostic.Location.GetMappedLineSpan();
        var line = span.StartLinePosition.Line + 1;
        var column = span.StartLinePosition.Character + 1;
        var message = diagnostic.GetMessage(CultureInfo.InvariantCulture);
        return $"{span.Path}({line},{column}): error {diagnostic.Id}: {message}";
    }

    // Errors only. A parser warning is not a rejection, and a program is in the syntax band only if
    // the parser refused it.
    private static bool IsError(Diagnostic diagnostic) =>
        diagnostic.Severity == DiagnosticSeverity.Error;
}
