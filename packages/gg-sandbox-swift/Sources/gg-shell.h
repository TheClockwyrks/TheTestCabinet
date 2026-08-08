// The bridging header gg compiles every Swift program against.
//
// Swift has no `wit-bindgen` generator and does not need one: it imports C natively, so the
// canonical ABI is generated once as C (`sandbox.h`/`sandbox.c`, from `crates/gg/wit`) and
// reached from Swift through this header. `swiftc -import-objc-header` puts everything below
// into the program's scope with no import line of its own — which is what lets a model's reply
// be compiled VERBATIM, with no prologue and no line offset.
//
// It exists as a file of its own, rather than as `sandbox.h` alone, for one declaration:

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
