//! **C#** — the arm whose compiler emits neither wasm nor source, and the only one that pairs a
//! real compiler on the turn path with a prebuilt runtime that never changes.
//!
//! Everything this arm owns lives here or in one of this module's siblings:
//!
//! * [`compile`] — the host-side `csc`, what it costs, what it refuses, and the two failures it
//!   tells apart;
//! * [`sdk`] — the SDK's sources, carried in gg's binary and compiled into the one assembly every
//!   program references;
//! * [`source`] — what gg writes around a **code module**, and the lexer that lets it look at C#
//!   without parsing it;
//! * `packages/gg-sandbox-csharp/src/Gg/` — that SDK, and the XML documentation comments every word
//!   a model reads is reflected out of;
//! * `packages/gg-sandbox-csharp/Sources/` — the guest's C: the shell, the bridge, the trampolines;
//! * [`GUEST_COMPONENT`] — the guest itself: Mono's IL interpreter, the .NET class libraries and
//!   ICU, as one self-contained component, relinked by `gg-artifact-csharp` on the build that
//!   compiles this module and embedded from its `OUT_DIR` rather than committed anywhere;
//! * the **signature catalogue**, which is the whole of what a model is told about the surface —
//!   reflected out of the SDK's own XML documentation comments and generated into this build's
//!   `OUT_DIR`, the same way and for the same reason (see `crates/gg/build.rs`).
//!
//! # The strategy, in one paragraph
//!
//! **Roslyn on the host, a Mono IL interpreter in the guest.** A model's reply is compiled to an IL
//! assembly by `csc` in ~0.3 s, sent base64-encoded over the world's existing `program` string with
//! the libraries it references, and loaded by a prebuilt component that carries the whole .NET
//! runtime. It is **neither of the two
//! shapes this seam had**: an interpreted arm ([Python](super::python), [Ruby](super::ruby)) sends
//! source to a prebuilt runtime, and a compiled arm ([Rust](super::rust), [Swift](super::swift),
//! [C++](super::cpp)) sends a component and bakes nothing. This sends an *assembly* to a prebuilt
//! runtime — an interpreted arm's artifact with a compiled arm's failure bands — and that is the
//! whole reason C# is affordable. A prior study priced this arm on the only toolchain it looked at,
//! `componentize-dotnet`, which compiles the *program* to native wasm: 25–43 seconds a turn, and
//! the arm was cut as impractical. What it missed is that Microsoft publishes the interpreter.
//!
//! # The one piece everybody said was unbuilt, and why it is not
//!
//! Binding gg's WIT world from .NET is what `dotnet/runtime#113868` says has no supported path.
//! That issue was opened in 2025 and **closed unresolved, with no owner and no PR**, and the
//! feasibility study that scheduled this arm last treated it as the residual risk — a Mono relink to
//! be attempted only as research, after two fallbacks.
//!
//! **No relink research was needed and neither fallback was taken.** The question contains its own
//! answer once it is asked of the right layer: the component gg instantiates is **C**, not managed
//! code. It is Mono's own runtime pack sources — which Microsoft ships as static archives *plus the
//! C that links them*, precisely so the runtime can be relinked with an embedder's own natives —
//! compiled together with `wit-bindgen`'s C bindings for gg's world and
//! `packages/gg-sandbox-csharp/Sources/shell.c`. The managed half never binds a WIT world at all: it
//! reaches gg through `mono_add_internal_call`, Mono's embedding API for exactly this, which is
//! older than wasm and needs no build-time code generation.
//!
//! So this arm's guest is built by the runtime pack's **own supported build**, with three extra
//! translation units. The measured result — which `packages/gg-sandbox-csharp/build.sh` prints and
//! which is what [`GUEST_COMPONENT`] holds — is a 35.3 MB component, produced by wasi-sdk's `clang`
//! on `wasm32-wasip2`, holding the interpreter, 171 bundled assemblies and ICU, in about 26 s.
//!
//! # What a C# program is, here
//!
//! **The model's reply, unaltered, as a compilation unit with an entry point.** No wrapper and no
//! prologue, so a diagnostic at line 7 is line 7 and there is no offset to subtract anywhere in this
//! arm. C# admits top-level statements, a `class`, a `record`, a `namespace` and a `using` in one
//! file, so nothing about the language forces the wrapper the statement-shaped arms need — and all
//! four ways a C# program can begin run here, **top-level statements first**, which is what a
//! program written to do one thing looks like in this decade.
//!
//! What the program is compiled *against* is gg's SDK and the code modules in its scope, each a
//! referenced assembly (see [`sdk`]), and that is the whole of what gg does for it: `csc` is told the
//! library exists, exactly as an `--extern` or a classpath entry tells another arm's compiler. Nothing is in the program's scope
//! until the program has put it there. `Gg.Views.OpenText` is the whole path and needs no line;
//! `Views.OpenText` needs `using Gg;`, which the model writes, and which every module's catalogue
//! entry states so a documentation view can quote it. The BCL is reached the same way, so a program
//! that writes to `Console` writes `using System;` first.
//!
//! # What this arm has that the other compiled arms do not
//!
//! **A real exception mechanism *and* a managed stack trace.** [Rust](super::rust) aborts and
//! reaches for a panic hook; [Swift](super::swift) traps and has no hook at all; [C++](super::cpp)
//! has `throw` and `catch` but nothing to ask a caught exception where it came from. Here the
//! interpreter is a .NET runtime: `try`/`catch`/`finally` work because they are IL, and what an
//! unhandled exception reports is `Exception.ToString()` — the type, the message and the managed
//! frames, which is exactly what a C# developer sees. That is the best error surface of any compiled
//! arm in this study, and it is a property of interpreting IL rather than anything gg engineered.
//!
//! # Why the guest needs no filesystem, and why that matters
//!
//! The class libraries and ICU are **bundled into the component**, registered as in-memory
//! resources, so the runtime boots with zero preopens and reads nothing. The alternative — the
//! runtime pack's default, a `managed/` directory beside the program — would have put 17 MB of
//! Microsoft's assemblies into a run's own working tree where a model would find them, and would
//! have made the guest depend on a path the toolchain image happened to install. It costs 22 MB of
//! embedded artifact and buys a component that behaves the same on every machine.
//!
//! # What the SDK is
//!
//! **Eleven capability modules, each a `public static partial class` in `namespace Gg`**, with
//! `PascalCase` methods, optional arguments a call names, real `enum`s, nullable reference types,
//! `record`s for results and a thrown `ApiException` for the error arm — plus a twelfth,
//! class-less `core` module holding the three types every other module's signatures name. It is
//! compiled from sources gg carries into one assembly, once per machine, and **referenced** by every
//! program and every code module — see [`sdk`] for the argument and what it costs.
//!
//! Every name in it is spelled the way C# spells it, and nothing about the shape is gg's: a module
//! is `System.Math`'s idiom, a result type is nested in the module that produces it, and a program
//! that wants the prefix gone writes `using static Gg.Files;` of its own. What the SDK does *not*
//! do is write that `using` on the program's behalf. The module qualification is the discovery
//! backbone — a call written `Files.ReadFile` says which module documents it, and a bare `ReadFile`
//! says nothing — so a program that has never been told a module's name can still read one off any
//! call it sees.
//!
//! # The types are nested in the module that produces them
//!
//! `Gg.Files.FileRead`, `Gg.Tasks.TextEdit`, `Gg.Delegation.Brief`. That is what makes a
//! fully-qualified name a *real* C# name on this arm rather than a key gg invented: the string a
//! documentation view is opened by is the string a program could write. It also makes the surface
//! collision-safe by construction, which is the property this design is being prototyped for — two
//! modules may both declare a `Status` and neither has to be renamed.
//!
//! The one exception is the `core` module, whose declarations (`ApiException`, `ApiErrorCode`)
//! sit directly in `namespace Gg`, so `using Gg;` is what makes `catch (ApiException failure)`
//! resolve and `catch (Gg.ApiException failure)` is the same clause written out.
//!
//! There is no logging function, and that is this arm's own answer rather than an omission:
//! `Console.WriteLine` reaches the run's operator, because the SDK redirects `Console.Out` onto gg's
//! feedback channel from a `[ModuleInitializer]`. A program writing the first line of C# it would
//! write anywhere else is understood, once it has written the `using System;` that line needs.
//!
//! # What a code module is, and the one decision C# forced
//!
//! A code [skill](crate::skills)'s or [memory](crate::memories)'s namespace is bound at `lib.<key>`,
//! and every other arm answers "what is `lib.<key>`?" with whatever its language uses to hold
//! functions — a `namespace`, a `mod`, a module object. **C# has no free functions at all**: a
//! function is a member of a type, and a namespace may hold only types. So `namespace lib.<key>`
//! would be a namespace nothing could be called on, and a program would have to write
//! `lib.CsvTools.Helpers.Slugify(…)` with a class name only the skill's author knows.
//!
//! `lib.<key>` is therefore a **`static class`** in `namespace lib`, and a module is that class's
//! body — which is the shape a C# author already writes when they write a file of helpers, and the
//! answer [Java](super::java)'s arm reached for the same reason. It is compiled into `lib.<key>.dll`
//! and named to the program's compile with `-r:`, which is exactly how gg's own SDK is supplied, and
//! `#line` keeps every diagnostic in the author's own coordinates. See [`source`] for the wrap, the
//! `using` hoist and the two refusals, and [`compile`] for the reference.
//!
//! # Why there is nothing to warm
//!
//! This arm is the only registered one whose [prepare step](ProgramLanguage::prepare_program)
//! compiles and whose [`warm_prepare`](ProgramLanguage::warm_prepare) does nothing, and the reason
//! is worth stating rather than leaving as an empty method. There is no archive to unpack — the
//! guest is one prebuilt component the sandbox already compiles at launch — and no prelude to
//! build, because a C# compilation has no precompiled-header equivalent to hold across
//! preparations. What is left is the ~2 s the *first* `csc` on a machine spends paging Roslyn in,
//! and gg cannot pay that here: a compiler is spawned through a [`PrepareContext`] that a warm-up
//! is not handed, which is the same wall the [C++](super::cpp) arm's prelude ran into. It is a
//! one-off per process and it lands in the first turn's recorded compile, where it is visible
//! rather than hidden.

use std::sync::OnceLock;

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::signatures::SignatureCatalogue;

use super::{
    CodeModule, FileWindow, PrepareContext, PrepareFailure, PreparedModule, PreparedProgram,
    ProgramLanguage, spell,
};
use crate::docs::MAX_SEARCH_LIMIT;
use crate::sandbox::operations::{DOCS_SEARCH, VIEWS_OPEN_DOCS_VIEW, VIEWS_OPEN_FILE};

#[path = "csharp.compile.rs"]
pub(super) mod compile;

#[path = "csharp.sdk.rs"]
pub(super) mod sdk;

#[path = "csharp.source.rs"]
pub(super) mod source;

/// **The guest** — Mono's IL interpreter, the .NET class libraries and ICU, as one self-contained
/// wasm component exporting gg's `sandbox` world.
///
/// Built by `packages/gg-sandbox-csharp/build.sh` and **embedded in the binary**, for the reason
/// every other guest here is: gg is copied as a single file into an ephemeral run container and must
/// carry everything the turn path needs with it. Nothing about a C# *program* is compiled to wasm,
/// so no wasm toolchain reaches a run container on this arm at all.
///
/// It is not committed. `gg-artifact-csharp` runs that `build.sh` as a step of building this crate
/// and this line embeds what it wrote into that crate's `OUT_DIR`, so the runtime a program is
/// interpreted by is relinked out of the sources in this checkout, on the build that compiles the
/// module describing it — the same guarantee, and the same idiom, as [`SIGNATURES`] below.
///
/// This is the one arm where that decision cost something, and it is worth knowing what: relinking
/// Mono wants a whole .NET SDK and an unpruned wasi-sdk, ~1.4 GB that no gg *run* needs, so building
/// gg now needs `scripts/ci/install-gg-build-toolchains.sh` to have been run. The alternative was to
/// keep committing 35 MB — and it was rejected on evidence rather than on principle. Measured on one
/// machine: two builds of the same checkout differing only in where the toolchains were unpacked
/// produced components of 35 263 680 and 35 263 728 bytes, because the link bakes its own absolute
/// paths in. So a committed copy could never have been *verified* by rebuilding it and diffing;
/// nobody could have told a stale 35 MB blob from a current one by looking. Generating it deletes
/// the question. `gg-artifact-csharp`'s `src/lib.rs` carries the rest of that argument.
const GUEST_COMPONENT: &[u8] = include_bytes!(concat!(
    env!("GG_ARTIFACTS_CSHARP"),
    "/csharp.component.wasm"
));

/// This arm's catalogue, reflected out of the SDK's own XML documentation comments by
/// `packages/gg-sandbox-csharp/signatures.sh` — a hosted Roslyn driver, which is the compiler's own
/// documentation parser and the machinery every C# documentation tool is built on.
///
/// It is not committed. `crates/gg/build.rs` runs that reflection as a step of building this
/// crate and this line embeds what it wrote into the build's own `OUT_DIR`, so what a model is
/// told about this arm is reflected out of the SDK sources in this checkout, on the build that
/// compiles the module telling it.
const SIGNATURES: &str = include_str!(concat!(
    env!("OUT_DIR"),
    "/signatures/csharp.signatures.json"
));

/// The parsed catalogue, parsed once per process.
static CATALOGUE: OnceLock<SignatureCatalogue> = OnceLock::new();

/// The one instance of this language. A unit struct, so the `static` costs nothing and coerces
/// straight to `&'static dyn ProgramLanguage`.
pub(super) static CSHARP: CSharp = CSharp;

/// C#: compiled by Roslyn into the IL assembly a prebuilt Mono interpreter loads, per turn.
pub(super) struct CSharp;

impl ProgramLanguage for CSharp {
    fn id(&self) -> GgProgramLanguage {
        GgProgramLanguage::CSharp
    }

    fn display_name(&self) -> &'static str {
        GgProgramLanguage::CSharp.display_name()
    }

    /// One `csc` over the model's file alone, against gg's SDK and the code modules in scope as
    /// referenced libraries — see [`compile`] for what it costs, what it refuses, and how it tells a
    /// program Roslyn rejected from a Roslyn that could not run.
    fn prepare_program(
        &self,
        source: &str,
        modules: &[CodeModule],
        context: &PrepareContext,
    ) -> Result<PreparedProgram, PrepareFailure> {
        compile::compile_program(source, modules, context)
    }

    /// `csc`, which is what a C# programmer calls the compiler and what the assembly gg runs under
    /// `dotnet exec` is called.
    ///
    /// Not `dotnet`, which is the launcher, and emphatically not `msbuild`, which never runs here:
    /// what judges the program is Roslyn's command-line compiler and nothing else. Naming a checker
    /// is also what has this arm's compile [recorded](crate::sandbox::SandboxOutcome::compile) on
    /// every turn, the failing path included — which matters here because this arm's per-turn cost
    /// is *only* the compile, with no engine work at all behind it, and an arm whose one measurable
    /// cost went unrecorded would be an arm a study could not price.
    fn checker(&self) -> Option<&'static str> {
        Some("csc")
    }

    /// The module's own `csc`, run over the class body gg wrapped it in — and the names that class
    /// offers, read from the author's own source.
    ///
    /// What comes back is **source**, because the library a program references is built for the key
    /// the seam binds when the module is loaded, and a module's own preparation is handed none. What
    /// this compile buys is the author's diagnostic, in their own coordinates, on the call that read
    /// the module.
    fn prepare_module(
        &self,
        source: &str,
        context: &PrepareContext,
    ) -> Result<PreparedModule, PrepareFailure> {
        compile::compile_module(source, context)
    }

    /// **`.cs`, and nothing else.**
    ///
    /// The extension every C# file has had since the language shipped, and the only one: C# has no
    /// second spelling the way C++ has `.hpp` beside `.hh`, and nothing else in the registry
    /// compiles C#. The seam's reason for the list being a list — two languages sharing a module
    /// runtime, where withholding a skill from one would be a larger difference than the study is
    /// measuring — has no instance here.
    fn module_file_extensions(&self) -> &'static [&'static str] {
        &["cs"]
    }

    /// [PascalCase](self::source::binding_name) — because on this arm the key names a **type**, and
    /// a class called `csv_tools` is a thing no C# author would write beside `Enumerable`.
    fn binding_name(&self, name: &str) -> String {
        source::binding_name(name)
    }

    /// **`using lib;`** — the same line, and the same kind of line, as the [`using Gg;`](SURFACE_IMPORT)
    /// that reaches gg's own surface.
    ///
    /// A module is supplied as a referenced assembly, exactly as the SDK is, and a reference
    /// declares no name. So a program reaches `lib.CsvTools.Slugify` by writing the whole path, and
    /// reaches `CsvTools.Slugify` after writing this line — which is the pair this arm's catalogue
    /// already states for every one of gg's own modules.
    ///
    /// One line for every module bound, rather than a line each, because that is what C# is: the
    /// modules are types in one namespace and a `using` of a namespace brings all of them. The key
    /// is therefore not in it, and the [access](Self::lib_access) spelling — the seam's default path
    /// — is what names the module.
    fn lib_import(&self, _key: &str) -> Option<String> {
        Some(format!("using {};", source::NAMESPACE))
    }

    /// **The prebuilt guest**, which is where this arm departs from every other one that runs a
    /// compiler on the turn path.
    ///
    /// [Rust](super::rust), [Swift](super::swift) and [C++](super::cpp) answer `None` here because
    /// their compilers produce the *program* and the program is the component. Roslyn produces
    /// neither wasm nor source: it produces an **IL assembly**, which is not a component and cannot
    /// be one, and the thing that runs it is a 34.9 MB interpreter that never changes. So this arm
    /// commits a component like an interpreted one and compiles like a compiled one, and the two
    /// halves meet at [`PreparedProgram::source`](super::PreparedProgram::source), which carries the
    /// assembly base64-encoded over the string every arm already has.
    fn guest_component(&self) -> Option<&'static [u8]> {
        Some(GUEST_COMPONENT)
    }

    /// This language's catalogue, parsed once and checked to be **this** language's.
    ///
    /// Every registered language's build reflects one of these under its own stem into the one
    /// `OUT_DIR`, and each carries the language it was generated for; checking it here is what stops
    /// a catalogue written — or embedded — under the wrong stem from reaching a model as a system
    /// prompt describing a sandbox nobody has.
    fn catalogue(&self) -> &'static SignatureCatalogue {
        CATALOGUE.get_or_init(|| {
            let catalogue = SignatureCatalogue::parse(SIGNATURES)
                .expect("the generated signature catalogue is valid JSON of the expected shape");
            assert_eq!(
                catalogue.language,
                GgProgramLanguage::CSharp,
                "`signatures/csharp.signatures.json` was generated for another program language",
            );
            catalogue
        })
    }

    /// [`Gg.Views.OpenFile("src/Program.cs");`](self::open_file_statement) — with the window as the
    /// call's own optional arguments, passed by name.
    fn open_file_statement(&self, path: &str, window: Option<FileWindow>) -> String {
        open_file_statement(&spell(self, VIEWS_OPEN_FILE), path, window)
    }

    /// [A collection expression and a `foreach` over it](self::open_docs_views_statement), each
    /// iteration opening one documentation view — as top-level statements, which is what a C#
    /// program written to do one thing looks like.
    fn open_docs_views_statement(&self, names: &[&str]) -> String {
        open_docs_views_statement(&spell(self, VIEWS_OPEN_DOCS_VIEW), names)
    }

    /// [One search naming every module, then a `string[]` and a
    /// `foreach`](self::bootstrap_program) — both calls resolved from this language's own
    /// catalogue, and the search's filters passed by name.
    fn bootstrap_program(&self, modules: &[&str], docs: &[&str]) -> String {
        bootstrap_program(
            &spell(self, DOCS_SEARCH),
            &spell(self, VIEWS_OPEN_DOCS_VIEW),
            modules,
            docs,
        )
    }

    /// One `public static` method returning `name` — because a C# code module is the **body of a
    /// `static class`** and a C# program is a compilation unit with an entry point.
    ///
    /// The seam's default subject is this language's generated documentation program, and here that
    /// program is not a module at all: top-level statements inside a class body are a syntax error,
    /// so the default would fail this gate's baseline over C#'s grammar rather than over anything
    /// about isolation. So this arm answers for itself, as [Rust](super::rust), [Swift](super::swift),
    /// [C++](super::cpp) and the [JVM](super::jvm) arms do, and the `name` rides in as a returned
    /// **string literal** — which is where the module's one export hands it back, and where
    /// [`wrap_module`](self::source::wrap_module) finds a `public` member to bind.
    #[cfg(test)]
    fn gate_module(&self, name: &str) -> String {
        format!(
            "public static string Marker() => {};\n",
            serde_json::Value::String(name.to_string())
        )
    }

    /// **Every assembly the artifact carries, with its transport encoding taken back off.**
    ///
    /// The only arm that answers this at all, and the only one that reaches the
    /// [source](super::PreparedProgram::source) half rather than a component — because on this arm
    /// that field does not hold source. It holds a manifest of named IL assemblies, each
    /// base64-encoded because the wire's `program` is a string, so a gate looking for a marker inside
    /// the artifact would be looking at an alphabet the marker cannot survive, and would report every
    /// well-isolated C# preparation as one whose output does not carry its own input.
    ///
    /// Decoding hides **nothing**, which is the whole of what the seam asks: it shows the gate more
    /// of the artifact rather than less, and every check downstream of it is a search for a marker
    /// that a hidden byte could be sitting in. What comes back is every assembly `csc` wrote, whole
    /// and in the order the manifest names them.
    ///
    /// An input this cannot read as a manifest is handed back untouched rather than being silently
    /// replaced by an empty artifact — a preparation that produced something this could not decode
    /// is a failure the gate should see whole.
    #[cfg(test)]
    fn isolation_readable(&self, artifact: Vec<u8>) -> Vec<u8> {
        use base64::Engine as _;
        let Ok(text) = std::str::from_utf8(&artifact) else {
            return artifact;
        };
        let mut decoded = Vec::new();
        // Two lines per assembly: the name it is registered under, then its IL. The names are gg's
        // own and carry no marker, so what the gate searches is the IL and the whole of it.
        let mut lines = text.lines();
        while let (Some(_), Some(payload)) = (lines.next(), lines.next()) {
            match base64::engine::general_purpose::STANDARD.decode(payload) {
                Ok(bytes) => decoded.extend(bytes),
                Err(_) => return artifact,
            }
        }
        match decoded.is_empty() {
            true => artifact,
            false => decoded,
        }
    }

    /// **The marker as written, and the marker as an assembly stores it** — which is UTF-16.
    ///
    /// The only arm that needs a second form, and it is a fact about ECMA-335 rather than about gg:
    /// a .NET assembly keeps its user strings in the `#US` metadata heap as UTF-16, so
    /// `gg-isolation-000-marker` is `g\0g\0-\0…` in the bytes `csc` produced. Measured on this
    /// toolchain rather than assumed — the ASCII bytes are not in the assembly at all.
    ///
    /// The ASCII form is kept beside it rather than replaced, because it costs nothing and it is
    /// what a *module*'s artifact carries: a module's own preparation hands back the author's own
    /// source.
    ///
    /// Both forms are derived from the marker character by character, so a form belonging to one
    /// input can never be found in another input's artifact — which is what keeps the gate's
    /// "carries somebody else's program" half as strong here as it is everywhere else.
    #[cfg(test)]
    fn isolation_marker_forms(&self, marker: &str) -> Vec<String> {
        let wide: String = marker
            .encode_utf16()
            .flat_map(|unit| unit.to_le_bytes())
            .map(char::from)
            .collect();
        vec![marker.to_string(), wide]
    }
}

// ---------------------------------------------------------------------------------------------
// The syntax this arm writes
// ---------------------------------------------------------------------------------------------

/// **The one line a C# program writes to reach gg's surface by its short name.**
///
/// `namespace Gg` is an ordinary namespace in a library the program references, so a program either
/// writes the whole path — `Gg.Views.OpenFile` — or writes this once and then writes `Views.OpenFile`.
/// It is the line every module of this arm's catalogue states as its
/// [import](crate::sandbox::ModuleDoc::import), which a documentation view quotes and which
/// `csharp.test.rs` holds this constant to; the same string is written by
/// `packages/gg-sandbox-csharp/tools/Catalogue.cs`, which is where the catalogue gets it.
///
/// One line for thirteen modules rather than a line each, because that is what C# is: the modules
/// are types in one namespace, and a `using` of a namespace brings all of them. The alternative
/// spelling — a `using Files = Gg.Files;` per module — resolves the same calls and is not what a C#
/// author writes.
pub(super) const SURFACE_IMPORT: &str = "using Gg;";

/// `Gg.Views.OpenFile("src/Program.cs");`, or the same call with `offset: 400, limit: 200` for a
/// window — with `Gg.Views.OpenFile` already spelled by the language that asked.
///
/// Deliberately the plainest statement that does the job: no binding, no printing. It is synthesized
/// into the agent's own transcript and read by the model as an example of its own output, so
/// anything clever in it is a style the run did not intend to teach.
///
/// The **whole path**, which is what [`spell`] hands back on this arm and what several of these
/// joined into one program need: a `using` may not stand between two statements, so a synthesized
/// statement writes the route that needs no line.
///
/// The window is passed as **named arguments**, which is what this SDK offers instead of an options
/// record and what a C# author writes for a pair of optional parameters that would otherwise be two
/// bare numbers. The whole-file form passes nothing at all, because both parameters have defaults
/// and a C# author does not write `null` where the default is what they wanted.
///
/// The path is rendered through [`serde_json`] so a quote or a backslash in one cannot produce a
/// statement that would not parse: C#'s ordinary string literals accept every escape JSON's produce.
pub(super) fn open_file_statement(
    open_file: &str,
    path: &str,
    window: Option<FileWindow>,
) -> String {
    let path = serde_json::Value::String(path.to_string());
    match window {
        Some(window) => format!(
            "{open_file}({path}, offset: {}, limit: {});",
            window.offset, window.limit
        ),
        None => format!("{open_file}({path});"),
    }
}

/// A whole program: a `string[]` built with a collection expression, and a `foreach` over it opening
/// one documentation view per name.
///
/// It is a **whole program** rather than a statement list because the seam asks for one — the on-use
/// script of every [built-in family skill](crate::skills) is a program — and on this arm the two are
/// the same text anyway: C# top-level statements *are* a compilation unit, so nothing has to be
/// wrapped around them and no `class` or `Main` is written.
///
/// The call is written by its **whole path**, which is one of the two routes this arm's catalogue
/// advertises and the one that needs no line above it. [`SURFACE_IMPORT`] is the other.
///
/// A collection expression (`["a", "b"]`) rather than `new[] { … }`, because it is what a C# author
/// writing a new file today reaches for and this arm pins the language version high enough to have
/// it. A `foreach` rather than a call per name because the list is as long as the family — eleven
/// calls written out would be a program a model reads as a style to copy.
///
/// The empty case keeps the loop rather than collapsing to nothing, so that what the model is shown
/// is one shape with one thing varying in it.
pub(super) fn open_docs_views_statement(open_docs_view: &str, names: &[&str]) -> String {
    let listed = match names.is_empty() {
        true => "string[] functions = [];\n".to_string(),
        false => {
            let entries: Vec<String> = names
                .iter()
                .map(|name| format!("    {},", serde_json::Value::String((*name).to_string())))
                .collect();
            format!("string[] functions =\n[\n{}\n];\n", entries.join("\n"))
        }
    };
    format!("{listed}foreach (var name in functions)\n{{\n    {open_docs_view}(name);\n}}\n")
}

/// The opening turn: **one** search naming every module gg listed, then the `string[]` of
/// documentation keys and the `foreach` that opens a view of each.
///
/// Top-level statements, which on this arm are already a whole compilation unit, so nothing is
/// wrapped around them and no `class` or `Main` is written — and every call written by its whole
/// path, so the first program a model reads of its own is one that needed no line above it.
///
/// One call rather than a search per module, because the filter is a **union**: a dozen modules are
/// one page, ranked once, and a model's first example of searching should not also be its first
/// example of calling the same function in a loop. The modules go in as a **collection expression
/// at the call site** — with no loop left to feed, a binding would name a list nothing else reads —
/// and the filters are **passed by name**, which is this language's idiom for optional arguments
/// and what its SDK declares them with. No query is passed at all, because none is wanted: what the
/// filter asks for is those modules' whole directories, and an empty-string query standing in for
/// one is a habit a model reading its own first program would copy.
///
/// The limit is [`MAX_SEARCH_LIMIT`], which is the whole difference between an agent shown every
/// function it holds and one shown the first page of them.
///
/// **An agent holding neither `files` nor `shell` writes no search at all.** No query and no filter
/// is `invalid-argument`, so the call gg would emit for an empty list is one gg would then refuse —
/// and an opening turn that failed is the worst first example there is. What is left is the
/// documentation program on its own, which is the half every other opening program already ends
/// with.
///
/// A failed call throws and nothing here catches it, which is this arm's failure model: a bootstrap
/// that caught its own failure would be a worked example of swallowing one.
pub(super) fn bootstrap_program(
    search: &str,
    open_docs_view: &str,
    modules: &[&str],
    docs: &[&str],
) -> String {
    let opened = open_docs_views_statement(open_docs_view, docs);
    match modules.is_empty() {
        true => opened,
        false => {
            let paths: Vec<String> = modules
                .iter()
                .map(|path| serde_json::Value::String((*path).to_string()).to_string())
                .collect();
            format!(
                "{search}(modules: [{}], limit: {MAX_SEARCH_LIMIT});\n\n{opened}",
                paths.join(", ")
            )
        }
    }
}

#[cfg(test)]
#[path = "csharp.test.rs"]
mod tests;

/// **The one C# version written down twice**, held to itself across a build.
///
/// What is left of the gate that used to cover this arm's committed guest: the guest is generated
/// now, so the three assertions that compared it against a manifest have no subject. This one never
/// read the manifest — it holds [`compile::LANGUAGE_VERSION`] to `csharp-version.sh`'s
/// `GG_DOTNET_LANG_VERSION`, which is a cross-language invariant no rerun set can enforce. That file
/// carries the whole argument.
#[cfg(test)]
#[path = "csharp.pins.test.rs"]
mod pins;

/// **The C# arm's execution substrate**, driven end to end through gg's real compiler, linker,
/// membrane and store.
///
/// A separate test file from any unit tests, because these are a different kind of test: each one
/// runs a real `csc` and instantiates a 34.9 MB component, which is hundreds of milliseconds rather
/// than microseconds.
#[cfg(test)]
#[path = "csharp.substrate.test.rs"]
mod substrate;

/// **Every C# example a model is shown, put through `csc`** — the prompt's, the notice's and the
/// catalogue's.
///
/// A separate file from [`surface`] because it asks a question no other kind of gate can: not
/// whether the call gg quotes exists, which [`crate::prompts`] already gates in every language, but
/// whether the code around it builds. On a compiled arm an example that does not is a whole turn
/// spent on gg's own prose.
#[cfg(test)]
#[path = "csharp.examples.test.rs"]
mod examples;

/// **The C# arm's model-facing surface** — the SDK a model writes against, the catalogue reflected
/// out of it, and the libraries this arm says a program may reach, driven through the same real
/// toolchain and real membrane the substrate is.
#[cfg(test)]
#[path = "csharp.surface.test.rs"]
mod surface;

/// **Code modules**, driven end to end: a code skill's C# compiles into its own library, and a
/// program reaches its declarations at `lib.<key>` through the real compiler and the real guest.
#[cfg(test)]
#[path = "csharp.modules.test.rs"]
mod modules;
