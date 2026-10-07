//! **The Kotlin compile** — how a model's Kotlin becomes the component that runs it, and what it
//! costs.
//!
//! # The strategy, in one sentence
//!
//! A Kotlin program is compiled to **bytecode by the Kotlin compiler and then to a `wasm32` core
//! module by TeaVM's `WEBASSEMBLY_WASI` backend**, both inside a warm JVM gg keeps between
//! preparations, and gg encodes that module as a **component of its own**
//! ([`component`](super::super::jvm::component)) — the same shape the
//! [Java](super::super::java), [Rust](super::super::rust), [C++](super::super::cpp) and
//! [Swift](super::super::swift) arms have. There is no baked guest and there cannot be one: TeaVM
//! does not produce a Kotlin interpreter that later runs a program, it produces the program.
//!
//! It therefore rides [the road the Java arm shares with it](super::super::jvm): the same JDK, the
//! same TeaVM jars, the same TeaVM settings, the same generated entry class, the same canonical ABI
//! and the same component encode. What is this arm's own is the **front** of it — the compiler that
//! reads the model's source, and what its diagnostics look like.
//!
//! # Why the compiler is embedded rather than spawned
//!
//! `kotlinc` is a shell script around a JVM and has no daemon of its own to ask, but the compiler
//! **warms** dramatically when it is embedded. Measured on this repository's dev container, through
//! this arm's own driver: the first build in a JVM costs 1.7–9 s and the ones after it cost
//! **0.14–0.4 s** of Kotlin plus TeaVM's own translation. A per-compile process would make this arm
//! ten times dearer than every other one, which is a difference in the *harness* rather than in the
//! language, and a study cannot carry that.
//!
//! So the shape is [Java's](super::super::java::compile), for the same reasons and with the same
//! guarantees: a [`CompilerPool`] of JVM **processes**, each lent to one preparation at a time, a
//! fresh compiler and a fresh TeaVM build strategy per request, output written where the request
//! says, and a daemon retired after [`MAX_BUILDS`] because every build leaves class loaders behind
//! that gg cannot reclaim from here. Two preparations are never inside one JVM together, which is
//! the precondition of the measured TeaVM corruption the seam's isolation rule exists for.
//!
//! # The two files a build reads, and which of them is the model's
//!
//! [`PROGRAM_FILE`] is the model's reply, byte for byte. Beside it gg writes [`ENTRY_FILE`] — the
//! component's two exports and a call to `ProgramKt.main`, with no `try` and no `catch` — and
//! nothing else. TeaVM is given the **model's** own facade class as its main class, so the whole
//! dependency graph is rooted at the program the model wrote.
//!
//! An agent's [code modules](compile_module) are not in that compile. Each is compiled on its own,
//! into a directory of class files that goes on the program compile's **classpath**, which is how
//! this arm's own SDK jar reaches a program. So nothing gg writes puts a module's name in the
//! program's scope: the program writes `lib.csvTools.slugify(…)`, or its own
//! `import lib.csvTools.*`, or it does not resolve.
//!
//! # What a model is told when its program fails: whatever its runtime said
//!
//! Nothing. gg catches nothing, describes nothing and re-reports nothing. A program that throws dies
//! the way TeaVM kills it — `printHeader(); printStack(); abort();` — and what the model reads is the
//! exception's own message and the model's own file and lines, off the guest's standard error, which
//! is where [the failure rule](https://docs.testcabinet.ai/gg/responses-as-code/invariants/#failures) says to
//! read it. The one thing gg changed is that upstream TeaVM printed the frames and not the header; see
//! `packages/gg-sandbox-jvm/vendor/org/teavm/runtime/ExceptionHandling.java`.
//!
//! There is no source map on this road and no offset anywhere in this file. A location arrives in the
//! model's own coordinates because the file the compiler read *is* the model's file.
//!
//! # The four ways a compile can end, and whose fault each is
//!
//! | What happened | How it is reported |
//! | --- | --- |
//! | the Kotlin compiler's `SYNTAX` diagnostic | [`Syntax`](PrepareError::Syntax) — the parser could not read it |
//! | any other Kotlin error in the model's own file | [`Compile`](PrepareError::Compile) — read whole and rejected, which is the band a typed arm exists to produce |
//! | TeaVM naming a class or method its classlib does not carry | [`Compile`](PrepareError::Compile), **including when the file it names is the standard library's** |
//! | javac refusing [`ENTRY_FILE`] | [`Unsupported`](PrepareError::Unsupported) — a shape refusal quoting the one convention back |
//!
//! The third row is where this arm parts company with [Java's](super::super::java::compile::verdict),
//! and the reason is the language rather than a preference. A Java program reaches TeaVM's classlib
//! **directly**, so a diagnostic in a file that is not the model's is gg's own generated code and
//! blaming a model for it would send it rewriting something that was never wrong. A Kotlin program
//! reaches that classlib *through a standard library written in its own language* — so
//! `kotlin.concurrent.thread { … }` is refused at `kotlin/concurrent/Thread.kt`, which is a fact
//! about the program the model wrote and is reported as one, with the library's own file named so
//! the model can see what it reached through.

use std::path::PathBuf;
use std::time::Duration;

use serde::Deserialize;

use crate::sandbox::CodeModule;
use crate::sandbox::language::compile::{
    CompilerDaemon, CompilerPool, Workspace, place, place_bytes,
};
use crate::sandbox::language::jvm;
use crate::sandbox::language::{
    PrepareContext, PrepareError, PrepareFailure, PreparedModule, PreparedProgram,
};

use super::source;

/// This arm's half of gg's compiler driver: the front end that reads a model's **Kotlin**.
const FRONT: &str = include_str!("../checkers/kotlin.compiler.java");

/// What the toolchain the driver is run against is pinned to.
const MANIFEST_JSON: &str = include_str!("../checkers/kotlin.toolchain.json");

/// This arm's **SDK**, compiled: the jar both compilers put on the classpath a model's own source is
/// read against.
///
/// Inside gg's binary rather than beside the compiler in the toolchain image, and that is the same
/// split [the Java arm's SDK](super::super::java::compile) and
/// [PureScript's library set](super::super::purescript) are on, for the same reason: the image is
/// built separately from the binary that runs in it, so an SDK living there could be a different
/// vintage from the gg whose catalogue describes it — and a model shown one surface in its prompt and
/// compiled against another is the failure this whole seam exists to prevent.
///
/// **Compiled by this build**, out of `packages/gg-sandbox-kotlin/src` and
/// `packages/gg-sandbox-jvm/src`, by that package's `build.sh` — the same sources and the same build
/// that the catalogue describing it is reflected from, so the two cannot be two vintages. Committed,
/// they only moved together when somebody remembered to re-cut the jar, which on the Java arm's
/// identical setup is a thing that did not happen.
const SDK: &[u8] = include_bytes!(concat!(env!("GG_ARTIFACTS_KOTLIN"), "/kotlin.sdk.jar"));

/// The environment variable an operator points at the directory of Kotlin jars.
pub(super) const KOTLIN_ENV: &str = "TCAB_GG_KOTLIN";

/// Where `containers/gg-toolchains` installs this arm's own jars in a gg run image.
const IMAGE_ROOT: &str = "/opt/gg/toolchains/kotlin";

/// Where `scripts/ci/install-kotlin.sh` installs them on a developer's or CI machine, under `$HOME`.
const HOME_ROOT: &str = ".local/share/gg-kotlin";

/// How many programs one JVM builds before it is thrown away.
const MAX_BUILDS: usize = 64;

/// How many warm JVMs may exist at once.
///
/// Not `limits.maxParallel`, for the reason [Java's pool](super::super::java::compile) is not
/// either: a JVM holding the Kotlin compiler *and* TeaVM holds several hundred megabytes, so sixteen
/// of them is a container that swaps rather than an arm that is four times faster. A preparation
/// that arrives when all four are out waits, which costs nothing because preparation runs on a
/// blocking task.
///
/// Under test it is the seam's test-only `TEST_POOL_CAPACITY`, so the isolation gate drives more
/// preparations than the pool holds.
#[cfg(not(test))]
const POOL_SIZE: usize = 4;
#[cfg(test)]
const POOL_SIZE: usize = crate::sandbox::language::compile::TEST_POOL_CAPACITY;

/// How long one build may take before the daemon is retired and the failure reported as a
/// [toolchain failure](PrepareFailure::Toolchain).
const BUILD_TIMEOUT: Duration = Duration::from_secs(180);

/// How long starting a JVM and reading its handshake may take.
const START_TIMEOUT: Duration = Duration::from_secs(120);

/// The heap one of this arm's warm JVMs gets, floor and ceiling both — see [`jvm::daemon`].
///
/// Larger than the Java arm's, because this one holds an embedded Kotlin compiler beside TeaVM.
const HEAP: &str = "1g";

/// The file a program's source is written into, and the one its diagnostics are located in.
///
/// `.kt` rather than `.kts`: [a program is an ordinary Kotlin file](super::source), and the file's
/// own name is what decides the facade class gg's entry class calls.
pub(super) const PROGRAM_FILE: &str = "Program.kt";

/// The file gg's generated entry class is written into.
const ENTRY_FILE: &str = "GgEntry.java";

/// The directory the Kotlin compiler writes a program's own classes into, under the compile
/// workspace's working directory.
const PROGRAM_CLASSES: &str = "classes";

/// Where one code module's file is written: this key's own directory in the
/// [loaded-module band](crate::sandbox::Workspace::open_module) of the agent's compile workspace,
/// which is where a build survives the preparation that made it — named by the seam rather than
/// spelled here, so no two modules and no program share a compile's inputs.
fn module_source(workspace: &Workspace, key: &str) -> String {
    workspace.module_path(key, &source::module_file(key))
}

/// Where its classes are written, and the path that goes on the **classpath** of every program
/// compiled against it.
fn module_classes(workspace: &Workspace, key: &str) -> String {
    workspace.module_path(key, PROGRAM_CLASSES)
}

/// What TeaVM is asked to write: a `wasm32` core module.
const CORE_MODULE_FILE: &str = "program.wasm";

/// The name the driver is placed under. The JDK's single-file launcher requires the file name to
/// match the public class it holds.
const DRIVER_FILE: &str = "GgCompiler.java";

/// The name this arm's SDK jar is placed under, beside the driver.
const SDK_FILE: &str = "gg-sdk.jar";

/// What this arm's toolchain is pinned to.
#[derive(Debug, Deserialize)]
struct Manifest {
    /// The Kotlin release the jars are.
    kotlin: String,
    /// The driver protocol gg speaks. A driver answering anything else is refused at the handshake.
    protocol: u32,
}

/// The parsed manifest, read once per process.
fn manifest() -> &'static Manifest {
    static MANIFEST: std::sync::OnceLock<Manifest> = std::sync::OnceLock::new();
    MANIFEST.get_or_init(|| {
        serde_json::from_str(MANIFEST_JSON)
            .expect("the committed Kotlin toolchain pin is valid JSON of the expected shape")
    })
}

/// The Kotlin release a program is compiled by, for the run's record and for an operator reading a
/// diagnostic and wondering whose it is.
pub(super) fn compiler_version() -> &'static str {
    &manifest().kotlin
}

/// Start one JVM and place the driver now, so the first code turn does not pay for either.
///
/// Best effort and idempotent: a failure here is the failure the first compile will make, and there
/// it is classified, counted and reported.
pub(super) fn warm() {
    if let Ok(checkout) = POOL.checkout(KotlinCompiler::start) {
        drop(checkout);
    }
}

/// **How many JVMs the pool is holding**, so a test can assert that several compilations went
/// through one of them rather than infer it from how long they took.
#[cfg(test)]
pub(super) fn live_jvms() -> usize {
    POOL.live()
}

/// **How many JVMs the pool has started** in this process — see [`CompilerPool::started`].
#[cfg(test)]
pub(super) fn jvms_started() -> usize {
    POOL.started()
}

/// **Throw the pool's warm JVMs away**, so the next compilation starts a new one — see
/// [`CompilerPool::evict_idle`].
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
/// each already compiled by [`compile_module`] at the read that bound it. What this compile is
/// given is the directory of class files that compile wrote — a classpath entry, exactly as this
/// arm's SDK jar is. The program's own compile therefore reads two files, both of which name only
/// what the model declared.
fn compile(
    program: &str,
    modules: &[CodeModule],
    context: &PrepareContext,
) -> Result<Vec<u8>, PrepareFailure> {
    source::refuse_moved_facade(program)?;
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
        classpath.push(bind_module(workspace, module)?);
    }

    let report = request(
        workspace,
        PROGRAM_CLASSES,
        &classpath,
        source::PROGRAM_CLASS,
        CORE_MODULE_FILE,
        ENTRY_FILE,
        &[PROGRAM_FILE.to_string()],
    )?;
    verdict(&report, PROGRAM_FILE)?;

    let artifact = workspace.output().join(CORE_MODULE_FILE);
    let module = std::fs::read(&artifact).map_err(|error| {
        PrepareFailure::Toolchain(format!(
            "TeaVM reported success and wrote no module to {}: {error}",
            artifact.display(),
        ))
    })?;
    jvm::component::componentize(&module).map_err(PrepareFailure::Toolchain)
}

/// Compile a code [skill](crate::skills)'s or [memory](crate::memories)'s Kotlin into the classes a
/// program is compiled against, and report the names its namespace offers.
///
/// This is where a module is compiled and the only place. `key` is the binding key, which on this
/// arm is the package it is compiled into, so the class files land in that key's directory in the
/// [band](crate::sandbox::Workspace::open_module) and every program the agent writes afterwards
/// takes that directory as a classpath entry.
///
/// A compile of its own, with the standard library and gg's SDK on its classpath and **nothing
/// else**: a module sees gg's surface, the library set and its own declarations, and no other
/// module.
///
/// Running the Kotlin compiler here is also what buys the *location*. Without it a module that does
/// not compile would take the turn of whoever loaded it, in a file its author never wrote, for as
/// long as it stayed loaded.
///
/// **The Kotlin compiler alone, and not TeaVM**: what a program links is class files, so asking for
/// a wasm module here would be paying TeaVM for an artifact nothing reads.
pub(super) fn compile_module(
    key: &str,
    source: &str,
    context: &PrepareContext,
) -> Result<PreparedModule, PrepareFailure> {
    let workspace = context.workspace().map_err(PrepareFailure::Toolchain)?;
    let wrapped = source::wrap_module(source, &source::module_package(key))?;
    build_module(workspace, key, &wrapped.source, source)?;
    Ok(PreparedModule {
        source: source.to_string(),
        exports: wrapped.exports,
    })
}

/// The classpath entry the module bound at `module.name` is reached through, compiling it first when
/// this agent's workspace holds no build made from these bytes.
///
/// The build is the miss rather than the rule — a module reaching a program compile was compiled at
/// the read that loaded it — and it is what keeps a program handed a module this workspace never saw
/// compiling.
fn bind_module(workspace: &Workspace, module: &CodeModule) -> Result<String, PrepareFailure> {
    let key = module.name.as_str();
    if workspace.module_build(key, &module.source).is_some() {
        return Ok(module_classes(workspace, key));
    }
    let wrapped = source::wrap_module(&module.source, &source::module_package(key))
        .map_err(|failure| ours(key, failure))?;
    build_module(workspace, key, &wrapped.source, &module.source)
        .map_err(|failure| ours(key, failure))?;
    Ok(module_classes(workspace, key))
}

/// Compile one code module's wrapped source into its own directory in the band, and record what that
/// produced.
///
/// A failure names the key: the module is the thing to fix or to stop loading, and a session told
/// nothing would meet it again on every turn.
fn build_module(
    workspace: &Workspace,
    key: &str,
    wrapped: &str,
    source: &str,
) -> Result<(), PrepareFailure> {
    workspace
        .open_module(key)
        .map_err(PrepareFailure::Toolchain)?;
    workspace
        .write_module(key, &source::module_file(key), wrapped)
        .map_err(PrepareFailure::Toolchain)?;

    let classes = module_classes(workspace, key);
    let report = request(
        workspace,
        &classes,
        &[],
        CHECK_ONLY,
        CHECK_ONLY,
        CHECK_ONLY,
        &[module_source(workspace, key)],
    )?;
    verdict(&report, &source::module_file(key))?;
    workspace.record_module(key, source, vec![workspace.work().join(&classes)]);
    Ok(())
}

/// Re-attribute a [rebuilt module](bind_module)'s refusal to gg, whichever of the model-facing
/// bands it arrived in.
///
/// A module is compiled at the read that binds it, so its author already read this diagnostic in
/// their own coordinates and this arm refusing the same bytes now is this arm disagreeing with
/// itself. The program beside it compiles, and the file the diagnostic names is one that program's
/// author never wrote, so handing it back under `Compiler error` charges a model for a program it
/// wrote correctly and offers it nothing to change.
///
/// Both producers are covered because both are gg's here: the [wrap](source::wrap_module), which
/// refuses a module whose shape this arm has no lowering for, and the compile under it, which
/// refuses one `kotlinc` read and disagreed with.
///
/// A [toolchain failure](PrepareFailure::Toolchain) passes through. A JVM that would not start is
/// already gg's rather than the model's, and saying a key in front of it would blame a skill for it.
fn ours(key: &str, failure: PrepareFailure) -> PrepareFailure {
    match failure {
        PrepareFailure::Program(error @ (PrepareError::Syntax(_) | PrepareError::Compile(_))) => {
            PrepareFailure::Lowering(format!(
                "kotlinc refused the code module gg compiled as `{key}` beside the program, which \
                 compiled on its own when it was loaded:\n{error}"
            ))
        }
        PrepareFailure::Program(error @ PrepareError::Unsupported(_)) => {
            PrepareFailure::Lowering(format!(
                "gg could not lower the code module bound at `{key}` beside the program, which it \
                 accepted when it was loaded:\n{error}"
            ))
        }
        other => other,
    }
}

/// The main class, target file and entry file that ask [the driver](super::super::jvm) for the
/// Kotlin compiler alone.
///
/// Empty, which is the one value none of the three can otherwise take: a class has a name, a target
/// file has one and so does a source file. It exists because a module is *checked* rather than
/// built — see [`compile_module`] — and asking TeaVM for a module with no entry point would be
/// asking it for nothing.
const CHECK_ONLY: &str = "";

/// One build request, as the driver reads it: the preparation's two directories, the directory the
/// Kotlin compiler writes classes into, the classpath entries to add to the ones the daemon was
/// started with, the class TeaVM roots the program at, the artifact to write, gg's entry class, and
/// the sources to compile.
///
/// Every path but the first two is **relative to the work directory**, which the driver resolves
/// against it. The classpath field is joined the way a JVM joins one, so the driver splits it on
/// `File.pathSeparator` exactly as it splits the classpath it was started with.
fn wire_request(
    workspace: &Workspace,
    classes: &str,
    classpath: &[String],
    main_class: &str,
    target: &str,
    entry: &str,
    files: &[String],
) -> String {
    format!(
        "{}\t{}\t{classes}\t{}\t{main_class}\t{target}\t{entry}\t{}",
        workspace.work().display(),
        workspace.output().display(),
        classpath.join(CLASSPATH_SEPARATOR),
        files.join("\t"),
    )
}

/// What Java's `File.pathSeparator` is on the platforms this arm runs on, which is every platform a
/// JDK, TeaVM and the Kotlin jars are installed on by `scripts/ci/install-kotlin.sh` and the
/// toolchain image.
const CLASSPATH_SEPARATOR: &str = ":";

/// Send one build to a warm JVM and read what it answered.
fn request(
    workspace: &Workspace,
    classes: &str,
    classpath: &[String],
    main_class: &str,
    target: &str,
    entry: &str,
    files: &[String],
) -> Result<Report, PrepareFailure> {
    let mut compiler = POOL
        .checkout(KotlinCompiler::start)
        .map_err(PrepareFailure::Toolchain)?;
    let request = wire_request(
        workspace, classes, classpath, main_class, target, entry, files,
    );
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
                "gg could not read what its Kotlin compiler answered ({error}){tail}"
            )));
        }
    };
    if compiler.spent() {
        compiler.retire();
    }
    if let Some(internal) = &report.internal {
        return Err(PrepareFailure::Toolchain(format!(
            "the Kotlin {} toolchain could not build the program: {internal}",
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
    /// A failure of gg's driver or of a compiler itself rather than of the program — nothing read
    /// the model's Kotlin, so there is no diagnostic and the model is not blamed.
    internal: Option<String>,
    /// Everything either compiler said.
    diagnostics: Vec<Diagnostic>,
}

/// One thing a compiler said.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Diagnostic {
    /// Which compiler said it: `kotlinc`, `javac` or `teavm`.
    stage: String,
    /// Whether it stops the build.
    error: bool,
    /// The compiler's own stable name for the diagnostic — `SYNTAX`, `UNRESOLVED_REFERENCE` — or
    /// nothing.
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

/// The Kotlin compiler's own name for *the parser could not read this*.
///
/// One code rather than Java's list of prefixes, because Kotlin's front end reports every parse
/// failure under it — `Expecting an element`, `Expecting an expression`, an unclosed brace — where
/// javac has dozens of `compiler.err.expected…` variants. That is the compiler's own grouping and it
/// is exactly the distinction [`Syntax`](PrepareError::Syntax) and [`Compile`](PrepareError::Compile)
/// exist to keep apart.
const PARSE_ERROR_CODE: &str = "SYNTAX";

/// How many distinct diagnostics a model is shown.
///
/// TeaVM reports one problem per *call site*, so a single unsupported library call can arrive
/// forty-five times with the same message at different lines inside the standard library. What a
/// model can act on is the first few; the rest is noise it pays tokens to read.
///
/// This was the first bound any arm carried, and it is the number the rest of them took: the
/// [shared measurement](super::super::diagnostics) — one misremembered SDK name at fifty call sites
/// — costs **475 bytes across 17 lines** through this arm, which is eight diagnostics and the line
/// that counts the forty-two it did not show. The uncapped arms measured against it in the same
/// table cost between six and twenty-four times that for the identical mistake. Eight is therefore
/// justified here by what it *reports* rather than by what it drops, and that is the row every other
/// arm's constant cites.
const SHOWN: usize = 8;

/// Turn a finished build into a verdict.
///
/// Four bands, decided by **which file** — and by which compiler — was talking:
///
/// * the model's own file — the model's diagnostic, rendered in the model's own coordinates,
///   because the file the compiler read is the file the model wrote and there is nothing to correct;
/// * a **TeaVM** diagnostic about any other file — the classlib refusing to translate something the
///   program's own call graph reached, named in the file it was found in. It is the model's, and the
///   module note above says why this arm answers that differently from [Java's](super::super::java);
/// * [`ENTRY_FILE`] — gg's own generated file, which names the model's own `main` and can fail for
///   exactly one reason: the program did not declare what gg's file calls. That is a **shape refusal
///   shown to the model**, in the words of the convention it broke, rather than a toolchain failure
///   the model is not told about
///   ([ruling D4](https://docs.testcabinet.ai/gg/responses-as-code/invariants/));
/// * anything else — a file nobody named — which is drift rather than anything this program did, and
///   is reported to the operator.
///
/// A **code module** is compiled before the program that uses it, in a build of its own whose `file`
/// is the module's, so the key it is bound at is named by [`build_module`] rather than read back off
/// a diagnostic here.
pub(crate) fn verdict(report: &Report, file: &str) -> Result<(), PrepareFailure> {
    let errors: Vec<&Diagnostic> = report
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.error)
        .collect();
    if errors.is_empty() {
        return Ok(());
    }

    // A TeaVM diagnostic is the model's wherever it was found: this arm reaches TeaVM's classlib
    // through a standard library written in Kotlin, so the file that names the refusal is routinely
    // `kotlin/…` rather than the model's own.
    let mine: Vec<&&Diagnostic> = errors
        .iter()
        .filter(|diagnostic| {
            diagnostic.file.as_deref() == Some(file) || diagnostic.stage == "teavm"
        })
        .collect();
    if mine.is_empty() {
        let rendered = errors
            .iter()
            .map(|diagnostic| diagnostic.render(file))
            .collect::<Vec<_>>()
            .join(" | ");
        if errors
            .iter()
            .all(|diagnostic| diagnostic.file.as_deref() == Some(ENTRY_FILE))
        {
            return Err(PrepareFailure::Program(PrepareError::Unsupported(format!(
                "the entry point does not compile: gg calls `{program}.main()`, and that call \
                 does not resolve against this program: {rendered}\n\nWrite the reply as one \
                 Kotlin file declaring `fun main()` — no parameters, because \
                 `fun main(args: Array<String>)` compiles to a method the entry call cannot \
                 resolve. Every other declaration — a class, an object, a sealed interface, an \
                 enum class, a typealias — goes beside it at the top level of the same file.",
                program = source::PROGRAM_CLASS,
            ))));
        }
        return Err(PrepareFailure::Toolchain(format!(
            "the Kotlin toolchain rejected gg's own guest rather than the model's program: \
             {rendered}"
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
    // A parse failure anywhere is the whole verdict: the compiler never got as far as meaning, so
    // whatever else it says is downstream of text it could not read.
    //
    // `mine` and not the capped rendering, and that is the invariant rather than a preference: the
    // band is decided on the WHOLE set, so a parse error the bound did not show is still a parse
    // error.
    Err(PrepareFailure::Program(
        match mine.iter().any(|diagnostic| diagnostic.is_parse_error()) {
            true => PrepareError::Syntax(rendered),
            false => PrepareError::Compile(rendered),
        },
    ))
}

impl Diagnostic {
    /// Whether the compiler refused to *read* the program, as opposed to reading it and disagreeing.
    fn is_parse_error(&self) -> bool {
        self.stage == "kotlinc" && self.code.as_deref() == Some(PARSE_ERROR_CODE)
    }

    /// This diagnostic as the model reads it: `Program.kt:7:19: Unresolved reference 'nope'.`
    ///
    /// The coordinate is the compiler's own, uncorrected, because the file it read is the file the
    /// model wrote.
    fn render(&self, file: &str) -> String {
        let located = match (self.file.as_deref() == Some(file), self.line) {
            (true, 0) => file.to_string(),
            (true, line) => match self.column {
                0 => format!("{file}:{line}"),
                column => format!("{file}:{line}:{column}"),
            },
            // A library's own file, named as such. This is a fact about what the model's program
            // reached — Kotlin's standard library is where an unsupported call is *found*, because
            // the program reached TeaVM's classlib through it — so the file is quoted rather than
            // hidden, and it is not written as though the model could open it.
            (false, _) => match (&self.file, self.line) {
                (Some(name), 0) => format!("{file}, inside {name}"),
                (Some(name), line) => format!("{file}, inside {name}:{line}"),
                (None, _) => file.to_string(),
            },
        };
        format!("{located}: {}", self.message.trim_end())
    }
}

// ---------------------------------------------------------------------------------------------
// The generated entry class
// ---------------------------------------------------------------------------------------------

/// [The shared entry class](jvm::entry_class), with this arm's own one line in it.
///
/// `ProgramKt.main();` against [Java's](super::super::java::compile::entry_class)
/// `Program.main(new String[0]);`, and that is the whole of the difference between the two arms'
/// generated entry classes — which [`jvm`]'s own tests assert by comparing what
/// these two functions actually write.
pub(in crate::sandbox::language) fn entry_class() -> String {
    jvm::entry_class(&format!("{}.main();", source::PROGRAM_CLASS))
}

// ---------------------------------------------------------------------------------------------
// The warm JVMs
// ---------------------------------------------------------------------------------------------

/// The warm JVMs, lent one at a time.
static POOL: CompilerPool<KotlinCompiler> = CompilerPool::new(POOL_SIZE);

/// One warm JVM running gg's compiler driver.
struct KotlinCompiler {
    /// The process.
    process: CompilerDaemon,
    /// How many programs it has built.
    builds: usize,
}

impl KotlinCompiler {
    /// Start one, place the driver if this is the first, and read its handshake.
    fn start() -> Result<Self, String> {
        let toolchain = toolchain()?;
        let placed = placed()?;
        // The SDK goes on the classpath a MODEL's own source is read against, and on no other: a
        // program that could reach the compiler's own jars could import `kotlinx.coroutines`, which
        // this sandbox cannot run. So `gg.files.readFile("x")` type-checks against the same bytes
        // TeaVM translates, and there is no second path to keep in step.
        //
        // IT GOES FIRST, AND THE ORDER IS LOAD-BEARING. The jar carries one vendored TeaVM runtime
        // class — `org.teavm.runtime.ExceptionHandling`, changed in one place so that an uncaught
        // exception prints WHAT was thrown and not only where — and TeaVM resolves the classes it
        // translates from the classpath it is given, first match winning. Behind `teavm-core.jar`
        // the copy would never be read and the change would vanish with no diagnostic. See
        // `packages/gg-sandbox-jvm/vendor/org/teavm/runtime/ExceptionHandling.java`.
        let program_path = format!("{}:{}", placed.sdk.display(), toolchain.program_path);
        let started = jvm::daemon(&toolchain.java, HEAP).and_then(|mut command| {
            command
                .arg("-cp")
                .arg(&toolchain.classpath)
                // The driver's own source. The JDK's single-file launcher compiles it in memory,
                // which is why gg builds no jar of its own for it.
                .arg(&placed.driver)
                .arg(&toolchain.compile_path)
                .arg(&program_path);
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
                    "gg found no Kotlin toolchain — the Kotlin compiler and the TeaVM jars — in \
                     {IMAGE_ROOT}, under ~/{HOME_ROOT} (scripts/ci/install-kotlin.sh), or named by \
                     {KOTLIN_ENV}: {error}"
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

/// Read the driver's handshake and refuse a driver speaking another protocol, or a Kotlin release
/// that is not the pinned one.
///
/// The version half is what the Java arm's handshake cannot ask: that arm's driver names no release
/// of anything it did not install, while this one loads a compiler out of a directory a *script*
/// filled — and a drifted one would word its diagnostics differently, which is the hardest kind of
/// difference to attribute when two runs of a study disagree.
fn handshake(greeting: &str) -> Result<(), String> {
    #[derive(Deserialize)]
    struct Greeting {
        /// The protocol the driver speaks.
        protocol: u32,
        /// The Kotlin release the JVM loaded, or nothing when it could not be read.
        kotlin: Option<String>,
    }
    // The line itself is in the message, and it is the whole of the diagnostic's value: a parse
    // error alone says a JVM answered wrongly and never what it answered, which is a dead end when
    // the answer came from somewhere gg did not expect (see `jvm::LOG_TO_STDERR`, found the hard way
    // through exactly this message with the evidence thrown away).
    let line = greeting.trim();
    let greeting: Greeting = serde_json::from_str(line).map_err(|error| {
        format!("gg could not read its Kotlin compiler's greeting ({error}): {line:?}")
    })?;
    if greeting.protocol != manifest().protocol {
        return Err(format!(
            "gg speaks protocol {} to its Kotlin compiler and this one answered {}",
            manifest().protocol,
            greeting.protocol,
        ));
    }
    // A version that could not be read at all is deliberately not a mismatch: that is a strange
    // machine rather than a wrong one, and the compile that follows has far more to say about it.
    if let Some(loaded) = greeting.kotlin.as_deref()
        && loaded != compiler_version()
    {
        return Err(format!(
            "gg pins Kotlin {} and this machine has {loaded}; run scripts/ci/install-kotlin.sh",
            compiler_version(),
        ));
    }
    Ok(())
}

/// Where gg's own driver and this arm's SDK are on disk, placing each on first use.
///
/// The seam's one sanctioned share, taken under the seam's discipline: the directory's key folds in
/// the pinned Kotlin release, a digest of the assembled driver's own bytes **and** one of the
/// [SDK], so a gg carrying either a different driver or a different surface reads a different
/// directory rather than another build's files; each write goes through [`place`], which renames a
/// complete file into place. Nothing ever writes to it again — a JVM only reads it.
fn placed() -> Result<&'static Placed, String> {
    static PLACED: std::sync::OnceLock<Result<Placed, String>> = std::sync::OnceLock::new();
    PLACED
        .get_or_init(|| {
            let source = jvm::driver(FRONT);
            let root = jvm::placed_dir("kotlin", compiler_version(), &[source.as_bytes(), SDK])?;
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

/// The two files gg places for itself: its own compiler driver, and this arm's SDK.
///
/// The SDK's digest is in the directory's key for a reason the driver's alone would not cover: an SDK
/// edit changes what a *program* may write, so a gg carrying one build of it must never read another
/// build's jar out of a directory they would otherwise share.
struct Placed {
    /// gg's own compiler driver, assembled and written out for the single-file launcher.
    driver: PathBuf,
    /// This arm's SDK, as the jar a model's program is compiled against.
    sdk: PathBuf,
}

/// What this arm compiles with: one JDK and three classpaths.
struct Toolchain {
    /// The `java` a daemon is started as, which is [the JVM arms' shared JDK](jvm::toolchain).
    java: PathBuf,
    /// What the driver JVM itself runs with: the Kotlin compiler, its own dependencies, and TeaVM.
    classpath: String,
    /// What gg's generated entry class is compiled with, and what TeaVM translates from.
    compile_path: String,
    /// What a model's **program** is compiled against: the Kotlin standard library, and nothing
    /// else.
    ///
    /// This is the arm's library claim, and it is a claim gg can only make by being deliberate about
    /// it: the driver runs with a 60 MB Kotlin compiler and every TeaVM jar on its classpath, and a
    /// program compiled against *that* could import the compiler's own internals and — worse —
    /// `kotlinx.coroutines`, which is a runtime dependency of the compiler and which this sandbox
    /// cannot run. Compiled against the standard library alone, `import kotlinx.coroutines.*` is an
    /// `UNRESOLVED_IMPORT` at the model's own line rather than forty-five TeaVM errors inside
    /// somebody else's file.
    ///
    /// This arm's [SDK] is prepended to it as the daemon starts, because that jar is placed rather
    /// than installed and its path is not known until then.
    program_path: String,
}

/// Find the toolchain, once per process.
fn toolchain() -> Result<&'static Toolchain, String> {
    static TOOLCHAIN: std::sync::OnceLock<Result<Toolchain, String>> = std::sync::OnceLock::new();
    TOOLCHAIN
        .get_or_init(find_toolchain)
        .as_ref()
        .map_err(Clone::clone)
}

/// Look for the Kotlin jars, and build the three classpaths out of them and the JVM toolchain.
fn find_toolchain() -> Result<Toolchain, String> {
    let shared = jvm::toolchain()?;
    let root = jvm::named(KOTLIN_ENV)
        .or_else(|| {
            jvm::roots(IMAGE_ROOT, HOME_ROOT)
                .into_iter()
                .find(|root| root.join("libs").is_dir())
        })
        .ok_or_else(|| {
            format!(
                "gg found no Kotlin compiler in {IMAGE_ROOT} (containers/gg-toolchains), under \
                 ~/{HOME_ROOT} (scripts/ci/install-kotlin.sh), or named by {KOTLIN_ENV}"
            )
        })?;
    let kotlin = jvm::jars(&root.join("libs"))?;

    // Named by prefix rather than by full file name, because the version is in the name and the pin
    // that decides it lives in `packages/gg-sandbox-kotlin/kotlin-version.sh` rather than in Rust.
    let stdlib = jar(&kotlin, "kotlin-stdlib-")?;
    Ok(Toolchain {
        java: shared.java.clone(),
        classpath: format!("{kotlin}:{}", shared.classpath),
        compile_path: shared.classpath.clone(),
        program_path: stdlib,
    })
}

/// The one jar in `classpath` whose file name starts with `prefix`.
fn jar(classpath: &str, prefix: &str) -> Result<String, String> {
    classpath
        .split(':')
        .find(|path| {
            std::path::Path::new(path)
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(prefix))
        })
        .map(ToString::to_string)
        .ok_or_else(|| format!("gg found no {prefix}*.jar; run scripts/ci/install-kotlin.sh"))
}

#[cfg(test)]
#[path = "kotlin.compile.test.rs"]
mod tests;
