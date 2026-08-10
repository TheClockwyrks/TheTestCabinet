// The **shell** module: everything gg has no tool for.
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

/// Run shell commands in the workspace.
///
/// One function, and the way a program reaches everything gg has no tool for: a build, a test run,
/// `git`, `curl`, a package manager. The workspace is the working directory.
///
/// A non-zero exit is a result rather than a failure, because deciding whether a build or a test
/// run passed is the single most common thing a program does with one.
///
/// <ggmodule>shell</ggmodule>
namespace shell {

/// \copydoc gg::detail::module_directory
std::vector<core::function_summary> list();

/// What a command reported when it finished.
struct shell_output {
  /// The process's exit status; empty when a signal killed it. Zero means success.
  std::optional<std::int32_t> exit_code;
  /// Merged stdout then stderr, tail-truncated at 16 KiB or at the run's own ceiling.
  ///
  /// Where the run offloads shell output this holds the tail that fits and a note naming the files
  /// that hold the whole of it. Under the default `adaptive` mode a command that succeeded returns
  /// just that note.
  std::string output;
  /// Whether the cap cut `output`, dropping the head and keeping the tail.
  bool truncated{};
};

/// Run a command with `sh -c` in the workspace and hand back its merged stdout and stderr.
///
/// A non-zero exit is not a failure: it arrives as `exit_code` on the result, and only a process
/// that could not be launched, or one the timeout killed, throws.
///
/// A run may offload shell output, and the `shell` tool's own description says which mode is in
/// force. Under `offload`, `output` holds only the tail that fits and ends with a note naming the
/// two files the command's full stdout and stderr were written to. Under `adaptive`, the default,
/// a command that succeeded returns that note alone and one that failed returns the tail. Grepping
/// the named files is cheaper than running the command again.
///
/// <ggop>shell.shell</ggop>
///
/// \param command The command line, run by `sh -c` with the workspace as its working directory.
/// \param timeout_secs How long to let it run before it is killed; empty takes gg's default of
///   120, clamped to whatever is left of the run's wall-clock budget.
/// \returns what the process reported when it finished.
/// \throws core::tool_error `limit_exceeded` when the timeout killed the process, and `io_error`
///   when it could not be launched.
shell::shell_output run(std::string_view command,
                        std::optional<double> timeout_secs = std::nullopt);

}  // namespace shell

}  // namespace gg
