//! **What the two JVM arms share**: the JDK and TeaVM they both compile through, and the half of
//! gg's compiler driver that does not depend on which language a program was written in.
//!
//! [Java](super::java) and [Kotlin](super::kotlin) reach the same guest by the same road — a program
//! is compiled to **bytecode**, TeaVM translates the bytecode to JavaScript, and the ECMAScript
//! guest evaluates it. What differs is the *front* of that road: which compiler reads the model's
//! source, and what its diagnostics look like. This module is the rest of it.
//!
//! # Why the sharing is real rather than a pair of copies
//!
//! Two of TeaVM's settings are not optional, and one of them fails **silently** when it is missing:
//! without `setStrict(true)` TeaVM omits the null checks that make a `NullPointerException` an
//! exception at all, so `catch (NullPointerException)` never fires and a program that failed is
//! recorded as one that succeeded. A second copy of the code that sets it would be a standing chance
//! for one arm to lose it and for nobody to notice — which is the argument that has
//! [JavaScript](super::javascript) serve TypeScript's committed component rather than a
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

use super::compile::shared_toolchain_dir;

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
                "gg found no TeaVM jars. They are installed in {IMAGE_ROOT}/libs by \
                 containers/gg-toolchains and under ~/{HOME_ROOT}/libs by \
                 scripts/ci/install-java.sh; {TEAVM_ENV} names another directory."
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

#[cfg(test)]
#[path = "jvm.test.rs"]
mod tests;
