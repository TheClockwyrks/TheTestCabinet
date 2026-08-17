---
title: "PureScript"
---

## The arm

An agent whose `responses-as-code` capability sets `language: "purescript"`
answers each turn with a PureScript module. `purs` compiles that module to
JavaScript on the host, `esbuild` flattens the module graph into one script, and
the `componentize-js` guest evaluates the script as a function body. What crosses
the sandbox membrane is JavaScript.

This arm keeps the [invariants](/gg/responses-as-code/invariants/) import rule: a
program writes `import Gg.Files as Gg.Files` for every module it calls, and
nothing gg offers is in scope before it does. It does not keep the rest yet, and
this page states what it does today. The compile renames the
module header a reply wrote to `Main`, supplies one where a reply wrote none and
moves each diagnostic back by that line, and a guest backtrace is located in the
bundle rather than in the model's PureScript.

The arm evaluates programs in the `componentize-js` guest, which it has to
itself. `purs` compiles a program's own code together with the library code it
reaches into ordinary JavaScript, so the bundle is self-contained and carries no
runtime the component has to hold for it. Moving the arm onto the
[ECMAScript guest](/gg/languages/ecmascript-guest/) is what retires that
component and what puts a backtrace back in the model's own PureScript.

The preparation workspace, compiler isolation, the two failure bands and the
diagnostic bound are shared with the other program languages and are described
on [compilation](/gg/languages/compilation/).

## Program shape

A program is a module whose `main` has type `Effect Unit`. The compile renames
the module header to `Main` in place, so no line moves. A reply with no header
at all is given one, which costs exactly one line and is the number every
diagnostic's line is moved back by. A program that compiles but declares no
`main` is refused with a sentence naming the type it must define.

A code skill's or memory's module is an ordinary PureScript module compiled as
itself, with a bundler entry that re-exports rather than one that runs `main`.
The namespace bound at `lib.<key>` is the module's own export list, and gg
reports the lower-case value names among its exports. A `lib` key is camelCase
with its leading upper-case run lower-cased and ASCII only, so `CSV-tools` binds
at `lib.csvTools`: the key is a record label, which PureScript requires to begin
lower-case. A program reaches an export by string, `Gg.Core.lib "<key>"
"<export>"`, which is the form the reply to the read that bound it quotes.

`.purs` is the arm's only module file extension.

## Toolchain

`purs` and `esbuild` are executables the run image carries. Each is looked for
in the operator's override, then in the toolchain image's directory, then on
`PATH`.

| Executable | Override | Image path | Timeout |
| --- | --- | --- | --- |
| `purs` | `TCAB_GG_PURS` | `/opt/gg/toolchains/bin` | 120 s |
| `esbuild` | `TCAB_GG_ESBUILD` | `/opt/gg/toolchains/bin` | 60 s |

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

| Artifact | Contents |
| --- | --- |
| `purescript.libraries.tar.gz` | The declared library set, compiled, with this arm's SDK staged into the same tree and compiled with it |
| `purescript.compiler.json` | The pinned `purs` and `esbuild` releases and the packages and modules the tree holds |

The library set is declared by `packages/gg-sandbox-purescript/spago.yaml` and
resolved against a pinned registry package set. `purs` requires both the sources
and the compiled externs of everything a program imports, so the tree ships
compiled and inside the binary. `warm_prepare` unpacks it once per machine into
a content-keyed shared toolchain directory, sealed read-only, and each
preparation hard-links its own tree out of that one. The two files at the root
of `output/` that `purs` rewrites are staged as real copies.

## SDK and signature catalogue

The SDK is `packages/gg-sandbox-purescript/src/Gg/`: one module per capability
(`Gg.Files`, `Gg.Shell`, `Gg.Board`, …) plus `Gg.Core`, which binds no
capability and carries the failure types, `attempt`, `toolError`,
`toolErrorCode` and `lib`. Each module carries an explicit export list.
`Gg.Internal.Wire` is the only module that names the guest's own scope objects,
resolving them as free identifiers in the bundle, so a call the agent was not
granted arrives as a `ToolError` carrying `unavailable` from the host. The
rules every arm's SDK obeys are on
[the agent surface](/gg/languages/agent-surface/).

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

| What happened | How it is reported |
| --- | --- |
| `ErrorParsingModule` or `ErrorParsingFFIModule` in the model's file | `PrepareError::Syntax` |
| Any other `purs` error code in the model's file | `PrepareError::Compile` |
| `esbuild` reporting no matching export for `main` | `PrepareError::Compile`, with a sentence saying the program must define `main :: Effect Unit` |
| `purs` reporting only diagnostics in gg's shipped library files | `PrepareFailure::Toolchain` |
| A compiler that could not run, was killed, timed out, or reported nothing readable | `PrepareFailure::Toolchain` |
| A `purs` release disagreeing with the manifest's pin | `PrepareFailure::Toolchain` |

Diagnostics in the model's own file are deduplicated and capped at eight, since
`purs` reports one error per site. The band is decided over the whole set before
the cap applies, so a parse error the cap did not show still makes the whole
verdict a syntax failure. Line numbers are reported in the model's own
coordinates.

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
- A failure is thrown, and `Gg.Core.attempt` hands back `Either ToolError a` and
  re-throws anything that is not a gg failure.
- A child agent's brief is a constructor, `Prompt` or `Issue`, so exactly one of
  the two type-checks.
- `lib key name` hands back `Maybe a` and the program annotates the type it
  expects.

## Prompt segment

[`system-code.hbs`](/gg/prompts/) reaches this arm through a segment gated on
`purescript`, and `code-nothing-shown.hbs` through a clause naming
`Effect.Console.log`. Both quote every function name from the catalogue rather
than writing one out. The segment states:

- the reply is a module whose `main` has type `Effect Unit`, written as
  straight-line `Effect` code in a `do` block, and a `do` block discards a
  statement's value only when it is `Unit`;
- a failed call is thrown rather than returned, and `Gg.Core.attempt` catches
  one as an `Either`;
- optional arguments are the fields of a record argument, with `{}` passing none
  of them and `?` marking an optional field of the row, and each capability
  module is imported under its own full name.

The arm names `purs` as its [checker](/gg/languages/compilation/), so the shared
body states that a program is compiled before it runs, that one `purs` refuses
is not executed, and that a call the run withheld compiles and fails when it
runs. The library set is carried by a compile failure rather than by the prompt.

## Healing dialect

Two of the dialect's lexical answers are this language's own. A `#` line is
prose and is deleted, because PureScript comments with `--` and `{- … -}` and
`#` is an ordinary operator. A `--` line is always code. The carve-out is a
pipeline continuation: an indented single `#` applied to a lower-case name and
an argument is kept.

A call written by juxtaposition carries no bracket, operator, keyword or dot, so
`"` is on the dialect's non-prose character list and the prose test reads the
shape English is written in, a leading capital or terminal punctuation. Two
lexer rules keep the rest of a line readable. A run of dashes opens a comment
only when what follows is not a symbol character, since `-->` is a definable
operator, and a `'` is a prime on an identifier unless it opens a character
literal that closes within the few bytes one can. The scan that reads a code
module's exports reads the same mask.
