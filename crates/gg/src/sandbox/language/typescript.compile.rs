//! **The TypeScript arm's compiler** — TypeScript's whole answer to
//! [`prepare_program`](super::ProgramLanguage::prepare_program), and the reason this arm answers
//! [`prepare_compiles`](super::ProgramLanguage::prepare_compiles) `true`.
//!
//! One invocation of `tsc` does both halves of it. It reads the model's own file, against the SDK's
//! own declarations, and rejects a program whose types do not hold; and it emits the JavaScript the
//! guest evaluates, with the **source map** that reads a frame in that JavaScript back to the line
//! the model wrote. A program the compiler rejects never reaches the guest, and the model is handed
//! the compiler's diagnostics at the coordinates of the text it sent.
//!
//! # Why the model's bytes and the guest's bytes differ here, and what makes that legitimate
//!
//! Types must be erased, and `tsc` erases them by **re-printing** the program: a declaration the
//! model wrote on line 21 executes on line 11. This is the one arm where the text that executes is
//! not the text the model sent, and it is the same position every compiled arm is in — the
//! difference is only that this compiler's output is source rather than an object file.
//!
//! What the [invariants](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) require of
//! that position is two things, and both are properties of this module:
//!
//! * the bytes gg **compiles** are the bytes the model sent. `program.ts` is written into the
//!   preparation's workspace verbatim, and it is what `tsc` reads and what every diagnostic names;
//! * a location is recovered **through a source map** and by no other means. The emitted JavaScript
//!   carries `tsc`'s own map inline, with the model's own source inside it, and
//!   [`locate`](crate::sandbox::locate) reads a frame back through it. Nothing here computes a line
//!   number.
//!
//! # Why a subprocess, and why this one
//!
//! The compile runs **inside the run container**, on gg's own blocking thread, on every code turn.
//! Three candidates were measured against a representative program before this shape was chosen,
//! each driven the same way from a shell (this repository's dev container, aarch64, warm):
//!
//! | Checker | Per program | Ships as |
//! | --- | --- | --- |
//! | `node` + `_tsc.js`, `noLib`, one concatenated library | **87 ms** | 6.7 MB, one artifact, every platform |
//! | `tsgo` (`@typescript/native-preview`) | 93 ms | 26 MB **per platform**, a `7.0.0-dev` preview |
//! | `node` + `typescript.js` through `ts.createProgram` | 785 ms | as above, plus a host to write |
//!
//! So the fastest option is also the one that needs no per-platform binary and no preview compiler:
//! the reference implementation, pinned at one release, invoked exactly as npm's own `tsc` shim
//! invokes it. `node` is the one interpreter every run image already has — the shared base *is*
//! `node:24-bookworm-slim`, and the one image not built from it installs Node explicitly — so this
//! adds nothing to any image.
//!
//! End to end through [`prepare_program`](super::ProgramLanguage::prepare_program) — this module's
//! file writes, the spawn, the compile and the read-back — a representative program measures
//! **~91 ms** (median of 12, unoptimised build, same machine, with Node's compile cache warm). That
//! is the figure a run records. The **first** compile of a process pays ~450 ms instead,
//! materialising the compiler and filling that cache, and a run normally pays it before its first
//! turn (see [`warm`]).
//!
//! A **persistent compiler process** would save most of it and was rejected: it is a process gg
//! would have to own, health-check, cancel and reap, on a turn path where 91 ms is well under 1 % of
//! a turn and is now *measured* —
//! [`SandboxOutcome::compile`](crate::sandbox::SandboxOutcome::compile) carries it, so an arm that
//! pays for compiling is compared on what it paid.
//!
//! # What the program is compiled against
//!
//! Three declaration files, assembled once per process and reused by every compile:
//!
//! 1. `lib.gg.d.ts` — the ES2022 standard library, the 57 `lib.*.d.ts` files concatenated by this
//!    arm's build so one open replaces 57. The compile runs `noLib` and names it explicitly.
//! 2. `gg.d.ts` — the **whole** SDK surface, generated here from this language's
//!    [signature catalogue](crate::sandbox::signatures): one ambient module per specifier a program
//!    may import, in exactly the shape the guest's own loader resolves.
//! 3. `globals.d.ts` — `console`, `performance` and `crypto`: the names a program reaches that no
//!    SDK declaration covers, authored beside the guest that installs them (in
//!    `packages/gg-sandbox/tools/program-globals.d.ts`) and copied verbatim into the build's
//!    artifacts. The rule there is one rule — a name a program can **call** is declared and a name
//!    it cannot is not — which is why `setTimeout` and `fetch` are absent and the host's clock and
//!    entropy are present.
//!
//! None of the three is a committed file, and neither is the compiler that reads them. All four come
//! out of `packages/gg-sandbox/build.sh`, run by `crates/gg-sandbox-artifacts/typescript` as part of
//! building this crate, so the pinned `typescript` a program is judged by and the pinned
//! `typescript` its catalogue was emitted with are the same release by construction rather than by
//! a check somebody has to run.
//!
//! ## The surface is the whole one, not the agent's
//!
//! `gg.d.ts` declares every module and every function the catalogue carries, including the ones this
//! agent was not granted and the ending calls of roles it does not have. That is deliberate, and it
//! is the opposite of what the *prompt* does — a call an agent does not hold contributes no prompt
//! text at all.
//!
//! Two reasons, both load-bearing:
//!
//! * **A call the agent does not hold must stay writable.** Every arm's SDK is
//!   [static](crate::sandbox::membrane), so such a call compiles, reaches the host and is
//!   **refused** there — and that refusal is the record of "the model reached for something this
//!   agent was not granted", which is precisely what a reader comparing two configurations is
//!   looking for. If the compiler refused those programs instead, the same reach would be a
//!   `transpile_compile` failure in a checked language and a host refusal in an unchecked one, and
//!   two arms of a study would no longer be counting the same event.
//! * **A verdict must depend on the program alone.** The same text must compile the same way whether
//!   it arrives as a turn's program, as a skill's on-use script, or as the code half of a memory
//!   being written — none of which is prepared with an agent's grant in hand. It is why a code
//!   module is declared as the wildcard `lib:*` rather than as the modules this agent happens to
//!   have loaded.
//!
//! # Isolation
//!
//! Several agents run programs at once — up to `limits.maxParallel` of them, each able to chain
//! programs within a turn — and every one of them may be in this module simultaneously. So each
//! compile runs in **this preparation's own [workspace](crate::sandbox::Workspace)**, holding its
//! own `tsconfig.json`, its own `program.ts` and the `program.js` `tsc` wrote beside it, removed
//! when the preparation ends. No compile can see, or be seen by, another one's input or output — and
//! it is the seam that guarantees that rather than this module.
//!
//! Two things are shared, and both are shared under the
//! [one sanctioned discipline](crate::sandbox::shared_toolchain_dir). The **compiler inputs** — the
//! compiler, the standard library, the globals and the surface — are written once per version into a
//! content-keyed directory by a rename, so two processes racing to materialise them either both
//! win or one overwrites the other with identical bytes, and are read-only from then on. Node's
//! **compile cache** is one writable directory every concurrent compile points `NODE_COMPILE_CACHE`
//! at; it is safe to share because it is content-addressed and validated on read, so a torn or
//! stale entry is discarded and re-earned rather than believed. Sharing it is the point: it holds
//! the compiled bytecode of the 6.2 MB compiler, which is identical for every compile in the
//! process. Nothing in it can change a verdict — the worst outcome is a wasted parse.

use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use serde::Deserialize;

use crate::sandbox::language::compile::{CompilerReport, NODE_ENV, place, shared_toolchain_dir};
use crate::sandbox::language::{
    PrepareContext, PrepareError, PrepareFailure, PreparedModule, PreparedProgram, ProgramLanguage,
};
use crate::sandbox::signatures::{EntryKind, SignatureCatalogue};

/// The compiler behind the `tsc` CLI, at the release the repository-root `package.json` pins.
///
/// **Embedded** for the reason the guest component is: gg is copied as a single file into an
/// ephemeral run container and must carry everything it needs with it. **Cut by this build** rather
/// than committed beside this file, by `packages/gg-sandbox/build.sh` through
/// `tools/checker.mjs`, so that the compiler a program is judged by and the catalogue that program's
/// prompt was written from come out of one checkout on one build. A bumped `typescript` pin used to
/// be two edits with a gate between them; it is now one, and the gate has nothing left to catch.
const TSC_JS: &str = include_str!(concat!(
    env!("GG_ARTIFACTS_TYPESCRIPT"),
    "/typescript.tsc.js"
));

/// The ES2022 standard library, 57 declaration files concatenated so a compile opens one.
const LIB_DTS: &str = include_str!(concat!(
    env!("GG_ARTIFACTS_TYPESCRIPT"),
    "/typescript.lib.d.ts"
));

/// `console`, `performance` and `crypto` — the globals no SDK declaration covers.
const GLOBALS_DTS: &str = include_str!(concat!(
    env!("GG_ARTIFACTS_TYPESCRIPT"),
    "/typescript.globals.d.ts"
));

/// What the compiler beside it is, so gg can say which release judged a program.
const MANIFEST_JSON: &str = include_str!(concat!(
    env!("GG_ARTIFACTS_TYPESCRIPT"),
    "/typescript.checker.json"
));

/// How long a single compile may take before it is killed and reported as a
/// [toolchain failure](PrepareFailure::Toolchain).
///
/// Generous on purpose. gg refuses no program for its length, and compiling scales with it: a
/// representative program takes about a tenth of a second, a 100 KB one about a second, and an
/// 800 KB one several. A bound is still needed — a compiler that hangs would otherwise hold a
/// blocking thread for the rest of the run — and a minute is far past any program a model has
/// produced while being unmistakably a hang rather than a slow compile.
const CHECK_TIMEOUT: Duration = Duration::from_secs(60);

/// The file a **program** is compiled under, and the one its diagnostics are located in.
///
/// It carries the model's bytes and nothing else: no prologue, no wrapper, no appended line. That
/// is what makes `program.ts(21,3)` a coordinate in the reply the model sent.
const PROGRAM_SOURCE: &str = "program.ts";

/// What `tsc` emits beside it, and the name the guest declares that emission under.
///
/// The two names have to agree — a frame the engine reports says `program.js`, and
/// [`locate`](crate::sandbox::locate) finds this program's map by that name — so it is the guest's
/// own constant rather than a second spelling of it.
pub(super) const PROGRAM_EMITTED: &str = crate::sandbox::language::ecmascript::PROGRAM;

/// The file a **code module** is compiled under.
const MODULE_SOURCE: &str = "module.ts";

/// What `tsc` emits beside it.
const MODULE_EMITTED: &str = "module.js";

/// What the embedded compiler is: the TypeScript release it was cut from and the language level it
/// compiles at.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckerManifest {
    /// The pinned TypeScript version (`5.9.3`).
    typescript: String,
    /// The standard library a program is compiled against, and the language level it is compiled at
    /// (`ES2022`). Both, because the concatenated library *is* that level: reading one value for
    /// both is what stops a program from being compiled against a library its target does not match.
    lib: String,
}

/// The parsed manifest, read once per process.
fn manifest() -> &'static CheckerManifest {
    static MANIFEST: OnceLock<CheckerManifest> = OnceLock::new();
    MANIFEST.get_or_init(|| {
        serde_json::from_str(MANIFEST_JSON)
            .expect("the checker manifest this build wrote is valid JSON of the expected shape")
    })
}

/// The TypeScript release a program is compiled with, for the run's own record and for an operator
/// reading a diagnostic and wondering whose it is.
pub(super) fn checker_version() -> &'static str {
    &manifest().typescript
}

/// Materialise the compiler now, so the first compile does not.
///
/// The whole of [`ProgramLanguage::warm_prepare`] for this language. The result is dropped: a
/// failure here is the same failure the first compile will make, and there it is classified, counted
/// and reported.
pub(super) fn warm() {
    let _ = checker();
}

/// Compile a **program** — a model's reply — into the module the guest evaluates.
///
/// `Ok` carries `tsc`'s emitted JavaScript, with its own source map inline. A program the compiler
/// read and rejected is [`PrepareError::Compile`] carrying the compiler's own diagnostics; a
/// compiler that could not run at all is [`PrepareFailure::Toolchain`], which is not the model's
/// failure and is never shown to it as one.
pub(super) fn compile_program(
    source: &str,
    context: &PrepareContext,
) -> Result<PreparedProgram, PrepareFailure> {
    let emitted = compile(PROGRAM_SOURCE, PROGRAM_EMITTED, source, context)?;
    Ok(PreparedProgram {
        source: emitted,
        component: None,
    })
}

/// Compile a **code module** — the source of a code [skill](crate::skills) or
/// [memory](crate::memories), which a program reaches by importing `lib:<key>`.
///
/// It is an ordinary module of the language, compiled exactly as a program is and in its own
/// coordinates. What it offers is what it exports, read back off the emitted JavaScript by
/// [`ecmascript::exports`](crate::sandbox::language::ecmascript::exports).
pub(super) fn compile_module(
    source: &str,
    context: &PrepareContext,
) -> Result<PreparedModule, PrepareFailure> {
    let emitted = compile(MODULE_SOURCE, MODULE_EMITTED, source, context)?;
    Ok(PreparedModule {
        exports: crate::sandbox::language::ecmascript::exports(&emitted),
        source: emitted,
    })
}

/// Run one compile of `source`, filed as `file`, and hand back what `tsc` wrote to `emitted`.
fn compile(
    file: &str,
    emitted: &str,
    source: &str,
    context: &PrepareContext,
) -> Result<String, PrepareFailure> {
    let checker = checker().map_err(PrepareFailure::Toolchain)?;
    let workspace = context.workspace().map_err(PrepareFailure::Toolchain)?;

    workspace
        .write(file, source)
        .map_err(PrepareFailure::Toolchain)?;
    workspace
        .write("tsconfig.json", &tsconfig(checker, file))
        .map_err(PrepareFailure::Toolchain)?;

    let report = invoke(checker, context).map_err(PrepareFailure::Toolchain)?;
    classify(file, report)?;

    let path = workspace.work().join(emitted);
    std::fs::read_to_string(&path).map_err(|error| {
        PrepareFailure::Toolchain(format!(
            "tsc {} reported no diagnostic and wrote no {emitted} ({error})",
            checker_version(),
        ))
    })
}

/// How many diagnostics a model is shown.
///
/// Eight, the number [Kotlin measured](super::super::kotlin) and the
/// [shared bound](super::super::diagnostics) carries between arms. What eight costs here has three
/// answers, because a `tsc` diagnostic's size is a property of the *type* it is talking about rather
/// than of the mistake:
///
/// * the [cross-arm measurement](super::super::diagnostics) — one misremembered SDK name at fifty
///   call sites — is 3390 bytes across 50 lines, so 68 bytes on one line each, and eight is ~0.5 KB;
/// * the same mistake made against `files`, whose type `tsc` prints structurally into the message,
///   measures 21440 bytes across 50 lines on this checkout: 429 bytes each, still one line each, and
///   eight is ~3.4 KB;
/// * a structural mismatch, the shape that elaborates, measures 2942 bytes across 24 lines for
///   twelve of them — 245 bytes and two lines each — so eight is ~2 KB.
///
/// The middle row is the argument for the bound and also the limit of it: what this constant governs
/// is how many times a model is told the same thing, not how much `tsc` says each time. Fifty copies
/// of a printed object type is 21 KB the model reads to learn one misspelling; eight copies is the
/// same lesson, and no arithmetic on this number could have made one copy of it small.
///
/// # What it does not do, stated rather than hidden
///
/// It keeps the compiler's first eight, not the model's first eight. `tsc` reports in the order of
/// the project's `files`, which puts gg's own declarations before the program — so a verdict that
/// carried diagnostics in *both* could spend the whole bound on gg's and show the model none of its
/// own. There is no ordering preference here to stop that, and the reason is that the mix is very
/// nearly unreachable rather than that it would not matter: [`tsconfig`] sets `skipLibCheck`, so a
/// declaration file can only earn a diagnostic by failing to *parse*, and `tsc` withholds every
/// semantic diagnostic while a syntactic one stands — so a declaration file that fails to parse
/// produces *no* program-located diagnostic at all, and the verdict is the
/// [`Lowering`](PrepareFailure::Lowering) one below rather than a mixed
/// [`Compile`](PrepareError::Compile).
/// The mix this paragraph guards against is unreachable for that reason rather than merely unlikely.
/// An arm that met it anyway would want [C++'s answer](super::super::cpp) — exempt anything naming a
/// file the author wrote — rather than a larger number here.
const SHOWN: usize = 8;

/// Whether a line **begins** a diagnostic rather than continuing one.
///
/// `tsc` runs with [`--pretty false`](invoke), which writes a diagnostic as one unindented line and
/// then indents whatever elaborates it — `Type 'FileRead' is not assignable to type 'number'.`
/// followed by two spaces and the structural reason. That indentation is the compiler's own
/// statement of where one diagnostic ends, which is why this arm is bounded by group rather than by
/// line.
fn opens_a_diagnostic(line: &str) -> bool {
    !line.is_empty() && !line.starts_with(char::is_whitespace)
}

/// Turn a finished invocation into a verdict.
///
/// The exit status alone cannot decide: `tsc` exits non-zero both for "your program has errors" and
/// for "I could not run". What decides is whether it produced a diagnostic **about the file gg gave
/// it**:
///
/// * diagnostics in `file` — the model's program was read and rejected: [`PrepareError::Compile`].
/// * diagnostics only in gg's own declaration files — those are generated by gg from its own
///   catalogue and are never the model's doing, so this is [`PrepareFailure::Lowering`], the arm
///   that keeps "the model's text failed" and "gg's pipeline failed" from being read as one number,
///   and ends the run rather than charging gg's defect to the model.
/// * no diagnostics at all and a non-zero exit — the compiler did not get far enough to have an
///   opinion: [`PrepareFailure::Toolchain`].
fn classify(file: &str, report: CompilerReport) -> Result<(), PrepareFailure> {
    let diagnostics = report.stdout.trim();
    if report.ok && diagnostics.is_empty() {
        return Ok(());
    }
    if diagnostics.is_empty() {
        let stderr = report.stderr_tail();
        return Err(PrepareFailure::Toolchain(format!(
            "tsc {} without reporting a diagnostic ({}){stderr}",
            report.status,
            checker_version(),
        )));
    }
    // The band is decided here, on the WHOLE of what `tsc` said, and before anything is bounded:
    // "is any diagnostic located in the model's file" is a question about the compiler's output,
    // not about the part of it a model will read. Asking it after the cap would let a program whose
    // ninth diagnostic is the only one in its own file be reported as gg's pipeline failing.
    let located_in_program = diagnostics
        .lines()
        .any(|line| line.starts_with(&format!("{file}(")));
    if !located_in_program {
        // This is gg's own declarations being refused — a defect in gg rather than a mistake a model
        // can act on — so it goes back as `PrepareFailure::Lowering`, which no model ever sees: it
        // ends the run under `internal_error` instead of being handed to a model as a compiler error
        // about a program that was fine.
        //
        // The bound stays, for the one reader that is left. `skipLibCheck` means a declaration file
        // earns a diagnostic only by failing to *parse*, and `tsc` withholds every semantic
        // diagnostic while a syntactic one stands — so this branch is reached with the *whole* of a
        // broken generated surface and nothing of the program. Two hundred generated declarations
        // with one codegen defect apiece measured **29682 bytes across 600 lines** on this checkout,
        // and that is the size of the sentence a run's `error` stream and its fault diagnostic would
        // carry.
        return Err(PrepareFailure::Lowering(format!(
            "the generated declarations gg compiles a program against were rejected by tsc {}: {}",
            checker_version(),
            crate::sandbox::language::diagnostics::capped_lines(
                diagnostics,
                opens_a_diagnostic,
                SHOWN,
            ),
        )));
    }
    Err(PrepareFailure::Program(PrepareError::Compile(
        crate::sandbox::language::diagnostics::capped_lines(diagnostics, opens_a_diagnostic, SHOWN),
    )))
}

/// The project file one compile runs under.
///
/// `noLib` with the concatenated library named explicitly, `skipLibCheck` because gg's declarations
/// and the standard library are checked at build time rather than on a turn path, and `types: []`
/// so nothing an `@types` directory happens to contain can reach a program that could never import
/// it. `moduleDetection: force` makes the compiled file a module whatever it contains, which is what
/// the guest declares it as and what stops a program's own top-level names from colliding with the
/// standard library's.
///
/// Three options are what make the emitted JavaScript readable back into the model's own text.
/// `inlineSourceMap` puts `tsc`'s map in the emitted file, so it travels wherever the source does and
/// nothing beside it can be lost; `inlineSources` puts the model's own bytes in that map, which is
/// what lets the authorship gate check the map against the text it was
/// handed rather than take its word for it; and `noEmitOnError` means the file this module reads
/// back exists only for a program the compiler accepted.
fn tsconfig(checker: &Checker, file: &str) -> String {
    let lib = escape(&checker.lib_dts);
    let globals = escape(&checker.globals_dts);
    let surface = escape(&checker.surface_dts);
    let target = &manifest().lib;
    format!(
        r#"{{
  "compilerOptions": {{
    "strict": true,
    "target": "{target}",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "noLib": true,
    "types": [],
    "noEmitOnError": true,
    "inlineSourceMap": true,
    "inlineSources": true,
    "skipLibCheck": true
  }},
  "files": ["{lib}", "{globals}", "{surface}", "{file}"]
}}
"#
    )
}

/// A path as a JSON string body — the one escaping a generated `tsconfig.json` needs.
fn escape(path: &Path) -> String {
    let text = path.to_string_lossy();
    let quoted = serde_json::Value::String(text.into_owned()).to_string();
    quoted[1..quoted.len() - 1].to_string()
}

/// Spawn `tsc` over the project in this preparation's own workspace and wait for it, killing it at
/// [`CHECK_TIMEOUT`].
///
/// The spawn goes through [`PrepareContext::compiler`], which is the only way a language in this
/// repository is allowed to start a compiler: it is what puts the working directory, `HOME`,
/// `TMPDIR` and the `XDG_*` roots inside this preparation's own tree, so nothing `tsc` or `node`
/// decides to write "somewhere global" can reach another preparation. The timeout, the kill and the
/// reap live there too, so this function is now the arguments and nothing else.
fn invoke(checker: &Checker, context: &PrepareContext) -> Result<CompilerReport, String> {
    let node = std::env::var(NODE_ENV).unwrap_or_else(|_| "node".to_string());
    context
        .compiler(&node)
        .map_err(|error| format!("{}{}", spawn_prefix(&node), error))?
        .arg(&checker.tsc_js)
        .arg("--project")
        .arg("tsconfig.json")
        .arg("--pretty")
        .arg("false")
        // The compiler is 6.2 MB of JavaScript and every compile parses it again. Node's on-disk
        // compile cache keeps the compiled bytecode beside the checker, which it re-uses from the
        // second compile onward — measured at roughly a quarter of the time of parsing it cold. It
        // is the one thing here pointed deliberately *outside* the private tree, and it is safe for
        // the reason the seam requires such a thing to be safe: it is content-addressed and
        // validated on read, so a torn or stale entry is discarded and re-earned rather than
        // believed, and nothing in it can change a verdict. A Node too old to know the variable
        // ignores it, and a directory it cannot write to turns it off rather than failing a compile.
        .env("NODE_COMPILE_CACHE", &checker.node_cache)
        .run(CHECK_TIMEOUT)
        .map_err(|error| match error.starts_with("could not run") {
            true => format!("{}{error}", spawn_prefix(&node)),
            false => error,
        })
}

/// What a failure to start the compiler is prefixed with, because it is the one failure here an
/// operator can actually fix: `node` is not where gg looked for it.
fn spawn_prefix(node: &str) -> String {
    format!(
        "gg compiles every TypeScript program and needs Node on PATH or {NODE_ENV} pointing at \
         it (`{node}`): "
    )
}

/// The materialised compiler: where its four read-only inputs ended up on this machine.
struct Checker {
    /// The compiler bundle `node` is pointed at.
    tsc_js: PathBuf,
    /// The concatenated ES2022 standard library.
    lib_dts: PathBuf,
    /// `console`, `performance` and `crypto`.
    globals_dts: PathBuf,
    /// The SDK surface, generated from this language's catalogue.
    surface_dts: PathBuf,
    /// Where Node keeps the compiler's compiled bytecode between compiles.
    node_cache: PathBuf,
}

/// The materialised compiler for this process, materialising it on first use.
///
/// Materialisation is ~6.7 MB of writes and happens once. A run normally pays it before its first
/// turn, off the critical path, because [`warm`] is called from
/// [`precompile`](crate::sandbox::precompile) beside the component compile; a run whose warm-up lost
/// the race pays it inside the first compile, where it lands in that turn's
/// [compile measurement](crate::sandbox::SandboxOutcome::compile) rather than hidden beside it.
///
/// The directory is keyed by the compiler's version **and** by a hash of the declarations gg
/// generates, so a gg with a different SDK surface never reads another's files, and two processes
/// with the same ones share.
fn checker() -> Result<&'static Checker, String> {
    static CHECKER: OnceLock<Result<Checker, String>> = OnceLock::new();
    CHECKER
        .get_or_init(materialise)
        .as_ref()
        .map_err(Clone::clone)
}

/// Write the compiler's read-only inputs into a [shared toolchain
/// directory](crate::sandbox::shared_toolchain_dir).
///
/// This is the seam's one sanctioned share and it is taken under the seam's discipline: the key
/// folds in the pinned compiler version *and* a digest of the declarations gg generates, and every
/// file goes in through [`place`], which stages under a process-unique name and **renames**. Rename
/// is atomic within a directory, so a second gg process materialising the same version concurrently
/// can only ever replace a complete file with an identical complete file — a reader never sees a
/// half-written compiler. Nothing here is written again afterwards.
fn materialise() -> Result<Checker, String> {
    let surface = surface(super::TYPESCRIPT.catalogue());
    let root = shared_toolchain_dir(&format!(
        "typescript-checker-{}-{:016x}",
        manifest().typescript,
        fingerprint(&surface)
    ))?;

    let checker = Checker {
        tsc_js: root.join("tsc.js"),
        lib_dts: root.join("lib.gg.d.ts"),
        globals_dts: root.join("globals.d.ts"),
        surface_dts: root.join("gg.d.ts"),
        node_cache: root.join("node-cache"),
    };
    place(&checker.tsc_js, TSC_JS)?;
    place(&checker.lib_dts, LIB_DTS)?;
    place(&checker.globals_dts, GLOBALS_DTS)?;
    place(&checker.surface_dts, &surface)?;
    Ok(checker)
}

/// A stable digest of the generated surface, so a change to it changes the directory it is written
/// into. Not cryptographic and not required to be: it distinguishes builds, it does not defend
/// against one.
fn fingerprint(surface: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    surface.hash(&mut hasher);
    LIB_DTS.len().hash(&mut hasher);
    GLOBALS_DTS.hash(&mut hasher);
    hasher.finish()
}

/// **The whole SDK surface as a declaration file**: one ambient module per specifier a program may
/// import.
///
/// It is generated from the catalogue rather than written out, for the reason nothing about this SDK
/// is written out: the catalogue is reflected from the SDK's own declarations, so what a program is
/// *compiled* against is the same text a model is *shown*, with no second copy to drift. It carries
/// no documentation — the model never reads this file, and a comment would only be text for `tsc` to
/// skip.
///
/// # It is the guest's own module graph, one level up
///
/// `packages/gg-sandbox/guest/src/loader.rs` resolves three things for a program: `gg`, which
/// re-exports one namespace per family; `gg:<family>`, which is that family on its own; and
/// `lib:<name>`, which is a code module the agent loaded. Each is declared here in the same shape,
/// so a program the compiler accepts is a program whose every import the loader resolves.
///
/// `lib:*` is the **wildcard shorthand** form, which types every import from a `lib:` specifier as
/// `any`. That is the truth rather than a shortcut: a module's exports are whatever the code a model
/// or a skill author wrote happens to export, and gg has no declaration for any of them. It is also
/// what keeps a verdict a function of the program alone, since the modules an agent has loaded are
/// not known when a skill's own script is compiled at its read.
fn surface(catalogue: &SignatureCatalogue) -> String {
    let mut out = String::from(
        "// Generated by gg from this language's signature catalogue. Not for reading.\n",
    );
    for module in &catalogue.modules {
        out.push_str(&format!("declare module \"gg:{}\" {{\n", module.id));
        for import in borrowed(catalogue, &module.id) {
            out.push_str(&format!("  {import}\n"));
        }
        for declaration in catalogue
            .types
            .iter()
            .filter(|declaration| declaration.module == module.id)
        {
            out.push_str(&format!("  export {}\n", declaration.declaration));
        }
        for signature in members(catalogue, &module.id) {
            out.push_str(&format!("  export function {signature};\n"));
        }
        out.push_str("}\n");
    }
    out.push_str("declare module \"gg\" {\n");
    for module in &catalogue.modules {
        out.push_str(&format!(
            "  export * as {} from \"gg:{}\";\n",
            module.id, module.id
        ));
    }
    out.push_str(&format!(
        "  export {{ {ERROR_TYPE} }} from \"gg:{ERROR_MODULE}\";\n}}\n"
    ));
    out.push_str("declare module \"lib:*\";\n");
    out
}

/// The module the error type every failed call throws is declared in, and the type's own name.
///
/// The guest's aggregate module re-exports it bare beside the namespaces, because
/// `catch (error) { if (error instanceof ToolError) … }` is the shape the prompt teaches and a
/// qualified name in a `catch` reads as ceremony. This declaration has to match it or the compiler
/// would refuse the shape the prompt teaches.
const ERROR_MODULE: &str = "core";

/// See [`ERROR_MODULE`].
const ERROR_TYPE: &str = "ToolError";

/// The `import` lines the module `id`'s own declarations need — one per other module whose type it
/// names.
///
/// Read off the catalogue's own resolved references rather than by scanning the text: every function
/// carries the fully-qualified name of every type its signature spells, so the module a name belongs
/// to is a fact the catalogue states. A name this module declares itself is not imported, and a name
/// nothing it declares actually spells is not either.
fn borrowed(catalogue: &SignatureCatalogue, id: &str) -> Vec<String> {
    let declared: Vec<&str> = catalogue
        .types
        .iter()
        .filter(|declaration| declaration.module == id)
        .map(|declaration| declaration.name.as_str())
        .collect();
    let emitted = members(catalogue, id).join("\n");
    let mut wanted: Vec<(String, String)> = Vec::new();
    for reference in catalogue
        .functions
        .iter()
        .filter(|function| function.module == id)
        .flat_map(|function| function.returns.iter().chain(&function.types))
    {
        let Some((path, name)) = reference.fqn().rsplit_once('.') else {
            continue;
        };
        let owner = path.rsplit('.').next().unwrap_or(path);
        // A name this module declares itself needs no import, and neither does one no signature this
        // module emits actually spells: the catalogue records every type a function's documentation
        // mentions, which is wider than the set its declarations name.
        if owner == id || declared.contains(&name) || !emitted.contains(name) {
            continue;
        }
        let entry = (owner.to_string(), name.to_string());
        if !wanted.contains(&entry) {
            wanted.push(entry);
        }
    }
    wanted
        .into_iter()
        .map(|(owner, name)| format!("import {{ {name} }} from \"gg:{owner}\";"))
        .collect()
}

/// Every signature the module `id` binds, in catalogue order.
///
/// One entry may contribute several signatures — that is what an overload group is — so they are
/// emitted in order and TypeScript reads them as the overload set the language declared.
///
/// It is exactly the catalogue's own entries and nothing else, so what the compiler accepts on a
/// module is precisely what that module's declarations say, and it cannot admit a call the guest
/// does not bind.
///
/// # Why the module's *methods* are skipped
///
/// A [convenience helper](EntryKind::Method) — `handle.send(text)` for
/// `gg.delegation.sendMessage(handle.id, text)` — is catalogued under the module its receiver
/// belongs to, because that is where its documentation belongs. It is **not** a member of that
/// module: it is a member of the type, and the type's own declaration (emitted above, verbatim from
/// the catalogue) is what already carries it. Emitting it here as well would declare a free
/// `delegation.send(…)` that the guest binds nowhere — the compiler admitting a call the guest does
/// not have, which is the one direction this function must never fail in.
fn members(catalogue: &SignatureCatalogue, id: &str) -> Vec<String> {
    catalogue
        .functions
        .iter()
        .filter(|function| function.module == id && function.kind == EntryKind::Function)
        .flat_map(|function| function.signatures.iter())
        .map(|entry| entry.signature.clone())
        .collect()
}

#[cfg(test)]
#[path = "typescript.compile.test.rs"]
mod tests;
