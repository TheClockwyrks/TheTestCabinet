// The **shell** a model's C++ program runs inside: what the sandbox world's two exports do, and
// how the program's own `main` is reached.
//
// It is compiled **once**, at build time, into the `shell.o` gg carries inside its own binary —
// not per turn, because nothing in it is a function of the model's program. What links it to that
// program is one symbol: `__main_void`, which is what clang lowers a wasm translation unit's
// `main` to, and which `wasm-ld` resolves at the link every turn runs.
//
// It is not the SDK. Nothing here is model-facing and nothing here is in a signature catalogue; a
// program written by a model calls the curated surface in `sdk/`, which is compiled against the
// same `sandbox.h` this file is.

#include <cctype>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <string>
#include <typeinfo>
#include <vector>

extern "C" {
#include "sandbox.h"
}

#include "sdk/gg/core.hpp"
#include "sdk/runtime.hpp"

// The entry point of the model's own program.
//
// clang lowers a wasm translation unit's `main` to `__main_void` when it is `int main()` and to
// `__main_argc_argv` when it takes arguments — and wasi-libc supplies a `__main_void` that calls
// the latter, so this single name reaches both spellings. It is declared here rather than taken
// from the prelude because this file is compiled ONCE, at build time, and has no business reading
// the header a model's program is precompiled against.
//
// It is worth knowing why the shell cannot simply call `main`: in C++ `main` may not be named or
// called by a program at all ([basic.start.main]), and clang enforces it. `__main_void` is the
// symbol the language lowers it to, so naming that is naming the same function without writing
// the one call the standard forbids.
extern "C" int __main_void(void);

// **The gg tool names this component can bind** — what `bound-operations` answers.
//
// It is `gg::bound_operation_names()`, which is assembled from the SDK's own per-module tables: each
// capability module states the tools it dispatches in the same translation unit as the functions
// that dispatch them, so a tool that gained a function without gaining an entry — or the reverse — is a
// failing gate rather than a silent difference between what a model may call and what gg thinks it
// may call.
//
// `std::malloc` rather than `new`, because the generated post-return frees this list and every
// string in it with `free()`. A zero-length list keeps a null pointer, which is the shape the
// post-return is written for.
extern "C" void exports_sandbox_bound_operations(sandbox_list_string_t *ret) {
  const std::vector<std::string> names = gg::bound_operation_names();
  ret->len = names.size();
  ret->ptr = nullptr;
  if (names.empty()) return;
  ret->ptr = (sandbox_string_t *)std::malloc(names.size() * sizeof(sandbox_string_t));
  for (std::size_t at = 0; at < names.size(); at++) {
    ret->ptr[at].len = names[at].size();
    ret->ptr[at].ptr = (uint8_t *)std::malloc(names[at].size());
    std::memcpy(ret->ptr[at].ptr, names[at].data(), names[at].size());
  }
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
// **The code is read off a `gg::core::api_error`**, which is the whole reason that exception carries
// one. The host classifies a turn from the code rather than from the kind, so a failed
// `files::read_file` that nothing caught arrives as `not-found` and is recorded as the same class of
// failure it would be on every other arm. Anything else a program threw has no gg code at all and
// is reported without one, which is honest: a `std::out_of_range` a model's own `.at()` raised is
// not a gg failure.
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
//
// One component IS dropped, and only one: libc++'s **inline namespace**, which is what the `__2` in
// `NSt3__212system_errorE` is. Inline means it is not part of the name anybody wrote — a model that
// caught `std::system_error` wrote `std::system_error` — so reporting `std::__2::system_error`
// would show a model an implementation detail of the standard library it is standing on and invite
// it to write the name back. Dropped only directly under `std::`, where it can be nothing else.
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
    const std::string component = name.substr(digits, length);
    at = digits + length;
    // libc++'s inline namespace, directly under `std::` and nowhere else.
    if (out == "std::" && component.size() > 2 && component.compare(0, 2, "__") == 0 &&
        component.find_first_not_of("0123456789", 2) == std::string::npos) {
      continue;
    }
    if (!out.empty() && out.compare(out.size() - 2, 2, "::") != 0) out += "::";
    out += component;
  }
  return out.empty() ? name : out;
}

static void report_uncaught(const char *kind, const char *what,
                            const test_cabinet_gg_types_error_code_t *code) {
  std::string message = std::string("uncaught ") + kind;
  if (what != nullptr && *what != '\0') {
    message += ": ";
    message += what;
  }
  test_cabinet_gg_feedback_program_error_t error;
  error.kind = code == nullptr ? TEST_CABINET_GG_FEEDBACK_ERROR_KIND_OTHER
                               : TEST_CABINET_GG_FEEDBACK_ERROR_KIND_API_FAILURE;
  error.code.is_some = code != nullptr;
  if (code != nullptr) error.code.val = *code;
  error.location.is_some = false;
  sandbox_string_set(&error.message, message.c_str());
  test_cabinet_gg_feedback_report_error(&error);
}

// **The status the program's own entry point returned**, reported with the number it chose.
//
// A separate report from `report_uncaught` above, because nothing was thrown and nothing was
// uncaught: the program ran to the end of `main` and ended by handing back a failure. It carries no
// gg error code for the same reason — the failure is the program's rather than a call's — and no
// location, because a returned status is not raised at a statement.
static void report_status(int status) {
  test_cabinet_gg_feedback_program_error_t error;
  error.kind = TEST_CABINET_GG_FEEDBACK_ERROR_KIND_OTHER;
  error.code.is_some = false;
  error.location.is_some = false;
  sandbox_string_set(&error.message,
                     ("the program's entry point returned " + std::to_string(status)).c_str());
  test_cabinet_gg_feedback_report_error(&error);
}

// The wire's code for a failure the SDK threw.
static test_cabinet_gg_types_error_code_t wire_code(gg::core::api_error_code code) {
  switch (code) {
    case gg::core::api_error_code::invalid_argument:
      return TEST_CABINET_GG_TYPES_ERROR_CODE_INVALID_ARGUMENT;
    case gg::core::api_error_code::not_found: return TEST_CABINET_GG_TYPES_ERROR_CODE_NOT_FOUND;
    case gg::core::api_error_code::conflict: return TEST_CABINET_GG_TYPES_ERROR_CODE_CONFLICT;
    case gg::core::api_error_code::refused: return TEST_CABINET_GG_TYPES_ERROR_CODE_REFUSED;
    case gg::core::api_error_code::unavailable: return TEST_CABINET_GG_TYPES_ERROR_CODE_UNAVAILABLE;
    case gg::core::api_error_code::limit_exceeded:
      return TEST_CABINET_GG_TYPES_ERROR_CODE_LIMIT_EXCEEDED;
    case gg::core::api_error_code::io_error: return TEST_CABINET_GG_TYPES_ERROR_CODE_IO_ERROR;
    case gg::core::api_error_code::other: return TEST_CABINET_GG_TYPES_ERROR_CODE_OTHER;
  }
  return TEST_CABINET_GG_TYPES_ERROR_CODE_OTHER;
}

// **Evaluate one program** — the sandbox world's `run`.
//
// Every parameter is ignored, and on this arm that is a property of the strategy rather than an
// omission. `program` is empty because the program is not source that crossed the membrane: it was
// compiled INTO this component, and this component exists only for that one program. `modules`,
// `operations`, `ending` and `library` describe what the run offers, and what a program may reach is
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
                                    sandbox_list_string_t *operations,
                                    sandbox_ending_kind_t ending, bool library) {
  (void)program;
  (void)modules;
  (void)operations;
  (void)ending;
  (void)library;
  try {
    // **The status `main` returned is read**, because it is the one way a C++ program reports a
    // failure without throwing and the one that walks past every `catch` there is. C++ gives an
    // entry point exactly one channel of its own and this is it, so a program that ended with
    // `return 3` is told gg read the 3 — where discarding it recorded the turn as a clean one and
    // told the model its program worked.
    //
    // Nothing is added about what to do instead: a program that returns a status meant to.
    const int status = __main_void();
    if (status != 0) {
      report_status(status);
    }
  } catch (const gg::core::api_error &failure) {
    // A gg call the program did not catch. `what()` is already gg's own sentence about it — the
    // call, the class and the guidance — so what is added here is only that nothing caught it, and
    // the CODE, which is what the host classifies the turn by.
    const test_cabinet_gg_types_error_code_t code = wire_code(failure.code());
    report_uncaught("gg::core::api_error", failure.what(), &code);
  } catch (const std::exception &failure) {
    // `typeid` rather than a fixed string, so a model reading the report sees the class it actually
    // threw — its own `struct TooSmall : std::runtime_error` rather than `std::exception`. What
    // `typeid` hands over is the ABI's mangled name, which `demangled()` above decodes BY HAND: the
    // hand-written part is the point, because `__cxa_demangle` would link libc++abi's whole
    // demangler into every artifact this arm ever produces to pretty-print one line of one failing
    // turn.
    report_uncaught(demangled(typeid(failure).name()).c_str(), failure.what(), nullptr);
  } catch (...) {
    // C++ lets a program throw anything at all, and models do — `throw "a string literal"` and
    // `throw 42` are both legal. There is nothing to ask such a value, so what is reported is that
    // it happened, which is still more than `thrown Wasm exception`.
    report_uncaught("exception that is not a std::exception", nullptr, nullptr);
  }
}
