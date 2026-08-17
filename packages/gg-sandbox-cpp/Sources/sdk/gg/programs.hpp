// The **programs** module: the library of what this session has already run.
//
// This file is model-facing: everything a `///` says here is reflected into the signature catalogue
// and reaches a model. `//` comments are for whoever maintains it.

#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "core.hpp"

namespace gg {

/// Fetch a program that already ran, and hand a patched copy back to be run.
///
/// Under responses as code a reply is a whole program, so a one-character mistake in a sixty-line
/// program costs the sixty lines again. The library makes the fix proportional to the mistake:
/// fetch what ran, patch it with ordinary string work, hand it back.
///
/// ```cpp
/// auto source = gg::programs::get();
/// source.replace(source.find("gg::files::read_fil("), 20, "gg::files::read_file(");
/// gg::programs::rerun(source);
/// ```
///
/// <ggmodule>programs</ggmodule>
namespace programs {

/// One program that has already run this session, as the history lists it.
///
/// It describes the program's shape rather than its source: a directory that inlined every program
/// would put the whole session back in the context window, which is the one thing the library
/// exists to avoid.
struct program_summary {
  /// The turn it ran on, which is what fetching its source takes.
  std::uint32_t turn{};
  /// How many lines of source it was.
  std::uint32_t lines{};
  /// How many characters of source it was.
  std::uint32_t chars{};
  /// Whether it ran to its end, with no uncaught failure and no sandbox ceiling stopping it.
  bool ok{};
  /// The error it ended with, when it did not run to its end.
  std::optional<std::string> error;

  /// Fetch the exact source of this program.
  ///
  /// <ggop-alias>programs.get</ggop-alias>
  ///
  /// \returns that program's exact source.
  /// \throws gg::core::tool_error `not_found` when the library has since dropped that turn.
  std::string source() const;
};

/// List the programs this session has already run, oldest first.
///
/// It lists shapes rather than sources, so fetching the one worth having is a second call. The
/// list survives a compaction, which is what makes it the way to find a program whose text has
/// left the context window, and it is empty rather than an error for a session that has run
/// nothing yet.
///
/// <ggop>programs.history</ggop>
///
/// \returns one summary per program this session has run, oldest first.
/// \throws gg::core::tool_error `unavailable` when this agent keeps no program library at all — a
///   different fact from a library that is empty, and the reason this can fail.
std::vector<programs::program_summary> history();

/// Fetch the exact source of one program that ran; with no argument, the most recent one.
///
/// This is the first half of fixing a program without rewriting it: fetch what ran, patch it with
/// ordinary string work, and hand the result back to be run. What comes back is the program that
/// executed — so where a turn's program was itself handed over, this is the program that ran
/// rather than the few lines that asked for it, and fetch-patch-run composes turn after turn.
///
/// <ggop>programs.get</ggop>
///
/// \param turn The turn whose program to fetch, as the history reports it; empty fetches the most
///   recent one.
/// \returns that program's exact source.
/// \throws gg::core::tool_error `not_found`, naming the turns that are held, for a turn that ran no
///   program or one old enough that the library has dropped it.
std::string get(std::optional<std::uint32_t> turn = std::nullopt);

/// Hand gg a program to run in place of this one, once this one has finished.
///
/// Nothing is undone: every call this program already made stands, and the program that runs next
/// sees the world this one left behind — so the hand-over belongs before work that should not
/// happen twice. The first call in a turn stands, because a silently replaced program is a change
/// nobody can see, and a program that then fails cancels the hand-over along with everything else
/// it decided.
///
/// <ggop>programs.rerun</ggop>
///
/// \param source The program to run in place of this one, as C++. It may not be blank, and it must
///   define `main`.
/// \throws gg::core::tool_error `refused` for a second hand-over in one turn, and `invalid_argument`
///   for a blank source.
void rerun(std::string_view source);

}  // namespace programs

}  // namespace gg
