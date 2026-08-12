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

## Toolchain and build outputs

The compiler is a wasi-sdk tree, located at `TCAB_GG_WASI_SDK_HOME`, then
`/opt/gg/toolchains/wasi-sdk`, then `~/.local/share/tcab/gg-wasi-sdk`. A compile
is bounded at 120 seconds. `crates/gg-sandbox-artifacts/cpp` builds three
artifacts from `packages/gg-sandbox-cpp` into that crate's `OUT_DIR`, and the
arm embeds them through `GG_ARTIFACTS_CPP`. None of them are committed.

| Artifact | What it carries |
| --- | --- |
| `cpp.guest.tar.gz` | the generated WIT header, the SDK headers, `prelude.hpp`, gg's shell as source and as an object, and the SDK, bindings and component-type objects the link needs |
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

`Sources/prelude.hpp` is gg's SDK header plus the standard-library headers a C++
author reaches for; the raw canonical ABI header the SDK is written against is
deliberately not in it. Parsing it as text costs around 850 ms of every compile,
so it is precompiled into a shared, content-keyed toolchain directory, placed by
rename and sealed read only. The key folds in the pinned release, a digest of the
guest archive, a digest of the flags every compile passes and a stamp of the
compiler binary's own size and modification time, so a reinstall at the same
version cannot leave a stale header behind.
Warm-up unpacks the guest archive only, and the precompiled header is built by
the first compile of a process, because building one means running a compiler.

## SDK and catalogue

The SDK is hand-written in `packages/gg-sandbox-cpp/Sources/sdk/` and reads as
the standard library it arrives beside: `snake_case` functions and types,
`enum class` for a fixed choice, aggregates for records, `std::variant` for a
value that is one of two things, and a thrown `gg::core::tool_error` deriving
from `std::runtime_error` for a call that failed. One optional argument is a
default argument; two or more are designated initialisers.

Every capability module is a `namespace` inside `namespace gg`, with the types
it produces nested in it, and the prelude writes `using namespace gg;` above the
standard-library headers it goes on to include. A program writes
`files::read_file(…)` with no include line of its own, and
`gg::files::read_file` is the same call in full. The using-directive makes gg's
module names visible at global scope, so a program's own file-scope
`namespace files` leaves an unqualified `files::` ambiguous. `gg::files::` and
`::files::` each resolve it.

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
expands to nothing at all. The prelude stands in front of a module as it does in
front of a program, so a module needs no include of its own.

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

At run time there are three shapes. An uncaught `throw` is caught by gg's shell
and reported as a recoverable program error carrying the exception's demangled
class and its `what()`, with no location. A libc++ hardening check traps with
libc++'s own sentence at the model's own line. Any other undefined behaviour is
a trap with no words, located at the model's own line and no more.

## Prompt dialect

The templates are `system-code.cpp.hbs` and `code-nothing-shown.cpp.hbs` in
`crates/gg/templates/`. Beyond what every arm's prompt states, this one states:

- the reply is compiled verbatim as a whole translation unit and must define
  `int main`, and gg's surface and the standard library are already in front of
  the first line;
- each capability module is a namespace and a call is a qualified name; a
  program's own file-scope namespace sharing a module's name makes the
  unqualified form ambiguous, and `gg::` plus the module name always resolves;
- one optional argument is a default argument, two or more are designated
  initialisers, and a fixed choice is an `enum class`;
- every call throws, an expected failure is caught as `core::tool_error`, and
  its `code()` is an `enum class`;
- the header list, that a standard header outside it still resolves if the
  program includes it, and that a non-standard header is `file not found`;
- that container bounds are checked, that undefined behaviour is the one failure
  the sandbox cannot explain, and that `<thread>`, `<future>` and `<atomic>`
  have nothing to run on.

The statements gg synthesizes into a transcript use the same spelling. A file
view is `gg::views::open_file("src/main.cpp");`, with a window as a designated
initialiser, and a documentation-view program is a whole `int main` holding a
`std::array` of names and a range `for` over it.

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
