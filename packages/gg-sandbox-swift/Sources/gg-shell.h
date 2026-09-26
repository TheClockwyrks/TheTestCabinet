// The header gg's shell reaches the canonical ABI through, as the clang module
// `Sources/module.modulemap` declares it.
//
// Swift has no `wit-bindgen` generator and does not need one: it imports C natively, so the
// canonical ABI is generated once as C (`sandbox.h`/`sandbox.c`, from `crates/gg/wit`) and
// reached from Swift through this header. It is a clang MODULE rather than a bridging header,
// and the difference is which files see it: `swiftc -import-objc-header` puts a header into every
// file of the Swift module compiled with it, the model's own reply included, while `import
// GgShell` puts it into the one file that wrote the line. Nothing below is model-facing.
//
// It exists as a file of its own, rather than as `sandbox.h` alone, for two things `sandbox.h`
// does not carry. The first is `malloc`/`free`: what an export RETURNS across the canonical ABI
// is freed by the generated post-return with `free`, so the shell has to allocate with the
// matching `malloc` rather than with Swift's own allocator. The second is the declaration below.

#include <stdlib.h>

#include "sandbox.h"

// **The entry point of the model's own program**, and the one symbol in this arm that is not
// generated from the WIT.
//
// A model's reply is compiled as `main.swift` — an ordinary Swift top-level file, which is the
// only shape in which `import`, `extension`, `protocol` and a bare statement are all legal at
// once. Swift lowers a top-level file's statements into the target's C entry point, and on wasm
// that is clang's two-argument form rather than `main`. gg's shell (`shell.swift`) is a second
// file of the SAME module, so it can name this symbol and call it from the `run` export the
// sandbox world declares.
//
// Declaring it here rather than with `@_silgen_name` is deliberate: `@_silgen_name` gives a
// Swift-convention function and the compiler rejects the call ("declared as @convention(c) but
// used as @convention(thin)"). A C declaration is what makes the calling convention agree.
int __main_argc_argv(int argc, char **argv);
