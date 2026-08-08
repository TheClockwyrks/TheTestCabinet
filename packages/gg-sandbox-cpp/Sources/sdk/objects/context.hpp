#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "../api.hpp"
#include "../types.hpp"

namespace gg {

/// manage your own context window
///
/// These are the only calls whose effect is on the conversation rather than on the workspace. They
/// are worth making from a program precisely because a program can decide *when* to: read a set of
/// files, extract what matters, then evict the views in the same turn.
namespace context {

/// \copydoc gg::detail::api_object_list
std::vector<function_summary> list();

/// Drop the contents of files you have read out of your context window, freeing the tokens they
/// occupy, and report what that reclaimed.
///
/// The files on disk are untouched — this forgets what you read, not what exists.
///
/// \param path The file whose views to drop; leave it out to drop every file view you hold.
/// \returns what the reclaim actually freed.
reclaim_report evict_file_view(std::optional<std::string_view> path = std::nullopt);

/// Move whole turns out of your context window and report what that reclaimed.
///
/// Every result you are given carries a header with its turn number and roughly what holding it
/// costs, so name the turns worth dropping. Both ends of a span are included, so
/// `context::archive_thread({{4, 19}})` archives turns 4 through 19. Your own messages in an
/// archived turn are dropped; the results are kept and stay searchable with `search_archive`.
///
/// \param ranges The inclusive spans of turn numbers to move out of your window. They may overlap.
/// \returns what the archive actually freed.
/// \throws tool_error `invalid_argument` for a span whose ends are not turn numbers.
reclaim_report archive_thread(std::vector<turn_range> ranges);

/// Search archived history for a case-insensitive substring, most recent first, up to 8 hits.
///
/// Check `archive_empty` before reading `hits`: it distinguishes "nothing has been archived yet"
/// from "the search ran and matched nothing", so you do not archive again believing the first
/// archive failed.
///
/// \param query The substring to look for. Matching is case-insensitive.
/// \returns whether anything is archived at all, and the matches.
archive_search search_archive(std::string_view query);

/// Compact your context window: the detailed thread is dropped and restarted from `summary`, plus
/// a fresh read of each path in `files`.
///
/// Your skills, memories and task list are kept as they are. You are asked to call this when your
/// window is full, and every other call is refused until you do.
///
/// It does NOT stop your program: it registers the request and returns, and the rewrite happens
/// once your program has ended. Everything not in your summary and not in `files` is gone, so
/// write the summary for your future self and name the files you will actually need in hand.
///
/// \param summary What your restarted window opens with. Write it for your future self: everything
///   not in it and not re-read from `files` is gone.
/// \param files The paths to read afresh into the restarted window. An empty vector reads nothing
///   back.
/// \throws tool_error `refused` when a compaction is already in flight and this call is not the
///   one it asked for.
void compact(std::string_view summary, std::vector<std::string> files);

}  // namespace context

}  // namespace gg
