#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "../api.hpp"
#include "../types.hpp"

namespace gg {

/// fetch a program you already ran, and hand a patched copy back to be run
///
/// Under responses as code a reply is a whole program, so a one-character mistake in a sixty-line
/// program costs the sixty lines again. The library makes the fix proportional to the mistake:
/// fetch what ran, patch it with ordinary string work, hand it back.
///
/// ```cpp
/// auto source = programs::get();
/// source.replace(source.find("fs::read_fil("), 13, "fs::read_file(");
/// programs::rerun(source);
/// ```
namespace programs {

/// \copydoc gg::detail::api_object_list
std::vector<function_summary> list();

/// The programs you have already run this session, oldest first — each with the turn it ran on,
/// how big it was, and whether it ran to its end.
///
/// It lists shapes, not sources: fetch the one you want with `programs::get`. The list survives a
/// compaction, so it is also how you find a program whose text has left your context window. It is
/// empty — never an error — for a session that has run nothing yet.
///
/// \returns one summary per program you have run, oldest first.
std::vector<program_summary> history();

/// The exact source of one program you ran. With no argument, your most recent one.
///
/// This is the first half of fixing a program without rewriting it: get what ran, patch it with
/// ordinary string work, and hand the result to `rerun`. What comes back is the program that
/// **executed** — so when a turn's program was itself handed over by `programs::rerun`, you get
/// the program that ran, not the few lines that asked for it, and fetch-patch-run composes turn
/// after turn.
///
/// \param turn The turn whose program to fetch, as `history` reports it; leave it out to fetch
///   your most recent one.
/// \returns that program's exact source.
/// \throws tool_error `not_found`, naming the turns that are held, for a turn that ran no program
///   or one old enough that the library has dropped it.
std::string get(std::optional<std::uint32_t> turn = std::nullopt);

/// Hand gg a program to run in place of this one. Your program finishes, then gg compiles and runs
/// `source` as this turn's program.
///
/// Use it with `get` to fix a program without re-emitting it. Nothing is undone: every call your
/// program already made stands, and the program that runs next sees the world your program left
/// behind — so hand over BEFORE doing work you do not want done twice.
///
/// The first call stands, because a silently replaced program is a change you cannot see. If your
/// program then fails, the hand-over is cancelled along with everything else the failed program
/// decided, and you get an ordinary error turn instead. Chains are bounded: hand over once per
/// turn, and write the fixed program to do the work.
///
/// \param source The program to run in place of this one, as C++. It may not be blank, and it must
///   define `main`.
/// \throws tool_error `refused` for a second hand-over in one turn, and `invalid_argument` for a
///   blank source.
void rerun(std::string_view source);

}  // namespace programs

}  // namespace gg
