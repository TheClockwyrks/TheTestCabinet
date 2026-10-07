// The **docs** module: how a program finds what it may call, and how it puts documentation away.
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

/// Find the modules, functions and types this run bound, and take documentation back out of context.
///
/// A search answers with one-line briefs, each carrying the fully-qualified name it is keyed by.
/// Searching is bound to every program whatever a run enables; closing is bought by a capability.
///
/// <ggmodule>docs</ggmodule>
namespace docs {

/// Which of the three kinds of entry a search hit documents.
enum class doc_kind {
  /// A module a program imports, and whose functions are the names inside it.
  module,
  /// A function a program calls.
  function,
  /// A type a function's signature names.
  type,
};

/// Everything one search runs under: the words to look for, the filters, and the page.
///
/// An aggregate filled in with designated initialisers:
/// `gg::docs::search({.query = "read", .modules = {"files"}, .limit = 5})`. Every field may be left
/// out and the fields given compose; `{}` is refused.
struct search_filters {
  /// The words to look for, matched as case-insensitive substrings.
  ///
  /// Several specific words rank an entry above one vague word. Empty searches on the filters
  /// alone.
  std::optional<std::string_view> query;
  /// The modules to look in, each by gg's id (`files`) or by this arm's path (`gg::files`).
  ///
  /// A union: naming several returns the entries of any of them, and an empty vector looks in all
  /// of them. Matching is exact and case-insensitive, and a hit's own `module` goes straight back
  /// in here.
  std::vector<std::string> modules;
  /// One type's own name (`file_read`), narrowing to it and to the functions that mention it.
  ///
  /// Every function whose signature takes or returns it, beside the type's own declaration.
  std::optional<std::string_view> type;
  /// Whether to return only modules, only functions or only types; empty returns every kind.
  std::optional<docs::doc_kind> kind;
  /// How many hits to skip, for paging through a total larger than one page.
  std::optional<std::uint32_t> offset;
  /// How many hits to return; empty takes the default page of 20, and the ceiling is 100.
  std::optional<std::uint32_t> limit;
};

/// One entry a search matched: enough to choose from, and no more.
struct doc_hit {
  /// The fully-qualified name it is keyed by, which is what opening and closing its view take.
  std::string key;
  /// Whether this is a module, a function or a type.
  docs::doc_kind kind{};
  /// The module it lives in: the one that publishes a function, or the one that declares a type.
  ///
  /// One module, always, and itself for a module. The `modules` filter takes it exactly as it
  /// reads here.
  std::string module;
  /// The name a program calls it by, the type's own name, or the module's own path.
  std::string name;
  /// Its one-line brief, and only that. The rest is what a documentation view holds.
  std::string summary;
};

/// One page of what a search matched, and the total behind it.
struct doc_search {
  /// How many entries matched before paging, so a capped page is legible rather than guessed at.
  std::uint32_t total{};
  /// The offset this page starts at, echoed back.
  std::uint32_t offset{};
  /// The page itself, best first.
  std::vector<docs::doc_hit> hits;
};

/// Search the bound modules, functions and types by keyword, by module, or both — best match first.
///
/// Matching is case-insensitive substring over names, signatures, briefs and detailed descriptions.
/// An entry whose own name matched outranks one that only mentions the word in a paragraph. Only
/// what this run bound is returned.
///
/// Every part of a search may be left out and the parts given compose. `modules` is a union —
/// naming several returns the entries of any of them — and `modules` with no query is those
/// modules' whole directory. Asking for nothing at all is refused.
///
/// The page is returned as a value, readable in the turn that asked for it, and is also opened as a
/// view under the selector `search results`, replaced by the next search rather than accumulating.
/// A hit carries a brief and no more.
///
/// <ggop>docs.search</ggop>
///
/// \param filters The words to look for, the filters they compose with, and the page to take. Any
///   field may be left out; all of them at once may not, which is why this argument has no default.
/// \returns the page that matched, best first, and how many matched behind it.
/// \throws gg::core::api_error `invalid_argument` when `filters` names neither a query nor anything
///   to narrow by, and when `limit` is `0`.
docs::doc_search search(docs::search_filters filters);

/// Take one documentation view out of the context window, by the key it was opened under.
///
/// The removal does not cascade: closing a function's view leaves the views of the types it named,
/// and closing a type's leaves every function beside it. A type closed here is opened again by the
/// next function that mentions it.
///
/// <ggop>docs.close</ggop>
///
/// \param key The fully-qualified name the view was opened under, as a hit's `key` reports it.
/// \returns how many views were closed; `0` when that key is not open.
/// \throws gg::core::api_error `unavailable` when this run did not bind the capability that buys
///   closing documentation.
std::uint32_t close(std::string_view key);

/// Take every documentation view out of the context window, and report how many went.
///
/// It frees every documentation view this session has opened, and no file or text view beside them.
///
/// <ggop>docs.close_all</ggop>
///
/// \returns how many views were closed.
/// \throws gg::core::api_error `unavailable` when this run did not bind the capability that buys
///   closing documentation.
std::uint32_t close_all();

}  // namespace docs

}  // namespace gg
