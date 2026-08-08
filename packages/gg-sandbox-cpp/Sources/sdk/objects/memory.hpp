#pragma once

#include <string>
#include <string_view>
#include <vector>

#include "../api.hpp"
#include "../options.hpp"
#include "../types.hpp"

namespace gg {

/// durable memories that survive context compaction
///
/// A run picks one of three memory strategies, and only that strategy's functions are bound — so
/// `memory::list()` is the honest answer to "what can I do with memory here?". The scratchpad
/// keeps every memory in the context window (`write_memory`/`update_memory`); the two file-shaped
/// strategies keep the contents *outside* it (`create_memory`/`read_memory`/`edit_memory`), one
/// behind an index that is always in context and one behind `search_memories`. `delete_memory` is
/// bound under all three.
///
/// Every mutation hands back the budget after it, so a program can decide whether to write another
/// memory by reading numbers rather than by parsing a sentence about them.
namespace memory {

/// \copydoc gg::detail::api_object_list
std::vector<function_summary> list();

/// Record a durable memory that survives context compaction, and hand back how much of the memory
/// budget is now used.
///
/// A memory may also carry **code**. `options.code` is a C++ translation unit whose declarations
/// are bound at `lib::<name>` in every later program you write, so a helper you get right once you
/// never write again; `options.on_use` is a program gg runs the first time the memory comes into
/// use, whose views reach you on your next turn. Neither is context — they cost you no window, are
/// never shown back to you, and count against no body limit — and both are bounded on their own.
///
/// \param name The memory's slug: letters, digits, `-`, `_` and `.`. It is what every other memory
///   call takes, and no two memories may share one.
/// \param description A one-line description of what the memory holds. Where the run keeps a
///   memory index this is the memory's line in it, and so all you see of the memory until you read
///   it.
/// \param body The memory's contents.
/// \param options The code halves you may leave out.
/// \returns how much of the memory budget is now used.
/// \throws tool_error `conflict` on a duplicate name, and `limit_exceeded` when the body would
///   breach the run's caps — revise or delete a memory rather than accruing more.
memory_usage write_memory(std::string_view name, std::string_view description,
                          std::string_view body, memory_options options = {});

/// Replace an existing memory's description and body, keyed on its `name`, and hand back the
/// memory budget.
///
/// Its code and on-use program are replaced too — leaving them out of `options` clears them.
///
/// \param name The slug of the memory to replace.
/// \param description The one-line description to replace the old one with.
/// \param body The contents to replace the old ones with.
/// \param options The code halves. Leaving one out clears the one the memory had.
/// \returns how much of the memory budget is now used.
/// \throws tool_error `not_found` when no memory has that name.
memory_usage update_memory(std::string_view name, std::string_view description,
                           std::string_view body, memory_options options = {});

/// Record a new memory whose contents are kept OUT of your context window until you read them, and
/// hand back the memory budget.
///
/// Give it a slug, a one-line description — required where the run keeps an index, since that is
/// the memory's line in it — and the initial contents.
///
/// \param name The memory's slug: letters, digits, `-`, `_` and `.`.
/// \param description A one-line description of what the memory holds, which is its line in the
///   index.
/// \param body The memory's initial contents, which stay out of your context window until you read
///   them.
/// \param options The code halves you may leave out. They load on that first read.
/// \returns how much of the memory budget is now used.
/// \throws tool_error `conflict` on a duplicate slug, and `limit_exceeded` when the contents, or
///   the index entry, would breach a limit.
memory_usage create_memory(std::string_view name, std::string_view description,
                           std::string_view body, memory_options options = {});

/// Read one memory's full contents, by slug — the only thing that brings them into your context.
///
/// If the memory carries code, reading it also loads that code: the reply names the `lib::<key>`
/// it is bound at, and it stays bound for the rest of your session.
///
/// \param name The memory's slug.
/// \returns the memory's full contents.
/// \throws tool_error `not_found` when no memory has that slug.
std::string read_memory(std::string_view name);

/// Revise a memory in place by replacing the one exact occurrence of `search` with `replace`, and
/// hand back the memory budget.
///
/// Append by quoting the last line and replacing it with itself plus what you are adding.
///
/// \param name The slug of the memory to revise.
/// \param search The exact text to find in its contents. It must appear exactly once.
/// \param replace The text to put in its place.
/// \returns how much of the memory budget is now used.
/// \throws tool_error `not_found` when the text does not appear, `conflict` when it appears more
///   than once, `limit_exceeded` when the result would be too long, and `invalid_argument` when
///   the edit would leave the memory empty — delete it instead.
memory_usage edit_memory(std::string_view name, std::string_view search, std::string_view replace);

/// Find the memories mentioning any of `keywords`, best first.
///
/// Plain case-insensitive substring matching over each memory's slug, description and contents,
/// ranked by how many of your keywords a memory mentions and then by how often. Pass several
/// specific words rather than one sentence, then `memory::read_memory` the hits worth having in
/// full. A search that matches nothing is an empty vector.
///
/// \param keywords The words to look for. Several specific words rank better than one sentence,
///   because a memory is ranked by how many of them it mentions.
/// \returns the memories that matched, best first.
/// \throws tool_error `invalid_argument` when every keyword is empty.
std::vector<memory_hit> search_memories(std::vector<std::string> keywords);

/// Evict a memory by name, freeing room in the budget, and hand back what is left in use.
///
/// \param name The memory's slug.
/// \returns how much of the memory budget is left in use.
/// \throws tool_error `not_found` when no memory has that name.
memory_usage delete_memory(std::string_view name);

}  // namespace memory

}  // namespace gg
