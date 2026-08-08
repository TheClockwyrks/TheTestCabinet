# `gg-sandbox-cpp` — gg's C++ prelude, shell and compile inputs

The **C++** arm of gg's [responses as code] capability: the prelude every model program is compiled
against, the shell it is linked with, and the build that commits both into gg's binary.

It is not an npm package and not a Cargo crate. It is a directory of two sources and three scripts,
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
| `Sources/prelude.hpp` | **What every program is compiled against**, and the header this arm precompiles once per machine: the generated WIT surface as C, the declaration of the model's own entry point, and the standard-library set. One declaration, two readers — the compile, and the `headers` list in the committed manifest. |
| `Sources/shell.cpp` | gg's shell — the two exports the sandbox world declares, the call into the model's own `main`, and the `catch` that turns an uncaught exception from `thrown Wasm exception` into the exception's own class and `what()`. Compiled **once**, at build time. |
| `cpp-version.sh` | Every pin — the wasi-sdk release, the target triple, the C++ standard, the `wasi_snapshot_preview1` adapter, the `wit-bindgen` release — and where gg looks for the toolchain. Sourced by everything below, by `containers/gg-toolchains/Dockerfile` and by `scripts/ci/install-wasi-sdk.sh`. |
| `bindings.sh` | Generates the C bindings from `crates/gg/wit` with the pinned `wit-bindgen`. Its own script so no step that must write exactly one file has to reach the build. |
| `build.sh` | Compiles those bindings and the shell for wasm, cuts the committed archive, fetches the adapter, and writes the manifest. |

## What a C++ program looks like

An ordinary translation unit. Nothing is added to it and nothing has to be included, because the
prelude is already in front of it — though writing the includes anyway costs nothing, which is the
point of compiling the reply verbatim:

```cpp
#include <format>
#include <ranges>
#include <vector>

int main() {
  std::vector<int> values{3, 1, 2};
  std::ranges::sort(values);
  // … and gg's own surface, which this arm's SDK step has still to put in front of a model.
  return 0;
}
```

## The library set

The **C++ standard library**, as libc++ 22 implements it for this target, declared header by header
in `Sources/prelude.hpp` and reflected into the committed manifest from that same file. Ranges,
`std::format`, `std::expected`, the containers, `<regex>`, `<chrono>` and `<random>` are all there
and all exercised by this arm's tests.

Three things are deliberately absent. `<thread>`, `<future>` and `<atomic>`, because this sandbox
has no concurrency at all and a header a model is told it has and cannot use is worse than one it
was never offered. `<iostream>`, because a program's stdout is not a channel a turn is read from and
including it drags its static initialisation into every artifact. And any third-party library:
what a C++ author reaches for first *is* the standard library, and a curated set beyond it is a
decision for the SDK step, which is what would have to tell a model the set exists.

## What it commits, and why those and not the compiler

```
crates/gg/src/sandbox/checkers/cpp.guest.tar.gz     36 KB — the compile inputs: the generated
                                                            header, the prelude, gg's shell as
                                                            source and object, the bindings object
crates/gg/src/sandbox/checkers/cpp.adapter.wasm     52 KB — the preview1 reactor adapter
crates/gg/src/sandbox/checkers/cpp.toolchain.json         — what built them, and what is in them
```

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

## What is not built

The **SDK** — the curated, idiomatic C++ surface a model's program calls, and the catalogue that
describes it — and the **registration** that makes `language: "cpp"` a value an operator can
configure. `crates/gg/src/sandbox/language/cpp.rs` says what registering needs, and what the open
question is for `lib.<key>` on a language whose modules are linked.
