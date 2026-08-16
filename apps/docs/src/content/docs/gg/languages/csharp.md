---
title: "C#"
---

This arm keeps three of the [invariants](/gg/responses-as-code/invariants/) for a
program: it compiles the model's own bytes, writes no import around them, and
locates every diagnostic and every runtime frame in the model's coordinates. A
code module is put in a class gg declares around it, which the invariants place
outside the authorship rule.

The one it does not keep is shared rather than this arm's. A guest's standard
error is trimmed to a byte budget without counting what it dropped, so a stack
overflow reaches the model as a report that begins part way through a frame and
says nothing about the frames above it.

## Preparation

The arm is selected per agent by the responses-as-code capability's `language`
parameter, with the value `"csharp"`. A model's reply is compiled verbatim as
`program.cs` in the preparation's own workspace. Nothing is prepended, appended
or re-indented, so a diagnostic at line 7 is line 7 of what the model wrote and
this arm subtracts no offset anywhere. Every way a C# program may begin is
accepted, and the prompt directs a model to top-level statements.

Roslyn compiles the reply to a .NET assembly on the host, and the assembly is
base64-encoded into the string a prepared program carries its source in. The
guest is a prebuilt component holding Mono's IL interpreter and the .NET class
library, so nothing about a C# program is compiled to wasm. A prepared program
carries no component of its own.

One `csc` invocation compiles the program, the SDK's sources and the code
modules in scope, driven by a response file in the workspace. It declares
`-nostdlib+`, `-langversion:14.0`, `-nullable:enable`, `-optimize+`,
`-debug:embedded`, `-pathmap:`, `-deterministic`, `-utf8output`, the target, the
output path, and `-r:` for
every `.dll` under the toolchain's `ref/` directory, sorted. `-debug:embedded`
puts a portable PDB inside the assembly, which is the only place one can travel
to the guest, and `-pathmap:` maps the preparation's own workspace onto `./` so
that what a stack trace names is `./program.cs` rather than a path that differs
between two preparations of the same program. `-noconfig` goes on
the command line, which is the only place `csc` honours it. The compiler is run
as `dotnet exec roslyn/bincore/csc.dll`, never through the `csc` shim, which
would start Roslyn's resident compiler server, and never through msbuild. A
compile that exceeds 60 seconds is killed and reported as a toolchain failure.
The arm names `csc` as its checker, so compile time is recorded on the failing
path as well as the succeeding one, and it performs no warm-up, so Roslyn's
start-up cost lands in the first turn a process compiles.

## Toolchain and build artifacts

The toolchain is a .NET tree rather than a `dotnet` on `PATH`, because the
reference assemblies decide what a program may call and must match the class
library inside the guest. gg looks in `TCAB_GG_DOTNET_HOME` when an operator
sets it, then `/opt/gg/toolchains/dotnet`, then `~/.local/share/tcab/gg-dotnet`.
A tree is usable only when it holds `dotnet/dotnet`, `roslyn/bincore/csc.dll`
and a `ref/` directory. A partial one is rejected rather than allowed to fail as
a compile error, and a machine's own .NET installation is never used. The
installer deletes Roslyn's `VBCSCompiler`, so a resident compiler server shared
between two preparations is absent from the tree rather than merely unused.

`crates/gg-sandbox-artifacts/csharp` runs `packages/gg-sandbox-csharp/build.sh`
and publishes one file, `csharp.component.wasm`, which is not committed. The arm
reaches it through `GG_ARTIFACTS_CSHARP` and embeds it in the gg binary. The
component is Mono's own runtime-pack sources relinked for `wasm32-wasip2`
together with `wit-bindgen`'s C bindings for gg's world and the C in
`packages/gg-sandbox-csharp/Sources/`. Managed code never binds the WIT world;
it reaches gg through `mono_add_internal_call`. The class libraries and ICU are
bundled into the component as in-memory resources, so the guest boots with zero
preopens and loads exactly one assembly per run. Building it needs a second,
larger toolchain than a run does: a full .NET SDK and an unpruned wasi-sdk,
installed by `scripts/ci/install-gg-build-toolchains.sh`.

## SDK and signature catalogue

The SDK is 26 `.cs` files under `packages/gg-sandbox-csharp/src/Gg/`, embedded
in the gg binary as source and written into each preparation's workspace under
`sdk/`, a path that is also what tells a diagnostic in gg's own SDK apart from
one in the model's program. A test requires the embedded list and the directory
to be equal. Compiling the SDK with the program is how `csc` is told the library
exists, which is what an `--extern` or a classpath entry is on another arm. It
puts no name in the program's scope.

Every module's catalogue entry states `using Gg;` as the line a program writes,
and a documentation view quotes it. A program reaches a call either by writing
that line and then the module's last segment, or by writing the module's path in
full. The .NET class libraries are reached the same way, so a program that calls
`Console.WriteLine` writes `using System;` first. Source gg synthesizes for this
arm writes the path in full, because a synthesized statement may be joined with
others into one program and a `using` may not stand between two statements.

The surface is twelve capability modules, each a `public static partial class`
in `namespace Gg`, plus a class-less `core` module whose `ToolException` and
`ToolErrorCode` sit directly in `namespace Gg`. Result types are nested in the
module that produces them, so `Gg.Files.FileRead` is both a name a program
writes and the name a documentation view is opened by. gg writes no
`using static`, because the module prefix is what says which module documents a
call.

The catalogue is reflected by a hosted Roslyn driver over the SDK's XML
documentation comments, generated by `crates/gg/build.rs` into the build's own
`OUT_DIR` and uncommitted like the component. The arm asserts that the catalogue
it parses names C#. A function's operation identity is a `<ggop>` element on its
own declaration and a module's is a `<ggmodule>` element on its class, and
`tools/Catalogue.cs` holds only the module identities and the order a model
meets them in, which must equal the classes in both directions. The `libraries`
section is read from the heading groups in `libraries.txt`, and the reflector
treats every Roslyn warning as fatal, refusing to emit a catalogue with a blank
description in it.

## Code modules

`lib.<key>` is a `static class` in `namespace lib`, and a code skill's or
memory's module is that class's body. The key is spelled `PascalCase`, because
here it names a type. Line numbers do not move in either direction, because gg
emits `#line` rather than subtracting a header's height.

The leading run of `using` directives is hoisted out of the class body, each
with a `#line` of its own, so a `using` naming something the guest does not
carry is reported where the author wrote it. That is also how a module reaches
gg's surface: an author writes `using Gg;` as a program does. A `namespace`
declaration and a
`global using` are each refused with a message naming what to write instead, and
a module that declares no `public` member is refused. Exports are every `public`
declaration at the top level of the body, types and members alike, read from a
lexical mask rather than a parse.

A module is compiled alone with `-target:library` when it is read, so its author
gets a diagnostic in their own coordinates, and again as an input to every
program that binds it. It never becomes a second assembly.

## Failures

`csc` exits non-zero both for a program it rejected and for a run it could not
finish, so a rejection is recognised by Roslyn's own diagnostic format. Only
lines carrying `error CS` count. A warning is neither shown as a rejection nor
allowed to decide a band.

| What happened | How it is reported |
| --- | --- |
| Roslyn's parser refused it | a syntax error, at the model's own coordinates |
| Only the binder refused it | a compile error, at the model's own coordinates |
| Every diagnostic is inside gg's SDK | a toolchain failure naming gg |
| No diagnostic was reported at all | a toolchain failure |

Roslyn's command line does not say which stage raised a diagnostic, so gg asks
its parser. `packages/gg-sandbox-csharp/tools/Parse.cs` is a parse-only driver
run on the failing path only: it prints the parser's own errors, and empty
output means the program parsed. It is built once per machine into a
content-keyed shared directory, placed by rename and sealed read-only, which is
the only thing this arm shares between preparations. When it cannot be built or
cannot answer, the rejection is reported as a compile error, the wider band.

Diagnostics located inside gg's SDK are gg's defect and reach the operator,
unless `csc` also complained about the model's file, in which case the model's
own diagnostics are what it is shown. That partition is taken over every
reported error before anything is dropped for length. What the model reads is
deduplicated and bounded at eight diagnostics, and the bound never moves an
error between bands. The rules these bands follow are on
[compilation](/gg/languages/compilation/).

At run time the guest is a real .NET runtime, so `try`, `catch` and `finally`
work, and an unhandled exception reports `Exception.ToString()`: the type, the
message and the managed frames. Each frame carries the file and line the
assembly's own debug information gives for it, so a frame in the model's program
reads `./program.cs:line 5`. The guest initialises Mono's debug lookup before it
loads the runtime, which is what makes that information readable.

A program that ends by returning a non-zero status from its entry point is
reported with the status it chose. That is the one failure C# reports without
throwing.

## Prompt segment

[`system-code.hbs`](/gg/prompts/) reaches this arm through a segment gated on
`csharp`, and `code-nothing-shown.hbs` through a clause naming
`Console.WriteLine`. Neither names a catalogued function, on the terms
described in [agent surface](/gg/languages/agent-surface/). The segment states:

- the reply is compiled verbatim as one compilation unit, written as the
  `using` lines it needs followed by top-level statements;
- every call throws, and an expected failure is a `ToolException` whose `Code`
  is an `enum`;
- everything gg offers is in the namespace `Gg`, a name is written in full or
  under its own `using` line, and optional arguments are defaults passed by name
  to a module that is a `static class`.

The arm names `csc` as its [checker](/gg/languages/compilation/), so the shared
body states that a program is compiled before it runs, that one the compiler
refuses is not executed, and that a call the run withheld compiles and fails
when it runs. The referenced namespace set is carried by a compile failure
rather than by the prompt.

Source gg synthesizes for this arm is written in the same idiom:
`Gg.Views.OpenFile("src/Program.cs");`, with a window passed as the call's own
`offset:` and `limit:` arguments.

## The idiomatic C# surface

This arm's SDK is written as C# is written. Members are `PascalCase`, results
are `record`s, a fixed choice is an `enum`, nullable reference types are
enabled, optional arguments are default values passed by name, a list the wire
carries is a `params` list, and a failure is a thrown `ToolException` rather
than a returned status.

```csharp
using Gg;

Files.EditFile("src/Program.cs", "old", "new");
var built = Shell.Run("dotnet build", timeoutSeconds: 300);
Views.OpenText("build", built.Output);
```

A value a call hands back carries the calls that belong to it, each catalogued
as an alias of the module function it repeats. There is no logging function. The
SDK redirects `Console.Out` onto gg's feedback channel from a
`[ModuleInitializer]`, so `Console.WriteLine` reaches the run's operator.

## Healing dialect

The arm reads a fenced block tagged `csharp`, `c#` or `cs` as the program. `#`
is not treated as code punctuation, so a Markdown heading above a fenced program
stays deletable. A line whose `#` is followed by one of thirteen preprocessor
directive words spelled lower-case is read as code, and statement keywords are
matched case-sensitively.

One lexer serves both healing and the module reader, classifying every byte as
code, text or the inside of an interpolation hole. It reads raw string fences of
any quote count, verbatim strings that escape a quote by doubling it, and holes
containing further strings. Healing takes a mask only when the scan ended
cleanly, and the module reader takes the best reading whatever happened.
