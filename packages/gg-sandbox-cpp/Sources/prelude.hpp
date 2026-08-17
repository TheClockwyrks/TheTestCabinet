// **THE LIBRARY SET THIS ARM MAKES AVAILABLE**, declared header by header — and PUT IN FRONT OF
// NOTHING.
//
// This file is a declaration, not a compile input. A model's reply is compiled verbatim as
// `main.cpp` with no header of gg's in front of it, so `std::vector` is undeclared until the reply
// writes `#include <vector>`, exactly as `gg::files::read_file` is undeclared until it writes
// `#include <gg/files.hpp>`. That is the
// [invariant](https://docs.testcabinet.ai/gg/responses-as-code/invariants/): everything a program
// uses, it imports, its language's own standard library included.
//
// WHO READS THIS FILE. Three readers, and they are the whole of its job:
//
//   * `build.sh` reads the `#include` lines below into `cpp.toolchain.json`'s `headers` list;
//   * `tools/signatures.py` reads the `// == Heading ==` groups into the catalogue's `libraries`
//     section, which is what a compile failure quotes back to a model group by group;
//   * a reader of this arm, for what the set is and why.
//
// One declaration, several readers — the rule every other arm's library manifest follows, and the
// reason nothing here is restated anywhere else.
//
// WHAT USED TO HAPPEN TO IT. This set was precompiled once per machine and named to every compile
// with `-include-pch`, which is what made a small program 90 ms rather than 836 ms — measured on
// this repository's dev container, aarch64, best of five; the ranges/format/map program in
// `cpp.compile.rs`'s table was 952 ms against 1581 ms. It was also the one place in gg where a name
// reached a model's program through a line the model had not written, so it is gone and the arm pays
// the parse of whatever the program itself included.
//
// WHAT IS IN IT: THE STANDARD LIBRARY, AND NOTHING ELSE. gg's own surface is not on this list
// because it is not a library a C++ author reaches for: it is declared by the thirteen headers the
// catalogue states as its modules' own include lines, and a program writes one of those.
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
// them is none of those things. It is not a compiler problem — a program that writes
// `#include <filesystem>` compiles and links on this target, measured — so this is the seam's
// answer about which route the workspace has, stated once here and reaching a model only as an
// absence from the set
// this arm's catalogue declares, which gg quotes back on a compile failure rather than in the
// system prompt: a program that reached for it reads the set beside the diagnostic that made it
// relevant.
//
// WHAT THIS SET IS NOT: AN ALLOWLIST. This file declares what a program is TOLD it may reach, not
// what it CAN reach. The whole of libc++ is on clang's default include path, so a reply
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
