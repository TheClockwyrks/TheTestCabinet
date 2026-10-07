// The **context** module: the calls whose effect is on the conversation rather than on the
// workspace.
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

/// Reclaim room in the context window.
///
/// These are the calls whose effect is on the conversation rather than on the workspace.
///
/// <ggmodule>context</ggmodule>
namespace context {

/// What a reclaim actually freed from the live context window.
struct reclaim_report {
  /// Context items dropped from the live window.
  std::uint32_t items{};
  /// Approximately how many tokens that freed.
  std::uint32_t reclaimed_tokens{};
  /// The workspace paths whose views were evicted; empty for an archive.
  std::vector<std::string> paths;
  /// The prose summary of what was reclaimed.
  std::string detail;
};

/// Who said an archived message.
enum class message_role {
  /// The system prompt.
  system,
  /// A turn's input: a result, a view, or an operator's instruction.
  user,
  /// A model turn's own output.
  assistant,
  /// A tool result, on a session that made tool calls rather than writing programs.
  tool,
};

/// One archived message that matched a search.
struct archive_hit {
  /// The archived message's sequence number.
  std::uint32_t seq{};
  /// Who said it.
  context::message_role role{};
  /// The message text.
  std::string text;
};

/// What a search of the archive found.
struct archive_search {
  /// Whether nothing has been archived yet, so there was nothing to search.
  ///
  /// Distinct from a search that ran and matched nothing.
  bool archive_empty{};
  /// The matches, most recent first, at most 8.
  std::vector<context::archive_hit> hits;
};

/// An inclusive span of turn numbers.
///
/// Both ends are included, so `{.from = 4, .to = 19}` is turns 4 through 19.
struct turn_range {
  /// The first turn in the span.
  std::uint32_t from{};
  /// The last turn in the span, included.
  std::uint32_t to{};
};

/// Drop the contents of files that were read out of the context window.
///
/// The files on disk are untouched: this forgets what was read, not what exists.
///
/// <ggop>context.evict_file_view</ggop>
///
/// \param path The file whose views to drop; empty drops every file view this session holds.
/// \returns what the reclaim actually freed.
/// \throws gg::core::api_error `invalid_argument` for a path that is given but empty; leaving it out
///   altogether is how every file view is dropped.
context::reclaim_report evict_file_view(std::optional<std::string_view> path = std::nullopt);

/// Move whole turns out of the context window, keeping their results searchable.
///
/// Every result carries a header with its turn number and roughly what holding it costs. Both ends
/// of a span are included, so `{{4, 19}}` archives turns 4 through 19. A model turn's own messages
/// in an archived turn are dropped; the results are kept and stay searchable.
///
/// <ggop>context.archive_thread</ggop>
///
/// \param ranges The inclusive spans of turn numbers to move out of the window. They may overlap.
/// \returns what the archive actually freed.
/// \throws gg::core::api_error `invalid_argument` for a span whose ends are not turn numbers.
context::reclaim_report archive_thread(std::vector<context::turn_range> ranges);

/// Search archived history for a case-insensitive substring, most recent first, up to 8 hits.
///
/// <ggop>context.search_archive</ggop>
///
/// \param query The substring to look for. Matching is case-insensitive.
/// \returns whether anything is archived at all, and the matches.
/// \throws gg::core::api_error `invalid_argument` for an empty query.
context::archive_search search_archive(std::string_view query);

/// Compact the context window: the detailed thread is dropped and restarted from `summary`.
///
/// Each path in `files` is read afresh into the restarted window, and this session's skills,
/// memories and task list are kept as they are. gg asks for this call when the window is full, and
/// refuses every other call until it arrives.
///
/// It does not stop the program: the request is registered and the rewrite happens once the program
/// has ended. Everything not in the summary and not in `files` is gone afterwards.
///
/// <ggop>context.compact</ggop>
///
/// \param summary What the restarted window opens with. Everything not in it and not re-read from
///   `files` is gone.
/// \param files The paths to read afresh into the restarted window. An empty vector reads nothing
///   back.
/// \throws gg::core::api_error `invalid_argument` for a blank summary. This is the one call gg does
///   not refuse while a compaction is in flight, since nothing else can clear the window.
void compact(std::string_view summary, std::vector<std::string> files);

}  // namespace context

}  // namespace gg
