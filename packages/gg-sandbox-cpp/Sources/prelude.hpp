// **The prelude every C++ program gg compiles is compiled against**, and the header this arm
// precompiles once per machine.
//
// A model's reply is compiled verbatim as `main.cpp` and this file is put in front of it with
// clang's `-include-pch`, so the reply opens with gg's whole wire surface and the standard
// library already declared. It is the one file in this arm that is *both* a compile input and a
// performance decision, and the two are the same decision:
//
//   * A model writes `#include <vector>` without thinking, and it should work — so the reply is
//     never edited and an ordinary `#include` is simply a second, redundant read of a header the
//     preamble already saw. clang de-duplicates it against the PCH for nothing.
//   * Parsing this set costs **~850 ms** every time a C++ program is compiled, and precompiling
//     it costs ~40 ms. Measured on this repository's dev container: a small program is 883–1110 ms
//     without the PCH and **82–95 ms** with it. That is the single largest reducer available to
//     this arm and the reason the header is "always full" rather than tailored per program —
//     tailoring it would key the PCH on the model's reply, which is a new PCH per turn and the
//     whole saving gone.
//
// WHAT IT IS NOT. It is not the SDK. Nothing below is model-facing prose, nothing here is in a
// signature catalogue, and `sandbox.h` is the raw canonical-ABI surface `wit-bindgen` generated
// from `crates/gg/wit` — a C header of `sandbox_string_t` and out-parameters, which is what the
// arm's own SDK will be written *against* rather than what a model will be shown.
//
// WHAT DECIDES THE SET BELOW. Two rules, and both are the seam's rather than this file's.
// Commonly used libraries are available by default in every arm, and for C++ that library is the
// standard one — so the set is "what a C++ author reaches for", read in the order the standard
// groups them. And nothing that is a JSON document, a network client or a thread is here: this
// sandbox has no concurrency at all (`<thread>`, `<future>`, `<atomic>` compile against a target
// with no threads and would be a capability a model is told it has and does not), and neither an
// argument nor a result on this membrane is a document a program assembles.

#pragma once

// The generated WIT surface, as C. `extern "C"` rather than a shim, because that is the whole of
// what C++ needs to call C — and generating the lowering once from the WIT is what keeps this arm
// from carrying a second implementation of a specification that drifts on its own schedule.
extern "C" {
#include "sandbox.h"
}

// The one declaration that is not generated: the entry point of the model's own program.
//
// clang lowers a wasm translation unit's `main` to `__main_void` when it is `int main()` and to
// `__main_argc_argv` when it takes arguments — and wasi-libc supplies a `__main_void` that calls
// the latter, so this single name reaches both spellings. gg's shell (`shell.cpp`) is a separate
// translation unit that calls it from the sandbox world's `run` export.
//
// It is worth knowing why the shell cannot simply call `main`: in C++ `main` may not be named or
// called by a program at all ([basic.start.main]), and clang enforces it. `__main_void` is the
// symbol the language lowers it to, so naming that is naming the same function without writing
// the one call the standard forbids.
extern "C" int __main_void(void);

// --- The standard library ---------------------------------------------------------------------
// Grouped as the standard groups them, so the list reads as a claim about what a program may use
// rather than as an alphabetised pile. Every one of these is in libc++ 22 for this target and is
// exercised by the arm's own tests.

// Language support and concepts.
#include <compare>
#include <concepts>
#include <cstddef>
#include <cstdint>
#include <initializer_list>
#include <limits>
#include <source_location>
#include <type_traits>
#include <typeinfo>
#include <utility>
#include <version>

// Diagnostics: the exception hierarchy a `throw` and a `catch` are written in.
#include <cassert>
#include <exception>
#include <stdexcept>
#include <system_error>

// Memory and general utilities.
#include <bit>
#include <functional>
#include <memory>
#include <optional>
#include <tuple>
#include <variant>

// Errors as values, beside errors as exceptions. Both are C++; which one this arm's SDK uses is
// the SDK's decision, and a program is free to use either in its own code regardless.
#include <expected>

// Strings, text and formatting.
#include <charconv>
#include <cstring>
#include <format>
#include <regex>
#include <string>
#include <string_view>

// Containers.
#include <array>
#include <bitset>
#include <deque>
#include <forward_list>
#include <list>
#include <map>
#include <queue>
#include <set>
#include <span>
#include <stack>
#include <unordered_map>
#include <unordered_set>
#include <vector>

// Iterators, ranges and algorithms.
#include <algorithm>
#include <iterator>
#include <numeric>
#include <ranges>

// Numerics and time.
#include <chrono>
#include <cmath>
#include <complex>
#include <numbers>
#include <random>
#include <ratio>

// Streams. `<iostream>` is deliberately absent and `<sstream>` is deliberately here: a program's
// stdout is not a channel a model's turn is read from — `gg.log` is — and pulling `<iostream>` in
// would drag its static initialisation into every artifact for a stream nothing reads. Building
// a string is what a program actually wants.
#include <iomanip>
#include <sstream>
