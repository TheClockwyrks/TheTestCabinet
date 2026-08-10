# `gg-sandbox-ruby`

The **Ruby guest** for gg's [responses-as-code](../../apps/docs/src/content/docs/gg/responses-as-code.md)
sandbox: the hand-written Ruby SDK a model is given, the libraries a program may require,
and the **Opal compiler** gg turns a model's Ruby into JavaScript with.

It is not an npm workspace package and it exports nothing. It is three build scripts, one
entry module and a directory of Ruby, and everything it produces is committed in the Rust
crate that embeds it:

| Artifact | Written by | What it is |
| --- | --- | --- |
| `crates/gg/src/sandbox/guests/ruby.component.wasm` | `build.sh` | the JavaScript engine with Opal's runtime, this SDK and the curated libraries pre-initialised into it |
| `crates/gg/src/sandbox/guests/ruby.signatures.json` | `signatures.sh` | the signature catalogue, reflected out of this SDK's own YARD documentation |
| `crates/gg/src/sandbox/checkers/ruby.opal.cjs` | `compiler.sh` | Opal — runtime, self-hosted compiler and gg's driver — as one CommonJS bundle |
| `crates/gg/src/sandbox/checkers/ruby.compiler.json` | `compiler.sh` | which Opal that is, and which Ruby it emulates |

`build.sh` and `compiler.sh` read their pins from `opal-version.sh`, and there is exactly
one Opal pin because every artifact has to be the same Opal: the compiler emits JavaScript
against a runtime's private conventions, and a program compiled by one release and
evaluated against another's runtime does not fail cleanly.

## The strategy

**A Ruby program is compiled to JavaScript on the host, and evaluated by a guest whose
whole surface is Ruby.** Nothing crosses the membrane as Ruby, and everything the compiled
program is evaluated *against* is Ruby: the capability modules are constants under `GG`
(`GG::Files`, `GG::Views`), each declaring the types it produces, a failure is a raised
`GG::Core::ToolError`, and a code module is an anonymous `Module` bound at `lib.<key>`.

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
| `src/library.rb` | the manifest of what a program may `require`. `build.sh` compiles exactly this set out of the pinned Opal's own sources; `signatures.sh` reflects the same lines into the catalogue's `libraries` section. One file decides both. |
| `src/shim.js` | the entry module: it imports the runtime, the libraries and the SDK at top level (so `wizer` snapshots them), publishes the membrane where `GG::Wire` can reach it, and owns `run`. |

Its documentation is **the** documentation. Every YARD comment on a catalogued method,
parameter, type and type member is what gg renders the system prompt and every
documentation view from; there is nowhere else for a description of this surface to live,
which is what stops one from drifting.

## Why there is a second component at all

Because Opal's 743 KB runtime has to be somewhere, and where it is decides what a turn
costs. Measured through gg's own store and linker, on this repository's dev container:

| Where the runtime lives | Per program |
| --- | --- |
| Prepended to the program, evaluated in the committed ECMAScript component | 45.6–51.0 ms |
| Imported by `src/shim.js`, so `componentize-js` pre-initialises it | **2.1–2.6 ms** |
| (a plain JavaScript program on the same component, for scale) | 1.2–1.4 ms |

`componentize-js` runs the entry module's top level at build time under `wizer` and
snapshots the resulting heap, so the corelib, the libraries and this SDK's classes are
built once, into the artifact, instead of once per turn. Building the run's *surface* is
still per run and costs the rest of what a turn costs: **4.8 ms with no tool bound and
7.7 ms with all thirty-five**.

Two further things settled the question, and either would have on its own:

- **A code module could not have seen a prepended runtime.** A skill's or memory's module
  is evaluated *before* the program and against the same surface, so a runtime living
  inside the program's own source would not exist yet. `lib.<key>` in Ruby would have been
  unimplementable.
- **Baking it into the *shared* component was worse.** It would put `globalThis.Opal` in
  front of the TypeScript and JavaScript arms too, and those two must differ in the type
  check and in nothing else — a checked program cannot name `Opal` (no declaration covers
  it) and an unchecked one can.

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
packages/gg-sandbox-ruby/compiler.sh     # the host-side compiler (Node only; CI runs this)
packages/gg-sandbox-ruby/signatures.sh   # the signature catalogue (Ruby + YARD; CI runs this)
packages/gg-sandbox-ruby/build.sh        # the guest component (needs componentize-js)
```

`build.sh` is not wired into a build. It is run by hand, deliberately, and its output is
committed alongside the source change that motivated it. Run it after changing
`crates/gg/wit/gg-sandbox.wit`, anything under this package's `src/`, or the pins in
`opal-version.sh` — and run `signatures.sh` alongside it whenever `src/gg/` or
`src/library.rb` changed, because the catalogue is reflected out of exactly those.
