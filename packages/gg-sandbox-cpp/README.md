# `gg-sandbox-cpp` — gg's C++ SDK, prelude, shell and compile inputs

The **C++** arm of gg's [responses as code] capability: the hand-written SDK a model's program is
written against, the prelude it is compiled against, the shell it is linked with, and the build
that commits all three into gg's binary.

It is not an npm package and not a Cargo crate. It is a directory of C++ sources and four scripts,
because what it produces is not a library anybody links from this repository — it is compile
*inputs* that ride inside `gg` and are unpacked next to a model's program once per machine.

[responses as code]: https://docs.testcabinet.ai/gg/responses-as-code/

## What this arm is

**A C++ program is compiled by `clang++` into the wasm component that turn is evaluated by.** There
is no committed guest and no interpreter: this is the third arm of that shape, after
[Rust](../gg-sandbox-rust/) and [Swift](../gg-sandbox-swift/), and the whole design is in
`crates/gg/src/sandbox/language/cpp.compile.rs`.

Four things about it are worth knowing before reading anything here.

**A model's reply is compiled verbatim, as `main.cpp`, and it must define `main`.** No wrapper, no
prologue and no line offset. That is forced rather than chosen: C++ refuses a `template` and a
`namespace` at block scope outright, and a `#include` inside a function body would expand the whole
of `<vector>` there — so a translation unit is the only shape that admits what a C++ author writes.
The price is the entry point, and gg refuses a reply that defines none *at prepare time*, because
`wasm-ld` will not: wasi-libc references `main` weakly, so a program with nothing to run links
cleanly and traps having done nothing.

**The prelude is precompiled, and that is the single largest thing about this arm's cost.** Parsing
`Sources/prelude.hpp` — gg's generated wire header plus the ~55 standard-library headers a C++
author reaches for — costs ~850 ms of every compile. Reading it back precompiled costs ~40 ms.
Measured: a small program is 883–1110 ms without the PCH and **82–95 ms** with it, which makes this
the cheapest of the three compiled arms per turn rather than the dearest.

**Exceptions work.** `-fwasm-exceptions` with the standardised encoding (`-mllvm
-wasm-use-legacy-eh=false`, because clang still defaults to the legacy one and the pinned wasmtime
refuses it), libc++'s `eh` build, an explicit `-lunwind`, and `Config::wasm_exceptions` on gg's
engine. `-fno-exceptions` would have made every `try` a model writes a compile error, which is an
arm measuring gg's flag rather than the language.

**libc++'s hardening checks are turned on.** wasi-sdk ships libc++ configured to check *nothing* —
`_LIBCPP_HARDENING_MODE_DEFAULT` is `none` in its own `__config_site` — so `values[9]` on a
three-element vector reads whatever is there. gg compiles every translation unit with
`extensive`, which turns the most common shape of undefined behaviour into a message and a line.

## What is here

| | |
| --- | --- |
| `Sources/sdk/gg/` | **gg's surface, hand-written and idiomatic**: one header per capability module, each a nested `namespace` under `gg` holding that module's functions and the types they hand back. Its `///` comments are the model-facing documentation — `tools/signatures.py` reflects the committed catalogue out of them — and its `//` comments are not. |
| `Sources/sdk/*.cpp` | One translation unit per module: the lowering, the call and the lift. Nothing in them is model-facing. `sdk/wire.*` is the bridge onto the canonical ABI, which a model never reads, and `sdk/runtime.hpp` holds the three declarations that belong to no module. |
| `Sources/prelude.hpp` | **What every program is compiled against**, and the header this arm precompiles once per machine: the generated WIT surface as C, the declaration of the model's own entry point, and the standard-library set. One declaration, two readers — the compile, and the `headers` list in the committed manifest. |
| `Sources/shell.cpp` | gg's shell — the two exports the sandbox world declares, the call into the model's own `main`, and the `catch` that turns an uncaught exception from `thrown Wasm exception` into the exception's own class and `what()`. Compiled **once**, at build time. |
| `cpp-version.sh` | Every pin — the wasi-sdk release, the target triple, the C++ standard, the `wasi_snapshot_preview1` adapter, the `wit-bindgen` release — and where gg looks for the toolchain. Sourced by everything below, by `containers/gg-toolchains/Dockerfile` and by `scripts/ci/install-wasi-sdk.sh`. |
| `bindings.sh` | Generates the C bindings from `crates/gg/wit` with the pinned `wit-bindgen`. Its own script so no step that must write exactly one file has to reach the build. |
| `build.sh` | Compiles those bindings, the SDK and the shell for wasm, cuts the committed archive, fetches the adapter, and writes the manifest. |
| `signatures.sh` | Dumps the SDK's comment AST with `clang++ -ast-dump=json` and writes `crates/gg/src/sandbox/guests/cpp.signatures.json`. Run by `scripts/ci/contract-drift.sh` on every CI run; writes exactly one file. |
| `tools/catalogue.py` | The twelve module identities, and the order a reader meets them in. Nothing else: a function's gg operation id is written on its own declaration. |
| `tools/signatures.py` | The reflector: clang's comment AST in, the committed catalogue out. |

## What a C++ program looks like

An ordinary translation unit. Nothing is added to it and nothing has to be included, because the
prelude is already in front of it — though writing the includes anyway costs nothing, which is the
point of compiling the reply verbatim:

```cpp
int main() {
  const auto entries = files::list_dir("src");
  std::vector<std::string> sources;
  for (const auto &entry : entries) {
    if (entry.kind == files::entry_kind::file) sources.push_back(entry.name);
  }
  std::ranges::sort(sources);

  const auto built = shell::run("cmake --build build", 300.0);
  views::open_text("build", built.output);
  session::finish(std::format("looked at {} sources", sources.size()));
  return 0;
}
```

## What the SDK looks like, and the two decisions behind it

**The surface is twelve capability modules, one header and one namespace each, under `namespace
gg`.** `gg::files` is a namespace, a header, a translation unit and the prefix of every name the
module declares, so `gg::files::read_file` and `gg::files::file_read` are both real C++ paths a
program can write and two modules may each offer a `close`. The prelude ends with
`using namespace gg;`, so a program writes `files::read_file(…)` with no import line of its own.
The directive costs one measured surprise: it makes gg's module names visible *at* global scope
rather than nested inside it, so a program's own file-scope `namespace files { … }` — or the reflex
`namespace files = std::filesystem;` — is a second candidate and an unqualified `files::` is
*reference to 'files' is ambiguous*, naming both at the model's own line. The declaration itself is
accepted; `gg::files::` and `::files::` each resolve the use, and block scope is unaffected. No
module name collides with anything the prelude already declares: measured against this arm's pinned
`clang++`, all twelve compile as a fresh `namespace` at global scope beside it.

**It reads like the standard library**, because it arrives in the same prelude as `<vector>` and is
called with `std::string` arguments: `snake_case` functions, `snake_case` types, `enum class` for a
fixed choice, aggregates with public members for a record, `std::variant` for a value that is one of
two things, **default arguments** for one optional part and a **designated initialiser** for
several, and a thrown `gg::tool_error` — a `std::runtime_error` — for a call that failed.

```cpp
files::read_file("src/main.cpp", {.limit = 40});
tasks::update_task("t1", {.description = tasks::text_edit::clear(),
                          .status = tasks::task_status::done});
try {
  views::open_text("notes", files::read_text_file("notes.md"));
} catch (const core::tool_error &failure) {
  if (failure.code() != core::tool_error_code::not_found) throw;
}
```

## The catalogue, and why clang is the documentation tool

`crates/gg/src/sandbox/guests/cpp.signatures.json` is reflected out of the SDK's own `///` comments
by **clang's comment AST**, dumped as JSON. clang carries a real documentation parser — the one
`-Wdocumentation` diagnoses against and the one `libclang`'s comment API and `clang-doc` are built
on — and it does the three things that matter: it decides which comment belongs to which declaration,
it parses the Doxygen commands inside one into structure, and it keeps the **lines** the author
wrote. So `\param path`'s prose arrives attached to the parameter called `path`, `\returns` and
`\throws` arrive as their own nodes, and the first line of a comment is recoverable as a first line
rather than as a sentence a rule had to find.

That makes C++ one of the few arms here with a **real per-parameter documentation slot** rather than
a convention standing in for one — Rust and PureScript both need a `# Arguments` list, because
neither language has anywhere to write a comment on a parameter. `signatures.sh` compiles the
reflection unit with `-Werror=documentation`, so a `\param` naming an argument the function does
not take is a failed reflection rather than a sentence a model reads about an argument that does not
exist.

Two conventions the reflector enforces, both worth knowing before editing a header:

- **`///` means model-facing and `//` does not.** A public member the bridge needs —
  `tasks::text_edit::tag()`, `delegation::brief::is_issue()` — carries `//` and is left out of the
  declaration a model is shown, and so does `core::gg_name`, which is this SDK's own error message
  rather than a capability. There is no other marker.
- **The brief is the first line, and the reflector refuses anything else.** The opening paragraph of
  a declaration's comment is its brief and everything after the blank line is its detail, with no
  `\brief` tag anywhere. An opening paragraph that runs to two source lines fails the reflection by
  name, at the declaration it was written on.
- **The gg operation a declaration binds is written on it**, as a `<ggop>files.read_file</ggop>`
  line in its own `///` comment, and a module's gg id as `<ggmodule>files</ggmodule>` on its
  namespace. An element rather than a `\command`, because an unknown Doxygen command is a compiler
  warning on every declaration that carries one; on the declaration rather than in a table beside
  it, because a table is a second place to be wrong.

## The library set

The **C++ standard library**, as libc++ 22 implements it for this target, declared header by header
in `Sources/prelude.hpp` under `// == Heading ==` groups. That one declaration has **three** readers
— the compile, the committed manifest's `headers` list, and the catalogue's `libraries` section,
which is what a model is told it may include — so what a model reads and what the compile allows
cannot drift. Ranges, `std::format`, `std::expected`, the containers, `<regex>`, `<chrono>` and
`<random>` are all there and all exercised by this arm's tests.

**The set is what is put in front of a program, not an allowlist.** clang's default include path is
the whole of libc++, so a reply that writes `#include <iostream>` or `#include <thread>` gets that
header and compiles — measured, not assumed. Making the list a real allowlist would mean
`-nostdinc++` and an explicit include tree, and what it would buy is a refusal in place of a
run-time exception a model can read. gg tells the model the truth instead, in
`crates/gg/templates/system-code.cpp.hbs`, and `cpp.surface.test.rs` asserts both directions — that
every header on the list is reachable, and that one off it is reachable too and behaves the way the
prompt says it does.

Four things are deliberately off the set, and each is a decision rather than an oversight.

- `<thread>`, `<future>` and `<atomic>`, because this sandbox has no concurrency at all. A program
  that includes one anyway compiles and links; `std::thread`'s constructor then throws
  `system_error: thread constructor failed: Not supported`, which is the same position the Rust arm
  is in with a readable ending instead of a silent one.
- `<iostream>`, because a program's stdout is not a channel a turn is read from — `gg::log` is — and
  including it drags its static initialisation into every artifact.
- `<filesystem>`, for the reason the Rust arm keeps `std::fs` off its own: it compiles and links
  here — measured — and nothing read through it is gated, recorded in the run's events or put in
  front of the model. The workspace is reached through `files`, `shell::run` and
  `views::open_file`, which is what gg mediates anyway.
- **Any third-party library.** This is the one place this arm ships a set of a different *kind* from
  the Rust and Swift arms, and it is a deviation from the seam's eighth rule taken deliberately
  rather than skipped. The rule is that commonly used libraries are available by default, and what a
  C++ author reaches for first *is* the standard library. Read against what the other arms actually
  vendor, the gap is narrower than the absence of a `cpp.libraries.tar.gz` suggests:

  | What another arm vendors | What answers it here |
  | --- | --- |
  | Rust `regex` | `<regex>` |
  | Rust `itertools`, `indexmap` | `<ranges>`, `<algorithm>`, `<numeric>`; `<map>`/`<unordered_map>` |
  | Rust `serde_json`, Python `yaml`/`tomli_w` | nothing, deliberately — no argument or result on this membrane is a document |
  | Swift `swift-collections`, `swift-algorithms` | the whole container set, `<ranges>`, `<algorithm>` |
  | Swift `swift-numerics` | `<complex>`, `<numbers>`, `<cmath>`, `<random>`, `<ratio>` |
  | Swift `Foundation` | `<chrono>`, `<format>`, `<regex>`, `<charconv>` |
  | PureScript's collections, transformers, lenses | `<optional>`, `<variant>`, `<expected>`, `<functional>`, the containers |

  What has no counterpart is a vendoring *mechanism*: there is no ambient C++ package manager, so
  anything further would be a tree committed to this repository, and one committed badly —
  unpinned, unlicensed, untested against `wasm32-wasip1` — is worse than the table above. A curated
  header set on the include path is the shape it would take if it is ever taken; nothing about this
  arm is in the way, and the prelude's `// == Heading ==` groups would carry it into the catalogue
  with no further work. **A cross-language study should read the library sets as equivalent in
  coverage and not in kind**, and the docs page says so where it compares the arms.

## Code modules

A code skill's or memory's code is bound at **`lib::<key>`**, and on this arm that binding is a
**link**: the module is compiled into the same artifact as the program that uses it. gg writes two
lines above the author's first and one below their last, and hands the file to `clang++` with
`-include`:

```cpp
namespace lib::csv_tools {                                             // gg's line
#line 1 "module_csv_tools.hpp"                                         // gg's line
std::vector<row> parse(std::string_view text, char delimiter = ',') {  // as authored
```

Two things about C++ make this the plainest module shape of the three compiled arms. It has a real
**nested namespace**, so nothing is moved or re-synthesized and every default argument, template
parameter, overload and `struct` survives; and it is the one language here with a **line-control
directive**, so no line number moves at all. `-include` is what keeps the *program*'s numbering
intact too — it leaves the primary file alone.

**A `#include` at a module's top level is refused by name**, and that is this half's one refusal.
`#include` is textual, so one inside a namespace pulls the header into `lib::<key>` — and when the
header is one the prelude already read, its include guard is already defined and it expands to
nothing at all, which is worse: the module compiles, and the same line detonates the day somebody
writes a header the prelude does not carry. Hoisting it out would be gg editing the author's file,
which this arm has never done to anybody's text. It does not need to: the prelude is in front of a
module exactly as it is in front of a program, so the refusal says to delete the line and write
nothing in its place. A *program*'s `#include` is left exactly as written, because a program is not
compiled inside a namespace.

A code skill or memory spells its code **`skill.hpp`** / `memory.hpp` — one spelling, because
nothing else in the registry compiles C++ and a language whose modules nothing else can evaluate
names one extension and no more.

## What it commits, and why those and not the compiler

```
crates/gg/src/sandbox/checkers/cpp.guest.tar.gz    100 KB — the compile inputs: the generated
                                                            header, the prelude, the SDK's headers
                                                            and its prebuilt object, gg's shell as
                                                            source and object, the bindings object
crates/gg/src/sandbox/checkers/cpp.adapter.wasm     52 KB — the preview1 reactor adapter
crates/gg/src/sandbox/checkers/cpp.toolchain.json         — what built them, and what is in them
```

`cpp.toolchain.json` lists every file with its size, so that is the figure to read rather than this
one; the number above is here to say the order of magnitude, which is ~151 KB carried in total and
still by far the lightest of the compiled arms.

The split every compiled arm here has. wasi-sdk is ~200 MB even pruned, so it lives in the gg run
image (`containers/gg-toolchains/Dockerfile`). These go the other way because they are a function of
gg's own wire, and gg is copied as a single file into an ephemeral run container whose image was
built separately — so bindings that lived in the image could be a different vintage from the binary
reading them.

**The precompiled header is deliberately not committed.** A PCH may only be read by the clang that
wrote it and records the absolute path of every header in it, so one built in this checkout is
unreadable by the wasi-sdk in a run image — and it is 26 MB. It is built once per *machine* instead,
by the first compile, into a content-keyed shared toolchain directory that is sealed read-only.

**This set is byte-reproducible**, unlike the Swift arm's: clang stamps no per-invocation nonce into
an object, and `-ffile-prefix-map` removes the one thing that would otherwise record the checkout it
was built in. A diff here means an edit.

## Rebuilding

```sh
scripts/ci/install-wasi-sdk.sh        # once; ~200 MB kept out of a ~650 MB tarball
packages/gg-sandbox-cpp/build.sh      # after editing Sources/, or after crates/gg/wit changes
```

Commit the artifacts with the change that needed them. `cpp.compile.test.rs` fails by name if the
archive's copy of the prelude or the shell is not this checkout's, so an edit here without a rebuild
does not reach a model as a program compiled against the old one.
