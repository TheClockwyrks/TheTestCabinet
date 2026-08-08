//! **The Roslyn compile** — how a model's C# becomes something the [C# guest](super) can evaluate.
//!
//! # The strategy, and why it is the one that makes this arm affordable
//!
//! A model's reply is compiled **on the host, to IL**, by Roslyn — `csc`, the compiler every C#
//! developer's build already runs — and the assembly it produces crosses the membrane as base64 in
//! the world's existing `program` string. The committed guest is a Mono **IL interpreter**, so the
//! artifact gg ships is a runtime rather than a program, and the per-turn cost is one `csc` and
//! nothing else.
//!
//! What `csc` is given is the model's program **and the SDK's own sources** — twenty-two `.cs` files
//! written into the preparation's workspace beside it, so that gg's surface is in the program's own
//! assembly and the committed guest has nothing extra to carry. See [`sdk`](super::sdk) for why, and
//! below for what it costs.
//!
//! That shape is what a prior feasibility study missed. Priced on `componentize-dotnet` —
//! NativeAOT-LLVM, which compiles the *program* to native wasm — this arm measured **25–43 seconds a
//! turn** and was cut as impractical. Compiling to IL instead is three orders of magnitude cheaper,
//! and it costs nothing a study would notice: the interpreter is the same runtime `dotnet` uses on
//! wasm everywhere else.
//!
//! # What it costs, measured
//!
//! In this repository's dev container, aarch64, one `csc` process per compile:
//!
//! | | |
//! | --- | --- |
//! | The first compile in a fresh process tree (JIT, page cache cold) | ~2.4 s |
//! | Every compile after that | **~0.28 s** |
//! | Of which the SDK's own 2,500 lines | ~70 ms, against ~210 ms for a program alone |
//!
//! Which puts it **second among the compiled arms**, behind [C++](super::super::cpp)'s ~85 ms — and
//! that arm is only there because it precompiles a header once per machine — and comfortably ahead
//! of `swiftc`, both JVM arms and `purs`. What it costs *beyond* the compiler is where this arm
//! differs from those: none of them instantiates a committed guest, and this one instantiates the
//! largest in the repository, so the honest per-turn figure is `csc` plus a share of one 35.3 MB
//! `Component::new` paid once per process. It is
//! [recorded](crate::sandbox::SandboxOutcome::compile) on the failing path as well as the succeeding
//! one, because an arm that looks free and is not is exactly what the seam requires a language to
//! declare rather than leave to be inferred.
//!
//! # Isolation
//!
//! Sixteen agents may be compiling at once. Every compile runs in **this preparation's own
//! [workspace](crate::sandbox::Workspace)** — its own `program.cs`, its own response file, its own
//! `output/` — spawned through [`PrepareContext::compiler`], which puts the working directory,
//! `HOME`, `TMPDIR` and the `XDG_*` roots inside that tree. `dotnet` writes into `HOME` (its first-run
//! sentinel, its extraction directories) without being asked, so that redirection is doing real work
//! here rather than standing by.
//!
//! **Nothing is shared, and one thing is refused on purpose.** Roslyn ships a compiler *server* —
//! `VBCSCompiler`, a resident process the SDK's build reuses across compilations — which is exactly
//! the shape of the shared-daemon corruption [`compile`](crate::sandbox::language::compile)
//! documents. gg never reaches it: the server is started by the `csc` **shim**, and gg runs
//! `csc.dll` under `dotnet exec` directly, so each compile is its own process with its own state.
//! That is a decision rather than an accident of invocation, and it is why this module names the
//! assembly instead of the launcher beside it.
//!
//! # The two failures, and which is the model's
//!
//! `csc` exits non-zero both when it disagreed with the program and when it could not run, so the
//! two are told apart by whether it **reported diagnostics in its own format**:
//!
//! | | What happened | How it is reported |
//! | --- | --- | --- |
//! | exit 0 | compiled | the assembly, base64-encoded |
//! | non-zero, with `program.cs(line,col): error CSxxxx:` lines | Roslyn read the program and refused it | [`PrepareError::Compile`] — the model's, with Roslyn's own diagnostics at the model's own coordinates |
//! | anything else | the compiler could not finish | [`PrepareFailure::Toolchain`] — **not** the model's, and never shown to it as its own |
//!
//! **Every rejection is [`Compile`](PrepareError::Compile) and none is
//! [`Syntax`](PrepareError::Syntax), and that is a stated limit rather than an oversight.** javac
//! labels a diagnostic with a key that says whether the *parser* produced it, so the
//! [Java](super::super::java) arm can separate a typo from a program written whole against the wrong
//! surface. Roslyn's command line does not: a `CS1002` and a `CS0117` arrive in one format with
//! nothing distinguishing the stage that raised them, and Roslyn's own `ErrorFacts` — which knows —
//! is internal. gg could hand-maintain a table of which `CSxxxx` codes the parser emits; it would be
//! gg guessing at another compiler's taxonomy, and a wrong guess reports a typo as a surface
//! misunderstanding, which is the exact distinction the two bands exist to keep. The fix is known
//! and is not free: a hosted Roslyn driver can ask `SyntaxTree.GetDiagnostics()` and get the
//! authoritative answer, and this arm now has one — `packages/gg-sandbox-csharp/tools/Signatures.cs`
//! reflects the catalogue through `Microsoft.CodeAnalysis.CSharp` — but it runs on a developer's
//! machine rather than on the turn path, and putting a resident Roslyn *there* is a compiler server
//! by another name. It would have to go through [`CompilerPool`](super::super::compile), which is
//! the whole reason `VBCSCompiler` is deleted from the image, and that is a decision to make with
//! the numbers in front of it rather than in passing.
//!
//! # And a third, which is gg's own
//!
//! [`classify`] separates a third case out of the compile band, and it is one only this arm has:
//! the SDK is in the **same invocation** as the program, so a diagnostic can be located in gg's own
//! sources. Those arrive as a [toolchain failure](PrepareFailure::Toolchain) naming gg rather than
//! as a compile error a model would read as its own — unless `csc` also complained about
//! `program.cs`, in which case the model's own diagnostics are what it is shown and gg's are
//! dropped. That order is deliberate: a program declaring a type the SDK already declares produces
//! diagnostics at both, and it is the model's to fix.
//!
//! # What is deliberately absent from this arm's class library
//!
//! `System.Net.Http`'s **native handler**. The assembly is bundled — so the types exist, load and
//! compile — but its WASI implementation is a set of `[DllImport]`s against
//! `wasi:http/outgoing-handler@0.2.0`, an interface gg's world does not declare and gg's linker does
//! not define, and a guest whose *pinvoke scan* included them could not be encoded as a component at
//! all. `packages/gg-sandbox-csharp/build.sh` therefore keeps that one assembly in the bundle and
//! out of the scan. A program reaches the network the way every other arm does, through the `shell`
//! tool.

use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine as _;

use crate::sandbox::language::compile::CompilerReport;
use crate::sandbox::language::csharp::sdk::{SDK_DIRECTORY, SDK_SOURCES};
use crate::sandbox::language::{PrepareContext, PrepareError, PrepareFailure, PreparedProgram};

/// The environment variable an operator points at this arm's .NET toolchain when it is not where gg
/// looks.
///
/// The same escape every compiled arm has, and it must agree with `gg_dotnet_home` in
/// `packages/gg-sandbox-csharp/csharp-version.sh` — the installer and the compiler have to look in
/// the same place or a machine that installed the toolchain would not find it.
pub(super) const DOTNET_HOME_ENV: &str = "TCAB_GG_DOTNET_HOME";

/// Where the gg toolchain image puts it.
const IMAGE_HOME: &str = "/opt/gg/toolchains/dotnet";

/// Where `scripts/ci/install-dotnet.sh` puts it on a developer's machine, under `$HOME`.
const USER_HOME_SUFFIX: &str = ".local/share/tcab/gg-dotnet";

/// The file a model's program is compiled from, and the one its diagnostics are located in.
///
/// A fixed name inside a per-preparation directory, which is the seam's rule: what differs between
/// two concurrent compiles is the directory, never the file name, so a diagnostic always reads
/// `program.cs(7,9)` and never a path that leaks a workspace id to the model.
pub(super) const PROGRAM_FILE: &str = "program.cs";

/// The assembly `csc` is told to produce, inside this preparation's own output directory.
///
/// It must be the name the guest registers and loads — `GG_PROGRAM_ASSEMBLY` in
/// `packages/gg-sandbox-csharp/Sources/shell.c` — because Mono resolves a bundled assembly resource
/// by that name and by nothing else.
pub(super) const PROGRAM_ASSEMBLY: &str = "GgProgram.dll";

/// The response file the compiler's arguments are written into.
///
/// A file rather than an argument list because the reference set alone is ~160 paths: passing them
/// as `argv` works today and is one platform limit away from not, and a response file is what a
/// .NET build itself uses for exactly this.
const RESPONSE_FILE: &str = "csc.rsp";

/// The C# language version a program is compiled as — pinned rather than `latest`, so a toolchain
/// bump cannot silently change what a model may write.
///
/// It must agree with `GG_DOTNET_LANG_VERSION` in `packages/gg-sandbox-csharp/csharp-version.sh`.
pub(super) const LANGUAGE_VERSION: &str = "14.0";

/// How long one compile may take before it is killed and reported as a
/// [toolchain failure](PrepareFailure::Toolchain).
///
/// The same bound every other arm here takes: far past any program a model has produced, and
/// unmistakably a hang rather than a slow compile.
const COMPILE_TIMEOUT: Duration = Duration::from_secs(60);

/// The .NET toolchain tree, in the order gg looks for it.
///
/// A tree rather than a `dotnet` on `PATH`, for the reason the C++ and Swift arms resolve one: what
/// this arm needs is a runtime, a Roslyn and a **reference assembly set that agree with the BCL
/// inside the committed guest**, and a `dotnet` on `PATH` says nothing about the last two. A
/// machine's own .NET is deliberately not used even when it is the same version — the guest was
/// built against one release and the reference assemblies decide what a program may call.
pub(super) fn dotnet_home() -> Option<PathBuf> {
    if let Ok(configured) = std::env::var(DOTNET_HOME_ENV) {
        let configured = PathBuf::from(configured);
        return usable(&configured).then_some(configured);
    }
    let image = PathBuf::from(IMAGE_HOME);
    if usable(&image) {
        return Some(image);
    }
    let user = home()?.join(USER_HOME_SUFFIX);
    usable(&user).then_some(user)
}

/// The current user's home directory, without pulling in a crate to read one variable.
fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Whether a candidate tree is the one this arm needs — the launcher, the compiler and the
/// references, all three.
///
/// All three rather than just the launcher, because the failure a partial tree produces is the worst
/// kind: `dotnet` starts, `csc` is missing, and what a model would be told is that its program did
/// not compile.
fn usable(root: &Path) -> bool {
    root.join("dotnet/dotnet").is_file()
        && root.join("roslyn/bincore/csc.dll").is_file()
        && root.join("ref").is_dir()
}

/// Compile a **program** — a model's reply — into the IL the guest interprets, base64-encoded.
///
/// [`unreachable`](PreparedProgram::unreachable) is `None`, and it is an absence rather than a zero:
/// the measurement counts top-level statements written after one that *ends the program*, and C#'s
/// entry point has no such statement — every way out of `Main` is a `return` the compiler already
/// treats as the end, or an exception.
///
/// [`component`](PreparedProgram::component) is `None` because this arm evaluates its program with a
/// **committed** runtime rather than compiling one per turn. That is what separates it from the
/// three arms whose compiler emits wasm: its per-turn cost is one `csc` and no engine work at all,
/// where theirs is a compiler *and* a `Component::new` over bytes that differ every turn.
pub(super) fn compile_program(
    source: &str,
    context: &PrepareContext,
) -> Result<PreparedProgram, PrepareFailure> {
    let assembly = compile(source, context)?;
    Ok(PreparedProgram {
        source: base64::engine::general_purpose::STANDARD.encode(assembly),
        unreachable: None,
        component: None,
    })
}

/// Compile one C# source into an IL assembly's bytes.
pub(super) fn compile(source: &str, context: &PrepareContext) -> Result<Vec<u8>, PrepareFailure> {
    let root = dotnet_home().ok_or_else(|| PrepareFailure::Toolchain(missing_toolchain()))?;
    let workspace = context.workspace().map_err(PrepareFailure::Toolchain)?;

    let program = workspace
        .write(PROGRAM_FILE, source)
        .map_err(PrepareFailure::Toolchain)?;
    let mut sdk = Vec::with_capacity(SDK_SOURCES.len());
    for file in SDK_SOURCES {
        sdk.push(
            workspace
                .write(&format!("{SDK_DIRECTORY}/{}", file.name), file.text)
                .map_err(PrepareFailure::Toolchain)?,
        );
    }
    let output = workspace.output().join(PROGRAM_ASSEMBLY);
    let response = workspace
        .write(
            RESPONSE_FILE,
            &response_file(&root, &program, &sdk, &output)?,
        )
        .map_err(PrepareFailure::Toolchain)?;

    let report = invoke(&root, &response, context).map_err(PrepareFailure::Toolchain)?;
    classify(&report)?;

    std::fs::read(&output).map_err(|error| {
        PrepareFailure::Toolchain(format!(
            "csc reported success but wrote no assembly to {}: {error}",
            output.display(),
        ))
    })
}

/// Every argument `csc` is given, one per line, as Roslyn's own response-file format.
///
/// Each flag earns its place:
///
/// * `-nologo` — nothing but the diagnostics, which is what gg is about to read.
/// * `-nostdlib+` — load-bearing. The references below are the ones that match the BCL inside the
///   committed guest, and nothing else may be implicitly in scope. (`-noconfig`, which stops `csc`
///   reading the `csc.rsp` sitting beside it, is **not** here: Roslyn ignores it inside a response
///   file and says so as `CS2023`, so [`invoke`] passes it on the command line instead.)
/// * `-target:exe` — the guest loads the assembly and calls its entry point, so it needs one.
/// * `-langversion` — pinned; see [`LANGUAGE_VERSION`].
/// * `-nullable:enable` — nullable reference types on, which is what a C# author writing a new file
///   in this decade gets and what the SDK is written for.
/// * `-optimize+` — the IL is *interpreted*, so optimisation here is not about native code: it is
///   what removes the debug-build scaffolding an interpreter would otherwise walk instruction by
///   instruction.
/// * `-deterministic` — Roslyn stamps a build with an MVID derived from its inputs rather than from
///   the clock, so two preparations of one program produce byte-identical assemblies. The seam's
///   [isolation gate](crate::sandbox::language::isolation) compares prepared outputs, and without
///   this every comparison would fail for a reason that has nothing to do with isolation.
/// * `-utf8output` — so a diagnostic quoting a model's own identifier arrives as the bytes it wrote.
///
/// The reference set is every `.dll` in the toolchain's `ref/<tfm>` directory, sorted, which is the
/// reference assembly pack for the pinned runtime. Sorted so the response file — and therefore the
/// compile — is a function of the directory's contents rather than of the order a filesystem
/// happened to list them in.
///
/// The **SDK's own sources** are compiled with the program, which is what makes gg's surface
/// reachable without an assembly the guest would have to carry — see [`sdk`](super::sdk). They are
/// listed before the program so that a `csc` reading them in order meets `GlobalUsings.cs` first;
/// nothing about C# requires it, and it makes the response file read the way the compilation is
/// meant to.
fn response_file(
    root: &Path,
    program: &Path,
    sdk: &[PathBuf],
    output: &Path,
) -> Result<String, PrepareFailure> {
    let mut lines = vec![
        "-nologo".to_string(),
        "-nostdlib+".to_string(),
        "-target:exe".to_string(),
        format!("-langversion:{LANGUAGE_VERSION}"),
        "-nullable:enable".to_string(),
        "-optimize+".to_string(),
        "-deterministic".to_string(),
        "-utf8output".to_string(),
        format!("-out:{}", output.display()),
    ];
    for reference in references(root)? {
        lines.push(format!("-r:{}", reference.display()));
    }
    for file in sdk {
        lines.push(format!("{}", file.display()));
    }
    lines.push(format!("{}", program.display()));
    lines.push(String::new());
    Ok(lines.join("\n"))
}

/// The reference assemblies a program is compiled against: every `.dll` under `ref/`, sorted.
fn references(root: &Path) -> Result<Vec<PathBuf>, PrepareFailure> {
    let reference_root = root.join("ref");
    let mut found = Vec::new();
    let mut stack = vec![reference_root.clone()];
    while let Some(directory) = stack.pop() {
        let entries = std::fs::read_dir(&directory).map_err(|error| {
            PrepareFailure::Toolchain(format!(
                "gg could not read the C# reference assemblies at {}: {error}",
                directory.display(),
            ))
        })?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|extension| extension == "dll") {
                found.push(path);
            }
        }
    }
    if found.is_empty() {
        return Err(PrepareFailure::Toolchain(format!(
            "gg found no C# reference assemblies under {}",
            reference_root.display(),
        )));
    }
    found.sort();
    Ok(found)
}

/// Spawn `csc` over this preparation's own response file and wait for it, killing it at
/// [`COMPILE_TIMEOUT`].
///
/// `dotnet exec <csc.dll>` rather than the `csc` shim beside it, deliberately — see this module's
/// own documentation: the shim is what starts Roslyn's shared compiler server, and a compiler
/// process shared between two agents' programs is the one thing this seam does not allow.
///
/// `DOTNET_ROOT` names the runtime inside the same tree, because the launcher resolves its shared
/// framework relative to it and a machine with its own .NET installed must not be able to satisfy
/// this compile. The two CLI variables silence a first-run banner that would otherwise be printed
/// into the diagnostics gg is about to read.
fn invoke(
    root: &Path,
    response: &Path,
    context: &PrepareContext,
) -> Result<CompilerReport, String> {
    let launcher = root.join("dotnet/dotnet");
    context
        .compiler(&launcher)
        .map_err(|error| format!("{}{error}", spawn_prefix(&launcher)))?
        .arg("exec")
        .arg(root.join("roslyn/bincore/csc.dll"))
        // On the command line rather than in the response file, and it has to be: `csc` reads the
        // `csc.rsp` sitting beside it *before* it opens any response file, so the flag that stops it
        // is ignored — with a `CS2023` warning — anywhere else. Without it a compile inherits
        // whatever assemblies that installation calls default, which is the one thing `-nostdlib+`
        // and the reference set are chosen to decide.
        .arg("-noconfig")
        .arg(format!("@{}", response.display()))
        .env("DOTNET_ROOT", root.join("dotnet"))
        .env("DOTNET_CLI_TELEMETRY_OPTOUT", "1")
        .env("DOTNET_NOLOGO", "1")
        .run(COMPILE_TIMEOUT)
        .map_err(|error| match error.starts_with("could not run") {
            true => format!("{}{error}", spawn_prefix(&launcher)),
            false => error,
        })
}

/// What a failure to start the compiler is prefixed with — the one failure here an operator can fix.
fn spawn_prefix(launcher: &Path) -> String {
    format!(
        "gg compiles every C# program with Roslyn and could not start it ({}): ",
        launcher.display(),
    )
}

/// What gg says when the toolchain is not installed at all.
fn missing_toolchain() -> String {
    format!(
        "gg compiles every C# program with Roslyn and found no .NET toolchain — install one with \
         scripts/ci/install-dotnet.sh, or point {DOTNET_HOME_ENV} at a tree holding \
         dotnet/dotnet, roslyn/bincore/csc.dll and ref/",
    )
}

/// Whether one of `csc`'s diagnostics is located inside gg's **own SDK** rather than in anything the
/// model wrote — which it can be, because the two are one compilation. See [`classify`].
fn in_the_sdk(line: &str) -> bool {
    line.contains(&format!("{SDK_DIRECTORY}/"))
}

/// Turn a finished invocation into a verdict.
///
/// A rejection is recognised by Roslyn's **own diagnostic format** rather than by the exit code,
/// because the exit code says only that something went wrong: `csc` exits 1 for a program it refused
/// and for a program it could not read the references for. What only a rejection produces is a line
/// shaped `program.cs(7,9): error CS0117: …`, and gg keeps exactly those lines — a compiler that
/// fell over without producing one is reported as a toolchain failure and never shown to the model
/// as its own mistake.
///
/// # And a third case, which is gg's own
///
/// The SDK is compiled in the **same invocation** as the program, so a diagnostic can be located in
/// gg's own sources. Those are reported as a [toolchain failure](PrepareFailure::Toolchain) naming
/// gg, rather than as a compile error a model would read as its own — unless `csc` also complained
/// about the model's file, in which case the model's own diagnostics are what it is shown and gg's
/// are dropped. That order is deliberate: a program declaring a type the SDK already declares
/// produces diagnostics at both, and it is the model's to fix.
fn classify(report: &CompilerReport) -> Result<(), PrepareFailure> {
    if report.ok {
        return Ok(());
    }
    let reported: Vec<&str> = report
        .stdout
        .lines()
        .map(str::trim_end)
        .filter(|line| is_diagnostic(line))
        .collect();
    if reported.is_empty() {
        return Err(PrepareFailure::Toolchain(format!(
            "csc {} without reporting a diagnostic{}",
            report.status,
            report.stderr_tail(),
        )));
    }
    // What the model wrote, which is everything `csc` did not locate inside gg's own SDK.
    let (mine, ours): (Vec<&str>, Vec<&str>) =
        reported.into_iter().partition(|line| !in_the_sdk(line));
    if mine.is_empty() {
        return Err(PrepareFailure::Toolchain(format!(
            "gg's own C# SDK did not compile, which is a defect in gg rather than in the \
             program:\n{}",
            ours.join("\n"),
        )));
    }
    Err(PrepareFailure::Program(PrepareError::Compile(
        mine.join("\n"),
    )))
}

/// Whether one line of `csc`'s output is a diagnostic about the model's program.
///
/// Roslyn writes `program.cs(7,9): error CS0117: 'string' does not contain a definition for 'Nope'`
/// and, for something not attached to a location, a bare `error CS2001: Source file … not found`.
/// Both are kept; a summary line, a blank, or anything else is not.
fn is_diagnostic(line: &str) -> bool {
    let after_location = match line.split_once("): ") {
        Some((_, rest)) => rest,
        None => line.trim_start(),
    };
    after_location.starts_with("error CS") || after_location.starts_with("warning CS")
}

#[cfg(test)]
#[path = "csharp.compile.test.rs"]
mod tests;
