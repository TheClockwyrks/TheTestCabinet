// **How a gg call fails, in C++**: an exception, because C++ is an exception language and every
// other way of saying it would be a library fighting its own runtime.
//
// This file is model-facing: everything a `///` says here is reflected into the signature
// catalogue and reaches a model. `//` comments are for whoever maintains it.

#pragma once

#include <stdexcept>
#include <string>
#include <string_view>

namespace gg {

/// Why a gg call failed — the `code()` on a `tool_error`, and what a `catch` branches on instead
/// of matching on a message.
enum class tool_error_code {
  /// The arguments were malformed, ill-typed, or out of range — including an agent name this run
  /// does not declare, and an empty list where the call requires one.
  invalid_argument,
  /// The named file, skill, memory, task, epic, issue, subagent, stored program, or documentation
  /// entry does not exist.
  not_found,
  /// Well-formed, but in conflict with the current state: an ambiguous edit, a dependency cycle, a
  /// duplicate id, a subagent that already returned.
  conflict,
  /// gg refused the call on a rule about your state: a compaction in flight that this call is not
  /// the one it asked for, a memory call while your memories are read-only, a second ending or
  /// hand-over in a turn that already declared one, or a hook that blocked it. A ceiling you ran
  /// into is `limit_exceeded`, not this.
  refused,
  /// The call exists but this run's capability set does not offer it. Every name in this SDK is in
  /// scope whatever a run enables, because the SDK is compiled once and a run's capability set is
  /// decided per run — so this is what a call gg withheld comes back as.
  unavailable,
  /// A gg-side ceiling was hit: a shell timeout, a store cap, the delegation depth cap, one of the
  /// view caps your program spends, or the run's wall-clock budget.
  limit_exceeded,
  /// The underlying I/O or process failed.
  io_error,
  /// The failure was not classified. Reserved for outcomes raised outside a tool implementation;
  /// nothing you can call produces it.
  other,
};

/// gg's own word for a failure class, as every other execution mode and every other language arm
/// prints it.
///
/// A C++ enumerator is `not_found` and gg's word is `not-found`. A model that has read one failure
/// should recognise the next one whichever arm it is on, so the sentence a failure renders as uses
/// gg's word rather than this SDK's spelling of it.
///
/// \param code The failure class to name.
/// \returns gg's own hyphenated word for it (`not-found`, `limit-exceeded`).
std::string_view gg_name(tool_error_code code) noexcept;

/// A gg call that failed.
///
/// Every function in this SDK throws one of these when the call fails, and nothing here returns a
/// status you might forget to look at. That is what makes `try` the whole of the ceremony:
/// `const auto notes = fs::read_text_file("notes.md");` binds a `std::string`, and a failure
/// leaves your program with gg told exactly which call failed and on which line.
///
/// It derives from `std::runtime_error`, so `catch (const std::exception&)` catches it as a C++
/// programmer expects of anything a library throws — and `what()` is gg's own sentence about the
/// failure rather than a bare message.
///
/// Catch the failures you *expect* and branch on `code()`, which is a value rather than prose:
///
/// ```cpp
/// try {
///   const auto notes = fs::read_text_file("notes.md");
///   view::open_text("notes", notes);
/// } catch (const tool_error& failure) {
///   if (failure.code() != tool_error_code::not_found) throw;
///   fs::write_file("notes.md", "");
/// }
/// ```
///
/// Let the ones you do not expect out. An exception that escapes `main` is reported to you with
/// its class and its `what()`, so an uncaught failure names the call that failed rather than
/// stopping your program without a word — but it carries **no line**, because C++ cannot ask a
/// caught exception where it was thrown. Catching what you expect is what buys the line back.
class tool_error : public std::runtime_error {
 public:
  // Built from what the membrane reported, and by nothing else — so it carries `//` rather than
  // `///`, which is this SDK's marker for "a model reads this". A program catches one of these; it
  // never has a reason to construct one.
  tool_error(tool_error_code code, std::string tool, std::string message);

  /// The failure class, so a `catch` branches on a value rather than on prose.
  ///
  /// \returns the class gg put the failure in.
  tool_error_code code() const noexcept { return code_; }

  /// The gg call that failed, under gg's own name for it (`read_file`, `spawn_subagent`).
  ///
  /// \returns the failing call's gg tool name.
  const std::string& tool() const noexcept { return tool_; }

  /// What went wrong, in gg's words. Worth showing yourself; not worth matching on.
  ///
  /// \returns gg's guidance for this failure, without the sentence `what()` wraps it in.
  const std::string& message() const noexcept { return message_; }

 private:
  tool_error_code code_;
  std::string tool_;
  std::string message_;
};

}  // namespace gg
