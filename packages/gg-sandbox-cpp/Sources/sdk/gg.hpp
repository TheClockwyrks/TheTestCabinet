// **gg's surface, in one header** — everything a C++ [responses-as-code] program may call.
//
// [responses-as-code]: https://docs.testcabinet.ai/gg/responses-as-code/
//
// It is included by `Sources/prelude.hpp`, which is precompiled once per machine and put in front
// of every model program with `-include-pch` — so a program starts with all of this already
// declared and needs no `#include` line of its own. The `using namespace gg;` that makes
// `files::read_file(…)` reachable unqualified is in the prelude rather than here, because a header
// that opens a namespace for its includer is a header nobody should copy.
//
// ONE HEADER PER MODULE, and the module is the unit of everything. `gg::files` is a namespace, a
// header, a translation unit and the prefix of every name the module declares — so
// `gg::files::read_file` and `gg::files::file_read` are both real C++ paths a program can write,
// and two modules may each offer a `close` without either having to be renamed.
//
// WHY THERE IS A `gg` NAMESPACE AT ALL. So that the name a program writes and a search hit shows —
// `gg::files::read_file` — is a real C++ path and not a label, and so that a program that does
// declare its own `files` has somewhere to reach gg's from. It does not make the two invisible to
// each other: the prelude's using-directive puts gg's module names *at* global scope, so an
// unqualified `files::` beside a program's own global `files` is ambiguous rather than shadowed,
// and `gg::files::` is the spelling that always resolves. See `Sources/prelude.hpp`, which measures
// that against this arm's pinned compiler.

#pragma once

#include "runtime.hpp"

#include "gg/board.hpp"
#include "gg/context.hpp"
#include "gg/core.hpp"
#include "gg/delegation.hpp"
#include "gg/files.hpp"
#include "gg/memories.hpp"
#include "gg/programs.hpp"
#include "gg/session.hpp"
#include "gg/shell.hpp"
#include "gg/skills.hpp"
#include "gg/tasks.hpp"
#include "gg/views.hpp"
