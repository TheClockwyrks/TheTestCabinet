//! **The Opal compile** — how a model's Ruby becomes something the [Ruby guest](super) can
//! evaluate.
//!
//! Ruby is the first arm whose program is neither evaluated as written (as
//! [Python](super::super::python)'s is, by a CPython inside the artifact) nor lowered by a parse gg
//! carries in-process (as [TypeScript](super::super::typescript)'s is, by `oxc`). It is **compiled**,
//! by a real compiler, in a real process, on the turn path — and everything in this module follows
//! from that.
//!
//! # Why the compiler is Opal, and why it runs here rather than in the guest
//!
//! Opal compiles Ruby to JavaScript, and it has a **self-hosted** build: the compiler is itself Ruby
//! compiled to JavaScript, so it runs anywhere `node` does. That is what makes this arm cheap in the
//! two places a language arm is usually expensive:
//!
//! * **Nothing is installed in the run container.** `node` is what every run image already ships —
//!   the shared base *is* `node:24-bookworm-slim` — so the compiler is a committed artifact gg
//!   carries with it, exactly as the TypeScript checker is, and `containers/gg-toolchains` gains a
//!   paragraph rather than a toolchain.
//! * **No second engine.** The compiled program is JavaScript, so it is evaluated by the same
//!   `componentize-js` guest the ECMAScript arms use — with Opal's runtime pre-initialised into it,
//!   which is the whole of what `packages/gg-sandbox-ruby` adds and the whole reason that component
//!   exists separately.
//!
//! Compiling **in the guest** was the alternative and it was rejected on what it costs the
//! measurement rather than on what it costs the clock. Opal is JavaScript, so the component could
//! carry it and a program could cross the membrane as Ruby — and then a Ruby syntax error would be a
//! run-time error like Python's, `compileMs` would be absent, and the one band this arm can report
//! that Python's cannot (*the compiler read the whole program and refused it*) would not exist. The
//! study is about what a language arm costs and what it gets wrong; an arm that hides both is a
//! worse arm even when it is a faster one.
//!
//! # What a Ruby program costs to compile
//!
//! Measured in this repository's dev container, aarch64, `node` v24, one process per compile:
//!
//! | | |
//! | --- | --- |
//! | Loading Opal (the runtime, the compiler's modules, and `require`ing the compiler) | ~100–110 ms |
//! | Compiling a representative program | ~50 ms |
//! | End to end, wall clock, including `node` start | **~176–190 ms** |
//!
//! Against TypeScript's ~91 ms, that is the more expensive checked arm, and the figure is
//! [recorded](crate::sandbox::SandboxOutcome::compile) rather than argued about. Two ways to halve
//! it were measured and neither is taken yet:
//!
//! * **A Node startup snapshot.** `node --build-snapshot` over this bundle produces a 16 MB blob
//!   that starts with Opal already loaded; a compile through it measures **90–95 ms**, and the
//!   output is byte-identical (checked). It costs 321 ms to build once and it is specific to the
//!   Node build and architecture that made it, so it belongs in a
//!   [shared toolchain directory](crate::sandbox::shared_toolchain_dir) written at
//!   [warm](warm) time — which needs a binary [`place`](crate::sandbox::place), where today's takes
//!   text.
//! * **A pooled warm process.** [`CompilerPool`](crate::sandbox::CompilerPool) is the seam's
//!   sanctioned answer for a compiler whose cost is in starting up, and a resident `node` speaking a
//!   framed protocol would pay only the ~50 ms compile. It needs the seam to be able to spawn a
//!   process that outlives one preparation, which [`CompilerCommand`](crate::sandbox::CompilerCommand)
//!   deliberately cannot do today.
//!
//! Neither is a correctness question and both are additive, so they wait for a measurement that says
//! the arm's compile time is distorting a study rather than merely being one of its findings.
//!
//! # Isolation
//!
//! Sixteen agents may be compiling at once, each in this module. Every compile therefore runs in
//! **this preparation's own [workspace](crate::sandbox::Workspace)**, holding its own `program.rb`
//! and writing its own `program.js`, removed when the preparation ends — and the spawn goes through
//! [`PrepareContext::compiler`], which is what puts the working directory, `HOME`, `TMPDIR` and the
//! `XDG_*` roots inside that tree. Opal writes nothing outside its arguments, but the redirection is
//! what makes that a fact about the seam rather than a fact about Opal.
//!
//! Two things are shared and both are shared under the
//! [one sanctioned discipline](crate::sandbox::shared_toolchain_dir). The **compiler bundle** is
//! 2.9 MB and is written once per Opal release into a content-keyed directory by a rename, then read
//! and never written again. Node's **compile cache** is one writable directory every concurrent
//! compile points `NODE_COMPILE_CACHE` at, which is safe because it is content-addressed and
//! validated on read — a torn or stale entry is discarded and re-earned rather than believed — and
//! because nothing in it can change what Opal emits.
//!
//! # The two failures, and which is the model's
//!
//! Ruby has no compile-time type system, so there is no `tsc`-shaped "read it whole and disagreed
//! about a type" here. What Opal does refuse, it refuses as `Opal::SyntaxError`, and that covers two
//! shapes rather than one: **the parser could not read it** (`y = 2 +* 3`), and **valid Ruby this
//! compiler has no lowering for** (`BEGIN { … }` — "Unsupported sexp: preexe"). Both are the model's
//! to fix and both arrive as [`PrepareError::Syntax`], because the model's answer to each is the
//! same: write different Ruby.
//!
//! The driver in the committed bundle says which of three things happened in its **exit code**
//! rather than leaving gg to guess it from a non-zero status — which cannot be guessed, since a
//! compiler that rejected a program and a compiler that could not start both exit non-zero:
//!
//! | Exit | What happened | How it is reported |
//! | --- | --- | --- |
//! | 0 | compiled | the JavaScript, from the workspace |
//! | 20 | Opal refused the Ruby | [`PrepareError::Syntax`] — the model's, with Opal's own message and, where the parser located it, the model's own line |
//! | 21 | Opal raised something that is **not** a refusal of the Ruby | [`PrepareError::Compile`] — a compiler-internal failure surfacing as a Ruby exception. Rare, and still model-facing: it is reached by compiling a particular program, and the next program may well compile |
//! | anything else | the compiler could not finish | [`PrepareFailure::Toolchain`] — **not** the model's, and never shown to it as its own |

use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::time::Duration;

use serde::Deserialize;

use crate::sandbox::language::compile::{CompilerReport, NODE_ENV, place, shared_toolchain_dir};
use crate::sandbox::language::{PrepareContext, PrepareError, PrepareFailure, PreparedProgram};

/// Opal — the runtime and its self-hosted compiler as one CommonJS bundle, with gg's driver at the
/// end of it — at the release `packages/gg-sandbox-ruby/opal-version.sh` pins.
///
/// Committed and embedded for the reason the guest components are: gg is copied as a single file
/// into an ephemeral run container and must carry everything it needs with it.
const OPAL_CJS: &str = include_str!("../checkers/ruby.opal.cjs");

/// What the committed compiler is, so gg can say which Opal compiled a program.
const MANIFEST_JSON: &str = include_str!("../checkers/ruby.compiler.json");

/// How long one compile may take before it is killed and reported as a
/// [toolchain failure](PrepareFailure::Toolchain).
///
/// The same bound TypeScript's check takes, for the same reason: gg refuses no program for its
/// length and compiling scales with it, so a minute is far past any program a model has produced
/// while being unmistakably a hang rather than a slow compile.
const COMPILE_TIMEOUT: Duration = Duration::from_secs(60);

/// The file name a program is compiled under, and the one its diagnostics are located in.
pub(super) const PROGRAM_FILE: &str = "program.rb";

/// The file name a code module is compiled under.
pub(super) const MODULE_FILE: &str = "module.rb";

/// What the compiler writes, inside this preparation's own output directory.
const OUTPUT_FILE: &str = "program.js";

/// The exit code the driver uses for Ruby the parser rejected.
const EXIT_SYNTAX: i32 = 20;

/// The exit code the driver uses for a compilation Opal refused for any other reason.
const EXIT_REFUSED: i32 = 21;

/// What the committed compiler is: the Opal release it was cut from, and the Ruby that release
/// emulates.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompilerManifest {
    /// The pinned Opal version (`1.7.3`).
    opal: String,
    /// The `RUBY_VERSION` that Opal reports (`3.2.0`) — the language level a program is written in,
    /// which is not the same fact as which compiler read it and is the one a model needs.
    ///
    /// Read only by [`ruby_version`], which is a gate rather than a runtime need and says why.
    #[cfg_attr(
        not(test),
        allow(dead_code, reason = "read by the prompt's own drift gate")
    )]
    ruby_version: String,
}

/// The parsed manifest, read once per process.
fn manifest() -> &'static CompilerManifest {
    static MANIFEST: std::sync::OnceLock<CompilerManifest> = std::sync::OnceLock::new();
    MANIFEST.get_or_init(|| {
        serde_json::from_str(MANIFEST_JSON)
            .expect("the committed compiler manifest is valid JSON of the expected shape")
    })
}

/// The Opal release a program is compiled with, for the run's own record and for an operator reading
/// a diagnostic and wondering whose it is.
pub(super) fn compiler_version() -> &'static str {
    &manifest().opal
}

/// The Ruby version this arm's programs are written in, as Opal reports it.
///
/// `#[cfg(test)]` because it is a **gate** rather than a runtime need, in the same sense
/// [`MODEL_FACING_CALLS`](super::super::MODEL_FACING_CALLS) is: the language level a program is
/// written in is a sentence in [this arm's system prompt](super::PROMPT), which is prose and cannot
/// be generated from a manifest — so what this exists for is the test that holds that sentence to
/// what the committed compiler actually reports. Nothing at run time asks; a compile reports which
/// *compiler* read the program, which is [`compiler_version`] and a different fact.
#[cfg(test)]
pub(super) fn ruby_version() -> &'static str {
    &manifest().ruby_version
}

/// Materialise the compiler now, so the first compile does not.
///
/// The whole of [`ProgramLanguage::warm_prepare`](super::super::ProgramLanguage::warm_prepare) for
/// this language. The result is dropped: a failure here is the same failure the first compile will
/// make, and there it is classified, counted and reported.
pub(super) fn warm() {
    let _ = compiler();
}

/// Compile a **program** — a model's reply — into the JavaScript the guest evaluates.
///
/// [`unreachable`](PreparedProgram::unreachable) is `None`, and that is an absence rather than a
/// zero. The measurement counts top-level statements written after one that **ends the program**,
/// which in the ECMAScript arms is a top-level `return` — the program is evaluated as a function
/// body there. A Ruby program's top level has no statement that ends it early: a bare `return` at
/// the top level is a `LocalJumpError` rather than an exit, and every other way out is an exception.
/// So the shape this field records does not exist on this arm rather than going unmeasured, exactly
/// as it does not exist on [Python](super::super::python)'s.
pub(super) fn compile_program(
    source: &str,
    context: &PrepareContext,
) -> Result<PreparedProgram, PrepareFailure> {
    Ok(PreparedProgram {
        source: compile(PROGRAM_FILE, source, context)?,
        unreachable: None,
    })
}

/// The call a code module's body is wrapped in, so that evaluating it produces a **namespace**.
///
/// A Ruby file has no exports: its top level defines methods on `Object`, which is exactly what
/// `require` gives a Ruby program and exactly not what `lib.<key>` needs. So the author's source is
/// evaluated as a block against a fresh anonymous `Module`, which extends itself — the guest's
/// `GG::Lib` — and what the body defined is what the namespace offers. There is no export protocol
/// for a skill's author to remember.
///
/// It takes no key because this step has not been told one: a module's binding key is assigned when
/// the agent reads the skill or the memory, which is after its code was compiled. The guest names
/// the namespace immediately after evaluating it.
const MODULE_PROLOGUE: &str = "GG::Lib.define do\n";

/// What closes [`MODULE_PROLOGUE`]. On its own line, so a module whose last line has no newline is
/// still closed.
const MODULE_EPILOGUE: &str = "\nend\n";

/// How many lines [`MODULE_PROLOGUE`] puts in front of the author's own first line, and therefore
/// what a diagnostic's line number has to be moved back by.
const MODULE_LINE_OFFSET: usize = 1;

/// Compile a **code module** — the code half of a [skill](crate::skills) or a
/// [memory](crate::memories) — into JavaScript whose evaluation leaves a namespace behind.
///
/// The wrapping is what a diagnostic has to be corrected for: Opal reports the line it read the
/// error on, which is one further down than the line the author wrote. A skill's author reading
/// "line 4" over their line 3 would go looking in the wrong place, so the number is moved back
/// here — the one thing about this compile that is not [`compile`]'s.
pub(super) fn compile_module(
    source: &str,
    context: &PrepareContext,
) -> Result<String, PrepareFailure> {
    let wrapped = format!("{MODULE_PROLOGUE}{source}{MODULE_EPILOGUE}");
    compile(MODULE_FILE, &wrapped, context).map_err(shift_module_diagnostic)
}

/// Move a module diagnostic's line number back over [`MODULE_PROLOGUE`].
///
/// Only the number is touched. The offending text the driver quotes under it is read out of the
/// wrapped source at that line, which *is* the author's own line, so it is already right.
fn shift_module_diagnostic(failure: PrepareFailure) -> PrepareFailure {
    let shift = |text: String| {
        let prefix = format!("{MODULE_FILE}:");
        let Some(rest) = text.strip_prefix(&prefix) else {
            return text;
        };
        let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
        match digits.parse::<usize>() {
            Ok(line) if line > MODULE_LINE_OFFSET => format!(
                "{prefix}{}{}",
                line - MODULE_LINE_OFFSET,
                &rest[digits.len()..]
            ),
            _ => text,
        }
    };
    match failure {
        PrepareFailure::Program(PrepareError::Syntax(text)) => {
            PrepareFailure::Program(PrepareError::Syntax(shift(text)))
        }
        PrepareFailure::Program(PrepareError::Compile(text)) => {
            PrepareFailure::Program(PrepareError::Compile(shift(text)))
        }
        other => other,
    }
}

/// Compile one Ruby source, filed as `file`, and hand back the JavaScript.
///
/// The one entry point: a program and a code module differ in the name their diagnostics are located
/// in and in what is done with the result, never in how they are compiled.
pub(super) fn compile(
    file: &str,
    source: &str,
    context: &PrepareContext,
) -> Result<String, PrepareFailure> {
    let compiler = compiler().map_err(PrepareFailure::Toolchain)?;
    let workspace = context.workspace().map_err(PrepareFailure::Toolchain)?;

    let input = workspace
        .write(file, source)
        .map_err(PrepareFailure::Toolchain)?;
    let output = workspace.output().join(OUTPUT_FILE);

    let report = invoke(compiler, &input, &output, context).map_err(PrepareFailure::Toolchain)?;
    classify(report)?;

    std::fs::read_to_string(&output).map_err(|error| {
        PrepareFailure::Toolchain(format!(
            "opal {} reported success but wrote no JavaScript to {}: {error}",
            compiler_version(),
            output.display(),
        ))
    })
}

/// Turn a finished invocation into a verdict.
///
/// The exit code is the whole of the decision, because the driver in the committed bundle exists to
/// make it one: a status gg had to interpret is a status gg would eventually interpret wrongly, and
/// reporting a broken compiler as a broken program is the misattribution this whole split is for.
fn classify(report: CompilerReport) -> Result<(), PrepareFailure> {
    if report.ok {
        return Ok(());
    }
    let diagnostic = report.stdout.trim();
    let code = report.code;
    if (code == Some(EXIT_SYNTAX) || code == Some(EXIT_REFUSED)) && !diagnostic.is_empty() {
        let diagnostic = diagnostic.to_string();
        return Err(PrepareFailure::Program(match code {
            Some(EXIT_SYNTAX) => PrepareError::Syntax(diagnostic),
            _ => PrepareError::Compile(diagnostic),
        }));
    }
    Err(PrepareFailure::Toolchain(format!(
        "opal {} {} without reporting a diagnostic{}",
        compiler_version(),
        report.status,
        report.stderr_tail(),
    )))
}

/// Spawn Opal over the source in this preparation's own workspace and wait for it, killing it at
/// [`COMPILE_TIMEOUT`].
///
/// The spawn goes through [`PrepareContext::compiler`], which is the only way a language in this
/// repository is allowed to start a compiler: it is what puts the working directory, `HOME`,
/// `TMPDIR` and the `XDG_*` roots inside this preparation's own tree. The timeout, the kill and the
/// reap live there too, so this function is the arguments and nothing else.
fn invoke(
    compiler: &Compiler,
    input: &std::path::Path,
    output: &std::path::Path,
    context: &PrepareContext,
) -> Result<CompilerReport, String> {
    let node = std::env::var(NODE_ENV).unwrap_or_else(|_| "node".to_string());
    context
        .compiler(&node)
        .map_err(|error| format!("{}{}", spawn_prefix(&node), error))?
        .arg(&compiler.opal_cjs)
        .arg(input)
        .arg(output)
        // Opal is 2.9 MB of JavaScript and every compile parses it again. Node's on-disk compile
        // cache keeps the compiled bytecode beside the bundle and re-uses it from the second compile
        // onward. It is the one thing here pointed deliberately *outside* the private tree, and it
        // is safe for the reason the seam requires such a thing to be safe: it is content-addressed
        // and validated on read, so a torn or stale entry is discarded and re-earned rather than
        // believed, and nothing in it can change what Opal emits. A Node too old to know the
        // variable ignores it, and a directory it cannot write to turns it off rather than failing a
        // compile.
        .env("NODE_COMPILE_CACHE", &compiler.node_cache)
        .run(COMPILE_TIMEOUT)
        .map_err(|error| match error.starts_with("could not run") {
            true => format!("{}{error}", spawn_prefix(&node)),
            false => error,
        })
}

/// What a failure to start the compiler is prefixed with, because it is the one failure here an
/// operator can actually fix: `node` is not where gg looked for it.
fn spawn_prefix(node: &str) -> String {
    format!(
        "gg compiles every Ruby program with Opal and needs Node on PATH or {NODE_ENV} pointing at \
         it (`{node}`): "
    )
}

/// The materialised compiler: where its read-only input ended up on this machine.
struct Compiler {
    /// The Opal bundle `node` is pointed at.
    opal_cjs: PathBuf,
    /// Where Node keeps the bundle's compiled bytecode between compiles.
    node_cache: PathBuf,
}

/// The materialised compiler for this process, materialising it on first use.
///
/// Materialisation is ~2.9 MB of writes and happens once. A run normally pays it before its first
/// turn, off the critical path, because [`warm`] is called from
/// [`precompile`](crate::sandbox::precompile) beside the component compile; a run whose warm-up lost
/// the race pays it inside the first compile, where it lands in that turn's
/// [compile measurement](crate::sandbox::SandboxOutcome::compile) rather than hidden beside it.
fn compiler() -> Result<&'static Compiler, String> {
    static COMPILER: std::sync::OnceLock<Result<Compiler, String>> = std::sync::OnceLock::new();
    COMPILER
        .get_or_init(materialise)
        .as_ref()
        .map_err(Clone::clone)
}

/// Write the compiler's read-only input into a
/// [shared toolchain directory](crate::sandbox::shared_toolchain_dir).
///
/// The seam's one sanctioned share, taken under the seam's discipline: the key folds in the pinned
/// Opal version **and** a digest of the bundle itself, so a gg carrying a different bundle at the
/// same version reads a different directory rather than another build's file; the write goes through
/// [`place`], which stages under a process-unique name and renames, so a second gg process
/// materialising the same release concurrently can only replace a complete file with an identical
/// complete file. Nothing here is written again afterwards.
fn materialise() -> Result<Compiler, String> {
    let root = shared_toolchain_dir(&format!(
        "ruby-opal-{}-{:016x}",
        compiler_version(),
        fingerprint(),
    ))?;
    let compiler = Compiler {
        opal_cjs: root.join("opal.cjs"),
        node_cache: root.join("node-cache"),
    };
    place(&compiler.opal_cjs, OPAL_CJS)?;
    Ok(compiler)
}

/// A stable digest of the committed bundle, so a change to it changes the directory it is written
/// into. Not cryptographic and not required to be: it distinguishes builds, it does not defend
/// against one.
fn fingerprint() -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    OPAL_CJS.hash(&mut hasher);
    hasher.finish()
}

#[cfg(test)]
#[path = "ruby.compile.test.rs"]
mod tests;
