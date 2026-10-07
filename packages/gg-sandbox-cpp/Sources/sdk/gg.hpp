// **gg's surface, in one header** — everything a C++ [responses-as-code] program may call.
//
// [responses-as-code]: https://docs.testcabinet.ai/gg/responses-as-code/overview/
//
// It is the umbrella a program writes `#include <gg.hpp>` for when it wants all thirteen modules at
// once; one module's own `#include <gg/files.hpp>` is what a catalogue entry states and what a
// documentation view quotes. Nothing here is put in front of a program by gg: the
// [invariants](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) require every name a
// program writes to be reached through a line that program wrote — the C++ standard library
// included, which is why nothing at all is put in front of a translation unit here — and there is no
// using-directive anywhere.
//
// ONE HEADER PER MODULE, and the module is the unit of everything. `gg::files` is a namespace, a
// header, a translation unit and the prefix of every name the module declares — so
// `gg::files::read_file` and `gg::files::file_read` are both real C++ paths a program can write,
// and two modules may each offer a `close` without either having to be renamed.
//
// WHY THERE IS A `gg` NAMESPACE AT ALL. So that the name a program writes and a search hit shows —
// `gg::files::read_file` — is a real C++ path and not a label, and so that a program declaring its
// own `files` takes a name gg is not using: nothing of this SDK's is at global scope, so a
// program's own `namespace files` and `gg::files` never meet.

#pragma once

#include "runtime.hpp"

#include "gg/board.hpp"
#include "gg/context.hpp"
#include "gg/core.hpp"
#include "gg/delegation.hpp"
#include "gg/docs.hpp"
#include "gg/files.hpp"
#include "gg/memories.hpp"
#include "gg/programs.hpp"
#include "gg/session.hpp"
#include "gg/shell.hpp"
#include "gg/skills.hpp"
#include "gg/tasks.hpp"
#include "gg/views.hpp"
