// The bridge between a managed C# program and gg's WIT world.
//
// `Sources/shell.c` owns the runtime and the program's transport; this owns the membrane. The two
// are separate translation units because they answer to different things: the shell answers to
// Mono's embedding API and would not change if gg's surface did, while everything here is a function
// of `crates/gg/wit/gg-sandbox.wit` and of the SDK in `src/Gg/`.

#ifndef GG_BRIDGE_H
#define GG_BRIDGE_H

#include <stddef.h>

// Register every gg function as a Mono internal call. Called once per component instance, after the
// runtime has started and before the program's entry point is reached.
void gg_bridge_register(void);

// The gg tool names a program can dispatch through this bridge — what the world's `bound-tools`
// answers, and what gg's own drift gate compares with `ALL_TOOL_NAMES`.
//
// It is one table beside the registrations rather than a second list somewhere else, so that what
// the artifact reports and what it actually binds cannot disagree.
void gg_bridge_tool_names(const char *const **names, size_t *count);

// Install the managed-to-native trampolines gg's own bridge needs and the class library does not —
// see `Sources/m2n.c`, which is where the four of them and the argument for each are written.
void gg_install_trampolines(void);

#endif
