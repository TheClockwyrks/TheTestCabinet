//! **The Roslyn compile** — how a model's C# becomes something the [C# guest](super) can evaluate.
//!
//! # The strategy, and why it is the one that makes this arm affordable
//!
//! A model's reply is compiled **on the host, to IL**, by Roslyn — `csc`, the compiler every C#
//! developer's build already runs — and the assembly it produces crosses the membrane as base64 in
//! the world's existing `program` string. The prebuilt guest is a Mono **IL interpreter**, so the
//! artifact gg ships is a runtime rather than a program, and the per-turn cost is one `csc` and
//! nothing else.
//!
//! What `csc` is given is the model's program and **nothing else**. Every library it may reach is a
//! `-r:` reference: gg's own SDK, as the assembly [`sdk_assembly`] builds once per machine, and one
//! library per code module in the agent's scope. A reference puts no name in the program's scope,
//! so what reaches `Views.OpenText` is the `using Gg;` the program wrote and what reaches
//! `CsvTools.Slugify` is the `using lib;` it wrote.
//!
//! What the turn ships is therefore a **manifest** of named assemblies rather than one assembly —
//! the SDK, the module libraries, and the program — which the guest registers as bundled resources
//! and resolves references out of, exactly as it resolves the class libraries it carries.
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
//! | A program with nothing loaded, after that | **~0.22 s** |
//! | Each code module in scope, compiled to its own library | ~0.22 s more |
//! | gg's own SDK, built once per machine by [`sdk_assembly`] | ~0.28 s, and never again |
//!
//! Which puts it **second among the compiled arms**, behind [C++](super::super::cpp)'s ~90 ms — and
//! that arm is only there because it precompiles a header once per machine — and comfortably ahead
//! of `swiftc`, both JVM arms and `purs`. What it costs *beyond* the compiler is where this arm
//! differs from those: none of them instantiates a prebuilt guest, and this one instantiates the
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
//! **Two things are shared on purpose**, on the seam's own terms: gg's own SDK assembly
//! ([`sdk_assembly`]) and the parse-only driver [`parser`] builds. Each is content-keyed on gg's own
//! sources and the toolchain it is built against, placed by rename and sealed read-only. Nothing
//! writes to either afterwards, which is the whole of the discipline — the measured corruption this
//! contract exists to prevent is a *write* into a shared tree. Neither holds anything a model or a
//! skill author wrote: what is compiled per preparation is compiled in that preparation's own
//! workspace.
//!
//! **Nothing else is shared, and one thing is refused on purpose.** Roslyn ships a compiler *server* —
//! `VBCSCompiler`, a resident process the SDK's build reuses across compilations — which is exactly
//! the shape of the shared-daemon corruption [`compile`](crate::sandbox::language::compile)
//! documents. gg never reaches it: the server is started by the `csc` **shim**, and gg runs
//! `csc.dll` under `dotnet exec` directly, so each compile is its own process with its own state.
//! That is a decision rather than an accident of invocation, and it is why this module names the
//! assembly instead of the launcher beside it.
//!
//! # What the toolchain carries, because the run image does not
//!
//! .NET does not link ICU; it **`dlopen`s** it. `libSystem.Globalization.Native.so` opens
//! `libicuuc.so.<v>` and `libicui18n.so.<v>` — and `libicudata` behind the first of them — while the
//! runtime is still starting, and a process that cannot find them does not fail to compile. It
//! `FailFast`s before any managed code runs: SIGABRT, an empty stdout, and a sentence on stderr
//! nobody was reading. The `node:24-bookworm-slim` run image twenty-six of the twenty-seven `-gg`
//! variants are built over ships no ICU at all, so that is what `csc` did there on **every C# turn**
//! until this arm started carrying its own copy.
//!
//! Three things that look like they would have caught it did not, and each is a reason the rule is
//! shaped the way it is. `ldd` reported a complete closure, because a `dlopen`ed library appears in
//! no ELF header. The installer's own verification compile passed, because it ran in a builder stage
//! that had `apt-get install`ed `libicu72` for exactly that purpose and then exported `/opt/gg`
//! without it. And the arm compiled perfectly in *some* of those images the whole time — the Ubuntu
//! `blender-gg`, because Blender's package closure pulls in `libicu78`, and every image that
//! installs the mesa stack, because `mesa-vulkan-drivers` pulls in `libicu72` — the render kinds
//! (`voxel-gg`, `mc-gg`, `material-gg`, …) and `full-stack-3d-gg`, which renders a 3D full-stack
//! run's asset previews through Mesa's software Vulkan exactly as they do. Not one of those
//! Dockerfiles asks for an ICU.
//! An image that satisfies a dependency by accident satisfies nothing: the same tree is copied to
//! the same absolute path into all twenty-seven, and none of them was ever asked.
//!
//! So the toolchain carries the three libraries under [`lib/`](LIBRARY_DIRECTORY) and **every**
//! `dotnet` gg spawns names that directory on `LD_LIBRARY_PATH` — which is why [`dotnet`] exists as
//! the one place a `dotnet` command is built. It is the [Swift arm](super::super::swift)'s
//! arrangement, arrived at from the same failure: a toolchain published against one distribution,
//! copied into an image built from another, carrying the closure it needs and naming it on the
//! loader path rather than hoping. `apps/docs/src/content/docs/gg/languages/compilation.md` states
//! the rule for every arm.
//!
//! `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1` also makes `csc` run, and was **rejected**. It does not
//! supply what is missing; it changes the compiler's globalization behaviour, and this arm's
//! `-deterministic` is a promise that one program compiles to one assembly on a developer's machine
//! and in a run image. A flag that makes the two compilers different is the one repair this arm
//! cannot take.
//!
//! # The failures, and which of them are the model's
//!
//! `csc` exits non-zero both when it disagreed with the program and when it could not run, so the
//! two are told apart by whether it **reported diagnostics in its own format**:
//!
//! | | What happened | How it is reported |
//! | --- | --- | --- |
//! | exit 0 | compiled | the assembly, base64-encoded |
//! | non-zero, and the **parser** refused it | a typo | [`PrepareError::Syntax`] — the parser's own diagnostics, at the model's own coordinates |
//! | non-zero, and only the **binder** refused it | a program written whole against the wrong surface | [`PrepareError::Compile`] — Roslyn's own diagnostics, at the model's own coordinates |
//! | non-zero, and a diagnostic named [gg's arrangement](ARRANGEMENT_CODES) | a source, a reference or an output path gg got wrong | [`PrepareFailure::Toolchain`] — the whole invocation, located diagnostics beside it and all |
//! | non-zero, over a [rebuilt code module](bind_module) | this arm disagreeing with itself about a file the model did not write | [`PrepareFailure::Lowering`] — gg's own defect, and the run ends on it |
//! | anything else | the compiler could not finish | [`PrepareFailure::Toolchain`] — **not** the model's, and never shown to it as its own |
//!
//! Every diagnostic a program's compile can produce is located in the model's own file, because the
//! model's own file is the only source in it. gg's SDK earns its diagnostics where it is built, and
//! [`sdk_assembly`] reports them as a defect in gg.
//!
//! **The first two are told apart by asking Roslyn's parser, not by guessing.** javac labels a
//! diagnostic with a key that says whether the *parser* produced it, so the
//! [Java](super::super::java) arm gets the split for free. Roslyn's command line does not: a `CS1002`
//! and a `CS0117` arrive in one format with nothing distinguishing the stage that raised them, and
//! Roslyn's own `ErrorFacts` — which knows — is `internal`. A hand-maintained table of which
//! `CSxxxx` codes the parser emits would be gg guessing at another compiler's taxonomy, and a wrong
//! guess reports a typo as a surface misunderstanding, which is the exact distinction the two bands
//! exist to keep. So on the **failing path only**, gg runs
//! `packages/gg-sandbox-csharp/tools/Parse.cs` — a parse-only Roslyn driver over the one file — and
//! reads the answer off whether it printed anything. See [`parse_errors`] for why that is not the
//! compiler server this seam forbids, and for what happens when it cannot answer.
//!
//! # A code module is a referenced library
//!
//! A code [skill](crate::skills)'s or [memory](crate::memories)'s class is bound at `lib.<key>`, and
//! that binding is an **assembly the program references**. At the read that binds it, a module is
//! written into that key's directory in the
//! [band](crate::sandbox::Workspace::open_module) as `module_<key>.cs` —
//! [wrapped](super::source::wrap_module) as `public static class <key>` inside `namespace lib` —
//! and compiled on its own with `-target:library` and `-r:Gg.dll` into `lib.<key>.dll`. Every
//! program the agent writes afterwards names that file with `-r:` and reads its IL out of it.
//!
//! It is the same supply gg's own surface gets, which is the point: `-r:Gg.dll` and
//! `-r:lib.CsvTools.dll` are one mechanism, and neither declares a name.
//!
//! Compiling it at the read is what buys its author a diagnostic in their own coordinates rather
//! than a program that stops compiling a turn later for reasons in somebody else's file.
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

use crate::sandbox::language::compile::{
    CompilerCommand, CompilerReport, Workspace, place_tree, shared_toolchain_dir,
};
use crate::sandbox::language::csharp::sdk::{SDK_DIRECTORY, SDK_SOURCES};
use crate::sandbox::language::csharp::source;
use crate::sandbox::language::{
    CodeModule, PrepareContext, PrepareError, PrepareFailure, PreparedModule, PreparedProgram,
};

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

/// The launcher, inside the toolchain tree — the only `dotnet` this arm ever runs.
///
/// Named once because three things have to agree about it: the check that a tree
/// [is one](usable), the [command builder](dotnet) that spawns it, and the sentence an operator is
/// shown when it will not start.
const LAUNCHER: &str = "dotnet/dotnet";

/// The shared libraries the toolchain carries because the run image does not, relative to its root.
///
/// `libicuuc`, `libicui18n` and `libicudata`, put there by `scripts/ci/install-dotnet.sh` out of the
/// same distribution the rest of the tree is pruned against. See this module's own documentation for
/// what happens without them, and why nothing short of shipping them was accepted. It is named on
/// [every `dotnet` this arm spawns](dotnet), and a tree without it is
/// [not a toolchain](usable) — because what a missing ICU produces is a SIGABRT with no output at
/// all, and a model told that was its program's fault.
const LIBRARY_DIRECTORY: &str = "lib";

/// The sonames [`LIBRARY_DIRECTORY`] must hold, which are the three .NET opens as it starts.
///
/// `libicuuc` and `libicui18n` are named by `libSystem.Globalization.Native.so` itself; `libicudata`
/// is the blob the first of them reaches for. All three, checked one at a time — see [`vendored`]
/// for why two of the three is the shape worth catching, and
/// `gg_dotnet_icu_vendored` in `scripts/ci/install-dotnet.sh`, which asks the same question of the
/// tree it has just written.
const VENDORED_LIBRARIES: &[&str] = &["libicuuc", "libicui18n", "libicudata"];

/// The file a model's program is compiled from, and the one its diagnostics are located in.
///
/// A fixed name inside a directory the preparation was handed empty, which is the seam's rule: what
/// differs between two compiles is the directory, never the file name, so a diagnostic always reads
/// `program.cs(7,9)` and never a path that leaks a workspace id to the model.
pub(super) const PROGRAM_FILE: &str = "program.cs";

/// The assembly `csc` is told to produce, inside this preparation's own output directory.
///
/// It must be the name the guest registers and loads — `GG_PROGRAM_ASSEMBLY` in
/// `packages/gg-sandbox-csharp/Sources/shell.c` — because Mono resolves a bundled assembly resource
/// by that name and by nothing else.
pub(super) const PROGRAM_ASSEMBLY: &str = "GgProgram.dll";

/// gg's own SDK, as the one assembly every program and every code module references.
///
/// It must be the name the guest registers it under — `GG_SDK_ASSEMBLY` in
/// `packages/gg-sandbox-csharp/Sources/shell.c` — because a reference the compiler resolved is
/// resolved again in the guest out of the bundled resource of that name.
pub(super) const SDK_ASSEMBLY: &str = "Gg.dll";

/// The assembly a code module bound at `lib.<key>` is compiled into, and referenced by.
///
/// Named for the binding, so that the reference the program's compile is given, the resource the
/// guest registers and the namespace a program writes are one string with one meaning. The key is
/// already a C# identifier ([`source::binding_name`]) so it cannot produce a file name that is not
/// one.
pub(super) fn module_assembly(key: &str) -> String {
    format!("lib.{key}.dll")
}

/// The response file one compiler invocation's arguments are written into, named for the assembly
/// it produces.
///
/// A file rather than an argument list because the reference set alone is ~160 paths: passing them
/// as `argv` works today and is one platform limit away from not, and a response file is what a
/// .NET build itself uses for exactly this. Named per assembly because one workspace holds the
/// program's invocation and each module's, and a fixed name would leave an operator reading the
/// workspace of a failed turn only the last of them.
fn response_name(assembly: &str) -> String {
    format!("{}.rsp", assembly.trim_end_matches(".dll"))
}

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
/// inside the prebuilt guest**, and a `dotnet` on `PATH` says nothing about the last two. A
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

/// Whether a candidate tree is the one this arm needs — the launcher, the compiler, the references
/// and the [libraries the image does not supply](LIBRARY_DIRECTORY), all four.
///
/// All four rather than just the launcher, because the failure a partial tree produces is the worst
/// kind: `dotnet` starts, `csc` is missing, and what a model would be told is that its program did
/// not compile.
///
/// `lib/` is here for exactly that argument and is the sharpest case of it. A tree missing it is a
/// tree whose `dotnet` aborts on SIGABRT at start-up, before it has read a line of the model's
/// program, printing to stderr and leaving stdout empty — so what the model would be told is that
/// its program did not compile, on the evidence of nothing at all. Refusing the tree turns that into
/// the sentence [`missing_toolchain`] shows an operator, which names the four things a tree must
/// hold and is the only reading of the failure that is true.
fn usable(root: &Path) -> bool {
    root.join(LAUNCHER).is_file()
        && root.join("roslyn/bincore/csc.dll").is_file()
        && root.join("ref").is_dir()
        && vendored(root)
}

/// Whether the toolchain really carries [the libraries the run image does not
/// supply](LIBRARY_DIRECTORY) — each of the three sonames, and not merely the directory they live
/// in.
///
/// The directory is not the thing that makes `csc` start; the files in it are, and the two come
/// apart. `scripts/ci/install-dotnet.sh` creates `lib/` before it fills it, so an install that fell
/// over between the two — no `ar` on the machine, a fetch that failed, an interrupted layer — leaves
/// exactly the shape [`usable`] was extended to reject: a tree that looks complete and whose
/// `dotnet` aborts on SIGABRT before it reads a line of the model's program. That was measured, on
/// an image with no `binutils`, and the empty directory was accepted.
///
/// Matched one soname at a time and by **prefix**, for the two reasons the installer's own guard
/// gives. The version is not gg's to know — it is whatever that distribution's package index
/// resolved to, which is the point of resolving it there rather than writing it into a script — and
/// the failure worth catching is a `lib/` holding two of the three: `libicuuc` and `libicudata` are
/// what the [Swift arm](super::super::swift) vendors for `libxml2`, so a tree that borrowed its
/// closure would carry two thirds of what .NET opens and start nothing.
fn vendored(root: &Path) -> bool {
    let directory = root.join(LIBRARY_DIRECTORY);
    let Ok(entries) = std::fs::read_dir(&directory) else {
        return false;
    };
    let present: Vec<String> = entries
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    VENDORED_LIBRARIES.iter().all(|soname| {
        present
            .iter()
            .any(|name| name.starts_with(&format!("{soname}.so")))
    })
}

/// Compile a **program** — a model's reply — into the manifest of IL assemblies the guest loads.
///
/// [`component`](PreparedProgram::component) is `None` because this arm evaluates its program with a
/// **prebuilt** runtime — one the build linked, once, and gg embeds — rather than compiling one per
/// turn. That is what separates it from the
/// three arms whose compiler emits wasm: its per-turn cost is one `csc` and no engine work at all,
/// where theirs is a compiler *and* a `Component::new` over bytes that differ every turn.
pub(super) fn compile_program(
    program: &str,
    modules: &[CodeModule],
    context: &PrepareContext,
) -> Result<PreparedProgram, PrepareFailure> {
    let assemblies = compile(program, modules, context)?;
    Ok(PreparedProgram {
        source: manifest(&assemblies),
        component: None,
    })
}

/// **The transport**: every assembly this turn needs, named, in the order they were built.
///
/// Two lines per assembly — the name the guest registers it under, then its IL as base64 — because
/// the world's `program` is a `string` and an IL assembly is a PE image whose body is arbitrary.
/// Widening that parameter to `list<u8>` would change the wire for every arm to say one thing about
/// one language, and a text manifest costs a third again on a payload that never leaves the process.
///
/// The program is last, which is the order they are read in and the order they depend on each other
/// in. `packages/gg-sandbox-csharp/Sources/shell.c` registers every one of them before it loads any,
/// so nothing about the guest depends on that order.
fn manifest(assemblies: &[(String, Vec<u8>)]) -> String {
    let mut out = String::new();
    for (name, bytes) in assemblies {
        out.push_str(name);
        out.push('\n');
        out.push_str(&base64::engine::general_purpose::STANDARD.encode(bytes));
        out.push('\n');
    }
    out
}

/// Prepare a **code module** — the code half of a skill or a memory — by compiling it into the
/// library a program references, and read the names its class offers.
///
/// This is where a module is compiled and the only place. `key` is the binding key, so the class is
/// named for it and the assembly is `lib.<key>.dll`, inside that key's directory in the
/// [band](crate::sandbox::Workspace::open_module). Every program the agent writes afterwards is
/// handed `-r:` of that file and reads its IL out of it.
///
/// It is compiled here, at the read, for what that buys its author: a diagnostic in **their own
/// coordinates**, on the call that loaded the skill, rather than a program that stops compiling a
/// turn later for reasons in somebody else's file. `-r:Gg.dll` and nothing else, so a module sees
/// gg's surface and its own declarations.
pub(super) fn compile_module(
    key: &str,
    module_source: &str,
    context: &PrepareContext,
) -> Result<PreparedModule, PrepareFailure> {
    let module = source::wrap_module(module_source, key)?;
    let root = dotnet_home().ok_or_else(|| PrepareFailure::Toolchain(missing_toolchain()))?;
    let workspace = context.workspace().map_err(PrepareFailure::Toolchain)?;

    build_module(
        &root,
        workspace,
        key,
        &module.source,
        module_source,
        context,
    )?;

    Ok(PreparedModule {
        source: module_source.to_string(),
        exports: module.exports,
    })
}

/// Compile one code module's wrapped source into `lib.<key>.dll`, inside that key's directory in the
/// band, and record what it produced.
fn build_module(
    root: &Path,
    workspace: &Workspace,
    key: &str,
    wrapped: &str,
    source: &str,
    context: &PrepareContext,
) -> Result<PathBuf, PrepareFailure> {
    let sdk = sdk_assembly(root, context).map_err(PrepareFailure::Toolchain)?;
    let name = source::module_file(key);
    let into = workspace
        .open_module(key)
        .map_err(PrepareFailure::Toolchain)?;
    let file = workspace
        .write_module(key, &name, wrapped)
        .map_err(PrepareFailure::Toolchain)?;
    let assembly = into.join(module_assembly(key));
    library(
        root,
        workspace,
        std::slice::from_ref(&sdk),
        &file,
        &assembly,
        &response_name(&module_assembly(key)),
        context,
    )?;
    workspace.record_module(key, source, vec![assembly.clone()]);
    Ok(assembly)
}

/// The library the module bound at `module.name` is referenced through, compiling it first when this
/// agent's workspace holds no build made from these bytes.
///
/// The rebuild is the miss rather than the rule — a module reaching a program's compile was
/// [read](compile_module) and accepted before any program named it — and it happens when this
/// agent's workspace holds no build for these bytes: the recorded source differs, or the artifact it
/// recorded is gone. It is what keeps a program handed a module this workspace never saw compiling,
/// which is the authorship gate's own scope and every test that drives the program step directly.
///
/// **Every way it can fail is [gg's](ours)**, and that is what this function exists to state. The
/// module's bytes were accepted at the read that loaded them, so this arm refusing them now is this
/// arm disagreeing with itself over a file the model did not write. Handing the module author's
/// diagnostic to the model charges it for a program it wrote correctly and names a file it cannot
/// open.
fn bind_module(
    root: &Path,
    workspace: &Workspace,
    module: &CodeModule,
    context: &PrepareContext,
) -> Result<PathBuf, PrepareFailure> {
    match workspace.module_build(&module.name, &module.source) {
        Some(artifacts) if !artifacts.is_empty() => Ok(artifacts[0].clone()),
        _ => {
            let wrapped = source::wrap_module(&module.source, &module.name)
                .map_err(|failure| ours(&module.name, failure))?;
            build_module(
                root,
                workspace,
                &module.name,
                &wrapped.source,
                &module.source,
                context,
            )
            .map_err(|failure| ours(&module.name, failure))
        }
    }
}

/// Re-attribute a [rebuilt module](bind_module)'s refusal to gg, whichever of the model-facing bands
/// it arrived in.
///
/// Both producers are covered because both are reachable and both are equally gg's here: the
/// [wrap](source::wrap_module), which refuses a module whose shape this arm has no lowering for, and
/// the compile under it, which refuses one Roslyn read and disagreed with. A fix that re-attributed
/// only the second would leave a module offering nothing public reaching a model as its own
/// `Unsupported` refusal, over a file it did not write.
///
/// A [toolchain failure](PrepareFailure::Toolchain) passes through. A compiler that could not
/// finish is the run image's rather than anybody's source, whichever file it was reading, and it
/// already ends the run without the model reading it.
fn ours(key: &str, failure: PrepareFailure) -> PrepareFailure {
    let binding = format!("{}.{key}", source::NAMESPACE);
    match failure {
        PrepareFailure::Program(error @ (PrepareError::Syntax(_) | PrepareError::Compile(_))) => {
            PrepareFailure::Lowering(format!(
                "csc refused the code module gg compiled as `{binding}` beside the program, which \
                 compiled on its own when it was loaded:\n{error}"
            ))
        }
        PrepareFailure::Program(error @ PrepareError::Unsupported(_)) => {
            PrepareFailure::Lowering(format!(
                "gg could not lower the code module bound at `{binding}` beside the program, which \
                 it accepted when it was loaded:\n{error}"
            ))
        }
        other => other,
    }
}

/// Compile one `.cs` file into `output` — a code module's library, or the program's own assembly —
/// and hand back where it landed.
///
/// `-target:library` because a class body has no entry point and needs none, and `libraries` is what
/// this one may reach: gg's SDK, and nothing else for a module.
fn library(
    root: &Path,
    workspace: &Workspace,
    libraries: &[PathBuf],
    file: &Path,
    output: &Path,
    response_name: &str,
    context: &PrepareContext,
) -> Result<(), PrepareFailure> {
    let response = workspace
        .write(
            response_name,
            &response_file(
                root,
                Target::Library,
                workspace.work(),
                libraries,
                std::slice::from_ref(&file.to_path_buf()),
                output,
            )?,
        )
        .map_err(PrepareFailure::Toolchain)?;
    let report = invoke(root, &response, context).map_err(PrepareFailure::Toolchain)?;
    classify(&report, root, file, context)
}

/// Compile one model program, and the code modules in its scope, into the assemblies the guest runs.
///
/// The model's program is compiled **alone**: its own file is the only source in its invocation, and
/// everything it may reach is a `-r:` reference. Each module in scope was compiled into its own
/// library at the read that bound it, so none of them can move a line of the model's own file.
///
/// What comes back is every assembly the turn needs, named as the guest registers it: gg's surface,
/// the module libraries in binding order, and the program last.
fn compile(
    program: &str,
    modules: &[CodeModule],
    context: &PrepareContext,
) -> Result<Vec<(String, Vec<u8>)>, PrepareFailure> {
    let root = dotnet_home().ok_or_else(|| PrepareFailure::Toolchain(missing_toolchain()))?;
    let workspace = context.workspace().map_err(PrepareFailure::Toolchain)?;
    let sdk = sdk_assembly(&root, context).map_err(PrepareFailure::Toolchain)?;

    // Verbatim. Nothing is prepended, appended or re-indented, which is what makes every line and
    // column below the model's own.
    let entry = workspace
        .write(PROGRAM_FILE, program)
        .map_err(PrepareFailure::Toolchain)?;

    let mut assemblies = vec![(SDK_ASSEMBLY.to_string(), read_assembly(&sdk)?)];
    // What the program's compile may reference: gg's surface, then every module in scope.
    let mut libraries = vec![sdk];
    for module in modules {
        let assembly = bind_module(&root, workspace, module, context)?;
        assemblies.push((module_assembly(&module.name), read_assembly(&assembly)?));
        libraries.push(assembly);
    }

    let output = workspace.output().join(PROGRAM_ASSEMBLY);
    let response = workspace
        .write(
            &response_name(PROGRAM_ASSEMBLY),
            &response_file(
                &root,
                Target::Exe,
                workspace.work(),
                &libraries,
                std::slice::from_ref(&entry),
                &output,
            )?,
        )
        .map_err(PrepareFailure::Toolchain)?;

    let report = invoke(&root, &response, context).map_err(PrepareFailure::Toolchain)?;
    classify(&report, &root, &entry, context)?;
    assemblies.push((PROGRAM_ASSEMBLY.to_string(), read_assembly(&output)?));
    Ok(assemblies)
}

/// Read an assembly `csc` was told to write, or say that it did not write one.
fn read_assembly(path: &Path) -> Result<Vec<u8>, PrepareFailure> {
    std::fs::read(path).map_err(|error| {
        PrepareFailure::Toolchain(format!(
            "csc reported success but wrote no assembly to {}: {error}",
            path.display(),
        ))
    })
}

/// **gg's own SDK, as one assembly**, built once per machine into a
/// [shared toolchain directory](shared_toolchain_dir).
///
/// # Why it is an assembly rather than sources in every compile
///
/// Because that is what a module is, and the two are supplied the same way or the arm has two
/// stories. A referenced assembly declares no name — `namespace Gg` is reached by a `using Gg;` the
/// program wrote, exactly as `namespace lib` is reached by a `using lib;` it wrote — and it gives
/// both halves one identity: a module's method that hands back a `Gg.Files.FileRead` hands back the
/// program's own `Gg.Files.FileRead`, which two copies compiled into two assemblies could not.
///
/// It also puts gg's own diagnostics where they belong. The SDK earns them **here**, once, as a
/// defect in gg, rather than inside the invocation that judges a model's program.
///
/// # How it satisfies the isolation contract
///
/// The directory is [shared on purpose](shared_toolchain_dir) and is content-keyed on everything
/// that could change its bytes — every SDK source gg carries, the language version they are compiled
/// at, and the toolchain that compiles them — placed by [rename](place_tree) and sealed read-only.
/// `-deterministic` and a `-pathmap` onto `./` make the assembly a function of those alone, so two
/// preparations racing to build it write the same bytes and the loser discards an identical copy.
/// Nothing writes to it afterwards, and nothing a model or a skill author wrote is in it.
pub(super) fn sdk_assembly(root: &Path, context: &PrepareContext) -> Result<PathBuf, String> {
    let directory = shared_toolchain_dir(&format!(
        "csharp-sdk-{}-{:016x}-{}",
        LANGUAGE_VERSION,
        fingerprint_sdk(),
        compiler_stamp(root),
    ))?;
    let tree = directory.join(SDK_DIRECTORY);
    place_tree(&tree, |into| {
        let mut sources = Vec::with_capacity(SDK_SOURCES.len());
        for file in SDK_SOURCES {
            let path = into.join(file.name);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
            }
            std::fs::write(&path, file.text)
                .map_err(|error| format!("could not write {}: {error}", path.display()))?;
            sources.push(path);
        }
        let output = into.join(SDK_ASSEMBLY);
        let rendered = response_file(root, Target::Library, into, &[], &sources, &output).map_err(
            |failure| match failure {
                PrepareFailure::Toolchain(message) => message,
                other => format!("{other:?}"),
            },
        )?;
        let response = into.join(response_name(SDK_ASSEMBLY));
        std::fs::write(&response, rendered)
            .map_err(|error| format!("could not write {}: {error}", response.display()))?;

        let report = invoke(root, &response, context)?;
        match report.ok {
            true => Ok(()),
            false => Err(arrangement_failure(
                "gg's own C# SDK did not compile",
                &report,
            )),
        }
    })?;
    Ok(tree.join(SDK_ASSEMBLY))
}

/// A digest of every SDK source gg carries, for the [assembly](sdk_assembly)'s content key.
///
/// Over the names as well as the texts, because a file that moved is a different compilation even
/// when every byte of C# in it is the same.
fn fingerprint_sdk() -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for file in SDK_SOURCES {
        file.name.hash(&mut hasher);
        file.text.hash(&mut hasher);
    }
    hasher.finish()
}

/// What a compilation is for: a model's program, which the guest calls an entry point on, or a code
/// module's library, which has no entry point and needs none.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Target {
    /// A program. `-target:exe`.
    Exe,
    /// A code module, compiled alone at the read. `-target:library`.
    Library,
}

impl Target {
    /// The `csc` flag it is.
    fn flag(self) -> &'static str {
        match self {
            Self::Exe => "-target:exe",
            Self::Library => "-target:library",
        }
    }
}

/// Every argument `csc` is given, one per line, as Roslyn's own response-file format.
///
/// Each flag earns its place:
///
/// * `-nologo` — nothing but the diagnostics, which is what gg is about to read.
/// * `-nostdlib+` — load-bearing. The references below are the ones that match the BCL inside the
///   prebuilt guest, and nothing else may be implicitly in scope. (`-noconfig`, which stops `csc`
///   reading the `csc.rsp` sitting beside it, is **not** here: Roslyn ignores it inside a response
///   file and says so as `CS2023`, so [`invoke`] passes it on the command line instead.)
/// * `-target:exe` — the guest loads the assembly and calls its entry point, so it needs one.
/// * `-langversion` — pinned; see [`LANGUAGE_VERSION`].
/// * `-nullable:enable` — nullable reference types on, which is what a C# author writing a new file
///   in this decade gets and what the SDK is written for.
/// * `-optimize+` — the IL is *interpreted*, so optimisation here is not about native code: it is
///   what removes the debug-build scaffolding an interpreter would otherwise walk instruction by
///   instruction.
/// * `-debug:embedded` — **what puts the model's own line on a runtime frame.** A portable PDB, in
///   the assembly rather than beside it, because the assembly is the only thing that crosses to the
///   guest: a `program.pdb` written into a workspace gg deletes is a file the interpreter never
///   sees. Mono reads it once the guest has initialised its debug lookup
///   (`packages/gg-sandbox-csharp/Sources/shell.c`), and an unhandled exception's frames then name
///   `./program.cs` and a line, where they used to name a method and an IL offset. It is compatible
///   with `-optimize+`: the sequence points are in the PDB, not in the IL.
/// * `-pathmap` — the preparation's own workspace, mapped onto `./`. Two things need it. A model
///   reads those frames, and `/tmp/gg-prepare/1234-0/work/program.cs` is a path it cannot open and
///   did not write; and the PDB is *in* the assembly, so an absolute path would make two
///   preparations of one program differ in the bytes `-deterministic` exists to hold equal. The
///   value is `./` because Roslyn refuses an empty one (`CS8101`), which is the only spelling that
///   would have left the bare `program.cs` the compiler's own diagnostics use.
/// * `-deterministic` — Roslyn stamps a build with an MVID derived from its inputs rather than from
///   the clock, so two preparations of one program produce byte-identical assemblies. Nothing in the
///   seam demands that (the isolation gate in `language/isolation.rs` searches artifacts
///   for markers and never compares two of them), and it is passed anyway: an artifact that is a
///   function of its program is one a study can re-prepare from a recorded program and get back what
///   ran.
/// * `-utf8output` — so a diagnostic quoting a model's own identifier arrives as the bytes it wrote.
///
/// The reference set is every `.dll` in the toolchain's `ref/<tfm>` directory, sorted, which is the
/// reference assembly pack for the pinned runtime. Sorted so the response file — and therefore the
/// compile — is a function of the directory's contents rather than of the order a filesystem
/// happened to list them in.
///
/// `libraries` is what **gg** supplies on top of it, as references and never as sources: its own
/// [SDK assembly](sdk_assembly), and one library per code module in the compilation's scope. A
/// reference is availability and nothing else — it declares no name, which is what makes the line
/// that reaches one the program's own. `sources` is what is being compiled, which is one file: a
/// model's program, or one module.
fn response_file(
    root: &Path,
    target: Target,
    work: &Path,
    libraries: &[PathBuf],
    sources: &[PathBuf],
    output: &Path,
) -> Result<String, PrepareFailure> {
    let sep = std::path::MAIN_SEPARATOR;
    let quote = |value: &str| quoted(value).map_err(PrepareFailure::Toolchain);
    let mapped = |value: &str| path_map(value).map_err(PrepareFailure::Toolchain);
    let mut lines = vec![
        "-nologo".to_string(),
        "-nostdlib+".to_string(),
        target.flag().to_string(),
        format!("-langversion:{LANGUAGE_VERSION}"),
        "-nullable:enable".to_string(),
        "-optimize+".to_string(),
        "-debug:embedded".to_string(),
        format!(
            "-pathmap:{}={}",
            mapped(&format!("{}{sep}", work.display()))?,
            mapped(&format!(".{sep}"))?,
        ),
        "-deterministic".to_string(),
        "-utf8output".to_string(),
        format!("-out:{}", quote(&output.display().to_string())?),
    ];
    for reference in references(root)?.iter().chain(libraries) {
        lines.push(format!("-r:{}", quote(&reference.display().to_string())?));
    }
    for file in sources {
        lines.push(quote(&file.display().to_string())?);
    }
    lines.push(String::new());
    Ok(lines.join("\n"))
}

/// One value a response-file line carries, wrapped in the quotes Roslyn's own lexer strips off it
/// again.
///
/// Roslyn splits a response file **on whitespace**, exactly as a shell splits a command line, and a
/// quoted run is one token however many spaces are inside it. Every path this arm writes into one
/// comes from somewhere gg does not choose the spelling of — the compile
/// [workspace](crate::sandbox::Workspace) under the machine's temporary directory, the toolchain
/// root under `$HOME` or [`DOTNET_HOME_ENV`] — so a `TMPDIR` or a `HOME` holding a space is a
/// machine on which every unquoted line arrives as two arguments. Measured against this arm's own
/// toolchain, an unquoted response file over a workspace whose path holds a space fails the whole
/// invocation with `error CS8101: The pathmap option was incorrectly formatted.` — one of the
/// [codes that describe gg's own arrangement](ARRANGEMENT_CODES) — before `csc` reads a line of the
/// program.
///
/// A path holding a `"` has no spelling in that format at all, and gg refuses to write one rather
/// than emit a line the compiler will re-lex into something else. It is a
/// [toolchain failure](PrepareFailure::Toolchain) because the machine's own directory names are what
/// it is about, and it names the path so an operator can see which one.
fn quoted(value: &str) -> Result<String, String> {
    if value.contains('"') {
        return Err(format!(
            "gg cannot pass {value} to csc: Roslyn's response-file format has no spelling for a \
             path holding a quote character. Put TMPDIR and the .NET toolchain \
             ({DOTNET_HOME_ENV}) under directory names without one.",
        ));
    }
    Ok(format!("\"{value}\""))
}

/// One side of the [`-pathmap`](response_file) pair, in the spelling Roslyn's own option parser
/// reads a path back out of.
///
/// `-pathmap` carries `key=value` pairs separated by `,`, and its parser reads a **doubled**
/// separator as one literal character. A `=` or a `,` inside a path written straight into that
/// option therefore re-lexes into an extra pair or an extra field, and the invocation fails with
/// `CS8101` over a program `csc` never read. Doubling both is the format's own escape, and the
/// quoting the value still needs is the [response file's](quoted), which is a separate lexer and
/// runs first.
///
/// Every path this option carries is the agent's compile workspace, rooted under `TMPDIR`, so the
/// characters in it are the machine's to choose and not gg's.
fn path_map(value: &str) -> Result<String, String> {
    quoted(&value.replace(',', ",,").replace('=', "=="))
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

/// **The one place a `dotnet` is built**, isolated in this preparation's tree and pointed at this
/// toolchain and at nothing else the machine happens to have.
///
/// Two call sites spawn the launcher — [`invoke`], which is every `csc` this arm runs, and
/// [`parse_errors`], which runs the parse-only driver — and they were until recently four
/// environment variables written out twice. That is exactly the shape a half fix takes: `csc`
/// given its libraries, the classifier not, and an arm that compiles a program correctly and then
/// cannot say whether the compiler's rejection was a typo. The environment a `dotnet` this arm runs
/// needs is one rule, so it lives in one function, and a third call site added later inherits it
/// rather than remembering it.
///
/// Each of the four earns its place:
///
/// * `DOTNET_ROOT` names the runtime **inside the same tree**, because the launcher resolves its
///   shared framework relative to it and a machine with its own .NET installed must not be able to
///   satisfy this compile.
/// * `DOTNET_CLI_TELEMETRY_OPTOUT` and `DOTNET_NOLOGO` silence a first-run banner that would
///   otherwise be printed into the diagnostics gg is about to read.
/// * `LD_LIBRARY_PATH` names the [libraries the toolchain carries](LIBRARY_DIRECTORY), because .NET
///   `dlopen`s ICU as it starts and the run image has none — see this module's own documentation
///   for the failure that produces and why nothing cheaper was accepted. It is applied after the
///   seam's own redirection and points at a read-only path outside this preparation's tree, which
///   is the escape hatch [`CompilerCommand::env`] documents: it selects which shared library the
///   loader opens and can change no verdict. The [Swift arm](super::super::swift) names its own
///   vendored closure the same way, for the same reason.
fn dotnet<'context>(
    root: &Path,
    context: &'context PrepareContext,
) -> Result<CompilerCommand<'context>, String> {
    let mut command = context.compiler(root.join(LAUNCHER))?;
    command
        .env("DOTNET_ROOT", root.join("dotnet"))
        .env("DOTNET_CLI_TELEMETRY_OPTOUT", "1")
        .env("DOTNET_NOLOGO", "1")
        .env("LD_LIBRARY_PATH", root.join(LIBRARY_DIRECTORY));
    Ok(command)
}

/// Spawn `csc` over this preparation's own response file and wait for it, killing it at
/// [`COMPILE_TIMEOUT`].
///
/// `dotnet exec <csc.dll>` rather than the `csc` shim beside it, deliberately — see this module's
/// own documentation: the shim is what starts Roslyn's shared compiler server, and a compiler
/// process shared between two agents' programs is the one thing this seam does not allow. The
/// environment it runs in is [`dotnet`]'s, which is where the reasons for it are.
fn invoke(
    root: &Path,
    response: &Path,
    context: &PrepareContext,
) -> Result<CompilerReport, String> {
    dotnet(root, context)
        .map_err(|error| format!("{}{error}", spawn_prefix(root)))?
        .arg("exec")
        .arg(root.join("roslyn/bincore/csc.dll"))
        // On the command line rather than in the response file, and it has to be: `csc` reads the
        // `csc.rsp` sitting beside it *before* it opens any response file, so the flag that stops it
        // is ignored — with a `CS2023` warning — anywhere else. Without it a compile inherits
        // whatever assemblies that installation calls default, which is the one thing `-nostdlib+`
        // and the reference set are chosen to decide.
        .arg("-noconfig")
        .arg(format!("@{}", response.display()))
        .run(COMPILE_TIMEOUT)
        .map_err(|error| match error.starts_with("could not run") {
            true => format!("{}{error}", spawn_prefix(root)),
            false => error,
        })
}

/// What a failure to start the compiler is prefixed with — the one failure here an operator can fix.
fn spawn_prefix(root: &Path) -> String {
    format!(
        "gg could not start the C# compiler ({}): ",
        root.join(LAUNCHER).display(),
    )
}

/// What gg says when the toolchain is not installed at all.
///
/// It enumerates what a tree must hold, and the list is [`usable`]'s list: an operator who points
/// [`DOTNET_HOME_ENV`] at a tree gg then refuses reads this sentence and nothing else, so a part it
/// does not name is a part they cannot know is missing. `lib/` is on it for that reason rather than
/// for completeness — a tree assembled before the installer vendored the
/// [libraries](LIBRARY_DIRECTORY) is exactly the tree that reaches this sentence today.
fn missing_toolchain() -> String {
    format!(
        "gg found no .NET toolchain (install one with scripts/ci/install-dotnet.sh, or point \
         {DOTNET_HOME_ENV} at a tree holding {LAUNCHER}, roslyn/bincore/csc.dll, ref/ and \
         {LIBRARY_DIRECTORY}/)",
    )
}

/// How a compile **gg ran for itself** — its own [SDK](sdk_assembly), its own
/// [parse classifier](parser) — is reported when it failed.
///
/// The reader is an **operator**, never a model, and that decides everything about the shape.
/// Nothing here is [bounded](SHOWN) the way a model's diagnostics are, because none of it is spent
/// in a model's context window: someone is reading a defect in gg's own arrangement and wants all of
/// it. What it carries is what the seam's own contract says a toolchain failure carries — "the exit
/// status, the signal and the tail of the compiler's stderr"
/// (`apps/docs/src/content/docs/gg/languages/compilation.md`) — and
/// [`CompilerReport::stderr_tail`] has already trimmed that tail to the size a crash report needs.
///
/// The status and the stderr are here because of what they cost when they were not. Both of these
/// paths once rendered `report.stdout` alone, and a .NET that cannot start writes to stderr and
/// leaves stdout empty — so a live run died on its first turn reporting "gg's own C# SDK did not
/// compile:" followed by a full stop and nothing, with the SIGABRT and the compiler's own account
/// of what it could not find both in hand and both discarded. [`verdict`] had it right in the same
/// file the whole time.
///
/// The compiler's stdout comes last and only when there is any, so the ordinary case — Roslyn
/// disagreeing with gg's own C#, which is what these two failures usually are — reads as the
/// diagnostics it always did, under one line saying how the process ended.
fn arrangement_failure(lead: &str, report: &CompilerReport) -> String {
    let mut message = format!("{lead}: {}{}", report.status, report.stderr_tail());
    let reported = report.stdout.trim();
    if !reported.is_empty() {
        message.push('\n');
        message.push_str(reported);
    }
    message
}

/// Turn a finished invocation into a verdict.
///
/// A rejection is recognised by Roslyn's **own diagnostic format** rather than by the exit code,
/// because the exit code says only that something went wrong: `csc` exits 1 for a program it refused
/// and for a program it could not read the references for. What only a rejection produces is a line
/// shaped `program.cs(7,9): error CS0117: …`, and gg keeps exactly those lines — a compiler that
/// fell over without producing one is reported as a toolchain failure and never shown to the model
/// as its own mistake. A line whose code names [gg's arrangement](ARRANGEMENT_CODES) is a toolchain
/// failure too, because what it reports on is the invocation rather than the C# inside it.
///
/// Every diagnostic an invocation here can produce is located in the file that invocation was given,
/// because gg supplies its SDK and every code module as references rather than as sources. A defect
/// in gg's own SDK is reported where the SDK is built ([`sdk_assembly`]) and never as a program's.
fn classify(
    report: &CompilerReport,
    root: &Path,
    written: &Path,
    context: &PrepareContext,
) -> Result<(), PrepareFailure> {
    let failure = match verdict(report) {
        Ok(()) => return Ok(()),
        Err(failure) => failure,
    };
    // Only a rejection has a band to refine. A toolchain failure decided nothing about the source,
    // so there is nothing to ask the parser about.
    if !matches!(failure, PrepareFailure::Program(PrepareError::Compile(_))) {
        return Err(failure);
    }
    match parse_errors(root, written, context) {
        // The band is decided on what the parser reported in full — one error anywhere in it makes
        // this a typo rather than a misunderstood surface — and only what the model reads is
        // [bounded](SHOWN). A parse failure the cap dropped cannot therefore stop being one.
        Some(syntax) if !syntax.is_empty() => Err(PrepareFailure::Program(PrepareError::Syntax(
            crate::sandbox::language::diagnostics::capped(syntax, SHOWN, "\n"),
        ))),
        _ => Err(failure),
    }
}

/// How many of `csc`'s diagnostics a model is shown.
///
/// [Kotlin's eight](super::super::kotlin), and on this arm the arms agree for the same reason rather
/// than by default: a Roslyn diagnostic is **exactly one line**. `csc` prints no source excerpt and
/// no caret, so eight diagnostics is eight lines, and there is no per-diagnostic tail for the number
/// to have to allow for the way [C++'s four](super::super::cpp) does. Measured on this machine
/// against this arm's own flags, one misremembered SDK name called at fifty call sites is **4840
/// bytes across 50 lines** — ~97 bytes a diagnostic — so eight is ~775 bytes and the fifty were
/// ~4.8 KB of one sentence repeated with the line number changed.
///
/// It bounds what the model **reads** and never what a [band](classify) is decided on: the parser's
/// answer about which stage refused the program is taken over the whole set before this applies. Nor
/// does it bound what gg's own SDK's diagnostics say when they are the failure — that string is for
/// an operator reading a defect in gg, who wants all of it, and it never reaches a model.
const SHOWN: usize = 8;

/// What `csc` decided, before the [band](classify) is refined — the pure half, over the invocation's
/// own output and nothing else.
fn verdict(report: &CompilerReport) -> Result<(), PrepareFailure> {
    if report.ok {
        return Ok(());
    }
    let reported: Vec<&str> = report
        .stdout
        .lines()
        .map(str::trim_end)
        .filter(|line| is_error(line))
        .collect();
    if reported.is_empty() {
        return Err(PrepareFailure::Toolchain(format!(
            "csc {} without reporting a diagnostic{}",
            report.status,
            report.stderr_tail(),
        )));
    }
    // One [arrangement diagnostic](ARRANGEMENT_CODES) makes the whole invocation a toolchain
    // failure, beside located diagnostics in the model's own file and all. `csc` was reading inputs
    // gg got wrong — a source it could not open, a reference it could not resolve — so everything
    // else it said about the program is downstream of an input the program had no part in, and a
    // model handed the located half would rewrite a program that was never the problem. It is the
    // same safe direction [`is_error`] takes.
    if reported.iter().any(|line| is_arrangement(line)) {
        return Err(PrepareFailure::Toolchain(arrangement_failure(
            "csc reported on the compilation gg arranged rather than on the program in it",
            report,
        )));
    }
    // Deduplicated and capped through the seam's own [bound](SHOWN), because Roslyn reports one
    // diagnostic per call site: a single misremembered SDK name arrives once for every place the
    // program called it, saying the same sentence at fifty different columns.
    Err(PrepareFailure::Program(PrepareError::Compile(
        crate::sandbox::language::diagnostics::capped(
            reported.into_iter().map(str::to_string).collect(),
            SHOWN,
            "\n",
        ),
    )))
}

/// **Which stage refused it**, asked of Roslyn's parser rather than guessed at — `Some(diagnostics)`
/// when the parser was consulted, and `None` when it could not be.
///
/// # Why there is a second process here at all
///
/// The seam keeps a [syntax error](PrepareError::Syntax) and a [compile error](PrepareError::Compile)
/// apart because they say different things about a model: a syntax error is a typo, and a compile
/// error is a program written whole and coherently against a surface the model got wrong — which is
/// the most interesting thing a checked arm can report about the SDK it was handed. `csc` will not
/// say which it produced. Its diagnostics arrive in one stream with no stage attached, and Roslyn's
/// own `ErrorFacts.IsParseError` — which knows — is `internal`. A hand-maintained table of which
/// `CSxxxx` codes the parser emits would be gg guessing at another compiler's taxonomy, and a wrong
/// guess reports a typo as a surface misunderstanding, which is the exact distinction the two bands
/// exist to keep.
///
/// So gg asks the parser. `packages/gg-sandbox-csharp/tools/Parse.cs` parses the one file and prints
/// the parser's own errors; **empty output means it parsed**, and the rejection was therefore a
/// binder's.
///
/// # Why this is not the compiler server the isolation contract forbids
///
/// It parses one file and exits, holding nothing between invocations, resolving no references,
/// binding nothing and writing nothing. It is a process spawned through
/// [`PrepareContext::compiler`] like `csc` is, inside this preparation's own tree. What the contract
/// forbids is a **resident** process shared between two agents' programs, which is what
/// `VBCSCompiler` is and why it is deleted from the image rather than merely unused.
///
/// # What it costs, and when
///
/// **Nothing on the turn path.** A program that compiled has no band to decide, so this runs only
/// after a rejection — on a turn that was already lost — and costs one `dotnet` start (~0.2 s) plus,
/// once per machine, the ~2 s `csc` that builds the driver into a
/// [shared toolchain directory](shared_toolchain_dir).
///
/// # What happens when it cannot answer
///
/// [`PrepareError::Compile`], which is the wider band and what this arm reported before the driver
/// existed. A classifier that could not run must not turn a real diagnostic into a toolchain failure
/// — the model's program really was rejected and the diagnostics really are its — and it must not
/// claim a program parsed when nobody asked. Reporting the wider band is the one answer that is
/// wrong in neither direction.
fn parse_errors(root: &Path, file: &Path, context: &PrepareContext) -> Option<Vec<String>> {
    let driver = parser(root, context).ok()?;
    let report = dotnet(root, context)
        .ok()?
        .arg("exec")
        .arg(&driver)
        .arg(LANGUAGE_VERSION)
        .arg(file)
        .run(COMPILE_TIMEOUT)
        .ok()?;
    // A non-zero exit is the driver saying it could not answer — a usage or I/O failure — and is
    // never "the program parsed".
    report.ok.then(|| {
        report
            .stdout
            .lines()
            .map(str::trim_end)
            // The driver prints errors and nothing else — `Parse.cs` filters on
            // `DiagnosticSeverity.Error`, because a parser warning is not a rejection — so this is
            // the same predicate `csc`'s own output is read with rather than a laxer one.
            .filter(|line| is_error(line))
            .map(str::to_string)
            .collect()
    })
}

/// The parse-only driver's assembly, built once per machine into a shared toolchain directory.
const PARSER_ASSEMBLY: &str = "GgParse.dll";

/// The driver's source, carried in gg's binary for the reason every guest is: gg is copied as a
/// single file into an ephemeral run container and must take everything the turn path needs with it.
const PARSER_SOURCE: &str =
    include_str!("../../../../../packages/gg-sandbox-csharp/tools/Parse.cs");

/// Build [`parse_errors`]'s driver, once, and hand back where it landed.
///
/// # How it satisfies the isolation contract
///
/// The directory is [shared on purpose](shared_toolchain_dir) and is content-keyed on everything
/// that could change its bytes — the driver's own source, the language version it is told to parse
/// at, and the toolchain it is compiled and run against — placed by
/// [rename](place_tree) and sealed read-only. Two preparations racing to build it either both win or
/// one discards an identical copy. **Nothing writes to it afterwards**, which is the whole
/// discipline: the measured corruption this contract exists to prevent is a *write* into a shared
/// tree.
///
/// A .NET application with no `deps.json` resolves its dependencies out of **its own directory**, so
/// Roslyn's two assemblies have to be beside the driver. They are **copied** rather than symlinked,
/// at 31 MB once per machine, and the reason is the sealing: `place_tree` makes every file in the
/// tree unwritable with `set_permissions`, which **follows a symlink**, so a linked tree would reach
/// out and change the mode of the toolchain's own installed assemblies. Nothing in a shared
/// directory may touch anything outside it, and 31 MB written once is the cheaper side of that
/// bargain. `csc`'s own `runtimeconfig.json` is copied as the driver's, so the parser runs on exactly
/// the framework Roslyn does rather than on a version gg would otherwise have to pin a second time.
fn parser(root: &Path, context: &PrepareContext) -> Result<PathBuf, String> {
    let bincore = root.join("roslyn/bincore");
    let directory = shared_toolchain_dir(&format!(
        "csharp-parser-{}-{:016x}-{}",
        LANGUAGE_VERSION,
        fingerprint(PARSER_SOURCE.as_bytes()),
        compiler_stamp(root),
    ))?;
    let tree = directory.join("parser");
    place_tree(&tree, |into| {
        for assembly in [
            "Microsoft.CodeAnalysis.dll",
            "Microsoft.CodeAnalysis.CSharp.dll",
        ] {
            std::fs::copy(bincore.join(assembly), into.join(assembly))
                .map_err(|error| format!("could not copy {assembly}: {error}"))?;
        }
        std::fs::copy(
            bincore.join("csc.runtimeconfig.json"),
            into.join(format!(
                "{}.runtimeconfig.json",
                PARSER_ASSEMBLY.trim_end_matches(".dll")
            )),
        )
        .map_err(|error| format!("could not take Roslyn's own runtime configuration: {error}"))?;

        let source = into.join("Parse.cs");
        std::fs::write(&source, PARSER_SOURCE)
            .map_err(|error| format!("could not write {}: {error}", source.display()))?;
        let response = into.join("parse.rsp");
        std::fs::write(&response, parser_response(root, &bincore, into, &source)?)
            .map_err(|error| format!("could not write {}: {error}", response.display()))?;

        let report = invoke(root, &response, context)?;
        match report.ok {
            true => Ok(()),
            false => Err(arrangement_failure(
                "csc could not build gg's own C# parse classifier",
                &report,
            )),
        }
    })?;
    Ok(tree.join(PARSER_ASSEMBLY))
}

/// Every argument the [parse classifier](parser)'s own build is given, as Roslyn's response-file
/// format.
///
/// It is its own function rather than a vector inside the build, because it is the **second**
/// producer of a response file on this arm and it was the one that got forgotten: a fix that quoted
/// only [`response_file`] would leave the classifier that runs on every rejection broken on a path
/// holding a space, and its failure surfaces as the band widening from
/// [`Syntax`](PrepareError::Syntax) to [`Compile`](PrepareError::Compile) rather than as anything an
/// operator would read as an error. Every path here goes through [`quoted`] for that reason.
///
/// The driver is not compiled against gg's flags for the model's sake — it is gg's own program — so
/// it names Roslyn's two assemblies out of `bincore` and the reference pack beside them, and asks
/// for the one entry point `Parse.cs` declares.
fn parser_response(
    root: &Path,
    bincore: &Path,
    into: &Path,
    source: &Path,
) -> Result<String, String> {
    let quote = |path: &Path| quoted(&path.display().to_string());
    let mut arguments = vec![
        "-nologo".to_string(),
        "-nostdlib+".to_string(),
        "-target:exe".to_string(),
        format!("-langversion:{LANGUAGE_VERSION}"),
        "-nullable:enable".to_string(),
        "-optimize+".to_string(),
        "-deterministic".to_string(),
        "-main:Tools.Parse".to_string(),
        format!("-out:{}", quote(&into.join(PARSER_ASSEMBLY))?),
        format!("-r:{}", quote(&bincore.join("Microsoft.CodeAnalysis.dll"))?),
        format!(
            "-r:{}",
            quote(&bincore.join("Microsoft.CodeAnalysis.CSharp.dll"))?
        ),
    ];
    for reference in references(root).map_err(|failure| match failure {
        PrepareFailure::Toolchain(message) => message,
        other => format!("{other:?}"),
    })? {
        arguments.push(format!("-r:{}", quote(&reference)?));
    }
    arguments.push(quote(source)?);
    arguments.push(String::new());
    Ok(arguments.join("\n"))
}

/// A stamp of the toolchain the driver is built and run against — the compiler's size and
/// modification time — for the [driver](parser)'s content key.
///
/// Deliberately not a digest of Roslyn's assemblies, which would be read on every process start for
/// a key whose only job is to notice that the toolchain moved.
fn compiler_stamp(root: &Path) -> String {
    let compiler = root.join("roslyn/bincore/csc.dll");
    let Ok(metadata) = std::fs::metadata(&compiler) else {
        return "unknown".to_string();
    };
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|since| since.as_secs())
        .unwrap_or_default();
    format!("{}-{modified}", metadata.len())
}

/// A cheap, stable digest of some bytes, for a [shared directory](shared_toolchain_dir)'s key.
fn fingerprint(bytes: &[u8]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

/// Whether one line of `csc`'s output is an **error** about the compilation.
///
/// Roslyn writes `program.cs(7,9): error CS0117: 'string' does not contain a definition for 'Nope'`
/// and, for something not attached to a location, a bare `error CS1729: 'Program' does not contain
/// a constructor that takes 1 arguments`. Both are kept; a summary line, a blank, or anything else
/// is not.
///
/// It answers one question — is this Roslyn's error format — and a line's **code** decides
/// separately, in [`verdict`], whose failure the compilation was. A location settles neither: an
/// unlocated `CS1729` is the model's, and a located [`CS2001`](ARRANGEMENT_CODES) is gg's.
///
/// **A `warning CS` line is not one**, and that is a decision about each of the two things this
/// predicate feeds.
///
/// On what the model reads it is [the C++ arm's](super::super::cpp) decision, taken here for the
/// same stated reason: a model's program is not being reviewed, and an unused variable that failed a
/// turn would be gg imposing a lint policy on an experiment about capability. It costs more on this
/// arm than on that one, because a compile here runs with `-nullable:enable` and no `-nowarn` — so a
/// program `csc` refused for one reason can arrive trailing a `CS8600`/`CS8602` nullable tail as long
/// as the program, none of which is what stopped it.
///
/// On the [band](verdict) it is the safe direction: a compilation that produced warnings and no
/// error at all did not fail for anything in them, so a report built out of them would hand the model
/// a diagnostic it cannot act on in place of the failure it is looking for.
fn is_error(line: &str) -> bool {
    reported(line).starts_with("error CS")
}

/// One diagnostic line with its `file(line,col): ` prefix removed, when it had one.
///
/// Roslyn locates a diagnostic in the source it was reading and leaves one unlocated when it never
/// got that far, so both shapes have to be read the same way by everything that reads a line at all.
fn reported(line: &str) -> &str {
    match line.split_once("): ") {
        Some((_, rest)) => rest,
        None => line.trim_start(),
    }
}

/// The `CSxxxx` code one of Roslyn's [error lines](is_error) carries.
fn error_code(line: &str) -> Option<&str> {
    reported(line)
        .strip_prefix("error ")
        .and_then(|rest| rest.split_once(':'))
        .map(|(code, _)| code)
}

/// The codes that describe **the compilation gg arranged** rather than the program inside it.
///
/// Each is one fact about who supplied what, and gg supplied all of it:
///
/// * `CS0006` — a reference could not be found. gg supplies every reference: the toolchain's own
///   pack, its [SDK](sdk_assembly), and one library per code module in scope.
/// * `CS1504` — a source file could not be opened. gg writes every source in the invocation.
/// * `CS2001` — a source file could not be found. The same fact, for a file that was not there at
///   all rather than one that would not open.
/// * `CS2012` — the output could not be opened for writing. gg owns the output path.
/// * `CS8101` — the `-pathmap` option was incorrectly formatted. gg writes that option, out of a
///   workspace path it did not choose the spelling of.
///
/// A model's program cannot produce one. What can is a `-pathmap` line the compiler
/// [re-lexed](quoted), a workspace something swept while the compile was in flight, or a volume
/// that filled. Each is the run's environment failing rather than the program in it, which is what
/// makes them [toolchain failures](PrepareFailure::Toolchain): the run ends on the operator's terms
/// with the compiler's own words on their stream, and nothing is charged to the model.
const ARRANGEMENT_CODES: &[&str] = &["CS0006", "CS1504", "CS2001", "CS2012", "CS8101"];

/// Whether one of Roslyn's error lines is about [gg's arrangement](ARRANGEMENT_CODES).
fn is_arrangement(line: &str) -> bool {
    error_code(line).is_some_and(|code| ARRANGEMENT_CODES.contains(&code))
}

/// **The namespaces Roslyn said this program could not reach**, read out of the diagnostics this
/// arm's [verdict] rendered.
///
/// Two codes name one, and they carry the name differently. `CS0246` quotes the whole unresolved
/// name (`The type or namespace name 'Newtonsoft' could not be found`). `CS0234` quotes the leaf and
/// the namespace it looked in separately (`The type or namespace name 'Jsn' does not exist in the
/// namespace 'System.Text'`), so the two are rejoined: a `using System.Text.Jsn;` is the name
/// `System.Text.Jsn`, and the leaf alone would match nothing.
pub(super) fn unresolved_imports(diagnostic: &str) -> Vec<String> {
    diagnostic
        .lines()
        .filter_map(|line| {
            let names = crate::sandbox::language::diagnostics::named(line, "'", "'");
            if line.contains("CS0246") {
                return names.into_iter().next();
            }
            if line.contains("CS0234") {
                return match names.as_slice() {
                    [name, owner, ..] => Some(format!("{owner}.{name}")),
                    [name] => Some(name.clone()),
                    [] => None,
                };
            }
            None
        })
        .collect()
}

#[cfg(test)]
#[path = "csharp.compile.test.rs"]
mod tests;
