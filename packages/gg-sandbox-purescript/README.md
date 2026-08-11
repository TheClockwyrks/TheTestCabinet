# `gg-sandbox-purescript` — gg's PureScript SDK and library set

The **PureScript** arm of gg's
[responses-as-code](../../apps/docs/src/content/docs/gg/responses-as-code.md)
capability. Under that capability a model answers a turn by writing a whole
**program** instead of a batch of tool calls; this arm compiles that program to
JavaScript on the host with `purs`, flattens it with `esbuild`, and hands the result
to the same ECMAScript guest the TypeScript and JavaScript arms use.

**Not a guest.** Unlike `gg-sandbox`, `gg-sandbox-python` and `gg-sandbox-ruby`,
this package bakes no wasm component, and that is the arm's whole design: a compiled
PureScript program is self-contained JavaScript with no runtime to carry, so a
component of its own would differ from the shared one in nothing at all. What it
does bake is the thing `purs` cannot work without — the **library set, compiled** —
and, inside it, this arm's own **SDK**: the `Gg.*` modules a model's program is
written against, compiled into the same tree so that the surface a model is shown in
its prompt and the surface its program is compiled against cannot be two vintages.

**The surface is capability modules.** A program writes `import Gg.Files as Gg.Files`
and then `Gg.Files.readFile "src/Main.purs" {}`, so the fully-qualified name gg
documents is the expression the program writes — PureScript accepts a qualified alias
that is the module's own dotted name, and an *open* import does not make such a
reference resolve. Each module's explicit export list is what decides its public
surface, which is a compiler-enforced protocol rather than a convention.

It is not an npm workspace member and has no runtime dependents. Its output is two
**committed artifacts** in the Rust crate, named for the language rather than for
this package:

| Artifact | What it is |
| --- | --- |
| [`crates/gg/src/sandbox/checkers/purescript.libraries.tar.gz`](../../crates/gg/src/sandbox/checkers/) | Every package's PureScript sources beside the externs and JavaScript `purs` emitted for them, plus this package's own `src/` under `libs/gg-sdk/`. **~1.3 MB** gzipped, ~15 MB unpacked, `include_bytes!`d by the host and unpacked once per machine. |
| [`crates/gg/src/sandbox/checkers/purescript.compiler.json`](../../crates/gg/src/sandbox/checkers/) | What that tree was built from — `purs`, `esbuild` and registry versions — and what is in it, package by package. |
| [`crates/gg/src/sandbox/guests/purescript.signatures.json`](../../crates/gg/src/sandbox/guests/) | The **signature catalogue**: every module, function, argument, field and type a model is told about, reflected out of the SDK's own doc comments by [`signatures.sh`](signatures.sh). |

## Why the tree is committed, and why the compiler is not

`purs` cannot type-check a program without both the **sources** and the compiled
**externs** of everything it imports: given externs alone, every import is
`ModuleNotFound` (measured). Compiling the set from scratch costs ~16 s, which no
turn can pay. So it is compiled once, here, and shipped inside gg's binary — where
it cannot drift from the SDK compiled into it, because they are one file.

`purs` itself goes the other way. It is a ~100 MB statically linked Haskell
executable with a separate build per platform, so it is installed into the gg
toolchain image ([`containers/gg-toolchains/Dockerfile`](../../containers/gg-toolchains/Dockerfile))
and found on `PATH` at run time. `esbuild` is there for the same reason. A machine
running gg's test suite gets both from
[`scripts/ci/install-purescript.sh`](../../scripts/ci/install-purescript.sh), pinned
to the same versions.

The pins live in one place — [`purescript-version.sh`](purescript-version.sh) —
because externs are a compiler-version-private format: a tree built by one `purs`
and read by another does not compile at all.

## Layout

| Path | What it holds |
| --- | --- |
| `purescript-version.sh` | The `purs`, `esbuild`, Spago and registry pins, sourced by `build.sh`, `containers/build.sh` and `scripts/ci/install-purescript.sh`. |
| `spago.yaml` | The library set a program may import, and the argument for every package in it. |
| `spago.lock` | What that resolved to, package by package, against the pinned registry set. |
| `src/` | The hand-written, idiomatic SDK. `Gg/<Module>.purs` is one **capability module** each — `Gg.Files`, `Gg.Shell`, `Gg.Board`, … — owning the functions it binds and the types they produce; `Gg/Core.purs` binds no capability and holds the failure types every signature names; `Gg/Internal/` is the bridge, which no model ever sees. |
| `build.sh` | Vendors the toolchain, resolves the set, stages the sources **and the SDK**, compiles, packs and writes the manifest. |
| `signatures.sh` | Regenerates the committed catalogue: unpacks the tree, stages the working `src/` over it, compiles with `--codegen docs`, and runs `tools/signatures.mjs`. |
| `tools/catalogue.mjs` | The one thing the sources cannot say: which thirteen modules the surface is divided into, and in what order a reader meets them. Nothing else — a function's gg operation id is written in its own doc comment, and every word a model reads is a doc comment in `src/`. |
| `tools/signatures.mjs` | The reflector: `purs`' own `docs.json` plus that module table, emitted as the catalogue. |

## Rebuilding

Two artifacts, two commands, and they are **both** needed after a change to `src/`:

```sh
packages/gg-sandbox-purescript/build.sh        # the library tree, with the SDK compiled into it
packages/gg-sandbox-purescript/signatures.sh   # the catalogue, reflected out of the SDK's doc comments
```

Run `build.sh` after changing `spago.yaml`, `purescript-version.sh` or `src/**`. It needs
Node and network access — the pinned `purescript`, `spago` and `esbuild` come from
npm and Spago fetches the package set's sources from the registry — takes about a
minute, and emits ~1.2 MB. Commit both artifacts.

Nothing in CI runs `build.sh`. `signatures.sh` **is** run there — it needs only the
pinned `purs` and Node, both of which CI installs — so a doc comment edited without a
regeneration is a diff CI fails on. The tarball is verified by its **declared
contents** instead: a test in `purescript.compile.rs` unpacks the
committed tree and compares every package and module against the manifest, so a tree
rebuilt with a different set and committed without its manifest fails. `spago.yaml`
and `spago.lock` are committed so that what went in is reviewable even though what
came out is a binary.

## Where the rest of the arm lives

| | |
| --- | --- |
| The compile, the isolation, the two failure bands | [`crates/gg/src/sandbox/language/purescript.compile.rs`](../../crates/gg/src/sandbox/language/purescript.compile.rs) |
| What the SDK looks like and why | [`crates/gg/src/sandbox/language/purescript.rs`](../../crates/gg/src/sandbox/language/purescript.rs) |
| Why the arm has no component of its own | [`crates/gg/src/sandbox/language/purescript.rs`](../../crates/gg/src/sandbox/language/purescript.rs) |
| The end-to-end proof, through gg's real linker and store | `crates/gg/src/sandbox/language/purescript.substrate.test.rs` |
| The narrative | [Program languages](../../apps/docs/src/content/docs/gg/program-languages.md) |
