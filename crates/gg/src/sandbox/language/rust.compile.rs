//! **The Rust compile** — how a model's Rust becomes the wasm component that turn is evaluated by.
//!
//! # The strategy, in one sentence
//!
//! A Rust program is **compiled on the host, per turn, into a component of its own**: one `rustc`
//! over the model's own bytes, against a prebuilt library set that ships inside gg's binary, then an
//! in-process [`wit_component`] encode with the pinned preview1 reactor adapter — and what crosses
//! the membrane is not source at all but the artifact gg's engine instantiates.
//!
//! # Why this arm has no guest component, and what that costs
//!
//! Every other arm gg drives ships one: Python's holds a whole CPython, Ruby's holds Opal, the
//! ECMAScript one holds a JavaScript engine, and a program crosses the membrane as a **string** the
//! runtime inside evaluates. Rust has no such runtime. `rustc` does not produce a Rust interpreter
//! that later runs a program; it produces the program, and there is no artifact of the language that
//! is not one particular program. So this is the first arm whose component is
//! [per turn](super::super::PreparedProgram::component), and the seam carries that shape because
//! this arm — and the C++ and Swift arms that follow it — cannot be expressed without it.
//!
//! What it costs is one wasmtime `Component::new` per turn instead of one per process. That is a
//! real cost, it is reported (as
//! [`SandboxOutcome::compile_wait`](crate::sandbox::SandboxOutcome::compile_wait)) rather than
//! hidden, and it is small for the reason the artifacts are small: `wasm-ld` dead-strips unreached
//! code, so a program links only the part of the library set it actually reached. Measured in this
//! repository's dev container, aarch64, best of five per program:
//!
//! | | |
//! | --- | --- |
//! | `rustc` — the whole compile, including the link — and the [`wit_component`] encode | **~45–60 ms** |
//! | wasmtime `Component::new` at `OptLevel::None` | **~15 ms** |
//! | Artifact, program reaching nothing of the SDK's | **~64 KB** |
//! | Artifact, program calling a gg tool | **~79–82 KB** |
//!
//! The two artifact rows are one step rather than a slope, and what it is worth knowing about it is
//! *where* the step is. `fn main() {}` is 63,949 bytes and a program that only logs is 64,581: the
//! standard library and the panic machinery are the floor, and a call that cannot fail costs
//! nothing on top of it. The **first fallible** SDK call is what adds ~14 KB — the error type, and
//! the wire a result decodes through — and every call after it is nearly free: one
//! `views::open_text` is 78,626 bytes and one adding a second fallible read plus a `gg::log` is
//! 81,667. So the figure a model's own program actually costs is the second row, and the first is
//! the floor beneath it rather than a typical turn.
//!
//! The feasibility study priced this arm at 0.15–0.5 s of CPU per compile against a **1.57–4.22 MB**
//! artifact costing 296–317 ms to instantiate. Those figures came from a build topology in which
//! every program relinked the whole binding surface; in the prebuilt-rlib topology this arm actually
//! uses, neither survives. The study's own conclusion — that `-C strip=symbols` is mandatory for
//! size — is kept anyway, and costs nothing: the name section is what it deletes, and a Rust
//! program's failures are located by `std`'s own panic message, printed out of `Location`, which is
//! static data rather than a symbol name.
//!
//! # Why the compiler is not carried, and the library set is
//!
//! The same split every compiled arm here has, for the same two reasons.
//!
//! `rustc` and its `wasm32-wasip1` standard library are **~380 MB** — 109 MB of
//! `librustc_driver`, ~150 MB of LLVM, 98 MB of wasm standard library and `rust-lld` — so it cannot
//! ride inside a single static `tcab` binary. It goes into the gg toolchain image
//! (`containers/gg-toolchains/Dockerfile`) and is found on `PATH` at run time. It is by a wide
//! margin the heaviest toolchain in that image, and that is stated rather than buried.
//!
//! The **library set** goes the other way: 9.4 MB gzipped of `.rlib` — 4.4 MB of that `regex`'s own
//! `regex-syntax` and `regex-automata`, which every program is linked against and almost none uses
//! all of — built once by `packages/gg-sandbox-rust/build.sh`, into the `OUT_DIR` this file embeds
//! it from. It could have gone in the image beside the compiler and deliberately does not, for the
//! reason the PureScript arm's tree does not — gg is
//! copied as a single file into an ephemeral run container whose image was built separately, so a
//! set that lived in the image could be a different vintage from the binary reading it. Once this
//! arm's SDK is compiled into that set, that would mean a model shown one surface in its prompt and
//! compiled against another.
//!
//! **The two halves are pinned to each other by the compiler's version**, harder than any other
//! arm's are. An `.rlib` is a compiler-version-private format: `rustc` refuses one built by any
//! other release outright, with `E0514`. That is why there is no separate pin for this arm's
//! compiler — it is `rust-toolchain.toml`'s, the one every checkout already uses, so there is only
//! one release in the repository to keep in step. See
//! `packages/gg-sandbox-rust/rust-version.sh`.
//!
//! # Isolation
//!
//! This arm needs less of the seam's machinery than any other compiled one, and the reason is worth
//! writing down rather than assuming.
//!
//! `rustc` only ever **reads** the library set. It is named on `-L dependency=` and `--extern`, it
//! is never written to, and nothing is generated into it — so unlike the PureScript arm's tree,
//! which `purs` compiles *into*, this one is used directly out of the
//! [shared toolchain directory](shared_toolchain_dir) with no staging, no hard links and no copy.
//! The directory is content-keyed on the pinned compiler and a digest of the embedded tarball, and
//! it is sealed read-only when it is placed, so a compiler that tried to write into it would fail
//! loudly at the moment it tried.
//!
//! Everything a compile does write goes in this preparation's own workspace, and most of it without
//! this arm having asked: `rustc` writes its incremental and temporary files under `TMPDIR`, and
//! `CARGO_HOME`/`RUSTUP_HOME` derive from `HOME` — all three of which
//! [`PrepareContext::compiler`](super::compile::PrepareContext::compiler) has already redirected
//! into the private tree. The output path is named absolutely, into
//! [`Workspace::output`](super::compile::Workspace::output).
//!
//! There is no compiler daemon and no pool. `rustc` is a one-shot process whose cost is the compile
//! rather than the start-up, and a 45 ms compile has nothing warm to be.

use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;

use crate::sandbox::{
    CodeModule, CompilerReport, PrepareContext, PrepareError, PrepareFailure, PreparedModule,
    PreparedProgram, Workspace, place_tree, shared_toolchain_dir,
};

use super::source::{CRATE_NAME, PROGRAM_FILE, SDK_CRATE};

/// The library set a program is compiled against: every `.rlib` `rustc` links, gzipped, built by
/// `packages/gg-sandbox-rust/build.sh`.
///
/// Embedded for the reason the guest components are: gg is copied as a single file into an ephemeral
/// run container and must carry everything it needs with it.
const LIBRARIES_TAR_GZ: &[u8] =
    include_bytes!(concat!(env!("GG_ARTIFACTS_RUST"), "/rust.libraries.tar.gz"));

/// The `wasi_snapshot_preview1` **reactor** adapter, which turns the preview1 core module `rustc`
/// emits into the preview 2 component gg's engine instantiates.
///
/// In memory rather than in the tarball above, because this is the one input the *encoder* needs and
/// not the compiler: it never touches a filesystem.
///
/// It is this arm's own copy of a file the [C++](super::super::cpp) and [Swift](super::super::swift)
/// arms also carry, and the duplication is deliberate rather than an oversight: each arm pins its
/// adapter from its own version file, and the point of a pin is that bumping one arm's toolchain
/// cannot silently move another arm's ABI.
const ADAPTER: &[u8] = include_bytes!(concat!(env!("GG_ARTIFACTS_RUST"), "/rust.adapter.wasm"));

/// The import namespace the adapter satisfies, which is the preview1 snapshot's own module name.
const ADAPTER_NAME: &str = "wasi_snapshot_preview1";

/// What that set was built by, and what is in it.
const MANIFEST_JSON: &str =
    include_str!(concat!(env!("GG_ARTIFACTS_RUST"), "/rust.toolchain.json"));

/// The environment variable an operator points at `rustc` when it is not where gg looks.
pub(super) const RUSTC_ENV: &str = "TCAB_GG_RUSTC";

/// Where `containers/gg-toolchains` installs this arm's compiler in a gg run image.
///
/// Looked at before `PATH` rather than instead of it: the gg run images put it on `PATH` anyway, and
/// a developer's machine has neither, so the order is "what an operator said, then what the image
/// guarantees, then what the shell would have found".
const TOOLCHAIN_BIN: &str = "/opt/gg/toolchains/rust/bin";

/// How long one `rustc` may take before it is killed and reported as a
/// [toolchain failure](PrepareFailure::Toolchain).
///
/// A compile here is tens of milliseconds, and the worst honest case — a program that instantiates
/// a great deal of generic code — is seconds. A minute is unmistakably a hang.
const COMPILE_TIMEOUT: Duration = Duration::from_secs(60);

/// What `rustc` is told to write, in this preparation's own output directory.
const ARTIFACT_FILE: &str = "program.wasm";

/// What the embedded library set was built by, and what is in it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    /// The `rustc` release that built every `.rlib` in the set — and therefore the only release
    /// that can read them.
    rustc: String,
    /// The target triple they were built for, and the one a program is compiled to.
    target: String,
    /// The `wit-bindgen` release the guest bindings inside them were generated by. Recorded for an
    /// operator reading a binding-shaped diagnostic; nothing routes on it.
    #[allow(dead_code)]
    wit_bindgen: String,
    /// The wasmtime release the embedded [preview1 adapter](ADAPTER) was published with. Recorded
    /// for the same reason and read by nothing: the bytes themselves are what the encode uses.
    #[allow(dead_code)]
    adapter: String,
    /// Every crate in the set.
    crates: Vec<Library>,
}

/// One `.rlib` in the shipped set.
#[derive(Debug, Deserialize)]
struct Library {
    /// The crate name, as `--extern` and `-L dependency=` find it.
    name: String,
    /// How big it is. Recorded so a truncated tarball is visible in the manifest rather than only in
    /// a link failure.
    #[allow(dead_code)]
    bytes: u64,
    /// Whether a **program** may name this crate — the SDK and the curated library set, but not the
    /// transitive closure under them.
    ///
    /// The difference is `--extern`, which is what puts a name in a program's extern prelude;
    /// everything else is found by `-L dependency=` when something already in the graph needs it. A
    /// set that put all seventeen in the prelude would offer a model `regex_syntax` and `hashbrown`,
    /// which are crates this arm *carries* rather than crates it offers — and the catalogue's
    /// library list, reflected from the same declaration, would then be describing a smaller surface
    /// than the compile allows.
    #[serde(rename = "extern")]
    extern_: bool,
}

/// The parsed manifest, read once per process.
fn manifest() -> &'static Manifest {
    static MANIFEST: std::sync::OnceLock<Manifest> = std::sync::OnceLock::new();
    MANIFEST.get_or_init(|| {
        serde_json::from_str(MANIFEST_JSON)
            .expect("the embedded Rust toolchain manifest is valid JSON of the expected shape")
    })
}

/// Every crate name the shipped set occupies — the SDK, the curated library set, and the transitive
/// closure carried under them.
///
/// Read by [`binding_name`](super::binding_name), which may not mint a key that is one of these: a
/// module bound under a name already on `--extern` or `-L dependency=` would either shadow the crate
/// a program was told it could reach or leave `rustc` with two candidates for one name.
pub(super) fn library_crate_names() -> impl Iterator<Item = &'static str> {
    manifest()
        .crates
        .iter()
        .map(|library| library.name.as_str())
}

/// The `rustc` release a program is compiled with, for the run's own record and for an operator
/// reading a diagnostic and wondering whose it is.
pub(super) fn compiler_version() -> &'static str {
    &manifest().rustc
}

/// The target triple a program is compiled to.
pub(super) fn target() -> &'static str {
    &manifest().target
}

/// Unpack the library set now, so the first compile does not.
///
/// The whole of this language's warm-up: 9.4 MB decompressed into ~27.5 MB of `.rlib` files, once
/// per machine. The result is dropped, because a failure here is the failure the first compile will
/// make, and there it is classified, counted and reported.
pub(super) fn warm() {
    let _ = libraries();
}

/// Compile a **program** — a model's reply — into the component that evaluates it.
///
/// [`source`](PreparedProgram::source) is empty: there is nothing left for a guest to evaluate,
/// because the guest *is* what this returned.
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

/// Compile one model program into a component, or say why it could not be.
///
/// `modules` are this agent's loaded code [skills](crate::skills) and
/// [memories](crate::memories), each already through [`compile_module`]. Each is built into a
/// **crate of its own** here and named to the program's `rustc` on `--extern <key>=…`, which is the
/// same packaging the SDK arrives by: it makes the crate reachable and puts no name in the
/// program's scope. The bytes written to [`PROGRAM_FILE`] are the model's, with a module in scope
/// or without one.
///
/// # Where the `.rlib` comes from
///
/// From the read that loaded the module: [`compile_module`] built it under the binding key into
/// that key's directory in the [loaded-module band](crate::sandbox::Workspace::open_module), which
/// a preparation's reset leaves standing. This names it and compiles the model's own file alone, so
/// a turn's `rustc` count is one however much the agent has loaded.
///
/// [`build_module`] is the miss: a module handed to a program in an agent whose workspace holds no
/// build made from those bytes is built here and recorded, so the program after it names one.
fn compile(
    program: &str,
    modules: &[CodeModule],
    context: &PrepareContext,
) -> Result<Vec<u8>, PrepareFailure> {
    let libraries = libraries().map_err(PrepareFailure::Toolchain)?;
    let workspace = context.workspace().map_err(PrepareFailure::Toolchain)?;

    workspace
        .write(PROGRAM_FILE, program)
        .map_err(PrepareFailure::Toolchain)?;
    let mut externs: Vec<(String, PathBuf)> = Vec::new();
    for module in modules {
        externs.push((
            module.name.clone(),
            build_module(module, workspace, libraries, context)?,
        ));
    }

    let artifact = workspace.output().join(ARTIFACT_FILE);
    let report =
        invoke_rustc(&artifact, &externs, libraries, context).map_err(PrepareFailure::Toolchain)?;
    classify(&report, PROGRAM_FILE, program.lines().count())?;

    let module = std::fs::read(&artifact).map_err(|error| {
        PrepareFailure::Toolchain(format!(
            "rustc {} reported success and wrote no module to {}: {error}",
            compiler_version(),
            artifact.display(),
        ))
    })?;
    componentize(&module).map_err(PrepareFailure::Toolchain)
}

/// Compile a code [skill](crate::skills)'s or [memory](crate::memories)'s Rust into the crate a
/// program links, and report the names that crate offers.
///
/// This is where a module is compiled and the only place. `key` is the binding key, so the crate
/// is built under the name a program writes — `--crate-name <key>`, `lib<key>.rlib` — into that
/// key's directory in the [band](crate::sandbox::Workspace::open_module), and every program the
/// agent writes afterwards names that file on `--extern`.
///
/// Running `rustc` here is also what buys the *location*. A module that does not build would
/// otherwise take down every program the agent writes from then on, with the diagnostic arriving
/// against the turn's own program in a file the model never wrote. Here the author is told at the
/// read, at the module's own line and column.
///
/// It is a **full build** rather than `--emit=metadata`, which is what makes the read and the link
/// the same invocation: an error only the code generator raises would otherwise pass here and fail
/// against a program whose author could do nothing about it. See [`invoke_module_rustc`].
pub(super) fn compile_module(
    key: &str,
    source: &str,
    context: &PrepareContext,
) -> Result<PreparedModule, PrepareFailure> {
    let libraries = libraries().map_err(PrepareFailure::Toolchain)?;
    let workspace = context.workspace().map_err(PrepareFailure::Toolchain)?;

    let (file, artifact) = write_module(key, source, workspace)?;
    let report = invoke_module_rustc(key, &file, &artifact, libraries, context)
        .map_err(PrepareFailure::Toolchain)?;
    classify(&report, &file, source.lines().count())?;
    workspace.record_module(key, source, vec![artifact]);

    Ok(PreparedModule {
        exports: super::source::exports(source),
        source: source.to_string(),
    })
}

/// Write one module's source into its own directory in the band, and say where its `.rlib` goes.
///
/// The source file is named **relative to the working directory** because that is what `rustc`
/// reports as a diagnostic's `file_name`, and a module's author reads `modules/<key>/module_<key>.rs`
/// rather than a temporary path nobody should be shown. The artifact is absolute so the
/// `--extern <key>=…` reaching it is a path this arm wrote.
fn write_module(
    key: &str,
    source: &str,
    workspace: &Workspace,
) -> Result<(String, PathBuf), PrepareFailure> {
    let name = super::source::module_file(key);
    workspace
        .open_module(key)
        .map_err(PrepareFailure::Toolchain)?;
    workspace
        .write_module(key, &name, source)
        .map_err(PrepareFailure::Toolchain)?;
    let artifact = workspace
        .work()
        .join(workspace.module_path(key, &super::source::module_artifact(key)));
    Ok((workspace.module_path(key, &name), artifact))
}

/// Name the `.rlib` of the module bound at `module.name`, building it first when this agent's
/// workspace holds no build made from these bytes.
///
/// The build is the miss rather than the rule — a module reaching a program compile was built at the
/// read that loaded it — and it is what keeps a program handed a module this workspace never saw
/// compiling: the authorship gate's own scope, and a test that drives the program step directly.
///
/// A refusal here is **gg's own**, which is why it is a [`Lowering`](PrepareFailure::Lowering)
/// rather than anything the model is shown: every module reaching a program compile has already been
/// accepted by [`compile_module`], under this same invocation, so a refusal now is this arm
/// disagreeing with itself over somebody else's file. Handing the module author's diagnostic to the
/// model would charge it for a program it wrote correctly and could not fix.
fn build_module(
    module: &CodeModule,
    workspace: &Workspace,
    libraries: &Libraries,
    context: &PrepareContext,
) -> Result<PathBuf, PrepareFailure> {
    if let Some(artifacts) = workspace.module_build(&module.name, &module.source)
        && let Some(artifact) = artifacts.into_iter().next()
    {
        return Ok(artifact);
    }
    let (file, artifact) = write_module(&module.name, &module.source, workspace)?;
    let report = invoke_module_rustc(&module.name, &file, &artifact, libraries, context)
        .map_err(PrepareFailure::Toolchain)?;
    if !report.ok {
        return Err(PrepareFailure::Lowering(format!(
            "rustc {} refused the code module bound at `{}`, which its own read had accepted{}",
            compiler_version(),
            module.name,
            report.stderr_tail(),
        )));
    }
    workspace.record_module(&module.name, &module.source, vec![artifact.clone()]);
    Ok(artifact)
}

// ---------------------------------------------------------------------------------------------
// The compiler
// ---------------------------------------------------------------------------------------------

/// Spawn `rustc` over the model's own file, and link the module the encode turns into a component.
///
/// # `bin`, and it is the whole trick
///
/// A **binary** crate is what makes the model's `fn main` reachable at all. `rustc` compiling one
/// emits the unmangled C entry symbol wasi-libc's convention names (`__main_void`) beside the
/// model's `main` and asks `rust-lld` to export it — which is the symbol
/// `packages/gg-sandbox-rust/src/program.rs` declares and calls. A `cdylib` emits neither: there the
/// model's `main` is dead code, and the Rust-mangled symbol carries a `-C metadata` hash no `extern`
/// declaration can name (measured: `rust-lld: undefined symbol: main`).
///
/// It is also what turns "a program with no entry point" into a first-class located diagnostic —
/// `error[E0601]: main function not found in crate program` — instead of something gg has to detect
/// and word for itself.
fn invoke_rustc(
    artifact: &Path,
    externs: &[(String, PathBuf)],
    libraries: &Libraries,
    context: &PrepareContext,
) -> Result<CompilerReport, String> {
    let (rustc, mut command) = rustc(libraries, context)?;
    for (key, path) in externs {
        command
            .arg("--extern")
            .arg(format!("{key}={}", path.display()));
    }
    command
        .arg("--crate-type")
        .arg("bin")
        .arg("--crate-name")
        .arg(CRATE_NAME)
        // Not a size optimisation so much as the removal of a section nothing reads: what locates a
        // Rust program's failures is `std`'s own panic message, printed to standard error out of
        // `Location`, which is static data rather than a symbol name and survives this.
        .arg("-Cstrip=symbols");
    for argument in link_the_shell(libraries) {
        command.arg(argument);
    }
    command.arg("-o").arg(artifact).arg(PROGRAM_FILE);
    run(rustc, command)
}

/// **Link gg's shell into a program that never names `gg`**, and export what the world is answered
/// on.
///
/// The problem this solves, measured on this arm's real toolchain. `--extern gg=…` makes the crate
/// *available*; `rustc` loads it only if the program's own text refers to it, and passes
/// `--export run --export bound-operations …` to `rust-lld` only for a crate it loaded. So a program that
/// names nothing of gg's — `fn main() { let v = vec![1, 2, 3]; let _ = v[7]; }`, which is a whole
/// Rust program and a perfectly ordinary reply — links a module with **no `run` export at all**. The
/// encode below then succeeds, silently, and produces a component gg cannot call: the failure would
/// arrive as gg's own artifact being broken, and end the session over a program the model wrote
/// correctly.
///
/// So the archive is named to the linker directly and the four exports are asked for by name. What
/// each argument is for:
///
/// * `--undefined=run` makes `run` a root, which is what pulls the archive member defining it;
/// * the two `.rlib` paths are that member's archive and the `wit-bindgen` runtime it calls into —
///   both are already on `rustc`'s own link line for a program that *does* name `gg`, and naming an
///   archive twice is not an error, because archive members are taken on demand;
/// * the four `--export=` names are the world's own two exports (`run`, `bound-operations`, out of
///   `crates/gg/wit/gg-sandbox.wit`) and the two the canonical ABI fixes (`cabi_post_<name>` for a
///   returning export, and `cabi_realloc`).
///
/// The one export deliberately **not** asked for is `wit-bindgen`'s version-stamped
/// `cabi_realloc_wit_bindgen_0_60_0`, which is an implementation detail of the generator rather than
/// anything the component model names; a program that never reaches the SDK never needs it, and the
/// encode was measured to succeed without it.
///
/// It is guarded by a test rather than trusted: `rust.substrate.test.rs` drives a whole program that
/// names nothing of gg's through `run_program` end to end, so a toolchain or generator that moved
/// any of these names fails in CI rather than in a run container.
fn link_the_shell(libraries: &Libraries) -> Vec<String> {
    let mut arguments = vec!["-Clink-arg=--undefined=run".to_string()];
    for name in [SDK_CRATE, "wit_bindgen"] {
        arguments.push(format!(
            "-Clink-arg={}",
            libraries.tree.join(format!("lib{name}.rlib")).display()
        ));
    }
    for export in [
        "run",
        "bound-operations",
        "cabi_post_bound-operations",
        "cabi_realloc",
    ] {
        arguments.push(format!("-Clink-arg=--export={export}"));
    }
    arguments
}

/// Spawn `rustc` over one code module, building the `.rlib` a program links it through.
///
/// The **one** invocation a module is ever compiled by: [`compile_module`] runs it at the read that
/// binds the module, and [`build_module`] runs the same thing on the one occasion a program is
/// handed a module this workspace holds no build of.
///
/// The crate type is `lib` rather than the program's `bin`: a code module is a file of items and
/// declares no `main`, so asking for the program's crate type would refuse every module ever written
/// with `E0601`. The artifact is named absolutely rather than left to `--out-dir`, so the
/// `--extern <key>=…` that reaches it is a path this arm wrote rather than one it guessed.
fn invoke_module_rustc(
    name: &str,
    file: &str,
    artifact: &Path,
    libraries: &Libraries,
    context: &PrepareContext,
) -> Result<CompilerReport, String> {
    let (rustc, mut command) = rustc(libraries, context)?;
    command
        .arg("--crate-type")
        .arg("lib")
        .arg("--crate-name")
        .arg(name)
        .arg("-o")
        .arg(artifact)
        .arg(file);
    run(rustc, command)
}

/// A `rustc` invocation carrying everything both compiles need: where the toolchain is, which
/// target and edition, the library set, and the two settings the target leaves no choice about.
fn rustc<'a>(
    libraries: &Libraries,
    context: &'a PrepareContext,
) -> Result<(String, crate::sandbox::CompilerCommand<'a>), String> {
    let rustc = tool(RUSTC_ENV, "rustc");
    let mut command = context
        .compiler(&rustc)
        .map_err(|error| format!("{}{error}", spawn_prefix(&rustc)))?;
    command
        // The repository's own edition, so a model writes the Rust this decade rather than the Rust
        // of whichever edition happened to be `rustc`'s default.
        .arg("--edition")
        .arg("2024")
        .arg("--target")
        .arg(target())
        // wasm has no unwinder on any of its targets, so this is the only setting they support and
        // naming it is how a mismatch with the library set becomes impossible rather than implicit.
        // A panic therefore aborts — after `std` has written its own located message to standard
        // error, which is the target's whole reason for being `wasm32-wasip1`.
        .arg("-Cpanic=abort")
        // A component is instantiated by the engine on every turn, so a smaller module is a cheaper
        // turn — and `s` is measurably *faster to produce* than `0` here, because the code `wasm-ld`
        // then has to link is smaller. On a code module's own crate it is the same bargain one step
        // earlier: what a program links is the code generated here.
        .arg("-Copt-level=s")
        // Warnings are style, and a model's program is not being reviewed. An unused variable that
        // failed a turn would be gg imposing a lint policy on an experiment about capability.
        .arg("-Awarnings")
        // Structured diagnostics, so a location is a field rather than something to scrape out of
        // prose. Nothing is done to the coordinates it carries: `rustc` reads the model's own file,
        // so its line and column ARE the model's.
        .arg("--error-format=json")
        .arg("-L")
        .arg(format!("dependency={}", libraries.tree.display()));
    for library in manifest().crates.iter().filter(|library| library.extern_) {
        command.arg("--extern").arg(format!(
            "{}={}",
            library.name,
            libraries
                .tree
                .join(format!("lib{}.rlib", library.name))
                .display()
        ));
    }
    // Applied after the seam's redirection, and pointing at nothing outside this preparation's tree:
    // it selects a toolchain rather than a directory. On a developer's or CI machine `rustc` is a
    // rustup shim that resolves the toolchain from the *working directory*, and this preparation's
    // working directory is a private tree in `/tmp` with no `rust-toolchain.toml` above it — so
    // without this the shim would pick the machine's default release and the library set would be
    // refused with `E0514`. In a run container `rustc` is a real binary and this is an environment
    // variable it does not read.
    command.env("RUSTUP_TOOLCHAIN", compiler_version());
    Ok((rustc, command))
}

/// Run a prepared `rustc` invocation under this arm's timeout, naming the toolchain if it could not
/// be started at all.
fn run(
    rustc: String,
    mut command: crate::sandbox::CompilerCommand<'_>,
) -> Result<CompilerReport, String> {
    command
        .run(COMPILE_TIMEOUT)
        .map_err(|error| match error.starts_with("could not run") {
            true => format!("{}{error}", spawn_prefix(&rustc)),
            false => error,
        })
}

/// Where `rustc` is: what an operator said, then what a gg run image guarantees, then `PATH`.
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

/// What a failure to start it is prefixed with, because it is the one failure here an operator can
/// actually fix: the toolchain is not where gg looked.
fn spawn_prefix(tool: &str) -> String {
    format!(
        "gg found no Rust toolchain (`{tool}` on PATH, in {TOOLCHAIN_BIN}, or named by \
         {RUSTC_ENV}): "
    )
}

// ---------------------------------------------------------------------------------------------
// The verdicts
// ---------------------------------------------------------------------------------------------

/// One `--error-format=json` diagnostic.
#[derive(Debug, Deserialize)]
struct Diagnostic {
    /// `error`, `warning`, `note`, `help` — or `failure-note` for the summary line `rustc` ends a
    /// failed compile with.
    level: String,
    /// The prose.
    message: String,
    /// The compiler's own stable name for what went wrong: `E0308`, `E0425`. `None` for the
    /// diagnostics that have no code, which is most notes and some errors.
    code: Option<Code>,
    /// Where it was found. Empty for a diagnostic about no particular place.
    #[serde(default)]
    spans: Vec<Span>,
    /// Notes and helps hung off it — where `rustc`'s suggestions live, which is the half of its
    /// diagnostics a model gains the most from.
    #[serde(default)]
    children: Vec<Diagnostic>,
}

/// A diagnostic's error code.
#[derive(Debug, Deserialize)]
struct Code {
    /// `E0308`.
    code: String,
}

/// One span of a diagnostic. Only its start is reported: a model reads a coordinate, not a
/// rectangle.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct Span {
    /// The file it is in, as `rustc` was given it.
    file_name: String,
    /// Whether this is the span the diagnostic is *about*, as opposed to a secondary one it refers
    /// to.
    is_primary: bool,
    /// 1-based line — which on this arm is the **author's own**, because the file `rustc` read is
    /// the file the author wrote.
    line_start: usize,
    /// 1-based column.
    column_start: usize,
    /// The label written under it, when there is one.
    label: Option<String>,
}

impl Diagnostic {
    /// Whether this is one of the diagnostics a **model** is answerable for.
    fn is_error(&self) -> bool {
        self.level == "error"
    }

    /// This diagnostic, rendered in the coordinates of `file` — the model's own program, or the
    /// module whose author is being told about it.
    ///
    /// `rustc`'s own `rendered` field is deliberately not used: it carries a source excerpt, and a
    /// rendering gg assembles from the structured fields is the one that cannot disagree with the
    /// location gg reports.
    fn render(&self, file: &str, lines: usize) -> String {
        let mut rendered = match &self.code {
            Some(code) => format!("error[{}]: {}", code.code, self.message),
            None => format!("error: {}", self.message),
        };
        if let Some(span) = self.primary(file, lines) {
            rendered.push_str(&format!(
                "\n  --> line {}, column {}",
                span.line_start, span.column_start
            ));
            if let Some(label) = &span.label {
                rendered.push_str(&format!("\n  {label}"));
            }
        }
        // `rustc`'s suggestions are the most valuable thing it says and they are all in the
        // children: `help: consider borrowing here`, `note: expected `&str`, found `String``.
        for child in &self.children {
            rendered.push_str(&format!("\n  {}: {}", child.level, child.message));
        }
        rendered
    }

    /// The span this diagnostic is about, in the author's own text.
    ///
    /// A diagnostic whose only spans are in a library, or — for a program compiled against code
    /// modules — in **somebody else's crate**, has none: reporting its line as if it were the
    /// model's would point at whichever of the model's lines shares the number.
    ///
    /// `lines` is what holds that to the author's own text rather than to the file name alone. A
    /// span past the author's last line is reported without a location, which is the honest answer
    /// for a coordinate the author cannot act on.
    fn primary(&self, file: &str, lines: usize) -> Option<&Span> {
        self.spans.iter().find(|span| {
            span.is_primary && span.file_name == file && (1..=lines).contains(&span.line_start)
        })
    }
}

/// How many distinct diagnostics a model is shown.
///
/// Eight, which is [the number Kotlin measured](super::super::kotlin) and the one the
/// [shared bound](super::super::diagnostics) is asked for by every arm with no reason to differ.
/// This arm's reason to keep it is its own measurement: one misremembered SDK name called at fifty
/// call sites is 5982 bytes across 201 lines of `rustc`, so a diagnostic here costs ~120 bytes and ~4
/// lines and eight of them is ~1 KB — a screenful, which is what a model can act on before it is
/// reading repetitions.
///
/// Four lines for a *compact* rendering is not an accident of it. [`render`](Diagnostic::render)
/// appends **every** `child`, and the children are where `rustc` puts the half of a diagnostic a
/// model gains the most from — the `help: consider borrowing here` and the `note:` naming the type
/// it expected against the one it found. Dropping them to fit more diagnostics in would trade the
/// sentence that says what to do for more copies of the sentence that says what is wrong.
///
/// The count is a pure error count, unlike an arm that has to reason about warnings: the
/// [invocation](rustc) passes `-Awarnings` because a model's program is not being reviewed for
/// style, so every diagnostic that reaches here is one `rustc` refused to compile over.
const SHOWN: usize = 8;

/// Turn a finished `rustc` invocation into a verdict.
///
/// The split is the seam's: a compiler that **read the program and rejected it** is a
/// [`PrepareError::Compile`] the model is shown and can act on; a compiler that could not finish is
/// a [`PrepareFailure::Toolchain`] the model is not blamed for. `rustc` exits non-zero for both, so
/// the evidence is whether it emitted a diagnostic at `error` level at all.
///
/// Everything a Rust compiler rejects arrives as [`Compile`](PrepareError::Compile) and not as
/// [`Syntax`](PrepareError::Syntax), and that is a fact about the language rather than a shortcut.
/// `rustc` has no parse-only phase a program passes before meaning is considered, and it does not
/// mark a diagnostic as a parse failure — an unclosed brace and a borrow error are both an
/// `error[E….]` from one pass over the file. Inventing the distinction from the error code would be
/// gg guessing at a taxonomy the compiler does not have.
fn classify(report: &CompilerReport, file: &str, lines: usize) -> Result<(), PrepareFailure> {
    if report.ok {
        return Ok(());
    }
    // One JSON object per line on stderr, and — because a toolchain may write to stderr for other
    // reasons — a line that is not one is skipped rather than treated as a failure to read the
    // diagnostics at all.
    let diagnostics: Vec<Diagnostic> = report
        .stderr
        .lines()
        .filter_map(|line| serde_json::from_str::<Diagnostic>(line).ok())
        .collect();
    let errors: Vec<&Diagnostic> = diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.is_error())
        .collect();
    if errors.is_empty() {
        return Err(PrepareFailure::Toolchain(format!(
            "rustc {} {} without reporting a diagnostic in {file}{}",
            compiler_version(),
            report.status,
            report.stderr_tail(),
        )));
    }

    // A diagnostic inside the library set is gg's artifact rather than the model's program — but it is still reported, because withholding it would leave the model with
    // "your program did not compile" and nothing else. What is *not* done is inventing a line for
    // it: `render` reports a location only for a span in the model's own file.
    //
    // Which band this is was settled above, on the WHOLE set: every error is a `Compile` on this
    // arm and the only other outcome — a `Toolchain` failure — was decided by `errors` being empty
    // before a single diagnostic was rendered. So the bound below cannot move a verdict from one
    // band to the other; all it decides is how much of a refusal the model reads.
    Err(PrepareFailure::Program(PrepareError::Compile(
        crate::sandbox::language::diagnostics::capped(
            errors
                .iter()
                .map(|diagnostic| diagnostic.render(file, lines))
                .collect(),
            SHOWN,
            "\n\n",
        ),
    )))
}

// ---------------------------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------------------------

/// Encode the core wasm module `rustc` emitted into the component gg's engine instantiates.
///
/// In process, from the bytes, with no `wasm-tools` binary anywhere: the module carries the
/// `component-type` custom sections `wit-bindgen` wrote into the library set, and those sections
/// *are* the world — so this step reads gg's own WIT out of the artifact rather than being told it
/// again. `-C strip=symbols` deletes the name section and leaves them, which was measured rather
/// than assumed.
///
/// [`ADAPTER`] is what makes the target's own imports satisfiable. `wasm32-wasip1` is a preview1
/// target, so the module `rustc` links imports `wasi_snapshot_preview1`; the adapter implements that
/// namespace in terms of the preview 2 interfaces gg's linker provides, which is what gives a Rust
/// program a real standard error to fail into. It is the **reactor** adapter, and the module's own
/// `_start` is left unused: this component's entry point is the world's `run`, which
/// `packages/gg-sandbox-rust/src/program.rs` answers and which calls the model's `main` itself.
///
/// Validated on the way out. An invalid component would otherwise fail at
/// [`Component::new`](wasmtime::component::Component) as a
/// [`SandboxError::Compile`](crate::sandbox::SandboxError) — the variant that means gg's *own*
/// embedded artifact is broken and ends the session — where what it really is is a toolchain
/// failure on one turn.
fn componentize(module: &[u8]) -> Result<Vec<u8>, String> {
    wit_component::ComponentEncoder::default()
        .validate(true)
        .module(module)
        .and_then(|encoder| encoder.adapter(ADAPTER_NAME, ADAPTER))
        .and_then(|mut encoder| encoder.encode())
        .map_err(|error| {
            format!(
                "rustc {} compiled the program and gg could not encode it as a component: {error:#}",
                compiler_version()
            )
        })
}

// ---------------------------------------------------------------------------------------------
// The library set
// ---------------------------------------------------------------------------------------------

/// Where the embedded library set is unpacked, for this process.
struct Libraries {
    /// The directory holding every `.rlib`, named on `-L dependency=` and `--extern`.
    tree: PathBuf,
}

/// The unpacked library set, materialised once per process.
fn libraries() -> Result<&'static Libraries, String> {
    static LIBRARIES: std::sync::OnceLock<Result<Libraries, String>> = std::sync::OnceLock::new();
    LIBRARIES
        .get_or_init(materialise)
        .as_ref()
        .map_err(Clone::clone)
}

/// Unpack the embedded set into a [shared toolchain directory](shared_toolchain_dir).
///
/// The seam's one sanctioned share, taken under the seam's discipline: the key folds in the pinned
/// compiler **and** a digest of the tarball itself, so a gg carrying a different set at the same
/// compiler version reads a different directory rather than another build's files; the write goes
/// through [`place_tree`], which fills a staging directory, seals it read-only and renames it in,
/// so a reader never sees a half-unpacked tree and nothing can write to a placed one.
///
/// Sharing it needs no further argument than that, because `rustc` only ever **reads** it. Nothing
/// is compiled into it, nothing is generated beside it, and no preparation's output goes anywhere
/// near it — which is what lets this arm name the shared directory directly rather than staging a
/// copy per preparation the way the PureScript arm must.
fn materialise() -> Result<Libraries, String> {
    let root = shared_toolchain_dir(&format!(
        "rust-{}-{:016x}",
        compiler_version(),
        fingerprint(),
    ))?;
    let tree = root.join("lib");
    place_tree(&tree, unpack)?;
    Ok(Libraries { tree })
}

/// Decompress and extract the embedded tarball into `into`.
fn unpack(into: &Path) -> Result<(), String> {
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(LIBRARIES_TAR_GZ));
    // The tarball is gg's own build artifact rather than anything a run produced, but the extraction
    // is still confined to `into`: an archive is a file format, and a file format is the wrong place
    // to be trusting.
    archive.set_overwrite(true);
    archive
        .unpack(into)
        .map_err(|error| format!("could not unpack the Rust library set: {error}"))
}

/// A stable digest of the embedded tarball, so a change to it changes the directory it is unpacked
/// into. Not cryptographic and not required to be: it distinguishes builds, it does not defend
/// against one.
fn fingerprint() -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    LIBRARIES_TAR_GZ.hash(&mut hasher);
    hasher.finish()
}

        .lines()
        .filter(|line| line.contains("error[E0432]") || line.contains("error[E0433]"))
        .flat_map(|line| crate::sandbox::language::diagnostics::named(line, "`", "`"))
        .collect()
}

#[cfg(test)]
#[path = "rust.compile.test.rs"]
mod tests;
