//! **The Swift compile** — how a model's Swift becomes the wasm component that turn is evaluated
//! by.
//!
//! # The strategy, in one sentence
//!
//! A Swift program is **compiled on the host, per turn, into a component of its own**: one
//! `swiftc` over the model's reply and gg's shell against the Swift SDK for WebAssembly, then an
//! in-process [`wit_component`] encode with the pinned preview1 adapter — and what crosses the
//! membrane is not source at all but the artifact gg's engine instantiates.
//!
//! It is the second arm of that shape, after [Rust](super::super::rust), and it inherits the seam Rust
//! grew: [`PreparedProgram::component`] carries the bytes, `guest_component` answers `None`, and
//! `engine::program_component` is where the two shapes meet.
//!
//! A **code module** adds a `swiftc` of its own to that, before the program's: it is built into a
//! Swift module named for the key it is bound under, which the program's compile resolves through an
//! `-I` and links the object of. See [`source`](super::source) for the one word gg writes into such a
//! file, and [`compile_module`] for the `-typecheck` that reads one on its own when it is loaded.
//!
//! # What a Swift program is, here: the file itself
//!
//! **A model's reply is compiled verbatim, as `main.swift`.** No wrapper and no prologue, its own
//! `import gg` included, and therefore **no line offset at all** — a diagnostic at line 7 is line 7
//! of what the model wrote, and so is a located trap.
//!
//! That is not a nicety; it is the only shape in which a model can write ordinary Swift. Swift
//! forbids `extension`, `protocol` and `import` inside a function body, so the wrapper every other
//! statement-shaped arm uses — put the reply in a function and call it — would forbid three things
//! a Swift author writes without thinking, and `extension` is the one Swift is *built* around. A
//! top-level file admits all of them together with bare statements, which no other Swift context
//! does.
//!
//! What makes it work is that Swift lowers a top-level file's statements into the target's C entry
//! point — `__main_argc_argv` on wasm — which gg's shell
//! (`packages/gg-sandbox-swift/Sources/shell.swift`) calls from the `run` export. The shell is a
//! module of its own, compiled ahead of time into `shell.o` and only linked here, because a Swift
//! access level is module-wide: compiled beside the reply, gg's two exports would be names in the
//! model's own file that no line of the model's put there. The model's file is never edited, quoted
//! or re-indented.
//!
//! ## What it costs, and it is the error surface
//!
//! Top-level code is not a `throws` context anything can wrap. Swift's own entry point catches
//! nothing, and there is no hook: an uncaught `throw`, a `fatalError`, a force-unwrapped `nil`, an
//! index out of range and an arithmetic overflow all end the same way — the runtime writes its own
//! message to **stderr** and executes `unreachable`, which traps the store.
//!
//! So this arm's failures arrive as traps, and what keeps them from being *opaque* traps is
//! [`DEBUG_INFO`] — not, as expected, the guest's stderr. At `-Osize` Swift does not print its
//! runtime failures at all: the optimiser turns them into a bare `unreachable` and puts the message
//! in the **debug information**, as a synthetic inlined frame. So `-g` plus a symbolicating engine
//! is what gets `Swift runtime failure: Index out of range` and `/gg/work/main.swift:3:22` to a
//! model, and without it the same program says `program.wasm!main` and nothing more.
//!
//! It is still the weakest error surface of any arm here, and that is a fact about the language
//! rather than a gap in the implementation: Swift's unrecoverable failures are unrecoverable **by
//! design**, no guest-side shell can catch one, and what reaches the model is a *report about* a
//! failure rather than a caught error it could have branched on. The [Rust](super::super::rust) arm has
//! the same problem and a way out this one does not — a panic *hook* runs on a live guest before
//! the abort and completes a real `feedback.report-error` first. Swift has no equivalent.
//!
//! The guest's **stderr** is captured too (see
//! [`MembraneState`](crate::sandbox::membrane::MembraneState)) and is what a program reaches when it
//! writes to fd 2 on purpose. It is simply not where Swift's own failures go.
//!
//! # Why the compiler is not carried, and the bindings are
//!
//! The split every compiled arm here has. The Swift toolchain is **~835 MB** even pruned — a
//! `swift-frontend`, a `clang`, an `lld`, the swift-syntax libraries the front end links, and the
//! wasm SDK's standard library — so it cannot ride inside a single static `tcab` binary. It goes
//! into the gg toolchain image (`containers/gg-toolchains/Dockerfile`) and is found under
//! [`swift_home`].
//!
//! What gg carries is **185 KB** of guest and **3.4 MB** of libraries. The guest is the C bindings
//! generated from `crates/gg/wit` (compiled to a wasm object once, at build time, because 3,000
//! lines of generated C that never changes between programs is ~90 ms a turn that buys nothing), the
//! component-type object that names the world, the shell's header and the clang module map that
//! names it, the shell's Swift source, and
//! **this arm's SDK as a prebuilt module** — `gg.swiftmodule` and `gg.o`, compiled ahead of time for
//! the same two reasons the library set is: ~2,000 lines type-checked per turn buys nothing, and a
//! separate module is what lets a program shadow a name gg bound rather than collide with it. The
//! libraries are the curated set. All of it is a function of gg's own wire and gg's own surface, and
//! gg is copied as a single file into an ephemeral run container whose image was built separately —
//! so bindings that lived in the image could be a different vintage from the binary reading them,
//! and an SDK that did could be a different vintage from the prompt describing it.
//!
//! The **adapter** rides inside gg too, and separately: `swift.adapter.wasm` is the pinned
//! `wasi_snapshot_preview1` reactor adapter, which is what turns the preview1 core module the Swift
//! SDK emits into a preview 2 component. It is pinned to the wasmtime release gg links because the
//! two are halves of one ABI.
//!
//! # What it costs
//!
//! Measured in this repository's dev container, aarch64, 18 cores, on an ordinary program:
//!
//! | | |
//! | --- | --- |
//! | `swiftc` — the model's file, the shell, the prebuilt SDK, and the link | **~0.3 s** |
//! | The [`wit_component`] encode | **~10 ms** |
//! | Artifact | **~7.1 MB** |
//! | wasmtime `Component::new`, at `OptLevel::None`, **per turn** | **~1.3 s** |
//!
//! The SDK and the library set cost that table **nothing**, which is why both are prebuilt: the SDK
//! is a module the compiler reads rather than sources it type-checks, and the libraries are a static
//! archive whose members are pulled only when something references them — a program that imports
//! none of them links an artifact byte for byte the size of one built without the archive on the
//! command line at all.
//!
//! The artifact is two orders of magnitude larger than the [Rust](super::super::rust) arm's ~25 KB, and
//! the reason is the standard library rather than the program: Swift's is statically linked, its
//! `String` and its reflection metadata are reachable from anything, and `--gc-sections` cannot
//! strip what a metadata table names. That is a real per-turn cost — the engine compiles those
//! bytes on every turn — the dearest per-turn cost of any arm here by a wide margin, and larger
//! than the compile that produced them — and it is reported as
//! [`compile_wait`](crate::sandbox::SandboxOutcome::compile_wait) rather than hidden.
//!
//! # Isolation
//!
//! This arm satisfies the [contract](super::compile) the way the Rust arm does, and needs a little
//! more of the machinery.
//!
//! Everything gg carries is unpacked into a [shared toolchain directory](shared_toolchain_dir) —
//! two of them, one per embedded archive, each content-keyed on the pinned compiler and a digest
//! of its own bytes, placed by rename and sealed read-only. `swiftc` only ever **reads** them: the
//! module map is named on `-Xcc -fmodule-map-file`, the shell and the objects are inputs, the
//! modules are found by `-I`, the library archive is a link input, and nothing is generated beside
//! any of them.
//!
//! Everything a compile writes goes into this preparation's own workspace, and most of it without
//! this arm having asked. Swift's driver writes its intermediates under `TMPDIR` and its **clang
//! module cache** under the cache directory it derives from `HOME` — both of which
//! [`PrepareContext::compiler`](super::compile::PrepareContext::compiler) has already redirected
//! into the private tree. That is the half of the isolation contract this arm would not have
//! thought to guard: a module cache shared between two preparations of two different programs is
//! precisely the shape of the measured `purs` bug.
//!
//! Two arguments point outside the tree, and both are the escape hatch [`compile`](super::compile)
//! documents. [`LD_LIBRARY_PATH`](self::invoke_swiftc) selects which `libxml2` and `libncurses` the
//! toolchain loads and points at the toolchain's own read-only directory; and `-file-prefix-map`
//! rewrites this preparation's tree to a fixed name in everything the compiler records, so a model
//! reading a located trap is not shown a directory that was deleted before the message reached it.
//! Neither can change a verdict.
//!
//! There is no compiler daemon and no pool. `swiftc` is a one-shot process whose cost is the
//! compile.

use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;

use crate::sandbox::{
    CodeModule, CompilerReport, PrepareContext, PrepareError, PrepareFailure, PreparedModule,
    PreparedProgram, Workspace, place_tree, shared_toolchain_dir,
};

use super::super::ProgramLanguage;
use super::source::MODULE_FILE_PREFIX;

/// Everything a compile needs on disk that is not the model's own file: the shell's header and the
/// clang module map that names it, the generated WIT header, the compiled bindings object, the
/// component-type object, and gg's shell.
///
/// Embedded for the reason the guest components are: gg is copied as a single file into an
/// ephemeral run container and must carry everything it needs with it. Built by
/// `packages/gg-sandbox-swift/build.sh`.
const GUEST_TAR_GZ: &[u8] =
    include_bytes!(concat!(env!("GG_ARTIFACTS_SWIFT"), "/swift.guest.tar.gz"));

/// The **curated library set**, compiled for this arm's target: one static archive and the
/// `.swiftmodule` a program's `import` resolves against.
///
/// A separate archive from [`GUEST_TAR_GZ`] because the two are different kinds of thing and change
/// on different schedules — the guest is a function of `crates/gg/wit` and gg's own SDK sources, and
/// this is a function of three pinned third-party releases — and because this one is twenty times
/// the size. Unpacked into a [shared directory](shared_toolchain_dir) of its own, keyed on its own
/// digest.
///
/// It is a **static archive** rather than a directory of objects, and that is what makes a library a
/// program does not import cost it nothing: `lld` pulls archive members, so an artifact for a
/// program that imports none of them is byte for byte the size of one built without the archive on
/// the command line at all. Measured; passing the objects directly added ~2.7 MB to every artifact
/// on this arm, used or not, because `--gc-sections` cannot strip what a reflection metadata table
/// names.
const LIBRARIES_TAR_GZ: &[u8] = include_bytes!(concat!(
    env!("GG_ARTIFACTS_SWIFT"),
    "/swift.libraries.tar.gz"
));

/// The `wasi_snapshot_preview1` **reactor** adapter, which turns the preview1 core module the Swift
/// SDK emits into the preview 2 component gg's engine instantiates.
///
/// In memory rather than in the archive above, because this is the one input the *encoder* needs
/// and not the compiler: it never touches a filesystem.
const ADAPTER: &[u8] = include_bytes!(concat!(env!("GG_ARTIFACTS_SWIFT"), "/swift.adapter.wasm"));

/// What the archives were built by, and what is in them.
const MANIFEST_JSON: &str =
    include_str!(concat!(env!("GG_ARTIFACTS_SWIFT"), "/swift.toolchain.json"));

/// The environment variable an operator points at the Swift toolchain tree when it is not where gg
/// looks.
pub(super) const SWIFT_HOME_ENV: &str = "TCAB_GG_SWIFT_HOME";

/// Where `containers/gg-toolchains` installs this arm's toolchain in a gg run image.
const IMAGE_HOME: &str = "/opt/gg/toolchains/swift";

/// Where `scripts/ci/install-swift.sh` installs it on a developer's or CI machine, relative to
/// `HOME`.
///
/// Looked at after the image path rather than instead of it, so a run container never depends on a
/// home directory and a developer never has to export anything. A **tree** rather than a binary on
/// `PATH`, because this arm needs three things that must agree — a compiler, the wasm SDK, and the
/// shared libraries the compiler's linker was built against — and a `swiftc` on `PATH` says nothing
/// about where the other two are.
const USER_HOME_SUFFIX: &str = ".local/share/tcab/gg-swift";

/// How long one `swiftc` may take before it is killed and reported as a
/// [toolchain failure](PrepareFailure::Toolchain).
///
/// A compile here is ~0.3 s and the worst honest case — a program with a great deal of generic
/// instantiation, or type inference over a large literal — is seconds. Two minutes is
/// unmistakably a hang, and is longer than the Rust arm's minute because this compiler is doing
/// considerably more work per invocation: it type-checks, optimises and links, all in one process.
const COMPILE_TIMEOUT: Duration = Duration::from_secs(120);

/// The file a model's reply is compiled as — **verbatim**.
///
/// The name is load-bearing rather than conventional: Swift admits top-level statements only in a
/// file called `main.swift`, so this is what lets a reply be a sequence of statements *and*
/// contain an `extension`.
pub(super) const PROGRAM_FILE: &str = "main.swift";

/// What `swiftc` is told to write, in this preparation's own output directory.
const ARTIFACT_FILE: &str = "program.wasm";

/// The clang module map that declares [`GgShell`](self), which gg's shell imports and the model's
/// own file does not.
///
/// Named on `-Xcc -fmodule-map-file` rather than discovered from a header search path, so the one
/// file of the program's module that reaches gg's wire is the one that wrote `import GgShell`.
const MODULE_MAP_FILE: &str = "module.modulemap";

/// What a preparation's own tree is called in anything the compiler records — a diagnostic's path,
/// a debug-information file entry, a located trap's frame.
const PREPARATION_PREFIX: &str = "/gg";

/// **`-g`, and it is this arm's whole error surface** rather than a debugging convenience.
///
/// The expectation going in was that Swift's runtime *prints* its failures — `Fatal error: Index
/// out of range` — and that gg would read them off the guest's stderr. It does not, at `-Osize`:
/// the optimiser replaces the report-and-trap with a bare `unreachable` and **encodes the message
/// in the debug information**, as the name of a synthetic inlined frame. What comes back from a
/// trap, with `-g` here and [`wasm_backtrace_details`](crate::sandbox::engine) on the engine, is
/// this:
///
/// ```text
/// 0: 0x11870 - Swift runtime failure: Index out of range
///                at /<compiler-generated>
///            - $sSayxSicigSi_Tg5
///            - __main_argc_argv
///                at /gg/work/main.swift:3:22
/// ```
///
/// The message *and* the model's own line and column, for a failure class the guest cannot catch at
/// all. Without it the same program yields `program.wasm!main` and nothing else — no message, no
/// line — which would be the worst error surface of any arm here by a wide margin. Both readings
/// are in `swift.substrate.test.rs`.
///
/// It costs ~5.6 KB of a ~7.1 MB artifact, which is nothing, and one real complication: debug
/// information records the **compilation environment** — the hashes and paths of the clang module
/// cache, computed over an invocation naming this preparation's own working directory, `HOME` and
/// `TMPDIR` — so two preparations of one program produce different debug sections. That is a
/// consequence of the [isolation contract](super::compile) rather than a breach of it, and every
/// way round it was measured and rejected (`-file-prefix-map` rewrites the paths but not the
/// hashes; `-gline-tables-only` still carries them; a shared warm module cache still hashes the
/// working directory). It costs the seam's
/// isolation gate (`language/isolation.rs`) nothing, because that gate searches an
/// artifact for its own program's marker rather than comparing two artifacts — the marker lives in
/// the data section and the debug sections are beside the point. It did cost that gate a great deal
/// while it also compared bytes, which is one of the three reasons that comparison was deleted.
const DEBUG_INFO: &str = "-g";

/// What the embedded archive was built by, and what is in it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    /// The Swift release the shell is written for and a program is compiled by.
    swift: String,
    /// The Swift SDK for WebAssembly a program's standard library comes from. The same release;
    /// recorded separately because it is a separate download an operator may have to check.
    #[allow(dead_code)]
    wasm_sdk: String,
    /// The target triple a program is compiled to.
    target: String,
    /// The `wit-bindgen` release the C bindings in the archive were generated by.
    #[allow(dead_code)]
    wit_bindgen: String,
    /// The wasmtime release [`ADAPTER`] came from.
    #[allow(dead_code)]
    adapter: String,
    /// The third-party packages the [library set](LIBRARIES_TAR_GZ) was vendored from, by release
    /// tag. Recorded so a reader of the embedded archive knows which sources produced it, and so a
    /// bump is visible in a diff of one line rather than only in three megabytes of binary.
    #[allow(dead_code)]
    packages: std::collections::BTreeMap<String, String>,
    /// Every module a program may `import` out of the library set, which is what [`libraries`]
    /// unpacks and what `libraries.txt` claims.
    modules: Vec<String>,
    /// Every file in the guest archive.
    files: Vec<GuestFile>,
}

/// One file in the embedded archive.
#[derive(Debug, Deserialize)]
struct GuestFile {
    /// Its name, which is also its name inside the unpacked tree.
    name: String,
    /// How big it is. Recorded so a truncated archive is visible in the manifest rather than only
    /// in a compile failure.
    #[allow(dead_code)]
    bytes: u64,
}

/// The parsed manifest, read once per process.
fn manifest() -> &'static Manifest {
    static MANIFEST: std::sync::OnceLock<Manifest> = std::sync::OnceLock::new();
    MANIFEST.get_or_init(|| {
        serde_json::from_str(MANIFEST_JSON)
            .expect("the embedded Swift toolchain manifest is valid JSON of the expected shape")
    })
}

/// The Swift release a program is compiled with, for the run's own record and for an operator
/// reading a diagnostic and wondering whose it is.
pub(super) fn compiler_version() -> &'static str {
    &manifest().swift
}

/// The target triple a program is compiled to.
pub(super) fn target() -> &'static str {
    &manifest().target
}

/// Every file the embedded archive holds, in the order the manifest lists them.
pub(super) fn guest_files() -> impl Iterator<Item = &'static str> {
    manifest().files.iter().map(|file| file.name.as_str())
}

/// Every module a program of this language may `import` out of the embedded library set.
///
/// Read off the manifest the build wrote, so what gg believes it ships and what it really shipped
/// are one statement. The *model-facing* list is `packages/gg-sandbox-swift/libraries.txt`, and the
/// surface gate compares the two.
pub(super) fn library_modules() -> impl Iterator<Item = &'static str> {
    manifest().modules.iter().map(String::as_str)
}

/// Unpack both embedded archives now, so the first compile does not.
///
/// The whole of this language's warm-up: 185 KB and 3.4 MB decompressed, once per machine. The
/// results are dropped, because a failure here is the failure the first compile will make, and
/// there it is classified, counted and reported.
pub(super) fn warm() {
    let _ = guest();
    let _ = libraries();
}

// ---------------------------------------------------------------------------------------------
// The two compiles
// ---------------------------------------------------------------------------------------------

/// Compile a **program** — a model's reply — into the component that evaluates it.
///
/// [`source`](PreparedProgram::source) is empty for the same reason the Rust arm's is: there is
/// nothing left for a guest to evaluate, because the guest *is* what this returned.
pub(super) fn compile_program(
    source: &str,
    modules: &[CodeModule],
    context: &PrepareContext,
) -> Result<PreparedProgram, PrepareFailure> {
    Ok(PreparedProgram {
        source: String::new(),
        component: Some(compile(source, modules, context)?),
    })
}

/// Compile one model program, and the code modules in its scope, into the component that evaluates
/// it — or say why it could not be.
///
/// The modules go first, one `swiftc` each, because each is a Swift module the program's own compile
/// resolves and links rather than a further file of it.
fn compile(
    program: &str,
    modules: &[CodeModule],
    context: &PrepareContext,
) -> Result<Vec<u8>, PrepareFailure> {
    let guest = guest().map_err(PrepareFailure::Toolchain)?;
    let libraries = libraries().map_err(PrepareFailure::Toolchain)?;
    let home = swift_home().map_err(PrepareFailure::Toolchain)?;
    let workspace = context.workspace().map_err(PrepareFailure::Toolchain)?;

    let built = build_modules(modules, guest, libraries, &home, workspace, context)?;

    // Verbatim. Nothing is prepended, appended or re-indented, which is what makes every line and
    // column below the model's own.
    workspace
        .write(PROGRAM_FILE, program)
        .map_err(PrepareFailure::Toolchain)?;

    let artifact = workspace.output().join(ARTIFACT_FILE);
    let sources = [PROGRAM_FILE.to_string()];
    let build = Build {
        sources: &sources,
        output: Output::Program {
            modules: built.as_ref(),
            artifact: &artifact,
        },
    };
    let report = invoke_swiftc(build, guest, libraries, &home, workspace, context)
        .map_err(PrepareFailure::Toolchain)?;
    classify(&report)?;

    let module = std::fs::read(&artifact).map_err(|error| {
        PrepareFailure::Toolchain(format!(
            "swiftc {} reported success and wrote no module to {}: {error}",
            compiler_version(),
            artifact.display(),
        ))
    })?;
    componentize(&module).map_err(PrepareFailure::Toolchain)
}

/// Prepare a **code module** — the code half of a skill or a memory — by building it into the Swift
/// module every program that imports it resolves, and read the names it offers.
///
/// This is where a module is compiled and the only place. `key` is the binding key, which on this
/// arm is the Swift module's own name, so the `.swiftmodule` and the object land in that key's
/// directory in the [band](crate::sandbox::Workspace::open_module) and every program the agent
/// writes afterwards is given the `-I` that resolves them and the object to link.
///
/// It is a full build at the program's own `-Osize -g`, because the object is linked into the
/// artifact and a trap inside a skill's own code should symbolicate to the line its author wrote.
/// What running it here buys is the **location**: a module that does not build fails on the turn
/// that loaded it, at its author's own line, rather than on every later turn in a file the model
/// never wrote.
pub(super) fn compile_module(
    key: &str,
    source: &str,
    context: &PrepareContext,
) -> Result<PreparedModule, PrepareFailure> {
    let guest = guest().map_err(PrepareFailure::Toolchain)?;
    let libraries = libraries().map_err(PrepareFailure::Toolchain)?;
    let home = swift_home().map_err(PrepareFailure::Toolchain)?;
    let workspace = context.workspace().map_err(PrepareFailure::Toolchain)?;

    build_module(key, source, guest, libraries, &home, workspace, context)?;

    Ok(PreparedModule {
        source: source.to_string(),
        exports: super::source::exports(source),
    })
}

/// Build one code module into a Swift module of its own, inside that key's directory in the band,
/// and record what it produced.
///
/// One `swiftc`, since a `swiftc` builds one module.
fn build_module(
    key: &str,
    source: &str,
    guest: &Guest,
    libraries: &Path,
    home: &Path,
    workspace: &Workspace,
    context: &PrepareContext,
) -> Result<(PathBuf, PathBuf), PrepareFailure> {
    refuse_a_supplied_name(key)?;
    let name = super::source::module_file(key);
    let into = workspace
        .open_module(key)
        .map_err(PrepareFailure::Toolchain)?;
    workspace
        .write_module(key, &name, &super::source::module_source(source))
        .map_err(PrepareFailure::Toolchain)?;

    let object = into.join(format!("{key}.o"));
    let sources = [workspace.module_path(key, &name)];
    let build = Build {
        sources: &sources,
        output: Output::Module {
            name: key,
            into: &into,
            object: &object,
        },
    };
    let report = invoke_swiftc(build, guest, libraries, home, workspace, context)
        .map_err(PrepareFailure::Toolchain)?;
    classify(&report)?;
    let interface = into.join(format!("{key}.swiftmodule"));
    workspace.record_module(key, source, vec![interface, object.clone()]);
    Ok((into, object))
}

/// What the program's compile needs to reach the code modules in scope: one `-I` per module, and the
/// object each compiled to.
///
/// `None` for an agent that has loaded nothing, so an ordinary program's command line is exactly what
/// it was before code modules existed — which is what keeps the artifact of a program with no modules
/// byte for byte what it was.
///
/// A module reaching here was built at the read that loaded it, so this names that build. A module
/// this agent's workspace holds no build of — the one a test or the authorship gate hands straight to
/// the program step — is built here and recorded, so the program after it names one.
fn build_modules(
    modules: &[CodeModule],
    guest: &Guest,
    libraries: &Path,
    home: &Path,
    workspace: &Workspace,
    context: &PrepareContext,
) -> Result<Option<Modules>, PrepareFailure> {
    if modules.is_empty() {
        return Ok(None);
    }
    let mut search = Vec::with_capacity(modules.len());
    let mut objects = Vec::with_capacity(modules.len());
    for module in modules {
        let built = match workspace.module_build(&module.name, &module.source) {
            Some(artifacts) if artifacts.len() == 2 => {
                (workspace.module_dir(&module.name), artifacts[1].clone())
            }
            _ => build_module(
                &module.name,
                &module.source,
                guest,
                libraries,
                home,
                workspace,
                context,
            )?,
        };
        search.push(built.0);
        objects.push(built.1);
    }
    Ok(Some(Modules { search, objects }))
}

/// Refuse a binding key that names a Swift module every compile here already supplies.
///
/// A code module is compiled under its key, so a key that is `gg`, the program's own module name, or
/// one a program may already `import` would produce two modules of one name in a single compile. The
/// refusal names the collision, which is a thing the run's operator can fix by renaming the skill;
/// the alternative is a resolution nobody chose, or a duplicate symbol from `lld` that names nobody.
///
/// The library names are read from the catalogue's own `libraries` section rather than from the
/// [archive's manifest](library_modules), because that section is the whole set a program may import
/// and the archive carries only the vendored part of it.
fn refuse_a_supplied_name(key: &str) -> Result<(), PrepareFailure> {
    let libraries = super::SWIFT
        .catalogue()
        .libraries
        .iter()
        .flat_map(|group| group.modules.iter().map(String::as_str));
    let supplied = [super::SURFACE_MODULE, SHELL_MODULE, PROGRAM_MODULE]
        .into_iter()
        .chain(libraries)
        .any(|module| module == key);
    match supplied {
        false => Ok(()),
        true => Err(PrepareFailure::Program(PrepareError::Unsupported(format!(
            "a code module is compiled as a Swift module named for the key it is bound at, and \
             `{key}` is already the name of a module every program here is compiled against. Rename \
             the skill or memory whose code is bound at `{key}`."
        )))),
    }
}

/// The Swift module a program is compiled as, stated rather than derived from the artifact's file
/// name — because [what a key may not be](refuse_a_supplied_name) is read off it.
const PROGRAM_MODULE: &str = "program";

/// The clang module the generated bindings are declared in, which gg's shell imports.
const SHELL_MODULE: &str = "GgShell";

/// The code modules a program is compiled against: where their `.swiftmodule` files are, and the
/// objects the link needs.
struct Modules {
    /// One directory per module, each named on an `-I` of the program's own compile.
    search: Vec<PathBuf>,
    /// One object per module, in the order the modules were handed over.
    objects: Vec<PathBuf>,
}

/// What one `swiftc` is asked to read and to write.
struct Build<'a> {
    /// The files named **relatively**, which is what puts a diagnostic in them in the author's own
    /// coordinates and what tells one from a diagnostic in gg's own inputs: the model's `main.swift`,
    /// or the one file of the code module being built.
    sources: &'a [String],
    /// Which of the three things this invocation is.
    output: Output<'a>,
}

/// The three shapes a `swiftc` here takes.
#[derive(Clone, Copy)]
enum Output<'a> {
    /// A model's program: optimised, carrying its debug information, and linked into `artifact`
    /// together with the objects its code modules compiled to.
    Program {
        modules: Option<&'a Modules>,
        artifact: &'a Path,
    },
    /// One code module, built into a Swift module called `name`, whose `.swiftmodule` goes in `into`
    /// and whose code goes in `object`.
    Module {
        name: &'a str,
        into: &'a Path,
        object: &'a Path,
    },
}

// ---------------------------------------------------------------------------------------------
// The compiler
// ---------------------------------------------------------------------------------------------

/// Spawn `swiftc` over one Swift module — a model's program, or one code module in its scope.
///
/// One invocation does the whole of each — type-check, optimise, and for a program link — because
/// the Swift driver's notion of a build is a whole module and there is nothing to be gained by
/// splitting one. The source is named **relatively** while everything else is absolute: the command's
/// working directory is this preparation's own, so a diagnostic in the model's program reads
/// `main.swift:7` and one in a code module reads `module_csvTools.swift:2`, where a diagnostic in one
/// of gg's own files is unmistakable because it carries a path.
fn invoke_swiftc(
    build: Build<'_>,
    guest: &Guest,
    libraries: &Path,
    home: &Path,
    workspace: &Workspace,
    context: &PrepareContext,
) -> Result<CompilerReport, String> {
    let swiftc = home.join("toolchain/usr/bin/swiftc");
    let sdk = home.join("sdk");
    let mut command = context
        .compiler(&swiftc)
        .map_err(|error| format!("{}{error}", spawn_prefix(home)))?;
    command
        .arg("-target")
        .arg(target())
        // The wasm sysroot (libc, its headers) and the wasm standard library, which the SDK calls a
        // resource directory. Named explicitly rather than through `--swift-sdk`, which resolves an
        // installed SDK out of a per-user store gg would then have to populate and keep isolated.
        .arg("-sdk")
        .arg(sdk.join("WASI.sdk"))
        .arg("-resource-dir")
        .arg(sdk.join("swift.xctoolchain/usr/lib/swift_static"))
        // A component is one self-contained module; there is nothing inside it to dynamically link
        // against, and the SDK's own toolset says so too.
        .arg("-static-stdlib")
        // Whole-module: one file is one module here, whether it is the model's program or a code
        // module of its own. gg's shell is in neither — an access level is module-wide, so a shell
        // compiled beside the reply would put gg's own two exports into the model's file with no
        // line the model wrote.
        .arg("-wmo")
        // The generated WIT surface, reached from Swift as C — what gg's shell calls, and what
        // declares the model program's own entry point so the shell can call *it*. A clang
        // **module map** rather than `-import-objc-header`, and the difference is which files see
        // it: a bridging header is module-scoped and put gg's wire, `malloc` and the entry-point
        // symbol into the model's own `main.swift` with no line the model wrote, where an `import
        // GgShell` reaches them in the shell's own module alone.
        .arg("-Xcc")
        .arg(format!(
            "-fmodule-map-file={}",
            guest.file(MODULE_MAP_FILE).display()
        ))
        // Where `gg.swiftmodule` and the library set's modules are found — packaging, which tells
        // the compiler the library exists and puts no name in scope. A reply reaches gg's surface
        // by writing `import gg`, which resolves here; a reply that writes no import reaches
        // nothing gg carries. A program's own `import Collections` resolves here too.
        .arg("-I")
        .arg(guest.tree())
        .arg("-I")
        .arg(libraries)
        // `RealModule` reaches its C shims through a clang module map, which a program importing
        // it (or `Algorithms`, which depends on it) needs on the include path.
        .arg("-Xcc")
        .arg("-I")
        .arg("-Xcc")
        .arg(libraries.join("include"))
        // Every path this preparation's own tree contributes to the artifact, rewritten to a fixed
        // one. A model that traps is shown the frame, and `/gg/work/main.swift:7:13` is a thing it
        // can read, where `/tmp/gg-prepare/8421-3/work/main.swift:7:13` names a directory that was
        // deleted before the message reached it. It does *not* make the artifact a function of the
        // program: the paths are rewritten and the module-cache hashes computed over them are not,
        // so this arm claims no byte-stability — unlike the C++ arm, whose identical-looking flag
        // does buy it. Nothing depends on the difference; the seam's isolation gate searches for
        // markers rather than comparing artifacts.
        .arg("-file-prefix-map")
        .arg(format!("{}={PREPARATION_PREFIX}", workspace.root().display()));

    match build.output {
        // A program's build: optimised, carrying its debug information, and linked.
        Output::Program { modules, artifact } => {
            command.arg("-module-name").arg(PROGRAM_MODULE);
            // Where the code modules in scope are found, on the same terms gg's own SDK is: an `-I`
            // tells the compiler the modules exist and puts no name in scope, so a program reaches
            // one by writing its `import` and a program that writes none reaches nothing. Last of
            // the three, and a key that names a module the two above already carry is
            // [refused](refuse_a_supplied_name) rather than left to shadow one.
            for directory in modules.iter().flat_map(|modules| &modules.search) {
                command.arg("-I").arg(directory);
            }
            command
                // Size, because the engine compiles this artifact on every turn and a smaller
                // module is a cheaper turn. `-Osize` rather than `-O` because the difference in
                // generated code is immaterial for a program that runs for milliseconds and the
                // difference in bytes is not.
                .arg("-Osize")
                .arg(DEBUG_INFO)
                // The link is handed to clang, and these three are for it. The SDK's clang resource
                // directory holds the wasm `compiler-rt`; the host's, which clang would otherwise
                // derive from its own path, holds only the host's.
                .arg("-Xclang-linker")
                .arg("-resource-dir")
                .arg("-Xclang-linker")
                .arg(sdk.join("swift.xctoolchain/usr/lib/clang"))
                // A **reactor**, not a command: a component's exports are called after
                // `_initialize`, and the default execution model would insist on a `_start` this
                // guest does not have — and would run the model's program at instantiation rather
                // than when `run` is called.
                .arg("-Xclang-linker")
                .arg("-mexec-model=reactor")
                .arg("-Xlinker")
                .arg("--gc-sections")
                .arg("-o")
                .arg(artifact);
        }
        // One code module: a Swift module of its own, emitted beside the object a program's link
        // will pull it in from. `-parse-as-library` is what makes it declarations — the file is the
        // only one of its module, and a lone Swift file is otherwise read as a script whose
        // statements run.
        Output::Module { name, into, object } => {
            command
                .arg("-parse-as-library")
                .arg("-module-name")
                .arg(name)
                .arg("-Osize")
                .arg(DEBUG_INFO)
                .arg("-emit-module-path")
                .arg(into.join(format!("{name}.swiftmodule")))
                .arg("-c")
                .arg("-o")
                .arg(object);
        }
    }
    for source in build.sources {
        command.arg(source);
    }
    if let Output::Program { modules, .. } = build.output {
        command
            // gg's shell, compiled ahead of time as a module of its own and only linked here. It
            // is what the world's two exports resolve to, and it reaches the model's top-level
            // code through `__main_argc_argv`, which is what Swift lowers a top-level file into on
            // this target and which the linker resolves like any other C symbol.
            .arg(guest.file("shell.o"))
            .arg(guest.file("gg.o"))
            .arg(guest.file("sandbox.o"))
            .arg(guest.file("sandbox_component_type.o"));
        // The code modules in scope, ahead of the archive because a static archive is searched for
        // what is undefined by the time the linker reaches it.
        for object in modules.iter().flat_map(|modules| &modules.objects) {
            command.arg(object);
        }
        // Last, and an archive rather than a list of objects: the linker resolves what is still
        // undefined out of its members, so a program that imports none of the curated libraries
        // links none of them and pays nothing for them.
        command.arg(libraries.join(LIBRARY_ARCHIVE));
    }
    // Applied after the seam's redirection and pointing at a read-only path outside this
    // preparation's tree, which is the escape hatch `compile.rs` documents. The published
    // toolchain's `lld` links against Debian 12's `libxml2` soname; a gg run image derived from
    // Debian bookworm has it, `blender-gg`'s Ubuntu does not, and this same tree is copied to the
    // same absolute path in both. So the closure travels with the toolchain and is named here. It
    // selects which shared library the linker loads and can change no verdict.
    command.env("LD_LIBRARY_PATH", home.join("lib"));
    command
        .run(COMPILE_TIMEOUT)
        .map_err(|error| match error.starts_with("could not run") {
            true => format!("{}{error}", spawn_prefix(home)),
            false => error,
        })
}

/// What a failure to start the compiler is prefixed with, because it is the one failure here an
/// operator can actually fix: the toolchain is not where gg looked.
fn spawn_prefix(home: &Path) -> String {
    format!(
        "gg compiles every Swift program with the toolchain in the gg run image and looked for it \
         in {} (set {SWIFT_HOME_ENV}, or run scripts/ci/install-swift.sh): ",
        home.display()
    )
}

// ---------------------------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------------------------

/// Decide what a finished `swiftc` means: nothing, a program the compiler rejected, or a compiler
/// that could not finish.
///
/// **One band**, and that is a fact about the language rather than a shortcut. `swiftc` has no
/// parse-only phase a program passes before meaning is considered — an unclosed brace and a type
/// error are both an `error:` from one invocation, reported together and undistinguished — so
/// everything it rejects is [`PrepareError::Compile`], exactly as everything `rustc` rejects is.
///
/// The one thing this does distinguish is **whose file** the error is in, and it distinguishes it
/// three ways rather than two. A diagnostic located in `main.swift` is the model's. One located in
/// another file is in gg's own shell or bindings, which no model wrote and none can fix. And one
/// with no location at all did not come from reading a program — a link that failed, a driver that
/// could not find a tool — so it is the toolchain's too, and is reported with the compiler's own
/// words rather than as "your program did not compile". Both of the latter are a
/// [toolchain failure](PrepareFailure::Toolchain), which is the safe direction: a model told to fix
/// a program that was never wrong is the one misattribution this codebase spends the most effort
/// not making.
fn classify(report: &CompilerReport) -> Result<(), PrepareFailure> {
    if report.ok {
        return Ok(());
    }
    let diagnostics = errors(&report.stderr);
    if diagnostics.is_empty() {
        // A compiler that could not finish: it crashed, was killed by its timeout, or fell over on
        // an expression it could not fold. `swiftc` 6.3.3 is known to abort on some programs, so
        // this is a real path rather than a defensive one — and it must never reach the model as
        // "your program did not compile", because nothing was ever decided about the program.
        return Err(PrepareFailure::Toolchain(format!(
            "swiftc {} {}{}",
            compiler_version(),
            report.status,
            report.stderr_tail(),
        )));
    }
    if let Some(foreign) = diagnostics.iter().find(|line| located_elsewhere(line)) {
        return Err(PrepareFailure::Toolchain(format!(
            "swiftc {} rejected gg's own guest rather than the model's program: {foreign}",
            compiler_version(),
        )));
    }
    if let Some(unlocated) = diagnostics.iter().find(|line| !is_program_diagnostic(line)) {
        return Err(PrepareFailure::Toolchain(format!(
            "swiftc {} failed without reading a program: {unlocated}",
            compiler_version(),
        )));
    }
    Err(PrepareFailure::Program(PrepareError::Compile(rendered(
        &report.stderr,
    ))))
}

/// Every `error:` line in a `swiftc` run, in order.
///
/// Lines rather than a parse tree, because Swift's diagnostics are already one line each with the
/// location in front of them, and the surrounding source-snippet lines the compiler draws are the
/// half a model gains most from — so they are kept whole rather than reduced to fields.
fn errors(stderr: &str) -> Vec<&str> {
    stderr.lines().filter(|line| is_error(line)).collect()
}

/// Whether a line **opens** a diagnostic — `swiftc`'s located `error:` header, the line the excerpt
/// and the caret under it belong to.
///
/// One predicate rather than the same `contains` written in three places, because all three are
/// answering the same question and must not be able to disagree: which lines
/// [classification](classify) counts as diagnostics, where [the rendering](rendered) stops treating
/// lines as part of a warning, and where a [group](SHOWN) begins when the rendering is bounded.
///
/// A **located** `: error: ` rather than `error:` anywhere, which is what this arm has always
/// matched and is the opposite choice from the warning match beside it. A driver's own `error:`,
/// printed with nothing in front of it, is not a compiler reading a program, and both ways it can
/// arrive end in a [toolchain failure](PrepareFailure::Toolchain): either nothing matches here at
/// all, or what matched is located somewhere no model wrote.
fn is_error(line: &str) -> bool {
    line.contains(": error: ")
}

/// Whether a diagnostic line is located in a file the **model's session** owns: its own program, or
/// one of the code modules its skills and memories put in scope.
///
/// The compiler is run with its working directory inside this preparation's own tree and both kinds
/// of file named relatively, so their diagnostics begin `main.swift:` or `module_<key>.swift:`.
/// Everything else on the command line — gg's shell, the bindings, the library archive — is named
/// absolutely, and a diagnostic in one of those begins with a `/`.
///
/// A module's file is matched by its **name** rather than by the whole path, because a program's own
/// compile reads its code modules as built modules rather than as source: a location the compiler
/// recovers from one's recorded source information is the absolute path that module was compiled
/// under, and it is still the model's file.
///
/// A module's diagnostic is the model's rather than gg's, and it is deliberately *not* filed under
/// the toolchain: it names a file the model can see the effect of and act on, by not calling that
/// skill's code. The module was already checked on its own when it was read, so a diagnostic here is
/// a module that has stopped building since — which is precisely the thing the model needs told.
fn is_program_diagnostic(line: &str) -> bool {
    let located = located_in(line);
    located == PROGRAM_FILE
        || located
            .rsplit('/')
            .next()
            .is_some_and(|file| file.starts_with(MODULE_FILE_PREFIX))
}

/// Whether a diagnostic line is located in a file that is **not** the model's — which on this arm
/// means one of gg's own inputs, since those are the only other files named on the command line.
///
/// Distinct from `!is_program_diagnostic`, because a diagnostic with no location at all is neither:
/// a driver that could not find a tool and a link that failed both say `error:` with nothing in
/// front of it.
fn located_elsewhere(line: &str) -> bool {
    line.starts_with('/') && !is_program_diagnostic(line)
}

/// The file a `swiftc` diagnostic is located in — everything in front of its first `:`, which is
/// where the line and column follow.
fn located_in(line: &str) -> &str {
    line.split(':').next().unwrap_or_default()
}

/// The compiler's own output, as the model is shown it.
///
/// Unaltered but for two things gg owes the reader. The **warnings** are dropped, because a model's
/// program is not being reviewed and an unused variable that failed a turn would be gg imposing a
/// lint policy on an experiment about capability — and the match is on `warning:` anywhere rather
/// than on a *located* `: warning: `, because the driver has one of its own that is located nowhere
/// (`warning: Unable to locate libSwiftScan`, which the toolchain's pruning deliberately provokes;
/// see `scripts/ci/install-swift.sh`) and a model must not be shown gg's own toolchain notes. And
/// the compiler's summary of how it exited is dropped with them, because it is about the process
/// rather than the program.
///
/// What is left is then **bounded** — see [`SHOWN`] for the number and the measurement behind it —
/// and bounded in place rather than by rebuilding the text, because on this arm a diagnostic is a
/// picture: the header, the source line `swiftc` drew under it and the caret it drew under that only
/// mean anything while they are still lined up.
fn rendered(stderr: &str) -> String {
    let mut kept: Vec<&str> = Vec::new();
    let mut in_warning = false;
    for line in stderr.lines() {
        if is_error(line) {
            in_warning = false;
        } else if line.contains("warning: ") || line.contains(": note: ") {
            in_warning = true;
        }
        if !in_warning {
            kept.push(line);
        }
    }
    crate::sandbox::language::diagnostics::capped_lines(kept.join("\n").trim(), is_error, SHOWN)
}

/// How many of `swiftc`'s errors a model is shown.
///
/// [Kotlin's eight](super::super::kotlin), and this arm is the reason there is a number at all. The
/// measured mistake — one misremembered SDK name called at fifty call sites — is **11614 bytes
/// across 395 lines** here, the worst of the eight arms measured and nearly twice the next, because
/// `swiftc` draws the offending source line and a caret under every error: ~232 bytes and ~8 lines
/// apiece where a [Roslyn](super::super::csharp) diagnostic is one line of ~97. Eight of them is
/// ~1.9 KB and ~63 lines, and the other forty-two become one sentence.
///
/// Eight rather than [C++'s four](super::super::cpp), even though both arms keep an excerpt, because
/// a group here has a *bounded* size. A `clang` error drags an instantiation backtrace of unbounded
/// depth behind it and the model's own line can be thirty notes into it; `swiftc` has no template
/// instantiation to unwind, and [the rendering above](rendered) has already dropped every `note:`, so
/// eight groups is eight headers and the picture each drew — the ~8 lines the measurement recorded —
/// with no backtrace tail for the number to have to allow for.
///
/// It bounds what the model **reads** and nothing else. Which band the compilation falls in —
/// whether a diagnostic sits in gg's own guest, and whether anything was located in a program at all
/// — is decided by [`classify`] over the compiler's whole `stderr`, before a line of it is dropped.
const SHOWN: usize = 8;

// ---------------------------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------------------------

/// Encode the core module `swiftc` linked as the component gg's engine instantiates.
///
/// In process, from the bytes the compiler wrote, with no `wasm-tools` binary to install in a run
/// container — the same encode the Rust arm does, with one addition this arm cannot do without.
/// The Swift SDK targets `wasm32-unknown-wasip1`, so the module it produces imports the preview1
/// snapshot; [`ADAPTER`] is what implements those imports in terms of the preview 2 interfaces gg's
/// linker provides. Without it the component would import a WASI generation the host does not have.
fn componentize(module: &[u8]) -> Result<Vec<u8>, String> {
    wit_component::ComponentEncoder::default()
        .validate(true)
        .module(module)
        .and_then(|encoder| encoder.adapter(ADAPTER_NAME, ADAPTER))
        .and_then(|mut encoder| encoder.encode())
        .map_err(|error| {
            format!(
                "swiftc {} compiled the program and gg could not encode it as a component: \
                 {error:#}",
                compiler_version()
            )
        })
}

/// The import namespace the adapter satisfies, which is the preview1 snapshot's own module name.
const ADAPTER_NAME: &str = "wasi_snapshot_preview1";

// ---------------------------------------------------------------------------------------------
// The toolchain and the embedded guest
// ---------------------------------------------------------------------------------------------

/// Where this arm's toolchain tree is: what an operator said, then what a gg run image guarantees,
/// then where `scripts/ci/install-swift.sh` puts it.
///
/// Kept in step with `gg_swift_home` in `packages/gg-sandbox-swift/swift-version.sh`, which is what
/// the installer and the image build resolve.
pub(super) fn swift_home() -> Result<PathBuf, String> {
    if let Ok(configured) = std::env::var(SWIFT_HOME_ENV)
        && !configured.is_empty()
    {
        return Ok(PathBuf::from(configured));
    }
    let image = PathBuf::from(IMAGE_HOME);
    if image.join("toolchain/usr/bin/swiftc").is_file() {
        return Ok(image);
    }
    let Some(user) = std::env::var_os("HOME") else {
        return Ok(image);
    };
    Ok(PathBuf::from(user).join(USER_HOME_SUFFIX))
}

/// Where the embedded archive is unpacked, for this process.
pub(super) struct Guest {
    /// The directory holding every file the archive carried.
    tree: PathBuf,
}

impl Guest {
    /// One of the archive's files, by the name the manifest gives it.
    pub(super) fn file(&self, name: &str) -> PathBuf {
        self.tree.join(name)
    }

    /// The directory itself, which is what `swiftc -I` is given so `gg.swiftmodule` resolves.
    pub(super) fn tree(&self) -> &Path {
        &self.tree
    }
}

/// The unpacked guest, materialised once per process.
pub(super) fn guest() -> Result<&'static Guest, String> {
    static GUEST: std::sync::OnceLock<Result<Guest, String>> = std::sync::OnceLock::new();
    GUEST
        .get_or_init(materialise)
        .as_ref()
        .map_err(Clone::clone)
}

/// Unpack the embedded archive into a [shared toolchain directory](shared_toolchain_dir).
///
/// The seam's one sanctioned share, taken under the seam's discipline: the key folds in the pinned
/// compiler **and** a digest of the archive itself, so a gg carrying different bindings at the same
/// Swift version reads a different directory rather than another build's files; the write goes
/// through [`place_tree`], which fills a staging directory, seals it read-only and renames it in.
///
/// Sharing it needs no further argument than that, because `swiftc` only ever **reads** it: the
/// module map is named on `-Xcc -fmodule-map-file`, the shell and the two objects are inputs, and
/// every artifact goes to this preparation's own output directory.
fn materialise() -> Result<Guest, String> {
    let root = shared_toolchain_dir(&format!(
        "swift-{}-{:016x}",
        compiler_version(),
        fingerprint(GUEST_TAR_GZ)
    ))?;
    let tree = root.join("guest");
    place_tree(&tree, unpack)?;
    Ok(Guest { tree })
}

/// Decompress and extract the embedded archive into `into`.
fn unpack(into: &Path) -> Result<(), String> {
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(GUEST_TAR_GZ));
    // The archive is gg's own build artifact rather than anything a run produced, but the
    // extraction is still confined to `into`: an archive is a file format, and a file format is the
    // wrong place to be trusting.
    archive
        .unpack(into)
        .map_err(|error| format!("could not unpack the embedded Swift guest: {error}"))?;
    for name in guest_files() {
        let path = into.join(name);
        if !path.is_file() {
            return Err(format!(
                "the embedded Swift guest is missing {name}, which its manifest declares"
            ));
        }
    }
    Ok(())
}

/// A digest of an embedded archive, so the [shared directory](shared_toolchain_dir) a process reads
/// is keyed on the bytes it would have written.
fn fingerprint(archive: &[u8]) -> u64 {
    let mut hasher = std::hash::DefaultHasher::new();
    archive.hash(&mut hasher);
    hasher.finish()
}

/// The static archive the [library set](LIBRARIES_TAR_GZ) carries, named on every link.
const LIBRARY_ARCHIVE: &str = "libgglibs.a";

/// The unpacked library set, materialised once per process.
pub(super) fn libraries() -> Result<&'static Path, String> {
    static LIBRARIES: std::sync::OnceLock<Result<PathBuf, String>> = std::sync::OnceLock::new();
    LIBRARIES
        .get_or_init(materialise_libraries)
        .as_ref()
        .map(PathBuf::as_path)
        .map_err(Clone::clone)
}

/// Unpack the embedded library set into a [shared toolchain directory](shared_toolchain_dir) of its
/// own.
///
/// Its own directory rather than the guest's, keyed on its own digest, because the two archives are
/// rebuilt independently: a gg carrying a new SDK and the same libraries should reuse the 3.4 MB it
/// already unpacked, and a gg carrying new libraries must not read a tree another build filled.
///
/// Sharing it needs no further argument than the guest's does, because `swiftc` only ever **reads**
/// it: the archive is a link input, the modules are found by `-I`, and every artifact goes to the
/// preparation's own output directory.
fn materialise_libraries() -> Result<PathBuf, String> {
    let root = shared_toolchain_dir(&format!(
        "swift-libs-{}-{:016x}",
        compiler_version(),
        fingerprint(LIBRARIES_TAR_GZ)
    ))?;
    let tree = root.join("lib");
    place_tree(&tree, |into| {
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(LIBRARIES_TAR_GZ));
        archive
            .unpack(into)
            .map_err(|error| format!("could not unpack the embedded Swift library set: {error}"))?;
        if !into.join(LIBRARY_ARCHIVE).is_file() {
            return Err(format!(
                "the embedded Swift library set is missing {LIBRARY_ARCHIVE}, which every link \
                 names"
            ));
        }
        for module in library_modules() {
            let path = into.join(format!("{module}.swiftmodule"));
            if !path.is_file() {
                return Err(format!(
                    "the embedded Swift library set is missing {module}.swiftmodule, which its \
                     manifest declares"
                ));
            }
        }
        Ok(())
    })?;
    Ok(tree)
}

#[cfg(test)]
#[path = "swift.compile.test.rs"]
mod tests;
