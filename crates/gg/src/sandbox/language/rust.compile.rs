//! **The Rust compile** — how a model's Rust becomes the wasm component that turn is evaluated by.
//!
//! # The strategy, in one sentence
//!
//! A Rust program is **compiled on the host, per turn, into a component of its own**: one `rustc`
//! against a prebuilt library set that ships inside gg's binary, then an in-process
//! [`wit_component`] encode, and what crosses the membrane is not source at all but the artifact
//! gg's engine instantiates.
//!
//! # Why this arm has no committed component, and what that costs
//!
//! Every other arm gg drives ships one: Python's holds a whole CPython, Ruby's holds Opal, the
//! ECMAScript one holds a JavaScript engine, and a program crosses the membrane as a **string** the
//! runtime inside evaluates. Rust has no such runtime. `rustc` does not produce a Rust interpreter
//! that later runs a program; it produces the program, and there is no artifact of the language that
//! is not one particular program. So this is the first arm whose component is
//! [per turn](super::super::PreparedProgram::component), and the seam carries that shape because
//! this arm — and the C++ and Swift arms that follow it — cannot be expressed without it.
//!
//! What it costs is one wasmtime `Component::new` per turn instead of one per process. That is a
//! real cost, it is reported (as
//! [`SandboxOutcome::compile_wait`](crate::sandbox::SandboxOutcome::compile_wait)) rather than
//! hidden, and it is small for the reason the artifacts are small: `wasm-ld` dead-strips a
//! `cdylib`'s unreached code, so a program links only the part of the library set it actually
//! reached. Measured in this repository's dev container, aarch64, on an ordinary program:
//!
//! | | |
//! | --- | --- |
//! | `rustc` — the whole compile, including the link — and the [`wit_component`] encode | **~60 ms** |
//! | wasmtime `Component::new` at `OptLevel::None` | **~9 ms** |
//! | Artifact | **~25 KB** |
//!
//! The feasibility study priced this arm at 0.15–0.5 s of CPU per compile against a **1.57–4.22 MB**
//! artifact costing 296–317 ms to instantiate. Those figures came from a build topology in which
//! every program relinked the whole binding surface; in the prebuilt-rlib topology this arm actually
//! uses, neither survives. The study's own conclusion — that `-C strip=symbols` is mandatory for
//! size — is kept anyway, and costs nothing: the name section is what it deletes, and a Rust
//! program's failures are located by the [panic hook](super::source), out of `Location`, which is
//! static data rather than a symbol name.
//!
//! # Why the compiler is not carried, and the library set is
//!
//! The same split every compiled arm here has, for the same two reasons.
//!
//! `rustc` and its `wasm32-unknown-unknown` standard library are **~376 MB** — 109 MB of
//! `librustc_driver`, ~150 MB of LLVM, 93 MB of wasm standard library and `rust-lld` — so it cannot
//! ride inside a single static `tcab` binary. It goes into the gg toolchain image
//! (`containers/gg-toolchains/Dockerfile`) and is found on `PATH` at run time. It is by a wide
//! margin the heaviest toolchain in that image, and that is stated rather than buried.
//!
//! The **library set** goes the other way: 9.4 MB gzipped of `.rlib` — 4.4 MB of that `regex`'s own
//! `regex-syntax` and `regex-automata`, which every program is linked against and almost none uses
//! all of — built once by `packages/gg-sandbox-rust/build.sh` and committed. It could have gone in the image beside the
//! compiler and deliberately does not, for the reason the PureScript arm's tree does not — gg is
//! copied as a single file into an ephemeral run container whose image was built separately, so a
//! set that lived in the image could be a different vintage from the binary reading it. Once this
//! arm's SDK is compiled into that set, that would mean a model shown one surface in its prompt and
//! compiled against another.
//!
//! **The two halves are pinned to each other by the compiler's version**, harder than any other
//! arm's are. An `.rlib` is a compiler-version-private format: `rustc` refuses one built by any
//! other release outright, with `E0514`. That is why there is no separate pin for this arm's
//! compiler — it is `rust-toolchain.toml`'s, the one every checkout already uses, so there is only
//! one release in the repository to keep in step. See
//! `packages/gg-sandbox-rust/rust-version.sh`.
//!
//! # Isolation
//!
//! This arm needs less of the seam's machinery than any other compiled one, and the reason is worth
//! writing down rather than assuming.
//!
//! `rustc` only ever **reads** the library set. It is named on `-L dependency=` and `--extern`, it
//! is never written to, and nothing is generated into it — so unlike the PureScript arm's tree,
//! which `purs` compiles *into*, this one is used directly out of the
//! [shared toolchain directory](shared_toolchain_dir) with no staging, no hard links and no copy.
//! The directory is content-keyed on the pinned compiler and a digest of the committed tarball, and
//! it is sealed read-only when it is placed, so a compiler that tried to write into it would fail
//! loudly at the moment it tried.
//!
//! Everything a compile does write goes in this preparation's own workspace, and most of it without
//! this arm having asked: `rustc` writes its incremental and temporary files under `TMPDIR`, and
//! `CARGO_HOME`/`RUSTUP_HOME` derive from `HOME` — all three of which
//! [`PrepareContext::compiler`](super::compile::PrepareContext::compiler) has already redirected
//! into the private tree. The output path is named absolutely, into
//! [`Workspace::output`](super::compile::Workspace::output).
//!
//! There is no compiler daemon and no pool. `rustc` is a one-shot process whose cost is the compile
//! rather than the start-up, and a 70 ms compile has nothing warm to be.

use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;

use crate::sandbox::{
    CodeModule, CompilerReport, PrepareContext, PrepareError, PrepareFailure, PreparedModule,
    PreparedProgram, Workspace, place_tree, shared_toolchain_dir,
};

use super::source::{CRATE_NAME, LINE_OFFSET, PROGRAM_FILE};

/// The library set a program is compiled against: every `.rlib` `rustc` links, gzipped, built by
/// `packages/gg-sandbox-rust/build.sh`.
///
/// Embedded for the reason the guest components are: gg is copied as a single file into an ephemeral
/// run container and must carry everything it needs with it.
const LIBRARIES_TAR_GZ: &[u8] = include_bytes!("../checkers/rust.libraries.tar.gz");

/// What that set was built by, and what is in it.
const MANIFEST_JSON: &str = include_str!("../checkers/rust.toolchain.json");

/// The environment variable an operator points at `rustc` when it is not where gg looks.
pub(super) const RUSTC_ENV: &str = "TCAB_GG_RUSTC";

/// Where `containers/gg-toolchains` installs this arm's compiler in a gg run image.
///
/// Looked at before `PATH` rather than instead of it: the gg run images put it on `PATH` anyway, and
/// a developer's machine has neither, so the order is "what an operator said, then what the image
/// guarantees, then what the shell would have found".
const TOOLCHAIN_BIN: &str = "/opt/gg/toolchains/rust/bin";

/// How long one `rustc` may take before it is killed and reported as a
/// [toolchain failure](PrepareFailure::Toolchain).
///
/// A compile here is ~70 ms, and the worst honest case — a program that instantiates a great deal of
/// generic code — is seconds. A minute is unmistakably a hang.
const COMPILE_TIMEOUT: Duration = Duration::from_secs(60);

/// What `rustc` is told to write, in this preparation's own output directory.
const ARTIFACT_FILE: &str = "program.wasm";

/// What the committed library set was built by, and what is in it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    /// The `rustc` release that built every `.rlib` in the set — and therefore the only release
    /// that can read them.
    rustc: String,
    /// The target triple they were built for, and the one a program is compiled to.
    target: String,
    /// The `wit-bindgen` release the guest bindings inside them were generated by. Recorded for an
    /// operator reading a binding-shaped diagnostic; nothing routes on it.
    #[allow(dead_code)]
    wit_bindgen: String,
    /// Every crate in the set.
    crates: Vec<Library>,
}

/// One `.rlib` in the shipped set.
#[derive(Debug, Deserialize)]
struct Library {
    /// The crate name, as `--extern` and `-L dependency=` find it.
    name: String,
    /// How big it is. Recorded so a truncated tarball is visible in the manifest rather than only in
    /// a link failure.
    #[allow(dead_code)]
    bytes: u64,
    /// Whether a **program** may name this crate — the SDK and the curated library set, but not the
    /// transitive closure under them.
    ///
    /// The difference is `--extern`, which is what puts a name in a program's extern prelude;
    /// everything else is found by `-L dependency=` when something already in the graph needs it. A
    /// set that put all seventeen in the prelude would offer a model `regex_syntax` and `hashbrown`,
    /// which are crates this arm *carries* rather than crates it offers — and the catalogue's
    /// library list, reflected from the same declaration, would then be describing a smaller surface
    /// than the compile allows.
    #[serde(rename = "extern")]
    extern_: bool,
}

/// The parsed manifest, read once per process.
fn manifest() -> &'static Manifest {
    static MANIFEST: std::sync::OnceLock<Manifest> = std::sync::OnceLock::new();
    MANIFEST.get_or_init(|| {
        serde_json::from_str(MANIFEST_JSON)
            .expect("the committed Rust toolchain manifest is valid JSON of the expected shape")
    })
}

/// The `rustc` release a program is compiled with, for the run's own record and for an operator
/// reading a diagnostic and wondering whose it is.
pub(super) fn compiler_version() -> &'static str {
    &manifest().rustc
}

/// The target triple a program is compiled to.
pub(super) fn target() -> &'static str {
    &manifest().target
}

/// Unpack the library set now, so the first compile does not.
///
/// The whole of this language's warm-up: 9.4 MB decompressed into ~27.5 MB of `.rlib` files, once
/// per machine. The result is dropped, because a failure here is the failure the first compile will
/// make, and there it is classified, counted and reported.
pub(super) fn warm() {
    let _ = libraries();
}

/// Compile a **program** — a model's reply — into the component that evaluates it.
///
/// [`unreachable`](PreparedProgram::unreachable) is `None`, and that is an absence rather than a
/// zero: the measurement counts top-level statements written after one that *ends* the program,
/// which in the ECMAScript arms is a top-level `return`. A `return` in a Rust program returns from
/// the body gg wrapped it in, and everything after it is ordinary dead code the compiler already
/// reports on — so the shape this field records does not exist on this arm, exactly as it does not
/// on Python's, Ruby's or PureScript's.
///
/// [`source`](PreparedProgram::source) is empty for the same reason: there is nothing left for a
/// guest to evaluate, because the guest *is* what this returned.
pub(super) fn compile_program(
    source: &str,
    modules: &[CodeModule],
    context: &PrepareContext,
) -> Result<PreparedProgram, PrepareFailure> {
    Ok(PreparedProgram {
        source: String::new(),
        unreachable: None,
        component: Some(compile(source, modules, context)?),
    })
}

/// Compile one model program into a component, or say why it could not be.
///
/// `modules` are this agent's loaded code [skills](crate::skills) and
/// [memories](crate::memories), each already through [`compile_module`]. They are **inputs to this
/// compile**, which is what makes this arm's preparation take them at all: a Rust module is Rust,
/// and Rust is linked, so a module is only reachable from the artifact it was built into. Each is
/// written beside the program as its own file and declared under `lib::<key>`.
fn compile(
    program: &str,
    modules: &[CodeModule],
    context: &PrepareContext,
) -> Result<Vec<u8>, PrepareFailure> {
    let libraries = libraries().map_err(PrepareFailure::Toolchain)?;
    let workspace = context.workspace().map_err(PrepareFailure::Toolchain)?;

    let wrapped = super::source::wrap(program, modules)?;
    workspace
        .write(PROGRAM_FILE, &wrapped)
        .map_err(PrepareFailure::Toolchain)?;
    for module in modules {
        workspace
            .write(&super::source::module_file(&module.name), &module.source)
            .map_err(PrepareFailure::Toolchain)?;
    }

    let artifact = workspace.output().join(ARTIFACT_FILE);
    let report = invoke_rustc(&artifact, libraries, context).map_err(PrepareFailure::Toolchain)?;
    classify(&report, PROGRAM_FILE, program.lines().count())?;

    let module = std::fs::read(&artifact).map_err(|error| {
        PrepareFailure::Toolchain(format!(
            "rustc {} reported success and wrote no module to {}: {error}",
            compiler_version(),
            artifact.display(),
        ))
    })?;
    componentize(&module).map_err(PrepareFailure::Toolchain)
}

/// The file a code module is **checked** under, before it is ever linked into a program.
const MODULE_FILE: &str = "module.rs";

/// Check a code [skill](crate::skills)'s or [memory](crate::memories)'s Rust, and report the names
/// its namespace offers.
///
/// What comes back is **source**, not an artifact, and that is the honest shape for a linked
/// language: there is nothing a module can be compiled into that a later program could load, so what
/// this hands on is the file the next [program compile](compile) will build against.
///
/// The compiler still runs, and what it buys is the *location*. Without it a module that does not
/// compile would take down every program the agent writes from then on — the diagnostic would arrive
/// against the turn's own program, in a file the model never wrote, on every turn until the module
/// was somehow unloaded. Running `rustc` here instead means the author is told at the read, at the
/// module's own line and column, exactly as every other compiled arm tells them.
///
/// `--emit=metadata` rather than a full build: this output is thrown away, so asking for code
/// generation would be paying LLVM for an artifact nothing reads. Everything a model can get wrong
/// — a name that does not resolve, a type error, a trait not satisfied — is decided before that
/// point.
pub(super) fn compile_module(
    source: &str,
    context: &PrepareContext,
) -> Result<PreparedModule, PrepareFailure> {
    let libraries = libraries().map_err(PrepareFailure::Toolchain)?;
    let workspace = context.workspace().map_err(PrepareFailure::Toolchain)?;

    let wrapped = super::source::wrap_module(source);
    workspace
        .write(MODULE_FILE, &wrapped)
        .map_err(PrepareFailure::Toolchain)?;

    let report =
        invoke_module_check(workspace, libraries, context).map_err(PrepareFailure::Toolchain)?;
    classify(&report, MODULE_FILE, source.lines().count())?;

    Ok(PreparedModule {
        exports: super::source::exports(source),
        source: wrapped,
    })
}

// ---------------------------------------------------------------------------------------------
// The compiler
// ---------------------------------------------------------------------------------------------

/// Spawn `rustc` over the entry file this preparation just wrote, and link the component.
fn invoke_rustc(
    artifact: &Path,
    libraries: &Libraries,
    context: &PrepareContext,
) -> Result<CompilerReport, String> {
    let (rustc, mut command) = rustc(libraries, context)?;
    command
        .arg("--crate-type")
        .arg("cdylib")
        .arg("--crate-name")
        .arg(CRATE_NAME)
        // A component is instantiated by the engine on every turn, so a smaller module is a cheaper
        // turn — and `s` is measurably *faster to produce* than `0` here, because the code `wasm-ld`
        // then has to link is smaller.
        .arg("-Copt-level=s")
        // Not a size optimisation so much as the removal of a section nothing reads: a Rust
        // program's failures are located by its panic hook, out of `Location`, which survives this.
        .arg("-Cstrip=symbols")
        .arg("-o")
        .arg(artifact)
        .arg(PROGRAM_FILE);
    run(rustc, command)
}

/// Spawn `rustc` over the code module this preparation just wrote, asking for **metadata only**.
///
/// Every diagnostic a module's author can be answerable for is produced before code generation, and
/// the output of this invocation is thrown away, so a `cdylib` here would be paying LLVM and
/// `wasm-ld` for an artifact nothing loads. The one thing it must still do is *link nothing*, which
/// is why the crate type is `lib` rather than the program's: a module has no `export!` and no
/// component-type section, so asking for a `cdylib` would fail on the absence of what the program's
/// own wrapper supplies.
fn invoke_module_check(
    workspace: &Workspace,
    libraries: &Libraries,
    context: &PrepareContext,
) -> Result<CompilerReport, String> {
    let (rustc, mut command) = rustc(libraries, context)?;
    command
        .arg("--crate-type")
        .arg("lib")
        .arg("--crate-name")
        .arg("module")
        .arg("--emit=metadata")
        .arg("--out-dir")
        .arg(workspace.output())
        .arg(MODULE_FILE);
    run(rustc, command)
}

/// A `rustc` invocation carrying everything both compiles need: where the toolchain is, which
/// target and edition, the library set, and the two settings the target leaves no choice about.
fn rustc<'a>(
    libraries: &Libraries,
    context: &'a PrepareContext,
) -> Result<(String, crate::sandbox::CompilerCommand<'a>), String> {
    let rustc = tool(RUSTC_ENV, "rustc");
    let mut command = context
        .compiler(&rustc)
        .map_err(|error| format!("{}{error}", spawn_prefix(&rustc)))?;
    command
        // The repository's own edition, so a model writes the Rust this decade rather than the Rust
        // of whichever edition happened to be `rustc`'s default.
        .arg("--edition")
        .arg("2024")
        .arg("--target")
        .arg(target())
        // `wasm32-unknown-unknown` has no unwinder, so this is the only setting the target supports
        // and naming it is how a mismatch with the library set becomes impossible rather than
        // implicit.
        .arg("-Cpanic=abort")
        // Warnings are style, and a model's program is not being reviewed. An unused variable that
        // failed a turn would be gg imposing a lint policy on an experiment about capability.
        .arg("-Awarnings")
        // Structured diagnostics, so a location is a field rather than something to scrape out of
        // prose — and so the one-line offset gg's wrapper costs can be subtracted from it.
        .arg("--error-format=json")
        .arg("-L")
        .arg(format!("dependency={}", libraries.tree.display()));
    for library in manifest().crates.iter().filter(|library| library.extern_) {
        command.arg("--extern").arg(format!(
            "{}={}",
            library.name,
            libraries
                .tree
                .join(format!("lib{}.rlib", library.name))
                .display()
        ));
    }
    // Applied after the seam's redirection, and pointing at nothing outside this preparation's tree:
    // it selects a toolchain rather than a directory. On a developer's or CI machine `rustc` is a
    // rustup shim that resolves the toolchain from the *working directory*, and this preparation's
    // working directory is a private tree in `/tmp` with no `rust-toolchain.toml` above it — so
    // without this the shim would pick the machine's default release and the library set would be
    // refused with `E0514`. In a run container `rustc` is a real binary and this is an environment
    // variable it does not read.
    command.env("RUSTUP_TOOLCHAIN", compiler_version());
    Ok((rustc, command))
}

/// Run a prepared `rustc` invocation under this arm's timeout, naming the toolchain if it could not
/// be started at all.
fn run(
    rustc: String,
    mut command: crate::sandbox::CompilerCommand<'_>,
) -> Result<CompilerReport, String> {
    command
        .run(COMPILE_TIMEOUT)
        .map_err(|error| match error.starts_with("could not run") {
            true => format!("{}{error}", spawn_prefix(&rustc)),
            false => error,
        })
}

/// Where `rustc` is: what an operator said, then what a gg run image guarantees, then `PATH`.
fn tool(variable: &str, name: &str) -> String {
    if let Ok(configured) = std::env::var(variable)
        && !configured.is_empty()
    {
        return configured;
    }
    let installed = Path::new(TOOLCHAIN_BIN).join(name);
    match installed.is_file() {
        true => installed.to_string_lossy().into_owned(),
        false => name.to_string(),
    }
}

/// What a failure to start it is prefixed with, because it is the one failure here an operator can
/// actually fix: the toolchain is not where gg looked.
fn spawn_prefix(tool: &str) -> String {
    format!(
        "gg compiles every Rust program with the toolchain in the gg run image and needs `{tool}` \
         on PATH, in {TOOLCHAIN_BIN}, or {RUSTC_ENV} pointing at it: "
    )
}

// ---------------------------------------------------------------------------------------------
// The verdicts
// ---------------------------------------------------------------------------------------------

/// One `--error-format=json` diagnostic.
#[derive(Debug, Deserialize)]
struct Diagnostic {
    /// `error`, `warning`, `note`, `help` — or `failure-note` for the summary line `rustc` ends a
    /// failed compile with.
    level: String,
    /// The prose.
    message: String,
    /// The compiler's own stable name for what went wrong: `E0308`, `E0425`. `None` for the
    /// diagnostics that have no code, which is most notes and some errors.
    code: Option<Code>,
    /// Where it was found. Empty for a diagnostic about no particular place.
    #[serde(default)]
    spans: Vec<Span>,
    /// Notes and helps hung off it — where `rustc`'s suggestions live, which is the half of its
    /// diagnostics a model gains the most from.
    #[serde(default)]
    children: Vec<Diagnostic>,
}

/// A diagnostic's error code.
#[derive(Debug, Deserialize)]
struct Code {
    /// `E0308`.
    code: String,
}

/// One span of a diagnostic. Only its start is reported: a model reads a coordinate, not a
/// rectangle.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct Span {
    /// The file it is in, as `rustc` was given it.
    file_name: String,
    /// Whether this is the span the diagnostic is *about*, as opposed to a secondary one it refers
    /// to.
    is_primary: bool,
    /// 1-based line, in the **entry file's** coordinates.
    line_start: usize,
    /// 1-based column.
    column_start: usize,
    /// The label written under it, when there is one.
    label: Option<String>,
}

impl Diagnostic {
    /// Whether this is one of the diagnostics a **model** is answerable for.
    fn is_error(&self) -> bool {
        self.level == "error"
    }

    /// This diagnostic, rendered in the coordinates of `file` — the model's own program, or the
    /// module whose author is being told about it.
    ///
    /// `rustc`'s own `rendered` field is deliberately not used. It carries a source excerpt with the
    /// **entry file's** line numbers printed into it, which would have to be rewritten line by line
    /// to be true — and a rendering gg assembles from the structured fields cannot disagree with the
    /// location gg reports.
    fn render(&self, file: &str, lines: usize) -> String {
        let mut rendered = match &self.code {
            Some(code) => format!("error[{}]: {}", code.code, self.message),
            None => format!("error: {}", self.message),
        };
        if let Some(span) = self.primary(file, lines) {
            rendered.push_str(&format!(
                "\n  --> line {}, column {}",
                span.line_start.saturating_sub(LINE_OFFSET),
                span.column_start
            ));
            if let Some(label) = &span.label {
                rendered.push_str(&format!("\n  {label}"));
            }
        }
        // `rustc`'s suggestions are the most valuable thing it says and they are all in the
        // children: `help: consider borrowing here`, `note: expected `&str`, found `String``.
        for child in &self.children {
            rendered.push_str(&format!("\n  {}: {}", child.level, child.message));
        }
        rendered
    }

    /// The span this diagnostic is about, in the author's own text.
    ///
    /// A diagnostic whose only spans are in a library, or — for a program compiled beside code
    /// modules — in **somebody else's module**, has none: reporting its line as if it were the
    /// model's would point at whichever of the model's lines shares the number.
    ///
    /// So is one in gg's own wrapper, which is why `lines` is here. The wrapper's *prologue* is
    /// subtracted by [`LINE_OFFSET`], but its epilogue and the
    /// [module declarations](super::source) below it are in the same file and further down — so a
    /// diagnostic gg's own generated text earned would otherwise be reported at a line past the end
    /// of the program the model wrote. Above the author's last line it is located; past it, it is
    /// reported without one.
    fn primary(&self, file: &str, lines: usize) -> Option<&Span> {
        self.spans.iter().find(|span| {
            span.is_primary
                && span.file_name == file
                && (LINE_OFFSET + 1..=LINE_OFFSET + lines).contains(&span.line_start)
        })
    }
}

/// How many distinct diagnostics a model is shown.
///
/// Eight, which is [the number Kotlin measured](super::super::kotlin) and the one the
/// [shared bound](super::super::diagnostics) is asked for by every arm with no reason to differ.
/// This arm's reason to keep it is its own measurement: one misremembered SDK name called at fifty
/// call sites is 5982 bytes across 201 lines of `rustc`, so a diagnostic here costs ~120 bytes and ~4
/// lines and eight of them is ~1 KB — a screenful, which is what a model can act on before it is
/// reading repetitions.
///
/// Four lines for a *compact* rendering is not an accident of it. [`render`](Diagnostic::render)
/// appends **every** `child`, and the children are where `rustc` puts the half of a diagnostic a
/// model gains the most from — the `help: consider borrowing here` and the `note:` naming the type
/// it expected against the one it found. Dropping them to fit more diagnostics in would trade the
/// sentence that says what to do for more copies of the sentence that says what is wrong.
///
/// The count is a pure error count, unlike an arm that has to reason about warnings: the
/// [invocation](rustc) passes `-Awarnings` because a model's program is not being reviewed for
/// style, so every diagnostic that reaches here is one `rustc` refused to compile over.
const SHOWN: usize = 8;

/// Turn a finished `rustc` invocation into a verdict.
///
/// The split is the seam's: a compiler that **read the program and rejected it** is a
/// [`PrepareError::Compile`] the model is shown and can act on; a compiler that could not finish is
/// a [`PrepareFailure::Toolchain`] the model is not blamed for. `rustc` exits non-zero for both, so
/// the evidence is whether it emitted a diagnostic at `error` level at all.
///
/// Everything a Rust compiler rejects arrives as [`Compile`](PrepareError::Compile) and not as
/// [`Syntax`](PrepareError::Syntax), and that is a fact about the language rather than a shortcut.
/// `rustc` has no parse-only phase a program passes before meaning is considered, and it does not
/// mark a diagnostic as a parse failure — an unclosed brace and a borrow error are both an
/// `error[E….]` from one pass over the file. Inventing the distinction from the error code would be
/// gg guessing at a taxonomy the compiler does not have.
fn classify(report: &CompilerReport, file: &str, lines: usize) -> Result<(), PrepareFailure> {
    if report.ok {
        return Ok(());
    }
    // One JSON object per line on stderr, and — because a toolchain may write to stderr for other
    // reasons — a line that is not one is skipped rather than treated as a failure to read the
    // diagnostics at all.
    let diagnostics: Vec<Diagnostic> = report
        .stderr
        .lines()
        .filter_map(|line| serde_json::from_str::<Diagnostic>(line).ok())
        .collect();
    let errors: Vec<&Diagnostic> = diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.is_error())
        .collect();
    if errors.is_empty() {
        return Err(PrepareFailure::Toolchain(format!(
            "rustc {} {} without reporting a diagnostic in {file}{}",
            compiler_version(),
            report.status,
            report.stderr_tail(),
        )));
    }

    // A diagnostic in gg's wrapper or inside the library set is gg's artifact rather than the
    // model's program — but it is still reported, because withholding it would leave the model with
    // "your program did not compile" and nothing else. What is *not* done is inventing a line for
    // it: `render` reports a location only for a span in the model's own file.
    //
    // Which band this is was settled above, on the WHOLE set: every error is a `Compile` on this
    // arm and the only other outcome — a `Toolchain` failure — was decided by `errors` being empty
    // before a single diagnostic was rendered. So the bound below cannot move a verdict from one
    // band to the other; all it decides is how much of a refusal the model reads.
    Err(PrepareFailure::Program(PrepareError::Compile(
        crate::sandbox::language::diagnostics::capped(
            errors
                .iter()
                .map(|diagnostic| diagnostic.render(file, lines))
                .collect(),
            SHOWN,
            "\n\n",
        ),
    )))
}

// ---------------------------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------------------------

/// Encode the core wasm module `rustc` emitted into the component gg's engine instantiates.
///
/// In process, from the bytes, with no `wasm-tools` binary anywhere: the module carries the
/// `component-type` custom sections `wit-bindgen` wrote into the library set, and those sections
/// *are* the world — so this step reads gg's own WIT out of the artifact rather than being told it
/// again. `-C strip=symbols` deletes the name section and leaves them, which was measured rather
/// than assumed.
///
/// Validated on the way out. An invalid component would otherwise fail at
/// [`Component::new`](wasmtime::component::Component) as a
/// [`SandboxError::Compile`](crate::sandbox::SandboxError) — the variant that means gg's *own*
/// committed artifact is broken and ends the session — where what it really is is a toolchain
/// failure on one turn.
fn componentize(module: &[u8]) -> Result<Vec<u8>, String> {
    wit_component::ComponentEncoder::default()
        .validate(true)
        .module(module)
        .and_then(|mut encoder| encoder.encode())
        .map_err(|error| {
            format!(
                "rustc {} compiled the program and gg could not encode it as a component: {error:#}",
                compiler_version()
            )
        })
}

// ---------------------------------------------------------------------------------------------
// The library set
// ---------------------------------------------------------------------------------------------

/// Where the committed library set is unpacked, for this process.
struct Libraries {
    /// The directory holding every `.rlib`, named on `-L dependency=` and `--extern`.
    tree: PathBuf,
}

/// The unpacked library set, materialised once per process.
fn libraries() -> Result<&'static Libraries, String> {
    static LIBRARIES: std::sync::OnceLock<Result<Libraries, String>> = std::sync::OnceLock::new();
    LIBRARIES
        .get_or_init(materialise)
        .as_ref()
        .map_err(Clone::clone)
}

/// Unpack the committed set into a [shared toolchain directory](shared_toolchain_dir).
///
/// The seam's one sanctioned share, taken under the seam's discipline: the key folds in the pinned
/// compiler **and** a digest of the tarball itself, so a gg carrying a different set at the same
/// compiler version reads a different directory rather than another build's files; the write goes
/// through [`place_tree`](super::compile::place_tree), which fills a staging directory, seals it
/// read-only and renames it in, so a reader never sees a half-unpacked tree and nothing can write to
/// a placed one.
///
/// Sharing it needs no further argument than that, because `rustc` only ever **reads** it. Nothing
/// is compiled into it, nothing is generated beside it, and no preparation's output goes anywhere
/// near it — which is what lets this arm name the shared directory directly rather than staging a
/// copy per preparation the way the PureScript arm must.
fn materialise() -> Result<Libraries, String> {
    let root = shared_toolchain_dir(&format!(
        "rust-{}-{:016x}",
        compiler_version(),
        fingerprint(),
    ))?;
    let tree = root.join("lib");
    place_tree(&tree, unpack)?;
    Ok(Libraries { tree })
}

/// Decompress and extract the committed tarball into `into`.
fn unpack(into: &Path) -> Result<(), String> {
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(LIBRARIES_TAR_GZ));
    // The tarball is gg's own build artifact rather than anything a run produced, but the extraction
    // is still confined to `into`: an archive is a file format, and a file format is the wrong place
    // to be trusting.
    archive.set_overwrite(true);
    archive
        .unpack(into)
        .map_err(|error| format!("could not unpack the Rust library set: {error}"))
}

/// A stable digest of the committed tarball, so a change to it changes the directory it is unpacked
/// into. Not cryptographic and not required to be: it distinguishes builds, it does not defend
/// against one.
fn fingerprint() -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    LIBRARIES_TAR_GZ.hash(&mut hasher);
    hasher.finish()
}

#[cfg(test)]
#[path = "rust.compile.test.rs"]
mod tests;
