//! **The Java compile** — how a model's Java becomes something the [guest](super) can evaluate, and
//! what it costs.
//!
//! # The strategy, in one sentence
//!
//! A Java program is compiled to **bytecode by `javac` and then to JavaScript by TeaVM**, both
//! inside a warm JVM gg keeps between preparations, and evaluated by the same ECMAScript guest the
//! [TypeScript](super::super::typescript), [JavaScript](super::super::javascript) and
//! [PureScript](super::super::purescript) arms use.
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
//! 4. **The daemon stands on ground of its own** ([`daemon`]) rather than on any preparation's
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
//! # The two TeaVM settings that are not optional
//!
//! * `setJsModuleType(NONE)` — so the emitted code names its entry point as a **bare identifier** in
//!   the enclosing scope. The guest evaluates a program as the body of a function whose parameters
//!   are the API objects, and a module wrapper would put those names out of reach.
//! * `setStrict(true)` — without it TeaVM omits the null and bounds checks that make a
//!   `NullPointerException` an exception at all, and `catch (NullPointerException)` **silently fails
//!   to catch**. A program that failed would be recorded as one that succeeded, which is the one
//!   class of error a measurement harness must never make.
//!
//! # What a model is told when its program fails
//!
//! Java's error surface was the study's stated worry about this arm — an uncaught
//! `NullPointerException` was measured arriving as `Error: Error: null` at a line inside TeaVM's own
//! runtime. Both halves of that are fixed here, and what is left is stated rather than hidden.
//!
//! * **The name and the message** come from an [enumerated catch chain](entry_for_program) in the
//!   generated entry class rather than from `getClass().getName()`, which TeaVM answers `null` for a
//!   `NullPointerException`. The chain hands the description to JavaScript and **rethrows the
//!   original**, so a failure a *binding* threw — a `ToolError` the host raised — reaches the guest
//!   as itself rather than wrapped in gg's opinion of it.
//! * **The location** comes from TeaVM's own source map, folded on the host into a
//!   generated-line → model-line table and shipped in the bundle's [prelude](super::super::jvm::PRELUDE). A `NullPointerException`
//!   the model caused on its line 14 is reported as `java.lang.NullPointerException` followed by
//!   `at program.java:14`. Measured end to end.
//! * **What is still wrong** is the `location` field itself: `feedback.program-error` carries one,
//!   the guest fills it from the innermost frame of what was thrown, and for this arm that frame is
//!   inside TeaVM's runtime. So the model reads the right line in the *message* and a meaningless one
//!   in the *location*. The fix is a frame list on the wire, shared with the PureScript arm.
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

use crate::sandbox::language::compile::{CompilerDaemon, CompilerPool, daemon, place, place_bytes};
use crate::sandbox::language::jvm::{self, HOME_ROOT, IMAGE_ROOT, JAVA_ENV, TEAVM_ENV};
use crate::sandbox::language::{PrepareContext, PrepareError, PrepareFailure, PreparedProgram};

use super::source::{self, Wrapped};

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

/// The name this arm's SDK jar is placed under, beside the driver.
const SDK_FILE: &str = "gg-sdk.jar";

/// The file a program's source is written into, and the one its diagnostics are located in.
pub(super) const PROGRAM_FILE: &str = "Program.java";

/// The file a code module's source is written into.
pub(super) const MODULE_FILE: &str = "Module.java";

/// The file gg's generated entry class is written into.
const ENTRY_FILE: &str = "GgEntry.java";

/// What TeaVM is asked to write.
const BUNDLE_FILE: &str = "program.js";

/// The name the driver is placed under. The JDK's single-file launcher requires the file name to
/// match the public class it holds.
const DRIVER_FILE: &str = "GgCompiler.java";

/// The name a model's own file is reported under in a located failure: `Program.java` becomes
/// `program.java` and `Module.java` becomes `module.java`.
///
/// Lower case because it is prose the model reads rather than a path it can open — and derived from
/// the file rather than fixed, so a diagnostic about a code skill's module does not tell its author
/// the line is in a program.
fn label(file: &str) -> String {
    file.to_ascii_lowercase()
}

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

/// Compile a **program** — a model's reply — into the JavaScript the guest evaluates.
pub(super) fn compile_program(
    source: &str,
    context: &PrepareContext,
) -> Result<PreparedProgram, PrepareFailure> {
    let wrapped = source::wrap_program(source)?;
    Ok(PreparedProgram {
        source: build(PROGRAM_FILE, &wrapped, Entry::Program, context)?,
        component: None,
    })
}

/// Compile a **code module** — the code half of a [skill](crate::skills) or a
/// [memory](crate::memories) — into JavaScript whose evaluation leaves a namespace behind.
pub(super) fn compile_module(
    source: &str,
    context: &PrepareContext,
) -> Result<(String, Vec<String>), PrepareFailure> {
    let wrapped = source::wrap_module(source)?;
    let built = build(MODULE_FILE, &wrapped, Entry::Module, context)?;
    Ok((built, wrapped.exports))
}

/// Which of the two things is being built.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Entry {
    /// A model's program: run its statements, and report what they threw.
    Program,
    /// A code module: export its methods, and hand the namespace back.
    Module,
}

impl Entry {
    /// The entry class gg generates beside the model's own file.
    fn source(self) -> String {
        match self {
            Self::Program => entry_for_program(),
            Self::Module => entry_for_module(),
        }
    }

    /// What the assembled bundle ends with.
    fn tail(self) -> String {
        // `main` is TeaVM's default export name, and the callback is how its runtime reports a
        // failure — DIRECTLY, as the callback's argument. A program that read `result.exception`
        // instead would report a failed program as a complete success, which was measured.
        // A gg failure the program did not catch goes back as the record the membrane itself
        // raises, BEFORE the Java description is considered: the guest classifies a tool failure
        // from the host's own code, and a re-description would turn a refusal the model can act on
        // into prose about a Java class.
        let start = "main([], function ($ggThrown) {\n  if (!$ggThrown) return;\n  \
                     if ($ggFailure) throw $ggFailure;\n  \
                     if (!$ggMessage) throw $ggThrown;\n  \
                     throw new Error($ggMessage + $ggLocate($ggThrown.stack));\n});\n";
        match self {
            Self::Program => start.to_string(),
            // A plain object rather than the class TeaVM exported onto. The guest binds `lib.<key>`
            // to the value evaluating a module produces and takes it only if it is an `object`, and
            // a class is a `function` — so returning the export directly binds an empty namespace
            // and no error, which is the quiet kind of wrong.
            Self::Module => format!(
                "{start}var $ggNamespace = {{}};\n\
                 for (var $ggKey of Object.keys({global})) $ggNamespace[$ggKey] = {global}[$ggKey];\n\
                 return $ggNamespace;\n",
                global = source::MODULE_GLOBAL,
            ),
        }
    }
}

/// Compile one wrapped source and hand back the JavaScript the guest evaluates.
fn build(
    file: &str,
    wrapped: &Wrapped,
    entry: Entry,
    context: &PrepareContext,
) -> Result<String, PrepareFailure> {
    let workspace = context.workspace().map_err(PrepareFailure::Toolchain)?;
    workspace
        .write(file, &wrapped.source)
        .map_err(PrepareFailure::Toolchain)?;
    workspace
        .write(ENTRY_FILE, &entry.source())
        .map_err(PrepareFailure::Toolchain)?;

    let mut compiler = POOL
        .checkout(JavaCompiler::start)
        .map_err(PrepareFailure::Toolchain)?;
    let request = format!(
        "{}\t{}\t{}\t{BUNDLE_FILE}\t{file}\t{ENTRY_FILE}",
        workspace.work().display(),
        workspace.output().display(),
        source::ENTRY_CLASS,
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
    verdict(&report, file, wrapped.shift)?;

    jvm::assembled(
        workspace.output(),
        BUNDLE_FILE,
        file,
        wrapped.shift,
        &label(file),
        &entry.tail(),
    )
    .map_err(|error| PrepareFailure::Toolchain(format!("TeaVM {}: {error}", compiler_version())))
}

// ---------------------------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------------------------

/// What one build of the driver reported.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Report {
    /// Whether the build produced JavaScript.
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
pub(crate) fn verdict(report: &Report, file: &str, shift: usize) -> Result<(), PrepareFailure> {
    let errors: Vec<&Diagnostic> = report
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.error)
        .collect();
    if errors.is_empty() {
        return Ok(());
    }

    // A diagnostic about a file that is not the model's is about gg's own generated entry class,
    // which is gg's artifact rather than the model's program. Blaming a model for it would send it
    // rewriting something that was never wrong.
    let mine: Vec<&&Diagnostic> = errors
        .iter()
        .filter(|diagnostic| diagnostic.file.as_deref() == Some(file))
        .collect();
    if mine.is_empty() {
        let rendered = errors
            .iter()
            .map(|diagnostic| diagnostic.render(file, shift))
            .collect::<Vec<_>>()
            .join(" | ");
        return Err(PrepareFailure::Toolchain(format!(
            "the Java toolchain refused a file gg generated rather than the program: {rendered}"
        )));
    }

    // Deduplicated and capped through the seam's own bound: TeaVM reports one problem per call site,
    // so a single unsupported call is one thing to fix however many times it is named.
    let rendered = crate::sandbox::language::diagnostics::capped(
        mine.iter()
            .map(|diagnostic| diagnostic.render(file, shift))
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

    /// This diagnostic as the model reads it: `program.java:7:19: cannot find symbol …`.
    ///
    /// The line is moved back over the wrapper gg put in front of the program, so the coordinate
    /// names the line of the reply the model actually wrote. A TeaVM diagnostic has no column — its
    /// locations are per statement — so it prints one coordinate rather than two.
    fn render(&self, file: &str, shift: usize) -> String {
        let located = match (self.file.as_deref() == Some(file), self.line) {
            (true, 0) => label(file),
            (true, line) => {
                let line = line.saturating_sub(shift).max(1);
                match self.column {
                    0 => format!("{}:{line}", label(file)),
                    column => format!("{}:{line}:{column}", label(file)),
                }
            }
            (false, _) => format!(
                "gg's own {}",
                self.file.as_deref().unwrap_or("generated code")
            ),
        };
        // TeaVM's refusals are the interesting half of this arm's compile band: a class its
        // 1,213-class classlib does not carry is named here, at the model's own line, rather than
        // discovered as a `ReferenceError` at run time.
        format!("{located}: {}", self.message.trim_end())
    }
}

// ---------------------------------------------------------------------------------------------
// The generated entry class
// ---------------------------------------------------------------------------------------------

/// The exceptions the entry class names one by one, innermost subtype first.
///
/// **Enumerated rather than derived**, and that is the whole point of it. `failure.getClass()
/// .getName()` is what a Java author would write and it answers `null` for a
/// `NullPointerException` under TeaVM — which is exactly how the study measured this arm reporting
/// `Error: Error: null`. Naming the classes gg cares about in `catch` clauses makes the answer
/// javac's rather than the runtime's, and a class not on this list still gets `getName()` with a
/// stated fallback.
///
/// Order matters: `ArrayIndexOutOfBoundsException` before `IndexOutOfBoundsException`, and
/// `NumberFormatException` before `IllegalArgumentException`, because Java takes the first clause
/// that matches and a supertype first would swallow the name a model needs.
const CAUGHT: [&str; 12] = [
    "java.lang.NullPointerException",
    "java.lang.ArrayIndexOutOfBoundsException",
    "java.lang.StringIndexOutOfBoundsException",
    "java.lang.IndexOutOfBoundsException",
    "java.lang.ClassCastException",
    "java.lang.ArithmeticException",
    "java.lang.NumberFormatException",
    "java.lang.IllegalArgumentException",
    "java.lang.IllegalStateException",
    "java.lang.UnsupportedOperationException",
    "java.util.NoSuchElementException",
    "java.util.ConcurrentModificationException",
];

/// TeaVM's own marker on a Java wrapper around a **JavaScript** exception.
///
/// A failure a binding raised — a `ToolError` the host refused a call with — arrives in Java as a
/// `RuntimeException` whose message TeaVM prefixes with this. gg must not describe one: the guest
/// classifies a tool failure from what the host said, and a re-description would turn a refusal the
/// model can act on into prose about a Java class it never wrote.
const FOREIGN_MARKER: &str = "(JavaScript) ";

/// The entry class for a **program**: run the model's statements, describe what they threw, and
/// rethrow it.
fn entry_for_program() -> String {
    let chain: String = CAUGHT
        .iter()
        .map(|name| {
            format!("        catch ({name} failure) {{ throw seen(\"{name}\", failure); }}\n")
        })
        .collect();
    format!(
        "import org.teavm.jso.JSBody;\n\
         \n\
         public final class {entry} {{\n\
         \x20   @JSBody(params = {{\"text\"}}, script = \"$ggMessage = text;\")\n\
         \x20   static native void describe(String text);\n\
         \n\
         \x20   @JSBody(params = {{\"tool\", \"code\", \"message\"}}, \
         script = \"$ggFailure = {{ tool: tool, code: code, message: message }};\")\n\
         \x20   static native void refused(String tool, String code, String message);\n\
         \n\
         \x20   public static void main(String[] args) throws Throwable {{\n\
         \x20       try {{ {program}.{method}(); }}\n\
         \x20       catch (gg.ToolError failure) {{\n\
         \x20           refused(failure.tool(), failure.code().wireName(), failure.getMessage());\n\
         \x20           throw failure;\n\
         \x20       }}\n\
         {chain}\
         \x20       catch (StackOverflowError failure) {{ throw seen(\"java.lang.StackOverflowError\", failure); }}\n\
         \x20       catch (Throwable failure) {{ throw seen(named(failure), failure); }}\n\
         \x20   }}\n\
         \n\
         \x20   static String named(Throwable failure) {{\n\
         \x20       Class<?> type = failure.getClass();\n\
         \x20       String name = type == null ? null : type.getName();\n\
         \x20       return name == null ? \"a failure whose class this runtime cannot name\" : name;\n\
         \x20   }}\n\
         \n\
         \x20   static Throwable seen(String name, Throwable failure) {{\n\
         \x20       String message = failure.getMessage();\n\
         \x20       if (message != null && message.startsWith({marker:?})) {{ return failure; }}\n\
         \x20       describe(message == null ? name : name + \": \" + message);\n\
         \x20       return failure;\n\
         \x20   }}\n\
         }}\n",
        entry = source::ENTRY_CLASS,
        program = source::PROGRAM_CLASS,
        method = source::PROGRAM_METHOD,
        marker = FOREIGN_MARKER,
    )
}

/// The entry class for a **code module**: export the class, and leave the namespace where the
/// bundle's tail can hand it back.
fn entry_for_module() -> String {
    format!(
        "import org.teavm.jso.JSExportClasses;\n\
         \n\
         @JSExportClasses({{ {module}.class }})\n\
         public final class {entry} {{\n\
         \x20   public static void main(String[] args) {{ }}\n\
         }}\n",
        module = source::MODULE_CLASS,
        entry = source::ENTRY_CLASS,
    )
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
        let classpath = format!("{}:{}", toolchain.classpath, placed.sdk.display());
        let started = daemon(&toolchain.java).and_then(|mut command| {
            command
                // A JVM that lives for sixty-four builds and is then replaced has no use for a
                // concurrent collector, and a serial one leaves the cores to the fifteen other
                // preparations that may be compiling beside it.
                // A developer's shell may carry either of these, and a JVM that picks one up
                // prints a line to stderr and may compile differently from the one in the run
                // image — which is a difference between two arms of a study that came from a
                // dotfile. Emptied rather than unset because that is what the launcher checks.
                .env("JAVA_TOOL_OPTIONS", "")
                .env("_JAVA_OPTIONS", "")
                .arg("-XX:+UseSerialGC")
                .arg("-Xms64m")
                .arg("-Xmx768m")
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
    let greeting: Greeting = serde_json::from_str(greeting.trim())
        .map_err(|error| format!("gg could not read its Java compiler's greeting ({error})"))?;
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
