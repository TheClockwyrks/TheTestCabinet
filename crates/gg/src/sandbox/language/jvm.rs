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
//! # Two targets, and the arms are one each
//!
//! TeaVM's `WEBASSEMBLY_WASI` backend compiles a program into a **component of its own**, which
//! [`component`] encodes and which reaches gg through the one door `test-cabinet:gg/wire` declares.
//! That is [Java](super::java)'s road. Its JavaScript backend is what [Kotlin](super::kotlin)
//! compiles through, and that arm's bundles are evaluated by the
//! [ECMAScript guest](super::typescript); [`assembled`] and everything below it is that road's own
//! half, and it goes when that arm converts.
//!
//! The **guest** half of that crossing — `gg/internal/{Abi,Coding,Value}.java`, and the one vendored
//! TeaVM runtime class that makes an uncaught exception print what was thrown — is in
//! [the Java arm's SDK jar](super::java::compile) and is language-neutral. Kotlin will reach it by
//! putting that jar on its own TeaVM classpath rather than by carrying a translation of it: a second
//! copy would be a second canonical-ABI implementation to keep in step with one WIT, which is the
//! thing this whole arrangement exists to avoid.
//!
//! # Why the sharing is real rather than a pair of copies
//!
//! Four of TeaVM's settings are not optional, and each fails **silently** when it is missing.
//! Without `setStrict(true)` TeaVM omits the null checks that make a `NullPointerException` an
//! exception at all, so `catch (NullPointerException)` never fires and a program that failed is
//! recorded as one that succeeded. Without `setClassesToPreserve` on the wasm route the entry class
//! is dead-stripped and the encode produces a component with no exports. Without an equal minimum
//! and maximum heap on the wasm route a program gets the *minimum* and not the difference, so a
//! generous maximum reads as an allowance a program never has. Without `setJsModuleType(NONE)` on
//! the JavaScript route
//! the entry point is not a bare name the guest's scope can reach. A second copy of the code that
//! sets them would be a standing chance for one arm to lose any one and for nobody to notice —
//! which is the argument that has
//! [JavaScript](super::javascript) serve TypeScript's prebuilt component rather than a
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

use serde::Deserialize;

use super::compile::shared_toolchain_dir;

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

// ---------------------------------------------------------------------------------------------
// The bundle TeaVM wrote, and the model's own lines — THE JAVASCRIPT ROAD, WHICH IS KOTLIN'S ALONE
//
// Everything below this line exists because a failure on that road surfaces inside a generated
// JavaScript bundle rather than in the model's own file: the prelude, the run-time-calibrated
// `$ggBase`, the hand-written base-64 VLQ decoder and the generated-line to model-line table. The
// Java arm no longer reaches any of it — a Java failure arrives on the guest's own standard error,
// in the model's own coordinates, with nothing to remap — and it goes when Kotlin converts too.
// ---------------------------------------------------------------------------------------------

/// The JavaScript gg puts in front of every compiled program, whichever arm compiled it.
///
/// Three things, and each of them is load-bearing:
///
/// * `$ggMessage` — where the generated entry class's catch chain leaves the Java name and
///   message of what failed. Empty means nothing Java threw, which is how a failure raised by a
///   *binding* is rethrown untouched rather than re-described.
/// * `$ggFailure` — where the same chain leaves the three fields of a **gg** failure the program did
///   not catch. The SDK catches a refusal in JavaScript and raises a Java `ToolError` so that
///   `catch (ToolError failure)` works at all; without this, one that *escaped* would reach the
///   guest as a Java exception and be recorded as a program that threw something rather than as a
///   tool that failed. The guest reads `tool`, `code` and `message` off whatever is thrown, so what
///   goes back over is that record — the same shape the membrane itself raises.
/// * `$ggLines` — TeaVM's source map, folded by [`model_lines`] into the change points of "whose
///   code is this generated line?", with `0` for somebody else's. Looked up nearest-preceding,
///   because a source map is sparse and a stack frame lands where the failure happened rather than
///   where a segment starts.
/// * `$ggBase` — how far the stack's line numbers are from the bundle's. Part of it is known
///   (this prelude's own length); part is the engine's `Function` wrapper, which is calibrated at run
///   time exactly as the guest's own shim calibrates it, so an engine update costs nothing.
pub(super) const PRELUDE: &str = r#"var $ggMessage = "";
var $ggFailure = null;
var $ggLines = __GG_LINES__;
var $ggBase = __GG_BASE__;
(function () {
  try { new Function("throw new Error('calibrate')")(); } catch (thrown) {
    var frames = String(thrown && thrown.stack).split("\n");
    for (var index = 0; index < frames.length; index++) {
      var found = /:(\d+):(\d+)/.exec(frames[index]);
      if (found) { $ggBase += Number(found[1]) - 1; break; }
    }
  }
})();
function $ggModelLine(line) {
  var low = 0, high = $ggLines.length - 1, found = -1;
  while (low <= high) {
    var middle = (low + high) >> 1;
    if ($ggLines[middle][0] <= line) { found = middle; low = middle + 1; } else { high = middle - 1; }
  }
  return found < 0 ? 0 : $ggLines[found][1];
}
function $ggLocate(stack) {
  if (typeof stack !== "string") return "";
  var seen = [], located = [], frames = stack.split("\n"), pattern = /:(\d+):(\d+)/g;
  for (var index = 0; index < frames.length; index++) {
    var found = null, last = null;
    pattern.lastIndex = 0;
    while ((found = pattern.exec(frames[index])) !== null) last = found;
    if (!last) continue;
    var line = $ggModelLine(Number(last[1]) - $ggBase);
    if (line === 0 || seen.indexOf(line) >= 0) continue;
    seen.push(line);
    located.push("\n    at __GG_LABEL__:" + line);
  }
  return located.join("");
}
"#;

/// The prelude, with the model's line table in it and its own length accounted for.
fn prelude(lines: &[(usize, usize)], label: &str) -> String {
    let table: Vec<String> = lines
        .iter()
        .map(|(generated, model)| format!("[{generated},{model}]"))
        .collect();
    let filled = PRELUDE
        .replace("__GG_LINES__", &format!("[{}]", table.join(",")))
        .replace("__GG_LABEL__", label);
    // Counted after the table is in, and the table is one line, so this is a constant — but derived
    // rather than written down, because a prelude that grew by a line and a constant that did not
    // would report every location one line out.
    let length = filled.lines().count();
    filled.replace("__GG_BASE__", &length.to_string())
}

/// The prelude, TeaVM's output and the call that starts it, in that order.
fn assemble(prelude: &str, compiled: &str, tail: &str) -> String {
    // TeaVM opens its output with `"use strict";`, which is a directive rather than a statement and
    // is inert anywhere but the top of a body. That is fine and deliberate: the guest evaluates the
    // whole of this as one function body, and a prelude in front of the directive is what makes the
    // table reachable from inside TeaVM's own generated code.
    format!("{prelude}{compiled}\n{tail}")
}

// ---------------------------------------------------------------------------------------------
// The source map
// ---------------------------------------------------------------------------------------------

/// A source map, as much of one as this needs.
#[derive(Debug, Deserialize)]
struct SourceMap {
    /// The files the generated code came from.
    sources: Vec<String>,
    /// The mappings, in the format's own base-64 VLQ.
    mappings: String,
}

/// Fold TeaVM's source map down to the **change points** of "which of the model's lines is this
/// generated line?", with `0` for a generated line that belongs to somebody else's code.
///
/// Not simply the model's own mappings, and the difference is what makes a located error land. A
/// source map is **sparse**: TeaVM emits one segment per Java statement, at the first generated line
/// of that statement's code, and a stack frame lands wherever the failure happened — which is
/// routinely a later line of the same statement, with no segment of its own. Looking up an exact
/// generated line therefore finds nothing most of the time. The correct reading, and the one every
/// source-map consumer uses, is the segment at or **before** the position.
///
/// That in turn is why the classlib's mappings are kept as `0` rather than dropped: a frame deep
/// inside `java.util` would otherwise fall back to whichever of the model's lines happened to come
/// before it and be reported as the model's own. Recording those runs as "not yours" is what makes
/// the nearest-preceding lookup safe.
///
/// Run-length compressed, so what ships is the handful of places the answer changes rather than one
/// entry per generated line: an ordinary program's table is tens of pairs against a 44 KB map.
///
/// The model's line is already moved back over the wrapper, so nothing downstream has to know the
/// shift. A map gg cannot read is not a failure — it costs a located message and nothing else, and
/// refusing a program that compiled because its debug information was odd would be the wrong trade.
fn model_lines(map: &str, file: &str, shift: usize) -> Vec<(usize, usize)> {
    let Ok(map) = serde_json::from_str::<SourceMap>(map) else {
        return Vec::new();
    };
    let mut lines: Vec<(usize, usize)> = Vec::new();
    let mut source = 0i64;
    let mut original = 0i64;
    let mut previous = 0usize;
    for (generated, segments) in map.mappings.split(';').enumerate() {
        let mut first: Option<usize> = None;
        for segment in segments.split(',').filter(|segment| !segment.is_empty()) {
            let Some(fields) = vlq(segment) else { continue };
            if fields.len() < 4 {
                continue;
            }
            source += fields[1];
            original += fields[2];
            if first.is_some() {
                continue;
            }
            // The first segment of a generated line is what that whole line is attributed to: a
            // frame carries a column too, but a table keyed by line is what a stack can be read
            // against without a second lookup.
            let named = usize::try_from(source)
                .ok()
                .and_then(|index| map.sources.get(index))
                .is_some_and(|name| Path::new(name).file_name().is_some_and(|it| it == file));
            first = Some(match (named, usize::try_from(original)) {
                // 0 is "not the model's code", which is a line number no source has.
                (true, Ok(line)) => (line + 1).saturating_sub(shift).max(1),
                _ => 0,
            });
        }
        let Some(model) = first else { continue };
        if model != previous || lines.is_empty() {
            lines.push((generated + 1, model));
            previous = model;
        }
    }
    lines
}

/// Decode one base-64 VLQ segment into its fields.
///
/// `None` for a segment carrying a character the alphabet does not have, which is a map gg will not
/// use rather than a program it will refuse.
fn vlq(segment: &str) -> Option<Vec<i64>> {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut fields = Vec::new();
    let mut value: i64 = 0;
    let mut shift: u32 = 0;
    for character in segment.bytes() {
        let digit = ALPHABET.iter().position(|it| *it == character)? as i64;
        let more = digit & 32 != 0;
        value += (digit & 31) << shift;
        shift += 5;
        if more {
            continue;
        }
        let negative = value & 1 != 0;
        value >>= 1;
        fields.push(match negative {
            true => -value,
            false => value,
        });
        value = 0;
        shift = 0;
    }
    Some(fields)
}

/// What TeaVM wrote for one build, read out of `output` and assembled into what the guest evaluates.
///
/// The arm supplies the two things that are its own — the label a located failure is reported under
/// (`program.java`, `program.kts`) and the tail that starts the program — and this supplies
/// everything TeaVM's output is read with, because a source map is a source map whichever compiler
/// wrote the bytecode.
///
/// A map gg cannot read is **not** a failure: it costs a located message and nothing else, and
/// refusing a program that compiled because its debug information was odd would be the wrong trade.
pub(super) fn assembled(
    output: &Path,
    target: &str,
    source_file: &str,
    shift: usize,
    label: &str,
    tail: &str,
) -> Result<String, String> {
    let bundle = output.join(target);
    let compiled = std::fs::read_to_string(&bundle).map_err(|error| {
        format!(
            "TeaVM reported success but wrote no JavaScript to {}: {error}",
            bundle.display(),
        )
    })?;
    let lines = std::fs::read_to_string(bundle.with_extension("js.map"))
        .ok()
        .map(|map| model_lines(&map, source_file, shift))
        .unwrap_or_default();
    Ok(assemble(&prelude(&lines, label), &compiled, tail))
}

#[cfg(test)]
#[path = "jvm.test.rs"]
mod tests;
