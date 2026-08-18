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
//! that binding is an **assembly the program references**. Each module in scope is written into the
//! preparation's workspace as `module_<key>.cs` — [wrapped](super::source::wrap_module) as
//! `public static class <key>` inside `namespace lib` — compiled on its own with `-target:library`
//! into `lib.<key>.dll`, and named to the program's compile with `-r:`. The modules are built in
//! binding order and each references the ones before it, so one module may reach another's class.
//!
//! It is the same supply gg's own surface gets, which is the point: `-r:Gg.dll` and
//! `-r:lib.CsvTools.dll` are one mechanism, and neither declares a name.
//!
//! A module is also compiled **alone** when it is read — [`compile_module`] — which is what buys its
//! author a diagnostic in their own coordinates rather than a program that stops compiling a turn
//! later for reasons in somebody else's file.
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
    CompilerReport, Workspace, place_tree, shared_toolchain_dir,
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

/// The assembly a **code module's own check** is told to produce, and then thrown away.
///
/// The check compiles a module under a fixed key before any program has asked for it, so this
/// assembly is not the one a program will reference — that one is built per key, by
/// [`module_assembly`], when the program that binds it is compiled. Nothing reads this one.
const MODULE_ASSEMBLY: &str = "GgModule.dll";

/// The response file one compiler invocation's arguments are written into, named for the assembly
/// it produces.
///
/// A file rather than an argument list because the reference set alone is ~160 paths: passing them
/// as `argv` works today and is one platform limit away from not, and a response file is what a
/// .NET build itself uses for exactly this. Named per assembly because a preparation runs `csc`
/// once per module and once for the program, in one workspace, and a fixed name would leave an
/// operator reading the workspace of a failed turn only the last of them.
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

/// Prepare a **code module** — the code half of a skill or a memory — by compiling it the way a
/// program will, and read the names its class offers.
///
/// What comes back is the author's **source**, because the library a program references is built for
/// a key this preparation is not handed: the seam binds `lib.<key>` when the module is loaded, and
/// the class inside the library is named for it. So the assembly built here is the check and nothing
/// more, and [`compile`] builds the one a program references, under the key that program knows.
///
/// It is compiled here, at the read, for what that buys its author: a diagnostic in **their own
/// coordinates**, on the call that loaded the skill, rather than a program that stops compiling a
/// turn later for reasons in somebody else's file. It is the same `-target:library` over the same
/// `-r:Gg.dll` a bound module's own library is built with, so what compiles here compiles there.
pub(super) fn compile_module(
    module_source: &str,
    context: &PrepareContext,
) -> Result<PreparedModule, PrepareFailure> {
    let module = source::wrap_module(module_source, source::CHECK_KEY)?;
    let root = dotnet_home().ok_or_else(|| PrepareFailure::Toolchain(missing_toolchain()))?;
    let workspace = context.workspace().map_err(PrepareFailure::Toolchain)?;

    let sdk = sdk_assembly(&root, context).map_err(PrepareFailure::Toolchain)?;
    let file = workspace
        .write(&source::module_file(source::CHECK_KEY), &module.source)
        .map_err(PrepareFailure::Toolchain)?;
    library(
        &root,
        workspace,
        std::slice::from_ref(&sdk),
        &file,
        MODULE_ASSEMBLY,
        context,
    )?;

    Ok(PreparedModule {
        source: module_source.to_string(),
        exports: module.exports,
    })
}

/// Compile one `.cs` file into `assembly`, a library inside this preparation's own output directory
/// — a code module's own check, and the library a program references — and hand back where it landed.
///
/// `-target:library` because a class body has no entry point and needs none, and `libraries` is what
/// this one may reach: gg's SDK, and for a bound module the modules bound before it.
fn library(
    root: &Path,
    workspace: &Workspace,
    libraries: &[PathBuf],
    file: &Path,
    assembly: &str,
    context: &PrepareContext,
) -> Result<PathBuf, PrepareFailure> {
    let output = workspace.output().join(assembly);
    let response = workspace
        .write(
            &response_name(assembly),
            &response_file(
                root,
                Target::Library,
                workspace.work(),
                libraries,
                std::slice::from_ref(&file.to_path_buf()),
                &output,
            )?,
        )
        .map_err(PrepareFailure::Toolchain)?;
    let report = invoke(root, &response, context).map_err(PrepareFailure::Toolchain)?;
    classify(&report, root, file, context)?;
    Ok(output)
}

/// Compile one model program, and the code modules in its scope, into the assemblies the guest runs.
///
/// The model's program is compiled **alone**: its own file is the only source in its invocation, and
/// everything it may reach is a `-r:` reference. Each module in scope is compiled first, into its
/// own library, in binding order and each referencing the ones before it, so one module may reach
/// another's class and none of them can move a line of the model's own file.
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
    // What the next compile may reference, which grows as the modules are built: gg's surface first,
    // then every module bound before this one.
    let mut libraries = vec![sdk];
    for module in modules {
        let wrapped = source::wrap_module(&module.source, &module.name)?;
        let file = workspace
            .write(&source::module_file(&module.name), &wrapped.source)
            .map_err(PrepareFailure::Toolchain)?;
        let name = module_assembly(&module.name);
        let output = library(&root, workspace, &libraries, &file, &name, context)?;
        assemblies.push((name, read_assembly(&output)?));
        libraries.push(output);
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
            false => Err(format!(
                "gg's own C# SDK did not compile, which is a defect in gg rather than in the \
                 program:\n{}",
                report.stdout.trim(),
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
/// module's own check, which has none and needs none.
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
    let mut lines = vec![
        "-nologo".to_string(),
        "-nostdlib+".to_string(),
        target.flag().to_string(),
        format!("-langversion:{LANGUAGE_VERSION}"),
        "-nullable:enable".to_string(),
        "-optimize+".to_string(),
        "-debug:embedded".to_string(),
        format!(
            "-pathmap:{}{sep}=.{sep}",
            work.display(),
            sep = std::path::MAIN_SEPARATOR
        ),
        "-deterministic".to_string(),
        "-utf8output".to_string(),
        format!("-out:{}", output.display()),
    ];
    for reference in references(root)?.iter().chain(libraries) {
        lines.push(format!("-r:{}", reference.display()));
    }
    for file in sources {
        lines.push(format!("{}", file.display()));
    }
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

/// Turn a finished invocation into a verdict.
///
/// A rejection is recognised by Roslyn's **own diagnostic format** rather than by the exit code,
/// because the exit code says only that something went wrong: `csc` exits 1 for a program it refused
/// and for a program it could not read the references for. What only a rejection produces is a line
/// shaped `program.cs(7,9): error CS0117: …`, and gg keeps exactly those lines — a compiler that
/// fell over without producing one is reported as a toolchain failure and never shown to the model
/// as its own mistake.
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
    let report = context
        .compiler(root.join("dotnet/dotnet"))
        .ok()?
        .arg("exec")
        .arg(&driver)
        .arg(LANGUAGE_VERSION)
        .arg(file)
        .env("DOTNET_ROOT", root.join("dotnet"))
        .env("DOTNET_CLI_TELEMETRY_OPTOUT", "1")
        .env("DOTNET_NOLOGO", "1")
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
        let mut arguments = vec![
            "-nologo".to_string(),
            "-nostdlib+".to_string(),
            "-target:exe".to_string(),
            format!("-langversion:{LANGUAGE_VERSION}"),
            "-nullable:enable".to_string(),
            "-optimize+".to_string(),
            "-deterministic".to_string(),
            "-main:Tools.Parse".to_string(),
            format!("-out:{}", into.join(PARSER_ASSEMBLY).display()),
            format!(
                "-r:{}",
                bincore.join("Microsoft.CodeAnalysis.dll").display()
            ),
            format!(
                "-r:{}",
                bincore.join("Microsoft.CodeAnalysis.CSharp.dll").display()
            ),
        ];
        for reference in references(root).map_err(|failure| match failure {
            PrepareFailure::Toolchain(message) => message,
            other => format!("{other:?}"),
        })? {
            arguments.push(format!("-r:{}", reference.display()));
        }
        arguments.push(format!("{}", source.display()));
        arguments.push(String::new());
        std::fs::write(&response, arguments.join("\n"))
            .map_err(|error| format!("could not write {}: {error}", response.display()))?;

        let report = invoke(root, &response, context)?;
        match report.ok {
            true => Ok(()),
            false => Err(format!(
                "csc could not build gg's own C# parse classifier, which is gg's arrangement \
                 failing rather than any program's: {}\n{}",
                report.status,
                report.stdout.trim(),
            )),
        }
    })?;
    Ok(tree.join(PARSER_ASSEMBLY))
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
/// and, for something not attached to a location, a bare `error CS2001: Source file … not found`.
/// Both are kept; a summary line, a blank, or anything else is not.
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
    let after_location = match line.split_once("): ") {
        Some((_, rest)) => rest,
        None => line.trim_start(),
    };
    after_location.starts_with("error CS")
}

#[cfg(test)]
#[path = "csharp.compile.test.rs"]
mod tests;
