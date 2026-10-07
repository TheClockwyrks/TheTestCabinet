// The **shell** a model's Swift program runs inside: what the sandbox world's two exports do,
// and how the program's own top-level code is reached.
//
// It is compiled ahead of time by `build.sh` into `shell.o` as a module of its own, and every
// turn links that object beside the model's `main.swift`. The model's own module holds its
// reply and the code modules in its scope and nothing else, which is what makes a reply
// compiled **verbatim**, with no wrapper line and no line offset, carry the model's own
// coordinates in every diagnostic and every located trap.
//
// It reaches the model's top-level code the way anything reaches a C symbol: `__main_argc_argv`
// is what Swift lowers a top-level file into on this target, declared by the clang module
// below and resolved by the linker.
//
// Both imports below are FILE-scoped, which is the whole point of them. A Swift `import` puts
// names in the file that wrote it and in no other file of the module, so nothing here reaches
// the model's own `main.swift`: a reply that calls gg writes its own `import gg`, and nothing
// gg carries is in scope in a reply that wrote no line at all.
//
// The two `@_cdecl` functions below are `public`, and this file is a MODULE of its own, compiled
// ahead of time by `build.sh` into `shell.o` and only linked per turn. Both halves are needed and
// neither is optional: an access level is module-wide where an `import` is file-scoped, so
// `public` or `internal` in the model's own module would put a name the model was never told
// about into the model's file, and anything narrower than `public` gives the `@_cdecl` symbol
// internal linkage, which the linker then drops and the world's `run` export goes undefined.
//
// It is not the SDK. Nothing here is model-facing and nothing here is in the signature
// catalogue; a program written by a model calls the curated surface in `Sources/SDK/`, which
// is compiled ahead of time into the `gg` module imported below.

/// The SDK, for [`ggBoundOperations`](ggBoundOperations) alone — this file dispatches nothing
/// else.
///
/// A separate Swift module from the program's is also what makes the SDK **shadowable**: a
/// program that declares its own `files`, its own `DirEntry` or its own `log` wins over gg's
/// rather than colliding with it, which a single-module SDK compiled beside the reply could not
/// do, since two declarations of one name in one module is a redeclaration error.
import gg

/// The canonical ABI, as the clang module `Sources/module.modulemap` declares — the generated
/// `sandbox_*` records, `malloc` and `free`, and the model program's own entry-point symbol.
///
/// A module import rather than `swiftc -import-objc-header`, which is what this used to be. A
/// bridging header is MODULE-scoped: it put gg's wire, the C allocator and `__main_argc_argv`
/// into the model's `main.swift` with no line the model wrote. This import reaches them here and
/// nowhere else.
import GgShell

/// The gg tool names this component can bind — what `bound-operations` answers.
///
/// It is **derived from the SDK's own binding table**, object by object: each API object states
/// the tools it dispatches beside the functions that dispatch them, and `gg.boundOperationNames()`
/// concatenates them. gg's drift gate compares the artifact's answer with its own
/// `ALL_TOOL_NAMES`, so what that gate really checks here is that the SDK's declarations and
/// gg's vocabulary have not drifted apart — which a hand-written list in this file could not
/// have told it, because a hand-written list is a third statement that agrees with neither.
///
/// Both allocations are `malloc`'s, and that is load-bearing rather than incidental: the
/// generated post-return frees what this returns with `free`, element by element and then the
/// array — so Swift's own allocator would be a mismatched pair on the one path that runs after
/// every single turn.
@_cdecl("exports_sandbox_bound_operations")
public func ggBoundOperations(_ ret: UnsafeMutablePointer<sandbox_list_string_t>) {
    let names = gg.boundOperationNames()
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
/// `modules`, `operations`, `ending` and `library` describe what the run offers, and what a program
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
    _ operations: UnsafeMutablePointer<sandbox_list_string_t>?,
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
