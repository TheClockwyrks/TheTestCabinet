// Where the one paragraph a model reads about `List()` is written, and the lowering the twelve
// objects share.
//
// C# has no way to give twelve methods one doc comment except `<inheritdoc cref="…"/>`, so this is
// the declaration the twelve inherit from — the same shape the C++ arm's `detail::api_object_list`
// has, and for the same reason: the words are written once, and an object whose directory drifted
// from the other eleven is not a thing that can happen.
//
// It carries `///` rather than `//` deliberately, and it is the one declaration in `Gg.Internal`
// that does: the reflector reads this text as the `meta` section's documentation, resolving the
// twelve `<inheritdoc>`s to it and asserting they all land here.

using System.Collections.Generic;

namespace Gg.Internal;

// The directory every API object carries.
internal static class ObjectDirectory
{
    /// <summary>List the functions available on this API object, each with a one-line summary.</summary>
    /// <remarks>
    /// Only the functions this run actually bound are returned, so the directory never names a call
    /// your program cannot make. Open a view of one function's full signature, argument descriptions
    /// and types with <c>view.OpenDocsView</c>.
    /// </remarks>
    /// <returns>the functions this object really bound, each with its one-line summary.</returns>
    internal static IReadOnlyList<FunctionSummary> List(string obj)
    {
        Native.ListFunctions(obj, out var names, out var summaries);
        var functions = new FunctionSummary[names.Length];
        for (var index = 0; index < names.Length; index++)
        {
            functions[index] = new FunctionSummary(names[index], summaries[index]);
        }
        return functions;
    }
}
