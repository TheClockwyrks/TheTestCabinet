// **The four managed-to-native trampolines gg's bridge needs and the .NET class library does not.**
//
// # What this is, and why it is not optional
//
// Mono's interpreter cannot call a native function directly: it calls a *trampoline* that reads the
// interpreter's argument frame and calls through a C function pointer of the right type. There is
// one trampoline per **signature shape**, keyed by a cookie — `I` for an int or a pointer, `L` for a
// 64-bit integer, `D` for a double, `V` for nothing — so `int f(void*, double, void*, void*)` is
// `IIDIII`.
//
// Those trampolines are generated at build time by the runtime pack's own
// `ManagedToNativeGenerator`, which reflects them out of **the assemblies it is given**: the class
// library, whose `[DllImport]`s are the only native calls a stock .NET-on-wasm build ever makes.
// gg's bridge is not in that scan and cannot be — its declarations live in the model's own assembly,
// compiled per turn — so a bridge function whose shape the BCL happens never to use has no
// trampoline, and the interpreter aborts the whole guest with a Mono assertion the moment a program
// calls it.
//
// That is not a hypothetical: it is what `system.Shell` did. The generated table has no cookie with
// a `double` in any position but the first, because nothing in the class library takes one there.
//
// # Why four, and why they are written here rather than generated
//
// The bridge is *designed* to need almost none. Forty-four of its fifty functions already fit a
// shape the class library uses; two of those were made to fit by narrowing a `long` argument to an
// `int` where the value is a `u32` anyway, and two by handing a record's numbers back as one array
// rather than as an `out` parameter each — which the interpreter forces regardless, since it refuses
// to build a frame for an internal call of fourteen arguments at all. What is left is these, four of
// them simply wider than anything in the BCL:
//
// | Cookie | What needs it |
// | --- | --- |
// | `IIDIIII` | `Shell`, whose timeout is the surface's one `double` |
// | `IIIIIIIIIII` | `UpdateIssue` and `OpenFileView`, ten arguments each |
// | `IIIIIIIIIIIII` | `RecordMemory` and `SearchDocs`, twelve each |
// | `IIIIIIIIIIII` | `CreateIssue`, eleven |
//
// `SearchDocs` is the one of those five that arrives at twelve *after* the same array trick: a page
// of five-field hits plus a total and an offset is fifteen arguments written out, and folding the
// page's own two numbers into a sixth array is what brings it under the ceiling at all. It shares a
// cookie with the memory-recording calls rather than needing a fifth trampoline.
//
// # How they are installed
//
// `mono_wasm_install_interp_to_native_callback` is the runtime's own hook for exactly this, and the
// runtime pack's `runtime.c` installs the generated table through it at startup. This file installs
// a callback that consults gg's four first and **delegates everything else to that same generated
// table**, which it reaches by including the generated header here as well. Including it is what
// makes the fallback possible at all: the generated lookup is `static` to the translation unit it
// was written for, so there is nothing to chain to from outside one.

#include <string.h>

#include "bridge.h"

// The generated table, included for its lookup function. Every trampoline in it is `static` and most
// are unused here, which is the whole reason for the diagnostic: this file wants one symbol out of a
// five-hundred-line generated header.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wunused-function"
#include "wasm_m2n_invoke.g.h"
#pragma clang diagnostic pop

/// One 32-bit argument out of the interpreter's frame.
#define GG_I(index) mono_wasm_interp_method_args_get_iarg(margs, index)

/// One `double` argument.
///
/// **Floating-point arguments are counted separately from the rest**, which is the one thing about
/// this frame that is not obvious and the one that cost a debugging session: `iarg` and `larg` share
/// an index in which a 64-bit integer occupies two slots, while `darg` and `farg` have an index of
/// their own that starts at zero. So in `f(void*, double, void*, …)` the pointer after the double is
/// `GG_I(1)`, not `GG_I(3)` — reading it as `GG_I(3)` gets a timeout of NaN, which the host reads as
/// "no timeout given" and quietly substitutes its own default for.
#define GG_D(index) mono_wasm_interp_method_args_get_darg(margs, index)

/// `int f(void*, double, void*, void*, void*, void*)` — `system.Shell`.
static void gg_invoke_iidiiii(void *target_func, MonoInterpMethodArguments *margs) {
  typedef int (*T)(int, double, int, int, int, int);
  const int res = ((T)target_func)(GG_I(0), GG_D(0), GG_I(1), GG_I(2), GG_I(3), GG_I(4));
  *(int *)mono_wasm_interp_method_args_get_retval(margs) = res;
}

/// `int f(void* × 10)` — `project.UpdateIssue`, and `view.OpenFileView` since its line cut.
static void gg_invoke_i11(void *target_func, MonoInterpMethodArguments *margs) {
  typedef int (*T)(int, int, int, int, int, int, int, int, int, int);
  const int res = ((T)target_func)(GG_I(0), GG_I(1), GG_I(2), GG_I(3), GG_I(4), GG_I(5), GG_I(6),
                                   GG_I(7), GG_I(8), GG_I(9));
  *(int *)mono_wasm_interp_method_args_get_retval(margs) = res;
}

/// `int f(void* × 12)` — the three memory-recording calls, and the documentation search.
static void gg_invoke_i13(void *target_func, MonoInterpMethodArguments *margs) {
  typedef int (*T)(int, int, int, int, int, int, int, int, int, int, int, int);
  const int res = ((T)target_func)(GG_I(0), GG_I(1), GG_I(2), GG_I(3), GG_I(4), GG_I(5), GG_I(6),
                                   GG_I(7), GG_I(8), GG_I(9), GG_I(10), GG_I(11));
  *(int *)mono_wasm_interp_method_args_get_retval(margs) = res;
}

/// `int f(void* × 11)` — `project.CreateIssue`.
static void gg_invoke_i12(void *target_func, MonoInterpMethodArguments *margs) {
  typedef int (*T)(int, int, int, int, int, int, int, int, int, int, int);
  const int res = ((T)target_func)(GG_I(0), GG_I(1), GG_I(2), GG_I(3), GG_I(4), GG_I(5), GG_I(6),
                                   GG_I(7), GG_I(8), GG_I(9), GG_I(10));
  *(int *)mono_wasm_interp_method_args_get_retval(margs) = res;
}

/// gg's own four, by cookie.
static const InterpToNative gg_invokes[] = {
    {"IIDIIII", gg_invoke_iidiiii},
    {"IIIIIIIIIII", gg_invoke_i11},
    {"IIIIIIIIIIIII", gg_invoke_i13},
    {"IIIIIIIIIIII", gg_invoke_i12},
};

/// gg's four, then the generated table's — so nothing the class library needs is displaced.
static void *gg_interp_to_native(char *cookie) {
  for (size_t index = 0; index < sizeof gg_invokes / sizeof gg_invokes[0]; index++) {
    if (strcmp(cookie, gg_invokes[index].signature) == 0) {
      return gg_invokes[index].func;
    }
  }
  return mono_wasm_interp_to_native_callback(cookie);
}

void gg_install_trampolines(void) {
  mono_wasm_install_interp_to_native_callback(gg_interp_to_native);
}
