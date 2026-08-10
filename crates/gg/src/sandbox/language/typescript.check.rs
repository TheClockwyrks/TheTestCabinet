//! **The type check** — TypeScript's answer to
//! [`prepare_compiles`](super::ProgramLanguage::prepare_compiles), and the reason this language
//! answers `true`.
//!
//! A model's reply is TypeScript, and until this module existed nothing checked it: the types were
//! erased by [`prepare`](super::prepare) and the JavaScript underneath was handed to the guest, so a
//! call that passed a string where the SDK declared a number ran anyway and failed — if it failed at
//! all — somewhere in the middle of a turn's work, as a `TypeError` with a stack frame instead of a
//! sentence naming the argument. Now `tsc` reads the whole program first, against the SDK's own
//! declarations, and a program that does not type-check never reaches the guest: the model is handed
//! the compiler's diagnostics, at the coordinates of the text it wrote, and writes another program.
//!
//! It is the one part of this arm that is **not** shared with
//! [gg's JavaScript arm](super::super::javascript) — [the type-strip](super::prepare) is — and it
//! is therefore the whole of what the two arms differ in.
//!
//! # Why a subprocess, and why this one
//!
//! The check runs **inside the run container**, on gg's own blocking thread, on every code turn.
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
//! End to end through [`prepare_program`](super::ProgramLanguage::prepare_program) — the strip, this
//! module's file writes, the spawn, and the check — a representative program measures **~91 ms**
//! (median of 12, unoptimised build, same machine, with Node's compile cache warm). That is the
//! figure a run records. The **first** check of a process pays ~450 ms instead, materialising the
//! checker and filling that cache, and a run normally pays it before its first turn (see
//! [`warm`]).
//!
//! A **persistent checker process** would save most of it and was rejected: it is a process gg would
//! have to own, health-check, cancel and reap, on a turn path where 91 ms is well under 1 % of a
//! turn and is now *measured* — [`SandboxOutcome::compile`](crate::sandbox::SandboxOutcome::compile)
//! carries it, so an arm that pays for checking is compared on what it paid.
//!
//! # What the program is checked against
//!
//! Three declaration files, assembled once per process and reused by every check:
//!
//! 1. `lib.gg.d.ts` — the ES2022 standard library, the 57 `lib.*.d.ts` files concatenated at build
//!    time so one open replaces 57. The check runs `noLib` and names it explicitly.
//! 2. `gg.d.ts` — the **whole** SDK surface, generated here from this language's committed
//!    [signature catalogue](crate::sandbox::signatures): one ambient namespace per capability
//!    module, carrying that module's types and functions, plus the bare aliases the shim also binds.
//!    Nothing is hand-written; the same reflected signatures a model reads in a documentation view
//!    are the ones it is checked against, so the two cannot disagree.
//! 3. `globals.d.ts` — `console`, `lib`, `performance` and `crypto`: the names a program reaches
//!    that no SDK declaration covers, authored beside the shim that installs or shadows them and
//!    committed verbatim. The rule there is one rule — a name a program can **call** is declared and
//!    a name it cannot is not — which is why `setTimeout` and `fetch` are absent and the host's clock
//!    and entropy are present.
//!
//! ## The surface is the whole one, not the run's
//!
//! `gg.d.ts` declares every module and every function the catalogue carries, including the ones this
//! run's toolset withholds and the ending calls of roles this agent does not have. That is
//! deliberate, and it is the opposite of what the *prompt* does — a withheld capability contributes
//! no prompt text at all.
//!
//! Two reasons, both load-bearing:
//!
//! * **A withheld name must stay reachable as a withheld name.** A tool this run does not offer is
//!   not in the program's scope, so calling it is a `ReferenceError` the turn records as
//!   `program_unknown_name` — "the model reached for something it was not given", which is the
//!   measurement [toolset ablation](crate::tools) exists to take. If the checker refused those
//!   programs instead, that measurement would be recorded as `transpile_compile` in a checked
//!   language and as `program_unknown_name` in an unchecked one, and the two arms of a study would
//!   no longer be counting the same event.
//! * **A verdict must depend on the program alone.** The same text must check the same way whether
//!   it arrives as a turn's program, as a skill's on-use script, or as the code half of a memory
//!   being written — none of which is prepared with a run's toolset in hand.
//!
//! # Coordinates
//!
//! The guest evaluates a program as the **body of a function** (`new Function(...names, source)`),
//! which is why a top-level `return` is legal in one. `tsc` has no such notion, so the source is
//! wrapped in a function declaration before it is checked — one line, added at the top, with the
//! program's own text unindented underneath. Every diagnostic therefore arrives one line low, and
//! exactly one line low, so the fix is exact: [`shift_lines`] rewrites `program.ts(12,8)` to
//! `program.ts(11,8)` and touches nothing else, including the indented continuation lines a
//! multi-part diagnostic carries. The model reads coordinates into the reply it wrote.
//!
//! # Isolation
//!
//! Several agents run programs at once — up to `limits.maxParallel` of them, each able to chain
//! programs within a turn — and every one of them may be in this module simultaneously. So each
//! check runs in **this preparation's own [workspace](crate::sandbox::Workspace)**, holding its own
//! `tsconfig.json` and its own `program.ts`, removed when the preparation ends. No check can see, or
//! be seen by, another one's input or output — and it is the seam that guarantees that rather than
//! this module, which is why this module no longer has a directory of its own to get wrong.
//!
//! Two things are shared, and both are shared under the
//! [one sanctioned discipline](crate::sandbox::shared_toolchain_dir). The **checker inputs** — the
//! compiler, the standard library, the globals and the surface — are written once per version into a
//! content-keyed directory by a rename, so two processes racing to materialise them either both
//! win or one overwrites the other with identical bytes, and are read-only from then on. Node's
//! **compile cache** is one writable directory every concurrent check points `NODE_COMPILE_CACHE`
//! at; it is safe to share because it is content-addressed and validated on read, so a torn or
//! stale entry is discarded and re-earned rather than believed. Sharing it is the point: it holds
//! the compiled bytecode of the 6.2 MB compiler, which is identical for every check in the process.
//! Nothing in it can change a verdict — the worst outcome is a wasted parse.

use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use serde::Deserialize;

use crate::sandbox::language::compile::{CompilerReport, NODE_ENV, place, shared_toolchain_dir};
use crate::sandbox::language::{PrepareContext, PrepareError, PrepareFailure, ProgramLanguage};
use crate::sandbox::operations::operation_by_id;
use crate::sandbox::signatures::SignatureCatalogue;

/// The compiler behind the `tsc` CLI, at the release
/// `packages/gg-sandbox/tools/checker.mjs` pins — committed and embedded for the reason the
/// component is: gg is copied as a single file into an ephemeral run container and must carry
/// everything it needs with it.
const TSC_JS: &str = include_str!("../checkers/typescript.tsc.js");

/// The ES2022 standard library, concatenated at build time.
const LIB_DTS: &str = include_str!("../checkers/typescript.lib.d.ts");

/// `console`, `lib`, `performance` and `crypto` — the globals no SDK declaration covers.
const GLOBALS_DTS: &str = include_str!("../checkers/typescript.globals.d.ts");

/// What the committed checker is, so gg can say which compiler judged a program.
const MANIFEST_JSON: &str = include_str!("../checkers/typescript.checker.json");

/// How long a single check may take before it is killed and reported as a
/// [toolchain failure](PrepareFailure::Toolchain).
///
/// Generous on purpose. gg refuses no program for its length, and checking scales with it: a
/// representative program takes about a tenth of a second, a 100 KB one about a second, and an
/// 800 KB one several. A bound is still needed — a compiler that hangs would otherwise hold a
/// blocking thread for the rest of the run — and a minute is far past any program a model has
/// produced while being unmistakably a hang rather than a slow check.
const CHECK_TIMEOUT: Duration = Duration::from_secs(60);

/// The file name a program is checked under, and the one its diagnostics are located in.
const PROGRAM_FILE: &str = "program.ts";

/// The file name a code module is checked under.
const MODULE_FILE: &str = "module.ts";

/// The wrapper that makes a program's top-level `return` legal, matching the guest's own
/// `new Function(...names, source)`. Exactly one line, so the shift is exactly one line.
const PROGRAM_PROLOGUE: &str = "function __ggProgram__() {\n";

/// What closes it.
const PROGRAM_EPILOGUE: &str = "\n}\n";

/// What the committed checker is: the TypeScript release it was cut from and the language level it
/// checks at.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckerManifest {
    /// The pinned TypeScript version (`5.9.3`).
    typescript: String,
    /// The standard library a program is checked against, and the language level it is checked at
    /// (`ES2022`). Both, because the concatenated library *is* that level: reading one value for
    /// both is what stops a program from being checked against a library its target does not match.
    lib: String,
}

/// The parsed manifest, read once per process.
fn manifest() -> &'static CheckerManifest {
    static MANIFEST: OnceLock<CheckerManifest> = OnceLock::new();
    MANIFEST.get_or_init(|| {
        serde_json::from_str(MANIFEST_JSON)
            .expect("the committed checker manifest is valid JSON of the expected shape")
    })
}

/// The TypeScript release a program is checked with, for the run's own record and for an operator
/// reading a diagnostic and wondering whose it is.
pub(super) fn checker_version() -> &'static str {
    &manifest().typescript
}

/// Materialise the checker now, so the first check does not.
///
/// The whole of [`ProgramLanguage::warm_prepare`] for this language. The result is dropped: a
/// failure here is the same failure the first check will make, and there it is classified, counted
/// and reported.
pub(super) fn warm() {
    let _ = checker();
}

/// Type-check a **program** — a model's reply, as the guest will evaluate it.
///
/// `Ok(())` means `tsc` found nothing. A program the compiler read and rejected is
/// [`PrepareError::Compile`] carrying the compiler's own diagnostics; a compiler that could not run
/// at all is [`PrepareFailure::Toolchain`], which is not the model's failure and is never shown to
/// it as one.
pub(super) fn check_program(source: &str, context: &PrepareContext) -> Result<(), PrepareFailure> {
    let wrapped = format!("{PROGRAM_PROLOGUE}{source}{PROGRAM_EPILOGUE}");
    check(PROGRAM_FILE, &wrapped, 1, context)
}

/// Type-check a **code module** — the source of a code [skill](crate::skills) or
/// [memory](crate::memories), which the guest evaluates to produce the namespace bound at
/// `lib.<key>`.
///
/// Checked as a module rather than as a function body, because that is what it is: it declares
/// `export`s, and its coordinates are its own with nothing added, so no shift is applied.
pub(super) fn check_module(source: &str, context: &PrepareContext) -> Result<(), PrepareFailure> {
    check(MODULE_FILE, source, 0, context)
}

/// Run one check of `source`, filed as `file`, and translate what `tsc` said.
///
/// `shift` is how many lines the checked text has that the model's text does not; every diagnostic
/// located in `file` is moved back by it.
fn check(
    file: &str,
    source: &str,
    shift: usize,
    context: &PrepareContext,
) -> Result<(), PrepareFailure> {
    let checker = checker().map_err(PrepareFailure::Toolchain)?;
    let workspace = context.workspace().map_err(PrepareFailure::Toolchain)?;

    workspace
        .write(file, source)
        .map_err(PrepareFailure::Toolchain)?;
    workspace
        .write("tsconfig.json", &tsconfig(checker, file))
        .map_err(PrepareFailure::Toolchain)?;

    let report = invoke(checker, context).map_err(PrepareFailure::Toolchain)?;
    classify(file, shift, report)
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
/// * the same mistake made against `fs`, whose type `tsc` prints structurally into the message,
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
/// [`Lowering`](PrepareError::Lowering) one below rather than a mixed [`Compile`](PrepareError::Compile).
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
///
/// It asks about indentation rather than about the `{file}(` prefix [`shift_line`] matches, and the
/// difference is real: the [`Compile`](PrepareError::Compile) band needs only *some* line located in
/// the program, so a verdict can carry a diagnostic in one of gg's declaration files beside the
/// model's own. Under a prefix test that line opens nothing, and is absorbed into the group above it
/// — sharing a fate it has nothing to do with, and going uncounted when that fate is being dropped.
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
///   catalogue and are never the model's doing, so this is [`PrepareError::Lowering`], the kind that
///   exists to keep "the model's text failed" and "gg's pipeline failed" from being read as one
///   number.
/// * no diagnostics at all and a non-zero exit — the compiler did not get far enough to have an
///   opinion: [`PrepareFailure::Toolchain`].
fn classify(file: &str, shift: usize, report: CompilerReport) -> Result<(), PrepareFailure> {
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
        // Bounded like the band below it, and the reason is that this string has two readers rather
        // than the one it reads as having. It is gg's own declarations being refused — a defect in
        // gg rather than a mistake a model can act on — so it is tempting to keep it whole as the
        // bug report an operator reads out of the run record. But `Lowering` is a
        // `PrepareFailure::Program`, which `SandboxError::Prepare` carries to
        // `CodeFeedback::compiler` and into the very next request: whatever is here, a **model**
        // reads it too, and reads it again on every turn after.
        //
        // That makes it the largest model-facing string this arm can produce, not the smallest.
        // `skipLibCheck` means a declaration file earns a diagnostic only by failing to *parse*, and
        // `tsc` withholds every semantic diagnostic while a syntactic one stands — so this branch is
        // reached with the *whole* of a broken generated surface and nothing of the program. Two
        // hundred generated declarations with one codegen defect apiece measured **29682 bytes
        // across 600 lines** on this checkout, which is two and a half times the worst row in the
        // [table](super::super::diagnostics) this bound was written against.
        //
        // What the operator loses is nothing they had a use for: generated declarations that do not
        // parse fail the same way six hundred times, and the first eight say which codegen wrote
        // them and what it got wrong. The count line keeps the total honest.
        return Err(PrepareFailure::Program(PrepareError::Lowering(format!(
            "the generated declarations gg checks a program against were rejected by tsc {}: {}",
            checker_version(),
            crate::sandbox::language::diagnostics::capped_lines(
                diagnostics,
                opens_a_diagnostic,
                SHOWN,
            ),
        ))));
    }
    // Renumbered first, bounded second, and that order is not interchangeable. `shift_lines`
    // rebuilds the text through `str::lines`, so anything it runs over it also normalises; the
    // bound's promise is that what it kept is byte-for-byte what it was handed, which only holds if
    // nothing edits the text after it. Putting the bound inside `shift_lines` instead would have
    // left the module path — which is checked with `shift == 0` and returns early — uncapped.
    Err(PrepareFailure::Program(PrepareError::Compile(
        crate::sandbox::language::diagnostics::capped_lines(
            &shift_lines(diagnostics, file, shift),
            opens_a_diagnostic,
            SHOWN,
        ),
    )))
}

/// Move every diagnostic located in `file` back by `shift` lines, leaving everything else — the
/// message, the column, and the indented continuation lines a multi-part diagnostic carries —
/// exactly as `tsc` wrote it.
///
/// The compiler's own text is what the model is meant to read; the only thing gg corrects is the one
/// number the wrapper made wrong.
fn shift_lines(diagnostics: &str, file: &str, shift: usize) -> String {
    if shift == 0 {
        return diagnostics.to_string();
    }
    let prefix = format!("{file}(");
    diagnostics
        .lines()
        .map(|line| shift_line(line, &prefix, shift).unwrap_or_else(|| line.to_string()))
        .collect::<Vec<_>>()
        .join("\n")
}

/// One `<file>(<line>,<column>): …` rendered at `line - shift`, or `None` when the line is not one.
fn shift_line(line: &str, prefix: &str, shift: usize) -> Option<String> {
    let rest = line.strip_prefix(prefix)?;
    let (number, rest) = rest.split_once(',')?;
    let number: usize = number.parse().ok()?;
    Some(format!(
        "{prefix}{},{rest}",
        number.saturating_sub(shift).max(1)
    ))
}

/// The project file one check runs under.
///
/// `noLib` with the concatenated library named explicitly, `skipLibCheck` because gg's declarations
/// and the standard library are checked at build time rather than on a turn path, and `types: []`
/// so nothing an `@types` directory happens to contain can reach a program that could never import
/// it. `moduleDetection: force` makes the checked file a module whatever it contains, which is what
/// stops a program's own top-level names from colliding with the standard library's.
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
    "moduleDetection": "force",
    "noLib": true,
    "types": [],
    "noEmit": true,
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
        // The compiler is 6.2 MB of JavaScript and every check parses it again. Node's on-disk
        // compile cache keeps the compiled bytecode beside the checker, which it re-uses from the
        // second check onward — measured at roughly a quarter of the time of parsing it cold. It is
        // the one thing here pointed deliberately *outside* the private tree, and it is safe for the
        // reason the seam requires such a thing to be safe: it is content-addressed and validated on
        // read, so a torn or stale entry is discarded and re-earned rather than believed, and
        // nothing in it can change a verdict. A Node too old to know the variable ignores it, and a
        // directory it cannot write to turns it off rather than failing a check.
        .env("NODE_COMPILE_CACHE", &checker.node_cache)
        .run(CHECK_TIMEOUT)
        .map_err(|error| match error.starts_with("could not run") {
            true => format!("{}{error}", spawn_prefix(&node)),
            false => error,
        })
}

/// What a failure to start the checker is prefixed with, because it is the one failure here an
/// operator can actually fix: `node` is not where gg looked for it.
fn spawn_prefix(node: &str) -> String {
    format!(
        "gg type-checks every TypeScript program and needs Node on PATH or {NODE_ENV} pointing at \
         it (`{node}`): "
    )
}

/// The materialised checker: where its four read-only inputs ended up on this machine.
struct Checker {
    /// The compiler bundle `node` is pointed at.
    tsc_js: PathBuf,
    /// The concatenated ES2022 standard library.
    lib_dts: PathBuf,
    /// `console`, `lib`, `performance` and `crypto`.
    globals_dts: PathBuf,
    /// The SDK surface, generated from this language's catalogue.
    surface_dts: PathBuf,
    /// Where Node keeps the compiler's compiled bytecode between checks.
    node_cache: PathBuf,
}

/// The materialised checker for this process, materialising it on first use.
///
/// Materialisation is ~6.7 MB of writes and happens once. A run normally pays it before its first
/// turn, off the critical path, because [`warm`] is called from
/// [`precompile`](crate::sandbox::precompile) beside the component compile; a run whose warm-up lost
/// the race pays it inside the first check, where it lands in that turn's
/// [compile measurement](crate::sandbox::SandboxOutcome::compile) rather than hidden beside it.
///
/// The directory is keyed by the checker's version **and** by a hash of the declarations gg
/// generates, so a gg with a different SDK surface never reads another's files, and two processes
/// with the same ones share.
fn checker() -> Result<&'static Checker, String> {
    static CHECKER: OnceLock<Result<Checker, String>> = OnceLock::new();
    CHECKER
        .get_or_init(materialise)
        .as_ref()
        .map_err(Clone::clone)
}

/// Write the checker's read-only inputs into a [shared toolchain
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

/// The whole SDK surface as a declaration file: one ambient namespace per capability module, then
/// the bare aliases every module and every type is also reachable by.
///
/// Generated from the committed catalogue rather than written out, for the reason nothing about this
/// SDK is written out: the catalogue is reflected from the SDK's own declarations, so what a program
/// is *checked* against is the same text a model is *shown*, with no second copy to drift. It carries
/// no documentation — the model never reads this file, and a comment would only be text for `tsc` to
/// skip.
///
/// # Why the aliases are part of the surface rather than a convenience
///
/// The shim binds every type bare beside its qualified name, and binds each module under the
/// [legacy grouping](legacy_groupings) a sibling arm reaches it by, so a program that writes
/// `catch (e) { if (e instanceof ToolError) … }` or `fs.readFile(…)` is a program that runs. A
/// checker that knew only the qualified names would refuse it, which is the one thing a checker must
/// never do. `import x = y.z` is TypeScript's own alias form and carries a namespace's *types* as
/// well as its values, so `fs.DirEntry` type-checks exactly as `gg.files.DirEntry` does.
///
/// A module is deliberately **not** aliased under its own bare id. The shim does not bind one, for
/// the reason it says: `files` and `shell` are ordinary variable names, and a parameter of that name
/// turns `const files = …` into a `SyntaxError` about a redeclared formal parameter. Four modules
/// are the exception rather than the rule — [`legacy_groupings`] explains why `tasks`, `skills`,
/// `context` and `programs` are declared here all the same — and it is the *legacy grouping* that
/// puts them in scope, not the module id.
fn surface(catalogue: &SignatureCatalogue) -> String {
    let mut out = String::from(
        "// Generated by gg from this language's committed signature catalogue. Not for reading.\n",
    );
    out.push_str("declare namespace gg {\n");
    for module in &catalogue.modules {
        out.push_str(&format!("  namespace {} {{\n", module.id));
        for declaration in catalogue
            .types
            .iter()
            .filter(|declaration| declaration.module.as_deref() == Some(module.id.as_str()))
        {
            out.push_str(&format!("    {}\n", declaration.declaration));
        }
        for signature in members(catalogue, &module.id) {
            out.push_str(&format!("    function {signature};\n"));
        }
        out.push_str("  }\n");
    }
    out.push_str("}\n");
    for module in &catalogue.modules {
        for legacy in legacy_groupings(catalogue, &module.id) {
            out.push_str(&format!("import {legacy} = gg.{};\n", module.id));
        }
    }
    for declaration in &catalogue.types {
        let Some(module) = declaration.module.as_deref() else {
            continue;
        };
        out.push_str(&format!(
            "import {} = gg.{module}.{};\n",
            declaration.name, declaration.name
        ));
    }
    out
}

/// The **legacy grouping names** the shim also binds the module `id` under, in operation order.
///
/// gg files every operation under an `(object, key)` pair that predates the module vocabulary, and
/// the shim binds each module under that object's name as well as under its own id — not for this
/// arm's sake but for the PureScript arm's, whose compiled bundle this same
/// component evaluates and which resolves `fs`, `view` and the rest as free identifiers.
///
/// A name the shim binds is a name a program can call, so the checker declares it. It is nowhere in
/// the catalogue, so nothing puts it in front of a model: it is reachable and undocumented, which is
/// the honest shape of an alias that exists for a sibling arm.
///
/// Derived from gg's own [operations table](crate::sandbox::operations) rather than listed here,
/// because the pair it comes from is gg's and a second copy would be a second thing to keep in step.
/// `session` yields two — an ending's grouping is its *role's* — and both are declared, exactly as
/// both roles' ending calls are. Four modules' groupings are their own id (`tasks`, `skills`,
/// `context`, `programs`), and those are declared too rather than skipped as redundant: the module id
/// is not otherwise a name, so skipping one would leave a name the shim binds undeclared.
fn legacy_groupings(catalogue: &SignatureCatalogue, id: &str) -> Vec<&'static str> {
    let mut out: Vec<&'static str> = Vec::new();
    for function in catalogue.functions.iter().filter(|f| f.module == id) {
        let Some(operation) = operation_by_id(&function.operation) else {
            continue;
        };
        let object = operation.call.object;
        if !out.contains(&object) {
            out.push(object);
        }
    }
    out
}

/// Every signature the module `id` binds, in catalogue order, with the directory every module that
/// binds anything also carries.
///
/// One entry may contribute several signatures — that is what an overload group is — so they are
/// emitted in order and TypeScript reads them as the overload set the language declared.
///
/// A module that binds no function at all gets no directory, and that is the truth rather than a
/// simplification: `core` declares the types every other module speaks in and the shim builds no
/// object for it beyond the error class, so a `core.list()` the checker accepted would be a call that
/// fails at run time.
fn members(catalogue: &SignatureCatalogue, id: &str) -> Vec<String> {
    let mut out: Vec<String> = catalogue
        .functions
        .iter()
        .filter(|function| function.module == id)
        .flat_map(|function| function.signatures.iter())
        .map(|entry| entry.signature.clone())
        .collect();
    if out.is_empty() {
        return out;
    }
    for entry in &catalogue.meta {
        out.extend(entry.signatures.iter().map(|entry| entry.signature.clone()));
    }
    out
}

#[cfg(test)]
#[path = "typescript.check.test.rs"]
mod tests;
