//! **The PureScript compile** — how a model's PureScript becomes something the
//! [guest](super) can evaluate.
//!
//! # The strategy, in one sentence
//!
//! A PureScript program is **compiled to JavaScript on the host** — by `purs`, against a library
//! set that was compiled once and is shipped inside gg's binary, then flattened into one script by
//! `esbuild` — and evaluated by the same ECMAScript guest the [TypeScript](super::super::typescript)
//! and [JavaScript](super::super::javascript) arms use.
//!
//! Nothing about it is per-run: the tree a program is compiled against is a build-time artifact,
//! the compiler is a binary in the run image, and what crosses the membrane is JavaScript.
//!
//! # Why the compiler is not carried, and the library set is
//!
//! The two halves of this toolchain are shipped in opposite ways, and each is shipped the only way
//! it can be.
//!
//! `purs` is a ~100 MB statically linked Haskell executable with a separate build per platform. It
//! cannot ride inside gg's binary the way the [Ruby arm](super::super::ruby)'s 2.9 MB self-hosted
//! Opal does, so it is installed into the gg toolchain image (`containers/gg-toolchains/Dockerfile`)
//! — which is what that image exists for, and what its header names `purs` as the example of. So is
//! `esbuild`, for the same reason: a 10 MB Go binary, one build per platform.
//!
//! The **library set** goes the other way. `purs` cannot type-check a program without both the
//! sources and the compiled externs of everything it imports (measured: with externs alone every
//! import is `ModuleNotFound`), and compiling the set from scratch costs ~16 s — so it is compiled
//! once by `packages/gg-sandbox-purescript/build.sh` and committed as a 1.3 MB tarball that gg
//! embeds. This arm's **SDK** is compiled into that same tree, which is what makes the surface a
//! model is shown in its prompt and the surface its program is compiled against one artifact. It could have gone in the image beside `purs` and it deliberately does not: gg is copied
//! as a single file into an ephemeral run container whose image was built separately, so a tree that
//! lived in the image could be a different vintage from the binary reading it. Once this arm's SDK
//! is compiled into that tree, that would mean a model being shown one surface in its prompt and
//! compiled against another.
//!
//! # What a PureScript program costs to compile
//!
//! Measured in this repository's dev container, aarch64, against the committed tree (329 modules,
//! 50 packages plus this arm's own SDK), median of nine:
//!
//! | | |
//! | --- | --- |
//! | Hard-linking the tree into this preparation's workspace (1,119 files) | ~19 ms |
//! | `purs compile` — dominated by loading 9 MB of externs, not by the program | ~200 ms |
//! | `esbuild` — bundling and tree-shaking the module graph | ~65 ms |
//! | End to end | **~290 ms** |
//!
//! The feasibility study priced this arm at 0.45–0.65 s per turn with a `purs ide server` needed to
//! bring it to 151–713 ms. It is cheaper than that here, and the difference is the staging: a real
//! `cp -a` of the tree costs ~150 ms where a hard-linked one costs ~19 ms, and the study's figure
//! included the copy. So the **daemon is not taken**, and the reason is a measurement rather than a
//! preference — batch compilation already sits inside the range a warm `purs ide server` was
//! measured in, and [`CompilerPool`](crate::sandbox::CompilerPool) is here for the arm that needs
//! it. It would also cost something this does not: an IDE server reused across preparations carries
//! the previous compilation's state, so "what a preparation returns is a function of its input
//! alone" would become a property of that server's cache invalidation rather than of the filesystem.
//!
//! # Isolation
//!
//! This arm is one of the two the study measured **silent corruption** on: eight concurrent `purs`
//! compiles into one shared output tree produced a single `output/Main/index.js` holding two agents'
//! programs interleaved, three times out of three, with every process exiting zero. So the shape
//! here is the opposite one, in three layers:
//!
//! 1. **The shared tree is never written.** It is unpacked once per machine into a content-keyed
//!    [shared toolchain directory](crate::sandbox::shared_toolchain_dir) through
//!    [`place_tree`](crate::sandbox::place_tree), which renames a finished tree into place and seals
//!    every file and directory in it read-only.
//! 2. **Each preparation compiles in its own tree**, hard-linked from that one in ~19 ms. Hard links
//!    are what make a private tree affordable — and they are also what makes the sealing bite, since
//!    a link to a read-only inode is read-only too. The two files `purs` rewrites whatever else it
//!    does are the ones at the root of `output/`, and those are staged as real copies; the other
//!    1,050 stay linked and stay sealed. The seal is what found the second of the two — left linked,
//!    the compile failed with `Permission denied` naming `output/package.json` rather than writing
//!    through into every other agent's tree.
//! 3. **The spawn goes through [`PrepareContext::compiler`]**, so the working directory, `HOME`,
//!    `TMPDIR` and the `XDG_*` roots are inside that private tree — which is what covers whatever
//!    `purs` and `esbuild` write that this module never thought about.
//!
//! It is **verified by mutation** rather than only by passing. Pointed at one shared output tree —
//! the measured shape — the seam's own [isolation gate](super::super::isolation) failed this arm
//! three independent ways at sixteen-way: artifacts that did not carry their own marker, artifacts
//! that carried *another preparation's program*, and one preparation reading a `package.json` another
//! was halfway through writing. Reverted, it is green.
//!
//! # The two failures, and which is the model's
//!
//! `purs` is asked for `--json-errors`, so a rejection arrives as structured diagnostics with the
//! error's own code and its exact span rather than as prose to be scraped:
//!
//! | What happened | How it is reported |
//! | --- | --- |
//! | `ErrorParsingModule` / `ErrorParsingFFIModule` | [`PrepareError::Syntax`] — the parser could not read it |
//! | any other `purs` error code (`TypesDoNotUnify`, `UnknownName`, `NoInstanceFound`, …) | [`PrepareError::Compile`] — read whole and rejected, which is the band a typed arm exists to produce |
//! | `esbuild` reporting no matching export for `main` | [`PrepareError::Compile`] — the program compiled but declares no entry point |
//! | `purs` or `esbuild` could not run, was killed, or reported nothing | [`PrepareFailure::Toolchain`] — **not** the model's, and never shown to it as its own |
//!
//! Diagnostics are located in the model's **own** coordinates. A program is compiled as module
//! `Main` whatever the model called it, so that the entry point can be imported by a fixed path; the
//! rename is done in place and costs no lines, and the one case that does — a reply with no module
//! header at all, which gg supplies — moves every line number back by exactly one on the way out.

use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;

use crate::sandbox::language::compile::{CompilerReport, place_tree, shared_toolchain_dir};
use crate::sandbox::language::{PrepareContext, PrepareError, PrepareFailure, PreparedProgram};

/// The library set, compiled: every package's PureScript sources beside the externs and JavaScript
/// `purs` emitted for them — **and this arm's own SDK**, staged into the same tree and compiled with
/// them — as one gzipped tar built by `packages/gg-sandbox-purescript/build.sh`.
///
/// Embedded for the reason the guest components are: gg is copied as a single file into an ephemeral
/// run container and must carry everything it needs with it.
const LIBRARIES_TAR_GZ: &[u8] = include_bytes!("../checkers/purescript.libraries.tar.gz");

/// What that tree was built from and what is in it.
const MANIFEST_JSON: &str = include_str!("../checkers/purescript.compiler.json");

/// The environment variable an operator points at `purs` when it is not where gg looks.
pub(super) const PURS_ENV: &str = "TCAB_GG_PURS";

/// The environment variable an operator points at `esbuild` when it is not where gg looks.
pub(super) const ESBUILD_ENV: &str = "TCAB_GG_ESBUILD";

/// Where `containers/gg-toolchains` installs the executables a gg run image carries.
///
/// Looked at before `PATH` rather than instead of it: the gg run images put this directory on
/// `PATH` anyway, and a developer's machine has neither, so the order is "what an operator said,
/// then what the image guarantees, then what the shell would have found".
const TOOLCHAIN_BIN: &str = "/opt/gg/toolchains/bin";

/// How long one `purs` invocation may take before it is killed and reported as a
/// [toolchain failure](PrepareFailure::Toolchain).
///
/// Twice what the other arms allow their compilers, because this one reads 9 MB of externs before it
/// reads the program: two minutes is far past any program a model has produced while being
/// unmistakably a hang rather than a slow compile.
const COMPILE_TIMEOUT: Duration = Duration::from_secs(120);

/// How long one `esbuild` invocation may take. Bundling is tens of milliseconds; a minute is a hang.
const BUNDLE_TIMEOUT: Duration = Duration::from_secs(60);

/// The file a program is compiled under, and the one its diagnostics are located in.
pub(super) const PROGRAM_FILE: &str = "program.purs";

/// The file a code module is compiled under.
pub(super) const MODULE_FILE: &str = "module.purs";

/// The module name every program and every module is compiled as, whatever the model called it.
///
/// Fixed so that the bundler's entry point can name it: the entry imports
/// `./output/Main/index.js`, which is where `purs` puts the module of this name. A model that wrote
/// `module Solve where` gets its header rewritten rather than an error, because the name of a module
/// nothing else imports carries no meaning a program can depend on — and `Main` is what a PureScript
/// author would have called it anyway.
const MODULE_NAME: &str = "Main";

/// The entry module `esbuild` is pointed at.
const ENTRY_FILE: &str = "entry.js";

/// What the bundler writes, in this preparation's own output directory.
const BUNDLE_FILE: &str = "program.js";

/// The name a bundled **code module**'s namespace is bound to inside the bundle, and the value the
/// guest gets back when it evaluates it.
///
/// Deliberately not a name a skill's author could collide with: it is declared in the same function
/// body their module's code ends up in.
const MODULE_GLOBAL: &str = "__ggPureScriptModule";

/// The glob that names the library set's sources to `purs`.
///
/// One argument rather than 49, and `libs/*/src/**` rather than `libs/**`: the two find the same 309
/// modules, and the narrower one is measurably cheaper to walk.
const LIBRARY_GLOB: &str = "libs/*/src/**/*.purs";

/// The compiled half of the tree — and the only part of it `purs` writes into.
const OUTPUT_DIR: &str = "output";

/// The tree's two top-level directories: the library sources, and what `purs` compiled them to.
const TREE_DIRS: [&str; 2] = ["libs", OUTPUT_DIR];

/// What the committed library tree was built from, and what is in it.
#[derive(Debug, Deserialize)]
struct Manifest {
    /// The pinned `purs` release the tree was compiled by — and therefore the only one that can read
    /// it, since externs are a compiler-version-private format.
    purs: String,
    /// The pinned `esbuild` release the module graph is flattened by.
    esbuild: String,
    /// The registry package set the versions below were resolved against.
    ///
    /// Read by this arm's own gate rather than at run time: what a program is compiled against is the
    /// tree, and the set that produced it is provenance — held to the committed `spago.lock`, which
    /// is what the build resolved through.
    #[cfg_attr(
        not(test),
        allow(dead_code, reason = "read by the library set's own drift gate")
    )]
    registry: String,
    /// The directory under `libs/` holding **this arm's own SDK**, which is compiled into the tree
    /// exactly as a library is and is deliberately not a registry package.
    ///
    /// Recorded rather than assumed so that [`packages`](Self::packages) stays a list of what the
    /// registry resolved: the drift gate compares that list with the tree's directories, and an SDK
    /// filed among them would be a package no package set has ever heard of.
    #[cfg_attr(
        not(test),
        allow(dead_code, reason = "read by the library set's own drift gate")
    )]
    sdk: String,
    /// How many modules the tree carries.
    #[cfg_attr(
        not(test),
        allow(dead_code, reason = "read by the library set's own drift gate")
    )]
    modules: usize,
    /// Every package in the tree, transitive ones included, as it is named on disk.
    #[cfg_attr(
        not(test),
        allow(dead_code, reason = "read by the library set's own drift gate")
    )]
    packages: Vec<Package>,
}

/// One package in the shipped library set.
#[cfg_attr(
    not(test),
    allow(dead_code, reason = "read by the library set's own drift gate")
)]
#[derive(Debug, Deserialize)]
struct Package {
    /// Its registry name — `ordered-collections`.
    name: String,
    /// The version the pinned package set resolved it to.
    version: String,
}

impl Package {
    /// The directory this package's sources are staged under: `ordered-collections-3.2.0`.
    #[cfg_attr(
        not(test),
        allow(dead_code, reason = "read by the library set's own drift gate")
    )]
    fn directory(&self) -> String {
        format!("{}-{}", self.name, self.version)
    }
}

/// The parsed manifest, read once per process.
fn manifest() -> &'static Manifest {
    static MANIFEST: std::sync::OnceLock<Manifest> = std::sync::OnceLock::new();
    MANIFEST.get_or_init(|| {
        serde_json::from_str(MANIFEST_JSON)
            .expect("the committed compiler manifest is valid JSON of the expected shape")
    })
}

/// The `purs` release a program is compiled with, for the run's own record and for an operator
/// reading a diagnostic and wondering whose it is.
pub(super) fn compiler_version() -> &'static str {
    &manifest().purs
}

/// Unpack the library tree now, so the first compile does not.
///
/// The whole of this language's warm-up: ~1.3 MB decompressed into 1,119 files, once per machine.
/// The result is dropped, because a failure here is the failure the first compile will make, and
/// there it is classified, counted and reported.
pub(super) fn warm() {
    let _ = libraries();
}

/// Compile a **program** — a model's reply — into the JavaScript the guest evaluates.
///
/// [`unreachable`](PreparedProgram::unreachable) is `None`, and that is an absence rather than a
/// zero. The measurement counts top-level statements written after one that *ends the program*,
/// which in the ECMAScript arms is a top-level `return`. A PureScript module has no statements at its
/// top level at all — it has declarations, in any order, and the entry point is a value called
/// `main` — so the shape this field records does not exist on this arm rather than going unmeasured,
/// exactly as it does not on [Python](super::super::python)'s or [Ruby](super::super::ruby)'s.
pub(super) fn compile_program(
    source: &str,
    context: &PrepareContext,
) -> Result<PreparedProgram, PrepareFailure> {
    Ok(PreparedProgram {
        source: compile(PROGRAM_FILE, source, Entry::Program, context)?,
        unreachable: None,
    })
}

/// Compile a **code module** — the code half of a [skill](crate::skills) or a
/// [memory](crate::memories) — into JavaScript whose evaluation leaves a namespace behind.
///
/// The difference from a program is entirely in the entry module the bundler is pointed at: a
/// program's runs `main`, a module's re-exports everything the module exported and hands the
/// namespace back. There is no wrapper around the author's source and therefore nothing to correct a
/// diagnostic for — the author's module is compiled as itself.
pub(super) fn compile_module(
    source: &str,
    context: &PrepareContext,
) -> Result<String, PrepareFailure> {
    compile(MODULE_FILE, source, Entry::Module, context)
}

/// Which of the two things a compiled module is being turned into.
#[derive(Clone, Copy)]
enum Entry {
    /// A model's program: import `main` and run it.
    Program,
    /// A code module: re-export everything and hand the namespace back.
    Module,
}

impl Entry {
    /// The JavaScript entry module `esbuild` is pointed at.
    fn source(self) -> String {
        let module = format!("./output/{MODULE_NAME}/index.js");
        match self {
            // `main` is imported by name rather than through the namespace so that a program with no
            // entry point is refused by the bundler, with a diagnostic, instead of failing inside
            // the guest as an ordinary `TypeError` on `undefined`.
            Self::Program => format!("import {{ main }} from {module:?};\nmain();\n"),
            Self::Module => format!("export * from {module:?};\n"),
        }
    }

    /// The name the bundle binds its exports to, for the half that has any.
    fn global(self) -> Option<&'static str> {
        match self {
            Self::Program => None,
            Self::Module => Some(MODULE_GLOBAL),
        }
    }
}

/// Compile one PureScript source, filed as `file`, and hand back the JavaScript.
///
/// The one entry point: a program and a code module differ in the name their diagnostics are located
/// in and in what the bundler is asked to produce, never in how they are compiled.
fn compile(
    file: &str,
    source: &str,
    entry: Entry,
    context: &PrepareContext,
) -> Result<String, PrepareFailure> {
    let libraries = libraries().map_err(PrepareFailure::Toolchain)?;
    let workspace = context.workspace().map_err(PrepareFailure::Toolchain)?;

    let (retargeted, shift) = retarget(source);
    workspace
        .write(file, &retargeted)
        .map_err(PrepareFailure::Toolchain)?;
    workspace
        .write(ENTRY_FILE, &entry.source())
        .map_err(PrepareFailure::Toolchain)?;
    stage(workspace.work(), libraries).map_err(PrepareFailure::Toolchain)?;

    let report = invoke_purs(file, context).map_err(PrepareFailure::Toolchain)?;
    classify(&report, file, shift)?;

    let bundle = workspace.output().join(BUNDLE_FILE);
    let report =
        invoke_esbuild(&bundle, entry.global(), context).map_err(PrepareFailure::Toolchain)?;
    classify_bundle(&report)?;

    let bundled = std::fs::read_to_string(&bundle).map_err(|error| {
        PrepareFailure::Toolchain(format!(
            "esbuild {} reported success but wrote no JavaScript to {}: {error}",
            manifest().esbuild,
            bundle.display(),
        ))
    })?;
    Ok(match entry.global() {
        // The bundle assigns the module's namespace to a `var`; handing it back is what makes
        // evaluating this source produce the namespace, which is the protocol `lib.<key>` needs.
        Some(global) => format!("{bundled}\nreturn {global};\n"),
        None => bundled,
    })
}

// ---------------------------------------------------------------------------------------------
// The module header
// ---------------------------------------------------------------------------------------------

/// Rewrite the source's module header to [`MODULE_NAME`], and say how many lines that added.
///
/// Every program is compiled under one module name so that the bundler's entry point can import it
/// by a fixed path. A model that wrote a header gets its **name** replaced in place, which changes no
/// line and therefore no diagnostic coordinate; a reply with no header at all — which is what a model
/// that thought it was writing a script produces — gets one supplied, which costs exactly one line
/// and is the number returned here for the diagnostics to be moved back by.
///
/// Comments before the header are skipped rather than searched through, because `--` and `{- -}` may
/// legally precede it and a `module` inside one is not the header.
fn retarget(source: &str) -> (String, usize) {
    match module_name_span(source) {
        Some(span) => {
            let mut retargeted = String::with_capacity(source.len() + MODULE_NAME.len());
            retargeted.push_str(&source[..span.start]);
            retargeted.push_str(MODULE_NAME);
            retargeted.push_str(&source[span.end..]);
            (retargeted, 0)
        }
        None => (format!("module {MODULE_NAME} where\n{source}"), 1),
    }
}

/// The byte span of the module **name** in a source that opens with a module header, or `None` for
/// one that does not.
fn module_name_span(source: &str) -> Option<std::ops::Range<usize>> {
    let bytes = source.as_bytes();
    let mut at = skip_trivia(source, 0);

    // The header keyword, which must be followed by something that is not part of an identifier —
    // `modulename` is a name, not a header.
    at = source[at..]
        .strip_prefix("module")
        .filter(|rest| rest.starts_with(|character: char| character.is_whitespace()))
        .map(|rest| source.len() - rest.len())?;

    let start = skip_trivia(source, at);
    let mut end = start;
    while end < bytes.len() && is_module_name_byte(bytes[end]) {
        end += 1;
    }
    (end > start).then_some(start..end)
}

/// Whether a byte may appear in a qualified module name (`Data.Map.Internal`).
fn is_module_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'_' || byte == b'\''
}

/// Advance past whitespace and comments, starting at `from`.
fn skip_trivia(source: &str, from: usize) -> usize {
    let mut at = from;
    loop {
        let rest = &source[at..];
        let trimmed = rest.trim_start();
        at = source.len() - trimmed.len();
        if trimmed.starts_with("--") {
            at += trimmed.find('\n').map_or(trimmed.len(), |end| end + 1);
            continue;
        }
        if trimmed.starts_with("{-") {
            // PureScript's block comments nest, so the first `-}` does not necessarily close the
            // first `{-`.
            let bytes = source.as_bytes();
            let mut depth = 0usize;
            let mut scan = at;
            while scan < bytes.len() {
                if source[scan..].starts_with("{-") {
                    depth += 1;
                    scan += 2;
                } else if source[scan..].starts_with("-}") {
                    // Saturating because this runs over a model's untrusted text on the turn path:
                    // the scan starts at a `{-`, so a close cannot outrun an open here, but an
                    // arithmetic panic in a prepare step would be a run ended over a comment.
                    depth = depth.saturating_sub(1);
                    scan += 2;
                    if depth == 0 {
                        break;
                    }
                } else {
                    scan += 1;
                }
            }
            at = scan;
            continue;
        }
        return at;
    }
}

// ---------------------------------------------------------------------------------------------
// The two invocations
// ---------------------------------------------------------------------------------------------

/// Spawn `purs` over the source in this preparation's own workspace and wait for it, killing it at
/// [`COMPILE_TIMEOUT`].
fn invoke_purs(file: &str, context: &PrepareContext) -> Result<CompilerReport, String> {
    let purs = tool(PURS_ENV, "purs");
    context
        .compiler(&purs)
        .map_err(|error| format!("{}{error}", spawn_prefix(&purs, PURS_ENV)))?
        .arg("compile")
        // Structured diagnostics on stdout: an error's own code and its exact span, rather than
        // prose gg would have to scrape a location out of.
        .arg("--json-errors")
        // Relative to the working directory, which is this preparation's own — so this is the
        // hard-linked tree and nothing else can see it.
        .arg("--output")
        .arg("output")
        .arg(file)
        .arg(LIBRARY_GLOB)
        .run(COMPILE_TIMEOUT)
        .map_err(|error| match error.starts_with("could not run") {
            true => format!("{}{error}", spawn_prefix(&purs, PURS_ENV)),
            false => error,
        })
}

/// Spawn `esbuild` over what `purs` emitted, writing the bundle to `bundle`.
fn invoke_esbuild(
    bundle: &Path,
    global: Option<&str>,
    context: &PrepareContext,
) -> Result<CompilerReport, String> {
    let esbuild = tool(ESBUILD_ENV, "esbuild");
    let mut command = context
        .compiler(&esbuild)
        .map_err(|error| format!("{}{error}", spawn_prefix(&esbuild, ESBUILD_ENV)))?;
    command
        .arg(ENTRY_FILE)
        .arg("--bundle")
        // The guest evaluates a program as the body of a function whose parameters are the API
        // objects, so the bundle has to be an expression-level thing that leaves no module syntax
        // behind and closes over the enclosing scope. That is what makes a capability withheld by
        // the host an undefined identifier inside compiled PureScript, exactly as it is inside
        // TypeScript.
        .arg("--format=iife")
        .arg(format!("--outfile={}", bundle.display()))
        // Warnings are the bundler's opinion about generated code and reach nobody; errors are read
        // from stderr either way.
        .arg("--log-level=warning");
    if let Some(global) = global {
        command.arg(format!("--global-name={global}"));
    }
    command
        .run(BUNDLE_TIMEOUT)
        .map_err(|error| match error.starts_with("could not run") {
            true => format!("{}{error}", spawn_prefix(&esbuild, ESBUILD_ENV)),
            false => error,
        })
}

/// Where gg looks for one of this arm's two executables: what an operator named, then what the gg
/// run image installs, then whatever `PATH` finds.
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

/// What a failure to start one of them is prefixed with, because it is the one failure here an
/// operator can actually fix: the toolchain is not where gg looked.
fn spawn_prefix(tool: &str, variable: &str) -> String {
    format!(
        "gg compiles every PureScript program with the toolchain in the gg run image and needs \
         `{tool}` on PATH, in {TOOLCHAIN_BIN}, or {variable} pointing at it: "
    )
}

// ---------------------------------------------------------------------------------------------
// The verdicts
// ---------------------------------------------------------------------------------------------

/// Everything `purs --json-errors` writes to stdout.
#[derive(Debug, Deserialize)]
struct Diagnostics {
    /// What it refused the compilation over. Empty on success.
    errors: Vec<Diagnostic>,
}

/// One `purs` diagnostic.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Diagnostic {
    /// The compiler's own stable name for what went wrong: `TypesDoNotUnify`, `UnknownName`.
    error_code: String,
    /// The prose, already wrapped and indented by the compiler.
    message: String,
    /// The file it was found in, absolutely — `None` for the few errors that belong to no file.
    filename: Option<String>,
    /// Where in that file, when there is a where.
    position: Option<Position>,
}

/// A diagnostic's span. Only its start is reported: a model reads a coordinate, not a rectangle.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Position {
    /// 1-based line.
    start_line: usize,
    /// 1-based column.
    start_column: usize,
}

/// The `purs` error codes that mean *the parser could not read this*, as opposed to *I read it and
/// disagreed*.
const PARSE_ERROR_CODES: [&str; 2] = ["ErrorParsingModule", "ErrorParsingFFIModule"];

/// Turn a finished `purs` invocation into a verdict.
fn classify(report: &CompilerReport, file: &str, shift: usize) -> Result<(), PrepareFailure> {
    if report.ok {
        return Ok(());
    }
    let diagnostics: Diagnostics = serde_json::from_str(report.stdout.trim()).map_err(|error| {
        PrepareFailure::Toolchain(format!(
            "purs {} {} and gg could not read its diagnostics ({error}){}",
            compiler_version(),
            report.status,
            report.stderr_tail(),
        ))
    })?;

    // An error in a file that is not the model's is an error in the shipped library tree, which is
    // gg's artifact rather than the model's program. Blaming a model for it would send it rewriting
    // something that was never wrong.
    let mine: Vec<&Diagnostic> = diagnostics
        .errors
        .iter()
        .filter(|diagnostic| diagnostic.is_from(file))
        .collect();
    if mine.is_empty() {
        return Err(PrepareFailure::Toolchain(format!(
            "purs {} {} without reporting a diagnostic in the program{}",
            compiler_version(),
            report.status,
            report.stderr_tail(),
        )));
    }

    let rendered = mine
        .iter()
        .map(|diagnostic| diagnostic.render(file, shift))
        .collect::<Vec<_>>()
        .join("\n\n");
    // A parse failure anywhere is the whole verdict: the compiler never got as far as meaning, so
    // whatever else it says is downstream of text it could not read.
    Err(PrepareFailure::Program(
        match mine
            .iter()
            .any(|diagnostic| PARSE_ERROR_CODES.contains(&diagnostic.error_code.as_str()))
        {
            true => PrepareError::Syntax(rendered),
            false => PrepareError::Compile(rendered),
        },
    ))
}

impl Diagnostic {
    /// Whether this diagnostic is about the file gg wrote the model's source into.
    ///
    /// `purs` reports an absolute path, and the workspace's is per preparation, so the comparison is
    /// on the file name — which is fixed, and is a name no library module has.
    fn is_from(&self, file: &str) -> bool {
        self.filename.as_deref().is_some_and(|filename| {
            Path::new(filename)
                .file_name()
                .is_some_and(|name| name == file)
        })
    }

    /// This diagnostic as the model reads it: `program.purs:7:19: TypesDoNotUnify`, then the
    /// compiler's own prose.
    ///
    /// The line is moved back over any header gg supplied, so the coordinate names the line of the
    /// reply the model actually wrote.
    fn render(&self, file: &str, shift: usize) -> String {
        let located = match &self.position {
            Some(position) => format!(
                "{file}:{}:{}: {}",
                position.start_line.saturating_sub(shift).max(1),
                position.start_column,
                self.error_code,
            ),
            None => format!("{file}: {}", self.error_code),
        };
        format!("{located}\n{}", self.message.trim_end())
    }
}

/// What `esbuild` says when the entry module asks for an export the program does not have — which
/// for this arm means one thing: no `main`.
const NO_ENTRY_POINT: &str = "No matching export";

/// Turn a finished `esbuild` invocation into a verdict.
///
/// Only one of its failures is the model's, and it is a real one: a program that compiled cleanly but
/// declares no `main` has nothing to run, and the model is told that in a sentence rather than being
/// shown a bundler's error about a JavaScript file it never wrote.
fn classify_bundle(report: &CompilerReport) -> Result<(), PrepareFailure> {
    if report.ok {
        return Ok(());
    }
    if report.stderr.contains(NO_ENTRY_POINT) {
        return Err(PrepareFailure::Program(PrepareError::Compile(format!(
            "your program has no entry point: it must define `main :: Effect Unit`, and export it if \
             the `module {MODULE_NAME} (…) where` header lists its exports"
        ))));
    }
    Err(PrepareFailure::Toolchain(format!(
        "esbuild {} {}{}",
        manifest().esbuild,
        report.status,
        report.stderr_tail(),
    )))
}

// ---------------------------------------------------------------------------------------------
// The library tree
// ---------------------------------------------------------------------------------------------

/// The unpacked library tree: where the shared, sealed, read-only copy ended up on this machine.
struct Libraries {
    /// The tree's root, holding `libs/` and `output/`.
    tree: PathBuf,
}

/// The unpacked library tree for this process, unpacking it on first use.
///
/// Unpacking is ~1.3 MB decompressed into 1,119 files and happens once per machine, not once per
/// process: a second gg process finds the tree already placed. A run normally pays it before its
/// first turn, off the critical path, because [`warm`] is called from
/// [`precompile`](crate::sandbox::precompile); a run whose warm-up lost the race pays it inside the
/// first compile, where it lands in that turn's
/// [compile measurement](crate::sandbox::SandboxOutcome::compile) rather than hidden beside it.
fn libraries() -> Result<&'static Libraries, String> {
    static LIBRARIES: std::sync::OnceLock<Result<Libraries, String>> = std::sync::OnceLock::new();
    LIBRARIES
        .get_or_init(materialise)
        .as_ref()
        .map_err(Clone::clone)
}

/// Unpack the committed tree into a [shared toolchain directory](shared_toolchain_dir).
///
/// The seam's one sanctioned share, taken under the seam's discipline: the key folds in the pinned
/// `purs` release **and** a digest of the tarball itself, so a gg carrying a different tree at the
/// same compiler version reads a different directory rather than another build's files; the write
/// goes through [`place_tree`], which fills a staging directory, seals it read-only and renames it in,
/// so a reader never sees a half-unpacked tree and nothing can write to a placed one.
fn materialise() -> Result<Libraries, String> {
    let root = shared_toolchain_dir(&format!(
        "purescript-{}-{:016x}",
        compiler_version(),
        fingerprint(),
    ))?;
    let tree = root.join("tree");
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
        .map_err(|error| format!("could not unpack the PureScript library set: {error}"))
}

/// A stable digest of the committed tarball, so a change to it changes the directory it is unpacked
/// into. Not cryptographic and not required to be: it distinguishes builds, it does not defend
/// against one.
fn fingerprint() -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    LIBRARIES_TAR_GZ.hash(&mut hasher);
    hasher.finish()
}

/// Give this preparation its own copy of the library tree, inside `work`.
///
/// Hard links rather than copies: 1,119 files land in ~19 ms instead of ~150 ms, and — because a hard
/// link shares the inode, and the shared tree's inodes are sealed read-only — a compiler that tried to
/// rewrite a library's artifact would be refused rather than corrupting every other agent's tree. The
/// directories are made fresh, so `purs` can create the one directory it needs (the program's own
/// module) inside them, and so the whole tree unlinks cleanly when the workspace is dropped.
///
/// The exception is the files at the **root** of `output/`, which `purs` rewrites on every compile
/// however little it recompiled: `cache-db.json` (what it believes is up to date) and `package.json`
/// (the `{"type": "module"}` that makes its emitted `.js` files ES modules). Those are staged as real,
/// writable copies. Every one of the tree's 1,050 other files stays linked and stays sealed — and the
/// seal is what found the second of the two: left linked, the compile failed with `Permission denied`
/// naming `output/package.json`, which is exactly the loud failure the seal exists to turn a silent
/// corruption into.
///
/// The root is copied wholesale rather than by name so that a `purs` release which writes a third
/// file there is a slower compile rather than a broken arm.
fn stage(work: &Path, libraries: &Libraries) -> Result<(), String> {
    for directory in TREE_DIRS {
        link_tree(&libraries.tree.join(directory), &work.join(directory))?;
    }
    unseal_root_files(&libraries.tree.join(OUTPUT_DIR), &work.join(OUTPUT_DIR))
}

/// Replace every hard link to a file directly inside `to` with a writable copy of `from`'s.
fn unseal_root_files(from: &Path, to: &Path) -> Result<(), String> {
    let entries = std::fs::read_dir(from)
        .map_err(|error| format!("could not read {}: {error}", from.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("could not read {}: {error}", from.display()))?;
        if !entry.file_type().is_ok_and(|kind| kind.is_file()) {
            continue;
        }
        let staged = to.join(entry.file_name());
        std::fs::remove_file(&staged)
            .map_err(|error| format!("could not unlink {}: {error}", staged.display()))?;
        std::fs::copy(entry.path(), &staged)
            .map_err(|error| format!("could not stage {}: {error}", staged.display()))?;
        // `copy` brings the source's mode with it, and the source is sealed — so without this the
        // files `purs` must write are the files it cannot.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o644))
                .map_err(|error| format!("could not stage {}: {error}", staged.display()))?;
        }
    }
    Ok(())
}

/// Recreate `from`'s directory structure under `to`, hard-linking every file.
fn link_tree(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to)
        .map_err(|error| format!("could not create {}: {error}", to.display()))?;
    let entries = std::fs::read_dir(from)
        .map_err(|error| format!("could not read {}: {error}", from.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("could not read {}: {error}", from.display()))?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => link_tree(&source, &target)?,
            Ok(_) => std::fs::hard_link(&source, &target).map_err(|error| {
                format!(
                    "could not link {} to {}: {error}",
                    source.display(),
                    target.display()
                )
            })?,
            Err(error) => return Err(format!("could not stat {}: {error}", source.display())),
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "purescript.compile.test.rs"]
mod tests;
