---
title: "Registering a language"
---

A registered language is one implementation of the `ProgramLanguage` trait
(`crates/gg/src/sandbox/language.rs`) plus the files the build produces for it.
The registry is an exhaustive `match` over `GgProgramLanguage`, so a variant
added to the core enum fails to compile until it is registered, and a registered
language is then covered by every gate that iterates the registered set.

Registration is additive. Adding an arm leaves the WIT world, the host's
`OperationApi`, the membrane, the gate model and every other language's
implementation untouched.

## Trait requirements

| What it supplies | What it is |
| --- | --- |
| An id and a display name | The id is the config value, the telemetry value, and the stem every one of the arm's artifacts is filed under. The display name is what an operator reads in gg's own output. |
| A member separator | The punctuation between an API object and one of its functions, `.` by default and `::` for a language whose objects are modules. Names come from the catalogue; this joins the two halves. |
| Program preparation | Turning a model's reply into the source its guest evaluates, given the code modules already in that agent's scope. |
| A checker name | What a program of this language is judged by, spelled as the language's own users spell it (`tsc`, `rustc`), or nothing for a prepare step that invokes no compiler. |
| Module preparation | Turning a [code skill](/gg/skills/)'s or [code memory](/gg/memories/)'s file into the library this arm supplies to a program, the way it supplies gg's own SDK, compiled under the key it is bound at. |
| Module file extensions | The extensions a skills directory spells `skill.<ext>` and `on-use.<ext>` with, most preferred first, never empty. |
| A binding name rule | A skill's authored name mapped to an identifier this language parses. Non-empty, and stable for a given name. |
| A `lib` access form | How a program reaches one export of a loaded module, stated in the documentation view of that export. A path by default; an arm that reaches a module by string supplies its own. The arm states the line a program writes to reach the module itself on the same terms, alongside the line that reaches gg's SDK. |
| A guest component | The prebuilt `.wasm` that evaluates prepared source, or nothing for an arm that compiles the program itself into a component. |
| A signature catalogue | Every module, signature, argument, type and type member the model reads, reflected out of the arm's own SDK by the language's own documentation tool. |
| A prompt segment | The arm's gated segment of `system-code.hbs` and of `code-nothing-shown.hbs`, keyed by the arm's id. |
| A file-view statement | The one statement that opens a view of a path, whole or windowed, terminated the way this language terminates a statement. |
| A documentation-view program | A whole program that opens one documentation view per name, which is the on-use script of every built-in family skill. |
| A bootstrap program | A whole program that lists the named modules in one search and opens the documentation of each named key, which gg runs to seed a fresh window. |

### Program preparation

The prepare step is called concurrently, and what it returns must be a function
of its source alone. An implementation compiles through the `PrepareContext` it
is handed and through nothing else, and one that runs a compiler reports which
of the two failures it hit. Both rules are set out on
[compilation](/gg/languages/compilation/).

### The checker

Naming a checker has three consequences. Every program of the arm is timed on
the failing path as well as the succeeding one, the sandbox reports that time,
and the system prompt states the checker's name and the sections a checked arm's
model needs. An arm cannot name a compiler and go untimed, or be timed and leave
its model with half a sentence.

### The prompt segment

One `system-code.hbs` serves every arm, and an arm reaches it through a segment
gated on its own id. A segment states the shape of a whole reply in that
language and names no type: how the language reports a failure and how a call's
arguments are passed are the language's own, and a documentation view renders
the whole signature. A gate holds it to two paragraphs and to a character bound,
so anything an arm could report at the moment it matters is reported there
instead. See [prompts](/gg/prompts/).

### The bootstrap program

The program gg runs to seed a fresh window is the arm's own, generated from the
module list and the documentation keys gg hands it, either of which may be
empty, in which case the program carries no search or no opens. It is one
program by the arm's own rules, meaning one module, one `main` or one translation unit where
the language wants one. It is the model's first example of its own output, so it
is written the way that arm's users write, down to how it handles a failed call.

### Guest shapes

An interpreted arm answers with a prebuilt component holding a whole language
runtime, and every program crosses the membrane as a string that runtime
evaluates. A compiled arm answers with nothing there and hands back the bytes it
compiled on the prepared program instead, because its compiler produces the
program rather than an interpreter of it. Exactly one of the two is present.

A component may be shared by two arms that differ only in what gg does to a
program before handing it over, and such sharing is declared in the seam's
exemption table. A catalogue is always the arm's own, and the arm asserts that
the one it embedded carries its own id.

### Test-only hooks

Three trait methods have defaults that are right for almost every arm and exist
for the ones they are wrong for:

- `gate_module`, for a language whose code module is a different shape from a
  program, so a gate that drives the module step has a module to drive;
- `isolation_readable`, for an arm whose artifact rides over the wire in a
  transport encoding. An implementation may only reveal more bytes, never drop,
  mask, reorder or summarise any;
- `isolation_marker_forms`, for an arm whose compiler stores a string literal in
  an encoding a byte-for-byte search would miss. Every form returned must be
  derived from the marker.

### The artifacts

Nothing gg embeds is committed. Each arm's `build.sh` writes the files its row
promises into `$GG_ARTIFACTS_OUT_DIR`, driven by a crate under
`crates/gg-sandbox-artifacts/<arm>/` whose `links` key carries the output
directory to `crates/gg`'s build script, and the arm's module embeds them from
there. `crates/gg/build.rs` runs `scripts/gg-signatures.sh` with its destination
set to `$OUT_DIR/signatures`, and each arm embeds the catalogue filed under its
stem from there. A build of gg therefore cannot embed a catalogue older than the
SDK sources in the same checkout.

What that costs is that building gg requires every arm's documentation
toolchain. `scripts/ci/install-gg-toolchains.sh` installs the lot, idempotently,
and every surface that builds gg runs it.

### WASI

The guest binds `crates/gg/wit/gg-sandbox.wit`, of which there is one copy. gg's
linker defines the whole WASI p2 surface for every guest unconditionally, so a
guest instantiates with nothing added to the host and nothing stubbed out of the
guest. The one thing withheld is stdout, which carries gg's telemetry stream.

The execution deadline is delivered by epoch interruption, which fires only
where the guest is executing wasm. A guest parked inside a synchronous WASI call
is executing none, so a program sleeping in one long park runs that park out.
Nothing stalls, because the program runs on a blocking thread, and the membrane
refuses every bridged call once the budget is spent.

## Adding a language

Build the arm in three passes: the substrate first, so that a program provably
crosses the membrane and comes back; then the surface, the SDK and its
catalogue; then the registration. The registry's `match` is exhaustive, so an
arm cannot be half-registered. The surface is still checked before the enum
carries the arm's id: the fixture language
(`crates/gg/src/sandbox/language/fixture.rs`) holds its catalogue per instance,
so an unregistered arm's reflected catalogue is driven through the capability
gate wearing it, and every tool is driven through the real membrane from the new
arm's spelling against the same expected JSON every other arm asserts. A
constructor added for that check is removed by the step that registers the arm.

The Python arm ([its arm page](/gg/languages/python/)) is the worked example
below.

1. Create the package. `packages/gg-sandbox-<id>/`, holding the guest sources,
   the version pins that decide what the artifact contains, a `build.sh` and a
   `signatures.sh`. Both scripts take their destination from an environment
   variable, `GG_ARTIFACTS_OUT_DIR` and `GG_SIGNATURES_OUT_DIR` respectively,
   and fail saying so when it is unset. `signatures.sh` writes its catalogue and
   nothing else, so anything else it needs gets its own script.
2. Decide the library set here, if the arm offers one. The libraries this
   language's own authors reach for by default belong in it, so that the arm
   measures the language rather than how a model copes without its idioms. What
   a program may import is a property of the artifact, and the file that decides
   it is the one the catalogue's `libraries` section is reflected out of.
   Declaring it in a template instead produces a sentence a model reads and the
   component contradicts.
3. Hand-write the SDK, idiomatic for the language and obeying the rules every
   agent-facing surface obeys. Python's is
   `packages/gg-sandbox-python/src/gg/`, one module per capability. Which
   capabilities exist and what gates each one is fixed; the spelling of every
   name, the argument idiom, the error mechanism and the type shapes are the
   language's own.
4. Emit the catalogue as `<id>.signatures.json`, reflected out of the SDK by
   the language's own documentation tool. Python's reads the SDK statically with
   griffe. Reflect the prose rather than restating it: the reflector must refuse
   to emit a blank description, a signature that documents none of its
   arguments, or an entry documenting no argument where gg's operations table
   says the operation takes one.
5. Wire the build. Three files under `crates/gg-sandbox-artifacts/<arm>/`
   (`Cargo.toml` with `links = "gg-artifact-<arm>"`, a `build.rs` calling
   `gg_artifact_build::arm("<arm>")`, an empty `src/lib.rs`), one `members` line
   in the root `Cargo.toml`, one entry in `crates/gg/Cargo.toml`'s
   `[dependencies]`, and one entry in the `rerun_paths` table in
   `crates/gg-sandbox-artifacts/build-support`. The dependency edge must be an
   ordinary dependency; declared as a build dependency, the `DEP_*` variable
   carrying the output directory is simply absent. List the arm's real inputs in
   the rerun set and nothing a build writes into.

   Re-include every `packages/` directory the arm reads in the root
   `.dockerignore`, which is an allowlist. The images that build gg copy the
   whole context and compile these packages, so a missing entry fails inside the
   arm's own build rather than at a `COPY`. `scripts/ci/build-context.sh` is the
   gate.
6. Add the row to `scripts/gg-arms.sh`, which is the one list of gg's arms. A
   row names the id, the package, the label a person reads while it runs, the
   catalogue stems the reflector promises to write, and the artifact files
   `build.sh` promises to write. Both orchestrators check afterwards that every
   promised file landed non-empty. Add the same arm's reflector inputs to
   `crates/gg/build.rs`'s rerun set.
7. Decide where the compiler lives, if the arm type-checks the model's program.
   A compiler small enough to be an artifact is cut by the arm's `build.sh` and
   embedded in gg's binary, which is what stops a program being judged by one
   release and described by another. A real toolchain goes in
   `containers/gg-toolchains/Dockerfile` instead, because gg is copied into a
   run container as a single file.
8. Add the enum variant in `crates/core/src/gg.rs`, list it in
   `GgProgramLanguage::ALL`, and give it an `ordinal()` arm. Neither can be
   forgotten: the `match` is exhaustive and each arm checks its own position
   against `ALL` in a `const` block.
9. Implement the trait in `crates/gg/src/sandbox/language/<id>.rs`, and add the
   arm's segment to `system-code.hbs` and to `code-nothing-shown.hbs` in
   `crates/gg/templates/`. A segment names no catalogued function of any arm,
   because the shared template is judged against every arm's spellings at once.
10. Install the run-time toolchain, if the arm needs one, in
    `containers/gg-toolchains/Dockerfile`. It installs under
    `/opt/gg/toolchains` and nowhere else, is relocatable across the Debian- and
    Ubuntu-based run images, carries under its own root every shared library
    those images do not supply, and is drivable with a per-invocation working
    tree and output directory. A `COPY` that reads the build context must have its
    path re-included in the applicable `.dockerignore`, which is an allowlist;
    `scripts/ci/build-context.sh` is the gate that catches a missing
    re-inclusion. Add the arm's documentation tool to
    `scripts/ci/install-gg-toolchains.sh`.
11. Add the console's row: one name in `PROGRAM_LANGUAGE_NAMES`
    (`packages/ui/src/app/pages/gg/programLanguages.ts`). The capability
    editor's picker spreads that same table, so it needs an entry only when the
    arm requires an annotation a reader choosing it must have. Both are a
    `Record` over the `GgProgramLanguage` union, so a missing key is a
    TypeScript error. The prompt editor and the reference document need nothing:
    one seeds the same code default whatever the language, the other walks
    `GgProgramLanguage::ALL`.
12. Run the gates. The isolation gate drives the new arm's program and module
    steps sixteen ways and requires every artifact to carry its own input. The
    authorship gate drives the same two steps and records what the preparation
    did to the bytes it was handed. The runtime-failure gate drives five shapes
    of failure through the arm's real preparation and run and requires the
    report the model reads to name the fault and to carry a location wherever
    the language reports one. The last two each hold a table of the cells an arm
    does not satisfy, so an arm that starts satisfying one fails until its rows
    are deleted. The capability gate holds the new catalogue to gg's operations
    table operation by operation. The prompt gate renders `system-code.hbs` for
    the new arm under every context fixture and checks every required section,
    every configured value, the ending call, every rule a program runs under,
    and that the render carries this arm's segment and no other arm's, within
    the two-paragraph and character ceilings. The bootstrap gate prepares and
    runs the arm's bootstrap program and requires the views it promised, and
    [`gg selfcheck`](/gg/languages/selfcheck/) drives that same round trip
    inside a built `-gg` run image of each lineage, which is where the arm's
    toolchain is held to what the image supplies. The spelling gates refuse a
    segment that names a catalogued function of any arm.

Every step is either a new file the arm owns or a one-line registration the
compiler refuses to let anyone skip.
