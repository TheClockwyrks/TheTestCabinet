---
title: "Ruby"
---

A Ruby program is compiled to JavaScript on the host by Opal, and evaluated by a
guest component carrying Opal's runtime pre-initialised into it. The program
crosses the membrane as JavaScript, and everything it is evaluated against is
Ruby.

gg's SDK, the agent's own code modules and the declared library set are all
compiled into the guest as requirable units and none of them is loaded. A
program reaches gg's surface by writing `require "gg"`, its own loaded code by
writing `require "lib"`, and a library by writing `require "json"`. A program
that writes none of those lines has Opal's corelib and its own text.

## Preparation

The whole reply is compiled as `program.rb`, at its top level, with no wrapper
and no prologue. The compile runs in the preparation's own workspace, writes the
JavaScript the guest evaluates, and appends a v3 source map with
`sourcesContent` stripped. The guest decodes that map only when something
raised, so a located run-time error names the line of Ruby the model wrote.

## Code modules

A skill's or memory's code is a module when it is spelled `.rb`, and that is the
arm's only extension. `packages/gg-sandbox-ruby/src/knowledge.rb` is the
requirable unit `lib`, registered in the guest's require registry and left
unloaded, which is how gg's own SDK is supplied as well. A program reaches its
modules by writing `require "lib"` and reaches one export at `lib.<key>.<name>`,
where the key is the skill's or memory's name in `snake_case` and ASCII-only. A
program that writes no such line runs no line of anybody's module.

Requiring `lib` evaluates each module the agent has used, in the order gg handed
them over, and defines a top-level `lib` whose members are the binding keys. It
names nothing of gg's surface, so it is not a second way to reach `GG::Files`. A
module whose body raises leaves an empty namespace, and the guest reports the
raise on its own channel.

A Ruby file has no exports, so a module's source is compiled wrapped in
`Module.new do … end`. The block is evaluated against a fresh anonymous
`Module`, what the body defines is what the key offers, and an author writes no
export protocol. The wrapper names nothing of gg's and shares the author's first
line, so every module diagnostic is already at the author's own number and
nothing corrects one afterwards.

Ruby's `require` is process-wide. A module whose own body calls gg writes
`require "gg"` in it, exactly as a program does, and from that point `GG::`
resolves for the program too. gg writes no `require` on anybody's behalf, and
nothing of its surface is loaded before the program's first line.

The names gg reports for a module are its top-level methods, `def name` and
`def self.name`, in source order, with Ruby's own privacy honoured. A bare
`private` or `protected` line makes everything below it private, and a
`private def name` makes that one method private. Each name carries its `def`
line as the declaration a documentation view quotes, together with the comment
block written above it. A Ruby declaration writes no types, so the type views an
agent's `docViewTypes` flags ask for are empty on this arm.

A constant is not reported, because a constant assigned inside a block belongs
to the block's lexical scope rather than to the module it is evaluated against,
so `lib.<key>.LIMIT` does not exist however the file is written.

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
| `ruby.component.wasm` | the guest: the ECMAScript component with Opal's runtime pre-initialised, and gg's SDK, `lib` and the declared libraries registered in its require registry |
| `ruby.opal.cjs` | the host-side compiler, as one CommonJS bundle with gg's driver at the end of it |
| `ruby.compiler.json` | which Opal that is, and which Ruby it emulates |

One build cuts all three out of one resolved Opal release, so the SDK's two
lowerings to JavaScript are of one vintage.

This arm has a guest component of its own rather than sharing the ECMAScript
one. `componentize-js` runs the entry module's top level under `wizer` and
snapshots the heap, so Opal's runtime is built once into the artifact instead of
once per program. That component's imported interfaces must be exactly the
ECMAScript guest's.

Two further guest requirements follow from that substrate. Ruby's `$stdout` and
`$stderr` are pointed at `console` on every run, because Opal picks its write
procedure once at load, while `wizer` is pre-initialising. Every array the
membrane hands back is re-made in the guest module's realm, because an array the
generated bindings built carries prototypes Opal never patched.

## The SDK and the signature catalogue

The SDK is hand-written Ruby under `packages/gg-sandbox-ruby/src/gg/`, compiled
into the component as the requirable unit `gg`. Thirteen modules are declared,
`GG::Core` last and carrying types alone. A call is a module function on the
module that owns the capability, `GG::Files.read_file`, and a type is written
under the module that produces it, `GG::Files::TextFile`. A failed call raises
`GG::Core::ApiError`, which is a `StandardError` with a Symbol `code`. Every
module of the catalogue states `require "gg"` as the line a program writes to
reach it, and a documentation view quotes it.

`require "gg"` runs the SDK's whole top level, which binds every declaration
onto its module. A call this agent was not granted reaches the host and comes
back as an `ApiError` naming the capability it needed. The rules that surface
obeys are on [the agent surface](/gg/languages/agent-surface/).

`GG::Scope` lifts each module function off its module and puts it back behind a
forwarder that checks the positional count and refuses a keyword the target does
not declare, raising `ArgumentError` naming the accepted set. Opal lowers
keyword arguments to a trailing hash and ignores keys the target does not
declare, so `create_issue(reviewer: [...])` would otherwise file an issue with
no reviewer. Programs, the SDK and the libraries are compiled with Opal's
`arity_check` on, so a call with the wrong number of positional arguments raises
rather than binding a missing parameter to `undefined`.

Requiring the SDK is what a turn pays for the invariant: measured on this
repository's dev container, a program costs 2.7 ms without the line and 20.4 ms
with it, against 2.1 ms for a plain JavaScript program on the same component.
The compile above dominates either figure, at roughly 127 ms for the same
program.

`packages/gg-sandbox-ruby/src/library.rb` declares what a program may `require`.
The build compiles exactly that set, together with whatever those in turn
require, out of the pinned Opal release's own sources, and the catalogue's
`libraries` section is reflected from the same file, so the sentence a model
reads and the modules the component carries have one source. Pattern matching is
baked in as well, since Opal lowers `case … in` into a corelib module.

The catalogue is reflected by `packages/gg-sandbox-ruby/signatures.sh`, which
runs YARD over the SDK's own documentation and reads `GG::Surface.registry` for
operation identity. A `@raise` tag names an error type the function declares, and
the catalogue carries those types as that function's `throws` list. It is written
into the build's `OUT_DIR` and embedded from there, parsed once per process and
checked to name Ruby.

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
class, its message and the line of the model's own Ruby. The program and each
code module are evaluated as their own unit, under a name of their own, so the
guest locates the program's own frame and maps it through the program's own map.
A raise inside a code module is therefore reported at the line of the program
that called into it. A frame's line is the compiled unit's line, because each
unit is evaluated by an indirect `eval` rather than through the `Function`
constructor, and the source map is the only thing that moves a location.

`exit` ends the program by raising `SystemExit` carrying the status the program
chose, which is what Ruby raises there, and the raised object answers `status`
and `success?`. `abort` writes its message and ends with status 1, and `exit!`
ends without running the `at_exit` blocks. Opal delegates process termination
to its host and defines none of the three, so this guest supplies them.

Opal's `sleep` is a busy wait rather than a park in a host call, so the
execution deadline reaches it as it reaches any other runaway.

## Prompt segment

[`system-code.hbs`](/gg/prompts/) reaches this arm through a segment gated on
`ruby`, and `code-nothing-shown.hbs` through a clause naming `puts`. The segment
states:

- the reply is executed exactly as written, as the whole of a `program.rb` at its
  top level, whose last expression's value goes nowhere;
- statements and definitions sit side by side, and the model writes the `require`
  lines it would normally write.

Each entry of the module list beside it carries `require "gg"` as the line that
brings that module into scope.

The arm names `opal` as its [checker](/gg/languages/compilation/), so the shared
body states that a program is compiled before it runs and one the compiler
refuses is not executed. The declared library set is carried by a compile
failure rather than by the prompt.

## Code mask

The arm keeps one byte-level lexer, `ruby.mask.rs`, answering which bytes of a
source are code. It reads five string shapes: `'…'`, `"…"` with `#{…}`
interpolation, backtick command literals, the `%w[…]` family, and heredocs —
and `#` line comments plus column-zero `=begin`/`=end` blocks. A regex literal
is the one shape it deliberately does not read: `/…/` cannot be told from
division without a parse, so a regex carrying a quote makes the scan decline.
Its reader is the [code-module analysis](#the-sdk-and-the-signature-catalogue),
which must not take a `def` written into a string for one the module declares.

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
