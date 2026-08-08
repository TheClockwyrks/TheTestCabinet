# `gg-sandbox-csharp`

The **C#** arm of gg's [responses-as-code](../../apps/docs/src/content/docs/gg/responses-as-code.md)
capability: the guest that evaluates a model's C# program, and the build that produces it.

Not an npm package. This directory is a build, and what it commits lives elsewhere:

| Artifact | What it is |
| --- | --- |
| `crates/gg/src/sandbox/guests/csharp.component.wasm` | The guest — Mono's IL interpreter, the .NET class libraries and ICU, as one self-contained wasm component exporting gg's `sandbox` world (34.9 MB) |
| `crates/gg/src/sandbox/checkers/csharp.toolchain.json` | What built it, and what is in it |

## The strategy, in one paragraph

**Roslyn on the host, a Mono IL interpreter in the guest.** A model's reply is compiled to an
IL assembly by `csc` in ~0.3 s, base64-encoded into the world's existing `program` string,
and loaded by the committed component above. That is the same shape the Python and Ruby arms
have — one committed runtime, a payload per turn — rather than the shape Rust, Swift and C++
have, and it is the whole reason C# is affordable. A prior feasibility study priced this arm
on the only toolchain it looked at, `componentize-dotnet` (NativeAOT-LLVM, which compiles the
*program* to native wasm): 25–43 seconds a turn, and the arm was cut as impractical.

## How the guest binds gg's WIT world

It does not need to. `dotnet/runtime#113868` — closed unresolved — says there is no supported
path for binding a custom WIT world from managed .NET code, and this arm never asks for one:

- the component is **C**. Microsoft publishes Mono's wasm build as static archives *plus the
  C that links them* (`src/driver.c`, `src/runtime.c`, `src/pinvoke.c`), precisely so the
  runtime can be relinked with an embedder's own natives. `build.sh` compiles those together
  with `wit-bindgen`'s C bindings for `crates/gg/wit` and `Sources/shell.c`.
- the **managed** half reaches gg through `mono_add_internal_call`, Mono's embedding API for
  exactly this. It is older than wasm and needs no build-time code generation.

## What `build.sh` does

1. Fetches its own .NET SDK, its own full wasi-sdk and the Mono WASI runtime pack into
   `.build/` — all three developer-only, none of them in the gg toolchain image.
2. Runs the runtime pack's **own** MSBuild tasks to generate the pinvoke table, the
   interpreter's managed-to-native thunks, `runtimeconfig.bin`, and the bundle objects that
   carry the class libraries and ICU.
3. Compiles the runtime pack's C, gg's bindings and `Sources/shell.c` for `wasm32-wasip2`.
4. Links a **reactor** component with wasi-sdk's `wasm-component-ld`.

Nothing in CI runs it. It is a developer's command, run deliberately when a pin in
`csharp-version.sh` moves or `Sources/shell.c` changes, and committed with its output —
which is why `crates/gg/src/sandbox/language/csharp.manifest.test.rs` compares the committed
component and the shell's digest against the manifest, and fails when one of the two was
rebuilt without the other.

```sh
packages/gg-sandbox-csharp/build.sh
```

## What a *run* needs

Much less: a .NET runtime, Roslyn and the reference assemblies — ~122 MB, installed by
`scripts/ci/install-dotnet.sh` and by `containers/gg-toolchains/Dockerfile`. **No wasm
toolchain reaches a run container on this arm**, because nothing about a C# program is
compiled to wasm.

## What is deliberately absent from the class library

- **`System.Net.Http`'s native handler.** Its WASI implementation is a set of `[DllImport]`s
  against `wasi:http/outgoing-handler@0.2.0`, which gg's world does not declare and gg's
  linker does not define — a guest carrying them cannot be encoded as a component at all. The
  assembly is bundled, so the types exist and a program compiles against them; what is gone
  is the transport under `HttpClient`. A program reaches the network through the `shell` tool,
  as every other arm does.
- **`System.Security.Cryptography`**, which is the *runtime's* gap rather than gg's: Mono's
  wasi build ships the types as ones that throw `PlatformNotSupportedException`. Measured,
  not assumed — `csharp.substrate.test.rs` drives it — and nothing gg can do restores it.

## What is not built yet

The **SDK**, and therefore the registration. `bound-tools` answers an honest empty list, and
the two internal calls `Sources/shell.c` registers (`Gg.Native::Log`, `Gg.Native::ReadFile`)
exist to prove both directions of the membrane from a real C# program rather than to be a
surface. See `crates/gg/src/sandbox/language/csharp.rs` for what the SDK step adds and why
this arm must not be registered before it.
