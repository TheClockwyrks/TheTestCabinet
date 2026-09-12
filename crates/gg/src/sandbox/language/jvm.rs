//! **What the two JVM arms share**: the JDK and TeaVM they both compile through, and the half of
//! gg's compiler driver that does not depend on which language a program was written in.
//!
//! [Java](super::java) and [Kotlin](super::kotlin) reach gg by the same road — a program is compiled
//! to **bytecode** and TeaVM translates the bytecode. What differs is the *front* of that road:
//! which compiler reads the model's source, and what its diagnostics look like. This module is the
//! rest of it.
//!
//! It is not a language and it is not registered anywhere: no
//! [`ProgramLanguage`](super::ProgramLanguage) is implemented here and
//! [the lookup](super::language()) never answers with it. It is the road two registered arms drive
//! down.
//!
//! # One target, and both arms are on it
//!
//! TeaVM's `WEBASSEMBLY_WASI` backend compiles a program into a **component of its own**, which
//! [`component`] encodes and which reaches gg through the one door `test-cabinet:gg/wire` declares.
//! Both arms take that road, so neither has a baked guest and neither can have one: TeaVM does not
//! produce a Java runtime that later runs a program, it produces the program.
//!
//! The **guest** half of that crossing — `gg/internal/{Abi,Value,Frames}.java`, and the one vendored
//! TeaVM runtime class that makes an uncaught exception print what was thrown — is in
//! `packages/gg-sandbox-jvm` and is language-neutral. Each arm's `build.sh` compiles those two trees
//! into its own SDK jar, rather than either arm carrying a translation of them: a second copy would
//! be a second canonical-ABI implementation to keep in step with one WIT, which is the thing this
//! whole arrangement exists to avoid. What is *not* shared is the one function above them that
//! raises the arm's own `ApiError`, because that class is model-facing and has a catalogue entry of
//! its own on each side.
//!
//! [`entry_class`] is the last piece of that sharing and the sharpest: the two arms' generated entry
//! classes differ by **one line**, the call to the model's own entry point.
//!
//! # Why the sharing is real rather than a pair of copies
//!
//! Three of TeaVM's settings are not optional, and each fails **silently** when it is missing.
//! Without `setStrict(true)` TeaVM omits the null checks that make a `NullPointerException` an
//! exception at all, so a program that failed is recorded as one that succeeded. Without
//! `setClassesToPreserve` the entry class is dead-stripped and the encode produces a component with
//! no exports. Without an equal minimum and maximum heap a program gets the *minimum* and not the
//! difference, so a generous maximum reads as an allowance a program never has. A second copy of the
//! code that sets them would be a standing chance for one arm to lose any one and for nobody to
//! notice — which is the argument that has [JavaScript](super::javascript) reach the
//! [ECMAScript guest](super::ecmascript) through TypeScript's own constant rather than embed a
//! byte-identical copy of it, one level down.
//!
//! The JDK's single-file source-code launcher compiles **one** file, so sharing here cannot mean
//! `import`: it means gg builds the file. [`driver`] appends
//! `checkers/jvm.backend.java` — a class-body tail — to an arm's own front end and closes the brace.
//! The assembled text is what is placed on disk and run, and what an arm's shared-directory key is
//! taken over, so a gg carrying a different backend never reads another build's driver.
//!
//! # Why the toolchain lookup is shared too
//!
//! There is one JDK and one set of TeaVM jars on a machine, installed by
//! `scripts/ci/install-java.sh` and by `containers/gg-toolchains`, and both arms compile with them.
//! A second lookup would be a second set of environment variables and a second error message for one
//! missing directory. Kotlin adds **its own** jars on top of what [`toolchain`] finds — see
//! [`kotlin::compile`](super::kotlin::compile) — rather than replacing it.

use std::path::{Path, PathBuf};

use super::compile;
use super::compile::{DaemonCommand, shared_toolchain_dir};

/// Encoding the core module TeaVM's `WEBASSEMBLY_WASI` backend writes as the component gg's engine
/// instantiates.
#[path = "jvm.component.rs"]
pub(crate) mod component;

/// The half of the driver both arms run.
const BACKEND: &str = include_str!("../checkers/jvm.backend.java");

/// The environment variable an operator points at a JDK's `java` when it is not where gg looks.
pub(super) const JAVA_ENV: &str = "TCAB_GG_JAVA";

/// The environment variable an operator points at the directory of TeaVM jars.
pub(super) const TEAVM_ENV: &str = "TCAB_GG_TEAVM";

/// Where `containers/gg-toolchains` installs the JDK and TeaVM in a gg run image.
pub(super) const IMAGE_ROOT: &str = "/opt/gg/toolchains/java";

/// Where `scripts/ci/install-java.sh` installs them on a developer's or CI machine, under `$HOME`.
///
/// Looked at because this toolchain is not a binary on `PATH` — it is a JDK *and* a directory of
/// jars — so there is no `PATH` lookup that could find it, and a test suite that needed an
/// environment variable set by hand would be a test suite that is red on a fresh clone.
pub(super) const HOME_ROOT: &str = ".local/share/gg-java";

/// **The VM's own logging, off the pipe the protocol is spoken on.**
///
/// A JVM's default unified-logging configuration is `all=warning:stdout:uptime,level,tags` — which
/// `java -Xlog:help` states from the other side, documenting `-Xlog:disable` as "turn off all
/// logging, **including warnings and errors**". So a warning the VM raises about the machine it is
/// on — a thread it could not start, a class-data archive it could not map — is written to *stdout*,
/// which is the one pipe gg's compiler driver answers requests on, and it is written by the VM
/// itself before any Java code runs. Both driver front ends re-point `System.out` at stderr for this
/// exact hazard (`java.compiler.java:80`), and it does not help: `System.setOut` moves the Java
/// stream, not the file descriptor the VM logs to.
///
/// One such line ahead of the greeting is read as the greeting, and gg refuses a JVM that is working
/// perfectly. Measured, that is the shape of it:
///
/// ```text
/// $ java -XX:SharedArchiveFile=/tmp/bogus.jsa GgCompiler.java …   # stdout
/// [0.001s][error][cds] Not a valid shared archive file (/tmp/bogus.jsa)
/// {"protocol":2,"java":"25.0.3","release":"21"}
/// ```
///
/// and `serde` reads `[0.001s]…` as a JSON *array* whose first element is a float:
/// `invalid type: floating point `0.001`, expected u32 at line 1 column 6`. It was found as a
/// full-suite-only flake in the Java arm's substrate tests, which is what a resource warning looks
/// like: sixteen preparations compiling at once is when a VM has something to warn about.
///
/// Disabling and re-enabling to stderr rather than disabling outright, because the lines are worth
/// having — [`CompilerDaemon::stderr_tail`](super::compile::CompilerDaemon::stderr_tail) puts the
/// daemon's stderr on the end of every failure gg reports about it, so a VM that says why it is
/// unhappy is quoted rather than silenced. Two flags in this order and not one: configuring a second
/// output does not retire the default one, so without `disable` the lines would go to both.
pub(super) const LOG_TO_STDERR: [&str; 2] = [
    "-Xlog:disable",
    "-Xlog:all=warning:stderr:uptime,level,tags",
];

/// **A JVM started the way both arms start one**, up to the classpath and the driver.
///
/// Everything here is a property of *being a gg compiler daemon* rather than of either language, so
/// it is decided once: the machine's own options out of the way, the VM's own logging off the reply
/// pipe, a serial collector, and one heap number. What is left for a caller is the two things that
/// really do differ — which jars are on the classpath and which driver is run.
///
/// `heap` is the ceiling and the floor both, spelled as a JVM wants it (`768m`, `1g`): a JVM that
/// lives for a bounded number of builds and is then replaced has no use for a growing heap, and a
/// serial collector leaves the cores to the fifteen other preparations that may be compiling beside
/// it.
pub(super) fn daemon(java: &Path, heap: &str) -> Result<DaemonCommand, String> {
    let mut command = compile::daemon(java)?;
    command
        // A developer's shell may carry either of these, and a JVM that picks one up prints a line
        // to stderr and may compile differently from the one in the run image — which is a
        // difference between two arms of a study that came from a dotfile. Emptied rather than unset
        // because that is what the launcher checks.
        .env("JAVA_TOOL_OPTIONS", "")
        .env("_JAVA_OPTIONS", "")
        .args(LOG_TO_STDERR)
        .arg("-XX:+UseSerialGC")
        .arg("-Xms64m")
        .arg(format!("-Xmx{heap}"));
    Ok(command)
}

/// One arm's compiler driver, assembled: its own front end with the shared backend appended and the
/// class closed.
///
/// The brace is gg's rather than either file's, because a file that closed its own class could not
/// have the other half appended to it and a file that did not would look unfinished to a reader. It
/// is written here, once, where the shape is documented.
pub(super) fn driver(front: &str) -> String {
    format!("{front}{BACKEND}}}\n")
}

/// The JDK and the TeaVM jars this machine compiles bytecode with.
pub(super) struct Toolchain {
    /// The `java` a daemon is started as.
    pub java: PathBuf,
    /// Every jar of the toolchain, joined the way a JVM wants them.
    pub classpath: String,
}

/// Find the JDK and TeaVM, once per process.
///
/// Looked for in the order "what an operator said, then what the gg run image guarantees, then what
/// `scripts/ci/install-java.sh` puts under `$HOME`". There is no `PATH` step for the jars — a
/// directory is not on `PATH` — so the `$HOME` fallback is what makes both arms' tests green on a
/// machine that has merely run the install script.
pub(super) fn toolchain() -> Result<&'static Toolchain, String> {
    static TOOLCHAIN: std::sync::OnceLock<Result<Toolchain, String>> = std::sync::OnceLock::new();
    TOOLCHAIN
        .get_or_init(find_toolchain)
        .as_ref()
        .map_err(Clone::clone)
}

/// Look for the JDK and the jars.
fn find_toolchain() -> Result<Toolchain, String> {
    let roots = roots(IMAGE_ROOT, HOME_ROOT);

    let java = named(JAVA_ENV)
        .or_else(|| {
            roots
                .iter()
                .map(|root| root.join("jdk").join("bin").join("java"))
                .find(|path| path.is_file())
        })
        // A `java` on `PATH` is the last answer rather than none: a developer's machine has one, and
        // a JDK gg did not install still compiles a program correctly — it is only the *diagnostics*
        // that could word themselves differently from the pinned one.
        .unwrap_or_else(|| PathBuf::from("java"));

    let libraries = named(TEAVM_ENV)
        .or_else(|| library_dir(&roots))
        .ok_or_else(|| {
            format!(
                "gg found no TeaVM jars in {IMAGE_ROOT}/libs (containers/gg-toolchains), under \
                 ~/{HOME_ROOT}/libs (scripts/ci/install-java.sh), or named by {TEAVM_ENV}"
            )
        })?;

    // Every jar in the directory rather than a list gg carries: the directory is written by the
    // install script and the toolchain image from one pinned list, and a second copy of that list in
    // Rust would be a second thing to keep in step for no gain.
    let classpath = jars(&libraries)?;
    Ok(Toolchain { java, classpath })
}

/// The directories a toolchain installed by one of gg's scripts may be under, in the order they are
/// preferred: what a gg run image guarantees, then what a developer's or CI machine has.
pub(super) fn roots(image: &str, home: &str) -> Vec<PathBuf> {
    std::iter::once(PathBuf::from(image))
        .chain(std::env::var_os("HOME").map(|it| PathBuf::from(it).join(home)))
        .collect()
}

/// The first `libs` directory among `roots` that exists.
pub(super) fn library_dir(roots: &[PathBuf]) -> Option<PathBuf> {
    roots
        .iter()
        .map(|root| root.join("libs"))
        .find(|path| path.is_dir())
}

/// Every jar in `directory`, joined the way a JVM wants a classpath.
///
/// Sorted, so a classpath is the same on two machines with the same jars — which is one fewer thing
/// to wonder about when two runs disagree.
pub(super) fn jars(directory: &Path) -> Result<String, String> {
    let mut jars: Vec<PathBuf> = std::fs::read_dir(directory)
        .map_err(|error| format!("could not read {}: {error}", directory.display()))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|it| it == "jar"))
        .collect();
    if jars.is_empty() {
        return Err(format!("{} holds no jars", directory.display()));
    }
    jars.sort();
    Ok(join(&jars))
}

/// Paths, joined the way a JVM wants a classpath.
pub(super) fn join(paths: &[PathBuf]) -> String {
    paths
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join(":")
}

/// What an operator named in `variable`, when they named anything.
pub(super) fn named(variable: &str) -> Option<PathBuf> {
    std::env::var_os(variable)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// A shared directory keyed by what gg puts in it, for the files an arm carries inside its own
/// binary and unpacks once per machine.
///
/// Content-keyed on purpose and by the seam's own discipline: the key folds in whatever the caller
/// hands it, so a gg carrying a different driver or a different library reads a *different*
/// directory rather than another build's files.
pub(super) fn placed_dir(arm: &str, version: &str, contents: &[&[u8]]) -> Result<PathBuf, String> {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for content in contents {
        content.hash(&mut hasher);
    }
    shared_toolchain_dir(&format!("{arm}-{version}-{:016x}", hasher.finish()))
}

// ---------------------------------------------------------------------------------------------
// The generated entry class
// ---------------------------------------------------------------------------------------------

/// The class gg generates to hold the component's two exports, on either arm.
pub(super) const ENTRY_CLASS: &str = "GgEntry";

/// **The two lines the host reaches a compiled program through**, and nothing else.
///
/// It is the world's `run` — eight canonically-lowered parameters a compiled arm reads none of — and
/// `call`, which is the model's own entry point and **the one line the two arms differ by**
/// (`Program.main(new String[0]);` against `ProgramKt.main();`). There is **no `try` and no
/// `catch`**: what replaced the twelve-clause chain both arms used to hold is the runtime itself. A
/// program that throws dies the way TeaVM kills it and its own dying words reach the model on
/// standard error, which is what [the failure rule](https://docs.testcabinet.ai/gg/responses-as-code/invariants/#failures)
/// asks for and what a catch chain made impossible.
///
/// It declares **no `main` of its own**, on purpose: TeaVM is given the *model's* class as its main
/// class, so nothing in the dependency graph reaches this one and `setClassesToPreserve` in
/// `checkers/jvm.backend.java` is the only thing keeping it. Without that list
/// the class is dead-stripped silently, at exit code 0, and the component gg encodes has no exports
/// at all.
///
/// `run` declares `throws Throwable` because an author writes `throws Exception` on a `main` every
/// day, and an export that did not would refuse a shape the language has.
///
/// Written in **Java** on both arms, which is worth saying on the one whose program is Kotlin: a
/// Kotlin entry class would have to be compiled by the compiler it exists to wrap, in a second pass,
/// for a class that appears in no diagnostic a model reads. javac compiles this against the classes
/// the model's own compiler produced, which is one pass either way.
///
/// It carries **nothing else at all**. An earlier version held a list of sixteen exception classes
/// and a loop over them, so that TeaVM's dependency analysis would emit their name strings and an
/// uncaught failure could say what it was. That list could not hold a class a *model* declared, and
/// a class that fell off it printed a blank header with no test able to see it; what answers the
/// same question now is `gg.internal.ThrowableNames`, a TeaVM plugin in each arm's SDK jar that
/// derives the set from the program actually being compiled.
pub(super) fn entry_class(call: &str) -> String {
    format!(
        "import gg.internal.Abi;\n\
         import org.teavm.interop.Export;\n\
         \n\
         public final class {ENTRY_CLASS} {{\n\
         \x20   private {ENTRY_CLASS}() {{\n\
         \x20   }}\n\
         \n\
         \x20   @Export(name = \"run\")\n\
         \x20   public static void run(int program, int programLength, int modules, \
         int modulesLength,\n\
         \x20           int operations, int operationsLength, int ending, int library) throws Throwable {{\n\
         \x20       {call}\n\
         \x20   }}\n\
         \n\
         \x20   @Export(name = \"bound-operations\")\n\
         \x20   public static int boundOperations() {{\n\
         \x20       return Abi.emptyList();\n\
         \x20   }}\n\
         }}\n",
    )
}

#[cfg(test)]
#[path = "jvm.test.rs"]
mod tests;
