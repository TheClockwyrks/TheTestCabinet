//! **The Kotlin compile** — how a model's Kotlin becomes something the [guest](super) can evaluate,
//! and what it costs.
//!
//! # The strategy, in one sentence
//!
//! A Kotlin program is compiled to **bytecode by the Kotlin compiler and then to JavaScript by
//! TeaVM**, both inside a warm JVM gg keeps between preparations, and evaluated by the same
//! ECMAScript guest the [TypeScript](super::super::typescript), [JavaScript](super::super::javascript),
//! [PureScript](super::super::purescript) and [Java](super::super::java) arms use.
//!
//! It therefore rides [the road the Java arm already built](super::super::jvm): the same JDK, the
//! same TeaVM jars, the same TeaVM settings, the same reading of TeaVM's source map. What is this
//! arm's own is the **front** of it — the compiler that reads the model's source, what its
//! diagnostics look like, and the shape a program is compiled in.
//!
//! # Why the compiler is embedded rather than spawned
//!
//! `kotlinc` is a shell script around a JVM and has no daemon of its own to ask, but the compiler
//! **warms** dramatically when it is embedded. Measured on this repository's dev container, through
//! this arm's own driver: the first build in a JVM costs 1.7–9 s and the ones after it cost
//! **0.14–0.4 s** of Kotlin plus 0.15–0.6 s of TeaVM. A per-compile process would make this arm ten
//! times dearer than every other one, which is a difference in the *harness* rather than in the
//! language, and a study cannot carry that.
//!
//! So the shape is [Java's](super::super::java::compile), for the same reasons and with the same
//! guarantees: a [`CompilerPool`] of JVM **processes**, each lent to one preparation at a time, a
//! fresh compiler and a fresh TeaVM build strategy per request, output written where the request
//! says, and a daemon retired after [`MAX_BUILDS`] because every build leaves class loaders behind
//! that gg cannot reclaim from here. Two preparations are never inside one JVM together, which is
//! the precondition of the measured TeaVM corruption the seam's isolation rule exists for.
//!
//! # What a Kotlin program is: a script
//!
//! The one deep difference from the Java arm, and it is [`source`](super::source)'s to explain. A
//! reply is compiled as a Kotlin **script** rather than as the body of a function gg declares,
//! because Kotlin refuses `object`, `interface`, `enum class`, `typealias` and `private fun` as
//! *local* declarations — five things a Kotlin author writes without thinking. In a script they are
//! all legal, statements and declarations sit side by side, and a reply with no `import` in it is
//! compiled **byte for byte as the model wrote it**.
//!
//! What that costs is here rather than there: four scripting jars in the toolchain, one experimental
//! compiler flag (`-Xallow-any-scripts-in-source-roots`, which compiles a script instead of running
//! it), a `kotlin-home` directory the plugin is found through, and three `idea.*` system properties
//! without which the compiler's IntelliJ core cannot find a configuration directory and throws
//! before it reads a line. All four are pinned, and all four are checked by this arm's tests
//! starting a real daemon.
//!
//! # The three ways a compile can end, and whose fault each is
//!
//! | What happened | How it is reported |
//! | --- | --- |
//! | the Kotlin compiler's `SYNTAX` diagnostic | [`Syntax`](PrepareError::Syntax) — the parser could not read it |
//! | any other Kotlin error | [`Compile`](PrepareError::Compile) — read whole and rejected, which is the band a typed arm exists to produce |
//! | TeaVM naming a class or method its classlib does not carry | [`Compile`](PrepareError::Compile), **including when the file it names is the standard library's** |
//! | anything about a file gg generated, a compiler that could not run, or one that reported nothing | [a toolchain failure](PrepareFailure::Toolchain) — never the model's |
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

use crate::sandbox::language::compile::{CompilerDaemon, CompilerPool, daemon, place, place_bytes};
use crate::sandbox::language::jvm;
use crate::sandbox::language::{PrepareContext, PrepareError, PrepareFailure, PreparedProgram};

use super::source::{self, Wrapped};

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
/// compiled against another is the failure this whole seam exists to prevent. Committed, the SDK and
/// the catalogue reflected from it move in one diff.
const SDK: &[u8] = include_bytes!("../checkers/kotlin.sdk.jar");

/// The environment variable an operator points at the directory of Kotlin jars.
pub(super) const KOTLIN_ENV: &str = "TCAB_GG_KOTLIN";

/// Where `containers/gg-toolchains` installs this arm's own jars in a gg run image.
const IMAGE_ROOT: &str = "/opt/gg/toolchains/kotlin";

/// Where `scripts/ci/install-kotlin.sh` installs them on a developer's or CI machine, under `$HOME`.
const HOME_ROOT: &str = ".local/share/gg-kotlin";

/// The directory inside either of those that the scripting plugin is loaded through.
///
/// The compiler looks for four jars by **unversioned** name under `<kotlin home>/lib`, which is the
/// layout of a Kotlin distribution rather than of a Maven repository — so the install script writes
/// one, and gg names it. Without it a script compiles to `SCRIPTING_ERROR: Unable to evaluate
/// script, no scripting plugin loaded`, which is a sentence about gg's packaging wearing the shape
/// of a diagnostic about the model's program.
const KOTLIN_HOME: &str = "kotlin-home";

/// How many programs one JVM builds before it is thrown away.
const MAX_BUILDS: usize = 64;

/// How many warm JVMs may exist at once.
///
/// Not [`WIDTH`](super::super::isolation::WIDTH), for the reason
/// [Java's pool](super::super::java::compile) is not either: a JVM holding the Kotlin compiler *and*
/// TeaVM holds several hundred megabytes, so sixteen of them is a container that swaps rather than an
/// arm that is four times faster. A preparation that arrives when all four are out waits, which costs
/// nothing because preparation runs on a blocking task.
const POOL_SIZE: usize = 4;

/// How long one build may take before the daemon is retired and the failure reported as a
/// [toolchain failure](PrepareFailure::Toolchain).
const BUILD_TIMEOUT: Duration = Duration::from_secs(180);

/// How long starting a JVM and reading its handshake may take.
const START_TIMEOUT: Duration = Duration::from_secs(120);

/// The file a program's source is written into, and the one its diagnostics are located in.
///
/// `.kts` rather than `.kt` because [a program is a script](super::source), and the extension is what
/// tells the compiler so. A model reads the name in its diagnostics, which is honest: what it wrote
/// really was compiled as a script.
pub(super) const PROGRAM_FILE: &str = "Program.kts";

/// The file a code module's source is written into.
pub(super) const MODULE_FILE: &str = "Module.kt";

/// The file gg's generated entry class is written into.
const ENTRY_FILE: &str = "GgEntry.java";

/// What TeaVM is asked to write.
const BUNDLE_FILE: &str = "program.js";

/// The name the driver is placed under. The JDK's single-file launcher requires the file name to
/// match the public class it holds.
const DRIVER_FILE: &str = "GgCompiler.java";

/// The name this arm's SDK jar is placed under, beside the driver.
const SDK_FILE: &str = "gg-sdk.jar";

/// The name a model's own file is reported under in a located failure: `Program.kts` becomes
/// `program.kts` and `Module.kt` becomes `module.kt`.
fn label(file: &str) -> String {
    file.to_ascii_lowercase()
}

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
            .expect("the committed Kotlin toolchain manifest is valid JSON of the expected shape")
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

/// Compile a **program** — a model's reply — into the JavaScript the guest evaluates.
///
/// [`unreachable`](PreparedProgram::unreachable) is `None`, and that is an absence rather than a
/// zero: the measurement counts top-level statements written after one that *ends the program*,
/// which in the ECMAScript arms is a top-level `return`. A script's top level is not a function
/// body, so `return` there is a compile error the model is shown rather than something to count.
pub(super) fn compile_program(
    source: &str,
    context: &PrepareContext,
) -> Result<PreparedProgram, PrepareFailure> {
    let wrapped = source::wrap_program(source)?;
    Ok(PreparedProgram {
        source: build(PROGRAM_FILE, &wrapped, Entry::Program, context)?,
        unreachable: None,
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
    /// A model's program: run the script, and report what it threw.
    Program,
    /// A code module: export its functions, and hand the namespace back.
    Module,
}

impl Entry {
    /// What the driver is told this build is, which decides the classpath the model's own source is
    /// compiled against.
    fn kind(self) -> &'static str {
        match self {
            Self::Program => "program",
            Self::Module => "module",
        }
    }

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
        // instead would report a failed program as a complete success, which was measured on the
        // Java arm.
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
        .checkout(KotlinCompiler::start)
        .map_err(PrepareFailure::Toolchain)?;
    let request = format!(
        "{}\t{}\t{}\t{BUNDLE_FILE}\t{}\t{file}\t{ENTRY_FILE}",
        workspace.work().display(),
        workspace.output().display(),
        source::ENTRY_CLASS,
        entry.kind(),
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
    verdict(&report, file, wrapped.shift)?;

    jvm::assembled(
        workspace.output(),
        BUNDLE_FILE,
        file,
        wrapped.shift,
        &label(file),
        &entry.tail(),
    )
    .map_err(|error| {
        PrepareFailure::Toolchain(format!(
            "the Kotlin {} toolchain: {error}",
            compiler_version()
        ))
    })
}

// ---------------------------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------------------------

/// What one build of the driver reported.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Report {
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
const SHOWN: usize = 8;

/// Turn a finished build into a verdict.
fn verdict(report: &Report, file: &str, shift: usize) -> Result<(), PrepareFailure> {
    let errors: Vec<&Diagnostic> = report
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.error)
        .collect();
    if errors.is_empty() {
        return Ok(());
    }

    // A diagnostic about the file gg GENERATED is about gg's own entry class, which is gg's artifact
    // rather than the model's program. Blaming a model for it would send it rewriting something that
    // was never wrong. Everything else is the model's — including a diagnostic in a library file,
    // which is this arm's own answer and the module's documentation says why.
    let (mine, ours): (Vec<&&Diagnostic>, Vec<&&Diagnostic>) = errors
        .iter()
        .partition(|diagnostic| diagnostic.file.as_deref() != Some(ENTRY_FILE));
    if mine.is_empty() {
        let rendered = ours
            .iter()
            .map(|diagnostic| diagnostic.render(file, shift))
            .collect::<Vec<_>>()
            .join(" | ");
        return Err(PrepareFailure::Toolchain(format!(
            "the Kotlin toolchain refused a file gg generated rather than the program: {rendered}"
        )));
    }

    // Deduplicated, because one unsupported call is one thing to fix however many call sites TeaVM
    // found it at, and capped, because a model reads the first few and pays for all of them.
    let mut seen: Vec<String> = Vec::new();
    for diagnostic in &mine {
        let rendered = diagnostic.render(file, shift);
        if !seen.contains(&rendered) {
            seen.push(rendered);
        }
    }
    let more = seen.len().saturating_sub(SHOWN);
    seen.truncate(SHOWN);
    let mut rendered = seen.join("\n\n");
    if more > 0 {
        rendered.push_str(&format!("\n\n… and {more} more like these."));
    }
    // A parse failure anywhere is the whole verdict: the compiler never got as far as meaning, so
    // whatever else it says is downstream of text it could not read.
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

    /// This diagnostic as the model reads it: `program.kts:7:19: Unresolved reference 'nope'.`
    ///
    /// The line is moved back over whatever gg put in front of the program, so the coordinate names
    /// the line of the reply the model actually wrote.
    fn render(&self, file: &str, shift: usize) -> String {
        let mine = self.file.as_deref() == Some(file);
        let located = match (mine, self.line) {
            (true, 0) => label(file),
            (true, line) => {
                let line = line.saturating_sub(shift).max(1);
                match self.column {
                    0 => format!("{}:{line}", label(file)),
                    column => format!("{}:{line}:{column}", label(file)),
                }
            }
            // A library's own file, named as such. This is a fact about what the model's program
            // reached — Kotlin's standard library is where an unsupported call is *found*, because
            // the program reached TeaVM's classlib through it — so the file is quoted rather than
            // hidden, and it is not written as though the model could open it.
            (false, _) => match (&self.file, self.line) {
                (Some(name), 0) => format!("{}, inside {name}", label(file)),
                (Some(name), line) => format!("{}, inside {name}:{line}", label(file)),
                (None, _) => label(file),
            },
        };
        format!("{located}: {}", self.message.trim_end())
    }
}

// ---------------------------------------------------------------------------------------------
// The generated entry class
// ---------------------------------------------------------------------------------------------

/// The exceptions the entry class names one by one, innermost subtype first.
///
/// **Enumerated rather than derived**, for the reason [Java's](super::super::java::compile) is:
/// `failure.getClass().getName()` answers `null` for a `NullPointerException` under TeaVM, which is
/// how that arm was measured reporting `Error: Error: null`. Naming the classes gg cares about in
/// `catch` clauses makes the answer the compiler's rather than the runtime's, and a class not on this
/// list still gets `getName()` with a stated fallback.
///
/// Two of them are Kotlin's own and are why this list is not simply Java's. `!!` on a null and a
/// failed `check(…)` are the two ways a Kotlin program most often stops, and
/// `UninitializedPropertyAccessException` is the third — each of them a class no Java program can
/// throw. Order matters: a subtype before its supertype, because Java takes the first clause that
/// matches.
const CAUGHT: [&str; 14] = [
    "kotlin.KotlinNullPointerException",
    "java.lang.NullPointerException",
    "kotlin.UninitializedPropertyAccessException",
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
/// A failure a binding raised — a `ToolError` the host refused a call with — arrives in the JVM as a
/// `RuntimeException` whose message TeaVM prefixes with this. gg must not describe one: the guest
/// classifies a tool failure from what the host said, and a re-description would turn a refusal the
/// model can act on into prose about a class it never wrote.
///
/// # What that costs, said out loud
///
/// This is the **one** failure a Kotlin program can produce that carries no line of the model's own.
/// Locating a failure and describing it are the same act here: `$ggMessage` is what
/// [the tail](Entry::tail) branches on, and only the branch that sets it runs `$ggLocate` over
/// TeaVM's source map. A refusal that arrives wearing this marker takes the pass-through branch
/// instead, so the coordinate that reaches the outcome is the generated bundle's rather than the
/// program's — `line 2529, column 19` of something the model never saw.
///
/// Kept, rather than fixed by locating without describing, because the two are not separable on this
/// road: what the guest classifies from is the thrown value itself, and the only place a located line
/// could go is the message it must not touch. The refusal's own sentence is the thing a model acts on
/// — `setTimeout is not available in the sandbox` names the mistake far more precisely than a line
/// number would — so the trade is deliberate and not this arm's alone: it follows from the shared
/// [JVM road](super::super::jvm) and [Java's arm](super::super::java::compile) is on exactly the same
/// terms. `a_refusal_raised_under_the_program_rather_than_by_it_is_passed_through_undescribed` in
/// [the substrate tests](super::substrate) holds it, so a future reader finds the exception rather
/// than the unqualified claim.
const FOREIGN_MARKER: &str = "(JavaScript) ";

/// The entry class for a **program**: run the model's script, describe what it threw, and rethrow it.
///
/// The first `catch` is this arm's SDK rather than the language's, and it is the half no SDK could do
/// for itself: a `ToolError` the program did not handle must reach the guest as a **tool failure**,
/// because gg classifies a turn's error from the host's own code. The SDK catches a refusal in
/// JavaScript and raises a real Kotlin exception so that `catch (failure: ToolError)` works at all;
/// this records the same three fields on the way past, and the bundle's tail throws that record
/// instead of the exception object. `ToolError` is named with no package, because this SDK declares
/// its surface in the root one — which is what makes a program need no `import` at all.
///
/// Written in Java rather than in Kotlin, which is worth saying because the program it starts is
/// Kotlin. A Kotlin entry class would have to be compiled by the compiler this class exists to
/// wrap — before the model's own source, in a second pass, against annotations
/// (`@JSBody`) whose Kotlin spelling is `external fun` — for a class that never appears in a
/// diagnostic a model reads. Running a script is `new Program(new String[0])` from anywhere on the
/// JVM.
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
         \x20       try {{ new {program}(new String[0]); }}\n\
         \x20       catch (ToolError failure) {{\n\
         \x20           refused(failure.getTool(), failure.getCode().getWireName(), \
         failure.getMessage());\n\
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
        marker = FOREIGN_MARKER,
    )
}

/// The entry class for a **code module**: export the module's class, and leave the namespace where
/// the bundle's tail can hand it back.
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
        // The SDK goes on the two classpaths a MODEL's own source is read against, and on neither of
        // the others: a program that could reach the compiler's own jars could import
        // `kotlinx.coroutines`, which this sandbox cannot run. So `fs.readFile("x")` type-checks
        // against the same bytes TeaVM translates, and there is no second path to keep in step.
        let program_path = format!("{}:{}", toolchain.program_path, placed.sdk.display());
        let module_path = format!("{}:{}", toolchain.module_path, placed.sdk.display());
        let started = daemon(&toolchain.java).and_then(|mut command| {
            command
                // A developer's shell may carry either of these, and a JVM that picks one up prints
                // a line to stderr and may compile differently from the one in the run image —
                // which is a difference between two arms of a study that came from a dotfile.
                // Emptied rather than unset because that is what the launcher checks.
                .env("JAVA_TOOL_OPTIONS", "")
                .env("_JAVA_OPTIONS", "")
                // A JVM that lives for sixty-four builds and is then replaced has no use for a
                // concurrent collector, and a serial one leaves the cores to the fifteen other
                // preparations that may be compiling beside it.
                .arg("-XX:+UseSerialGC")
                .arg("-Xms64m")
                .arg("-Xmx1g")
                .arg("-cp")
                .arg(&toolchain.classpath)
                // The driver's own source. The JDK's single-file launcher compiles it in memory,
                // which is why gg builds no jar of its own for it.
                .arg(&placed.driver)
                .arg(&toolchain.compile_path)
                .arg(&program_path)
                .arg(&module_path)
                .arg(&toolchain.home);
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
                    "gg compiles every Kotlin program with the Kotlin compiler and the TeaVM jars \
                     in the gg run image, and needs them in {IMAGE_ROOT}, under ~/{HOME_ROOT} \
                     (scripts/ci/install-kotlin.sh), or named by {KOTLIN_ENV}: {error}"
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
    let greeting: Greeting = serde_json::from_str(greeting.trim())
        .map_err(|error| format!("gg could not read its Kotlin compiler's greeting ({error})"))?;
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
/// [SDK](SDK), so a gg carrying either a different driver or a different surface reads a different
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

/// What this arm compiles with: one JDK, four classpaths and the directory the scripting plugin is
/// loaded out of.
struct Toolchain {
    /// The `java` a daemon is started as, which is [the JVM arms' shared JDK](jvm::toolchain).
    java: PathBuf,
    /// What the driver JVM itself runs with: the Kotlin compiler, its own dependencies, and TeaVM.
    classpath: String,
    /// What gg's generated entry class is compiled with, and what TeaVM translates from.
    compile_path: String,
    /// What a model's **program** is compiled against: the Kotlin standard library and the script
    /// runtime its script class extends, and nothing else.
    ///
    /// This is the arm's library claim, and it is a claim gg can only make by being deliberate about
    /// it: the driver runs with a 60 MB Kotlin compiler and every TeaVM jar on its classpath, and a
    /// program compiled against *that* could import the compiler's own internals and — worse —
    /// `kotlinx.coroutines`, which is a runtime dependency of the compiler and which this sandbox
    /// cannot run. Compiled against the standard library alone, `import kotlinx.coroutines.*` is an
    /// `UNRESOLVED_IMPORT` at the model's own line rather than forty-five TeaVM errors inside
    /// somebody else's file.
    ///
    /// This arm's [SDK](SDK) is appended to it as the daemon starts, because that jar is placed
    /// rather than installed and its path is not known until then.
    program_path: String,
    /// What a code **module** is compiled against: the above plus TeaVM's `@JSExport`, which gg
    /// writes into a module and an author never types.
    module_path: String,
    /// The directory the scripting plugin is loaded out of, as the compiler's `-kotlin-home`.
    ///
    /// Not a classpath entry, and that is the point of it: the compiler looks for its scripting
    /// plugin by four **unversioned** file names under `<home>/lib`, which is a Kotlin
    /// distribution's layout rather than a Maven repository's, so the install script writes one and
    /// gg names it.
    home: String,
}

/// Find the toolchain, once per process.
fn toolchain() -> Result<&'static Toolchain, String> {
    static TOOLCHAIN: std::sync::OnceLock<Result<Toolchain, String>> = std::sync::OnceLock::new();
    TOOLCHAIN
        .get_or_init(find_toolchain)
        .as_ref()
        .map_err(Clone::clone)
}

/// Look for the Kotlin jars, and build the four classpaths out of them and the JVM toolchain.
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
                "gg found no Kotlin compiler. It is installed in {IMAGE_ROOT} by \
                 containers/gg-toolchains and under ~/{HOME_ROOT} by \
                 scripts/ci/install-kotlin.sh; {KOTLIN_ENV} names another directory."
            )
        })?;
    let kotlin = jvm::jars(&root.join("libs"))?;

    let home = root.join(KOTLIN_HOME);
    if !home.join("lib").is_dir() {
        return Err(format!(
            "{} holds no scripting plugin; a Kotlin program is compiled as a script and the \
             compiler loads that plugin out of a kotlin-home directory. Run \
             scripts/ci/install-kotlin.sh.",
            home.display()
        ));
    }

    // Named by prefix rather than by full file name, because the version is in the name and the pin
    // that decides it lives in `packages/gg-sandbox-kotlin/kotlin-version.sh` rather than in Rust.
    let stdlib = jar(&kotlin, "kotlin-stdlib-")?;
    let script_runtime = jar(&kotlin, "kotlin-script-runtime-")?;
    let jso = jar(&shared.classpath, "teavm-jso-")?;
    let program_path = format!("{stdlib}:{script_runtime}");
    Ok(Toolchain {
        java: shared.java.clone(),
        classpath: format!("{kotlin}:{}", shared.classpath),
        compile_path: shared.classpath.clone(),
        module_path: format!("{program_path}:{jso}"),
        program_path,
        home: home.to_string_lossy().into_owned(),
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
