// **gg's surface, in one header** — everything a C++ [responses-as-code] program may call.
//
// [responses-as-code]: https://docs.testcabinet.ai/gg/responses-as-code/
//
// It is included by `Sources/prelude.hpp`, which is precompiled once per machine and put in front
// of every model program with `-include-pch` — so a program starts with all of this already
// declared and needs no `#include` line of its own. The `using namespace gg;` that makes
// `fs::read_file(…)` reachable unqualified is in the prelude rather than here, because a header
// that opens a namespace for its includer is a header nobody should copy.
//
// WHY THERE IS A `gg` NAMESPACE AT ALL. Because `<cstdlib>` declares `int system(const char *)` at
// global scope and `namespace system { … }` beside it is a hard error — *redefinition of 'system'
// as different kind of symbol*, measured against the wasi-libc this arm compiles against. One
// object's name forces the whole surface into a namespace, and a namespace plus a using-directive
// is what C++ does with a library surface anyway. Qualified lookup for `system::shell` considers
// only namespaces and types, never functions, so the C library's `system` cannot shadow the
// object.

#pragma once

#include "api.hpp"
#include "error.hpp"
#include "options.hpp"
#include "types.hpp"

#include "objects/agents.hpp"
#include "objects/context.hpp"
#include "objects/fs.hpp"
#include "objects/harness.hpp"
#include "objects/memory.hpp"
#include "objects/programs.hpp"
#include "objects/project.hpp"
#include "objects/review.hpp"
#include "objects/skills.hpp"
#include "objects/system.hpp"
#include "objects/tasks.hpp"
#include "objects/view.hpp"
