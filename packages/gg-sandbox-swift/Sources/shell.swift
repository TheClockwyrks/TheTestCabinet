// The **shell** a model's Swift program runs inside: what the sandbox world's two exports do,
// and how the program's own top-level code is reached from one of them.
//
// It is compiled as a second file of the SAME module as the model's `main.swift`, once per
// turn, by `crates/gg/src/sandbox/language/swift.compile.rs`. Being in one module is what buys
// this arm its defining property: a model's reply is compiled **verbatim**, with no wrapper
// line, no `import` and no line offset, so every diagnostic and every located trap carries the
// model's own coordinates.
//
// It is not the SDK. Nothing here is model-facing and nothing here is in the signature
// catalogue; a program written by a model calls the curated surface, which is a later step.
// What is here is the plumbing that surface will be built on.

/// Call `body` with `text` lowered into the canonical ABI's string representation.
///
/// Scoped rather than returned, because `sandbox_string_set` does not copy: it points a
/// `sandbox_string_t` at bytes it does not own. Every import below lowers its arguments during
/// the call, so a pointer that lives exactly as long as the call is correct — and one that
/// outlived the closure would be a dangling read the first time a host function was slow.
@inline(__always)
func ggWithString<T>(_ text: String, _ body: (inout sandbox_string_t) -> T) -> T {
    text.withCString { bytes in
        var lowered = sandbox_string_t()
        sandbox_string_set(&lowered, bytes)
        return body(&lowered)
    }
}

/// Write one line to the run's **operator** log — this arm's `console.log`.
///
/// The `feedback` interface is the shim's private channel back to gg (`crates/gg/wit`), never
/// part of what a model is shown. It is here because gg's own substrate tests need a way for a
/// program to say something that crosses the membrane, and because the SDK's `log` will be
/// built on exactly this call.
func ggLog(_ line: String) {
    ggWithString(line) { test_cabinet_gg_feedback_log(&$0) }
}

/// The gg tool names this component can bind — what `bound-tools` answers.
///
/// **Empty, and that is this step's honest answer.** gg's drift gate asks a registered
/// language's artifact which tools it binds and compares the answer with gg's own
/// `ALL_TOOL_NAMES`; the answer has to come from the SDK's own binding table, object by object,
/// so that it is a second and independent statement of the same fact. This arm has no SDK yet
/// and therefore no such table, and a hand-written list here would be a *third* statement that
/// agreed with neither. The list arrives with the surface it is derived from.
@_cdecl("exports_sandbox_bound_tools")
public func ggBoundTools(_ ret: UnsafeMutablePointer<sandbox_list_string_t>) {
    ret.pointee.ptr = nil
    ret.pointee.len = 0
}

/// **Evaluate one program** — the sandbox world's `run`.
///
/// Every parameter is ignored, and on this arm that is a property of the strategy rather than
/// an omission. `program` is empty because the program is not source that crossed the membrane:
/// it was compiled INTO this component, and this component exists only for that one program.
/// `modules`, `tools`, `ending` and `library` describe what the run offers, and what a program
/// may reach is decided at COMPILE time on an arm like this one — by which SDK the entry file
/// was built against — with the host checking every call regardless, because a guest that links
/// its SDK as a library has no name to withhold.
///
/// A throw does not reach here. Swift's top-level code is not a `throws` context this shell can
/// wrap: an uncaught error, a `fatalError`, a force-unwrapped `nil`, an index out of range and
/// an arithmetic overflow all end in the runtime writing its own message to **stderr** and then
/// executing `unreachable`, which traps the store. gg captures that stderr and reports what the
/// program said about itself; see `swift.compile.rs` for what is located and what is not.
@_cdecl("exports_sandbox_run")
public func ggRun(
    _ program: UnsafeMutablePointer<sandbox_string_t>?,
    _ modules: UnsafeMutablePointer<sandbox_list_code_module_t>?,
    _ tools: UnsafeMutablePointer<sandbox_list_string_t>?,
    _ ending: sandbox_ending_kind_t,
    _ library: Bool
) {
    // An empty argument vector, because a component is not a command: it has no `argv` and
    // nothing above it ever set one. It is a real allocation rather than `nil` so that a
    // program reaching for `CommandLine.arguments` reads an empty list instead of a null
    // dereference.
    let argv = UnsafeMutablePointer<UnsafeMutablePointer<Int8>?>.allocate(capacity: 1)
    argv[0] = nil
    _ = __main_argc_argv(0, argv)
}
