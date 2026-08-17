// The **memories** module: what survives a compaction.
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

/// Keep durable memories that survive context compaction.
///
/// A run picks one of three memory strategies and binds only that strategy's functions, so what
/// this module offers is the honest answer to what memory can do in a given run. The scratchpad
/// keeps every memory in the context window; the two file-shaped strategies keep the contents
/// outside it, one behind an index that is always in context and one behind a search.
///
/// Every mutation hands back the budget after it, so a program decides whether to write another
/// memory by reading numbers rather than by parsing a sentence about them.
///
/// <ggmodule>memories</ggmodule>
namespace memories {

/// How much of the run's durable-memory budget is used, after the call that returned it.
///
/// Every maximum is optional, because each limit can be turned off and a run's memory strategy
/// applies only some of them: an empty one means nothing bounds that axis, which is worth checking
/// before subtracting.
struct memory_usage {
  /// Memories currently held.
  std::uint32_t count{};
  /// The most memories this run allows, where it limits the count.
  std::optional<std::uint32_t> max_count;
  /// Characters of body currently held, across all memories.
  std::uint32_t total_chars{};
  /// The most characters of body this run allows in total, where it limits the aggregate.
  std::optional<std::uint32_t> max_total_chars;
  /// Characters the memory index occupies, under a run that keeps one.
  std::optional<std::uint32_t> index_chars;
  /// The most characters the index may occupy, where it is limited.
  std::optional<std::uint32_t> max_index_chars;
};

/// One memory a search matched, and the numbers it was ranked by.
struct memory_hit {
  /// The memory's slug, which is what a read takes.
  std::string name;
  /// Its description, or `""` when it was created without one.
  std::string description;
  /// How many distinct keywords of the query it matched — the primary ranking.
  std::uint32_t matched{};
  /// How many times those keywords occur in it — the tiebreak.
  std::uint32_t occurrences{};
  /// A short window of the memory around its first match.
  std::string excerpt;

  /// Read this memory's full contents, which is the only thing that brings them into context.
  ///
  /// <ggop-alias>memories.read_memory</ggop-alias>
  ///
  /// \returns the memory's full contents.
  /// \throws gg::core::api_error `not_found` when the memory has since been deleted.
  std::string read() const;
};

/// The two code halves every write of a memory accepts and may leave out.
///
/// Neither is context: they cost no window, are never shown back, and count against no body limit.
struct memory_options {
  /// A C++ translation unit whose declarations are bound at `lib::<name>` in every later program.
  std::optional<std::string> code;
  /// A program gg runs the first time the memory comes into use.
  ///
  /// Whatever it shows arrives on the next turn.
  std::optional<std::string> on_use;
};

/// Record a durable memory that survives context compaction, and hand back the memory budget.
///
/// A memory may also carry code: `options.code` is a C++ translation unit whose declarations are
/// bound at `lib::<name>` in every later program, so a helper written correctly once is never
/// written again, and `options.on_use` is a program gg runs the first time the memory comes into
/// use. Neither costs any context window.
///
/// <ggop>memories.write_memory</ggop>
///
/// \param name The memory's slug: letters, digits, `-`, `_` and `.`. Every other memory call takes
///   it, and no two memories may share one.
/// \param description One line saying what the memory holds. Where the run keeps an index, this is
///   the memory's line in it.
/// \param body The memory's contents.
/// \param options The code halves, which may be left out.
/// \returns how much of the memory budget is now used.
/// \throws gg::core::api_error `conflict` on a duplicate name, and `limit_exceeded` when the body
///   would breach the run's caps.
memories::memory_usage write_memory(std::string_view name, std::string_view description,
                                    std::string_view body, memories::memory_options options = {});

/// Replace an existing memory's description and body, keyed on its slug.
///
/// Its code and on-use program are replaced too, so leaving them out of `options` clears the ones
/// the memory had.
///
/// <ggop>memories.update_memory</ggop>
///
/// \param name The slug of the memory to replace.
/// \param description The one-line description to replace the old one with.
/// \param body The contents to replace the old ones with.
/// \param options The code halves. Leaving one out clears the one the memory had.
/// \returns how much of the memory budget is now used.
/// \throws gg::core::api_error `not_found` when no memory has that name.
memories::memory_usage update_memory(std::string_view name, std::string_view description,
                                     std::string_view body,
                                     memories::memory_options options = {});

/// Record a new memory whose contents stay out of the context window until they are read.
///
/// This is the file-shaped strategies' write: the description is what the index carries, and it is
/// required where the run keeps one, because it is all that is seen of the memory until it is
/// read.
///
/// <ggop>memories.create_memory</ggop>
///
/// \param name The memory's slug: letters, digits, `-`, `_` and `.`.
/// \param description One line saying what the memory holds, which is its line in the index.
/// \param body The memory's initial contents, which stay out of the context window until they are
///   read.
/// \param options The code halves, which load on that first read.
/// \returns how much of the memory budget is now used.
/// \throws gg::core::api_error `conflict` on a duplicate slug, and `limit_exceeded` when the contents
///   or the index entry would breach a limit.
memories::memory_usage create_memory(std::string_view name, std::string_view description,
                                     std::string_view body,
                                     memories::memory_options options = {});

/// Read one memory's full contents by slug, which is the only thing that brings them into context.
///
/// A memory carrying code loads it on this read: the reply names the `lib::<key>` it is bound at,
/// and it stays bound for the rest of the session.
///
/// <ggop>memories.read_memory</ggop>
///
/// \param name The memory's slug.
/// \returns the memory's full contents.
/// \throws gg::core::api_error `not_found` when no memory has that slug.
std::string read_memory(std::string_view name);

/// Revise a memory in place, replacing the one exact occurrence of `search` with `replace`.
///
/// Appending is quoting the last line and replacing it with itself plus what is being added.
///
/// <ggop>memories.edit_memory</ggop>
///
/// \param name The slug of the memory to revise.
/// \param search The exact text to find in its contents. It must appear exactly once.
/// \param replace The text to put in its place.
/// \returns how much of the memory budget is now used.
/// \throws gg::core::api_error `not_found` when the text does not appear, `conflict` when it appears
///   more than once, `limit_exceeded` when the result would be too long, and `invalid_argument`
///   when the edit would leave the memory empty.
memories::memory_usage edit_memory(std::string_view name, std::string_view search,
                                   std::string_view replace);

/// Find the memories mentioning any of `keywords`, best first.
///
/// Plain case-insensitive substring matching over each memory's slug, description and contents,
/// ranked by how many distinct keywords a memory mentions and then by how often. Several specific
/// words rank better than one sentence, and a search that matches nothing is an empty vector
/// rather than a failure.
///
/// <ggop>memories.search_memories</ggop>
///
/// \param keywords The words to look for. Several specific words rank better than one sentence.
/// \returns the memories that matched, best first.
/// \throws gg::core::api_error `invalid_argument` when every keyword is empty.
std::vector<memories::memory_hit> search_memories(std::vector<std::string> keywords);

/// Evict a memory by slug, freeing room in the budget.
///
/// <ggop>memories.delete_memory</ggop>
///
/// \param name The memory's slug.
/// \returns how much of the memory budget is left in use.
/// \throws gg::core::api_error `not_found` when no memory has that name.
memories::memory_usage delete_memory(std::string_view name);

}  // namespace memories

}  // namespace gg
