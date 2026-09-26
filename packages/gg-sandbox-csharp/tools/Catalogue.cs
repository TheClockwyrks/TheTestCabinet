// The one thing this arm's SOURCES cannot say: which modules the surface is divided into, and in
// what order a reader meets them.
//
// Everything else that used to live here is gone. A function's gg operation id is now written on the
// declaration it belongs to, as a `<ggop>` element in that declaration's own XML documentation
// comment, and a type's module is written on the module class that contains it. A side table naming
// every function twice was precisely the second copy that drifts, and it does not exist any more.
//
// What is left is a table of twelve capability modules and the class-less `core` beside them, and it
// is here rather than on the classes for three reasons: the ORDER is model-facing — it is the
// sequence a documentation index and the run's agent surface present the modules in — the PATH is the
// string gg matches a fully-qualified name's prefix against, so a class that misspelled its own
// namespace would be reporting a name nothing could open, and the IMPORT is the line a program
// writes to reach the module, which Roslyn has no way to report because no declaration states it.
// The class's own `<ggmodule>` says which of these rows it is, and `Signatures` asserts the two sets
// are equal in both directions.

using System.Collections.Generic;

namespace Tools;

/// One module's identity: gg's cross-arm id for it, how C# spells it, and the line a program writes
/// to reach it by its short name.
internal sealed record Module(string Id, string Class, string Path, string Import);

internal static class Catalogue
{
    // THE LINE A PROGRAM WRITES. gg's SDK is compiled in the same compilation as the program, which
    // tells `csc` the library exists and puts nothing in the program's scope. `Gg.Views.OpenText` is
    // therefore reachable with no line at all, and `Views.OpenText` is reachable after this one.
    //
    // It is the same line for every module because that is what C#'s namespaces are: the modules are
    // types in `namespace Gg`, and a `using` of the namespace brings all of them. The per-module
    // alternative — `using Files = Gg.Files;` — resolves the same calls and is not what a C# author
    // writes. `crates/gg/src/sandbox/language/csharp.rs` carries the same string as
    // `SURFACE_IMPORT`, for the refusals and gates that quote it, and a test holds the two equal.
    private const string Import = "using Gg;";

    // The modules the surface is divided into, IN THE ORDER IT IS PRESENTED IN.
    //
    // It runs from the modules almost every run has to the ones a particular shape of agent has,
    // because a model reads a list from the top. `core` is last and deliberately: it declares no
    // function at all, only the types and the exception every other module's signatures name.
    internal static readonly Module[] Modules =
    [
        new("files", "Files", "Gg.Files", Import),
        new("shell", "Shell", "Gg.Shell", Import),
        new("board", "Board", "Gg.Board", Import),
        new("tasks", "Tasks", "Gg.Tasks", Import),
        new("memories", "Memories", "Gg.Memories", Import),
        new("docs", "Docs", "Gg.Docs", Import),
        new("views", "Views", "Gg.Views", Import),
        new("context", "Context", "Gg.Context", Import),
        new("delegation", "Delegation", "Gg.Delegation", Import),
        new("skills", "Skills", "Gg.Skills", Import),
        new("programs", "Programs", "Gg.Programs", Import),
        new("session", "Session", "Gg.Session", Import),
        // The one module with no class of its own: the types and the exception that live directly in
        // `namespace Gg`, because every other module's signatures name them. Its empty class name is
        // what says so, and is what keeps it out of the function walk. Its own two lines of
        // documentation are still written on a declaration, like every other module's — on the
        // `internal` class at the end of `src/Gg/Core/Errors.cs`, which `Signatures` resolves by
        // its `<ggmodule>` tag.
        new("core", "", "Gg", Import),
    ];

    /// Every module that has a class of its own, which is every module but `core`.
    internal static IEnumerable<Module> Classed()
    {
        foreach (var module in Modules)
        {
            if (module.Class.Length > 0)
            {
                yield return module;
            }
        }
    }
}
