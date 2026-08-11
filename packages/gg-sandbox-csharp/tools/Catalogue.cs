// The one thing this arm's SOURCES cannot say: which modules the surface is divided into, and in
// what order a reader meets them.
//
// Everything else that used to live here is gone. A function's gg operation id is now written on the
// declaration it belongs to, as a `<ggop>` element in that declaration's own XML documentation
// comment, and a type's module is written on the module class that contains it. A side table naming
// every function twice was precisely the second copy that drifts, and it does not exist any more.
//
// What is left is a table of twelve capability modules and the class-less `core` beside them, and it
// is here rather than on the classes for two reasons: the ORDER is model-facing — it is the sequence
// a documentation index and the run's agent surface present the modules in — and the PATH is the
// string gg matches a fully-qualified
// name's prefix against, so a class that misspelled its own namespace would be reporting a name
// nothing could open. The class's own `<ggmodule>` says which of these rows it is, and `Signatures`
// asserts the two sets are equal in both directions.

using System.Collections.Generic;

namespace Tools;

/// One module's identity: gg's cross-arm id for it, and how C# spells it.
internal sealed record Module(string Id, string Class, string Path);

internal static class Catalogue
{
    // The modules the surface is divided into, IN THE ORDER IT IS PRESENTED IN.
    //
    // It runs from the modules almost every run has to the ones a particular shape of agent has,
    // because a model reads a list from the top. `core` is last and deliberately: it declares no
    // function at all, only the types and the exception every other module's signatures name.
    internal static readonly Module[] Modules =
    [
        new("files", "Files", "Gg.Files"),
        new("shell", "Shell", "Gg.Shell"),
        new("board", "Board", "Gg.Board"),
        new("tasks", "Tasks", "Gg.Tasks"),
        new("memories", "Memories", "Gg.Memories"),
        new("docs", "Docs", "Gg.Docs"),
        new("views", "Views", "Gg.Views"),
        new("context", "Context", "Gg.Context"),
        new("delegation", "Delegation", "Gg.Delegation"),
        new("skills", "Skills", "Gg.Skills"),
        new("programs", "Programs", "Gg.Programs"),
        new("session", "Session", "Gg.Session"),
        // The one module with no class of its own: the types and the exception that live directly in
        // `namespace Gg`, because every other module's signatures name them. Its empty class name is
        // what says so, and is what keeps it out of the function walk.
        new("core", "", "Gg"),
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
