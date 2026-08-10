// The two public functions that belong to no capability module: the operator log, and the binding
// table gg's drift gate asks the artifact for.
//
// Neither is in the signature catalogue, and that is deliberate rather than an omission — the
// catalogue describes the capability modules, and these belong to none of them.

/// Write one line to the run's log.
///
/// It is this arm's `console.log`: a channel the model that wrote the program cannot read back,
/// capped by the host. Showing a value to the model is `views.openText`, which is a view —
/// attributable, closable, and in the next prompt.
///
/// `print` works too and goes to the same place — this arm's guest has a real WASI stdout — but it
/// is the standard library's function rather than gg's. Write `gg.log(…)` where a program of its own
/// has defined a `log`.
public func log(_ line: String) {
    withScratch { scratch in
        var lowered = scratch.string(line)
        test_cabinet_gg_feedback_log(&lowered)
    }
}

/// Every gg tool this SDK binds, gathered from the modules that dispatch them.
///
/// It is what gg's shell answers `bound-tools` with, and gg's drift gate compares that answer with
/// its own `ALL_TOOL_NAMES`. The value of asking the artifact rather than reading a list is that the
/// answer is assembled from the *same* declarations the functions are: each module states the tools
/// it dispatches beside the functions that dispatch them, so a tool that gained a function without
/// gaining an entry — or the reverse — is a failing gate rather than a silent difference between
/// what a model may call and what gg thinks it may call.
///
/// Not model-facing and not catalogued: a program has the functions themselves.
public func boundToolNames() -> [String] {
    files.ggTools + shell.ggTools + board.ggTools + tasks.ggTools + memories.ggTools
        + context.ggTools + delegation.ggTools + skills.ggTools
}
