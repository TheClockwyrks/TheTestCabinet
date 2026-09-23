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
/// One function, reaching everything gg has no tool for: a build, a test run, `git`, `curl`, a
/// package manager. The workspace is the working directory, and a non-zero exit is a result rather
/// than a failure.
///
/// <ggmodule>shell</ggmodule>
namespace shell {

/// What a command reported when it finished.
struct shell_output {
  /// The process's exit status; empty when a signal killed it. Zero means success.
  std::optional<std::int32_t> exit_code;
  /// Merged stdout then stderr, tail-truncated at 16 KiB or at the run's own ceiling.
  ///
  /// Where the run offloads shell output this holds the tail that fits, and an output that was cut
  /// ends with a note naming the two files that hold the whole of it.
  std::string output;
  /// Whether the cap cut `output`, dropping the head and keeping the tail.
  bool truncated{};
};

/// Run a command with `sh -c` in the workspace and hand back its merged stdout and stderr.
///
/// A non-zero exit is not a failure: it arrives as `exit_code` on the result, and only a process
/// that could not be launched, or one the timeout killed, throws.
///
/// Where the run offloads shell output, `output` holds only the tail that fits and ends with a note
/// naming the two files the command's full stdout and stderr were written to. Those files are
/// readable by absolute path.
///
/// <ggop>shell.shell</ggop>
///
/// \param command The command line, run by `sh -c` with the workspace as its working directory.
/// \param timeout_secs How long to let it run before it is killed; empty takes gg's default of
///   600, clamped to whatever is left of the run's wall-clock budget.
/// \returns what the process reported when it finished.
/// \throws gg::core::api_error `limit_exceeded` when the timeout killed the process, and `io_error`
///   when it could not be launched.
shell::shell_output run(std::string_view command,
                        std::optional<double> timeout_secs = std::nullopt);

}  // namespace shell

}  // namespace gg
