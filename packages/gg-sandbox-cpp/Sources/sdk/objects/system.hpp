#pragma once

#include <optional>
#include <string_view>
#include <vector>

#include "../api.hpp"
#include "../types.hpp"

namespace gg {

/// run shell commands in the workspace
///
/// One function, and it is the widest one this SDK has: everything a command line can do, a
/// program can do through it. A non-zero exit is a *result* rather than a failure, because
/// deciding whether a build or a test run passed is the single most common thing a program does
/// with it.
///
/// The name is why this whole SDK lives in `namespace gg`: `<cstdlib>` declares a function called
/// `system` at global scope, and a namespace of that name beside it does not compile. Reached as
/// `system::shell` it is unambiguous, because a qualified name is looked up among namespaces and
/// types and never among functions.
namespace system {

/// \copydoc gg::detail::api_object_list
std::vector<function_summary> list();

/// Run a command with `sh -c` in the workspace directory and hand back its merged stdout and
/// stderr.
///
/// A non-zero exit is NOT a failure — read `exit_code` on the result; only a process that could
/// not be launched, or one the timeout killed, throws.
///
/// This run may **offload** shell output — the `shell` tool's own description says which mode is
/// in force. Under `offload`, `output` holds only the tail that fits and ends with a note naming
/// the two files the command's full stdout and stderr were written to. Under `adaptive` (the
/// default), a command that **succeeded** returns no output at all, only that note; one that
/// **failed** returns the tail. Grep the named files instead of re-running the command.
///
/// \param command The command line, run by `sh -c` with your workspace as its working directory.
/// \param timeout_secs How long to let it run, in seconds, before killing it. Leave it out to take
///   gg's default of 120, which is clamped to whatever is left of the run's wall-clock budget.
/// \returns what the process reported when it finished.
/// \throws tool_error `limit_exceeded` when the timeout killed the process, and `io_error` when it
///   could not be launched.
shell_output shell(std::string_view command, std::optional<double> timeout_secs = std::nullopt);

}  // namespace system

}  // namespace gg
