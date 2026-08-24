//! **The Java compile** — how a model's Java becomes the component that runs it, and what it costs.
//!
//! # The strategy, in one sentence
//!
//! A Java program is compiled to **bytecode by `javac` and then to a `wasm32` core module by
//! TeaVM's `WEBASSEMBLY_WASI` backend**, both inside a warm JVM gg keeps between preparations, and
//! gg encodes that module as a **component of its own** ([`jvm::component`]) — the same shape the
//! [Rust](super::super::rust), [C++](super::super::cpp) and [Swift](super::super::swift) arms have.
//! There is no baked guest and there cannot be one: TeaVM does not produce a Java interpreter that
//! later runs a program, it produces the program.
//!
//! # Why a daemon, and why that is not a hole in the isolation contract
//!
//! Java is the first arm whose compiler is only affordable **warm**. Measured on this repository's
//! dev container: a cold `java` that starts a JVM, loads TeaVM and builds costs **4–9 s**; the same
//! build in a JVM that has already done one costs **0.33–0.56 s**, of which ~30 ms is `javac` and
//! the rest is TeaVM. A per-compile process would make this arm ten times dearer than every other
//! one, which is a difference in the *harness* rather than in the language, and a study cannot carry
//! that.
//!
//! Warmth is also exactly where the measured TeaVM corruption lives: one
//! `InProcessBuildStrategy` driven from four threads produced **no output at all for three of the
//! four** while `build()` threw nothing. So the warmth here is the shape the seam sanctions and not
//! the shape that broke:
//!
//! 1. **A [`CompilerPool`] of processes**, each lent to one preparation at a time. Two preparations
//!    can never be inside one JVM together, so the measured bug's precondition does not exist.
//! 2. **A fresh `InProcessBuildStrategy` per request**, inside the JVM, so a build cannot depend on
//!    what the last one compiled. This one is a belt rather than the braces, and the honest statement
//!    is below.
//! 3. **Output goes where the request says**, which is the calling preparation's own
//!    [workspace](crate::sandbox::Workspace). The daemon remembers no path between requests.
//! 4. **The daemon stands on ground of its own** ([`jvm::daemon`]) rather than on any preparation's
//!    workspace, which is removed when that preparation ends.
//! 5. **A daemon is retired after [`MAX_BUILDS`]**, because a JVM that has built a hundred programs
//!    has a hundred class loaders' worth of metaspace and nothing gg can do about it from here.
//!
//! **Verified by mutation, and one of the two mutations did not fire — which is worth saying.**
//! Pointed at a single shared `classes` directory, the arm's own sixteen-way gate failed four
//! independent ways, including artifacts *carrying another preparation's program*: exactly the
//! silent-corruption shape. But made to reuse one `InProcessBuildStrategy` across builds, it
//! **passed** — because the pool has already removed the precondition the measured bug needed, which
//! was two threads inside one builder at once. So the fresh strategy is kept for what it is (cheap,
//! and the only thing that makes a build independent of the last one through the same JVM) rather
//! than for a failure this gate has been shown to catch.
//!
//! # The two files a build reads, and which of them is the model's
//!
//! [`PROGRAM_FILE`] is the model's reply, byte for byte. Beside it gg writes [`ENTRY_FILE`] — the
//! component's two exports and a call to `Program.main`, with no `try` and no `catch` — and nothing
//! else. TeaVM is given the **model's** class as its main class, so the whole dependency graph is
//! rooted at the program the model wrote.
//!
//! An agent's [code modules](compile_module) are not in that compile. Each is compiled on its own,
//! into a directory of class files that goes on the program compile's **classpath**, which is how
//! this arm's own SDK jar reaches a program. So nothing gg writes puts a module's name in the
//! program's scope: the program writes `lib.csvTools.parse(…)`, or its own `import lib.csvTools;`,
//! or it does not resolve.
//!
//! # What a model is told when its program fails: whatever its runtime said
//!
//! Nothing. gg catches nothing, describes nothing and re-reports nothing. A program that throws dies
//! the way TeaVM kills it — `printHeader(); printStack(); abort();` — and what the model reads is the
//! exception's own message and the model's own file and lines, off the guest's standard error, which
//! is where [ruling D8a](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) says to read
//! it. The one thing gg changed is that upstream TeaVM printed the frames and not the header; see
//! `packages/gg-sandbox-jvm/vendor/org/teavm/runtime/ExceptionHandling.java`.
//!
//! There is no source map on this road and no offset anywhere in this file. A location arrives in the
//! model's own coordinates because the file javac read *is* the model's file.
//!
//! # What the toolchain is, and where it lives
//!
//! Four things, shipped three ways because each can only go one way:
//!
//! | | Where | Why |
//! | --- | --- | --- |
//! | A JDK | the gg toolchain image, or `scripts/ci/install-java.sh` on a developer's machine | ~190 MB with a build per platform; it cannot ride inside a static binary |
//! | TeaVM's jars | the same place | ~29 MB of third-party artifacts, pinned by version |
//! | gg's compiler driver | **inside gg's binary** (`checkers/java.compiler.java`) | it is gg's own code, and a driver of a different vintage from the gg that speaks to it would be a protocol mismatch nobody notices |
//! | this arm's SDK, compiled | **inside gg's binary** (`java.sdk.jar`, cut by this build) | it is the surface a program is compiled against, and one of a different vintage from the catalogue describing it would show a model a surface it is not compiled against |
//!
//! The driver is a **single `.java` file run by the JDK's single-file source-code launcher**, so
//! there is no jar to build, no binary artifact to commit and no reproducible-build gate to keep
//! green. The launcher compiles it in memory once per daemon, inside the JVM start this arm pays
//! anyway.

use std::path::PathBuf;
use std::time::Duration;

use serde::Deserialize;

use crate::sandbox::CodeModule;
use crate::sandbox::language::compile::{
    CompilerDaemon, CompilerPool, Workspace, place, place_bytes,
};
use crate::sandbox::language::jvm::{self, HOME_ROOT, IMAGE_ROOT, JAVA_ENV, TEAVM_ENV};
use crate::sandbox::language::{
    PrepareContext, PrepareError, PrepareFailure, PreparedModule, PreparedProgram,
};

use super::source;

/// This arm's half of gg's compiler driver: the front end that reads a model's **Java**.
///
/// What runs is this text with [the shared JVM backend](jvm::driver) — `javac`, TeaVM, the
/// diagnostic shapes and the JSON — appended to it, because those are the same whatever language a
/// program was written in and one of TeaVM's settings fails silently when it goes missing.
const FRONT: &str = include_str!("../checkers/java.compiler.java");

/// This arm's **SDK**, compiled: the jar both compilers put on their classpath.
///
/// Java reaches a library through the classpath, so the surface a model writes against is a jar
/// rather than a source tree — javac resolves `fs.readFile` against it and TeaVM translates the
/// bytecode behind it out of the same file.
///
/// It rides **inside gg's binary** rather than in the [toolchain image](super), which is the split
/// [PureScript](super::super::purescript)'s library tarball is on the same side of and for the same
/// reason: the image is built separately from the binary that runs in it, so an SDK living there
/// could be a different vintage from the gg whose catalogue describes it — and a model shown one
/// surface in its prompt and compiled against another is the failure this seam exists to prevent.
///
/// And it is **compiled by this build**, out of `packages/gg-sandbox-java/src`, by that package's
/// `build.sh` — not committed. That closes the last gap in the sentence above, which used to end
/// "…and it is the half of the pair that can be committed stale". It could, and it was: the change
/// that added `@throws` prose to `Files.java`, `Views.java` and `Context.java` moved the catalogue
/// on the next build and left the jar at the previous vintage, and nothing about a `.jar` looks
/// stale. Now the library and the description of it are cut from one `src/` on one build, so being
/// two vintages is not a state this arm can be in.
const SDK: &[u8] = include_bytes!(concat!(env!("GG_ARTIFACTS_JAVA"), "/java.sdk.jar"));

/// What the toolchain the driver is run against is pinned to.
const MANIFEST_JSON: &str = include_str!("../checkers/java.toolchain.json");

/// How many programs one JVM builds before it is thrown away.
///
/// Every build makes a fresh class loader over the toolchain's jars, which is what keeps a build a
/// function of its own input — and what makes a long-lived JVM's metaspace grow. Retiring costs one
/// cold start (~4 s) amortised over this many builds, which is under 1% of the warm cost.
const MAX_BUILDS: usize = 64;

/// How many warm JVMs may exist at once.
///
/// Not `WIDTH` in `language/isolation.rs`. A JVM with TeaVM loaded holds several hundred
/// megabytes, so sixteen of them is a container that swaps rather than an arm that is four times
/// faster; a preparation that arrives when all four are out waits, which costs nothing because
/// preparation runs on a blocking task. Four is what the feasibility study measured concurrency at
/// (1.3–2.5 s per agent at 4-way on 2 cores).
const POOL_SIZE: usize = 4;

/// How long one build may take before the daemon is retired and the failure reported as a
/// [toolchain failure](PrepareFailure::Toolchain).
///
/// Generous against a warm build's 0.33–0.56 s, because a *cold* one is 4–9 s and a machine under
/// sixteen-way load is slower still — while being unmistakably a hang rather than a slow compile.
const BUILD_TIMEOUT: Duration = Duration::from_secs(180);

/// How long starting a JVM and reading its handshake may take.
const START_TIMEOUT: Duration = Duration::from_secs(120);

/// The heap one of this arm's warm JVMs gets, floor and ceiling both — see [`jvm::daemon`].
const HEAP: &str = "768m";

/// The name this arm's SDK jar is placed under, beside the driver.
const SDK_FILE: &str = "gg-sdk.jar";

/// The file a program's source is written into, and the one its diagnostics are located in.
///
/// Named for the class a program declares, because javac requires a public class and its file to
/// agree — which is what makes half of [the convention](super::source) javac's own diagnostic rather
/// than gg's.
pub(super) const PROGRAM_FILE: &str = "Program.java";

/// The file a code module is **checked** in at the read that binds it, named for the class that read
/// compiles it under.
pub(super) const MODULE_FILE: &str = "Module.java";

/// The file gg's generated entry class is written into.
const ENTRY_FILE: &str = "GgEntry.java";

/// The directory javac writes a program's own classes into, under the preparation's workspace.
const PROGRAM_CLASSES: &str = "classes";

/// The file one code module is compiled from, named for the class it declares — which is the key
/// the agent bound it at.
///
/// Java names a compilation unit by its own public type, so this name is not a choice: it is the
/// key. What it buys is that every diagnostic about a module carries the key in the file position,
/// which is the one coordinate a model can act on for code it did not write.
fn module_file(key: &str) -> String {
    format!("{key}.java")
}

/// Where that file is written: a directory of the module's own, so no two modules and no program
/// share a compile's inputs.
fn module_source(key: &str) -> String {
    format!("{MODULE_ROOT}/{key}/{}", module_file(key))
}

/// Where its classes are written, and the path that goes on the **classpath** of every program
/// compiled against it.
fn module_classes(key: &str) -> String {
    format!("{MODULE_ROOT}/{key}/{PROGRAM_CLASSES}")
}

/// The directory an agent's code modules are built under, inside the preparation's own workspace.
const MODULE_ROOT: &str = "modules";

/// What TeaVM is asked to write: a `wasm32` core module, which is what the `.wasm` extension selects
/// in [the shared driver](super::super::jvm).
const CORE_MODULE_FILE: &str = "program.wasm";

/// The name the driver is placed under. The JDK's single-file launcher requires the file name to
/// match the public class it holds.
const DRIVER_FILE: &str = "GgCompiler.java";

/// What this arm's toolchain is pinned to.
#[derive(Debug, Deserialize)]
struct Manifest {
    /// The TeaVM release the jars are, and the one the driver is compiled against.
    teavm: String,
    /// The JDK release `scripts/ci/install-java.sh` and the toolchain image install.
    #[cfg_attr(
        not(test),
        allow(dead_code, reason = "read by the toolchain pin's own drift gate")
    )]
    jdk: String,
    /// The driver protocol gg speaks. A driver answering anything else is refused at the handshake.
    protocol: u32,
}

/// The parsed manifest, read once per process.
fn manifest() -> &'static Manifest {
    static MANIFEST: std::sync::OnceLock<Manifest> = std::sync::OnceLock::new();
    MANIFEST.get_or_init(|| {
        serde_json::from_str(MANIFEST_JSON)
            .expect("the committed Java toolchain pin is valid JSON of the expected shape")
    })
}

/// The TeaVM release a program is compiled by, for the run's record and for an operator reading a
/// diagnostic and wondering whose it is.
pub(super) fn compiler_version() -> &'static str {
    &manifest().teavm
}

/// Start one JVM and place the driver now, so the first code turn does not pay for either.
///
/// Best effort and idempotent: a failure here is the failure the first compile will make, and there
/// it is classified, counted and reported.
pub(super) fn warm() {
    if let Ok(checkout) = POOL.checkout(JavaCompiler::start) {
        drop(checkout);
    }
}

/// **How many JVMs the pool is holding**, so a test can assert that four compilations went through
/// one of them rather than infer it from how long they took.
#[cfg(test)]
pub(super) fn live_jvms() -> usize {
    POOL.live()
}

/// **Throw the pool's warm JVMs away**, so the next compilation pays for a new one.
///
/// Test-only, and it is what lets a COLD reading be taken at a chosen moment instead of only at the
/// start of a process — see [`CompilerPool::evict_idle`].
#[cfg(test)]
pub(super) fn discard_pooled_jvms() {
    POOL.evict_idle();
}

/// Compile a **program** — a model's reply — into the component that runs it.
///
/// [`source`](PreparedProgram::source) is empty: there is nothing left for a guest to evaluate,
/// because the guest *is* what this returned.
pub(super) fn compile_program(
    source: &str,
    modules: &[CodeModule],
    context: &PrepareContext,
) -> Result<PreparedProgram, PrepareFailure> {
    Ok(PreparedProgram {
        source: String::new(),
        component: Some(compile(source, modules, context)?),
    })
}

/// Compile one model program into a component, or say why it could not be.
///
/// `modules` are this agent's loaded code [skills](crate::skills) and [memories](crate::memories),
/// each already through [`compile_module`]. Every one of them is compiled **first, and on its own**
/// ([`build_module`]), and what this compile is given is the directory of class files that compile
/// wrote — a classpath entry, exactly as this arm's SDK jar is. The program's own compile therefore
/// reads two files, both of which name only what the model declared.
fn compile(
    program: &str,
    modules: &[CodeModule],
    context: &PrepareContext,
) -> Result<Vec<u8>, PrepareFailure> {
    let workspace = context.workspace().map_err(PrepareFailure::Toolchain)?;
    // THE MODEL'S OWN BYTES. No wrapper, no header, no entry point, no import.
    workspace
        .write(PROGRAM_FILE, program)
        .map_err(PrepareFailure::Toolchain)?;
    workspace
        .write(ENTRY_FILE, &entry_class())
        .map_err(PrepareFailure::Toolchain)?;

    let mut classpath: Vec<String> = Vec::new();
    for module in modules {
        classpath.push(build_module(workspace, module)?);
    }

    let files = [PROGRAM_FILE.to_string(), ENTRY_FILE.to_string()];
    let report = request(
        workspace,
        PROGRAM_CLASSES,
        &classpath,
        source::PROGRAM_CLASS,
        CORE_MODULE_FILE,
        &files,
    )?;
    verdict(&report, PROGRAM_FILE)?;

    let artifact = workspace.output().join(CORE_MODULE_FILE);
    let module = std::fs::read(&artifact).map_err(|error| {
        PrepareFailure::Toolchain(format!(
            "TeaVM {} reported success and wrote no module to {}: {error}",
            compiler_version(),
            artifact.display(),
        ))
    })?;
    jvm::component::componentize(&module).map_err(PrepareFailure::Toolchain)
}

/// Check a code [skill](crate::skills)'s or [memory](crate::memories)'s Java, and report the names
/// its namespace offers.
///
/// What comes back is **the author's own source**, not an artifact, because the key the module will
/// be bound at does not exist yet and the key is the name of the class it is compiled under. So this
/// hands on the body, and [`build_module`] compiles it under that key for each program that uses it.
///
/// The compiler still runs, and what it buys is the *location*. Without it a module that does not
/// compile would take the turn of whoever loaded it, in a file its author never wrote, for as long
/// as it stayed loaded. Running `javac` here instead tells the author at the read, at the module's
/// own line and column.
///
/// **javac and not TeaVM**: this output is thrown away, so asking for a wasm module would be paying
/// TeaVM for an artifact nothing reads — and everything an author can get wrong that TeaVM would
/// catch (a classlib method that is not there) is caught again, at the same line, on the first
/// program compiled against it.
pub(super) fn compile_module(
    source: &str,
    context: &PrepareContext,
) -> Result<PreparedModule, PrepareFailure> {
    let workspace = context.workspace().map_err(PrepareFailure::Toolchain)?;
    let wrapped = source::wrap_module(source, source::MODULE_CHECK_CLASS)?;
    workspace
        .write(MODULE_FILE, &wrapped.source)
        .map_err(PrepareFailure::Toolchain)?;

    let report = request(
        workspace,
        PROGRAM_CLASSES,
        &[],
        CHECK_ONLY,
        CHECK_ONLY,
        &[MODULE_FILE.to_string()],
    )?;
    verdict(&report, MODULE_FILE)?;
    Ok(PreparedModule {
        source: source.to_string(),
        exports: wrapped.exports,
    })
}

/// Compile one loaded code module under its binding key, and hand back the classpath entry a program
/// reaches it through.
///
/// A compile of its own, with the SDK and the toolchain on its classpath and **nothing else**: a
/// module sees gg's surface, the library set and its own declarations, and no other module — the
/// same scope it was checked in at the read.
///
/// A failure here is the model's to act on rather than the operator's, and it names the key: the
/// module is the thing to fix or to stop loading, and a session told nothing would meet it again on
/// every turn.
fn build_module(workspace: &Workspace, module: &CodeModule) -> Result<String, PrepareFailure> {
    let key = module.name.as_str();
    let wrapped =
        source::wrap_module(&module.source, key).map_err(|failure| about(key, failure))?;
    workspace
        .write(&module_source(key), &wrapped.source)
        .map_err(PrepareFailure::Toolchain)?;

    let classes = module_classes(key);
    let report = request(
        workspace,
        &classes,
        &[],
        CHECK_ONLY,
        CHECK_ONLY,
        &[module_source(key)],
    )?;
    verdict(&report, &module_file(key)).map_err(|failure| about(key, failure))?;
    Ok(classes)
}

/// One of [`build_module`]'s failures, said as something about the code this session loaded.
///
/// Only the model-facing bands are renamed: a toolchain failure is the operator's whatever compiled
/// when it happened, and saying a key in front of it would blame a skill for a JVM that would not
/// start.
fn about(key: &str, failure: PrepareFailure) -> PrepareFailure {
    let said = match failure {
        PrepareFailure::Program(PrepareError::Syntax(said) | PrepareError::Compile(said)) => {
            PrepareError::Compile(format!(
                "the code this session loaded at `{key}` does not compile: {said}"
            ))
        }
        PrepareFailure::Program(PrepareError::Unsupported(said)) => PrepareError::Unsupported(
            format!("the code this session loaded at `{key}` cannot be built: {said}"),
        ),
        other => return other,
    };
    PrepareFailure::Program(said)
}

/// The main class and target file that ask [the driver](super::super::jvm) for `javac` alone.
///
/// Empty, which is the one value neither field can otherwise take: a class has a name and a target
/// file has one. It exists because a module is *checked* rather than built — see
/// [`compile_module`] — and asking TeaVM for a module with no entry point would be asking it for
/// nothing.
const CHECK_ONLY: &str = "";

/// One build request, as the driver reads it: the preparation's two directories, the directory
/// javac writes classes into, the classpath entries to add to the toolchain's own, the class TeaVM
/// roots the program at, the artifact to write, and the sources to compile.
///
/// Every path but the first two is **relative to the work directory**, which the driver resolves
/// against it. The classpath field is joined the way Java joins one, so the driver splits it on
/// `File.pathSeparator` exactly as it splits the classpath it was started with.
fn wire_request(
    workspace: &Workspace,
    classes: &str,
    classpath: &[String],
    main_class: &str,
    target: &str,
    files: &[String],
) -> String {
    format!(
        "{}\t{}\t{classes}\t{}\t{main_class}\t{target}\t{}",
        workspace.work().display(),
        workspace.output().display(),
        classpath.join(CLASSPATH_SEPARATOR),
        files.join("\t"),
    )
}

/// What Java's `File.pathSeparator` is on the platforms gg's Java arm runs on, which is every
/// platform a JDK and TeaVM are installed on by `scripts/ci/install-java.sh` and the toolchain
/// image.
const CLASSPATH_SEPARATOR: &str = ":";

/// Send one build to a warm JVM and read what it answered.
fn request(
    workspace: &Workspace,
    classes: &str,
    classpath: &[String],
    main_class: &str,
    target: &str,
    files: &[String],
) -> Result<Report, PrepareFailure> {
    let mut compiler = POOL
        .checkout(JavaCompiler::start)
        .map_err(PrepareFailure::Toolchain)?;
    let request = wire_request(workspace, classes, classpath, main_class, target, files);
    let answered = match compiler.request(&request, BUILD_TIMEOUT) {
        Ok(answered) => answered,
        Err(failure) => {
            // A JVM that did not answer is a JVM nothing should build on top of.
            compiler.retire();
            return Err(PrepareFailure::Toolchain(failure));
        }
    };
    let report: Report = match serde_json::from_str(&answered) {
        Ok(report) => report,
        Err(error) => {
            let tail = compiler.stderr_tail();
            compiler.retire();
            return Err(PrepareFailure::Toolchain(format!(
                "gg could not read what its Java compiler answered ({error}){tail}"
            )));
        }
    };
    if compiler.spent() {
        compiler.retire();
    }
    if let Some(internal) = &report.internal {
        return Err(PrepareFailure::Toolchain(format!(
            "TeaVM {} could not build the program: {internal}",
            compiler_version(),
        )));
    }
    Ok(report)
}

// ---------------------------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------------------------

/// What one build of the driver reported.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Report {
    /// Whether the build produced its artifact.
    ///
    /// Part of the driver's protocol and deliberately kept, though nothing reads it: the [verdict]
    /// is decided by the diagnostics, because a build that "succeeded" with an error among them is
    /// a driver bug rather than a program gg should run. Dropping the field would leave a wire
    /// value serde silently discards and nothing in the diff to say gg had seen it.
    #[allow(dead_code, reason = "the diagnostics are the verdict")]
    ok: bool,
    /// A failure of gg's driver or of TeaVM itself rather than of the program — nothing read the
    /// model's Java, so there is no diagnostic and the model is not blamed.
    internal: Option<String>,
    /// Everything either compiler said.
    diagnostics: Vec<Diagnostic>,
}

/// One thing a compiler said.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Diagnostic {
    /// Which compiler said it: `javac` or `teavm`.
    stage: String,
    /// Whether it stops the build.
    error: bool,
    /// javac's own stable code — `compiler.err.cant.resolve.location` — or nothing.
    code: Option<String>,
    /// The file it is about, as gg named it.
    file: Option<String>,
    /// 1-based line in that file, or 0.
    line: usize,
    /// 1-based column, or 0.
    column: usize,
    /// The prose.
    message: String,
}

/// javac's own codes for *the parser could not read this*, as opposed to *I read it and disagreed*.
///
/// Prefixes rather than exact codes: javac has dozens of `compiler.err.expected…` variants and they
/// are all one thing to a model — a typo — where a `cant.resolve` is a program written whole against
/// the wrong surface. That is the distinction
/// [`Syntax`](PrepareError::Syntax) and [`Compile`](PrepareError::Compile) exist to keep apart.
const PARSE_ERROR_PREFIXES: [&str; 6] = [
    "compiler.err.expected",
    "compiler.err.illegal",
    "compiler.err.premature.eof",
    "compiler.err.unclosed",
    "compiler.err.not.stmt",
    "compiler.err.class.expected",
];

/// How many distinct diagnostics a model is shown.
///
/// Eight, the same as [Kotlin's](super::super::kotlin), and here the sameness is the point rather
/// than a default taken for want of an argument. The two JVM arms share
/// [the driver](super::super::jvm), the [`Diagnostic`] shape and the rendering, and they are the
/// pair an A/B most naturally compares — so an arm that showed fifty diagnostics beside one that
/// showed eight would have the comparison measuring context size along with the language.
///
/// The measurement it costs: one misremembered SDK name called at fifty call sites is 5139 bytes
/// across 199 lines out of this arm, so a diagnostic is ~103 bytes and ~4 lines and eight of them
/// is ~820 bytes.
///
/// # This arm had a ceiling already, and it was not one
///
/// Alone among the uncapped arms, javac stops on its own: `-Xmaxerrs` defaults to 100 and
/// [the driver](super::super::jvm) does not set it — its option list is `-g`, `-nowarn`, `--release`
/// (`crates/gg/src/sandbox/checkers/jvm.backend.java`) — and the limit applies to the
/// `DiagnosticCollector` the driver reads through exactly as it does to the command line, which was
/// measured rather than assumed: 150 unresolvable calls through that same option list arrive as 100
/// diagnostics and no note saying so. At the measured ~103 bytes each that ceiling is ~10 KB, which
/// is a truncation with no count attached rather than a bound worth having.
///
/// TeaVM, the other half of this arm's compile, has no such limit at all and reports one problem per
/// **call site** — the shape that produced the measurement above.
const SHOWN: usize = 8;

/// Turn a finished build into a verdict.
///
/// Four bands, decided by **which file** — and by which compiler — was talking:
///
/// * the model's own file — the model's diagnostic, rendered in the model's own coordinates,
///   because the file javac read is the file the model wrote and there is nothing to correct;
/// * [`ENTRY_FILE`] — gg's one generated file, which names something the model declared and can
///   fail for exactly one reason: the program did not declare what that file names. That is a
///   **shape refusal shown to the model**, in the words of the convention it broke, rather than a
///   toolchain failure the model is not told about
///   ([ruling D4](https://docs.testcabinet.ai/gg/responses-as-code/invariants/));
/// * a **TeaVM** diagnostic about any other file — which is the classlib refusing to translate
///   something the program's own call graph reached, named in the classlib's own file. It is the
///   model's, and it says what is missing: `java.nio.file.Files.readString` is
///   `Method java.io.BufferedReader.transferTo … was not found`, which is a call to write another
///   way rather than a broken toolchain. A code module's own class is on the same road, and its
///   file is named for the key it is bound at;
/// * anything else — a file nobody named — which is drift rather than anything this program did, and
///   is reported to the operator.
pub(crate) fn verdict(report: &Report, file: &str) -> Result<(), PrepareFailure> {
    let errors: Vec<&Diagnostic> = report
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.error)
        .collect();
    if errors.is_empty() {
        return Ok(());
    }

    let mine: Vec<&&Diagnostic> = errors
        .iter()
        .filter(|diagnostic| diagnostic.file.as_deref() == Some(file))
        .collect();
    if mine.is_empty() {
        let rendered = errors
            .iter()
            .map(|diagnostic| diagnostic.render(file))
            .collect::<Vec<_>>()
            .join(" | ");
        if errors.iter().all(|diagnostic| diagnostic.stage == "teavm") {
            return Err(PrepareFailure::Program(PrepareError::Compile(
                crate::sandbox::language::diagnostics::capped(
                    errors
                        .iter()
                        .map(|diagnostic| diagnostic.render(file))
                        .collect(),
                    SHOWN,
                    "\n\n",
                ),
            )));
        }
        if errors
            .iter()
            .all(|diagnostic| diagnostic.file.as_deref() == Some(ENTRY_FILE))
        {
            return Err(PrepareFailure::Program(PrepareError::Unsupported(format!(
                "the entry point does not compile: gg calls `{program}.main(new String[0])`, \
                 and that call does not resolve against this program: {rendered}\n\nWrite the \
                 reply as one compilation unit declaring `public final class {program}` with a \
                 `public static void main(String[] args)` in it. Any other declaration — a \
                 second class, a record, an enum — goes beside it in the same file.",
                program = source::PROGRAM_CLASS,
            ))));
        }
        return Err(PrepareFailure::Toolchain(format!(
            "the Java toolchain refused a file gg generated rather than the program: {rendered}"
        )));
    }

    // Deduplicated and capped through the seam's own bound: TeaVM reports one problem per call site,
    // so a single unsupported call is one thing to fix however many times it is named.
    let rendered = crate::sandbox::language::diagnostics::capped(
        mine.iter()
            .map(|diagnostic| diagnostic.render(file))
            .collect(),
        SHOWN,
        "\n\n",
    );
    // A parse failure anywhere is the whole verdict: javac never got as far as meaning, so whatever
    // else it says is downstream of text it could not read.
    //
    // `mine` and not the capped rendering, and that is the invariant rather than a preference: the
    // band is decided on the WHOLE set, so a parse error the bound did not show is still a parse
    // error. Asking the kept eight instead would let a program whose ninth diagnostic was the
    // unclosed brace be reported as a program javac read and disagreed with.
    Err(PrepareFailure::Program(
        match mine.iter().any(|diagnostic| diagnostic.is_parse_error()) {
            true => PrepareError::Syntax(rendered),
            false => PrepareError::Compile(rendered),
        },
    ))
}

impl Diagnostic {
    /// Whether javac refused to *read* the program, as opposed to reading it and disagreeing.
    fn is_parse_error(&self) -> bool {
        self.stage == "javac"
            && self.code.as_deref().is_some_and(|code| {
                PARSE_ERROR_PREFIXES
                    .iter()
                    .any(|prefix| code.starts_with(prefix))
            })
    }

    /// This diagnostic as the model reads it: `Program.java:7:19: cannot find symbol …`.
    ///
    /// The coordinate is the compiler's own, uncorrected, because the file it read is the file the
    /// model wrote. A TeaVM diagnostic has no column — its locations are per statement — so it
    /// prints one coordinate rather than two.
    fn render(&self, file: &str) -> String {
        let located = match (self.file.as_deref() == Some(file), self.line) {
            (true, 0) => file.to_string(),
            (true, line) => match self.column {
                0 => format!("{file}:{line}"),
                column => format!("{file}:{line}:{column}"),
            },
            // Somebody else's file: TeaVM's classlib names its own, and there is nothing else a
            // build reads that has one.
            (false, _) => self
                .file
                .as_deref()
                .unwrap_or("gg's own generated code")
                .to_string(),
        };
        // TeaVM's refusals are the interesting half of this arm's compile band: a class its
        // 1,213-class classlib does not carry is named here, at the model's own line, rather than
        // discovered at run time.
        format!("{located}: {}", self.message.trim_end())
    }
}

// ---------------------------------------------------------------------------------------------
// The generated entry class
// ---------------------------------------------------------------------------------------------

/// [The shared entry class](jvm::entry_class), with this arm's own one line in it.
///
/// `Program.main(new String[0]);` against [Kotlin's](super::super::kotlin::compile::entry_class)
/// `ProgramKt.main();`, and that is the whole of the difference between the two arms' generated
/// entry classes — which [`jvm`]'s own tests assert by comparing what these two
/// functions actually write.
///
/// `new String[0]` and not `null`: a model's `main` may read `args.length`, and Java's own launcher
/// hands it an empty array rather than nothing.
pub(in crate::sandbox::language) fn entry_class() -> String {
    jvm::entry_class(&format!("{}.main(new String[0]);", source::PROGRAM_CLASS))
}

// ---------------------------------------------------------------------------------------------
// The warm JVMs
// ---------------------------------------------------------------------------------------------

/// The warm JVMs, lent one at a time.
static POOL: CompilerPool<JavaCompiler> = CompilerPool::new(POOL_SIZE);

/// One warm JVM running gg's compiler driver.
struct JavaCompiler {
    /// The process.
    process: CompilerDaemon,
    /// How many programs it has built.
    builds: usize,
}

impl JavaCompiler {
    /// Start one, place the driver if this is the first, and read its handshake.
    fn start() -> Result<Self, String> {
        let toolchain = jvm::toolchain()?;
        let placed = placed()?;
        // The SDK goes on the same classpath TeaVM's own jars are on, which is the classpath the
        // driver hands to javac *and* to TeaVM. A model's `fs.readFile("x")` therefore type-checks
        // against the same bytes TeaVM translates, and there is no second path to keep in step.
        //
        // IT GOES FIRST, AND THE ORDER IS LOAD-BEARING. The jar carries one vendored TeaVM runtime
        // class — `org.teavm.runtime.ExceptionHandling`, changed in one place so that an uncaught
        // exception prints WHAT was thrown and not only where — and TeaVM resolves the classes it
        // translates from the classpath it is given, first match winning. Behind `teavm-core.jar`
        // the copy would never be read and the change would vanish with no diagnostic. See
        // `packages/gg-sandbox-jvm/vendor/org/teavm/runtime/ExceptionHandling.java`.
        let classpath = format!("{}:{}", placed.sdk.display(), toolchain.classpath);
        let started = jvm::daemon(&toolchain.java, HEAP).and_then(|mut command| {
            command
                .arg("-cp")
                .arg(&toolchain.classpath)
                // The driver's own source. The JDK's single-file launcher compiles it in memory,
                // which is why gg builds no jar of its own for it.
                .arg(&placed.driver)
                .arg(&classpath);
            command.start()
        });
        started
            .and_then(|mut process| {
                let greeting = process.reply(START_TIMEOUT)?;
                handshake(&greeting)?;
                Ok(Self { process, builds: 0 })
            })
            .map_err(|error| {
                format!(
                    "gg compiles every Java program with the JDK and the TeaVM jars in the gg run \
                     image, and needs them in {IMAGE_ROOT}, under ~/{HOME_ROOT} \
                     (scripts/ci/install-java.sh), or named by {JAVA_ENV} and {TEAVM_ENV}: {error}"
                )
            })
    }

    /// Send one build request and read its answer.
    fn request(&mut self, request: &str, timeout: Duration) -> Result<String, String> {
        self.builds += 1;
        self.process.request(request, timeout)
    }

    /// The tail of what this JVM wrote to stderr.
    fn stderr_tail(&self) -> String {
        self.process.stderr_tail()
    }

    /// Whether it has built enough programs to be worth replacing.
    fn spent(&self) -> bool {
        self.builds >= MAX_BUILDS
    }
}

/// Read the driver's handshake and refuse a driver speaking another protocol.
///
/// The one thing a protocol version buys that nothing else does: gg's binary and the toolchain image
/// are built separately, and a driver from one and a gg from the other would otherwise disagree by
/// silently mis-reading a field. This one carries gg's own driver — it is embedded — so a mismatch
/// can only mean a `java` old enough to have compiled it differently, which is worth saying out loud.
fn handshake(greeting: &str) -> Result<(), String> {
    #[derive(Deserialize)]
    struct Greeting {
        /// The protocol the driver speaks.
        protocol: u32,
    }
    // The line itself is in the message, and it is the whole of the diagnostic's value: a parse
    // error alone says a JVM answered wrongly and never what it answered, which is a dead end when
    // the answer came from somewhere gg did not expect (see `jvm::LOG_TO_STDERR`, found the hard way
    // through exactly this message with the evidence thrown away).
    let line = greeting.trim();
    let greeting: Greeting = serde_json::from_str(line).map_err(|error| {
        format!("gg could not read its Java compiler's greeting ({error}): {line:?}")
    })?;
    if greeting.protocol != manifest().protocol {
        return Err(format!(
            "gg speaks protocol {} to its Java compiler and this one answered {}",
            manifest().protocol,
            greeting.protocol,
        ));
    }
    Ok(())
}

/// The two files gg carries inside its own binary, unpacked once per machine.
pub(super) struct Placed {
    /// gg's compiler driver, run by the JDK's single-file source-code launcher.
    driver: PathBuf,
    /// This arm's SDK, as the jar both compilers put on their classpath.
    pub sdk: PathBuf,
}

/// Where gg's own two files are on disk, placing them on first use.
///
/// The seam's one sanctioned share, taken under the seam's discipline: the directory's key folds in
/// the pinned TeaVM release **and** a digest of both files' own bytes, so a gg carrying a different
/// driver or a different SDK reads a different directory rather than another build's files; each
/// write goes through [`place`], which renames a complete file into place. Nothing ever writes to it
/// again — a JVM only reads it.
///
/// The SDK's digest is in the key for a reason a driver's is not: an SDK edit changes what a
/// program *compiles against*, so a stale jar left in a shared directory would compile a model's
/// program against a surface its own prompt does not describe.
pub(super) fn placed() -> Result<&'static Placed, String> {
    static PLACED: std::sync::OnceLock<Result<Placed, String>> = std::sync::OnceLock::new();
    PLACED
        .get_or_init(|| {
            let source = jvm::driver(FRONT);
            let root = jvm::placed_dir("java", compiler_version(), &[source.as_bytes(), SDK])?;
            let driver = root.join(DRIVER_FILE);
            if !driver.is_file() {
                place(&driver, &source)?;
            }
            let sdk = root.join(SDK_FILE);
            if !sdk.is_file() {
                place_bytes(&sdk, SDK)?;
            }
            Ok(Placed { driver, sdk })
        })
        .as_ref()
        .map_err(Clone::clone)
}

#[cfg(test)]
#[path = "java.compile.test.rs"]
mod tests;

/// **The JVM arms' wasm substrate**, driven end to end through this file's own compiler pool.
///
/// Declared here rather than beside `jvm.rs` because what it drives is this arm's real driver, out
/// of this arm's real pool: the pieces it proves are shared with Kotlin, but there is exactly one
/// JVM daemon and it is checked out from here.
#[cfg(test)]
#[path = "jvm.wire.test.rs"]
mod wire_tests;
