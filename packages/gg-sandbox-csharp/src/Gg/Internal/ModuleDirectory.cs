// Where the one paragraph a model reads about `List()` is written, and the lowering the modules
// share.
//
// C# has no way to give eleven methods one doc comment except `<inheritdoc cref="…"/>`, so this is
// the declaration the eleven inherit from — the same shape the C++ arm's `detail::api_object_list`
// has, and for the same reason: the words are written once, and a module whose directory drifted
// from the other ten is not a thing that can happen.
//
// It carries `///` rather than `//` deliberately, and it is the one declaration in `Gg.Internal`
// that does: the reflector reads this text as the `meta` section's documentation, resolving the
// eleven `<inheritdoc>`s to it and asserting they all land here.

using System.Collections.Generic;

namespace Gg.Internal;

// The directory every module carries.
internal static class ModuleDirectory
{
    /// <summary>List the functions this module offers, each with a one-line summary.</summary>
    /// <remarks>
    /// Only the functions this run actually bound are returned, so the directory never names a call
    /// a program cannot make. One function's full signature, argument descriptions and types are
    /// opened as a view with <c>Views.OpenDocsView</c>.
    /// </remarks>
    /// <param name="declaring">The module class whose directory to read — always <c>typeof(Self)</c>.</param>
    /// <returns>the functions this module really bound, each with its one-line summary.</returns>
    // The module is named by its own type rather than by a string. `Gg.Files` written out at eleven
    // call sites is eleven chances to hand a model another module's directory: the host filters on
    // the path, so a copy-pasted one resolves to a real module and returns the wrong functions. A
    // `typeof` cannot be misspelled, and `Signatures.cs` holds each call site to naming the class it
    // sits in.
    internal static IReadOnlyList<FunctionSummary> List(System.Type declaring)
    {
        var module = declaring.FullName!;
        Native.ListFunctions(module, out var names, out var summaries);
        var functions = new FunctionSummary[names.Length];
        for (var index = 0; index < names.Length; index++)
        {
            functions[index] = new FunctionSummary(names[index], summaries[index]);
        }
        return functions;
    }
}
