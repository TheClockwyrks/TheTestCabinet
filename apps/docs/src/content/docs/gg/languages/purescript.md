---
title: "PureScript"
---

## The arm

An agent whose `responses-as-code` capability sets `language: "purescript"`
answers each turn with a PureScript module. `purs` compiles that module to
JavaScript on the host, `esbuild` flattens the module graph into one ES module,
and the [ECMAScript guest](/gg/languages/ecmascript-guest/) evaluates it. What
crosses the sandbox membrane is JavaScript.

`purs` reads the reply and nothing else. The model writes its own module header,
its own `main :: Effect Unit`, an `import Gg.Files as Gg.Files` for every gg
module it calls and an `import Lib.CsvTools as CsvTools` for every code module it
uses, so every compile diagnostic is already in the model's own coordinates and
nothing gg offers is in scope before the program asks for it.

A run-time frame is read back through the source map `purs` and `esbuild` both
emit: `esbuild` composes the two into the bundle it writes, and gg reads the
composition with a standard source-map library. A frame in the model's own
PureScript names the model's own file and line, a frame in a library names that
library's own module, and a frame in gg's own SDK is struck.

The compile workspace, compiler isolation, the two failure bands and the
diagnostic bound are shared with the other program languages and are described
on [compilation](/gg/languages/compilation/).

## Program shape

A program is a module with its own `module … where` header and a `main` of type
`Effect Unit`. The module name is the model's, and nothing reads it. gg derives
the bundler's entry point from the module directory `purs` wrote for the
response, which is the one directory in the compiler's output that neither the
shipped library set nor a loaded code module claims.

The previous response's module directory is removed from that output at the
start of every program compile, so a module name a later response reuses still
resolves to that response's own build.

A name the shipped library set or a loaded code module already publishes is
`DuplicateModule` at line 1 of the model's own file, which is the compiler's own
answer. A reply with no header is `ErrorParsingModule` at line 1, and a program
that compiles but declares no `main` is refused with a sentence naming the type
it must define.

## Code modules

A code skill's or memory's module is an ordinary PureScript module with its own
`module … where` header and its own export list, and gg files it under
`Lib.<Key>` by rewriting the name in that header. The header is located through
the arm's code mask, so a `module` written inside a leading comment is comment
rather than header. The rewrite occupies the author's own header line and adds
none, so every diagnostic is at the line the author wrote. A file with no header
is `ErrorParsingModule` at line 1, which is the compiler's own answer.

`<Key>` is the binding key, which on this arm is PascalCase and ASCII: a skill
named `csv-tools` is keyed `CsvTools` and compiled as `Lib.CsvTools`. A key that
would open with something other than an upper-case letter is prefixed `Module`,
because a PureScript module name is a proper name.

The module is compiled into the same `purs` project as the program that uses it,
so the program reaches it the way it reaches any other module. The project is the
agent's: the staged library set and `purs`'s own output directory are laid out
once for the agent and kept across its preparations, so a module compiled at the
read that bound it stays compiled. The line is the
key's own:

```
import Lib.CsvTools as CsvTools
```

and an export is `CsvTools.parse`, type-checked by `purs` against the module's
own signature. `ProgramLanguage::lib_import` states that line and
`ProgramLanguage::lib_access` states `CsvTools.<name>`.

Using a skill or a memory compiles its module on its own first, under the name
`Lib.<Key>` it will be reached by, so an author's mistake is a located diagnostic
naming the skill rather than a failure of the next program that has it in scope.
Its file is written into the loaded-module band of the agent's compile workspace,
where `purs` finds it up to date on every later program. gg reports the lower-case
value names among its exports, with the type names each signature writes in return
and in parameter position. That reading is over the module as written: it walks
the source a byte at a time to split a signature at its top-level constraint and
function arrows. PureScript accepts two spellings of each, so a constraint ends
at `=>` or `⇒` and an argument ends at `->` or `→`, and a signature
written in either spelling declares the same parameters.

`.purs` is the arm's only module file extension.

## Toolchain

`purs` and `esbuild` are executables the run image carries. Each is looked for
in the operator's override, then in the toolchain image's directory, then on
`PATH`.

| Executable | Override          | Image path               | Timeout |
| ---------- | ----------------- | ------------------------ | ------- |
| `purs`     | `TCAB_GG_PURS`    | `/opt/gg/toolchains/bin` | 120 s   |
| `esbuild`  | `TCAB_GG_ESBUILD` | `/opt/gg/toolchains/bin` | 60 s    |

The first compile of a process reads `purs --version` once and refuses a release
that disagrees with the one recorded in the shipped manifest, naming both
releases and where the pinned one is installed from. Externs are a
compiler-version-private format, so a compiler of another release reads the
shipped library tree as a wall of errors in gg's own files. A `--version` that
cannot be read cleanly is treated as machine variation, and the compile that
follows reports whatever is really wrong.

`packages/gg-sandbox-purescript/purescript-version.sh` is the one pin. The
toolchain image's build and the installer a developer and CI run both read it,
so the `purs` in an image is the release that compiled the library set gg
carries.

`checker()` is `"purs"`, so the compile is recorded as the turn's compile time
on the failing path as well as the succeeding one.

## Build outputs

`crates/gg-sandbox-artifacts/purescript` runs
`packages/gg-sandbox-purescript/build.sh` and produces two artifacts, reached by
`crates/gg` through `GG_ARTIFACTS_PURESCRIPT` and embedded in the gg binary.

| Artifact                      | Contents                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `purescript.libraries.tar.gz` | The declared library set, compiled with `--codegen js,sourcemaps`, with this arm's SDK staged into the same tree and compiled with it |
| `purescript.compiler.json`    | The pinned `purs` and `esbuild` releases and the packages and modules the tree holds                                                  |

The library set is declared by `packages/gg-sandbox-purescript/spago.yaml` and
resolved against a pinned registry package set. `purs` requires both the sources
and the compiled externs of everything a program imports, so the tree ships
compiled and inside the binary. It is compiled with the codegen set a turn's
compile uses, because `purs` treats a module built for a different set as stale.
`warm_prepare` unpacks it once per machine into a content-keyed shared toolchain
directory, sealed read-only, and each agent hard-links one tree out of that one
at its first preparation.

The project directory and the compiler's output directory are declared as
persistent work, so the reset the next preparation pays leaves both standing. A
program's compile then removes from that output directory every module directory
the shipped library set and this turn's loaded code modules do not claim, so
what survives a preparation is the library set and the loaded modules' builds.
The two files at the root of `output/` that `purs` rewrites are staged as real
copies.

## SDK and signature catalogue

The SDK is `packages/gg-sandbox-purescript/src/Gg/`: one module per capability
(`Gg.Files`, `Gg.Shell`, `Gg.Board`, …) plus `Gg.Core`, which binds no
capability and carries the failure types, `attempt`, `apiError` and
`apiErrorCode`. Each module carries an explicit export list.
`Gg.Internal.Wire` is the only module that reaches gg's own SDK: its foreign half
writes `import * as gg from "gg"`, which `esbuild` leaves external and the guest's
loader resolves to the instance a TypeScript program shares, so a call the agent
was not granted arrives as an `ApiError` carrying `unavailable` from the host. The
rules every arm's SDK obeys are on
[the agent surface](/gg/languages/agent-surface/).

Every call crosses that bridge in one engine frame, which is what keeps the
model's own innermost frame inside the
[guest's ten-frame capture](/gg/languages/ecmascript-guest/). The value a call
answers with is read inside that same frame, once the call has returned.

`packages/gg-sandbox-purescript/signatures.sh` reflects the catalogue with
`purs compile --codegen docs`, run against the shipped library tree with this
package's working `src/` staged over the copy inside it. `crates/gg/build.rs`
hands that tarball over as `GG_PURESCRIPT_LIBRARIES` and embeds the resulting
`purescript.signatures.json` from the build's `OUT_DIR`. `crates/gg` must depend
on `gg-artifact-purescript` as an ordinary dependency, because the reflection
requires the tarball that crate builds. The arm asserts that the catalogue it
loads was generated for PureScript.

Doc comments carry what an ML signature cannot:

- `# Operation` names the operation a declaration reaches, and `# Alias` marks a
  declaration as an alias of one.
- `# Arguments` names and describes each argument in call order.
- `# Fields` names and describes every field of a record type, and only those.
- `# Throws` names the error types a declaration declares, which the catalogue
  carries as that declaration's `throws` list.
- A row-typed optional argument is printed flat with its optional fields marked
  `limit?`, since `Record given` alone describes nothing.

The reflector refuses to emit a catalogue that violates any of those: a
signature's documented arguments must match it in count and order, every field
of a record argument must be documented, every documented field must exist, and
no entry may be blank. `spago.yaml` groups each package under a
`# --- Heading ---` line, and those headings are the groups of the catalogue's
`libraries` section.

## Failures

`purs` is invoked with `--json-errors`, so a rejection arrives as structured
diagnostics carrying the compiler's own error code and span.

| What happened                                                                      | How it is reported                                                                             |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ErrorParsingModule` or `ErrorParsingFFIModule` in the model's file                | `PrepareError::Syntax`                                                                         |
| Any other `purs` error code in the model's file                                    | `PrepareError::Compile`                                                                        |
| `esbuild` reporting no matching export for `main`                                  | `PrepareError::Compile`, with a sentence saying the program must define `main :: Effect Unit`  |
| `purs` reporting a diagnostic only in a loaded module's file                       | `PrepareFailure::Lowering`, naming the key — the module compiled on its own when it was loaded |
| `purs` reporting only diagnostics in gg's shipped library files                    | `PrepareFailure::Toolchain`                                                                    |
| A compiler that could not run, was killed, timed out, or reported nothing readable | `PrepareFailure::Toolchain`                                                                    |
| A `purs` release disagreeing with the manifest's pin                               | `PrepareFailure::Toolchain`                                                                    |
| The response's module directory not identifiable in the compiler's output          | `PrepareFailure::Toolchain`, naming what was found                                             |

Diagnostics in the model's own file are deduplicated and capped at eight, since
`purs` reports one error per site. The band is decided over the whole set before
the cap applies, so a parse error the cap did not show still makes the whole
verdict a syntax failure.

A run-time failure is reported by capture: nothing catches a program's throw,
and the engine's own rendering is reported to gg over `feedback.report-error`
with the failure's class, so the turn is a `program_fault` rather than a
`sandbox_trap` — `program_api_error` for an uncaught `ApiError`,
`program_throw` for anything else a program throws. `Gg.Core.attempt` is how a
program handles a failure it expects.

Every frame in that rendering is read back through the map `purs` and `esbuild`
composed, so a frame in the model's own code names `program.purs`, a frame in a
loaded code module names `Lib.<Key>.purs`, and a frame in a library names that
library's module. `purs` maps a definition that takes no argument to its
type-signature line, so a frame in one reports the signature rather than the
body.

Three kinds of frame name neither the model's code nor a library and are struck
instead, with the report closing on how many went: gg's own bundler entry, a
position in the flattened bundle the composed map resolves nothing for, and this
arm's own SDK. The SDK is struck under both names it carries in the composed map,
its PureScript sources under the library directory the manifest names it by and
the JavaScript `purs` emitted for its `Gg.` modules.

## The idiomatic PureScript surface

The SDK is spelled the way a PureScript library is:

- Capability modules of free functions, imported under their own full name. The
  import line aliases a module to itself, so `import Gg.Files as Gg.Files` makes
  `Gg.Files.readFile` both the catalogue key and the expression a call site
  writes.
- A follow-up call over a value is a free function taking the whole value, since
  a record carries fields rather than methods.
- Optional arguments are one record argument whose row is checked
  (`Union given rest ReadOptions`), so `{}` and `{ limit: 20 }` both type-check
  and a misspelled field is a type error naming the fields that would have
  worked.
- A three-way patch field is `Maybe`: leave the field out to keep the value,
  pass `Nothing` to clear it, pass `Just` to replace it.
- A fixed choice is a `data` type and a read is a sum type a program matches on.
- A failure is thrown, and `Gg.Core.attempt` hands back `Either ApiError a` and
  re-throws anything that is not a gg failure.
- A child agent's brief is a constructor, `Prompt` or `Issue`, so exactly one of
  the two type-checks.
- A loaded code module is a module like any other: the program writes
  `import Lib.CsvTools as CsvTools` and calls `CsvTools.parse`.

## Prompt segment

[`system-code.hbs`](/gg/prompts/) reaches this arm through a segment gated on
`purescript`, and `code-nothing-shown.hbs` through a clause naming
`Effect.Console.log`. Both quote every function name from the catalogue rather
than writing one out. The segment states that the reply is compiled verbatim as
one module, with its own header, its own `import` lines and a
`main :: Effect Unit` written as a `do` block, and that the module name is the
model's to pick. Each entry of the module list beside it carries that module's
own import line, `import Gg.Files as Gg.Files`, so the path a module is listed
under is the expression a call site writes.

The arm names `purs` as its [checker](/gg/languages/compilation/), so the shared
body states that a program is compiled before it runs, that one `purs` refuses
is not executed, and that a call the run withheld compiles and fails when it
runs.

## Code mask

The arm keeps one byte-level lexer, `purescript.mask.rs`, answering which bytes
of a source are code: `"…"` with escapes, `"""…"""` raw strings, `-- …` line
comments — recognised only where the dashes are not part of an operator like
`-->` — and nested `{- … -}` block comments, with the prime-versus-character
rule for `'`. It has two readers: the code-module analysis, which must not take
a declaration written into a string for one the module makes, and the header
rewrite that files a code module under `Lib.<Key>`. A source that does not lex
cleanly declines the mask, and both readers then read the source as it stands.

Every source is UTF-8 and the lexer reads all of it: a comment, a string or a
character literal may hold text outside ASCII. Every delimiter the scan looks
for is ASCII, so the scan stays byte-indexed and tests bytes directly. A
character literal holds one character of whatever width, and a quote following
an identifier character is a prime whether that character is ASCII or not.
