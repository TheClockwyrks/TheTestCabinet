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
// WHAT IS IN IT. Two things, and only two. The **SDK** — gg's own surface, hand-written in
// `sdk/`, whose `///` comments are the model-facing documentation this arm's signature catalogue
// is reflected out of — and the **standard library**, which is this arm's library set. What is
// deliberately NOT in it is the raw canonical ABI: `sandbox.h` is a C header of `sandbox_string_t`
// and out-parameters, it is what the SDK is written *against*, and a model never sees it.
//
// WHAT DECIDES THE SET BELOW. Two rules, and both are the seam's rather than this file's.
// Commonly used libraries are available by default in every arm, and for C++ that library is the
// standard one — so the set is "what a C++ author reaches for", read in the order the standard
// groups them. And nothing that is a JSON document, a network client or a thread is here: this
// sandbox has no concurrency at all, and neither an argument nor a result on this membrane is a
// document a program assembles.
//
// `<filesystem>` is off the set for the same reason the Rust arm keeps `std::fs` off its own: the
// workspace is reached through `gg::files` and `gg::shell`, which are gated, recorded in the run's
// events and able to put what they read in front of the model, and a directory walk done behind
// them is none of those things. It is not a compiler problem — `#include <filesystem>` beside this
// prelude compiles and links on this target, measured — so this is the seam's answer about which
// route the workspace has, stated once here and once to the model in
// `crates/gg/templates/system-code.cpp.hbs`.
//
// WHAT THIS SET IS NOT: AN ALLOWLIST. This file decides what is put IN FRONT of a program, not
// what a program may reach. The whole of libc++ is on clang's default include path, so a reply
// that writes `#include <thread>` or `#include <iostream>` gets exactly that header and compiles.
// Measured, not assumed: a `std::thread` program compiles, links and throws `system_error: thread
// constructor failed: Not supported` at run time. Making the list an allowlist would mean
// `-nostdinc++` and an explicit include tree, which buys a refusal in place of a run-time
// exception a model can read — so what gg does instead is TELL the model the truth, in
// `crates/gg/templates/system-code.cpp.hbs`, and `cpp.surface.test.rs` holds it to that.

#pragma once

// **gg's surface**, which is what a program is actually written against. It is declarations only —
// every body is in the `sdk.o` this arm links, compiled once at build time — so putting it in the
// precompiled header costs a program nothing and puts `files::read_file` in front of it with no
// `#include` line of gg's own.
#include "sdk/gg.hpp"

// What makes `files::read_file(…)` reachable without writing `gg::`.
//
// A using-directive rather than declaring the modules at global scope, and the reason is not a
// collision — measured against this arm's own pinned `clang++`, every one of the twelve module
// names compiles as a fresh `namespace` at global scope beside this prelude, `shell` and `core`
// included. It is that the modules have to live inside `gg` for the fully-qualified name a program
// writes and a search hit shows — `gg::files::read_file` — to be a real C++ path rather than a
// label, which is what makes two modules free to each declare a `close`. The using-directive is
// then what keeps the ordinary call site short.
//
// WHAT A PROGRAM DECLARING ITS OWN `files` GETS. Not shadowing. A using-directive makes gg's names
// visible *at* global scope rather than nested inside it, so a program's own global `namespace
// files { … }` — or the reflex `namespace files = std::filesystem;` — is a second candidate and an
// unqualified `files::` is *reference to 'files' is ambiguous*, with both candidates named at the
// model's own line. Measured, not read from a standard: the declaration itself is accepted, the
// unqualified use is the error, and either `::files::` or `gg::files::` resolves it. That is a
// compile error a model can read and fix in one line, and it is the only cost of the directive.
// Block scope is unaffected, so a local type or variable named after a module is simply the
// program's.
using namespace gg;

// --- The standard library -----------------------------------------------------------------
// **This arm's library set**, grouped as the standard groups them, so the list reads as a claim
// about what a program may use rather than as an alphabetised pile. Every one of these is in
// libc++ 22 for this target and is exercised by the arm's own tests.
//
// The `// == Heading ==` lines below are MACHINE-READABLE: `tools/signatures.py` reads this file
// and emits the catalogue's `libraries` section out of it, group by group, so what a model is told
// it may include is the file that decides what it may include — the same one declaration, two
// readers rule the manifest's `headers` list already follows.

// == Language support and concepts ==
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

// == Diagnostics ==
// The exception hierarchy a `throw` and a `catch` are written in — including gg's own
// `tool_error`, which is a `std::runtime_error`.
#include <cassert>
#include <exception>
#include <stdexcept>
#include <system_error>

// == Memory and general utilities ==
#include <bit>
#include <functional>
#include <memory>
#include <optional>
#include <tuple>
#include <variant>

// == Errors as values ==
// Beside errors as exceptions. gg's own SDK throws, because C++ is an exception language and
// `try` is the whole of the ceremony; a program is free to use `std::expected` in its own code
// regardless, and this is why it can.
#include <expected>

// == Strings, text and formatting ==
#include <charconv>
#include <cstring>
#include <format>
#include <regex>
#include <string>
#include <string_view>

// == Containers ==
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

// == Iterators, ranges and algorithms ==
#include <algorithm>
#include <iterator>
#include <numeric>
#include <ranges>

// == Numerics and time ==
#include <chrono>
#include <cmath>
#include <complex>
#include <numbers>
#include <random>
#include <ratio>

// == Streams ==
// `<iostream>` is deliberately absent and `<sstream>` is deliberately here: a program's stdout is
// not a channel a model's turn is read from — `gg::log` is — and pulling `<iostream>` in would
// drag its static initialisation into every artifact for a stream nothing reads. Building a
// string is what a program actually wants.
#include <iomanip>
#include <sstream>
