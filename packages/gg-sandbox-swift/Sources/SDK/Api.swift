// The API objects themselves: what makes one, the `list` every one of them carries, and the two
// free functions that belong to none of them.

/// What every **API object** in gg's surface is.
///
/// An object is a caseless `enum` — Swift's own namespace — so `fs.readFile("src/main.swift")` is a
/// call on a namespace and nothing has to be constructed first. Conforming to this is what gives an
/// object its `list`, which is declared exactly once, below, and is therefore the same function with
/// the same documentation on all twelve.
///
/// It is `public` because Swift requires a protocol to be at least as visible as what conforms to
/// it. Nothing in a program has any reason to write it.
public protocol ApiObject {
    /// gg's own name for this object, which is what its directory is looked up by.
    static var ggObject: String { get }
}

extension ApiObject {
    /// List the functions available on this API object, each with a one-line summary.
    ///
    /// Only the functions this run actually bound are returned, so the directory never names a call
    /// your program cannot make. Open a view of one function's full signature, argument descriptions
    /// and types with `view.openDocsView`.
    public static func list() -> [FunctionSummary] {
        directory(of: ggObject)
    }
}

/// The directory of one API object, as the host answers it.
///
/// Not model-facing: the `list` above is the declaration a program calls and the one the catalogue
/// is reflected from. This is the single call underneath all twelve of them.
func directory(of object: String) -> [FunctionSummary] {
    withScratch { scratch in
        var name = scratch.string(object)
        var ret = test_cabinet_gg_docs_list_function_summary_t()
        test_cabinet_gg_docs_list_functions(&name, &ret)
        let summaries = lift(ret.ptr, ret.len) { FunctionSummary(wire: $0) }
        test_cabinet_gg_docs_list_function_summary_free(&ret)
        return summaries
    }
}

/// Write one line to the run's **operator** log.
///
/// It is this arm's `console.log`: the channel a program uses to say something to whoever is
/// watching the run, capped by the host and never shown back to the model. Showing something to
/// **yourself** is `view.openText`, which is a view — attributable, closable, and in your next
/// prompt.
///
/// It is deliberately **not** in the signature catalogue, on the same terms every other arm's
/// `console.log` is not: the catalogue describes the API objects, and this belongs to none of them.
///
/// `print` works too and goes to the same place — this arm's guest has a real WASI stdout — but it
/// is the standard library's function rather than gg's, and `gg.log` is the name that says where the
/// line goes. Write `gg.log(…)` where a program of your own has defined a `log`.
public func log(_ line: String) {
    withScratch { scratch in
        var lowered = scratch.string(line)
        test_cabinet_gg_feedback_log(&lowered)
    }
}

/// **Every gg tool this SDK binds**, gathered from the objects that dispatch them.
///
/// It is what gg's shell answers `bound-tools` with, and gg's drift gate compares that answer with
/// its own `ALL_TOOL_NAMES`. The value of asking the artifact rather than reading a list is that the
/// answer is assembled from the *same* declarations the functions are: each object states the tools
/// it dispatches beside the functions that dispatch them, so a tool that gained a function without
/// gaining an entry — or the reverse — is a failing gate rather than a silent difference between
/// what a model may call and what gg thinks it may call.
///
/// Not model-facing and not catalogued: a program has the functions themselves.
public func boundToolNames() -> [String] {
    fs.ggTools + system.ggTools + project.ggTools + tasks.ggTools + memory.ggTools
        + context.ggTools + agents.ggTools + skills.ggTools
}
