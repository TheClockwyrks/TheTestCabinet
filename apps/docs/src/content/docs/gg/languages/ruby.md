---
title: "Ruby"
---

A Ruby program is compiled to JavaScript on the host by Opal, and evaluated by a
guest component carrying Opal's runtime, gg's Ruby SDK and the declared library
set pre-initialised into it. The program crosses the membrane as JavaScript, and
everything it is evaluated against is Ruby.

## Preparation

The whole reply is compiled as `program.rb`, at its top level, with no wrapper
and no prologue. The compile runs in the preparation's own workspace, writes the
JavaScript the guest evaluates, and appends a v3 source map with
`sourcesContent` stripped. The guest decodes that map only when something
raised, so a located run-time error names the line of Ruby the model wrote.

A code module, the code half of a skill or a memory, is compiled the same way
with its source wrapped in `GG::Lib.define do … end`. The block is evaluated
against a fresh anonymous `Module` which extends itself, so what the body
defines is what `lib.<key>` offers and an author writes no export protocol. The
wrapper adds one line, and a diagnostic's line number is moved back over it so
an author reads their own.

The names gg reports for that module are its top-level methods, `def name` and
`def self.name`, in source order, with Ruby's own privacy honoured. A bare
`private` or `protected` line makes everything below it private, and a
`private def name` makes that one method private. A constant is not reported,
because a constant assigned inside a block belongs to the block's lexical scope
rather than to the module it is evaluated against, so `lib.<key>.LIMIT` does not
exist however the file is written.

## Toolchain and build outputs

Opal has a self-hosted build, so the compiler is itself Ruby compiled to
JavaScript and gg carries it inside its own binary. Nothing is installed in the
run container: the compiler runs under the `node` every run image ships, found
on `PATH` or at `TCAB_GG_NODE`. A compile is killed at 60 seconds and reported
as a toolchain failure.

`warm_prepare` materialises the 2.9 MB bundle into a shared toolchain directory
whose key folds in the pinned Opal release and a digest of the bundle itself.
Every concurrent compile points `NODE_COMPILE_CACHE` at one writable directory
beside it, which is content-addressed and validated on read.

`packages/gg-sandbox-ruby/build.sh` is the arm's one producer and writes three
artifacts into the artifact crate's `OUT_DIR`, from which gg embeds them:

| Artifact | What it is |
| --- | --- |
| `ruby.component.wasm` | the guest: the ECMAScript component with Opal's runtime, gg's Ruby SDK and the declared libraries pre-initialised |
| `ruby.opal.cjs` | the host-side compiler, as one CommonJS bundle with gg's driver at the end of it |
| `ruby.compiler.json` | which Opal that is, and which Ruby it emulates |

One build cuts all three out of one resolved Opal release, so the SDK's two
lowerings to JavaScript are of one vintage.

This arm has a guest component of its own rather than sharing the ECMAScript
one. `componentize-js` runs the entry module's top level under `wizer` and
snapshots the heap, so Opal's runtime is built once into the artifact instead of
once per program, and a code module, which is evaluated before the program
against the same scope, can see it. That component's imported interfaces must be
exactly the ECMAScript guest's.

Two further guest requirements follow from that substrate. Ruby's `$stdout` and
`$stderr` are pointed at `console` on every run, because Opal picks its write
procedure once at load, while `wizer` is pre-initialising. Every array the
membrane hands back is re-made in the guest module's realm, because an array the
generated bindings built carries prototypes Opal never patched.

## The SDK and the signature catalogue

The SDK is hand-written Ruby under `packages/gg-sandbox-ruby/src/gg/` and baked
into the component. Thirteen modules are declared, `GG::Core` last and carrying
types alone. A call is a module function on the module that owns the capability,
`GG::Files.read_file`, and a type is written under the module that produces it,
`GG::Files::TextFile`. A failed call raises `GG::Core::ToolError`, which is a
`StandardError` with a Symbol `code`.

Every declaration is bound onto its module at load time and stays bound for
every program of every run. A call this agent was not granted reaches the host
and comes back as a `ToolError` naming the capability it needed. The rules that
surface obeys are on [the agent surface](/gg/languages/agent-surface/).

`GG::Scope` lifts each module function off its module and puts it back behind a
forwarder that checks the positional count and refuses a keyword the target does
not declare, raising `ArgumentError` naming the accepted set. Opal lowers
keyword arguments to a trailing hash and ignores keys the target does not
declare, so `create_issue(reviewer: [...])` would otherwise file an issue with
no reviewer. The lifting and the reflection happen at load, inside the
snapshotted heap. Programs, the SDK and the libraries are compiled with Opal's
`arity_check` on, so a call with the wrong number of positional arguments raises
rather than binding a missing parameter to `undefined`.

`packages/gg-sandbox-ruby/src/library.rb` declares what a program may `require`.
The build compiles exactly that set, together with whatever those in turn
require, out of the pinned Opal release's own sources, and the catalogue's
`libraries` section is reflected from the same file, so the sentence a model
reads and the modules the component carries have one source. Pattern matching is
baked in as well, since Opal lowers `case … in` into a corelib module.

The catalogue is reflected by `packages/gg-sandbox-ruby/signatures.sh`, which
runs YARD over the SDK's own documentation and reads `GG::Surface.registry` for
operation identity. It is written into the build's `OUT_DIR` and embedded from
there, parsed once per process and checked to name Ruby.

## Checking and failures

The checker is `opal`, so the compile is recorded as this arm's compile time on
the succeeding and the failing path alike. The driver gg writes into the bundle
states the outcome in its exit code, because a compiler that refused a program
and one that could not start both exit non-zero.

| Exit | What happened | How it is reported |
| --- | --- | --- |
| 0 | compiled | the JavaScript, from the workspace |
| 20 | Opal refused the Ruby | a syntax error, with Opal's own message and, where the parser located it, the model's own line |
| 21 | Opal raised something that is not a refusal of the Ruby | a compile error, still the model's to answer |
| anything else | the compiler could not finish | gg's own defect, which the model is never shown and which ends the run |

A rejection is structurally one diagnostic, since the driver catches a single
thrown `SyntaxError`, so this arm declares no diagnostic cap. Both refusals a
model can act on arrive as one band: Ruby the parser could not read, and valid
Ruby this compiler has no lowering for. The shared preparation machinery behind
that split is on [compilation](/gg/languages/compilation/).

There is no type check, so a wrong positional count or an undeclared keyword
reaches the model as an `ArgumentError` naming the count and the accepted
keywords while the program runs. That holds for the model's own methods and for
the SDK's functions, since Opal's corelib arrives already compiled with the
check off.

At run time an uncaught exception ends the program and is reported with its
class, its message and the line of the model's own Ruby. Opal's `sleep` is a
busy wait rather than a park in a host call, so the execution deadline reaches
it as it reaches any other runaway.

## Prompt segment

[`system-code.hbs`](/gg/prompts/) reaches this arm through a segment gated on
`ruby`, and `code-nothing-shown.hbs` through a clause naming `puts`. The segment
states:

- the reply is the top-level body of a program, whose last expression's value
  goes nowhere;
- a failed call raises `GG::Core::ToolError`, a `StandardError` that `rescue`
  catches, and its `code` is a Symbol;
- optional arguments are keyword arguments with defaults, `*items` is variadic
  and `&body` is a block, and each module is a constant the guest already
  carries.

The arm names `opal` as its [checker](/gg/languages/compilation/), so the shared
body states that a program is compiled before it runs and one the compiler
refuses is not executed. The declared library set is carried by a compile
failure rather than by the prompt.

## Healing dialect

The healing dialect reads `ruby` and `rb` as the fence tags of a program. A `#`
line is never prose, because a Ruby comment and a Markdown heading are the same
byte. The lexical mask reads five string shapes: `'…'`, `"…"` with `#{…}`
interpolation delimited by brace counting, `` `…` ``, the `%w[…]`/`%q(…)` family
and `<<~EOS` heredocs, beside `#` line comments and `=begin`/`=end` blocks. A
regular-expression literal is not read, since `/…/` cannot be told from division
without a parse, and the scan declines where it loses its place.

## The idiomatic Ruby surface

The SDK is spelled the way a Ruby library is:

- a block where a Ruby author expects one, so the calls whose last argument is a
  long body take it as one: `GG::Files.write_file("notes.md") { body }`. An
  entry may therefore carry more than one signature;
- a `Range` is a span: `GG::Context.archive_thread(4..19, 30...36)`;
- splats where the argument is a list, with an array accepted in place of one;
- a boolean reader ends in `?`, and the catalogue's member names do too;
- a result carries `==`, `hash`, `to_h`, `inspect` and `deconstruct_keys`, so
  two reads of one file compare equal and a `case … in` destructures;
- a read is a `GG::Files::TextFile` or a `GG::Files::ImageFile`, narrowed with
  an ordinary `case … when` rather than by a discriminant;
- a fixed choice is a Symbol, `GG::Tasks.update_task(id, status: :done)`.

Opal's `Symbol` is `String`, so the SDK validates every fixed choice against its
accepted set by hand and refuses an unknown one with `invalid-argument` naming
every symbol that would have worked.
