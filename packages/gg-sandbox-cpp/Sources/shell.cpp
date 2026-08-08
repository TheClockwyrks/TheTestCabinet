// The **shell** a model's C++ program runs inside: what the sandbox world's two exports do, and
// how the program's own `main` is reached.
//
// It is compiled **once**, at build time, into the `shell.o` gg carries inside its own binary —
// not per turn, because nothing in it is a function of the model's program. What links it to that
// program is one symbol: `__main_void`, which is what clang lowers a wasm translation unit's
// `main` to, and which `wasm-ld` resolves at the link every turn runs.
//
// It is not the SDK. Nothing here is model-facing and nothing here is in a signature catalogue; a
// program written by a model will call the curated surface this arm's SDK step adds, which is
// compiled against the same `sandbox.h` this file is.

#include <cctype>
#include <cstdlib>
#include <exception>
#include <string>
#include <typeinfo>

#include "prelude.hpp"

// **The gg tool names this component can bind** — what `bound-tools` answers.
//
// **Empty, and it is an honest empty rather than a stub.** This arm has no SDK yet: nothing in a
// program's scope dispatches a gg tool by name, so there is no name to report. The drift gate that
// compares a registered arm's answer with gg's own `ALL_TOOL_NAMES` does not run against this arm,
// because this arm is not registered — and when the SDK lands, this function becomes what the
// Swift arm's is: a concatenation of each API object's own binding table, so that what the artifact
// reports and what the SDK declares are one statement rather than two that can disagree.
//
// A null pointer with a zero length is what the generated post-return is written for (it frees
// nothing when the length is zero), so this is the shape of "no names" rather than an allocation of
// none.
extern "C" void exports_sandbox_bound_tools(sandbox_list_string_t *ret) {
  ret->ptr = nullptr;
  ret->len = 0;
}

// **What an uncaught exception is reported as**, and the reason this shell has a `catch` in it at
// all.
//
// Under `-fwasm-exceptions` an exception that escapes `main` does not reach `std::terminate`: it
// unwinds out of the module and becomes a **host-visible wasm exception**, which wasmtime reports as
// `thrown Wasm exception` — no type, no `what()`, nothing. That was measured, and it is the opposite
// of what a C++ programmer expects, where the runtime prints
// `terminating due to uncaught exception of type …` on its way out.
//
// So gg catches. The `try` is around the **call** to the model's `main`, not inside it, so it
// changes nothing about what the program is: every `try`/`catch` the model wrote still runs first,
// and this only sees what nothing else wanted. What it buys is the exception's own type and its
// `what()`, reported over `feedback.report-error` as a located-nowhere program error — which is what
// the Rust arm's panic hook buys that arm, reached a different way.
//
// **`OTHER` and no code**, deliberately. This is the substrate: nothing in a program's scope raises
// a gg `tool-error` yet, because there is no SDK — the generated bindings hand a failure back as a
// return value. When the SDK lands it will throw a `ToolError` carrying the wire's own `error-code`,
// and *this* is the function that has to start reading it, because the host classifies a turn from
// that code rather than from the kind.
//
// **No location**, honestly. C++ has no portable way to ask a caught exception where it was thrown,
// and the frames are gone by the time this runs. A model reads what failed and not where — the same
// trade the Swift arm's uncaught throw makes, and the reason an arm that catches what it expects
// gets a better answer than one that does not.
//
// **The type name is demangled here, by hand**, and the hand-written part is the point. `typeid`
// hands back the Itanium ABI's mangled spelling — `St13runtime_error`, `N9inventory8TooSmallE` — and
// a model reading `uncaught St13runtime_error` has been shown a compiler's internal notation for a
// class it wrote. `__cxa_demangle` would fix that and would link libc++abi's whole demangler into
// **every artifact this arm ever produces**, to pretty-print one line of one failing turn.
//
// What is decoded is the subset an exception type is spelled in and nothing else: a length-prefixed
// source name, `St` for `std::`, and `N … E` for a nested one. A template argument list, a
// substitution or anything else this does not know is handed back **unaltered** rather than guessed
// at — a wrong name would be worse than a mangled one, because a mangled one is at least obviously
// a spelling rather than a lie.
static std::string demangled(const char *mangled) {
  const std::string name(mangled == nullptr ? "" : mangled);
  std::size_t at = 0;
  bool nested = false;
  if (name.compare(0, 1, "N") == 0) {
    nested = true;
    at = 1;
  }
  std::string out;
  if (name.compare(at, 2, "St") == 0) {
    out = "std::";
    at += 2;
  }
  while (at < name.size()) {
    if (nested && name[at] == 'E' && at + 1 == name.size()) break;
    std::size_t digits = at;
    while (digits < name.size() && std::isdigit((unsigned char)name[digits])) digits++;
    if (digits == at) return name;  // Not a length: a notation this does not know.
    const std::size_t length = (std::size_t)std::stoul(name.substr(at, digits - at));
    if (digits + length > name.size()) return name;
    if (!out.empty() && out.compare(out.size() - 2, 2, "::") != 0) out += "::";
    out += name.substr(digits, length);
    at = digits + length;
  }
  return out.empty() ? name : out;
}

static void report_uncaught(const char *kind, const char *what) {
  std::string message = std::string("uncaught ") + kind;
  if (what != nullptr && *what != '\0') {
    message += ": ";
    message += what;
  }
  test_cabinet_gg_feedback_program_error_t error;
  error.kind = TEST_CABINET_GG_FEEDBACK_ERROR_KIND_OTHER;
  error.code.is_some = false;
  error.location.is_some = false;
  sandbox_string_set(&error.message, message.c_str());
  test_cabinet_gg_feedback_report_error(&error);
}

// **Evaluate one program** — the sandbox world's `run`.
//
// Every parameter is ignored, and on this arm that is a property of the strategy rather than an
// omission. `program` is empty because the program is not source that crossed the membrane: it was
// compiled INTO this component, and this component exists only for that one program. `modules`,
// `tools`, `ending` and `library` describe what the run offers, and what a program may reach is
// decided at COMPILE time on an arm like this one — by which SDK the entry file was built against —
// with the host checking every call regardless, because a guest that links its SDK as a library has
// no name to withhold.
//
// One failure shape does NOT come through here, and it does not need to: a failed libc++
// **hardening** check — `v[10]`, `.front()` on an empty container — traps rather than throwing, so
// this function cannot stand in front of it, and it carries libc++'s own sentence AND the model's
// own line out of the artifact's debug information instead. What is left after that and the `catch`
// below is undefined behaviour, which says nothing anywhere.
extern "C" void exports_sandbox_run(sandbox_string_t *program,
                                    sandbox_list_code_module_t *modules,
                                    sandbox_list_string_t *tools,
                                    sandbox_ending_kind_t ending, bool library) {
  (void)program;
  (void)modules;
  (void)tools;
  (void)ending;
  (void)library;
  try {
    // The value `main` returned is deliberately discarded. A program's return value is not a channel
    // on this membrane — everything a program has to say it says over `feedback` — so a non-zero
    // `return 1` is not an error gg invents a band for, exactly as a top-level `return` on the
    // ECMAScript arms is not.
    (void)__main_void();
  } catch (const std::exception &failure) {
    // `typeid` rather than a fixed string, so a model reading the report sees the class it actually
    // threw — its own `struct TooSmall : std::runtime_error` rather than `std::exception`. The name
    // is the ABI's mangled one; it is left as it is rather than demangled here, because
    // `__cxa_demangle` pulls the whole demangler into every artifact this arm ever produces to
    // pretty-print one line of one failing turn.
    report_uncaught(demangled(typeid(failure).name()).c_str(), failure.what());
  } catch (...) {
    // C++ lets a program throw anything at all, and models do — `throw "a string literal"` and
    // `throw 42` are both legal. There is nothing to ask such a value, so what is reported is that
    // it happened, which is still more than `thrown Wasm exception`.
    report_uncaught("exception that is not a std::exception", nullptr);
  }
}
