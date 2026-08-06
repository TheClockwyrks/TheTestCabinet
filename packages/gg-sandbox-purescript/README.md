# `gg-sandbox-purescript` — gg's PureScript library set

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
does bake is the thing `purs` cannot work without — the **library set, compiled**.

It is not an npm workspace member and has no runtime dependents. Its output is two
**committed artifacts** in the Rust crate, named for the language rather than for
this package:

| Artifact | What it is |
| --- | --- |
| [`crates/gg/src/sandbox/checkers/purescript.libraries.tar.gz`](../../crates/gg/src/sandbox/checkers/) | Every package's PureScript sources beside the externs and JavaScript `purs` emitted for them. **~1.2 MB** gzipped, ~14 MB unpacked, `include_bytes!`d by the host and unpacked once per machine. |
| [`crates/gg/src/sandbox/checkers/purescript.compiler.json`](../../crates/gg/src/sandbox/checkers/) | What that tree was built from — `purs`, `esbuild` and registry versions — and what is in it, package by package. |

## Why the tree is committed, and why the compiler is not

`purs` cannot type-check a program without both the **sources** and the compiled
**externs** of everything it imports: given externs alone, every import is
`ModuleNotFound` (measured). Compiling the set from scratch costs ~16 s, which no
turn can pay. So it is compiled once, here, and shipped inside gg's binary — where
it cannot drift from the SDK that will be compiled into it, because they are one
file.

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
| `src/` | This package's own PureScript. Today one placeholder module Spago needs to resolve a package at all; the hand-written, idiomatic `Gg.*` SDK modules land here. |
| `build.sh` | Vendors the toolchain, resolves the set, stages the sources, compiles, packs and writes the manifest. |

## Rebuilding

```sh
packages/gg-sandbox-purescript/build.sh
```

Run it after changing `spago.yaml`, `purescript-version.sh` or `src/**`. It needs
Node and network access — the pinned `purescript`, `spago` and `esbuild` come from
npm and Spago fetches the package set's sources from the registry — takes about a
minute, and emits ~1.2 MB. Commit both artifacts.

Nothing in CI runs it. `scripts/ci/contract-drift.sh` verifies the tarball by its
**declared contents** instead: a test in `purescript.compile.rs` unpacks the
committed tree and compares every package and module against the manifest, so a tree
rebuilt with a different set and committed without its manifest fails. `spago.yaml`
and `spago.lock` are committed so that what went in is reviewable even though what
came out is a binary.

## Where the rest of the arm lives

| | |
| --- | --- |
| The compile, the isolation, the two failure bands | [`crates/gg/src/sandbox/language/purescript.compile.rs`](../../crates/gg/src/sandbox/language/purescript.compile.rs) |
| Why the arm has no component of its own | [`crates/gg/src/sandbox/language/purescript.rs`](../../crates/gg/src/sandbox/language/purescript.rs) |
| The end-to-end proof, through gg's real linker and store | `crates/gg/src/sandbox/language/purescript.substrate.test.rs` |
| The narrative | [Program languages](../../apps/docs/src/content/docs/gg/program-languages.md) |
