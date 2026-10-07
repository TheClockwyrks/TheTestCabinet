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
/// <ggmodule>programs</ggmodule>
namespace programs {

/// One program that has already run this session, as the history lists it.
///
/// It carries the program's shape rather than its source.
struct program_summary {
  /// The id its `submit_program` acknowledgement carried, which is what fetching its source takes.
  std::string id;
  /// The turn it ran on.
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
  /// \throws gg::core::api_error `not_found` when the library has since dropped that program.
  std::string source() const;
};

/// List the programs this session has already run, oldest first.
///
/// It lists shapes rather than sources. The list survives a compaction, and is empty rather than an
/// error for a session that has run nothing yet.
///
/// <ggop>programs.history</ggop>
///
/// \returns one summary per program this session has run, oldest first.
/// \throws gg::core::api_error `unavailable` when this run keeps no program library.
std::vector<programs::program_summary> history();

/// Fetch the exact source of one program that ran, by the id its acknowledgement carried.
///
/// What comes back is the program that executed, so where a submission handed a program over, this
/// is the program that ran rather than the lines that asked for it. A rerun keeps the id of the
/// submission it replaced.
///
/// <ggop>programs.get</ggop>
///
/// \param id The program's id, as its acknowledgement carried it and as the history reports it.
/// \returns that program's exact source.
/// \throws gg::core::api_error `not_found`, naming the ids that are held, for an id this session
///   was never issued or one whose program the library has since dropped.
std::string get(std::string_view id);

/// Hand gg a program to run in place of this one, once this one has finished.
///
/// It runs under this submission's id, so a later fetch of that id returns it. Nothing is undone:
/// every call this program already made stands, and the program that runs next sees the world this
/// one left behind. The first call in a turn stands, and a program that then fails cancels the
/// hand-over.
///
/// <ggop>programs.rerun</ggop>
///
/// \param source The program to run in place of this one, as C++. It may not be blank, and it must
///   define `main`.
/// \throws gg::core::api_error `refused` for a second hand-over from the same program, and `invalid_argument`
///   for a blank source.
void rerun(std::string_view source);

}  // namespace programs

}  // namespace gg
