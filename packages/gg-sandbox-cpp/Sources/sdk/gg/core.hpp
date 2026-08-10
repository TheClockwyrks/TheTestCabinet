// **The types every other module's signatures name**, and nothing else.
//
// It declares no capability of its own, which is why it carries no `list()`: a program reaches
// `core::tool_error` by catching one and `core::function_summary` by calling another module's
// directory, so a directory of this module would list nothing.
//
// This file is model-facing: everything a `///` says here is reflected into the signature catalogue
// and reaches a model. `//` comments are for whoever maintains it.

#pragma once

#include <stdexcept>
#include <string>
#include <string_view>

namespace gg {

/// The types every other module's signatures name: how a call fails, and what a directory carries.
///
/// It declares no capability of its own, which is why it carries no directory: a program reaches
/// `core::tool_error` by catching one and `core::function_summary` by calling another module's
/// `list`.
///
/// <ggmodule>core</ggmodule>
namespace core {

/// Why a gg call failed — what a `catch` branches on instead of matching on a message.
enum class tool_error_code {
  /// The arguments were malformed, ill-typed, or out of range.
  ///
  /// An agent name the run does not declare, and an empty list where the call requires one, are
  /// both this.
  invalid_argument,
  /// The named thing does not exist.
  ///
  /// A file, a skill, a memory, a task, an epic, an issue, a subagent, a stored program and a
  /// documentation entry all fail this way.
  not_found,
  /// Well-formed, but in conflict with the current state.
  ///
  /// An ambiguous edit, a dependency cycle, a duplicate id, and a subagent that has already
  /// returned are all this.
  conflict,
  /// gg refused the call on a rule about the agent's own state.
  ///
  /// A compaction in flight that this call is not the one it asked for, a memory call while
  /// memories are read-only, a second ending in one turn, or a hook that blocked it. A ceiling
  /// that was hit is `limit_exceeded` rather than this.
  refused,
  /// The call exists and this run's capability set does not offer it.
  ///
  /// Every name in this SDK is in scope whatever a run enables, because the SDK is compiled once
  /// and a capability set is decided per run, so a withheld call fails here rather than failing to
  /// compile.
  unavailable,
  /// A gg-side ceiling was hit.
  ///
  /// A shell timeout, a store cap, the delegation depth cap and the run's wall-clock budget are
  /// all this.
  limit_exceeded,
  /// The underlying I/O or process failed.
  io_error,
  /// The failure was not classified, and nothing a program can call produces it.
  other,
};

/// A gg call that failed.
///
/// Every function in this SDK throws one of these when its call fails, and nothing here returns a
/// status that could be left unread — which is what makes `try` the whole of the ceremony. It
/// derives from `std::runtime_error`, so `catch (const std::exception&)` catches it as a C++
/// author expects of anything a library throws, and `what()` is gg's own sentence about the
/// failure rather than a bare message.
///
/// The failures worth expecting are caught and branched on by `code()`, which is a value rather
/// than prose:
///
/// ```cpp
/// try {
///   const auto notes = files::read_text_file("notes.md");
///   views::open_text("notes", notes);
/// } catch (const core::tool_error& failure) {
///   if (failure.code() != core::tool_error_code::not_found) throw;
///   files::write_file("notes.md", "");
/// }
/// ```
///
/// An exception that escapes `main` is reported with its class and its `what()`, so it names the
/// call that failed — but it carries no line, because C++ cannot ask a caught exception where it
/// was thrown. Catching the expected failures is what buys the line back.
class tool_error : public std::runtime_error {
 public:
  // Built from what the membrane reported, and by nothing else — so it carries `//` rather than
  // `///`, which is this SDK's marker for "a model reads this". A program catches one of these; it
  // never has a reason to construct one.
  tool_error(tool_error_code code, std::string tool, std::string message);

  /// The failure class, so a `catch` branches on a value rather than on prose.
  core::tool_error_code code() const noexcept { return code_; }

  /// The gg call that failed, under gg's own name for it (`read_file`, `spawn_subagent`).
  const std::string& tool() const noexcept { return tool_; }

  /// What went wrong, in gg's words: worth showing, not worth matching on.
  const std::string& message() const noexcept { return message_; }

 private:
  tool_error_code code_;
  std::string tool_;
  std::string message_;
};

/// One function in a module's directory: its name, and one line saying what it does.
///
/// The whole documentation of a function — every shape it may be called in, what to put in each
/// argument, and the types it refers to — is a view, opened with `views::open_docs_view`.
struct function_summary {
  /// The name a program calls it by, under its own module (`read_file` in `files::read_file`).
  std::string name;
  /// One line saying what it does.
  std::string summary;
};

// gg's own hyphenated word for a failure class (`not-found`, `limit-exceeded`), as every other
// execution mode and every other language arm prints it.
//
// It carries `//` rather than `///` deliberately: it is what this SDK's own error message is
// assembled from, not a capability gg gates, and this arm catalogues exactly the declarations that
// bind a gg operation.
std::string_view gg_name(tool_error_code code) noexcept;

}  // namespace core

}  // namespace gg
