// The `list` every capability module carries, and the one call underneath all eleven of them.
//
// WHY A PROTOCOL EXTENSION RATHER THAN ELEVEN DECLARATIONS. `list` is model-facing, and its
// paragraph is the same paragraph on every module — so eleven copies of it would be eleven copies of
// one piece of documentation with nothing keeping them equal. Rust expands one macro into each
// module and C# resolves eleven `<inheritdoc>`s to one summary; Swift's own answer to "one
// implementation across many namespaces" is a protocol extension, so that is what this is. There is
// one declaration, one paragraph, and the reflector reads the `meta` section off it rather than off
// any module.
//
// The protocol is `public` because Swift requires a protocol to be at least as visible as what
// conforms to it, and nothing in a program has any reason to write it. It is not in the catalogue,
// so no model is shown it.

/// The directory every capability module carries.
///
/// Conforming is what gives a module its `list`. `core` deliberately does not conform: it offers no
/// capability, so it has nothing to list, and the reflector refuses a catalogue in which it does.
public protocol ModuleDirectory {
    /// gg's own path for this module, which is what its directory is looked up by.
    ///
    /// It is the same string the catalogue records as the module's `path`, and the reflector holds
    /// the two to being equal — the host filters the directory on it, so a module answering under a
    /// neighbour's path would hand a program the wrong functions rather than fail.
    static var ggModule: String { get }
}

extension ModuleDirectory {
    /// List the functions this module offers, each with a one-line summary.
    ///
    /// Only the functions this run actually bound are returned, so the directory never names a call
    /// the program cannot make. One function's full signature, argument descriptions and types are
    /// opened as a view with `views.openDocsView`.
    ///
    /// - Returns: the functions this module really bound, each with its one-line summary.
    public static func list() -> [core.FunctionSummary] {
        directory(of: ggModule)
    }
}

/// The directory of one module, as the host answers it.
///
/// Not model-facing: the `list` above is the declaration a program calls and the one the catalogue
/// is reflected from. This is the single call underneath all eleven of them.
func directory(of module: String) -> [core.FunctionSummary] {
    withScratch { scratch in
        var name = scratch.string(module)
        var ret = test_cabinet_gg_docs_list_function_summary_t()
        test_cabinet_gg_docs_list_functions(&name, &ret)
        let summaries = lift(ret.ptr, ret.len) { core.FunctionSummary(wire: $0) }
        test_cabinet_gg_docs_list_function_summary_free(&ret)
        return summaries
    }
}
