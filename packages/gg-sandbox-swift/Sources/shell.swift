// The **shell** a model's Swift program runs inside: what the sandbox world's two exports do,
// how the SDK gets into the program's scope, and how the program's own top-level code is
// reached.
//
// It is compiled as a second file of the SAME module as the model's `main.swift`, once per
// turn, by `crates/gg/src/sandbox/language/swift.compile.rs`. Being in one module is what buys
// this arm its defining property: a model's reply is compiled **verbatim**, with no wrapper
// line, no `import` and no line offset, so every diagnostic and every located trap carries the
// model's own coordinates.
//
// It is not the SDK. Nothing here is model-facing and nothing here is in the signature
// catalogue; a program written by a model calls the curated surface in `Sources/SDK/`, which
// is compiled ahead of time into the `gg` module the line below re-exports.

/// **The one line that puts gg's surface in a model's scope**, and the reason a Swift reply
/// needs no import of its own.
///
/// `@_exported` rather than a plain `import`, and the difference is the whole arm. A Swift
/// `import` is FILE-scoped: written here it would put `fs` in scope in `shell.swift` and
/// nowhere else, and the model's `main.swift` — a second file of the same module — would
/// still fail with `cannot find 'fs' in scope`. `@_exported` re-exports the module through
/// this one, and a re-export is MODULE-scoped, so every file of the program's module sees it.
/// Measured both ways, because the alternative was making a model write `import gg` on line 1
/// and paying a line offset on every diagnostic and every located trap for the rest of the
/// arm's life.
///
/// It is also what makes the SDK **shadowable**. `gg` is a different module, so a program that
/// declares its own `fs`, its own `DirEntry` or its own `log` wins over this one rather than
/// colliding with it — which a single-module SDK compiled beside the reply could not do, since
/// two declarations of one name in one module is a redeclaration error.
///
/// The underscore says the attribute is not part of Swift's stable surface. It is what the
/// standard library's own overlays are built on, it has behaved this way since Swift 3, and
/// this arm pins one compiler release — so the risk it carries is bounded by the pin.
@_exported import gg

/// The gg tool names this component can bind — what `bound-tools` answers.
///
/// It is **derived from the SDK's own binding table**, object by object: each API object states
/// the tools it dispatches beside the functions that dispatch them, and `gg.boundToolNames()`
/// concatenates them. gg's drift gate compares the artifact's answer with its own
/// `ALL_TOOL_NAMES`, so what that gate really checks here is that the SDK's declarations and
/// gg's vocabulary have not drifted apart — which a hand-written list in this file could not
/// have told it, because a hand-written list is a third statement that agrees with neither.
///
/// Both allocations are `malloc`'s, and that is load-bearing rather than incidental: the
/// generated post-return frees what this returns with `free`, element by element and then the
/// array — so Swift's own allocator would be a mismatched pair on the one path that runs after
/// every single turn.
@_cdecl("exports_sandbox_bound_tools")
public func ggBoundTools(_ ret: UnsafeMutablePointer<sandbox_list_string_t>) {
    let names = gg.boundToolNames()
    let bytes = MemoryLayout<sandbox_string_t>.stride * max(names.count, 1)
    guard let items = malloc(bytes)?.bindMemory(to: sandbox_string_t.self, capacity: names.count)
    else {
        ret.pointee.ptr = nil
        ret.pointee.len = 0
        return
    }
    for (index, name) in names.enumerated() {
        name.withCString { sandbox_string_dup(&items[index], $0) }
    }
    ret.pointee.ptr = items
    ret.pointee.len = names.count
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
