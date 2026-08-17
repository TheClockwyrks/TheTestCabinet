# `gg-sandbox-ruby`

The **Ruby guest** for gg's [responses-as-code](../../apps/docs/src/content/docs/gg/responses-as-code/overview.md)
sandbox: the hand-written Ruby SDK a model is given, the libraries a program may require,
and the **Opal compiler** gg turns a model's Ruby into JavaScript with.

It is not an npm workspace package and it exports nothing. It is two build scripts, one
entry module and a directory of Ruby. All four things it produces are generated into the
`OUT_DIR` of the build that embeds them; **nothing here is committed**:

| Artifact | Written by | What it is |
| --- | --- | --- |
| `ruby.component.wasm`, in the build's `OUT_DIR` | `build.sh`, run by `gg-artifact-ruby` | the JavaScript engine with Opal's runtime pre-initialised into it, and this SDK, `lib` and the curated libraries registered in its require registry |
| `ruby.signatures.json`, in the build's `OUT_DIR` | `signatures.sh`, run by `crates/gg/build.rs` | the signature catalogue, reflected out of this SDK's own YARD documentation |
| `ruby.opal.cjs`, in the build's `OUT_DIR` | `build.sh`, run by `gg-artifact-ruby` | Opal — runtime, self-hosted compiler and gg's driver — as one CommonJS bundle |
| `ruby.compiler.json`, in the same place | `build.sh`, run by `gg-artifact-ruby` | which Opal that is, and which Ruby it emulates |

The last two used to be committed under `crates/gg/src/sandbox/checkers/`, cut by a third
script (`compiler.sh`) that a CI step re-ran and diffed. `crates/gg-sandbox-artifacts/ruby`
now runs `build.sh` as part of building `test-cabinet-gg` and `ruby.compile.rs` embeds the
result out of that build's `OUT_DIR`, so there is no committed copy to be stale and no
third script.

`build.sh` reads its pins from `opal-version.sh`, and there is exactly one Opal pin because
every artifact has to be the same Opal: the compiler emits JavaScript against a runtime's
private conventions, and a program compiled by one release and evaluated against another's
runtime does not fail cleanly.

## The strategy

**A Ruby program is compiled to JavaScript on the host, and evaluated by a guest whose
whole surface is Ruby.** Nothing crosses the membrane as Ruby, and everything the compiled
program is evaluated *against* is Ruby: the capability modules are constants under `GG`
(`GG::Files`, `GG::Views`), each declaring the types it produces, a failure is a raised
`GG::Core::ToolError`, and a code module is an anonymous `Module` bound at `lib.<key>`.

A program reaches any of it by writing Ruby's own `require`. This SDK is the requirable
unit `gg`, the agent's loaded code modules are `lib`, and the curated set is `json`, `set`
and the rest. None of them is loaded until a line of the program says so.

That is what makes this arm cheap in the two places a language arm is usually expensive.
There is no second engine — the compiled program is JavaScript, so a `componentize-js`
guest evaluates it — and there is nothing to install in the run container, because Opal's
compiler is itself Ruby compiled to JavaScript and runs with the `node` every run image
already ships. `containers/gg-toolchains` therefore gains a paragraph rather than a
toolchain.

## What is in `src/`

| | |
| --- | --- |
| `src/gg/` | the SDK: one file per capability module, each declaring that module's functions and the types they produce, plus `core.rb` for what every one of them names. Which gg operation a method binds is written under that method's own `end`, as the `operation` line `surface.rb` records — there is no table naming a function twice. `wire.rb` is the one file that touches the membrane, and the only Ruby here written in JavaScript. |
| `src/knowledge.rb` | the `lib` a program requires to reach its own code modules. Requiring it is what evaluates them. It names nothing of `GG`, so it is not a second way to reach the SDK. |
| `src/library.rb` | the manifest of what a program may `require`. `build.sh` compiles exactly this set out of the pinned Opal's own sources; `signatures.sh` reflects the same lines into the catalogue's `libraries` section. One file decides both. |
| `src/shim.js` | the entry module: it imports the runtime at top level (so `wizer` snapshots it) and the two files that register `gg`, `lib` and the libraries, publishes the membrane where `GG::Wire` can reach it, and owns `run`. |

Its documentation is **the** documentation. Every YARD comment on a catalogued method,
parameter, type and type member is what gg answers a documentation search and every
documentation view from; the system prompt renders no signature at all, and takes only the
module paths and the one-line brief each module introduces itself by. There is nowhere else
for a description of this surface to live, which is what stops one from drifting.

## Why there is a second component at all

Because Opal's 743 KB runtime has to be somewhere, and where it is decides what a turn
costs. Measured through gg's own store and linker, on this repository's dev container:

| Where the runtime lives | Per program |
| --- | --- |
| Prepended to the program, evaluated in the prebuilt ECMAScript component | 45.6–51.0 ms |
| Imported by `src/shim.js`, so `componentize-js` pre-initialises it | **2.1–2.6 ms** |
| (a plain JavaScript program on the same component, for scale) | 1.2–1.4 ms |

`componentize-js` runs the entry module's top level at build time under `wizer` and
snapshots the resulting heap, so Opal's corelib is built once, into the artifact, instead
of once per turn. Loading this SDK is a turn's own cost, because `require "gg"` is the
model's line rather than the build's: **2.7 ms for a program without it, 20.4 ms with it**,
against 2.1 ms for a plain JavaScript program on the same component.

Baking the runtime into the *shared* component was worse than either. It would put
`globalThis.Opal` in front of the TypeScript and JavaScript arms too, and those two must
differ in the type check and in nothing else — a checked program cannot name `Opal` (no
declaration covers it) and an unchecked one can.

## Two things `src/shim.js` does that no SDK could

Both were silent failures before they were fixed, and both are about the seam between the
engine's realms rather than about Ruby.

**Ruby's `$stdout` and `$stderr` are pointed at `console` on every run.** Opal picks its
write procedure once, at load, and captures the `console` that existed while `wizer` was
pre-initialising the component — not the one the shim rebinds to `feedback.log` at the
start of every run. Without it, `puts "hello"` logs nothing at all.

**Every array the membrane returns is re-made in the shim's realm.** The generated
bindings run against a different set of intrinsics (the same split that makes
`instanceof Error` answer false for a binding-level fault), so an array they built carries
*their* `Array.prototype`, which Opal never patched. `entries.map { … }` on a value the
program was *handed* would fail with `$map is not a function`: correct Ruby, refused.

## What a Ruby program is offered

Opal's corelib without requiring anything — `Set`, `Struct`, `Time`, `Math`, `Random`,
`Enumerator` with `lazy`, `Comparable`, `Rational`, `Complex` — plus **pattern matching**,
which is Ruby 3 syntax rather than a library and which the npm runtime bundle does not
carry, so it is baked and loaded here. Beyond that, whatever `src/library.rb` declares.

Opal is not CRuby, and a study has to record that. Integer division is JavaScript's, so
`1 / 0` is `Infinity` where CRuby raises `ZeroDivisionError`; there is no bignum; and
`Symbol` **is** `String`, so `:done == "done"` is true. All three are asserted in
`crates/gg/src/sandbox/language/ruby.substrate.test.rs` rather than described here, so the
claims are checkable against the artifact. The last of them is why the SDK validates every
fixed choice against its accepted set by hand rather than trusting the language to tell a
symbol from a typo.

## Building

```sh
GG_ARTIFACTS_OUT_DIR=/tmp/artifacts \
  packages/gg-sandbox-ruby/build.sh      # the compiler AND the component (needs componentize-js)
scripts/gg-artifacts.sh                  # every arm, into target/gg-artifacts/

GG_SIGNATURES_OUT_DIR=/tmp/sigs \
  packages/gg-sandbox-ruby/signatures.sh # the catalogue, to READ (Ruby + the pinned YARD)
scripts/gg-signatures.sh                 # all eleven, into target/gg-signatures/
```

`build.sh` is wired into `cargo build`: `crates/gg-sandbox-artifacts/ruby` runs it, into that
build's own `OUT_DIR`, whenever anything in its rerun set moves — this package's `src/`, its
`tools/`, `opal-version.sh`, or `crates/gg/wit`. Running it by hand is for *reading* what it
emitted, which is why the destination is required and has no default. It cuts all three of
this arm's artifacts on every run, and that is deliberate rather than incidental: the
component and the host-side compiler are lowered to JavaScript from the same `src/` by the
same script under the same rerun set, which is what makes it impossible for them to be two
vintages. `ruby.rs` embeds the component and `ruby.compile.rs` embeds the compiler and its
manifest, all three out of that one `OUT_DIR`.

`signatures.sh` is the opposite: `crates/gg/build.rs` runs it on **every** build of
`test-cabinet-gg`, so an edit under `src/gg/` or to `src/library.rb` reaches the model's
prompt on the next `cargo build` with nothing to regenerate and nothing to commit. Running
it by hand is for *reading* what it emitted — YARD's `@return` and `@param` prose arriving
whole is the kind of thing only the JSON shows — and it takes its destination from
`GG_SIGNATURES_OUT_DIR` rather than defaulting to one.
