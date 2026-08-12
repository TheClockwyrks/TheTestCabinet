# `gg-sandbox-csharp`

The **C#** arm of gg's [responses-as-code](../../apps/docs/src/content/docs/gg/responses-as-code/overview.md)
capability: the guest that evaluates a model's C# program, the hand-written SDK that program calls,
and the builds that produce both.

Not an npm package. This directory is a set of builds, and what they produce lives elsewhere —
in the `OUT_DIR`s of the two crates that run those builds. **Nothing here is committed:**

| Artifact | What it is |
| --- | --- |
| `csharp.component.wasm`, in `crates/gg-sandbox-artifacts/csharp`'s `OUT_DIR` | The guest — Mono's IL interpreter, the .NET class libraries, ICU and gg's bridge, as one self-contained wasm component exporting gg's `sandbox` world (35.3 MB). Built by `build.sh`, which that crate runs on every build whose declared inputs moved. |
| `csharp.signatures.json`, in the build's `OUT_DIR` | The **catalogue** — every module, signature, argument, type and type member a model is told about, in the normalized schema, reflected out of the SDK's own XML documentation comments by `signatures.sh`, which `crates/gg/build.rs` runs. |

`build.sh` used to write a `csharp.toolchain.json` beside the component — the pins, the source
digests and the byte count a drift test recomputed from the checkout. It went with the committing:
it was the only one of the per-arm toolchain declarations that nothing on the turn path read, so
once the component was generated it described a question nobody could ask. `build.sh` records what
each part of it became.

| | |
| --- | --- |
| [`csharp-version.sh`](csharp-version.sh) | every toolchain release this arm is pinned to |
| [`src/Gg/`](src/Gg/) | the **SDK** a model's program is compiled against, and the documentation comments every word a model reads is reflected out of |
| [`Sources/`](Sources/) | the guest's C: the shell, the bridge, and the interpreter trampolines |
| [`libraries.txt`](libraries.txt) | the namespaces this arm says a program may reach, grouped as the prompt shows them |
| [`build.sh`](build.sh) | builds the guest into `$GG_ARTIFACTS_OUT_DIR` |
| [`signatures.sh`](signatures.sh) | reflects the catalogue out of the SDK, with Roslyn, into `$GG_SIGNATURES_OUT_DIR` |
| [`tools/`](tools/) | the reflector `signatures.sh` runs and the identity table it reads, plus [`Parse.cs`](tools/Parse.cs) — the parse-only Roslyn driver gg builds and runs on a rejected program, to tell a typo from a program written against the wrong surface |

## The strategy, in one paragraph

**Roslyn on the host, a Mono IL interpreter in the guest.** A model's reply is compiled to an
IL assembly by `csc` in ~0.28 s, base64-encoded into the world's existing `program` string,
and loaded by the prebuilt component above. That is the same shape the Python and Ruby arms
have — one prebuilt runtime, a payload per turn — rather than the shape Rust, Swift and C++
have, and it is the whole reason C# is affordable. A prior feasibility study priced this arm
on the only toolchain it looked at, `componentize-dotnet` (NativeAOT-LLVM, which compiles the
*program* to native wasm): 25–43 seconds a turn, and the arm was cut as impractical.

## How the guest binds gg's WIT world

It does not need to. `dotnet/runtime#113868` — closed unresolved — says there is no supported
path for binding a custom WIT world from managed .NET code, and this arm never asks for one:

- the component is **C**. Microsoft publishes Mono's wasm build as static archives *plus the
  C that links them* (`src/driver.c`, `src/runtime.c`, `src/pinvoke.c`), precisely so the
  runtime can be relinked with an embedder's own natives. `build.sh` compiles those together
  with `wit-bindgen`'s C bindings for `crates/gg/wit` and the three files in `Sources/`.
- the **managed** half reaches gg through `mono_add_internal_call`, Mono's embedding API for
  exactly this. It is older than wasm and needs no build-time code generation.

## The SDK, and why it is source rather than a built assembly

`src/Gg/` is twelve capability modules, each a `public static partial class` in `namespace Gg` with
its result types nested inside it, plus a class-less `core` module holding the `ToolException` and
the `ToolErrorCode` that every module's signatures name. It is **compiled with the model's program**, not
referenced as a built assembly — `crates/gg/src/sandbox/language/csharp.sdk.rs` carries the sources
in gg's binary and writes them into the preparation's own workspace beside `program.cs`.

Three things follow, and each of them is why:

- **there is no second assembly for the guest to find.** The guest loads exactly one assembly per
  run: the program's. An SDK compiled separately would have to be bundled *into* the 35.3 MB
  component, so every doc-comment edit would mean re-linking it — a ~26 s build rather than the
  ~70 ms below.
- **the SDK is reviewable.** What a reviewer reads in the diff is what a model compiles against,
  with no binary in between.
- **it costs almost nothing.** ~70 ms on a ~210 ms compile, measured.

What puts it in a model's scope without touching a byte of the model's file is a `global using` the
SDK declares for itself, in `src/Gg/GlobalUsings.cs`. It is the same mechanism .NET's implicit usings
use, and it works here for the same reason: one compilation.

`Console.WriteLine` reaches the run's operator, because the SDK redirects `Console.Out` onto gg's
feedback channel from a `[ModuleInitializer]`. That is why this arm has no logging function in its
catalogue — there is nothing to catalogue, only `Console`.

## What `build.sh` does

1. Fetches its own .NET SDK, its own full wasi-sdk and the Mono WASI runtime pack into
   `.build/` — all three developer-only, none of them in the gg toolchain image.
2. Runs the runtime pack's **own** MSBuild tasks to generate the pinvoke table, the
   interpreter's managed-to-native thunks, `runtimeconfig.bin`, and the bundle objects that
   carry the class libraries and ICU.
3. Compiles the runtime pack's C, gg's bindings and `Sources/*.c` for `wasm32-wasip2`.
4. Links a **reactor** component with wasi-sdk's `wasm-component-ld`.

**`cargo build` runs it**, which is the opposite of what this paragraph used to say. It was a
developer's command, run deliberately when a pin in `csharp-version.sh` moved or a file in
`Sources/` changed, and committed with its output — with a drift test recomputing each source's
digest against a manifest so that a rebuild forgotten was a named failure rather than a silent one.
`crates/gg-sandbox-artifacts/csharp` runs it now, on every build whose declared inputs moved, and
`crates/gg` embeds what lands in that crate's `OUT_DIR`. The gate and the manifest are gone with
the committed component, because "did somebody forget?" is not a question a generated artifact has.

What that costs is the one thing worth knowing about this arm: the toolchains below are needed to
BUILD gg at all now, not merely to work on C#. They are ~1.4 GB no gg *run* needs, which is why
they live in their own prefix and their own installer — see `scripts/ci/install-gg-build-toolchains.sh`.
The devcontainer image and the CI image's `build-toolchains` tag both carry them.

```sh
scripts/ci/install-dotnet.sh                 # once: the toolchain a program compiles with
scripts/ci/install-gg-build-toolchains.sh    # once: the ~1.4 GB that RELINKS the guest
packages/gg-sandbox-csharp/build.sh          # the guest, by hand (cargo build does it for you)
cargo nextest run -p test-cabinet-gg sandbox::language::csharp

GG_SIGNATURES_OUT_DIR=/tmp/sigs \
  packages/gg-sandbox-csharp/signatures.sh   # the catalogue a model reads, to READ
scripts/gg-signatures.sh                     # all eleven, into target/gg-signatures/
```

`signatures.sh` needs only the first of those: `Microsoft.CodeAnalysis.CSharp.dll` ships beside
`csc.dll` in the toolchain a program compiles with, so the catalogue is reflected by the same
compiler, reading the same sources, as the compile itself. You never have to run it for
correctness — `crates/gg/build.rs` runs it on every build of `test-cabinet-gg`, so an XML doc
comment edited in `src/Gg/` reaches the model's prompt on the next `cargo build`. Run it by hand
to *read* what it emitted; a `<returns>` dropped or a `<param>` truncated is invisible in the C#
and plain in the JSON.

## What a *run* needs

Much less: a .NET runtime, Roslyn and the reference assemblies — ~122 MB, installed by
`scripts/ci/install-dotnet.sh` and by `containers/gg-toolchains/Dockerfile`. **No wasm
toolchain reaches a run container on this arm**, because nothing about a C# program is
compiled to wasm.

## What is deliberately absent from the class library

- **`System.Net.Http`'s native handler.** Its WASI implementation is a set of `[DllImport]`s
  against `wasi:http/outgoing-handler@0.2.0`, which gg's world does not declare and gg's
  linker does not define — a guest whose *pinvoke scan* included them could not be encoded as
  a component at all. So `build.sh` keeps that one assembly **in the bundle and out of the
  scan**: the types exist, load and compile, and what is gone is the transport under
  `HttpClient`. A program reaches the network through the `shell` tool, as every other arm does.
- **`System.Security.Cryptography`**, which is the *runtime's* gap rather than gg's: Mono's
  wasi build ships the types as ones that throw `PlatformNotSupportedException`. Measured,
  not assumed — `csharp.substrate.test.rs` drives it — and nothing gg can do restores it.

## What is not built yet

The **registration**: an enum variant, a registry arm, a healing dialect, two prompt templates and
the console's rows — and, under it, code modules. See
`crates/gg/src/sandbox/language/csharp.rs` for what each of those needs and why this arm must not be
registered before them.
