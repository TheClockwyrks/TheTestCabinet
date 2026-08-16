---
title: "C++"
---

## The arm

`language: "cpp"` under the responses-as-code capability makes a model's reply a
C++ translation unit. The reply is written to disk verbatim as `main.cpp` and
compiled by `clang++` from wasi-sdk into a `wasm32-wasip1` core module, then
encoded in process with a pinned preview1 adapter into the WebAssembly component
that turn is evaluated by. The bytes ride on the prepared program, so this arm
declares no guest component of its own.

Nothing is prepended, appended or re-indented, so no line moves and a diagnostic
at line 7 is line 7 of what the model wrote. A translation unit is the only C++
context admitting the `template`, `namespace` and `#include` declarations an
author writes at a file's top level. C++ has nowhere else to put a statement, so
the reply must define `main`, which is the entry point gg's shell calls.

A reply defining none is refused at prepare time as `PrepareError::Unsupported`,
with a sentence naming what to write. gg has to ask that question because
wasi-libc references `main` weakly, so a program with no entry point links
cleanly and traps having run nothing. The reply is read lexically for the token
`main` followed by an open parenthesis in its code bytes, so the reading can
only be wrong in the accepting direction.

`member_separator` is `::`, code modules are compiled from `.hpp` files, and
`checker()` is `"clang++"`, so compile time is recorded on every turn.

Every name gg offers is reached through an `#include` the program wrote. The
precompiled header carries the C++ standard library and nothing else, so `gg` is
undeclared until the reply writes `#include <gg/files.hpp>` or the umbrella
`#include <gg.hpp>`. The SDK's headers are on the compile's include path and its
bodies are linked into every artifact, which is packaging rather than scope.

## Toolchain and build outputs

The compiler is a wasi-sdk tree, located at `TCAB_GG_WASI_SDK_HOME`, then
`/opt/gg/toolchains/wasi-sdk`, then `~/.local/share/tcab/gg-wasi-sdk`. A compile
is bounded at 120 seconds. `crates/gg-sandbox-artifacts/cpp` builds three
artifacts from `packages/gg-sandbox-cpp` into that crate's `OUT_DIR`, and the
arm embeds them through `GG_ARTIFACTS_CPP`. None of them are committed.

| Artifact | What it carries |
| --- | --- |
| `cpp.guest.tar.gz` | the generated WIT header, the SDK headers under the `include/` root a program's own `#include <gg/…>` resolves against, `prelude.hpp`, gg's shell as source and as an object, and the SDK, bindings and component-type objects the link needs |
| `cpp.adapter.wasm` | this arm's pinned `wasi_snapshot_preview1` reactor adapter |
| `cpp.toolchain.json` | the pinned release, target, standard and adapter version, and the header list read out of the prelude |

Three compile flags decide what a model can write and read.
`-fwasm-exceptions` with `-mllvm -wasm-use-legacy-eh=false` selects the
standardised `try_table` encoding the pinned wasmtime accepts, so `throw`, `try`
and `catch` work. `-D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_EXTENSIVE`
turns on libc++'s bounds checks, which wasi-sdk ships disabled. `-g1` supplies
the debug information the engine symbolicates traps with.

The host accepts that encoding through `Config::wasm_exceptions`, which wasmtime
gates behind its `gc` build feature. The workspace therefore builds against a
wasmtime with GC support, and the repository's other wasm hosts turn
`gc_support` off on their own engines rather than inheriting a wider validation
surface. gg's engine is the one that opts in.

### The precompiled prelude

`Sources/prelude.hpp` is the standard-library headers a C++ author reaches for,
and only those. Parsing them as text costs the best part of a second of every
compile, so the file is precompiled into a shared, content-keyed toolchain
directory, placed by rename and sealed read only. The key folds in the pinned
release, a digest of the guest archive, a digest of the flags every compile
passes and a stamp of the compiler binary's own size and modification time, so a
reinstall at the same version cannot leave a stale header behind.

Warm-up unpacks the guest archive only, and the precompiled header is built by
the first compile of a process, because building one means running a compiler.
Measured on this repository's dev container, aarch64, best of five: a small
program compiles in 90 ms with the header and 836 ms without it, and a program
using ranges, `std::format` and `std::map` in 952 ms with and 1581 ms without.
Keeping gg's own surface out of the header costs 31 ms of a turn, which is the
parse the reply's own `#include` asks for.

## SDK and catalogue

The SDK is hand-written in `packages/gg-sandbox-cpp/Sources/sdk/` and reads as
the standard library it arrives beside: `snake_case` functions and types,
`enum class` for a fixed choice, aggregates for records, `std::variant` for a
value that is one of two things, and a thrown `gg::core::tool_error` deriving
from `std::runtime_error` for a call that failed. One optional argument is a
default argument; two or more are designated initialisers.

Every capability module is a `namespace` inside `namespace gg`, declared in one
header of its own. A program writes `#include <gg/files.hpp>` and then
`gg::files::read_file(…)`, and `#include <gg.hpp>` is the umbrella declaring all
thirteen. Each module's catalogue entry states its own include line, which the
system prompt's module list and every documentation view of a symbol in it quote.

The library set is the C++ standard library and nothing else, declared header by
header in `prelude.hpp` under `// == Heading ==` groups, which the compile,
`build.sh`'s manifest and the catalogue's `libraries` section all read.

`packages/gg-sandbox-cpp/signatures.sh` reflects the signature catalogue out of
clang's own comment AST, dumped as JSON by the same `clang++` that compiles
every program and filtered with `-ast-dump-filter=gg`. `crates/gg/build.rs` runs
it while building the crate. The reflection enforces four rules:

- `///` comments are model-facing and `//` comments are not. A public member
  documented with `//`, or with nothing, is left out of what a model is shown.
- `-Wdocumentation -Wdocumentation-pedantic -Werror=documentation` is passed, so
  a `\param` naming an argument the function does not take fails the reflection.
- The gg operation a function binds is written on its declaration as a
  `<ggop>files.read_file</ggop>` line, a namespace's gg module as
  `<ggmodule>files</ggmodule>`, and a member function reaching an operation its
  module already offers as `<ggop-alias>`. A documented function that names no
  operation fails the reflection; an id gg's operations table has no row for is
  caught the other way, by the registry gate over the catalogue this arm
  embedded.
- The brief is the comment's first line and the detail is the rest. A
  declaration whose first line runs on is refused by name.

## Code modules

A code skill's or memory's namespace is bound at `lib::<key>`, and on this arm
that binding is a link. Each module in scope is written into the preparation's
workspace with its declarations opened inside `namespace lib::<key>` where they
stand, and named on the program's command line with `-include`, in binding order
so one module may reach another's namespace. A `#line` directive states what the
author's first line is, so no line number moves for a module either.

A `#include` at a module's top level is refused by name, and the refusal says to
delete the line. `#include` is textual, so one inside a namespace puts the
included header inside `lib::<key>`, and a header the prelude already read
expands to nothing at all. gg writes `#include <gg.hpp>` above the namespace
itself, so a module reaches gg's surface and the standard library with no include
of its own. That wrapper is the module half's alone: a program is a model's reply
and is compiled exactly as sent.

A module is also compiled alone with `-fsyntax-only` when it is read, so a
module that does not build is reported to its author rather than to every
program the agent writes afterwards. Its own file is the only authored source
there, so a diagnostic located elsewhere is a toolchain failure.

## Failures

Everything `clang++` rejects is one band, `PrepareError::Compile`, because clang
has no parse-only phase a program passes before meaning is considered. A
rejection is the model's when a file somebody authored is named anywhere in the
whole rendering, notes included, because a template error is reported inside the
library with the model's own line arriving as a `note:`.
`wasm-ld: error: undefined symbol:` is also the model's, and everything else is
a toolchain failure. Warnings and the driver's own `linker command failed`
summary are dropped from what the model reads. See
[compilation](/gg/languages/compilation/) for how the two kinds are reported.

What the model reads is capped group by group. The first four errors are kept
whole, at most three `note:` lines are kept under one error, and what was
dropped is counted rather than hidden. A diagnostic naming an authored file is
never dropped at any depth, and clang's own `N errors generated.` summary is
kept. The band is decided on the whole rendering before the cap runs, so capping
can never turn a compile error into a toolchain failure.

At run time there are four shapes. An uncaught `throw` is caught by gg's shell
and reported as a recoverable program error carrying the exception's demangled
class and its `what()`, with no location. A libc++ hardening check traps with
libc++'s own sentence at the model's own line. A non-zero status returned from
`main` is read by the shell and reported with the number the program chose, which
is the one failure channel C++ gives an entry point. Any other undefined
behaviour is a trap with no words, located at the model's own line and no more.

Two failures this arm cannot report faithfully are recorded by
[gate G8](/gg/responses-as-code/invariants/). `std::exit(3)` reaches the model as
`exit(1)`, because the pinned preview1 adapter imports `wasi:cli/exit.exit` and
that import carries a boolean rather than a status. A null dereference is not a
fault at all: address zero is ordinary linear memory in wasm, so reading and
writing through a null pointer succeeds and the turn is recorded as a clean one.

## Prompt segment

[`system-code.hbs`](/gg/prompts/) reaches this arm through a segment gated on
`cpp`, and `code-nothing-shown.hbs` through a clause naming printing. The
segment states:

- the reply is compiled verbatim as a whole translation unit and defines
  `int main`, with the C++ standard library already in front of its first line;
- every call throws, an expected failure is caught as `gg::core::tool_error`, and
  its `code()` is an `enum class`;
- one optional argument is a default argument and two or more are designated
  initialisers, and each module is a namespace inside `namespace gg` reached by
  writing that module's own `#include` line and then its path in full.

The arm names `clang++` as its [checker](/gg/languages/compilation/), so the
shared body states that a program is compiled before it runs, that one the
compiler refuses is not executed, and that a call the run withheld compiles and
fails when it runs. The header set is carried by a compile failure rather than
by the prompt.

Source gg synthesizes for this arm is a whole program by the same rules. The
file-view program, the documentation-view program and the bootstrap program each
carry the include lines the calls they make need and a whole `int main`. A file
view is written `gg::views::open_file("src/main.cpp");`, with a window as a
designated initialiser.

## Healing dialect

`crates/gg/src/sandbox/language/cpp.healing.rs` answers
[response healing](/gg/response-healing/)'s lexical questions with the lexer the
arm reads a reply with. `#` opens both a preprocessor directive and a Markdown
heading, and case tells them apart: a `#` followed by one of the fourteen
directive words spelled lower-case is code, while `# Include the manifest` is
prose and stays deletable. A raw string's fence is chosen by its author, so
`R"gg(…)gg"` is read rather than looked for. A `'` immediately after an
alphanumeric is a digit separator. Block comments do not nest.

One scan answers both readers. Healing is handed a code mask only when the scan
ended cleanly. The reader asking whether a reply defines `main` takes the mask
whatever happened, because its errors are safe in the accepting direction.
