// **The standard library every C++ program gg compiles is compiled against**, and the header this
// arm precompiles once per machine.
//
// A model's reply is compiled verbatim as `main.cpp` and this file is put in front of it with
// clang's `-include-pch`, so the reply opens with the C++ standard library already declared. It is
// the one file in this arm that is *both* a compile input and a performance decision, and the two
// are the same decision:
//
//   * A model writes `#include <vector>` without thinking, and it should work — so the reply is
//     never edited and an ordinary `#include` is simply a second, redundant read of a header the
//     preamble already saw. clang de-duplicates it against the PCH for nothing.
//   * Parsing this set costs the best part of a second every time a C++ program is compiled, and
//     reading a precompiled copy back costs tens of milliseconds. Measured on this repository's dev
//     container, aarch64, best of five: a small program is 836 ms without the PCH and 90 ms with it;
//     the ranges/format/map program in `cpp.compile.rs`'s table is 1581 ms without and 952 ms with.
//     That is the single largest reducer available to this arm and the reason the header is "always
//     full" rather than tailored per program — tailoring it would key the PCH on the model's reply,
//     which is a new PCH per turn and the whole saving gone.
//
// WHAT IS IN IT: THE STANDARD LIBRARY, AND NOTHING ELSE. **gg's own surface is deliberately not
// here**, and that is the [invariant](https://docs.testcabinet.ai/gg/responses-as-code/invariants/)
// rather than an omission: every SDK name a program writes is reached through an import that program
// wrote, so `gg::files::read_file` is undeclared until the reply writes `#include <gg/files.hpp>`.
// The SDK is still *available* — its headers are on the include path and its bodies are in the
// `sdk.o` every artifact links, which is packaging — and what it is not is in scope. Measured, best
// of five on the same machine: carrying the SDK here saved 33 ms of a 952 ms turn, and cost the arm
// the one line that says where a call came from.
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
// route the workspace has, stated once here and reaching a model only as an absence from the set
// this arm's catalogue declares, which gg quotes back on a compile failure rather than in the
// system prompt: a program that reached for it reads the set beside the diagnostic that made it
// relevant.
//
// WHAT THIS SET IS NOT: AN ALLOWLIST. This file decides what is put IN FRONT of a program, not
// what a program may reach. The whole of libc++ is on clang's default include path, so a reply
// that writes `#include <thread>` or `#include <iostream>` gets exactly that header and compiles.
// Measured, not assumed: a `std::thread` program compiles, links and throws `system_error: thread
// constructor failed: Not supported` at run time. Making the list an allowlist would mean
// `-nostdinc++` and an explicit include tree, which buys a refusal in place of a run-time
// exception a model can read — so what gg does instead is TELL the model the truth: the set is
// reflected into this arm's catalogue and quoted back on a compile failure, where the mistake it
// prevents is the one the compiler just detected. `cpp.surface.test.rs` asserts both directions —
// that every header on the list is reachable, and that one off it is reachable too.

#pragma once

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
// The exception hierarchy a `throw` and a `catch` are written in, and the base gg's own
// `gg::core::api_error` derives from once a program has included the header declaring it.
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
